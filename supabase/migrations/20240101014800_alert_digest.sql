-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 108 — Alert digest quotidien (table recipients + RPC + cron)
--
-- BUT
--   Compléter Sentry (errors en temps réel via les SDK) + observability page
--   (lecture admin manuelle) avec un PUSH quotidien : un email récap envoyé
--   le matin si quelque chose mérite l'attention (errors > 0, warnings ≥ 5,
--   ou silence total = potentiel cron cassé). Sans ça, l'admin doit penser
--   à check la page — pas viable en routine solo.
--
-- ARCHITECTURE
--   1. Table `niqo_alert_recipients` : liste des emails qui reçoivent le digest.
--      RLS admin-only (SELECT) + grants pour permettre l'Edge Function service_role
--      de lire les recipients actifs.
--   2. RPC `get_alert_digest_24h()` : agrège niqo_event_log sur 24h en jsonb
--      (total, by_module_severity, top_errors). Réutilisable depuis l'Edge
--      Function send-alert-digest et depuis SQL Editor pour debug.
--   3. Helper `_invoke_alert_digest()` : appelle l'Edge Function via pg_net
--      avec NIQO_INTERNAL_KEY (pattern mig 65, fire-and-forget).
--   4. Cron quotidien 8h UTC (9h Abidjan / 10h Brazzaville) qui call le helper.
--
-- DÉCLENCHEUR D'EMAIL (côté Edge Function — non encodé dans le SQL)
--   - errors > 0 en 24h         → email
--   - warnings ≥ 5 en 24h       → email
--   - total = 0 en 24h          → email (signal cron mort)
--   - sinon                     → skip (silence si tout est ok et il y a du trafic)
--
-- PRÉREQUIS
--   - Extension pg_net activée (déjà fait pour mig 65)
--   - Extension supabase_vault activée (déjà fait pour mig 02)
--   - Secret `service_role_key` dans vault (déjà fait pour mig 65/77)
--   - Edge Function `send-alert-digest` déployée
--   - Secrets Supabase Edge : RESEND_API_KEY, ALERT_EMAIL_FROM (optionnel)
--
-- POST-DEPLOY — AJOUTER SES EMAILS DESTINATAIRES
--   insert into public.niqo_alert_recipients (email, label) values
--     ('hdbosshdboss01@gmail.com', 'Dominique Huang');
--
-- VÉRIFICATION
--   select public.get_alert_digest_24h();
--   select jobname, schedule from cron.job where jobname = 'niqo-alert-digest';
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table niqo_alert_recipients ──────────────────────────────────────────

create table if not exists public.niqo_alert_recipients (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  label      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Index unique sur email (lowercase pour éviter les doublons de casse)
create unique index if not exists idx_niqo_alert_recipients_email_unique
  on public.niqo_alert_recipients (lower(email));

-- Index pour la query d'envoi (filtre active=true)
create index if not exists idx_niqo_alert_recipients_active
  on public.niqo_alert_recipients (active)
  where active = true;

comment on table public.niqo_alert_recipients is
  'Destinataires du digest d''alerte quotidien envoyé par send-alert-digest (mig 108). Admin only — gestion via SQL Editor.';

-- ── 2. RLS deny-by-default + grants ─────────────────────────────────────────

alter table public.niqo_alert_recipients enable row level security;

revoke all on public.niqo_alert_recipients from public, anon, authenticated;

-- Admin peut lire (page admin future ou debug SQL Editor)
drop policy if exists niqo_alert_recipients_select_admin on public.niqo_alert_recipients;
create policy niqo_alert_recipients_select_admin on public.niqo_alert_recipients
  for select
  to authenticated
  using (
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );

grant select on public.niqo_alert_recipients to authenticated;

-- Pas de INSERT/UPDATE/DELETE policy : gestion via SQL Editor service_role.
-- L'admin web pourra ajouter une UI plus tard si besoin.

-- ── 3. RPC get_alert_digest_24h ─────────────────────────────────────────────
-- Retourne un jsonb prêt à consommer côté Edge Function :
--   {
--     window_hours: 24,
--     total: <n>,
--     totals_by_severity: { info, warning, error, debug },
--     by_module: [{ module, total, error_count, warning_count, info_count }],
--     top_errors: [{ event_type, module, cnt }],
--     generated_at: <iso>
--   }

create or replace function public.get_alert_digest_24h()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_total int;
  v_totals_by_severity jsonb;
  v_by_module jsonb;
  v_top_errors jsonb;
begin
  select count(*) into v_total
  from public.niqo_event_log
  where occurred_at > v_since;

  select coalesce(jsonb_object_agg(severity, cnt), '{}'::jsonb)
  into v_totals_by_severity
  from (
    select severity, count(*) as cnt
    from public.niqo_event_log
    where occurred_at > v_since
    group by severity
  ) s;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_by_module
  from (
    select
      module,
      count(*) as total,
      count(*) filter (where severity = 'error') as error_count,
      count(*) filter (where severity = 'warning') as warning_count,
      count(*) filter (where severity = 'info') as info_count
    from public.niqo_event_log
    where occurred_at > v_since
    group by module
    order by error_count desc, total desc
  ) t;

  select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb)
  into v_top_errors
  from (
    select event_type, module, count(*) as cnt
    from public.niqo_event_log
    where occurred_at > v_since and severity = 'error'
    group by event_type, module
    order by cnt desc
    limit 10
  ) e;

  return jsonb_build_object(
    'window_hours', 24,
    'total', v_total,
    'totals_by_severity', v_totals_by_severity,
    'by_module', v_by_module,
    'top_errors', v_top_errors,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.get_alert_digest_24h() from public, anon, authenticated;
grant execute on function public.get_alert_digest_24h() to service_role;

comment on function public.get_alert_digest_24h() is
  'Agrège niqo_event_log sur 24h pour le digest email (mig 108). Service role only.';

-- ── 4. URL de l'Edge Function stockée dans Vault ───────────────────────────

do $$
begin
  perform vault.create_secret(
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-alert-digest',
    'alert_digest_function_url',
    'URL Edge Function send-alert-digest (mig 108)'
  );
exception
  when unique_violation then null;  -- déjà stocké
end $$;

-- ── 5. Helper _invoke_alert_digest ─────────────────────────────────────────
-- Appelé par le cron quotidien. Fire-and-forget via pg_net.

create or replace function public._invoke_alert_digest()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_url text;
  v_key text;
begin
  -- URL : lecture vault avec fallback hardcodé
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'alert_digest_function_url'
  limit 1;
  if v_url is null then
    v_url := 'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-alert-digest';
  end if;

  -- Auth : NIQO_INTERNAL_KEY (cf send-push-notification mig 77)
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_key is null then
    raise notice 'service_role_key absent du Vault — skip alert digest';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
exception
  when others then
    -- L'alerte digest ne doit jamais casser le cron — log warning et continue.
    raise warning '_invoke_alert_digest failed: % %', sqlstate, sqlerrm;
end;
$$;

revoke all on function public._invoke_alert_digest() from public, anon, authenticated;
-- pg_cron tourne en superuser, pas besoin de grant explicite.

comment on function public._invoke_alert_digest() is
  'Invoke send-alert-digest via pg_net. Appelé par le cron niqo-alert-digest (mig 108).';

-- ── 6. Cron quotidien 8h UTC ───────────────────────────────────────────────
-- 8h UTC = 9h Abidjan (UTC+0) = 9h Brazzaville (UTC+1). Heure où l'admin commence
-- typiquement sa journée → digest dans la boîte à l'ouverture.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'niqo-alert-digest') then
    perform cron.unschedule('niqo-alert-digest');
  end if;
exception
  when undefined_table then null;
end $$;

do $$
begin
  perform cron.schedule(
    'niqo-alert-digest',
    '0 8 * * *',  -- 8:00 UTC quotidien
    $cron$select public._invoke_alert_digest();$cron$
  );
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — alert digest cron skipped';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 106 — niqo_event_log + RPC log_event + cron purge 30j
--
-- CONTEXTE
--   Sentry (intégré 2026-05-10, commit 5038ffd) capture les ERREURS sur les 3
--   surfaces (Edge Functions, mobile, Next.js admin). Mais Sentry n'agrège pas
--   les flux qui marchent : combien de pushs envoyés en 24h, combien de
--   webhooks PawaPay COMPLETED vs FAILED, santé des 9 crons, etc.
--
--   Cette table comble le gap : event log structuré, lu par le dashboard
--   /admin/observability (Phase 2 plan observabilité).
--
-- DESIGN
--   - Append-only par les Edge Functions / triggers DB / crons via RPC log_event
--   - RLS deny-by-default : seul admin (via users.is_admin) peut lire en REST
--   - Service role bypass RLS automatiquement (Edge Functions + triggers DB)
--   - Purge auto à 30j via pg_cron (idéal pour le free tier Supabase, ~120k rows max)
--
-- SCHÉMA
--   id           bigint identity PK
--   occurred_at  timestamptz default now() (indexé desc)
--   module       text — surface qui a émis ('send-push', 'pawapay-webhook', cron name, etc.)
--   event_type   text — verbe métier ('push.sent', 'webhook.completed', 'cron.run.ok')
--   severity     text — debug | info | warning | error
--   payload      jsonb — données contextuelles (counts, ids, etc.)
--   user_id      uuid — optionnel, lien vers auth.users si applicable
--
-- VÉRIFICATION POST-DEPLOY
--   -- En tant qu'admin Supabase Dashboard SQL Editor :
--   select public.log_event('test', 'manual.smoketest', 'info', '{"foo":"bar"}');
--   select * from public.niqo_event_log order by id desc limit 1;
--   -- Doit retourner la row insérée.
--
--   -- Vérifier que le cron est planifié :
--   select jobname, schedule from cron.job where jobname = 'purge-niqo-event-log';
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase, §Backend ownership.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table niqo_event_log ─────────────────────────────────────────────────

create table if not exists public.niqo_event_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  module      text not null,
  event_type  text not null,
  severity    text not null default 'info'
              check (severity in ('debug', 'info', 'warning', 'error')),
  payload     jsonb not null default '{}'::jsonb,
  user_id     uuid references auth.users(id) on delete set null
);

-- Index pour les requêtes du dashboard (« derniers events par module 24h »,
-- « tous les events par type sur 7j »).
create index if not exists idx_niqo_event_log_module_time
  on public.niqo_event_log (module, occurred_at desc);

create index if not exists idx_niqo_event_log_type_time
  on public.niqo_event_log (event_type, occurred_at desc);

-- Index pour la purge cron (range scan sur occurred_at).
create index if not exists idx_niqo_event_log_occurred_at
  on public.niqo_event_log (occurred_at);

comment on table public.niqo_event_log is
  'Event log structuré pour observabilité (mig 106). Append-only via log_event(). RLS deny-by-default, admin only via REST. Rétention 30j via cron purge-niqo-event-log.';

-- ── 2. RLS deny-by-default + policy admin SELECT ───────────────────────────

alter table public.niqo_event_log enable row level security;

-- Revoke défensif des grants par défaut.
revoke all on public.niqo_event_log from public, anon, authenticated;

-- Admin (Dominique Huang via users.is_admin) peut lire pour le dashboard.
drop policy if exists niqo_event_log_select_admin on public.niqo_event_log;
create policy niqo_event_log_select_admin on public.niqo_event_log
  for select
  to authenticated
  using (
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );

-- Pas de policy INSERT : seuls service_role + RPC SECURITY DEFINER peuvent insérer.

-- ── 3. RPC log_event ────────────────────────────────────────────────────────
-- SECURITY DEFINER pour permettre l'insert depuis les Edge Functions (service_role
-- pourrait insérer direct, mais la RPC standardise + valide). Aussi appelable
-- depuis les triggers DB (insert depuis fn_after_paiement_completed par ex.).

create or replace function public.log_event(
  p_module     text,
  p_event_type text,
  p_severity   text default 'info',
  p_payload    jsonb default '{}'::jsonb,
  p_user_id    uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id bigint;
begin
  -- Validation : empêche les severities invalides (le CHECK contrainte ferait
  -- crash le caller, on préfère un message explicite).
  if p_severity not in ('debug', 'info', 'warning', 'error') then
    raise exception 'log_event_invalid_severity' using hint = p_severity;
  end if;

  -- Garde-fou : module + event_type non vides
  if p_module is null or length(trim(p_module)) = 0 then
    raise exception 'log_event_module_required';
  end if;
  if p_event_type is null or length(trim(p_event_type)) = 0 then
    raise exception 'log_event_event_type_required';
  end if;

  insert into public.niqo_event_log (module, event_type, severity, payload, user_id)
  values (p_module, p_event_type, p_severity, coalesce(p_payload, '{}'::jsonb), p_user_id)
  returning id into v_id;

  return v_id;
exception
  -- Le log d'événements ne doit JAMAIS faire échouer le caller métier
  -- (un push qui marche ne doit pas crasher parce que log_event a un souci).
  -- On capture toute exception et on retourne null. La perte d'un event log
  -- est acceptable, un push perdu ne l'est pas.
  when others then
    raise warning 'log_event_failed: % %', sqlstate, sqlerrm;
    return null;
end;
$$;

-- Accès restreint : seul service_role peut l'appeler (Edge Functions + triggers
-- SECURITY DEFINER qui passent par service_role). Pas d'accès anon/authenticated
-- direct — un user ne doit pas pouvoir polluer l'event log depuis le client.
revoke all on function public.log_event(text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.log_event(text, text, text, jsonb, uuid) to service_role;

comment on function public.log_event(text, text, text, jsonb, uuid) is
  'Append-only logger pour niqo_event_log. SECURITY DEFINER. Catch-all sur exceptions (un échec de log ne casse jamais le caller métier). Accessible service_role uniquement (Edge Functions, triggers).';

-- ── 4. Cron purge 30j ───────────────────────────────────────────────────────
-- Tourne tous les jours à 4h05 UTC (5min après la purge des boosts, pour
-- éviter une fenêtre de pic).

do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — skipping cron schedule. Enable extension and re-run this migration.';
end $$;

-- Unschedule défensif pour permettre rejouer la mig sans erreur.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-niqo-event-log') then
    perform cron.unschedule('purge-niqo-event-log');
  end if;
exception
  when undefined_table then null;  -- pg_cron pas installé
end $$;

-- Planifier la purge des events > 30j.
do $$
begin
  perform cron.schedule(
    'purge-niqo-event-log',
    '5 4 * * *',  -- 4:05 UTC quotidien
    $cron$delete from public.niqo_event_log where occurred_at < now() - interval '30 days'$cron$
  );
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — purge cron skipped. Run: create extension pg_cron;';
end $$;

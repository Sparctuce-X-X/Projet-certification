-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 109 — Instrumenter les 10 crons DB existants
--
-- BUT
--   Aujourd'hui les 10 crons pg_cron tournent silencieusement : seul
--   `cron.job_run_details` capture les exécutions, et ce n'est pas exposé au
--   dashboard /admin/observability. Conséquence : si `expire-annonces` arrête
--   de tourner, l'admin ne le voit pas dans le dashboard ni dans le digest.
--
--   Cette mig wrappe chaque cron pour logger dans niqo_event_log :
--     - cron.run    (info)  : exécution réussie, avec duration_ms
--     - cron.error  (error) : exception capturée, avec sqlstate + message
--
-- ARCHITECTURE
--   1. Helper générique `_cron_run_logged(cron_name, fn_name)` : execute la
--      fonction via EXECUTE format(%I) (whitelist anti-injection), log dans
--      niqo_event_log avec duration, re-raise les exceptions pour que pg_cron
--      les voie dans job_run_details.
--   2. 2 wrappers dédiés pour les crons avec SQL inline (mig 04, 16) : ils
--      transforment le DELETE/UPDATE inline en RPC réutilisable par
--      _cron_run_logged.
--   3. 10 reschedule (unschedule + schedule) pour passer chaque cron par
--      `_cron_run_logged`.
--
-- CRONS INSTRUMENTÉS (10)
--   niqo-purge-suspended-users    → mig 04 — inline DELETE → wrapper _cron_purge_suspended_users
--   expire-annonces               → mig 16 — inline UPDATE → wrapper _cron_expire_annonces
--   purge-expired-annonces        → mig 16 — fn_purge_expired_annonces
--   avis-auto-j7                  → mig 37 — fn_avis_auto_j7
--   purge-expired-kyc-verifications → mig 54 — purge_expired_kyc_verifications
--   purge-expired-boosts          → mig 60/62 — purge_expired_boosts
--   purge-stale-push-tokens       → mig 68 — purge_stale_push_tokens
--   rencontre-reminder            → mig 87 — fn_push_rencontre_reminder
--   mark-vendue-reminder          → mig 90 — fn_push_mark_vendue_reminder
--   rdv-reminder                  → mig 97 — fn_push_rdv_reminder
--
-- DÉJÀ INSTRUMENTÉS (non touchés ici)
--   purge-niqo-event-log          → mig 106 — pas instrumenté (log_event sur soi serait récursif et de toute façon inutile)
--   niqo-alert-digest             → mig 108 — log via send-alert-digest Edge Function
--
-- VÉRIFICATION POST-DEPLOY
--   select public._cron_run_logged('test-cron', 'log_event');  -- doit logger 'test-cron'
--   select count(*) from cron.job;  -- doit toujours retourner 12
--   -- Attendre que le cron rdv-reminder tourne (heure :00) :
--   select * from niqo_event_log where module = 'rdv-reminder' order by id desc limit 5;
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Helper générique _cron_run_logged ───────────────────────────────────

create or replace function public._cron_run_logged(
  p_cron_name text,
  p_fn_name   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_started     timestamptz := clock_timestamp();
  v_duration_ms integer;
begin
  -- Anti-injection : on contrôle les callers (uniquement nos cron.schedule)
  -- mais belt-and-braces sur le nom de fonction passé en argument.
  if p_fn_name !~ '^[a-zA-Z_][a-zA-Z0-9_]*$' then
    raise exception 'invalid_fn_name' using hint = p_fn_name;
  end if;

  execute format('select public.%I()', p_fn_name);

  v_duration_ms := round(extract(epoch from clock_timestamp() - v_started) * 1000)::integer;

  perform public.log_event(
    p_cron_name,
    'cron.run',
    'info',
    jsonb_build_object('fn', p_fn_name, 'duration_ms', v_duration_ms)
  );
exception when others then
  v_duration_ms := round(extract(epoch from clock_timestamp() - v_started) * 1000)::integer;
  perform public.log_event(
    p_cron_name,
    'cron.error',
    'error',
    jsonb_build_object(
      'fn',          p_fn_name,
      'sqlstate',    sqlstate,
      'message',     sqlerrm,
      'duration_ms', v_duration_ms
    )
  );
  -- Re-raise pour que cron.job_run_details voie l'échec aussi (sinon ça pourrait
  -- masquer un cron en panne à un opérateur qui regarde Supabase Dashboard).
  raise;
end;
$$;

revoke all on function public._cron_run_logged(text, text) from public, anon, authenticated;

comment on function public._cron_run_logged(text, text) is
  'Wrapper pg_cron : execute public.<fn>() + log dans niqo_event_log (mig 109). Re-raise les exceptions pour cron.job_run_details.';

-- ── 2. Wrappers pour les 2 crons inline SQL (mig 04, mig 16) ───────────────

-- mig 04 — niqo-purge-suspended-users (DELETE auth.users where is_active=false >30j)
create or replace function public._cron_purge_suspended_users()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from auth.users
  where id in (
    select id from public.users
    where is_active = false
      and updated_at < now() - interval '30 days'
  );
end;
$$;

revoke all on function public._cron_purge_suspended_users() from public, anon, authenticated;

comment on function public._cron_purge_suspended_users() is
  'Wrapper pour cron niqo-purge-suspended-users (mig 04). Preserve la sémantique RGPD pt 7 : purge auto comptes is_active=false depuis >30j.';

-- mig 16 — expire-annonces (UPDATE annonces SET statut=expiree)
create or replace function public._cron_expire_annonces()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.annonces
  set statut = 'expiree', updated_at = now()
  where statut = 'active'
    and expires_at < now();
end;
$$;

revoke all on function public._cron_expire_annonces() from public, anon, authenticated;

comment on function public._cron_expire_annonces() is
  'Wrapper pour cron expire-annonces (mig 16). Preserve la sémantique : annonces actives dont expires_at est passé → statut=expiree.';

-- ── 3. Reschedule des 10 crons via _cron_run_logged ────────────────────────

-- Helper local : unschedule défensif + schedule avec wrapper logged.
do $reschedule$
declare
  v_targets jsonb := jsonb_build_array(
    jsonb_build_object('name', 'niqo-purge-suspended-users',     'schedule', '0 3 * * *',      'fn', '_cron_purge_suspended_users'),
    jsonb_build_object('name', 'expire-annonces',                'schedule', '0 2 * * *',      'fn', '_cron_expire_annonces'),
    jsonb_build_object('name', 'purge-expired-annonces',         'schedule', '0 3 * * *',      'fn', 'fn_purge_expired_annonces'),
    jsonb_build_object('name', 'avis-auto-j7',                   'schedule', '0 4 * * *',      'fn', 'fn_avis_auto_j7'),
    jsonb_build_object('name', 'purge-expired-kyc-verifications','schedule', '0 3 * * *',      'fn', 'purge_expired_kyc_verifications'),
    jsonb_build_object('name', 'purge-expired-boosts',           'schedule', '*/15 * * * *',   'fn', 'purge_expired_boosts'),
    jsonb_build_object('name', 'purge-stale-push-tokens',        'schedule', '0 3 * * *',      'fn', 'purge_stale_push_tokens'),
    jsonb_build_object('name', 'rencontre-reminder',             'schedule', '0 10 * * *',     'fn', 'fn_push_rencontre_reminder'),
    jsonb_build_object('name', 'mark-vendue-reminder',           'schedule', '0 10 * * *',     'fn', 'fn_push_mark_vendue_reminder'),
    jsonb_build_object('name', 'rdv-reminder',                   'schedule', '0 * * * *',      'fn', 'fn_push_rdv_reminder')
  );
  v_target jsonb;
  v_command text;
begin
  for v_target in select * from jsonb_array_elements(v_targets)
  loop
    -- Unschedule défensif (si le job existe, sinon ignore)
    if exists (select 1 from cron.job where jobname = v_target->>'name') then
      perform cron.unschedule(v_target->>'name');
    end if;

    -- Schedule avec wrapper logged
    v_command := format(
      'select public._cron_run_logged(%L, %L)',
      v_target->>'name',
      v_target->>'fn'
    );
    perform cron.schedule(
      v_target->>'name',
      v_target->>'schedule',
      v_command
    );
  end loop;
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — cron reschedule skipped. Run: create extension pg_cron;';
end $reschedule$;

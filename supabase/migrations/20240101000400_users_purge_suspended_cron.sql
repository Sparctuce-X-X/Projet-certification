-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 04 — Purge auto comptes suspendus >30 jours (RGPD point 7)
--
-- Tout user avec is_active=false depuis >30j est définitivement supprimé via
-- pg_cron. Aligne la rétention des comptes suspendus sur le principe RGPD de
-- limitation de la conservation.
--
-- Cf. CLAUDE.md §RGPD point 7 + docs/rgpd-audit.md entrée #1 §rétention.
--
-- À jouer dans Supabase SQL Editor APRÈS 03_user_account_deletion.sql.
--
-- ⚠ Prérequis : pg_cron extension activable depuis Supabase Dashboard →
-- Database → Extensions → pg_cron (toggle ON). Sur les projets Free/Pro c'est
-- supporté ; vérifier avant de jouer cette migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enable pg_cron extension (idempotent) ────────────────────────────────
-- Doit être créée dans le schema 'extensions' (convention Supabase).

create extension if not exists pg_cron with schema extensions;

-- ── 2. Idempotence du job — unschedule si déjà créé ────────────────────────
-- cron.unschedule(jobname) lève si le job n'existe pas → wrap dans un EXCEPTION.

do $$
begin
  perform cron.unschedule('niqo-purge-suspended-users');
exception when others then
  -- Job n'existe pas encore — premier run de cette migration. OK.
  null;
end $$;

-- ── 3. Schedule du job — 3am UTC daily ─────────────────────────────────────
-- Cron expression : "0 3 * * *" = tous les jours à 03:00 UTC.
-- 3am UTC = 4am Abidjan (UTC+0 winter, mais CI ne passe pas à l'heure d'été)
--         = 4am Brazzaville (UTC+1)
-- → heure creuse pour minimiser conflit avec trafic users.
--
-- La query supprime depuis auth.users (ON DELETE CASCADE → public.users + tout
-- ce qui réfèrera plus tard).

select cron.schedule(
  'niqo-purge-suspended-users',
  '0 3 * * *',
  $cron$
    delete from auth.users
    where id in (
      select id from public.users
      where is_active = false
        and updated_at < now() - interval '30 days'
    );
  $cron$
);

-- ── 4. Vérification — voir les jobs programmés ─────────────────────────────
-- À exécuter manuellement dans le SQL Editor pour confirmer :
--
--   select jobid, schedule, command, jobname, active
--   from cron.job
--   where jobname = 'niqo-purge-suspended-users';
--
-- Pour voir l'historique des exécutions :
--
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'niqo-purge-suspended-users')
--   order by start_time desc limit 10;

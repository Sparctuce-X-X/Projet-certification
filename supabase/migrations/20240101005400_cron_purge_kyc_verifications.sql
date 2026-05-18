-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 54 — Cron purge cni-verifications (RGPD)
--
-- Tient la promesse RGPD affichée à l'user dans le wizard KYC :
--   - 30 jours après refus → suppression auto
--   - 6 mois après validation → suppression auto
--
-- Sans cette migration, les CNI s'accumulent indéfiniment → violation directe :
--   - ARTCI 2024-30 art. 25 (durée de conservation, Côte d'Ivoire)
--   - ANRTIC 2023-15 (Congo, équivalent)
--   - Loi rwandaise 2021-058 (entité légale Niqo)
--
-- Architecture :
--   1. Trigger BEFORE DELETE on verifications_identite → purge Storage
--      (les 3 fichiers cni_recto_path / cni_verso_path / selfie_path).
--   2. Function purge_expired_kyc_verifications() → DELETE rows expirées.
--      Le trigger #1 s'occupe automatiquement de Storage.
--   3. Cron pg_cron quotidien (3h UTC = 4h CI/CG) qui appelle #2.
--
-- ⚠ Prérequis : extension pg_cron activée dans Supabase Dashboard
--   → Database → Extensions → pg_cron → Enable
--
-- Le trigger #1 est aussi utilisé par d'autres mécanismes futurs :
--   - Admin qui supprime manuellement une verification depuis le back-office
--   - Cascade depuis users (déjà : ON DELETE CASCADE via FK)
--   → Garantit que Storage et DB restent synchrones quoi qu'il arrive.
--
-- Prérequis : migrations 45 (verifications_identite) + 46 (Storage RLS).
-- Idempotente. Cf. CLAUDE.md §RGPD.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Trigger BEFORE DELETE — purge Storage des 3 fichiers liés ────────────

create or replace function public.purge_cni_storage_on_verif_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  -- Supabase Storage = table `storage.objects`. SECURITY DEFINER bypass la
  -- RLS qui interdit DELETE aux non-admin (mig 46).
  delete from storage.objects
   where bucket_id = 'cni-verifications'
     and name in (
       old.cni_recto_path,
       old.cni_verso_path,
       old.selfie_path
     );
  return old;
end;
$$;

drop trigger if exists trg_purge_cni_storage on public.verifications_identite;
create trigger trg_purge_cni_storage
  before delete on public.verifications_identite
  for each row
  execute function public.purge_cni_storage_on_verif_delete();

-- ── 2. Function purge des verifications expirées ─────────────────────────────

create or replace function public.purge_expired_kyc_verifications()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  delete from public.verifications_identite
   where (statut = 'rejected' and reviewed_at < now() - interval '30 days')
      or (statut = 'verified' and reviewed_at < now() - interval '6 months');
  get diagnostics v_count = row_count;
  raise notice 'purge_expired_kyc_verifications: % rows deleted', v_count;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_kyc_verifications() from public;
-- Pas de grant explicit : appelée uniquement par pg_cron (role pg_cron_role,
-- super-user-like) et éventuellement à la main par admin via SQL Editor.

-- ── 3. Cron quotidien 3h UTC ────────────────────────────────────────────────
-- Idempotent : `cron.schedule` upsert si le job existe déjà avec le même nom.

-- Unschedule pour rejouer proprement si la mig est rejouée
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-expired-kyc-verifications') then
    perform cron.unschedule('purge-expired-kyc-verifications');
  end if;
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — skipping cron schedule. Enable extension and re-run this migration.';
end $$;

do $$
begin
  perform cron.schedule(
    'purge-expired-kyc-verifications',
    '0 3 * * *',
    $cron$select public.purge_expired_kyc_verifications();$cron$
  );
exception
  when undefined_table then
    raise notice 'pg_cron not enabled — cron job NOT scheduled. Enable extension and re-run this migration.';
end $$;

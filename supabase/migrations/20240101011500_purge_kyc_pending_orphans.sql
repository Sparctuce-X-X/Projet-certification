-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 75 — Étend purge_expired_kyc_verifications aux pending orphelins
--
-- Trou identifié review #2 :
-- La fonction `purge_expired_kyc_verifications` (mig 54) supprime :
--   - rejected où reviewed_at < now() - 30j
--   - verified où reviewed_at < now() - 6 mois
-- MAIS pas les `pending` qui resteraient en attente plus de 60 jours
-- (admin absent, vérification abandonnée par l'user, etc.).
--
-- Conséquence : un user dont la KYC est restée pending 90 jours peut
-- penser être "en attente" indéfiniment. Et les CNI restent en Storage
-- au-delà de la promesse RGPD du consent ("durée de conservation : 30j").
--
-- Fix : ajouter une 3e branche au cron.
--   - pending où created_at < now() - 60 jours → purge
--   60j = compromis : assez long pour permettre un retour user après une
--   absence (vacances, problème réseau, etc.), mais court pour respecter
--   la promesse RGPD.
--
-- Le trigger BEFORE DELETE (mig 54) purge automatiquement les Storage.objects
-- liés (cni_recto_path, cni_verso_path, selfie_path) → pas d'orphelin S3.
--
-- Idempotente. Cf. CLAUDE.md §RGPD.
-- ─────────────────────────────────────────────────────────────────────────────

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
   where (statut = 'rejected'
            and reviewed_at is not null
            and reviewed_at < now() - interval '30 days')
      or (statut = 'verified'
            and reviewed_at is not null
            and reviewed_at < now() - interval '6 months')
      or (statut = 'pending'
            and created_at < now() - interval '60 days');
  get diagnostics v_count = row_count;
  raise notice 'purge_expired_kyc_verifications: % rows deleted', v_count;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 55 — Bump RGPD consent whitelist v1.0 → v1.0 + v1.1
--
-- Le wording du consent dans VerifIntro.tsx a été mis à jour pour :
--   1. Ne plus prétendre "supprime automatiquement" sans cron (mig 54 ajoute
--      la cron, donc maintenant la promesse est tenable).
--   2. Préciser les durées différenciées : 30j si refus, 6 mois si validé
--      (cohérent avec mig 46 doc + mig 54 cron).
--   3. Mentionner que l'admin Niqo accède aux pièces (transparence vs
--      promesse "admin seul" qui était techniquement floue après mig 48).
--
-- Le bump v1.1 invalide les v1.0 antérieurs côté texte (mais reste accepté
-- côté DB pour audit historique des consents passés).
--
-- Wording v1.1 affiché à l'user dans VerifIntro.tsx :
--   "J'accepte que Niqo conserve ma CNI chiffrée pour validation par
--    l'équipe d'administration. Durée de conservation : 30 jours en cas
--    de refus, 6 mois après validation. Conforme aux lois ARTCI 2024-30
--    (Côte d'Ivoire) et ANRTIC 2023-15 (Congo)."
--
-- Prérequis : migration 47 (RPC submit_verification + colonne consent_version).
-- Idempotente. Cf. CLAUDE.md §RGPD.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.submit_verification(
  p_paiement_id      uuid,
  p_recto_path       text,
  p_verso_path       text,
  p_selfie_path      text,
  p_consent_version  text default 'v1.1'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_paiement record;
  v_verif_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_paiement
    from public.paiements_niqo
   where id = p_paiement_id
     and user_id = v_user_id
     and type = 'verification'
     and statut = 'completed';

  if not found then
    raise exception 'INVALID_PAIEMENT' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.verifications_identite where paiement_id = p_paiement_id) then
    raise exception 'PAIEMENT_ALREADY_USED' using errcode = 'P0003';
  end if;

  if exists (
    select 1 from public.verifications_identite
     where user_id = v_user_id and statut = 'pending'
  ) then
    raise exception 'VERIFICATION_ALREADY_PENDING' using errcode = 'P0004';
  end if;

  if (storage.foldername(p_recto_path))[1] <> v_user_id::text
     or (storage.foldername(p_verso_path))[1] <> v_user_id::text
     or (storage.foldername(p_selfie_path))[1] <> v_user_id::text then
    raise exception 'INVALID_PATH_OWNERSHIP' using errcode = 'P0005';
  end if;

  -- Whitelist consent version (étendue v1.1 — historique v1.0 toujours accepté)
  if p_consent_version not in ('v1.0', 'v1.1') then
    raise exception 'INVALID_CONSENT_VERSION' using errcode = 'P0006';
  end if;

  insert into public.verifications_identite
    (user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path,
     statut, rgpd_consent_version)
  values
    (v_user_id, p_paiement_id, p_recto_path, p_verso_path, p_selfie_path,
     'pending', p_consent_version)
  returning id into v_verif_id;

  return v_verif_id;
end;
$$;

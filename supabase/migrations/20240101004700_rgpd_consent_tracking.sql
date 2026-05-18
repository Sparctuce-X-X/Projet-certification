-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 47 — RGPD consent audit trail (verifications_identite)
--
-- Source : F07 KYC + conformité CNIL / ARTCI 2024-30 (CI) / ANRTIC 2023-15 (CG)
--
-- Le consent affiché à l'user au step 1 du wizard KYC doit être tracé en DB
-- pour audit (preuve en cas de plainte régulateur). On stocke :
--   - rgpd_consent_at : timestamp de la création de la row (= moment du submit
--     post-checkbox cochée). Default now() suffit, le client n'a pas besoin
--     de fournir un timestamp précis.
--   - rgpd_consent_version : version textuelle du document légal au moment du
--     consent (ex: 'v1.0'). Permet de re-prompter si le texte évolue.
--
-- Backfill : les soumissions existantes (avant cette mig) sont traitées comme
-- ayant consenti à 'v1.0' (la seule version connue). Default 'v1.0' couvre.
--
-- Composants :
--   1. ALTER table verifications_identite (2 colonnes)
--   2. Update RPC submit_verification : nouveau param p_consent_version
--
-- Prérequis : migration 45 (verifications_identite + RPCs).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonnes RGPD consent ────────────────────────────────────────────────

alter table public.verifications_identite
  add column if not exists rgpd_consent_at timestamptz not null default now();

alter table public.verifications_identite
  add column if not exists rgpd_consent_version text not null default 'v1.0'
  check (char_length(rgpd_consent_version) between 1 and 16);

comment on column public.verifications_identite.rgpd_consent_at is
  'Timestamp du consent RGPD (= now() à la création de la row). Audit trail CNIL/ARTCI/ANRTIC.';

comment on column public.verifications_identite.rgpd_consent_version is
  'Version du document légal acceptée. Bumper quand le wording change.';

-- ── 2. Update RPC submit_verification ──────────────────────────────────────
-- Ajout du param p_consent_version (default 'v1.0' pour rétro-compat).
-- Le rgpd_consent_at est géré par le default DB, pas besoin de param.

create or replace function public.submit_verification(
  p_paiement_id      uuid,
  p_recto_path       text,
  p_verso_path       text,
  p_selfie_path      text,
  p_consent_version  text default 'v1.0'
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

  -- Validation version consent (whitelist côté serveur)
  if p_consent_version not in ('v1.0') then
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

-- Drop l'ancienne signature (4 args) si elle existe — Postgres ne fait pas
-- l'overload nameless implicite, on évite les conflits.
drop function if exists public.submit_verification(uuid, text, text, text);

grant execute on function public.submit_verification(uuid, text, text, text, text) to authenticated;

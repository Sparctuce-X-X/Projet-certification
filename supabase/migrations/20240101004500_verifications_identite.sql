-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 45 — verifications_identite (F07 KYC)
--
-- Source : CDC v4.0 §2.6 Pilier 1 + F07
--
-- Historise les soumissions KYC. Un user peut resoumettre après refus (le
-- 1 000 FCFA précédent étant non remboursable) → on garde l'historique
-- complet pour anti-fraude (détection de mêmes photos resoumises).
--
-- Workflow :
--   1. User paie 1 000 FCFA → row dans paiements_niqo (mig 43, statut pending)
--   2. Webhook PawaPay : paiement → completed
--   3. User upload CNI recto/verso/selfie dans bucket cni-verifications (mig 46)
--   4. Client appelle RPC submit_verification → row dans verifications_identite (statut pending)
--   5. Admin (web /admin) approuve/refuse via RPC admin_validate_verification
--   6. Si approved : trigger met à jour users.is_verified = true + verification_paid_at
--
-- Composants :
--   1. Enum statut_verification
--   2. Colonnes verification_status / verification_paid_at sur users (CDC §5.1)
--   3. Table verifications_identite + indexes + RLS
--   4. Trigger : approved → users.is_verified = true
--   5. RPC submit_verification (création sécurisée client)
--   6. RPC admin_validate_verification (admin only, atomique)
--
-- Prérequis : migrations 01 (users), 43 (paiements_niqo), 44 (is_admin).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enum ─────────────────────────────────────────────────────────────────

do $$ begin
  create type statut_verification as enum (
    'pending',   -- soumise, en attente validation admin
    'verified',  -- approuvée, badge actif
    'rejected'   -- refusée par admin (motif obligatoire)
  );
exception
  when duplicate_object then null;
end $$;

-- ── 2. Colonnes additionnelles sur users ───────────────────────────────────
-- is_verified existe déjà (mig 01 ou ultérieure). On ajoute le ts de paiement
-- si absent (cohérent avec CDC §5.1).

alter table public.users
  add column if not exists is_verified boolean not null default false;

alter table public.users
  add column if not exists verification_paid_at timestamptz null;

-- ── 3. Table verifications_identite ────────────────────────────────────────

create table if not exists public.verifications_identite (
  id              uuid                primary key default uuid_generate_v4(),
  user_id         uuid                not null references public.users(id) on delete cascade,
  paiement_id     uuid                not null references public.paiements_niqo(id) on delete restrict,
  cni_recto_path  text                not null,
  cni_verso_path  text                not null,
  selfie_path     text                not null,
  statut          statut_verification not null default 'pending',
  reviewed_by     uuid                null references public.users(id) on delete set null,
  reviewed_at     timestamptz         null,
  reject_reason   text                null check (reject_reason is null or char_length(reject_reason) between 5 and 500),
  created_at      timestamptz         not null default now(),
  updated_at      timestamptz         not null default now()
);

-- Contrainte cohérence : si rejected → reject_reason obligatoire
alter table public.verifications_identite
  drop constraint if exists verif_rejected_needs_reason;
alter table public.verifications_identite
  add constraint verif_rejected_needs_reason
  check (statut <> 'rejected' or reject_reason is not null);

-- Contrainte cohérence : si verified → reviewed_by + reviewed_at obligatoires
alter table public.verifications_identite
  drop constraint if exists verif_reviewed_needs_admin;
alter table public.verifications_identite
  add constraint verif_reviewed_needs_admin
  check (
    statut = 'pending'
    or (reviewed_by is not null and reviewed_at is not null)
  );

-- Indexes
create index if not exists idx_verif_user
  on public.verifications_identite (user_id, statut, created_at desc);

create index if not exists idx_verif_pending
  on public.verifications_identite (created_at)
  where statut = 'pending';

create index if not exists idx_verif_paiement
  on public.verifications_identite (paiement_id);

-- Trigger updated_at
drop trigger if exists tg_verif_updated_at on public.verifications_identite;
create trigger tg_verif_updated_at
  before update on public.verifications_identite
  for each row
  execute function public.set_updated_at();

-- ── 4. Trigger : approved → users.is_verified = true ──────────────────────

create or replace function public.fn_verif_on_approve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Quand statut passe à 'verified', activer le badge sur users
  if (TG_OP = 'UPDATE' and OLD.statut <> 'verified' and NEW.statut = 'verified') then
    update public.users
       set is_verified = true,
           verification_paid_at = coalesce(verification_paid_at, NEW.reviewed_at, now())
     where id = NEW.user_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_verif_on_approve on public.verifications_identite;
create trigger tg_verif_on_approve
  after update on public.verifications_identite
  for each row
  execute function public.fn_verif_on_approve();

-- ── 5. RLS ──────────────────────────────────────────────────────────────────

alter table public.verifications_identite enable row level security;

-- Lecture : user voit ses propres soumissions (historique perso)
drop policy if exists verif_select_own on public.verifications_identite;
create policy verif_select_own on public.verifications_identite
  for select using (auth.uid() = user_id);

-- Lecture admin : toutes les soumissions
drop policy if exists verif_select_admin on public.verifications_identite;
create policy verif_select_admin on public.verifications_identite
  for select using (
    exists (select 1 from public.users where id = auth.uid() and is_admin = true)
  );

-- Pas de INSERT/UPDATE/DELETE direct côté client.
-- Tout passe par les RPC submit_verification + admin_validate_verification.

-- ── 6. RPC submit_verification (client) ────────────────────────────────────
-- Le client a déjà uploadé les 3 photos dans le bucket cni-verifications
-- et a un paiement_id `completed` correspondant.
-- Cette RPC vérifie l'intégrité avant de créer la row.

create or replace function public.submit_verification(
  p_paiement_id    uuid,
  p_recto_path     text,
  p_verso_path     text,
  p_selfie_path    text
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
  -- Authentification
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- Vérifier que le paiement appartient au user, est de type verification, et completed
  select * into v_paiement
    from public.paiements_niqo
   where id = p_paiement_id
     and user_id = v_user_id
     and type = 'verification'
     and statut = 'completed';

  if not found then
    raise exception 'INVALID_PAIEMENT' using errcode = 'P0002';
  end if;

  -- Vérifier que le paiement n'est pas déjà consommé par une autre verification
  if exists (select 1 from public.verifications_identite where paiement_id = p_paiement_id) then
    raise exception 'PAIEMENT_ALREADY_USED' using errcode = 'P0003';
  end if;

  -- Vérifier qu'aucune verification pending n'est en cours pour cet user
  if exists (
    select 1 from public.verifications_identite
     where user_id = v_user_id and statut = 'pending'
  ) then
    raise exception 'VERIFICATION_ALREADY_PENDING' using errcode = 'P0004';
  end if;

  -- Vérifier que les paths commencent par {user_id}/ (cohérence Storage RLS mig 46)
  if (storage.foldername(p_recto_path))[1] <> v_user_id::text
     or (storage.foldername(p_verso_path))[1] <> v_user_id::text
     or (storage.foldername(p_selfie_path))[1] <> v_user_id::text then
    raise exception 'INVALID_PATH_OWNERSHIP' using errcode = 'P0005';
  end if;

  -- Création
  insert into public.verifications_identite
    (user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut)
  values
    (v_user_id, p_paiement_id, p_recto_path, p_verso_path, p_selfie_path, 'pending')
  returning id into v_verif_id;

  return v_verif_id;
end;
$$;

grant execute on function public.submit_verification(uuid, text, text, text) to authenticated;

-- ── 7. RPC admin_validate_verification (admin only) ────────────────────────

create or replace function public.admin_validate_verification(
  p_verification_id  uuid,
  p_approved         boolean,
  p_reject_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  v_admin_id := auth.uid();
  if v_admin_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- Vérifier admin
  if not exists (select 1 from public.users where id = v_admin_id and is_admin = true) then
    raise exception 'ADMIN_REQUIRED' using errcode = 'P0010';
  end if;

  -- Refus : raison obligatoire entre 5 et 500 chars
  if not p_approved and (p_reject_reason is null or char_length(p_reject_reason) < 5) then
    raise exception 'REJECT_REASON_REQUIRED' using errcode = 'P0011';
  end if;

  update public.verifications_identite
     set statut       = case when p_approved then 'verified' else 'rejected' end,
         reviewed_by  = v_admin_id,
         reviewed_at  = now(),
         reject_reason = case when p_approved then null else p_reject_reason end
   where id = p_verification_id
     and statut = 'pending';

  if not found then
    raise exception 'VERIFICATION_NOT_PENDING' using errcode = 'P0012';
  end if;
end;
$$;

grant execute on function public.admin_validate_verification(uuid, boolean, text) to authenticated;

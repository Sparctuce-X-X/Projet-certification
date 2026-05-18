-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 43 — Table `paiements_niqo` (tracking PawaPay)
--
-- Source : CDC v4.0 §5.1 + features F07 (vérification d'identité) et F09 (boost)
--
-- Fondation pour tracer tous les encaissements Niqo via PawaPay (sandbox puis
-- prod). Niqo n'intermédie PAS l'argent C2C — uniquement les services :
-- vérification d'identité, boosts d'annonce, abonnement Pro, annonce vedette,
-- levée de suspension.
--
-- Composants :
--   1. Enums type_paiement + statut_paiement
--   2. Table paiements_niqo + indexes + trigger updated_at
--   3. RLS : user voit ses propres paiements ; admin voit tout
--
-- target_id : pour type='boost' = annonce_id ; pour type='verification' = null
-- (la liaison verification → paiement se fait via verifications_identite.paiement_id, mig 45)
--
-- Prérequis : migration 01 (users), 44 (users.is_admin pour les RLS admin).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enums ────────────────────────────────────────────────────────────────

do $$ begin
  create type type_paiement as enum (
    'verification',      -- F07 KYC, 1 000 FCFA
    'boost',             -- F09 boost annonce, 1 000 ou 3 000 FCFA
    'pro_subscription',  -- Phase 2, 5 000 FCFA/mois
    'vedette',           -- Phase 2, 5 000 FCFA/semaine
    'unsuspend'          -- levée de suspension, 1 000 FCFA
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type statut_paiement as enum (
    'pending',    -- deposit init, attend webhook PawaPay
    'completed',  -- webhook OK, montant reçu
    'failed',     -- webhook KO ou expiré
    'refunded'    -- remboursement (rare, erreur technique)
  );
exception
  when duplicate_object then null;
end $$;

-- ── 2. Table paiements_niqo ────────────────────────────────────────────────

create table if not exists public.paiements_niqo (
  id                  uuid             primary key default uuid_generate_v4(),
  user_id             uuid             not null references public.users(id) on delete cascade,
  type                type_paiement    not null,
  target_id           uuid             null,           -- nullable : verification = null, boost = annonce_id
  montant_fcfa        int              not null check (montant_fcfa > 0 and montant_fcfa <= 100000),
  pawapay_deposit_id  text             unique,         -- généré côté Edge Function init, peut être null avant init
  pawapay_metadata    jsonb            null,           -- payload brut PawaPay pour debug
  statut              statut_paiement  not null default 'pending',
  created_at          timestamptz      not null default now(),
  updated_at          timestamptz      not null default now(),
  completed_at        timestamptz      null
);

-- Indexes
create index if not exists idx_paiements_user
  on public.paiements_niqo (user_id, type, statut);

create index if not exists idx_paiements_pending
  on public.paiements_niqo (statut, created_at)
  where statut = 'pending';

create index if not exists idx_paiements_pawapay
  on public.paiements_niqo (pawapay_deposit_id)
  where pawapay_deposit_id is not null;

-- Trigger updated_at (fonction déclarée mig 01)
drop trigger if exists tg_paiements_updated_at on public.paiements_niqo;
create trigger tg_paiements_updated_at
  before update on public.paiements_niqo
  for each row
  execute function public.set_updated_at();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

alter table public.paiements_niqo enable row level security;

-- Lecture : user voit ses propres paiements (historique facturation)
drop policy if exists paiements_select_own on public.paiements_niqo;
create policy paiements_select_own on public.paiements_niqo
  for select using (auth.uid() = user_id);

-- Lecture admin : déplacée en mig 44 (la colonne `is_admin` est ajoutée
-- là). Bug d'ordering détecté par les tests locaux (mai 2026) : créer la
-- policy ici référence une colonne qui n'existe pas encore. Drop préventif
-- pour idempotence si mig 43 est rejouée après mig 44.
drop policy if exists paiements_select_admin on public.paiements_niqo;

-- Pas de policy INSERT/UPDATE/DELETE côté client.
-- Toutes les écritures passent par les Edge Functions (service_role) :
--   - pawapay-init-deposit : insert pending
--   - pawapay-webhook : update statut → completed/failed

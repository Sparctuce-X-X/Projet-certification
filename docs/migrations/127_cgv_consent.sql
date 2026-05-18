-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 127 — Consentement CGV + renonciation droit rétractation
--
-- Trace par paiement le consentement explicite de l'user à renoncer à son
-- droit de rétractation 14j (Code Conso CI/CG + OHADA). Obligatoire avant
-- prod pour pouvoir prouver le consentement en cas de litige.
--
-- Champs nullable : les paiements antérieurs à cette feature (~paiements test)
-- gardent NULL — l'EF `pawapay-init-deposit` exige les valeurs au body pour
-- tout nouveau paiement.
--
-- IDEMPOTENTE.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.paiements_niqo
  add column if not exists cgv_accepted_version text,
  add column if not exists cgv_accepted_at timestamptz;

comment on column public.paiements_niqo.cgv_accepted_version is
  'Version CGV acceptée au moment du paiement (ex: "1.1"). Trace pour preuve légale du consentement à la renonciation droit rétractation 14j.';

comment on column public.paiements_niqo.cgv_accepted_at is
  'Timestamp serveur de l''acceptation. Diffère de created_at (peut être identique en pratique mais juridiquement distinct).';

-- Index partiel : audit des paiements sans consentement (debug + retro).
create index if not exists idx_paiements_cgv_missing
  on public.paiements_niqo (created_at)
  where cgv_accepted_version is null;

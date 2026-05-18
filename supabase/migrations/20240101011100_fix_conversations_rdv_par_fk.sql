-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 71 — Fix FK conversations.rdv_propose_par / rdv_annule_par
--
-- Suite à mig 70 qui a fixé avis.auteur_id/cible_id, le diagnostic
-- des FK pointant vers users(id) en RESTRICT a remonté 2 autres
-- bloquantes pour delete_my_account :
--
--   conversations.rdv_propose_par → public.users(id)  [NO ACTION]
--   conversations.rdv_annule_par  → public.users(id)  [NO ACTION]
--
-- Ces colonnes ont été ajoutées par mig 35 (F05 RDV) sans clause
-- on delete → RESTRICT par défaut → un user qui a proposé ou annulé
-- un RDV ne peut pas supprimer son compte.
--
-- Fix : on delete set null pour les 2.
--   - rdv_propose_par : la conversation reste, le tracking "qui a proposé"
--     devient null (l'historique du RDV est préservé via rdv_lieu/date,
--     juste l'attribution de la proposition est anonymisée).
--   - rdv_annule_par : idem pour les annulations.
--
-- Les colonnes sont déjà nullable (cf mig 35 : `add column if not exists
-- rdv_propose_par uuid references public.users(id)` sans NOT NULL).
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conversations
  drop constraint if exists conversations_rdv_propose_par_fkey;

alter table public.conversations
  add constraint conversations_rdv_propose_par_fkey
  foreign key (rdv_propose_par) references public.users(id) on delete set null;

alter table public.conversations
  drop constraint if exists conversations_rdv_annule_par_fkey;

alter table public.conversations
  add constraint conversations_rdv_annule_par_fkey
  foreign key (rdv_annule_par) references public.users(id) on delete set null;

comment on column public.conversations.rdv_propose_par is
  'NULL si le compte du proposeur a été supprimé.';

comment on column public.conversations.rdv_annule_par is
  'NULL si le compte de l''annuleur a été supprimé.';

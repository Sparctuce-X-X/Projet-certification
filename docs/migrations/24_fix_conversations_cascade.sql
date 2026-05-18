-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 24 — Fix CASCADE sur conversations.acheteur_id / vendeur_id
--
-- Problème : suppression de compte (RGPD droit à l'oubli) laisse des
-- conversations orphelines car les FK acheteur_id/vendeur_id n'ont pas
-- ON DELETE CASCADE.
--
-- Fix : drop + re-create les FK avec CASCADE.
--
-- Prérequis : migration 22 (conversations).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop existing FK constraints (noms auto-générés par Postgres)
alter table public.conversations
  drop constraint if exists conversations_acheteur_id_fkey;
alter table public.conversations
  drop constraint if exists conversations_vendeur_id_fkey;

-- Re-create avec CASCADE
alter table public.conversations
  add constraint conversations_acheteur_id_fkey
  foreign key (acheteur_id) references public.users(id) on delete cascade;

alter table public.conversations
  add constraint conversations_vendeur_id_fkey
  foreign key (vendeur_id) references public.users(id) on delete cascade;

-- Idem pour messages.expediteur_id
alter table public.messages
  drop constraint if exists messages_expediteur_id_fkey;

alter table public.messages
  add constraint messages_expediteur_id_fkey
  foreign key (expediteur_id) references public.users(id) on delete cascade;

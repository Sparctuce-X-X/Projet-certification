-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 70 — Fix FK avis.auteur_id / cible_id pour delete_my_account
--
-- Bug remonté en review (et reproduit par l'user) : la suppression de compte
-- via la RPC `delete_my_account` (mig 03+53) échoue avec un message d'erreur
-- générique "La suppression a échoué" si l'user a émis ou reçu un avis.
--
-- Cause : la table `avis` (mig 37) déclare :
--   auteur_id uuid not null references public.users(id)
--   cible_id  uuid not null references public.users(id)
--
-- Les FK n'ont PAS de clause `on delete`, donc Postgres applique le
-- comportement par défaut RESTRICT → bloque la suppression de l'user
-- s'il existe un avis qui le référence.
--
-- La cascade auth.users → public.users (mig 01) marche, mais ensuite
-- public.users → avis tape sur RESTRICT et tout rollback.
--
-- Fix :
--   - auteur_id  → `on delete set null` (anonymise : "Avis de [user supprimé]"
--                 affiché côté UI, mais l'historique communautaire est préservé)
--   - cible_id   → `on delete cascade` (un avis sur un compte qui n'existe
--                 plus n'a aucun sens, on le supprime)
--
-- L'invariant `auteur_id != cible_id` (avis_pas_soi_meme) reste OK car
-- Postgres CHECK ignore les comparaisons impliquant NULL (UNKNOWN passe).
--
-- L'invariant unique `(conversation_id, auteur_id)` reste OK : plusieurs
-- avis avec auteur_id NULL peuvent coexister (NULL != NULL en SQL pour
-- les UNIQUE constraints).
--
-- Côté mobile : si la query d'affichage profil public retourne un avis
-- avec auteur_id null, il faut afficher "Utilisateur supprimé" au lieu
-- du prénom. À gérer en lib/users.ts ou dans la query SQL côté client.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. auteur_id : nullable + on delete set null ────────────────────────────

alter table public.avis
  alter column auteur_id drop not null;

alter table public.avis
  drop constraint if exists avis_auteur_id_fkey;

alter table public.avis
  add constraint avis_auteur_id_fkey
  foreign key (auteur_id) references public.users(id) on delete set null;

-- ── 2. cible_id : on delete cascade ─────────────────────────────────────────
-- (cible_id reste NOT NULL — l'avis a forcément une cible à sa création,
--  mais quand cette cible disparaît, l'avis disparaît avec.)

alter table public.avis
  drop constraint if exists avis_cible_id_fkey;

alter table public.avis
  add constraint avis_cible_id_fkey
  foreign key (cible_id) references public.users(id) on delete cascade;

-- ── 3. Vérification + commentaires ──────────────────────────────────────────

comment on column public.avis.auteur_id is
  'NULL si le compte de l''auteur a été supprimé (anonymisation post-deletion).';

comment on column public.avis.cible_id is
  'NOT NULL — si la cible est supprimée, l''avis est supprimé en cascade.';

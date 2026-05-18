-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 23 — RLS : lecture profil des participants de conversation
--
-- Problème : la RLS `users_own_profile` (auth.uid() = id) empêche PostgREST
-- de joindre le profil de l'autre participant dans la requête conversations.
-- Résultat : avatar + prénom = null dans la liste de conversations.
--
-- Fix : policy SELECT sur public.users pour tout user qui partage une
-- conversation (acheteur ou vendeur) avec l'user authentifié.
--
-- Prérequis : migration 22 (conversations).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists users_read_conversation_participant on public.users;
create policy users_read_conversation_participant on public.users
  for select using (
    exists (
      select 1 from public.conversations c
      where (c.acheteur_id = auth.uid() or c.vendeur_id = auth.uid())
        and (c.acheteur_id = id or c.vendeur_id = id)
    )
  );

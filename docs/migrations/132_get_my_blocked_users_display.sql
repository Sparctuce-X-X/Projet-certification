-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 132 — RPC get_my_blocked_users_display
--
-- PROBLÈME (constaté 2026-05-15)
--   La page Profil → "Utilisateurs bloqués" affiche "Utilisateur supprimé"
--   pour chaque ligne au lieu du prénom réel.
--
--   Cause : la function client `fetchMyBlockedUsersWithProfiles` fait
--   `SELECT id, prenom, avatar_url FROM users WHERE id IN (...)` directement.
--   RLS strict sur public.users (mig 01 + 23 + 52) refuse ce SELECT pour les
--   IDs qui ne sont pas (le user lui-même OU un participant de conv OU admin).
--   Pour les users bloqués sans conv partagée, RLS retourne 0 row → fallback
--   "Utilisateur supprimé" appliqué dans le map côté client.
--
-- CORRECTION
--   RPC `get_my_blocked_users_display()` SECURITY DEFINER qui :
--     - Join blocked_users + users
--     - Filtre où blocker_id = auth.uid()
--     - Retourne id, prenom, avatar_url, reason, created_at
--   Bypass RLS sur users via SECURITY DEFINER. Le scope est strictement
--   limité aux users que TU as bloqués (jamais d'autres users) — pas de
--   leak d'info.
--
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_my_blocked_users_display()
returns table (
  id          uuid,
  prenom      text,
  avatar_url  text,
  reason      text,
  blocked_at  timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    u.id,
    u.prenom,
    u.avatar_url,
    b.reason,
    b.created_at as blocked_at
  from public.blocked_users b
  join public.users u on u.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

revoke all on function public.get_my_blocked_users_display() from public;
grant execute on function public.get_my_blocked_users_display() to authenticated;

comment on function public.get_my_blocked_users_display() is
  'Returns the list of users blocked by the current user, with their public profile fields (prenom + avatar_url). SECURITY DEFINER bypass RLS on users (mig 132 fix mig 129).';

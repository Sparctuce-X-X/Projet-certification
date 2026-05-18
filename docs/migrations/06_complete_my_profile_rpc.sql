-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 06 — RPC public.complete_my_profile()
--
-- Permet à un user authentifié de compléter son profil après un signup OAuth
-- (Google/Apple). Ces flows ne collectent PAS telephone/quartier (et ville
-- est juste un fallback capital), donc on a besoin d'un écran post-signin
-- qui rappelle ces 3 champs et les écrit en DB.
--
-- L'écran client (app/auth/complete-profile.tsx) appelle cette RPC qui :
--   1. checke auth.uid()
--   2. encrypte le téléphone via public.encrypt_phone() (Vault)
--   3. update public.users en SECURITY DEFINER (bypass RLS — l'identification
--      par auth.uid() suffit à garantir qu'un user ne peut modifier que son
--      propre profil).
--
-- Cohérent avec le pattern get_my_phone() : toute opération sur la colonne
-- chiffrée `telephone bytea` passe par une RPC SECURITY DEFINER, jamais par
-- un UPDATE direct REST (le client n'a pas la clé Vault).
--
-- Cf. CLAUDE.md §RGPD point 3 (minimisation : on demande JUSTE ces 3 champs,
-- pas plus) + §RGPD point 5 (consentement : déjà acquis lors du signup OAuth
-- via les CGU acceptées au CountryPicker).
--
-- À jouer dans Supabase SQL Editor APRÈS 05_fix_auth_provider.sql.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_my_profile(
  p_ville     text,
  p_quartier  text,
  p_telephone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Validation minimale côté serveur — la validation UX (longueur phone, etc.)
  -- reste côté client mais on garde un garde-fou ici (bypass éventuel REST).
  if p_ville is null or length(trim(p_ville)) = 0 then
    raise exception 'ville requise';
  end if;
  if p_telephone is null or length(trim(p_telephone)) = 0 then
    raise exception 'telephone requis';
  end if;

  update public.users
  set ville      = trim(p_ville),
      -- quartier nullable côté schéma → on accepte null/empty (= null)
      quartier   = nullif(trim(coalesce(p_quartier, '')), ''),
      telephone  = public.encrypt_phone(trim(p_telephone)),
      updated_at = now()
  where id = uid;
end;
$$;

revoke all on function public.complete_my_profile(text, text, text) from public;
grant execute on function public.complete_my_profile(text, text, text) to authenticated;

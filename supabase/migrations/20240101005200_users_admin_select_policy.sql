-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 52 — Policy SELECT admin sur public.users
--
-- Bug : la policy `users_own_profile` (mig 01) permet à un user de voir
-- uniquement son propre row. Conséquence : dans le back-office admin, le
-- JOIN sur `users` (via FK depuis `verifications_identite` ou `signalements`)
-- retourne `null` pour tous les owners autres que l'admin connecté.
-- L'admin voit donc le détail des verifications mais pas le prenom/nom/ville
-- de l'user soumissionnaire — bloque la modération.
--
-- Fix : ajouter une policy SELECT séparée pour les admins, via une fonction
-- `is_admin()` SECURITY DEFINER pour éviter les loops RLS sur public.users
-- elle-même (la policy de cette table ne peut pas faire de SELECT sur
-- public.users dans son qual sans helper).
--
-- Conformité RGPD : ce SELECT admin est documenté + tracé dans les logs
-- Supabase. À utiliser uniquement pour modération KYC / signalements.
--
-- Prérequis : migrations 01 (users + policy initiale), 44 (is_admin column).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Fonction helper SECURITY DEFINER ──────────────────────────────────
-- STABLE permet à Postgres de cacher le résultat dans la même transaction.
-- Évite les loops RLS car cette function tourne côté table_owner, pas côté
-- caller (la policy users_own_profile ne s'applique pas dans son body).

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.users where id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;

-- ── 2. Policy SELECT admin ───────────────────────────────────────────────
-- Permet à l'admin (back-office) de voir n'importe quel user pour la
-- modération KYC, signalements, validations.

drop policy if exists users_admin_select on public.users;
create policy users_admin_select on public.users
  for select using (public.is_current_user_admin());

-- Note : la policy `users_own_profile` (mig 01) reste active. Postgres
-- combine les policies en OR — un user voit son propre profil OU s'il est
-- admin, tous les profils.

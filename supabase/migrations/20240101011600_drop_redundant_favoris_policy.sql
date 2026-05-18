-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 76 — Drop policy redondante `favoris_insert_own`
--
-- Détecté après mig 74 : la table favoris a 2 policies INSERT :
--   1. favoris_insert_own (mig 19, ancienne) : auth.uid() = user_id
--   2. favoris_owner_insert (mig 74, nouvelle) : auth.uid() = user_id
--      AND is_my_account_active()
--
-- Postgres combine les policies en OR (permissif) → l'ancienne annule
-- l'effet du guard `is_my_account_active` ajouté en mig 74. Un user
-- suspendu peut continuer à ajouter des favoris.
--
-- Fix : drop l'ancienne, garder uniquement la nouvelle.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists favoris_insert_own on public.favoris;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 72 — Relax verif_reviewed_needs_admin pour delete admin
--
-- Bug remonté lors du delete d'un user (BEGIN/ROLLBACK diagnostic) :
--
--   ERROR 23514: new row for relation "verifications_identite" violates
--   check constraint "verif_reviewed_needs_admin"
--   CONTEXT: UPDATE … SET "reviewed_by" = NULL WHERE … = "reviewed_by"
--
-- Cause : la FK `verifications_identite.reviewed_by → users(id)` a un
-- `on delete set null` (mig 45) qui s'active quand un admin est supprimé.
-- Mais le CHECK `verif_reviewed_needs_admin` (mig 45) exige :
--
--   check (statut = 'pending' or (reviewed_by is not null and reviewed_at is not null))
--
-- Quand `reviewed_by` passe à null sur une vérif validée/refusée, le check
-- échoue → toute la transaction de delete user rollback.
--
-- Fix : relâcher la contrainte. L'invariant métier "une vérif décidée doit
-- avoir un admin reviewer" reste vrai à l'INSERT/UPDATE par submit_verification
-- et admin_validate_verification (qui set reviewed_by = auth.uid()). Mais
-- a posteriori, un admin peut être supprimé → reviewed_by null = "admin
-- historique supprimé". L'invariant moins strict sur `reviewed_at` (timestamp,
-- ne disparaît jamais) suffit pour distinguer pending vs decided.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.verifications_identite
  drop constraint if exists verif_reviewed_needs_admin;

alter table public.verifications_identite
  add constraint verif_reviewed_needs_admin
  check (
    statut = 'pending' or reviewed_at is not null
  );

comment on constraint verif_reviewed_needs_admin on public.verifications_identite is
  'Une vérif décidée (verified/rejected) doit avoir reviewed_at. reviewed_by peut être NULL si l''admin a été supprimé (FK on delete set null).';

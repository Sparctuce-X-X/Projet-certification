-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 48 — Patch RLS Storage cni-verifications : user SELECT/UPDATE own
--
-- Cause : `supabase.storage.upload()` exécute un SELECT après l'INSERT pour
-- retourner les metadata (path, id, ...). Sans policy SELECT correspondant
-- au user uploadant, l'opération entière échoue avec :
--   "new row violates row-level security policy"
--
-- Solution : autoriser le user à SELECT ses propres uploads (path commence
-- par son UID). L'admin garde l'accès à tous via la policy cni_verif_admin_select.
--
-- Aussi : ajouter UPDATE own pour permettre la **recapture** côté client
-- (`upsert: true` dans uploadKycPhoto). Sans ça, refaire une photo échoue.
--
-- Sémantique vs mig 46 :
--   - Mig 46 disait "user ne peut PAS relire ses propres CNI" (privacy by default)
--   - Pragmatique : le pattern Supabase Storage exige SELECT post-INSERT
--   - Compromis : user peut SELECT/UPDATE SES données (logique RGPD : c'est sa data)
--   - DELETE reste admin-only (purge périodique J+30)
--
-- Prérequis : migration 46 (storage cni-verifications).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. SELECT own ─────────────────────────────────────────────────────────
-- Indispensable pour que upload() retourne les metadata.

drop policy if exists "cni_verif_owner_select" on storage.objects;
create policy "cni_verif_owner_select" on storage.objects
  for select
  using (
    bucket_id = 'cni-verifications'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 2. UPDATE own ─────────────────────────────────────────────────────────
-- Pour la recapture client (upsert: true). Sans ça, refaire une photo plante.

drop policy if exists "cni_verif_owner_update" on storage.objects;
create policy "cni_verif_owner_update" on storage.objects
  for update
  using (
    bucket_id = 'cni-verifications'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'cni-verifications'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE reste admin-only (mig 46) — l'user ne peut pas purger ses CNI.
-- L'admin purge via cron J+30 (à coder plus tard).

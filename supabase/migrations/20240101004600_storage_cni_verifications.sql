-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 46 — Bucket Storage `cni-verifications` + RLS
--
-- Source : F07 KYC (capture CNI recto/verso + selfie)
--
-- Bucket PRIVÉ (public=false) — contrairement à annonces-photos. Les pièces
-- d'identité sont des PII sensibles, accessibles uniquement à l'admin via
-- URLs signées (server-side, depuis l'admin web /admin/verifications/[id]).
--
-- Convention de path :
--   {auth.uid()}/{verification_id}/{recto|verso|selfie}.jpg
--
-- ⚠ Configurer dans Supabase Dashboard → Storage → cni-verifications → Settings :
--    - Public : OFF (DOIT rester privé)
--    - File size limit : 8 MB (qualité photo CNI)
--    - Allowed MIME types : image/jpeg, image/png
--
-- RLS strictes :
--   - INSERT  : user authentifié, path[1] = own UID (1ère foldername)
--   - SELECT  : admin uniquement (is_admin = true)
--   - DELETE  : admin uniquement (purge après validation/refus à J+30)
--   - UPDATE  : aucun (immutable, on re-upload + delete)
--
-- Conformité RGPD/loi CI 2024-30 / loi CG 2023-15 :
--   - Stockage chiffré at-rest (Supabase par défaut)
--   - Pas d'URL publique exposable
--   - Purge sous 30j si refus, conservation 6 mois si validé
--   - Lecture admin tracée via Supabase logs
--
-- Prérequis : migration 44 (users.is_admin).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Bucket privé ─────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('cni-verifications', 'cni-verifications', false)
on conflict (id) do update set public = false;  -- force private si déjà créé

-- ── 2. RLS storage.objects pour `cni-verifications` ──────────────────────────

-- INSERT : user authentifié, sa propre folder (UID = 1ère foldername)
drop policy if exists "cni_verif_owner_insert" on storage.objects;
create policy "cni_verif_owner_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'cni-verifications'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT : admin uniquement (lit toutes les CNI pour validation)
drop policy if exists "cni_verif_admin_select" on storage.objects;
create policy "cni_verif_admin_select" on storage.objects
  for select
  using (
    bucket_id = 'cni-verifications'
    and exists (
      select 1 from public.users
       where id = auth.uid() and is_admin = true
    )
  );

-- DELETE : admin uniquement (purge périodique J+30 si refus)
drop policy if exists "cni_verif_admin_delete" on storage.objects;
create policy "cni_verif_admin_delete" on storage.objects
  for delete
  using (
    bucket_id = 'cni-verifications'
    and exists (
      select 1 from public.users
       where id = auth.uid() and is_admin = true
    )
  );

-- Pas de policy UPDATE — les pièces sont immutables.
-- Si correction nécessaire : DELETE puis INSERT (admin only).

-- Pas de policy SELECT pour l'user — il ne peut pas relire ses propres CNI
-- une fois uploadées (privacy by default ; l'admin seul accède).

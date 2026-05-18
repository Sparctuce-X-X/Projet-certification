-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 14 — bucket Storage `annonces-photos` + RLS
--
-- Crée le bucket public qui hébergera les photos d'annonces (5 max par
-- annonce, 5 MB max, JPEG/PNG/WebP — limites enforcées côté Dashboard +
-- côté client dans lib/storage/annonces-photos.ts).
--
-- Pourquoi public : les annonces sont visibles sans compte (browse-first,
-- cf. CDC §Browse-first). Une photo de produit ≠ PII chiffrée — l'URL
-- publique reste accessible tant que le fichier n'est pas supprimé. Quand
-- l'annonce est delete, on purge les photos en cascade (logique côté code,
-- module `annonces` à venir).
--
-- Convention de path : `{auth.uid()}/{annonceId}/{uuid}.{ext}`. La 1ère
-- foldername (= userId) détermine la propriété — pattern repris de la
-- migration 09 (avatars).
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Bucket public ─────────────────────────────────────────────────────────
-- public=true → photos lisibles via URL publique sans signature (CDN-friendly).
-- ⚠ Configurer dans Supabase Dashboard → Storage → annonces-photos → Settings :
--    - File size limit : 5 MB (5242880 bytes)
--    - Allowed MIME types : image/jpeg, image/png, image/webp
-- (Ces limites ne sont PAS scriptables via SQL — Dashboard manuel uniquement.)

insert into storage.buckets (id, name, public)
values ('annonces-photos', 'annonces-photos', true)
on conflict (id) do nothing;

-- ── 2. RLS storage.objects pour `annonces-photos` ────────────────────────────
-- Drop-then-create pour idempotence (CREATE POLICY n'a pas de IF NOT EXISTS).
-- Pas de policy UPDATE — on ré-upload + delete plutôt que de muter en place
-- (simplifie l'invalidation CDN : URL change avec le nouveau uuid).

drop policy if exists "annonces_photos_public_read" on storage.objects;
create policy "annonces_photos_public_read" on storage.objects
  for select
  using (bucket_id = 'annonces-photos');

drop policy if exists "annonces_photos_owner_insert" on storage.objects;
create policy "annonces_photos_owner_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'annonces-photos'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "annonces_photos_owner_delete" on storage.objects;
create policy "annonces_photos_owner_delete" on storage.objects
  for delete
  using (
    bucket_id = 'annonces-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Storage (transversal, 4 buckets Supabase Storage)
--
-- Couvre la structure :
--   - 4 buckets (avatars, annonces-photos, cni-verifications, rencontre-photos)
--     + flag public correct par bucket
--   - RLS policies storage.objects présentes par bucket (path-pattern enforce)
--   - Mig 94 — drop des policies *_public_read (anti listing leak sur buckets
--     publics)
--   - Trigger trg_purge_cni_storage BEFORE DELETE on verifications_identite
--     (cascade Storage REST via HTTP — mig 54+110)
--   - Crons enregistrés (expire-annonces, purge-expired-annonces,
--     purge-expired-kyc-verifications)
--   - Functions Storage existantes (purge_cni_storage_on_verif_delete,
--     fn_purge_expired_annonces, purge_expired_kyc_verifications,
--     add_rencontre_photo)
--
-- ⚠ Les tests fonctionnels d'INSERT / DELETE sur storage.objects sont impossibles
-- en pgTAP (le trigger global Supabase `storage.protect_objects_delete` bloque
-- les DELETE directs ; les INSERT exigent le bucket physiquement présent et
-- service_role). Les tests end-to-end sont en Vitest (tests/integration/storage.test.ts)
-- via PostgREST + Storage API.
--
-- Cf. docs/backend/storage.md pour le module complet.
-- Migs couvertes : 09, 14, 16, 46, 48, 54, 65, 73, 92, 94, 102, 110.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(36);

-- ═════════════════════════════════════════════════════════════════════════════
-- A. Existence + flag public des 4 buckets (8 tests)
-- ═════════════════════════════════════════════════════════════════════════════

-- A1 — avatars (mig 09)
select is(
  (select count(*)::int from storage.buckets where id = 'avatars'),
  1,
  'A1 mig 09 : bucket avatars existe'
);

select is(
  (select public from storage.buckets where id = 'avatars'),
  true,
  'A1b mig 09 : bucket avatars est public (CDN browse-first)'
);

-- A2 — annonces-photos (mig 14)
select is(
  (select count(*)::int from storage.buckets where id = 'annonces-photos'),
  1,
  'A2 mig 14 : bucket annonces-photos existe'
);

select is(
  (select public from storage.buckets where id = 'annonces-photos'),
  true,
  'A2b mig 14 : bucket annonces-photos est public (CDN browse-first)'
);

-- A3 — cni-verifications (mig 46)
select is(
  (select count(*)::int from storage.buckets where id = 'cni-verifications'),
  1,
  'A3 mig 46 : bucket cni-verifications existe'
);

select is(
  (select public from storage.buckets where id = 'cni-verifications'),
  false,
  'A3b mig 46 : bucket cni-verifications PRIVÉ (PII sensibles)'
);

-- A4 — rencontre-photos (mig 92)
select is(
  (select count(*)::int from storage.buckets where id = 'rencontre-photos'),
  1,
  'A4 mig 92 : bucket rencontre-photos existe'
);

select is(
  (select public from storage.buckets where id = 'rencontre-photos'),
  false,
  'A4b mig 92 : bucket rencontre-photos PRIVÉ (anti-revanche)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- B. RLS policies storage.objects — avatars (3 tests, public_read dropped mig 94)
-- ═════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_owner_insert'),
  1,
  'B1 mig 09 : policy avatars_owner_insert existe (foldername[1] = uid)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_owner_update'),
  1,
  'B2 mig 09 : policy avatars_owner_update existe'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_owner_delete'),
  1,
  'B3 mig 09 : policy avatars_owner_delete existe'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- C. RLS policies storage.objects — annonces-photos (2 tests)
-- ═════════════════════════════════════════════════════════════════════════════
-- Mig 14 §2 : pas de policy UPDATE par design (DELETE + INSERT pour invalidation
-- CDN propre via nouveau path UUID).

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'annonces_photos_owner_insert'),
  1,
  'C1 mig 14 : policy annonces_photos_owner_insert existe (foldername[1] = uid)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'annonces_photos_owner_delete'),
  1,
  'C2 mig 14 : policy annonces_photos_owner_delete existe'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- D. RLS policies storage.objects — cni-verifications (6 tests)
-- ═════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cni_verif_owner_insert'),
  1,
  'D1 mig 46 : policy cni_verif_owner_insert existe (path[1] = uid)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cni_verif_owner_select'),
  1,
  'D2 mig 48 : policy cni_verif_owner_select existe (fix bug upload post-INSERT)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cni_verif_owner_update'),
  1,
  'D3 mig 48 : policy cni_verif_owner_update existe (recapture client upsert=true)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cni_verif_owner_delete'),
  1,
  'D4 mig 73 : policy cni_verif_owner_delete existe (purge RGPD client-side)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cni_verif_admin_select'),
  1,
  'D5 mig 46 : policy cni_verif_admin_select existe (admin lecture pour validation)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'cni_verif_admin_delete'),
  1,
  'D6 mig 46 : policy cni_verif_admin_delete existe (cron purge J+30/J+180)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- E. RLS policies storage.objects — rencontre-photos (4 tests)
-- ═════════════════════════════════════════════════════════════════════════════
-- Mig 92 — particularité : foldername[2] = uid (auteur), foldername[1] = conv_id

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'rencontre_photos_owner_insert'),
  1,
  'E1 mig 92 : policy rencontre_photos_owner_insert existe (foldername[2] = uid + participant check)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'rencontre_photos_owner_select'),
  1,
  'E2 mig 92 : policy rencontre_photos_owner_select existe (anti-revanche)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'rencontre_photos_admin_select'),
  1,
  'E3 mig 92 : policy rencontre_photos_admin_select existe (modération signalement)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'rencontre_photos_admin_delete'),
  1,
  'E4 mig 92 : policy rencontre_photos_admin_delete existe (purge admin)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- F. Mig 94 — drop policies *_public_read (2 tests — anti listing leak)
-- ═════════════════════════════════════════════════════════════════════════════
-- Sur buckets publics, le CDN sert l'objet sans policy SELECT. Garder une policy
-- *_public_read activait `storage.objects.list()` REST → leak metadata (compte
-- d'objets, naming pattern). Mig 94 a drop. URL CDN directe reste OK.

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_public_read'),
  0,
  'F1 mig 94 : policy avatars_public_read DROPPED (anti listing leak)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'annonces_photos_public_read'),
  0,
  'F2 mig 94 : policy annonces_photos_public_read DROPPED (anti listing leak)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- G. Trigger trg_purge_cni_storage (mig 54 wiring, mig 110 HTTP body) (1 test)
-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠ Le test fonctionnel "DELETE verif → HTTP DELETE Storage" est validé end-to-end
-- en mig 110 manual play (cf. CLAUDE.md gotcha). Ici : vérifier le wiring.

select is(
  (select count(*)::int from pg_trigger t
    where t.tgname = 'trg_purge_cni_storage'
      and t.tgrelid = 'public.verifications_identite'::regclass
      and (t.tgtype & 2) = 2   -- BEFORE
      and (t.tgtype & 8) = 8   -- DELETE
      and not t.tgisinternal),
  1,
  'G1 mig 54+110 : trg_purge_cni_storage wired BEFORE DELETE sur verifications_identite'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- H. Crons Storage-related (3 tests)
-- ═════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from cron.job where jobname = 'expire-annonces'),
  1,
  'H1 mig 16 : cron expire-annonces enregistré (02h UTC daily)'
);

select is(
  (select count(*)::int from cron.job where jobname = 'purge-expired-annonces'),
  1,
  'H2 mig 16 : cron purge-expired-annonces enregistré (03h UTC daily → Edge Function)'
);

select is(
  (select count(*)::int from cron.job where jobname = 'purge-expired-kyc-verifications'),
  1,
  'H3 mig 54 : cron purge-expired-kyc-verifications enregistré (03h UTC daily)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- I. Functions Storage-related présentes (4 tests)
-- ═════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_cni_storage_on_verif_delete'),
  1,
  'I1 mig 54+110 : function purge_cni_storage_on_verif_delete existe (trigger body HTTP)'
);

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_purge_expired_annonces'),
  1,
  'I2 mig 16 : function fn_purge_expired_annonces existe (cron Edge Function POST)'
);

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_expired_kyc_verifications'),
  1,
  'I3 mig 54 : function purge_expired_kyc_verifications existe (cron daily 03h)'
);

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'add_rencontre_photo'),
  1,
  'I4 mig 92+102 : function add_rencontre_photo existe (RPC INSERT rencontre_photos)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- J. RLS table rencontre_photos (3 tests — couplée au bucket)
-- ═════════════════════════════════════════════════════════════════════════════

select is(
  (select relrowsecurity from pg_class
    where relname = 'rencontre_photos' and relnamespace = 'public'::regnamespace),
  true,
  'J1 mig 92 : table rencontre_photos RLS enabled'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'rencontre_photos'
      and policyname = 'rencontre_photos_select_own'),
  1,
  'J2 mig 92 : policy rencontre_photos_select_own existe (auth.uid() = auteur_id)'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'rencontre_photos'
      and policyname = 'rencontre_photos_select_admin'),
  1,
  'J3 mig 92 : policy rencontre_photos_select_admin existe (modération)'
);

select * from finish();
rollback;

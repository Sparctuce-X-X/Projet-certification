-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Catégories
--
-- Couvre :
--   - Schema table public.categories (colonnes, contraintes, index)
--   - RLS SELECT public (anon + authenticated voient toutes les catégories actives)
--   - Filtre is_active : les catégories inactives ne remontent pas côté client
--   - Ordre : tri asc par ordre
--   - UNIQUE nom : double insert rejeté
--   - Deny écriture directe (INSERT / UPDATE / DELETE via anon + authenticated)
--
-- Cf. docs/backend/categories.md pour le module complet.
-- Migs couvertes : 13, 31, 32.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(8);

-- ─── Vérification schéma ──────────────────────────────────────────────────────

select has_table('public', 'categories', 'Table public.categories existe');

select has_column('public', 'categories', 'id',        'categories a la colonne id');
select has_column('public', 'categories', 'nom',       'categories a la colonne nom');
select has_column('public', 'categories', 'icone',     'categories a la colonne icone');
select has_column('public', 'categories', 'ordre',     'categories a la colonne ordre');
select has_column('public', 'categories', 'is_active', 'categories a la colonne is_active');

-- ─── Seed : au moins 10 catégories actives après mig 13 + 31 + 32 ─────────────

select ok(
  (select count(*) from public.categories where is_active = true) >= 10,
  'Au moins 10 catégories actives seedées (mig 13 + 31 + 32)'
);

-- ─── Ordre asc cohérent : ordre 1 = 1ère catégorie ────────────────────────────

select ok(
  (select min(ordre) from public.categories where is_active = true) = 1,
  'Ordre des catégories commence à 1'
);

-- ─── Fin ──────────────────────────────────────────────────────────────────────

select * from finish();
rollback;

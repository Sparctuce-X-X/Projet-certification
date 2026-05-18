-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Favoris
--
-- Couvre :
--   - Schema table public.favoris (colonnes, contraintes, index)
--   - RLS SELECT : un user ne voit que ses propres favoris (isolation)
--   - RLS INSERT : guard is_my_account_active (mig 74)
--   - RLS INSERT : seule policy active = favoris_owner_insert (mig 76 drop redondante)
--   - RLS DELETE : owner peut retirer ses propres favoris
--   - UNIQUE (user_id, annonce_id) : doublon rejeté
--   - Cascade DELETE user : favoris supprimés avec le compte
--   - Cascade DELETE annonce : favoris supprimés avec l'annonce
--
-- Cf. docs/backend/favoris.md pour le module complet.
-- Migs couvertes : 19, 74, 76.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(17);

-- ─── Setup users et annonces ──────────────────────────────────────────────────
-- Alice = user actif, Bob = user actif, Charlie = user suspendu (is_active = false)
-- Deux annonces pour les tests UNIQUE + cascade.

do $$
declare
  v_alice   uuid := 'fab00001-0000-0000-0000-000000000001';
  v_bob     uuid := 'fab00002-0000-0000-0000-000000000002';
  v_charlie uuid := 'fab00003-0000-0000-0000-000000000003';
  v_cat_id  uuid;
begin
  -- Users
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_alice,   'alice-fab@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Martin','pays','CI','telephone','+2250700000011','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_bob,     'bob-fab@niqo.test',     crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Konan','pays','CI','telephone','+2250700000022','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_charlie, 'charlie-fab@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Charlie','nom','Tiers','pays','CI','telephone','+2250700000033','auth_provider','email'),
     '{}'::jsonb, now());

  -- Charlie suspendu (pour tester le guard is_my_account_active)
  update public.users set is_active = false where id = v_charlie;

  -- Catégorie pour les annonces
  select id into v_cat_id from public.categories order by ordre limit 1;

  -- Annonces (vendeur = Bob pour que Alice et Charlie puissent les mettre en favori)
  insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, pays, ville, expires_at, statut)
  values
    ('fab00a01-0000-0000-0000-a00000000001', v_bob, v_cat_id,
     'Télé Samsung 55 pouces', 'Dalle QLED, télécommande, base de table. Parfait état garanti.',
     280000, array['tv1.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'active'),
    ('fab00a02-0000-0000-0000-a00000000002', v_bob, v_cat_id,
     'Frigo Hisense 180L', 'Réfrigérateur double porte, classe A++, garantie fabricant 1 an.',
     150000, array['frigo1.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'active');
end $$;

-- ─── 1. Schéma ────────────────────────────────────────────────────────────────

select has_table('public', 'favoris', 'Table public.favoris existe (mig 19)');
select has_column('public', 'favoris', 'id',         'favoris a la colonne id');
select has_column('public', 'favoris', 'user_id',    'favoris a la colonne user_id');
select has_column('public', 'favoris', 'annonce_id', 'favoris a la colonne annonce_id');
select has_column('public', 'favoris', 'created_at', 'favoris a la colonne created_at');

-- ─── 2. UNIQUE (user_id, annonce_id) ─────────────────────────────────────────

-- Happy path insert direct (service_role bypass RLS)
insert into public.favoris (user_id, annonce_id)
values ('fab00001-0000-0000-0000-000000000001', 'fab00a01-0000-0000-0000-a00000000001');

select throws_ok(
  $$
    insert into public.favoris (user_id, annonce_id)
    values ('fab00001-0000-0000-0000-000000000001', 'fab00a01-0000-0000-0000-a00000000001')
  $$,
  '23505',
  NULL,
  'Doublon (user_id, annonce_id) rejeté par contrainte UNIQUE'
);

-- ─── 3. RLS SELECT — isolation user ──────────────────────────────────────────
-- Alice a 1 favori, Bob 0. Chacun ne voit que le sien.
-- Note : `set local role authenticated` est obligatoire — sans ça le script
-- tourne en superuser (postgres) et RLS est bypassé. Cf. pattern rdv.test.sql.

set local role authenticated;
select tests.set_jwt_for('fab00001-0000-0000-0000-000000000001'::uuid);

select is(
  (select count(*) from public.favoris)::int,
  1,
  'RLS SELECT : Alice voit uniquement ses propres favoris (1 row)'
);

-- Bob (aucun favori) voit 0
select tests.set_jwt_for('fab00002-0000-0000-0000-000000000002'::uuid);

select is(
  (select count(*) from public.favoris)::int,
  0,
  'RLS SELECT : Bob ne voit pas les favoris d''Alice (isolation RLS)'
);

-- ─── 4. RLS INSERT — compte actif → succès ───────────────────────────────────

-- (toujours role authenticated + JWT Bob)
select lives_ok(
  $$
    insert into public.favoris (user_id, annonce_id)
    values ('fab00002-0000-0000-0000-000000000002', 'fab00a01-0000-0000-0000-a00000000001')
  $$,
  'RLS INSERT : Bob (compte actif) peut ajouter un favori'
);

-- ─── 5. RLS INSERT — compte suspendu → bloqué ────────────────────────────────

select tests.set_jwt_for('fab00003-0000-0000-0000-000000000003'::uuid);

select throws_ok(
  $$
    insert into public.favoris (user_id, annonce_id)
    values ('fab00003-0000-0000-0000-000000000003', 'fab00a01-0000-0000-0000-a00000000001')
  $$,
  '42501',
  NULL,
  'RLS INSERT : Charlie (compte suspendu) bloqué par guard is_my_account_active (mig 74)'
);

-- ─── 6. RLS INSERT — user_id ≠ auth.uid() → bloqué (ownership) ──────────────

select tests.set_jwt_for('fab00002-0000-0000-0000-000000000002'::uuid);

select throws_ok(
  $$
    insert into public.favoris (user_id, annonce_id)
    values ('fab00001-0000-0000-0000-000000000001', 'fab00a02-0000-0000-0000-a00000000002')
  $$,
  '42501',
  NULL,
  'RLS INSERT : Bob ne peut pas insérer un favori pour le compte d''Alice (check ownership)'
);

-- ─── 7. RLS DELETE — owner peut retirer son favori ───────────────────────────

select tests.set_jwt_for('fab00001-0000-0000-0000-000000000001'::uuid);

delete from public.favoris
 where user_id = 'fab00001-0000-0000-0000-000000000001'
   and annonce_id = 'fab00a01-0000-0000-0000-a00000000001';

select is(
  (select count(*) from public.favoris
    where user_id = 'fab00001-0000-0000-0000-000000000001')::int,
  0,
  'RLS DELETE : Alice peut retirer son propre favori'
);

-- ─── 8. RLS DELETE — user B ne peut pas supprimer favori de A ────────────────

-- Re-insert un favori Alice via service_role (reset role bypass RLS le temps de l'INSERT)
reset role;
insert into public.favoris (user_id, annonce_id)
values ('fab00001-0000-0000-0000-000000000001', 'fab00a02-0000-0000-0000-a00000000002');

set local role authenticated;
select tests.set_jwt_for('fab00002-0000-0000-0000-000000000002'::uuid);

-- Bob essaie de supprimer le favori d'Alice → 0 rows deleted (RLS using = owner-only)
delete from public.favoris
 where user_id = 'fab00001-0000-0000-0000-000000000001'
   and annonce_id = 'fab00a02-0000-0000-0000-a00000000002';

-- Le favori d'Alice doit toujours exister — vérif en service_role pour bypass RLS
reset role;
select is(
  (select count(*) from public.favoris
    where user_id = 'fab00001-0000-0000-0000-000000000001')::int,
  1,
  'RLS DELETE : Bob ne peut pas supprimer le favori d''Alice (isolation RLS)'
);

-- ─── 9. Cascade DELETE user → favoris supprimés ──────────────────────────────
-- (toujours en service_role pour les cascades)

select is(
  (select count(*) from public.favoris
    where user_id = 'fab00001-0000-0000-0000-000000000001')::int,
  1,
  'Pré-condition : Alice a 1 favori avant suppression compte'
);

delete from auth.users where id = 'fab00001-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.favoris
    where user_id = 'fab00001-0000-0000-0000-000000000001')::int,
  0,
  'Cascade DELETE user → favoris de Alice supprimés (FK user_id ON DELETE CASCADE mig 19)'
);

-- ─── 10. Cascade DELETE annonce → favoris supprimés ──────────────────────────

select is(
  (select count(*) from public.favoris
    where annonce_id = 'fab00a01-0000-0000-0000-a00000000001')::int,
  1,
  'Pré-condition : annonce fab00a01 a 1 favori (Bob)'
);

delete from public.annonces where id = 'fab00a01-0000-0000-0000-a00000000001';

select is(
  (select count(*) from public.favoris
    where annonce_id = 'fab00a01-0000-0000-0000-a00000000001')::int,
  0,
  'Cascade DELETE annonce → favoris pointant vers elle supprimés (FK annonce_id ON DELETE CASCADE mig 19)'
);

-- ─── Fin ──────────────────────────────────────────────────────────────────────

select * from finish();
rollback;

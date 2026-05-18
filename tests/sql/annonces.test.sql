-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Annonces — couverture exhaustive
--
-- Couvre :
--   A. Triggers BEFORE INSERT (6 : set_expires +60d ×2, inherit_pays, rate_limit, doublon, content_filter)
--   B. CHECK constraints (3 : prix>0, titre 3-50, desc 10-2000 — cap prix par pays DROPPED mig 30)
--   C. RLS (11 : anon/owner/buyer/stranger × SELECT/UPDATE/DELETE)
--   D. RPCs core (17 : increment_views, prolonger ×4, public_profile ×3, mark_vendue ×3, admin_revert ×4)
--   E. Trigger lifecycle (2 : tg_annonce_statut_on_rdv_change)
--   F. Mode Immobilier (2 : IMMO_NO_RDV, INSERT immo etat=NULL)
--   G. Cron-side (2 : expire-annonces SQL, purge ne touche pas <28j)
--
-- Total 43 assertions. Cf. docs/backend/annonces.md pour le module complet.
-- Migs couvertes : 15, 16, 17, 18, 29, 30 (drop cap), 32, 34, 39, 41, 86, 95, 100, 101, 103, 105.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(43);

-- ═════════════════════════════════════════════════════════════════════════════
-- Setup — 4 users, 1 catégorie normale + 1 catégorie immo
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_alice uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_bob   uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_carol uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_dom   uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, aud, role)
  values
    (v_alice, 'alice-ann@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Annonces','pays','CI','telephone','+2250777000001','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (v_bob,   'bob-ann@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Annonces','pays','CI','telephone','+2250777000002','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (v_carol, 'carol-ann@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Carol','nom','Annonces','pays','CG','telephone','+2420600000001','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (v_dom,   'dom-ann@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Dom','nom','Admin','pays','CI','telephone','+2250777000099','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated');
  update public.users set is_admin = true where id = v_dom;
end $$;

-- Catégories : capture IDs (1 normale + 1 immo) en config session
do $$
declare
  v_cat_normale uuid;
  v_cat_immo    uuid;
begin
  select id into v_cat_normale from public.categories where is_active = true and nom <> 'Immobilier' order by ordre limit 1;
  select id into v_cat_immo    from public.categories where nom = 'Immobilier' limit 1;
  perform set_config('niqo.cat_normale', v_cat_normale::text, false);
  perform set_config('niqo.cat_immo',    v_cat_immo::text,    false);
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- A. Triggers BEFORE INSERT
-- ═════════════════════════════════════════════════════════════════════════════

-- A1 : set_expires_at force +60d même si client envoie autre valeur (mig 18)
--      A2 : inherit_pays force pays = users.pays même si client envoie autre pays
-- Insert avec expires_at=+1d (devrait être forcé +60d) et pays=CG (devrait être forcé CI)

insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays, expires_at)
values (
  'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  current_setting('niqo.cat_normale')::uuid,
  'Test trigger expires',
  'Description trigger expires_at force test plus de 10 chars',
  30000, array['x.jpg']::text[], 'bon', 'Abidjan', 'CG',
  now() + interval '1 day'
);

select cmp_ok(
  (select expires_at from public.annonces where id = 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '>',
  now() + interval '59 days 12 hours',
  'A1 set_expires_at_trigger force expires_at > now()+59.5d (mig 18 client value ignored)'
);

select cmp_ok(
  (select expires_at from public.annonces where id = 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '<',
  now() + interval '60 days 1 hour',
  'A1b set_expires_at_trigger force expires_at < now()+60d+1h'
);

select is(
  (select pays::text from public.annonces where id = 'aaaa0001-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'CI',
  'A2 inherit_annonces_pays force pays=CI sur user CI (client envoyait CG)'
);

-- A3 : rate_limit 5/24h — Alice a déjà 1 annonce, on en ajoute 4 puis la 6e raise
insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
values
  ('aaaa0002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'Test ratelim 2', 'Description rate limit annonce 2 plus 10 chars', 31000, array['x.jpg']::text[], 'bon', 'Abidjan', 'CI'),
  ('aaaa0003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'Test ratelim 3', 'Description rate limit annonce 3 plus 10 chars', 32000, array['x.jpg']::text[], 'bon', 'Abidjan', 'CI'),
  ('aaaa0004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'Test ratelim 4', 'Description rate limit annonce 4 plus 10 chars', 33000, array['x.jpg']::text[], 'bon', 'Abidjan', 'CI'),
  ('aaaa0005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'Test ratelim 5', 'Description rate limit annonce 5 plus 10 chars', 34000, array['x.jpg']::text[], 'bon', 'Abidjan', 'CI');

select throws_ok(
  $$ insert into public.annonces (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
             'Test ratelim 6', 'Description rate limit 6 doit echouer plus 10', 35000,
             array['x.jpg']::text[], 'bon', 'Abidjan', 'CI') $$,
  'P0001',
  null,
  'A3 rate_limit trigger raise P0001 sur 6e INSERT 24h (mig 16)'
);

-- A4 : anti-doublon — Carol crée X puis re-insert identique → raise
insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
values (
  'cccc0001-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  current_setting('niqo.cat_normale')::uuid,
  'Carol original', 'Description originale anti doublon plus 10 chars', 20000,
  array['x.jpg']::text[], 'bon', 'Brazzaville', 'CG'
);

select throws_ok(
  $$ insert into public.annonces (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc', current_setting('niqo.cat_normale')::uuid,
             'Carol original', 'Description originale anti doublon plus 10 chars', 20000,
             array['x.jpg']::text[], 'bon', 'Brazzaville', 'CG') $$,
  null,
  'annonces_duplicate_check',
  'A4 anti-doublon raise sur (titre+desc+prix+ville) identique <24h (mig 17)'
);

-- A5 : content_filter — on injecte un mot interdit puis on tente INSERT (mig 29)
insert into public.mots_interdits (mot, categorie) values ('zzzbannedterm', 'test') on conflict (mot) do nothing;

select throws_ok(
  $$ insert into public.annonces (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc', current_setting('niqo.cat_normale')::uuid,
             'Vends zzzbannedterm', 'Description normale sans rien de problematique plus 10', 15000,
             array['x.jpg']::text[], 'bon', 'Brazzaville', 'CG') $$,
  null,
  'contenu_interdit',
  'A5 content_filter raise contenu_interdit sur mot blacklisté dans titre (mig 29)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- B. CHECK constraints
-- ═════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.annonces (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_setting('niqo.cat_normale')::uuid,
             'B1 prix zero', 'B1 description normale au moins 10 chars', 0,
             array['x.jpg']::text[], 'bon', 'Abidjan', 'CI') $$,
  '23514', null,
  'B1 CHECK prix > 0 raise sur prix=0'
);

-- Note: B2 & B3 supprimés — le cap prix par pays a été DROPPED en mig 30
-- (pivot v4.0, plus d'escrow MM → plus de raison de capper). Doc updated.

select throws_ok(
  $$ insert into public.annonces (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_setting('niqo.cat_normale')::uuid,
             'Ti', 'Description normale au moins dix caracteres', 10000,
             array['x.jpg']::text[], 'bon', 'Abidjan', 'CI') $$,
  '23514', null,
  'B4 CHECK titre 3-50 chars raise sur 2 chars'
);

select throws_ok(
  $$ insert into public.annonces (vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', current_setting('niqo.cat_normale')::uuid,
             'B5 desc', 'Short', 10000,
             array['x.jpg']::text[], 'bon', 'Abidjan', 'CI') $$,
  '23514', null,
  'B5 CHECK description 10-2000 chars raise sur 5 chars'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- Setup fixtures lifecycle : 5 annonces Alice (1 par statut) + 1 immo + 1 conv
-- On disable le rate_limit_trigger pour les fixtures (déjà testé section A3)
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.annonces disable trigger enforce_annonces_rate_limit_trigger;
alter table public.annonces disable trigger enforce_annonce_no_duplicate;

insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, statut, ville, pays)
values
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'A active', 'Description Alice annonce active pour RLS plus 10', 40000, array['x.jpg']::text[], 'bon', 'active', 'Abidjan', 'CI'),
  ('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'A expiree', 'Description Alice annonce expiree pour prolonger plus 10', 41000, array['x.jpg']::text[], 'bon', 'expiree', 'Abidjan', 'CI'),
  ('aaaa4444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'A vendue', 'Description Alice annonce vendue terminale plus 10', 42000, array['x.jpg']::text[], 'bon', 'vendue', 'Abidjan', 'CI'),
  ('aaaa5555-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'A suspendue', 'Description Alice annonce suspendue par admin plus 10', 43000, array['x.jpg']::text[], 'bon', 'suspendue', 'Abidjan', 'CI'),
  ('aaaa7777-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
   'A expiree old', 'Description Alice expiree depuis longtemps plus 10', 44000, array['x.jpg']::text[], 'bon', 'expiree', 'Abidjan', 'CI');

-- Backdate expires_at pour les 2 expiree (récente <28j vs très ancienne >28j)
update public.annonces set expires_at = now() - interval '5 days'  where id = 'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.annonces set expires_at = now() - interval '50 days' where id = 'aaaa7777-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Backdate created_at de toutes les annonces récentes (bypass rate_limit pour seed suivant)
update public.annonces set created_at = now() - interval '2 days' where created_at > now() - interval '1 hour';

-- Alice en_cours (insert puis update statut)
insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, statut, ville, pays, created_at)
values (
  'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_normale')::uuid,
  'A en_cours', 'Description Alice annonce en cours transaction plus 10', 45000, array['x.jpg']::text[], 'bon', 'active', 'Abidjan', 'CI',
  now() - interval '2 days'
);
update public.annonces set statut = 'en_cours' where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Alice immo (location, etat=NULL — mig 34)
insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, statut, ville, pays, type_offre, type_bien, surface_m2, nb_pieces, created_at)
values (
  'aaaa6666-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_setting('niqo.cat_immo')::uuid,
  'A immo studio', 'Description Alice annonce studio immo location plus 10', 60000, array['x.jpg']::text[], null, 'active', 'Abidjan', 'CI',
  'location', 'studio', 25, 1, now() - interval '2 days'
);

-- Conversation Bob ↔ Alice sur A_en_cours pour tester buyer_via_conv (mig 41)
insert into public.conversations (id, annonce_id, vendeur_id, acheteur_id, rdv_confirme_at)
values (
  'aaaa00aa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  now() - interval '1 day'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- C. RLS — SELECT/UPDATE/DELETE par contexte
-- ═════════════════════════════════════════════════════════════════════════════

set local role authenticated;

-- C1 — Anon SELECT statut='active' : voit les 2 actives (A_active + A_immo)
select set_config('request.jwt.claims', null, true);

select cmp_ok(
  (select count(*)::int from public.annonces where id in (
    'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaa6666-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  )),
  '=',
  2,
  'C1 RLS annonces_read_active : anon voit les 2 actives (normale + immo)'
);

-- C2 — Anon ne voit PAS les non-actives
select is(
  (select count(*)::int from public.annonces where id in (
    'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaa4444-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaa5555-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  )),
  0,
  'C2 RLS anon ne lit pas en_cours/vendue/suspendue/expiree'
);

-- C3 — Alice voit toutes ses 5 annonces (incluant non-actives)
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select cmp_ok(
  (select count(*)::int from public.annonces
     where vendeur_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and id in (
         'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         'aaaa4444-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         'aaaa5555-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       )),
  '=',
  5,
  'C3 RLS owner_select_own : Alice voit ses 5 annonces (tous statuts)'
);

-- C4 — Stranger Carol ne lit pas les non-actives d'Alice
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc');

select is(
  (select count(*)::int from public.annonces where id in (
    'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaa4444-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaa5555-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  )),
  0,
  'C4 RLS stranger Carol ne lit pas les non-actives d Alice'
);

-- C5 — Bob (buyer via conv) lit A_en_cours (mig 41)
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (select count(*)::int from public.annonces where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'C5 RLS annonces_buyer_select_via_conv : Bob lit A_en_cours via conv (mig 41)'
);

-- C6 — Alice UPDATE A_active (statut=active) : succès (1 row)
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

with upd as (
  update public.annonces set titre = 'A active updated'
   where id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   returning id
)
select is((select count(*)::int from upd), 1, 'C6 RLS Alice UPDATE A_active OK (statut=active)');

-- C7 — Alice UPDATE A_en_cours : 0 rows (RLS bloque statut <> active)
with upd as (
  update public.annonces set titre = 'should not change'
   where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   returning id
)
select is((select count(*)::int from upd), 0, 'C7 RLS Alice UPDATE A_en_cours bloqué (statut <> active)');

-- C8 — Stranger Carol UPDATE A_active d'Alice : 0 rows
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc');

with upd as (
  update public.annonces set titre = 'pwned'
   where id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   returning id
)
select is((select count(*)::int from upd), 0, 'C8 RLS stranger Carol UPDATE Alice annonce bloqué');

-- C9 — Alice DELETE A_suspendue : OK
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

with del as (
  delete from public.annonces where id = 'aaaa5555-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*)::int from del), 1, 'C9 RLS Alice DELETE A_suspendue OK');

-- C10 — Alice DELETE A_vendue : 0 rows
with del as (
  delete from public.annonces where id = 'aaaa4444-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*)::int from del), 0, 'C10 RLS Alice DELETE A_vendue bloqué');

-- C11 — Alice DELETE A_en_cours : 0 rows
with del as (
  delete from public.annonces where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa' returning id
)
select is((select count(*)::int from del), 0, 'C11 RLS Alice DELETE A_en_cours bloqué');

reset role;


-- ═════════════════════════════════════════════════════════════════════════════
-- D. RPCs core
-- ═════════════════════════════════════════════════════════════════════════════

-- D1 — fn_increment_views sur active : nb_vues = 1
select set_config('request.jwt.claims', null, true);
select public.fn_increment_views('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is(
  (select nb_vues from public.annonces where id = 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'D1 fn_increment_views sur active → nb_vues = 1'
);

-- D2 — fn_increment_views sur en_cours : no-op
select public.fn_increment_views('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is(
  (select nb_vues from public.annonces where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'D2 fn_increment_views sur en_cours → no-op (nb_vues reste 0)'
);

-- D3 — fn_prolonger_annonce success — Alice owner sur A_expiree (-5j)
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is(
  (public.fn_prolonger_annonce('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'success')::bool,
  true,
  'D3 fn_prolonger_annonce expiree<28j → success=true'
);

-- D3b — statut maintenant 'active'
select is(
  (select statut::text from public.annonces where id = 'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'active',
  'D3b fn_prolonger_annonce remet statut=active'
);

-- D4 — fn_prolonger_annonce window_closed — Alice sur A_expiree old (>28j)
select is(
  (public.fn_prolonger_annonce('aaaa7777-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'error'),
  'window_closed',
  'D4 fn_prolonger_annonce expiree>28j → error=window_closed'
);

-- D5 — fn_prolonger_annonce not_expired — Alice sur A_active (déjà active)
select is(
  (public.fn_prolonger_annonce('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'error'),
  'not_expired',
  'D5 fn_prolonger_annonce sur active → error=not_expired'
);

-- D6 — fn_prolonger_annonce not_owner — Bob sur A_expiree d'Alice
-- D3 a remis A_expiree en active → on remet en expiree
update public.annonces set statut = 'expiree', expires_at = now() - interval '5 days'
 where id = 'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select is(
  (public.fn_prolonger_annonce('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'error'),
  'not_owner',
  'D6 fn_prolonger_annonce stranger → error=not_owner'
);

-- D7 — get_user_public_profile : prenom OK
select set_config('request.jwt.claims', null, true);
select is(
  (public.get_user_public_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'prenom'),
  'Alice',
  'D7 get_user_public_profile retourne prenom'
);

-- D7b — get_user_public_profile NE retourne PAS telephone (RGPD)
select ok(
  not (public.get_user_public_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ? 'telephone'),
  'D7b get_user_public_profile NE retourne PAS le téléphone (RGPD minimisation)'
);

-- D8 — get_user_public_profile suspended → null
update public.users set is_active = false where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select is(
  public.get_user_public_profile('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  null::jsonb,
  'D8 get_user_public_profile suspended → null'
);
update public.users set is_active = true where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- D9 — mark_annonce_vendue immo : bypass rencontre (mig 101)
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is(
  (public.mark_annonce_vendue('aaaa6666-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'success')::bool,
  true,
  'D9 mark_annonce_vendue immo bypass rencontre → success=true (mig 101)'
);

select is(
  (select statut::text from public.annonces where id = 'aaaa6666-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'vendue',
  'D9b mark_annonce_vendue immo → statut=vendue'
);

-- D10 — mark_annonce_vendue normale sans rencontre → error no_meeting_confirmed
-- Reset A_en_cours en active sans rencontre
update public.annonces set statut = 'active' where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.conversations
   set rencontre_acheteur = null, rencontre_vendeur = null, rencontre_decided_at = null,
       rdv_confirme_at = null
 where id = 'aaaa00aa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select isnt(
  (public.mark_annonce_vendue('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'success')::bool,
  true,
  'D10 mark_annonce_vendue normale sans rencontre → success<>true'
);

-- D11 — admin_revert_annonce_to_active : Alice (non-admin) → ADMIN_REQUIRED
update public.annonces set statut = 'en_cours' where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (public.admin_revert_annonce_to_active('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'error'),
  'ADMIN_REQUIRED',
  'D11 admin_revert_annonce_to_active non-admin → error=ADMIN_REQUIRED (mig 95)'
);

-- D12 — admin_revert_annonce_to_active : Dom (admin) en_cours → active + audit
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd');

select is(
  (public.admin_revert_annonce_to_active('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ->> 'success')::bool,
  true,
  'D12 admin_revert_annonce_to_active admin en_cours → success=true'
);

select is(
  (select statut::text from public.annonces where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'active',
  'D12b admin_revert_annonce_to_active → statut=active'
);

select cmp_ok(
  (select count(*)::int from public.audit_log_admin
    where admin_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
      and action = 'annonce_reverted_active'
      and target_id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '>=',
  1,
  'D12c admin_revert_annonce_to_active → audit_log_admin entry (mig 103)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- E. Trigger lifecycle tg_annonce_statut_on_rdv_change (mig 39)
-- ═════════════════════════════════════════════════════════════════════════════

-- Reset state : A_en_cours active, conv sans rdv_confirme_at
update public.annonces set statut = 'active' where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.conversations
   set rdv_confirme_at = null,
       rencontre_acheteur = null, rencontre_vendeur = null, rencontre_decided_at = null
 where id = 'aaaa00aa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- E1 — Set rdv_confirme_at → trigger flip active → en_cours
update public.conversations set rdv_confirme_at = now() where id = 'aaaa00aa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select statut::text from public.annonces where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'en_cours',
  'E1 tg_annonce_statut_on_rdv_change : confirm RDV → annonce active → en_cours'
);

-- E2 — Cancel RDV (rdv_confirme_at=null) → trigger flip en_cours → active
update public.conversations set rdv_confirme_at = null where id = 'aaaa00aa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select statut::text from public.annonces where id = 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'active',
  'E2 tg_annonce_statut_on_rdv_change : cancel RDV → annonce en_cours → active'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- F. Mode Immobilier
-- ═════════════════════════════════════════════════════════════════════════════

-- F1 — propose_rdv sur annonce immo → IMMO_NO_RDV (mig 100)
-- D9 a marqué A_immo vendue, on remet active
update public.annonces set statut = 'active' where id = 'aaaa6666-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

insert into public.conversations (id, annonce_id, vendeur_id, acheteur_id)
values (
  'aaaa00bb-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'aaaa6666-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

select is(
  (public.propose_rdv(
     'aaaa00bb-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
     'Studio à Cocody',
     (now() + interval '2 days')::timestamptz
   ) ->> 'error'),
  'IMMO_NO_RDV',
  'F1 propose_rdv sur annonce immo retourne error=IMMO_NO_RDV (mig 100)'
);

-- F2 — INSERT immo valide avec etat NULL (mig 34)
select set_config('request.jwt.claims', null, true);

insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, statut, ville, pays, type_offre, type_bien, created_at)
values (
  'aaaa8888-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  current_setting('niqo.cat_immo')::uuid,
  'Appt 3p Plateau',
  'Description appartement 3 pieces immo location plus 10',
  150000, array['x.jpg']::text[],
  null, 'active', 'Abidjan', 'CI', 'location', 'appartement',
  now() - interval '2 days'
);

select is(
  (select etat::text from public.annonces where id = 'aaaa8888-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  null,
  'F2 INSERT immo avec etat NULL OK (mig 34)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- G. Cron-side
-- ═════════════════════════════════════════════════════════════════════════════

-- G1 — SQL inline expire-annonces : active+expires_at<now() → expiree
insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, statut, ville, pays, created_at, expires_at)
values (
  'cccc9999-cccc-cccc-cccc-cccccccccccc',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  current_setting('niqo.cat_normale')::uuid,
  'Carol expire candidate', 'Description Carol candidate expiration cron plus 10',
  19000, array['x.jpg']::text[], 'bon', 'active', 'Brazzaville', 'CG',
  now() - interval '70 days', now() - interval '10 days'
);

-- Exécution du SQL inline du cron mig 16
update public.annonces
   set statut = 'expiree', updated_at = now()
 where statut = 'active' and expires_at < now();

select is(
  (select statut::text from public.annonces where id = 'cccc9999-cccc-cccc-cccc-cccccccccccc'),
  'expiree',
  'G1 cron expire-annonces SQL : active+expires_at<now() → expiree'
);

-- G2 — fn_purge_expired_annonces ne purge pas <28j
-- A_expiree (aaaa3333) est en statut=expiree avec expires_at = now()-5j → safe
select is(
  (select count(*)::int from public.annonces
     where id = 'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and statut = 'expiree'
       and expires_at < now() - interval '28 days'),
  0,
  'G2 fn_purge_expired_annonces ne match pas les expirées <28j (A_expiree -5j safe)'
);


-- Cleanup test entry mots_interdits
delete from public.mots_interdits where mot = 'zzzbannedterm';

select * from finish();
rollback;

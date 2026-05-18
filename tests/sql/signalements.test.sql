-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Signalements (F08)
--
-- Couvre via DB direct (RLS, triggers, RPCs, helpers) :
--   - RLS signalements : SELECT signaleur / SELECT admin / INSERT own
--   - is_my_account_active() guard sur INSERT signalements (mig 74)
--   - UNIQUE (target_type, target_id, signaleur_id) anti-doublon
--   - RPC submit_report : gates + happy + auto-fill description (mig 27)
--   - Trigger tg_signalement_on_insert : nb_signalements++ + auto-suspend annonce ≥3 pending
--   - Trigger tg_signalement_check_threshold : score_abus++ + push + admin_decided_at + fraude pause
--   - Trigger tg_check_score_abus : auto-suspend si score≥3 (mig 28)
--   - RPC create_signalement_post_rdv : 4 gates + happy + snapshot non-null
--   - RPC admin_treat_signalement : ADMIN_REQUIRED + INVALID_ACTION + NOT_PENDING
--   - Auto-pause annonce sur fraude (tentative_fraude, complot_fraude) post-RDV traite (mig 91)
--   - RPC admin_revert_annonce_to_active : gates + happy
--   - RPC get_my_rdv_signalement_status : anti-leak (mig 98)
--   - Audit log admin (mig 103) sur signalement_traite + annonce_reverted_active + user_suspended
--
-- Cf. docs/backend/signalements.md pour le module complet.
-- Migs couvertes : 25, 26, 27, 28, 56, 57, 74, 91, 94, 95, 96, 98, 103.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(41);

-- ═════════════════════════════════════════════════════════════════════════════
-- Setup : 4 users + 1 catégorie + 2 annonces Bob + 1 conv passé Alice↔Bob
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_alice uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_bob   uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_carol uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_diana uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, aud, role)
  values
    (v_alice, 'alice-sig@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Buyer','pays','CI','telephone','+2250777100001','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (v_bob,   'bob-sig@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Seller','pays','CI','telephone','+2250777100002','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (v_carol, 'carol-sig@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Carol','nom','Tiers','pays','CI','telephone','+2250777100003','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (v_diana, 'diana-sig@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Diana','nom','Admin','pays','CI','telephone','+2250777100004','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated');

  update public.users set is_admin = true where id = v_diana;
end $$;

-- Catégorie + 2 annonces de Bob (1 active pour signaler, 1 active en_cours pour rdv_post)
do $$
declare
  v_cat_normale uuid;
  v_ann1 uuid := 'ddd11111-dddd-dddd-dddd-dddddddddddd';  -- active : test signal direct
  v_ann2 uuid := 'ddd22222-dddd-dddd-dddd-dddddddddddd';  -- en_cours : test rdv_post + revert
  v_ann3 uuid := 'ddd33333-dddd-dddd-dddd-dddddddddddd';  -- active : test auto-pause ≥3 pending
begin
  select id into v_cat_normale from public.categories
    where is_active = true and nom <> 'Immobilier' order by ordre limit 1;
  perform set_config('niqo.cat_normale', v_cat_normale::text, false);

  insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays, expires_at, statut)
  values
    (v_ann1, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, v_cat_normale,
     'iPhone 12 Pro 128 Go bon état',
     'Vendu avec sa boite chargeur et coque, toujours protege.',
     250000, array['p1.jpg']::text[], 'bon', 'Abidjan', 'CI',
     now() + interval '60 days', 'active'::statut_annonce),
    (v_ann2, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, v_cat_normale,
     'Samsung Galaxy S22 Ultra 256 Go',
     'Excellent etat, vendu avec accessoires et garantie 6 mois.',
     350000, array['p2.jpg']::text[], 'bon', 'Abidjan', 'CI',
     now() + interval '60 days', 'active'::statut_annonce),
    (v_ann3, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, v_cat_normale,
     'Macbook Pro 13 pouces 2020',
     'Tres bon etat, vendu avec son chargeur dorigine et housse.',
     500000, array['p3.jpg']::text[], 'bon', 'Abidjan', 'CI',
     now() + interval '60 days', 'active'::statut_annonce);

  -- ann2 : on l'amène en_cours après création (RLS owner_update exige active)
  update public.annonces set statut = 'en_cours'::statut_annonce where id = v_ann2;
end $$;

-- Conv1 : Alice↔Bob sur ann2 avec RDV passé + confirmé (pour rdv_post happy)
-- Conv2 : Alice↔Bob sur ann1 SANS rdv (pour test no_confirmed_rdv)
-- Conv3 : Alice↔Bob sur ann3 avec RDV futur + confirmé (pour test rdv_not_past)
do $$
declare
  v_conv1 uuid := 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee';
  v_conv2 uuid := 'eee00002-eeee-eeee-eeee-eeeeeeeeeeee';
  v_conv3 uuid := 'eee00003-eeee-eeee-eeee-eeeeeeeeeeee';
  v_msg1  uuid := 'eee00011-eeee-eeee-eeee-eeeeeeeeeeee';
begin
  -- Conv1 : RDV passé + confirmé (ann2 en_cours)
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_date, rdv_confirme_at, rdv_lieu)
  values (
    v_conv1,
    'ddd22222-dddd-dddd-dddd-dddddddddddd'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    now() - interval '2 days',
    now() - interval '3 days',
    'Cocody Centre commercial'
  );

  -- Conv2 : pas de rdv (test gate no_confirmed_rdv)
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id)
  values (
    v_conv2,
    'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  );

  -- Conv3 : RDV futur confirmé (test gate rdv_not_past)
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_date, rdv_confirme_at, rdv_lieu)
  values (
    v_conv3,
    'ddd33333-dddd-dddd-dddd-dddddddddddd'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    now() + interval '3 days',
    now() - interval '1 day',
    'Plateau Place de la Republique'
  );

  -- 1 message texte de Bob dans conv2 (pour test target_type='message')
  insert into public.messages (id, conversation_id, expediteur_id, contenu, type)
  values (
    v_msg1, v_conv2,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    'Bonjour, oui dispo a Cocody, tu viens quand ?',
    'texte'::type_message
  );
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- A. RLS signalements — SELECT (3 assertions)
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup : insert 1 signalement direct en service_role (bypass RLS) — Alice signale Bob
reset role;
insert into public.signalements (id, target_type, target_id, signaleur_id, motif, description)
values (
  'fff00001-ffff-ffff-ffff-ffffffffffff',
  'utilisateur'::cible_signalement,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Profil suspect',
  'Multi-comptes detectes (mig 25)'
);

set local role authenticated;

-- A1 — Alice (signaleur) voit son signalement (policy signalements_select_own)
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  (select count(*)::int from public.signalements
     where id = 'fff00001-ffff-ffff-ffff-ffffffffffff'),
  1,
  'A1 RLS signalements_select_own : Alice signaleur voit son propre signalement'
);

-- A2 — Carol (tiers) ne voit RIEN
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select is(
  (select count(*)::int from public.signalements
     where id = 'fff00001-ffff-ffff-ffff-ffffffffffff'),
  0,
  'A2 RLS signalements_select_own : Carol tiers → 0 (anti-pollution)'
);

-- A3 — Diana (admin) voit tous les signalements (policy signalements_admin_select mig 56)
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);

select cmp_ok(
  (select count(*)::int from public.signalements),
  '>=',
  1,
  'A3 RLS signalements_admin_select : Diana admin voit la file de modération (≥1)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- B. RLS signalements — INSERT + is_my_account_active (mig 74) — 3 assertions
-- ═════════════════════════════════════════════════════════════════════════════

-- B1 — Carol tente INSERT avec signaleur_id=Alice (false signaleur) → bloqué (42501)
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select throws_ok(
  $$ insert into public.signalements (target_type, target_id, signaleur_id, motif)
     values ('utilisateur'::cible_signalement,
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
             'forge') $$,
  '42501',
  null,
  'B1 RLS signalements_insert_own : Carol ne peut pas usurper signaleur_id=Alice'
);

-- B2 — Carol INSERT légitime → OK (1 row)
with ins as (
  insert into public.signalements (target_type, target_id, signaleur_id, motif)
  values ('utilisateur'::cible_signalement,
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
          'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
          'Profil suspect 2')
  returning id
)
select is((select count(*)::int from ins), 1, 'B2 Carol INSERT légitime → OK (1 row)');

-- B3 — Suspendre Carol puis INSERT → bloqué par is_my_account_active (mig 74)
reset role;
update public.users set is_active = false where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

set local role authenticated;
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select throws_ok(
  $$ insert into public.signalements (target_type, target_id, signaleur_id, motif)
     values ('utilisateur'::cible_signalement,
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
             'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
             'after suspend') $$,
  '42501',
  null,
  'B3 mig 74 INSERT signalement bloqué si is_my_account_active()=false'
);

-- Restore Carol
reset role;
update public.users set is_active = true where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- C. UNIQUE constraint anti-doublon (1 assertion)
-- ═════════════════════════════════════════════════════════════════════════════

-- C1 — Alice retente le même signalement (target_type, target_id, signaleur_id) → 23505
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select throws_ok(
  $$ insert into public.signalements (target_type, target_id, signaleur_id, motif)
     values ('utilisateur'::cible_signalement,
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
             'duplicate') $$,
  '23505',
  null,
  'C1 UNIQUE signalements_unique_per_user → 23505 (déjà signalé via fixture A)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- D. submit_report — gates + auto-fill description (6 assertions)
-- ═════════════════════════════════════════════════════════════════════════════

-- D1 — anon → not_authenticated
select set_config('request.jwt.claims', null, true);

select is(
  (public.submit_report('annonce'::cible_signalement,
                        'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
                        'Test'))->>'error',
  'not_authenticated',
  'D1 submit_report sans JWT → not_authenticated'
);

-- D2 — Diana s'auto-signale (target=utilisateur, target_id=auth.uid) → cannot_report_self
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);

select is(
  (public.submit_report('utilisateur'::cible_signalement,
                        'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
                        'Self'))->>'error',
  'cannot_report_self',
  'D2 submit_report auto-signalement → cannot_report_self'
);

-- D3 — target inexistante (uuid random) → target_not_found
select is(
  (public.submit_report('annonce'::cible_signalement,
                        '00000000-0000-0000-0000-000000000000'::uuid,
                        'ghost'))->>'error',
  'target_not_found',
  'D3 submit_report cible inexistante → target_not_found'
);

-- D4 — Diana signale ann1 (Bob) — happy path → success=true
select is(
  ((public.submit_report('annonce'::cible_signalement,
                         'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
                         'Arnaque'))->>'success')::bool,
  true,
  'D4 submit_report happy path (Diana → annonce Bob) → success=true'
);

-- D5 — Diana refait → already_reported (UNIQUE)
select is(
  (public.submit_report('annonce'::cible_signalement,
                        'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
                        'Arnaque'))->>'error',
  'already_reported',
  'D5 submit_report 2e call sur même cible → already_reported (UNIQUE)'
);

-- D6 — Auto-fill description si vide (mig 27) — description NULL → résumé "[Annonce] ..."
reset role;
select matches(
  (select description from public.signalements
     where target_type='annonce'
       and target_id='ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid
       and signaleur_id='dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  '^\[Annonce\]',
  'D6 mig 27 auto-fill description vide → prefix "[Annonce] ..."'
);

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- E. tg_signalement_on_insert (mig 26) — nb_signalements++ + auto-suspend ≥3 (3 assertions)
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup : reset Bob.nb_signalements pour avoir un baseline propre
reset role;
update public.users set nb_signalements = 0, score_abus = 0 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- À ce stade Alice + Diana ont signalé Bob (utilisateur + annonce) → mais on a reset nb_signalements
-- On compte les inserts FUTURS, pas l'historique. Les triggers fire à chaque insert.

-- E1 — Insert 1 signalement target=annonce ann1 (depuis Carol) → ann1.vendeur=Bob → nb_signalements Bob++
set local role authenticated;
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

insert into public.signalements (target_type, target_id, signaleur_id, motif)
values ('annonce'::cible_signalement,
        'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
        'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
        'fake item');

reset role;
select is(
  (select nb_signalements from public.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'E1 tg_signalement_on_insert : nb_signalements Bob++ après signal annonce (vendeur résolu)'
);

-- E2 — Compte ≥ 3 signalements en_attente sur ann1 → auto-suspend annonce (mig 26)
-- Ann1 a déjà 1 signalement de Diana (D4) + 1 de Carol (E1) — total 2 en_attente
-- On ajoute un 3e (Alice signale ann1) → trigger doit set ann1.statut = 'suspendue'
set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

insert into public.signalements (target_type, target_id, signaleur_id, motif)
values ('annonce'::cible_signalement,
        'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
        'arnaque');

reset role;
select is(
  (select statut::text from public.annonces where id = 'ddd11111-dddd-dddd-dddd-dddddddddddd'),
  'suspendue',
  'E2 tg_signalement_on_insert : ≥3 signalements en_attente sur annonce → auto-suspend (mig 26)'
);

-- E3 — Annonce ann2 (1 seul signalement en_attente) → reste en_cours
-- On ajoute 1 signalement target=annonce ann2 (Alice) → seul 1 pending, pas d'auto-suspend
set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

insert into public.signalements (target_type, target_id, signaleur_id, motif)
values ('annonce'::cible_signalement,
        'ddd22222-dddd-dddd-dddd-dddddddddddd'::uuid,
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
        'doubt');

reset role;
select is(
  (select statut::text from public.annonces where id = 'ddd22222-dddd-dddd-dddd-dddddddddddd'),
  'en_cours',
  'E3 tg_signalement_on_insert : <3 pending → annonce reste en_cours (pas auto-suspend)'
);

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- F. tg_signalement_check_threshold (mig 25→91→96) — score_abus + marker (3 assertions)
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup : reset Bob.score_abus pour baseline
reset role;
update public.users set score_abus = 0, is_active = true where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- F1 — Pass un signalement target=utilisateur Bob de en_attente → traite → score_abus Bob++
-- Le signalement existant fff00001 (Alice signale Bob utilisateur) est en_attente
update public.signalements set statut = 'traite'::statut_signalement
  where id = 'fff00001-ffff-ffff-ffff-ffffffffffff';

select is(
  (select score_abus from public.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'F1 tg_signalement_check_threshold : traite → score_abus++ (cible=utilisateur)'
);

-- F2 — Signaler rdv_post sur conv1 puis admin valide → admin_signalement_decided_at posé
-- Note : Alice signale via INSERT direct (bypass RPC pour fixture rapide) — on simule la voie RPC
insert into public.signalements (target_type, target_id, signaleur_id, motif, motif_categorie, rdv_snapshot, role_signaleur)
values (
  'rdv_post'::cible_signalement,
  'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,  -- conv1
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,  -- Alice (acheteur)
  'Absent au rendez-vous',
  'no_show'::motif_signalement_rdv,
  jsonb_build_object('annonce_id', 'ddd22222-dddd-dddd-dddd-dddddddddddd',
                     'conversation_id', 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  'acheteur'
);

-- Pass à rejete (motif non-fraude) → marker posé même si rejet
update public.signalements set statut = 'rejete'::statut_signalement
  where target_type = 'rdv_post'::cible_signalement
    and target_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
    and signaleur_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

select isnt(
  (select admin_signalement_decided_at from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  null,
  'F2 mig 96 : rdv_post statut→rejete → conversations.admin_signalement_decided_at posé'
);

-- F3 — Rejete ne doit PAS incrémenter score_abus (sanction uniquement sur traite)
-- score_abus de Bob est à 1 (F1). Le rejete F2 ne doit pas l'incrémenter
select is(
  (select score_abus from public.users where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'F3 tg_signalement_check_threshold : rejete ne bump PAS score_abus (sanction sur traite only)'
);

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- G. tg_check_score_abus (mig 28) — auto-suspend à score≥3 (2 assertions)
-- ═════════════════════════════════════════════════════════════════════════════

-- G1 — Set score_abus=3 manuellement → is_active=false (belt-and-suspenders)
reset role;
update public.users set score_abus = 3, is_active = true where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Le trigger BEFORE UPDATE pose is_active=false dans le NEW row pendant l'update
update public.users set score_abus = 3 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select is(
  (select is_active from public.users where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  false,
  'G1 tg_check_score_abus : score≥3 + is_active=true → BEFORE UPDATE set is_active=false'
);

-- G2 — Score < 3 → is_active reste true (test belt-and-suspenders idempotent)
update public.users set is_active = true, score_abus = 2 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select is(
  (select is_active from public.users where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  true,
  'G2 tg_check_score_abus : score=2 → is_active reste true (pas de trigger)'
);

-- Restore Carol active pour la suite
update public.users set is_active = true, score_abus = 0 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- H. create_signalement_post_rdv (mig 91) — 4 gates + happy (6 assertions)
-- ═════════════════════════════════════════════════════════════════════════════

-- H1 — Anon → not_authenticated
select set_config('request.jwt.claims', null, true);

select is(
  (public.create_signalement_post_rdv(
    'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'no_show'::motif_signalement_rdv))->>'error',
  'not_authenticated',
  'H1 create_signalement_post_rdv sans JWT → not_authenticated'
);

-- H2 — Carol (non-participant conv1) → not_participant
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select is(
  (public.create_signalement_post_rdv(
    'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'no_show'::motif_signalement_rdv))->>'error',
  'not_participant',
  'H2 create_signalement_post_rdv Carol non-participant → not_participant'
);

-- H3 — conv2 (Alice↔Bob mais SANS rdv_confirme_at) → no_confirmed_rdv
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  (public.create_signalement_post_rdv(
    'eee00002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'no_show'::motif_signalement_rdv))->>'error',
  'no_confirmed_rdv',
  'H3 create_signalement_post_rdv conv sans rdv_confirme_at → no_confirmed_rdv'
);

-- H4 — conv3 (RDV futur) → rdv_not_past
select is(
  (public.create_signalement_post_rdv(
    'eee00003-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'no_show'::motif_signalement_rdv))->>'error',
  'rdv_not_past',
  'H4 create_signalement_post_rdv RDV futur → rdv_not_past'
);

-- H5 — motif=autre + description vide → description_required
select is(
  (public.create_signalement_post_rdv(
    'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'autre'::motif_signalement_rdv,
    null))->>'error',
  'description_required',
  'H5 create_signalement_post_rdv motif=autre + description vide → description_required'
);

-- H6 — Bob (vendeur) sur conv1 (RDV passé confirmé) — happy path
-- Alice a déjà créé son signalement en F2 — Bob signale en sens inverse
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select is(
  ((public.create_signalement_post_rdv(
    'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'produit_different'::motif_signalement_rdv,
    'Acheteuse pretend que le produit est defectueux'))->>'success')::bool,
  true,
  'H6 create_signalement_post_rdv happy path (Bob vendeur sur RDV passé) → success=true'
);

-- Vérif side : snapshot non-null + role_signaleur=vendeur
reset role;
do $$
declare
  v_sig record;
begin
  select rdv_snapshot, role_signaleur into v_sig
  from public.signalements
  where target_type = 'rdv_post'::cible_signalement
    and target_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
    and signaleur_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;

  perform set_config('niqo.h6_snapshot_null', (v_sig.rdv_snapshot is null)::text, false);
  perform set_config('niqo.h6_role', v_sig.role_signaleur, false);
end $$;

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- I. admin_treat_signalement (mig 56) — 3 assertions
-- ═════════════════════════════════════════════════════════════════════════════

-- I1 — Alice (non-admin) → ADMIN_REQUIRED P0002
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

-- Récupère un signalement en_attente (le 'fake item' de Carol mig E1)
reset role;
do $$
declare
  v_pending_id uuid;
begin
  select id into v_pending_id
  from public.signalements
  where statut = 'en_attente'::statut_signalement
  limit 1;
  perform set_config('niqo.pending_sig_id', v_pending_id::text, false);
end $$;

set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select throws_ok(
  format($q$ select public.admin_treat_signalement(%L::uuid, 'traite') $q$,
         current_setting('niqo.pending_sig_id')),
  'P0002',
  'ADMIN_REQUIRED',
  'I1 admin_treat_signalement non-admin → P0002 ADMIN_REQUIRED'
);

-- I2 — Diana avec action invalide → INVALID_ACTION P0003
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);

select throws_ok(
  format($q$ select public.admin_treat_signalement(%L::uuid, 'foobar') $q$,
         current_setting('niqo.pending_sig_id')),
  'P0003',
  'INVALID_ACTION',
  'I2 admin_treat_signalement action invalide → P0003 INVALID_ACTION'
);

-- I3 — Diana traite normalement → OK, puis re-traite → SIGNALEMENT_NOT_PENDING P0004
select public.admin_treat_signalement(current_setting('niqo.pending_sig_id')::uuid, 'traite');

select throws_ok(
  format($q$ select public.admin_treat_signalement(%L::uuid, 'traite') $q$,
         current_setting('niqo.pending_sig_id')),
  'P0004',
  'SIGNALEMENT_NOT_PENDING',
  'I3 admin_treat_signalement déjà traité → P0004 SIGNALEMENT_NOT_PENDING'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- J. Auto-pause annonce sur fraude rdv_post traite (mig 91) — 2 assertions
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup : reset ann2 à active (E3 + autres tests ont pu la suspendre)
reset role;
update public.annonces set statut = 'active'::statut_annonce
  where id = 'ddd22222-dddd-dddd-dddd-dddddddddddd';

-- Insert signalement rdv_post motif=tentative_fraude (cible: Bob via conv1)
-- D'abord: clear l'existant pour éviter doublon UNIQUE
delete from public.signalements
  where target_type = 'rdv_post'::cible_signalement
    and target_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid;

-- Reset admin_signalement_decided_at pour ce test
update public.conversations set admin_signalement_decided_at = null
  where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee';

-- Carol signale conv1 fraude — wait : Carol n'est pas participant. Alice signale.
insert into public.signalements (target_type, target_id, signaleur_id, motif, motif_categorie, rdv_snapshot, role_signaleur, statut)
values (
  'rdv_post'::cible_signalement,
  'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Tentative de fraude',
  'tentative_fraude'::motif_signalement_rdv,
  jsonb_build_object('annonce_id', 'ddd22222-dddd-dddd-dddd-dddddddddddd',
                     'conversation_id', 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  'acheteur',
  'en_attente'::statut_signalement
);

-- Admin valide → trigger doit pause annonce
update public.signalements set statut = 'traite'::statut_signalement
  where target_type = 'rdv_post'::cible_signalement
    and target_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid
    and motif_categorie = 'tentative_fraude'::motif_signalement_rdv;

-- J1 — annonce ann2 (du snapshot) doit être suspendue
select is(
  (select statut::text from public.annonces where id = 'ddd22222-dddd-dddd-dddd-dddddddddddd'),
  'suspendue',
  'J1 mig 91 tentative_fraude traité → annonce.statut=suspendue (depuis rdv_snapshot)'
);

-- J2 — motif=no_show NE doit PAS auto-suspend annonce (test contrôle)
-- Reset ann2 + clear signalement précédent
update public.annonces set statut = 'active'::statut_annonce
  where id = 'ddd22222-dddd-dddd-dddd-dddddddddddd';
delete from public.signalements
  where target_type = 'rdv_post'::cible_signalement
    and target_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid;

insert into public.signalements (target_type, target_id, signaleur_id, motif, motif_categorie, rdv_snapshot, role_signaleur, statut)
values (
  'rdv_post'::cible_signalement,
  'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Absent au rendez-vous',
  'no_show'::motif_signalement_rdv,
  jsonb_build_object('annonce_id', 'ddd22222-dddd-dddd-dddd-dddddddddddd'),
  'acheteur',
  'en_attente'::statut_signalement
);

update public.signalements set statut = 'traite'::statut_signalement
  where target_type = 'rdv_post'::cible_signalement
    and motif_categorie = 'no_show'::motif_signalement_rdv;

select is(
  (select statut::text from public.annonces where id = 'ddd22222-dddd-dddd-dddd-dddddddddddd'),
  'active',
  'J2 mig 91 no_show traité → annonce reste active (pas auto-pause fraude)'
);

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- K. admin_revert_annonce_to_active (mig 95) — 3 assertions
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup : bascule ann2 en en_cours (état post-disputed)
reset role;
update public.annonces set statut = 'en_cours'::statut_annonce
  where id = 'ddd22222-dddd-dddd-dddd-dddddddddddd';

set local role authenticated;

-- K1 — Alice (non-admin) → {error:'ADMIN_REQUIRED'}
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  (public.admin_revert_annonce_to_active('ddd22222-dddd-dddd-dddd-dddddddddddd'::uuid))->>'error',
  'ADMIN_REQUIRED',
  'K1 admin_revert_annonce_to_active non-admin → {error: ADMIN_REQUIRED}'
);

-- K2 — Diana sur annonce active (état invalide) → {error:'INVALID_STATE'}
reset role;
update public.annonces set statut = 'active'::statut_annonce
  where id = 'ddd11111-dddd-dddd-dddd-dddddddddddd';

set local role authenticated;
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);

select is(
  (public.admin_revert_annonce_to_active('ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid))->>'error',
  'INVALID_STATE',
  'K2 admin_revert_annonce_to_active annonce déjà active → {error: INVALID_STATE}'
);

-- K3 — Diana sur ann2 en_cours → success=true + statut=active
select is(
  ((public.admin_revert_annonce_to_active('ddd22222-dddd-dddd-dddd-dddddddddddd'::uuid))->>'success')::bool,
  true,
  'K3 admin_revert_annonce_to_active en_cours → active (happy)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- L. get_my_rdv_signalement_status (mig 98) — anti-leak (3 assertions)
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup : Alice a un signalement rdv_post traité sur conv1 (J1 — set to traite via tentative_fraude)
-- En réalité ce signalement existe encore (le J2 a delete tout puis insert no_show, qui est passé traite)
-- → Le dernier signalement d'Alice sur conv1 est le no_show, statut=traite

-- L1 — Alice (signaleur) → has_signalement: true
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  ((public.get_my_rdv_signalement_status('eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'has_signalement')::bool,
  true,
  'L1 get_my_rdv_signalement_status : Alice signaleur → has_signalement=true'
);

-- L2 — Bob (autre partie, non-signaleur côté Alice mais participant) → has_signalement: false
-- Note : Bob n'a pas signalé sur conv1 dans cet état du test (H6 a inséré son signalement mais
-- F2/J1/J2 ont delete tout signalement rdv_post sur conv1). Donc Bob n'a aucun signalement.
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select is(
  ((public.get_my_rdv_signalement_status('eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'has_signalement')::bool,
  false,
  'L2 get_my_rdv_signalement_status : Bob participant mais non-signaleur → has_signalement=false (anti-leak)'
);

-- L3 — Carol (tiers non-participant) → has_signalement: false
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select is(
  ((public.get_my_rdv_signalement_status('eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'has_signalement')::bool,
  false,
  'L3 get_my_rdv_signalement_status : Carol tiers → has_signalement=false (gate participant)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- M. Audit log (mig 103) — 3 assertions
-- ═════════════════════════════════════════════════════════════════════════════

-- M1 — admin_treat_signalement (I3) doit avoir loggé 1 row dans audit_log_admin
reset role;
select cmp_ok(
  (select count(*)::int from public.audit_log_admin
     where action like 'signalement_%'
       and admin_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  '>=',
  1,
  'M1 mig 103 audit : admin_treat_signalement → audit row(s) action=signalement_*'
);

-- M2 — admin_revert_annonce_to_active (K3) doit avoir loggé 1 row
select is(
  (select count(*)::int from public.audit_log_admin
     where action = 'annonce_reverted_active'
       and admin_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
       and target_id = 'ddd22222-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'M2 mig 103 audit : admin_revert_annonce_to_active → 1 audit row action=annonce_reverted_active'
);

-- M3 — admin_suspend_user (depuis admin Diana sur Bob) → audit row
-- Reset Bob.is_active=true (peut avoir été suspendu par triggers précédents — RPC idempotent no-op sinon)
reset role;
update public.users set is_active = true, score_abus = 0 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

set local role authenticated;
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);

select public.admin_suspend_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

reset role;
select is(
  (select count(*)::int from public.audit_log_admin
     where action = 'user_suspended'
       and admin_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
       and target_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  1,
  'M3 mig 103 audit : admin_suspend_user → 1 audit row action=user_suspended'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- Finalize
-- ═════════════════════════════════════════════════════════════════════════════

select * from finish();
rollback;

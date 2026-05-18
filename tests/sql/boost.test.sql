-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Boost (F09) — couverture complète
--
-- Couvre :
--   A. apply_boost : 8 gates + happy path + atomic claim (PAIEMENT_ALREADY_USED)
--   B. Cumul boost : prolongation correcte
--   C. purge_expired_boosts : flip is_boosted=false sur boost_until < now()
--   D. dashboard_stats.annonces.boosted breakdown (mig 61)
--   E. RLS paiements_niqo : SELECT own, pas de cross-user
--   F. Trigger fn_scrub_pawapay_metadata (mig 77 §D) : phoneNumber redacté
--
-- Cf. docs/backend/boost.md pour le module complet.
-- Migs couvertes : 43, 60, 61, 62, 63, 77, 94.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(23);

-- ─── Setup users ──────────────────────────────────────────────────────────────
-- Alice & Bob (utilisateurs) + Dom (admin)

do $$
declare
  v_alice uuid := '11111111-bbbb-bbbb-bbbb-111111111111';
  v_bob   uuid := '22222222-bbbb-bbbb-bbbb-222222222222';
  v_dom   uuid := '33333333-bbbb-bbbb-bbbb-333333333333';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_alice, 'alice-boost@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Boost','pays','CI','telephone','+2250700001111','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_bob,   'bob-boost@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Boost','pays','CI','telephone','+2250700002222','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_dom,   'dom-boost@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Dom','nom','Admin','pays','CI','telephone','+2250700003333','auth_provider','email'),
     '{}'::jsonb, now());
  update public.users set is_admin = true where id = v_dom;
end $$;

-- ─── Setup annonces ───────────────────────────────────────────────────────────
-- Alice possède 2 annonces actives (a1, a2) + Bob 1 annonce (b1).
-- + 1 annonce d'Alice marquée 'vendue' (a3) pour tester ANNONCE_INVALID.

insert into public.annonces (id, vendeur_id, titre, description, prix, ville, pays, etat, statut, expires_at, categorie_id)
values
  ('aaaaaaaa-bbbb-1111-1111-111111111111'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid,
   'Annonce Alice 1', 'Test boost 1', 30000, 'Abidjan', 'CI', 'bon', 'active',
   now() + interval '60 days', (select id from public.categories order by ordre asc limit 1)),
  ('aaaaaaaa-bbbb-2222-2222-222222222222'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid,
   'Annonce Alice 2', 'Test boost 2', 50000, 'Abidjan', 'CI', 'bon', 'active',
   now() + interval '60 days', (select id from public.categories order by ordre asc limit 1)),
  ('aaaaaaaa-bbbb-3333-3333-333333333333'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid,
   'Annonce Alice 3 vendue', 'Test ANNONCE_INVALID', 20000, 'Abidjan', 'CI', 'bon', 'vendue',
   now() + interval '60 days', (select id from public.categories order by ordre asc limit 1)),
  ('bbbbbbbb-bbbb-1111-1111-111111111111'::uuid, '22222222-bbbb-bbbb-bbbb-222222222222'::uuid,
   'Annonce Bob 1', 'Test boost cross-user', 15000, 'Abidjan', 'CI', 'bon', 'active',
   now() + interval '60 days', (select id from public.categories order by ordre asc limit 1));

-- ─── Setup paiements ──────────────────────────────────────────────────────────
-- 8 paiements Alice + 1 Bob couvrant tous les cas :
--   p_a_ok1   : boost 1000 completed → annonce a1 — happy path 7j
--   p_a_ok2   : boost 1000 completed → annonce a1 — cumul +7j sur a1
--   p_a_ok3   : boost 1000 completed → annonce a3 — ANNONCE_INVALID (a3 vendue)
--   p_a_pending : boost 1000 pending → INVALID_PAIEMENT (statut)
--   p_a_verif   : verification 1000 completed → INVALID_PAIEMENT (type)
--   p_a_null    : boost 1000 completed, target_id=null → PAIEMENT_TARGET_MISSING
--   p_a_mismatch : boost 1000 completed → annonce a2 (mais on appellera sur a1) → MISMATCH
--   p_a_500     : boost 500 completed → annonce a1 → INVALID_PRICE
--   p_b_ok    : boost 1000 completed Bob → annonce b1 (pour cross-user)

insert into public.paiements_niqo (id, user_id, type, target_id, montant_fcfa, statut, completed_at)
values
  ('00000001-bbbb-bbbb-bbbb-000000000001'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'boost',        'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid, 1000, 'completed', now()),
  ('00000002-bbbb-bbbb-bbbb-000000000002'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'boost',        'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid, 1000, 'completed', now()),
  ('00000003-bbbb-bbbb-bbbb-000000000003'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'boost',        'aaaaaaaa-bbbb-3333-3333-333333333333'::uuid, 1000, 'completed', now()),
  ('00000004-bbbb-bbbb-bbbb-000000000004'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'boost',        'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid, 1000, 'pending',   null),
  ('00000005-bbbb-bbbb-bbbb-000000000005'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'verification', null,                                         1000, 'completed', now()),
  ('00000006-bbbb-bbbb-bbbb-000000000006'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'boost',        null,                                         1000, 'completed', now()),
  ('00000007-bbbb-bbbb-bbbb-000000000007'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'boost',        'aaaaaaaa-bbbb-2222-2222-222222222222'::uuid, 1000, 'completed', now()),
  ('00000008-bbbb-bbbb-bbbb-000000000008'::uuid, '11111111-bbbb-bbbb-bbbb-111111111111'::uuid, 'boost',        'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,  500, 'completed', now()),
  ('00000009-bbbb-bbbb-bbbb-000000000009'::uuid, '22222222-bbbb-bbbb-bbbb-222222222222'::uuid, 'boost',        'bbbbbbbb-bbbb-1111-1111-111111111111'::uuid, 1000, 'completed', now());


-- ═════════════════════════════════════════════════════════════════════════════
-- A. apply_boost gates + happy path
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 1 : AUTH_REQUIRED — pas de JWT
select set_config('request.jwt.claims', null, true);

select throws_ok(
  $$ select public.apply_boost(
       '00000001-bbbb-bbbb-bbbb-000000000001'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0001',
  'AUTH_REQUIRED',
  'apply_boost raise AUTH_REQUIRED si auth.uid() null'
);

-- Switch JWT à Alice
select tests.set_jwt_for('11111111-bbbb-bbbb-bbbb-111111111111'::uuid);

-- Test 2 : INVALID_DURATION — 5j n'est pas dans (7, 30)
select throws_ok(
  $$ select public.apply_boost(
       '00000001-bbbb-bbbb-bbbb-000000000001'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       5
     ) $$,
  'P0002',
  'INVALID_DURATION',
  'apply_boost raise INVALID_DURATION si p_duration_days not in (7,30)'
);

-- Test 3 : INVALID_PAIEMENT — paiement uuid inexistant
select throws_ok(
  $$ select public.apply_boost(
       'deadbeef-dead-dead-dead-deaddeaddead'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0003',
  'INVALID_PAIEMENT',
  'apply_boost raise INVALID_PAIEMENT si paiement introuvable'
);

-- Test 4 : INVALID_PAIEMENT — paiement de Bob (Alice JWT)
select throws_ok(
  $$ select public.apply_boost(
       '00000009-bbbb-bbbb-bbbb-000000000009'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0003',
  'INVALID_PAIEMENT',
  'apply_boost raise INVALID_PAIEMENT si paiement appartient à un autre user'
);

-- Test 5 : INVALID_PAIEMENT — type = verification (pas boost)
select throws_ok(
  $$ select public.apply_boost(
       '00000005-bbbb-bbbb-bbbb-000000000005'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0003',
  'INVALID_PAIEMENT',
  'apply_boost raise INVALID_PAIEMENT si paiement type<>boost'
);

-- Test 6 : INVALID_PAIEMENT — statut = pending
select throws_ok(
  $$ select public.apply_boost(
       '00000004-bbbb-bbbb-bbbb-000000000004'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0003',
  'INVALID_PAIEMENT',
  'apply_boost raise INVALID_PAIEMENT si statut<>completed'
);

-- Test 7 : PAIEMENT_TARGET_MISSING — target_id null sur paiement boost
select throws_ok(
  $$ select public.apply_boost(
       '00000006-bbbb-bbbb-bbbb-000000000006'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0007',
  'PAIEMENT_TARGET_MISSING',
  'apply_boost raise PAIEMENT_TARGET_MISSING si target_id null (mig 63)'
);

-- Test 8 : PAIEMENT_TARGET_MISMATCH — target_id pointe vers a2, on tente a1
select throws_ok(
  $$ select public.apply_boost(
       '00000007-bbbb-bbbb-bbbb-000000000007'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0006',
  'PAIEMENT_TARGET_MISMATCH',
  'apply_boost raise PAIEMENT_TARGET_MISMATCH si target_id<>p_annonce_id (mig 62)'
);

-- Test 9 : INVALID_PRICE — montant 500 pour 7j (tarif officiel 1000)
select throws_ok(
  $$ select public.apply_boost(
       '00000008-bbbb-bbbb-bbbb-000000000008'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0008',
  'INVALID_PRICE',
  'apply_boost raise INVALID_PRICE si montant_fcfa<>tarif officiel (mig 63)'
);

-- Test 10 : Happy path 7j — retourne timestamptz ~ now()+7j
select cmp_ok(
  public.apply_boost(
    '00000001-bbbb-bbbb-bbbb-000000000001'::uuid,
    'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
    7
  ),
  '>',
  now() + interval '6 days',
  'apply_boost happy path 7j retourne boost_until > now()+6j'
);

-- Test 11 : PAIEMENT_ALREADY_USED — atomic claim — re-utiliser le même paiement
-- (le paiement_a_ok1 a été consommé au test 10 hors savepoint)
select throws_ok(
  $$ select public.apply_boost(
       '00000001-bbbb-bbbb-bbbb-000000000001'::uuid,
       'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
       7
     ) $$,
  'P0004',
  'PAIEMENT_ALREADY_USED',
  'apply_boost raise PAIEMENT_ALREADY_USED sur 2e appel (atomic claim mig 63)'
);

-- Test 12 : ANNONCE_INVALID — annonce a3 statut='vendue'
select throws_ok(
  $$ select public.apply_boost(
       '00000003-bbbb-bbbb-bbbb-000000000003'::uuid,
       'aaaaaaaa-bbbb-3333-3333-333333333333'::uuid,
       7
     ) $$,
  'P0005',
  'ANNONCE_INVALID',
  'apply_boost raise ANNONCE_INVALID si annonce statut<>active'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- B. Cumul boost
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 13 : Cumul 7j sur 7j → boost_until ≈ now()+14j (greatest(boost_until, now())+N)
-- Le paiement_a_ok2 est encore consommable (target_id = a1)
select cmp_ok(
  public.apply_boost(
    '00000002-bbbb-bbbb-bbbb-000000000002'::uuid,
    'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid,
    7
  ),
  '>',
  now() + interval '13 days',
  'apply_boost cumul 7j+7j → boost_until > now()+13j'
);

-- Test 14 : et < 15 days (sanity upper bound)
select cmp_ok(
  (select boost_until from public.annonces where id = 'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid),
  '<',
  now() + interval '15 days',
  'apply_boost cumul 7j+7j → boost_until < now()+15j (pas de cumul double)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- C. purge_expired_boosts
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup : force annonce a2 dans un état boosté EXPIRÉ (boost_until passé)
-- + annonce a1 reste boostée active (test 13 a posé boost_until = now()+14j)
update public.annonces
   set is_boosted = true, boost_until = now() - interval '1 hour'
 where id = 'aaaaaaaa-bbbb-2222-2222-222222222222'::uuid;

-- Test 15 : purge retourne le count des boosts purgés (>=1)
select cmp_ok(
  public.purge_expired_boosts(),
  '>=',
  1,
  'purge_expired_boosts retourne >=1 (a2 expirée + éventuels autres)'
);

-- Test 16 : a2 a is_boosted=false après purge
select is(
  (select is_boosted from public.annonces where id = 'aaaaaaaa-bbbb-2222-2222-222222222222'::uuid),
  false,
  'purge_expired_boosts flippe is_boosted=false sur annonce expirée'
);

-- Test 17 : a1 reste is_boosted=true (boost_until = now()+14j)
select is(
  (select is_boosted from public.annonces where id = 'aaaaaaaa-bbbb-1111-1111-111111111111'::uuid),
  true,
  'purge_expired_boosts ne touche pas les annonces avec boost_until > now()'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- D. get_my_dashboard_stats.annonces.boosted (mig 61)
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 18 : Le breakdown remonte 1 annonce boostée pour Alice (a1 est encore boostée)
select tests.set_jwt_for('11111111-bbbb-bbbb-bbbb-111111111111'::uuid);

select is(
  (public.get_my_dashboard_stats() -> 'annonces' ->> 'boosted')::int,
  1,
  'get_my_dashboard_stats.annonces.boosted = 1 (a1 boostée active)'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- E. RLS paiements_niqo
-- ═════════════════════════════════════════════════════════════════════════════

set local role authenticated;

-- Test 19 : Alice voit ses propres paiements (au moins les 8 setup)
select tests.set_jwt_for('11111111-bbbb-bbbb-bbbb-111111111111'::uuid);

select cmp_ok(
  (select count(*)::int from public.paiements_niqo where user_id = '11111111-bbbb-bbbb-bbbb-111111111111'::uuid),
  '>=',
  8,
  'RLS paiements_select_own : Alice voit ses ≥8 paiements'
);

-- Test 20 : Bob ne voit pas les paiements d'Alice
select tests.set_jwt_for('22222222-bbbb-bbbb-bbbb-222222222222'::uuid);

select is(
  (select count(*)::int from public.paiements_niqo where user_id = '11111111-bbbb-bbbb-bbbb-111111111111'::uuid),
  0,
  'RLS paiements_select_own : Bob ne voit pas les paiements d''Alice'
);

reset role;


-- ═════════════════════════════════════════════════════════════════════════════
-- F. Trigger fn_scrub_pawapay_metadata (mig 77 §D)
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 21 : payer.accountDetails.phoneNumber → redacted
insert into public.paiements_niqo (id, user_id, type, target_id, montant_fcfa, statut, pawapay_metadata)
values (
  '77777777-bbbb-bbbb-bbbb-777777777777'::uuid,
  '11111111-bbbb-bbbb-bbbb-111111111111'::uuid,
  'boost',
  'aaaaaaaa-bbbb-2222-2222-222222222222'::uuid,
  1000,
  'pending',
  jsonb_build_object(
    'payer', jsonb_build_object(
      'accountDetails', jsonb_build_object('phoneNumber', '+22507000999')
    )
  )
);

select is(
  (select pawapay_metadata #>> '{payer,accountDetails,phoneNumber}'
     from public.paiements_niqo where id = '77777777-bbbb-bbbb-bbbb-777777777777'::uuid),
  '[redacted]',
  'fn_scrub_pawapay_metadata : payer.accountDetails.phoneNumber → [redacted]'
);

-- Test 22 : payee.accountDetails.phoneNumber → redacted (à l'update)
update public.paiements_niqo
   set pawapay_metadata = jsonb_build_object(
     'payee', jsonb_build_object(
       'accountDetails', jsonb_build_object('phoneNumber', '+22507111888')
     )
   )
 where id = '77777777-bbbb-bbbb-bbbb-777777777777'::uuid;

select is(
  (select pawapay_metadata #>> '{payee,accountDetails,phoneNumber}'
     from public.paiements_niqo where id = '77777777-bbbb-bbbb-bbbb-777777777777'::uuid),
  '[redacted]',
  'fn_scrub_pawapay_metadata : payee.accountDetails.phoneNumber → [redacted] (update)'
);

-- Test 23 : metadata array avec fieldName phoneNumber → redacted
update public.paiements_niqo
   set pawapay_metadata = jsonb_build_object(
     'metadata', jsonb_build_array(
       jsonb_build_object('fieldName', 'phoneNumber', 'fieldValue', '+22507222777'),
       jsonb_build_object('fieldName', 'orderId', 'fieldValue', 'ORDER-123')
     )
   )
 where id = '77777777-bbbb-bbbb-bbbb-777777777777'::uuid;

select is(
  (select pawapay_metadata #> '{metadata,0,fieldValue}'
     from public.paiements_niqo where id = '77777777-bbbb-bbbb-bbbb-777777777777'::uuid),
  '"[redacted]"'::jsonb,
  'fn_scrub_pawapay_metadata : metadata array phoneNumber fieldName → fieldValue redacted (orderId préservé)'
);


select * from finish();
rollback;

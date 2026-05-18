-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module KYC (vérification d'identité) — couverture complète
--
-- Couvre :
--   A. submit_verification : 7 gates + happy path
--   B. admin_validate_verification : 8 gates + happy paths approve/reject
--   C. Trigger fn_verif_on_approve : badge users.is_verified + verification_paid_at
--   D. CHECK constraints : verif_rejected_needs_reason, verif_numero_cni_format
--   E. RLS verifications_identite : SELECT own + SELECT admin
--   F. Cron purge_expired_kyc_verifications : 3 branches (rejected/verified/pending)
--   G. Trigger trg_purge_cni_storage : BEFORE DELETE purge Storage
--
-- Cf. docs/backend/kyc.md pour le module complet.
-- Migs couvertes : 43, 45, 46, 47, 48, 50, 52, 54, 55, 65, 72, 73, 75, 85, 94, 103.
-- Note : l'audit log mig 103 (`kyc_verified` / `kyc_rejected`) est testé dans
-- tests/sql/audit.test.sql — pas dupliqué ici.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(34);

-- ─── Setup users ──────────────────────────────────────────────────────────────
-- Alice & Bob (utilisateurs) + Dom (admin)

do $$
declare
  v_alice uuid := '11111111-aaaa-aaaa-aaaa-111111111111';
  v_bob   uuid := '22222222-bbbb-bbbb-bbbb-222222222222';
  v_dom   uuid := '33333333-dddd-dddd-dddd-333333333333';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_alice, 'alice-kyc@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Kyc','pays','CI','telephone','+2250700001111','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_bob,   'bob-kyc@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Kyc','pays','CI','telephone','+2250700002222','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_dom,   'dom-kyc@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Dom','nom','Admin','pays','CI','telephone','+2250700003333','auth_provider','email'),
     '{}'::jsonb, now());
  update public.users set is_admin = true where id = v_dom;
end $$;

-- ─── Setup paiements ──────────────────────────────────────────────────────────
-- 4 paiements pour couvrir tous les cas :
--   - p_alice_completed : completed, type=verification → happy path
--   - p_alice_pending   : pending → gate INVALID_PAIEMENT
--   - p_alice_boost     : completed mais type=boost → gate INVALID_PAIEMENT
--   - p_bob_completed   : completed, type=verification → pour Bob

insert into public.paiements_niqo (id, user_id, type, montant_fcfa, statut, completed_at)
values
  ('aaaa1111-1111-1111-1111-111111111111'::uuid, '11111111-aaaa-aaaa-aaaa-111111111111'::uuid, 'verification', 1000, 'completed', now()),
  ('aaaa2222-2222-2222-2222-222222222222'::uuid, '11111111-aaaa-aaaa-aaaa-111111111111'::uuid, 'verification', 1000, 'pending',   null),
  ('aaaa3333-3333-3333-3333-333333333333'::uuid, '11111111-aaaa-aaaa-aaaa-111111111111'::uuid, 'boost',        1000, 'completed', now()),
  ('bbbb2222-2222-2222-2222-222222222222'::uuid, '22222222-bbbb-bbbb-bbbb-222222222222'::uuid, 'verification', 1000, 'completed', now());


-- ═════════════════════════════════════════════════════════════════════════════
-- A. submit_verification : gates + happy path
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 1 : AUTH_REQUIRED — pas de JWT (claims null → auth.uid() retourne null)
select set_config('request.jwt.claims', null, true);

select throws_ok(
  $$ select public.submit_verification(
       'aaaa1111-1111-1111-1111-111111111111'::uuid,
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/recto.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/verso.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/selfie.jpg',
       'v1.1'
     ) $$,
  'P0001',
  'AUTH_REQUIRED',
  'submit_verification raise AUTH_REQUIRED si auth.uid() null'
);

-- Switch JWT à Alice pour les tests suivants
select tests.set_jwt_for('11111111-aaaa-aaaa-aaaa-111111111111'::uuid);

-- Test 2 : INVALID_PAIEMENT — paiement pending (pas completed)
select throws_ok(
  $$ select public.submit_verification(
       'aaaa2222-2222-2222-2222-222222222222'::uuid,
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/recto.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/verso.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/selfie.jpg',
       'v1.1'
     ) $$,
  'P0002',
  'INVALID_PAIEMENT',
  'submit_verification raise INVALID_PAIEMENT si paiement pending'
);

-- Test 3 : INVALID_PAIEMENT — paiement type=boost (pas verification)
select throws_ok(
  $$ select public.submit_verification(
       'aaaa3333-3333-3333-3333-333333333333'::uuid,
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/recto.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/verso.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/selfie.jpg',
       'v1.1'
     ) $$,
  'P0002',
  'INVALID_PAIEMENT',
  'submit_verification raise INVALID_PAIEMENT si paiement type<>verification'
);

-- Test 4 : INVALID_PAIEMENT — paiement d'un autre user (Bob's paiement, Alice's JWT)
select throws_ok(
  $$ select public.submit_verification(
       'bbbb2222-2222-2222-2222-222222222222'::uuid,
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/recto.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/verso.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/selfie.jpg',
       'v1.1'
     ) $$,
  'P0002',
  'INVALID_PAIEMENT',
  'submit_verification raise INVALID_PAIEMENT si paiement appartient à un autre user'
);

-- Test 5 : INVALID_PATH_OWNERSHIP — path[1] != caller uid
select throws_ok(
  $$ select public.submit_verification(
       'aaaa1111-1111-1111-1111-111111111111'::uuid,
       '22222222-bbbb-bbbb-bbbb-222222222222/v1/recto.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/verso.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/selfie.jpg',
       'v1.1'
     ) $$,
  'P0005',
  'INVALID_PATH_OWNERSHIP',
  'submit_verification raise INVALID_PATH_OWNERSHIP si path ne commence pas par caller uid'
);

-- Test 6 : INVALID_CONSENT_VERSION — version hors whitelist
select throws_ok(
  $$ select public.submit_verification(
       'aaaa1111-1111-1111-1111-111111111111'::uuid,
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/recto.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/verso.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v1/selfie.jpg',
       'v9.9'
     ) $$,
  'P0006',
  'INVALID_CONSENT_VERSION',
  'submit_verification raise INVALID_CONSENT_VERSION pour version hors whitelist'
);

-- Test 7 : Happy path Alice → retourne un uuid + crée la row pending
select isnt(
  public.submit_verification(
    'aaaa1111-1111-1111-1111-111111111111'::uuid,
    '11111111-aaaa-aaaa-aaaa-111111111111/v1/recto.jpg',
    '11111111-aaaa-aaaa-aaaa-111111111111/v1/verso.jpg',
    '11111111-aaaa-aaaa-aaaa-111111111111/v1/selfie.jpg',
    'v1.1'
  ),
  null,
  'submit_verification happy path retourne un uuid'
);

-- Test 8 : Row Alice insérée avec statut=pending
select is(
  (select statut::text from public.verifications_identite
    where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid
    order by created_at desc limit 1),
  'pending',
  'submit_verification crée la row avec statut=pending'
);

-- Test 9 : PAIEMENT_ALREADY_USED — resubmit avec même paiement
select throws_ok(
  $$ select public.submit_verification(
       'aaaa1111-1111-1111-1111-111111111111'::uuid,
       '11111111-aaaa-aaaa-aaaa-111111111111/v2/recto.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v2/verso.jpg',
       '11111111-aaaa-aaaa-aaaa-111111111111/v2/selfie.jpg',
       'v1.1'
     ) $$,
  'P0003',
  'PAIEMENT_ALREADY_USED',
  'submit_verification raise PAIEMENT_ALREADY_USED si paiement déjà consommé'
);

-- Test 10 : VERIFICATION_ALREADY_PENDING — Bob soumet, puis re-soumet → fail.
-- Setup côté Bob : 2 paiements completed distincts.
insert into public.paiements_niqo (id, user_id, type, montant_fcfa, statut, completed_at)
values
  ('bbbb3333-3333-3333-3333-333333333333'::uuid, '22222222-bbbb-bbbb-bbbb-222222222222'::uuid, 'verification', 1000, 'completed', now());

select tests.set_jwt_for('22222222-bbbb-bbbb-bbbb-222222222222'::uuid);

-- Bob soumet 1ère verif (consomme bbbb2222) — setup pour le gate suivant
select isnt(
  public.submit_verification(
    'bbbb2222-2222-2222-2222-222222222222'::uuid,
    '22222222-bbbb-bbbb-bbbb-222222222222/v1/recto.jpg',
    '22222222-bbbb-bbbb-bbbb-222222222222/v1/verso.jpg',
    '22222222-bbbb-bbbb-bbbb-222222222222/v1/selfie.jpg',
    'v1.1'
  ),
  null,
  'submit_verification Bob #1 OK (setup gate VERIFICATION_ALREADY_PENDING)'
);

-- Bob soumet 2e verif (autre paiement) → bloqué par pending existante
select throws_ok(
  $$ select public.submit_verification(
       'bbbb3333-3333-3333-3333-333333333333'::uuid,
       '22222222-bbbb-bbbb-bbbb-222222222222/v2/recto.jpg',
       '22222222-bbbb-bbbb-bbbb-222222222222/v2/verso.jpg',
       '22222222-bbbb-bbbb-bbbb-222222222222/v2/selfie.jpg',
       'v1.1'
     ) $$,
  'P0004',
  'VERIFICATION_ALREADY_PENDING',
  'submit_verification raise VERIFICATION_ALREADY_PENDING si row pending déjà existante'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- B. admin_validate_verification : gates + happy paths approve/reject
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 11 : ADMIN_REQUIRED — Bob (non-admin) tente de valider
select tests.set_jwt_for('22222222-bbbb-bbbb-bbbb-222222222222'::uuid);
select throws_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
       true,
       null,
       'CI123456789012'
     ) $$,
  'P0010',
  'ADMIN_REQUIRED',
  'admin_validate_verification raise ADMIN_REQUIRED si caller non admin'
);

-- Switch à Dom (admin) pour les tests suivants
select tests.set_jwt_for('33333333-dddd-dddd-dddd-333333333333'::uuid);

-- Test 12 : NUMERO_CNI_REQUIRED si approved sans p_numero_cni
select throws_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
       true,
       null,
       null
     ) $$,
  'P0014',
  'NUMERO_CNI_REQUIRED',
  'mig 85 — NUMERO_CNI_REQUIRED si approved sans p_numero_cni'
);

-- Test 13 : NUMERO_CNI_INVALID si format hors regex
select throws_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
       true,
       null,
       'abc!'
     ) $$,
  'P0015',
  'NUMERO_CNI_INVALID',
  'mig 85 — NUMERO_CNI_INVALID si format hors ^[A-Z0-9 \-]{4,20}$'
);

-- Test 14 : REJECT_REASON_REQUIRED si reject avec raison < 5 chars
select throws_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
       false,
       'abc',
       null
     ) $$,
  'P0011',
  'REJECT_REASON_REQUIRED',
  'admin_validate_verification raise REJECT_REASON_REQUIRED si reject avec raison < 5 chars'
);

-- Test 15 : Happy path approve Alice avec numero raw → trim+upper appliqué
select lives_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
       true,
       null,
       '  ci123456789012  '
     ) $$,
  'admin_validate_verification approve happy path avec numero raw'
);

-- Test 16 : numero_cni est trim+upper avant persist
select is(
  (select numero_cni from public.verifications_identite
    where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
  'CI123456789012',
  'mig 85 — numero_cni est trim+upper avant persist'
);

-- Test 17 : Row Alice statut → verified
select is(
  (select statut::text from public.verifications_identite
    where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
  'verified',
  'admin_validate_verification(approved=true) → statut=verified'
);

-- Test 18 : CNI_ALREADY_USED — Bob (autre user) tente valider avec MÊME numéro
select throws_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '22222222-bbbb-bbbb-bbbb-222222222222'::uuid limit 1),
       true,
       null,
       'CI123456789012'
     ) $$,
  'P0013',
  'CNI_ALREADY_USED',
  'mig 85 — CNI_ALREADY_USED si numero_cni déjà sur une verification verified'
);

-- Test 19 : VERIFICATION_NOT_PENDING — Alice déjà verified → 2e validate fail
select throws_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid limit 1),
       true,
       null,
       'CI999999999991'
     ) $$,
  'P0012',
  'VERIFICATION_NOT_PENDING',
  'admin_validate_verification raise VERIFICATION_NOT_PENDING si row déjà décidée'
);

-- Test 20 : Happy path REJECT Bob (CNI_ALREADY_USED gate ne fire QUE si approve)
select lives_ok(
  $$ select public.admin_validate_verification(
       (select id from public.verifications_identite where user_id = '22222222-bbbb-bbbb-bbbb-222222222222'::uuid limit 1),
       false,
       'Selfie illisible, recommence avec meilleure lumiere',
       null
     ) $$,
  'admin_validate_verification reject happy path avec raison >= 5 chars'
);

-- Test 21 : Bob row → reject_reason persisté
select is(
  (select reject_reason from public.verifications_identite
    where user_id = '22222222-bbbb-bbbb-bbbb-222222222222'::uuid limit 1),
  'Selfie illisible, recommence avec meilleure lumiere',
  'admin_validate_verification(approved=false) persiste reject_reason'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- C. Trigger fn_verif_on_approve : badge users.is_verified + verification_paid_at
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 22 : Alice → users.is_verified = true post-validation
select is(
  (select is_verified from public.users where id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid),
  true,
  'trigger fn_verif_on_approve set users.is_verified=true après approve'
);

-- Test 23 : Alice → users.verification_paid_at non-null
select isnt(
  (select verification_paid_at from public.users where id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid),
  null,
  'trigger fn_verif_on_approve set users.verification_paid_at non-null'
);

-- Test 24 : Bob → users.is_verified reste false (refus n'active pas le badge)
select is(
  (select is_verified from public.users where id = '22222222-bbbb-bbbb-bbbb-222222222222'::uuid),
  false,
  'trigger fn_verif_on_approve ne touche pas users.is_verified après reject'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- D. CHECK constraints
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 25 : CHECK verif_rejected_needs_reason : rejected sans reason fail
-- Reset role pour bypass RLS (test des CHECK directs).
reset role;
select throws_ok(
  $$ insert into public.verifications_identite
       (user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut, reviewed_at, reviewed_by)
     values
       ('11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
        'aaaa1111-1111-1111-1111-111111111111'::uuid,
        'a','b','c',
        'rejected','2026-01-01'::timestamptz,
        '33333333-dddd-dddd-dddd-333333333333'::uuid) $$,
  '23514',
  null,
  'CHECK verif_rejected_needs_reason : rejected sans reason fail'
);

-- Test 26 : CHECK verif_numero_cni_format — caractères interdits
select throws_ok(
  $$ insert into public.verifications_identite
       (user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut, numero_cni)
     values
       ('11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
        'aaaa1111-1111-1111-1111-111111111111'::uuid,
        'a','b','c','pending','ABC!@#') $$,
  '23514',
  null,
  'mig 85 — CHECK verif_numero_cni_format rejette les caractères hors regex'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- E. RLS verifications_identite : SELECT own + admin
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 27 : Alice voit sa propre verif (SELECT own)
set role authenticated;
select tests.set_jwt_for('11111111-aaaa-aaaa-aaaa-111111111111'::uuid);

select is(
  (select count(*)::int from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid),
  1,
  'RLS verif_select_own : Alice voit sa propre verif (1 row)'
);

-- Test 28 : Bob ne voit PAS la verif d'Alice
select tests.set_jwt_for('22222222-bbbb-bbbb-bbbb-222222222222'::uuid);
select is(
  (select count(*)::int from public.verifications_identite where user_id = '11111111-aaaa-aaaa-aaaa-111111111111'::uuid),
  0,
  'RLS verif_select_own : Bob ne voit pas la verif d''Alice (0 rows)'
);

-- Test 29 : Dom (admin) voit toutes les verifs
select tests.set_jwt_for('33333333-dddd-dddd-dddd-333333333333'::uuid);
select cmp_ok(
  (select count(*)::int from public.verifications_identite),
  '>=',
  2,
  'RLS verif_select_admin : Dom (admin) voit toutes les verifs (Alice + Bob)'
);

reset role;


-- ═════════════════════════════════════════════════════════════════════════════
-- F. Cron purge_expired_kyc_verifications : 3 branches
-- ═════════════════════════════════════════════════════════════════════════════
-- Post-mig 110 : la fonction du trigger fait du HTTP fire-and-forget
-- (pas de DELETE SQL direct sur storage.objects), donc pas besoin de
-- stub. Le `net.http_delete` retourne immédiatement avec un request_id ;
-- la réponse Storage arrivera de manière async sans impacter la transaction.

-- Setup 4 rows avec dates :
--   - rejected reviewed_at = -31j  → doit être purgé
--   - verified reviewed_at = -7m   → doit être purgé
--   - pending  created_at  = -61j  → doit être purgé (mig 75)
--   - pending  récente             → doit être conservée

insert into public.paiements_niqo (id, user_id, type, montant_fcfa, statut, completed_at)
values
  ('aaaa4444-4444-4444-4444-444444444444'::uuid, '11111111-aaaa-aaaa-aaaa-111111111111'::uuid, 'verification', 1000, 'completed', now() - interval '40 days'),
  ('aaaa5555-5555-5555-5555-555555555555'::uuid, '11111111-aaaa-aaaa-aaaa-111111111111'::uuid, 'verification', 1000, 'completed', now() - interval '7 months'),
  ('aaaa6666-6666-6666-6666-666666666666'::uuid, '11111111-aaaa-aaaa-aaaa-111111111111'::uuid, 'verification', 1000, 'completed', now() - interval '61 days'),
  ('aaaa7777-7777-7777-7777-777777777777'::uuid, '11111111-aaaa-aaaa-aaaa-111111111111'::uuid, 'verification', 1000, 'completed', now());

insert into public.verifications_identite (id, user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut, reviewed_at, reviewed_by, reject_reason, created_at)
values
  ('11111111-aaaa-eeee-1111-111111111111'::uuid,
   '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
   'aaaa4444-4444-4444-4444-444444444444'::uuid,
   'a','b','c','rejected',
   now() - interval '31 days',
   '33333333-dddd-dddd-dddd-333333333333'::uuid,
   'Old rejection 31d ago',
   now() - interval '40 days');

insert into public.verifications_identite (id, user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut, reviewed_at, reviewed_by, numero_cni, created_at)
values
  ('11111111-aaaa-eeee-2222-111111111111'::uuid,
   '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
   'aaaa5555-5555-5555-5555-555555555555'::uuid,
   'a','b','c','verified',
   now() - interval '7 months',
   '33333333-dddd-dddd-dddd-333333333333'::uuid,
   'CI777777777777',
   now() - interval '8 months');

insert into public.verifications_identite (id, user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut, created_at)
values
  ('11111111-aaaa-eeee-3333-111111111111'::uuid,
   '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
   'aaaa6666-6666-6666-6666-666666666666'::uuid,
   'a','b','c','pending',
   now() - interval '61 days');

insert into public.verifications_identite (id, user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut, created_at)
values
  ('11111111-aaaa-eeee-4444-111111111111'::uuid,
   '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
   'aaaa7777-7777-7777-7777-777777777777'::uuid,
   'a','b','c','pending',
   now());

-- Test 30 : Run cron — retourne >= 3
select cmp_ok(
  public.purge_expired_kyc_verifications(),
  '>=',
  3,
  'purge_expired_kyc_verifications retourne >= 3 (les 3 expirées purgées)'
);

-- Test 31 : Les 3 expirées ont disparu
select is(
  (select count(*)::int from public.verifications_identite
   where id in (
     '11111111-aaaa-eeee-1111-111111111111'::uuid,
     '11111111-aaaa-eeee-2222-111111111111'::uuid,
     '11111111-aaaa-eeee-3333-111111111111'::uuid
   )),
  0,
  'cron purge : les 3 rows expirées (rejected/verified/pending>60j) ont disparu'
);

-- Test 32 : La pending récente est conservée
select is(
  (select count(*)::int from public.verifications_identite
   where id = '11111111-aaaa-eeee-4444-111111111111'::uuid),
  1,
  'cron purge : la pending récente est conservée'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- G. Trigger trg_purge_cni_storage : structure
-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠ Le test fonctionnel "DELETE verif → storage objects purgés" est impossible
-- à exécuter en pgTAP : `storage.protect_objects_delete` (trigger global
-- Supabase) bloque tout `delete from storage.objects` direct, y compris
-- depuis un trigger SECURITY DEFINER en `public`. C'est un finding réel :
-- le trigger mig 54 est cassé en prod aussi. Cf. docs/backend/kyc.md §Known issues.
--
-- À défaut, on vérifie ici que le trigger est wired correctement.

-- Test 33 : Trigger trg_purge_cni_storage existe + BEFORE DELETE sur verifications_identite
select is(
  (select count(*)::int from pg_trigger t
    where t.tgname = 'trg_purge_cni_storage'
      and t.tgrelid = 'public.verifications_identite'::regclass
      and (t.tgtype & 2) = 2  -- BEFORE
      and (t.tgtype & 8) = 8  -- DELETE
      and not t.tgisinternal),
  1,
  'trigger trg_purge_cni_storage wired BEFORE DELETE sur verifications_identite'
);


select * from finish();
rollback;

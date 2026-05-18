-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Audit log admin (mig 103)
--
-- Couvre :
--   - Helper _log_admin_action : no-op si pas de session, insert si admin
--   - RLS : admin SELECT all, non-admin SELECT denied
--   - REVOKE : INSERT direct via authenticated denied
--   - Patch admin_suspend_annonce : 1 ligne audit après succès, 0 après no-op
--   - Patch admin_validate_verification : audit action+metadata correct
--
-- Cf. docs/migrations/103_audit_log_admin.sql.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(11);

-- ─── Setup ───────────────────────────────────────────────────────────────────
do $$
declare
  v_alice uuid := 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  v_dom   uuid := 'dddddddd-2222-2222-2222-dddddddddddd';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_alice, 'alice-audit@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Aud','pays','CI','telephone','+2250700009991','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_dom,   'dom-audit@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Dom','nom','Admin','pays','CI','telephone','+2250700009992','auth_provider','email'),
     '{}'::jsonb, now());
  -- Promote Dom admin
  update public.users set is_admin = true where id = v_dom;
end $$;

-- 1 annonce active d'Alice (pour tester admin_suspend_annonce)
insert into public.annonces (id, vendeur_id, titre, description, prix, ville, pays, etat, statut, expires_at, categorie_id)
values (
  '11111111-aaaa-1111-1111-111111111111'::uuid,
  'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid,
  'Test Phone Audit',
  'Description test pour audit log mig 103',
  50000,
  'Abidjan',
  'CI',
  'bon',
  'active',
  now() + interval '60 days',
  (select id from public.categories order by ordre asc limit 1)
);

-- 1 paiement + 1 verification pending d'Alice (pour tester admin_validate_verification)
insert into public.paiements_niqo (id, user_id, type, montant_fcfa, statut, completed_at)
values ('aaaa9999-1111-1111-1111-111111111111'::uuid,
        'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid,
        'verification', 1000, 'completed', now());

insert into public.verifications_identite (id, user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut)
values ('11111111-aaaa-9999-1111-111111111111'::uuid,
        'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid,
        'aaaa9999-1111-1111-1111-111111111111'::uuid,
        'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa/draft/recto.jpg',
        'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa/draft/verso.jpg',
        'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa/draft/selfie.jpg',
        'pending');

-- ─── Test 1 : _log_admin_action no-op si pas de session ──────────────────────
-- Sans JWT (auth.uid()=null), helper return early → 0 row inserted
select tests.set_jwt_for('00000000-0000-0000-0000-000000000000'::uuid);
-- Reset claim à null
select set_config('request.jwt.claims', null, true);

select public._log_admin_action('test_no_session', 'test', null, '{}'::jsonb);

select is(
  (select count(*)::int from public.audit_log_admin where action = 'test_no_session'),
  0,
  'mig 103 — _log_admin_action no-op si pas de session JWT'
);

-- ─── Test 2 : _log_admin_action insère avec admin_id depuis JWT ──────────────
select tests.set_jwt_for('dddddddd-2222-2222-2222-dddddddddddd'::uuid);

select public._log_admin_action(
  'test_helper_insert',
  'test',
  '11111111-aaaa-1111-1111-111111111111'::uuid,
  jsonb_build_object('foo', 'bar')
);

select is(
  (select count(*)::int from public.audit_log_admin where action = 'test_helper_insert'),
  1,
  'mig 103 — _log_admin_action insère 1 row sous JWT admin'
);

select is(
  (select admin_id from public.audit_log_admin where action = 'test_helper_insert'),
  'dddddddd-2222-2222-2222-dddddddddddd'::uuid,
  'mig 103 — _log_admin_action utilise auth.uid() comme admin_id'
);

select is(
  (select metadata->>'foo' from public.audit_log_admin where action = 'test_helper_insert'),
  'bar',
  'mig 103 — metadata jsonb persisté correctement'
);

-- ─── Test 3 : RLS — admin SELECT voit toutes les rows ────────────────────────
set local role authenticated;
select tests.set_jwt_for('dddddddd-2222-2222-2222-dddddddddddd'::uuid);

select cmp_ok(
  (select count(*)::int from public.audit_log_admin),
  '>=',
  1,
  'mig 103 — RLS admin SELECT voit les rows audit'
);

reset role;

-- ─── Test 4 : RLS — non-admin SELECT bloqué ──────────────────────────────────
set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid);

select is(
  (select count(*)::int from public.audit_log_admin),
  0,
  'mig 103 — RLS non-admin SELECT renvoie 0 (policy is_current_user_admin)'
);

reset role;

-- ─── Test 5 : INSERT direct via authenticated denied (REVOKE) ────────────────
set local role authenticated;
select tests.set_jwt_for('dddddddd-2222-2222-2222-dddddddddddd'::uuid);

select throws_ok(
  $$ insert into public.audit_log_admin (admin_id, action, target_type, target_id, metadata)
     values ('dddddddd-2222-2222-2222-dddddddddddd'::uuid, 'rogue_insert', 'test', null, '{}'::jsonb) $$,
  '42501',  -- insufficient_privilege
  null,
  'mig 103 — INSERT direct via authenticated bloqué par REVOKE (anti-falsification)'
);

reset role;

-- ─── Test 6 : admin_suspend_annonce génère 1 row audit ───────────────────────
select tests.set_jwt_for('dddddddd-2222-2222-2222-dddddddddddd'::uuid);

select public.admin_suspend_annonce('11111111-aaaa-1111-1111-111111111111'::uuid);

select is(
  (select count(*)::int from public.audit_log_admin
    where action = 'annonce_suspended'
      and target_id = '11111111-aaaa-1111-1111-111111111111'::uuid),
  1,
  'mig 103 — admin_suspend_annonce génère 1 row audit avec target_type=annonce'
);

-- ─── Test 7 : 2e appel idempotent → no new audit row ─────────────────────────
-- L'annonce est déjà suspendue → la RPC return tôt, pas de log additionnel
select public.admin_suspend_annonce('11111111-aaaa-1111-1111-111111111111'::uuid);

select is(
  (select count(*)::int from public.audit_log_admin
    where action = 'annonce_suspended'
      and target_id = '11111111-aaaa-1111-1111-111111111111'::uuid),
  1,
  'mig 103 — 2e appel admin_suspend_annonce sur déjà-suspended ne re-log pas'
);

-- ─── Test 8 : admin_validate_verification (approved) ─────────────────────────
select public.admin_validate_verification(
  '11111111-aaaa-9999-1111-111111111111'::uuid,
  true,
  null,
  'CI777777777'
);

select is(
  (select action from public.audit_log_admin
    where target_id = '11111111-aaaa-9999-1111-111111111111'::uuid
    order by created_at desc limit 1),
  'kyc_verified',
  'mig 103 — admin_validate_verification(approved=true) loggue action=kyc_verified'
);

select is(
  (select metadata->>'numero_cni' from public.audit_log_admin
    where target_id = '11111111-aaaa-9999-1111-111111111111'::uuid
    order by created_at desc limit 1),
  'CI777777777',
  'mig 103 — metadata.numero_cni capturé dans audit (validation KYC)'
);

select * from finish();
rollback;

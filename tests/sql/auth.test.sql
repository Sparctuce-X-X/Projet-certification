-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Auth
--
-- Couvre :
--   - Trigger handle_new_user (email signup, OAuth, fallbacks prenom/nom/ville)
--   - Helpers Vault encrypt_phone / decrypt_phone
--   - RPC get_my_phone (gate auth.uid)
--   - RPC complete_my_profile (validation, encryption phone)
--   - RPC delete_my_account (cascade auth + public)
--   - Trigger tg_check_score_abus (auto-suspend ≥3, mig 77 update of is_active)
--   - RPC accept_auth_cgu idempotente
--   - RLS users_own_profile (isolation)
--   - RPC repair_my_profile (idempotente)
--
-- Cf. docs/backend/auth.md pour le module complet.
-- Cf. tests/README.md pour le run command.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(43);

-- ─── Setup helper : insert direct dans auth.users (bypass GoTrue) ────────────
-- On garde un id stable pour pouvoir vérifier les triggers.
-- Le trigger on_auth_user_created fire automatiquement → public.users existe.

-- ─── Test 1 : handle_new_user — email signup happy path ──────────────────────
do $$
declare
  v_uid uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values (
    v_uid,
    'alice-email@niqo.test',
    crypt('pass-test', gen_salt('bf')),
    jsonb_build_object(
      'prenom', 'Alice',
      'nom', 'Dupont',
      'telephone', '+2250700000001',
      'pays', 'CI',
      'ville', 'Yopougon',
      'quartier', 'Niangon',
      'auth_provider', 'email',
      'cgu_accepted_at', '2026-05-08T10:00:00Z',
      'cgu_version', '1.1'
    ),
    '{}'::jsonb,
    now()
  );
end $$;

select is(
  (select prenom from public.users where id = '11111111-1111-1111-1111-111111111111'),
  'Alice',
  'handle_new_user copie prenom depuis raw_user_meta_data'
);

select is(
  (select pays::text from public.users where id = '11111111-1111-1111-1111-111111111111'),
  'CI',
  'handle_new_user copie pays depuis raw_user_meta_data'
);

select is(
  (select auth_provider::text from public.users where id = '11111111-1111-1111-1111-111111111111'),
  'email',
  'handle_new_user pose auth_provider = email'
);

select isnt(
  (select telephone from public.users where id = '11111111-1111-1111-1111-111111111111'),
  null,
  'handle_new_user chiffre le telephone (bytea non null)'
);

select isnt(
  (select cgu_accepted_at from public.users where id = '11111111-1111-1111-1111-111111111111'),
  null,
  'handle_new_user pose cgu_accepted_at (timestamp serveur, mig 21)'
);

-- ─── Test 2 : handle_new_user — OAuth Google (auth_provider depuis raw_app_meta_data) ───
do $$
declare
  v_uid uuid := '22222222-2222-2222-2222-222222222222';
begin
  -- OAuth : pas de auth_provider dans raw_user_meta_data, mais 'provider' dans raw_app_meta_data
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values (
    v_uid,
    'bob-google@niqo.test',
    crypt('pass-test', gen_salt('bf')),
    jsonb_build_object(
      'given_name', 'Bob',
      'family_name', 'Konan',
      'pays', 'CI'
      -- pas de telephone, pas de cgu_accepted_at (cas OAuth typique)
    ),
    jsonb_build_object('provider', 'google', 'providers', jsonb_build_array('google')),
    now()
  );
end $$;

select is(
  (select auth_provider::text from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'google',
  'handle_new_user lit auth_provider depuis raw_app_meta_data.provider en fallback (mig 05)'
);

select is(
  (select prenom from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'Bob',
  'handle_new_user lit prenom depuis given_name (Google) en fallback'
);

select is(
  (select telephone from public.users where id = '22222222-2222-2222-2222-222222222222'),
  null,
  'handle_new_user laisse telephone à null pour OAuth (pas dans raw_user_meta_data)'
);

-- ─── Test 3 : handle_new_user — fallback ville pour pays = CG ────────────────
do $$
declare
  v_uid uuid := '33333333-3333-3333-3333-333333333333';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values (
    v_uid,
    'claire-cg@niqo.test',
    crypt('pass-test', gen_salt('bf')),
    -- pas de ville → fallback capital pays
    jsonb_build_object('prenom', 'Claire', 'nom', 'Mboungou', 'pays', 'CG'),
    '{}'::jsonb,
    now()
  );
end $$;

select is(
  (select ville from public.users where id = '33333333-3333-3333-3333-333333333333'),
  'Brazzaville',
  'handle_new_user fallback ville = Brazzaville pour pays = CG'
);

-- ─── Test 4 : encrypt_phone / decrypt_phone roundtrip via get_my_phone ───────
-- get_my_phone() utilise auth.uid() → on simule la session JWT
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);

select is(
  public.get_my_phone(),
  '+2250700000001',
  'get_my_phone décrypte le téléphone du caller (Alice)'
);

-- ─── Test 5 : get_my_phone gate (auth.uid() null) ───────────────────────────
-- On reset la session pour simuler un caller anonyme
select set_config('request.jwt.claims', '{}', true);
select is(
  public.get_my_phone(),
  null,
  'get_my_phone retourne null si pas de session (auth.uid() = null)'
);

-- ─── Test 6 : complete_my_profile — happy path ───────────────────────────────
-- Bob (OAuth) n'a pas de phone — on complète son profil
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);

select lives_ok(
  $$ select public.complete_my_profile('Cocody', 'Riviera', '+2250700000002') $$,
  'complete_my_profile fonctionne pour Bob (OAuth)'
);

select is(
  public.get_my_phone(),
  '+2250700000002',
  'complete_my_profile chiffre le telephone correctement'
);

-- ─── Test 7 : complete_my_profile — validation ville vide ───────────────────
select throws_ok(
  $$ select public.complete_my_profile('', 'Riviera', '+2250700000002') $$,
  'ville requise',
  'complete_my_profile rejette ville vide'
);

-- ─── Test 7 bis : complete_my_profile — push p_pays met à jour le pays ──────
-- (Bug fix mig 82 : signInWithOAuth ne propage pas queryParams custom dans
-- raw_user_meta_data → trigger handle_new_user fallback 'CI' pour OAuth)
-- Bob a été créé avec pays='CI' par le trigger (Google OAuth). On le passe
-- en CG via complete_my_profile.
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
do $$ begin
  perform public.complete_my_profile('Brazzaville', null, '+2422060000222', 'CG'::pays_code);
end $$;

select is(
  (select pays::text from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'CG',
  'complete_my_profile met à jour pays via p_pays (mig 82 — fix OAuth)'
);

-- ─── Test 7 ter : complete_my_profile — p_pays null laisse le pays existant ──
do $$ begin
  perform public.complete_my_profile('Pointe-Noire', null, '+2422060000222');
end $$;

select is(
  (select pays::text from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'CG',
  'complete_my_profile rétrocompat — p_pays null n''écrase pas le pays existant'
);

-- ─── Test 7 quater : complete_my_profile — push prenom + nom (mig 83) ──────
-- Cas réel : Apple Sign In ne renvoie pas le nom → trigger fallback 'Utilisateur'/'—'
-- → user corrige via complete-profile
do $$ begin
  perform public.complete_my_profile(
    'Pointe-Noire', null, '+2422060000222',
    'CG'::pays_code,
    'Robert', 'Konan'
  );
end $$;

select is(
  (select prenom from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'Robert',
  'complete_my_profile met à jour prenom via p_prenom (mig 83 — fix Apple/OAuth)'
);

select is(
  (select nom from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'Konan',
  'complete_my_profile met à jour nom via p_nom (mig 83)'
);

-- ─── Test 7 quinquies : complete_my_profile — validation prenom vide rejetée ──
select throws_ok(
  $$ select public.complete_my_profile('Pointe-Noire', null, '+2422060000222', null, '', 'Konan') $$,
  'prenom cannot be empty',
  'complete_my_profile rejette p_prenom vide après trim'
);

-- ─── Test 8 : tg_check_score_abus — auto-suspend ≥3 ─────────────────────────
update public.users
   set score_abus = 3
 where id = '33333333-3333-3333-3333-333333333333';

select is(
  (select is_active from public.users where id = '33333333-3333-3333-3333-333333333333'),
  false,
  'tg_check_score_abus suspend automatiquement quand score_abus >= 3 (mig 28)'
);

-- ─── Test 9 : tg_check_score_abus — relance is_active OK même si score persiste (mig 77) ──
-- Edge case : admin réactive un compte avec score_abus = 5 toujours en place
-- Le trigger doit le re-suspendre
update public.users
   set is_active = true
 where id = '33333333-3333-3333-3333-333333333333';

select is(
  (select is_active from public.users where id = '33333333-3333-3333-3333-333333333333'),
  false,
  'tg_check_score_abus se déclenche aussi sur update of is_active (mig 77 fix E)'
);

-- ─── Test 10 : accept_auth_cgu idempotent ────────────────────────────────────
-- Alice a déjà cgu_accepted_at → 2e call ne doit pas l'écraser
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);

do $$
declare
  v_first  timestamptz;
  v_second timestamptz;
begin
  select cgu_accepted_at into v_first
    from public.users where id = '11111111-1111-1111-1111-111111111111';

  perform public.accept_auth_cgu('1.1');

  select cgu_accepted_at into v_second
    from public.users where id = '11111111-1111-1111-1111-111111111111';

  if v_first <> v_second then
    raise exception 'accept_auth_cgu n''est pas idempotente (% <> %)', v_first, v_second;
  end if;
end $$;

select pass('accept_auth_cgu est idempotente — n''écrase pas un consentement existant');

-- ─── Setup admin Dominique pour les tests is_current_user_admin / users_admin_select ───
do $$
declare
  v_uid uuid := '44444444-4444-4444-4444-444444444444';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values (
    v_uid,
    'admin-dom@niqo.test',
    crypt('pass-test', gen_salt('bf')),
    jsonb_build_object('prenom', 'Dom', 'nom', 'Admin', 'pays', 'CI', 'auth_provider', 'email'),
    '{}'::jsonb,
    now()
  );
  -- handle_new_user pose is_admin=false par défaut → on promote
  update public.users set is_admin = true where id = v_uid;
end $$;

-- ─── Test 11 : update_my_profile (mig 12) — happy path patch partiel ────────
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);

do $$ begin perform public.update_my_profile('{"prenom": "Robert", "ville": "Marcory"}'::jsonb); end $$;

select is(
  (select prenom from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'Robert',
  'update_my_profile applique le patch partiel sur prenom (mig 12)'
);

select is(
  (select ville from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'Marcory',
  'update_my_profile applique le patch partiel sur ville'
);

-- ─── Test 12 : update_my_profile — validation prenom vide ───────────────────
select throws_ok(
  $$ select public.update_my_profile('{"prenom": ""}'::jsonb) $$,
  'prenom cannot be empty',
  'update_my_profile rejette prenom vide explicite'
);

-- ─── Test 13 : UNIQUE telephone via complete_my_profile ───────────────────
-- Note : les tests sur update_my_phone(text) ont été retirés en mig 99
-- (RPC droppée car jamais appelée côté front — voir audit code mort 2026-05-08).
-- La couverture du hash phone reste garantie par les tests ci-dessous (collision
-- via complete_my_profile + collision native via trigger handle_new_user).
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);

-- ─── Test 13 (ex-quater) : UNIQUE telephone via complete_my_profile ────────
select throws_ok(
  $$ select public.complete_my_profile('Yopougon', 'Niangon', '+2422060000222') $$,
  'P0020',
  'PHONE_ALREADY_USED',
  'mig 84 — complete_my_profile raise PHONE_ALREADY_USED sur collision'
);

-- ─── Test 13 quinquies : signup direct (trigger handle_new_user) — collision ──
-- L'INSERT dans auth.users déclenche handle_new_user qui set telephone_hash.
-- Si collision : unique_violation native (pas de catch dans le trigger).
select throws_ok(
  $$
    insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
    values (
      '55555555-5555-5555-5555-555555555555'::uuid,
      'fraudeur@niqo.test',
      crypt('pass-test', gen_salt('bf')),
      jsonb_build_object(
        'prenom', 'Fraudeur', 'nom', 'Test',
        'telephone', '+2422060000222',
        'pays', 'CG', 'auth_provider', 'email'
      ),
      '{}'::jsonb,
      now()
    )
  $$,
  '23505',
  null,
  'mig 84 — signup avec téléphone déjà utilisé raise unique_violation natif (trigger)'
);

-- ─── Test 14 : repair_my_profile idempotent — pas de doublon sur user existant ──
do $$
declare
  v_count_before bigint;
  v_count_after  bigint;
  v_result       json;
begin
  select count(*) into v_count_before from public.users where id = '11111111-1111-1111-1111-111111111111';
  select public.repair_my_profile() into v_result;
  select count(*) into v_count_after from public.users where id = '11111111-1111-1111-1111-111111111111';

  if v_count_before <> 1 or v_count_after <> 1 then
    raise exception 'repair_my_profile pas idempotent (before=%, after=%)', v_count_before, v_count_after;
  end if;
  if v_result is null then
    raise exception 'repair_my_profile a retourné null sur user existant';
  end if;
end $$;
select pass('repair_my_profile est idempotente — retourne la row existante sans doublon (mig 07)');

-- ─── Test 15 : accept_sell_cgu — état initial null ──────────────────────────
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);

select is(
  (select cgu_sell_accepted_at from public.users where id = '22222222-2222-2222-2222-222222222222'),
  null::timestamptz,
  'cgu_sell_accepted_at null par défaut (Bob n''a jamais vendu)'
);

-- ─── Test 16 : accept_sell_cgu — pose le timestamp au 1er call ─────────────
do $$ begin perform public.accept_sell_cgu(); end $$;

select isnt(
  (select cgu_sell_accepted_at from public.users where id = '22222222-2222-2222-2222-222222222222'),
  null::timestamptz,
  'accept_sell_cgu pose cgu_sell_accepted_at au 1er call (mig 20)'
);

-- ─── Test 17 : accept_sell_cgu — idempotent au 2e call ─────────────────────
do $$
declare
  v_first  timestamptz;
  v_second timestamptz;
begin
  select cgu_sell_accepted_at into v_first
    from public.users where id = '22222222-2222-2222-2222-222222222222';
  perform public.accept_sell_cgu();
  select cgu_sell_accepted_at into v_second
    from public.users where id = '22222222-2222-2222-2222-222222222222';
  if v_first is distinct from v_second then
    raise exception 'accept_sell_cgu pas idempotente (% <> %)', v_first, v_second;
  end if;
end $$;
select pass('accept_sell_cgu est idempotente — n''écrase pas le timestamp existant');

-- ─── Test 18 : is_my_account_active — true pour user actif ────────────────
-- Alice est active (mig 81 backfill ne change rien à is_active)
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);

select is(
  public.is_my_account_active(),
  true,
  'is_my_account_active = true pour Alice (mig 74)'
);

-- ─── Test 19 : is_my_account_active — false pour user suspendu ────────────
-- Claire est suspendue (score_abus=3 → trigger mig 28+77)
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);

select is(
  public.is_my_account_active(),
  false,
  'is_my_account_active = false pour Claire (compte suspendu)'
);

-- ─── Test 20 : is_current_user_admin — false pour user normal ─────────────
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);

select is(
  public.is_current_user_admin(),
  false,
  'is_current_user_admin = false pour Alice (is_admin=false, mig 52)'
);

-- ─── Test 21 : is_current_user_admin — true pour admin ────────────────────
select tests.set_jwt_for('44444444-4444-4444-4444-444444444444'::uuid);

select is(
  public.is_current_user_admin(),
  true,
  'is_current_user_admin = true pour Dominique (is_admin=true)'
);

-- ─── Test 22 : RLS users_admin_select — admin lit le profil de Bob ───────
set local role authenticated;
select tests.set_jwt_for('44444444-4444-4444-4444-444444444444'::uuid);

select is(
  (select count(*)::int from public.users where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'RLS users_admin_select permet à l''admin de lire un autre profil (mig 52)'
);

reset role;

-- ─── Test 23 : trigger set_users_updated_at — bumpe updated_at sur UPDATE ──
-- Astuce : on hardcode created_at à hier pour pouvoir comparer (sinon
-- created_at = updated_at = now() de la transaction).
update public.users
   set created_at = now() - interval '1 day'
 where id = '22222222-2222-2222-2222-222222222222';

-- UPDATE quelconque pour déclencher le trigger
update public.users
   set ville = 'Treichville'
 where id = '22222222-2222-2222-2222-222222222222';

select cmp_ok(
  (select updated_at from public.users where id = '22222222-2222-2222-2222-222222222222'),
  '>',
  (select created_at from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'set_users_updated_at bumpe updated_at lors d''un UPDATE (mig 10)'
);

-- ─── Test 24 : trigger handle_email_update — sync auth.users.email → public.users.email ──
update auth.users
   set email = 'bob-renamed@niqo.test'
 where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select email from public.users where id = '22222222-2222-2222-2222-222222222222'),
  'bob-renamed@niqo.test',
  'handle_email_update propage auth.users.email vers public.users.email (mig 09)'
);

-- ─── Test 25 : RLS users_own_profile (isolation) ─────────────────────────────
-- Sous identité d'Alice, on essaie de lire Bob → doit échouer (RLS)
-- Le SELECT direct via SQL bypass la RLS (postgres role) → on simule via
-- set role authenticated puis query
set local role authenticated;
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);

select is(
  (select count(*)::int from public.users where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'RLS users_own_profile bloque la lecture du profil d''un autre user'
);

select is(
  (select count(*)::int from public.users where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'RLS users_own_profile permet la lecture de son propre profil'
);

reset role;

-- ─── Test 12 : delete_my_account cascade ────────────────────────────────────
-- Suppression Alice → public.users + auth.users disparaissent
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select lives_ok(
  $$ select public.delete_my_account() $$,
  'delete_my_account fonctionne pour user authentifié'
);

select is(
  (select count(*)::int from public.users where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'delete_my_account cascade public.users (FK on delete cascade)'
);

select is(
  (select count(*)::int from auth.users where id = '11111111-1111-1111-1111-111111111111'),
  0,
  'delete_my_account supprime auth.users'
);

select * from finish();
rollback;

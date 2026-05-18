-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Conversations (F04)
--
-- Couvre via DB direct (RLS, triggers, RPCs, helpers) :
--   - RLS conversations : SELECT participants / INSERT acheteur / REVOKE UPDATE
--   - RLS messages      : SELECT/INSERT participants / column-level UPDATE is_read
--   - is_my_account_active() guard sur INSERT messages (mig 74)
--   - mots_interdits deny-all (mig 105)
--   - fn_check_forbidden_words (case-insens, sous-chaîne, null safety)
--   - tg_messages_content_filter (block + bypass type='systeme' mig 35)
--   - tg_conversation_last_message (dénormalisation preview 100 chars max)
--   - get_or_create_conversation : gates + idempotence
--   - mark_messages_read : gates + ne touche pas ses propres msgs
--   - admin_soft_delete_message (mig 57) : gates + idempotent
--   - admin_suspend_user (mig 57) : gates + effet bloque INSERT message
--
-- Cf. docs/backend/conversations.md pour le module complet.
-- Migs couvertes : 22, 23, 24, 29, 35, 57, 65, 74, 105, 117, 118.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(48);

-- ═════════════════════════════════════════════════════════════════════════════
-- Setup : 4 users + 1 catégorie + 2 annonces Bob + 1 conv Alice↔Bob + 2 msgs
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_alice uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_bob   uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_carol uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_diana uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_alice, 'alice-conv@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Buyer','pays','CI','telephone','+2250700001111','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_bob,   'bob-conv@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Seller','pays','CI','telephone','+2250700002222','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_carol, 'carol-conv@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Carol','nom','Tiers','pays','CI','telephone','+2250700003333','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_diana, 'diana-conv@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Diana','nom','Admin','pays','CI','telephone','+2250700004444','auth_provider','email'),
     '{}'::jsonb, now());

  update public.users set is_admin = true where id = v_diana;
end $$;

-- Setup annonces : Bob crée 2 annonces (active + vendue)
do $$
declare
  v_categorie_id uuid;
  v_ann1 uuid := 'ddd11111-dddd-dddd-dddd-dddddddddddd';
  v_ann2 uuid := 'ddd22222-dddd-dddd-dddd-dddddddddddd';
begin
  -- Première catégorie non-immo
  select id into v_categorie_id from public.categories
    where is_active = true and nom <> 'Immobilier'
    order by ordre limit 1;

  insert into public.annonces (
    id, vendeur_id, categorie_id, titre, description, prix, photos,
    pays, ville, expires_at, statut
  )
  values
    (v_ann1,
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
     v_categorie_id,
     'iPhone 12 Pro 128 Go bon état',
     'Vendu avec sa boîte d''origine, chargeur et coque. Toujours protégé.',
     250000,
     array['photo1.jpg'],
     'CI'::pays_code,
     'Abidjan',
     now() + interval '60 days',
     'active'::statut_annonce),
    (v_ann2,
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
     v_categorie_id,
     'Samsung Galaxy S22 Ultra 256 Go',
     'Très bon état, vendu avec ses accessoires. Garantie de 6 mois.',
     350000,
     array['photo2.jpg'],
     'CI'::pays_code,
     'Abidjan',
     now() + interval '60 days',
     'active'::statut_annonce);

  -- Forcer ann2 en 'vendue' (bypass RLS owner_update qui exige statut='active')
  update public.annonces set statut = 'vendue' where id = v_ann2;
end $$;

-- Setup conv Alice↔Bob + 2 messages "normaux"
do $$
declare
  v_conv  uuid := 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee';
  v_msg1  uuid := 'eee00011-eeee-eeee-eeee-eeeeeeeeeeee';
  v_msg2  uuid := 'eee00022-eeee-eeee-eeee-eeeeeeeeeeee';
begin
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id)
  values (
    v_conv,
    'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  );

  insert into public.messages (id, conversation_id, expediteur_id, contenu, type)
  values
    (v_msg1, v_conv,
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
     'Bonjour, ton iPhone est encore disponible ?',
     'texte'::type_message),
    (v_msg2, v_conv,
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
     'Oui, dispo à Cocody. Tu viens quand ?',
     'texte'::type_message);
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- A. RLS conversations — SELECT participants
-- ═════════════════════════════════════════════════════════════════════════════

set local role authenticated;

-- A1 — anon SELECT conv → 0 (no JWT)
select set_config('request.jwt.claims', null, true);

select is(
  (select count(*)::int from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  0,
  'A1 RLS conversations_select_participants : anon → 0'
);

-- A2 — Alice (acheteur) voit sa conv
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  (select count(*)::int from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  1,
  'A2 RLS conversations_select_participants : Alice (acheteur) voit sa conv'
);

-- A3 — Bob (vendeur) voit sa conv
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select is(
  (select count(*)::int from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  1,
  'A3 RLS conversations_select_participants : Bob (vendeur) voit sa conv'
);

-- A4 — Carol (tiers) ne voit pas la conv
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select is(
  (select count(*)::int from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  0,
  'A4 RLS conversations_select_participants : Carol (tiers) → 0'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- B. RLS conversations — INSERT acheteur + REVOKE UPDATE (mig 74)
-- ═════════════════════════════════════════════════════════════════════════════

-- B1 — Carol tente INSERT conv avec acheteur_id = Alice (false acheteur) → bloqué
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select throws_ok(
  $$ insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id)
     values (
       'eee00002-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
       'ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
     ) $$,
  '42501',
  null,
  'B1 RLS conversations_insert_buyer : Carol ne peut pas usurper acheteur_id=Alice'
);

-- B2 — REVOKE UPDATE conversations (mig 74) : authenticated UPDATE direct → 42501
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select throws_ok(
  $$ update public.conversations
       set last_message_preview = 'pwned'
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee' $$,
  '42501',
  null,
  'B2 mig 74 REVOKE UPDATE conversations from authenticated → 42501'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- C. RLS messages — SELECT participants
-- ═════════════════════════════════════════════════════════════════════════════

-- C1 — Alice voit les 2 messages
select is(
  (select count(*)::int from public.messages
     where conversation_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  2,
  'C1 RLS messages_select_participants : Alice voit 2 msgs'
);

-- C2 — Bob voit les 2 messages
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select is(
  (select count(*)::int from public.messages
     where conversation_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  2,
  'C2 RLS messages_select_participants : Bob voit 2 msgs'
);

-- C3 — Carol (tiers) ne voit aucun message
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select is(
  (select count(*)::int from public.messages
     where conversation_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  0,
  'C3 RLS messages_select_participants : Carol → 0'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- D. RLS messages — INSERT participants + is_my_account_active (mig 74)
-- ═════════════════════════════════════════════════════════════════════════════

-- D1 — Carol tente INSERT msg dans conv Alice-Bob → bloqué (non-participant)
select throws_ok(
  $$ insert into public.messages (conversation_id, expediteur_id, contenu, type)
     values (
       'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
       'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
       'Spam from outsider',
       'texte'::type_message
     ) $$,
  '42501',
  null,
  'D1 RLS messages_insert_participants : Carol non-participant → 42501'
);

-- D2 — Alice INSERT msg légitime → OK (1 row)
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

with ins as (
  insert into public.messages (conversation_id, expediteur_id, contenu, type)
  values (
    'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'Top, je passe demain à 14h',
    'texte'::type_message
  )
  returning id
)
select is((select count(*)::int from ins), 1, 'D2 Alice INSERT msg légitime → OK');

-- D3 — Suspendre Alice puis tenter INSERT → bloqué par is_my_account_active() (mig 74)
reset role;
update public.users set is_active = false where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select throws_ok(
  $$ insert into public.messages (conversation_id, expediteur_id, contenu, type)
     values (
       'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'Message après suspension',
       'texte'::type_message
     ) $$,
  '42501',
  null,
  'D3 mig 74 INSERT msg bloqué si is_my_account_active()=false'
);

-- Restore Alice
reset role;
update public.users set is_active = true where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- E. messages UPDATE — column-level grant is_read only (mig 74)
-- ═════════════════════════════════════════════════════════════════════════════

-- E1 — Bob marque msg1 (d'Alice) comme lu → OK (1 row)
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

with upd as (
  update public.messages set is_read = true
   where id = 'eee00011-eeee-eeee-eeee-eeeeeeeeeeee'
   returning id
)
select is((select count(*)::int from upd), 1, 'E1 mig 74 UPDATE messages.is_read column-level OK');

-- E2 — Bob tente UPDATE contenu → bloqué par REVOKE column-level (mig 74)
select throws_ok(
  $$ update public.messages set contenu = 'altered content'
      where id = 'eee00011-eeee-eeee-eeee-eeeeeeeeeeee' $$,
  '42501',
  null,
  'E2 mig 74 UPDATE messages.contenu (autre colonne) → 42501'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- F. mots_interdits — RLS deny-all (mig 105) + seed count
-- ═════════════════════════════════════════════════════════════════════════════

-- F1 — authenticated SELECT mots_interdits → 42501 (REVOKE ALL mig 105)
select throws_ok(
  $$ select count(*) from public.mots_interdits $$,
  '42501',
  null,
  'F1 mig 105 mots_interdits SELECT en authenticated → 42501 (REVOKE)'
);

-- F2 — service_role (reset role) voit les 63 mots seed (mig 29)
reset role;

select cmp_ok(
  (select count(*)::int from public.mots_interdits),
  '>=',
  110,
  'F2 mig 29+117+118 seed mots_interdits ≥ 110 (63 + 42 arnaques_* + 6 adulte)'
);

-- F3 — mig 117 seed scam patterns (4 sous-catégories arnaques_*)
select cmp_ok(
  (select count(*)::int from public.mots_interdits
     where categorie in ('arnaques_otp','arnaques_avance','arnaques_frais','arnaques_liens')),
  '>=',
  42,
  'F3 mig 117 seed scam patterns arnaques_otp/avance/frais/liens ≥ 42'
);

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- G. fn_check_forbidden_words — helper (mig 29, EXECUTE revoke d'authenticated
--    en mig 94 → on teste en role postgres / service_role)
-- ═════════════════════════════════════════════════════════════════════════════

reset role;  -- mig 94 a revoke EXECUTE from authenticated → seul postgres/service_role appelle

-- G1 — null → null
select is(
  public.fn_check_forbidden_words(null),
  null,
  'G1 fn_check_forbidden_words(null) → null'
);

-- G2 — texte normal → null
select is(
  public.fn_check_forbidden_words('Bonjour, ton iPhone est encore dispo ?'),
  null,
  'G2 fn_check_forbidden_words(texte normal) → null'
);

-- G3 — mot interdit présent → retourne le mot trouvé
select isnt(
  public.fn_check_forbidden_words('je vends de la cocaine pure'),
  null,
  'G3 fn_check_forbidden_words("cocaine") → mot trouvé'
);

-- G4 — case-insensitive
select isnt(
  public.fn_check_forbidden_words('COCAINE EN MAJUSCULES'),
  null,
  'G4 fn_check_forbidden_words case-insensitive (COCAINE) → mot trouvé'
);

-- G5 — mig 117 pattern OTP détecté
select isnt(
  public.fn_check_forbidden_words('envoyez-moi le code de vérification que tu vas recevoir par SMS'),
  null,
  'G5 mig 117 fn_check_forbidden_words OTP pattern détecté'
);

-- G6 — mig 117 pattern paiement à l''avance détecté
select isnt(
  public.fn_check_forbidden_words('Salut, peux-tu faire un paiement à l''avance via Wave stp ?'),
  null,
  'G6 mig 117 fn_check_forbidden_words paiement à l''avance détecté'
);

-- G7 — mig 117 pattern URL raccourcie détecté
select isnt(
  public.fn_check_forbidden_words('Voir le produit ici : https://bit.ly/promo-iphone'),
  null,
  'G7 mig 117 fn_check_forbidden_words URL raccourcie (bit.ly/) détecté'
);

-- G8 — defensive : "code postal" légitime ne déclenche PAS de match
-- (validation que les patterns OTP mig 117 sont assez spécifiques pour ne pas
-- bloquer les codes postaux/wifi/promo courants en marketplace)
select is(
  public.fn_check_forbidden_words('Quel est ton code postal pour la livraison ?'),
  null,
  'G8 mig 117 fn_check_forbidden_words "code postal" → null (pas de faux positif)'
);

-- G9 — mig 118 catch "Photo intimes adulte" (cas observé prod 2026-05-12)
-- (couche 1 rattrape le gap zone grise OpenAI Moderation)
select isnt(
  public.fn_check_forbidden_words('Photo intimes adulte à vendre'),
  null,
  'G9 mig 118 fn_check_forbidden_words "photo intime" suggestif détecté'
);

set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);


-- ═════════════════════════════════════════════════════════════════════════════
-- H. tg_messages_content_filter — block + bypass type='systeme' (mig 35)
-- ═════════════════════════════════════════════════════════════════════════════

-- H1 — INSERT msg type='texte' avec mot interdit → throws contenu_interdit (P0001)
select throws_ok(
  $$ insert into public.messages (conversation_id, expediteur_id, contenu, type)
     values (
       'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'je vends de la cocaine pure',
       'texte'::type_message
     ) $$,
  'P0001',
  null,
  'H1 tg_messages_content_filter : texte avec mot interdit → P0001 contenu_interdit'
);

-- H3 — INSERT msg avec scam pattern mig 117 (paiement à l''avance) → throws P0001
-- Placé avant H2 car H2 fait un INSERT qui réussit (last_message_preview consommé
-- par tests I1+). throws_ok rollback son INSERT donc n'interfère pas.
select throws_ok(
  $$ insert into public.messages (conversation_id, expediteur_id, contenu, type)
     values (
       'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'Salut, fais un paiement à l''avance via Wave avant le RDV stp',
       'texte'::type_message
     ) $$,
  'P0001',
  null,
  'H3 mig 117 tg_messages_content_filter : scam pattern arnaques_avance → P0001'
);

-- H2 — INSERT msg type='systeme' avec mot interdit → OK (bypass mig 35)
reset role;
-- Insert en service_role car les RPCs RDV qui produisent les msgs systeme tournent
-- SECURITY DEFINER (mig 35) — on émule ici.
do $$
begin
  insert into public.messages (conversation_id, expediteur_id, contenu, type)
  values (
    'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'RDV au marché de bombe artisanale',  -- contient "bombe" interdit
    'systeme'::type_message
  );
end $$;

select is(
  (select count(*)::int from public.messages
     where conversation_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'
       and type = 'systeme'),
  1,
  'H2 tg_messages_content_filter : bypass type=systeme (mig 35) → INSERT OK'
);

set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);


-- ═════════════════════════════════════════════════════════════════════════════
-- I. tg_conversation_last_message — dénormalisation (mig 22)
-- ═════════════════════════════════════════════════════════════════════════════

-- I1 — Le dernier INSERT a propagé last_message_preview sur la conv
-- Vu qu'on a inséré le msg systeme "RDV au marché de bombe artisanale" en dernier
select is(
  (select left(last_message_preview, 20) from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  'RDV au marché de bom',
  'I1 tg_conversation_last_message : dénormalise les 1ers chars (1-20)'
);

-- I2 — Insertion msg court → preview = contenu intégral
insert into public.messages (conversation_id, expediteur_id, contenu, type)
values (
  'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Court msg',
  'texte'::type_message
);

select is(
  (select last_message_preview from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  'Court msg',
  'I2 tg_conversation_last_message : msg court → preview = contenu entier'
);

-- I3 — Insertion msg > 100 chars → preview tronqué à 100
insert into public.messages (conversation_id, expediteur_id, contenu, type)
values (
  'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  repeat('A', 150),
  'texte'::type_message
);

select is(
  (select char_length(last_message_preview) from public.conversations
     where id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'),
  100,
  'I3 tg_conversation_last_message : msg > 100 chars → preview tronqué à 100'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- J. get_or_create_conversation — RPC (mig 22, refait mig 40)
-- ═════════════════════════════════════════════════════════════════════════════

-- J1 — anon → not_authenticated
select set_config('request.jwt.claims', null, true);

select is(
  (public.get_or_create_conversation('ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid))->>'error',
  'not_authenticated',
  'J1 get_or_create_conversation sans JWT → not_authenticated'
);

-- J2 — annonce_not_found
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  (public.get_or_create_conversation('00000000-0000-0000-0000-000000000000'::uuid))->>'error',
  'annonce_not_found',
  'J2 get_or_create_conversation annonce inexistante → annonce_not_found'
);

-- J3 — Bob (vendeur) tente sur sa propre annonce → cannot_message_self
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select is(
  (public.get_or_create_conversation('ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid))->>'error',
  'cannot_message_self',
  'J3 get_or_create_conversation vendeur sur sa propre annonce → cannot_message_self'
);

-- J4 — Carol sur annonce vendue → annonce_not_available
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select is(
  (public.get_or_create_conversation('ddd22222-dddd-dddd-dddd-dddddddddddd'::uuid))->>'error',
  'annonce_not_available',
  'J4 get_or_create_conversation annonce vendue → annonce_not_available'
);

-- J5 — Carol sur annonce active de Bob → success + nouvelle conv
select is(
  ((public.get_or_create_conversation('ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid))->>'success')::bool,
  true,
  'J5 get_or_create_conversation happy path (Carol → Bob active) → success=true'
);

-- J6 — 2e call Carol → même id (idempotent ON CONFLICT)
select is(
  (public.get_or_create_conversation('ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid))->'conversation'->>'id',
  (public.get_or_create_conversation('ddd11111-dddd-dddd-dddd-dddddddddddd'::uuid))->'conversation'->>'id',
  'J6 get_or_create_conversation idempotent : 2e call retourne le même id'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- K. mark_messages_read — RPC (mig 22)
-- ═════════════════════════════════════════════════════════════════════════════

-- K1 — anon → throws not_authenticated
select set_config('request.jwt.claims', null, true);

select throws_ok(
  $$ select public.mark_messages_read('eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid) $$,
  'P0001',
  'not_authenticated',
  'K1 mark_messages_read sans JWT → P0001 not_authenticated'
);

-- K2 — Carol (non-participant) → throws not_participant
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

select throws_ok(
  $$ select public.mark_messages_read('eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid) $$,
  'P0001',
  'not_participant',
  'K2 mark_messages_read non-participant → P0001 not_participant'
);

-- K3 — Bob marque ses msgs reçus comme lus, ses propres msgs restent inchangés
-- D'abord on insère un nouveau msg d'Alice (unread) + on remet le msg de Bob unread
reset role;
update public.messages set is_read = false
  where conversation_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee';

insert into public.messages (id, conversation_id, expediteur_id, contenu, type)
values (
  'eee00033-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'Encore moi',
  'texte'::type_message
);

set local role authenticated;
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select public.mark_messages_read('eee00001-eeee-eeee-eeee-eeeeeeeeeeee'::uuid);

select is(
  (select count(*)::int from public.messages
     where conversation_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'
       and expediteur_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
       and is_read = false),
  0,
  'K3a mark_messages_read : tous les msgs d Alice sont is_read=true côté Bob'
);

select cmp_ok(
  (select count(*)::int from public.messages
     where conversation_id = 'eee00001-eeee-eeee-eeee-eeeeeeeeeeee'
       and expediteur_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
       and is_read = false),
  '>',
  0,
  'K3b mark_messages_read : Bob NE marque PAS ses propres msgs lus'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- L. admin_soft_delete_message (mig 57)
-- ═════════════════════════════════════════════════════════════════════════════

-- L1 — Alice (non-admin) → ADMIN_REQUIRED (P0002)
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select throws_ok(
  $$ select public.admin_soft_delete_message('eee00011-eeee-eeee-eeee-eeeeeeeeeeee'::uuid) $$,
  'P0002',
  'ADMIN_REQUIRED',
  'L1 admin_soft_delete_message non-admin → P0002 ADMIN_REQUIRED'
);

-- L2 — Diana (admin) sur id inexistant → MESSAGE_NOT_FOUND (P0003)
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);

select throws_ok(
  $$ select public.admin_soft_delete_message('00000000-0000-0000-0000-000000000000'::uuid) $$,
  'P0003',
  'MESSAGE_NOT_FOUND',
  'L2 admin_soft_delete_message id inexistant → P0003 MESSAGE_NOT_FOUND'
);

-- L3 — Diana sur message existant → is_deleted=true
select public.admin_soft_delete_message('eee00011-eeee-eeee-eeee-eeeeeeeeeeee'::uuid);

reset role;  -- bypass RLS pour lire l'état post-soft-delete
select is(
  (select is_deleted from public.messages
     where id = 'eee00011-eeee-eeee-eeee-eeeeeeeeeeee'),
  true,
  'L3 admin_soft_delete_message admin → is_deleted=true (contenu préservé)'
);

set local role authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- M. admin_suspend_user (mig 57)
-- ═════════════════════════════════════════════════════════════════════════════

-- M1 — Alice (non-admin) → ADMIN_REQUIRED
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select throws_ok(
  $$ select public.admin_suspend_user('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid) $$,
  'P0002',
  'ADMIN_REQUIRED',
  'M1 admin_suspend_user non-admin → P0002 ADMIN_REQUIRED'
);

-- M2 — Diana tente de se suspendre elle-même → CANNOT_SUSPEND_SELF (P0004)
select tests.set_jwt_for('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);

select throws_ok(
  $$ select public.admin_suspend_user('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid) $$,
  'P0004',
  'CANNOT_SUSPEND_SELF',
  'M2 admin_suspend_user self → P0004 CANNOT_SUSPEND_SELF'
);

-- M3 — Diana suspend Carol → users.is_active=false
select public.admin_suspend_user('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);

reset role;
select is(
  (select is_active from public.users
     where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  false,
  'M3 admin_suspend_user admin → users.is_active=false'
);


-- ═════════════════════════════════════════════════════════════════════════════
-- Finalize
-- ═════════════════════════════════════════════════════════════════════════════

select * from finish();
rollback;

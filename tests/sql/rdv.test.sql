-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module RDV (F05)
--
-- Couvre :
--   - 4 RPCs : propose_rdv, confirm_rdv, cancel_rdv, mark_annonce_vendue
--     (validations + happy paths + erreurs nommées)
--   - Trigger lifecycle annonce (active → en_cours → active sur cycle RDV)
--   - Trigger insertion message système (1 message par RPC)
--   - RLS annonces_buyer_select_via_conv (acheteur voit annonce en_cours via
--     conversation, alors que la policy publique filtre statut='active')
--
-- Cf. docs/backend/rdv.md pour le module complet.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(37);

-- ─── Setup users ─────────────────────────────────────────────────────────────
do $$
declare
  v_alice   uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_bob     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_charlie uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_alice,   'alice-rdv@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Buyer','pays','CI','telephone','+2250700001111','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_bob,     'bob-rdv@niqo.test',     crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Seller','pays','CI','telephone','+2250700002222','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_charlie, 'charlie-rdv@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Charlie','nom','Tiers','pays','CI','telephone','+2250700003333','auth_provider','email'),
     '{}'::jsonb, now());
end $$;

-- ─── Setup annonce de Bob (active) + conversation Alice-Bob ──────────────────
do $$
declare
  v_categorie_id uuid;
  v_annonce_id   uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_conv_id      uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
begin
  -- 1ère catégorie disponible (mig 13 a peuplé 6 catégories)
  select id into v_categorie_id from public.categories order by ordre limit 1;

  insert into public.annonces (
    id, vendeur_id, categorie_id, titre, description, prix, photos,
    pays, ville, expires_at, statut
  )
  values (
    v_annonce_id,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    v_categorie_id,
    'iPhone 12 Pro 128 Go bon état',
    'Vendu avec sa boîte d''origine, chargeur et coque. Toujours protégé.',
    250000,
    array['photo1.jpg'],
    'CI'::pays_code,
    'Abidjan',
    now() + interval '60 days',
    'active'::statut_annonce
  );

  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id)
  values (
    v_conv_id, v_annonce_id,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  );
end $$;

-- ─── Test 1 : propose_rdv non-authentifié → not_authenticated ───────────────
select set_config('request.jwt.claims', '{}', true);

select is(
  (public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Marché de Cocody', now() + interval '2 days'))->>'error',
  'not_authenticated',
  'propose_rdv sans JWT renvoie not_authenticated'
);

-- ─── Switch JWT à Alice (acheteur) ───────────────────────────────────────────
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

-- ─── Test 2 : propose_rdv lieu vide → lieu_required ────────────────────────
select is(
  (public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, '   ', now() + interval '2 days'))->>'error',
  'lieu_required',
  'propose_rdv avec lieu vide/whitespace renvoie lieu_required'
);

-- ─── Test 3 : propose_rdv lieu trop long → lieu_too_long ───────────────────
select is(
  (public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, repeat('A', 101), now() + interval '2 days'))->>'error',
  'lieu_too_long',
  'propose_rdv avec lieu > 100 chars renvoie lieu_too_long'
);

-- ─── Test 4 : propose_rdv date trop tôt → date_too_soon ────────────────────
select is(
  (public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Marché de Cocody', now() + interval '10 minutes'))->>'error',
  'date_too_soon',
  'propose_rdv avec date < now+30min renvoie date_too_soon'
);

-- ─── Test 5 : propose_rdv conversation inconnue → conversation_not_found ──
select is(
  (public.propose_rdv('00000000-0000-0000-0000-000000000000'::uuid, 'Marché', now() + interval '2 days'))->>'error',
  'conversation_not_found',
  'propose_rdv sur conv inexistante renvoie conversation_not_found'
);

-- ─── Test 6 : propose_rdv non-participant (Charlie) → not_participant ──────
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);
select is(
  (public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Marché', now() + interval '2 days'))->>'error',
  'not_participant',
  'propose_rdv par un tiers (Charlie) renvoie not_participant'
);

-- ─── Test 7 : propose_rdv happy path (Alice propose) ───────────────────────
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  (public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Marché de Cocody, devant la pharmacie', now() + interval '2 days'))->>'success',
  'true',
  'propose_rdv happy path renvoie success=true'
);

select is(
  (select rdv_propose_par from public.conversations where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'propose_rdv set rdv_propose_par = caller (Alice)'
);

select is(
  (select rdv_lieu from public.conversations where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid),
  'Marché de Cocody, devant la pharmacie',
  'propose_rdv set rdv_lieu correctement'
);

select cmp_ok(
  (select count(*)::int from public.messages where conversation_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid and type = 'systeme'),
  '=', 1,
  'propose_rdv insert 1 message système (bypass content_filter via mig 35)'
);

-- ─── Test 8 : confirm_rdv self (Alice tente sa propre prop) → cannot_self_confirm ──
select is(
  (public.confirm_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'error',
  'cannot_self_confirm',
  'confirm_rdv par le proposeur lui-même renvoie cannot_self_confirm'
);

-- ─── Test 9 : confirm_rdv non-participant → not_participant ────────────────
select tests.set_jwt_for('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid);
select is(
  (public.confirm_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'error',
  'not_participant',
  'confirm_rdv par un tiers renvoie not_participant'
);

-- ─── Test 10 : confirm_rdv happy (Bob confirme) + trigger lifecycle annonce ─
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select is(
  (public.confirm_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'success',
  'true',
  'confirm_rdv happy path par Bob renvoie success=true'
);

select isnt(
  (select rdv_confirme_at from public.conversations where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid),
  null::timestamptz,
  'confirm_rdv pose rdv_confirme_at'
);

select is(
  (select statut::text from public.annonces where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'en_cours',
  'trigger fn_annonce_statut_on_rdv_change : annonce active → en_cours après confirm (mig 39)'
);

-- ─── Test 11 : RLS annonces_buyer_select_via_conv (mig 41) ─────────────────
-- Sous role authenticated + JWT Alice (acheteuse), elle doit voir l'annonce
-- même si statut='en_cours' (la policy publique filtre statut='active').
set local role authenticated;
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

select is(
  (select count(*)::int from public.annonces where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  1,
  'RLS annonces_buyer_select_via_conv : Alice (acheteuse) lit l''annonce en_cours via sa conversation (mig 41)'
);

reset role;

-- ─── Test 12 : confirm_rdv 2 fois → rdv_already_confirmed ──────────────────
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);
select is(
  (public.confirm_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'error',
  'rdv_already_confirmed',
  'confirm_rdv 2e fois renvoie rdv_already_confirmed'
);

-- ─── Test 13 : propose_rdv après confirm → rdv_already_confirmed ───────────
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select is(
  (public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Autre lieu', now() + interval '3 days'))->>'error',
  'rdv_already_confirmed',
  'propose_rdv post-confirmation renvoie rdv_already_confirmed (annuler d''abord)'
);

-- ─── Test 14 : cancel_rdv (Alice annule un RDV confirmé) ───────────────────
select is(
  (public.cancel_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'success',
  'true',
  'cancel_rdv happy path par Alice renvoie success=true'
);

select is(
  (select rdv_lieu from public.conversations where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid),
  null::text,
  'cancel_rdv reset rdv_lieu à null'
);

select is(
  (select rdv_annule_par from public.conversations where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'cancel_rdv pose rdv_annule_par = caller (Alice témoin)'
);

select is(
  (select statut::text from public.annonces where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'active',
  'trigger lifecycle : annonce en_cours → active après cancel du dernier RDV confirmé (mig 39)'
);

-- ─── Test 15 : cancel_rdv quand rien à annuler → no_rdv_to_cancel ─────────
select is(
  (public.cancel_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'error',
  'no_rdv_to_cancel',
  'cancel_rdv sans RDV en cours renvoie no_rdv_to_cancel'
);

-- ─── Test 16 : mark_annonce_vendue sans rencontre confirmée → no_meeting_confirmed ─
-- Mig 86 : remplace no_past_rdv par no_meeting_confirmed (anti-fraude vendeur).
-- Mig 88 : exige rencontre_acheteur=true ET rencontre_vendeur != false.
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);
select is(
  (public.mark_annonce_vendue('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid))->>'error',
  'no_meeting_confirmed',
  'mark_annonce_vendue sans rencontre acheteur confirmée renvoie no_meeting_confirmed (mig 86+88)'
);

-- ─── Test 17 : Setup RDV passé + rencontre confirmée des 2 côtés ───────────
-- On re-propose, on confirme, on hack rdv_date au passé, puis CHACUN confirme
-- la rencontre via confirm_rencontre (mig 86). Sans ces 2 confirms, mark_vendue
-- est bloqué.
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select pass(
  ((public.propose_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, 'Marché Treichville', now() + interval '2 days'))->>'success' = 'true')::text
);

select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);
select pass(
  ((public.confirm_rdv('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid))->>'success' = 'true')::text
);

-- Hack date dans le passé (bypass postgres role)
update public.conversations
   set rdv_date = now() - interval '1 day'
 where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid;

-- Confirm_rencontre Alice (acheteuse) + Bob (vendeur) → état met
select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select pass(
  ((public.confirm_rencontre('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, true))->>'success' = 'true')::text
);

select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);
select pass(
  ((public.confirm_rencontre('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid, true))->>'success' = 'true')::text
);

-- ─── Test 18 : mark_annonce_vendue happy path après rencontre confirmée ────
select is(
  (public.mark_annonce_vendue('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid))->>'success',
  'true',
  'mark_annonce_vendue après rencontre confirmée par les 2 parties renvoie success=true (mig 86)'
);

select is(
  (select statut::text from public.annonces where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid),
  'vendue',
  'mark_annonce_vendue pose statut=vendue'
);

-- ─── Test 19 : mark_annonce_vendue non-owner → not_owner ──────────────────
-- Reset annonce pour pouvoir tester (vendue → invalid_state sinon)
update public.annonces
   set statut = 'active'
 where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;

select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select is(
  (public.mark_annonce_vendue('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid))->>'error',
  'not_owner',
  'mark_annonce_vendue par non-vendeur renvoie not_owner'
);

-- ─── Test 20 : guard IMMO_NO_RDV (mig 100) ─────────────────────────────────
-- Crée une annonce immobilière (type_offre IS NOT NULL) + conv Alice-Bob,
-- puis tente propose_rdv → doit raise IMMO_NO_RDV.
do $$
declare
  v_categorie_id uuid;
  v_immo_id      uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  v_conv_immo    uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- Catégorie immobilier (nom = 'Immobilier', mig 32)
  select id into v_categorie_id from public.categories where nom = 'Immobilier';

  insert into public.annonces (
    id, vendeur_id, categorie_id, titre, description, prix, photos,
    pays, ville, expires_at, statut, type_offre
  )
  values (
    v_immo_id,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    v_categorie_id,
    'Appartement 2 pièces Cocody',
    'Bel appartement meublé proche centre commercial.',
    150000,
    array['photo1.jpg'],
    'CI'::pays_code,
    'Abidjan',
    now() + interval '60 days',
    'active'::statut_annonce,
    'location'::type_offre_immo
  );

  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id)
  values (
    v_conv_immo, v_immo_id,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  );
end $$;

select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select is(
  (public.propose_rdv(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Visite appartement Cocody',
    now() + interval '2 days'
  ))->>'error',
  'IMMO_NO_RDV',
  'propose_rdv sur annonce immobilière (type_offre non-null) raise IMMO_NO_RDV (mig 100)'
);

-- ─── Test 21 : mark_annonce_vendue immo bypass guard rencontre (mig 101) ───
-- Bob (vendeur) marque son annonce immo `vendue`/`louée` sans aucune
-- rencontre confirmée (et pour cause : pas de RDV en mode immo).
select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);

select is(
  (public.mark_annonce_vendue('ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))->>'success',
  'true',
  'mark_annonce_vendue sur annonce immo bypass le guard rencontre (mig 101)'
);

select is(
  (select statut::text from public.annonces where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid),
  'vendue',
  'mark_annonce_vendue immo pose statut=vendue (DB unique pour vente ET location)'
);

-- ─── Test 22 : régression — non-immo sans rencontre raise toujours no_meeting_confirmed ─
-- Crée une 2e annonce non-immo neuve par Bob (sans aucune conv ni rencontre)
-- pour vérifier que le bypass mig 101 ne s'active QUE pour type_offre != null.
do $$
declare
  v_categorie_id     uuid;
  v_annonce_clean_id uuid := '22222222-2222-2222-2222-222222222222';
begin
  select id into v_categorie_id from public.categories order by ordre limit 1;

  insert into public.annonces (
    id, vendeur_id, categorie_id, titre, description, prix, photos,
    pays, ville, expires_at, statut
  )
  values (
    v_annonce_clean_id,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    v_categorie_id,
    'Casque audio neuf jamais utilisé',
    'Vendu sous blister, garantie restante.',
    35000,
    array['photo1.jpg'],
    'CI'::pays_code,
    'Abidjan',
    now() + interval '60 days',
    'active'::statut_annonce
  );
end $$;

select tests.set_jwt_for('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid);
select is(
  (public.mark_annonce_vendue('22222222-2222-2222-2222-222222222222'::uuid))->>'error',
  'no_meeting_confirmed',
  'mark_annonce_vendue non-immo sans rencontre raise no_meeting_confirmed (régression mig 86+88, bypass mig 101 inactif)'
);

select is(
  (select statut::text from public.annonces where id = '22222222-2222-2222-2222-222222222222'::uuid),
  'active',
  'mark_annonce_vendue non-immo refusée → statut reste active (régression)'
);

-- ─── Test 23 : add_rencontre_photo lock après admin_decided (mig 102) ─────
-- La conv eeee a un RDV confirmé + date passée + rencontre confirmée des 2 côtés
-- (héritage Test 17). On hack admin_signalement_decided_at à now() pour
-- simuler une décision admin, puis Alice tente d'ajouter une photo → doit
-- raise 'signalement_decided'.
update public.conversations
   set admin_signalement_decided_at = now()
 where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid;

select tests.set_jwt_for('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select is(
  (public.add_rencontre_photo(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/test-mig102.jpg'
  ))->>'error',
  'signalement_decided',
  'add_rencontre_photo après admin_signalement_decided_at set raise signalement_decided (mig 102)'
);

select * from finish();
rollback;

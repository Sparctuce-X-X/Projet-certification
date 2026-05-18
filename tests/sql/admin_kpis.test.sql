-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Admin KPIs v2 (mig 111-116) — 100% NUMBER ACCURACY
--
-- Objectif : chaque KPI retourné par les 4 RPCs est asserted en valeur EXACTE
-- (pas de range >=). Pour ça on construit une fixture déterministe avec :
--   - 7 users (5 CI + 2 CG, dont 1 admin + Vendeur Fiable + suspended auto/admin)
--   - 6 annonces (4 CI + 2 CG, dont 1 expirée récente)
--   - 8 paiements completed + 1 boost pending stuck
--   - 6 push_tokens (DAU/WAU/MAU couverts)
--   - 3 conversations (dont 2 avec rdv_propose)
--   - 3 messages (pour time-to-first-contact P50)
--   - 1 avis (pour funnel completed_first_rdv)
--   - 3 signalements (1 pending >24h alerte, 1 pending récent, 1 traité)
--   - 2 vérifications pending (1 CI >48h alerte, 1 CG >48h alerte)
--
-- ## Couverture (par section)
--   A. Gates (4)              : ADMIN_REQUIRED, INVALID_PAYS, INVALID_WINDOW × 3 RPCs
--   B. Liquidity exact (20)   : supply_health + demand_engagement × CI/CG/ALL
--   C. Activation exact (16)  : signups + funnel cohorte + trust_quality
--   D. Revenue exact (20)     : XOF/XAF/FCFA/EUR + breakdown + ARPU + monthly
--   E. Alerts mig 116 (8)     : 4 counts × 3 pays + total
--   F. Export CSV (10)        : 6 datasets + SHA256 + escape RFC 4180 + filter
--   G. Edge cases (5)         : 0-data shape, cross-pays leak, window boundary
--   H. Invariants (4)         : régression mig 80 (cohorte stricte, ARPU stable)
--
-- TOTAL : ~85 assertions exactes (vs 30 dans la v1 du test).
--
-- Cf. docs/backend/admin_kpis.md. Migs couvertes : 111-116 + 103.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(87);

-- ═══════════════════════════════════════════════════════════════════════════
-- SETUP : fixture déterministe
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_alice uuid := '11111111-aaaa-bbbb-cccc-111111111111';
  v_bob   uuid := '22222222-aaaa-bbbb-cccc-222222222222';
  v_carol uuid := '33333333-aaaa-bbbb-cccc-333333333333';
  v_dave  uuid := '44444444-aaaa-bbbb-cccc-444444444444';  -- CI suspended admin
  v_dieu  uuid := '55555555-aaaa-bbbb-cccc-555555555555';  -- CG
  v_emma  uuid := '66666666-aaaa-bbbb-cccc-666666666666';  -- CG
  v_dom   uuid := '99999999-aaaa-bbbb-cccc-999999999999';  -- admin (CI, >30j)
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, created_at)
  values
    (v_alice, 'alice-kpi@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','Kpi','pays','CI','telephone','+2250700111111','auth_provider','email'),
     '{}'::jsonb, now() - interval '20 days', now() - interval '20 days'),
    (v_bob,   'bob-kpi@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','Kpi','pays','CI','telephone','+2250700222222','auth_provider','email'),
     '{}'::jsonb, now() - interval '15 days', now() - interval '15 days'),
    (v_carol, 'carol-kpi@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Carol','nom','Kpi','pays','CI','telephone','+2250700333333','auth_provider','email'),
     '{}'::jsonb, now() - interval '5 days', now() - interval '5 days'),
    (v_dave,  'dave-kpi@niqo.test',  crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Dave','nom','Kpi','pays','CI','telephone','+2250700444444','auth_provider','email'),
     '{}'::jsonb, now() - interval '8 days', now() - interval '8 days'),
    (v_dieu,  'dieu-kpi@niqo.test',  crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Dieu','nom','Kpi','pays','CG','telephone','+2420600111111','auth_provider','email'),
     '{}'::jsonb, now() - interval '10 days', now() - interval '10 days'),
    (v_emma,  'emma-kpi@niqo.test',  crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Emma','nom','Kpi','pays','CG','telephone','+2420600222222','auth_provider','email'),
     '{}'::jsonb, now() - interval '7 days', now() - interval '7 days'),
    (v_dom,   'dom-kpi@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Dom','nom','Admin','pays','CI','telephone','+2250700999999','auth_provider','email'),
     '{}'::jsonb, now() - interval '90 days', now() - interval '90 days');

  -- Aligne created_at + flags users (le trigger handle_new_user a créé le profil
  -- public.users automatiquement, on UPDATE pour synchroniser dates + flags).
  update public.users set created_at = now() - interval '20 days',
    is_verified = true, nb_ventes = 6, note_vendeur = 4.5, is_active = true, score_abus = 0
    where id = v_alice;
  update public.users set created_at = now() - interval '15 days',
    is_verified = true, nb_ventes = 2, note_vendeur = 3.0, is_active = true, score_abus = 0
    where id = v_bob;
  update public.users set created_at = now() - interval '5 days',
    is_verified = false, is_active = false, score_abus = 4,
    updated_at = now() - interval '3 days'
    where id = v_carol;  -- suspended AUTO (score >= 3)
  update public.users set created_at = now() - interval '8 days',
    is_verified = false, is_active = false, score_abus = 1,
    updated_at = now() - interval '3 days'
    where id = v_dave;   -- suspended ADMIN (score < 3)
  update public.users set created_at = now() - interval '10 days',
    is_verified = false, is_active = true
    where id = v_dieu;
  update public.users set created_at = now() - interval '7 days',
    is_verified = true, is_active = true
    where id = v_emma;
  update public.users set created_at = now() - interval '90 days',
    is_active = true, is_admin = true
    where id = v_dom;
end $$;

-- ─── Annonces ────────────────────────────────────────────────────────────────
-- CI : a1 nouvelle (Alice 2j), a2 ancienne (Alice 40j hors fenêtre 30j), a3 expirée (Alice
--      updated 2j ago), b1 (Bob 3j)
-- CG : d1 (Dieu 5j), d2 (Dieu 8j)
insert into public.annonces (id, vendeur_id, titre, description, prix, ville, pays, etat, statut, created_at, updated_at, expires_at, categorie_id, nb_vues)
values
  ('aaaaaaaa-cccc-1111-1111-111111111111'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid,
   'Annonce Alice nouvelle', 'Récente window 30j', 50000, 'Abidjan', 'CI', 'bon', 'active',
   now() - interval '2 days', now() - interval '2 days', now() + interval '58 days',
   (select id from public.categories order by ordre asc limit 1), 100),
  ('aaaaaaaa-cccc-2222-2222-222222222222'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid,
   'Annonce Alice ancienne', 'Hors fenêtre 30j', 30000, 'Abidjan', 'CI', 'bon', 'active',
   now() - interval '40 days', now() - interval '40 days', now() + interval '20 days',
   (select id from public.categories order by ordre asc limit 1), 50),
  ('aaaaaaaa-cccc-3333-3333-333333333333'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid,
   'Annonce Alice expirée', 'updated_at récent', 20000, 'Abidjan', 'CI', 'bon', 'expiree',
   now() - interval '70 days', now() - interval '2 days', now() - interval '2 days',
   (select id from public.categories order by ordre asc limit 1), 30),
  ('bbbbbbbb-cccc-1111-1111-111111111111'::uuid, '22222222-aaaa-bbbb-cccc-222222222222'::uuid,
   'Annonce Bob', 'Window 30j fixture', 25000, 'Abidjan', 'CI', 'bon', 'active',
   now() - interval '3 days', now() - interval '3 days', now() + interval '57 days',
   (select id from public.categories order by ordre asc limit 1), 40),
  ('dddddddd-cccc-1111-1111-111111111111'::uuid, '55555555-aaaa-bbbb-cccc-555555555555'::uuid,
   'Annonce Dieu 1', 'Brazzaville fixture description', 100000, 'Brazzaville', 'CG', 'bon', 'active',
   now() - interval '5 days', now() - interval '5 days', now() + interval '55 days',
   (select id from public.categories order by ordre asc limit 1), 20),
  ('dddddddd-cccc-2222-2222-222222222222'::uuid, '55555555-aaaa-bbbb-cccc-555555555555'::uuid,
   'Annonce Dieu 2 "spéciale, avec virgule"', 'CSV escape test', 75000, 'Brazzaville', 'CG', 'bon', 'active',
   now() - interval '8 days', now() - interval '8 days', now() + interval '52 days',
   (select id from public.categories order by ordre asc limit 1), 15);

-- ─── Paiements completed ────────────────────────────────────────────────────
-- Calculs attendus :
--   CI = 1k verif Alice + 1k boost7 Alice + 3k boost30 Alice + 1k verif Bob = 6 000 FCFA
--   CG = 1k boost7 Dieu + 1k verif Emma = 2 000 FCFA
--   ALL = 8 000 FCFA
insert into public.paiements_niqo (id, user_id, type, target_id, montant_fcfa, statut, completed_at, created_at)
values
  ('00000001-cccc-1111-1111-111111111111'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid, 'verification', null,
   1000, 'completed', now() - interval '5 days', now() - interval '5 days'),
  ('00000002-cccc-1111-1111-111111111111'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid, 'boost',
   'aaaaaaaa-cccc-1111-1111-111111111111'::uuid, 1000, 'completed', now() - interval '4 days', now() - interval '4 days'),
  ('00000003-cccc-1111-1111-111111111111'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid, 'boost',
   'aaaaaaaa-cccc-2222-2222-222222222222'::uuid, 3000, 'completed', now() - interval '3 days', now() - interval '3 days'),
  ('00000004-cccc-2222-2222-222222222222'::uuid, '22222222-aaaa-bbbb-cccc-222222222222'::uuid, 'verification', null,
   1000, 'completed', now() - interval '2 days', now() - interval '2 days'),
  ('00000005-cccc-4444-4444-444444444444'::uuid, '55555555-aaaa-bbbb-cccc-555555555555'::uuid, 'boost',
   'dddddddd-cccc-1111-1111-111111111111'::uuid, 1000, 'completed', now() - interval '1 day', now() - interval '1 day'),
  ('00000006-cccc-5555-5555-555555555555'::uuid, '66666666-aaaa-bbbb-cccc-666666666666'::uuid, 'verification', null,
   1000, 'completed', now() - interval '6 days', now() - interval '6 days');

-- Paiement boost STUCK pending >1h (mig 116 alert)
insert into public.paiements_niqo (id, user_id, type, target_id, montant_fcfa, statut, created_at)
values
  ('00000007-cccc-1111-1111-111111111111'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid, 'boost',
   'aaaaaaaa-cccc-1111-1111-111111111111'::uuid, 1000, 'pending', now() - interval '2 hours');

-- ─── Push tokens (DAU/WAU/MAU) ──────────────────────────────────────────────
-- CI :
--   Alice push -1h    → DAU CI=1
--   Bob push -3 days  → WAU CI (DAU + WAU)
--   Carol push -20 days → MAU CI only
--   Dom push -100 days → aucun (filtré out)
-- CG :
--   Dieu push -5 days → WAU + MAU CG
--   Emma push -25 days → MAU CG only

insert into public.push_tokens (user_id, token, platform, last_seen_at)
values
  ('11111111-aaaa-bbbb-cccc-111111111111'::uuid, 'tok_alice_kpi_123456789', 'ios', now() - interval '1 hour'),
  ('22222222-aaaa-bbbb-cccc-222222222222'::uuid, 'tok_bob_kpi_123456789',   'ios', now() - interval '3 days'),
  ('33333333-aaaa-bbbb-cccc-333333333333'::uuid, 'tok_carol_kpi_123456789', 'ios', now() - interval '20 days'),
  ('99999999-aaaa-bbbb-cccc-999999999999'::uuid, 'tok_dom_kpi_123456789',   'ios', now() - interval '100 days'),
  ('55555555-aaaa-bbbb-cccc-555555555555'::uuid, 'tok_dieu_kpi_123456789',  'ios', now() - interval '5 days'),
  ('66666666-aaaa-bbbb-cccc-666666666666'::uuid, 'tok_emma_kpi_123456789',  'ios', now() - interval '25 days');

-- ─── Conversations ──────────────────────────────────────────────────────────
-- conv1 sur a1 (Alice CI), acheteur=Bob, vendeur=Alice, rdv_propose -3h
-- conv2 sur b1 (Bob CI), acheteur=Carol, vendeur=Bob, sans rdv
-- conv3 sur d1 (Dieu CG), acheteur=Emma, vendeur=Dieu, rdv_propose -2h
-- Note : conversations.unique (annonce_id, acheteur_id) — donc distinct OK.

insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, created_at, rdv_propose_at, rdv_propose_par, rdv_lieu, rdv_date)
values
  ('cccccccc-1111-1111-1111-111111111111'::uuid,
   'aaaaaaaa-cccc-1111-1111-111111111111'::uuid,
   '22222222-aaaa-bbbb-cccc-222222222222'::uuid,
   '11111111-aaaa-bbbb-cccc-111111111111'::uuid,
   now() - interval '4 hours', now() - interval '3 hours',
   '11111111-aaaa-bbbb-cccc-111111111111'::uuid,
   'Cocody', now() + interval '1 day'),
  ('cccccccc-2222-2222-2222-222222222222'::uuid,
   'bbbbbbbb-cccc-1111-1111-111111111111'::uuid,
   '33333333-aaaa-bbbb-cccc-333333333333'::uuid,
   '22222222-aaaa-bbbb-cccc-222222222222'::uuid,
   now() - interval '2 hours', null, null, null, null),
  ('cccccccc-3333-3333-3333-333333333333'::uuid,
   'dddddddd-cccc-1111-1111-111111111111'::uuid,
   '66666666-aaaa-bbbb-cccc-666666666666'::uuid,
   '55555555-aaaa-bbbb-cccc-555555555555'::uuid,
   now() - interval '2 hours', now() - interval '1 hour',
   '55555555-aaaa-bbbb-cccc-555555555555'::uuid,
   'Plateau Brazza', now() + interval '1 day');

-- ─── Messages (pour time-to-first-contact P50) ──────────────────────────────
-- a1.created_at = now - 2 days → first msg @ -2 days + 1h → ttfc a1 = 1h
-- b1.created_at = now - 3 days → first msg @ -3 days + 2h → ttfc b1 = 2h
-- Median CI = (1+2)/2 = 1.5
-- d1.created_at = now - 5 days → first msg @ -5 days + 4h → ttfc d1 = 4h
-- Median CG = 4

insert into public.messages (id, conversation_id, expediteur_id, contenu, type, created_at)
values
  ('eeeeeeee-1111-1111-1111-111111111111'::uuid,
   'cccccccc-1111-1111-1111-111111111111'::uuid,
   '22222222-aaaa-bbbb-cccc-222222222222'::uuid,
   'Bonjour Alice', 'texte', now() - interval '2 days' + interval '1 hour'),
  ('eeeeeeee-2222-2222-2222-222222222222'::uuid,
   'cccccccc-2222-2222-2222-222222222222'::uuid,
   '33333333-aaaa-bbbb-cccc-333333333333'::uuid,
   'Bonjour Bob', 'texte', now() - interval '3 days' + interval '2 hours'),
  ('eeeeeeee-3333-3333-3333-333333333333'::uuid,
   'cccccccc-3333-3333-3333-333333333333'::uuid,
   '66666666-aaaa-bbbb-cccc-666666666666'::uuid,
   'Bonjour Dieu', 'texte', now() - interval '5 days' + interval '4 hours');

-- ─── Avis (pour funnel completed_first_rdv) ─────────────────────────────────
-- Bob (CI, cohort signup) émet 1 avis → completed_first_rdv CI = 1
insert into public.avis (id, conversation_id, auteur_id, cible_id, note, commentaire, role_auteur, created_at)
values
  ('ffffffff-1111-1111-1111-111111111111'::uuid,
   'cccccccc-1111-1111-1111-111111111111'::uuid,
   '22222222-aaaa-bbbb-cccc-222222222222'::uuid,
   '11111111-aaaa-bbbb-cccc-111111111111'::uuid,
   5, 'Top vendeuse', 'acheteur', now() - interval '1 hour');

-- ─── Signalements (mig 116 alerts) ──────────────────────────────────────────
-- sig1 : pending -25h → alert
-- sig2 : pending -10h → NOT alert
-- sig3 : traité → NOT alert
insert into public.signalements (id, target_type, target_id, signaleur_id, motif, statut, created_at, updated_at)
values
  ('11111111-fffd-1111-1111-111111111111'::uuid, 'annonce',
   'bbbbbbbb-cccc-1111-1111-111111111111'::uuid,
   '33333333-aaaa-bbbb-cccc-333333333333'::uuid, 'spam',
   'en_attente', now() - interval '25 hours', now() - interval '25 hours'),
  ('22222222-fffd-1111-1111-111111111111'::uuid, 'utilisateur',
   '22222222-aaaa-bbbb-cccc-222222222222'::uuid,
   '11111111-aaaa-bbbb-cccc-111111111111'::uuid, 'arnaque',
   'en_attente', now() - interval '10 hours', now() - interval '10 hours'),
  ('33333333-fffd-1111-1111-111111111111'::uuid, 'annonce',
   'dddddddd-cccc-1111-1111-111111111111'::uuid,
   '66666666-aaaa-bbbb-cccc-666666666666'::uuid, 'doublon',
   'traite', now() - interval '5 days', now() - interval '3 days');

-- ─── Vérifications KYC pending (mig 116 alerts) ─────────────────────────────
-- v1 : Alice (CI), pending -50h (>48h) → alert CI + ALL
-- v2 : Dieu (CG), pending -55h (>48h) → alert CG + ALL
-- v3 : Bob (CI), pending -20h (<48h) → NOT alert
-- Note : la table verifications_identite a un FK NOT NULL sur paiements_niqo.
-- On crée 3 paiements vérification supplémentaires STATUT='pending' pour ne pas
-- polluer le revenue (qui filtre statut='completed').
insert into public.paiements_niqo (id, user_id, type, target_id, montant_fcfa, statut, created_at)
values
  ('00000008-cccc-1111-1111-111111111111'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid, 'verification', null,
   1000, 'pending', now() - interval '51 hours'),
  ('00000009-cccc-4444-4444-444444444444'::uuid, '55555555-aaaa-bbbb-cccc-555555555555'::uuid, 'verification', null,
   1000, 'pending', now() - interval '56 hours'),
  ('00000010-cccc-2222-2222-222222222222'::uuid, '22222222-aaaa-bbbb-cccc-222222222222'::uuid, 'verification', null,
   1000, 'pending', now() - interval '21 hours');

insert into public.verifications_identite (id, user_id, paiement_id, cni_recto_path, cni_verso_path, selfie_path, statut, created_at)
values
  ('aaaaaaaa-fff1-1111-1111-111111111111'::uuid, '11111111-aaaa-bbbb-cccc-111111111111'::uuid,
   '00000008-cccc-1111-1111-111111111111'::uuid,
   '11111111-aaaa-bbbb-cccc-111111111111/recto.jpg',
   '11111111-aaaa-bbbb-cccc-111111111111/verso.jpg',
   '11111111-aaaa-bbbb-cccc-111111111111/selfie.jpg',
   'pending', now() - interval '50 hours'),
  ('aaaaaaaa-fff2-1111-1111-111111111111'::uuid, '55555555-aaaa-bbbb-cccc-555555555555'::uuid,
   '00000009-cccc-4444-4444-444444444444'::uuid,
   '55555555-aaaa-bbbb-cccc-555555555555/recto.jpg',
   '55555555-aaaa-bbbb-cccc-555555555555/verso.jpg',
   '55555555-aaaa-bbbb-cccc-555555555555/selfie.jpg',
   'pending', now() - interval '55 hours'),
  ('aaaaaaaa-fff3-1111-1111-111111111111'::uuid, '22222222-aaaa-bbbb-cccc-222222222222'::uuid,
   '00000010-cccc-2222-2222-222222222222'::uuid,
   '22222222-aaaa-bbbb-cccc-222222222222/recto.jpg',
   '22222222-aaaa-bbbb-cccc-222222222222/verso.jpg',
   '22222222-aaaa-bbbb-cccc-222222222222/selfie.jpg',
   'pending', now() - interval '20 hours');

-- ═══════════════════════════════════════════════════════════════════════════
-- A. Gates communes (4 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- A1. liquidity sans admin → ADMIN_REQUIRED
select tests.set_jwt_for('11111111-aaaa-bbbb-cccc-111111111111'::uuid);
select throws_ok(
  $$ select public.admin_kpis_liquidity(null, null, null) $$,
  'ADMIN_REQUIRED',
  'A1. liquidity bloquée si non-admin'
);

-- Bascule admin pour tous les autres tests
select tests.set_jwt_for('99999999-aaaa-bbbb-cccc-999999999999'::uuid);

select throws_like(
  $$ select public.admin_kpis_liquidity(null, null, 'XX') $$,
  '%INVALID_PAYS%',
  'A2. liquidity rejette pays inconnu'
);
select throws_like(
  $$ select public.admin_kpis_activation(null, null, 'FR') $$,
  '%INVALID_PAYS%',
  'A3. activation rejette pays inconnu'
);
select throws_like(
  $$ select public.admin_kpis_liquidity(now(), now() - interval '1 day', null) $$,
  '%INVALID_WINDOW%',
  'A4. window inversée rejetée'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- B. Liquidity exact (20 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- Fenêtre 30 derniers jours utilisée partout

-- ── supply_health (CI) ──
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'supply_health' ->> 'annonces_nouvelles_period')::int,
  2,
  'B1. CI annonces_nouvelles_period = 2 (Alice 2j + Bob 3j ; Alice 40j hors fenêtre)'
);
select is(
  (public.admin_kpis_liquidity(null, null, 'CI') -> 'supply_health' ->> 'annonces_actives_total')::int,
  3,
  'B2. CI annonces_actives_total = 3 (Alice 2 actives + Bob 1)'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'supply_health' ->> 'annonces_expirees_period')::int,
  1,
  'B3. CI annonces_expirees_period = 1 (Alice expirée updated -2j)'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'supply_health' ->> 'contacts_per_annonce_avg')::numeric,
  1.00::numeric,
  'B4. CI contacts/annonce = 1.00 (2 convs / 2 annonces nouvelles)'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'supply_health' ->> 'time_to_first_contact_p50_hrs')::numeric,
  1.5::numeric,
  'B5. CI time-to-first-contact P50 = 1.5h (median de [1h, 2h])'
);

-- ── supply_health (CG) ──
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CG') -> 'supply_health' ->> 'annonces_nouvelles_period')::int,
  2,
  'B6. CG annonces_nouvelles_period = 2 (Dieu 5j + Dieu 8j)'
);
select is(
  (public.admin_kpis_liquidity(null, null, 'CG') -> 'supply_health' ->> 'annonces_actives_total')::int,
  2,
  'B7. CG annonces_actives_total = 2 (Dieu)'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CG') -> 'supply_health' ->> 'annonces_expirees_period')::int,
  0,
  'B8. CG annonces_expirees_period = 0'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CG') -> 'supply_health' ->> 'contacts_per_annonce_avg')::numeric,
  0.50::numeric,
  'B9. CG contacts/annonce = 0.50 (1 conv / 2 annonces)'
);

-- ── supply_health (ALL) ──
select is(
  (public.admin_kpis_liquidity(null, null, null) -> 'supply_health' ->> 'annonces_actives_total')::int,
  5,
  'B10. ALL annonces_actives_total = 5 (3 CI + 2 CG)'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), null) -> 'supply_health' ->> 'annonces_nouvelles_period')::int,
  4,
  'B11. ALL annonces_nouvelles_period = 4 (2 CI + 2 CG)'
);

-- ── demand_engagement (CI) ──
select is(
  (public.admin_kpis_liquidity(null, null, 'CI') -> 'demand_engagement' ->> 'dau')::int,
  1,
  'B12. CI DAU = 1 (Alice last_seen -1h)'
);
select is(
  (public.admin_kpis_liquidity(null, null, 'CI') -> 'demand_engagement' ->> 'wau')::int,
  2,
  'B13. CI WAU = 2 (Alice + Bob ; Carol -20j hors 7j)'
);
select is(
  (public.admin_kpis_liquidity(null, null, 'CI') -> 'demand_engagement' ->> 'mau')::int,
  3,
  'B14. CI MAU = 3 (Alice + Bob + Carol ; Dom -100j hors 30j)'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'demand_engagement' ->> 'vues_total_period')::int,
  140,
  'B15. CI vues_total = 140 (a1 100 + b1 40 ; a2 50 hors fenêtre)'
);
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'demand_engagement' ->> 'conversations_initiated_period')::int,
  2,
  'B16. CI conversations_initiated = 2 (conv1 + conv2)'
);

-- ── demand_engagement (CG) ──
select is(
  (public.admin_kpis_liquidity(null, null, 'CG') -> 'demand_engagement' ->> 'dau')::int,
  0,
  'B17. CG DAU = 0'
);
select is(
  (public.admin_kpis_liquidity(null, null, 'CG') -> 'demand_engagement' ->> 'mau')::int,
  2,
  'B18. CG MAU = 2 (Dieu + Emma)'
);

-- ── nullif div/0 ──
-- Fenêtre 90j → 60j ago : 0 annonces → contacts_per_annonce_avg = null
select is(
  public.admin_kpis_liquidity(now() - interval '90 days', now() - interval '60 days', 'CG')
    -> 'supply_health' ->> 'contacts_per_annonce_avg',
  null,
  'B19. nullif protège contacts/annonce quand 0 annonces (failure mode div/0)'
);

-- vues_to_contact_pct (CI) = 2 conv / 140 vues * 100 = 1.43%
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'demand_engagement' ->> 'vues_to_contact_pct')::numeric,
  1.43::numeric,
  'B20. CI vues→contact = 1.43% (2 conv / 140 vues)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- C. Activation exact (16 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── signups (CI) ──
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'signups' ->> 'total_period')::int,
  4,
  'C1. CI signups = 4 (Alice + Bob + Carol + Dave ; Dom -90j hors fenêtre)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'signups' ->> 'total_prev_period')::int,
  0,
  'C2. CI signups prev = 0 (personne dans [-60j, -30j[ ; Dom -90j trop ancien)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'signups' ->> 'delta_pct_vs_prev_period')::numeric,
  100::numeric,
  'C3. CI delta = 100% (règle when prev=0 and curr>0 then 100)'
);

-- ── signups (CG) ──
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CG') -> 'signups' ->> 'total_period')::int,
  2,
  'C4. CG signups = 2 (Dieu + Emma)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), null) -> 'signups' ->> 'total_period')::int,
  6,
  'C5. ALL signups = 6 (4 CI + 2 CG)'
);

-- ── funnel (CI) cohorte = 4 ──
-- published_first_annonce CI : Alice (a1, a2, a3) + Bob (b1) = 2/4
-- proposed_first_rdv CI : Alice (vendeur conv1 avec rdv_propose) = 1/4
-- completed_first_rdv CI : Bob (auteur avis1) = 1/4
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'published_first_annonce')::int,
  2,
  'C6. CI funnel published = 2/4 (Alice + Bob)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'proposed_first_rdv')::int,
  1,
  'C7. CI funnel proposed_rdv = 1 (Alice vendeur conv1)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'completed_first_rdv')::int,
  1,
  'C8. CI funnel completed_rdv = 1 (Bob auteur avis1)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'signup_to_publish_pct')::numeric,
  50.0::numeric,
  'C9. CI signup→publish = 50% (2/4)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'publish_to_rdv_pct')::numeric,
  50.0::numeric,
  'C10. CI publish→rdv = 50% (1/2)'
);
select is(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'rdv_to_avis_pct')::numeric,
  100.0::numeric,
  'C11. CI rdv→avis = 100% (1/1)'
);

-- ── trust_quality (CI) snapshot alltime ──
-- total_users CI = 5 (Alice + Bob + Carol + Dave + Dom)
select is(
  (public.admin_kpis_activation(null, null, 'CI') -> 'trust_quality' ->> 'total_users')::int,
  5,
  'C12. CI total_users = 5 (Alice + Bob + Carol + Dave + Dom)'
);
select is(
  (public.admin_kpis_activation(null, null, 'CI') -> 'trust_quality' ->> 'verified')::int,
  2,
  'C13. CI verified = 2 (Alice + Bob)'
);
select is(
  (public.admin_kpis_activation(null, null, 'CI') -> 'trust_quality' ->> 'verified_pct')::numeric,
  40.0::numeric,
  'C14. CI verified_pct = 40% (2/5)'
);
select is(
  (public.admin_kpis_activation(null, null, 'CI') -> 'trust_quality' ->> 'vendeur_fiable')::int,
  1,
  'C15. CI vendeur_fiable = 1 (Alice : nb_ventes=6 ≥5 ET note=4.5 ≥4.0)'
);
select is(
  (public.admin_kpis_activation(null, null, 'CI') -> 'trust_quality' ->> 'suspended_auto_score')::int,
  1,
  'C16. CI suspended_auto = 1 (Carol score_abus=4 ≥3)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- D. Revenue exact (20 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── totaux période (ALL) ──
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' ->> 'total_fcfa_period')::int,
  8000,
  'D1. ALL total_fcfa = 8000 (CI 6k + CG 2k)'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' ->> 'total_xof_period')::int,
  6000,
  'D2. ALL total_xof = 6000 (paiements user.pays=CI)'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' ->> 'total_xaf_period')::int,
  2000,
  'D3. ALL total_xaf = 2000 (paiements user.pays=CG)'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' ->> 'total_eur_period')::numeric,
  12.20::numeric,
  'D4. ALL total_eur = 12.20 (8000 / 655.957 round 2)'
);

-- ── totaux CI filtré (cross-pays leak check) ──
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CI') -> 'revenue' ->> 'total_fcfa_period')::int,
  6000,
  'D5. CI total_fcfa = 6000 (filter strict)'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CI') -> 'revenue' ->> 'total_xaf_period')::int,
  0,
  'D6. CI total_xaf = 0 (filter CI exclude CG strict)'
);

-- ── totaux CG filtré ──
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CG') -> 'revenue' ->> 'total_fcfa_period')::int,
  2000,
  'D7. CG total_fcfa = 2000'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CG') -> 'revenue' ->> 'total_xof_period')::int,
  0,
  'D8. CG total_xof = 0 (filter CG exclude CI strict)'
);

-- ── breakdown verifications (ALL) ──
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' -> 'verifications' ->> 'count')::int,
  3,
  'D9. ALL verifications count = 3 (Alice + Bob + Emma)'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' -> 'verifications' ->> 'total_fcfa')::int,
  3000,
  'D10. ALL verifications total = 3000'
);

-- ── breakdown boosts 7j (ALL) ──
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' -> 'boosts_7j' ->> 'count')::int,
  2,
  'D11. ALL boosts_7j count = 2 (Alice + Dieu)'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' -> 'boosts_7j' ->> 'total_fcfa')::int,
  2000,
  'D12. ALL boosts_7j total = 2000'
);

-- ── breakdown boosts 30j (ALL) ──
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' -> 'boosts_30j' ->> 'count')::int,
  1,
  'D13. ALL boosts_30j count = 1 (Alice)'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' -> 'boosts_30j' ->> 'total_fcfa')::int,
  3000,
  'D14. ALL boosts_30j total = 3000'
);

-- ── breakdown filtré CI ──
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CI') -> 'revenue' -> 'boosts_30j' ->> 'count')::int,
  1,
  'D15. CI boosts_30j count = 1'
);
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CG') -> 'revenue' -> 'boosts_30j' ->> 'count')::int,
  0,
  'D16. CG boosts_30j count = 0 (cross-pays exclude)'
);

-- ── ARPU ──
-- CI : revenu 6000 / 655.957 / 2 vendeurs distincts = 4.57
select is(
  (public.admin_kpis_revenue(null, null, 'CI') -> 'arpu' ->> 'eur_alltime')::numeric,
  4.57::numeric,
  'D17. CI ARPU alltime = 4.57€ (6000 FCFA / 655.957 / 2 vendeurs Alice+Bob)'
);
-- CG : 2000 / 655.957 / 1 = 3.05
select is(
  (public.admin_kpis_revenue(null, null, 'CG') -> 'arpu' ->> 'eur_alltime')::numeric,
  3.05::numeric,
  'D18. CG ARPU alltime = 3.05€ (1 vendeur Dieu)'
);

-- ── alltime ──
select is(
  (public.admin_kpis_revenue(null, null, null) -> 'alltime' ->> 'total_fcfa')::int,
  8000,
  'D19. ALL alltime total_fcfa = 8000'
);
select is(
  (public.admin_kpis_revenue(null, null, null) -> 'alltime' ->> 'vendeurs_distinct')::int,
  3,
  'D20. ALL vendeurs distinct = 3 (Alice + Bob + Dieu)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Alerts mig 116 (8 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- ALL = sig 1 + kyc 2 + boost stuck 1 + suspended 30d 2 = 6
select is(
  (public.admin_kpis_alerts(null) ->> 'signalements_pending_24h_plus')::int,
  1,
  'E1. ALL signalements pending >24h = 1 (sig1 -25h)'
);
select is(
  (public.admin_kpis_alerts(null) ->> 'kyc_pending_48h_plus')::int,
  2,
  'E2. ALL kyc pending >48h = 2 (v1 Alice + v2 Dieu ; v3 Bob -20h exclu)'
);
select is(
  (public.admin_kpis_alerts(null) ->> 'boosts_stuck_pending')::int,
  1,
  'E3. ALL boosts stuck = 1 (p7 Alice pending -2h)'
);
select is(
  (public.admin_kpis_alerts(null) ->> 'suspended_30d')::int,
  2,
  'E4. ALL suspended 30d = 2 (Carol + Dave updated -3d)'
);
select is(
  (public.admin_kpis_alerts(null) ->> 'total')::int,
  6,
  'E5. ALL alerts total = 6 (1+2+1+2)'
);

-- Filtre pays CI (sig non filtré par pays en V1)
select is(
  (public.admin_kpis_alerts('CI') ->> 'kyc_pending_48h_plus')::int,
  1,
  'E6. CI kyc pending >48h = 1 (Alice ; Dieu exclu)'
);
select is(
  (public.admin_kpis_alerts('CI') ->> 'suspended_30d')::int,
  2,
  'E7. CI suspended 30d = 2 (Carol + Dave)'
);
select is(
  (public.admin_kpis_alerts('CG') ->> 'suspended_30d')::int,
  0,
  'E8. CG suspended 30d = 0 (no CG suspended)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- F. Export CSV (10 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- F1. INVALID_DATASET
select throws_like(
  $$ select public.admin_export_dataset('inconnu', null, null, null) $$,
  '%INVALID_DATASET%',
  'F1. dataset inconnu rejeté'
);

-- F2. CSV users header
-- Note: ok(... LIKE ...) plutôt que pgTAP like() — le keyword SQL `LIKE` entre
-- en collision avec la résolution de signature pgTAP `like(text,text,text)`
-- pour les litéraux non-castés (`function like(text, unknown, unknown) does not exist`).
select ok(
  substring(public.admin_export_dataset('users', now() - interval '30 days', now(), 'CI') from 1 for 100)
    like 'id,created_at,prenom,nom,pays,ville,email,telephone_sha256%',
  'F2. CSV users header RFC 4180'
);

-- F3. SHA256 hex pattern (preuve hash actif, pas de PII en clair)
select ok(
  public.admin_export_dataset('users', null, null, 'CI') ~ '"[0-9a-f]{64}"',
  'F3. CSV users contient hash SHA256 (64 chars hex)'
);

-- F4. Pas de leak +225 en clair
select ok(
  public.admin_export_dataset('users', null, null, 'CI') !~ '\+225[0-9]{10}',
  'F4. CSV users : aucun +225 en clair (RGPD)'
);

-- F5. CSV escape : annonce "Dieu 2 \"spéciale, avec virgule\"" doit être quoted + escaped
select ok(
  public.admin_export_dataset('annonces', null, null, 'CG') ~ '""spéciale, avec virgule""',
  'F5. CSV escape : guillemets internes doublés RFC 4180'
);

-- F6. CSV annonces filtre CI (cross-pays exclude)
select ok(
  public.admin_export_dataset('annonces', null, null, 'CI') !~ 'Brazzaville',
  'F6. CSV annonces CI : pas de ligne Brazzaville (filter strict)'
);

-- F7. CSV paiements CI : 4 paiements completed dans window 30j
-- Alice 3 (p1 verif + p2 boost7 + p3 boost30) + Bob 1 (p4 verif) = 4 rows
-- (Les paiements pending KYC p8/p10 sont filtrés out statut='completed')
select is(
  (
    length(public.admin_export_dataset('paiements', now() - interval '30 days', now(), 'CI'))
    -
    length(replace(public.admin_export_dataset('paiements', now() - interval '30 days', now(), 'CI'), E'\n', ''))
  ),
  4,  -- 1 header + 4 paiements CI completed = 5 lines = 4 newlines
  'F7. CSV paiements CI : 4 newlines (header + Alice 3 + Bob 1)'
);

-- F8. CSV signalements (pas filtré pays)
select ok(
  substring(public.admin_export_dataset('signalements', null, null, null) from 1 for 80)
    like 'id,created_at,statut,target_type,target_id,signaleur_id,motif%',
  'F8. CSV signalements header correct (target_type/target_id corrects vs mig 25)'
);

-- F9. Window passé : aucune ligne (test bornes inférieures)
select is(
  public.admin_export_dataset('annonces', now() - interval '120 days', now() - interval '90 days', 'CI'),
  'id,created_at,vendeur_id,vendeur_nom,titre,categorie_id,statut,prix_fcfa,pays,ville,nb_vues,is_boosted'
  || E'\n',
  'F9. CSV annonces window vide : juste le header + newline'
);

-- F10. Audit log : 1 entrée export_users par appel
select cmp_ok(
  (select count(*)::int from public.audit_log_admin
    where action = 'export_users'
      and admin_id = '99999999-aaaa-bbbb-cccc-999999999999'::uuid),
  '>=',
  1,
  'F10. Audit log : ≥1 entrée export_users par admin (calls ci-dessus en ont fait plusieurs)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- G. Edge cases (5 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- G1. RPC avec 0 data : retourne JSON valide (pas d'erreur)
select ok(
  (public.admin_kpis_liquidity(now() - interval '5 years', now() - interval '4 years', 'CI')
    ->> 'pays') = 'CI',
  'G1. RPC liquidity 0-data : JSON shape valide (pays=CI)'
);

-- G2. Cross-pays leak : revenue.total_xaf doit être 0 quand filtre CI
select is(
  (public.admin_kpis_revenue(null, null, 'CI') -> 'revenue' ->> 'total_xaf_period')::int,
  0,
  'G2. Revenue cross-pays : filtre CI → total_xaf = 0 strict'
);

-- G3. Window boundary : annonce a2 (created -40d) NE compte PAS dans fenêtre 30j
select is(
  (public.admin_kpis_liquidity(now() - interval '30 days', now(), 'CI') -> 'supply_health' ->> 'annonces_nouvelles_period')::int,
  2,
  'G3. Window boundary : annonce -40d hors fenêtre 30j (Alice a2 ignorée)'
);

-- G4. Pre-window data : window 60-30 days ago, doit contenir 0 annonces
-- (Alice a2 -40d est dedans → 1 annonce)
select is(
  (public.admin_kpis_liquidity(now() - interval '60 days', now() - interval '30 days', 'CI') -> 'supply_health' ->> 'annonces_nouvelles_period')::int,
  1,
  'G4. Pre-window 60-30j : Alice a2 (-40d) dedans = 1 annonce'
);

-- G5. Alerts filtre pays : signalements toujours retourné (V1 mig 116 ne filtre pas)
select is(
  (public.admin_kpis_alerts('CG') ->> 'signalements_pending_24h_plus')::int,
  1,
  'G5. Alerts : signalements non filtrés par pays en V1 (mig 116 §Simplification)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- H. Invariants régression mig 80 (4 assertions)
-- ═══════════════════════════════════════════════════════════════════════════

-- H1. Funnel cohorte stricte : published ≤ signed_up
select ok(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'published_first_annonce')::int
  <=
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'signed_up')::int,
  'H1. Funnel cohorte stricte : published ≤ signed_up'
);

-- H2. Funnel cohorte stricte : proposed ≤ published
select ok(
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'proposed_first_rdv')::int
  <=
  (public.admin_kpis_activation(now() - interval '30 days', now(), 'CI') -> 'activation_funnel' ->> 'published_first_annonce')::int,
  'H2. Funnel cohorte stricte : proposed_rdv ≤ published'
);

-- H3. ARPU alltime stable invariant filtre période (ne dépend pas du window)
select is(
  (public.admin_kpis_revenue(now() - interval '7 days', now(), 'CI') -> 'arpu' ->> 'eur_alltime')::numeric,
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CI') -> 'arpu' ->> 'eur_alltime')::numeric,
  'H3. ARPU alltime invariant fenêtre (=même valeur sur 7j et 30j)'
);

-- H4. Pays filter strict : sum(CI) + sum(CG) = sum(ALL) sur revenu période
select is(
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CI') -> 'revenue' ->> 'total_fcfa_period')::int
  +
  (public.admin_kpis_revenue(now() - interval '30 days', now(), 'CG') -> 'revenue' ->> 'total_fcfa_period')::int,
  (public.admin_kpis_revenue(now() - interval '30 days', now(), null) -> 'revenue' ->> 'total_fcfa_period')::int,
  'H4. Sum(CI) + Sum(CG) = Sum(ALL) revenu période'
);

select * from finish();
rollback;

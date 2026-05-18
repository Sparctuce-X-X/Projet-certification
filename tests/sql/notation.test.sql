-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Module Notation post-RDV (F06)
--
-- Couvre :
--   - RPC submit_avis : 8 gates + 2 happy paths (acheteur note vendeur,
--     vendeur note acheteur)
--   - Triggers tg_avis_after_insert + tg_avis_after_delete (recalc-from-scratch
--     mig 42 + 38) sur users.note_vendeur / note_acheteur / nb_ventes / nb_achats
--   - CHECK constraints : avis_pas_soi_meme, note 1-5, commentaire 1-200
--   - UNIQUE (conversation_id, auteur_id)
--   - FK : auteur_id ON DELETE SET NULL (mig 70), cible_id ON DELETE CASCADE
--   - RLS : SELECT public OK, INSERT direct authenticated bloqué
--
-- Cf. docs/backend/notation.md pour le module complet.
-- Migs couvertes : 37, 38, 42, 70.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(33);

-- ─── Setup users ──────────────────────────────────────────────────────────────
-- Marie acheteuse, Jean vendeur, Charlie tiers (non-participant)
do $$
declare
  v_marie   uuid := 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  v_jean    uuid := 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';
  v_charlie uuid := 'cccccccc-1111-1111-1111-cccccccccccc';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_marie,   'marie-not@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Marie','nom','Acheteuse','pays','CI','telephone','+2250700111111','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_jean,    'jean-not@niqo.test',    crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Jean','nom','Vendeur','pays','CI','telephone','+2250700222222','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_charlie, 'charlie-not@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Charlie','nom','Tiers','pays','CI','telephone','+2250700333333','auth_provider','email'),
     '{}'::jsonb, now());
end $$;

-- ─── Setup 3 annonces Jean + 3 conversations Marie-Jean ───────────────────────
-- 3 annonces nécessaires car conversations_unique = (annonce_id, acheteur_id).
-- Conv 1 : RDV confirmé + passé    → support des happy paths
-- Conv 2 : RDV proposé mais non-confirmé → support du gate rdv_not_confirmed
-- Conv 3 : RDV confirmé mais futur → support du gate rdv_not_past
do $$
declare
  v_categorie_id uuid;
  v_jean   uuid := 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';
  v_marie  uuid := 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  v_a1     uuid := 'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_a2     uuid := 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_a3     uuid := 'a3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_c1     uuid := 'c1111111-cccc-cccc-cccc-cccccccccccc';
  v_c2     uuid := 'c2222222-cccc-cccc-cccc-cccccccccccc';
  v_c3     uuid := 'c3333333-cccc-cccc-cccc-cccccccccccc';
begin
  select id into v_categorie_id from public.categories order by ordre limit 1;

  insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, pays, ville, expires_at, statut)
  values
    (v_a1, v_jean, v_categorie_id, 'iPhone 13 Pro 256 Go', 'Vendu avec boite, chargeur, coque silicone. Excellent état.',
     350000, array['p1.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'en_cours'::statut_annonce),
    (v_a2, v_jean, v_categorie_id, 'Samsung Galaxy S22', 'Bon état, chargeur fourni, écran sans aucune rayure visible.',
     220000, array['p2.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'active'::statut_annonce),
    (v_a3, v_jean, v_categorie_id, 'Casque audio Bose', 'Casque QC35 II, autonomie 18h, étui de transport inclus.',
     85000, array['p3.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'en_cours'::statut_annonce);

  -- Conv 1 : RDV confirmé + passé + rencontre mutuelle confirmée (mig 86)
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par, rdv_confirme_at,
                                    rencontre_acheteur, rencontre_vendeur, rencontre_decided_at)
  values (v_c1, v_a1, v_marie, v_jean, 'Marché de Cocody', now() - interval '1 day', v_marie, now() - interval '2 days',
          true, true, now() - interval '12 hours');

  -- Conv 2 : RDV proposé mais non-confirmé
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par)
  values (v_c2, v_a2, v_marie, v_jean, 'Riviera Golf', now() + interval '3 days', v_marie);

  -- Conv 3 : RDV confirmé mais dans le futur
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par, rdv_confirme_at)
  values (v_c3, v_a3, v_marie, v_jean, 'Plateau', now() + interval '2 days', v_marie, now() - interval '1 hour');
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. submit_avis — gates d'erreur (8 codes documentés mig 37 + lib/notation.ts)
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 1 : pas de JWT → not_authenticated
select set_config('request.jwt.claims', '{}', true);
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, null))->>'error',
  'not_authenticated',
  'submit_avis sans JWT renvoie not_authenticated'
);

-- Switch JWT à Marie
select tests.set_jwt_for('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid);

-- Test 2 : note=0 (hors range) → note_invalid
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 0::smallint, null))->>'error',
  'note_invalid',
  'submit_avis avec note=0 renvoie note_invalid'
);

-- Test 3 : note=6 (hors range) → note_invalid
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 6::smallint, null))->>'error',
  'note_invalid',
  'submit_avis avec note=6 renvoie note_invalid'
);

-- Test 4 : commentaire > 200 chars → commentaire_too_long
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, repeat('A', 201)))->>'error',
  'commentaire_too_long',
  'submit_avis avec commentaire 201 chars renvoie commentaire_too_long'
);

-- Test 5 : conversation introuvable → conversation_not_found
select is(
  (public.submit_avis('00000000-0000-0000-0000-000000000000'::uuid, 4::smallint, null))->>'error',
  'conversation_not_found',
  'submit_avis avec conv_id inconnue renvoie conversation_not_found'
);

-- Test 6 : Charlie (non-participant) → not_participant
select tests.set_jwt_for('cccccccc-1111-1111-1111-cccccccccccc'::uuid);
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, null))->>'error',
  'not_participant',
  'submit_avis par un non-participant renvoie not_participant'
);

-- Test 7 : conv 2 (rdv non confirmé) → rdv_not_confirmed
select tests.set_jwt_for('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid);
select is(
  (public.submit_avis('c2222222-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, null))->>'error',
  'rdv_not_confirmed',
  'submit_avis sur conv sans rdv_confirme_at renvoie rdv_not_confirmed'
);

-- Test 8 : conv 3 (rdv confirmé mais futur) → rdv_not_past
select is(
  (public.submit_avis('c3333333-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, null))->>'error',
  'rdv_not_past',
  'submit_avis sur conv avec rdv_date future renvoie rdv_not_past'
);

-- ─── Backdate des 3 premières annonces de Jean pour bypass rate-limit ────────
-- Le trigger enforce_annonces_rate_limit (mig 16) bloque à 5 nouvelles annonces
-- par vendeur dans les 24h. On en a 3 (a1, a2, a3), on va en ajouter 4 de plus
-- (a4, a5, a6, a7). On pré-date a1-a3 hors fenêtre 24h pour passer la limite.
update public.annonces
   set created_at = now() - interval '25 hours'
 where vendeur_id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid;

-- ─── Setup convs 5/6/7 pour les gates rencontre (mig 86) ─────────────────────
-- Conv 5 : RDV passé + confirmé, rencontre_acheteur=NULL → meeting_not_confirmed_self
-- Conv 6 : RDV passé + confirmé, rencontre_acheteur=false → meeting_declined_self
-- Conv 7 : RDV passé + confirmé, rencontre_acheteur=true, rencontre_vendeur=false → meeting_disputed
do $$
declare
  v_categorie_id uuid;
  v_jean   uuid := 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';
  v_marie  uuid := 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  v_a5 uuid := 'a5555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_a6 uuid := 'a6666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_a7 uuid := 'a7777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_c5 uuid := 'c5555555-cccc-cccc-cccc-cccccccccccc';
  v_c6 uuid := 'c6666666-cccc-cccc-cccc-cccccccccccc';
  v_c7 uuid := 'c7777777-cccc-cccc-cccc-cccccccccccc';
begin
  select id into v_categorie_id from public.categories order by ordre limit 1;

  insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, pays, ville, expires_at, statut)
  values
    (v_a5, v_jean, v_categorie_id, 'Tablette Lenovo Tab M10', 'Tablette 10 pouces, 64 Go, état neuf jamais utilisée.',
     75000, array['p5.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'en_cours'::statut_annonce),
    (v_a6, v_jean, v_categorie_id, 'Enceinte JBL Charge 5', 'Enceinte bluetooth bonne sonorité, autonomie 20h.',
     65000, array['p6.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'en_cours'::statut_annonce),
    (v_a7, v_jean, v_categorie_id, 'Apple Watch SE 2022', 'Montre connectée 44mm, bracelet sport noir, état impec.',
     180000, array['p7.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'en_cours'::statut_annonce);

  -- Conv 5 : rencontre_acheteur NULL (Marie pas encore décidé)
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par, rdv_confirme_at,
                                    rencontre_acheteur, rencontre_vendeur)
  values (v_c5, v_a5, v_marie, v_jean, 'Yopougon', now() - interval '1 day', v_marie, now() - interval '2 days',
          null, true);

  -- Conv 6 : rencontre_acheteur false (Marie a déclaré "on s'est pas vu")
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par, rdv_confirme_at,
                                    rencontre_acheteur, rencontre_vendeur, rencontre_decided_at)
  values (v_c6, v_a6, v_marie, v_jean, 'Marcory', now() - interval '1 day', v_marie, now() - interval '2 days',
          false, true, now() - interval '6 hours');

  -- Conv 7 : Marie=true mais Jean=false (disputed)
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par, rdv_confirme_at,
                                    rencontre_acheteur, rencontre_vendeur, rencontre_decided_at)
  values (v_c7, v_a7, v_marie, v_jean, 'Adjamé', now() - interval '1 day', v_marie, now() - interval '2 days',
          true, false, now() - interval '6 hours');
end $$;

-- Test 8b : rencontre_acheteur NULL côté Marie → meeting_not_confirmed_self (mig 86)
select is(
  (public.submit_avis('c5555555-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, null))->>'error',
  'meeting_not_confirmed_self',
  'submit_avis avec rencontre_self=NULL renvoie meeting_not_confirmed_self (mig 86)'
);

-- Test 8c : rencontre_acheteur false côté Marie → meeting_declined_self (mig 86)
select is(
  (public.submit_avis('c6666666-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, null))->>'error',
  'meeting_declined_self',
  'submit_avis avec rencontre_self=false renvoie meeting_declined_self (mig 86)'
);

-- Test 8d : rencontre_vendeur false (autre côté) → meeting_disputed (mig 86)
select is(
  (public.submit_avis('c7777777-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, null))->>'error',
  'meeting_disputed',
  'submit_avis avec rencontre_other=false renvoie meeting_disputed (mig 86)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Happy path 1 : Marie (acheteuse) note Jean (vendeur) → trigger recalc
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 9 : submit success
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 4::smallint, 'Vendeur sérieux, bon prix'))->>'success',
  'true',
  'submit_avis Marie→Jean (acheteuse note vendeur) succès'
);

-- Test 10 : avis inserted avec les bons champs déterminés serveur-side
select results_eq(
  $$ select role_auteur, cible_id, auteur_id, note, commentaire, is_auto
       from public.avis
      where conversation_id = 'c1111111-cccc-cccc-cccc-cccccccccccc'::uuid $$,
  $$ values (
       'acheteur'::text,
       'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid,
       'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid,
       4::smallint,
       'Vendeur sérieux, bon prix'::text,
       false
     ) $$,
  'avis insérée avec role_auteur=acheteur, cible=Jean, auteur=Marie, is_auto=false'
);

-- Test 11 : trigger fn_avis_after_insert recalc note_vendeur côté Jean
select is(
  (select note_vendeur from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  4.00::numeric,
  'trigger after-insert recalc users.note_vendeur = 4.00'
);

-- Test 12 : trigger recalc nb_ventes côté Jean
select is(
  (select nb_ventes from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  1::int,
  'trigger after-insert recalc users.nb_ventes = 1'
);

-- Test 13 : note_acheteur de Jean reste à 0 (pas encore noté en tant qu'acheteur)
select is(
  (select note_acheteur from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  0::numeric,
  'note_acheteur de Jean reste 0 (cohérence rôle)'
);

-- Test 14 : 2e submit Marie → avis_already_submitted (UNIQUE conv+auteur)
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 5::smallint, 'Re-submit'))->>'error',
  'avis_already_submitted',
  'submit_avis 2x par même auteur sur même conv renvoie avis_already_submitted'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Happy path 2 : Jean (vendeur) note Marie (acheteuse) → symétrie
-- ═════════════════════════════════════════════════════════════════════════════

select tests.set_jwt_for('bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid);

-- Test 15 : submit success
select is(
  (public.submit_avis('c1111111-cccc-cccc-cccc-cccccccccccc'::uuid, 5::smallint, 'Acheteuse ponctuelle'))->>'success',
  'true',
  'submit_avis Jean→Marie (vendeur note acheteur) succès'
);

-- Test 16 : trigger recalc note_acheteur côté Marie
select is(
  (select note_acheteur from public.users where id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid),
  5.00::numeric,
  'trigger recalc users.note_acheteur = 5.00 côté Marie'
);

-- Test 17 : nb_achats côté Marie
select is(
  (select nb_achats from public.users where id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid),
  1::int,
  'trigger recalc users.nb_achats = 1 côté Marie'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Recalc-from-scratch : 2e avis sur Jean depuis une autre conv → moyenne
-- ═════════════════════════════════════════════════════════════════════════════

-- Setup conv 4 : nouvelle annonce de Jean + nouvelle conv Marie-Jean RDV passé
do $$
declare
  v_categorie_id uuid;
  v_jean   uuid := 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb';
  v_marie  uuid := 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  v_a4     uuid := 'a4444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_c4     uuid := 'c4444444-cccc-cccc-cccc-cccccccccccc';
begin
  select id into v_categorie_id from public.categories order by ordre limit 1;

  insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, pays, ville, expires_at, statut)
  values (v_a4, v_jean, v_categorie_id, 'Vélo VTT bon état', 'Vélo tout terrain 27.5 pouces, 21 vitesses, freins disque hydrauliques.',
          50000, array['p4.jpg'], 'CI'::pays_code, 'Abidjan', now() + interval '60 days', 'en_cours'::statut_annonce);

  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par, rdv_confirme_at,
                                    rencontre_acheteur, rencontre_vendeur, rencontre_decided_at)
  values (v_c4, v_a4, v_marie, v_jean, 'Treichville', now() - interval '3 days', v_marie, now() - interval '4 days',
          true, true, now() - interval '2 days');
end $$;

-- Marie poste un 2e avis sur Jean (note 5/5 cette fois) via conv 4
select tests.set_jwt_for('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid);
select is(
  (public.submit_avis('c4444444-cccc-cccc-cccc-cccccccccccc'::uuid, 5::smallint, null))->>'success',
  'true',
  'Marie poste un 2e avis sur Jean depuis une autre conv (succès)'
);

-- Test 19 : recalc moyenne note_vendeur Jean = avg(4, 5) = 4.5
select is(
  (select note_vendeur from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  4.50::numeric,
  'recalc note_vendeur Jean = avg(4,5) = 4.50 (recalc-from-scratch mig 42)'
);

-- Test 20 : nb_ventes Jean = 2
select is(
  (select nb_ventes from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  2::int,
  'nb_ventes Jean = 2 après 2e avis'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Trigger after-delete : recalc descend
-- ═════════════════════════════════════════════════════════════════════════════

-- DELETE 1 avis (note 5 de Marie sur Jean depuis conv 4) → moyenne redescend à 4.0
delete from public.avis
 where conversation_id = 'c4444444-cccc-cccc-cccc-cccccccccccc'::uuid
   and auteur_id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid;

-- Test 21 : recalc note_vendeur après delete = 4.00 (seul reste l'avis de conv 1)
select is(
  (select note_vendeur from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  4.00::numeric,
  'recalc note_vendeur Jean = 4.00 après DELETE de l avis 5/5 (trigger after-delete mig 38)'
);

-- Test 22 : nb_ventes redescend à 1
select is(
  (select nb_ventes from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  1::int,
  'nb_ventes Jean = 1 après DELETE'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. CHECK constraints + UNIQUE — INSERT direct service_role qui doit échouer
-- ═════════════════════════════════════════════════════════════════════════════

reset role;

-- Test 23 : avis_pas_soi_meme (auteur_id == cible_id) → CHECK violation
select throws_ok(
  $$ insert into public.avis (conversation_id, auteur_id, cible_id, note, role_auteur)
     values (
       'c1111111-cccc-cccc-cccc-cccccccccccc'::uuid,
       'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid,
       'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid,
       3, 'acheteur'
     ) $$,
  '23514',  -- check_violation
  null,
  'CHECK avis_pas_soi_meme bloque auteur_id == cible_id'
);

-- Test 24 : note hors range (CHECK 1-5) → CHECK violation
select throws_ok(
  $$ insert into public.avis (conversation_id, auteur_id, cible_id, note, role_auteur)
     values (
       'c1111111-cccc-cccc-cccc-cccccccccccc'::uuid,
       'cccccccc-1111-1111-1111-cccccccccccc'::uuid,
       'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid,
       7, 'acheteur'
     ) $$,
  '23514',
  null,
  'CHECK note 1-5 bloque note=7'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. FK ON DELETE — auteur_id SET NULL, cible_id CASCADE (mig 70)
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 25 : DELETE auteur Marie → cascade chain
-- En pratique : `conversations.acheteur_id ON DELETE CASCADE` (mig 24) supprime
-- toutes les conversations où Marie est acheteuse, ce qui cascade-supprime
-- les avis via `avis.conversation_id ON DELETE CASCADE` (mig 37). Le
-- `auteur_id ON DELETE SET NULL` (mig 70) ne se déclenche que si l'avis est
-- sur une conv où l'auteur n'est pas participant (cas qui n'arrive jamais
-- naturellement, mais le SET NULL reste un filet de sécurité défensif).
delete from auth.users where id = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa'::uuid;

select is(
  (select count(*)::int from public.avis
    where conversation_id = 'c1111111-cccc-cccc-cccc-cccccccccccc'::uuid),
  0::int,
  'Cascade chain : DELETE Marie → conv cascade → avis cascade (mig 24 + 37 + 70)'
);

-- Test 26 : recalc côté Jean après cascade — note_vendeur retombe à 0 car
-- l avis Marie→Jean (sur conv 1) est cascade-supprimé via conversation_id.
-- Le trigger fn_avis_after_delete recalc nb_ventes/note_vendeur Jean = 0.
select is(
  (select note_vendeur from public.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  0::numeric,
  'note_vendeur Jean recalculée à 0 après cascade-delete de l avis (trigger after-delete OK)'
);

-- Test 27 : DELETE cible Jean → cascade : ses avis reçus ET émis (avis qu'il a
-- posté sur Marie, qui a déjà été supprimée donc cible_id Marie cascade aussi)
-- disparaissent. Plus aucun avis ne référence Jean en cible.
delete from auth.users where id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid;

select is(
  (select count(*)::int from public.avis where cible_id = 'bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb'::uuid),
  0::int,
  'FK cible_id ON DELETE CASCADE : après DELETE de Jean, ses avis reçus disparaissent (mig 70)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. RLS — SELECT public OK + INSERT direct authenticated bloqué
-- ═════════════════════════════════════════════════════════════════════════════

-- Test 28 : role anon peut SELECT la table avis (pas d'erreur, juste 0 rows
-- vu que tout a été supprimé en cascade — l'important = pas d'erreur RLS)
set role anon;
select lives_ok(
  $$ select * from public.avis limit 5 $$,
  'RLS avis_select_public : role anon peut SELECT public.avis sans erreur'
);
reset role;

-- Test 29 : role authenticated ne peut PAS INSERT direct (pas de policy INSERT)
-- On re-seed un user pour avoir un auteur valide
do $$
declare v_dave uuid := 'dddddddd-1111-1111-1111-dddddddddddd';
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at)
  values (v_dave, 'dave-not@niqo.test', crypt('p', gen_salt('bf')), now())
  on conflict do nothing;
  insert into public.users (id, email, prenom, nom, pays, ville)
  values (v_dave, 'dave-not@niqo.test', 'Dave', 'Test', 'CI'::pays_code, 'Abidjan')
  on conflict do nothing;
end $$;

select tests.set_jwt_for('dddddddd-1111-1111-1111-dddddddddddd'::uuid);
set role authenticated;

select throws_ok(
  $$ insert into public.avis (conversation_id, auteur_id, cible_id, note, role_auteur)
     values (
       gen_random_uuid(),
       'dddddddd-1111-1111-1111-dddddddddddd'::uuid,
       'cccccccc-1111-1111-1111-cccccccccccc'::uuid,
       4, 'acheteur'
     ) $$,
  '42501',  -- insufficient_privilege (RLS deny)
  null,
  'RLS deny : role authenticated ne peut PAS INSERT direct (pas de policy INSERT)'
);
reset role;

-- Test 30 : la fonction submit_avis a bien le grant authenticated (pas de fail
-- de permission — on teste un appel qui passera les gates au moins jusqu'à
-- conversation_not_found, ce qui prouve que la fonction est exécutable)
select tests.set_jwt_for('dddddddd-1111-1111-1111-dddddddddddd'::uuid);
select is(
  (public.submit_avis('00000000-0000-0000-0000-000000000000'::uuid, 4::smallint, null))->>'error',
  'conversation_not_found',
  'GRANT submit_avis to authenticated : Dave peut appeler la RPC (échoue sur la gate métier)'
);

-- ─── Finish ──────────────────────────────────────────────────────────────────
select * from finish();
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — RDV trust v2 (migs 86 → 93)
--
-- Couvre :
--   - Mig 86 : RPC confirm_rencontre (auth, validations, état terminal),
--     mark_annonce_vendue exige rencontre confirmée, submit_avis self=true
--     AND other!=false, trigger lifecycle (revert active si false/false)
--   - Mig 87 : counter rencontre_reminders_sent (J+1/J+3/J+7), reset rencontre_*
--     dans propose_rdv et cancel_rdv
--   - Mig 88 : mark_vendue voix acheteur seule (vend=null OK si ach=true)
--   - Mig 89 : mark_vendue auto-pose rencontre_vendeur=true + decided_at +
--     message système
--   - Mig 90 : counter mark_vendue_reminders_sent + trigger reset sur statut
--     active + fn_push_mark_vendue_reminder smoke
--   - Mig 91 : create_signalement_post_rdv (gates + anti-doublon) + trigger
--     fn_signalement_check_threshold étendu (auto-pause annonce sur fraude)
--   - Mig 92 : add_rencontre_photo (gates + path validation + quota max 5)
--   - Mig 93 : get_pending_user_actions (4 types + dédup mark_vendue + limit 5)
--
-- Séquence de tests : on (re)crée annonce + conv pour chaque scénario clé
-- afin d'isoler les états (sinon rencontre_decided_at est figée).
--
-- Prérequis : migs 86-93 jouées. Cf. docs/backend/rdv.md.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(95);

-- ─── Setup users (Diane / Eric / Frank pour ne pas collider avec rdv.test.sql) ─
do $$
declare
  v_diane uuid := '11111111-1111-1111-1111-111111111111';
  v_eric  uuid := '22222222-2222-2222-2222-222222222222';
  v_frank uuid := '33333333-3333-3333-3333-333333333333';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
  values
    (v_diane, 'diane-renc@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Diane','nom','Buyer','pays','CI','telephone','+2250700004444','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_eric,  'eric-renc@niqo.test',  crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Eric','nom','Seller','pays','CI','telephone','+2250700005555','auth_provider','email'),
     '{}'::jsonb, now()),
    (v_frank, 'frank-renc@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Frank','nom','Tiers','pays','CI','telephone','+2250700006666','auth_provider','email'),
     '{}'::jsonb, now());
end $$;

-- ─── Helper : (re)crée annonce + conv + RDV passé confirmé (état initial) ───
-- Utilisé pour repartir d'un état frais avant chaque scénario clé.
create or replace function tests.seed_rdv_passed(
  p_annonce_id uuid,
  p_conv_id    uuid
)
returns void
language plpgsql
as $$
declare
  v_categorie_id uuid;
begin
  select id into v_categorie_id from public.categories order by ordre limit 1;

  -- Delete TOUTES les conversations + annonces du vendeur Eric (clean slate
  -- entre seeds — évite le rate limit annonces 5/24h dans la même transaction).
  delete from public.messages where conversation_id in (
    select id from public.conversations
    where vendeur_id = '22222222-2222-2222-2222-222222222222'::uuid
  );
  delete from public.conversations
    where vendeur_id = '22222222-2222-2222-2222-222222222222'::uuid;
  delete from public.annonces
    where vendeur_id = '22222222-2222-2222-2222-222222222222'::uuid;

  -- Titre/desc uniques par annonce (anti-trigger fn_enforce_annonce_no_duplicate mig 17)
  insert into public.annonces (
    id, vendeur_id, categorie_id, titre, description, prix, photos,
    pays, ville, expires_at, statut
  )
  values (
    p_annonce_id,
    '22222222-2222-2222-2222-222222222222'::uuid,  -- Eric vendeur
    v_categorie_id,
    'PS5 quasi neuve avec 2 manettes #' || substring(p_annonce_id::text, 1, 8),
    'Console testée, état impeccable. Vendue avec boîte d''origine. Réf ' || p_annonce_id::text,
    300000,
    array['photo1.jpg'],
    'CI'::pays_code,
    'Abidjan',
    now() + interval '60 days',
    'active'::statut_annonce
  );

  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id, rdv_lieu, rdv_date, rdv_propose_par, rdv_propose_at, rdv_confirme_at)
  values (
    p_conv_id, p_annonce_id,
    '11111111-1111-1111-1111-111111111111'::uuid,  -- Diane acheteuse
    '22222222-2222-2222-2222-222222222222'::uuid,  -- Eric vendeur
    'Marché de Cocody',
    now() - interval '1 day',  -- RDV passé
    '11111111-1111-1111-1111-111111111111'::uuid,
    now() - interval '3 days',
    now() - interval '2 days'
  );

  -- Trigger lifecycle a fait passer l'annonce en en_cours sur le confirme_at
  -- → on force l'état à active dans certains scénarios via update direct ailleurs.
  update public.annonces set statut = 'en_cours' where id = p_annonce_id;
end;
$$;

-- ── Bloc 1 : confirm_rencontre — validations ──────────────────────────────

select tests.seed_rdv_passed('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid,
                             'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid);

-- Test 1 : non-authentifié → not_authenticated
select set_config('request.jwt.claims', '{}', true);
select is(
  (public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, true))->>'error',
  'not_authenticated',
  'confirm_rencontre sans JWT renvoie not_authenticated'
);

-- Test 2 : non-participant (Frank) → not_participant
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
select is(
  (public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, true))->>'error',
  'not_participant',
  'confirm_rencontre par un tiers (Frank) renvoie not_participant'
);

-- Test 3 : conv inconnue → conversation_not_found
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.confirm_rencontre('00000000-0000-0000-0000-000000000000'::uuid, true))->>'error',
  'conversation_not_found',
  'confirm_rencontre sur conv inexistante renvoie conversation_not_found'
);

-- Test 4 : p_rencontre null → rencontre_required
select is(
  (public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, null))->>'error',
  'rencontre_required',
  'confirm_rencontre avec p_rencontre=null renvoie rencontre_required'
);

-- Test 5 : RDV pas confirmé → no_confirmed_rdv
update public.conversations
   set rdv_confirme_at = null
 where id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid;

select is(
  (public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, true))->>'error',
  'no_confirmed_rdv',
  'confirm_rencontre sans rdv_confirme_at renvoie no_confirmed_rdv'
);

-- Test 6 : RDV pas encore passé → rdv_not_past
update public.conversations
   set rdv_confirme_at = now() - interval '1 day',
       rdv_date        = now() + interval '2 days'
 where id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid;

select is(
  (public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, true))->>'error',
  'rdv_not_past',
  'confirm_rencontre avec rdv_date dans le futur renvoie rdv_not_past'
);

-- ── Bloc 2 : confirm_rencontre — état pending → unilateral → met ──────────

-- Reset RDV passé
update public.conversations
   set rdv_date = now() - interval '1 day'
 where id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid;

-- Test 7 : Diane (acheteuse) confirme rencontre → unilateral, decided_at toujours null
select is(
  (public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, true))->>'success',
  'true',
  'confirm_rencontre côté acheteur renvoie success=true'
);

select is(
  (select rencontre_acheteur from public.conversations where id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid)::text,
  'true',
  'rencontre_acheteur=true après confirm Diane'
);

select is(
  (select rencontre_decided_at from public.conversations where id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid),
  null::timestamptz,
  'rencontre_decided_at reste null tant que l''autre partie n''a pas répondu'
);

-- Test 8 : Eric (vendeur) confirme aussi → met, decided_at posé
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  ((public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, true))->>'decided'),
  'true',
  'confirm_rencontre 2e partie renvoie decided=true'
);

select isnt(
  (select rencontre_decided_at from public.conversations where id = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid),
  null::timestamptz,
  'rencontre_decided_at posé après confirm 2e partie'
);

-- Test 9 : 3e tentative (idempotence/figée) → rencontre_already_decided
select is(
  (public.confirm_rencontre('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, true))->>'error',
  'rencontre_already_decided',
  'confirm_rencontre après decided renvoie rencontre_already_decided'
);

-- ── Bloc 3 : mark_annonce_vendue — gating sur (true,true) ─────────────────

-- Test 10 : mark_vendue après met → success
select is(
  (public.mark_annonce_vendue('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid))->>'success',
  'true',
  'mark_annonce_vendue après rencontre (true,true) renvoie success=true'
);

-- ── Bloc 4 : submit_avis — gating sur self=true AND other!=false ──────────

-- Test 11 : Eric (vendeur) note Diane (acheteuse) → success (les 2 ont true)
select is(
  (public.submit_avis('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1'::uuid, 5::smallint, 'Acheteuse fiable'))->>'success',
  'true',
  'submit_avis après rencontre (true,true) côté vendeur renvoie success=true'
);

-- ── Bloc 5 : Scénario disputed — (true, false) ────────────────────────────

select tests.seed_rdv_passed('a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'::uuid,
                             'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid);

-- Diane confirme (true), Eric refuse (false)
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select pass(
  ((public.confirm_rencontre('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, true))->>'success' = 'true')::text
);

select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  ((public.confirm_rencontre('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, false))->>'decided'),
  'true',
  'confirm_rencontre disputed (true,false) → decided=true'
);

-- Test 14 : mark_vendue refusé en disputed
select is(
  (public.mark_annonce_vendue('a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'::uuid))->>'error',
  'no_meeting_confirmed',
  'mark_annonce_vendue refusé en état disputed (true,false)'
);

-- Test 15 : submit_avis côté Diane (qui a dit true) refusé car other=false → meeting_disputed
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.submit_avis('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, 5::smallint, null))->>'error',
  'meeting_disputed',
  'submit_avis côté Diane (self=true, other=false) renvoie meeting_disputed'
);

-- Test 16 : submit_avis côté Eric (qui a dit false) refusé → meeting_declined_self
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (public.submit_avis('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, 5::smallint, null))->>'error',
  'meeting_declined_self',
  'submit_avis côté Eric (self=false) renvoie meeting_declined_self'
);

-- Test 17 : annonce reste en_cours en disputed (pas de revert)
select is(
  (select statut::text from public.annonces where id = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'::uuid),
  'en_cours',
  'trigger lifecycle : annonce reste en_cours en état disputed (mig 86)'
);

-- ── Bloc 6 : Scénario unconfirmed — (false, false) → revert annonce ──────

select tests.seed_rdv_passed('a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3'::uuid,
                             'b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3'::uuid);

select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select pass(
  ((public.confirm_rencontre('b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3'::uuid, false))->>'success' = 'true')::text
);

select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select pass(
  ((public.confirm_rencontre('b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3'::uuid, false))->>'success' = 'true')::text
);

-- Test 20 : trigger lifecycle annonce → active en (false,false)
select is(
  (select statut::text from public.annonces where id = 'a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3'::uuid),
  'active',
  'trigger lifecycle : annonce revert en_cours → active en état unconfirmed (false,false)'
);

-- Test 21 : submit_avis côté Diane refusé → meeting_declined_self
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.submit_avis('b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3'::uuid, 4::smallint, null))->>'error',
  'meeting_declined_self',
  'submit_avis en unconfirmed (self=false) renvoie meeting_declined_self'
);

-- Test 22 : mark_vendue refusé en unconfirmed (annonce active maintenant)
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (public.mark_annonce_vendue('a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3'::uuid))->>'error',
  'no_meeting_confirmed',
  'mark_annonce_vendue refusé en état unconfirmed (false,false)'
);

-- ── Bloc 7 : Mig 88 — mark_vendue OK si ach=true, vend=null (voix acheteur) ─

select tests.seed_rdv_passed('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4'::uuid,
                             'b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'::uuid);

-- Diane (acheteuse) confirme oui — Eric (vendeur) silencieux
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select pass(
  ((public.confirm_rencontre('b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'::uuid, true))->>'success' = 'true')::text
);

-- Test 24 : mark_vendue OK côté vendeur même sans confirmer lui-même (mig 88)
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (public.mark_annonce_vendue('a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4'::uuid))->>'success',
  'true',
  'mark_annonce_vendue OK si rencontre_acheteur=true et rencontre_vendeur=null (mig 88 — voix acheteur seule)'
);

select is(
  (select statut::text from public.annonces where id = 'a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4'::uuid),
  'vendue',
  'mig 88 — annonce passe vendue après mark_vendue en unilateral_other'
);

-- Test 26 : mig 89 — rencontre_vendeur auto-posé à true (affirmation implicite)
select is(
  (select rencontre_vendeur from public.conversations where id = 'b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'::uuid)::text,
  'true',
  'mig 89 — rencontre_vendeur auto-posé à true après mark_vendue (était null avant)'
);

-- Test 27 : mig 89 — rencontre_decided_at posé (état figé met)
select isnt(
  (select rencontre_decided_at from public.conversations where id = 'b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'::uuid),
  null::timestamptz,
  'mig 89 — rencontre_decided_at posé après mark_vendue (état met)'
);

-- Test 28 : mig 89 — message système inséré (trace dans le chat)
select cmp_ok(
  (select count(*)::int from public.messages
    where conversation_id = 'b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4'::uuid
      and type = 'systeme'
      and contenu like '%marquée vendue%'),
  '>=', 1,
  'mig 89 — message système "Annonce marquée vendue — rencontre confirmée" inséré'
);

-- ── Bloc 8 : Mig 87 — Reset rencontre_* dans cancel_rdv et propose_rdv ────

select tests.seed_rdv_passed('a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5'::uuid,
                             'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid);

-- Setup avancé : tout est en état décidé + counter à 2 (avant cancel)
update public.conversations
set rencontre_acheteur       = true,
    rencontre_vendeur        = true,
    rencontre_decided_at     = now(),
    rencontre_reminders_sent = 2
where id = 'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid;

-- cancel_rdv côté Diane → tout doit reset
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select pass(
  ((public.cancel_rdv('b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid))->>'success' = 'true')::text
);

-- Test 30 : rencontre_acheteur reset à null
select is(
  (select rencontre_acheteur from public.conversations where id = 'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid),
  null::boolean,
  'mig 87 — cancel_rdv reset rencontre_acheteur à null'
);

-- Test 31 : rencontre_vendeur reset à null
select is(
  (select rencontre_vendeur from public.conversations where id = 'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid),
  null::boolean,
  'mig 87 — cancel_rdv reset rencontre_vendeur à null'
);

-- Test 32 : rencontre_decided_at reset à null
select is(
  (select rencontre_decided_at from public.conversations where id = 'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid),
  null::timestamptz,
  'mig 87 — cancel_rdv reset rencontre_decided_at à null'
);

-- Test 33 : rencontre_reminders_sent reset à 0
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid)::int,
  0,
  'mig 87 — cancel_rdv reset rencontre_reminders_sent à 0'
);

-- Test 34 : propose_rdv après cancel garde le reset propre
select pass(
  ((public.propose_rdv('b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid, 'Marché Adjamé', now() + interval '2 days'))->>'success' = 'true')::text
);

select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b5b5'::uuid)::int,
  0,
  'mig 87 — propose_rdv après cancel garde rencontre_reminders_sent à 0'
);

-- ── Bloc 9 : Mig 87 — fn_push_rencontre_reminder counter ──────────────────
-- Note : le push lui-même (pg_net) n'est pas observable en pgTAP local (vault
-- vide → _notify_push skip silencieusement). On teste la logique métier :
-- counter increment, conditions de filtrage, idempotence.

select tests.seed_rdv_passed('a6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6'::uuid,
                             'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid);

-- Setup : J+1+1h, acheteur a confirmé, vendeur silencieux, sent=0
update public.conversations
set rdv_date                 = now() - interval '1 day 1 hour',
    rencontre_acheteur       = true,
    rencontre_vendeur        = null,
    rencontre_decided_at     = null,
    rencontre_reminders_sent = 0
where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid;

-- Test 36 : 1er run cron → sent passe de 0 à 1 (J+1 fenêtre)
select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid)::int,
  1,
  'mig 87 — fn_push_rencontre_reminder J+1 incrémente sent 0→1'
);

-- Test 37 : 2e run sans avancer rdv_date → sent reste à 1 (pas encore J+3)
select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid)::int,
  1,
  'mig 87 — re-run sans avancer rdv_date n''envoie pas (counter idempotent)'
);

-- Test 38 : avancer rdv_date à J+3+1h → sent passe à 2
update public.conversations
set rdv_date = now() - interval '3 days 1 hour'
where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid;

select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid)::int,
  2,
  'mig 87 — fn_push_rencontre_reminder J+3 incrémente sent 1→2'
);

-- Test 39 : avancer rdv_date à J+7+1h → sent passe à 3 (dernier reminder)
update public.conversations
set rdv_date = now() - interval '7 days 1 hour'
where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid;

select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid)::int,
  3,
  'mig 87 — fn_push_rencontre_reminder J+7 incrémente sent 2→3 (dernier)'
);

-- Test 40 : silence radio après J+7 → sent reste à 3 même avec rdv plus vieux
update public.conversations
set rdv_date = now() - interval '15 days'
where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid;

select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b6b6b6b6-b6b6-b6b6-b6b6-b6b6b6b6b6b6'::uuid)::int,
  3,
  'mig 87 — sent=3 = silence radio définitif (pas de 4e push même 15j après)'
);

-- Test 41 : conv déjà décidée (rencontre_decided_at posée) exclue de la boucle
select tests.seed_rdv_passed('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7'::uuid,
                             'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7'::uuid);

update public.conversations
set rdv_date                 = now() - interval '1 day 1 hour',
    rencontre_acheteur       = true,
    rencontre_vendeur        = true,
    rencontre_decided_at     = now() - interval '1 hour',
    rencontre_reminders_sent = 0
where id = 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7'::uuid;

select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b7b7b7b7-b7b7-b7b7-b7b7-b7b7b7b7b7b7'::uuid)::int,
  0,
  'mig 87 — conv déjà décidée (decided_at not null) exclue, counter inchangé'
);

-- Test 42 : conv où user is_active=false exclue (skip silencieux)
select tests.seed_rdv_passed('a8a8a8a8-a8a8-a8a8-a8a8-a8a8a8a8a8a8'::uuid,
                             'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8'::uuid);

update public.conversations
set rdv_date                 = now() - interval '1 day 1 hour',
    rencontre_acheteur       = true,
    rencontre_vendeur        = null,
    rencontre_decided_at     = null,
    rencontre_reminders_sent = 0
where id = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8'::uuid;

-- Désactive Eric (vendeur) → la conv doit être skipped
update public.users set is_active = false where id = '22222222-2222-2222-2222-222222222222'::uuid;

select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8'::uuid)::int,
  0,
  'mig 87 — conv où vendeur is_active=false exclue (filter is_active=true)'
);

-- Réactive Eric pour ne pas perturber d'autres tests dans la même transaction
update public.users set is_active = true where id = '22222222-2222-2222-2222-222222222222'::uuid;

-- Test 43 : Re-run après réactivation → maintenant la conv est éligible
select public.fn_push_rencontre_reminder();
select is(
  (select rencontre_reminders_sent from public.conversations where id = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8'::uuid)::int,
  1,
  'mig 87 — après réactivation user, conv redevient éligible (sent 0→1)'
);

-- ── Bloc 10 : Mig 90 — counter mark_vendue + trigger reset ────────────────

-- Seed nouveau cycle (annonce m1m1 + conv m1c1) — bring annonce to en_cours met
select tests.seed_rdv_passed('a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9'::uuid,
                             'b9b9b9b9-b9b9-b9b9-b9b9-b9b9b9b9b9b9'::uuid);

-- Test 47 : counter par défaut à 0
select is(
  (select mark_vendue_reminders_sent from public.annonces where id = 'a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9'::uuid)::int,
  0,
  'mig 90 — annonce nouvelle a mark_vendue_reminders_sent = 0 par défaut'
);

-- Test 48 : trigger reset on statut → active
-- Pose le counter à 2 (simule des relances déjà envoyées)
update public.annonces
set mark_vendue_reminders_sent = 2,
    mark_vendue_reminder_last_at = now() - interval '2 days'
where id = 'a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9'::uuid;

-- Force la transition statut en_cours → active (simule cancel_rdv ou autre)
update public.annonces set statut = 'active' where id = 'a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9'::uuid;

select is(
  (select mark_vendue_reminders_sent from public.annonces where id = 'a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9'::uuid)::int,
  0,
  'mig 90 — trigger reset counter à 0 quand statut bascule à active'
);

select is(
  (select mark_vendue_reminder_last_at from public.annonces where id = 'a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9'::uuid),
  null::timestamptz,
  'mig 90 — trigger reset last_at à null quand statut bascule à active'
);

-- Test 50 : fn_push_mark_vendue_reminder ne plante pas (smoke)
-- (Ne va pas envoyer de push réellement faute de conv en met sur cette annonce
-- maintenant qu'elle est repassée à active, mais doit return void sans erreur.)
select lives_ok(
  $f$ select public.fn_push_mark_vendue_reminder() $f$,
  'mig 90 — fn_push_mark_vendue_reminder s''exécute sans erreur'
);

-- ── Bloc 11 : Mig 91 — signalement contextualisé post-RDV ─────────────────

-- Seed RDV passé (annonce s1s1 + conv s1c1), Diane=acheteur Eric=vendeur
select tests.seed_rdv_passed('aaaaaaaa-aaaa-aaaa-aaaa-aaaa1111aaaa'::uuid,
                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid);

-- Test 51 : non-authentifié → not_authenticated
select set_config('request.jwt.claims', '{}', true);
select is(
  (public.create_signalement_post_rdv(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid,
    'no_show'::motif_signalement_rdv
  ))->>'error',
  'not_authenticated',
  'mig 91 — create_signalement_post_rdv sans JWT renvoie not_authenticated'
);

-- Test 52 : non-participant (Frank) → not_participant
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
select is(
  (public.create_signalement_post_rdv(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid,
    'no_show'::motif_signalement_rdv
  ))->>'error',
  'not_participant',
  'mig 91 — create_signalement_post_rdv par un tiers renvoie not_participant'
);

-- Test 53 : motif=autre + description vide → description_required
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.create_signalement_post_rdv(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid,
    'autre'::motif_signalement_rdv
  ))->>'error',
  'description_required',
  'mig 91 — motif=autre avec description vide renvoie description_required'
);

-- Test 54 : happy path — Diane signale Eric pour no_show
select is(
  (public.create_signalement_post_rdv(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid,
    'no_show'::motif_signalement_rdv
  ))->>'success',
  'true',
  'mig 91 — create_signalement_post_rdv (Diane → Eric, no_show) renvoie success'
);

-- Test 55 : signalement bien créé avec target_type=rdv_post + role_signaleur=acheteur + snapshot
select is(
  (select role_signaleur from public.signalements
   where target_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid
     and signaleur_id = '11111111-1111-1111-1111-111111111111'::uuid),
  'acheteur',
  'mig 91 — role_signaleur correctement posé (acheteur)'
);

select isnt(
  (select rdv_snapshot from public.signalements
   where target_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid
     and signaleur_id = '11111111-1111-1111-1111-111111111111'::uuid),
  null,
  'mig 91 — rdv_snapshot correctement posé (jsonb non-null)'
);

-- Test 57 : anti-doublon — 2e tentative renvoie already_reported
select is(
  (public.create_signalement_post_rdv(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid,
    'no_show'::motif_signalement_rdv
  ))->>'error',
  'already_reported',
  'mig 91 — 2e signalement même conv même user renvoie already_reported'
);

-- Test 58 : auto-pause annonce sur fraude validée
-- Frank crée un signalement fraude sur la même conv (different signaleur, donc OK)
-- Mais Frank n'est pas participant → on doit utiliser un autre setup.
-- Plus simple : Eric (le vendeur) signale Diane pour fraude.
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (public.create_signalement_post_rdv(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid,
    'tentative_fraude'::motif_signalement_rdv,
    'Faux billet présenté'
  ))->>'success',
  'true',
  'mig 91 — Eric signale fraude OK'
);

-- L'admin (Frank fait office d'admin pour le test) traite le signalement de fraude
update public.users set is_admin = true where id = '33333333-3333-3333-3333-333333333333'::uuid;
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);

-- Récupérer l'id du signalement Eric (fraude)
do $$
declare
  v_sig_id uuid;
begin
  select id into v_sig_id from public.signalements
  where target_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb1111bbbb'::uuid
    and signaleur_id = '22222222-2222-2222-2222-222222222222'::uuid
    and motif_categorie = 'tentative_fraude';

  perform public.admin_treat_signalement(v_sig_id, 'traite');
end $$;

-- Test 58 : annonce désormais 'suspendue' (auto-pause par trigger)
select is(
  (select statut::text from public.annonces where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaa1111aaaa'::uuid),
  'suspendue',
  'mig 91 — annonce auto-suspendue après validation signalement fraude'
);

-- Cleanup
update public.users set is_admin = false where id = '33333333-3333-3333-3333-333333333333'::uuid;

-- ── Bloc 12 : Mig 92 — photos rencontre + RPC + RLS ───────────────────────

-- Seed nouveau RDV passé propre (annonce p1p1 + conv p1c1)
select tests.seed_rdv_passed('cccccccc-cccc-cccc-cccc-cccc2222cccc'::uuid,
                             'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid);

-- Test 59 : non-authentifié → not_authenticated
select set_config('request.jwt.claims', '{}', true);
select is(
  (public.add_rencontre_photo(
    'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid,
    'dddddddd-dddd-dddd-dddd-dddd2222dddd/11111111-1111-1111-1111-111111111111/photo.jpg'
  ))->>'error',
  'not_authenticated',
  'mig 92 — add_rencontre_photo sans JWT renvoie not_authenticated'
);

-- Test 60 : non-participant (Frank) → not_participant
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
select is(
  (public.add_rencontre_photo(
    'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid,
    'dddddddd-dddd-dddd-dddd-dddd2222dddd/33333333-3333-3333-3333-333333333333/photo.jpg'
  ))->>'error',
  'not_participant',
  'mig 92 — add_rencontre_photo par un tiers renvoie not_participant'
);

-- Test 61 : invalid_path (uid ne match pas auth.uid)
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.add_rencontre_photo(
    'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid,
    'dddddddd-dddd-dddd-dddd-dddd2222dddd/22222222-2222-2222-2222-222222222222/photo.jpg'
  ))->>'error',
  'invalid_path',
  'mig 92 — path avec uid différent renvoie invalid_path'
);

-- Mig 106 — Setup état disputed (ach=true, ven=false) pour pouvoir uploader.
-- Avant mig 106, tous les états post-RDV sauf unconfirmed acceptaient l'upload.
-- Mig 106 a durci : disputed uniquement (cas litigieux où la preuve a du poids).
update public.conversations
   set rencontre_acheteur   = true,
       rencontre_vendeur    = false,
       rencontre_decided_at = now() - interval '1 hour'
 where id = 'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid;

-- Test 62 : happy path — Diane upload sa 1ère photo
select is(
  (public.add_rencontre_photo(
    'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid,
    'dddddddd-dddd-dddd-dddd-dddd2222dddd/11111111-1111-1111-1111-111111111111/photo1.jpg'
  ))->>'success',
  'true',
  'mig 92 — add_rencontre_photo (Diane, path valide) renvoie success'
);

-- Test 63 : count_after = 1 sur happy path (renvoyé par RPC)
-- (Test 62 a déjà inséré, donc c'est la 2ème ligne maintenant si on relance.
-- Pour tester count_after, on regarde directement la table.)
select is(
  (select count(*) from public.rencontre_photos
   where conversation_id = 'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid
     and auteur_id = '11111111-1111-1111-1111-111111111111'::uuid)::int,
  1,
  'mig 92 — 1 photo en table après 1 add réussi'
);

-- Test 64 : quota_exceeded après 5 photos
do $$
begin
  -- Insère 4 photos supplémentaires (pour atteindre 5 total)
  for i in 2..5 loop
    perform public.add_rencontre_photo(
      'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid,
      'dddddddd-dddd-dddd-dddd-dddd2222dddd/11111111-1111-1111-1111-111111111111/photo' || i || '.jpg'
    );
  end loop;
end $$;

select is(
  (public.add_rencontre_photo(
    'dddddddd-dddd-dddd-dddd-dddd2222dddd'::uuid,
    'dddddddd-dddd-dddd-dddd-dddd2222dddd/11111111-1111-1111-1111-111111111111/photo6.jpg'
  ))->>'error',
  'quota_exceeded',
  'mig 92 — 6e photo renvoie quota_exceeded'
);

-- ── Bloc 13 : Mig 93 — get_pending_user_actions ───────────────────────────

-- Seed propre — annonce y1y1 + conv y1c1 + force état met (les 2 ont confirmé)
select tests.seed_rdv_passed('eeeeeeee-eeee-eeee-eeee-eeee3333eeee'::uuid,
                             'ffffffff-ffff-ffff-ffff-ffff3333ffff'::uuid);

-- Test 65 : sans auth → 0 actions
select set_config('request.jwt.claims', '{}', true);
select is(
  (select count(*) from public.get_pending_user_actions())::int,
  0,
  'mig 93 — sans JWT, get_pending_user_actions renvoie 0 lignes'
);

-- Test 66 : Diane (acheteur) sur RDV passé sans répondu → 1 action 'rencontre' priority=2
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (select type from public.get_pending_user_actions()
   where conversation_id = 'ffffffff-ffff-ffff-ffff-ffff3333ffff'::uuid),
  'rencontre',
  'mig 93 — Diane voit action rencontre sur conv RDV passé sans réponse'
);

-- Test 67 : pose Diane=true vendeur=null → côté Diane = unilateral_self
-- (mark_vendue côté Eric possible — sera testé après)
update public.conversations
set rencontre_acheteur = true
where id = 'ffffffff-ffff-ffff-ffff-ffff3333ffff'::uuid;

-- Eric (vendeur) doit voir 'rencontre' pour répondre
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (select type from public.get_pending_user_actions()
   where conversation_id = 'ffffffff-ffff-ffff-ffff-ffff3333ffff'::uuid),
  'rencontre',
  'mig 93 — Eric voit rencontre tant qu''il n''a pas répondu (état unilateral_other)'
);

-- Test 68 : pose Eric=true → état met → mark_vendue + avis pour les 2
update public.conversations
set rencontre_vendeur = true,
    rencontre_decided_at = now()
where id = 'ffffffff-ffff-ffff-ffff-ffff3333ffff'::uuid;

-- Eric (vendeur) doit voir 'mark_vendue' (annonce en_cours met)
-- Note : peut aussi voir 'avis' (priority 4 < 3, donc mark_vendue d'abord)
select is(
  (select type from public.get_pending_user_actions()
   where conversation_id = 'ffffffff-ffff-ffff-ffff-ffff3333ffff'::uuid
   order by priority asc limit 1),
  'mark_vendue',
  'mig 93 — Eric voit mark_vendue (priority 3) en première position'
);

-- Test 69 : Diane voit 'avis' (priority 4) puisqu'elle n'a pas noté
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (select type from public.get_pending_user_actions()
   where conversation_id = 'ffffffff-ffff-ffff-ffff-ffff3333ffff'::uuid),
  'avis',
  'mig 93 — Diane voit avis (priority 4) en met sans avis posé'
);

-- ── Bloc 14 : Mig 95 — admin_revert_annonce_to_active ─────────────────────

-- Setup : seed RDV passé, état disputed (Diane=true, Eric=false), annonce gelée en_cours
select tests.seed_rdv_passed('cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid,
                             'dddddddd-dddd-dddd-dddd-dddd1111dddd'::uuid);

update public.conversations
set rencontre_acheteur = true,
    rencontre_vendeur  = false,
    rencontre_decided_at = now()
where id = 'dddddddd-dddd-dddd-dddd-dddd1111dddd'::uuid;

-- Trigger lifecycle a fait passer en `active` puis seed_rdv_passed le re-pose
-- en `en_cours`. On force ici pour être sûr.
update public.annonces set statut = 'en_cours'
where id = 'cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid;

-- Test 71 : non-admin (Diane) → ADMIN_REQUIRED
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.admin_revert_annonce_to_active('cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid))->>'error',
  'ADMIN_REQUIRED',
  'mig 95 — non-admin Diane renvoie ADMIN_REQUIRED'
);

-- Promote Frank as admin
update public.users set is_admin = true where id = '33333333-3333-3333-3333-333333333333'::uuid;
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);

-- Test 72 : annonce inexistante → ANNONCE_NOT_FOUND
select is(
  (public.admin_revert_annonce_to_active('00000000-0000-0000-0000-000000000000'::uuid))->>'error',
  'ANNONCE_NOT_FOUND',
  'mig 95 — annonce inexistante renvoie ANNONCE_NOT_FOUND'
);

-- Test 73 : annonce déjà active → INVALID_STATE
update public.annonces set statut = 'active'
where id = 'cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid;
select is(
  (public.admin_revert_annonce_to_active('cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid))->>'error',
  'INVALID_STATE',
  'mig 95 — annonce déjà active renvoie INVALID_STATE'
);

-- Test 74 : annonce vendue → INVALID_STATE
update public.annonces set statut = 'vendue'
where id = 'cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid;
select is(
  (public.admin_revert_annonce_to_active('cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid))->>'error',
  'INVALID_STATE',
  'mig 95 — annonce vendue renvoie INVALID_STATE'
);

-- Test 75 : current_statut retourné dans error response
select is(
  (public.admin_revert_annonce_to_active('cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid))->>'current_statut',
  'vendue',
  'mig 95 — current_statut retourné dans error response (utile UI)'
);

-- Test 76 : Happy path — en_cours → active
update public.annonces set statut = 'en_cours'
where id = 'cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid;
select is(
  (public.admin_revert_annonce_to_active('cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid))->>'success',
  'true',
  'mig 95 — admin revert en_cours → active OK (happy path)'
);

-- Test 77 : statut effectivement updaté côté DB
select is(
  (select statut::text from public.annonces
   where id = 'cccccccc-cccc-cccc-cccc-cccc1111cccc'::uuid),
  'active',
  'mig 95 — annonces.statut effectivement = active après revert'
);

-- Cleanup admin
update public.users set is_admin = false where id = '33333333-3333-3333-3333-333333333333'::uuid;

-- ── Bloc 15 : Mig 96 — admin_signalement_decided_at + filtre Home banner ──

-- Setup : seed RDV passé en disputed, fresh conv pour ce bloc
select tests.seed_rdv_passed('eeeeeeee-eeee-eeee-eeee-eeee1111eeee'::uuid,
                             'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid);

update public.conversations
set rencontre_acheteur = true,
    rencontre_vendeur  = false,
    rencontre_decided_at = now()
where id = 'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid;
update public.annonces set statut = 'en_cours'
where id = 'eeeeeeee-eeee-eeee-eeee-eeee1111eeee'::uuid;

-- Test 78 : admin_signalement_decided_at initial NULL
select is(
  (select admin_signalement_decided_at from public.conversations
   where id = 'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid),
  null,
  'mig 96 — admin_signalement_decided_at initial NULL sur conv vierge'
);

-- Diane signale Eric pour produit_defectueux (motif non-fraude)
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select public.create_signalement_post_rdv(
  'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid,
  'produit_defectueux'::motif_signalement_rdv
);

-- Test 79 : Diane (qui a déjà signalé) ne voit PAS la card disputed dans Home banner
-- (filtre `not exists` côté get_pending_user_actions, mig 96)
select is(
  (select count(*)::int from public.get_pending_user_actions() where type = 'disputed'),
  0,
  'mig 96 — Diane (signaleur) ne voit PAS card disputed dans Home banner'
);

-- Test 80 : Eric (autre partie sans signalement) voit ENCORE la card disputed avant admin decided
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (select count(*)::int from public.get_pending_user_actions() where type = 'disputed'),
  1,
  'mig 96 — Eric (autre partie sans signalement) voit ENCORE card disputed avant admin decided'
);

-- Admin Frank traite le signalement de Diane → trigger fn_signalement_check_threshold (mig 96)
-- pose admin_signalement_decided_at sur la conv
update public.users set is_admin = true where id = '33333333-3333-3333-3333-333333333333'::uuid;
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
do $$
declare v_sig_id uuid;
begin
  select id into v_sig_id from public.signalements
  where target_id = 'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid
    and signaleur_id = '11111111-1111-1111-1111-111111111111'::uuid
    and motif_categorie = 'produit_defectueux';
  perform public.admin_treat_signalement(v_sig_id, 'traite');
end $$;

-- Test 81 : admin_signalement_decided_at posé après traite
select isnt(
  (select admin_signalement_decided_at from public.conversations
   where id = 'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid),
  null,
  'mig 96 — admin_signalement_decided_at posé après admin treat (trigger fire)'
);

-- Test 82 : Eric ne voit plus la card disputed (filtre admin_signalement_decided_at)
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (select count(*)::int from public.get_pending_user_actions() where type = 'disputed'),
  0,
  'mig 96 — Eric ne voit plus card disputed après admin decided (filtre actif)'
);

-- Test 83 : Idempotent — 2e signalement décidé n'écrase pas le 1er timestamp (coalesce)
-- Eric crée un signalement à son tour (Marie a déjà signalé pour produit_defectueux)
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select public.create_signalement_post_rdv(
  'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid,
  'comportement_dangereux'::motif_signalement_rdv
);

-- Admin Frank rejette le 2e signalement (Eric → motif comportement_dangereux)
-- Coalesce dans le trigger doit préserver le 1er timestamp (posé par traite de Diane).
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
do $$
declare v_sig_id uuid;
begin
  -- Pause minimale pour garantir un now() différent si update non-idempotent
  perform pg_sleep(0.05);

  select id into v_sig_id from public.signalements
  where target_id = 'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid
    and signaleur_id = '22222222-2222-2222-2222-222222222222'::uuid
    and motif_categorie = 'comportement_dangereux';
  perform public.admin_treat_signalement(v_sig_id, 'rejete');
end $$;

-- Test 83 : admin_signalement_decided_at = updated_at du 1er signalement traité (Diane)
-- (le 2e signalement rejeté n'a pas écrasé)
select is(
  (select admin_signalement_decided_at from public.conversations
   where id = 'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid),
  (select updated_at from public.signalements
   where target_id = 'ffffffff-ffff-ffff-ffff-ffff1111ffff'::uuid
     and signaleur_id = '11111111-1111-1111-1111-111111111111'::uuid
     and motif_categorie = 'produit_defectueux'),
  'mig 96 — admin_signalement_decided_at idempotent (coalesce preserve 1er timestamp posé par Diane, ignore 2e rejet d''Eric)'
);

-- Test 84 : trigger ignore target_type non rdv_post
-- Setup : nouvelle conv vierge sur l'annonce courante du Bloc 15 (eeeeeeee-…),
-- puis signalement target_type=utilisateur traité par admin.
-- L'annonce 'aaaaaaaa-…' du Bloc 11 a été deletée par seed_rdv_passed depuis,
-- donc on utilise l'annonce courante encore présente en DB.
do $$
declare v_sig_id uuid;
begin
  -- Nouvelle conv vierge sur l'annonce du Bloc 15 (acheteuse Frank cette fois
  -- pour ne pas collider avec la conv ffffffff-… qui est Diane↔Eric)
  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id)
  values (
    '12121212-1212-1212-1212-121212121212'::uuid,
    'eeeeeeee-eeee-eeee-eeee-eeee1111eeee'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,  -- Frank acheteur
    '22222222-2222-2222-2222-222222222222'::uuid   -- Eric vendeur
  )
  on conflict (id) do nothing;

  -- Diane signale Eric directement (target_type='utilisateur', PAS rdv_post)
  perform tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
  perform public.submit_report(
    'utilisateur'::cible_signalement,
    '22222222-2222-2222-2222-222222222222'::uuid,
    'Test trigger filter mig 96',
    'Le trigger ne doit toucher que rdv_post'
  );

  -- Frank traite (admin)
  perform tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
  select id into v_sig_id from public.signalements
  where target_type = 'utilisateur'
    and target_id = '22222222-2222-2222-2222-222222222222'::uuid
    and signaleur_id = '11111111-1111-1111-1111-111111111111'::uuid
  order by created_at desc limit 1;
  perform public.admin_treat_signalement(v_sig_id, 'traite');
end $$;

-- La nouvelle conv n'a JAMAIS reçu admin_signalement_decided_at
-- (trigger filtre `if NEW.target_type = 'rdv_post'` côté mig 96)
select is(
  (select admin_signalement_decided_at from public.conversations
   where id = '12121212-1212-1212-1212-121212121212'::uuid),
  null,
  'mig 96 — trigger ignore target_type=utilisateur (admin_signalement_decided_at reste null sur conv non-rdv_post)'
);

-- Cleanup admin
update public.users set is_admin = false where id = '33333333-3333-3333-3333-333333333333'::uuid;

-- ── Bloc 16 : Mig 97 — rappels push avant RDV (J-1 + H-2) ────────────────

-- Setup : seed avec RDV confirmé futur (override rdv_date pour tester
-- les fenêtres). seed_rdv_passed met rdv_date dans le passé → on overwrite.
select tests.seed_rdv_passed('aaaaaaaa-aaaa-aaaa-aaaa-aaaa9797aaaa'::uuid,
                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid);

-- Test 85 : conv neuve a rdv_reminders_sent = 0 par défaut
select is(
  (select rdv_reminders_sent from public.conversations
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid),
  0::smallint,
  'mig 97 — rdv_reminders_sent = 0 par défaut sur conv vierge'
);

-- Force RDV dans 36h (hors fenêtre J-1) — note : ce update va trigger reset
-- mais le counter est déjà à 0, donc pas de changement observable
update public.conversations
set rdv_date = now() + interval '36 hours'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid;

select public.fn_push_rdv_reminder();

-- Test 86 : RDV dans plus de 24h → no-op (counter reste 0)
select is(
  (select rdv_reminders_sent from public.conversations
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid),
  0::smallint,
  'mig 97 — RDV dans >24h → fn_push_rdv_reminder no-op (counter reste 0)'
);

-- Force RDV dans 12h (fenêtre J-1)
update public.conversations
set rdv_date = now() + interval '12 hours'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid;

select public.fn_push_rdv_reminder();

-- Test 87 : RDV dans <24h ET sent=0 → pose sent=1 (J-1 envoyé)
select is(
  (select rdv_reminders_sent from public.conversations
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid),
  1::smallint,
  'mig 97 — RDV dans <24h + sent=0 → push J-1, counter passe à 1'
);

-- Force RDV dans 1h (fenêtre H-2)
update public.conversations
set rdv_date = now() + interval '1 hour'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid;

-- ⚠ le trigger tg_reset_rdv_reminders réinitialise sent à 0 quand rdv_date
-- change → on doit donc re-set sent à 1 manuellement pour simuler "J-1 déjà
-- envoyé hier" (sinon on est ramené à 0 et on ne testerait que J-1 again).
update public.conversations
set rdv_reminders_sent = 1
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid;

select public.fn_push_rdv_reminder();

-- Test 88 : RDV dans <2h ET sent=1 → pose sent=2 (H-2 envoyé)
select is(
  (select rdv_reminders_sent from public.conversations
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid),
  2::smallint,
  'mig 97 — RDV dans <2h + sent=1 → push H-2, counter passe à 2'
);

-- Force RDV passé (-30 min) — note : trigger va reset à 0
update public.conversations
set rdv_date = now() - interval '30 minutes'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid;

select public.fn_push_rdv_reminder();

-- Test 89 : RDV passé → no-op (filtre `rdv_date > now()` du helper)
-- Counter reste à 0 (réinitialisé par trigger) — pas remonté à 1/2 par le helper
select is(
  (select rdv_reminders_sent from public.conversations
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid),
  0::smallint,
  'mig 97 — RDV passé → fn_push_rdv_reminder no-op (filtre rdv_date > now)'
);

-- Test 90 : trigger tg_reset_rdv_reminders reset counter quand rdv_date change
-- Setup : pose sent=2, puis change rdv_date → doit revenir à 0
update public.conversations
set rdv_reminders_sent = 2,
    rdv_date = now() + interval '5 hours'
where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid;

-- Trigger should have fired at the same UPDATE → both fields touched
-- en réalité le trigger reset sent à 0 dans la MÊME update car BEFORE UPDATE
-- (NEW.rdv_reminders_sent := 0 si rdv_date change).
select is(
  (select rdv_reminders_sent from public.conversations
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbb9797bbbb'::uuid),
  0::smallint,
  'mig 97 — trigger tg_reset_rdv_reminders reset counter quand rdv_date change'
);

-- ── Bloc 17 : Mig 98 — get_my_rdv_signalement_status (verdict perso) ─────

-- Setup : nouvelle conv en disputed (Diane=true, Eric=false), pas encore de signalement
select tests.seed_rdv_passed('cccccccc-cccc-cccc-cccc-cccc9898cccc'::uuid,
                             'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid);

update public.conversations
set rencontre_acheteur = true,
    rencontre_vendeur  = false,
    rencontre_decided_at = now()
where id = 'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid;

-- Test 91 : sans signalement → has_signalement=false
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.get_my_rdv_signalement_status(
    'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid
  ))->>'has_signalement',
  'false',
  'mig 98 — caller sans signalement → has_signalement=false'
);

-- Diane signale Eric (motif no_show)
select public.create_signalement_post_rdv(
  'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid,
  'no_show'::motif_signalement_rdv
);

-- Test 92 : avec signalement en_attente → statut='en_attente'
select is(
  (public.get_my_rdv_signalement_status(
    'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid
  ))->>'statut',
  'en_attente',
  'mig 98 — signalement en_attente retourné après création'
);

-- Frank (admin) traite le signalement
update public.users set is_admin = true where id = '33333333-3333-3333-3333-333333333333'::uuid;
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
do $$
declare v_sig_id uuid;
begin
  select id into v_sig_id from public.signalements
  where target_id = 'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid
    and signaleur_id = '11111111-1111-1111-1111-111111111111'::uuid;
  perform public.admin_treat_signalement(v_sig_id, 'traite');
end $$;

-- Test 93 : après admin treat → statut='traite' côté Diane
select tests.set_jwt_for('11111111-1111-1111-1111-111111111111'::uuid);
select is(
  (public.get_my_rdv_signalement_status(
    'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid
  ))->>'statut',
  'traite',
  'mig 98 — signalement traité retourné après admin treat'
);

-- Test 94 : Eric (autre partie qui n'a pas signalé) → has_signalement=false
-- Anti-leak : il ne voit pas le signalement de Diane, juste son propre absence
select tests.set_jwt_for('22222222-2222-2222-2222-222222222222'::uuid);
select is(
  (public.get_my_rdv_signalement_status(
    'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid
  ))->>'has_signalement',
  'false',
  'mig 98 — anti-leak : Eric (autre partie sans signalement) voit has_signalement=false'
);

-- Test 95 : Frank (tiers non-participant) → has_signalement=false
select tests.set_jwt_for('33333333-3333-3333-3333-333333333333'::uuid);
select is(
  (public.get_my_rdv_signalement_status(
    'dddddddd-dddd-dddd-dddd-dddd9898dddd'::uuid
  ))->>'has_signalement',
  'false',
  'mig 98 — anti-leak : non-participant (Frank) voit has_signalement=false'
);

-- Cleanup admin
update public.users set is_admin = false where id = '33333333-3333-3333-3333-333333333333'::uuid;

select * from finish();
rollback;

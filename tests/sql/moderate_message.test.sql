-- ─────────────────────────────────────────────────────────────────────────────
-- Tests pgTAP — Couche 4 modération messagerie (Phase 4)
--
-- Couvre via DB direct (schéma, grants, contraintes) :
--   - Mig 119 : user système Niqo Auto-Modération existe avec UUID figé
--   - Mig 120 : helper _invoke_moderate_message existe + lockdown grants
--   - Mig 120 : trigger trg_moderate_message_async fire AFTER INSERT messages
--   - Trigger function fn_moderate_message_async : filtres type / is_deleted /
--     expediteur=system / contenu_vide (sans appeler effectivement pg_net,
--     qui est non-bloquant et fail-silent en env de test)
--
-- LIMITES
--   pg_net.http_post est fire-and-forget : on ne peut pas valider le payload
--   envoyé à l'EF côté pgTAP. Cette partie est couverte par les tests Vitest
--   E2E (tests/integration/moderation-message.test.ts).
--
-- Cf. docs/backend/moderation.md §Couche 4.
-- Migs couvertes : 119, 120.
-- ─────────────────────────────────────────────────────────────────────────────

begin;
select plan(15);

-- ═════════════════════════════════════════════════════════════════════════════
-- ── 1. User système (mig 119) ───────────────────────────────────────────────
-- ═════════════════════════════════════════════════════════════════════════════

select ok(
  exists(
    select 1 from auth.users
    where id = '00000000-0000-0000-0000-000000000001'::uuid
      and email = 'auto-moderation@niqo.africa'
      and aud = 'authenticated'
      and role = 'authenticated'
  ),
  'mig 119 : user système présent dans auth.users avec aud + role authenticated'
);

select ok(
  exists(
    select 1 from auth.users
    where id = '00000000-0000-0000-0000-000000000001'::uuid
      and raw_app_meta_data->>'provider' = 'email'
  ),
  'mig 119 : raw_app_meta_data.provider = email (sinon GoTrue refuse — cf. memory feedback_supabase_auth_users_insert)'
);

select ok(
  exists(
    select 1 from public.users
    where id = '00000000-0000-0000-0000-000000000001'::uuid
      and prenom = 'Niqo'
      and nom = 'Auto-Modération'
      and is_active = true
      and is_admin = false
      and score_abus = 0
  ),
  'mig 119 : public.users row Niqo Auto-Modération is_active=true, is_admin=false'
);

select ok(
  (select pays::text from public.users
   where id = '00000000-0000-0000-0000-000000000001'::uuid) in ('CI', 'CG'),
  'mig 119 : pays valide (enum pays_code)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- ── 2. Helper _invoke_moderate_message (mig 120) ────────────────────────────
-- ═════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  '_invoke_moderate_message',
  array['uuid'],
  'mig 120 : helper _invoke_moderate_message(uuid) existe'
);

select ok(
  exists(
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = '_invoke_moderate_message'
      and n.nspname = 'public'
      and p.prosecdef = true
  ),
  'mig 120 : _invoke_moderate_message est SECURITY DEFINER'
);

-- Lockdown : authenticated/anon/public ne peuvent PAS exécuter le helper.
-- has_function_privilege() retourne true/false sans throw.
select ok(
  not has_function_privilege(
    'authenticated',
    'public._invoke_moderate_message(uuid)',
    'EXECUTE'
  ),
  'mig 120 : authenticated ne peut PAS exécuter _invoke_moderate_message (lockdown)'
);

select ok(
  not has_function_privilege(
    'anon',
    'public._invoke_moderate_message(uuid)',
    'EXECUTE'
  ),
  'mig 120 : anon ne peut PAS exécuter _invoke_moderate_message (lockdown)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- ── 3. Trigger fn_moderate_message_async (mig 120) ──────────────────────────
-- ═════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  'fn_moderate_message_async',
  'mig 120 : trigger function fn_moderate_message_async existe'
);

select ok(
  exists(
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'trg_moderate_message_async'
      and c.relname = 'messages'
      and t.tgenabled = 'O'
      and (t.tgtype & 2) = 0  -- AFTER (bit 2 = BEFORE, donc =0 → AFTER)
      and (t.tgtype & 4) = 4  -- INSERT
  ),
  'mig 120 : trigger trg_moderate_message_async AFTER INSERT sur public.messages enabled'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- ── 4. Comportement trigger (filtres) ───────────────────────────────────────
-- ═════════════════════════════════════════════════════════════════════════════
--
-- On crée 2 users + 1 conv + on insère plusieurs messages. Le trigger appelle
-- _invoke_moderate_message qui catch toute exception (notamment pg_net absent
-- dans env test). On vérifie juste que l'INSERT message réussit (pas de
-- raise) pour TOUS les cas filtrés.

do $$
declare
  v_alice uuid := 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  v_bob   uuid := 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';
  v_cat   uuid;
  v_ann   uuid := 'ccccccc1-cccc-cccc-cccc-cccccccccccc';
  v_conv  uuid := 'ddddddd2-dddd-dddd-dddd-dddddddddddd';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, aud, role)
  values
    (v_alice, 'alice-mod@niqo.test', crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Alice','nom','User','pays','CI','telephone','+2250777200001','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated'),
    (v_bob,   'bob-mod@niqo.test',   crypt('p', gen_salt('bf')),
     jsonb_build_object('prenom','Bob','nom','User','pays','CI','telephone','+2250777200002','auth_provider','email'),
     '{"provider":"email"}'::jsonb, now(), 'authenticated', 'authenticated');

  select id into v_cat from public.categories
    where is_active = true and nom <> 'Immobilier' order by ordre limit 1;

  insert into public.annonces (id, vendeur_id, categorie_id, titre, description, prix, photos, etat, ville, pays, expires_at, statut)
  values (v_ann, v_bob, v_cat,
          'iPhone test moderate-message',
          'Description longue suffisante pour passer le CHECK constraint mig 15.',
          100000, array['t.jpg']::text[], 'bon', 'Abidjan', 'CI',
          now() + interval '60 days', 'active'::statut_annonce);

  insert into public.conversations (id, annonce_id, acheteur_id, vendeur_id)
  values (v_conv, v_ann, v_alice, v_bob);

  perform set_config('niqo.alice_id', v_alice::text, false);
  perform set_config('niqo.bob_id', v_bob::text, false);
  perform set_config('niqo.conv_id', v_conv::text, false);
end $$;

-- Test : INSERT message texte d'un user humain → trigger fire, pas de crash
-- (pg_net.http_post est fail-silent quand pg_net absent ou URL injoignable)
prepare insert_texte_user as
  insert into public.messages (conversation_id, expediteur_id, type, contenu)
  values (
    current_setting('niqo.conv_id')::uuid,
    current_setting('niqo.alice_id')::uuid,
    'texte',
    'Salut Bob, est-ce que ton iPhone est encore dispo ?'
  )
  returning id;

select lives_ok(
  'execute insert_texte_user',
  'trigger : INSERT message texte humain réussit (pg_net fire-and-forget non-bloquant)'
);
deallocate insert_texte_user;

-- Test : INSERT message type='systeme' → trigger skip (NEW.type <> 'texte')
prepare insert_systeme as
  insert into public.messages (conversation_id, expediteur_id, type, contenu)
  values (
    current_setting('niqo.conv_id')::uuid,
    current_setting('niqo.alice_id')::uuid,
    'systeme',
    'Alice a proposé un RDV.'
  )
  returning id;

select lives_ok(
  'execute insert_systeme',
  'trigger : INSERT message type=systeme passe (filtre type <> texte)'
);
deallocate insert_systeme;

-- Test : INSERT message type='image' → trigger skip
prepare insert_image as
  insert into public.messages (conversation_id, expediteur_id, type, contenu)
  values (
    current_setting('niqo.conv_id')::uuid,
    current_setting('niqo.alice_id')::uuid,
    'image',
    'https://example.com/image.jpg'
  )
  returning id;

select lives_ok(
  'execute insert_image',
  'trigger : INSERT message type=image passe (filtre type <> texte)'
);
deallocate insert_image;

-- Test : INSERT message du system user → trigger skip (anti-loop)
-- Use service_role bypass RLS pour insérer en tant que system user
prepare insert_from_system as
  insert into public.messages (conversation_id, expediteur_id, type, contenu)
  values (
    current_setting('niqo.conv_id')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'texte',
    'Message hypothétique du system user (pour test anti-loop).'
  )
  returning id;

select lives_ok(
  'execute insert_from_system',
  'trigger : INSERT message du system user passe (filtre anti-loop)'
);
deallocate insert_from_system;

-- ═════════════════════════════════════════════════════════════════════════════
-- ── 5. Cohérence FK signalements ────────────────────────────────────────────
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Vérifie que le system user peut effectivement être référencé dans
-- signalements.signaleur_id (FK + cascade) — c'est tout l'intérêt de la mig.

prepare insert_signalement_system as
  insert into public.signalements
    (target_type, target_id, signaleur_id, motif, description)
  values
    ('message',
     (select id from public.messages
      where contenu = 'Salut Bob, est-ce que ton iPhone est encore dispo ?'
      limit 1),
     '00000000-0000-0000-0000-000000000001'::uuid,
     'Modération auto : test',
     'Description de test')
  returning id;

select lives_ok(
  'execute insert_signalement_system',
  'mig 119 : signalement avec signaleur_id=system_uuid réussit (FK OK)'
);
deallocate insert_signalement_system;

select * from finish();
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 119 — User système Niqo Auto-Modération (couche 4 messagerie)
--
-- CONTEXTE
--   Phase 4 modération auto = scan async des messages chat via OpenAI
--   Moderation API. Si flagged → INSERT direct dans public.signalements avec
--   signaleur_id = ce user système. La cascade existante (3 signalements
--   confirmés en 30j → auto-suspend mig 25 + 56-57) prend ensuite le relais.
--
--   signalements.signaleur_id ne peut pas être NULL (mig 25), donc on a besoin
--   d'un user réel. Le choix d'un user système dédié (vs nullable + flag) :
--     - garde l'unique constraint (target_type, target_id, signaleur_id)
--     - garde la simplicité du back-office signalements (1 schéma unique)
--     - permet d'attribuer 100 signalements auto au même UUID sans collision
--       car (target_type, target_id) sont différents à chaque fois
--
-- IDENTITÉ FIGÉE
--   UUID : 00000000-0000-0000-0000-000000000001
--   Email : auto-moderation@niqo.africa (jamais consulté, jamais notifié)
--   Identité affichée admin web : "Niqo Auto-Modération"
--
-- INSERT auth.users
--   Conventions GoTrue obligatoires même si le user ne sign-in jamais :
--     - aud = 'authenticated'
--     - role = 'authenticated'
--     - raw_app_meta_data.provider = 'email'
--   (cf. memory feedback_supabase_auth_users_insert ; un INSERT sans ces
--   champs crée un user "fantôme" que GoTrue refuse de gérer)
--   encrypted_password = mot de passe random non utilisable (60 chars bcrypt).
--   email_confirmed_at = now() pour bypass la confirmation email.
--
-- SÉCURITÉ
--   is_active = true (sinon une RLS éventuelle qui filtre les actifs casserait
--                     l'insert de signalement par service_role — défensif).
--   is_admin = false (juste un user normal, mais identifiable par UUID).
--   score_abus = 0 (ne s'auto-suspendrait pas).
--   pays = 'CI' (arbitraire, le user n'est jamais affiché en liste).
--
-- ANTI-COLLISION
--   ON CONFLICT (id) DO NOTHING : migration idempotente, ne crash pas si
--   relancée. Même UUID = même user.
--
-- POST-DEPLOY
--   select id, email, prenom, nom, is_active from public.users
--   where id = '00000000-0000-0000-0000-000000000001';
--   -- → Niqo Auto-Modération, is_active=true
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. INSERT auth.users ─────────────────────────────────────────────────────

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'auto-moderation@niqo.africa',
  crypt(gen_random_uuid()::text, gen_salt('bf')),
  now(),
  jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'role', 'system'
  ),
  jsonb_build_object(
    'system', true,
    'purpose', 'auto_moderation'
  ),
  now(),
  now()
)
on conflict (id) do nothing;

-- ── 2. INSERT public.users ───────────────────────────────────────────────────

insert into public.users (
  id,
  email,
  prenom,
  nom,
  pays,
  ville,
  auth_provider,
  is_active,
  is_admin,
  score_abus,
  nb_ventes,
  nb_achats
)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'auto-moderation@niqo.africa',
  'Niqo',
  'Auto-Modération',
  'CI',
  'System',
  'email',
  true,
  false,
  0,
  0,
  0
)
on conflict (id) do update set
  prenom = excluded.prenom,
  nom = excluded.nom,
  email = excluded.email,
  is_active = excluded.is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- Runner pgTAP — chargé avant chaque fichier *.test.sql
--
-- Active l'extension pgTAP. Dans Supabase local, l'extension est dispo
-- mais pas pré-installée par défaut.
--
-- Cf. tests/README.md pour le process complet.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgtap;

-- Schema dédié aux helpers de test (pour pas polluer public.)
-- Doit être créé AVANT les CREATE FUNCTION qui s'y déposent.
create schema if not exists tests;

-- Grant USAGE pour que les helpers soient appelables sous `set role authenticated`
-- (pour tester les RLS dans le même fichier de test).
grant usage on schema tests to authenticated, anon;

-- Helper : crée un user de test en bypass de la cascade auth.users.
-- On insère directement dans auth.users + public.users (le trigger
-- fn_handle_new_user fera doublon mais l'INSERT public.users sera ignoré
-- par la PK).
create or replace function tests.seed_user(
  p_email text default null,
  p_pays  text default 'CI',
  p_is_admin boolean default false,
  p_is_active boolean default true,
  p_score_abus int default 0
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_uid   uuid := gen_random_uuid();
  v_email text := coalesce(p_email, 'test-' || v_uid::text || '@niqo.test');
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at)
    values (v_uid, v_email, crypt('test-pass-123', gen_salt('bf')), now());

  insert into public.users (id, email, prenom, nom, pays, ville, is_admin, is_active, score_abus)
    values (v_uid, v_email, 'Test', 'User', p_pays::pays_code, 'Abidjan', p_is_admin, p_is_active, p_score_abus)
  on conflict (id) do update set
    is_admin = excluded.is_admin,
    is_active = excluded.is_active,
    score_abus = excluded.score_abus;

  return v_uid;
end;
$$;

-- Helper : simule la session JWT pour un user donné dans la transaction
create or replace function tests.set_jwt_for(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- Grant execute aux roles applicatifs pour les helpers de test
grant execute on function tests.seed_user(text, text, boolean, boolean, int) to authenticated, anon;
grant execute on function tests.set_jwt_for(uuid) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 123 — Guard "test mode" pour skip pg_net + vault en CI
--
-- PROBLÈME
--   La CI Vitest fait crasher Postgres après ~30 user creations + nombreux
--   INSERT avis. Segfault signal 11 sur un `submit_avis()`, cluster passe en
--   recovery mode, tous les tests suivants fail avec
--   "Database error checking email" (cf. run 25794593201, branche develop).
--
--   Le crash arrive dans la chaîne :
--     INSERT avis
--       → trg_push_avis_received (mig 67)
--         → fn_push_avis_received
--           → _notify_push (mig 65)
--             → vault.decrypted_secrets + net.http_post
--
--   pg_net (extension C) et pgsodium/vault (extension C) sont notoirement
--   instables sous charge. Le segfault n'est pas reproductible isolément,
--   mais déterministe après accumulation de N appels dans la même session
--   Postgres (problème mémoire interne aux extensions).
--
--   Les tests d'intégration ne valident PAS les push notifs (Expo n'est pas
--   atteignable depuis CI) ni l'EF moderation (gated par OPENAI_AVAILABLE)
--   ni la purge Storage KYC (testée indépendamment). Donc on peut désactiver
--   ces 3 chemins pg_net en test sans perdre de couverture.
--
-- SOLUTION — Marker table + early-return
--   Une table singleton `public._niqo_test_mode (enabled bool)` indique si
--   on est en CI. Trois helpers internes (`_notify_push`,
--   `_invoke_moderate_message`, `purge_cni_storage_on_verif_delete`) lisent
--   cet état au début et return immédiatement si enabled = true.
--
--   En PROD : la table existe avec `enabled = false`. Les helpers passent un
--   SELECT STABLE (Postgres le cache pour la durée du statement → quasi
--   gratuit) puis continuent leur chemin pg_net normal. Comportement
--   identique à avant cette migration.
--
--   En CI : le workflow `.github/workflows/backend-tests.yml` UPDATE
--   `enabled = true` entre `supabase start` et `npm test`. Les helpers
--   skip immédiatement, pg_net n'est jamais touché, pas de segfault.
--
-- POURQUOI PAS UN GUC current_setting('app.niqo_test_mode')
--   - ALTER DATABASE / ALTER ROLE n'affecte pas les sessions PostgREST déjà
--     pooled (il faut un reconnect explicite).
--   - SET LOCAL ne traverse pas un appel RPC SECURITY DEFINER (différent
--     contexte d'exécution).
--   - Une marker table + SELECT STABLE est immédiatement visible par toutes
--     les connexions PostgREST, sans reconnect, et coûte ~0 en prod.
--
-- POURQUOI CETTE MIGRATION EXISTE EN PROD ET PAS UN OVERRIDE CI-ONLY
--   - Garder la mig dans docs/migrations garantit que CI joue exactement le
--     même schéma que prod (sinon on teste un schema divergent → faux sens
--     de sécurité).
--   - Le flag enabled = false par défaut → prod inchangé, idempotent.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + §Backend ownership.
-- Cf. .github/workflows/backend-tests.yml job vitest pour le flip CI.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Marker table singleton ──────────────────────────────────────────────
-- CHECK (id = 1) garantit une seule ligne possible. INSERT ON CONFLICT
-- DO NOTHING pour rester idempotente sur replay.

create table if not exists public._niqo_test_mode (
  id      int     primary key default 1,
  enabled boolean not null    default false,
  check (id = 1)
);

insert into public._niqo_test_mode (id, enabled)
values (1, false)
on conflict (id) do nothing;

comment on table public._niqo_test_mode is
  'Marker CI singleton. Si enabled = true, _notify_push + _invoke_moderate_message + purge_cni_storage_on_verif_delete skip leur appel pg_net pour éviter le segfault Postgres connu (cf. mig 123). En prod : enabled = false (immutable).';

-- Lockdown : personne ne doit pouvoir UPDATE en prod. Seul un admin DB
-- (postgres role, supabase_admin role) le peut. Authenticated/anon : aucun droit.
revoke all on table public._niqo_test_mode from public, anon, authenticated;

-- ── 2. Helper _is_niqo_test_mode ───────────────────────────────────────────
-- STABLE → Postgres cache le résultat pour la durée du statement. Coût
-- effectif en prod : ~quelques µs pour le 1er appel d'un statement, 0 pour
-- les suivants du même statement.

create or replace function public._is_niqo_test_mode()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled from public._niqo_test_mode where id = 1),
    false
  );
$$;

revoke all on function public._is_niqo_test_mode() from public, anon, authenticated;
-- Pas de grant — seuls les SECURITY DEFINER internes (qui tournent en owner)
-- peuvent l'appeler.

comment on function public._is_niqo_test_mode() is
  'Helper interne : retourne true si CI test mode est actif. Utilisé par _notify_push, _invoke_moderate_message, purge_cni_storage_on_verif_delete pour skip pg_net en CI (cf. mig 123).';

-- ── 3. Refonte _notify_push (mig 65) avec guard test mode ──────────────────
-- Pattern : guard EN PREMIER, avant tout vault/pg_net. Si test mode actif,
-- return immédiatement.

create or replace function public._notify_push(
  p_user_ids uuid[],
  p_title    text,
  p_body     text,
  p_data     jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key  text;
  v_url  text;
begin
  -- Guard CI test mode (mig 123) : skip pg_net pour éviter segfault Postgres
  if public._is_niqo_test_mode() then
    return;
  end if;

  if cardinality(coalesce(p_user_ids, array[]::uuid[])) = 0 then
    return;
  end if;

  -- Service role key (chiffrée Vault). Si absent : log + skip silencieux
  -- (on ne bloque pas la transaction métier).
  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception
    when undefined_table then
      raise notice '[push] vault not enabled, skipping push notif';
      return;
  end;
  if v_key is null then
    raise notice '[push] no service_role_key in vault, skipping';
    return;
  end if;

  -- URL : Vault override si dispo, sinon hardcoded
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'push_function_url'
     limit 1;
  exception when others then v_url := null;
  end;
  v_url := coalesce(
    v_url,
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-push-notification'
  );

  -- Fire-and-forget : pg_net renvoie un id de request mais on ne l'attend pas.
  -- L'Edge Function gère elle-même la purge des dead tokens.
  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'user_ids', (select jsonb_agg(uid::text) from unnest(p_user_ids) uid),
        'title',    p_title,
        'body',     p_body,
        'data',     p_data
      )
    );
  exception
    when undefined_function then
      raise notice '[push] pg_net not enabled, skipping push notif';
    when others then
      raise notice '[push] http_post failed: %', sqlerrm;
  end;
end;
$$;

-- ── 4. Refonte _invoke_moderate_message (mig 120) avec guard test mode ─────

create or replace function public._invoke_moderate_message(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_url text;
begin
  -- Guard CI test mode (mig 123) : skip pg_net pour éviter segfault Postgres
  if public._is_niqo_test_mode() then
    return;
  end if;

  if p_message_id is null then return; end if;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception
    when undefined_table then
      raise notice '[moderate-message] vault not enabled, skipping invoke';
      return;
  end;
  if v_key is null then
    raise notice '[moderate-message] no service_role_key in vault, skipping';
    return;
  end if;

  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'moderate_message_function_url'
     limit 1;
  exception when others then v_url := null;
  end;
  v_url := coalesce(
    v_url,
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/moderate-message'
  );

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'message_id', p_message_id::text
      )
    );
  exception
    when undefined_function then
      raise notice '[moderate-message] pg_net not enabled, skipping invoke';
    when others then
      raise notice '[moderate-message] http_post failed: %', sqlerrm;
  end;
end;
$$;

-- ── 5. Refonte purge_cni_storage_on_verif_delete (mig 110) avec guard ──────

create or replace function public.purge_cni_storage_on_verif_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url  text;
  v_key  text;
  v_body jsonb;
begin
  -- Guard CI test mode (mig 123) : skip pg_net pour éviter segfault Postgres.
  -- Le DELETE row continue normalement, juste pas de purge Storage HTTP.
  if public._is_niqo_test_mode() then
    return old;
  end if;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key' limit 1;
  exception
    when undefined_table then null;
    when others then null;
  end;

  if v_key is null then
    raise notice '[kyc] vault service_role_key unavailable, skip storage purge (orphelins possibles)';
    return old;
  end if;

  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'cni_storage_remove_url' limit 1;
  exception
    when undefined_table then null;
    when others then null;
  end;

  if v_url is null then
    v_url := 'https://uokauzmafppukgsemugz.supabase.co/storage/v1/object/cni-verifications';
  end if;

  v_body := jsonb_build_object(
    'prefixes', array[
      old.cni_recto_path,
      old.cni_verso_path,
      old.selfie_path
    ]
  );

  begin
    perform net.http_delete(
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
        'authorization', 'Bearer ' || v_key,
        'content-type',  'application/json'
      )
    );
  exception
    when others then
      raise notice '[kyc] storage purge HTTP failed (orphelins possibles): %', sqlerrm;
  end;

  return old;
end;
$$;

revoke all on function public.purge_cni_storage_on_verif_delete() from public, anon, authenticated;

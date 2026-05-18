-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 128 — Extension du guard "test mode" aux helpers email (124/125/126)
--
-- PROBLÈME
--   Mig 123 a posé un guard `_is_niqo_test_mode()` sur les 3 helpers pg_net
--   connus à l'époque (`_notify_push`, `_invoke_moderate_message`,
--   `purge_cni_storage_on_verif_delete`) pour éviter le segfault Postgres
--   signal 11 que pg_net+vault produit après accumulation d'appels en CI.
--
--   Depuis, **trois nouveaux helpers pg_net ont été ajoutés sans le guard** :
--     - mig 124 : `_notify_welcome_email(uuid)`
--     - mig 125 : `_notify_admin_email(text, uuid)`
--     - mig 126 : `_notify_payment_confirmation(uuid)`
--
--   Conséquence en CI Vitest : signalements.test.ts crée des signalements
--   → trigger AFTER INSERT → `_notify_admin_email` → pg_net. kyc.test.ts
--   crée des vérifications → idem. boost.test.ts insère des paiements
--   completed → `_notify_payment_confirmation` → pg_net. Le cluster Postgres
--   segfault en cours de suite, GoTrue répond ensuite "Database error
--   checking email" sur le createUser de la suite suivante (favoris, qui
--   tourne en dernier).
--
-- SOLUTION
--   Refonte des 3 helpers via `create or replace function` en ajoutant
--   le guard `_is_niqo_test_mode()` en TOUT PREMIER (avant tout vault/pg_net),
--   strictement identique au pattern mig 123. En prod, `enabled = false`,
--   donc un SELECT STABLE quasi-gratuit puis le code continue normalement.
--   En CI, `enabled = true`, return immédiat → pas de pg_net → pas de segfault.
--
-- IDEMPOTENTE. Pattern mig 123. Aucun changement de signature, aucun trigger
-- à recréer.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Refonte _notify_welcome_email (mig 124) avec guard test mode ──────────

create or replace function public._notify_welcome_email(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
  v_url text;
begin
  -- Guard CI test mode (mig 123) : skip pg_net pour éviter segfault Postgres
  if public._is_niqo_test_mode() then
    return;
  end if;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception
    when undefined_table then
      raise notice '[welcome-email] vault not enabled, skip envoi email';
      return;
  end;

  if v_key is null then
    raise notice '[welcome-email] no service_role_key in vault, skip envoi email';
    return;
  end if;

  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'welcome_email_function_url'
     limit 1;
  exception when others then
    v_url := null;
  end;

  v_url := coalesce(
    v_url,
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-welcome-email'
  );

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('user_id', p_user_id::text)
    );
  exception
    when undefined_function then
      raise notice '[welcome-email] pg_net not enabled, skip envoi email';
    when others then
      raise notice '[welcome-email] http_post failed: %', sqlerrm;
  end;
end;
$$;

revoke all on function public._notify_welcome_email(uuid) from public;
revoke all on function public._notify_welcome_email(uuid) from authenticated;
revoke all on function public._notify_welcome_email(uuid) from anon;

-- ── 2. Refonte _notify_admin_email (mig 125) avec guard test mode ────────────

create or replace function public._notify_admin_email(
  p_type      text,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
  v_url text;
begin
  -- Guard CI test mode (mig 123) : skip pg_net pour éviter segfault Postgres
  if public._is_niqo_test_mode() then
    return;
  end if;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception
    when undefined_table then
      raise notice '[admin-notif] vault not enabled, skip envoi email';
      return;
  end;

  if v_key is null then
    raise notice '[admin-notif] no service_role_key in vault, skip envoi email';
    return;
  end if;

  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'admin_notif_function_url'
     limit 1;
  exception when others then
    v_url := null;
  end;

  v_url := coalesce(
    v_url,
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-admin-notification'
  );

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'type',      p_type,
        'target_id', p_target_id::text
      )
    );
  exception
    when undefined_function then
      raise notice '[admin-notif] pg_net not enabled, skip envoi email';
    when others then
      raise notice '[admin-notif] http_post failed: %', sqlerrm;
  end;
end;
$$;

revoke all on function public._notify_admin_email(text, uuid) from public;
revoke all on function public._notify_admin_email(text, uuid) from authenticated;
revoke all on function public._notify_admin_email(text, uuid) from anon;

-- ── 3. Refonte _notify_payment_confirmation (mig 126) avec guard test mode ───

create or replace function public._notify_payment_confirmation(
  p_paiement_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_key text;
  v_url text;
begin
  -- Guard CI test mode (mig 123) : skip pg_net pour éviter segfault Postgres
  if public._is_niqo_test_mode() then
    return;
  end if;

  begin
    select decrypted_secret into v_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception
    when undefined_table then
      raise notice '[payment-confirmation] vault not enabled, skip envoi email';
      return;
  end;

  if v_key is null then
    raise notice '[payment-confirmation] no service_role_key in vault, skip envoi email';
    return;
  end if;

  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'payment_confirmation_function_url'
     limit 1;
  exception when others then
    v_url := null;
  end;

  v_url := coalesce(
    v_url,
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-payment-confirmation'
  );

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'paiement_id', p_paiement_id::text
      )
    );
  exception
    when undefined_function then
      raise notice '[payment-confirmation] pg_net not enabled, skip envoi email';
    when others then
      raise notice '[payment-confirmation] http_post failed: %', sqlerrm;
  end;
end;
$$;

revoke all on function public._notify_payment_confirmation(uuid) from public;
revoke all on function public._notify_payment_confirmation(uuid) from authenticated;
revoke all on function public._notify_payment_confirmation(uuid) from anon;

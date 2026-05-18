-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 125 — Admin notification triggers (signalement + KYC)
--
-- Envoie automatiquement un email aux admins dès qu'un nouveau signalement
-- ou une nouvelle demande de vérification KYC est créée.
--
-- ARCHITECTURE
--   1. Vault secret `admin_notif_function_url` (URL Edge Function)
--        → fallback hardcoded si Vault absent
--
--   2. Helper `_notify_admin_email(p_type text, p_target_id uuid)` SECURITY DEFINER
--        → lit `service_role_key` (Vault, même clé que mig 65 _notify_push)
--        → lit ou fallback `admin_notif_function_url`
--        → appelle net.http_post → Edge Function `send-admin-notification`
--        → fire-and-forget non-bloquant
--        → REVOKE all from public/anon/authenticated (appelable triggers seulement)
--
--   3. Deux trigger functions :
--        `tg_fn_admin_notif_signalement()` RETURNS trigger
--           → appelle `_notify_admin_email('signalement', NEW.id)`
--        `tg_fn_admin_notif_verification()` RETURNS trigger
--           → appelle `_notify_admin_email('verification', NEW.id)`
--
--   4. Deux triggers AFTER INSERT :
--        `tg_admin_notif_signalement` sur `public.signalements`
--        `tg_admin_notif_verification` sur `public.verifications_identite`
--
-- NOTE : pas de clause WHEN(...) — tout INSERT crée un nouveau cas admin.
--   Les signalements arrivent toujours en statut `en_attente` (default).
--   Les vérifications arrivent toujours en statut `pending` (default).
--
-- PRÉREQUIS (à vérifier avant de jouer en prod)
--   - Extension `pg_net` activée (Dashboard → Database → Extensions)
--   - Extension `supabase_vault` activée
--   - Secret `service_role_key` dans vault.decrypted_secrets (posé par mig 65)
--   - Edge Function `send-admin-notification` déployée :
--       supabase functions deploy send-admin-notification
--   - Secret RESEND_API_KEY configuré dans Edge Function Secrets
--   - Secret NIQO_INTERNAL_KEY configuré dans Edge Function Secrets (partagé mig 65)
--   - Optionnel : Secret NIQO_ADMIN_BASE_URL si l'admin web a un domaine custom
--       (sinon fallback https://niqo.africa/admin)
--
-- TEST POST-DEPLOY
--   -- Tester l'envoi manuel (signalement) :
--   select _notify_admin_email('signalement', '<uuid-signalement>');
--   -- Tester l'envoi manuel (verification) :
--   select _notify_admin_email('verification', '<uuid-verification>');
--   -- Vérifier dans niqo_event_log :
--   select * from niqo_event_log where module = 'admin-notif' order by occurred_at desc limit 10;
--
-- IDEMPOTENTE. Pattern mig 124 (welcome email triggers).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. URL de l'Edge Function (Vault, pattern mig 65 + 124) ─────────────────
-- Stockée côté Vault pour basculer prod/staging sans modifier le SQL.
-- Fallback hardcoded si le secret est absent (Vault désactivé).

do $$
begin
  perform vault.create_secret(
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-admin-notification',
    'admin_notif_function_url',
    'URL Edge Function send-admin-notification (override prod via Vault)'
  );
exception
  when unique_violation then null;  -- déjà stocké, OK
  when others then
    raise notice '[admin-notif] vault.create_secret admin_notif_function_url failed (vault disabled?), on utilisera l''URL hardcodée';
end $$;

-- ── 1. Helper privé _notify_admin_email ─────────────────────────────────────
-- SECURITY DEFINER : tourne avec les droits du owner (postgres), pas du caller.
-- REVOKE de public/anon/authenticated : appelable uniquement par les triggers.
-- search_path verrouillé : public, vault, extensions (anti search_path hijack).

create or replace function public._notify_admin_email(
  p_type      text,   -- 'signalement' | 'verification'
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
  -- Clé bearer (NIQO_INTERNAL_KEY) lue depuis Vault.
  -- Même clé que _notify_push (mig 65) — stockée sous le nom 'service_role_key'.
  -- Si absente : log + skip silencieux (ne bloque pas la transaction).
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

  -- URL Edge Function : Vault override si dispo, sinon fallback hardcoded.
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

  -- Fire-and-forget via pg_net (non-bloquant — ne bloque pas l'INSERT métier).
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

-- Lockdown : uniquement les triggers SECURITY DEFINER (owner) peuvent appeler
-- ce helper — pas exposé à l'API REST ni à anon/authenticated.
revoke all on function public._notify_admin_email(text, uuid) from public;
revoke all on function public._notify_admin_email(text, uuid) from authenticated;
revoke all on function public._notify_admin_email(text, uuid) from anon;

-- ── 2a. Trigger function — signalement ──────────────────────────────────────

create or replace function public.tg_fn_admin_notif_signalement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify_admin_email('signalement', NEW.id);
  return NEW;
end;
$$;

-- ── 2b. Trigger function — verification KYC ──────────────────────────────────

create or replace function public.tg_fn_admin_notif_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify_admin_email('verification', NEW.id);
  return NEW;
end;
$$;

-- ── 3a. Trigger AFTER INSERT ON public.signalements ──────────────────────────
-- Pas de clause WHEN : tout nouveau signalement = notification admin.
-- Statut default = 'en_attente' (mig 25).
-- Drop préalable pour idempotence.

drop trigger if exists tg_admin_notif_signalement on public.signalements;

create trigger tg_admin_notif_signalement
  after insert on public.signalements
  for each row
  execute function public.tg_fn_admin_notif_signalement();

-- ── 3b. Trigger AFTER INSERT ON public.verifications_identite ────────────────
-- Pas de clause WHEN : toute nouvelle demande KYC = notification admin.
-- Statut default = 'pending' (mig 45).
-- Drop préalable pour idempotence.

drop trigger if exists tg_admin_notif_verification on public.verifications_identite;

create trigger tg_admin_notif_verification
  after insert on public.verifications_identite
  for each row
  execute function public.tg_fn_admin_notif_verification();

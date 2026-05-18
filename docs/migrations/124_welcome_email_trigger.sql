-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 124 — Welcome email trigger (v2 — timing post-confirmation)
--
-- Envoie automatiquement un email de bienvenue APRÈS confirmation de l'email.
-- Deux triggers distincts selon le provider :
--
-- ARCHITECTURE
--   1. Helper `_notify_welcome_email(uuid)` SECURITY DEFINER
--        → lit `service_role_key` (Vault, même clé que mig 65 _notify_push)
--        → lit ou fallback `welcome_email_function_url` (Vault)
--        → appelle net.http_post → Edge Function `send-welcome-email`
--        → fire-and-forget non-bloquant
--
--   2. Trigger function `tg_fn_welcome_email()` RETURNS trigger
--        → appelle `_notify_welcome_email(NEW.id)`
--        → retourne NEW (ne bloque pas)
--        → gate admin : géré côté Edge Function (skip is_admin = true)
--
--   3a. Trigger `tg_welcome_email_oauth` AFTER INSERT ON public.users
--         WHEN (NEW.auth_provider IN ('google', 'apple'))
--         → OAuth : email déjà confirmé par le provider → welcome immédiat
--
--   3b. Trigger `tg_welcome_email_confirmed` AFTER UPDATE OF email_confirmed_at ON auth.users
--         WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
--         → Email/password : welcome fire à la transition NULL → NOT NULL
--           (i.e. après que l'user ait cliqué le lien "Confirme ton inscription")
--
-- PRÉREQUIS (à vérifier avant de jouer en prod)
--   - Extension `pg_net` activée (Dashboard → Database → Extensions)
--   - Extension `supabase_vault` activée
--   - Secret `service_role_key` dans vault.decrypted_secrets (posé par mig 65)
--   - Edge Function `send-welcome-email` déployée :
--       supabase functions deploy send-welcome-email
--   - Secret RESEND_API_KEY configuré dans Edge Function Secrets
--   - Secret NIQO_INTERNAL_KEY configuré dans Edge Function Secrets (partagé mig 65)
--
-- TEST POST-DEPLOY
--   -- Tester l'envoi manuel :
--   select _notify_welcome_email('<uuid-test-user>');
--   -- Vérifier dans niqo_event_log :
--   select * from niqo_event_log where module = 'welcome-email' order by occurred_at desc limit 5;
--   -- Note : pour tester le trigger email/password, créer un NOUVEAU compte
--   -- email/password et cliquer le lien de confirmation — le trigger ne fire
--   -- pas sur un compte déjà confirmé (transition NULL→NOT NULL requise).
--
-- IDEMPOTENTE. Pattern mig 65 (push notifications).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. URL de l'Edge Function (Vault, pattern mig 65) ───────────────────────
-- Stockée côté Vault pour basculer prod/staging sans modifier le SQL.
-- Fallback hardcoded si le secret est absent (Vault désactivé).

do $$
begin
  perform vault.create_secret(
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-welcome-email',
    'welcome_email_function_url',
    'URL Edge Function send-welcome-email (override prod via Vault)'
  );
exception
  when unique_violation then null;  -- déjà stocké, OK
  when others then
    raise notice '[welcome-email] vault.create_secret welcome_email_function_url failed (vault disabled?), on utilisera l''URL hardcodée';
end $$;

-- ── 1. Helper privé _notify_welcome_email ────────────────────────────────────
-- SECURITY DEFINER : tourne avec les droits du owner (postgres), pas du caller.
-- REVOKE de public/anon/authenticated : appelable uniquement par les triggers.
-- search_path verrouillé : public, vault, extensions (anti search_path hijack).

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
      raise notice '[welcome-email] vault not enabled, skip envoi email';
      return;
  end;

  if v_key is null then
    raise notice '[welcome-email] no service_role_key in vault, skip envoi email';
    return;
  end if;

  -- URL Edge Function : Vault override si dispo, sinon fallback hardcoded.
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

  -- Fire-and-forget via pg_net (non-bloquant — ne bloque pas le INSERT users).
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

-- Lockdown : uniquement les triggers SECURITY DEFINER (owner) peuvent appeler
-- ce helper — pas exposé à l'API REST ni à anon/authenticated.
revoke all on function public._notify_welcome_email(uuid) from public;
revoke all on function public._notify_welcome_email(uuid) from authenticated;
revoke all on function public._notify_welcome_email(uuid) from anon;

-- ── 2. Trigger function ───────────────────────────────────────────────────────
-- Gate admin supprimé ici : la column is_admin n'existe pas sur auth.users
-- (utilisée par le trigger 3b), et le gate is_admin est déjà appliqué côté
-- Edge Function (lignes ~146-149 de send-welcome-email/index.ts).

create or replace function public.tg_fn_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify_welcome_email(NEW.id);
  return NEW;
end;
$$;

-- ── 3a. Trigger OAuth — AFTER INSERT ON public.users ─────────────────────────
-- Fire uniquement pour Google / Apple : ces providers ont déjà vérifié l'email,
-- donc email_confirmed_at est posé au moment du INSERT → welcome immédiat OK.
-- Drop préalable pour idempotence.

drop trigger if exists tg_welcome_email on public.users;
drop trigger if exists tg_welcome_email_oauth on public.users;

create trigger tg_welcome_email_oauth
  after insert on public.users
  for each row
  when (NEW.auth_provider in ('google', 'apple'))
  execute function public.tg_fn_welcome_email();

-- ── 3b. Trigger Email/password — AFTER UPDATE OF email_confirmed_at ON auth.users ──
-- Fire uniquement à la transition NULL → NOT NULL, i.e. au clic du lien
-- "Confirme ton inscription" par l'utilisateur.
-- Syntaxe trigger sur auth.users calquée sur mig 01 (on_auth_user_created)
-- et mig 09 (on_auth_user_email_updated).

drop trigger if exists tg_welcome_email_confirmed on auth.users;

create trigger tg_welcome_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (OLD.email_confirmed_at is null and NEW.email_confirmed_at is not null)
  execute function public.tg_fn_welcome_email();

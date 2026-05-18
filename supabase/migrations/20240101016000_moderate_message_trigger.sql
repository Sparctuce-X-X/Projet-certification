-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 120 — Trigger AFTER INSERT messages → pg_net → moderate-message
--
-- Couche 4 de la modération automatique (cf. docs/backend/moderation.md).
-- Pour chaque nouveau message texte d'un user humain, on déclenche un scan
-- async via OpenAI Moderation API. Si flagged → signalement auto attribué au
-- user système (mig 119, UUID 00000000-0000-0000-0000-000000000001).
--
-- ARCHITECTURE
--
--   INSERT messages (RLS-checked côté caller user)
--      ↓
--   Trigger AFTER INSERT trg_moderate_message_async
--      ↓                                                            (fire-and-forget)
--   Helper public._invoke_moderate_message(message_id)              ─→ pg_net.http_post
--      ↓                                                                    │
--   (lit NIQO_INTERNAL_KEY + URL Vault)                                     │
--                                                                            ▼
--                                              Edge Function moderate-message
--                                                  ↓ OpenAI Moderation API
--                                                  ↓ si flagged
--                                                  ↓ INSERT signalements (signaleur_id=system)
--
-- FILTRES TRIGGER
--   Le trigger ne fire QUE pour :
--     - NEW.type = 'texte'         (skip 'image', 'systeme', 'offre_prix', etc.)
--     - NEW.is_deleted IS FALSE    (anti-double-fire si delete soft pendant insert)
--     - NEW.expediteur_id <> system_uuid  (anti-loop défensif)
--
-- FAIL-OPEN PHILOSOPHY
--   pg_net est non-bloquant (fire-and-forget). Même si l'EF est down ou
--   l'OpenAI API timeout, l'INSERT message a déjà committé → le destinataire
--   le voit normalement. La modération est best-effort.
--
-- PRÉREQUIS (vérifiés mig 65 _notify_push)
--   - Extension pg_net activée
--   - Extension supabase_vault activée
--   - Secret 'service_role_key' (= NIQO_INTERNAL_KEY) stocké dans Vault
--   - Edge Function moderate-message déployée (verify_jwt=false côté gateway)
--
-- POST-DEPLOY
--   -- Vérif helper privé (doit retourner 1 ligne)
--   select proname, prosecdef from pg_proc
--   where proname = '_invoke_moderate_message';
--
--   -- Vérif trigger
--   select tgname, tgenabled from pg_trigger
--   where tgname = 'trg_moderate_message_async';
--
--   -- Test live : insert un message texte d'un user normal, attendre ~2s,
--   -- vérifier event log
--   select event_type, payload->>'message_id', occurred_at
--   from public.niqo_event_log
--   where module = 'moderate-message'
--   order by occurred_at desc limit 5;
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Stocker l'URL de l'Edge Function dans Vault (override prod possible) ──

do $$
begin
  perform vault.create_secret(
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/moderate-message',
    'moderate_message_function_url',
    'URL Edge Function moderate-message (override prod/staging via Vault)'
  );
exception
  when unique_violation then null;  -- déjà stocké, OK
  when others then
    raise notice '[moderate-message] vault.create_secret moderate_message_function_url failed (vault disabled?), continue with hardcoded URL';
end $$;

-- ── 2. Helper privé _invoke_moderate_message ─────────────────────────────────
-- Lit le secret partagé (NIQO_INTERNAL_KEY, stocké dans Vault sous le nom
-- 'service_role_key' pour réutiliser l'entrée existante mig 65) + l'URL Vault,
-- puis fire pg_net.http_post non-bloquant.
--
-- SECURITY DEFINER : seuls les triggers (qui tournent en owner postgres)
-- peuvent l'appeler. Aucun grant à authenticated/anon/public.

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
  if p_message_id is null then return; end if;

  -- Lit le secret partagé NIQO_INTERNAL_KEY (entrée Vault 'service_role_key',
  -- même que push notif mig 65). Si vault absent : log + skip silencieux.
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

  -- URL EF (Vault override si dispo, sinon fallback hardcoded)
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

  -- Fire-and-forget : pg_net renvoie un request_id mais on ne wait pas.
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

-- Lockdown : helper accessible uniquement aux triggers SECURITY DEFINER
revoke all on function public._invoke_moderate_message(uuid) from public;
revoke all on function public._invoke_moderate_message(uuid) from authenticated;
revoke all on function public._invoke_moderate_message(uuid) from anon;

comment on function public._invoke_moderate_message(uuid) is
  'Helper privé : fire-and-forget pg_net call vers Edge Function moderate-message. SECURITY DEFINER, callable uniquement par triggers internes.';

-- ── 3. Trigger fn_moderate_message_async ─────────────────────────────────────
-- AFTER INSERT messages, fire l'EF pour les messages texte de users humains.
--
-- Filtres :
--   - type = 'texte' uniquement (skip 'systeme' = messages RDV, 'image' sans
--     caption analysable, 'offre_prix' = montant + texte court)
--   - is_deleted IS FALSE
--   - expediteur_id <> system_user_uuid (anti-loop défensif)
--
-- Note : on n'utilise PAS de WHEN clause SQL pour rester compatible avec les
-- versions Postgres anciennes ; le filtre est fait dans le corps de la fonction.

create or replace function public.fn_moderate_message_async()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Filtres de scope (cf. décision phase 4 : "Texte user uniquement")
  if NEW.type <> 'texte' then return NEW; end if;
  if coalesce(NEW.is_deleted, false) = true then return NEW; end if;
  if NEW.expediteur_id = '00000000-0000-0000-0000-000000000001'::uuid then
    return NEW;
  end if;

  -- Skip si contenu vide (rare mais possible)
  if NEW.contenu is null or length(trim(NEW.contenu)) = 0 then
    return NEW;
  end if;

  perform public._invoke_moderate_message(NEW.id);
  return NEW;
end;
$$;

drop trigger if exists trg_moderate_message_async on public.messages;
create trigger trg_moderate_message_async
  after insert on public.messages
  for each row
  execute function public.fn_moderate_message_async();

comment on trigger trg_moderate_message_async on public.messages is
  'Fire la modération async OpenAI sur chaque message texte humain. Phase 4 modération (mig 120). Fire-and-forget : ne bloque jamais l''INSERT.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 65 — Triggers push notifications (F10 Phase 2)
--
-- 4 triggers DB qui fire automatiquement la Edge Function
-- `send-push-notification` via pg_net.http_post() :
--
--   1. AFTER INSERT messages → push au destinataire ("X t'a écrit")
--   2. AFTER UPDATE conversations.rdv_confirme_at → push à l'autre partie
--      ("RDV confirmé pour <annonce>")
--   3. AFTER UPDATE verifications_identite.statut → push au owner
--      ("Vérification validée" / "Vérification refusée")
--   4. AFTER UPDATE signalements.statut='traite' → push au target user
--      ("Signalement confirmé" — incite à corriger le comportement)
--
-- Architecture sécurité :
--   - Helper privé `_notify_push` SECURITY DEFINER, schéma `public` mais
--     revoke EXECUTE FROM public/authenticated (callable uniquement par les
--     triggers, pas exposé à l'API REST)
--   - Service role key lue depuis vault.decrypted_secrets (chiffrée at-rest,
--     jamais en clair côté DB)
--   - pg_net.http_post() = fire-and-forget non-bloquant (la trigger return
--     immédiatement même si Expo répond lentement)
--   - Best-effort : si vault vide ou pg_net erreur, on log notice et continue
--     (push notif n'est jamais une raison de bloquer une transaction métier)
--
-- Prérequis :
--   - Extension `pg_net` activée (Dashboard → Database → Extensions)
--   - Extension `supabase_vault` activée
--   - Secret `service_role_key` stocké dans vault.decrypted_secrets
--   - Edge Function `send-push-notification` déployée
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. URL de l'Edge Function (stockée comme secret pour rester portable) ──
-- On stocke aussi l'URL côté Vault pour pouvoir basculer prod/staging sans
-- modifier le SQL. Si le secret n'existe pas, fallback sur l'URL hardcodée.

do $$
begin
  perform vault.create_secret(
    'https://uokauzmafppukgsemugz.supabase.co/functions/v1/send-push-notification',
    'push_function_url',
    'URL Edge Function send-push-notification (override prod via Vault)'
  );
exception
  when unique_violation then null;  -- déjà stocké, OK
  when others then
    raise notice '[push] vault.create_secret push_function_url failed (vault disabled?), continue with hardcoded URL';
end $$;

-- ── 1. Helper privé _notify_push ────────────────────────────────────────────

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

-- Lockdown : helper accessible uniquement aux fonctions internes (triggers)
revoke all on function public._notify_push(uuid[], text, text, jsonb) from public;
revoke all on function public._notify_push(uuid[], text, text, jsonb) from authenticated;
revoke all on function public._notify_push(uuid[], text, text, jsonb) from anon;
-- pas de grant — seuls les SECURITY DEFINER triggers (qui tournent en owner)
-- peuvent l'appeler

-- ── 2. Trigger : nouveau message ────────────────────────────────────────────

create or replace function public.fn_push_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv             record;
  v_destinataire_id  uuid;
  v_expediteur       text;
  v_preview          text;
begin
  -- Ne notifie pas pour les messages systèmes (RDV, etc. — leur trigger dédié
  -- s'en occupe via conversations.rdv_confirme_at)
  if NEW.type = 'systeme' then return NEW; end if;
  if NEW.is_deleted = true then return NEW; end if;

  select * into v_conv from public.conversations where id = NEW.conversation_id;
  if not found then return NEW; end if;

  -- Destinataire = l'autre participant de la conv
  v_destinataire_id := case
    when NEW.expediteur_id = v_conv.acheteur_id then v_conv.vendeur_id
    else v_conv.acheteur_id
  end;

  if v_destinataire_id is null or v_destinataire_id = NEW.expediteur_id then
    return NEW;
  end if;

  select coalesce(prenom, 'Quelqu''un') into v_expediteur
    from public.users where id = NEW.expediteur_id;

  v_preview := case
    when NEW.type = 'image' then '📷 Photo'
    when NEW.type = 'offre_prix' then '💰 ' || NEW.contenu
    when char_length(NEW.contenu) > 80 then substring(NEW.contenu, 1, 77) || '…'
    else NEW.contenu
  end;

  perform public._notify_push(
    array[v_destinataire_id],
    coalesce(v_expediteur, 'Quelqu''un') || ' t''a écrit',
    v_preview,
    jsonb_build_object('conversation_id', NEW.conversation_id::text)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_push_new_message on public.messages;
create trigger trg_push_new_message
  after insert on public.messages
  for each row
  execute function public.fn_push_new_message();

-- ── 3. Trigger : RDV confirmé ───────────────────────────────────────────────

create or replace function public.fn_push_rdv_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destinataire_id uuid;
  v_annonce_titre   text;
begin
  -- Ne fire que sur transition NULL → non-NULL de rdv_confirme_at
  if NEW.rdv_confirme_at is null or OLD.rdv_confirme_at is not null then
    return NEW;
  end if;

  -- L'autre partie = celui qui n'a pas proposé le RDV
  -- (rdv_propose_par = celui qui a proposé, donc qui ne reçoit pas la notif
  -- "RDV confirmé !" — c'est lui qui a confirmé manuellement OU c'est l'autre)
  -- Logique : on notifie celui qui n'est PAS l'expéditeur de l'event
  -- → dans ce cas, l'event = celui qui appelle confirm_rdv = ce n'est pas
  -- nécessairement le proposeur. On notifie l'autre participant.
  --
  -- Simplification : on notifie LES DEUX (l'admin appelle pas confirm_rdv,
  -- donc auth.uid() = celui qui confirme = on notifie l'autre).
  -- Mais si on est dans un trigger DB on n'a pas accès propre à auth.uid()
  -- → on notifie les 2 participants pour que tout le monde sache.

  perform public._notify_push(
    array[NEW.acheteur_id, NEW.vendeur_id],
    'RDV confirmé',
    'Vous vous retrouvez le ' ||
      to_char(NEW.rdv_date at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') ||
      coalesce(' à ' || NEW.rdv_lieu, ''),
    jsonb_build_object('conversation_id', NEW.id::text)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_push_rdv_confirmed on public.conversations;
create trigger trg_push_rdv_confirmed
  after update of rdv_confirme_at on public.conversations
  for each row
  execute function public.fn_push_rdv_confirmed();

-- ── 4. Trigger : KYC validée / refusée ──────────────────────────────────────

create or replace function public.fn_push_verification_decided()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body  text;
begin
  -- Ne fire que sur transition pending → verified | rejected
  if NEW.statut = OLD.statut then return NEW; end if;
  if NEW.statut not in ('verified', 'rejected') then return NEW; end if;

  if NEW.statut = 'verified' then
    v_title := 'Vérification validée ✓';
    v_body  := 'Tu es maintenant Vendeur Vérifié sur Niqo.';
  else
    v_title := 'Vérification refusée';
    v_body  := coalesce(NEW.reject_reason, 'Consulte ton profil pour les détails.');
    if char_length(v_body) > 180 then
      v_body := substring(v_body, 1, 177) || '…';
    end if;
  end if;

  perform public._notify_push(
    array[NEW.user_id],
    v_title,
    v_body,
    jsonb_build_object('verification_id', NEW.id::text)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_push_verification_decided on public.verifications_identite;
create trigger trg_push_verification_decided
  after update of statut on public.verifications_identite
  for each row
  execute function public.fn_push_verification_decided();

-- ── 5. Trigger : signalement traité (notif au target user) ──────────────────

create or replace function public.fn_push_signalement_treated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user_id uuid;
begin
  -- Ne fire que sur transition autre → 'traite'
  if NEW.statut <> 'traite' or OLD.statut = 'traite' then return NEW; end if;

  -- Résout le user impacté (idem trigger fn_signalement_check_threshold mig 25)
  if NEW.target_type = 'utilisateur' then
    v_target_user_id := NEW.target_id;
  elsif NEW.target_type = 'annonce' then
    select vendeur_id into v_target_user_id
      from public.annonces where id = NEW.target_id;
  elsif NEW.target_type = 'message' then
    select expediteur_id into v_target_user_id
      from public.messages where id = NEW.target_id;
  end if;

  if v_target_user_id is null then return NEW; end if;

  perform public._notify_push(
    array[v_target_user_id],
    'Signalement confirmé',
    'Un de tes contenus a été signalé et confirmé. Score d''abus mis à jour.',
    jsonb_build_object('signalement_id', NEW.id::text)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_push_signalement_treated on public.signalements;
create trigger trg_push_signalement_treated
  after update of statut on public.signalements
  for each row
  execute function public.fn_push_signalement_treated();

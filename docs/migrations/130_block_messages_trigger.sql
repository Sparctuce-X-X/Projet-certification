-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 130 — Block enforcement : BEFORE INSERT messages trigger
--
-- CONTEXTE
--   Complète mig 129 (table blocked_users + RPC). Empêche un user bloqué
--   d'envoyer un message dans une conv partagée avec le bloqueur.
--
--   Apple Guideline 1.2 UGC requirement : "Blocking should ... remove [the
--   blocked user's content] from the user's feed instantly". Cette mig couvre
--   le canal CHAT. Pour les ANNONCES, le filter se fait côté client via le
--   hook useBlockedUsers + .not('vendeur_id', 'in', blockedIds) (pas de
--   trigger DB nécessaire — le client ne fetch pas les annonces du bloqué).
--
-- TRIGGER COMPORTEMENT
--   - Skip pour type='systeme' (Niqo Auto-Modération messages doivent passer)
--   - Skip pour conversations système (rdv, etc. — pas de conv système actuellement)
--   - Pour chaque message inséré par un user humain :
--     1. Trouve l'autre participant de la conv
--     2. Check si l'autre participant a bloqué l'expéditeur
--     3. Si oui → raise BLOCKED_BY_RECIPIENT (côté front affiche message neutre)
--
-- INTERACTION AVEC TRIGGERS EXISTANTS
--   - Trigger fn_messages_content_filter (mig 29) → s'exécute APRÈS (ORDER BY
--     trigger name alphabétique : "fn_block_check" avant "fn_content_filter")
--   - Trigger moderate-message (mig 120) → AFTER INSERT, n'est pas affecté
--
-- BYPASS POSSIBLE
--   - service_role bypass RLS mais le trigger reste actif (SECURITY DEFINER ne
--     change pas ça pour les triggers BEFORE). Les admins doivent utiliser des
--     RPCs dédiées pour bypass volontairement (pas implémenté ici).
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase + task #20.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fn_messages_block_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acheteur_id uuid;
  v_vendeur_id uuid;
  v_destinataire_id uuid;
  v_is_blocked boolean;
begin
  -- Skip messages système (Niqo Auto-Modération, futurs systèmes RDV, etc.)
  -- Cohérent avec mig 35 (content filter bypass type='systeme').
  if NEW.type = 'systeme' then
    return NEW;
  end if;

  -- Récupère les 2 participants de la conv
  select acheteur_id, vendeur_id into v_acheteur_id, v_vendeur_id
  from public.conversations
  where id = NEW.conversation_id;

  -- Conv inexistante (autre trigger gérera l'erreur FK)
  if v_acheteur_id is null then
    return NEW;
  end if;

  -- Détermine le destinataire (l'autre participant)
  v_destinataire_id := case
    when NEW.expediteur_id = v_acheteur_id then v_vendeur_id
    when NEW.expediteur_id = v_vendeur_id then v_acheteur_id
    else null
  end;

  -- Expéditeur n'est pas un participant — autre trigger gérera (mig 22 RLS)
  if v_destinataire_id is null then
    return NEW;
  end if;

  -- Check si le destinataire a bloqué l'expéditeur
  select exists(
    select 1 from public.blocked_users
    where blocker_id = v_destinataire_id
      and blocked_id = NEW.expediteur_id
  ) into v_is_blocked;

  if v_is_blocked then
    -- raise exception côté DB → bubble up au client mobile.
    -- Le client mobile mappe ce SQLSTATE / message pour afficher un toast
    -- générique "Ce message n'a pas pu être envoyé" (volontairement vague —
    -- ne révèle pas l'existence du block au bloqué, best-practice industrie).
    raise exception 'BLOCKED_BY_RECIPIENT'
      using errcode = 'restrict_violation',
            hint = 'The recipient has blocked you. Your message cannot be delivered.';
  end if;

  return NEW;
end;
$$;

comment on function public.fn_messages_block_check() is
  'BEFORE INSERT messages trigger. Empêche un user bloqué d''envoyer un message dans une conv avec le bloqueur (mig 130, Apple Guideline 1.2 UGC).';

-- Ordre de fire alphabétique entre BEFORE INSERT triggers sur messages :
-- "tg_messages_block_check" → "tg_messages_content_filter" (mig 29) →
-- "tg_messages_*..." autres. Le block check s'exécute en premier — si bloqué,
-- on n'évalue même pas le content filter (économise un grep mots_interdits).
drop trigger if exists tg_messages_block_check on public.messages;
create trigger tg_messages_block_check
  before insert on public.messages
  for each row
  execute function public.fn_messages_block_check();

-- ── Helper RPC : check si l'user courant est bloqué par target_id ──────────
-- Côté client, avant d'afficher le composer de message, on peut check si
-- l'autre partie nous a bloqué. Si oui, désactiver le composer + afficher
-- état "Cette conversation est fermée" (UX gracieuse vs erreur silencieuse).
--
-- ⚠ Volontairement, on N'EXPOSE PAS au client la liste de QUI nous a bloqué
-- (best-practice industrie : le bloqué ne sait pas). On expose juste le
-- boolean "suis-je bloqué dans cette conv" → toggle composer.

create or replace function public.am_i_blocked_in_conv(p_conversation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_acheteur_id uuid;
  v_vendeur_id uuid;
  v_other_id uuid;
  v_is_blocked boolean;
begin
  if v_uid is null then
    return false;
  end if;

  select acheteur_id, vendeur_id into v_acheteur_id, v_vendeur_id
  from public.conversations
  where id = p_conversation_id;

  if v_acheteur_id is null then
    return false;
  end if;

  v_other_id := case
    when v_uid = v_acheteur_id then v_vendeur_id
    when v_uid = v_vendeur_id then v_acheteur_id
    else null
  end;

  if v_other_id is null then
    return false;
  end if;

  select exists(
    select 1 from public.blocked_users
    where blocker_id = v_other_id and blocked_id = v_uid
  ) into v_is_blocked;

  return v_is_blocked;
end;
$$;

revoke all on function public.am_i_blocked_in_conv(uuid) from public;
grant execute on function public.am_i_blocked_in_conv(uuid) to authenticated;

comment on function public.am_i_blocked_in_conv(uuid) is
  'Returns true if the other conv participant has blocked the current user. Used by client to disable message composer (mig 130).';

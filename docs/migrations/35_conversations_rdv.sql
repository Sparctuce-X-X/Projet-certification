-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 35 — Confirmation de RDV (F05)
--
-- CDC v4.0 §parcours : après négociation dans le chat, l'une des deux parties
-- propose un RDV (lieu + date), l'autre confirme. Le RDV confirmé déclenche
-- (en F06) la possibilité de noter l'autre.
--
-- Modèle de confirmation : "Proposer → Confirmer" (option A validée).
--   - Une partie propose : set rdv_lieu + rdv_date + rdv_propose_par
--   - L'autre confirme : set rdv_confirme_at
--   - L'un ou l'autre peut annuler à tout moment (avant ou après confirmation)
--
-- Composants :
--   1. ALTER TABLE conversations — 7 colonnes RDV + CHECK
--   2. Patch fn_messages_content_filter (mig 29) → ignore type='systeme'
--   3. Realtime publication étendue à conversations (sync 2 parties)
--   4. RPC propose_rdv  (overwrite si non confirmé, refuse si confirmé)
--   5. RPC confirm_rdv  (l'autre partie uniquement)
--   6. RPC cancel_rdv   (les deux parties, avant ou après confirmation)
--
-- Prérequis : migrations 22 (conversations + messages), 29 (content filter).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ALTER TABLE conversations — colonnes RDV ────────────────────────────

alter table public.conversations
  add column if not exists rdv_lieu        text,
  add column if not exists rdv_date        timestamptz,
  add column if not exists rdv_propose_par uuid references public.users(id),
  add column if not exists rdv_propose_at  timestamptz,
  add column if not exists rdv_confirme_at timestamptz,
  add column if not exists rdv_annule_par  uuid references public.users(id),
  add column if not exists rdv_annule_at   timestamptz;

-- Lieu : 100 chars max (le label visible "Marché de Cocody, devant la pharmacie")
alter table public.conversations
  drop constraint if exists conversations_rdv_lieu_max;
alter table public.conversations
  add  constraint conversations_rdv_lieu_max
  check (rdv_lieu is null or char_length(rdv_lieu) between 1 and 100);

-- Index partiel pour retrouver les RDV confirmés (utile F06 + dashboard)
create index if not exists idx_conversations_rdv_confirme
  on public.conversations (rdv_confirme_at desc)
  where rdv_confirme_at is not null;

-- ── 2. Patch trigger content_filter — bypass pour type='systeme' ───────────
-- Les messages système sont insérés par les RPC SECURITY DEFINER ci-dessous
-- et n'ont pas besoin du filtre (texte 100% serveur, pas d'input user libre).
-- Sans ce patch, "RDV au marché central" pourrait matcher un mot interdit.

create or replace function public.fn_messages_content_filter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found text;
begin
  -- Bypass : les messages système viennent toujours de RPC serveur
  if NEW.type = 'systeme' then
    return NEW;
  end if;

  v_found := public.fn_check_forbidden_words(NEW.contenu);
  if v_found is not null then
    raise exception 'contenu_interdit'
      using hint = 'Ton message contient un terme interdit : "' || v_found || '". Modifie ton message.';
  end if;

  return NEW;
end;
$$;

-- ── 3. Realtime — étendre la publication à conversations ──────────────────
-- Permet aux deux parties de voir les colonnes RDV se mettre à jour en live
-- (l'autre côté reçoit déjà le message système via la publi messages, mais
-- les colonnes rdv_* doivent aussi se synchroniser).

do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception
  when duplicate_object then null;
end $$;

-- ── 4. RPC propose_rdv ────────────────────────────────────────────────────
-- Permet à un participant de proposer (ou re-proposer) un RDV.
-- Si déjà confirmé → erreur (annuler d'abord).
-- Sinon : overwrite les champs rdv_* + insert message système.

create or replace function public.propose_rdv(
  p_conversation_id uuid,
  p_lieu            text,
  p_date            timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_conv         public.conversations%rowtype;
  v_prenom       text;
  v_msg_text     text;
  v_date_fmt     text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Validations input
  if p_lieu is null or trim(p_lieu) = '' then
    return jsonb_build_object('success', false, 'error', 'lieu_required');
  end if;

  if char_length(trim(p_lieu)) > 100 then
    return jsonb_build_object('success', false, 'error', 'lieu_too_long');
  end if;

  if p_date is null then
    return jsonb_build_object('success', false, 'error', 'date_required');
  end if;

  if p_date <= now() + interval '30 minutes' then
    return jsonb_build_object('success', false, 'error', 'date_too_soon');
  end if;

  -- Récupère la conversation + verrouille la ligne (anti-race condition)
  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  -- Participant ?
  if v_uid != v_conv.acheteur_id and v_uid != v_conv.vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  -- Déjà confirmé ?
  if v_conv.rdv_confirme_at is not null then
    return jsonb_build_object('success', false, 'error', 'rdv_already_confirmed');
  end if;

  -- Update conversation (overwrite si re-proposition)
  update public.conversations
  set rdv_lieu        = trim(p_lieu),
      rdv_date        = p_date,
      rdv_propose_par = v_uid,
      rdv_propose_at  = now(),
      rdv_confirme_at = null,
      rdv_annule_par  = null,
      rdv_annule_at   = null
  where id = p_conversation_id;

  -- Récupère le prénom du proposeur pour le message système
  select prenom into v_prenom from public.users where id = v_uid;

  -- Format date FR (timezone Africa/Abidjan = UTC+0, GMT toute l'année)
  v_date_fmt := to_char(p_date at time zone 'Africa/Abidjan', 'DD/MM/YYYY à HH24h"MI"');

  v_msg_text := coalesce(v_prenom, 'Un participant')
                || ' propose un RDV le ' || v_date_fmt
                || ' à ' || trim(p_lieu);

  insert into public.messages (
    conversation_id, expediteur_id, contenu, type
  ) values (
    p_conversation_id, v_uid, v_msg_text, 'systeme'
  );

  return jsonb_build_object('success', true, 'message', v_msg_text);
end;
$$;

revoke all on function public.propose_rdv(uuid, text, timestamptz) from public;
grant execute on function public.propose_rdv(uuid, text, timestamptz) to authenticated;

-- ── 5. RPC confirm_rdv ────────────────────────────────────────────────────
-- L'AUTRE partie (pas le proposeur) confirme la proposition active.

create or replace function public.confirm_rdv(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_conv      public.conversations%rowtype;
  v_msg_text  text;
  v_date_fmt  text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  if v_uid != v_conv.acheteur_id and v_uid != v_conv.vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  -- Doit y avoir une proposition active
  if v_conv.rdv_propose_par is null
     or v_conv.rdv_lieu is null
     or v_conv.rdv_date is null then
    return jsonb_build_object('success', false, 'error', 'no_pending_rdv');
  end if;

  -- Déjà confirmé ?
  if v_conv.rdv_confirme_at is not null then
    return jsonb_build_object('success', false, 'error', 'rdv_already_confirmed');
  end if;

  -- Le proposeur ne peut pas s'auto-confirmer
  if v_conv.rdv_propose_par = v_uid then
    return jsonb_build_object('success', false, 'error', 'cannot_self_confirm');
  end if;

  update public.conversations
  set rdv_confirme_at = now()
  where id = p_conversation_id;

  v_date_fmt := to_char(v_conv.rdv_date at time zone 'Africa/Abidjan', 'DD/MM/YYYY à HH24h"MI"');

  v_msg_text := 'RDV confirmé pour le ' || v_date_fmt || ' à ' || v_conv.rdv_lieu;

  insert into public.messages (
    conversation_id, expediteur_id, contenu, type
  ) values (
    p_conversation_id, v_uid, v_msg_text, 'systeme'
  );

  return jsonb_build_object('success', true, 'message', v_msg_text);
end;
$$;

revoke all on function public.confirm_rdv(uuid) from public;
grant execute on function public.confirm_rdv(uuid) to authenticated;

-- ── 6. RPC cancel_rdv ─────────────────────────────────────────────────────
-- Annulation par les deux parties, avant ou après confirmation.
-- Reset des champs rdv_lieu/date/propose_*/confirme_at, set rdv_annule_*.

create or replace function public.cancel_rdv(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_conv     public.conversations%rowtype;
  v_prenom   text;
  v_msg_text text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  if v_uid != v_conv.acheteur_id and v_uid != v_conv.vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  -- Rien à annuler
  if v_conv.rdv_propose_par is null and v_conv.rdv_lieu is null then
    return jsonb_build_object('success', false, 'error', 'no_rdv_to_cancel');
  end if;

  update public.conversations
  set rdv_lieu        = null,
      rdv_date        = null,
      rdv_propose_par = null,
      rdv_propose_at  = null,
      rdv_confirme_at = null,
      rdv_annule_par  = v_uid,
      rdv_annule_at   = now()
  where id = p_conversation_id;

  select prenom into v_prenom from public.users where id = v_uid;

  v_msg_text := coalesce(v_prenom, 'Un participant') || ' a annulé le RDV';

  insert into public.messages (
    conversation_id, expediteur_id, contenu, type
  ) values (
    p_conversation_id, v_uid, v_msg_text, 'systeme'
  );

  return jsonb_build_object('success', true, 'message', v_msg_text);
end;
$$;

revoke all on function public.cancel_rdv(uuid) from public;
grant execute on function public.cancel_rdv(uuid) to authenticated;

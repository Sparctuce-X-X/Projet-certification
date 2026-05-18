-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 36 — Simplification du texte des messages système RDV
--
-- Pourquoi : le format `to_char(... at time zone 'Africa/Abidjan', ...)` dans
-- les RPC propose_rdv et confirm_rdv produit une heure en UTC+0, ce qui est
-- correct pour CI mais décalé pour les viewers dans d'autres timezones (dev
-- en France, futurs voyageurs, CG UTC+1 vs CI UTC+0).
--
-- Solution : retirer la date+heure du texte du message système. Le bandeau
-- contextuel dans le chat affiche déjà la date+heure en timezone locale du
-- viewer (toLocaleString) — c'est la source de vérité.
--
-- Le message système reste informatif : "<Prénom> a proposé un RDV à <lieu>"
-- / "RDV confirmé à <lieu>". Trace claire de l'événement pour l'historique.
--
-- Prérequis : migration 35.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── propose_rdv : message sans date/heure ──────────────────────────────────

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
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

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

  if v_conv.rdv_confirme_at is not null then
    return jsonb_build_object('success', false, 'error', 'rdv_already_confirmed');
  end if;

  update public.conversations
  set rdv_lieu        = trim(p_lieu),
      rdv_date        = p_date,
      rdv_propose_par = v_uid,
      rdv_propose_at  = now(),
      rdv_confirme_at = null,
      rdv_annule_par  = null,
      rdv_annule_at   = null
  where id = p_conversation_id;

  select prenom into v_prenom from public.users where id = v_uid;

  v_msg_text := coalesce(v_prenom, 'Un participant')
                || ' a proposé un RDV à ' || trim(p_lieu);

  insert into public.messages (
    conversation_id, expediteur_id, contenu, type
  ) values (
    p_conversation_id, v_uid, v_msg_text, 'systeme'
  );

  return jsonb_build_object('success', true, 'message', v_msg_text);
end;
$$;

-- ── confirm_rdv : message sans date/heure ──────────────────────────────────

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

  if v_conv.rdv_propose_par is null
     or v_conv.rdv_lieu is null
     or v_conv.rdv_date is null then
    return jsonb_build_object('success', false, 'error', 'no_pending_rdv');
  end if;

  if v_conv.rdv_confirme_at is not null then
    return jsonb_build_object('success', false, 'error', 'rdv_already_confirmed');
  end if;

  if v_conv.rdv_propose_par = v_uid then
    return jsonb_build_object('success', false, 'error', 'cannot_self_confirm');
  end if;

  update public.conversations
  set rdv_confirme_at = now()
  where id = p_conversation_id;

  v_msg_text := 'RDV confirmé à ' || v_conv.rdv_lieu;

  insert into public.messages (
    conversation_id, expediteur_id, contenu, type
  ) values (
    p_conversation_id, v_uid, v_msg_text, 'systeme'
  );

  return jsonb_build_object('success', true, 'message', v_msg_text);
end;
$$;

-- =============================================================================
-- Migration 100 — Block propose_rdv on Immo annonces (defense in depth)
-- =============================================================================
--
-- Règle métier : les annonces de catégorie Immobilier (mode Immo, ajouté
-- mig 32) ne supportent pas le système de RDV physique anti-fraude. Visites
-- de logement, signature de bail, etc. se gèrent en messagerie pure.
--
-- Le front mobile cache le bouton "Proposer un RDV" si `convInfo.is_immo`
-- (cf. `app/messages/[conversationId].tsx`), mais on ajoute un guard côté
-- RPC en defense in depth (au cas où un user appellerait l'RPC en direct
-- via PostgREST, ou si un bug de cache front laissait passer).
--
-- Discriminateur : `annonces.type_offre IS NOT NULL` ⇔ annonce immobilière
-- (cf. mig 32 — `comment on column annonces.type_offre is 'Null si pas
-- immobilier. Location ou vente.'`).
--
-- Erreur côté client : code `IMMO_NO_RDV` retourné dans le payload jsonb.
--
-- Cette mig prend la version finale de propose_rdv (mig 35 + 36 + 87) et
-- ajoute UNIQUEMENT le guard immo entre le check `not_participant` et le
-- check `rdv_already_confirmed`. Tout le reste (validations, format date
-- avec heure, reset rencontre + reminders, retour message, revoke/grant)
-- est préservé strictement à l'identique.
-- =============================================================================

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
  v_annonce      public.annonces%rowtype;
  v_prenom       text;
  v_msg_text     text;
  v_date_fmt     text;
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

  -- ── Guard mode Immo (mig 100) : pas de RDV sur annonces immobilières ─────
  -- annonce_id peut être null si l'annonce a été purgée (mig 39 set null on
  -- delete) — dans ce cas pas de check immo, on continue (RDV historique).
  if v_conv.annonce_id is not null then
    select * into v_annonce
    from public.annonces
    where id = v_conv.annonce_id;

    if v_annonce.id is not null and v_annonce.type_offre is not null then
      return jsonb_build_object('success', false, 'error', 'IMMO_NO_RDV');
    end if;
  end if;

  if v_conv.rdv_confirme_at is not null then
    return jsonb_build_object('success', false, 'error', 'rdv_already_confirmed');
  end if;

  -- Update conversation : RDV neuf + reset rencontre_* + reset counter (mig 87)
  -- (rdv_reminders_sent est reset par trigger tg_reset_rdv_reminders, mig 97)
  update public.conversations
  set rdv_lieu                 = trim(p_lieu),
      rdv_date                 = p_date,
      rdv_propose_par          = v_uid,
      rdv_propose_at           = now(),
      rdv_confirme_at          = null,
      rdv_annule_par           = null,
      rdv_annule_at            = null,
      rencontre_acheteur       = null,
      rencontre_vendeur        = null,
      rencontre_decided_at     = null,
      rencontre_reminders_sent = 0
  where id = p_conversation_id;

  select prenom into v_prenom from public.users where id = v_uid;

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

-- ── Note —————————————————————————————————————————————————————————————────
-- Tests : voir tests/sql/rdv.test.sql §"Test 20 — guard IMMO_NO_RDV".

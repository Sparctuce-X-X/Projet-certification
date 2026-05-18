-- =============================================================================
-- Migration 106 — Durcir add_rencontre_photo : disputed uniquement
-- =============================================================================
--
-- PROBLÈME RÉSOLU
--   Mig 92 + 102 permettait l'upload de preuves photo dans tous les états
--   post-RDV sauf `unconfirmed` (gates RPC : auth + path + participant +
--   rdv_confirme + rdv_passé + admin_decided + quota). Le filtre par état
--   rencontre était purement cosmétique côté UI.
--
--   Conséquence : en état `met` (les 2 ont confirmé "on s'est vu"), `pending`
--   (personne n'a répondu) ou `unilateral` (un seul a répondu), les 2 parties
--   pouvaient uploader des photos sans aucun litige actif. Pollution storage
--   + UX qui suggère un usage de "preuve" alors qu'il n'y a rien à prouver.
--
-- DÉCISION PRODUIT (audit UX 2026-05-10)
--   Les preuves photo n'ont de valeur juridique/modération qu'en cas de
--   désaccord explicite — c'est-à-dire en état `disputed` (un côté `true`,
--   l'autre `false`). Tout autre état :
--     - met        → tout va bien, pas de litige → pas de preuve nécessaire
--     - pending    → personne n'a encore répondu → pas de litige actif
--     - unilateral → en attente de l'autre → pas de litige confirmé
--     - unconfirmed → les 2 ont dit "on s'est pas vu" → annonce reverte,
--                     RDV non-existant, preuve inutile (déjà bloqué côté UI mig 92)
--
-- SOLUTION
--   Ajouter dans la RPC `add_rencontre_photo` une nouvelle gate après
--   `rdv_not_past` et avant `admin_signalement_decided` :
--     - rencontre_acheteur != rencontre_vendeur
--     - ET au moins un des deux est `false`
--   Sinon → return error `not_disputed`.
--
--   Côté UI : `app/messages/[conversationId].tsx` masque déjà le block
--   `RencontrePhotosBlock` sauf en `rencontreState === "disputed"` (patch
--   parallèle à cette mig). Le guard ici est defense in depth — protège
--   contre les appels directs PostgREST ou un cache front buggé.
--
-- IMPACT BACKWARDS
--   Si des photos existaient déjà sur des convs en état met/pending (avant
--   cette mig), elles restent en DB et lisibles via SELECT (RLS inchangée).
--   Elles n'apparaîtront simplement plus dans l'UI tant que la conv n'est
--   pas en `disputed` (cas rare en pratique). Pas de purge nécessaire.
--
-- Cette mig prend la version mig 102 de add_rencontre_photo et ajoute
-- UNIQUEMENT le check disputed entre `rdv_not_past` et `admin_decided`.
-- Tout le reste est préservé strictement à l'identique.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- =============================================================================

create or replace function public.add_rencontre_photo(
  p_conversation_id uuid,
  p_storage_path    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_conv      public.conversations%rowtype;
  v_role      text;
  v_count     int;
  v_path_uid  text;
  v_path_conv text;
  v_disputed  boolean;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if p_storage_path is null or trim(p_storage_path) = '' then
    return jsonb_build_object('success', false, 'error', 'path_required');
  end if;

  -- Validation path : doit commencer par {conv_id}/{uid}/
  v_path_conv := split_part(p_storage_path, '/', 1);
  v_path_uid  := split_part(p_storage_path, '/', 2);
  if v_path_conv != p_conversation_id::text or v_path_uid != v_uid::text then
    return jsonb_build_object('success', false, 'error', 'invalid_path');
  end if;

  -- Conv existe + caller participant
  select * into v_conv
  from public.conversations
  where id = p_conversation_id;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  if v_uid != v_conv.acheteur_id and v_uid != v_conv.vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  -- RDV doit avoir été confirmé ET la date doit être passée
  if v_conv.rdv_confirme_at is null then
    return jsonb_build_object('success', false, 'error', 'no_confirmed_rdv');
  end if;

  if v_conv.rdv_date is null or v_conv.rdv_date >= now() then
    return jsonb_build_object('success', false, 'error', 'rdv_not_past');
  end if;

  -- ── Mig 102 : Lock après décision admin sur signalement post-RDV ────────
  -- Cette gate fire AVANT disputed parce que c'est le signal le plus fort :
  -- admin a tranché → message UX précis "examiné par l'équipe Niqo".
  if v_conv.admin_signalement_decided_at is not null then
    return jsonb_build_object('success', false, 'error', 'signalement_decided');
  end if;

  -- ── Mig 106 : Disputed uniquement ────────────────────────────────────────
  -- Les preuves photo n'ont de valeur qu'en cas de désaccord explicite :
  -- (true, false) ou (false, true). Tout autre état (pending, unilateral,
  -- met, unconfirmed) → pas de litige actif → reject.
  v_disputed := (
    v_conv.rencontre_acheteur is not null
    and v_conv.rencontre_vendeur is not null
    and v_conv.rencontre_acheteur != v_conv.rencontre_vendeur
  );
  if not v_disputed then
    return jsonb_build_object('success', false, 'error', 'not_disputed');
  end if;

  -- Role auteur
  v_role := case
    when v_uid = v_conv.acheteur_id then 'acheteur'
    else 'vendeur'
  end;

  -- Quota max 5 photos par auteur par conv
  select count(*) into v_count
  from public.rencontre_photos
  where conversation_id = p_conversation_id
    and auteur_id = v_uid;

  if v_count >= 5 then
    return jsonb_build_object('success', false, 'error', 'quota_exceeded');
  end if;

  -- Insert
  insert into public.rencontre_photos (
    conversation_id, auteur_id, role_auteur, storage_path
  ) values (
    p_conversation_id, v_uid, v_role, p_storage_path
  );

  return jsonb_build_object('success', true, 'count_after', v_count + 1);
end;
$$;

revoke all on function public.add_rencontre_photo(uuid, text) from public;
grant execute on function public.add_rencontre_photo(uuid, text) to authenticated;

-- ── Note ─────────────────────────────────────────────────────────────────
-- Tests : tests/sql/rencontre.test.sql couvre les anciens gates (mig 92+102).
-- Le nouveau gate `not_disputed` n'a pas encore de test pgTAP dédié — à
-- ajouter quand le module Rencontre/Signalement post-RDV passera dans le
-- backfill backend (cf. docs/backend/PROCESS.md §État du backfill).
-- Front : app/messages/[conversationId].tsx masque RencontrePhotosBlock
-- sauf en `rencontreState === "disputed"` (patch parallèle à cette mig).

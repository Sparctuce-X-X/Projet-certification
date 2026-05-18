-- =============================================================================
-- Migration 102 — Lock add_rencontre_photo après décision admin
-- =============================================================================
--
-- Problème :
--   Mig 92 permet aux 2 parties d'ajouter des preuves photos sur une conv
--   en RDV passé. Aucun gate sur `admin_signalement_decided_at` (mig 96)
--   → après que l'admin a tranché un signalement post-RDV, les 2 parties
--   peuvent encore ajouter des photos. Cohérence UX cassée :
--     - Bandeau gris "RDV examiné par notre équipe" (mig 96)
--     - Mais bouton "+ Ajouter photo" toujours actif → contradictoire
--     - Pire : preuve uploadée tardivement n'a aucun poids (l'affaire est
--       close), juste de la pollution Storage et une fausse impression que
--       l'utilisateur peut encore agir
--
-- Fix :
--   Ajouter le check `admin_signalement_decided_at IS NULL` dans la RPC
--   `add_rencontre_photo` (mig 92), entre `rdv_not_past` et le check quota.
--   Erreur `signalement_decided` retournée au client si admin a tranché.
--
--   Le client est censé masquer le bouton "+ Ajouter" via `convInfo.
--   admin_signalement_decided_at` (cf. components/chat/RencontrePhotosBlock),
--   mais le guard backend protège contre les appels directs PostgREST ou
--   les bugs de cache front (defense in depth).
--
-- Conséquence storage :
--   Le pattern actuel upload-then-RPC (mig 92 §5) reste valide. Si la RPC
--   reject avec `signalement_decided`, le client rollback le fichier
--   storage automatiquement (cf. lib/rencontre.ts ligne ~157).
--
-- Cette mig prend la version mig 92 de add_rencontre_photo et ajoute
-- UNIQUEMENT le check entre `rdv_not_past` et le quota. Tout le reste
-- (validations, path check, role assignment, insert) est préservé
-- strictement à l'identique.
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
  -- Cohérence UX avec le bandeau gris mig 96 ("RDV examiné par l'équipe Niqo") :
  -- une fois l'affaire close côté admin, plus de nouvelles preuves possibles.
  if v_conv.admin_signalement_decided_at is not null then
    return jsonb_build_object('success', false, 'error', 'signalement_decided');
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
-- Tests : voir tests/sql/rdv.test.sql §"Test 23 — add_rencontre_photo lock
--         post admin_decided".
-- Front : components/chat/RencontrePhotosBlock + app/messages/[conversationId]
--         masquent le bouton "+ Ajouter" si convInfo.admin_signalement_decided_at
--         est non-null. Le guard backend ici est defense in depth.

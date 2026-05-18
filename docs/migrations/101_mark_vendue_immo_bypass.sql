-- =============================================================================
-- Migration 101 — mark_annonce_vendue : bypass guard rencontre pour Immo
-- =============================================================================
--
-- Problème :
--   Mig 88+89 exigent qu'au moins une conv ait `rencontre_acheteur=true AND
--   rencontre_vendeur != false` avant d'autoriser mark_annonce_vendue. Mais
--   la mig 100 bloque propose_rdv sur les annonces immobilières (type_offre
--   IS NOT NULL) → aucun rdv_confirme_at posé → aucune rencontre possible
--   → vendeur immo bloqué : impossible de marquer un bien vendu/loué avant
--   l'expiration auto à 60j.
--
-- Fix :
--   Si annonce.type_offre IS NOT NULL (= immo), bypass complet du guard
--   rencontre ET de l'auto-confirm vendeur (mig 89). Le vendeur immo peut
--   marquer son bien vendu/loué à tout moment, sans contrainte de rencontre.
--
-- Justification anti-fraude :
--   En mode immo, la confiance se joue hors plateforme (visite physique du
--   bien, vérification du titre de propriété ou du bail, paiement traçable
--   préconisé dans ChatSafetyTips immo). Niqo n'a pas de signal "rencontre
--   confirmée" à exploiter, donc on fait confiance au vendeur pour clore
--   son annonce. Risque marginal : un vendeur immo malveillant pourrait
--   "cocher vendue" sans transaction — mais comme il n'y a pas de notation
--   sans rencontre confirmée (mig 86), ça ne gonfle ni nb_ventes ni
--   note_vendeur. Conséquence : juste retrait propre du marché.
--
-- Cette mig prend la version mig 89 de mark_annonce_vendue et ajoute
-- UNIQUEMENT le bypass `if not v_is_immo then ...` autour des deux blocs
-- guard (rencontre + auto-confirm). Le reste (validations owner,
-- statut, update annonce, retour) est préservé strictement à l'identique.
-- =============================================================================

create or replace function public.mark_annonce_vendue(p_annonce_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_annonce public.annonces%rowtype;
  v_has_meeting boolean;
  v_conv_to_decide uuid[];
  v_is_immo boolean;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_annonce
  from public.annonces
  where id = p_annonce_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'annonce_not_found');
  end if;

  if v_annonce.vendeur_id != v_uid then
    return jsonb_build_object('success', false, 'error', 'not_owner');
  end if;

  if v_annonce.statut not in ('active', 'en_cours') then
    return jsonb_build_object('success', false, 'error', 'invalid_state');
  end if;

  -- Mig 101 : discriminateur immo (type_offre IS NOT NULL ⇔ annonce immobilière, mig 32)
  v_is_immo := v_annonce.type_offre is not null;

  -- Garde-fou anti-fraude (mig 86 + 88) : voix acheteur requise — UNIQUEMENT non-immo
  if not v_is_immo then
    select exists (
      select 1 from public.conversations
      where annonce_id = p_annonce_id
        and rdv_confirme_at is not null
        and rencontre_acheteur = true
        and rencontre_vendeur is distinct from false
    ) into v_has_meeting;

    if not v_has_meeting then
      return jsonb_build_object('success', false, 'error', 'no_meeting_confirmed');
    end if;
  end if;

  -- Update annonce → vendue (statut DB unique pour vente ET location immo,
  -- libellé "louée" / "vendue" géré côté client via type_offre)
  update public.annonces
  set statut = 'vendue', updated_at = now()
  where id = p_annonce_id;

  -- ── Mig 89 : auto-confirm rencontre côté vendeur — UNIQUEMENT non-immo ──
  -- En immo : pas de RDV jamais (mig 100), donc pas de conv en attente de
  -- décision côté vendeur, et pas de message "rencontre confirmée" à insérer.
  if not v_is_immo then
    -- Collecter les conv en attente de décision côté vendeur (ach=true, vend=null)
    select array_agg(id) into v_conv_to_decide
    from public.conversations
    where annonce_id = p_annonce_id
      and rdv_confirme_at is not null
      and rencontre_acheteur = true
      and rencontre_vendeur is null;

    if v_conv_to_decide is not null and cardinality(v_conv_to_decide) > 0 then
      -- Pose rencontre_vendeur=true + decided_at (état terminal `met`)
      update public.conversations
      set rencontre_vendeur    = true,
          rencontre_decided_at = now()
      where id = any(v_conv_to_decide);

      -- Message système dans chaque conv concernée (trace humaine)
      -- Bypass content_filter : type='systeme' (mig 35 patch)
      insert into public.messages (conversation_id, expediteur_id, contenu, type)
      select uid, v_uid, 'Annonce marquée vendue — rencontre confirmée', 'systeme'
      from unnest(v_conv_to_decide) uid;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mark_annonce_vendue(uuid) from public;
grant execute on function public.mark_annonce_vendue(uuid) to authenticated;

-- ── Note ─────────────────────────────────────────────────────────────────
-- Tests : voir tests/sql/rdv.test.sql §"Test 21 — mark_vendue immo bypass"
--         + §"Test 22 — régression non-immo no_meeting_confirmed".

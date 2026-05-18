-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 89 — mark_annonce_vendue auto-pose rencontre_vendeur=true
--
-- PROBLÈME RÉSOLU
--   Mig 88 a assoupli mark_vendue (voix acheteur seule). Mais le vendeur peut
--   maintenant marquer vendue SANS avoir cliqué "Oui, on s'est vu" lui-même
--   → la conv reste en `unilateral_other` côté vendeur (zombie : bandeau "On
--   s'est vu ?" toujours visible alors que la vente est conclue), et le vendeur
--   ne peut pas noter l'acheteur (submit_avis exige self=true).
--
-- SOLUTION (mig 89)
--   Quand le vendeur tape mark_annonce_vendue, c'est une affirmation IMPLICITE
--   "j'ai vu l'acheteur" (sinon comment vendrait-il ?). Donc après update du
--   statut annonce, on auto-pose `rencontre_vendeur=true` + `rencontre_decided_at`
--   sur toutes les conv éligibles (ach=true, vend=null) de cette annonce.
--
--   Et on insert un message système contextuel : "Annonce marquée vendue —
--   rencontre confirmée" pour tracer la décision côté chat.
--
-- BÉNÉFICES
--   - Bandeau chat passe automatiquement de `unilateral_other` à `met`
--   - Vendeur peut noter l'acheteur juste après mark_vendue (sans étape Oui)
--   - Realtime sync : l'évolution est visible en direct sur l'iPhone vendeur
--   - Anti-fraude inchangé : c'est rencontre_acheteur=true qui protège
--
-- EDGE CASES
--   - Multi-conv (plusieurs acheteurs ont confirmé sur la même annonce) :
--     update toutes les conv ach=true ET vend=null. Le vendeur s'engage en
--     cliquant — peu importe à qui il a vendu, il les a tous "rencontrés"
--     dans la conversation au moins virtuellement.
--   - Conv déjà en `met` (ach=true, vend=true) : pas touchée, pas de message
--     dupliqué (filtre `vend IS NULL` exclut).
--   - Conv en `disputed` (vend=false) : déjà filtrée par v_has_meeting check
--     → mark_vendue refusé en amont (mig 88).
--
-- Prérequis : mig 86 (rencontre), mig 88 (mark_vendue assoupli).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- Garde-fou anti-fraude (mig 86 + 88) : voix acheteur requise
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

  -- Update annonce → vendue
  update public.annonces
  set statut = 'vendue', updated_at = now()
  where id = p_annonce_id;

  -- ── Mig 89 : auto-confirm rencontre côté vendeur ──────────────────────
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

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mark_annonce_vendue(uuid) from public;
grant execute on function public.mark_annonce_vendue(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 88 — Assouplir mark_annonce_vendue (voix acheteur suffit)
--
-- PROBLÈME RÉSOLU
--   Mig 86 exigeait rencontre_acheteur=true AND rencontre_vendeur=true pour
--   autoriser mark_annonce_vendue. Logique : "les 2 doivent confirmer pour
--   être sûr".
--
--   En pratique, c'est friction inutile : la voix du vendeur n'apporte aucune
--   garantie anti-fraude (un vendeur qui veut frauder dira toujours "oui on
--   s'est vu"). Seule la voix de l'acheteur protège vraiment. Et la mig 86
--   bloquait les vendeurs honnêtes qui n'avaient simplement pas pensé à
--   répondre eux-mêmes au cycle "On s'est vu ?" alors que l'acheteur l'avait
--   fait.
--
-- NOUVELLE RÈGLE (mig 88)
--   mark_annonce_vendue exige :
--     rencontre_acheteur = true                 (l'acheteur a confirmé)
--     AND rencontre_vendeur IS DISTINCT FROM false  (le vendeur ne nie pas)
--
--   Cas couverts :
--     ach=true, vend=true   → ✅ OK (met)
--     ach=true, vend=null   → ✅ OK (vendeur n'a pas répondu, mais l'acheteur
--                                    a confirmé — anti-fraude OK)
--     ach=true, vend=false  → ❌ BLOQUÉ (vendeur lui-même nie la rencontre,
--                                        cas no-show acheteur — utile pour
--                                        signalement futur)
--     ach=false ou null     → ❌ BLOQUÉ (acheteur n'a pas confirmé)
--
-- PRÉSERVÉ
--   - submit_avis garde la règle mig 86 (self=true AND other!=false). Pour
--     noter, il faut affirmer soi-même la rencontre — c'est ton input perso,
--     pas un signal anti-fraude.
--   - Trigger lifecycle annonce inchangé (mig 86) — revert à active si (false,false).
--
-- Prérequis : mig 86 (rencontre).
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

  -- Au moins une conv où l'acheteur a confirmé la rencontre ET le vendeur
  -- n'a pas dit "non" explicitement (mig 88).
  -- IS DISTINCT FROM false : true OK, null OK, false bloqué.
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

  update public.annonces
  set statut = 'vendue', updated_at = now()
  where id = p_annonce_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.mark_annonce_vendue(uuid) from public;
grant execute on function public.mark_annonce_vendue(uuid) to authenticated;

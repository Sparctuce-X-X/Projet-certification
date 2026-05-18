-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 95 — Action admin "Revert annonce à active" sur signalement non-fraude
--
-- PROBLÈME RÉSOLU
--   Mig 86 §4.6 : sur état `disputed` (acheteur=true, vendeur=false ou inverse),
--   l'annonce reste gelée en `en_cours` indéfiniment. Mig 91 auto-suspend
--   l'annonce uniquement sur motifs `tentative_fraude` ou `complot_fraude`.
--
--   Pour les autres motifs validés (produit_defectueux, no_show,
--   comportement_dangereux, etc.), pas d'auto-action sur l'annonce → elle
--   reste `en_cours` jusqu'à expiration naturelle 60j (cron).
--
--   → Friction UX vendeur : Jean a son annonce gelée 60j sans pouvoir la
--   modifier ni republier (anti-doublon mig 17). Bonne foi possible (objet
--   réellement défectueux sans le savoir) → admin doit pouvoir décider.
--
-- SOLUTION
--   RPC admin manuelle pour revert l'annonce de `en_cours` vers `active`.
--   Décision au cas par cas, pas d'auto-revert (anti-fraude design strict).
--
-- DESIGN
--   - `is_admin = true` requis (gate dans corps RPC, raise sinon)
--   - Annonce doit être en `en_cours` (pas suspendue, pas vendue, pas expiree)
--   - Push notif vendeur "Annonce remise en vente"
--   - Pas de cascade sur conv/rencontre_* (l'historique reste figé)
--
-- Prérequis : mig 25 (signalements), 39 (lifecycle annonce), 44 (is_admin),
--             56 (admin_treat_signalement), 65 (_notify_push), 91 (rdv_post),
--             94 (REVOKE pattern grant authenticated).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_revert_annonce_to_active(p_annonce_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean;
  v_annonce public.annonces%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED');
  end if;

  -- Gate admin
  select is_admin into v_admin from public.users where id = v_uid;
  if not coalesce(v_admin, false) then
    return jsonb_build_object('success', false, 'error', 'ADMIN_REQUIRED');
  end if;

  -- Annonce existe + lock pour update atomique
  select * into v_annonce
  from public.annonces
  where id = p_annonce_id
  for update;

  if v_annonce.id is null then
    return jsonb_build_object('success', false, 'error', 'ANNONCE_NOT_FOUND');
  end if;

  -- Doit être en en_cours (pas suspendue, pas vendue, pas expiree, pas active)
  -- Si active → no-op (déjà bon état). Si vendue/suspendue/expiree → mauvais état.
  if v_annonce.statut <> 'en_cours' then
    return jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATE',
      'current_statut', v_annonce.statut::text
    );
  end if;

  -- Revert
  update public.annonces
  set statut     = 'active',
      updated_at = now()
  where id = p_annonce_id;

  -- Push vendeur (best-effort, ne fail pas la transaction si push down)
  begin
    perform public._notify_push(
      array[v_annonce.vendeur_id],
      'Annonce remise en vente',
      'Ton annonce « ' || v_annonce.titre || ' » est de nouveau visible.',
      jsonb_build_object('url', '/announce/' || p_annonce_id::text)
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true);
end;
$$;

-- Pattern mig 94 : revoke from public + grant explicit to authenticated
revoke all on function public.admin_revert_annonce_to_active(uuid) from public, anon;
grant execute on function public.admin_revert_annonce_to_active(uuid) to authenticated;

comment on function public.admin_revert_annonce_to_active(uuid) is
  'Admin manual revert: annonce en_cours → active. Utilisé après signalement post-RDV non-fraude validé pour libérer l''annonce du gel disputed (mig 86 §4.6). Push vendeur. Gate is_admin requis.';

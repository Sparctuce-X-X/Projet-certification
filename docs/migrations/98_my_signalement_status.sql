-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 98 — Verdict signalement post-RDV visible côté user (closure)
--
-- PROBLÈME RÉSOLU
--   Mig 96 affiche un bandeau gris "Ce RDV a été examiné par l'équipe Niqo"
--   quand admin a tranché. Mais le user (Marie ou Jean) qui a signalé n'a
--   AUCUN signal sur le verdict admin (traité ou rejeté). Closure
--   psychologique manquante : "j'ai signalé, est-ce que ça a été validé ?"
--
--   Le push notif arrive mais peut être manqué/effacé. La conv reste le
--   point de référence durable, donc on doit y exposer le verdict.
--
-- SOLUTION
--   RPC `get_my_rdv_signalement_status(p_conversation_id)` qui retourne
--   le statut du dernier signalement post-RDV créé PAR le caller sur cette
--   conv. Anti-leak : ne retourne RIEN si le caller n'a pas signalé (ou
--   si le caller n'est pas participant).
--
--   Côté mobile : le bandeau gris s'enrichit avec le verdict perso :
--   - signalement traité  → "Ton signalement (motif X) a été VALIDÉ"
--   - signalement rejeté  → "Ton signalement (motif X) a été examiné — non retenu"
--   - en attente          → "Ton signalement est en cours d'examen"
--   - aucun signalement   → bandeau gris générique (pas de verdict perso)
--
-- DESIGN
--   - Lecture seule, pas d'effet de bord
--   - Anti-leak : SECURITY DEFINER + check participant + filtre signaleur_id
--     = caller. L'autre partie ne peut pas voir le verdict du signalement
--     adverse.
--   - Retourne `has_signalement: false` plutôt que NULL pour faciliter le
--     pattern côté client (toujours un objet jsonb).
--
-- HORS SCOPE
--   - Pas de notification push à l'ouverture du chat (le push verdict est
--     déjà géré par fn_signalement_check_threshold mig 91/96)
--   - Pas d'affichage public côté autre partie (anti-vendetta)
--
-- Prérequis : mig 22 (conversations), 25 (signalements), 91 (rdv_post + role_signaleur).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_my_rdv_signalement_status(
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_is_participant boolean;
  v_sig          record;
begin
  if v_uid is null then
    return jsonb_build_object('has_signalement', false);
  end if;

  -- Anti-leak : caller doit être participant de la conv
  select exists (
    select 1 from public.conversations
    where id = p_conversation_id
      and (acheteur_id = v_uid or vendeur_id = v_uid)
  ) into v_is_participant;

  if not v_is_participant then
    return jsonb_build_object('has_signalement', false);
  end if;

  -- Récupérer le dernier signalement rdv_post du caller sur cette conv
  -- (UNIQUE constraint = max 1 par caller, mais order by au cas où)
  select
    s.id,
    s.statut::text          as statut,
    s.motif,
    s.motif_categorie::text as motif_categorie,
    s.created_at,
    s.updated_at
  into v_sig
  from public.signalements s
  where s.target_type = 'rdv_post'
    and s.target_id = p_conversation_id
    and s.signaleur_id = v_uid
  order by s.created_at desc
  limit 1;

  if v_sig.id is null then
    return jsonb_build_object('has_signalement', false);
  end if;

  return jsonb_build_object(
    'has_signalement',  true,
    'signalement_id',   v_sig.id,
    'statut',           v_sig.statut,            -- 'en_attente' | 'traite' | 'rejete'
    'motif',            v_sig.motif,             -- label fr
    'motif_categorie',  v_sig.motif_categorie,   -- enum motif_signalement_rdv
    'created_at',       v_sig.created_at,
    'updated_at',       v_sig.updated_at
  );
end;
$$;

revoke all on function public.get_my_rdv_signalement_status(uuid) from public, anon;
grant execute on function public.get_my_rdv_signalement_status(uuid) to authenticated;

comment on function public.get_my_rdv_signalement_status(uuid) is
  'Mig 98 — Retourne le verdict du signalement post-RDV créé par le caller sur cette conv (closure psychologique). Anti-leak : check participant + filtre signaleur_id. Retourne {has_signalement:false} si caller n''a pas signalé ou n''est pas participant.';

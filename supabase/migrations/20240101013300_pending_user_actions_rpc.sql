-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 93 — RPC get_pending_user_actions (bannière Home)
--
-- PROBLÈME RÉSOLU
--   Push notifications + bandeaux chat couvrent le moment opportun, mais un
--   user qui désactive les notifs OU revient sur l'app après plusieurs jours
--   peut oublier des actions en attente (répondre rencontre, mark_vendue,
--   noter, etc.). On a besoin d'une surface centralisée Home qui agrège
--   TOUTES les actions pendantes.
--
-- SOLUTION
--   RPC SECURITY DEFINER qui retourne une liste d'actions pendantes pour
--   l'user authentifié (auth.uid()), triées par priorité décroissante.
--
-- TYPES D'ACTIONS COUVERTES
--   1. 'rencontre'   — RDV passé, user n'a pas dit Oui/Non
--   2. 'disputed'    — Désaccord : signaler ou attendre
--   3. 'mark_vendue' — Vendeur en `met`, annonce encore en_cours
--   4. 'avis'        — Conv `met`, user n'a pas encore noté l'autre
--                       (fenêtre 7j post-décision rencontre)
--
-- LIMITES
--   - Max 5 actions par appel (anti-overload UI)
--   - Order by priority asc puis created_at desc
--   - Filtre users.is_active = true (caller actif requis)
--
-- Prérequis : mig 22 (conv), 35 (RDV), 37+ (avis), 86 (rencontre), 89 (mark_vendue)
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_pending_user_actions()
returns table (
  type            text,        -- 'rencontre' | 'disputed' | 'mark_vendue' | 'avis'
  priority        int,         -- 1 = urgent, 5 = info
  conversation_id uuid,
  annonce_id      uuid,
  annonce_titre   text,
  other_user_id   uuid,
  other_prenom    text,
  rdv_date        timestamptz,
  created_at      timestamptz  -- pour ordering tertiaire
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;  -- empty result
  end if;

  return query
  with my_convs as (
    select
      c.id,
      c.acheteur_id,
      c.vendeur_id,
      c.annonce_id,
      c.rdv_date,
      c.rdv_confirme_at,
      c.rencontre_acheteur,
      c.rencontre_vendeur,
      c.rencontre_decided_at,
      a.titre as annonce_titre,
      a.statut as annonce_statut,
      a.vendeur_id as annonce_vendeur_id,
      case when v_uid = c.acheteur_id then c.vendeur_id else c.acheteur_id end as other_id,
      case when v_uid = c.acheteur_id then c.rencontre_acheteur else c.rencontre_vendeur end as my_rencontre,
      case when v_uid = c.acheteur_id then c.rencontre_vendeur else c.rencontre_acheteur end as other_rencontre,
      c.created_at as conv_created_at
    from public.conversations c
    left join public.annonces a on a.id = c.annonce_id
    where (c.acheteur_id = v_uid or c.vendeur_id = v_uid)
  )
  -- Action 1 : disputed (urgent — signaler ou attendre)
  select
    'disputed'::text          as type,
    1                         as priority,
    mc.id                     as conversation_id,
    mc.annonce_id,
    mc.annonce_titre,
    mc.other_id               as other_user_id,
    u.prenom::text            as other_prenom,
    mc.rdv_date,
    mc.conv_created_at        as created_at
  from my_convs mc
  join public.users u on u.id = mc.other_id
  where mc.rencontre_acheteur is not null
    and mc.rencontre_vendeur  is not null
    and mc.rencontre_acheteur <> mc.rencontre_vendeur

  union all
  -- Action 2 : rencontre — moi je n'ai pas encore répondu
  select
    'rencontre'::text         as type,
    2                         as priority,
    mc.id                     as conversation_id,
    mc.annonce_id,
    mc.annonce_titre,
    mc.other_id               as other_user_id,
    u.prenom::text            as other_prenom,
    mc.rdv_date,
    mc.conv_created_at        as created_at
  from my_convs mc
  join public.users u on u.id = mc.other_id
  where mc.rdv_confirme_at is not null
    and mc.rdv_date is not null
    and mc.rdv_date < now()
    and mc.my_rencontre is null
    and mc.rencontre_decided_at is null

  union all
  -- Action 3 : mark_vendue — je suis vendeur, ≥1 conv `met` sur cette annonce, statut en_cours
  -- On dédupplique par annonce_id (1 entrée par annonce, pas par conv)
  select distinct on (mc.annonce_id)
    'mark_vendue'::text       as type,
    3                         as priority,
    mc.id                     as conversation_id,
    mc.annonce_id,
    mc.annonce_titre,
    mc.other_id               as other_user_id,
    u.prenom::text            as other_prenom,
    mc.rdv_date,
    mc.conv_created_at        as created_at
  from my_convs mc
  join public.users u on u.id = mc.other_id
  where v_uid = mc.annonce_vendeur_id
    and mc.annonce_statut = 'en_cours'
    and mc.rencontre_acheteur = true
    and mc.rencontre_vendeur  = true

  union all
  -- Action 4 : avis — conv `met`, je n'ai pas encore noté l'autre, fenêtre 7j
  select
    'avis'::text              as type,
    4                         as priority,
    mc.id                     as conversation_id,
    mc.annonce_id,
    mc.annonce_titre,
    mc.other_id               as other_user_id,
    u.prenom::text            as other_prenom,
    mc.rdv_date,
    mc.conv_created_at        as created_at
  from my_convs mc
  join public.users u on u.id = mc.other_id
  where mc.rencontre_acheteur = true
    and mc.rencontre_vendeur  = true
    and mc.rencontre_decided_at is not null
    and mc.rencontre_decided_at > now() - interval '7 days'
    and not exists (
      select 1 from public.avis av
      where av.conversation_id = mc.id
        and av.auteur_id = v_uid
    )

  order by priority asc, rdv_date desc nulls last, created_at desc
  limit 5;
end;
$$;

revoke all on function public.get_pending_user_actions() from public;
grant execute on function public.get_pending_user_actions() to authenticated;

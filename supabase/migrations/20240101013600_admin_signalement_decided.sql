-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 96 — admin_signalement_decided_at + UX bandeau résolu
--
-- PROBLÈMES RÉSOLUS
--
--   1. Bandeau orange "disputed" zombie côté chat
--      ─────────────────────────────────────────
--      Après qu'un signalement post-RDV est traité/rejeté par l'admin, le
--      bandeau orange "Vous n'êtes pas d'accord — Signaler ce RDV" reste
--      affiché des 2 côtés. Marie/Jean reviennent 3 mois plus tard et voient
--      toujours l'invite à signaler. Frustration : "j'ai déjà signalé".
--
--   2. Card "disputed" zombie sur la bannière Home (mig 93)
--      ──────────────────────────────────────────────────────
--      get_pending_user_actions retourne la card priority 1 "Désaccord à
--      signaler" pour TOUTES les conv en disputed, sans tenir compte :
--      a) si l'user a déjà signalé (UNIQUE empêche le re-signalement de
--         toute façon, mais la card pollue la bannière)
--      b) si l'admin a déjà tranché (situation connue de Niqo, plus la
--         peine d'agir)
--
-- SOLUTION
--   Nouveau marqueur `conversations.admin_signalement_decided_at timestamptz`
--   posé automatiquement par `fn_signalement_check_threshold` (étendu mig 91)
--   dès qu'un signalement `target_type='rdv_post'` passe à `traite` OU `rejete`.
--   Cumulatif et idempotent : un 2e signalement décidé n'écrase pas la date.
--
--   Conséquences :
--   - Côté chat : bandeau orange disputed → bandeau gris "Ce RDV a été
--     examiné par l'équipe Niqo" (côté UI mobile, cf. lib/rdv.ts)
--   - Côté Home banner : card "disputed" filtrée dès qu'un user a signalé
--     OU que l'admin a tranché
--   - Pas de réinitialisation : si Jean signale Marie après que Marie a
--     déjà été traitée, la conv reste marquée résolue
--
-- HORS SCOPE
--   - submit_avis et mark_vendue restent bloqués (cohérent : rencontre est
--     toujours en désaccord, on ne peut pas noter ni vendre)
--   - Bouton "Signaler ce RDV" côté chat : reste visible côté UI tant que
--     admin pas décidé (autre partie peut signaler en retour). Une fois
--     admin decided, masqué pour les 2.
--
-- Prérequis : mig 22 (conversations), 25 (signalements + trigger), 91 (rdv_post),
--             93 (get_pending_user_actions).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonne admin_signalement_decided_at ───────────────────────────────

alter table public.conversations
  add column if not exists admin_signalement_decided_at timestamptz;

comment on column public.conversations.admin_signalement_decided_at is
  'Timestamp posé par fn_signalement_check_threshold (mig 96) dès qu''un signalement target_type=rdv_post sur cette conv passe à traite OU rejete. Sert à masquer le bandeau disputed zombie côté chat + filtrer la card "disputed" de get_pending_user_actions. Cumulatif (1er décidé wins). NULL = jamais décidé.';

-- Index partiel : sert au filtrage get_pending_user_actions (where IS NULL)
create index if not exists idx_conversations_admin_decided
  on public.conversations (admin_signalement_decided_at)
  where admin_signalement_decided_at is not null;

-- ── 2. Extension fn_signalement_check_threshold ────────────────────────────
-- Patch mig 91 → ajoute le set du timestamp pour rdv_post (traite OR rejete).
-- Le reste de la function (push signaleur, score_abus, auto-pause fraude)
-- reste inchangé.

create or replace function public.fn_signalement_check_threshold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user_id uuid;
  v_count_30d      int;
  v_annonce_id     uuid;
begin
  -- Fire seulement quand statut change
  if NEW.statut = OLD.statut then
    return NEW;
  end if;

  -- ── Push signaleur (toutes décisions) — inchangé mig 91 ─────────────────
  if NEW.statut in ('traite', 'rejete') then
    perform public._notify_push(
      array[NEW.signaleur_id],
      case when NEW.statut = 'traite'
        then 'Signalement pris en compte'
        else 'Signalement examiné'
      end,
      case when NEW.statut = 'traite'
        then 'Merci, ton signalement a été validé. Action prise contre l''auteur.'
        else 'Notre équipe a examiné ton signalement et n''a pas retenu de manquement.'
      end,
      jsonb_build_object('url', '/profile')
    );
  end if;

  -- ── Mig 96 — set admin_signalement_decided_at sur conv (rdv_post only) ──
  -- Cumulatif : si déjà set par un signalement antérieur, on n'écrase pas.
  -- Si la conv est purgée plus tard (annonce_id null), pas de drame.
  if NEW.target_type = 'rdv_post' and NEW.statut in ('traite', 'rejete') then
    update public.conversations
    set admin_signalement_decided_at = coalesce(admin_signalement_decided_at, now())
    where id = NEW.target_id;
  end if;

  -- ── Logique sanction (uniquement si traite) — inchangé mig 91 ──────────
  if NEW.statut <> 'traite' or OLD.statut = 'traite' then
    return NEW;
  end if;

  if NEW.target_type = 'utilisateur' then
    v_target_user_id := NEW.target_id;
  elsif NEW.target_type = 'annonce' then
    select vendeur_id into v_target_user_id
    from public.annonces where id = NEW.target_id;
  elsif NEW.target_type = 'message' then
    select expediteur_id into v_target_user_id
    from public.messages where id = NEW.target_id;
  elsif NEW.target_type = 'rdv_post' then
    select case when NEW.role_signaleur = 'acheteur' then vendeur_id else acheteur_id end
      into v_target_user_id
    from public.conversations where id = NEW.target_id;
  end if;

  if v_target_user_id is null then
    return NEW;
  end if;

  update public.users
  set score_abus      = score_abus + 1,
      nb_signalements = nb_signalements + 1
  where id = v_target_user_id;

  select count(*) into v_count_30d
  from public.signalements s
  where s.statut = 'traite'
    and s.updated_at > now() - interval '30 days'
    and (
      (s.target_type = 'utilisateur' and s.target_id = v_target_user_id)
      or (s.target_type = 'annonce' and s.target_id in (
        select id from public.annonces where vendeur_id = v_target_user_id
      ))
      or (s.target_type = 'message' and s.target_id in (
        select id from public.messages where expediteur_id = v_target_user_id
      ))
      or (s.target_type = 'rdv_post' and s.target_id in (
        select id from public.conversations
        where (s.role_signaleur = 'acheteur' and vendeur_id = v_target_user_id)
           or (s.role_signaleur = 'vendeur'  and acheteur_id = v_target_user_id)
      ))
    );

  if v_count_30d >= 3 then
    update public.users
    set is_active = false
    where id = v_target_user_id
      and is_active = true;
  end if;

  -- Auto-pause annonce sur fraude validée (mig 91 inchangé)
  if NEW.target_type = 'rdv_post'
     and NEW.motif_categorie in ('tentative_fraude', 'complot_fraude')
  then
    v_annonce_id := (NEW.rdv_snapshot->>'annonce_id')::uuid;
    if v_annonce_id is not null then
      update public.annonces
      set statut     = 'suspendue',
          updated_at = now()
      where id = v_annonce_id
        and statut not in ('suspendue', 'expiree');
    end if;
  end if;

  return NEW;
end;
$$;

-- ── 3. Update get_pending_user_actions (mig 93) ────────────────────────────
-- Branche `disputed` : exclure si admin a tranché OU si user a déjà signalé.
-- Le reste des branches (rencontre, mark_vendue, avis) inchangé.

create or replace function public.get_pending_user_actions()
returns table (
  type            text,
  priority        int,
  conversation_id uuid,
  annonce_id      uuid,
  annonce_titre   text,
  other_user_id   uuid,
  other_prenom    text,
  rdv_date        timestamptz,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
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
      c.admin_signalement_decided_at,  -- mig 96
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
  -- Action 1 : disputed (mig 96 — masque si admin a décidé OU user a déjà signalé)
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
    -- mig 96 — masque si admin a déjà tranché sur cette conv
    and mc.admin_signalement_decided_at is null
    -- mig 96 — masque si user a déjà signalé (UNIQUE empêche re-signalement de toute façon)
    and not exists (
      select 1 from public.signalements
      where target_type = 'rdv_post'
        and target_id = mc.id
        and signaleur_id = v_uid
    )

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
  -- Action 3 : mark_vendue — je suis vendeur, ≥1 conv `met` sur cette annonce
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

revoke all on function public.get_pending_user_actions() from public, anon;
grant execute on function public.get_pending_user_actions() to authenticated;

-- ── 4. Backfill ────────────────────────────────────────────────────────────
-- Pour les signalements existants déjà décidés (traite OR rejete) sur target_type=rdv_post,
-- set admin_signalement_decided_at sur leur conv (= MIN updated_at du 1er signalement décidé).
-- Idempotent : ré-jeu de la mig n'écrase pas (coalesce protège).

update public.conversations c
set admin_signalement_decided_at = sub.first_decided_at
from (
  select target_id as conv_id, min(updated_at) as first_decided_at
  from public.signalements
  where target_type = 'rdv_post'
    and statut in ('traite', 'rejete')
  group by target_id
) sub
where c.id = sub.conv_id
  and c.admin_signalement_decided_at is null;

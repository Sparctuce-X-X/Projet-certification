-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 91 — Signalement contextualisé post-RDV
--
-- PROBLÈME RÉSOLU
--   Mig 86 introduit l'état `disputed` (les 2 parties désaccord sur la
--   rencontre). Bandeau chat propose "Signaler ce RDV" mais → placeholder
--   Alert. F08 actuel (mig 25-28) gère 3 cibles : annonce / utilisateur /
--   message. Aucune piste contextualisée pour signaler un RDV en lui-même
--   (avec snapshot de la conv + motif typé + actions admin spécifiques
--   comme auto-pause annonce sur fraude).
--
-- SOLUTION
--   1. Étendre enum cible_signalement avec 'rdv_post' (target_id = conv_id)
--   2. Nouvel enum `motif_signalement_rdv` à 7 valeurs typées
--   3. Colonnes additionnelles sur signalements :
--      - motif_categorie : enum typé (vs motif text libre)
--      - rdv_snapshot   : jsonb immuable (titre annonce, parties,
--                         date/lieu, état rencontre au moment du report)
--      - role_signaleur : 'acheteur' | 'vendeur' (pour résoudre la cible
--                         dans le trigger sans re-fetch)
--   4. RPC `create_signalement_post_rdv()` — gates : participant conv, RDV
--      passé (rdv_date < now), description obligatoire si motif='autre'
--   5. Trigger `fn_signalement_check_threshold` étendu pour rdv_post :
--      - Résoudre v_target_user_id depuis role_signaleur (l'AUTRE partie)
--      - Auto-pause annonce (statut='suspendue') si motif=tentative_fraude
--        OU complot_fraude ET statut signalement → 'traite'
--      - Push signaleur "Ton signalement a été pris en compte/rejeté"
--
-- CHOIX DESIGN
--   - Étendre la table existante (vs nouvelle table dédiée) : 1 file
--     d'attente unifiée pour l'admin, 1 seul écran modération, réutilise
--     le trigger auto-suspend, anti-doublon UNIQUE déjà en place.
--   - rdv_snapshot jsonb : témoin immuable. Si admin valide 30j plus tard,
--     l'annonce/conv peut avoir été supprimée — le snapshot reste.
--   - Pas de push à la cible (la personne signalée) sauf si auto-suspendue
--     (déjà géré par fn_push_user_suspended mig 67). Évite le côté
--     culpabilisant et les vendettas.
--
-- Prérequis : mig 25 (signalements), 28 (auto-suspend), 56 (admin RPC),
--             65 (_notify_push helper), 86 (rencontre).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║                                                                         ║
-- ║   ⚠ EXÉCUTION EN 2 PASSES SUR SUPABASE SQL EDITOR (1ère fois)          ║
-- ║                                                                         ║
-- ║   ALTER TYPE ADD VALUE doit être commité avant d'être utilisé dans     ║
-- ║   les statements de la même transaction (ici : index partiel + corps   ║
-- ║   de la function check_threshold). Sur Supabase SQL Editor (qui wrap   ║
-- ║   tout en BEGIN/COMMIT par défaut), il faut donc 2 passes :             ║
-- ║                                                                         ║
-- ║     PASSE 1 — sélectionner UNIQUEMENT la ligne ALTER TYPE ci-dessous   ║
-- ║                et cliquer Run                                           ║
-- ║     PASSE 2 — sélectionner tout le reste (à partir du commentaire      ║
-- ║                "── 2. Nouvel enum") et cliquer Run                     ║
-- ║                                                                         ║
-- ║   Au REPLAY (clean dev / re-deploy) : ALTER TYPE skip via IF NOT       ║
-- ║   EXISTS car la valeur est déjà commitée → on peut run TOUT le         ║
-- ║   fichier d'un coup sans erreur. Mig idempotente.                       ║
-- ║                                                                         ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

-- ── 1. Étendre enum cible_signalement ─────────────────────────────────────

alter type public.cible_signalement add value if not exists 'rdv_post';

-- ── 2. Nouvel enum motif_signalement_rdv ──────────────────────────────────

do $$ begin
  create type public.motif_signalement_rdv as enum (
    'no_show',                -- L'autre n'est pas venu au RDV
    'produit_different',      -- Produit reçu ne correspond pas à l'annonce
    'produit_defectueux',     -- Produit défectueux / cassé / non fonctionnel
    'tentative_fraude',       -- Fausse monnaie, faux billet, vol, escroquerie
    'comportement_dangereux', -- Violent, menaçant, harcèlement physique
    'complot_fraude',         -- Suspicion de coordination malveillante (multi-comptes)
    'autre'                   -- Autre (description obligatoire)
  );
exception when duplicate_object then null;
end $$;

-- ── 3. Colonnes additionnelles sur signalements ───────────────────────────

alter table public.signalements
  add column if not exists motif_categorie public.motif_signalement_rdv;

alter table public.signalements
  add column if not exists rdv_snapshot jsonb;

alter table public.signalements
  add column if not exists role_signaleur text
    check (role_signaleur is null or role_signaleur in ('acheteur', 'vendeur'));

comment on column public.signalements.motif_categorie is
  'Motif typé pour signalements target_type=rdv_post (mig 91). Null pour les autres types.';
comment on column public.signalements.rdv_snapshot is
  'Snapshot jsonb immuable de la conv au moment du signalement (mig 91). Préserve contexte si annonce/conv supprimée plus tard. Null pour les autres types.';
comment on column public.signalements.role_signaleur is
  'Role du signaleur dans la conv (mig 91) : acheteur OU vendeur. Permet au trigger de résoudre la cible (= l''autre partie) sans re-fetch. Null pour les autres types.';

-- Index pour file modération admin (couvre tous les target_type, filtrables
-- via le predicate sur target_type côté query). On évite délibérément le
-- WHERE target_type='rdv_post' qui forcerait un cast immédiat de la nouvelle
-- enum value et déclencherait l'erreur 55P04 dans la même tx que ALTER TYPE.
create index if not exists idx_signalements_pending_by_type
  on public.signalements (target_type, created_at desc)
  where statut = 'en_attente';

-- ── 4. RPC create_signalement_post_rdv ────────────────────────────────────

create or replace function public.create_signalement_post_rdv(
  p_conversation_id uuid,
  p_motif_categorie public.motif_signalement_rdv,
  p_description     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_conv         public.conversations%rowtype;
  v_role         text;
  v_snapshot     jsonb;
  v_motif_label  text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  -- Description obligatoire pour motif 'autre'
  if p_motif_categorie = 'autre' and (p_description is null or trim(p_description) = '') then
    return jsonb_build_object('success', false, 'error', 'description_required');
  end if;

  -- Description max 1000 chars
  if p_description is not null and char_length(p_description) > 1000 then
    return jsonb_build_object('success', false, 'error', 'description_too_long');
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

  -- Role du signaleur
  v_role := case
    when v_uid = v_conv.acheteur_id then 'acheteur'
    else 'vendeur'
  end;

  -- Snapshot (immuable) — fetch enrichi annonce + parties
  select jsonb_build_object(
    'conversation_id',    v_conv.id,
    'annonce_id',         v_conv.annonce_id,
    'annonce_titre',      a.titre,
    'annonce_prix',       a.prix,
    'annonce_statut',     a.statut::text,
    'acheteur_id',        v_conv.acheteur_id,
    'acheteur_prenom',    ua.prenom,
    'vendeur_id',         v_conv.vendeur_id,
    'vendeur_prenom',     uv.prenom,
    'rdv_lieu',           v_conv.rdv_lieu,
    'rdv_date',           v_conv.rdv_date,
    'rdv_confirme_at',    v_conv.rdv_confirme_at,
    'rencontre_acheteur', v_conv.rencontre_acheteur,
    'rencontre_vendeur',  v_conv.rencontre_vendeur,
    'rencontre_decided_at', v_conv.rencontre_decided_at,
    'snapshot_at',        now()
  ) into v_snapshot
  from public.conversations c
  left join public.annonces a on a.id = c.annonce_id
  left join public.users ua    on ua.id = c.acheteur_id
  left join public.users uv    on uv.id = c.vendeur_id
  where c.id = v_conv.id;

  -- Motif label fr (utilisé comme valeur du champ motif text pour fallback)
  v_motif_label := case p_motif_categorie
    when 'no_show'                then 'Absent au rendez-vous'
    when 'produit_different'      then 'Produit ne correspond pas à l''annonce'
    when 'produit_defectueux'     then 'Produit défectueux'
    when 'tentative_fraude'       then 'Tentative de fraude'
    when 'comportement_dangereux' then 'Comportement dangereux'
    when 'complot_fraude'         then 'Complot / coordination malveillante'
    when 'autre'                  then 'Autre'
  end;

  -- Insert signalement (UNIQUE constraint anti-doublon : même conv + même
  -- signaleur + target_type 'rdv_post' = 1 seul report par cible)
  begin
    insert into public.signalements (
      target_type, target_id, signaleur_id, motif, description,
      motif_categorie, rdv_snapshot, role_signaleur
    ) values (
      'rdv_post', p_conversation_id, v_uid, v_motif_label, p_description,
      p_motif_categorie, v_snapshot, v_role
    );
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_reported');
  end;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.create_signalement_post_rdv(uuid, public.motif_signalement_rdv, text) from public;
grant execute on function public.create_signalement_post_rdv(uuid, public.motif_signalement_rdv, text) to authenticated;

-- ── 5. Étendre fn_signalement_check_threshold pour rdv_post ───────────────
-- Diff vs mig 25 :
--   - Resolve v_target_user_id pour target_type='rdv_post' (l'AUTRE partie
--     selon role_signaleur). Le snapshot est référence figée mais ici on
--     veut savoir qui est sanctionné — l'autre partie.
--   - Si motif_categorie ∈ (tentative_fraude, complot_fraude) ET statut →
--     'traite' : auto-pause annonce du snapshot (statut='suspendue').
--   - Push signaleur : "Ton signalement a été pris en compte/rejeté".
--
-- Reste inchangé : score_abus++, nb_signalements++, auto-suspend si ≥3 en 30j.

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
  -- Fire seulement quand statut passe de !traite → traite OU statut → rejete
  if NEW.statut = OLD.statut then
    return NEW;
  end if;

  -- ── Push signaleur (toutes décisions) ────────────────────────────────────
  -- Note : pour les target_type historiques (annonce/user/message), on push
  -- aussi maintenant — léger changement de comportement vs mig 25 (mais
  -- bénéfique : feedback utilisateur sur sa modération).
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

  -- ── Logique sanction (uniquement si traite) ──────────────────────────────
  if NEW.statut <> 'traite' or OLD.statut = 'traite' then
    return NEW;
  end if;

  -- Résoudre v_target_user_id selon target_type
  if NEW.target_type = 'utilisateur' then
    v_target_user_id := NEW.target_id;
  elsif NEW.target_type = 'annonce' then
    select vendeur_id into v_target_user_id
    from public.annonces where id = NEW.target_id;
  elsif NEW.target_type = 'message' then
    select expediteur_id into v_target_user_id
    from public.messages where id = NEW.target_id;
  elsif NEW.target_type = 'rdv_post' then
    -- target_id = conversation_id, role_signaleur indique le signaleur
    -- → la cible est l'AUTRE partie de la conv
    select case when NEW.role_signaleur = 'acheteur' then vendeur_id else acheteur_id end
      into v_target_user_id
    from public.conversations where id = NEW.target_id;
  end if;

  if v_target_user_id is null then
    return NEW;
  end if;

  -- Incrémenter score_abus + nb_signalements (le trigger tg_check_score_abus
  -- mig 28 auto-suspendra si score_abus ≥ 3)
  update public.users
  set score_abus      = score_abus + 1,
      nb_signalements = nb_signalements + 1
  where id = v_target_user_id;

  -- Compter les signalements traite sur ce user dans les 30 derniers jours
  -- (idem mig 25, étendu pour inclure rdv_post)
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

  -- Auto-suspension si ≥ 3 signalements traite en 30j (idem mig 25)
  if v_count_30d >= 3 then
    update public.users
    set is_active = false
    where id = v_target_user_id
      and is_active = true;
  end if;

  -- ── Auto-pause annonce sur fraude validée (rdv_post uniquement) ──────────
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

-- Trigger déjà créé en mig 25 (tg_signalement_check_threshold). On ne le
-- recrée pas ici, juste la function est remplacée par CREATE OR REPLACE.

-- ── 6. Étendre la liste des motifs admin (info doc, pas du code) ──────────
-- L'admin web /admin/signalements affichera signalement.motif_categorie
-- via un mapping enum → label fr (côté front). Pas de table de référence
-- côté DB pour rester souple (changement label = front-only).

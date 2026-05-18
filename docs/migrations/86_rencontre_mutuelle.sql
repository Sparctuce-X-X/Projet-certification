-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 86 — Confirmation mutuelle post-RDV (anti-fraude vendeur)
--
-- PROBLÈME RÉSOLU
--   Le modèle "Proposer → Confirmer" (mig 35) permet à un vendeur de
--   `mark_annonce_vendue` dès que `rdv_date < now()` ET `rdv_confirme_at IS NOT NULL`.
--   Conséquence : un vendeur peut gonfler ses chiffres sans avoir réellement
--   rencontré l'acheteur (suffit de proposer un RDV bidon, l'acheteur confirme
--   par politesse, le vendeur attend la date, mark_vendue → faux nb_ventes
--   et faux KPIs plateforme).
--
--   Idem pour `submit_avis` (F06) : un vendeur peut auto-noter sans rencontre
--   réelle, dès que rdv_date est passé.
--
-- SOLUTION — Confirmation mutuelle post-RDV
--   Après le passage de `rdv_date`, chaque partie répond explicitement :
--     - `rencontre_<role> = true`   → "Oui, on s'est vu"
--     - `rencontre_<role> = false`  → "Non, on ne s'est pas vu"
--     - `rencontre_<role> = null`   → pas encore répondu
--
--   États dérivés (calculés à la lecture, pas stockés) :
--     met         (true,  true)   → tout ouvert (mark_vendue + submit_avis)
--     disputed    (true,  false)  → tout bloqué (signalement contextuel à venir mig 87)
--     unconfirmed (false, false)  → tout bloqué + lifecycle revert annonce → active
--     pending     (null partout)  → tout bloqué tant que personne n'a répondu
--     unilateral  (true, null)    → bloqué (en attente de l'autre)
--
-- COMPOSANTS
--   1. ALTER TABLE conversations — 3 colonnes (rencontre_acheteur/vendeur/decided_at)
--   2. Index partiel pour requêtes "RDV passés en attente de décision"
--   3. RPC confirm_rencontre(p_conversation_id, p_rencontre boolean)
--   4. Adapter RPC mark_annonce_vendue (mig 39) — exige rencontre 2x true
--   5. Adapter RPC submit_avis (mig 37) — exige rencontre côté auteur=true, autre!=false
--   6. Trigger fn_annonce_statut_on_rencontre_change — revert annonce → active si 2x false
--   7. Backfill : conv avec rdv_confirme_at non-null → rencontre_*=true
--
-- Prérequis : migrations 35 (RDV), 37-38-42 (notation), 39 (lifecycle).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. ALTER TABLE conversations ──────────────────────────────────────────

alter table public.conversations
  add column if not exists rencontre_acheteur   boolean,
  add column if not exists rencontre_vendeur    boolean,
  add column if not exists rencontre_decided_at timestamptz;

comment on column public.conversations.rencontre_acheteur is
  'Confirmation post-RDV côté acheteur. NULL=pas répondu, TRUE=on s''est vu, FALSE=on ne s''est pas vu.';
comment on column public.conversations.rencontre_vendeur is
  'Confirmation post-RDV côté vendeur. NULL=pas répondu, TRUE=on s''est vu, FALSE=on ne s''est pas vu.';
comment on column public.conversations.rencontre_decided_at is
  'Set quand les DEUX parties ont répondu (état terminal : met / disputed / unconfirmed).';

-- ── 2. Index partiel — RDV passés en attente de décision ──────────────────
-- Sert à : requêtes du dashboard vendeur ("À confirmer : 3 RDV passés"),
-- futur cron de relance push, et debug admin.

create index if not exists idx_conversations_rdv_pending_decision
  on public.conversations (rdv_date)
  where rdv_confirme_at is not null
    and rencontre_decided_at is null;

-- ── 3. RPC confirm_rencontre ──────────────────────────────────────────────
-- Permet à un participant de répondre "oui/non" sur la rencontre post-RDV.
-- Idempotent : repasser à la même valeur ne change rien (mais réécrit decided_at).
-- Une fois decided_at set (les 2 ont répondu), la décision est figée — plus de modif.

create or replace function public.confirm_rencontre(
  p_conversation_id uuid,
  p_rencontre       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_conv         public.conversations%rowtype;
  v_role         text;        -- 'acheteur' | 'vendeur'
  v_other_value  boolean;
  v_now_decided  boolean;
  v_prenom       text;
  v_msg_text     text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if p_rencontre is null then
    return jsonb_build_object('success', false, 'error', 'rencontre_required');
  end if;

  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  -- Participant ?
  if v_uid = v_conv.acheteur_id then
    v_role        := 'acheteur';
    v_other_value := v_conv.rencontre_vendeur;
  elsif v_uid = v_conv.vendeur_id then
    v_role        := 'vendeur';
    v_other_value := v_conv.rencontre_acheteur;
  else
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  -- RDV doit être confirmé ET passé
  if v_conv.rdv_confirme_at is null then
    return jsonb_build_object('success', false, 'error', 'no_confirmed_rdv');
  end if;

  if v_conv.rdv_date is null or v_conv.rdv_date >= now() then
    return jsonb_build_object('success', false, 'error', 'rdv_not_past');
  end if;

  -- Décision déjà figée ?
  if v_conv.rencontre_decided_at is not null then
    return jsonb_build_object('success', false, 'error', 'rencontre_already_decided');
  end if;

  -- Update du côté courant
  v_now_decided := v_other_value is not null;  -- les 2 vont avoir répondu

  if v_role = 'acheteur' then
    update public.conversations
    set rencontre_acheteur   = p_rencontre,
        rencontre_decided_at = case when v_now_decided then now() else null end
    where id = p_conversation_id;
  else
    update public.conversations
    set rencontre_vendeur    = p_rencontre,
        rencontre_decided_at = case when v_now_decided then now() else null end
    where id = p_conversation_id;
  end if;

  -- Message système (silencieux si pas terminal — on n'inonde pas le chat)
  if v_now_decided then
    select prenom into v_prenom from public.users where id = v_uid;
    v_msg_text :=
      case
        when (v_role = 'acheteur' and p_rencontre = true and v_other_value = true)
          or (v_role = 'vendeur' and p_rencontre = true and v_other_value = true)
          then 'Rencontre confirmée par les deux parties'
        when (v_role = 'acheteur' and p_rencontre = false and v_other_value = false)
          or (v_role = 'vendeur' and p_rencontre = false and v_other_value = false)
          then 'Aucune rencontre confirmée par les deux parties'
        else 'Désaccord sur la rencontre — signalement possible'
      end;

    insert into public.messages (conversation_id, expediteur_id, contenu, type)
    values (p_conversation_id, v_uid, v_msg_text, 'systeme');
  end if;

  return jsonb_build_object(
    'success', true,
    'decided', v_now_decided,
    'rencontre_acheteur', case when v_role='acheteur' then p_rencontre else v_conv.rencontre_acheteur end,
    'rencontre_vendeur',  case when v_role='vendeur'  then p_rencontre else v_conv.rencontre_vendeur  end
  );
end;
$$;

revoke all on function public.confirm_rencontre(uuid, boolean) from public;
grant execute on function public.confirm_rencontre(uuid, boolean) to authenticated;

-- ── 4. Adapter mark_annonce_vendue (mig 39) ───────────────────────────────
-- Nouvelle règle : exige au moins une conversation où les DEUX parties ont
-- confirmé la rencontre (rencontre_acheteur=true AND rencontre_vendeur=true).
-- L'erreur 'no_past_rdv' devient 'no_meeting_confirmed'.

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

  -- Au moins une conv avec rencontre confirmée par les DEUX parties
  select exists (
    select 1 from public.conversations
    where annonce_id = p_annonce_id
      and rdv_confirme_at is not null
      and rencontre_acheteur = true
      and rencontre_vendeur  = true
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

-- ── 5. Adapter submit_avis (mig 37) ───────────────────────────────────────
-- Nouvelle règle : la note ne peut être posée que si l'auteur a dit "on s'est
-- vu" (rencontre_<role auteur>=true) ET l'autre n'a pas explicitement dit
-- "non" (rencontre_<autre> != false). Si l'autre a dit non → état disputed,
-- pas de note possible (l'admin tranche via signalement, mig 87).
--
-- L'erreur 'rdv_not_past' (jamais censée fire vu que rencontre exige rdv passé)
-- est conservée par sécurité défense en profondeur.

create or replace function public.submit_avis(
  p_conversation_id uuid,
  p_note            smallint,
  p_commentaire     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid             uuid := auth.uid();
  v_conv            public.conversations%rowtype;
  v_role_auteur     text;
  v_cible_id        uuid;
  v_existing        uuid;
  v_clean_comment   text;
  v_rencontre_self  boolean;
  v_rencontre_other boolean;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if p_note is null or p_note < 1 or p_note > 5 then
    return jsonb_build_object('success', false, 'error', 'note_invalid');
  end if;

  v_clean_comment := nullif(trim(coalesce(p_commentaire, '')), '');

  if v_clean_comment is not null and char_length(v_clean_comment) > 200 then
    return jsonb_build_object('success', false, 'error', 'commentaire_too_long');
  end if;

  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  if v_uid = v_conv.acheteur_id then
    v_role_auteur     := 'acheteur';
    v_cible_id        := v_conv.vendeur_id;
    v_rencontre_self  := v_conv.rencontre_acheteur;
    v_rencontre_other := v_conv.rencontre_vendeur;
  elsif v_uid = v_conv.vendeur_id then
    v_role_auteur     := 'vendeur';
    v_cible_id        := v_conv.acheteur_id;
    v_rencontre_self  := v_conv.rencontre_vendeur;
    v_rencontre_other := v_conv.rencontre_acheteur;
  else
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  if v_conv.rdv_confirme_at is null then
    return jsonb_build_object('success', false, 'error', 'rdv_not_confirmed');
  end if;

  if v_conv.rdv_date is null or v_conv.rdv_date >= now() then
    return jsonb_build_object('success', false, 'error', 'rdv_not_past');
  end if;

  -- Doit avoir confirmé "on s'est vu"
  if v_rencontre_self is null then
    return jsonb_build_object('success', false, 'error', 'meeting_not_confirmed_self');
  end if;

  if v_rencontre_self = false then
    return jsonb_build_object('success', false, 'error', 'meeting_declined_self');
  end if;

  -- L'autre ne doit pas avoir dit "non" explicitement (disputed)
  if v_rencontre_other = false then
    return jsonb_build_object('success', false, 'error', 'meeting_disputed');
  end if;

  select id into v_existing
  from public.avis
  where conversation_id = p_conversation_id and auteur_id = v_uid;

  if v_existing is not null then
    return jsonb_build_object('success', false, 'error', 'avis_already_submitted');
  end if;

  insert into public.avis (
    conversation_id, auteur_id, cible_id, note, commentaire, role_auteur, is_auto
  ) values (
    p_conversation_id, v_uid, v_cible_id, p_note, v_clean_comment, v_role_auteur, false
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.submit_avis(uuid, smallint, text) from public;
grant execute on function public.submit_avis(uuid, smallint, text) to authenticated;

-- ── 6. Trigger lifecycle annonce sur rencontre_decided_at ─────────────────
-- Quand les 2 parties ont décidé :
--   - met         (true, true)  → annonce reste en_cours (vendeur fera mark_vendue)
--   - disputed    (true, false) → annonce reste en_cours (gelée jusqu'à signalement)
--   - unconfirmed (false, false) → annonce revert à active (RDV était fictif)
--
-- On ne touche que les statuts active <-> en_cours (pas vendue/expiree/suspendue).

create or replace function public.fn_annonce_statut_on_rencontre_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_annonce_id uuid;
begin
  -- Ne réagir que si decided_at vient d'être set (null → non-null)
  if OLD.rencontre_decided_at is not null
     or NEW.rencontre_decided_at is null then
    return NEW;
  end if;

  v_target_annonce_id := NEW.annonce_id;
  if v_target_annonce_id is null then
    return NEW;
  end if;

  -- Cas unconfirmed → revert annonce à active
  if NEW.rencontre_acheteur = false and NEW.rencontre_vendeur = false then
    update public.annonces
    set statut = 'active', updated_at = now()
    where id = v_target_annonce_id
      and statut = 'en_cours';
  end if;

  -- Pour met / disputed : on laisse l'annonce en_cours.
  -- mark_annonce_vendue (vendeur) ou expire_annonces (cron) feront évoluer.

  return NEW;
end;
$$;

drop trigger if exists tg_annonce_statut_on_rencontre_change on public.conversations;
create trigger tg_annonce_statut_on_rencontre_change
  after update of rencontre_decided_at on public.conversations
  for each row
  execute function public.fn_annonce_statut_on_rencontre_change();

-- ── 7. Backfill — conv existantes ─────────────────────────────────────────
-- Pré-MVP : aucune donnée prod. Pour les conv avec rdv_confirme_at + rdv_date
-- passé, on présume que les 2 parties se sont vues (rencontre_*=true,true)
-- pour ne pas casser les flows en cours de test. Idempotent.

update public.conversations
set rencontre_acheteur   = coalesce(rencontre_acheteur, true),
    rencontre_vendeur    = coalesce(rencontre_vendeur,  true),
    rencontre_decided_at = coalesce(rencontre_decided_at, now())
where rdv_confirme_at is not null
  and rdv_date is not null
  and rdv_date < now()
  and (rencontre_acheteur is null or rencontre_vendeur is null);

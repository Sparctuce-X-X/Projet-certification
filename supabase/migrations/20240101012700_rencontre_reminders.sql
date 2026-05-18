-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 87 — Cron de relance push pour rencontre post-RDV non confirmée
--
-- PROBLÈME RÉSOLU
--   Mig 86 introduit la confirmation mutuelle post-RDV mais ne prévoit pas
--   d'auto-décision si une partie ne répond jamais. Conséquence : le vendeur
--   honnête dont l'acheteur ne revient pas sur l'app est bloqué — il peut
--   noter mais pas mark_vendue, et son annonce reste `en_cours` jusqu'à
--   expiration 60j.
--
-- SOLUTION (Option A) — Push de relance progressif
--   Cron quotidien à 10h Africa/Abidjan qui envoie un push à la/les partie(s)
--   silencieuse(s) à J+1, J+3 et J+7 post-RDV. Pas d'auto-décision : on parie
--   sur le rappel. Si l'autre ne répond toujours pas après J+7 → silence radio
--   définitif, on s'arrête (pas de spam). L'annonce expirera à 60j naturellement.
--
-- COMPOSANTS
--   1. Add column conversations.rencontre_reminders_sent smallint default 0
--      (counter 0→3, garde-fou anti-doublon)
--   2. Adapter propose_rdv (reset rencontre_* + counter sur re-proposition)
--   3. Adapter cancel_rdv (reset rencontre_* + counter sur annulation)
--   4. Helper fn_push_rencontre_reminder() — boucle sur conv éligibles +
--      _notify_push aux silencieux + increment counter
--   5. Cron pg_cron quotidien 10h UTC (= 10h Africa/Abidjan UTC+0)
--
-- Prérequis : mig 35 (RDV), 65 (push helper), 86 (rencontre).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add column counter ─────────────────────────────────────────────────

alter table public.conversations
  add column if not exists rencontre_reminders_sent smallint not null default 0;

comment on column public.conversations.rencontre_reminders_sent is
  'Compteur des rappels push envoyés à la/les partie(s) silencieuse(s) post-RDV (mig 87). 0=aucun, 1=J+1 envoyé, 2=J+3 envoyé, 3=J+7 envoyé. Reset à 0 sur propose_rdv ou cancel_rdv. Garde-fou anti-doublon du cron.';

-- ── 2. Adapter propose_rdv (reset rencontre_* sur re-proposition) ─────────
-- Si on re-propose un RDV après cancel, on doit repartir d'un état rencontre vierge.
-- Le check rdv_already_confirmed garantit qu'on ne re-propose pas sur un RDV actif.

create or replace function public.propose_rdv(
  p_conversation_id uuid,
  p_lieu            text,
  p_date            timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_conv         public.conversations%rowtype;
  v_prenom       text;
  v_msg_text     text;
  v_date_fmt     text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  if p_lieu is null or trim(p_lieu) = '' then
    return jsonb_build_object('success', false, 'error', 'lieu_required');
  end if;

  if char_length(trim(p_lieu)) > 100 then
    return jsonb_build_object('success', false, 'error', 'lieu_too_long');
  end if;

  if p_date is null then
    return jsonb_build_object('success', false, 'error', 'date_required');
  end if;

  if p_date <= now() + interval '30 minutes' then
    return jsonb_build_object('success', false, 'error', 'date_too_soon');
  end if;

  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  if v_uid != v_conv.acheteur_id and v_uid != v_conv.vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  if v_conv.rdv_confirme_at is not null then
    return jsonb_build_object('success', false, 'error', 'rdv_already_confirmed');
  end if;

  -- Update conversation : RDV neuf + reset rencontre_* + reset counter (mig 87)
  update public.conversations
  set rdv_lieu                 = trim(p_lieu),
      rdv_date                 = p_date,
      rdv_propose_par          = v_uid,
      rdv_propose_at           = now(),
      rdv_confirme_at          = null,
      rdv_annule_par           = null,
      rdv_annule_at            = null,
      rencontre_acheteur       = null,
      rencontre_vendeur        = null,
      rencontre_decided_at     = null,
      rencontre_reminders_sent = 0
  where id = p_conversation_id;

  select prenom into v_prenom from public.users where id = v_uid;

  v_date_fmt := to_char(p_date at time zone 'Africa/Abidjan', 'DD/MM/YYYY à HH24h"MI"');

  v_msg_text := coalesce(v_prenom, 'Un participant')
                || ' propose un RDV le ' || v_date_fmt
                || ' à ' || trim(p_lieu);

  insert into public.messages (
    conversation_id, expediteur_id, contenu, type
  ) values (
    p_conversation_id, v_uid, v_msg_text, 'systeme'
  );

  return jsonb_build_object('success', true, 'message', v_msg_text);
end;
$$;

revoke all on function public.propose_rdv(uuid, text, timestamptz) from public;
grant execute on function public.propose_rdv(uuid, text, timestamptz) to authenticated;

-- ── 3. Adapter cancel_rdv (reset rencontre_* sur annulation) ──────────────

create or replace function public.cancel_rdv(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_conv     public.conversations%rowtype;
  v_prenom   text;
  v_msg_text text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;

  select * into v_conv
  from public.conversations
  where id = p_conversation_id
  for update;

  if v_conv.id is null then
    return jsonb_build_object('success', false, 'error', 'conversation_not_found');
  end if;

  if v_uid != v_conv.acheteur_id and v_uid != v_conv.vendeur_id then
    return jsonb_build_object('success', false, 'error', 'not_participant');
  end if;

  if v_conv.rdv_propose_par is null and v_conv.rdv_lieu is null then
    return jsonb_build_object('success', false, 'error', 'no_rdv_to_cancel');
  end if;

  -- Reset complet RDV + rencontre + counter (mig 87)
  update public.conversations
  set rdv_lieu                 = null,
      rdv_date                 = null,
      rdv_propose_par          = null,
      rdv_propose_at           = null,
      rdv_confirme_at          = null,
      rdv_annule_par           = v_uid,
      rdv_annule_at            = now(),
      rencontre_acheteur       = null,
      rencontre_vendeur        = null,
      rencontre_decided_at     = null,
      rencontre_reminders_sent = 0
  where id = p_conversation_id;

  select prenom into v_prenom from public.users where id = v_uid;

  v_msg_text := coalesce(v_prenom, 'Un participant') || ' a annulé le RDV';

  insert into public.messages (
    conversation_id, expediteur_id, contenu, type
  ) values (
    p_conversation_id, v_uid, v_msg_text, 'systeme'
  );

  return jsonb_build_object('success', true, 'message', v_msg_text);
end;
$$;

revoke all on function public.cancel_rdv(uuid) from public;
grant execute on function public.cancel_rdv(uuid) to authenticated;

-- ── 4. Helper fn_push_rencontre_reminder ──────────────────────────────────
-- Pour chaque conv éligible (RDV passé + au moins un silencieux + sent < 3),
-- envoie un push à la/les partie(s) silencieuse(s) avec un message contextualisé,
-- puis incrémente le counter.
--
-- Fenêtre temporelle (gardée par counter, pas par bornes hautes) :
--   sent=0 + rdv_date < now() - 1d  → envoyer J+1, sent=1
--   sent=1 + rdv_date < now() - 3d  → envoyer J+3, sent=2
--   sent=2 + rdv_date < now() - 7d  → envoyer J+7, sent=3 (dernier)
--   sent=3                          → silence radio, on n'envoie plus rien
--
-- Approche progressive : si le cron a raté un jour (dump DB, panne pg_cron),
-- on rattrape au prochain run sans perte (le counter est la garde).

create or replace function public.fn_push_rencontre_reminder()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_other_prenom text;
  v_silent_uids uuid[];
begin
  for r in
    select c.id,
           c.acheteur_id,
           c.vendeur_id,
           c.rdv_date,
           c.rencontre_acheteur,
           c.rencontre_vendeur,
           c.rencontre_reminders_sent,
           ua.prenom as acheteur_prenom,
           uv.prenom as vendeur_prenom
    from public.conversations c
    join public.users ua on ua.id = c.acheteur_id
    join public.users uv on uv.id = c.vendeur_id
    where c.rdv_confirme_at is not null
      and c.rdv_date is not null
      and c.rencontre_decided_at is null
      and (c.rencontre_acheteur is null or c.rencontre_vendeur is null)
      and (
        (c.rencontre_reminders_sent = 0 and c.rdv_date < now() - interval '1 day')
        or
        (c.rencontre_reminders_sent = 1 and c.rdv_date < now() - interval '3 days')
        or
        (c.rencontre_reminders_sent = 2 and c.rdv_date < now() - interval '7 days')
      )
      -- Skip si comptes désactivés (ban / suppression)
      and ua.is_active = true
      and uv.is_active = true
  loop
    -- Identifier les silencieux
    v_silent_uids := array[]::uuid[];
    if r.rencontre_acheteur is null then
      v_silent_uids := v_silent_uids || r.acheteur_id;
    end if;
    if r.rencontre_vendeur is null then
      v_silent_uids := v_silent_uids || r.vendeur_id;
    end if;

    -- Déterminer le prénom de "l'autre" pour personnaliser le message
    -- Si les 2 sont silencieux : on n'utilise pas v_other_prenom (broadcast)
    if cardinality(v_silent_uids) = 1 then
      v_other_prenom := case
        when r.rencontre_acheteur is null then r.vendeur_prenom
        else r.acheteur_prenom
      end;

      perform public._notify_push(
        v_silent_uids,
        'Tu as rencontré ' || coalesce(v_other_prenom, 'l''autre partie') || ' ?',
        'Réponds dans le chat pour clore le RDV — ça l''aide à finaliser sa vente.',
        jsonb_build_object('conversation_id', r.id::text)
      );
    else
      -- Les 2 silencieux : push aux 2, message neutre
      perform public._notify_push(
        v_silent_uids,
        'Vous êtes-vous rencontrés ?',
        'Confirmez dans le chat si le RDV a eu lieu.',
        jsonb_build_object('conversation_id', r.id::text)
      );
    end if;

    update public.conversations
    set rencontre_reminders_sent = rencontre_reminders_sent + 1
    where id = r.id;
  end loop;
end;
$$;

revoke all on function public.fn_push_rencontre_reminder() from public;
revoke all on function public.fn_push_rencontre_reminder() from authenticated;
revoke all on function public.fn_push_rencontre_reminder() from anon;
-- Pas de grant : seul le cron (postgres role) appelle cette fonction.

-- ── 5. Cron quotidien 10h Africa/Abidjan (UTC+0 = 10h UTC) ────────────────

select cron.unschedule('rencontre-reminder') where exists (
  select 1 from cron.job where jobname = 'rencontre-reminder'
);

select cron.schedule(
  'rencontre-reminder',
  '0 10 * * *',
  $$ select public.fn_push_rencontre_reminder(); $$
);

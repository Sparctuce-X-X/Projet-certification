-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 90 — Cron de relance push pour annonce "marque vendue" oubliée
--
-- PROBLÈME RÉSOLU
--   Mig 88 + 89 permettent au vendeur de mark_vendue dès que l'acheteur a
--   confirmé la rencontre. Mais si le vendeur OUBLIE de cliquer (ou ferme
--   l'app après le RDV), l'annonce reste `en_cours` indéfiniment jusqu'à
--   expiration naturelle (60j). Conséquences :
--     - L'annonce continue d'être visible/contactable par d'autres acheteurs
--     - `nb_ventes` n'est pas correctement reflétée (incrémentée via avis,
--       mais le vendeur ne pense plus à noter sans mark_vendue → dashboard
--       reste zombie)
--     - Aucune relance active comme pour la rencontre (mig 87)
--
-- SOLUTION — Push de relance progressif au vendeur
--   Cron quotidien à 10h UTC (= 10h Africa/Abidjan, même horaire que
--   `rencontre-reminder` mig 87) qui parcourt les annonces statut='en_cours'
--   où ≥1 conversation est en état `met` (rencontre_acheteur=true ET
--   rencontre_vendeur=true), et envoie un push au vendeur lui rappelant
--   de marquer l'annonce vendue.
--
-- ANTI-SPAM
--   Counter `annonces.mark_vendue_reminders_sent` (smallint 0→3, max 3).
--   Re-push uniquement si > 7 jours depuis dernier push.
--   Au-delà de 3 pushs : silence radio (pas de spam), l'annonce expirera
--   naturellement à 60j.
--
-- RESET
--   Trigger `tg_reset_mark_vendue_reminders` remet à 0 quand statut bascule
--   vers `active` (cancel_rdv → trigger annonce statut → active). Permet un
--   nouveau cycle de relance si nouveau RDV se confirme plus tard.
--   Pas de reset sur `vendue` (filter exclut) ni sur `expiree`/`suspendue`.
--
-- COMPOSANTS
--   1. Add column annonces.mark_vendue_reminders_sent (smallint 0)
--   2. Add column annonces.mark_vendue_reminder_last_at (timestamptz)
--   3. Trigger BEFORE UPDATE OF statut → reset counter sur retour à `active`
--   4. Helper fn_push_mark_vendue_reminder() — boucle + push + counter++
--   5. Cron pg_cron quotidien `mark-vendue-reminder` 10h UTC
--
-- Prérequis : mig 65 (push helper), mig 86 (rencontre), mig 87 (cron pattern),
--             mig 88 (mark_vendue voix acheteur), mig 89 (auto-confirm vendeur).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Counters sur annonces ──────────────────────────────────────────────

alter table public.annonces
  add column if not exists mark_vendue_reminders_sent smallint not null default 0;

comment on column public.annonces.mark_vendue_reminders_sent is
  'Compteur des rappels push envoyés au vendeur pour mark_annonce_vendue (mig 90). 0=aucun, 1-3=relances. Max 3. Reset à 0 quand statut repasse à `active` (trigger tg_reset_mark_vendue_reminders).';

alter table public.annonces
  add column if not exists mark_vendue_reminder_last_at timestamptz;

comment on column public.annonces.mark_vendue_reminder_last_at is
  'Timestamp du dernier push de relance mark_vendue (mig 90). Utilisé par le cron pour respecter l''intervalle min 7 jours entre relances.';

-- ── 2. Trigger reset compteur sur statut → active ─────────────────────────
-- Cas typique : annonce était en_cours (RDV confirmé), cancel_rdv revert à
-- active. Si nouveau RDV se confirme plus tard, on doit pouvoir relancer
-- depuis 0 (sinon vendeur qui a galéré sur RDV1 est silencé sur RDV2).

create or replace function public.fn_reset_mark_vendue_reminders()
returns trigger
language plpgsql
as $$
begin
  if NEW.statut = 'active' and OLD.statut is distinct from 'active' then
    NEW.mark_vendue_reminders_sent  := 0;
    NEW.mark_vendue_reminder_last_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_reset_mark_vendue_reminders on public.annonces;
create trigger tg_reset_mark_vendue_reminders
  before update of statut on public.annonces
  for each row
  execute function public.fn_reset_mark_vendue_reminders();

-- ── 3. Helper fn_push_mark_vendue_reminder ────────────────────────────────
-- Pour chaque annonce éligible (en_cours + ≥1 conv met + counter<3 + dernier
-- push > 7j ou jamais), envoie un push au vendeur avec le titre annonce et
-- le prénom du premier acheteur ayant confirmé la rencontre.
--
-- Multi-conv : si plusieurs acheteurs ont confirmé met sur la même annonce,
-- le push mentionne le premier (rencontre_decided_at asc). Le vendeur voit
-- "Marque vendue" en deeplink → écran annonce où il peut choisir.

create or replace function public.fn_push_mark_vendue_reminder()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_acheteur_prenom text;
  v_titre_short text;
begin
  for r in
    select
      a.id           as annonce_id,
      a.titre        as annonce_titre,
      a.vendeur_id,
      (
        select c.acheteur_id
        from public.conversations c
        where c.annonce_id = a.id
          and c.rdv_confirme_at is not null
          and c.rencontre_acheteur = true
          and c.rencontre_vendeur  = true
        order by c.rencontre_decided_at asc nulls last
        limit 1
      ) as first_acheteur_id
    from public.annonces a
    join public.users uv on uv.id = a.vendeur_id
    where a.statut = 'en_cours'
      and uv.is_active = true
      and a.mark_vendue_reminders_sent < 3
      and (
        a.mark_vendue_reminder_last_at is null
        or a.mark_vendue_reminder_last_at < now() - interval '7 days'
      )
      and exists (
        select 1
        from public.conversations c
        where c.annonce_id = a.id
          and c.rdv_confirme_at is not null
          and c.rencontre_acheteur = true
          and c.rencontre_vendeur  = true
      )
  loop
    -- Safety : si pas d'acheteur trouvé (race), skip
    if r.first_acheteur_id is null then
      continue;
    end if;

    select coalesce(prenom, 'l''acheteur') into v_acheteur_prenom
      from public.users where id = r.first_acheteur_id;

    -- Tronque le titre annonce pour rentrer dans la notif
    v_titre_short := case
      when char_length(r.annonce_titre) > 40
        then substring(r.annonce_titre, 1, 37) || '…'
      else r.annonce_titre
    end;

    perform public._notify_push(
      array[r.vendeur_id],
      'Marque ton annonce comme vendue',
      'Tu as conclu la vente avec ' || v_acheteur_prenom ||
        ' ? Pense à marquer « ' || v_titre_short || ' » comme vendue.',
      jsonb_build_object('url', '/announce/' || r.annonce_id::text)
    );

    update public.annonces
    set mark_vendue_reminders_sent   = mark_vendue_reminders_sent + 1,
        mark_vendue_reminder_last_at = now()
    where id = r.annonce_id;
  end loop;
end;
$$;

revoke all on function public.fn_push_mark_vendue_reminder() from public;
revoke all on function public.fn_push_mark_vendue_reminder() from authenticated;
revoke all on function public.fn_push_mark_vendue_reminder() from anon;
-- Pas de grant : seul le cron (postgres role) appelle cette fonction.

-- ── 4. Cron quotidien 10h UTC ─────────────────────────────────────────────
-- Même horaire que rencontre-reminder (mig 87) — pas de conflit, fonctions
-- distinctes opérant sur des annonces dans des états différents :
--   - rencontre-reminder : conv RDV passé + au moins 1 silencieux
--   - mark-vendue-reminder : annonce en_cours + au moins 1 conv `met`

select cron.unschedule('mark-vendue-reminder') where exists (
  select 1 from cron.job where jobname = 'mark-vendue-reminder'
);

select cron.schedule(
  'mark-vendue-reminder',
  '0 10 * * *',
  $$ select public.fn_push_mark_vendue_reminder(); $$
);

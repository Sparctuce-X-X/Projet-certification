-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 97 — Rappels push avant RDV (J-1 + H-2)
--
-- PROBLÈME RÉSOLU
--   Niqo notifie à propose / confirm / annule, mais aucun rappel à
--   l'approche du RDV. Marie/Jean peuvent oublier leur RDV — friction
--   majeure pour la confiance plateforme. Pattern standard apps RDV
--   (Doctolib, Booking, Calendly).
--
-- SOLUTION
--   Cron horaire qui balaie les conv RDV confirmés futurs et envoie aux 2
--   parties :
--   - 1 push J-1  (rdv_date < now() + 24h, counter=0)  → "Rappel : RDV demain"
--   - 1 push H-2  (rdv_date < now() + 2h,  counter=1)  → "RDV dans 2h"
--   Counter conversations.rdv_reminders_sent (smallint 0-2).
--
--   Reset auto via trigger BEFORE UPDATE quand rdv_date OR rdv_confirme_at
--   change (cancel + re-propose = nouveau cycle de rappels propres).
--
-- DESIGN
--   - Cron horaire (pas quotidien) car H-2 nécessite une fenêtre fine
--   - Push aux 2 parties (rappel mutuel, pas asymétrique comme rencontre)
--   - Timezone affichée selon pays acheteur (Africa/Abidjan = UTC+0 pour CI/CG)
--   - Filtre is_active=true (pas de push aux comptes suspendus)
--   - Counter = garde anti-doublon : si cron rate une heure (panne pg_cron),
--     on rattrape au prochain run sans dupliquer
--
-- HORS SCOPE
--   - Notif "tu peux noter ton expérience après le RDV" → déjà couvert par
--     le bandeau pending mig 86 + cron J+1/J+3/J+7 mig 87
--   - Permettre à l'user de désactiver les rappels → pas demandé MVP
--
-- Prérequis : mig 22 (conversations), 35 (RDV), 65 (_notify_push), 68 (_tz_for_pays).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonne rdv_reminders_sent ─────────────────────────────────────────

alter table public.conversations
  add column if not exists rdv_reminders_sent smallint not null default 0;

comment on column public.conversations.rdv_reminders_sent is
  'Counter rappels push envoyés avant le RDV confirmé (mig 97). 0=jamais, 1=J-1 envoyé, 2=H-2 envoyé. Reset à 0 par trigger tg_reset_rdv_reminders quand rdv_date OR rdv_confirme_at change (nouveau cycle).';

-- ── 2. Trigger reset counter sur changement RDV ────────────────────────────
-- Cancel_rdv pose rdv_date=null + rdv_confirme_at=null → reset.
-- Propose_rdv après cancel pose nouvelle date → reset.
-- Confirm_rdv pose rdv_confirme_at → reset (au cas où).
-- Le trigger AVANT update intercepte tous ces cas via NEW vs OLD compare.

create or replace function public.fn_reset_rdv_reminders()
returns trigger
language plpgsql
as $$
begin
  if NEW.rdv_date is distinct from OLD.rdv_date
     or NEW.rdv_confirme_at is distinct from OLD.rdv_confirme_at
  then
    NEW.rdv_reminders_sent := 0;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tg_reset_rdv_reminders on public.conversations;
create trigger tg_reset_rdv_reminders
  before update on public.conversations
  for each row
  execute function public.fn_reset_rdv_reminders();

-- ── 3. Helper fn_push_rdv_reminder ─────────────────────────────────────────

create or replace function public.fn_push_rdv_reminder()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_tz             text;
  v_local_time     text;
  v_lieu_safe      text;
  v_target_uids    uuid[];
begin
  for r in
    select c.id,
           c.acheteur_id,
           c.vendeur_id,
           c.rdv_date,
           c.rdv_lieu,
           c.rdv_reminders_sent,
           ua.pays as acheteur_pays
    from public.conversations c
    join public.users ua on ua.id = c.acheteur_id
    join public.users uv on uv.id = c.vendeur_id
    where c.rdv_confirme_at is not null
      and c.rdv_date is not null
      and c.rdv_date > now()  -- RDV strictement futur
      and (
        (c.rdv_reminders_sent = 0 and c.rdv_date < now() + interval '24 hours')
        or
        (c.rdv_reminders_sent = 1 and c.rdv_date < now() + interval '2 hours')
      )
      and ua.is_active = true
      and uv.is_active = true
  loop
    v_tz := public._tz_for_pays(r.acheteur_pays::text);
    v_local_time := to_char((r.rdv_date at time zone v_tz)::time, 'HH24h"h"MI');
    v_lieu_safe := coalesce(nullif(trim(r.rdv_lieu), ''), 'lieu non précisé');
    v_target_uids := array[r.acheteur_id, r.vendeur_id];

    if r.rdv_reminders_sent = 0 then
      -- J-1
      perform public._notify_push(
        v_target_uids,
        'Rappel : RDV demain',
        'Vous avez RDV demain à ' || v_local_time || ' à « ' || v_lieu_safe || ' ».',
        jsonb_build_object('conversation_id', r.id::text)
      );
    else
      -- H-2
      perform public._notify_push(
        v_target_uids,
        'RDV dans 2h',
        'RDV à ' || v_local_time || ' à « ' || v_lieu_safe || ' ». Confirme dans le chat en cas d''empêchement.',
        jsonb_build_object('conversation_id', r.id::text)
      );
    end if;

    update public.conversations
    set rdv_reminders_sent = rdv_reminders_sent + 1
    where id = r.id;
  end loop;
end;
$$;

revoke all on function public.fn_push_rdv_reminder() from public, anon, authenticated;
-- Pas de grant : seul le cron (postgres role) appelle cette fonction.

-- ── 4. Cron horaire ────────────────────────────────────────────────────────

select cron.unschedule('rdv-reminder') where exists (
  select 1 from cron.job where jobname = 'rdv-reminder'
);

select cron.schedule(
  'rdv-reminder',
  '0 * * * *',  -- toutes les heures à HH:00
  $$ select public.fn_push_rdv_reminder(); $$
);

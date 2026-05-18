-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 68 — Push notification quality fixes (RECONSTITUÉ depuis prod)
--
-- ⚠ Cette mig a été appliquée en prod en mai 2026 (commit 4a93695) mais le
-- fichier .sql local avait été tronqué à l'écriture (NO-OP `select 1`).
-- Ce fichier est la reconstruction depuis l'état prod (pg_get_functiondef +
-- cron.job, le 2026-05-08).
--
-- 5 fixes qualité sur le module push (F10) identifiés à la review code :
--
--   1. Helper `_tz_for_pays(p_pays)` → 'Africa/Brazzaville' pour CG,
--      'Africa/Abidjan' default. Refonte fn_push_rdv_proposed/confirmed
--      pour formatter la date avec la tz du DESTINATAIRE (pas hardcodée
--      Abidjan qui décalait l'heure de +1h pour les users CG).
--
--   2. fn_push_user_suspended : wording générique "Contacte support" — la
--      suspension peut être auto (score abus ≥3) OU manuelle admin
--      (admin_suspend_user mig 57), le wording mentionnait à tort des
--      signalements confirmés.
--
--   3. fn_push_avis_received : early return si NEW.auteur_id = NEW.cible_id
--      (cas exotique self-avis, évite la notif "X t'a noté X/5").
--
--   4. purge_stale_push_tokens() + cron quotidien 3h UTC qui delete les
--      tokens last_seen_at < 90 jours. Trou RGPD ouvert depuis mig 64.
--
--   5. (Cold-start tap handling — déjà en code mobile lib/push.ts, hors SQL)
--
-- Prérequis : mig 64 (push_tokens), mig 65 (_notify_push helper),
--             mig 66 (fn_push_rdv_proposed), mig 67 (push events).
-- Idempotente : CREATE OR REPLACE pour functions, unschedule+schedule pour cron.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Helper timezone par pays ────────────────────────────────────────────
create or replace function public._tz_for_pays(p_pays text)
returns text
language sql
immutable
as $$
  select case p_pays when 'CG' then 'Africa/Brazzaville' else 'Africa/Abidjan' end;
$$;

-- ── 2. Refonte fn_push_rdv_proposed (tz du destinataire) ───────────────────
create or replace function public.fn_push_rdv_proposed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destinataire_id    uuid;
  v_destinataire_pays  text;
  v_proposeur_prenom   text;
  v_tz                 text;
begin
  if NEW.rdv_propose_at is null then return NEW; end if;
  if OLD.rdv_propose_at is not null and NEW.rdv_propose_at = OLD.rdv_propose_at then
    return NEW;
  end if;

  v_destinataire_id := case
    when NEW.rdv_propose_par = NEW.acheteur_id then NEW.vendeur_id
    when NEW.rdv_propose_par = NEW.vendeur_id then NEW.acheteur_id
    else null
  end;
  if v_destinataire_id is null then return NEW; end if;

  -- Tz du destinataire (pas du proposeur — c'est lui qui regarde la notif)
  select pays into v_destinataire_pays
    from public.users where id = v_destinataire_id;
  v_tz := public._tz_for_pays(v_destinataire_pays);

  -- Prénom du proposeur (différent du destinataire)
  select coalesce(prenom, 'Quelqu''un') into v_proposeur_prenom
    from public.users where id = NEW.rdv_propose_par;

  perform public._notify_push(
    array[v_destinataire_id],
    coalesce(v_proposeur_prenom, 'Quelqu''un') || ' te propose un RDV',
    'Le ' ||
      to_char(NEW.rdv_date at time zone v_tz, 'DD/MM "à" HH24"h"MI') ||
      coalesce(' à ' || NEW.rdv_lieu, '') ||
      ' — Confirme depuis le chat',
    jsonb_build_object('conversation_id', NEW.id::text)
  );
  return NEW;
end;
$$;

-- ── 3. Refonte fn_push_rdv_confirmed (tz du destinataire) ──────────────────
create or replace function public.fn_push_rdv_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destinataire_id   uuid;
  v_destinataire_pays text;
  v_tz                text;
begin
  if NEW.rdv_confirme_at is null or OLD.rdv_confirme_at is not null then
    return NEW;
  end if;

  v_destinataire_id := NEW.rdv_propose_par;

  if v_destinataire_id is null then
    -- Fallback : notif les 2 (cas exotique sans rdv_propose_par)
    -- Tz par défaut Abidjan (même hypothèse que par défaut)
    perform public._notify_push(
      array[NEW.acheteur_id, NEW.vendeur_id],
      'RDV confirmé',
      'Vous vous retrouvez le ' ||
        to_char(NEW.rdv_date at time zone 'Africa/Abidjan', 'DD/MM "à" HH24"h"MI') ||
        coalesce(' à ' || NEW.rdv_lieu, ''),
      jsonb_build_object('conversation_id', NEW.id::text)
    );
    return NEW;
  end if;

  select pays into v_destinataire_pays
    from public.users where id = v_destinataire_id;
  v_tz := public._tz_for_pays(v_destinataire_pays);

  perform public._notify_push(
    array[v_destinataire_id],
    'RDV confirmé !',
    'Vous vous retrouvez le ' ||
      to_char(NEW.rdv_date at time zone v_tz, 'DD/MM "à" HH24"h"MI') ||
      coalesce(' à ' || NEW.rdv_lieu, ''),
    jsonb_build_object('conversation_id', NEW.id::text)
  );
  return NEW;
end;
$$;

-- ── 4. fn_push_avis_received : early return self-avis ──────────────────────
create or replace function public.fn_push_avis_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur_prenom text;
  v_stars         text;
  v_preview       text;
begin
  -- Anti-self : ne notifie pas si l'auteur est aussi la cible (cas exotique)
  if NEW.auteur_id = NEW.cible_id then
    return NEW;
  end if;

  select coalesce(prenom, 'Quelqu''un') into v_auteur_prenom
    from public.users where id = NEW.auteur_id;

  v_stars := repeat('★', NEW.note) || repeat('☆', 5 - NEW.note);

  v_preview := coalesce(v_auteur_prenom, 'Quelqu''un') ||
               ' t''a noté ' || NEW.note || '/5';
  if NEW.commentaire is not null and char_length(NEW.commentaire) > 0 then
    v_preview := v_preview || ' · ' ||
      case when char_length(NEW.commentaire) > 100
        then substring(NEW.commentaire, 1, 97) || '…'
        else NEW.commentaire
      end;
  end if;

  perform public._notify_push(
    array[NEW.cible_id],
    'Avis reçu ' || v_stars,
    v_preview,
    jsonb_build_object('url', '/u/' || NEW.cible_id::text)
  );
  return NEW;
end;
$$;

-- ── 5. fn_push_user_suspended : wording générique ──────────────────────────
create or replace function public.fn_push_user_suspended()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.is_active = OLD.is_active then return NEW; end if;
  if NEW.is_active <> false then return NEW; end if;

  perform public._notify_push(
    array[NEW.id],
    'Compte suspendu',
    'Ton compte Niqo a été suspendu. Contacte support@niqo.africa pour plus d''informations.',
    jsonb_build_object('url', '/profile')
  );
  return NEW;
end;
$$;

-- ── 6. purge_stale_push_tokens + cron quotidien ────────────────────────────
create or replace function public.purge_stale_push_tokens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  delete from public.push_tokens
   where last_seen_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  raise notice 'purge_stale_push_tokens: % tokens deleted', v_count;
  return v_count;
end;
$$;

-- Cron : tous les jours à 3h UTC (idempotent : unschedule si existe puis re-schedule)
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'purge-stale-push-tokens';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'purge-stale-push-tokens',
  '0 3 * * *',
  $$select public.purge_stale_push_tokens();$$
);

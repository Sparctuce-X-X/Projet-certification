-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 38 — Notation : fixes + suppression auto-3/5
--
-- Suite à l'audit du module notation (F06) :
--   1. Drop le cron `avis-auto-j7` + la fonction → décision : pas de note auto
--      par défaut. Si l'utilisateur n'a pas noté en 7j, **pas de note** posée.
--      Plus simple, plus honnête. Le `is_auto` reste dans le schéma au cas où
--      d'anciennes lignes auto sont déjà en DB (rétrocompat sans incidence).
--
--   2. Recalc one-shot des users.note_* et nb_* depuis la table avis. Corrige
--      les incohérences pré-mig 37 (seed/test data avec note_vendeur=5 sans
--      avis backing).
--
--   3. Trigger after delete on avis → recalcule note + nb_* côté cible.
--      Sans ça : si un avis est supprimé (admin / cascade conversation purgée),
--      la moyenne et le compteur deviennent faux. Ouvre une fraude potentielle
--      (pump puis delete).
--
-- Prérequis : migration 37.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Suppression cron + fonction auto-3/5 ───────────────────────────────

select cron.unschedule('avis-auto-j7') where exists (
  select 1 from cron.job where jobname = 'avis-auto-j7'
);

drop function if exists public.fn_avis_auto_j7();

-- ── 2. Recalc one-shot users.note_* et nb_* depuis avis ────────────────────
-- Synchronise tous les compteurs et moyennes avec la réalité de la table avis.
-- À ne jouer qu'une fois — les triggers maintiennent ensuite la cohérence.

update public.users u set
  note_vendeur = coalesce((
    select round(avg(note)::numeric, 2)
    from public.avis
    where cible_id = u.id and role_auteur = 'acheteur'
  ), 0),
  nb_ventes = (
    select count(*)::int
    from public.avis
    where cible_id = u.id and role_auteur = 'acheteur'
  ),
  note_acheteur = coalesce((
    select round(avg(note)::numeric, 2)
    from public.avis
    where cible_id = u.id and role_auteur = 'vendeur'
  ), 0),
  nb_achats = (
    select count(*)::int
    from public.avis
    where cible_id = u.id and role_auteur = 'vendeur'
  );

-- ── 3. Trigger after delete on avis — recalcule moyenne + compteur ─────────
-- Ne s'active qu'en cas de suppression admin ou cascade — l'INSERT direct
-- n'est pas concerné (trigger fn_avis_after_insert mig 37).

create or replace function public.fn_avis_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.role_auteur = 'acheteur' then
    update public.users
    set note_vendeur = coalesce((
          select round(avg(note)::numeric, 2)
          from public.avis
          where cible_id = OLD.cible_id and role_auteur = 'acheteur'
        ), 0),
        nb_ventes = (
          select count(*)::int
          from public.avis
          where cible_id = OLD.cible_id and role_auteur = 'acheteur'
        )
    where id = OLD.cible_id;
  else
    update public.users
    set note_acheteur = coalesce((
          select round(avg(note)::numeric, 2)
          from public.avis
          where cible_id = OLD.cible_id and role_auteur = 'vendeur'
        ), 0),
        nb_achats = (
          select count(*)::int
          from public.avis
          where cible_id = OLD.cible_id and role_auteur = 'vendeur'
        )
    where id = OLD.cible_id;
  end if;

  return OLD;
end;
$$;

drop trigger if exists tg_avis_after_delete on public.avis;
create trigger tg_avis_after_delete
  after delete on public.avis
  for each row
  execute function public.fn_avis_after_delete();

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 42 — Symétriser fn_avis_after_insert (recalc-from-scratch)
--
-- Suite à la code review : `fn_avis_after_insert` (mig 37) faisait
-- `nb_ventes = nb_ventes + 1` alors que `fn_avis_after_delete` (mig 38)
-- recalcule depuis la table avis. Asymétrie qui empêche l'auto-correction
-- en cas de désynchro (cf. cas Jean nb_ventes=7 fantôme avant mig 38).
--
-- → On harmonise les deux triggers sur le pattern recalc-from-scratch.
-- Effet : à chaque INSERT comme à chaque DELETE, les compteurs et moyennes
-- sont recalculés depuis la source de vérité (table avis).
--
-- Plus défensif, marginalement plus coûteux (count + avg sur l'index
-- idx_avis_cible — instantané vu la volumétrie).
--
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fn_avis_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.role_auteur = 'acheteur' then
    -- Cible = vendeur. Recalc note_vendeur + nb_ventes depuis avis.
    update public.users
    set note_vendeur = coalesce((
          select round(avg(note)::numeric, 2)
          from public.avis
          where cible_id = NEW.cible_id and role_auteur = 'acheteur'
        ), 0),
        nb_ventes = (
          select count(*)::int
          from public.avis
          where cible_id = NEW.cible_id and role_auteur = 'acheteur'
        )
    where id = NEW.cible_id;
  else
    -- Cible = acheteur. Recalc note_acheteur + nb_achats depuis avis.
    update public.users
    set note_acheteur = coalesce((
          select round(avg(note)::numeric, 2)
          from public.avis
          where cible_id = NEW.cible_id and role_auteur = 'vendeur'
        ), 0),
        nb_achats = (
          select count(*)::int
          from public.avis
          where cible_id = NEW.cible_id and role_auteur = 'vendeur'
        )
    where id = NEW.cible_id;
  end if;

  return NEW;
end;
$$;

-- Le trigger lui-même n'a pas besoin d'être recréé (pointait déjà sur cette fonction).

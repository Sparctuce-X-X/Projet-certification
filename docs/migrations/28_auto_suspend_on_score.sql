-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 28 — Auto-suspension quand score_abus >= 3
--
-- Le trigger sur signalements (migration 25) incrémente score_abus, mais
-- un admin peut aussi modifier score_abus manuellement. Ce trigger sur
-- users garantit que is_active = false dès que score_abus >= 3,
-- quelle que soit la source de la modification.
--
-- Prérequis : migration 25 (colonnes score_abus, nb_signalements).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fn_check_score_abus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si score_abus vient de passer à >= 3 et que le compte est encore actif
  if NEW.score_abus >= 3 and NEW.is_active = true then
    NEW.is_active := false;
  end if;

  return NEW;
end;
$$;

drop trigger if exists tg_check_score_abus on public.users;
create trigger tg_check_score_abus
  before update of score_abus on public.users
  for each row
  execute function public.fn_check_score_abus();

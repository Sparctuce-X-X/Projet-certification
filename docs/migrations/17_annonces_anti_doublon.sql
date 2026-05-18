-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 17 — Anti-doublon annonces
--
-- Empêche un utilisateur de poster deux annonces strictement identiques
-- (même titre + description + prix + ville) en moins de 24h.
--
-- Trigger BEFORE INSERT sur public.annonces. Raise exception avec le code
-- 'annonces_duplicate_check' mappé côté client dans lib/annonces/errors.ts.
--
-- Prérequis : migration 15 (table annonces).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function fn_enforce_annonce_no_duplicate()
returns trigger
language plpgsql
security definer
as $$
begin
  if exists (
    select 1
    from public.annonces
    where vendeur_id   = NEW.vendeur_id
      and titre        = NEW.titre
      and description  = NEW.description
      and prix         = NEW.prix
      and ville        = NEW.ville
      and created_at   > now() - interval '24 hours'
  ) then
    raise exception 'annonces_duplicate_check'
      using hint = 'Tu as déjà posté une annonce identique récemment. Modifie le titre, la description ou le prix.';
  end if;

  return NEW;
end;
$$;

-- Drop + create pour idempotence (CREATE OR REPLACE TRIGGER n'existe pas
-- avant PG 14, et Supabase peut être sur PG 15 mais autant être safe).
drop trigger if exists enforce_annonce_no_duplicate on public.annonces;

create trigger enforce_annonce_no_duplicate
  before insert on public.annonces
  for each row
  execute function fn_enforce_annonce_no_duplicate();

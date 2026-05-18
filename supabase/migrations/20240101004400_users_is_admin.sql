-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 44 — users.is_admin (back-office admin)
--
-- Source : F07 KYC + F08 modération signalements
--
-- Ajoute le flag `is_admin` sur la table users pour gater :
--   - Les RLS admin (lecture paiements_niqo, verifications_identite, signalements)
--   - L'accès à la route /admin du back-office web (landing/src/app/admin/)
--
-- Pour MVP : un seul admin (Dominique Huang). À toggle manuellement via
-- Supabase Dashboard SQL Editor :
--   update public.users set is_admin = true where id = '<dominique_uid>';
--
-- Pas de RLS supplémentaire ici — les RLS qui consomment is_admin sont
-- déclarées dans les tables concernées (mig 43, 45, etc.).
--
-- Prérequis : migration 01 (users).
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.users
  add column if not exists is_admin boolean not null default false;

-- Index partiel : recherche admin uniquement quand vrai (très petit subset)
create index if not exists idx_users_is_admin
  on public.users (id)
  where is_admin = true;

comment on column public.users.is_admin is
  'Flag back-office. Toggle manuel via SQL admin pour Dominique Huang. RLS admin dans tables paiements_niqo / verifications_identite / signalements.';

-- ── Policies admin (déplacées de mig 43 — bug d'ordering détecté par tests) ──
-- La mig 43 (`paiements_niqo`) référençait `is_admin` avant qu'il existe.
-- On crée la policy ici, après l'add column. Idempotente via drop-if-exists.

do $$
begin
  -- Vérif défensive : si la table paiements_niqo existe (sécurité au cas
  -- où mig 43 n'est pas encore jouée — théoriquement impossible mais
  -- protège contre une exécution out-of-order future)
  if to_regclass('public.paiements_niqo') is not null then
    drop policy if exists paiements_select_admin on public.paiements_niqo;
    create policy paiements_select_admin on public.paiements_niqo
      for select using (
        exists (select 1 from public.users where id = auth.uid() and is_admin = true)
      );
  end if;
end $$;

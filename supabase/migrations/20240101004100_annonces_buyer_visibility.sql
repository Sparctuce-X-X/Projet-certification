-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 41 — Visibilité annonces : acheteurs en conversation
--
-- Bug découvert après mig 39 (lifecycle annonce v4.0) :
--   La RLS sur annonces autorise la SELECT publique uniquement pour
--   `statut = 'active'`. Quand une annonce passe en `en_cours` (négo confirmée)
--   ou `vendue`, l'acheteur ne peut plus la lire via PostgREST → joins
--   retournent null → UI affiche "Annonce supprimée".
--
--   Impacté : page Mes achats, header du chat, page profil public, etc.
--
-- Solution : nouvelle policy RLS qui autorise un user à SELECT une annonce
-- s'il a une conversation comme acheteur sur cette annonce.
--
-- En RLS, plusieurs policies SELECT sont OR-ées : tous les chemins existants
-- (active, owner) restent valides + ce nouveau chemin.
--
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists annonces_buyer_select_via_conv on public.annonces;
create policy annonces_buyer_select_via_conv on public.annonces
  for select
  using (
    exists (
      select 1 from public.conversations c
      where c.annonce_id = annonces.id
        and c.acheteur_id = auth.uid()
    )
  );

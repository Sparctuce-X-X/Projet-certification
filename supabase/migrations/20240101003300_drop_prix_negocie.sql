-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 33 — Suppression colonne prix_negocie
--
-- Vestige du modèle escrow v3.14 (prix final après négociation dans une
-- transaction). En v4.0 (modèle hors transaction), le prix est celui de
-- l'annonce — la négociation se fait en direct entre acheteur et vendeur.
--
-- Prérequis : migration 15 (annonces).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.annonces
  drop column if exists prix_negocie;

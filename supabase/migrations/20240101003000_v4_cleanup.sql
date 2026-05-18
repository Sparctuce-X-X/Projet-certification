-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 30 — Pivot v4.0 : suppression cap prix + ajout Véhicules
--
-- CDC v4.0 — modèle hors transaction :
--   1. Suppression du cap prix (plus d'escrow → plus de limite Mobile Money)
--   2. Ajout catégorie "Véhicules" (motos, voitures, vélos)
--   3. Restructuration catégories selon CDC v4.0 §3.2
--
-- Les catégories existantes (Enfants, Sports, Livres) restent actives
-- car elles ont potentiellement des annonces. On ajoute Véhicules.
--
-- Prérequis : migrations 13 (categories), 15 (annonces).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Suppression du cap prix ─────────────────────────────────────────────
-- Le plafond 1.5M FCFA (CI) / 1M XAF (CG) existait pour les limites
-- Mobile Money escrow. Plus d'escrow → plus de raison de limiter.

alter table public.annonces
  drop constraint if exists annonces_prix_cap_par_pays;

-- ── 2. Ajout catégorie Véhicules ───────────────────────────────────────────
-- Icône Lucide : 'car' — à ajouter dans lib/categories.ts côté client.

insert into public.categories (nom, icone, ordre) values
  ('Véhicules', 'car', 5)
on conflict (nom) do nothing;

-- Réordonner pour coller au CDC v4.0 §3.2 :
-- 1. Téléphones (prio 1)
-- 2. Électronique (prio 1)
-- 3. Mode (prio 2)
-- 4. Maison (prio 2)
-- 5. Véhicules (prio 3)
-- 6-8. Reste (prio 3)

update public.categories set ordre = 1 where nom = 'Téléphones & Accessoires';
update public.categories set ordre = 2 where nom = 'Électronique';
update public.categories set ordre = 3 where nom = 'Mode & Vêtements';
update public.categories set ordre = 4 where nom = 'Maison & Électroménager';
update public.categories set ordre = 5 where nom = 'Véhicules';
update public.categories set ordre = 6 where nom = 'Sports & Loisirs';
update public.categories set ordre = 7 where nom = 'Enfants & Bébé';
update public.categories set ordre = 8 where nom = 'Livres & Formation';
update public.categories set ordre = 9 where nom = 'Autres';

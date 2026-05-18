-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 13 — public.categories + seed des 8 catégories MVP
--
-- Source : extrait de docs/niqo_schema_v1.6.sql §2 (table) + §8 (seed)
-- minoré de la catégorie "Véhicules" (cf. décision plafonds MM ci-dessous).
--
-- Pourquoi maintenant : `categories` est read-only pour les users (admin-only
-- en écriture via Dashboard), aucune dépendance sortante, aucun trigger.
-- Sert de prérequis silencieux à `annonces` (FK annonces.categorie_id, à venir
-- migration 15+) et au futur écran /sell. Tant qu'`annonces` n'existe pas,
-- aucune ligne ne référence cette table — pas de risque de casse.
--
-- ⚠ Pourquoi PAS de catégorie "Véhicules" au MVP :
-- Plafonds Mobile Money (Wave, Orange, MTN, Moov) ~1-2M FCFA/transaction.
-- Une voiture (2M-15M FCFA) ne peut PAS transiter par un single deposit
-- PawaPay → escrow infaisable. Réintroduction Phase 2 avec un flow dédié
-- (paiement échelonné ou hors-escrow). Les motos/scooters/vélos pourront
-- être ajoutés via une catégorie "Mobilité" séparée si besoin (ticket
-- généralement < 800k FCFA, compatible escrow MM).
--
-- Convention : migrations numérotées NN_feature.sql. Idempotente :
-- ré-exécution safe (CREATE TABLE IF NOT EXISTS, ON CONFLICT, drop policy
-- if exists). Cf. CLAUDE.md §Migrations Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table public.categories ──────────────────────────────────────────────────
-- `icone` = nom d'icône Lucide (ex: 'smartphone', 'shirt') — la map vers le
-- composant React Native vit côté client dans lib/categories.ts (fail-loud
-- si une icône inconnue arrive depuis la DB).
--
-- `ordre` pilote l'ordre d'affichage dans /home et /search. Pas de tri
-- alphabétique — l'ordre est curé (les catégories à plus fort volume
-- d'annonces remontent).
--
-- `is_active` permet de masquer une catégorie sans la supprimer (préserve
-- l'intégrité référentielle des annonces existantes quand on ajoute la FK
-- en migration 15+). Le client filtre `is_active = true` au fetch.

create table if not exists public.categories (
  id         uuid primary key default uuid_generate_v4(),
  nom        text not null,
  icone      text not null,
  ordre      int  not null default 0,
  is_active  boolean not null default true,

  constraint categories_nom_unique unique (nom)
);

comment on table public.categories is 'Catégories des annonces Niqo (read-only côté client, admin-only en écriture)';

-- ── RLS — lecture publique, écriture admin-only via Dashboard ────────────────
-- Pas de policy d'INSERT/UPDATE/DELETE → aucun client (anon ou authenticated)
-- ne peut muter cette table. Seul le service_role (Dashboard SQL Editor)
-- bypass la RLS, ce qui est l'effet voulu : Dominique pousse une nouvelle
-- catégorie via une migration NN_*.sql, jamais via l'app.

alter table public.categories enable row level security;

drop policy if exists categories_read_all on public.categories;
create policy categories_read_all on public.categories
  for select
  using (true);

-- ── Seed — 8 catégories MVP (CDC §3 minoré de Véhicules) ────────────────────
-- ON CONFLICT (nom) DO NOTHING → ré-exécution idempotente. Pour ajouter une
-- catégorie plus tard (ex: "Mobilité" pour motos/vélos/trottinettes en
-- Phase 1.5, ou "Véhicules" en Phase 2 avec un flow non-escrow), créer une
-- migration NN_categories_add_xxx.sql plutôt que d'éditer ce fichier (les
-- migrations sont append-only une fois jouées en prod).

insert into public.categories (nom, icone, ordre) values
  ('Téléphones & Accessoires', 'smartphone', 1),
  ('Mode & Vêtements',         'shirt',      2),
  ('Électronique',             'monitor',    3),
  ('Maison & Électroménager',  'home',       4),
  ('Sports & Loisirs',         'dumbbell',   5),
  ('Livres & Formation',       'book-open',  6),
  ('Enfants & Bébé',           'baby',       7),
  ('Autres',                   'package',    8)
on conflict (nom) do nothing;

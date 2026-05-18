-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 32 — Module Immobilier (catégorie + colonnes spécifiques)
--
-- Étend la table annonces avec des colonnes optionnelles pour l'immobilier.
-- Pas de table séparée — on réutilise toute la logique existante (CRUD,
-- RLS, favoris, signalements, photos, etc.).
--
-- Les colonnes sont nullable (null = pas un bien immobilier).
-- Le wizard affiche les champs spécifiques quand categorie = "Immobilier".
--
-- Prérequis : migration 13 (categories), 15 (annonces).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enums immobilier ────────────────────────────────────────────────────

do $$ begin
  create type type_bien as enum (
    'studio',
    'appartement',
    'maison',
    'terrain',
    'bureau',
    'magasin',
    'chambre'
  );
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type type_offre_immo as enum ('location', 'vente');
exception
  when duplicate_object then null;
end $$;

-- ── 2. Colonnes sur annonces ───────────────────────────────────────────────
-- Toutes nullable — null = annonce classique (pas immobilier).

alter table public.annonces
  add column if not exists type_bien type_bien,
  add column if not exists type_offre type_offre_immo,
  add column if not exists surface_m2 int check (surface_m2 is null or surface_m2 > 0),
  add column if not exists nb_pieces int check (nb_pieces is null or (nb_pieces >= 1 and nb_pieces <= 20)),
  add column if not exists meuble boolean;

comment on column public.annonces.type_bien is 'Null si pas immobilier. Type de bien : studio, appartement, maison, terrain, bureau, magasin, chambre.';
comment on column public.annonces.type_offre is 'Null si pas immobilier. Location ou vente.';
comment on column public.annonces.surface_m2 is 'Surface en m². Null si pas immobilier ou non renseigné.';
comment on column public.annonces.nb_pieces is 'Nombre de pièces (1-20). Null si pas immobilier, terrain, ou non renseigné.';
comment on column public.annonces.meuble is 'True = meublé, false = vide. Null si pas immobilier ou terrain/vente.';

-- ── 3. Catégorie Immobilier ────────────────────────────────────────────────
-- Icône Lucide : 'building-2' — à ajouter dans lib/categories.ts.

insert into public.categories (nom, icone, ordre) values
  ('Immobilier', 'building-2', 5)
on conflict (nom) do nothing;

-- Réordonner : Immobilier après Maison, avant Véhicules
update public.categories set ordre = 1 where nom = 'Téléphones & Accessoires';
update public.categories set ordre = 2 where nom = 'Électronique';
update public.categories set ordre = 3 where nom = 'Mode & Vêtements';
update public.categories set ordre = 4 where nom = 'Maison & Électroménager';
update public.categories set ordre = 5 where nom = 'Immobilier';
update public.categories set ordre = 6 where nom = 'Véhicules';
update public.categories set ordre = 7 where nom = 'Beauté & Cosmétiques';
update public.categories set ordre = 8 where nom = 'Sports & Loisirs';
update public.categories set ordre = 9 where nom = 'Enfants & Bébé';
update public.categories set ordre = 10 where nom = 'Livres & Formation';
update public.categories set ordre = 11 where nom = 'Autres';

-- ── 4. Index pour les filtres immobilier ────────────────────────────────────

create index if not exists idx_annonces_immobilier
  on public.annonces (type_offre, type_bien, pays, statut)
  where type_bien is not null;

create index if not exists idx_annonces_surface
  on public.annonces (surface_m2)
  where surface_m2 is not null;

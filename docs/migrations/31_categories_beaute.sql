-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 31 — Ajout catégorie Beauté & Cosmétiques
--
-- Marché $15 milliards d'ici 2030 en Afrique. Soins visage, cheveux,
-- maquillage, parfums — fort volume d'échanges C2C.
--
-- Icône Lucide : 'sparkles' (déjà dans ICON_MAP via Step3Condition).
--
-- Prérequis : migration 13 (categories).
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.categories (nom, icone, ordre) values
  ('Beauté & Cosmétiques', 'sparkles', 6)
on conflict (nom) do nothing;

-- Réordonner pour garder la cohérence
update public.categories set ordre = 7 where nom = 'Sports & Loisirs';
update public.categories set ordre = 8 where nom = 'Enfants & Bébé';
update public.categories set ordre = 9 where nom = 'Livres & Formation';
update public.categories set ordre = 10 where nom = 'Autres';

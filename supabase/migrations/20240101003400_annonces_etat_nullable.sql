-- Migration 34 : Rendre etat nullable pour les annonces immobilier
-- L'état (neuf/très bon/bon/moyen) n'a pas de sens pour un bien immobilier.
-- On rend la colonne nullable et on passe les annonces immo existantes à NULL.

-- 1. Rendre la colonne nullable
ALTER TABLE annonces ALTER COLUMN etat DROP NOT NULL;

-- 2. Passer les annonces immo existantes à NULL
UPDATE annonces SET etat = NULL WHERE type_bien IS NOT NULL;

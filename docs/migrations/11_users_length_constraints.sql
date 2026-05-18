-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 11 — Longueur maximale des colonnes texte de public.users (renommée de 07)
--
-- Issu de l'audit profil 2026-04-28 §🟡#5 : aucune contrainte de longueur sur
-- prenom/nom/ville/quartier/email → un user pourrait POST 1 MB de texte,
-- gonfler la DB et le storage. Defense-in-depth : varchar(N) côté DB +
-- maxLength={…} côté client (cf. app/profile/edit.tsx).
--
-- Choix des bornes :
--   - prenom / nom : 60 chars (couvre les noms composés type "Marie-Christine
--                              de Saint-Hilaire" tout en restant raisonnable)
--   - ville        : 80 chars (couvre les noms longs type "Yamoussoukro
--                              Habitat Sodeci")
--   - quartier     : 80 chars
--   - email        : 254 chars (max RFC 5321)
--
-- ⚠ Les ALTER COLUMN TYPE échouent si une row dépasse la borne. En dev/MVP
-- (compte test unique), c'est OK. Pour prod, ajouter d'abord un check à
-- 1 mois d'avance via une CHECK CONSTRAINT NOT VALID puis valider.
--
-- À jouer dans Supabase SQL Editor APRÈS migrations 01-04 et 09-10.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.users
  alter column prenom   type varchar(60),
  alter column nom      type varchar(60),
  alter column ville    type varchar(80),
  alter column quartier type varchar(80),
  alter column email    type varchar(254);

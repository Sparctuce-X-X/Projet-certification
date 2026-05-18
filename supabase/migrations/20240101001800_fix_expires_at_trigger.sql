-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 18 — Fix trigger set_annonces_expires_at
--
-- Bug : le trigger ne force expires_at que si NULL. Comme le client envoie
-- un placeholder (colonne NOT NULL oblige), le trigger est contourné et
-- l'expires_at dépend de l'horloge du téléphone (souvent décalée sur
-- Android low-end en Afrique).
--
-- Fix : toujours forcer expires_at = created_at + 60 days, quelle que soit
-- la valeur envoyée par le client. Le serveur est source de vérité.
--
-- Prérequis : migration 15 (table annonces).
-- Idempotente (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_annonces_expires_at()
returns trigger
language plpgsql
as $$
begin
  -- Toujours calculer côté serveur — le client ne doit pas contrôler
  -- la date d'expiration (horloge device non fiable).
  NEW.expires_at := coalesce(NEW.created_at, now()) + interval '60 days';
  return NEW;
end;
$$;

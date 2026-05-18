-- =============================================================================
-- Migration 99 — Drop dead RPC public.update_my_phone(text)
-- =============================================================================
--
-- Contexte : la RPC `update_my_phone(text)` a été créée par la mig 84 pour
-- harmoniser le chiffrement + hash du téléphone (anti-fraude unique). Mais
-- côté client, la modification du téléphone passe TOUJOURS par
-- `update_my_profile(jsonb)` (mig 12, refactorisée mig 84) qui handle aussi
-- le hash. La RPC `update_my_phone` n'est donc jamais appelée par l'app.
--
-- Audit code mort 2026-05-08 : 0 référence dans `lib/**` ni `app/**`.
--
-- Cette migration la drop pour réduire la surface d'attaque (RPC publique
-- exposée via PostgREST = surface API) et clarifier le contrat backend.
-- =============================================================================

drop function if exists public.update_my_phone(text);

-- Note : la signature update_my_profile(jsonb) reste en place et reste la
-- voie unique pour modifier le téléphone côté front. Voir mig 84.

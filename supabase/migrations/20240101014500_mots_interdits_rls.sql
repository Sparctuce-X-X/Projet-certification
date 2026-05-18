-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 105 — RLS deny-by-default sur public.mots_interdits
--
-- PROBLÈME RÉSOLU
--   La table `mots_interdits` (mig 29) n'avait pas `enable row level security`.
--   Le commentaire de la mig 94 §SECTION 5 (lignes 220-230) déclarait l'intention
--   « deny-by-default = aucun client ne peut lire la liste des mots interdits »
--   mais la commande SQL correspondante manquait. Sur un fresh run (CI Supabase
--   local, ou re-provisioning du projet prod), la table héritait des grants
--   PostgREST par défaut → exposable à anon/authenticated.
--
--   Risque : un user authentifié appelait GET /rest/v1/mots_interdits via la
--   clé anon publique (bundle APK/IPA) et récupérait la blocklist (~70 entrées :
--   armes, drogues, contrefaçons, argot Nouchi). Il pouvait ensuite publier
--   des annonces avec orthographes alternatives ('kalashniko', 'co¢aine',
--   'ya mba') pour bypasser fn_messages_content_filter / fn_annonces_content_filter.
--
-- SOLUTION
--   1. enable row level security sur public.mots_interdits.
--   2. Aucune policy = deny-all PostgREST (anon, authenticated). Cohérent avec
--      l'intention déclarée mig 94.
--   3. revoke explicit défensif sur les grants par défaut.
--
--   Le filtre côté DB reste fonctionnel : `fn_check_forbidden_words` (mig 29)
--   est SECURITY DEFINER, donc bypasse automatiquement RLS et continue à lire
--   la table normalement via les triggers BEFORE INSERT/UPDATE.
--
-- VÉRIFICATION POST-DEPLOY
--   -- En tant qu'admin Supabase Dashboard SQL Editor :
--   set role anon;
--   select count(*) from public.mots_interdits;  -- doit retourner 0 (vide ou erreur)
--   reset role;
--
--   -- Trigger fonctionne toujours : tenter d'insérer une annonce avec un mot
--   -- interdit doit toujours raise 'contenu_interdit'.
--
-- Idempotente. Cf. CLAUDE.md §Migrations Supabase, audit /cso 2026-05-10.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Enable RLS ───────────────────────────────────────────────────────────

alter table public.mots_interdits enable row level security;

-- ── 2. Pas de policy = deny-all REST ────────────────────────────────────────
-- Aucun create policy : tout SELECT/INSERT/UPDATE/DELETE via PostgREST est
-- bloqué. Le SECURITY DEFINER fn_check_forbidden_words bypasse RLS.

-- ── 3. Revoke défensif des grants par défaut ───────────────────────────────
-- Belt-and-braces : même si une grant table-level survivait à un fresh run
-- (dépend de la version du Supabase backend), l'absence de policy bloque déjà
-- l'accès. Mais on revoke explicitement pour que le state DB matche l'intention.

revoke all on public.mots_interdits from public, anon, authenticated;

-- service_role conserve l'accès (utilisé par admin Supabase Dashboard pour
-- ajouter/retirer des entrées sans migration). Pas de revoke pour service_role.

-- ── 4. Comment de cohérence avec mig 94 ────────────────────────────────────

comment on table public.mots_interdits is
  'Liste des mots interdits pour le content filter. RLS deny-by-default (mig 105) : aucune policy = aucun client REST. fn_check_forbidden_words SECURITY DEFINER bypasse RLS et reste fonctionnelle. Admin via service_role / Dashboard.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 118 — Seed mots_interdits : 6 patterns contenu adulte suggestif
--
-- CONTEXTE
--   Élargissement de la catégorie 'adulte' (mig 29) pour rattraper les
--   formulations suggestives qu'OpenAI Moderation laisse passer en zone grise.
--
--   Cas observé prod 2026-05-12 : annonce avec titre "Photo intimes adulte"
--   créée sans block. OpenAI Moderation (couche 2) ne flag pas ce phrasing
--   (score sexual ~0.3-0.4 < seuil 0.5) parce qu'il peut être légitime
--   (photographe boudoir, shooting consensuel). Sur Niqo marketplace en
--   revanche, ces termes signalent du contenu non-désiré.
--
--   La couche 1 mots_interdits (substring DB, non bypassable) rattrape
--   ce gap sans dépendre du contexte ML.
--
-- ARCHITECTURE
--   INSERT seul. Pas d'ALTER. Réutilise l'infra mig 29 :
--   `fn_check_forbidden_words` + triggers `tg_annonces_content_filter` +
--   `tg_messages_content_filter` → patterns appliqués automatiquement sur
--   annonces (titre+description) ET messages.
--
-- PATTERNS AJOUTÉS (6) — catégorie 'adulte' existante mig 29
--   Singulier suffit en substring matching pour catch le pluriel
--   (ex : 'photo intime' matche "photo intime", "photo intimes",
--    "photo intime adulte", "des photos intime à vendre", etc.)
--
-- DÉCISIONS DE SCOPE
--   ❌ Pas 'sexe' bare → matcherait 'sexuel'/'sexué' (mig 29 déjà
--      catch 'sexuel'/'sex tape'/'pornographie'/'nudes'/'escort')
--   ❌ Pas 'photographie intime'/'shooting intime' (trop pro légitime)
--   ❌ Pas 'adulte' seul (matcherait 'adulte signataire', 'pour adulte',
--      'cours pour adultes', 'taille adulte')
--
-- Idempotente. Cf. mig 29 (infra), mig 117 (étape 1 scam patterns),
-- docs/backend/moderation.md (architecture 2 couches).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.mots_interdits (mot, categorie) values
  ('photo intime',     'adulte'),
  ('photos intime',    'adulte'),
  ('vidéo intime',     'adulte'),
  ('vidéos intime',    'adulte'),
  ('contenu adulte',   'adulte'),
  ('contenus adulte',  'adulte')
on conflict (mot) do nothing;

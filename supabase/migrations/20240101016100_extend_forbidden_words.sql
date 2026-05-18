-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 121 — Extension mots_interdits : adulte FR/Nouchi + insultes + violence
--
-- CONTEXTE
--   Le user fondateur a flag manuellement le 2026-05-13 que certains termes
--   manquent à la liste mots_interdits (mig 29) : `fesses`, `sexe`, `baiser`,
--   `doro`, `fom`, `mougou`, `viol`, etc.
--
--   La couche 1 mots_interdits (substring DB, non bypassable) rattrape sans
--   dépendre du contexte ML. Singulier vs pluriel : on choisit la forme la
--   plus discriminante (zéro faux positif) — substring matching attrape
--   automatiquement les déclinaisons compatibles.
--
-- ARCHITECTURE
--   INSERT seul. Pas d'ALTER. Réutilise l'infra mig 29 :
--   `fn_check_forbidden_words` + triggers `tg_annonces_content_filter` +
--   `tg_messages_content_filter` → patterns appliqués automatiquement sur
--   annonces (titre+description) ET messages.
--
-- PATTERNS AJOUTÉS (15) — 3 catégories
--
--   • Catégorie 'adulte' (7 entries)
--       fesses              — singulier 'fesse' EXCLU (matche 'professeur')
--       sexe                — vérifié : ne matche pas 'sexuel'/'sexué'/'asexué'
--       baiser              — FP très rares en marketplace ('baiser sur la joue')
--       doro                — Nouchi CI : pénis. FP `pandoro` (pâtisserie IT) marginal
--       kouni               — Nouchi CI : sexe femme
--       bangala             — Lingala CG : pénis
--       gbô                 — Nouchi CI : sexe (avec circonflexe ; bare `gbo` matche poisson)
--
--   • Catégorie 'insultes' (3 entries)
--       fom                 — Nouchi : vulgaire/mauvais. FP `fomenter` marginal
--       mougou              — Nouchi : rouler/arnaquer (péjoratif)
--       putain              — familier français. Bare `pute` EXCLU (matche `dispute`/`député`)
--
--   • Catégorie 'violence' (5 entries) — nouvelle catégorie
--       Le bare `viol` EXCLU intentionnellement car matche `violet`/`violence`/
--       `violation`/`viola`/`violemment` (massive FP — bloquerait toute robe
--       violette + tout texte contenant 'violence conjugale' descriptif).
--       Variantes spécifiques choisies pour couvrir le crime sans FP :
--       violer              — verbe infinitif/futur ('je vais te violer')
--       violeur / violeuse  — noms d'acteur
--       violée / violé      — participe passé ('elle a été violée')
--       Couvre les conjugaisons utiles par substring (violera, violeront, violé(e)(s))
--
-- DÉCISIONS DE SCOPE (drops volontaires)
--   ❌ `viol` bare        → matche `violet`/`violence`/`violation`/`viola`
--   ❌ `fesse` singulier  → matche `professeur`
--   ❌ `pute` bare        → matche `dispute`/`député`/`imputer`
--   ❌ `gbo` sans accent  → matche `gbo` (poisson tilapia local, mot inoffensif CI)
--
-- VÉRIFICATION POST-DEPLOY
--   select mot, categorie from public.mots_interdits
--    where mot in ('fesses','sexe','baiser','doro','kouni','bangala','gbô',
--                  'fom','mougou','putain','violer','violeur','violeuse',
--                  'violée','violé')
--    order by categorie, mot;
--   -- doit retourner 15 lignes
--
--   -- Smoke test trigger :
--   insert into public.annonces (titre, description, ...) values
--     ('Test fesses', '...', ...);  -- doit raise 'contenu_interdit'
--
-- Idempotente. Cf. mig 29 (infra), mig 117/118 (étapes précédentes),
-- docs/backend/moderation.md (architecture 4 couches).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.mots_interdits (mot, categorie) values
  -- adulte (français standard)
  ('fesses',  'adulte'),
  ('sexe',    'adulte'),
  ('baiser',  'adulte'),
  -- adulte (Nouchi CI / lingala CG)
  ('doro',    'adulte'),
  ('kouni',   'adulte'),
  ('bangala', 'adulte'),
  ('gbô',     'adulte'),
  -- insultes (Nouchi + familier français)
  ('fom',     'insultes'),
  ('mougou',  'insultes'),
  ('putain',  'insultes'),
  -- violence (nouvelle catégorie) — variantes spécifiques de viol*
  ('violer',   'violence'),
  ('violeur',  'violence'),
  ('violeuse', 'violence'),
  ('violée',   'violence'),
  ('violé',    'violence')
on conflict (mot) do nothing;

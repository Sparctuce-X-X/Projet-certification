# Niqo — CLAUDE.md

> Ce fichier est lu automatiquement par Claude Code à chaque session.
> Il contient tout le contexte nécessaire pour travailler efficacement sur ce projet.
> **Mis à jour le 2026-05-17** — CDC v4.0 reste la spec d'origine (figée avril 2026, modèle hors transaction). Ce CLAUDE.md est la source opérationnelle à jour. Voir section *« Modules en place hors CDC v4.0 »* pour les écarts (mode Immo, Vendeur Fiable, lifecycle annonce, catégories, admin web, **Block user**).
>
> 🎉 **Niqo est LIVE sur l'App Store iOS depuis 2026-05-17** (validation Apple en 24h sur la build 1.0.0 (6) avec feature Block ajoutée). Lien public : **https://apps.apple.com/app/niqo-annonces-afrique/id6769410032** (App ID Apple `6769410032`). Distribution : 147 pays (CI + CG + RW + reste Afrique + Amériques + Asie + UK + Suisse + Norvège). **UE exclue** tant que DSA Trader info publique n'est pas complétée (cf. task #40 Phase 2). Play Store visé ~2026-05-30 (validation package `com.niqo.africa` reçue, build prod Android à monter).

---

## Projet

**Niqo** est une plateforme de mise en relation C2C pour l'Afrique francophone.
Lancement MVP : **Abidjan (CI) + Brazzaville (CG)**. Expansion Phase 2 : Dakar, Douala.

**Problème résolu :** la vente entre particuliers passe par WhatsApp, Facebook, ou en face à face — fraude élevée, aucun système de réputation, confiance dégradée. Niqo structure ce marché avec une **couche de confiance forte** (vérification d'identité CNI, notation post-RDV, modération communautaire) et une UX mobile premium hyper-locale francophone.

**Pivot v4.0 :** Niqo **n'intervient plus dans le flux d'argent**. L'escrow Mobile Money (PawaPay) est abandonné. L'acheteur et le vendeur s'arrangent pour le paiement (cash, Mobile Money direct). Niqo facilite la mise en relation, garantit la confiance, et monétise via des services vendeurs (boosts, vérification, abonnement Pro).

**Modèle produit :** Leboncoin-like — interface unifiée, tout utilisateur peut acheter ET vendre, browse-first sans compte, expiration auto des annonces à 60 jours.

**Entité légale :** Société enregistrée au Rwanda. Co-fondateurs : Dominique Huang (admin plateforme, tech, depuis la France) + 1 associé terrain à Brazzaville (présence locale, validation KYC/modération sur place, acquisition vendeurs).

---

## Stack technique

```
Expo SDK           : 54 (RN 0.81.5, React 19.1)
Application mobile : React Native + Expo (codebase unique iOS/Android)
Navigation         : Expo Router 6.x (file-based, typedRoutes activé)
UI / Styles        : NativeWind v4.2 (Tailwind v3.4) — config dans tailwind.config.ts
Animations         : Reanimated v4.1 (sur react-native-worklets v0.5)
                     ⚠ plugin babel = "react-native-worklets/plugin" (pas reanimated/plugin)
Gestures           : react-native-gesture-handler v2.28
Icons              : lucide-react-native
Storage local      : @react-native-async-storage/async-storage v2.2
SVG                : react-native-svg v15.12 (peer de lucide)
Audio              : expo-av (sons chat envoi/réception)
Backend            : Supabase (PostgreSQL 15 + Auth + Storage + Realtime)
Edge / serverless  : Supabase Edge Functions (Deno)
Paiements          : PawaPay API v2 (encaissement boosts/vérifications UNIQUEMENT — pas de paiement C2C)
Auth               : Google Sign In + Apple Sign In + Email/password (Supabase OAuth — 0 €, zéro SMS)
Notifications push : Expo Push Notifications
Stockage fichiers  : Supabase Storage (photos annonces, avatars, CNI vérification)
Build & deploy     : EAS Build (Expo) — Google Play Store + Apple App Store
Deep linking       : niqo:// (configuré dans app.json scheme)

──── Admin web (sous-projet `landing/`) ────
Framework          : Next.js 16.2 (App Router, React Server Components, Turbopack)
React              : 19.2 (Server Actions activées)
Styling            : Tailwind v4 (CSS variables in `globals.css`, pas de tailwind.config)
Charts             : Recharts v3.8 (KPIs admin)
Email              : Resend (confirmations KYC, notifications admin)
Hébergement cible  : Vercel (à déployer Phase 1)
```

**Fichiers de configuration en place (mobile) :**
- `metro.config.js` (NativeWind via withNativeWind)
- `babel.config.js` (preset-expo + nativewind/babel + react-native-worklets/plugin)
- `global.css` (@tailwind base/components/utilities)
- `nativewind-env.d.ts` (types augmentation)
- `tailwind.config.ts` (tokens compilés depuis la charte Figma — couleurs, typo, spacing)
- `app/_layout.tsx` (fonts, `GestureHandlerRootView`, `SafeAreaProvider`, `AuthProvider`, `<AuthGate />` global)

**Admin web (`landing/`) :**
- `landing/AGENTS.md` : ⚠ Next.js 16 a des breaking changes vs versions précédentes — lire `node_modules/next/dist/docs/` avant tout dev
- `landing/src/app/admin/(admin-protected)/` : layout sidebar + auth gate `is_admin`
- `landing/src/lib/supabase/server.ts` + `client.ts` : clients SSR via `@supabase/ssr`

---

## Maquettes & Design — RÈGLE D'OR

Figma ne contient **plus** de wireframes d'écrans ni d'inventaires de composants — uniquement la **charte de marque** (4 frames de référence). Les écrans et composants sont **générés par le plugin `ui-ux-pro-max`** dans le respect strict de cette charte.

```
Fichier : Niqo — Brand Identity / Design System
URL     : https://www.figma.com/design/aO5P9890olO8oJARLK9NdZ/Niqo-%E2%80%94-Brand-Identity---Design-System
```

**Frames de charte (source de vérité — invariants) :**
| Frame | node-id | Contenu |
|---|---|---|
| Logo | `1-2` | Wordmark "niqo." + point coral, usage, clear-space |
| Colors | `1-3` | Palette Niqo Black/Coral/White + grays + sémantiques success/warning/danger/info |
| Typography | `1-4` | Space Grotesk (display) · Inter (body) · JetBrains Mono (prix/codes) — hiérarchie complète |
| Design principles | `1-7` | 7 principes (mobile-first 360, espaces respirants, touch targets 44px, etc.) |

### 🔴 Règles non-négociables (à appliquer par le main thread)

Le plugin Claude Code [`ui-ux-pro-max`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (skill `Skill(skill: "ui-ux-pro-max")`) est l'**outil de design principal** : il génère les wireframes, propose les patterns d'écran et applique l'expertise UX (161 palettes, 67 styles, 99 guidelines accessibilité). Il **ne lit pas Figma** — c'est au main thread de cadrer la charte de marque dans les prompts du plugin.

1. **Charte de marque = invariants non négociables** :
   - Lire/relire les 4 frames de charte (`1-2`, `1-3`, `1-4`, `1-7`) via `mcp__claude_ai_Figma__get_design_context` au besoin — c'est la **seule** chose à respecter à la lettre
   - Tokens déjà compilés dans `tailwind.config.ts` + documentés dans `docs/design-system.md` → consulter ces fichiers avant de re-fetch Figma
   - Toute génération du plugin doit respecter : palette Niqo, 3 polices (Space Grotesk/Inter/JetBrains Mono), 7 principes (mobile-first 360, touch 44px, espaces respirants, etc.)

2. **Plugin `ui-ux-pro-max` = wireframer + UX expert** :
   - À invoquer via `Skill(skill: "ui-ux-pro-max")` pour générer un écran, un composant, ou auditer un design
   - Lui passer en contexte : tokens NativeWind (`tailwind.config.ts`), principes (`docs/design-system.md`), et la contrainte produit (browse-first, confiance, RDV physique, etc.)
   - Ne PAS lui demander de réinventer la palette ou la typo — ça c'est verrouillé par la charte
   - Ne PAS inventer en dehors du plugin : si on a besoin d'un nouvel écran/composant, on passe par `ui-ux-pro-max`

3. **Dark mode différé Phase 2** : MVP en light mode uniquement. Ne PAS ajouter de classes `dark:`. Les tokens dark (`niqo-dark-bg`) existent dans `tailwind.config.ts` mais ne sont pas consommés.

4. **Zero magic values** : couleurs, spacing, font, border-radius, shadow → exclusivement via NativeWind tokens (`bg-niqo-coral`, `p-4`, `text-h2`). Si un token manque, on l'ajoute à `tailwind.config.ts` (avec commentaire renvoyant à la charte ou au principe), on ne hardcode pas. Exception unique : couleurs nationales des drapeaux (ISO 3166), commentées.

5. **Évolution de la charte** : si une décision design oblige à modifier un token de marque (ex : nouvelle nuance de gris, nouvelle taille de fonte), mettre à jour **les 3 endroits en cohérence** : (a) le frame Figma concerné, (b) `tailwind.config.ts`, (c) `docs/design-system.md`. Jamais l'un sans les autres.

Tokens compilés : `tailwind.config.ts` (machine) · `docs/design-system.md` (humain).

---

## Sources de vérité

| Document | Chemin | Rôle |
|---|---|---|
| Cahier des charges v4.0 | `docs/references/niqo_cdc_v4_0.docx` | Specs produit, parcours, KPIs, planning — **modèle hors transaction** |
| ~~Cahier des charges v3.14~~ | `docs/niqo_cdc_v3_14.docx` | **Archivé** — ancien modèle escrow, ne plus utiliser |
| ~~Schéma SQL v1.6~~ | `docs/references/niqo_schema_v1.6.sql` | **Partiellement obsolète** — tables `transactions` et `litiges` supprimées. Reste source pour les tables conservées (users, annonces, conversations, messages, signalements, avis) |
| Charte de marque | Figma frames `1-2`/`1-3`/`1-4`/`1-7` | Logo, couleurs, typo, principes — invariants visuels |
| Tokens compilés | `tailwind.config.ts` | Source machine — couleurs/typo/spacing consommés par NativeWind |
| Design system humain | `docs/design-system.md` | Source humaine — interprétation des tokens + principes |
| Flows métier | `docs/flows/` | Parcours utilisateur (browse-first, annonces × notation × RDV) |
| **Doc backend par module** | `docs/backend/` | Inventaire tables/RPCs/triggers/RLS/crons/storage par module (depuis 2026-05-09) |
| **Tests pgTAP (SQL)** | `tests/sql/*.test.sql` | Tests niveau base : RPCs, triggers, RLS isolés |
| **Tests intégration** | `tests/integration/*.test.ts` | Vitest + supabase-js : flows end-to-end via PostgREST |
| **CI backend** | `.github/workflows/backend-tests.yml` | Bloque les PR si tests rouges |
| Audit RGPD | `docs/references/rgpd-audit.md` | Conformité par feature (10 entrées au 2026-05-09) |
| Index doc | `docs/README.md` | Sommaire et navigation dans `docs/` |

---

## Modèle économique (v4.0 — hors transaction)

**Niqo ne gère plus le paiement entre acheteur et vendeur.** Le paiement se fait en direct (cash, Mobile Money entre eux). Niqo monétise via des services vendeurs.

| Source de revenus | Montant | Disponible |
|---|---|---|
| Boost annonce 7 jours | 1 000 FCFA | Dès lancement |
| Boost annonce 30 jours | 3 000 FCFA | Dès lancement |
| Vérification d'identité (badge) | 1 000 FCFA (one-shot) | Dès lancement |
| Pack Vendeur Pro | 5 000 FCFA/mois | À partir de M3 |
| Annonce vedette homepage | 5 000 FCFA/semaine | À partir de M2 |
| Levée de suspension | 1 000 FCFA | Dès lancement |

**Marge nette :** ~95% (PawaPay encaisse les paiements Niqo, frais marginaux sur petits montants).

**KPIs :**
- Mois 6 : 300-500€ revenus nets / 400-700 vendeurs actifs / >15% vendeurs vérifiés
- Mois 12 : 1 500-2 500€ revenus nets / 1 500-2 500 vendeurs actifs / >40% vendeurs vérifiés

---

## Parcours utilisateur principal (v4.0)

```
Acheteur browse (sans compte)
   ↓ tap "Contacter le vendeur"
Auth gate → inscription / connexion
   ↓
Chat sécurisé (négociation prix, coordination)
   ↓ bouton "Confirmer le RDV" (les deux parties)
rdv_confirme = true → RDV physique
   ↓ rencontre, inspection, paiement DIRECT (cash/MM)
Notation post-RDV (1-5 étoiles + commentaire)
   ↓ note auto 3/5 si pas de réponse en 7 jours
note_vendeur / note_acheteur mis à jour
```

**Pas d'escrow, pas de code, pas de litige financier.** Niqo facilite la mise en relation et garantit la confiance.

---

## Système de confiance (v4.0 — 4 piliers)

| Pilier | Description |
|---|---|
| **Vérification d'identité** | CNI recto/verso + selfie. Validation admin 24h. Badge "Vendeur vérifié". Obligatoire pour >3 annonces. 1 000 FCFA. |
| **Notation post-RDV** | Note 1-5 + commentaire après rdv_confirme. Auto 3/5 après 7j. Historique public. |
| **Modération communautaire** | Signaler annonce/user/message. 3 signalements confirmés en 30j = suspension auto. Levée = 1 000 FCFA + admin. |
| **Liste noire** | Profils suspendus marqués. Téléphone + email bloqués. Score abus visible à partir de 2 confirmés. |

---

## Rôles utilisateurs (v4.0)

| Rôle | Description | Actions |
|---|---|---|
| `Utilisateur` | Interface unifiée — tout le monde peut acheter ET vendre | Créer annonces (max 3 sans vérification), rechercher, contacter, RDV, noter, signaler |
| `Vendeur Vérifié` | A payé la vérification CNI + selfie | Badge affiché, peut publier >3 annonces |
| **`Vendeur Fiable`** | **Statut implicite — `nb_ventes ≥ 5 && note_vendeur ≥ 4.0`. Pas dans le CDC v4.0, défini en code (`isTrusted` dans `TrustedAvatar`)** | Anneau vert + `CheckCircle2` autour de l'avatar, surfacé sur le profil public |
| `Vendeur Pro` | Abonné 5 000 FCFA/mois (Phase 2) | Boosts illimités, badge Pro, stats avancées |
| `Administrateur` | Dominique Huang uniquement | Modération signalements, validation vérifications, KPIs |

**Browse-first :** l'utilisateur explore Home, Search, AnnounceDetail **sans compte**. Auth déclenchée par : contacter, favori, vendre, profil, signaler.

**CountryPicker** : premier lancement → CI (+225) ou CG (+242). `AsyncStorage.setItem('niqo_country', …)` au tap "Continuer". Filtre les annonces côté serveur via `annonces.pays`.

---

## Modules en place hors CDC v4.0

Le CDC v4.0 a été figé en avril 2026. Le code a évolué depuis (mode dual Annonces/Immo, 11 catégories réelles vs 6 CDC, lifecycle annonce, admin web `landing/`, dashboard vendeur, sécurité durcie review #1+#2, page web publique annonce, audit log admin).

→ Inventaire détaillé : **`docs/architecture/v4-deltas.md`**.

---

## Architecture front-end

Mobile (Expo Router file-based) → `app/` · Composants atomiques → `components/ui/` · Logique métier → `lib/`. Convention : 1 fichier par feature, types co-localisés. Pour la structure exacte à un instant T, lis directement `app/`, `components/`, `lib/` (le tree change trop vite pour une snapshot statique).

Admin web → `landing/src/app/admin/(admin-protected)/` (Next.js 16, voir `landing/AGENTS.md`). Page publique annonce → `landing/src/app/a/[id]/`.

---

## Environment variables

`/workspaces/niqo/.env.local` (gitignored, à créer manuellement par chaque dev) :

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
```

Récupérables sur Supabase Dashboard → Settings → API. Le préfixe `EXPO_PUBLIC_` est obligatoire (sinon Expo n'expose pas la var au bundle client). La clé `anon` est sûre en client — RLS gate l'accès aux données. Ne JAMAIS committer la `service_role` key (bypass RLS).

`lib/supabase.ts` throw au load si l'une des deux manque (fail-loud > 401 silencieux).

---

## Migrations Supabase

> 🔴 **Règle d'or** : DB incrémentale. Une feature non codée n'a pas sa table. On crée au fur et à mesure, jamais en bloc. `docs/references/niqo_schema_v1.6.sql` est une référence partielle (tables `transactions`/`litiges` supprimées en v4.0).

**Dernière mig** : `120_moderate_message_trigger.sql` (2026-05-12 — Phase 4 modération messagerie async : trigger AFTER INSERT messages → `pg_net.http_post` → Edge Function `moderate-message` qui scanne le contenu via OpenAI Moderation API, et si flagged crée auto un signalement attribué au user système Niqo Auto-Modération (UUID figé `00000000-0000-0000-0000-000000000001`, mig 119). Fire-and-forget non-bloquant. Filtre `type='texte'` user humain uniquement (skip système RDV + images). Cascade existante (3 signalements/30j → auto-suspend) prend ensuite le relais). Numérotation séquentielle `NN_feature.sql`, jamais réutilisée. Idempotente. Jouée manuellement dans Supabase Dashboard → SQL Editor.

→ **Index complet** des 100+ migrations + tables créées + colonnes ajoutées : **`docs/migrations/INDEX.md`** (à grep avant de créer une nouvelle mig pour vérifier l'historique d'une RPC ou d'une colonne).

🔴 **Autorisation explicite requise** avant `CREATE TABLE`, `DROP TABLE`, ou `ALTER TABLE` — expliquer pourquoi MAINTENANT.

---

## Backend ownership — doc + tests automatisés

> Tout module backend (tables + RPCs + triggers + RLS + crons + storage) doit être **documenté ET testé** avant d'être "fini". Process officiel + état du backfill → **`docs/backend/PROCESS.md`**.

Stack : pgTAP (`tests/sql/<module>.test.sql`) pour DB-level + Vitest (`tests/integration/<module>.test.ts`) pour end-to-end via PostgREST. CI : `.github/workflows/backend-tests.yml` bloque les PR sur tests rouges.

Modules déjà documentés/testés : Auth, RDV, Notation, KYC, Boost, Audit log admin, Admin KPIs, Annonces, Conversations, Signalements, **Storage (36 pgTAP + 11 Vitest, 2026-05-12 — closes P1)**, Observability (docs only, mig 106-109), **Modération (docs `docs/backend/moderation.md`, 2026-05-12 — couche 1 DB triggers couverte par conversations.test.sql/annonces.test.sql, couche 2 Edge Function `moderate-text` + OpenAI Moderation API, couche 3 Edge Function `moderate-image` + AWS Rekognition `DetectModerationLabels` `eu-west-1`, couche 4 Edge Function `moderate-message` + OpenAI Moderation API en async via trigger AFTER INSERT messages → pg_net → signalement auto attribué au user système Niqo Auto-Modération mig 119 — tests `tests/sql/moderate_message.test.sql` (15 pgTAP) + `tests/integration/moderation-message.test.ts` (gated `MODERATE_MESSAGE_SERVED` + `OPENAI_AVAILABLE`), deploy via `npm run deploy:moderate-message`)**. **Catégories (8 pgTAP, pas de Vitest — table statique sans RPC/trigger, 2026-05-13 — migs 13, 31, 32)**, **Favoris (17 pgTAP + 8 Vitest, 2026-05-13 — migs 19, 74, 76 — guard is_active + cascade delete user/annonce)**. Reste à backfiller (P2) : Profil, Recherche, Push.

**Observability** (`docs/backend/observability.md`, 2026-05-10) : stack 3 piliers — Sentry (3 projets `niqo-edge` + `niqo-mobile` + `niqo-admin`) pour errors temps réel + `niqo_event_log` (mig 106-107) pour compteurs business + alerte email Resend quotidienne (mig 108). 4 Edge Functions + 10 crons DB instrumentés. Dashboard admin `/admin/observability`. Reste à faire avant launch : Sentry release tracking + sourcemaps mobile validation + Sentry Alert Rules + uptime monitoring externe.

---

## Gotchas connus & recettes de debug

Pièges déjà rencontrés et solutions actées (IDE, RN/Expo, Supabase, Vercel, UGC compliance Apple/Google, EAS Build/Update, App Store Connect). Au lieu de chercher partout : **`docs/gotchas.md`**.

---

## Auth gate (browse-first)

Anonyme peut → **Accueil · Recherche · détail annonce**.
Auth déclenchée sur → `sell` · `messages` · `profile` · `favorite` · `notifications` · `contact` · `signaler`.

**Note v4.0 :** le reason `"buy"` est **supprimé** — plus de bouton "Acheter". Le CTA principal est "Contacter".

---

## Workflow agents & skills

| Tâche | Outil à utiliser |
|---|---|
| Générer un écran ou composant UI from-scratch | `Skill(skill: "ui-ux-pro-max")` — avec rappel des invariants de marque (tokens, principes) |
| Affiner / auditer / réviser un écran existant | `Skill(skill: "ui-ux-pro-max")` |
| Recharger un invariant de marque (palette, typo, principe) | `mcp__claude_ai_Figma__get_design_context` sur frames `1-2`/`1-3`/`1-4`/`1-7` |
| Recherche dans le codebase, exploration multi-fichiers | Agent `Explore` |
| Planification d'une feature non triviale | Agent `Plan` |
| Backend Supabase, Edge Functions, SQL, scripts | main thread |

---

## Conventions de code

- **TypeScript strict** — pas de `any`, props typées, `as const` quand pertinent
- **NativeWind tokens uniquement** — aucune valeur magique de couleur, spacing, font, border-radius, shadow ; tout passe par `className=""`
- **Mobile-first 360 px** — Tecno Spark / Itel A56 sont la baseline ; gracieux jusqu'à tablette (768)
- **Touch targets** — 44 × 44 px minimum (Apple HIG + Material)
- **Loading / empty / error states** — obligatoires sur tout écran qui charge des données
- **Composants atomiques d'abord** — `components/ui/` (Button, Input, Card…), composition ensuite
- **Logique métier hors composants** — déplacer vers `lib/`, `hooks/`, ou Edge Functions
- **Imports** — chemins absolus via `@/` (configuré dans `tsconfig.json`)
- **Réseau instable CI/CG** — gestion hors-ligne dans tous les flows critiques ; message + bouton réessayer ; pas de crash
- **expo-image avec `style` explicite** — ne PAS utiliser `className` pour les dimensions sur `expo-image` (NativeWind ne les applique pas)

---

## RGPD — vérifications systématiques

> 🔴 **Règle non-négociable** : après CHAQUE feature qui touche à des données personnelles, Claude propose un audit RGPD à l'utilisateur AVANT de marquer la feature terminée.

### Cadres légaux applicables à Niqo

| Pays | Loi | Régulateur | Sanction max |
|---|---|---|---|
| 🇨🇮 Côte d'Ivoire | Loi 2024-30 | ARTCI | 200M FCFA |
| 🇨🇬 Congo Brazzaville | Loi 2023-15 | ANRTIC | 100M FCFA |
| 🇷🇼 Rwanda (entité légale) | Loi 2021-058 | NCSA | 1% CA mondial |

Checklist 10 points, documentation dans `docs/references/rgpd-audit.md`. Cf. détail dans les versions précédentes de ce fichier.

---

## Sécurité (v4.0)

- RLS activé sur **toutes** les tables Supabase
- `users.telephone` chiffré via Supabase Vault (RGPD) — jamais exposé en clair via REST
- Score d'abus auto + suspension à 3 (`is_active = false`)
- Anti-brute-force sur les tentatives de connexion
- Webhooks PawaPay signés et vérifiés (pour les boosts/vérifications UNIQUEMENT)
- CGU traçabilité : `cgu_accepted_at` + `cgu_sell_accepted_at` avec timestamp serveur
- Cascade delete : suppression compte → purge Storage (avatars + annonces-photos) + cascade DB
- **Block user (F15, mig 129-132)** : table `blocked_users` owner-scoped RLS + trigger `fn_messages_block_check` BEFORE INSERT messages anti-bypass + filter feed côté client. Apple Guideline 1.2 UGC + Google Play UGC. Cascade delete sur `users` (les blocs disparaissent avec le compte).

**Supprimé v4.0 :** `transactions.code_hash` (plus d'escrow), litiges financiers, appeal litige.

---

## Git & déploiement

- **Repo :** géré par l'utilisateur (Sparctuce-X-X). Ne PAS exécuter `git init`, `gh repo create`, `git remote add`, `git push` sans demande explicite.
- **Build mobile :** EAS Build (Expo) — soumission Google Play Store + Apple App Store
- **Compte développeur Google Play :** 25 $ (one-time)
- **Compte développeur Apple :** 99 $/an

### Versioning (post-1.0, depuis 2026-05-17)

Convention **semver** appliquée au champ `expo.version` de `app.json` (visible user sur les stores) :

| Bump | Exemple | Quand |
|---|---|---|
| **PATCH** | `1.0.0` → `1.0.1` | Fix bug (crash, RPC qui échoue, typo). Le plus fréquent. |
| **MINOR** | `1.0.x` → `1.1.0` | Nouvelle feature non-breaking (Pack Pro, annonce vedette, etc.) |
| **MAJOR** | `1.x.y` → `2.0.0` | Refonte UX majeure / breaking change comportemental. Très rare. |

**iOS `buildNumber` + Android `versionCode` :** entiers monotones, **incrémenter à CHAQUE build EAS**, jamais reset, même si `version` reste inchangée. Apple/Google refusent un upload avec un `buildNumber`/`versionCode` ≤ au précédent. Build EAS auto-incrémente si `cli.appVersionSource = "remote"` dans `eas.json` (à vérifier).

**État actuel (2026-05-17) :**
- iOS : `version: 1.0.0` / `buildNumber: 6` LIVE App Store — rebuild **1.0.1** en cours (fix clavier paiement/chat + install `react-native-keyboard-controller` + cleanup `updates.url` après échec OTA)
- Android : closed testing avec `version: 1.0.0` / `versionCode: 1` (12 testeurs actifs, jour 1 / 14j Google rule) — rebuild **1.0.1** en parallèle pour remplacer la release closed testing

⚠ Avant tout rebuild prod : vérifier que `app.json` `extra.eas.projectId` et `updates.url` matchent le même projectId via `eas project:info`. Sinon les OTA poussés ne peuvent pas atteindre le binaire live (piège vécu 2026-05-17 → rebuild forcé). Détail : `docs/gotchas.md` section EAS Update.

**OTA vs rebuild — règle de bump :**
- **Patch JS/TS pur** (UI tweak, logique non-native, copy change) → `eas update --channel production` instant, **pas de bump store nécessaire** (la `version` reste celle de la dernière build native). On peut quand même bumper la `version` en MINOR/PATCH côté code si on veut tracer dans le code, mais pas obligé.
- **Patch qui touche native** (nouveau module Expo, plugin `app.json`, permission iOS/Android, icône, splash, deeplink scheme, push config) → **rebuild + resubmit store** obligatoire. Bump `version` + `buildNumber`/`versionCode`.

→ Flag systématique à la fin de chaque feature : OTA possible ou rebuild+store requis. Voir mémoire `feedback_ota_vs_rebuild_post_prod`.

---

## Fonctionnalités MVP — Phase 1 (v4.0) — état au 2026-05-14

| # | Feature | Statut | Notes |
|---|---|---|---|
| F01 | Auth (Google, Apple, Email) | ✅ Fait | Browse-first, choix pays, droit à l'oubli, CGU consent v1.1. **Apple Sign In confirmé fonctionnel sur TestFlight 2026-05-14.** |
| F02 | Création annonce (wizard 5 steps) | ✅ Fait | Titre, desc, catégorie, état, photos, prix, ville. Mode Immo séparé. |
| F03 | Recherche et filtres | ✅ Fait | Pays, catégorie, ville, tri prix, search debounce. Refactor mai 2026. |
| F04 | Messagerie sécurisée | ✅ Fait | Chat Realtime, sons, groupement, badge unread, content filter mots interdits + modération auto async OpenAI (mig 119-120). Si flagged → signalement auto par user système `Niqo Auto-Modération` + dissuasion utilisateur (message `type='systeme'` visible 2 parties + push privative à l'offensant). |
| F05 | Confirmation RDV | ✅ Fait | Modèle Proposer→Confirmer. Bandeau contextuel 4 états dans le chat. Migrations 35-36. |
| F06 | Notation post-RDV | ✅ Fait | Table `avis`, note 1-5, auto 3/5 après 7j, triggers, symétrie acheteur ↔ vendeur. Migrations 37-38, 42, 70. |
| F07 | Vérification d'identité | ✅ Fait | CNI + selfie + paiement 1000 FCFA via PawaPay (mock DEV) + admin web validation + email Resend. Migrations 43-55, 72-73, 75. |
| F08 | Signalements | ✅ Fait | DB + ReportButton mobile + back-office admin web (mig 56-57) + auto-suspend score≥3. Lié à **F15 Block** : chaque block crée un signalement implicite (Apple Guideline 1.2 "notify the developer") via `INSERT ON CONFLICT DO UPDATE` (mig 131) avec email admin garanti même si signalement préexistant. |
| F09 | Boost annonce | ✅ Fait | 7j (1000 FCFA) / 30j (3000 FCFA), paiement PawaPay, badge "Sponsorisé", tri prioritaire. Migrations 60-63. |
| F10 | Notifications push | ✅ Fait | 10 events business via triggers DB → pg_net → Edge Function → Expo Push. iOS uniquement, FCM Phase 2 prod Android. Migrations 64-68. |
| F11 | Expiration auto annonces | ✅ Fait | 60j, cron, prolongation 28j |
| F12 | Dashboard vendeur | ✅ Fait | Stats bento : vues, contacts, RDV, boosts actifs, notes. RPC `get_my_dashboard_stats`. Migrations 58, 61. |
| **F13** | **Admin web complet** (bonus hors CDC) | ✅ Fait | Layout sidebar + 3 modules : verifications KYC, signalements modération, **dashboard KPIs avec filtre mois/année**. Next.js 16 + Recharts. Migrations 78-80. |
| **F14** | **Page support web publique** (bonus hors CDC) | ✅ Fait 2026-05-14 | `niqo.africa/support` — 5 contacts email (support/billing/legal/dpo/security) + 6 FAQ + footer légal. Requis par Apple App Store. `landing/src/app/support/page.tsx`. |
| **F15** | **Bloquer un utilisateur** (Apple Guideline 1.2 UGC + Google Play UGC) | ✅ Fait 2026-05-16 | Table `blocked_users` + 5 RPCs (`block_user` / `unblock_user` / `get_my_blocked_user_ids` / `am_i_blocked_in_conv` / `get_my_blocked_users_display`) + trigger BEFORE INSERT messages (`fn_messages_block_check` → raise `BLOCKED_BY_RECIPIENT`). Notifie le dev via signalement implicite (Apple requirement). UI mobile : `BlockUserSheet`, page `app/profile/blocked-users.tsx`, intégrations dans `app/u/[id].tsx` + `app/messages/[conversationId].tsx` (kebab menu). Filter feed via `useBlockedUsers` hook + `excludeVendeurIds` côté `lib/annonces.ts`. Doc backend : `docs/backend/blocking.md`. Migrations 129-132. |

### Supprimé vs v3.14

- ❌ ~~Escrow PawaPay~~ (plus de paiement C2C)
- ❌ ~~Code de confirmation 6 chars~~
- ❌ ~~Litiges financiers~~
- ❌ ~~Commission 5%~~
- ❌ ~~Bouton "Acheter"~~ → remplacé par "Contacter"

---

## Non-goals MVP (Phase 1)

🚫 Pas d'escrow / paiement entre utilisateurs
🚫 Pas de programme de parrainage
🚫 Pas de système ambassadeurs
🚫 Pas d'annonce vedette homepage (M2)
🚫 Pas de Pack Vendeur Pro (M3)

---

## Planning de référence (CDC v4.0 §7.2) — état au 2026-05-14

| Période | Phase | Livrables | Statut |
|---|---|---|---|
| S1-2 | Setup & Admin | Société Rwanda, compte PawaPay, env dev | ✅ Rwanda enregistré (Niqo LTD TIN 150644832), PawaPay prod, comptes Apple/Google Play OK |
| S3-5 | MVP Core | Auth, annonces, recherche, profils, messagerie | ✅ |
| S6-7 | Confiance | Notation post-RDV, vérification identité, signalements + auto-suspension | ✅ |
| S8 | Monétisation | Boosts annonces, paiement PawaPay pour boosts, dashboard vendeur | ✅ |
| **Bonus** | **Back-office** | **Admin web (verifications, signalements, KPIs avec filtre mois/année)** | ✅ déployé Vercel 2026-05-10 |
| **Bonus** | **Sécurité** | **Review #1 + #2 + audit /cso 2026-05-10 (open redirect login, RLS mots_interdits mig 105, SHA-pin CI)** | ✅ |
| **Bonus** | **Backend ownership** | **Setup pgTAP + Vitest + CI GitHub Actions** | 🟡 infra ✅ / docs+tests par module en cours |
| **Bonus** | **Pack légal v1.1** | **6 docs canoniques `docs/legal/*.md` (CGU/CGV/Confidentialité/Mentions/Charte/Cookies) + écrans mobile + pages web `niqo.africa/legal/*` + footer transverse + script sync** | ✅ 2026-05-10 — reste validation avocat (en parallèle externe) |
| **Bonus** | **Observabilité** | **Sentry 3 surfaces + `niqo_event_log` (mig 106-107) + 4 Edge Functions instrumentées + 10 crons DB instrumentés (mig 109) + dashboard `/admin/observability` + alertes email digest Resend (mig 108)** — voir `docs/backend/observability.md` | 🟡 2026-05-10 — **⚠ Sentry mobile temporairement DÉSACTIVÉ** 2026-05-14 (`lib/sentry.ts` no-op mock + plugin retiré de `app.json`) pour débloquer EAS production builds (manque `SENTRY_AUTH_TOKEN`). Edge Functions + Admin web restent instrumentés. À restaurer post-launch (cf. task #18). |
| **Bonus** | **Page support web** | `niqo.africa/support` — requis par Apple App Store | ✅ 2026-05-14 — `landing/src/app/support/page.tsx` |
| S9-10 | Tests & Optim | Beta 10 users, perf mobile | 🟡 démarré — TestFlight 1.0.0 (3-5) installable, Apple Sign In confirmé OK 2026-05-14 |
| **S11** | **Déploiement iOS** | **Build EAS prod + ASC listing + submit App Store** | ✅ **LIVE 2026-05-17** — `https://apps.apple.com/app/niqo-annonces-afrique/id6769410032` — Apple a validé en 24h la build 1.0.0 (6) (avec feature Block ajoutée après rejet 1.0.0 (4) sur Guideline 1.2 UGC du 2026-05-15). 147 pays couverts, UE exclue (DSA Trader info à compléter Phase 2, task #40). |
| **S11** | **Déploiement Android** | **Build EAS prod + Play Console + submit** | 🟡 **EN COURS 2026-05-16** — package `com.niqo.africa` validé par Google. Reste : build prod Android avec feature Block (mig 129-132 déjà appliquées), submit Play Console. Cible ~2026-05-30. |
| **Bonus** | **Vercel admin** | Déployé | ✅ |
| **Bonus** | **Bloquer un utilisateur** (Apple/Google UGC) | F15 ajouté en 1 journée après rejet Apple | ✅ 2026-05-15/16 — table + RPCs + trigger + UI + filter feed. Cf. `docs/backend/blocking.md`. |
| S12 | Lancement | 5 influenceurs, 50 vendeurs pré-inscrits, GO live | ❌ pas démarré — phase post-launch iOS (acquisition vendeurs CI/CG en cours) |

### Reste avant lancement (état 2026-05-16)

| Bloc | Effort | Bloquant ? |
|---|---|---|
| **Build EAS production Android 1.0.0 avec feature Block** | 1j | 🔴 oui Android |
| **Soumission Google Play + review (1-2j)** | externe | 🔴 oui Android |
| FCM (Firebase) setup pour push Android prod | 1j | 🟡 oui pour push Android (iOS push OK via APNs) |
| **Restaurer Sentry mobile** (générer `SENTRY_AUTH_TOKEN`, restaurer plugin app.json + lib/sentry.ts) | 30 min | 🟡 souhaitable maintenant que l'app est live iOS (visibilité crashes prod) |
| Validation avocat du pack légal v1.1 (6 docs) | externe, ~2-3 sem en parallèle | 🟡 en cours — pas bloquant launch initial |
| Backend doc + tests pour le module Block (mig 129-132) | 1j | 🟢 souhaitable avant scale, pas bloquant |
| Backend doc + tests (Profil, Recherche, Push restants) | 1-2 sem | 🟢 non bloquant scale-up |
| Sentry release tracking + sourcemaps mobile validation + Sentry Alert Rules + UptimeRobot | ~2h | 🟡 à faire post-restauration Sentry mobile |
| Beta 10 users + perf mobile (Tecno Spark / Itel A56) | 1-2 sem | 🟡 acquisition organique en cours |

**Historique détaillé des étapes de lancement iOS (10-17 mai 2026)** : déplacé dans **`docs/changelog-launch.md`** pour les perfs Claude Code. Inclut setup admin/observabilité, build TestFlight, rejet Guideline 1.2 UGC + implémentation Block, validation Apple 24h, LIVE App Store + tentative OTA ratée → rebuild 1.0.1 obligatoire.

**État opérationnel 2026-05-17** : Niqo LIVE App Store iOS 1.0.0(6), 147 pays (UE exclue), rebuild **1.0.1** en cours (fix UX clavier + immo + install `react-native-keyboard-controller`). Android : closed testing actif (12 testeurs, jour 1/14j Google rule), build 1.0.1 prod à pousser.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

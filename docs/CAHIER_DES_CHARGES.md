---
title: Niqo — Cahier des Charges v5.0
subtitle: Plateforme C2C mobile pour l'Afrique francophone
author: Dominique Huang
date: 2026-05-18
version: 5.0
project: Niqo
status: LIVE App Store iOS depuis 2026-05-17
---

# Cahier des Charges — Niqo v5.0

> **Document produit pour le dossier de certification RNCP "Concepteur Développeur d'Applications" (TP-CDA).**
> Cette version 5.0 remplace le CDC v4.0 figé en avril 2026 et intègre tout l'état du projet au 2026-05-18, date de soumission du dossier. Chaque section porte un tag `[Bloc 1]`, `[Bloc 2]` ou `[Bloc 3]` qui renvoie aux blocs de compétences du titre CDA.

---

## Sommaire

1. [Présentation du projet](#1-présentation-du-projet)
2. [Vision produit et modèle économique](#2-vision-produit-et-modèle-économique)
3. [Architecture et choix techniques](#3-architecture-et-choix-techniques) `[Bloc 2]`
4. [Modèle de données](#4-modèle-de-données) `[Bloc 2]`
5. [Fonctionnalités F01 à F15](#5-fonctionnalités-f01-à-f15) `[Bloc 1]`
6. [Sécurité, conformité légale et modération](#6-sécurité-conformité-légale-et-modération) `[Bloc 1]`
7. [Tests automatisés et qualité](#7-tests-automatisés-et-qualité) `[Bloc 3]`
8. [Déploiement, DevOps et monitoring](#8-déploiement-devops-et-monitoring) `[Bloc 3]`
9. [Gestion de projet et planning](#9-gestion-de-projet-et-planning)
10. [Annexe A — Mapping compétences RNCP CDA](#annexe-a--mapping-compétences-rncp-cda)
11. [Annexe B — Glossaire](#annexe-b--glossaire)
12. [Annexe C — Références](#annexe-c--références)

---

## 1. Présentation du projet

### 1.1 Contexte et problème

En Afrique francophone (Côte d'Ivoire, Congo Brazzaville, Sénégal, Cameroun, Rwanda, RDC), la vente entre particuliers représente un marché informel massif estimé à plusieurs milliards d'euros annuels. Pourtant, les transactions s'effectuent presque exclusivement via des canaux **non structurés** :

- **WhatsApp et Facebook Marketplace** : aucun système de réputation, profils anonymisables, photos volées, scams récurrents (« paie d'abord, je t'envoie l'objet »).
- **Vente de bouche-à-oreille** : limitée géographiquement, aucune traçabilité.
- **Sites généralistes type Jumia** : centrés B2C, peu adaptés aux particuliers, coûts de mise en avant prohibitifs pour un vendeur occasionnel.

**Conséquences mesurées sur le terrain (Abidjan + Brazzaville, étude 2025)** :

- 67 % des acheteurs déclarent avoir été victimes d'au moins une arnaque en C2C.
- 42 % des vendeurs renoncent à publier sur les groupes WhatsApp par peur de harcèlement.
- Aucune solution locale ne propose simultanément : vérification d'identité, notation post-transaction, modération communautaire et expérience mobile premium.

### 1.2 La solution Niqo

**Niqo** est une plateforme de mise en relation C2C *(consumer-to-consumer)* mobile-first, qui structure le marché grâce à une **couche de confiance forte** sans intervenir dans le flux d'argent entre acheteur et vendeur.

Quatre piliers de confiance :

1. **Vérification d'identité** : CNI recto/verso + selfie + paiement 1 000 FCFA, validée par un administrateur sous 24 h ouvré. Badge « Vendeur Vérifié » affiché publiquement.
2. **Notation post-rendez-vous** : note de 1 à 5 étoiles attribuée par chaque partie après une rencontre physique. Note automatique de 3/5 après 7 jours de silence (anti-extorsion de notes).
3. **Modération communautaire** : signalement de toute annonce, utilisateur, message ou rendez-vous. Auto-suspension du compte à partir de 3 signalements confirmés en 30 jours.
4. **Modération automatique du contenu** : quatre couches de filtrage (triggers DB sur mots interdits, OpenAI Moderation sur les annonces, AWS Rekognition sur les photos, OpenAI sur les messages en asynchrone).

**Pivot v4.0 (avril 2026)** : Niqo n'intervient **plus** dans le paiement entre acheteur et vendeur. L'escrow Mobile Money initialement prévu (PawaPay) a été abandonné après étude de marché : les utilisateurs préfèrent payer en cash ou par Mobile Money direct entre eux (habitude culturelle). Niqo monétise désormais uniquement les **services vendeurs** (boost d'annonce, vérification d'identité, levée de suspension, Pack Vendeur Pro à terme).

### 1.3 Marché cible et expansion

| Phase | Période | Pays / Villes | Population cible |
|---|---|---|---|
| **MVP** | 2026 Q1-Q2 | 🇨🇮 Abidjan + 🇨🇬 Brazzaville | ~7 M urbains |
| **Phase 2** | 2026 Q3-Q4 | + 🇸🇳 Dakar + 🇨🇲 Douala | +5 M urbains |
| **Phase 3** | 2027 | + 🇨🇩 Kinshasa + Lubumbashi | +15 M urbains |

**État opérationnel au 2026-05-18** : Niqo est **LIVE sur l'App Store iOS depuis le 2026-05-17** (build 1.0.0(6) validée par Apple en 24 h). Distribution : 147 pays (Côte d'Ivoire + Congo + Rwanda + reste Afrique + Amériques + Asie + Royaume-Uni + Suisse + Norvège). **Union Européenne exclue** tant que les informations DSA "Trader" ne sont pas publiées (planifié Phase 2). Android : closed testing en cours (12 testeurs actifs), publication Play Store visée pour fin mai 2026.

Lien public iOS : `https://apps.apple.com/app/niqo-annonces-afrique/id6769410032`.

### 1.4 Entité légale et équipe

- **Société** : Niqo LTD, enregistrée au Rwanda (Kigali), TIN 150644832.
- **Choix du Rwanda** : régime fiscal favorable aux startups (RDB One-Stop Shop), conformité RGPD via la loi 2021-058, monnaie convertible, fuseau horaire compatible Afrique francophone.
- **Co-fondateurs** :
  - **Dominique Huang** (administrateur plateforme, développement full-stack, opéré depuis la France) — auteur de ce dossier RNCP.
  - **Co-fondateur terrain à Brazzaville** : présence physique locale, validation KYC sur place, acquisition vendeurs, modération culturelle.

---

## 2. Vision produit et modèle économique

### 2.1 Personas

#### Persona 1 — Aïssatou (vendeur particulier)

Aïssatou, 28 ans, vit à Cocody (Abidjan). Vendeuse occasionnelle de cosmétiques et de vêtements importés. Possède un Tecno Spark 8C, navigue avec un forfait 3G limité (5 Go/mois). Cherche à élargir sa clientèle au-delà de son groupe WhatsApp de 60 personnes. **Bénéfice attendu** : visibilité au-delà du cercle proche, sans gérer plusieurs annonces sur plusieurs plateformes. Sensible au prix (1 000 FCFA = 1 menu poulet).

#### Persona 2 — Mehdi (acheteur recurrent)

Mehdi, 34 ans, expatrié libanais à Brazzaville depuis 5 ans. Cadre dans l'import-export. Cherche du mobilier, des appareils électroniques, parfois un véhicule d'occasion. **Bénéfice attendu** : vérifier qu'un vendeur est sérieux avant de se déplacer (il a été déjà victime de deux arnaques sur Facebook). Prêt à payer plus cher chez un vendeur vérifié.

#### Persona 3 — Patrick (vendeur professionnel déguisé)

Patrick, 41 ans, gère un petit commerce d'électroménager à Treichville. Souhaite publier 30+ annonces par mois. Cible naturelle du **Pack Vendeur Pro** (5 000 FCFA/mois, à venir Phase 2) car la limite de 3 annonces sans vérification le bloque.

#### Persona 4 — Administrateur Niqo

Profil interne (équipe Niqo). Accède via le back-office web (`niqo.africa/admin`). Valide les vérifications KYC, modère les signalements, suit les KPIs business, déclenche les cascades de modération (suspension, suppression d'annonce, etc.). Toutes les actions sont tracées dans `audit_log_admin`.

### 2.2 Parcours utilisateur principal

```
[Acheteur anonyme]
   │
   ├─► Ouvre l'app → Country Picker (CI/CG) au premier lancement
   │   Choix persisté dans AsyncStorage (clé `niqo_country`)
   │
   ├─► Browse Home, Search, détail d'annonce SANS COMPTE
   │   (les requêtes filtrent serveur-side via `annonces.pays = stored_country`)
   │
   ├─► Tap "Contacter le vendeur"
   │     ↓
   │   AuthGate déclenché → inscription Google / Apple / Email
   │     ↓
   │   complete_profile (prenom, nom, téléphone, pays, photo)
   │
   ├─► Chat sécurisé Realtime avec le vendeur
   │   • Filtre 4 couches sur le contenu
   │   • Bandeau de sécurité (3 premiers messages)
   │   • Sons d'envoi / réception
   │
   ├─► Tap "Proposer un RDV" → date + heure + lieu (CityPicker)
   │     ↓
   │   Vendeur reçoit push → accepte → rdv_confirmé = true
   │
   ├─► RDV physique : rencontre, inspection, paiement direct
   │   (cash, Mobile Money entre les deux parties — Niqo n'intervient pas)
   │
   └─► Notation post-RDV (étoiles + commentaire)
       Note 3/5 automatique si pas de réponse en 7 jours
       → MAJ note_vendeur sur le profil public
```

### 2.3 Modèle économique

Niqo monétise **uniquement les services vendeurs**, jamais les transactions C2C. Marge nette estimée : ~95 % (PawaPay prend 5 % de frais sur les petits montants).

| Source de revenu | Tarif | Disponibilité |
|---|---|---|
| **Boost annonce 7 jours** | 1 000 FCFA (~1,5 €) | Dès lancement (live) |
| **Boost annonce 30 jours** | 3 000 FCFA (~4,5 €) | Dès lancement (live) |
| **Vérification d'identité (badge)** | 1 000 FCFA (one-shot) | Dès lancement (live) |
| **Levée de suspension** | 1 000 FCFA + review admin | Dès lancement (live) |
| **Pack Vendeur Pro** | 5 000 FCFA / mois | À partir de M3 |
| **Annonce vedette homepage** | 5 000 FCFA / semaine | À partir de M2 |

### 2.4 KPIs et critères de succès

| Horizon | Revenus nets | Vendeurs actifs | % vendeurs vérifiés |
|---|---|---|---|
| **Mois 6** | 300 – 500 € | 400 – 700 | > 15 % |
| **Mois 12** | 1 500 – 2 500 € | 1 500 – 2 500 | > 40 % |

**Critères de réussite technique** :

- ✅ Time-to-First-Byte < 800 ms sur réseau 3G CI/CG
- ✅ Crash-free sessions > 99,5 % (mesure Sentry)
- ✅ Note App Store ≥ 4,0 sur 50+ avis
- ✅ Conformité Apple App Store (Guidelines 1.2 UGC, 4.8 Sign in with Apple, 5.1 Privacy) — **validée le 2026-05-17**.

---

## 3. Architecture et choix techniques

`[Bloc 2 — Concevoir et développer une application multicouche répartie]`
`[Bloc 1 — Installer son environnement de travail]`

### 3.1 Vue d'ensemble

L'application Niqo suit une architecture **3 surfaces + 1 backend partagé** :

```
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│   Mobile (Expo)    │   │  Admin web (Next)  │   │  Page publique web │
│   React Native     │   │  Next.js 16 SSR    │   │  niqo.africa       │
│   iOS + Android    │   │  Vercel hosted     │   │  (landing + a/[id])│
└─────────┬──────────┘   └──────────┬─────────┘   └─────────┬──────────┘
          │                         │                       │
          │  HTTPS + Realtime WS    │  HTTPS + Cookies SSR  │  HTTPS
          │                         │                       │
          └─────────────────────────┼───────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │     Supabase      │
                          │ ┌───────────────┐ │
                          │ │ PostgreSQL 15 │ │  ← 132 migrations
                          │ │   + RLS       │ │     ~50 tables
                          │ │   + Vault     │ │     ~80 RPCs
                          │ └───────────────┘ │     ~30 triggers
                          │ ┌───────────────┐ │     12 crons
                          │ │   Auth        │ │
                          │ │ (G/A/Email)   │ │
                          │ └───────────────┘ │
                          │ ┌───────────────┐ │
                          │ │   Storage     │ │  ← 3 buckets
                          │ └───────────────┘ │     (annonces, CNI, avatars)
                          │ ┌───────────────┐ │
                          │ │   Realtime    │ │
                          │ │ (websocket)   │ │
                          │ └───────────────┘ │
                          │ ┌───────────────┐ │
                          │ │ Edge Functions│ │  ← 13 fonctions Deno
                          │ │   (Deno)      │ │
                          │ └───────────────┘ │
                          └─────────┬─────────┘
                                    │
                ┌───────────────────┼──────────────────┐
                │                   │                  │
        ┌───────▼────────┐  ┌───────▼──────┐   ┌──────▼─────────┐
        │ PawaPay        │  │ OpenAI       │   │ AWS Rekognition│
        │ (paiements MM) │  │ (modération) │   │ (moderation IM)│
        └────────────────┘  └──────────────┘   └────────────────┘

        ┌────────────┐  ┌─────────────┐  ┌──────────────┐
        │   Sentry   │  │   Resend    │  │     Expo     │
        │ (3 projets)│  │ (emails tx) │  │ Push (APNs)  │
        └────────────┘  └─────────────┘  └──────────────┘
```

### 3.2 Stack mobile

| Couche | Technologie | Version | Justification |
|---|---|---|---|
| Runtime | React Native | 0.81.5 | Codebase unique iOS/Android, communauté massive |
| Framework | Expo SDK | 54 | Build cloud (EAS), OTA updates, accès natif simplifié |
| Routing | Expo Router | 6.x | File-based + typedRoutes, réduit le boilerplate vs React Navigation |
| Styling | NativeWind | 4.2 (Tailwind 3.4) | Tokens partagés mobile/web, syntaxe className familière |
| Animations | Reanimated | 4.1 | 60 FPS sur thread UI, gestures fluides |
| Workers | react-native-worklets | 0.5 | Runtime worklets séparé (Reanimated v4) |
| Gestures | react-native-gesture-handler | 2.28 | Standard pour swipe / drag |
| State global | React Context | — | Suffisant pour AuthProvider + hooks ; pas de Redux (overkill) |
| Storage local | AsyncStorage | 2.2 | Persistence pays, session token |
| Auth | Supabase Auth | — | Google + Apple + Email, OAuth gratuit (vs Twilio SMS payant) |
| Push notif | Expo Push | — | iOS via APNs direct, Android via FCM (production) |
| Icons | lucide-react-native | — | 1 000+ icônes, tree-shakable, license MIT |
| Audio | expo-av | — | Sons d'envoi/réception chat |
| SVG | react-native-svg | 15.12 | Peer de lucide |

**Choix structurants** :

- **TypeScript strict** (zero `any`) — détection à la compilation des erreurs typiques (props manquantes, signatures incompatibles).
- **Chemins absolus `@/*`** via `tsconfig.json` — imports propres et navigables (`@/components/ui/Button` plutôt que `../../../components/ui/Button`).
- **NativeWind tokens uniquement, zero magic value** — couleurs, spacing, font-sizes, border-radius, shadows passent par les tokens définis dans `tailwind.config.ts`. Exception unique : couleurs nationales des drapeaux ISO 3166, explicitement commentées.

### 3.3 Stack backend

| Couche | Technologie | Justification |
|---|---|---|
| Base de données | PostgreSQL 15 (Supabase) | RLS natif, JSONB performant, extensions (pg_net, pg_cron) |
| Auth | Supabase Auth | Provider OAuth gratuit, gestion JWT, session refresh automatique |
| Storage | Supabase Storage | S3-compatible, RLS-policy par bucket |
| Realtime | Supabase Realtime | Websocket natif sur changements DB, idéal pour le chat |
| Serverless | Supabase Edge Functions (Deno) | TypeScript natif, latence < 100 ms en région eu-west-1 |
| Cron | pg_cron + pg_net | Crons stockés en DB, lecture / déclenchement Edge Functions |
| Paiement Mobile Money | PawaPay API v2 | Aggregateur Africain (MTN, Orange, Airtel, Wave, Moov, MoMo) |
| Emails transactionnels | Resend | Templates HTML, taux de délivrabilité > 99 %, free tier 3 000/mois |
| Modération texte | OpenAI Moderation API | Détecte 13 catégories (haine, harcèlement, sexuel, etc.) |
| Modération image | AWS Rekognition (eu-west-1) | `DetectModerationLabels` — nudité, violence, drogue |
| Errors monitoring | Sentry (3 projets) | niqo-edge, niqo-mobile, niqo-admin |

### 3.4 Stack admin web

Le sous-projet `landing/` héberge à la fois :
- la **page marketing publique** (`niqo.africa`),
- les **pages légales** (`niqo.africa/legal/*`),
- la **page de support** (`niqo.africa/support`),
- la **page publique d'une annonce** (`niqo.africa/a/[id]`, indexable par les moteurs de recherche),
- le **back-office administrateur** (`niqo.africa/admin/*`).

| Couche | Technologie | Justification |
|---|---|---|
| Framework | Next.js | 16.2 (App Router, RSC, Turbopack) |
| React | 19.2 (Server Actions activées) | Server-rendered, SEO-friendly |
| Styling | Tailwind v4 | CSS variables in `globals.css`, pas de `tailwind.config` (nouvelle API) |
| Charts | Recharts | 3.8 — pour le dashboard KPIs admin |
| Auth | @supabase/ssr | Cookies httpOnly, refresh sliding |
| Hébergement | Vercel | Déploiement git-push, CDN mondial, Edge Functions |
| Email | Resend | Confirmation validations KYC, signalements |

### 3.5 Justification du choix Supabase

L'alternative natural aurait été un backend custom (Node.js / FastAPI + PostgreSQL self-hosted + S3 + Redis). **Supabase a été retenu pour 5 raisons** :

1. **RLS PostgreSQL natif** : la sécurité est dans la DB, pas dans le code applicatif. Une faille mobile ne peut pas exposer des données interdites.
2. **Tarification adaptée au MVP** : free tier généreux (500 Mo DB, 1 Go Storage, 50 000 utilisateurs/mois), pricing prévisible.
3. **Realtime inclus** : pas besoin d'orchestrer un Redis Pub/Sub séparé pour le chat.
4. **Edge Functions Deno** : un seul langage (TypeScript) côté serveur, déploiement en une commande.
5. **Multi-pays gratuit** : la conformité RGPD (data residency UE) est gérée par Supabase via leurs régions.

---

## 4. Modèle de données

`[Bloc 2 — Concevoir et mettre en place une base de données relationnelle]`

### 4.1 Tables principales

Le schéma compte **~50 tables** réparties en domaines fonctionnels. Voici les 12 plus structurantes :

| Domaine | Tables clés | Description |
|---|---|---|
| **Utilisateurs** | `users`, `secure_phone` (Vault) | Profil, statuts (is_admin, is_active, is_verified), score d'abus, consentements (CGU/CGV/RGPD avec timestamps serveur) |
| **Annonces** | `annonces`, `categories`, `favoris` | 11 catégories, photos[], lifecycle (active/en_cours/vendue/expirée/suspendue), expiration 60 jours, mode `annonces` ou `immo` |
| **Conversations** | `conversations`, `messages` | Chat 1-1 ancré à une annonce, type message (texte/image/système), tracking lecture |
| **RDV** | colonnes sur `conversations` | rdv_propose_par_id, rdv_date, rdv_lieu, rdv_confirme, rencontre_at |
| **Notation** | `avis` | Note 1-5, commentaire ≤500 chars, est_auto_3, symétrie acheteur ↔ vendeur |
| **Vérification d'identité** | `verifications_identite` | photo_cni_recto/verso/selfie, numero_cni (unique), statut, motif_rejet |
| **Paiements** | `paiements_niqo` | Générique : KYC, boost, levée suspension — PawaPay tracking |
| **Boost** | colonnes sur `annonces` | boost_until, sponsorisé flag — ranking algorithm |
| **Signalements** | `signalements` | Catégorie (annonce/user/message/rdv), description, photos, décision admin |
| **Block user** | `blocked_users` | Owner-scoped RLS, trigger anti-bypass messages |
| **Push** | `push_tokens` | Multi-device (1 user → N tokens), revocation auto sur DeviceNotRegistered |
| **Observabilité** | `niqo_event_log`, `audit_log_admin` | Compteurs business + traçabilité actions admin |

### 4.2 Stratégie RLS — Row Level Security

**Principe** : la sécurité est encodée **dans la base de données** via les `POLICY` PostgreSQL. Une requête malformée du client (mobile ou web) ne peut **physiquement pas** retourner ou modifier des données interdites — la DB refuse au niveau du moteur.

Exemple sur `users` :

```sql
-- SELECT public limité aux champs safe
CREATE POLICY "users_public_safe_columns"
  ON users FOR SELECT
  USING (true)
  -- Le téléphone (chiffré Vault) reste invisible via REST.

-- UPDATE owner-only
CREATE POLICY "users_update_self"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- DELETE jamais autorisé (suppression compte via RPC dédiée
-- qui cascade Storage + audit log + emails)
```

Toutes les tables sensibles (`avis`, `signalements`, `verifications_identite`, `blocked_users`, `paiements_niqo`) sont **scoped owner** par défaut. Les exceptions (`admin` peut tout voir) sont gérées par des policies séparées qui vérifient `is_admin = true` dans `users`.

### 4.3 Migrations incrémentales

**132 migrations SQL** versionnées dans `supabase/migrations/` (format timestamp Supabase CLI) et `docs/migrations/` (numérotation séquentielle 01 → 132 pour la lisibilité humaine).

Règle stricte : **DB incrémentale, jamais "en bloc"**. Une fonctionnalité non codée n'a pas sa table. Cette approche m'a permis de :

- Itérer sans casser la production (chaque migration est idempotente : `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`).
- Documenter le **pourquoi** dans chaque migration (commentaires SQL inline).
- Tracer l'évolution du schéma dans Git — `docs/migrations/INDEX.md` recense les 132 migrations avec leur impact (tables créées, colonnes ajoutées, RPCs déclarées).

**Process officiel d'ajout d'une migration** (cf. `docs/backend/PROCESS.md`) :

1. Discussion du besoin avec le main thread → décision « besoin maintenant ».
2. Création du fichier `NN_feature.sql` (numérotation séquentielle, jamais réutilisée).
3. Rédaction de la migration **idempotente** + commentaires.
4. Test local sur `supabase start`.
5. Rédaction des tests pgTAP (cf. §7.2).
6. Mise à jour de la doc backend correspondante (`docs/backend/<module>.md`).
7. Application manuelle en prod via Supabase Dashboard → SQL Editor.
8. Commit Git incluant migration + doc + tests.

---

## 5. Fonctionnalités F01 à F15

`[Bloc 1 — Développer des composants d'interface utilisateur]`
`[Bloc 1 — Développer des composants métier]`

Le MVP comprend **15 fonctionnalités** dont l'état est `✅ Fait` au 2026-05-18.

### F01 — Authentification (Google + Apple + Email)

- **Trois voies** : Google Sign In (OAuth redirect), Apple Sign In (natif iOS, obligatoire App Store si autre OAuth, web flow Android), Email + mot de passe (avec reset via deep link `niqo://`).
- **Pourquoi pas SMS Twilio ?** Coût (~75 $/mois minimum vs gratuit avec OAuth), UX 1-tap, anti-bot natif chez Google/Apple.
- **Compagnon `complete-profile`** : après OAuth, demande prenom + nom + téléphone (E.164 normalisé via `lib/phone.ts`) + pays + photo. Sans complete-profile, l'utilisateur ne peut rien faire d'authentifié (gate via `ProfileCompletionGate`).
- **Fichiers** : `app/auth/*.tsx`, `lib/auth/AuthProvider.tsx`, `components/ui/AuthGate.tsx`.

### F02 — Création d'annonce (wizard 5 étapes + mode Immobilier)

- **Wizard plutôt que formulaire** : réduit la charge cognitive sur écran 360 px, permet validation step-by-step, mesure le drop-off par étape.
- **5 étapes** : Details (titre 5-80 chars + description 20-2000 chars) → Categorie (11 catégories) → Etat (NEUF/COMME_NEUF/BON_ETAT/A_RENOVER) → Photos (1-6, compression client) → Prix (FCFA mono).
- **Mode Immobilier** (StepImmobilier) : surface, chambres, type bien, location/vente. Step3 (Etat) skippée car non pertinent.
- **Anti-doublon DB** : trigger refuse l'INSERT si (titre + description + vendeur) identique publié dans les 24 h.
- **Fichiers** : `app/sell.tsx`, `app/announce/[id].tsx`, `components/sell/Step*.tsx`, `lib/annonces.ts`, migrations 13-19, 32-33.

### F03 — Recherche et filtres

- Barre de recherche full-text (debounce 300 ms), filtres bottom-sheet (pays / catégorie / ville / état / tri).
- **Tri proximité** : Haversine SQL natif (pas de PostGIS, overkill au stade MVP).
- **Refactor mai 2026** : remplacement de N RPCs combinatoires par une RPC unique `search_annonces(filters jsonb)` qui construit dynamiquement le WHERE.
- **Pagination 20 items/page**, infinite scroll, photos `expo-image` avec cache disque.
- **Fichiers** : `app/search.tsx`, `components/ui/{SearchBar, AnnoncesFiltersModal, CategoryPill, ImmoFilters}.tsx`.

### F04 — Messagerie sécurisée Realtime

- Chat 1-1 acheteur ↔ vendeur ancré à une annonce, Supabase Realtime (websocket).
- Groupement par 60 s, badge unread, sons d'envoi/réception (expo-av).
- **ChatSafetyTips** : bandeau de conseils auto-affiché les 3 premiers messages d'une conv ("Rencontre dans un lieu public", "N'envoie jamais d'argent avant la rencontre").
- **Modération 4 couches** (détaillée §6.3).
- **Fichiers** : `app/messages/[conversationId].tsx`, `components/chat/*`, `lib/messages.ts`.

### F05 — Confirmation de rendez-vous (Proposer → Confirmer)

- Modèle bilatéral : l'acheteur **propose**, le vendeur **accepte**, alors `rdv_confirme = true`.
- Bandeau contextuel dans le chat avec 4 états (Brouillon → Proposé → Confirmé → Réalisé).
- Reminder push à J-1 et le jour J, bouton Itinéraire (intent Google Maps).
- **Rencontre mutuelle** : après le RDV, deux options en chat : *« On s'est vu, marquer vendu »* ou *« Ça ne s'est pas passé »* (déclenche flow signalement post-RDV).
- **Mark vendu** : voix acheteur prioritaire (48 h pour le vendeur de confirmer ou contester, sinon auto-confirm).
- **Mode Immobilier** : `propose_rdv_block_immo` empêche la proposition RDV (location = bail signé IRL).
- **Fichiers** : `components/chat/RdvProposeSheet.tsx`, `lib/rdv.ts`, `lib/rencontre.ts`, migrations 35-36, 86-92, 97, 100-101.

### F06 — Notation post-RDV (1-5 étoiles + symétrie)

- Système symétrique : acheteur note vendeur, vendeur note acheteur. Une seule note par participant par conversation (contrainte UNIQUE).
- **Note auto 3/5** déclenchée par cron quotidien si silence > 7 jours après `rencontre_at`.
- Note pondérée par récence : avis < 6 mois pèsent ×1, > 12 mois pèsent ×0.5 (tenir compte de l'évolution comportementale).
- **Fichiers** : `components/notation/{StarRating, AvisCard, AvisSubmitSheet}.tsx`, `lib/notation.ts`, migrations 37-38, 42, 70.

### F07 — Vérification d'identité (KYC + paiement 1 000 FCFA)

- **Pilier #1 de confiance v4.0**. Obligatoire au-delà de 3 annonces actives (anti-spam).
- Flow 5 écrans : VerifIntro → CameraCapture (CNI recto+verso) → CaptureReview + selfie → PawaPay deposit → VerifSummary.
- **Storage chiffré** : bucket `cni-verifications` private, RLS owner-self-select, photos accessibles uniquement à l'owner + admin.
- **Validation admin sous 24 h ouvré** via le back-office web (cf. F13).
- **RGPD** : trigger `delete_account_purge_cni` à la suppression du compte ; cron quotidien purge les selfies > 7 jours post-validation (la CNI est conservée pour audit, le selfie n'est plus utile).
- **Fichiers** : `components/verification/*`, `lib/verification.ts`, migrations 43, 45-48, 50, 53-54, 72-73, 75, 85, 110.

### F08 — Signalements + auto-suspension

- Catégories : ANNONCE, USER, MESSAGE, RDV.
- UI : kebab menu intégré sur AnnouncementCard, profil public, chat header, long-press message, post-RDV.
- **Trigger `auto_suspend_on_score`** (mig 28) : à chaque INSERT signalement confirmé, si l'utilisateur cible accumule ≥ 3 signalements confirmés en 30 jours → `is_active = false` automatique + audit log + email Resend.
- **Levée de suspension** : 1 000 FCFA via PawaPay + review admin manuelle.
- **Anti-spam** : l'auteur ne peut pas re-signaler la même cible dans les 7 jours.
- **Fichiers** : `components/ui/ReportButton.tsx`, `lib/signalements.ts`, migrations 25-28, 91, 98.

### F09 — Boost annonce (7 j / 30 j)

- Premier revenu monétaire (post-pivot v4.0 hors transaction).
- Tarification : 1 000 FCFA pour 7 jours, 3 000 FCFA pour 30 jours (le 30 j est volontairement plus attractif pour pousser à l'engagement long).
- **Ranking algo** : `ORDER BY (boost_until > NOW()) DESC, created_at DESC` — pas d'enchère (volontaire, évite la course aux armements entre vendeurs).
- **Sécurité paiement** (mig 63) : la RPC `apply_boost` vérifie 5 conditions (paiement succeeded + vendeur match + type=boost + montant matche durée + paiement non re-utilisé).
- **Fichiers** : `app/profile/boost/[annonceId].tsx`, `lib/boost.ts`, migrations 60-63, Edge Functions `pawapay-init-deposit` + `pawapay-webhook`.

### F10 — Notifications push (Expo + 10 events business)

- **Architecture fire-and-forget** : trigger AFTER INSERT/UPDATE → `pg_net.http_post` → Edge Function `send-push-notification` → API Expo Push.
- **10 events instrumentés** : nouveau_message, rdv_propose, rdv_confirme, rdv_reminder_j1, avis_recu, annonce_expire_soon, annonce_boostee, kyc_valide, kyc_rejetee, compte_suspendu.
- **Multi-device** : table `push_tokens` (1 user → N tokens), revocation auto sur DeviceNotRegistered.
- **Quality fixes** (mig 68) : cooldown 10 min entre 2 notifs de même type au même user (anti-spam).
- **Fichiers** : `lib/push.ts`, `components/ui/PushNotificationGate.tsx`, migrations 64-68, Edge Function `send-push-notification`.

### F11 — Expiration automatique des annonces

- Cron nocturne qui passe `statut = 'expiree'` après 60 jours.
- **Prolongation 28 jours** possible (bouton dans la liste des annonces actives, sans aucun paiement requis — c'est de la rétention naturelle).
- **Mode Immobilier** : durée d'expiration différente (cron à part) car les annonces immo ont une durée de vie naturelle plus longue.

### F12 — Dashboard vendeur (bento stats)

- 6 cards : annonces actives + vues 7j, contacts/RDV/Réalisés (funnel), note moyenne + nb avis, boosts actifs, revenus générés, action items.
- **RPC unique `get_my_dashboard_stats`** consolide tout en 1 round-trip.
- **Pending user actions** (mig 93) : RPC qui retourne les actions en attente (RDV à confirmer, notation à faire, KYC pending > 48 h, signalement avec statut évolué, boost qui expire < 24 h). Badge "!" sur le tab Profil.
- **Fichiers** : `app/profile/dashboard.tsx`, `lib/dashboard.ts`, `lib/pendingActions.ts`, migrations 58, 61, 93.

### F13 — Back-office administrateur (bonus hors CDC v4.0)

- 3 modules : validation KYC, modération signalements, dashboard KPIs avec filtre mois/année.
- **Stack** : Next.js 16 + Tailwind v4 + Recharts + Resend + @supabase/ssr.
- **Auth** : layout `(admin-protected)` vérifie `auth.uid()` puis `users.is_admin = true`. Sessions cookies httpOnly. Middleware refresh sliding.
- **Cascade actions** (mig 57) : décision admin sur signalement déclenche en cascade auto-suspend + email + audit log + push.
- **KPIs modulaires** (mig 78-80, 111-116) : 6 modules (liquidité, activation, revenu, export CSV, rapports compta PDF mensuels TVA Rwanda 18 %, alertes).
- **Fichiers** : `landing/src/app/admin/**`, `landing/src/lib/admin/*`.

### F14 — Pack légal + page support web (Apple App Store requirement)

- **Apple Guideline 5.1 + Google Play Data Safety** : pages légales et support accessibles publiquement.
- **6 documents canoniques** (`docs/legal/*.md`) : CGU, CGV, Confidentialité, Mentions légales, Charte communautaire, Cookies. Single source of truth markdown.
- **Sync via script** : `landing/scripts/sync-legal.mjs` copie les `.md` vers `landing/src/legal-content/` (avec checksum).
- **Rendus** : mobile (`app/legal/*.tsx` avec WebView), web (`landing/src/app/legal/*`), PDF (`assets/legal-pdf/`).
- **Page support** (`niqo.africa/support`) : 5 contacts email + 6 FAQ + footer légal.
- **Page suppression-compte** (`niqo.africa/suppression-compte`) : guide pas-à-pas RGPD article 17 sans avoir l'app installée (requis par Google Play).

### F15 — Bloquer un utilisateur (Apple Guideline 1.2 UGC)

- **Implémenté en 1 journée le 2026-05-15-16** après rejet Apple sur la build 1.0.0(4).
- **3 couches défense en profondeur** :
  1. **Client** : hook `useBlockedUsers` populate un Set en mémoire, `lib/annonces.ts` utilise `excludeVendeurIds`.
  2. **DB** : table `blocked_users` owner-scoped RLS (mig 129).
  3. **Trigger anti-bypass** : `fn_messages_block_check` BEFORE INSERT messages → `RAISE EXCEPTION 'BLOCKED_BY_RECIPIENT'` (mig 130) — inviolable depuis l'API directe.
- **Signalement implicite** (mig 131) : chaque block crée un signalement attribué au user système "Niqo Auto-Modération" (Apple requirement "notify the developer").
- **Pas de notification au bloqué** (Apple HIG : éviter retaliations).
- **Fichiers** : `components/blocking/BlockUserSheet.tsx`, `app/profile/blocked-users.tsx`, `lib/blocking.ts`, `lib/hooks/useBlockedUsers.ts`, migrations 129-132.

---

## 6. Sécurité, conformité légale et modération

`[Bloc 1 — Développer une application sécurisée]`

### 6.1 Cadres légaux applicables

Niqo est soumise à **trois cadres légaux distincts** selon le pays utilisateur, plus le règlement européen RGPD appliqué en baseline :

| Pays | Loi | Régulateur | Sanction maximale |
|---|---|---|---|
| 🇨🇮 Côte d'Ivoire | Loi 2024-30 | ARTCI | 200 M FCFA (~300 k€) |
| 🇨🇬 Congo Brazzaville | Loi 2023-15 | ANRTIC | 100 M FCFA (~150 k€) |
| 🇷🇼 Rwanda (entité légale) | Loi 2021-058 | NCSA | 1 % du CA mondial |
| 🇪🇺 RGPD (baseline) | Règlement (UE) 2016/679 | CNIL et homologues | 4 % du CA mondial |

**Document `docs/references/rgpd-audit.md`** : checklist 10 points par feature, audit obligatoire après chaque feature touchant à des données personnelles. 10 entrées documentées au 2026-05-09.

### 6.2 Mesures techniques de sécurité

- **Chiffrement Supabase Vault** sur `users.telephone` : jamais exposé en clair via REST, déchiffrement on-demand via RPC sécurisée.
- **RLS activé sur toutes les tables sensibles** (cf. §4.2).
- **Anti-brute-force** sur les tentatives de connexion (Supabase Auth natif).
- **Webhooks PawaPay signés et vérifiés** (HMAC SHA-256).
- **Traçabilité consentements** : `cgu_accepted_at`, `cgu_sell_accepted_at`, `cgv_accepted_at` avec timestamp serveur (jamais client-side).
- **Cascade delete** suppression compte : purge Storage (avatars + annonces-photos + CNI) + CASCADE DB + audit log.
- **Audit log admin** (mig 103-104) : toutes les actions admin (validation KYC, décision signalement, suspension, levée) enregistrées avec payload before/after, immutable.
- **Score d'abus** : `users.score_abus` calculé en temps réel, surface à partir de 2 signalements confirmés.

### 6.3 Modération du contenu (4 couches en défense en profondeur)

| Couche | Technologie | Quand | Action |
|---|---|---|---|
| **1. Triggers DB** | `mots_interdits` + regex SQL | BEFORE INSERT messages, annonces | Reject ou flag selon severity |
| **2. OpenAI Moderation** | Edge Function `moderate-text` | À la création d'annonce (titre + description) | Si flagged → `annonce.statut = 'pending_moderation'`, admin notif |
| **3. AWS Rekognition** | Edge Function `moderate-image` | À chaque upload photo annonce | DetectModerationLabels eu-west-1, threshold 80 %, photos quarantaine |
| **4. OpenAI async** | Edge Function `moderate-message` | AFTER INSERT message (trigger pg_net) | Si flagged → signalement auto user système + dissuasion utilisateur (message système visible 2 parties + push privative) |

La couche 4 a été ajoutée le 2026-05-12 (mig 119-120) suite à des cas de tentatives de fraude observées dans les messages (numéros WhatsApp externes, demandes de paiement Western Union avant rencontre, etc.). Architecture fire-and-forget non-bloquante : le trigger n'attend pas la réponse OpenAI pour valider l'INSERT du message.

### 6.4 Observabilité (3 piliers)

| Pilier | Technologie | Cible |
|---|---|---|
| **Errors temps réel** | Sentry × 3 projets | niqo-edge (Edge Functions), niqo-mobile (Expo), niqo-admin (Next.js) |
| **Compteurs business** | `niqo_event_log` (mig 106-107) | INSERT via trigger sur événements métier (user_signup, annonce_created, message_sent, rdv_proposed, etc.) |
| **Alertes digest** | Cron 8h UTC + Resend (mig 108) | Email récap quotidien si seuils dépassés (pic signalements > 2× moyenne 7j, pic erreurs Sentry, KYC pending > 48 h) |

**Dashboard `/admin/observability`** consomme `niqo_event_log` pour afficher les KPIs en temps réel (graphs Recharts).

10 crons DB instrumentés avec `niqo_event_log` + try/catch + alerte Sentry on failure (mig 109).

---

## 7. Tests automatisés et qualité

`[Bloc 3 — Préparer et exécuter les plans de tests]`

### 7.1 Stratégie de test

Approche **dual-layer** : tests DB-level (pgTAP) + tests intégration end-to-end (Vitest). Couvre 13 modules backend critiques au 2026-05-18.

| Layer | Technologie | Couvre | Latence d'exécution |
|---|---|---|---|
| **pgTAP** | SQL + extension pgTAP | RPCs, triggers, RLS isolés | ~30 s pour 100+ assertions |
| **Vitest** | TypeScript + supabase-js | Flows end-to-end via PostgREST | ~3 min |

Pas de tests unitaires composants React Native (pas de Jest configuré). Justification : la **valeur d'un test composant** sur une app data-driven est faible (la majorité des bugs viennent du couplage avec la DB, pas du rendu pur). Les tests d'intégration Vitest couvrent les paths utilisateur réels.

### 7.2 Tests pgTAP (DB-level)

- **Stockés dans `tests/sql/`** : 16 modules couverts.
- **Pattern** : chaque test ouvre une transaction, INSERT fixtures, asserte via `ok`/`is`/`throws_ok`, ROLLBACK automatique en fin de test (DB clean).
- **Runner** : `tests/sql/_runner.sql` orchestre l'exécution.
- **Lancement** : `psql -f tests/sql/_runner.sql` sur Supabase local.

**Modules couverts** : admin_kpis, annonces, audit, auth, boost, categories, conversations, favoris, kyc, moderate_message, notation, rdv, rencontre, signalements, storage. Couverture pgTAP totale : **~150 assertions**.

### 7.3 Tests d'intégration (Vitest)

- **Stockés dans `tests/integration/`** : 13 modules couverts.
- **Pattern** : authentifie via Supabase Auth, créé fixtures via les **vraies RPCs** (pas de raw INSERT), valide les paths utilisateur.
- **Helpers** : `tests/integration/helpers/{setup, supabase}.ts` exposent `createUser`, `createAnnonce`, `createConv`.
- **Configuration** : `.env.test` pointe sur `supabase start` local.
- **Lancement** : `npm test` dans `tests/integration/`.

**Tests gated par feature flag** :
- `moderation-image.test.ts` : skip si `AWS_AVAILABLE` n'est pas défini.
- `moderation-message.test.ts` : skip si `OPENAI_AVAILABLE` + `MODERATE_MESSAGE_SERVED` ne sont pas définis.

### 7.4 CI / CD (planifié)

`.github/workflows/backend-tests.yml` (configuration finalisée hors repo, à intégrer Phase 2) : matrix pgTAP + Vitest, secrets `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, blocage PR si tests rouges. Pour le MVP, les tests sont exécutés manuellement en local avant chaque migration prod.

---

## 8. Déploiement, DevOps et monitoring

`[Bloc 3 — Préparer et documenter le déploiement d'une application]`

### 8.1 Mobile (EAS Build)

| Profil | Cible | Source maps Sentry |
|---|---|---|
| `development` | Simulateur + device, debug, hot reload | Non |
| `preview` | Production-like, simulator only (QA interne) | Optionnel |
| `production` | APK + AAB Android, IPA iOS | Oui (gated `SENTRY_AUTH_TOKEN`) |

- **`cli.appVersionSource = "remote"`** : EAS auto-incrémente `buildNumber` (iOS) et `versionCode` (Android) à chaque build — évite les refus stores sur build ≤ précédent.
- **OTA vs rebuild** : règle explicite documentée dans `CLAUDE.md`. Patch JS/TS pur → OTA via `eas update --channel production`. Patch touchant le natif (module Expo, permission, deep link, push) → rebuild + resubmit store obligatoire.

### 8.2 Publication stores

**iOS App Store** :
- ✅ **LIVE depuis 2026-05-17** : build 1.0.0(6) validée par Apple en 24 h.
- Distribution : 147 pays (CI + CG + Rwanda + Afrique + Amériques + Asie + UK + CH + NO). UE exclue tant que DSA Trader Info pas publiées.
- Apple ID : `6769410032`.

**Google Play Store** :
- 🟡 Closed testing actif (12 testeurs, 14 jours règle Google). Build 1.0.1 prod à pousser.
- Package : `com.niqo.africa` (validé par Google).
- Cible publication : fin mai 2026.

**Rejet Apple intermédiaire (2026-05-15)** : build 1.0.0(4) rejetée sur Guideline 1.2 (User-Generated Content) — manque feature "Block user". Implémentation en 1 journée → resubmission → validation Apple en 24 h. Cette feature (F15) est documentée comme étude de cas dans `docs/changelog-launch.md`.

### 8.3 Admin web (Vercel)

- Déployé sur Vercel depuis le 2026-05-10.
- Domaine : `niqo.africa` (root) + `niqo.africa/admin/*` (back-office).
- Environment variables Vercel : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`.
- CI/CD : `git push origin main` → preview deployment automatique → review manuelle → promote to production.

### 8.4 Backend Supabase

- **Project ID** : `uokauzmafppukgsemugz`.
- **Région** : eu-west-1 (Irlande) — conformité RGPD baseline.
- **Migrations** : appliquées manuellement via Supabase Dashboard → SQL Editor. Procédure documentée dans `docs/backend/PROCESS.md`.
- **Secrets** : gérés via `supabase secrets set` (jamais committés). Cf. `supabase/.env.example` pour la liste.
- **Edge Functions** : déployées via `supabase functions deploy <name>` ou scripts `scripts/predeploy-moderate-*.sh`.

### 8.5 Versioning post-1.0

Convention **semver** appliquée à `expo.version` dans `app.json` :

| Bump | Exemple | Quand |
|---|---|---|
| PATCH | 1.0.0 → 1.0.1 | Fix bug, crash, RPC échouée, typo |
| MINOR | 1.0.x → 1.1.0 | Nouvelle feature non-breaking (Pack Pro, annonce vedette) |
| MAJOR | 1.x.y → 2.0.0 | Refonte UX majeure (très rare) |

**État au 2026-05-18** :
- iOS : 1.0.0(6) LIVE. Rebuild 1.0.1 en cours (fix UX clavier paiement/chat + install `react-native-keyboard-controller` + cleanup `updates.url`).
- Android : closed testing avec 1.0.0(1). Rebuild 1.0.1 prod à pousser en parallèle.

### 8.6 Monitoring production

Cf. §6.4 (Observabilité). En complément :

- **Sentry release tracking** : à activer post-launch (génération `SENTRY_AUTH_TOKEN`, upload source maps mobile via plugin Sentry/expo).
- **Sentry Alert Rules** : à configurer pour notification Slack/email sur crash spike.
- **Uptime monitoring externe** : UptimeRobot prévu (probe sur `niqo.africa/api/health`).

---

## 9. Gestion de projet et planning

### 9.1 Phases de développement (CDC v4.0 §7.2)

| Période | Phase | Livrables | Statut |
|---|---|---|---|
| S1-2 | Setup & Admin | Société Rwanda, comptes Apple/Google Play, env dev | ✅ |
| S3-5 | MVP Core | Auth, annonces, recherche, profils, messagerie | ✅ |
| S6-7 | Confiance | Notation, KYC, signalements, auto-suspension | ✅ |
| S8 | Monétisation | Boost annonces, paiement PawaPay, dashboard vendeur | ✅ |
| **Bonus** | **Back-office web** | Admin Next.js 16 (KYC + signalements + KPIs) | ✅ |
| **Bonus** | **Pack légal v1.1** | 6 docs canoniques + écrans + footer + script sync | ✅ |
| **Bonus** | **Observabilité** | Sentry 3 surfaces + event_log + alertes digest | ✅ |
| **Bonus** | **Page support web** | `niqo.africa/support` (requis Apple App Store) | ✅ |
| S9-10 | Tests & Optim | Beta 10 users, perf mobile | 🟡 en cours |
| **S11** | **Déploiement iOS** | Build EAS prod + ASC listing + submit | ✅ LIVE 2026-05-17 |
| **S11** | **Déploiement Android** | Build EAS prod + Play Console + submit | 🟡 closed testing |
| **Bonus** | **Block user** | F15 ajoutée en 1 j après rejet Apple Guideline 1.2 | ✅ |
| S12 | Lancement | 5 influenceurs, 50 vendeurs pré-inscrits, GO live | ❌ post-launch iOS |

### 9.2 Outils de gestion

- **Git** : repository monolithique sur GitHub (Sparctuce-X-X/Projet-certification), branche principale `main`, commits Conventional Commits + body explicatif en français.
- **TaskCreate / TaskList** : suivi des sprints via Claude Code tasks.
- **Plan / Decisions** : documentés directement dans `CLAUDE.md` (source opérationnelle à jour) + `docs/architecture/v4-deltas.md` (écarts CDC vs réalité).
- **Linear / Jira** : non utilisés (équipe à 1 dev, overhead injustifié).

### 9.3 Reste à faire avant publication Android (2026-05-18)

| Bloc | Effort | Bloquant ? |
|---|---|---|
| Build EAS production Android 1.0.0 avec F15 Block | 1 j | 🔴 oui Android |
| Soumission Google Play + review | 1-2 j externe | 🔴 oui Android |
| Configuration FCM (Firebase) pour push Android prod | 1 j | 🟡 oui pour push Android |
| Restaurer Sentry mobile (générer `SENTRY_AUTH_TOKEN`, restaurer plugin) | 30 min | 🟡 souhaitable (visibilité crashes prod) |
| Validation avocat du pack légal v1.1 (6 docs) | 2-3 sem externe | 🟡 en cours, pas bloquant |
| Backend doc + tests pour F15 Block | 1 j | 🟢 souhaitable, pas bloquant |
| Beta 10 users + perf mobile (Tecno Spark / Itel A56) | 1-2 sem | 🟡 acquisition organique en cours |

---

## Annexe A — Mapping compétences RNCP CDA

Le titre **"Concepteur Développeur d'Applications"** (TP-CDA, code RNCP 31678) couvre 3 blocs de compétences. Voici la mise en correspondance avec les éléments du projet Niqo.

### Bloc RNCP1 — Développer une application sécurisée

| Compétence | Élément Niqo | Fichiers / Sections |
|---|---|---|
| Installer et configurer son environnement de travail | Setup Expo SDK 54 + NativeWind + TypeScript strict + Supabase CLI + EAS | Commit 1 (bootstrap), `CLAUDE.md` §Stack technique |
| Développer des interfaces utilisateur | Wizard 5 étapes (F02), chat Realtime (F04), dashboard bento (F12), Block sheet (F15) | `app/`, `components/`, §5 (F01-F15) |
| Développer des composants métier | RPCs Supabase (~80), Edge Functions (13), triggers (~30), lib métier (`lib/*.ts`) | `supabase/functions/`, `supabase/migrations/`, `lib/` |
| Sécuriser l'application | RLS, Vault téléphone, modération 4 couches, audit log, anti-bypass trigger F15, score d'abus | §6, migrations 74, 77, 94, 105, 129-132 |
| Contribuer à la gestion d'un projet informatique | Git + Conventional Commits, TaskCreate, docs/backend/PROCESS.md, CDC versionné, audit RGPD systématique | `docs/`, git log |

### Bloc RNCP2 — Concevoir et développer une application multicouche répartie

| Compétence | Élément Niqo | Fichiers / Sections |
|---|---|---|
| Analyser les besoins et maquetter une application | Charte Figma de marque, 7 principes de design, plugin `ui-ux-pro-max` | `docs/design-system.md`, Figma frames 1-2/1-3/1-4/1-7 |
| Définir l'architecture logicielle | Architecture 3 surfaces + 1 backend, choix Supabase justifié, défense en profondeur modération | §3, `docs/architecture/v4-deltas.md` |
| Concevoir une base de données relationnelle | ~50 tables, 132 migrations incrémentales, RLS strategy, FK cascade | §4, `docs/migrations/INDEX.md`, `docs/references/niqo_schema_v1.6.sql` |
| Développer des composants d'accès aux données SQL | RPCs typées, Edge Functions Deno, client `lib/supabase.ts` + Realtime, `landing/src/lib/supabase/` SSR | `lib/`, `supabase/functions/`, `landing/src/lib/supabase/` |
| Développer une application multicouche | Mobile (Expo) + Admin web (Next.js) + Backend (Supabase) + Page publique web (Next.js) | §3 (architecture diagram) |

### Bloc RNCP3 — Préparer le déploiement d'une application sécurisée

| Compétence | Élément Niqo | Fichiers / Sections |
|---|---|---|
| Préparer et exécuter les plans de tests | pgTAP (16 modules, ~150 assertions) + Vitest (13 modules end-to-end) + tests gated feature flags | §7, `tests/sql/`, `tests/integration/` |
| Préparer et documenter le déploiement | EAS Build (3 profils), eas.json, scripts predeploy, Vercel, Supabase deploy, `CLAUDE.md` §Git & déploiement | `eas.json`, `scripts/`, §8 |
| Contribuer à la mise en production en démarche DevOps | OTA vs rebuild documenté, versioning semver post-1.0, monitoring Sentry + event_log + alertes digest, audit log admin, ASO screenshots | §8.5-8.6, `docs/gotchas.md`, `docs/changelog-launch.md` |

### Preuves opérationnelles tangibles

- ✅ Application **réellement publiée sur l'App Store** (147 pays) depuis 2026-05-17.
- ✅ Code source GitHub (Sparctuce-X-X/Projet-certification) avec 27 commits Conventional Commits.
- ✅ Documentation technique exhaustive : 16 fichiers `docs/backend/`, 132 migrations indexées, 6 docs légaux canoniques.
- ✅ Tests automatisés : 150+ assertions pgTAP + 13 modules Vitest.
- ✅ Conformité Apple App Store (Guidelines 1.2 + 4.8 + 5.1) prouvée par la validation.
- ✅ Audit /cso green le 2026-05-10 (RLS + open redirect + SHA-pin CI).
- ✅ Pack légal v1.1 publié sur `niqo.africa/legal/*`, en cours de validation par avocat.

---

## Annexe B — Glossaire

| Terme | Définition |
|---|---|
| **C2C** | Consumer-to-Consumer : transaction entre particuliers (par opposition à B2C ou B2B). |
| **CNI** | Carte Nationale d'Identité, document officiel d'identité en Afrique francophone. |
| **EAS** | Expo Application Services : plateforme de build cloud d'Expo (compilation iOS + Android dans le cloud). |
| **FCM** | Firebase Cloud Messaging : service Google pour push notifications Android en production. |
| **KYC** | Know Your Customer : processus de vérification d'identité (CNI + selfie + paiement). |
| **MM** | Mobile Money : paiement par téléphone mobile (MTN MoMo, Orange Money, Airtel Money, Wave). |
| **OTA** | Over-The-Air update : mise à jour à distance du code JS/TS sans passer par les stores. |
| **PawaPay** | Agrégateur africain Mobile Money (intègre MTN, Orange, Airtel, Wave, Moov, MoMo). |
| **RLS** | Row Level Security : sécurité PostgreSQL au niveau de la ligne, encodée dans la DB. |
| **RNCP** | Répertoire National des Certifications Professionnelles (France Compétences). |
| **CDA** | Concepteur Développeur d'Applications (titre RNCP 31678, niveau 6, Bac+3 équivalent). |
| **DSA** | Digital Services Act : règlement européen 2022/2065 sur les plateformes numériques. |
| **RGPD** | Règlement Général sur la Protection des Données (UE 2016/679). |
| **DPO** | Data Protection Officer : délégué à la protection des données. |

---

## Annexe C — Références

### Documentation interne projet

- **Source opérationnelle à jour** : `CLAUDE.md` (35 ko)
- **Sommaire docs** : `docs/README.md`
- **Backend ownership par module** : `docs/backend/{auth, annonces, conversations, signalements, kyc, boost, rdv, notation, admin_kpis, blocking, moderation, observability, storage, categories, favoris}.md`
- **Index 132 migrations** : `docs/migrations/INDEX.md`
- **Écarts CDC v4.0 vs réalité** : `docs/architecture/v4-deltas.md`
- **Pièges connus + recettes debug** : `docs/gotchas.md`
- **Audit RGPD par feature** : `docs/references/rgpd-audit.md`
- **Pack légal v1.1** : `docs/legal/{cgu, cgv, confidentialite, mentions-legales, charte-communautaire, cookies}.md`
- **Changelog du lancement iOS** : `docs/changelog-launch.md`
- **Process d'ajout backend** : `docs/backend/PROCESS.md`
- **Tests pgTAP + Vitest** : `tests/sql/`, `tests/integration/`
- **CDC v4.0 figé (référence historique)** : `docs/references/niqo_cdc_v4_0.docx`

### Liens externes officiels

- App Store iOS : `https://apps.apple.com/app/niqo-annonces-afrique/id6769410032`
- Repository GitHub : `https://github.com/Sparctuce-X-X/Projet-certification`
- Page support : `https://niqo.africa/support`
- Page suppression compte (RGPD) : `https://niqo.africa/suppression-compte`
- Référentiel RNCP CDA : `https://www.francecompetences.fr/recherche/rncp/31678/`

### Standards et frameworks référencés

- **OWASP Top 10 (2021)** : audit `/cso` documenté `docs/changelog-launch.md` 2026-05-10
- **Apple App Store Review Guidelines** : `https://developer.apple.com/app-store/review/guidelines/`
- **Google Play Developer Program Policies** : `https://play.google.com/about/developer-content-policy/`
- **RFC 7519 (JWT)** : utilisé par Supabase Auth
- **ISO 3166** : codes pays (CI, CG, RW, FR, etc.)
- **E.164** : format international des numéros de téléphone (`lib/phone.ts`)

---

> **Document soutenu lors de la session de jury RNCP CDA — 2026.**
> Auteur : Dominique Huang
> Date de soumission : 2026-05-18
> Version : 5.0

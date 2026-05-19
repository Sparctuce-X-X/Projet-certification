---
title: Méthodologie d'analyse UML — Projet Niqo
subtitle: Démarche de modélisation pour la certification RNCP "Concepteur Développeur d'Applications" (TP-CDA, code 31678)
author: Dominique Huang
date: 2026-05-19
version: 1.0
project: Niqo
status: Document de soutenance
---

# Méthodologie d'analyse UML — Projet Niqo

> Document produit pour le dossier de certification RNCP **Concepteur Développeur d'Applications** (TP-CDA — code 31678).
> Il décrit la **démarche** suivie pour modéliser le système Niqo en UML, **justifie** les choix de diagrammes, et fournit les **modèles concrets** au format PlantUML. À lire avec le **Cahier des Charges v5.0** ([docs/CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md)) et le **rétro-planning** (CDC §9 « Gestion de projet et planning »).

---

## Sommaire

1. [Contexte et objectifs de la modélisation](#1-contexte-et-objectifs-de-la-modélisation)
2. [Pourquoi UML pour Niqo](#2-pourquoi-uml-pour-niqo)
3. [Démarche d'analyse adoptée](#3-démarche-danalyse-adoptée)
4. [Outils, conventions et versioning](#4-outils-conventions-et-versioning)
5. [Diagramme 1 — Cas d'utilisation](#5-diagramme-1--cas-dutilisation-use-case)
6. [Diagramme 2 — Classes (modèle de données)](#6-diagramme-2--classes-modèle-de-données)
7. [Diagramme 3 — Séquence (trois scénarios critiques)](#7-diagramme-3--séquence-trois-scénarios-critiques)
8. [Diagramme 4 — État-transition](#8-diagramme-4--état-transition)
9. [Diagramme 5 — Activité](#9-diagramme-5--activité)
10. [Diagramme 6 — Déploiement](#10-diagramme-6--déploiement)
11. [Mapping vers les blocs RNCP CDA](#11-mapping-vers-les-blocs-rncp-cda)
12. [Limites, traçabilité et évolutions](#12-limites-traçabilité-et-évolutions)

---

## 1. Contexte et objectifs de la modélisation

**Niqo** est une plateforme C2C (consumer-to-consumer) mobile pour l'Afrique francophone, **LIVE sur l'App Store iOS depuis le 2026-05-17** dans 147 pays. Le système comprend :

- une **application mobile** React Native + Expo (iOS + Android),
- un **back-office administrateur** Next.js 16 hébergé sur Vercel,
- un **backend Supabase** (PostgreSQL + Auth + Storage + Realtime + Edge Functions),
- des **services tiers** (PawaPay Mobile Money, OpenAI Moderation, AWS Rekognition, Resend, Sentry, Expo Push).

L'objectif de la modélisation UML est triple :

1. **Cadrer le périmètre fonctionnel** avant chaque feature (15 features F01→F15) en s'appuyant sur des **cas d'utilisation** explicites avec acteurs et préconditions.
2. **Concevoir un modèle de données cohérent** (~50 tables, 132 migrations incrémentales) en distinguant les concepts métier (Annonce, Conversation, Avis…) de leur implémentation SQL.
3. **Documenter les flux critiques** (inscription, KYC, modération, paiement boost) pour la soutenance et la maintenance future — un développeur qui rejoint le projet doit pouvoir comprendre une feature en lisant son diagramme de séquence avant de plonger dans le code.

Cette démarche s'inscrit dans le **référentiel RNCP CDA 31678**, dont la modélisation est une compétence explicite des **Blocs RNCP1 et RNCP2** (cf. §11).

---

## 2. Pourquoi UML pour Niqo

### 2.1 Forces du formalisme UML appliquées au projet

| Besoin Niqo | Réponse UML | Diagramme retenu |
|---|---|---|
| Définir qui fait quoi (Visiteur vs Utilisateur vs Admin) | Représentation graphique des acteurs et de leurs droits | **Use Case** |
| Modéliser des entités métier interconnectées (Annonce ↔ Conversation ↔ Avis) avant de figer le SQL | Notation orientée objet exprimant cardinalités, héritage, agrégation | **Classes** |
| Spécifier des flux multi-acteurs et multi-systèmes (acheteur ↔ vendeur ↔ DB ↔ PawaPay ↔ Edge Function) | Lignes de vie + messages temporels | **Séquence** |
| Documenter les statuts d'une annonce (active → en_cours → vendue / expirée / suspendue) | Machine à états finis | **État-transition** |
| Décrire le parcours acheteur browse-first | Workflow conditionnel avec branches | **Activité** |
| Cartographier l'infrastructure (3 surfaces + Supabase + tiers) | Représentation des nœuds physiques et artefacts déployés | **Déploiement** |

### 2.2 Pourquoi pas une approche purement textuelle

Un cahier des charges textuel décrit **quoi** faire ; UML décrit **comment** les éléments interagissent. Pour Niqo, j'ai constaté pendant le développement que :

- la **table `conversations`** porte à la fois la conversation, l'ancrage à une annonce, **et** le RDV (colonnes `rdv_propose_par_id`, `rdv_date`, `rdv_lieu`, `rdv_confirme`). Sans diagramme de classes, ce couplage est invisible et conduit à des duplications de logique métier en Edge Function ;
- la **modération de message** combine 1 trigger DB + 1 appel HTTP asynchrone (`pg_net`) + 1 Edge Function + 1 API OpenAI + 1 insertion automatique de signalement par un user système. Sans diagramme de séquence, **personne** ne peut auditer la chaîne complète en moins de 15 minutes.

UML me sert donc autant pour **concevoir** que pour **transmettre** la connaissance technique (au jury, à un futur dev, à un auditeur sécurité).

### 2.3 Vues UML retenues / écartées

Sur les **14 diagrammes UML 2.x** standardisés, j'ai retenu **6 vues** jugées suffisantes au stade MVP. Les écarts :

- **Diagramme d'objet** : utile pour illustrer un cas particulier, redondant ici avec le diagramme de classes commenté.
- **Diagramme de composant** : fusionné avec le diagramme de déploiement (la granularité monolithique du backend Supabase ne justifie pas deux vues distinctes).
- **Diagramme de paquetage** : non pertinent, l'arborescence `app/` + `components/` + `lib/` + `landing/` est auto-documentée par Expo Router (file-based).
- **Diagramme de communication, de temps, de structure composite, de profil** : valeur ajoutée faible pour un MVP, à envisager en Phase 2 si la complexité explose.

---

## 3. Démarche d'analyse adoptée

### 3.1 Approche **top-down + itérative**

```
┌───────────────────────────────────────────────────────────┐
│  Itération N  (1 feature = F01 à F15)                     │
│                                                            │
│  (1) Cas d'utilisation    → on identifie acteurs + scope   │
│        ↓                                                   │
│  (2) Classes              → on raffine le modèle de        │
│                              données (table à créer ?      │
│                              colonne à ajouter ?)          │
│        ↓                                                   │
│  (3) Séquence             → on spécifie les flux back-end  │
│                              et tiers (Edge Functions,     │
│                              triggers, PawaPay, OpenAI…)   │
│        ↓                                                   │
│  (4) État / Activité      → si la feature a un lifecycle   │
│                              non trivial (annonce, KYC,    │
│                              RDV), on le modélise          │
│        ↓                                                   │
│  (5) Déploiement          → mis à jour quand on ajoute     │
│                              un service tiers              │
└───────────────────────────────────────────────────────────┘
```

À chaque itération, **les diagrammes sont versionnés en même temps que le code** (cf. §4.3). Cette discipline évite l'écueil classique de la modélisation UML : produire une jolie spec en début de projet, puis laisser le code diverger.

### 3.2 Lien avec le rétro-planning (CDC §9)

Le planning Niqo (CDC §9.1) découpe le projet en **12 sprints + bonus** sur 6 mois. Voici la cartographie des phases vers les diagrammes UML produits :

| Sprint | Phase produit | Diagrammes UML produits |
|---|---|---|
| **S1-2** | Setup & Admin (société Rwanda, comptes stores, env dev) | Use Case macro (acteurs) + Déploiement v0 |
| **S3-5** | MVP Core (Auth, annonces, recherche, messagerie) | Use Case détaillé F01-F04 + Classes v1 + Séquence (Auth, Création annonce, Chat Realtime) |
| **S6-7** | Confiance (Notation, KYC, Signalements) | État (KYC), Séquence (Validation admin, Auto-suspend score≥3), enrichissement Classes |
| **S8** | Monétisation (Boost, PawaPay, Dashboard) | Séquence (Paiement boost + webhook), Activité (parcours vendeur) |
| **Bonus** | Back-office, Observabilité, Pack légal | Use Case Admin, Déploiement v2 (Sentry + event_log + Resend) |
| **S9-11** | Tests, Déploiement iOS, Block user F15 (urgence post-rejet Apple) | Séquence (Block + signalement implicite + trigger anti-bypass), État (lifecycle annonce v4.0) |
| **S12** | Lancement | Diagrammes consolidés pour soutenance |

### 3.3 Granularité retenue

Chaque diagramme suit une règle de **lisibilité à 1 écran 1080p** (l'humain ne mémorise pas plus de ~7±2 éléments simultanément, loi de Miller). Quand une vue dépasse ce seuil, je la fractionne en sous-diagrammes (ex. : le diagramme de classes global est décliné en 3 vues thématiques — Utilisateurs, Annonces & Conversations, Confiance & Modération).

---

## 4. Outils, conventions et versioning

### 4.1 PlantUML — le choix structurant

**PlantUML** a été retenu (vs Mermaid, Draw.io, StarUML) pour 4 raisons :

1. **Source texte = versionnable Git** : un diff sur un fichier `.puml` se lit, contrairement à un binaire `.drawio`.
2. **Rendu reproductible** : le même `.puml` produit toujours la même image SVG/PNG via la CLI `plantuml` ou l'extension VSCode.
3. **Syntaxe expressive** : supporte les 14 diagrammes UML 2.x là où Mermaid en couvre ~6.
4. **Compatible avec la doc générée** : `pandoc` rend les blocs PlantUML embarqués dans le Markdown pour produire le PDF de soutenance.

### 4.2 Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Acteur | `PascalCase` | `Acheteur`, `VendeurVerifie`, `Admin` |
| Cas d'utilisation | Verbe à l'infinitif | `Publier une annonce`, `Confirmer un RDV` |
| Classe | `PascalCase` singulier | `Annonce`, `Conversation`, `Avis` |
| Attribut | `snake_case` (= SQL) | `created_at`, `rdv_confirme` |
| Association | Verbe + cardinalité | `User "1" -- "0..*" Annonce : publie` |
| État | `snake_case` (= valeur enum DB) | `active`, `en_cours`, `vendue` |

### 4.3 Versioning

Les fichiers `.puml` vivent dans `docs/uml/` et suivent le **même cycle de revue Git que le code source** :

- une feature qui crée une nouvelle table déclenche obligatoirement une mise à jour de `docs/uml/classes.puml` dans le même commit ;
- les diagrammes de séquence sont versionnés au moment où la feature est livrée (jamais a posteriori) ;
- chaque commit qui touche un `.puml` doit mentionner la feature dans le message (`docs(uml): ajoute séquence F15 block user`).

---

## 5. Diagramme 1 — Cas d'utilisation (Use Case)

### 5.1 Objectif

Identifier **qui** peut faire **quoi** sur la plateforme Niqo, en distinguant les usages anonymes (browse-first) des usages authentifiés et des privilèges admin. Ce diagramme est la **porte d'entrée** de l'analyse — il acte le périmètre du MVP et révèle les besoins d'authentification (auth gate).

### 5.2 Acteurs

| Acteur | Description | Mode d'accès |
|---|---|---|
| **Visiteur** | Utilisateur non authentifié (browse-first) | App mobile sans compte |
| **Utilisateur** | Compte créé, profil complété (`complete_profile`) | App mobile + JWT Supabase |
| **VendeurVerifie** | Sous-type d'Utilisateur ayant validé son KYC (badge) | + droit de publier >3 annonces |
| **Admin** | Membre interne Niqo (`users.is_admin = true`) | Back-office web Next.js + cookies httpOnly |
| **SystemeNiqo** | Acteur technique (crons + triggers + Edge Functions) | Service role key (jamais exposée côté client) |
| **PawaPay** | Acteur externe — webhook signé HMAC SHA-256 | HTTPS depuis pawapay.com |

### 5.3 Modèle PlantUML

```plantuml
@startuml UseCase_Niqo_Global
left to right direction
skinparam packageStyle rectangle
title Niqo — Cas d'utilisation global (MVP F01-F15)

actor "Visiteur" as V
actor "Utilisateur" as U
actor "Vendeur Vérifié" as VV
actor "Admin" as A
actor "Système Niqo" as S <<system>>
actor "PawaPay" as PP <<external>>

VV -|> U

rectangle "Application Niqo" {

  package "Browse-first (sans compte)" {
    usecase "Consulter le feed" as UC_browse
    usecase "Rechercher / filtrer" as UC_search
    usecase "Voir le détail annonce" as UC_detail
    usecase "Choisir son pays (CI/CG)" as UC_country
  }

  package "Compte et identité" {
    usecase "S'inscrire (Google/Apple/Email)" as UC_signup
    usecase "Compléter son profil" as UC_complete
    usecase "Demander la vérification d'identité (KYC)" as UC_kyc
    usecase "Supprimer son compte (RGPD)" as UC_delete
  }

  package "Annonces et favoris" {
    usecase "Publier une annonce (wizard 5 étapes)" as UC_publish
    usecase "Éditer / clôturer une annonce" as UC_edit
    usecase "Booster une annonce (7j / 30j)" as UC_boost
    usecase "Mettre en favori" as UC_fav
  }

  package "Messagerie et RDV" {
    usecase "Contacter le vendeur" as UC_contact
    usecase "Proposer un RDV" as UC_propose
    usecase "Confirmer un RDV" as UC_confirm
    usecase "Marquer vendu / non-réalisé" as UC_done
  }

  package "Confiance" {
    usecase "Noter post-RDV (1-5 étoiles)" as UC_rate
    usecase "Signaler annonce / user / message" as UC_report
    usecase "Bloquer un utilisateur" as UC_block
  }

  package "Back-office (Admin)" {
    usecase "Valider / refuser une vérification KYC" as UC_admin_kyc
    usecase "Traiter un signalement" as UC_admin_report
    usecase "Suspendre / lever un compte" as UC_admin_suspend
    usecase "Consulter KPIs et observability" as UC_admin_kpi
  }

  package "Automatismes" {
    usecase "Expirer les annonces (cron 60j)" as UC_cron_expire
    usecase "Noter automatiquement 3/5 (cron 7j)" as UC_cron_avis
    usecase "Modérer message async (OpenAI)" as UC_cron_mod
    usecase "Envoyer alertes digest quotidiennes" as UC_cron_digest
  }
}

V --> UC_browse
V --> UC_search
V --> UC_detail
V --> UC_country

U --> UC_signup
U --> UC_complete
U --> UC_kyc
U --> UC_delete
U --> UC_contact
U --> UC_propose
U --> UC_confirm
U --> UC_done
U --> UC_rate
U --> UC_report
U --> UC_block
U --> UC_fav
U --> UC_publish
U --> UC_edit

VV --> UC_boost

A --> UC_admin_kyc
A --> UC_admin_report
A --> UC_admin_suspend
A --> UC_admin_kpi

S --> UC_cron_expire
S --> UC_cron_avis
S --> UC_cron_mod
S --> UC_cron_digest

UC_contact ..> UC_signup : <<extend>>\nauth gate
UC_publish ..> UC_signup : <<extend>>
UC_fav ..> UC_signup : <<extend>>
UC_report ..> UC_signup : <<extend>>

UC_boost ..> PP : <<include>>\npaiement
UC_kyc ..> PP : <<include>>\n1000 FCFA

@enduml
```

### 5.4 Lecture du diagramme

- **Browse-first** : 4 cas d'usage accessibles sans compte (politique produit assumée pour réduire la friction d'acquisition).
- **Relations `<<extend>>`** : matérialisent l'**auth gate** (un visiteur qui tente `Contacter le vendeur` déclenche le scénario d'inscription).
- **Relations `<<include>>`** : tout cas d'usage payant intègre obligatoirement le sous-cas PawaPay.
- **Acteur SystemeNiqo** : rend visibles les **automatismes** (crons + triggers) souvent oubliés des diagrammes use case classiques mais critiques pour la conformité (note auto 3/5, expiration, modération asynchrone).

---

## 6. Diagramme 2 — Classes (modèle de données)

### 6.1 Objectif

Représenter les **entités métier** Niqo et leurs relations avant transposition SQL. Le passage classe → table est documenté dans `docs/migrations/INDEX.md` et `docs/backend/<module>.md`.

### 6.2 Périmètre

Le diagramme global couvre les **12 entités structurantes** sur les ~50 tables réelles (cf. CDC v5.0 §4.1). Les tables techniques (`niqo_event_log`, `audit_log_admin`, `secure_phone`) sont représentées séparément et non détaillées ici.

### 6.3 Modèle PlantUML — Vue principale

```plantuml
@startuml Classes_Niqo_Principal
title Niqo — Diagramme de classes (entités structurantes)
skinparam classAttributeIconSize 0

class User {
  +id : uuid <<PK>>
  +email : text
  +telephone : text <<Vault encrypted>>
  +prenom : text
  +nom : text
  +pays : char(2)  // CI / CG / RW
  +photo_url : text
  +is_admin : boolean
  +is_active : boolean
  +is_verified : boolean
  +nb_annonces : int
  +nb_ventes : int
  +nb_achats : int
  +note_vendeur : decimal(2,1)
  +note_acheteur : decimal(2,1)
  +score_abus : int
  +cgu_accepted_at : timestamptz
  +cgv_accepted_at : timestamptz
  +created_at : timestamptz
}

class Annonce {
  +id : uuid <<PK>>
  +vendeur_id : uuid <<FK User>>
  +titre : text  // 5-80 chars
  +description : text  // 20-2000 chars
  +categorie_id : int <<FK Categorie>>
  +pays : char(2)
  +ville : text
  +prix_fcfa : bigint
  +etat : enum  // NEUF / COMME_NEUF / BON_ETAT / A_RENOVER
  +photos : text[]  // 1-6 urls
  +statut : enum  // active / en_cours / vendue / expiree / suspendue
  +mode : enum  // annonces / immo
  +boost_until : timestamptz
  +expires_at : timestamptz  // +60j par défaut
  +vues : int
  +created_at : timestamptz
}

class Categorie {
  +id : int <<PK>>
  +slug : text  // smartphone / monitor / shirt / ...
  +nom_fr : text
  +icon_lucide : text
}

class Conversation {
  +id : uuid <<PK>>
  +annonce_id : uuid <<FK Annonce>>
  +acheteur_id : uuid <<FK User>>
  +vendeur_id : uuid <<FK User>>
  +rdv_propose_par_id : uuid <<FK User>>
  +rdv_date : timestamptz
  +rdv_lieu : text
  +rdv_confirme : boolean
  +rencontre_at : timestamptz
  +created_at : timestamptz
}

class Message {
  +id : uuid <<PK>>
  +conversation_id : uuid <<FK Conversation>>
  +sender_id : uuid <<FK User>>
  +type : enum  // texte / image / systeme
  +contenu : text
  +lu_at : timestamptz
  +created_at : timestamptz
}

class Avis {
  +id : uuid <<PK>>
  +conversation_id : uuid <<FK Conversation>>
  +auteur_id : uuid <<FK User>>
  +cible_id : uuid <<FK User>>
  +note : smallint  // 1-5
  +commentaire : text  // <=500
  +est_auto_3 : boolean
  +created_at : timestamptz
}

class Favori {
  +user_id : uuid <<FK User>>
  +annonce_id : uuid <<FK Annonce>>
  +created_at : timestamptz
}

class VerificationIdentite {
  +id : uuid <<PK>>
  +user_id : uuid <<FK User>>
  +photo_cni_recto : text
  +photo_cni_verso : text
  +photo_selfie : text
  +numero_cni : text <<UNIQUE>>
  +statut : enum  // pending / approved / rejected
  +motif_rejet : text
  +reviewed_by : uuid <<FK User>>
  +created_at : timestamptz
}

class PaiementNiqo {
  +id : uuid <<PK>>
  +user_id : uuid <<FK User>>
  +type : enum  // kyc / boost / leve_suspension
  +montant_fcfa : bigint
  +pawapay_deposit_id : text
  +statut : enum  // pending / succeeded / failed
  +pawapay_metadata : jsonb
  +created_at : timestamptz
}

class Signalement {
  +id : uuid <<PK>>
  +auteur_id : uuid <<FK User>>
  +categorie : enum  // annonce / user / message / rdv
  +cible_id : uuid
  +description : text
  +photos : text[]
  +statut : enum  // pending / confirmed / rejected
  +decision_admin : text
  +reviewed_by : uuid <<FK User>>
  +created_at : timestamptz
}

class BlockedUser {
  +blocker_id : uuid <<FK User>>
  +blocked_id : uuid <<FK User>>
  +created_at : timestamptz
}

class PushToken {
  +id : uuid <<PK>>
  +user_id : uuid <<FK User>>
  +expo_token : text
  +platform : enum  // ios / android
  +revoked_at : timestamptz
}

User "1" o-- "0..*" Annonce : publie >
Categorie "1" -- "0..*" Annonce : classifie
Annonce "1" o-- "0..*" Conversation : ancre <
User "1" -- "0..*" Conversation : acheteur
User "1" -- "0..*" Conversation : vendeur
Conversation "1" *-- "0..*" Message : contient >
User "1" -- "0..*" Message : envoie
Conversation "1" -- "0..2" Avis : note (symétrie)
User "1" -- "0..*" Avis : auteur
User "1" -- "0..*" Avis : cible
User "1" -- "0..*" Favori
Annonce "1" -- "0..*" Favori
User "1" -- "0..1" VerificationIdentite : possède
User "1" -- "0..*" PaiementNiqo
User "1" -- "0..*" Signalement : auteur
User "1" -- "0..*" Signalement : cible
User "1" -- "0..*" BlockedUser : blocker
User "1" -- "0..*" BlockedUser : blocked
User "1" -- "0..*" PushToken

note right of BlockedUser
  PK composite (blocker_id, blocked_id)
  CHECK (blocker_id != blocked_id)
  Trigger BEFORE INSERT messages
  raise 'BLOCKED_BY_RECIPIENT'
end note

note right of Conversation
  Le RDV est porté par la conv
  (pas de table RDV dédiée).
  Choix : 1 conv = 1 négociation,
  1 RDV max actif par conv.
end note

note bottom of Avis
  Contrainte UNIQUE (conv_id, auteur_id)
  Cron quotidien crée des Avis
  est_auto_3=true après 7j de silence
end note

@enduml
```

### 6.4 Choix de modélisation

- **`Conversation` porte le RDV** (et non une table `RDV` séparée). Justification : un acheteur ne négocie pas en parallèle plusieurs RDV avec le même vendeur sur la même annonce. Cette décision est tracée mig 35 et explicitée dans `docs/backend/rdv.md`.
- **`PaiementNiqo` est générique** (KYC + boost + levée suspension dans la même table). Justification : champs identiques (PawaPay), 3 tables séparées auraient dupliqué la logique webhook.
- **`Avis` symétrique** : un acheteur **et** un vendeur peuvent chacun noter l'autre via la même table, distingués par `(auteur_id, cible_id)`. Permet d'unifier la requête « historique des notes » côté profil public.
- **`BlockedUser` en clé composite** sans `id` artificiel : la paire (blocker, blocked) **est** la clé naturelle, l'unicité est gratuite, le trigger d'anti-bypass devient trivial.

---

## 7. Diagramme 3 — Séquence (trois scénarios critiques)

J'ai retenu **trois scénarios** qui ensemble couvrent les flux les plus complexes du projet et les plus représentatifs pour la soutenance.

### 7.1 Scénario A — Demande de vérification d'identité (F07)

```plantuml
@startuml Sequence_KYC
title F07 — Vérification d'identité (KYC) avec paiement PawaPay
autonumber

actor "Utilisateur" as U
participant "App mobile\n(Expo)" as APP
participant "Supabase Auth\n+ Storage" as SUPA
participant "RPC\nsubmit_kyc_request" as RPC
database "PostgreSQL\n(verifications_\nidentite)" as DB
participant "Edge Function\npawapay-init-deposit" as EF1
participant "PawaPay API" as PP
participant "Edge Function\npawapay-webhook" as EF2
participant "Admin web\nNext.js" as ADM
actor "Admin Niqo" as A
participant "Resend\n(email)" as MAIL

U -> APP : Ouvre VerifIntro
APP -> U : Affiche tarif (1000 FCFA) et conditions
U -> APP : Capture CNI recto + verso + selfie
APP -> SUPA : Upload 3 photos\nbucket=cni-verifications\nRLS owner-only
SUPA --> APP : URLs signées
APP -> RPC : submit_kyc_request(urls, numero_cni)
RPC -> DB : INSERT verifications_identite\nstatut='pending'
DB --> RPC : id
RPC --> APP : verif_id
APP -> EF1 : POST /pawapay-init-deposit\n{ type:'kyc', verif_id, montant:1000 }
EF1 -> PP : POST /v2/deposits (signed)
PP --> EF1 : { depositId, status:'ACCEPTED' }
EF1 -> DB : INSERT paiements_niqo\nstatut='pending'
EF1 --> APP : { depositId, redirect_url }
APP -> U : Affiche flow MoMo (OTP utilisateur)
PP -> U : SMS OTP
U -> PP : Confirme OTP
PP -> EF2 : Webhook signé HMAC SHA-256
EF2 -> EF2 : Vérifie signature\nGET /v2/deposits/{id}\n(double-check)
EF2 -> DB : UPDATE paiements_niqo\nstatut='succeeded'
EF2 -> DB : UPDATE verifications_identite\npaid=true
EF2 --> PP : 200 OK

== Validation admin (asynchrone, <24h) ==

A -> ADM : Ouvre /admin/verifications
ADM -> DB : SELECT verifications_identite\nWHERE statut='pending' AND paid=true
ADM --> A : Liste avec photos
A -> ADM : Tap "Valider"
ADM -> DB : UPDATE verifications_identite\nstatut='approved'
ADM -> DB : UPDATE users\nis_verified=true
ADM -> MAIL : Resend template "KYC validé"
MAIL --> U : Email confirmation
ADM -> DB : INSERT audit_log_admin\n(action='kyc_validate', before, after)

@enduml
```

### 7.2 Scénario B — Modération asynchrone d'un message (F04 + couche 4)

```plantuml
@startuml Sequence_ModerationAsync
title F04 — Modération message asynchrone (mig 119-120)
autonumber

actor "Vendeur (offensant)" as V
actor "Acheteur" as A
participant "App mobile" as APP
database "PostgreSQL" as DB
participant "Trigger\nfn_moderate_\nmessage" as TR
participant "pg_net\nhttp_post" as PGN
participant "Edge Function\nmoderate-message" as EF
participant "OpenAI\nModeration API" as OAI
participant "Resend" as MAIL

V -> APP : Envoie "Paye-moi 50000 Western Union d'abord"
APP -> DB : INSERT messages\n(type='texte', contenu)
DB -> TR : AFTER INSERT messages
TR -> TR : Skip si type != 'texte'\nou sender = système

note right of TR
  Fire-and-forget :
  le trigger N'ATTEND PAS
  la réponse OpenAI pour
  valider l'INSERT.
end note

TR -> PGN : http_post(\n  url=/moderate-message,\n  body={message_id, contenu},\n  headers={NIQO_INTERNAL_KEY})
TR --> DB : COMMIT (le message est livré)
DB --> APP : Realtime push
APP --> A : Message visible

EF -> OAI : POST /v1/moderations\n{ input: contenu }
OAI --> EF : { flagged: true, categories: {harassment: 0.91} }

alt flagged = true
  EF -> DB : INSERT signalements\n(auteur_id = SYSTEM_USER,\n cible_id = V,\n categorie='message',\n description='Auto-mod : harassment 0.91')
  EF -> DB : INSERT messages (type='systeme',\n  contenu='Tentative de fraude\n  détectée. Restez en sécurité.')
  DB -> APP : Realtime push msg système
  APP --> A : Bandeau de protection
  APP --> V : Push privative dissuasion
  EF -> MAIL : Notif admin (digest)
end

@enduml
```

### 7.3 Scénario C — Bloquer un utilisateur (F15, ajouté après rejet Apple)

```plantuml
@startuml Sequence_Block
title F15 — Bloquer un utilisateur (Apple Guideline 1.2 UGC)
autonumber

actor "Acheteur (Bob)" as B
actor "Vendeur (Mallory,\nmalveillant)" as M
participant "App mobile" as APP
participant "RPC block_user" as RPC
database "PostgreSQL\n(blocked_users)" as DB
participant "Trigger\nfn_messages_\nblock_check" as TR
participant "Realtime\nsupabase_realtime" as RT
participant "Resend\n(admin notif)" as MAIL

B -> APP : Profil de Mallory > kebab > "Bloquer"
APP -> APP : Confirmation BlockUserSheet
B -> APP : Confirme
APP -> RPC : block_user(target_id = M)
RPC -> DB : INSERT blocked_users\n(blocker=B, blocked=M)\nON CONFLICT DO NOTHING
RPC -> DB : INSERT signalements\n(auteur=B, cible=M,\n categorie='user',\n description='Block silencieux')\nON CONFLICT DO UPDATE

note right of RPC
  "Notify the developer" Apple :
  chaque block produit un
  signalement implicite, même
  si le bloqué a déjà été signalé.
end note

RPC -> MAIL : _notify_admin_email\n(via xmax=0 detection)
RPC --> APP : { ok: true }
RT --> APP : Realtime broadcast block

APP -> APP : useBlockedUsers refresh Set
APP -> APP : excludeVendeurIds en mémoire

== Anti-bypass canal chat ==

M -> APP : Tente d'envoyer un message à B
APP -> DB : INSERT messages\n(conversation_id, sender=M)
DB -> TR : BEFORE INSERT messages
TR -> DB : SELECT 1 FROM blocked_users\nWHERE blocker=B AND blocked=M
DB --> TR : Trouvé
TR -> TR : RAISE EXCEPTION\n'BLOCKED_BY_RECIPIENT'
TR --> APP : Erreur Postgres remontée
APP -> M : Toast "Impossible d'envoyer"

note right of TR
  Inviolable même depuis
  l'API REST directe :
  la barrière est en DB,
  pas dans le code applicatif.
end note

@enduml
```

---

## 8. Diagramme 4 — État-transition

### 8.1 Lifecycle d'une annonce (CDC v4.0, mig 39)

```plantuml
@startuml State_Annonce
title Cycle de vie d'une annonce
[*] --> active : INSERT annonce\n(via wizard 5 étapes)

active --> en_cours : RDV confirmé\n(trigger fn_annonce_\nstatut_on_rdv_change)
en_cours --> active : cancel_rdv\nsi plus aucun RDV confirmé
en_cours --> vendue : mark_annonce_vendue\n(voix acheteur prioritaire)

active --> expiree : Cron nocturne\n(expires_at < NOW())
expiree --> active : Prolongation 28j\n(action vendeur)

active --> suspendue : ≥ 3 signalements\nconfirmés en 30j
en_cours --> suspendue : (idem)
suspendue --> active : Levée admin\n+ 1000 FCFA PawaPay

vendue --> [*]
suspendue --> [*] : Purge J+88\n(droit à l'oubli)
expiree --> [*] : Purge J+88

@enduml
```

### 8.2 Lifecycle d'une vérification KYC

```plantuml
@startuml State_KYC
title Cycle de vie d'une vérification d'identité (F07)
[*] --> pending : submit_kyc_request\n(photos uploadées)

pending --> paid : Webhook PawaPay\nsucceeded (1000 FCFA)
pending --> abandonned : Cron 24h\nsi paiement non finalisé

paid --> approved : Admin valide\n(< 24h ouvré)
paid --> rejected : Admin refuse\n(motif obligatoire)

rejected --> pending : Resubmit possible\n(nouveau paiement 1000 FCFA)

approved --> revoked : Décision admin\npost-fraude détectée

approved --> [*]
revoked --> [*]
abandonned --> [*]

note right of approved
  Side-effects :
  - users.is_verified = true
  - badge "Vendeur Vérifié"
  - cron purge selfie J+7
  - email Resend
  - push notification
end note

@enduml
```

---

## 9. Diagramme 5 — Activité

### 9.1 Parcours acheteur (browse-first → notation post-RDV)

```plantuml
@startuml Activity_AcheteurFlow
title Parcours type acheteur — Browse-first jusqu'à la notation
|Visiteur anonyme|
start
:Ouvre l'app Niqo;
if (premier lancement ?) then (oui)
  :CountryPicker (CI/CG/RW);
  :AsyncStorage.setItem\n'niqo_country';
else (non)
endif

:Parcourt le feed\nfiltré par pays;
:Tap sur une annonce;

if (Action sensible ?) then (oui : Contacter / Favori / Vendre)
  |Auth Gate|
  :Inscription Google /\nApple / Email;
  :complete_profile\n(prénom, nom, tel, pays, photo);
  |Utilisateur|
else (non)
  |Visiteur anonyme|
  stop
endif

:Tap "Contacter le vendeur";
:Conversation Realtime;

note right
  Filtre 4 couches en arrière-plan :
  trigger DB, OpenAI texte,
  AWS Rekognition image,
  OpenAI message async.
end note

:Négociation prix;
:Tap "Proposer un RDV"\n(date + heure + lieu);

|Vendeur|
:Reçoit push;
if (Accepte ?) then (oui)
  :rdv_confirme = true;
else (non)
  :Contre-proposition\nou refus;
  |Utilisateur|
  stop
endif

|Utilisateur|
:Reçoit push confirmation;
:Reminder J-1 et jour J;
:Se rend au RDV;
:Inspection + paiement direct\n(cash ou MM, hors Niqo);

if (Marquer vendu ?) then (oui)
  :mark_annonce_vendue;
else (non)
  :Flow "RDV non réalisé"\n→ optionnel : signalement;
endif

:Note 1-5 + commentaire;
note right
  Si silence > 7j,
  cron auto-set 3/5
  et clôt la notation.
end note

stop
@enduml
```

---

## 10. Diagramme 6 — Déploiement

### 10.1 Vue d'ensemble de l'infrastructure

```plantuml
@startuml Deployment_Niqo
title Niqo — Diagramme de déploiement (2026-05-19)
skinparam node {
  BackgroundColor #F5F7FA
  BorderColor #2C3E50
}

node "Appareils utilisateurs" {
  node "iOS\n(iPhone 8+ \niOS 15+)" as IOS {
    artifact "Niqo.ipa\n1.0.0(6) LIVE" as APP_IOS
  }
  node "Android\n(Tecno Spark /\nItel A56)" as AND {
    artifact "Niqo.aab\n1.0.0(1) closed" as APP_AND
  }
}

cloud "Apple APNs" as APNS
cloud "Firebase FCM\n(Phase 2)" as FCM
cloud "Expo Push\nservers" as EXPO

node "Vercel\n(CDN mondial)" as VERCEL {
  artifact "niqo.africa\nNext.js 16" as WEB {
    component "/ (landing)" as L1
    component "/legal/*" as L2
    component "/support" as L3
    component "/a/[id]" as L4
    component "/admin/*\n(httpOnly cookies)" as L5
    component "/suppression-compte" as L6
  }
}

node "Supabase Cloud\n(eu-west-1, Irlande)" as SUPA {
  database "PostgreSQL 15" as PG {
    artifact "~50 tables\n132 migrations\n~80 RPCs\n~30 triggers\n12 crons\nRLS partout" as SCHEMA
  }
  component "Supabase Auth\n(Google/Apple/Email)" as AUTH
  component "Supabase Storage" as STO {
    folder "bucket\nannonces-photos\n(public)" as B1
    folder "bucket\ncni-verifications\n(private)" as B2
    folder "bucket\navatars\n(public)" as B3
  }
  component "Supabase Realtime\n(websocket)" as RT
  component "Edge Functions\nDeno × 13" as EF {
    artifact "pawapay-init-deposit" as F1
    artifact "pawapay-webhook" as F2
    artifact "moderate-text" as F3
    artifact "moderate-image" as F4
    artifact "moderate-message" as F5
    artifact "send-push-notification" as F6
    artifact "delete-user-account" as F7
  }
}

cloud "PawaPay API v2\n(Mobile Money)" as PP
cloud "OpenAI\nModeration API" as OAI
cloud "AWS Rekognition\n(eu-west-1)" as AWS
cloud "Resend\n(emails tx)" as RES
cloud "Sentry × 3 projets" as SENTRY {
  component "niqo-mobile" as S1
  component "niqo-admin" as S2
  component "niqo-edge" as S3
}

APP_IOS -[#blue]-> SUPA : HTTPS\nREST + WS
APP_AND -[#blue]-> SUPA : HTTPS\nREST + WS
APP_IOS --> APNS : push direct
APP_AND ..> FCM : push prod\n(Phase 2)
APNS <-- EXPO
FCM <-- EXPO
EF --> EXPO : send-push

WEB --> SUPA : SSR cookies
EF --> PG : service role
EF --> PP : HTTPS signé HMAC
EF --> OAI : HTTPS Bearer
EF --> AWS : HTTPS sigV4
EF --> RES : HTTPS Bearer
PP --> F2 : webhook signed

APP_IOS --> S1
APP_AND --> S1
WEB --> S2
EF --> S3

@enduml
```

### 10.2 Lecture du diagramme

- **3 surfaces clients** (iOS, Android, Web) + **1 backend Supabase** + **6 services tiers**.
- **iOS LIVE** via APNs direct (pas besoin de FCM côté iOS).
- **Android FCM** à brancher pour la prod (Phase 2 imminente, cf. CDC §9.3).
- **Sentry × 3 projets** : isolation par surface pour faciliter le triage des incidents (Edge Function ≠ Mobile ≠ Admin).
- **Edge Functions** centralisent les appels aux tiers payants (signature HMAC, secrets jamais exposés côté client).

---

## 11. Mapping vers les blocs RNCP CDA

Le titre **Concepteur Développeur d'Applications** (RNCP 31678) couvre 3 blocs de compétences. Voici comment chaque diagramme UML produit alimente la preuve de compétence en soutenance.

| Diagramme | Bloc RNCP1 (Application sécurisée) | Bloc RNCP2 (Multicouche répartie) | Bloc RNCP3 (Déploiement & tests) |
|---|---|---|---|
| **Use Case** | Auth gate, droits visiteur/user/vérifié/admin | Rôles distincts par surface (mobile vs admin web) | — |
| **Classes** | Modélisation `BlockedUser` anti-bypass, audit_log_admin | Conception relationnelle ~50 tables, RLS par classe | — |
| **Séquence KYC** | Chaîne paiement signée HMAC, double-check webhook | Edge Function ↔ DB ↔ PawaPay ↔ Resend | Webhook idempotent testé pgTAP |
| **Séquence Modération** | Modération 4 couches, défense en profondeur | Trigger DB + pg_net + Edge Function + OpenAI | Tests gated `OPENAI_AVAILABLE` |
| **Séquence Block** | Trigger inviolable BEFORE INSERT, anti-bypass | Couche client + couche DB + Realtime sync | Tests pgTAP `tests/sql/moderate_message.test.sql` |
| **État Annonce** | Statuts contrôlés, transitions tracées audit | Triggers DB + cron + RPC admin | Lifecycle testé end-to-end Vitest |
| **État KYC** | RGPD purge selfie J+7, audit log validation | Edge Function + cron + admin web | Tests `tests/sql/kyc.test.sql` |
| **Activité acheteur** | Browse-first + auth gate + safety tips | Mobile ↔ Supabase ↔ tiers | Beta 10 users (en cours) |
| **Déploiement** | RLS partout, Vault téléphone, Sentry 3 projets | 3 surfaces + 1 backend + 6 tiers | EAS Build, Vercel, OTA vs rebuild documenté |

---

## 12. Limites, traçabilité et évolutions

### 12.1 Limites assumées

- **Niveau de détail** : les diagrammes ne représentent pas chaque attribut ou chaque RPC. La source de vérité reste le code (`supabase/migrations/`, `lib/`, `landing/src/`) et la doc backend par module (`docs/backend/*.md`).
- **Pas de diagramme de communication** : redondant avec les diagrammes de séquence pour ce projet.
- **Pas de diagramme de composants** distinct : fusionné avec le déploiement vu la granularité monolithique de Supabase.
- **Diagramme de classes monolithique** : 12 entités sur 50 tables. Une vue exhaustive par domaine sera produite en Phase 2 si la complexité l'exige.

### 12.2 Traçabilité diagrammes ↔ code

| Diagramme | Source de vérité code |
|---|---|
| Use Case | `app/` (Expo Router file-based) + `landing/src/app/admin/` |
| Classes | `supabase/migrations/01_*.sql` à `132_*.sql` + `docs/migrations/INDEX.md` |
| Séquence KYC | `supabase/functions/pawapay-*/index.ts` + `landing/src/app/admin/verifications/` + mig 43-55, 72-73, 75 |
| Séquence Modération | `supabase/functions/moderate-message/index.ts` + mig 119-120 + `docs/backend/moderation.md` |
| Séquence Block | `supabase/functions/` + `lib/blocking.ts` + mig 129-132 + `docs/backend/blocking.md` |
| État Annonce | Trigger `fn_annonce_statut_on_rdv_change` (mig 39) + cron expiration + RPC `mark_annonce_vendue` |
| État KYC | `verifications_identite.statut` + `landing/src/app/admin/verifications/[id]/` |
| Activité acheteur | `app/index.tsx` → `app/search.tsx` → `app/annonce/[id].tsx` → `app/messages/[conversationId].tsx` |
| Déploiement | `eas.json` + `app.json` + `landing/vercel.json` + `supabase/config.toml` + `CLAUDE.md` §Stack |

### 12.3 Évolutions Phase 2

- **Diagramme de composants** pour le Pack Vendeur Pro (M3) si la facturation récurrente justifie une séparation.
- **Diagramme d'état RDV** isolé (proposé → confirmé → réalisé → noté) si on bascule le RDV dans sa propre table.
- **Diagramme de séquence FCM** pour la mise en production Android.
- **Diagramme de communication DSA Trader** quand on ouvrira la distribution UE.

---

## Annexe — Rendu des diagrammes PlantUML

Tous les blocs ` ```plantuml ` ci-dessus sont rendus :

- **dans VSCode** via l'extension *PlantUML* (Jebbs) — `Alt+D` ouvre la preview ;
- **en CLI** via `plantuml -tsvg docs/methodologie-uml.md` (extrait automatiquement les blocs) ;
- **pour le PDF de soutenance** via `pandoc docs/methodologie-uml.md --filter pandoc-plantuml -o soutenance-uml.pdf`.

Les fichiers `.puml` autonomes peuvent être extraits dans `docs/uml/` à la demande pour faciliter le versioning indépendant.

---

> **Document soutenu lors de la session de jury RNCP CDA — 2026.**
> Auteur : Dominique Huang — Date : 2026-05-19 — Version : 1.0
> À lire avec : [docs/CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md), [docs/architecture/v4-deltas.md](architecture/v4-deltas.md), [docs/migrations/INDEX.md](migrations/INDEX.md).

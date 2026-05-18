# CHANGELOG — documents légaux Niqo

> Journal des modifications matérielles des documents juridiques publiés. Cette traçabilité permet de prouver, en cas de litige, **quelle version chaque utilisateur a accepté** au moment de son inscription ou de son utilisation continue.
>
> Toute modification matérielle doit :
> 1. Incrémenter la version du document concerné
> 2. Mettre à jour la date dans le frontmatter du `.md` source
> 3. Mettre à jour `LEGAL_VERSIONS` dans `lib/legal.ts`
> 4. Notifier les utilisateurs au moins **15 jours** avant l'entrée en vigueur (bannière in-app)
> 5. Ajouter une entrée ci-dessous

---

## Mentions légales v1.1 → v1.2 — 2026-05-14

**Identité officielle NIQO LTD posée**, en remplacement des placeholders « à compléter ». Données extraites du certificat RDB Rwanda (`docs/certificate-NIQO-LTD.pdf`, RDB serial 261170857304440, printing date 2026-04-27).

### Changements (`docs/legal/mentions-legales.md` + `app/legal/mentions-legales.tsx`)

- **§1 Éditeur du service** :
  - Raison sociale : « Niqo Ltd » → **« NIQO LTD »** (forme exacte au registre RDB)
  - Forme juridique : « SARL de droit rwandais » → **« Société de droit rwandais — Private Company Limited By Shares »**
  - Ajout **Loi applicable** : Article 23 of Law N° 007/2021 of 05/02/2021
  - **TIN RDB** : *à compléter* → **150644832**
  - Ajout date d'enregistrement : 2025-11-10
  - Ajout régulateur : Office of the Registrar General (RDB)
  - Ajout code activité : J6201 — Computer programming activities
  - **Capital social** : *à compléter* → **1 000 000 RWF (1 000 actions × 1 000 RWF)**
  - **Siège social** : « Kigali, Rwanda » + *adresse à compléter* → **KG 622 St, Rebero, Rugando, Kimihurura, Gasabo, Kigali, Rwanda**

- **§8 Représentant local et DPO** (mobile uniquement, alignement v1.2 CG-only) : suppression du bullet « Représentant local en Côte d'Ivoire » → repris dans la note explicative (« Le représentant local en Côte d'Ivoire sera désigné lors de l'extension Phase 2 »).

- **Renommage transverse** : 16 occurrences « Niqo Ltd » → « NIQO LTD » (cohérence registre RDB).

Aucun changement matériel de droits ou d'obligations — il s'agit d'une mise à jour de l'identité légale officielle qui rend le document opposable juridiquement (Law 007/2021 art. 13).

### Synchronisation `lib/legal.ts`

L'objet `LEGAL_VERSIONS` était désynchronisé du frontmatter des `.md` (encore en v1.0/v1.1 du 2026-05-10 alors que les docs canoniques avaient été bumpés en v1.1/v1.2 le 2026-05-11). Resynchronisation effectuée :

| Document | Avant | Après |
|---|---|---|
| cgu | 1.1 (2026-05-10) | **1.2 (2026-05-11)** |
| cgv | 1.0 (2026-05-10) | **1.1 (2026-05-11)** |
| privacy | 1.1 (2026-05-10) | **1.2 (2026-05-11)** |
| mentionsLegales | 1.0 (2026-05-10) | **1.2 (2026-05-14)** |
| charteCommunautaire | 1.0 (2026-05-10) | **1.1 (2026-05-11)** |
| cookies | 1.0 (2026-05-10) | **1.1 (2026-05-11)** |

---

## v1.2 — 2026-05-11

**Resserrement du périmètre — Congo Brazzaville uniquement** pour le soft launch.

Le pack légal v1.1 couvrait CI + CG. Décision produit : lancer d'abord au **Congo Brazzaville uniquement**, l'extension à la Côte d'Ivoire passe en **Phase 2**. Cette version retire les références CI des engagements contractuels (juridiction, opérateurs Mobile Money, autorités de protection des données, biens interdits spécifiques) tout en gardant des notes explicites « Phase 2 » pour informer le lecteur (et l'avocat) du caractère temporaire de ce périmètre.

### CGU — version 1.1 → 1.2

- **Encart de tête** : ajout du périmètre v1.2 (CG uniquement, extension CI = Phase 2).
- **§1 (présentation)** : « en Côte d'Ivoire et au Congo Brazzaville » → « au Congo Brazzaville ».
- **§2 (inscription)** : condition de résidence resserrée au CG.
- **§4 (interdictions)** : suppression du renvoi à l'ARTCI dans la liste des autorités de signalement.
- **§5 (annonces)** : « conforme à la loi du pays de publication (CI ou CG) » → « conforme à la loi congolaise ».
- **§12 (sécurité)** : retrait ARTCI dans la liste des autorités notifiées en cas d'incident.
- **§15 (loi applicable / juridiction)** : suppression du paragraphe spécifique aux utilisateurs ivoiriens (ARTCI + juridictions ivoiriennes).
- **§16 (représentant local)** : engagement resserré au Congo Brazzaville uniquement.

### CGV — version 1.0 → 1.1

- **Encart de tête** : ajout du périmètre v1.1 (CG uniquement).
- **§1 (préambule)** : utilisateurs « domiciliés en Côte d'Ivoire ou au Congo Brazzaville » → « domiciliés au Congo Brazzaville ».
- **§5.2 (modes de paiement)** : suppression de la ligne « Côte d'Ivoire : Orange Money, MTN MoMo, Moov Money, Wave ». Seuls **Airtel Money + MTN MoMo (CG)** subsistent.
- **§4.3 (disponibilité)** : exemples d'opérateurs resserrés au CG.
- **§10.2 + §13** : « ivoiriens et congolais » → « congolais ».

### Politique de confidentialité — version 1.1 → 1.2

- **Encart de tête** : retrait de la ligne « 🇨🇮 Loi 2024-30 (Côte d'Ivoire) — régulateur ARTCI » du cadre légal applicable. Ajout du périmètre v1.2.
- **§2 (responsable de traitement)** : « Représentant local (CI / CG) » → « Représentant local au Congo Brazzaville ». Engagement ARTCI retiré.
- **§3.1 (identification)** : « Pays (CI ou CG, choisi au 1er lancement) » → « Pays de résidence (Congo Brazzaville au lancement) ».
- **§3.4 (paiement)** : opérateurs « Orange, MTN, Airtel, Moov, Wave » → « Airtel Money, MTN MoMo » (congolais uniquement).
- **§3.5 (techniques)** : retrait de la mention « pays » dans les préférences locales AsyncStorage.
- **§6 (transferts internationaux)** : retrait Côte d'Ivoire dans la liste des standards reconnus.
- **§8.1 (notification incident)** : ARTCI retiré de la liste des autorités notifiées.
- **§9 (droits)** : référence légale « lois ARTCI 2024-30, ANRTIC 2023-15, NCSA 2021-058 » → « lois ANRTIC 2023-15, NCSA 2021-058 ».
- **§10.1 (cookies mobile)** : retrait du choix de pays parmi les données stockées localement.
- **§13 (recours)** : suppression de la ligne ARTCI ([artci.ci](https://artci.ci)).

### Charte communautaire — version 1.0 → 1.1

- **Encart de tête** : ajout du périmètre v1.1 + note spécificités ivoiriennes en Phase 2.
- **§1 (esprit Niqo)** : « particuliers ivoiriens et congolais » → « particuliers congolais ».
- **§4.1** : titre « Interdictions communes (CI + CG) » → « Interdictions générales (CG) ».
- **§4.2 (spécificités CI)** : **section entièrement supprimée** (or natif Kimberley, cacao CCC, OIPR, armes traditionnelles ivoiriennes, médicaments, etc.) — à réintégrer en Phase 2.
- **§4.3 → §4.2** : renumérotation de la section Congo Brazzaville (anciennement 4.3).

### Mentions légales — version 1.0 → 1.1

- **Encart de tête** : ajout du périmètre v1.1.
- **§3.3 (PawaPay)** : opérateurs resserrés (Airtel Money + MTN MoMo au CG uniquement).
- **§8 (représentant local)** : suppression de la ligne « Représentant local en Côte d'Ivoire ». Note explicite que la désignation interviendra lors de l'extension Phase 2.

### Politique cookies — version 1.0 → 1.1

- **§3 (base légale)** : « lois CI 2024-30, CG 2023-15, RW 2021-058 » → « lois CG 2023-15, RW 2021-058 ».

### Pack avocat

- Régénération de `assets/legal-pdf/niqo-pack-legal-v1.2.pdf` (CG only) — 6 documents + page de couverture mise à jour (audience CG, pays opérés CG, régulateurs ANRTIC + NCSA uniquement, note période v1.2 sur le périmètre temporaire).

---

## v1.1 — 2026-05-10

**Pack légal solide complet** — pré-lancement public, premier jet "qui dépanne sans avocat".

### CGU — version 1.0 → 1.1

- **§1 (présentation)** : ajout du **statut hébergeur** explicite (régime de responsabilité limitée pour les contenus user-generated). Mention de Niqo Ltd (raison sociale).
- **§4 (interdictions)** : renvoi explicite à la **Charte communautaire** pour la liste détaillée des biens interdits par pays. Ajout du droit à l'image.
- **§5 (annonces)** : ajout du droit pour Niqo de retirer toute annonce non-conforme sans préavis ni remboursement.
- **§6 (rencontre)** : phrase explicite "Niqo ne te contactera jamais pour te demander tes identifiants ou un transfert d'argent" (anti-phishing).
- **§7 (notation)** : section dédiée (auparavant §10).
- **§8 (services payants)** : nouvelle section qui **renvoie aux CGV** distinctes (auparavant noyé dans §7-8).
- **§9 (signalements)** : split en 3 sous-sections — 9.1 utilisateurs, **9.2 notice-and-takedown** (NOUVEAU — canal pour ayants droit et autorités), **9.3 procédure d'appel** (NOUVEAU — droit de recours formalisé sous 15 jours).
- **§10 (PI)** : précision de la durée de la licence accordée à Niqo (durée légale des droits d'auteur, cesse à la suppression).
- **§11 (responsabilité)** : ajout d'une **valeur plancher** (50 000 FCFA) pour les utilisateurs n'ayant payé aucun service. Ajout du non-exclusion en cas de dol/faute lourde.
- **§12 (sécurité)** : nouvelle section dédiée — incident response 72h + canal `security@niqo.africa` pour responsible disclosure.
- **§16 (DPO et représentant local)** : NOUVEAU — engagement à désigner un représentant local CI + CG dans les 6 mois suivant le lancement public.
- **§17 (contact)** : ventilation des canaux (`support`, `legal`, `dpo`, `security`) au lieu d'un seul `support`.

### Politique de confidentialité — version 1.0 → 1.1

- **§2 (responsable de traitement)** : ajout du **DPO** dédié (`dpo@niqo.africa`) et engagement représentant local 6 mois.
- **§5 (sous-traitants)** : passage en tableau structuré, ajout de **Vercel** (hébergement web).
- **§6 (transferts internationaux)** : précision sur les **clauses contractuelles types** comme garantie pour les transferts hors UE/Rwanda. Possibilité de demander copie des CCT.
- **§7 (durées)** : passage en tableau, ajout des durées pour : compte inactif (5 ans + anonymisation), logs d'audit admin (5 ans), tokens push (90 jours après désinstallation).
- **§8 (sécurité)** : split en sous-sections, ajout du canal `security@niqo.africa` (responsible disclosure), précision Argon2 pour le hashage des mots de passe Supabase.
- **§9 (droits)** : ajout du **droit à la limitation**, **droit de ne pas faire l'objet d'une décision automatisée**, précision sur le délai de réponse 30 jours (extensible 30 jours).
- **§10 (cookies)** : split mobile / web, renvoi à la **Politique cookies** dédiée (NOUVEAU).
- **§11 (mineurs)** : escalade du contact vers `dpo@niqo.africa`.
- **§14 (contact)** : ajout du `security@niqo.africa`.

### CGV — NOUVEAU document

- Création du document distinct des CGU pour clarifier le régime des services payants (boost, KYC, levée suspension).
- **§6** : exclusion expresse du droit de rétractation pour services numériques pleinement exécutés, avec consentement explicite via case à cocher distincte sur l'écran de paiement (légalement requis pour la non-remboursabilité).
- **§6.3** : cas explicites de **remboursement accordé** (échec technique imputable à Niqo, double facturation, erreur manifeste).
- **§5.4** : engagement de facture électronique simplifiée par email + facture détaillée disponible sur demande.

### Mentions légales — NOUVEAU document

- Identification claire de l'éditeur (Niqo Ltd, Rwanda), du directeur de publication (Dominique Huang).
- Liste des hébergeurs et sous-traitants (Supabase, Vercel, PawaPay, Resend, Expo, Apple, Google).
- Procédure de signalement de contenu illicite (§9, renvoi au notice-and-takedown des CGU).
- Champs **à compléter** identifiés : numéro RDB, capital, adresse postale complète (à publier dès délivrance officielle, au plus tard à la mise en production publique).

### Charte communautaire — NOUVEAU document

- Esprit Niqo en 3 principes (respect / honnêteté / légalité).
- Comportements attendus (description précise, réactivité, ponctualité, bienveillance, vérité dans les notes).
- Comportements interdits détaillés (harcèlement, faux signalements, spam, contournement, phishing, usurpation, paiement anticipé, scraping, droit à l'image).
- **§4 (biens interdits par pays)** : liste détaillée — interdictions communes (armes, drogues, médicaments, tabac/alcool revendus par particuliers, espèces CITES, contrefaçons, sang/organes, contenus adultes, services illégaux) + spécificités Côte d'Ivoire (cacao circuit officiel, médicaments pharmacies agréées) + spécificités Congo (bois précieux, viande de brousse, espèces protégées).
- **§5** : catégories sensibles autorisées sous conditions (véhicules, téléphones, bijoux, immobilier, animaux domestiques).
- **§6 (procédure de signalement)** : sanctions graduées en 4 niveaux + auto-suspension à 3 signalements + recours d'appel 15 jours.

### Politique cookies — NOUVEAU document (web only)

- Précision : **mobile = aucun cookie**.
- Liste exhaustive des cookies web : sb-auth-token, sb-auth-token-code-verifier (PKCE).
- Catégorisation : strictement nécessaires uniquement, **pas d'analytique, pas de publicité, pas de tracking tiers**.
- Engagement : tout futur cookie analytique/marketing sera précédé d'un bandeau de consentement explicite.

---

## v1.0 — 2026-05-07

Premier jet rédigé en interne, hors transaction (modèle v4.0).

- **CGU** : 16 sections couvrant inscription, comportement, annonces, mise en relation, notation, vérification d'identité, boosts, signalements, suspension, modifications, juridiction.
- **Politique de confidentialité** : 14 sections couvrant collecte, finalités, sous-traitants (Supabase, PawaPay, Resend, Expo), transferts, durées, sécurité, droits, cookies, mineurs, recours.
- Cible : ARTCI 2024-30 (CI), ANRTIC 2023-15 (CG), NCSA 2021-058 (RW).
- Affiché in-app via `app/legal/cgu.tsx` et `app/legal/confidentialite.tsx`. Versioning unique via `LEGAL_LAST_UPDATED` (`lib/legal.ts`).

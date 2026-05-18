---
title: Politique de confidentialité
slug: confidentialite
version: 1.2
date: 2026-05-11
audience: tout utilisateur ou visiteur
---

# Politique de confidentialité

> Dernière mise à jour : 2026-05-11 — version 1.2
>
> **Périmètre v1.2** : Niqo lance d'abord au **Congo Brazzaville uniquement**. L'extension à la Côte d'Ivoire (et l'intégration du cadre ARTCI 2024-30) est prévue en **Phase 2**.
>
> **Cadre légal applicable :**
> - 🇨🇬 Loi 2023-15 (Congo Brazzaville) — régulateur ANRTIC
> - 🇷🇼 Loi 2021-058 (Rwanda) — régulateur NCSA, lieu d'immatriculation

## 1. Préambule

Cette Politique de confidentialité décrit comment Niqo collecte, utilise, partage et protège tes données personnelles. Elle complète les Conditions Générales d'Utilisation et s'applique à toute personne utilisant l'application mobile, le site web (`niqo.africa`) et les services Niqo.

En utilisant Niqo, tu reconnais avoir pris connaissance de cette politique. Si tu n'es pas d'accord, n'utilise pas la plateforme.

## 2. Responsable de traitement et DPO

- **Responsable de traitement** : **Niqo Ltd**, immatriculée au Rwanda (Kigali)
- **Délégué à la Protection des Données (DPO)** : **dpo@niqo.africa**
- **Représentant local au Congo Brazzaville** : à désigner dans les 6 mois suivant le lancement public, conformément aux exigences ANRTIC. Mise à jour publiée dans les Mentions légales.

Pour toute question relative à tes données personnelles, contact privilégié : **dpo@niqo.africa**.

## 3. Données collectées et finalités

Niqo collecte uniquement les données strictement nécessaires au fonctionnement du service. Voici la liste exhaustive :

### 3.1 Données d'identification

- Email (obligatoire pour créer un compte)
- Prénom, nom, ville, quartier (saisis par toi)
- Numéro de téléphone Mobile Money (chiffré côté serveur via Supabase Vault, jamais exposé en clair via l'API publique)
- Pays de résidence (Congo Brazzaville au lancement)
- Photo de profil (avatar) si tu en uploades une

**Finalité** : créer ton compte, te permettre d'être contacté, afficher ton profil public aux autres utilisateurs.

**Base légale** : exécution du contrat (CGU).

### 3.2 Données de vérification d'identité (KYC)

- Photo recto et verso de ta CNI ou passeport
- Selfie en direct
- Date et version du consentement explicite (obligatoire avant soumission)

**Finalité** : vérifier que tu es bien la personne indiquée, lutter contre les faux comptes et la fraude.

**Conservation** : 30 jours en cas de refus de la vérification, 6 mois après validation, puis suppression automatique. Ces fichiers sont chiffrés au repos et ne sont accessibles qu'à l'équipe d'administration Niqo (logs d'accès tracés via la table d'audit admin).

**Base légale** : consentement explicite (case à cocher au début du wizard KYC).

### 3.3 Données de contenu (annonces, messages, avis)

- Annonces publiées : titre, description, photos, prix, ville, quartier, catégorie, état, statut
- Messages échangés via la messagerie interne (texte, type, horodatage)
- Avis et notes post-rendez-vous (1 à 5, commentaire optionnel)
- Signalements émis ou reçus, motif et description
- Rendez-vous proposés ou confirmés (lieu, date, statut)

**Finalité** : faire fonctionner la marketplace (publier, chercher, communiquer), assurer la modération communautaire, calculer les scores de réputation.

**Base légale** : exécution du contrat.

### 3.4 Données de paiement

- Type de service (vérification, boost), montant, statut, horodatage
- Identifiant de transaction PawaPay (numéro de référence Mobile Money — pas le numéro de téléphone du payeur conservé en clair)

**Finalité** : tracer les paiements liés aux services Niqo (vérification, boosts), facturation, comptabilité, lutte contre la fraude.

**Base légale** : exécution du contrat + obligations légales comptables (conservation 10 ans selon le droit rwandais).

**Niqo ne stocke PAS** les données de carte bancaire ni les codes PIN Mobile Money. Ces informations sont gérées directement par PawaPay (notre prestataire de paiement) et les opérateurs Mobile Money congolais (Airtel Money, MTN MoMo).

### 3.5 Données techniques

- Token de notification push (pour t'envoyer des alertes : nouveau message, RDV confirmé, etc.)
- Logs d'authentification (date de connexion, fournisseur OAuth, IP — gérés par Supabase)
- Préférences locales (recherches récentes — stockées sur ton téléphone via AsyncStorage, pas envoyées au serveur)
- Cookies de session pour le site web (`niqo.africa`) — cf. Politique cookies

**Finalité** : sécurité, support technique, expérience utilisateur.

**Base légale** : intérêt légitime (sécurité du service).

## 4. Sources des données

Toutes tes données proviennent :

- De toi (saisie volontaire dans l'app)
- De ton fournisseur OAuth si tu utilises Connexion Google ou Apple (email + nom uniquement)
- Du processus de paiement (PawaPay nous transmet le statut, pas ton solde ni ton historique global)
- Générées par l'application (push tokens, logs, scores calculés à partir de tes interactions)

Niqo n'achète aucune donnée à des tiers et ne fait pas de géolocalisation passive.

## 5. Partenaires et sous-traitants

Niqo s'appuie sur des prestataires techniques pour fournir le service. Ils traitent tes données pour le compte de Niqo, sous contrat strict de confidentialité :

| Prestataire | Rôle | Localisation |
|---|---|---|
| **Supabase** | Base de données, authentification, stockage de fichiers, fonctions serverless | Union européenne (Irlande) |
| **PawaPay** | Traitement des paiements Mobile Money | Prestataire panafricain (Rwanda / Kenya) |
| **Resend** | Envoi des emails transactionnels | Union européenne / États-Unis |
| **Expo / Apple Push / Google FCM** | Livraison des notifications push | États-Unis |
| **Google et Apple** | Authentification OAuth si tu te connectes avec leur compte | États-Unis |
| **Vercel** | Hébergement du site web et de l'admin (`niqo.africa`) | Union européenne / États-Unis |

Aucune de ces données n'est revendue à des tiers à des fins publicitaires. Niqo ne fait pas de profilage publicitaire.

## 6. Transferts internationaux

Tes données sont hébergées principalement chez Supabase (Union européenne, Irlande). Certains traitements transitent par les États-Unis (Resend, Expo, Apple Push, Google FCM, Vercel) sous le cadre des **clauses contractuelles types** (CCT) adoptées par la Commission européenne, ou des standards équivalents reconnus par le Rwanda et le Congo Brazzaville.

La société Niqo Ltd elle-même est immatriculée au Rwanda. Les décisions administratives de modération (validation KYC, traitement des signalements) sont prises depuis l'équipe opérant à distance.

Pour obtenir copie des CCT applicables ou en savoir plus sur les garanties contractuelles : **dpo@niqo.africa**.

## 7. Durée de conservation

| Donnée | Durée |
|---|---|
| Compte actif | Tant que tu utilises Niqo |
| Compte inactif | 5 ans après la dernière connexion, puis anonymisation |
| CNI / pièce d'identité | 30 jours en cas de refus, 6 mois après validation |
| Annonces vendues ou expirées | 90 jours puis anonymisation |
| Messages | Conservés tant que les deux comptes participants existent ; soft delete possible par modération |
| Avis et signalements traités | Conservation indéfinie (historique communautaire) — anonymisés en cas de suppression du compte de l'auteur |
| Données comptables (paiements vérification, boosts) | **10 ans** pour conformité fiscale rwandaise |
| Logs techniques (auth, requêtes) | 30 jours |
| Logs d'audit admin (accès données sensibles) | 5 ans |
| Tokens de notifications push | Tant que valides + 90 jours après désinstallation |

À l'expiration de la durée, les données sont **supprimées ou anonymisées** de manière irréversible.

## 8. Sécurité

Niqo met en œuvre les mesures techniques et organisationnelles suivantes :

- **Chiffrement TLS** pour tous les échanges entre l'app et le serveur
- **Chiffrement au repos** pour les données sensibles (téléphone, CNI, secrets internes via Supabase Vault)
- **Politiques de sécurité au niveau ligne (RLS)** activées sur **toutes** les tables : chaque utilisateur ne voit que ses propres données, sauf accès admin justifié
- **Auth forte** par OAuth (Google, Apple) ou mot de passe avec hashage Argon2 (Supabase Auth)
- **Logs d'accès** aux données sensibles tracés (table d'audit admin)
- **Cloisonnement des secrets** (clés API jamais exposées au client)
- **Anti-brute-force** sur les tentatives de connexion
- **Filtrage de contenu** sur la messagerie (mots interdits)
- **Audit /cso** régulier (la dernière révision a été faite le 2026-05-10, RLS deny-by-default sur la blocklist)

### 8.1 Notification d'incident

En cas de violation de données affectant tes informations personnelles, Niqo te notifiera par email et notification push **dans les 72 heures** suivant la prise de connaissance de l'incident, et informera les autorités compétentes (ANRTIC, NCSA) conformément à la loi applicable.

### 8.2 Signaler une vulnérabilité

Pour signaler une vulnérabilité technique ou un risque de sécurité (responsible disclosure) : **security@niqo.africa**. Niqo s'engage à examiner toute notification de bonne foi sans poursuivre le chercheur agissant de manière responsable.

## 9. Tes droits

Conformément aux lois ANRTIC 2023-15 (Congo Brazzaville) et NCSA 2021-058 (Rwanda), tu disposes des droits suivants :

- **Droit d'accès** : obtenir une copie de tes données dans un format lisible.
- **Droit de rectification** : corriger des données inexactes (modifiable directement depuis l'app pour la plupart).
- **Droit à l'effacement** (droit à l'oubli) : supprimer ton compte et tes données depuis l'écran Profil. La suppression est immédiate sauf pour les données comptables (paiements) conservées 10 ans pour conformité fiscale, et les contributions communautaires (avis, signalements traités) qui sont anonymisées.
- **Droit d'opposition** : t'opposer à un traitement basé sur l'intérêt légitime.
- **Droit à la limitation** : demander à geler temporairement le traitement de tes données pendant la résolution d'un litige.
- **Droit à la portabilité** : recevoir tes données dans un format structuré (JSON ou CSV) pour les transférer ailleurs.
- **Droit de retirer ton consentement** à tout moment (cas du KYC) — sans effet rétroactif sur les traitements déjà effectués.
- **Droit de définir le sort de tes données** en cas de décès (sur demande des proches avec acte de décès et acte de notoriété).
- **Droit de ne pas faire l'objet d'une décision automatisée** : Niqo n'utilise pas de décision automatisée à effet juridique significatif (la suspension auto sur 3 signalements est révocable par appel humain — cf. CGU §9.3).

Pour exercer ces droits, écris à **dpo@niqo.africa** depuis l'adresse email associée à ton compte. Réponse sous **30 jours maximum** (extensible une fois de 30 jours pour les demandes complexes, avec notification).

En cas de refus ou d'absence de réponse satisfaisante, tu peux saisir l'autorité de protection compétente (cf. §13).

## 10. Cookies et stockage local

### 10.1 Application mobile

L'application mobile Niqo n'utilise **aucun cookie publicitaire** ni tracker tiers. Les seules données stockées localement sur ton téléphone (via AsyncStorage natif) sont :

- Tes recherches récentes
- Le cache des annonces vues (déduplication des compteurs de vues)
- La session d'authentification (chiffrée via Keychain iOS / Keystore Android)

Toutes ces données restent sur ton appareil et sont effacées si tu désinstalles l'app.

### 10.2 Site web (`niqo.africa`)

Le site web utilise des **cookies fonctionnels strictement nécessaires** (pas de cookie publicitaire ou de tracking tiers) pour la session d'authentification de l'admin. Détail complet dans la **Politique cookies** dédiée.

## 11. Mineurs

Niqo est strictement réservé aux personnes majeures (18 ans ou plus). Si nous découvrons qu'un compte appartient à un mineur, le compte est immédiatement suspendu et les données supprimées dans les meilleurs délais.

Si tu es parent ou tuteur et que tu as connaissance de l'utilisation de Niqo par un mineur sous ta responsabilité, écris-nous à **dpo@niqo.africa**.

## 12. Modifications de cette politique

Cette Politique de confidentialité peut être mise à jour pour refléter des évolutions du service ou de la réglementation. Toute modification matérielle te sera notifiée via une bannière dans l'application **au moins 15 jours** avant son entrée en vigueur. La date de dernière mise à jour et la version sont indiquées en haut de cette page. Les versions antérieures restent consultables sur demande à **dpo@niqo.africa**.

## 13. Recours auprès des autorités

Si tu estimes que tes droits ne sont pas respectés malgré nos efforts, tu peux saisir l'autorité de protection des données compétente :

- 🇨🇬 **ANRTIC** (Congo Brazzaville) — [anrtic.cg](https://anrtic.cg)
- 🇷🇼 **NCSA** (Rwanda) — [cyber.gov.rw](https://cyber.gov.rw)

## 14. Contact

Pour toute question relative à tes données personnelles ou à cette politique :

- **DPO** : **dpo@niqo.africa**
- Support général : **support@niqo.africa**
- Sécurité / vulnérabilités : **security@niqo.africa**

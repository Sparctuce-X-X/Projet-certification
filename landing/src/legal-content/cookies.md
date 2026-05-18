---
title: Politique cookies (site web)
slug: cookies
version: 1.1
date: 2026-05-11
audience: visiteurs du site niqo.africa
scope: web only (le mobile n'utilise pas de cookies — voir §10 de la Politique de confidentialité)
---

# Politique cookies — site web `niqo.africa`

> Dernière mise à jour : 2026-05-11 — version 1.1
>
> Cette politique concerne **uniquement le site web** [niqo.africa](https://niqo.africa) et ses sous-domaines. **L'application mobile Niqo (iOS/Android) n'utilise aucun cookie** — elle stocke localement quelques préférences via AsyncStorage natif (cf. Politique de confidentialité §10).

## 1. Qu'est-ce qu'un cookie ?

Un cookie est un petit fichier texte déposé par un site web sur ton appareil (ordinateur, mobile, tablette) lorsque tu le consultes. Il permet au site de reconnaître ton navigateur lors de tes visites suivantes ou pendant ta session.

## 2. Cookies utilisés par `niqo.africa`

Niqo utilise **uniquement des cookies strictement nécessaires** au fonctionnement du site. **Aucun cookie publicitaire**, aucun tracker tiers, aucun cookie de profilage.

### 2.1 Cookies de session Supabase Auth

| Nom | Émetteur | Finalité | Durée | Type |
|---|---|---|---|---|
| `sb-<project-ref>-auth-token` | Niqo (via Supabase SSR) | Session d'authentification administrateur (page `/admin/*`) | Durée de la session + 7 jours de refresh token | **Strictement nécessaire** |
| `sb-<project-ref>-auth-token-code-verifier` | Niqo (via Supabase SSR) | Sécurité OAuth (PKCE flow) | Durée d'une connexion (~5 min) | **Strictement nécessaire** |

Ces cookies sont posés exclusivement lorsqu'un administrateur Niqo se connecte à l'interface d'administration (`/admin/login`). Ils ne sont **jamais** posés pour un visiteur consultant la page d'accueil ou une annonce publique.

### 2.2 Cookies de préférences

Aucun cookie de préférences n'est utilisé. Les choix de pays et la langue sont gérés côté application mobile uniquement.

### 2.3 Cookies analytiques

**Aucun cookie analytique au lancement.** Si Niqo intègre un outil d'analyse à l'avenir (ex: Plausible, Vercel Analytics), cette politique sera mise à jour avec le détail correspondant et un mécanisme de consentement adapté.

### 2.4 Cookies publicitaires et tiers

**Aucun.** Niqo ne fait pas de publicité ciblée et ne partage pas de données comportementales avec des tiers à des fins commerciales.

## 3. Base légale

Les cookies utilisés par `niqo.africa` sont **strictement nécessaires** à la fourniture du service explicitement demandé par l'utilisateur (connexion à l'administration). À ce titre, leur dépôt ne nécessite pas de consentement préalable, conformément aux régulations applicables (lois CG 2023-15, RW 2021-058) et aux standards internationaux (ePrivacy européen).

Aucun consentement préalable n'est sollicité tant que seuls des cookies strictement nécessaires sont utilisés. Toute évolution introduisant des cookies non essentiels (analytics, marketing) sera précédée d'un mécanisme de **consentement explicite**.

## 4. Comment gérer les cookies

Tu peux à tout moment :

- **Configurer ton navigateur** pour bloquer ou supprimer les cookies (cf. documentation Chrome, Firefox, Safari, Edge)
- **Supprimer les cookies déjà déposés** depuis les paramètres de ton navigateur
- **Te déconnecter de l'administration** via le bouton « Déconnexion » (efface les cookies de session)

⚠ Bloquer les cookies strictement nécessaires empêchera la connexion à l'interface d'administration. La consultation publique du site (page d'accueil, page publique d'une annonce `/a/[id]`) reste possible sans cookies.

## 5. Durée de vie des cookies

| Cookie | Durée maximale |
|---|---|
| Session Auth Supabase | Jusqu'à déconnexion ou expiration (7 jours d'inactivité maximum) |
| Refresh token Supabase | 7 jours glissants |
| PKCE code verifier | 5 minutes (effacé après l'échange OAuth) |

Aucun cookie n'a une durée supérieure à 13 mois (norme protection des données).

## 6. Sous-traitants

Les cookies de session sont gérés par **Supabase Inc.** (Irlande, UE) en qualité de sous-traitant de Niqo, conformément aux dispositions de la Politique de confidentialité §5.

L'hébergement du site est assuré par **Vercel Inc.**, qui peut placer des cookies fonctionnels strictement nécessaires à la livraison du contenu (load balancing, anti-DDoS). Ces cookies sont éphémères et ne contiennent aucune donnée identifiante.

## 7. Évolutions

En cas d'ajout de nouveaux cookies (analytique, marketing), la présente politique sera mise à jour et un **bandeau de consentement** sera affiché lors de ta prochaine visite. Tant que ce bandeau n'apparaît pas, tu peux considérer que la liste ci-dessus est exhaustive.

## 8. Contact

Pour toute question relative aux cookies :

- **DPO** : **dpo@niqo.africa**
- Support général : **support@niqo.africa**

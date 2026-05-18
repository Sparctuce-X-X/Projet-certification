# 📁 docs/ — sommaire

Documentation projet Niqo. Organisée par usage.

📱 **App live sur l'App Store iOS depuis 2026-05-17** — https://apps.apple.com/app/niqo-annonces-afrique/id6769410032 (App ID `6769410032`, 147 pays, UE Phase 2).

## Top-level

- **[design-system.md](./design-system.md)** — Tokens visuels (couleurs, typo, spacing) + interprétation humaine de la charte de marque. Source de vérité pour le code UI.
- **[pre-production-checklist.md](./pre-production-checklist.md)** — Checklist maître pré-prod : modules backend à backfill (doc + tests pgTAP/Vitest), tests UX manuels par feature, livrables infra/légal/business avant GO live.
- **[gotchas.md](./gotchas.md)** — Pièges déjà rencontrés et solutions (IDE, RN/Expo, Supabase, Vercel, UGC compliance, EAS Build/Update, App Store Connect). À consulter avant de chercher plus loin sur un bug.
- **[changelog-launch.md](./changelog-launch.md)** — Historique détaillé des étapes du lancement iOS (10-17 mai 2026).

## 📂 backend/

Documentation backend par module : inventaire tables + RPCs + triggers + RLS + crons + storage. Process officiel défini dans `CLAUDE.md` §Backend ownership.

État détaillé du backfill : voir [backend/PROCESS.md](./backend/PROCESS.md) §État du backfill. À date (2026-05-16) :

| Statut | Modules |
|---|---|
| ✅ Doc + tests pgTAP + Vitest | Auth · RDV · Notation · KYC · Boost · Admin KPIs · Annonces · Conversations · Signalements · Storage · Favoris |
| ✅ Doc + tests pgTAP (Vitest non requis) | Catégories |
| 🟡 Doc seule (tests à écrire) | Audit log admin · Observability · Moderation · **Blocking** (F15, 2026-05-16) |
| 🚧 À backfill (P2) | Profil · Recherche · Push |

## 📂 features/

Plans de tests UX manuels (multi-device) par feature, et docs setup spécifiques.

| Document | Usage |
|---|---|
| [auth-tests.md](./features/auth-tests.md) | F01 — Tests UX Auth (Google, Apple, Email) |
| [auth-email-templates.md](./features/auth-email-templates.md) | Templates HTML Resend à copier dans Supabase Dashboard → Authentication → Emails |
| [annonces-tests.md](./features/annonces-tests.md) | F02 — Tests UX création annonce (wizard 5 steps) |
| [rdv-tests.md](./features/rdv-tests.md) | F05 — Tests UX RDV complet (A→H : propose, confirme, modifie, annule, edge cases, trust v2) |
| [rdv-trust-v2-test-plan.md](./features/rdv-trust-v2-test-plan.md) | F05+F06 — Plan focused anti-fraude rencontre + photos + signalement post-RDV + bannière (8 blocs, ~2h30) |
| [notation-tests.md](./features/notation-tests.md) | F06 — Tests UX notation post-RDV |
| [F07-kyc-tests.md](./features/F07-kyc-tests.md) | F07 — Tests UX KYC (CNI + selfie + paiement + admin web) |
| [signalements-tests.md](./features/signalements-tests.md) | F08 — Tests UX signalements (mobile + admin web) |
| [push-fcm-setup.md](./features/push-fcm-setup.md) | F10 — Setup Firebase Cloud Messaging pour push Android prod (iOS via APNs auto) |

> Tests manuels manquants pour F09 Boost, F11 Expiration, F12 Dashboard, F13 Admin KPIs — à écrire avant GO live.

## 📂 references/

Documents de référence projet (lourds, peu modifiés).

- **[niqo_cdc_v4_0.docx](./references/niqo_cdc_v4_0.docx)** — Cahier des charges v4.0 (modèle hors transaction, source de vérité produit)
- **[niqo_schema_v1.6.sql](./references/niqo_schema_v1.6.sql)** — Schéma SQL v3.14 (partiellement obsolète post-v4.0, voir `CLAUDE.md` §Migrations)
- **[rgpd-audit.md](./references/rgpd-audit.md)** — Audit RGPD (CI 2024-30 / CG 2023-15 / RW 2021-058)
- **[incident-response.md](./references/incident-response.md)** — Procédure d'incident

## 📂 migrations/

Migrations Supabase numérotées séquentiellement (`NN_feature.sql`). À jouer manuellement dans Supabase Dashboard → SQL Editor. Idempotentes.

→ Voir `CLAUDE.md` §Migrations Supabase pour la liste à date et la règle d'or (DB incrémentale).

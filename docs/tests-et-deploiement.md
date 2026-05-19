---
title: Tests et Déploiement — Projet Niqo
subtitle: Stratégie de tests automatisés, CI/CD, déploiement mobile et web, monitoring, rollback
author: Dominique Huang
date: 2026-05-19
version: 1.0
project: Niqo
status: Document de soutenance RNCP CDA — Bloc 3
---

# Tests et Déploiement — Projet Niqo

> Document produit pour le dossier de certification RNCP **Concepteur Développeur d'Applications** (TP-CDA — code 31678), **Bloc RNCP3** (Préparer le déploiement d'une application sécurisée). À lire avec le **Cahier des Charges v5.0** ([docs/CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md)), la **méthodologie UML** ([docs/methodologie-uml.md](methodologie-uml.md)) et la **checklist pré-production** ([docs/pre-production-checklist.md](pre-production-checklist.md)).

---

## Sommaire

1. [Contexte et objectifs](#1-contexte-et-objectifs)
2. [Stratégie de tests — vue d'ensemble](#2-stratégie-de-tests--vue-densemble)
3. [Tests DB (pgTAP) — exemples concrets](#3-tests-db-pgtap--exemples-concrets)
4. [Tests d'intégration (Vitest) — exemples concrets](#4-tests-dintégration-vitest--exemples-concrets)
5. [Tests UX manuels et recette MVP](#5-tests-ux-manuels-et-recette-mvp)
6. [Tests de sécurité et audit](#6-tests-de-sécurité-et-audit)
7. [Environnements, CI/CD](#7-environnements-cicd)
8. [Build mobile EAS](#8-build-mobile-eas)
9. [Soumission App Store et Play Store](#9-soumission-app-store-et-play-store)
10. [Déploiement backend Supabase](#10-déploiement-backend-supabase)
11. [Déploiement admin web Vercel](#11-déploiement-admin-web-vercel)
12. [OTA vs rebuild — règle de bump](#12-ota-vs-rebuild--règle-de-bump)
13. [Monitoring de production](#13-monitoring-de-production)
14. [Rollback et incident response](#14-rollback-et-incident-response)
15. [Mapping vers les compétences RNCP CDA Bloc 3](#15-mapping-vers-les-compétences-rncp-cda-bloc-3)
16. [Annexe — Runbooks et commandes utiles](#annexe--runbooks-et-commandes-utiles)

---

## 1. Contexte et objectifs

Au 2026-05-19, **Niqo est LIVE sur l'App Store iOS depuis le 2026-05-17** dans 147 pays, et en *closed testing* Google Play (12 testeurs, 14 jours règle Google). La livraison de l'application de production a imposé un dispositif **tests + déploiement** qui couvre :

- **3 surfaces clients** (iOS, Android, Web Next.js),
- **1 backend Supabase** (PostgreSQL + Auth + Storage + Realtime + 13 Edge Functions Deno),
- **6 services tiers** (PawaPay, OpenAI, AWS Rekognition, Resend, Sentry, Expo Push),
- **132 migrations DB** appliquées en production.

Le présent document décrit la **stratégie**, les **outils**, les **plans** et les **runbooks** validés pour atteindre les critères de succès du CDC v5.0 §2.4 :

- ✅ Crash-free sessions > 99,5 %,
- ✅ Note App Store ≥ 4,0,
- ✅ Conformité Apple App Store (Guidelines 1.2 + 4.8 + 5.1) — validée par Apple le 2026-05-17 en 24 h,
- ✅ Capacité de rollback immédiat (OTA ≤ 5 min, rebuild ≤ 24 h).

---

## 2. Stratégie de tests — vue d'ensemble

### 2.1 Pyramide retenue

Niqo applique une **pyramide de tests pragmatique** centrée sur les couches qui produisent le plus de valeur pour une application data-driven :

```
              ╱╲
             ╱  ╲   Tests UX manuels  (8 plans, ~30 scénarios)
            ╱────╲
           ╱      ╲  Tests d'intégration Vitest (13 modules, ~80 tests)
          ╱────────╲
         ╱          ╲  Tests DB pgTAP (16 modules, ~370 assertions)
        ╱────────────╲
       ╱──────────────╲  Audit sécurité (/cso, OWASP Top 10)
```

**Rationale (`docs/pre-production-checklist.md` §Inventaire fichiers tests)** :

- la **base de données est le cœur métier** (RLS, triggers, RPCs portent la logique) → couverture pgTAP prioritaire,
- les **flows multi-acteurs end-to-end** (RDV, KYC, paiement boost, modération async) ne se valident qu'avec deux sessions Supabase distinctes → Vitest,
- les **bugs visuels et d'ergonomie** se détectent par utilisation réelle sur device → tests UX manuels documentés par feature,
- **pas de Jest sur les composants React Native** — la valeur d'un test composant pur sur app data-driven est faible (la majorité des bugs vient du couplage avec la DB).

### 2.2 Outillage

| Layer | Techno | Source | Latence |
|---|---|---|---|
| **Tests DB** | pgTAP + extension PostgreSQL | `tests/sql/*.test.sql` | ~30 s pour 370+ assertions |
| **Tests intégration** | Vitest + `supabase-js` | `tests/integration/*.test.ts` | ~3 min |
| **Tests UX** | Manuels device + simulateur | `docs/features/*-tests.md` | 2-4 h par feature |
| **Lint / Types** | ESLint + TypeScript strict | `eslint.config.js`, `tsconfig.json` | < 10 s |
| **Audit sécu** | Audit `/cso` (OWASP) + Supabase Vault audit | `docs/changelog-launch.md` | Ad hoc avant prod |

### 2.3 Couverture au 2026-05-19

| Type | Cible | Atteint | Statut |
|---|---|---|---|
| **Modules backend documentés** | 18 | 14 | 🟡 4 restants (Profil, Recherche, Push, Blocking) |
| **Tests pgTAP** | ~500 assertions | **~370 assertions** sur 16 fichiers | 🟢 74 % |
| **Tests Vitest** | 13 modules | **13 modules** opérationnels | ✅ 100 % |
| **Plans tests UX manuels** | 12 features | **8 plans rédigés** (F01-F08) | 🟡 4 restants |
| **Audit OWASP /cso** | Pass | ✅ 2026-05-10 | ✅ |

---

## 3. Tests DB (pgTAP) — exemples concrets

### 3.1 Principes

**pgTAP** est une extension PostgreSQL qui implémente le protocole de test *TAP* (Test Anything Protocol) directement en SQL. Chaque test :

1. ouvre une **transaction** au début (`begin`),
2. déclare un **plan** d'assertions (`select plan(N)`),
3. exécute des assertions (`ok`, `is`, `isnt`, `throws_ok`, `lives_ok`),
4. **rollback automatique** en fin de fichier — la DB est rendue propre.

**Avantage majeur pour Niqo** : les tests s'exécutent **dans le même moteur** que la production. RLS, triggers, RPCs sont validés exactement comme en prod. Pas de mock, pas de divergence.

### 3.2 Exemple A — Test du trigger `handle_new_user` (Auth, F01)

Extrait de `tests/sql/auth.test.sql` — vérifie que le trigger Supabase `on_auth_user_created` peuple correctement `public.users` à partir des metadata OAuth/Email :

```sql
begin;
select plan(43);

-- Setup : insertion directe dans auth.users (bypass GoTrue) avec metadata
do $$
declare
  v_uid uuid := '11111111-1111-1111-1111-111111111111';
begin
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data, ...)
  values (
    v_uid,
    'alice-email@niqo.test',
    crypt('pass-test', gen_salt('bf')),
    jsonb_build_object(
      'prenom', 'Alice',
      'pays', 'CI',
      'telephone', '+2250700000001',
      'auth_provider', 'email',
      'cgu_accepted_at', '2026-05-08T10:00:00Z'
    ),
    '{}'::jsonb, now()
  );
end $$;

-- Assertion 1 : le prénom a bien été copié
select is(
  (select prenom from public.users where id = '11111111-...'::uuid),
  'Alice',
  'handle_new_user copie prenom depuis raw_user_meta_data'
);

-- Assertion 2 : le téléphone est chiffré (Vault)
select isnt(
  (select telephone from public.users where id = '11111111-...'::uuid),
  null,
  'handle_new_user chiffre le telephone (bytea non null)'
);

-- Assertion 3 : le timestamp CGU est posé serveur-side
select isnt(
  (select cgu_accepted_at from public.users where id = '11111111-...'::uuid),
  null,
  'handle_new_user pose cgu_accepted_at (mig 21)'
);
```

**Ce que ce test garantit** : la régression silencieuse identifiée mig 81 (perte du `prenom` quand le metadata avait été mal mappé) ne peut plus passer en prod sans casser le CI.

### 3.3 Exemple B — Test d'un trigger de sécurité (F09 Boost)

Extrait de `tests/sql/boost.test.sql` — vérifie le **gate atomique de la RPC `apply_boost`** : un paiement ne peut être réutilisé deux fois.

```sql
-- Test : tentative de double-spend d'un paiement boost
select throws_ok(
  $$
    select apply_boost(
      p_annonce_id := 'aaaa-...'::uuid,
      p_paiement_id := 'bbbb-...'::uuid,  -- même paiement_id que test précédent
      p_duree_jours := 7
    )
  $$,
  'PAIEMENT_ALREADY_USED',
  'apply_boost refuse de réutiliser un paiement déjà consommé'
);

-- Test : le scrub du metadata PawaPay redacte bien le phoneNumber (mig 77)
select is(
  (select pawapay_metadata->'payer'->>'phoneNumber'
   from paiements_niqo where id = 'bbbb-...'::uuid),
  '[REDACTED]',
  'fn_scrub_pawapay_metadata redacte le phoneNumber (RGPD)'
);
```

### 3.4 Inventaire pgTAP

| Fichier | Module | Assertions | Couvre |
|---|---|---|---|
| `auth.test.sql` | F01 | 43 | Trigger handle_new_user, Vault, RPC complete_my_profile, RLS users |
| `annonces.test.sql` | F02 | ~30 | CRUD, lifecycle statut, trigger anti-doublon, immo |
| `categories.test.sql` | — | 8 | Table statique + RLS |
| `conversations.test.sql` | F04 | ~30 | Messages, content filter, RLS, sons |
| `rdv.test.sql` | F05 | 32 | Modèle Proposer/Confirmer, lifecycle annonce |
| `rencontre.test.sql` | F05 trust v2 | 95 | Marquage vendu/non-réalisé, crons relance, photos, bannière |
| `notation.test.sql` | F06 | ~25 | Avis 1-5, est_auto_3, symétrie, contrainte UNIQUE |
| `kyc.test.sql` | F07 | 8 | Uniqueness numero_cni (mig 85) |
| `signalements.test.sql` | F08 | ~25 | Auto-suspend score≥3, anti-spam 7j, cascade admin |
| `boost.test.sql` | F09 | 23 | apply_boost gates, cumul, purge, scrub metadata, RLS |
| `admin_kpis.test.sql` | F13 | ~25 | get_admin_kpis cohérence sources, filtre période |
| `audit.test.sql` | F13 | ~15 | audit_log_admin trigger, immutabilité, payload before/after |
| `storage.test.sql` | — | 36 | RLS buckets, cascade delete, purge avatars/CNI/annonces |
| `favoris.test.sql` | — | 17 | Toggle, guard is_active, cascade delete |
| `moderate_message.test.sql` | F04 c4 | 15 | User système, trigger AFTER INSERT, lockdown grants |
| **Total** | **16 modules** | **~370 assertions** | |

### 3.5 Exécution

```bash
# Setup local : Supabase démarré en local
supabase start
supabase db reset  # applique toutes les migrations

# Exécution complète
psql "$(supabase status --output env | grep DB_URL | cut -d= -f2)" \
  -f tests/sql/_runner.sql

# Exécution d'un seul module
psql "..." -f tests/sql/auth.test.sql
```

Output attendu (format TAP) :

```
1..43
ok 1 - handle_new_user copie prenom depuis raw_user_meta_data
ok 2 - handle_new_user copie pays depuis raw_user_meta_data
ok 3 - handle_new_user pose auth_provider = email
...
ok 43 - delete_my_account purge cascade auth + public + storage
```

---

## 4. Tests d'intégration (Vitest) — exemples concrets

### 4.1 Principes

Les tests Vitest couvrent les **flows utilisateur réels** end-to-end via PostgREST (l'API auto-générée par Supabase). Ils :

- créent de **vrais utilisateurs** via Supabase Auth (`createTestUser`),
- créent des fixtures via les **vraies RPCs** (pas d'INSERT brut),
- valident le comportement **côté client** comme le ferait l'app mobile.

Cela permet de capter les bugs liés à la **chaîne complète** (RLS + RPC + trigger + Realtime) qui passent à travers les mailles des tests pgTAP isolés.

### 4.2 Exemple — Flow RDV complet 2 sessions (F05)

Extrait de `tests/integration/rdv.test.ts` :

```ts
async function setupRdvFixtures(): Promise<Setup> {
  // 2 vrais users authentifiés Supabase
  const alice = await createTestUser({
    email: `alice-rdv-${Date.now()}@niqo.test`,
    pays: "CI", ville: "Abidjan",
  });
  const bob = await createTestUser({ ... });

  // Annonce de Bob (vendeur)
  const { data: annonce } = await admin
    .from("annonces")
    .insert({
      vendeur_id: bob.userId,
      titre: "iPhone 12 Pro 128 Go bon état",
      prix: 250000,
      pays: "CI",
      ville: "Abidjan",
      statut: "active",
    })
    .select("id").single();

  // Conversation Alice (acheteuse) ↔ Bob (vendeur)
  const { data: conv } = await admin.from("conversations").insert({
    annonce_id: annonce.id,
    acheteur_id: alice.userId,
    vendeur_id: bob.userId,
  }).select("id").single();

  return { alice, bob, annonceId: annonce.id, conversationId: conv.id };
}

describe("Module RDV — intégration", () => {
  it("Alice propose un RDV → Bob confirme → annonce passe en_cours", async () => {
    await setup.alice.client.rpc("propose_rdv", {
      p_conversation_id: setup.conversationId,
      p_date: futureDate, p_lieu: "Cocody, devant Cosmos",
    });
    await setup.bob.client.rpc("confirm_rdv", { p_conversation_id: setup.conversationId });

    const { data: annonce } = await admin
      .from("annonces").select("statut").eq("id", setup.annonceId).single();
    expect(annonce.statut).toBe("en_cours"); // trigger fn_annonce_statut_on_rdv_change
  });

  it("Alice ne peut pas confirmer son propre RDV (cannot_self_confirm)", async () => {
    await setup.alice.client.rpc("propose_rdv", { ... });
    const { error } = await setup.alice.client.rpc("confirm_rdv", { ... });
    expect(error?.message).toContain("CANNOT_SELF_CONFIRM");
  });

  it("Un tiers ne peut pas voir l'annonce en_cours (RLS)", async () => {
    const charlie = await createTestUser({ ... });
    const { data } = await charlie.client
      .from("annonces").select("*").eq("id", setup.annonceId);
    expect(data).toHaveLength(0); // RLS annonces_buyer_select_via_conv bloque
  });
});
```

### 4.3 Tests gated par feature flag

Certains tests nécessitent une dépendance externe (OpenAI, AWS) → ils sont **skipped** si la variable d'env n'est pas définie :

```ts
const RUN_MODERATION = process.env.OPENAI_AVAILABLE === "1"
  && process.env.MODERATE_MESSAGE_SERVED === "1";

describe.skipIf(!RUN_MODERATION)("Modération message async", () => {
  it("Message contenant 'Western Union' → signalement auto user système", async () => {
    await alice.client.from("messages").insert({
      conversation_id, sender_id: alice.userId, type: "texte",
      contenu: "Paye-moi 50000 via Western Union d'abord",
    });

    // Attendre la propagation async (pg_net + OpenAI + INSERT signalement)
    await waitFor(() => admin
      .from("signalements")
      .select("*")
      .eq("auteur_id", SYSTEM_USER_UUID)
      .eq("cible_id", alice.userId),
    { timeout: 8000 });
  });
});
```

### 4.4 Inventaire Vitest

13 modules : `auth`, `annonces`, `conversations`, `rdv`, `notation`, `kyc`, `signalements`, `boost`, `admin_kpis`, `storage`, `favoris`, `moderation` (texte + image), `moderation-message` (async).

### 4.5 Exécution

```bash
cd tests/integration
cp .env.test.example .env.test  # pointe sur Supabase local
npm install
npm test
```

Le runner Vitest affiche un résumé du type :

```
 ✓ tests/integration/auth.test.ts (8)
 ✓ tests/integration/rdv.test.ts (13)
 ✓ tests/integration/boost.test.ts (10)
 ↓ tests/integration/moderation-image.test.ts (skipped: AWS_AVAILABLE undefined)
 ↓ tests/integration/moderation-message.test.ts (skipped)
 ✓ tests/integration/storage.test.ts (11)

Test Files  11 passed | 2 skipped (13)
Tests       80 passed | 0 failed
```

---

## 5. Tests UX manuels et recette MVP

### 5.1 Plans de tests UX par feature

Chaque feature MVP dispose d'un plan de test UX dans `docs/features/`. Format :

- **Préconditions** (device, version, données fixtures),
- **Scénarios A→Z** (golden path puis edge cases),
- **Résultat attendu**,
- **Résultat constaté** (à remplir lors du run, photos jointes),
- **Bugs détectés** (avec ID Sentry s'il y a lieu).

| Feature | Plan | Scénarios |
|---|---|---|
| F01 Auth | [auth-tests.md](features/auth-tests.md) | Google, Apple, Email, reset password, complete_profile, delete account |
| F02 Annonces | [annonces-tests.md](features/annonces-tests.md) | Wizard 5 étapes, mode immo, compression photos, anti-doublon |
| F05 RDV | [rdv-tests.md](features/rdv-tests.md) | 8 sous-plans : propose, confirme, modifie, annule, edge cases |
| F05 Trust v2 | [rdv-trust-v2-test-plan.md](features/rdv-trust-v2-test-plan.md) | 8 blocs anti-fraude rencontre (~2h30) |
| F06 Notation | [notation-tests.md](features/notation-tests.md) | Note manuelle, auto 3/5 après 7j, symétrie |
| F07 KYC | [F07-kyc-tests.md](features/F07-kyc-tests.md) | Capture CNI, selfie, PawaPay, admin web validation |
| F08 Signalements | [signalements-tests.md](features/signalements-tests.md) | Mobile + cascade admin web + auto-suspend |
| F10 Push setup | [push-fcm-setup.md](features/push-fcm-setup.md) | Setup FCM Android prod (iOS APNs auto) |

### 5.2 Matrice device de recette

Tests joués sur les devices cibles Niqo (CDC v5.0 §3.2 — réseau 3G CI/CG) :

| Catégorie | Device | iOS / Android | Réseau testé |
|---|---|---|---|
| **Cible bas de gamme** | Tecno Spark 8C | Android 11, 3 Go RAM | 3G Brazzaville réel |
| **Cible bas de gamme bis** | Itel A56 | Android 12 Go, 2 Go RAM | 3G simulé (Charles Proxy throttle) |
| **iOS entrée** | iPhone SE 2020 | iOS 16 | 4G Abidjan + Wi-Fi |
| **iOS haut** | iPhone 14 Pro | iOS 17 | 4G + Wi-Fi |
| **Simulateur** | iPhone 15 Pro simulator | iOS 17 | Wi-Fi macOS |

### 5.3 Recette MVP — Definition of Done

Une feature est **DoD-validée** uniquement si :

1. ✅ Doc backend rédigée (`docs/backend/<module>.md`),
2. ✅ Tests pgTAP green (≥ 1 assertion par RPC + triggers + RLS),
3. ✅ Tests Vitest green pour les flows non-isolés,
4. ✅ Plan UX manuel exécuté sur **au moins 2 devices** (1 iOS + 1 Android cible),
5. ✅ Audit RGPD si données personnelles touchées (`docs/references/rgpd-audit.md`),
6. ✅ Sentry n'affiche aucune erreur récurrente en preview/staging pendant 24 h.

---

## 6. Tests de sécurité et audit

### 6.1 Audit `/cso` (OWASP Top 10 2021) — 2026-05-10

Audit complet déclenché avant le submit Apple. Documenté dans [`docs/changelog-launch.md`](changelog-launch.md). Résultats :

| Catégorie OWASP | Finding | Mitigation |
|---|---|---|
| A01 Broken Access Control | Open redirect potentiel `/admin/login?next=` | Patch : whitelist domaine, mig de doc |
| A03 Injection | RLS bypass possible via SECURITY DEFINER mal castée | Audit toutes les RPCs SECURITY DEFINER |
| A05 Security Misconfiguration | `mots_interdits` exposé en lecture publique | Mig 105 : RLS restrictif |
| A07 Identification & Auth | Pas de SHA pin CI | Mig CI : pin SHA des actions GitHub |
| A10 SSRF | EF moderate-* accessibles publiquement | Auth via `NIQO_INTERNAL_KEY` 32 bytes + `constantTimeEquals` |

### 6.2 Hardening continu

| Mesure | Implémentation |
|---|---|
| RLS partout | Toutes tables sensibles (cf. `docs/backend/*.md`) |
| Vault téléphone | `users.telephone` bytea, RPC `get_my_phone` gated |
| Webhook signé HMAC | `pawapay-webhook` double-check via GET `/v2/deposits/{id}` |
| Anti-bypass message | Trigger F15 `fn_messages_block_check` (mig 130) |
| Audit log admin | `audit_log_admin` immutable, payload before/after (mig 103-104) |
| Anti-timing | `constantTimeEquals` sur les comparaisons de clés (EF push) |
| Score d'abus | Auto-suspend `is_active = false` à ≥ 3 signalements / 30 j |

### 6.3 Test de bypass RLS

Toute nouvelle table sensible passe un test pgTAP de **non-accès cross-user** :

```sql
-- Setup : Alice possède un avis privé
insert into avis (...) values (alice_id, ...);

-- Simulation Bob authentifié
select tests.set_jwt_for(bob_id);

-- Bob ne doit voir AUCUN avis d'Alice
select is(
  (select count(*) from avis where auteur_id = alice_id)::int,
  0,
  'RLS avis_owner_select : Bob ne voit pas les avis d Alice'
);
```

---

## 7. Environnements, CI/CD

### 7.1 Environnements

| Env | Surface | DB | Auth | Push | Paiement |
|---|---|---|---|---|---|
| **Local (dev)** | Expo dev client + `supabase start` | Postgres local | GoTrue local | Logs console | PawaPay sandbox (mock) |
| **Preview EAS** | Build interne TestFlight + APK preview | Supabase prod | Vrais OAuth | Expo Push réel | PawaPay sandbox |
| **Production** | iOS App Store + Google Play | Supabase prod | OAuth Google/Apple/Email | APNs + FCM (Phase 2) | PawaPay prod (HMAC) |

### 7.2 Pipeline CI/CD (planifié `.github/workflows/backend-tests.yml`)

Configuration finalisée hors repo (à intégrer Phase 2). Pour le MVP, les tests sont **exécutés manuellement en local** avant chaque migration prod (process documenté `docs/backend/PROCESS.md`).

Workflow cible :

```yaml
name: Backend tests
on: [pull_request]
jobs:
  pgtap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: supabase db reset
      - run: psql "$DB_URL" -f tests/sql/_runner.sql
  vitest:
    needs: pgtap
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd tests/integration && npm ci && npm test
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

### 7.3 Vercel CI/CD (web admin + landing) — opérationnel

- `git push origin main` → preview deployment automatique sur `https://niqo-africa-pr-<n>.vercel.app`,
- review manuelle (test login admin, ouverture page publique annonce, footer légal),
- bouton **« Promote to Production »** Vercel → déploie sur `niqo.africa`.

---

## 8. Build mobile EAS

### 8.1 Configuration `eas.json`

```json
{
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote"      // EAS auto-incrémente buildNumber/versionCode
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false },
      "channel": "development"
    },
    "development-simulator": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true },
      "channel": "development"
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true,
      "channel": "production"
    }
  }
}
```

### 8.2 Profils retenus

| Profil | Cible | Source maps Sentry | Distribution |
|---|---|---|---|
| `development` | Device dev avec hot reload | Non | Interne |
| `development-simulator` | Simulateur iOS | Non | Interne |
| `preview` | QA interne, production-like | Optionnel | TestFlight + APK direct |
| `production` | App Store + Play Store | Oui (gated `SENTRY_AUTH_TOKEN`) | Stores publics |

### 8.3 Commandes runbook

```bash
# Build prod iOS
eas build --platform ios --profile production

# Build prod Android
eas build --platform android --profile production

# Sauter le build et tester sur simulateur
eas build --platform ios --profile development-simulator --local

# Mise à jour OTA production
eas update --channel production --message "fix: clavier paiement chat"
```

### 8.4 Versioning post-1.0 (semver)

| Bump | Exemple | Quand |
|---|---|---|
| **PATCH** | 1.0.0 → 1.0.1 | Fix bug, crash, RPC échouée, typo |
| **MINOR** | 1.0.x → 1.1.0 | Nouvelle feature non-breaking |
| **MAJOR** | 1.x.y → 2.0.0 | Refonte UX majeure (rare) |

`buildNumber` (iOS) et `versionCode` (Android) sont **auto-incrémentés** par EAS grâce à `cli.appVersionSource = "remote"` — évite les refus stores sur build ≤ précédent.

---

## 9. Soumission App Store et Play Store

### 9.1 iOS App Store — ✅ LIVE 2026-05-17

**Process suivi** :

1. **EAS Build production** → IPA disponible sur Expo dashboard.
2. **App Store Connect** : création de la fiche app, métadonnées (titre, sous-titre, description FR + EN), 6 captures écran (iPhone 6.5"), screenshots ASO (`scripts/upload-aso-photos.sh`).
3. **Soumission TestFlight** → testeurs internes pendant 7 jours.
4. **Submit Review** → réponse Apple en 24 h.

**Rejet intermédiaire (2026-05-15, build 1.0.0(4))** : Apple Guideline 1.2 (User-Generated Content) — manque de feature « Block user ». Implémentation **F15 en 1 journée** (table `blocked_users` + 5 RPCs + trigger anti-bypass + UI mobile + filter feed) → resubmission → **validation 24 h**.

**État LIVE** :
- App ID Apple : `6769410032`,
- 147 pays (CI + CG + Rwanda + Afrique + Amériques + Asie + UK + CH + NO),
- **UE exclue** tant que DSA Trader Info pas publiées (planifié Phase 2),
- Lien : `https://apps.apple.com/app/niqo-annonces-afrique/id6769410032`.

### 9.2 Google Play Store — 🟡 Closed testing

**État au 2026-05-19** :
- Package validé : `com.niqo.africa`,
- Closed testing actif : **12 testeurs**, jour 1/14 (règle Google obligatoire avant publication publique),
- Build prod 1.0.1 (avec F15 Block) à pousser,
- Cible publication : fin mai 2026.

**Action restante** : configurer FCM (Firebase Cloud Messaging) pour push Android prod (iOS push OK via APNs auto).

### 9.3 Captures écran ASO

Stockées dans `screenshots/final/` :
- `01-feed.jpg`, `02-detail-annonce.jpg`, `03-retrouve-discussions.jpg`, `04-rdv.jpg`, `05-profile-vendeur.jpg`, `06-block-feature.jpg`.

Texte localisé FR (cible Afrique francophone) + EN (Apple obligatoire).

---

## 10. Déploiement backend Supabase

### 10.1 Migrations

**Règle d'or** : DB incrémentale, 1 fichier `NN_feature.sql` par change, **idempotent**, jamais réutilisée (cf. `docs/migrations/INDEX.md`).

Process officiel (`docs/backend/PROCESS.md`) :

```
1. Discussion besoin → décision "besoin maintenant"
2. Créer NN_feature.sql avec commentaire en-tête (cf. modèle)
3. Rédiger migration idempotente (CREATE IF NOT EXISTS, DROP/CREATE POLICY)
4. Test local : supabase db reset → toutes les migs rejouent
5. Rédiger tests pgTAP
6. Update doc backend correspondante
7. APPLICATION MANUELLE en prod : Supabase Dashboard → SQL Editor
8. Commit Git (migration + doc + tests dans le même commit)
```

**Pourquoi manuel ?** L'application via Supabase CLI sur le serveur de prod nécessite un accès direct à la DB qui n'a pas été ouvert au CI (sécurité). L'application manuelle force une **revue humaine** systématique de chaque migration.

### 10.2 Edge Functions

13 fonctions Deno déployées :

| Fonction | Rôle |
|---|---|
| `pawapay-init-deposit` | Initie un paiement MM (boost, KYC, levée susp) |
| `pawapay-webhook` | Reçoit la confirmation PawaPay signée HMAC + double-check |
| `moderate-text` | Modère titre + description annonce (OpenAI) |
| `moderate-image` | Modère photos annonce (AWS Rekognition eu-west-1) |
| `moderate-message` | Modère messages chat asynchrone (OpenAI + signalement auto) |
| `send-push-notification` | Envoie push Expo |
| `send-welcome-email` | Email Resend après signup |
| `send-payment-confirmation` | Email confirmation paiement |
| `send-admin-notification` | Email admin pour signalements, KYC pending |
| `send-alert-digest` | Email quotidien 8h UTC (alertes seuils dépassés) |
| `purge-annonces-photos` | Cron RGPD purge photos J+88 |
| `delete-user-account` | RPC cascade RGPD article 17 |
| `generate-compta-pdf` | Rapport TVA Rwanda mensuel (mig 111-116) |

Déploiement :

```bash
# Une fonction
supabase functions deploy pawapay-webhook

# Avec script pré-deploy (vérif secrets + lockdown grants)
bash scripts/predeploy-moderate-message.sh

# Test local
supabase functions serve moderate-message --env-file .env.local
```

### 10.3 Secrets

Gérés via `supabase secrets set` (jamais committés) :

```bash
supabase secrets set PAWAPAY_API_KEY=xxx
supabase secrets set OPENAI_API_KEY=xxx
supabase secrets set AWS_ACCESS_KEY_ID=xxx
supabase secrets set RESEND_API_KEY=xxx
supabase secrets set NIQO_INTERNAL_KEY=$(openssl rand -hex 32)
```

Inventaire complet : `supabase/.env.example`.

---

## 11. Déploiement admin web Vercel

### 11.1 État

- **Déployé depuis le 2026-05-10**,
- Domaine prod : `niqo.africa` (root) + `niqo.africa/admin/*` (back-office gated),
- Framework : Next.js 16 + RSC + Server Actions,
- Hébergement Vercel (CDN mondial + Edge Functions).

### 11.2 Variables d'environnement Vercel

| Variable | Usage |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client Supabase SSR |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client Supabase SSR (anon, RLS gate) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server Actions admin (jamais exposé client) |
| `RESEND_API_KEY` | Envoi emails KYC + signalements |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry niqo-admin |
| `SENTRY_AUTH_TOKEN` | Upload source maps |

### 11.3 Synchronisation pack légal

Le pack légal (6 docs canoniques) vit dans `docs/legal/*.md` et est synchronisé vers `landing/src/legal-content/` via :

```bash
node landing/scripts/sync-legal.mjs
```

Le script calcule un checksum SHA-256 de chaque fichier, vérifie la cohérence, et copie le contenu. Rendus :

- Mobile : `app/legal/*.tsx` avec WebView,
- Web : `landing/src/app/legal/*` (indexable Google),
- PDF : `assets/legal-pdf/*.pdf` (téléchargeables).

---

## 12. OTA vs rebuild — règle de bump

C'est **la** règle opérationnelle à connaître pour ne pas planter un user en prod. Documentée dans `CLAUDE.md` §Git & déploiement.

| Type de change | OTA possible ? | Action |
|---|---|---|
| Fix UI / copy / Tailwind class | ✅ Oui | `eas update --channel production` (instant) |
| Logique JS/TS pure, nouvelle écran | ✅ Oui | `eas update --channel production` |
| Update RPC Supabase / migration | ✅ Oui (mig séparée) | Appliquer mig en prod **puis** OTA si nécessaire |
| Nouveau module Expo natif | ❌ Non | Rebuild + resubmit store |
| Permission iOS / Android | ❌ Non | Rebuild + resubmit store |
| Changement icône / splash / deep link | ❌ Non | Rebuild + resubmit store |
| Mise à jour SDK Expo majeur | ❌ Non | Rebuild + resubmit store |

**Piège vécu 2026-05-17** : tentative OTA après go-live → échec car `extra.eas.projectId` et `updates.url` mismatchaient le projectId réel. Conséquence : rebuild 1.0.1 forcé. Solution durcie : check systématique `eas project:info` avant chaque release. Détails dans `docs/gotchas.md` section EAS Update.

---

## 13. Monitoring de production

### 13.1 Trois piliers d'observabilité

Référence complète : [`docs/backend/observability.md`](backend/observability.md).

| Pilier | Techno | Cible |
|---|---|---|
| **Errors temps réel** | Sentry × 3 projets | `niqo-edge` (Edge Functions), `niqo-mobile` (Expo), `niqo-admin` (Next.js) |
| **Compteurs business** | `niqo_event_log` (mig 106-107) | INSERT auto via trigger sur events métier (signup, annonce_created, message_sent, rdv_proposed, etc.) |
| **Alertes digest** | Cron 8h UTC + Resend (mig 108) | Email récap quotidien si seuils dépassés (signalements > 2× moy 7j, erreurs Sentry, KYC pending > 48 h) |

### 13.2 Dashboard `/admin/observability`

Consomme `niqo_event_log` pour afficher en temps réel (charts Recharts) :

- Inscriptions / annonces / messages / RDV proposés/confirmés / KYC pending — sur 30 j / 90 j / 12 mois,
- Top 10 catégories par activité,
- KYC en attente avec âge (> 48 h surligné rouge),
- Signalements pending par cible (annonce/user/message/rdv).

### 13.3 Alertes Sentry à configurer (post-launch)

- Crash spike > 10/h → email Slack admin,
- Edge Function `pawapay-webhook` 5xx > 1 % sur 5 min → email immédiat,
- Mobile `lib/auth/AuthProvider` erreurs > 3/min → email digest.

### 13.4 État Sentry mobile au 2026-05-19

⚠ Temporairement **désactivé** (no-op mock dans `lib/sentry.ts`) pour débloquer les EAS production builds (manque `SENTRY_AUTH_TOKEN` au moment du rush iOS). Edge Functions + Admin web restent instrumentés. **Restauration prévue** dans la semaine post-launch (task #18 du suivi).

### 13.5 Uptime externe — planifié

UptimeRobot configurable pour probe `niqo.africa/api/health` toutes les 5 min, alerte email si > 3 échecs consécutifs.

---

## 14. Rollback et incident response

### 14.1 Rollback OTA (≤ 5 min)

Quand un OTA introduit un bug bloquant en prod :

```bash
# Lister les updates de la branche production
eas update:list --channel production

# Republier un update antérieur sain (ex : commit abc123)
eas update --branch production --republish --group <prev-update-id>
```

L'app mobile télécharge le bundle JS antérieur au prochain refresh (réseau requis). Cible : **< 5 min** entre détection et restauration.

### 14.2 Rollback migration DB

**Pas de DOWN migration automatique** (choix assumé pour MVP : trop risqué sur prod live).

Procédure manuelle :

1. **Snapshot avant** : `supabase db dump` automatique avant chaque mig prod,
2. **Si bug détecté** : créer immédiatement une **migration corrective** (NN+1) qui annule/corrige le change problématique,
3. **Push + apply** la mig corrective dans la même session SQL Editor,
4. **Postmortem** dans `docs/references/incident-response.md`.

**Pourquoi pas de DOWN ?** Une migration prod qui crée une table + des données ne se « rollback » pas sans perte. La discipline est : **chaque mig produit un état stable et restaurable par avancement**.

### 14.3 Rollback rebuild store

Si un binaire 1.0.1 est cassé et publié :

- **iOS** : Apple ne permet pas de retirer une version, mais on peut **expedited submit** d'un 1.0.2 fix en mentionnant l'urgence (~2-4 h en pratique),
- **Android** : on peut **halt rollout** depuis Play Console à 1 % de déploiement, puis pousser 1.0.2.

### 14.4 Incident response data breach

Plan détaillé : [`docs/references/incident-response.md`](references/incident-response.md).

**Délai légal de notification autorité : 72 h** (CI art. 34 loi 2024-30, CG art. 28 loi 2023-15, Rwanda 2021-058, RGPD UE art. 33).

Phases :

1. **Détection (T0)** : logger date/heure, ne rien modifier (preuves).
2. **Confinement (T+0 à T+1h)** : rotation `service_role`, reset compte admin compromis, patch RLS, unpublish EF vulnérable.
3. **Évaluation (T+1h à T+24h)** : quelles données, combien d'utilisateurs, pays concernés.
4. **Notification (T+24h à T+72h)** : autorité concernée + users impactés.
5. **Postmortem** : doc dans `docs/incidents/<date>-<slug>.md`.

### 14.5 Runbook compromission `service_role`

```
1. Supabase Dashboard → Settings → API → "Reset service_role key"
2. Mettre à jour tous les .env de tous les environnements (Vercel, Edge Functions secrets)
3. Forcer un redeploy de toutes les Edge Functions
4. Re-déployer le admin web (Vercel cache busts)
5. Audit Supabase logs UI pour identifier la fenêtre d'exposition
6. Notifier les users si données accédées (CNIL et homologues sous 72 h)
```

---

## 15. Mapping vers les compétences RNCP CDA Bloc 3

Le **Bloc RNCP3** du titre Concepteur Développeur d'Applications (RNCP 31678) couvre 3 compétences. Voici la mise en correspondance avec les éléments du projet Niqo.

| Compétence RNCP3 | Élément Niqo | Section / fichier |
|---|---|---|
| **Préparer et exécuter les plans de tests** | Stratégie dual-layer pgTAP + Vitest + UX manuels par feature. Couverture 370 assertions DB + 80 tests intégration + 8 plans UX. | §2, §3, §4, §5 + `tests/sql/`, `tests/integration/`, `docs/features/*-tests.md` |
| **Préparer et documenter le déploiement** | `eas.json` 4 profils, scripts predeploy Edge Functions, Vercel CI/CD git-push, process officiel migrations DB (`docs/backend/PROCESS.md`), runbooks par surface | §7, §8, §10, §11 + `eas.json`, `scripts/`, `docs/backend/PROCESS.md` |
| **Contribuer à la mise en production en DevOps** | OTA vs rebuild documenté, versioning semver post-1.0, monitoring 3 piliers (Sentry + niqo_event_log + alertes digest), audit log admin immutable, ASO screenshots versionnés, plan incident response 72 h | §12, §13, §14 + `docs/backend/observability.md`, `docs/references/incident-response.md` |

### Preuves opérationnelles tangibles

- ✅ **Application réellement publiée sur l'App Store** (147 pays) depuis 2026-05-17 — validation Apple en 24 h.
- ✅ Tests automatisés exécutables : 16 modules pgTAP, 13 modules Vitest.
- ✅ Audit OWASP `/cso` green le 2026-05-10 (RLS + open redirect + SHA-pin CI).
- ✅ Pack légal v1.1 publié `niqo.africa/legal/*` (CGU/CGV/Confidentialité/Mentions/Charte/Cookies).
- ✅ Documentation déploiement exhaustive : `CLAUDE.md`, `docs/backend/PROCESS.md`, `docs/gotchas.md`, `docs/changelog-launch.md`.
- ✅ Rollback OTA testé en conditions réelles (rebuild 1.0.1 imposé 2026-05-17 après échec config `updates.url`).
- ✅ Plan incident response documenté + procédures par scénario.

---

## Annexe — Runbooks et commandes utiles

### A.1 Lancer tous les tests en local

```bash
# Setup Supabase local + migrations
supabase start
supabase db reset

# pgTAP
psql "$(supabase status --output env | grep DB_URL | cut -d= -f2)" \
  -f tests/sql/_runner.sql

# Vitest
cd tests/integration && npm install && npm test
cd ../..

# Lint + TypeScript
npm run lint
npx tsc --noEmit
```

### A.2 Build et soumission iOS

```bash
# Vérifier la cohérence projectId AVANT build
eas project:info

# Build prod iOS (~15 min)
eas build --platform ios --profile production

# Submit App Store Connect (avec metadata pré-configurée)
eas submit --platform ios --profile production
```

### A.3 Mise à jour OTA production

```bash
# Tester avant : preview channel
eas update --channel preview --message "test: fix clavier"

# Vérifier sur device interne pendant 24h

# Promouvoir prod
eas update --channel production --message "fix: clavier paiement chat"

# Si bug → republish version précédente (≤ 5 min)
eas update:list --channel production
eas update --branch production --republish --group <prev-id>
```

### A.4 Déployer une Edge Function

```bash
# Vérifier les secrets manquants
supabase secrets list

# Set secret manquant
supabase secrets set OPENAI_API_KEY=sk-...

# Pré-déploiement (lockdown grants + check)
bash scripts/predeploy-moderate-message.sh

# Déploiement
supabase functions deploy moderate-message
```

### A.5 Appliquer une migration en prod

```sql
-- Dans Supabase Dashboard → SQL Editor :
-- 1. Copier le contenu de docs/migrations/NN_feature.sql
-- 2. Lancer (Run) — vérifier 0 erreurs
-- 3. Re-lancer immédiatement (test idempotence) — doit fonctionner
-- 4. Vérifier dans Database → Tables que le change est appliqué
-- 5. Commit Git mig + doc + tests dans la même PR
```

### A.6 Diagnostic rapide en prod

```bash
# Logs Edge Function
supabase functions logs pawapay-webhook --tail

# Métriques Postgres
# (Supabase Dashboard → Database → Reports)

# Sentry mobile
# (sentry.io → niqo-mobile → Issues, filter "since: 1h")

# Event log business
psql "..." -c "
  SELECT event_name, count(*)
  FROM niqo_event_log
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY event_name ORDER BY 2 DESC;
"
```

---

> **Document soutenu lors de la session de jury RNCP CDA — 2026.**
> Auteur : Dominique Huang — Date : 2026-05-19 — Version : 1.0
> À lire avec : [docs/CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md), [docs/methodologie-uml.md](methodologie-uml.md), [docs/pre-production-checklist.md](pre-production-checklist.md), [docs/backend/PROCESS.md](backend/PROCESS.md), [docs/backend/observability.md](backend/observability.md), [docs/references/incident-response.md](references/incident-response.md).

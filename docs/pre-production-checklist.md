# Niqo — Checklist pré-production

> État au **2026-05-09**. Document maître pour tracker tout ce qui reste à valider
> avant le GO live MVP (Abidjan + Brazzaville).
>
> Mise à jour à chaque module backfilled, chaque test UX joué, chaque livrable infra.

---

## 1. Backend — Doc + tests automatisés (par module)

> Process officiel défini dans `CLAUDE.md` §Backend ownership :
> 1. Doc backend (`docs/backend/<module>.md`)
> 2. Audit cohérence → mig de cleanup si écart
> 3. Tests pgTAP (`tests/sql/<module>.test.sql`) — RPCs, triggers, RLS
> 4. Tests intégration Vitest (`tests/integration/<module>.test.ts`) — flows end-to-end
> 5. Validation locale + CI green

### Tier 🔴 P0 — Argent + confiance (bug = perte d'argent ou perte de confiance plateforme)

| Module | Doc backend | pgTAP | Vitest | Mig fix livrées |
|---|---|---|---|---|
| **Auth** | ✅ `docs/backend/auth.md` | ✅ 43 assertions (`tests/sql/auth.test.sql`) | ✅ 8 tests (`tests/integration/auth.test.ts`) | ✅ mig 81 (régression handle_new_user) + mig 84 (UNIQUE telephone) + mig 99 (drop dead update_my_phone) |
| **RDV** | ✅ `docs/backend/rdv.md` | ✅ 32 + 95 assertions (`rdv.test.sql` + `rencontre.test.sql`) | ✅ 13 tests (`rdv.test.ts`) | ✅ migs 86→98 (rencontre mutuelle, crons relance, signalement contextualisé, photos, bannière Home) + mig 100 (guard IMMO_NO_RDV) |
| **Notation** | ⏳ next | — | — | — |
| **KYC** (partiel) | — | ✅ 8 assertions (uniqueness numero_cni — `tests/sql/kyc.test.sql`) | — | ✅ mig 85 (UNIQUE numero_cni) |
| **Boost** | — | — | — | — |
| **Admin KPIs** | — | — | — | — |

### Tier 🟡 P1 — Cœur du marketplace, plus complexes

> ⚠ Ce tableau est snapshot daté — voir `docs/backend/PROCESS.md` §État du backfill pour l'état à jour (2026-05-16 : tous P0+P1 ont doc + pgTAP + Vitest, hormis Blocking shipped en urgence 2026-05-15 dont les tests restent à écrire).

| Module | Doc backend | pgTAP | Vitest |
|---|---|---|---|
| **Annonces** | — | — | — |
| **Conversations** | — | — | — |
| **Signalements** | — | — | — |
| **Storage** (buckets + RLS) | — | — | — |
| **Blocking** (F15, mig 129-132 — Apple Guideline 1.2 UGC) | ✅ `docs/backend/blocking.md` | ❌ à créer | ❌ à créer |

### Tier 🟢 P2 — Plus simples, moins critiques

| Module | Doc backend | pgTAP | Vitest |
|---|---|---|---|
| **Profil** | — | — | — |
| **Catégories** | — | — | — |
| **Recherche** | — | — | — |
| **Favoris** | — | — | — |
| **Push** | — | — | — |

### Inventaire fichiers tests

#### Tests pgTAP (SQL niveau base — RPCs, triggers, RLS isolés)

Dossier : `tests/sql/`

| Fichier | Module | Assertions | État |
|---|---|---|---|
| `_runner.sql` | (helpers `tests.set_jwt_for`, etc.) | — | ✅ infra |
| `auth.test.sql` | Auth | 43 | ✅ |
| `rdv.test.sql` | RDV (migs 35-40 + mig 100) | 32 | ✅ |
| `rencontre.test.sql` | RDV trust v2 (migs 86-98) | 95 | ✅ |
| `kyc.test.sql` | KYC (mig 85 uniquement — uniqueness numero_cni) | 8 | 🟡 partiel |
| `notation.test.sql` | Notation (F06) | — | ❌ à créer |
| `boost.test.sql` | Boost (F09) | — | ❌ à créer |
| `admin_kpis.test.sql` | Admin KPIs (F13) | — | ❌ à créer |
| `annonces.test.sql` | Annonces (CRUD + lifecycle) | — | ❌ à créer |
| `conversations.test.sql` | Conversations + messages + Realtime | — | ❌ à créer |
| `signalements.test.sql` | Signalements (mobile + admin cascade) | — | ❌ à créer |
| `storage.test.sql` | Storage RLS (avatars, annonces-photos, cni-verifications, rencontre-photos) | — | ❌ à créer |
| `profil.test.sql` | Profil (update_my_profile, avatar, etc.) | — | ❌ à créer |
| `categories.test.sql` | Catégories (fetch + RLS) | — | ❌ à créer |
| `recherche.test.sql` | Recherche annonces (filtres pays/cat/ville/tri) | — | ❌ à créer |
| `favoris.test.sql` | Favoris (toggle + RLS owner) | — | ❌ à créer |
| `push.test.sql` | Push (register/unregister token, triggers events) | — | ❌ à créer |

**Total actuel : 4 fichiers test, 177 assertions.** Cible MVP : ~17 fichiers, ~500+ assertions.

#### Tests Vitest (intégration end-to-end via PostgREST)

Dossier : `tests/integration/`

| Fichier | Module | Tests | État |
|---|---|---|---|
| `auth.test.ts` | Auth | 8 | ✅ |
| `rdv.test.ts` | RDV (migs 35→98) | 13 | ✅ |
| `notation.test.ts` | Notation | — | ❌ à créer |
| `kyc.test.ts` | KYC (flow complet : submit → admin validate → email Resend mocked) | — | ❌ à créer |
| `boost.test.ts` | Boost (init paiement → webhook → badge) | — | ❌ à créer |
| `admin_kpis.test.ts` | Admin KPIs (filtre période, sources cohérentes) | — | ❌ à créer |
| `annonces.test.ts` | Annonces (CRUD + expiration + buyer visibility) | — | ❌ à créer |
| `conversations.test.ts` | Conversations (Realtime postgres_changes, content filter, sons) | — | ❌ à créer |
| `signalements.test.ts` | Signalements (auto-suspend score≥3, cascade admin) | — | ❌ à créer |
| `storage.test.ts` | Storage (uploads owner, RLS, purge cascade) | — | ❌ à créer |
| `profil.test.ts` | Profil (atomic update, avatar, delete_my_account cascade) | — | ❌ à créer |
| `favoris.test.ts` | Favoris (multi-user isolation) | — | ❌ à créer |
| `push.test.ts` | Push (mock Expo Push, triggers business events) | — | ❌ à créer |

**Total actuel : 2 fichiers test, 21 tests.** Cible MVP : ~13 fichiers, ~80+ tests.

### Infra tests automatisés

- [x] pgTAP runner + helpers (`tests/sql/_runner.sql`)
- [x] Vitest setup (`tests/integration/` — config + helpers)
- [x] CI GitHub Actions (`.github/workflows/backend-tests.yml`)
- [x] CI bloquante : pgTAP red → Vitest skipped → PR red (job dépendance `needs: pgtap`)
- [x] Workflow trigger sur push develop/main + pull_request + workflow_dispatch (re-run manuel UI/CLI)
- [x] Concurrency : annule les anciens runs si nouveau push sur la même PR
- [x] Wait full stack ready (PostgREST + GoTrue + admin endpoint + safety margin) avant Vitest
- [x] Dump Postgres + GoTrue logs sur failure (debug aid)
- [ ] Branch protection effective (require Pro plan ou repo public — décision en attente)

---

## 2. Tests UX manuels (multi-device — 1 simu iOS + 1 iPhone perso)

> Pour chaque feature livrée. Pattern `docs/features/<feature>-tests.md` avec
> scénarios cochables. Complémente les tests automatisés (Realtime, push,
> OAuth multi-device, UX réelle).

| Feature | Test plan | Joué |
|---|---|---|
| **F01 Auth** (Google, Apple, Email) | ✅ `docs/features/auth-tests.md` | — |
| **F02 Annonces** (création wizard) | ✅ `docs/features/annonces-tests.md` | — |
| **F05 RDV** (propose/confirme/cancel) | ✅ `docs/features/rdv-tests.md` | partiel |
| **F05+F06 RDV trust v2** (anti-fraude rencontre + photos + signalement post-RDV + bannière) | ✅ `docs/features/rdv-trust-v2-test-plan.md` (8 blocs, ~2h30) | **À jouer** |
| **F06 Notation** (post-RDV, auto-3/5 J+7) | ✅ `docs/features/notation-tests.md` | — |
| **F07 KYC** (CNI + selfie + paiement + admin web) | ✅ `docs/features/F07-kyc-tests.md` | — |
| **F08 Signalements** (mobile + admin web) | ✅ `docs/features/signalements-tests.md` | — |
| **F09 Boost** (7j / 30j, PawaPay, badge) | — | — |
| **F10 Push** (10 events, cold-start, foreground) | — | — |
| **F11 Expiration auto** (60j cron + prolongation 28j) | — | — |
| **F12 Dashboard vendeur** (stats bento) | — | — |
| **F13 Admin web KPIs** (filtre période, charts Recharts) | — | — |

### Scope multi-device à valider en bout de route

- [ ] OAuth Google sur iOS device réel (Safari WebAuth)
- [ ] OAuth Apple sur iOS device réel (Apple ID natif)
- [ ] Push notifications cold-start (app fermée → tap notif → deeplink)
- [ ] Push notifications foreground (badge unread, son chat)
- [ ] Realtime chat 2 devices (latence, ordering, reconnect après réseau down)
- [ ] Suspension d'un compte en temps réel (admin suspend → user A reçoit signOut au prochain foreground)
- [ ] Droit à l'oubli complet (delete_my_account → cascade Storage + DB → purge cron J+30)

---

## 3. Pré-production — Infra, business, légal

### 🔴 Bloquants absolus

- [x] **Société Rwanda** enregistrée (entité légale Niqo) — ✅ confirmé Dominique 2026-05-09
- [x] **Compte PawaPay production** activé (sortir de la sandbox) — ✅ confirmé Dominique 2026-05-09
- [x] **Compte Apple Developer** (99 $/an) — ✅ confirmé Dominique 2026-05-09
- [x] **Compte Google Play Developer** (25 $ one-time) — ✅ confirmé Dominique 2026-05-09
- [ ] **EAS Build production iOS** (signing certs, provisioning profile, push key APNs)
- [ ] **EAS Build production Android** (keystore, FCM Server Key) — keystore déjà généré pour profil `development`, à étendre/copier sur profil `production`
- [ ] **FCM (Firebase Cloud Messaging)** setup pour push Android prod (iOS marche déjà via APNs) — voir `docs/features/push-fcm-setup.md`. **Pipeline validé 2026-05-09 sur Redmi Note 13 Pro 5G** (DB → pg_net → EF → Expo Push → FCM → device). Reste à valider sur build profil `production` + 1 Tecno/Itel + cold-start (cf. checklist détaillée dans le doc).
- [x] **Soumission App Store** + review Apple — ✅ **LIVE 2026-05-17** sur https://apps.apple.com/app/niqo-annonces-afrique/id6769410032 (App ID `6769410032`). Resubmit après rejet Guideline 1.2 UGC avec feature Block (mig 129-132). Validation Apple 24h.
- [ ] **Soumission Play Store** + review Google (1-2 jours)

### 🟡 Bloquants opérationnels

- [x] **Vercel deploy `landing/`** (admin web — Next.js 16) — ✅ déployé Dominique 2026-05-09 avec nom de domaine acheté sur NameCheap
- [x] **Variables prod Supabase** : `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Expo) + `SUPABASE_SERVICE_ROLE_KEY` côté serveur Vercel — ✅ configurées (à confirmer en bout de chaîne via test login admin)
- [x] **Variables prod Resend** (emails KYC validation/refus) — ✅ Resend configuré 2026-05-09
- [x] **DNS Resend** (SPF/DKIM/DMARC) configuré sur le domaine d'envoi — ✅ DNS posé sur NameCheap 2026-05-09
- [ ] **Webhook PawaPay prod** : flow validé en sandbox (✅ 2026-05-10 — sandbox marche end-to-end avec numéros test PawaPay). EF `pawapay-webhook` + `pawapay-init-deposit` déjà déployées et configurées. Restent 2 actions au go-prod : (a) update secrets Supabase `PAWAPAY_API_KEY` ← clé Bearer prod + `PAWAPAY_API_URL` ← `https://api.pawapay.cloud` (sans `.sandbox`) ; (b) configurer la même URL webhook EF dans Dashboard PawaPay prod (compte/instance séparé du sandbox). NB : `PAWAPAY_MOCK` n'est PAS posé (mode réel actif), à laisser absent en prod.
- [x] **Cron jobs prod activés** dans Supabase — ✅ audit 2026-05-10 confirme **9 crons actifs** : `expire-annonces` (0 2 * * *, mig 16), `purge-expired-annonces` (0 3 * * *, mig 16), `niqo-purge-suspended-users` (0 3 * * *, mig 04), `purge-expired-kyc-verifications` (0 3 * * *, mig 54+75 — **re-schedulé 2026-05-10** car skippé silencieusement à l'origine quand pg_cron pas encore activé, fix RGPD CNI Storage), `purge-stale-push-tokens` (0 3 * * *, mig 68), `purge-expired-boosts` (*/15 * * * *, mig 60→62), `rencontre-reminder` (0 10 * * *, mig 87), `mark-vendue-reminder` (0 10 * * *, mig 90), `rdv-reminder` (0 * * * *, mig 97). Pas 10 : `avis-auto-j7` a été délibérément supprimé par mig 38.

### 🟢 Souhaitable mais non bloquant pour M1

- [x] **Pack légal v1.1 — premier jet "dépanne sans avocat"** (2026-05-10) : 6 documents canoniques rédigés dans `docs/legal/*.md` (CGU v1.1, CGV v1.0, Politique de confidentialité v1.1, Mentions légales v1.0, Charte communautaire v1.0, Politique cookies v1.0) + `CHANGELOG.md`. Mobile : 5 écrans `app/legal/*.tsx` via composants partagés `components/ui/LegalBlocks.tsx`. Web : 6 pages prerender statiques `landing/src/app/legal/*/page.tsx` via `react-markdown` + script `npm run sync-legal` (predev/prebuild). Footer légal sur homepage + `/a/[id]`. Versioning structuré dans `lib/legal.ts` (`LEGAL_VERSIONS`).
- [ ] **CGU / CGV / Confidentialité / Mentions / Charte / Cookies — validation avocat** (loi CI 2024-30, loi CG 2023-15, loi RW 2021-058) : 1er jet rédigé, à faire reviewer par un cabinet africain (CI + CG + RW) avant lancement public. *Soft launch beta possible avant — la validation tourne en parallèle ~2-3 semaines.*
- [ ] **Mentions légales — champs "à compléter"** : remplir dans `docs/legal/mentions-legales.md` + écran mobile + page web après délivrance officielle Rwanda :
  - [ ] Numéro d'immatriculation **RDB** (Rwanda Development Board)
  - [ ] **Capital social**
  - [ ] **Adresse postale complète Kigali** (siège social)
- [ ] **Représentants locaux CI + CG** — engagement formalisé dans CGU §16 + Confidentialité §2 : désigner un représentant dans chaque pays **dans les 6 mois** suivant le lancement public (exigence ARTCI + ANRTIC). Non bloquant au lancement, bloquant à M+6.
- [ ] **Boîtes mail légales** à provisionner (cités dans CGU §17 + Mentions légales §10) : `legal@niqo.africa`, `dpo@niqo.africa`, `security@niqo.africa`, `billing@niqo.africa`. Aujourd'hui seul `support@niqo.africa` + `bonjour@niqo.africa` existent. Setup : alias forwarding vers Dominique sur Google Workspace ou équivalent. Bloquant pour la crédibilité juridique des docs.
- [ ] **Écran de consentement CGV** — case à cocher distincte sur l'écran de paiement avant achat d'un service payant (boost / KYC / levée suspension), matérialisant l'acceptation expresse du démarrage immédiat + renonciation au droit de rétractation (cf. CGV §6.1). Sans ça, la non-remboursabilité (CGV §6.2) est juridiquement contestable. Couvre les 3 services PawaPay payants existants.
- [ ] **Bandeau re-consentement CGU + Confidentialité** quand `LEGAL_VERSIONS.cgu.date` ou `.privacy.date` est plus récent que `users.cgu_accepted_at` du profil — exigé par CGU §14 (15 jours de préavis avant entrée en vigueur). Aujourd'hui `LEGAL_LAST_UPDATED` est passé de `2026-05-07` (v1.0) à `2026-05-10` (v1.1) → tous les comptes existants devront re-consenter. *Phase 2 du pack légal, non bloquant pour le lancement public si on ramène la cohorte beta à 0 avant lancement (clean slate).*
- [ ] **Audit RGPD** finalisé (`docs/references/rgpd-audit.md` à jour avec les 6 nouveaux docs légaux)
- [x] **Observabilité — stack complet** (2026-05-10) : 3 piliers en place — voir `docs/backend/observability.md`.
  - [x] **Sentry** (3 projets `niqo-edge` + `niqo-mobile` + `niqo-admin`) — capture errors temps réel. Edge + Next.js admin validés end-to-end. Mobile : code en place, validation au prochain build EAS prod (off en `__DEV__` par design).
  - [x] **niqo_event_log** (mig 106-107) — table append-only + RPC `log_event` SECURITY DEFINER + cron purge 30j. RLS deny-by-default admin only.
  - [x] **4 Edge Functions instrumentées** (commit 820a56e) — `send-push-notification`, `pawapay-init-deposit`, `pawapay-webhook`, `purge-annonces-photos` loguent succès + échecs via `_shared/event_log.ts`.
  - [x] **10 crons DB instrumentés** (mig 109) — wrapper `_cron_run_logged(cron_name, fn_name)` qui log `cron.run`/`cron.error` + duration_ms. Si un cron est en panne, le digest alert détecte le silence.
  - [x] **Dashboard `/admin/observability`** — tiles par module + chart Recharts stacked + filtre 24h/7d/30d + tables erreurs/warnings récents.
  - [x] **Alertes email auto Resend** (mig 108) — digest quotidien 8h UTC si seuils dépassés (errors > 0, warnings ≥ 5, total = 0). Table `niqo_alert_recipients` + Edge Function `send-alert-digest`. Email HTML responsive avec lien dashboard.
- [ ] **Sentry release tracking** — injecter `SENTRY_RELEASE` (git SHA ou version `app.json`) dans le build EAS + Vercel pour corréler les crashes à un deploy spécifique. Sans ça, impossible de dire "ce crash vient du build 1.0.2 vs 1.0.3". ~30 min.
- [ ] **Sentry mobile source maps validation** — provoquer un crash sur build EAS preview, vérifier que la stack Sentry montre des noms fichiers/lignes lisibles (pas du code minifié). Nécessite `SENTRY_AUTH_TOKEN` en EAS Secret. ~1h.
- [ ] **Sentry Alert Rules** — configurer côté UI Sentry "Si >10 new issues en 1h → email" pour les 3 projets. ~10 min par projet.
- [ ] **Uptime monitoring externe** — UptimeRobot ou BetterStack pings toutes les 5 min sur `pawapay-webhook`, `/admin/login`, `/rest/v1/`. Free tier suffit. Sans ça, si Supabase ou les Edge Functions sont down, on ne le sait pas avant qu'un user paye. ~15 min.
- [ ] **Backup automatique Supabase** (Point-in-Time Recovery 7j sur Pro tier)
- [ ] **Status page** publique (uptime monitoring : statuspage.io ou Better Uptime)
- [x] **UX admin — regrouper signalements liés** : section "Signalements liés" en bas du détail signalement (`landing/src/app/admin/(admin-protected)/signalements/[id]/_related-signalements.tsx`). Filtre matching strict tuple `(target_type, target_id)` + `statut='en_attente'` + exclude current. Affiche rien si 0 résultat (pas de section vide). MVP scope : matching strict (couvre réciprocité Jean→Marie sur la même conv `rdv_post` ou même annonce). Cross-target (rdv_post → annonce_id de la conv) Phase 2 si besoin. ✅ 2026-05-09
- [x] **Email — changer le sender `noreply@niqo.africa`** : migré vers `bonjour@niqo.africa` dans les 3 templates `landing/src/lib/email/*.ts` (verification-result, annonce-suspended, signalement-result) + Supabase Auth SMTP côté Dashboard. Plus humain, anti-spam (Gmail/Outlook filtrent les `noreply@*`), aligné ton tutoiement Niqo. ✅ 2026-05-09
- [ ] **Email deliverability — sortir du dossier spam** : test mai 2026 confirmé que `bonjour@niqo.africa` arrive en spam Gmail. Causes probables (par ordre) : (a) DMARC manquant ou mal configuré sur DNS NameCheap pour `niqo.africa`, (b) domaine trop neuf → réputation 0 (warm-up nécessaire : 10-20 emails/jour augmenté progressivement sur 2-4 semaines), (c) headers `Reply-To` + `List-Unsubscribe` manquants dans les 3 templates Resend, (d) IP partagée Resend free tier (dedicated IP ~10€/mois). **Action** : 1. lancer https://www.mail-tester.com/ pour audit précis, 2. fix DNS DMARC si KO (`v=DMARC1; p=none; rua=mailto:postmaster@niqo.africa` minimum), 3. ajouter headers Reply-To + List-Unsubscribe au code, 4. envisager dedicated IP si volume >1k emails/mois. *À traiter avant le pic d'activation post-launch (sinon les emails KYC/signalement risquent de ne pas arriver).*
- [x] **Bouton Partager annonce — page web fallback** : ✅ 2026-05-10, route publique `landing/src/app/a/[id]/page.tsx` qui SSR l'annonce depuis Supabase (RLS anon sur `annonces.statut='active'`) + OG tags pour preview WhatsApp/iMessage. Le message partagé mobile utilise désormais `https://niqo.africa/a/{id}` (auto-linkifié par tous les messagers) au lieu du custom scheme `niqo://` (qui n'était pas cliquable hors app). La page web a 2 CTA : "Ouvrir dans l'app" → tente `niqo://announce/{id}` (marche si app installée) + fallback "Télécharger Niqo". **2026-05-17** : le badge App Store wire vers `https://apps.apple.com/app/niqo-annonces-afrique/id6769410032` (post-publish iOS). Badge Google Play reste placeholder en attendant launch Android (Phase 2 ~2026-05-30).
- [ ] **Universal Links iOS + App Links Android** (Phase 2 — polish ouverture directe) : aujourd'hui le tap sur `https://niqo.africa/a/{id}` ouvre la page web (qui propose ensuite "Ouvrir dans l'app"). Avec Universal Links, iOS/Android intercepterait le lien et ouvrirait directement l'app sur la bonne annonce sans étape intermédiaire. **Setup** : 1. déposer `.well-known/apple-app-site-association` (JSON) sur `niqo.africa` — nécessite Team ID Apple + Bundle ID (post-1er build EAS App Store Connect), 2. déposer `.well-known/assetlinks.json` (App Links Android) — nécessite SHA256 fingerprint (depuis EAS Build), 3. configurer `associatedDomains: ["applinks:niqo.africa"]` dans `app.json` Expo, 4. tester sur device réel (les Universal Links ne marchent PAS dans Expo Go ni simu). **Total** : ~1-2h une fois les fingerprints stores en main. Pas bloquant pour MVP, juste 1 redirect en moins.

---

## 4. Sécurité — Reviews appliquées (livré)

- [x] **Review #1 + #2 sécurité** (mai 2026)
  - [x] mig 70-73 — FK cascade fixes pour droit à l'oubli (avis, conversations, verif, storage)
  - [x] mig 74-76 — RLS UPDATE durcie sur conversations/messages, helper `is_my_account_active()` sur INSERT critiques
  - [x] mig 77 — scrub `pawapay_metadata.payer.phone`, trigger score_abus étendu à `is_active`
  - [x] mig 84 — UNIQUE telephone (anti-fraude phone réutilisé sur N comptes)
  - [x] mig 85 — UNIQUE numero_cni (anti-fraude KYC)
  - [x] mig 86-88 — Rencontre mutuelle anti-fraude RDV + voix acheteur
  - [x] mig 91 — Signalement post-RDV contextualisé (auto-pause annonce si fraude)
  - [x] mig 94 — Security Advisor cleanup (search_path, REVOKE EXECUTE bulk, view security_invoker)
  - [x] Webhook PawaPay double-check via API GET `/v2/deposits/{id}` (Option B en attendant RFC-9421)
  - [x] Edge Function push : auth via `NIQO_INTERNAL_KEY` 32 bytes hex + `constantTimeEquals`

### À surveiller en continu

- [ ] **Rotation clés Vault** (clé chiffrement téléphone `phone_encryption_key`, push key `push_internal_key`) — pas de rotation auto, à faire annuellement
- [ ] **Rate limiting** sur les RPC sensibles (`update_my_profile`, `submit_verification`) — Phase 2 (Supabase Pro)
- [ ] **Audit log admin** : tracer qui a validé quelle KYC / cascadé quel signalement

---

## 5. Migrations en production (au 2026-05-09)

> Une migration est considérée "appliquée" quand jouée dans Supabase Dashboard
> SQL Editor. Toutes les migs `docs/migrations/NN_*.sql` doivent l'être avant
> que le code mobile/admin web associé soit shipped.

**État global :** ✅ migs **01 → 100 toutes jouées en prod** (confirmé Dominique 2026-05-09).

À surveiller pour la suite : toute nouvelle migration créée après le 2026-05-09 (mig 101+) devra être jouée manuellement avant son code associé.

---

## 6. Planning lancement (CDC v4.0 §7.2)

| Période | Phase | Livrables | Statut |
|---|---|---|---|
| S1-2 | Setup & Admin | Société Rwanda, compte PawaPay, env dev | ✅ Rwanda + PawaPay prod + Apple Dev + Google Play Dev tous fait (2026-05-09) |
| S3-5 | MVP Core | Auth, annonces, recherche, profils, messagerie | ✅ |
| S6-7 | Confiance | Notation post-RDV, vérification identité, signalements | ✅ |
| S8 | Monétisation | Boosts annonces, paiement PawaPay boosts, dashboard vendeur | ✅ |
| Bonus | Back-office admin | Verifications, signalements, KPIs | ✅ |
| Bonus | Sécurité reviews | RLS hardening, FK fixes, scrub PII, anti-fraude rencontre | ✅ |
| Bonus | Backend ownership | Setup pgTAP + Vitest + CI GitHub Actions | 🟡 infra ✅ / docs+tests par module en cours (Auth + RDV ✅) |
| **S9-10** | **Tests & Optim** | **Beta 10 users, perf mobile** | ❌ pas démarré |
| **S11** | **Déploiement** | **Build EAS, Play Store, Vercel admin** | ❌ pas démarré |
| **S12** | **Lancement** | **5 influenceurs, 50 vendeurs pré-inscrits, GO live** | ❌ pas démarré |

---

## 7. Flow recommandé pour finir avant GO

1. **Finir les tests UX RDV trust v2** (`rdv-trust-v2-test-plan.md`, ~2h30)
2. **Backfill Notation** (doc + pgTAP + Vitest)
3. **Backfill KYC complet** (déjà partiel — étendre la couverture pgTAP)
4. **Backfill Boost** (paiement PawaPay critique → P0)
5. **Backfill Admin KPIs** (RPC `get_admin_kpis` complexe)
6. Push test plans manuels manquants (F09 Boost, F10 Push, F11 Expiration, F12 Dashboard, F13 Admin KPIs)
7. ~~Société Rwanda + PawaPay prod~~ ✅ déjà fait
8. **EAS Build prod iOS + Android** (1-2j) — credentials Apple Dev + Google Play Dev déjà OK
9. ~~Vercel deploy admin web~~ ✅ déjà fait (avec domaine NameCheap + Resend + DNS)
10. **Webhook PawaPay prod** (URL EF publique à connecter dashboard PawaPay) (2h)
11. **Soumission stores** (1-7j review Apple + 1-2j review Google)
11. **Beta 10 users** (S9-10)
12. **GO live** (S12)

---

## 8. Légende

- ✅ Livré et validé
- 🟡 En cours / partiellement livré
- ⏳ Prochain dans la queue
- ❌ Pas démarré
- 🔴 Bloquant absolu
- 🟢 Souhaitable mais non bloquant

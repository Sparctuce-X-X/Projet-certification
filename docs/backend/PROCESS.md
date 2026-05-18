# Backend ownership — doc + tests automatisés (depuis 2026-05-09)

> Référencé depuis `CLAUDE.md`. Process officiel pour la doc + tests des modules backend.

> Tout module backend (au sens : tables + RPCs + triggers + RLS + crons + storage) doit être **documenté ET testé** avant d'être considéré terminé. Cette discipline s'applique aux nouvelles features ET au backfill progressif des modules existants.

## Pourquoi
- **Maîtrise** : tu peux modifier un module sans peur de casser ailleurs (la suite de tests sert de filet)
- **Onboarding** : un nouveau dev (ou Claude Code dans une autre session) comprend un module en lisant 1 fichier
- **CI** : toute PR qui casse un test est bloquée avant merge

## Stack
- **Doc** : `docs/backend/<module>.md` (Markdown + diagrammes Mermaid pour les flows)
- **Tests SQL** : pgTAP (extension Postgres standard) — testent RPCs, triggers, RLS, fonctions au niveau base
- **Tests intégration** : Vitest + supabase-js (TypeScript) — testent le stack via PostgREST (RLS gateway, JWT, etc.)
- **CI** : GitHub Actions (`.github/workflows/backend-tests.yml`) — spin up `supabase/postgres`, replay migrations, run pgTAP + Vitest

## Process module-par-module

Pour chaque feature non triviale (livrée OU en cours de backfill) :

1. **Doc backend** — `docs/backend/<module>.md` qui inventorie :
   - Tables consommées (colonnes critiques + indexes)
   - RPCs (signature, gate, comportement, exceptions)
   - Triggers (table, BEFORE/AFTER, effet observable)
   - RLS policies (qui peut quoi sur quelle ligne)
   - Cron jobs (fréquence, fonction appelée)
   - Storage buckets (path pattern, RLS)
   - Diagramme Mermaid pour les flows complexes (RDV, Notation, KYC, Boost)
2. **Audit cohérence** — relire la doc avec un œil critique : FK manquantes, RLS oubliées, RPCs doublons, conventions de nommage. Si écart → mig de cleanup ciblée numérotée (ex : mig 81+).
3. **Tests SQL pgTAP** — `tests/sql/<module>.test.sql` :
   - Happy path de chaque RPC critique
   - Erreurs attendues (exceptions raise, gate qui bloque)
   - Effet de chaque trigger (compteur incrémenté, statut changé)
   - RLS isolation (user A ne voit pas la data de B)
4. **Tests intégration Vitest** — `tests/integration/<module>.test.ts` :
   - Flows end-to-end via PostgREST (couvre gateway + RLS + RPC)
   - Multi-user : 2-3 sessions différentes pour valider l'isolation
5. **Validation locale** — `npm run test:db` (pgTAP) + `npm run test:integration` (Vitest) → tout vert
6. **Si refactor nécessaire** → mig de cleanup → re-tests
7. **Merge** → CI rejoue tout sur PR

## Priorité de backfill (modules livrés à documenter/tester)

| Tier | Modules | Pourquoi |
|---|---|---|
| 🔴 P0 | Auth · RDV · Notation · KYC · Boost · Admin KPIs | Argent + confiance. Bug = perte d'argent ou de confiance plateforme. |
| 🟡 P1 | Annonces · Conversations · Signalements · Storage · **Blocking** | Cœur du marketplace + compliance stores (Block = exigence Apple/Google). |
| 🟢 P2 | Profil · Catégories · Recherche · Favoris · Push | Plus simples, moins critiques. |

## État du backfill (au 2026-05-16)

| Module | Doc backend | pgTAP | Vitest | Mig fix |
|---|---|---|---|---|
| **Auth** | ✅ `docs/backend/auth.md` | ✅ 46 assertions | ✅ 9 tests | ✅ mig 81 (2 régressions trouvées par les tests) + mig 84 (UNIQUE telephone anti-fraude) |
| **RDV** | ✅ `docs/backend/rdv.md` | ✅ 37 + 95 assertions (`rdv.test.sql` + `rencontre.test.sql` couvre migs 86→102) | ✅ 13 tests (`rdv.test.ts` couvre migs 35→93) | ✅ mig 86-102 (anti-fraude rencontre + crons relance + immo) |
| **Audit log admin** | ⏳ next (mig 103-104) | ✅ 11 assertions (`audit.test.sql`) | — | ✅ mig 103 + 104 |
| **Notation** | ✅ `docs/backend/notation.md` | ✅ 33 assertions (`notation.test.sql` couvre migs 37/38/42/70/86) | ✅ 10 tests (`notation.test.ts`) | — (audit /cso a montré 2 findings 🟡 cohérence : `auteur_id SET NULL` dormant vs cascade conv mig 24, et UX gap `NOTATION_ERRORS_FR` désynchro vs gates mig 86 — pas bloquant) |
| **KYC** | ✅ `docs/backend/kyc.md` | ✅ 34 assertions (`kyc.test.sql` couvre migs 43→55, 65, 72, 73, 75, 85, 94) + 11 dans `audit.test.sql` (actions `kyc_*` mig 103) | ✅ 10 tests (`kyc.test.ts`) | ✅ mig 85 (UNIQUE numero_cni anti-fraude) + **mig 110 (2026-05-11 — fix trigger `trg_purge_cni_storage` SQL DELETE bloqué par Supabase `protect_objects_delete` → HTTP vers Storage REST API, débloque cron purge + cascade users delete)** |
| **Boost** | ✅ `docs/backend/boost.md` | ✅ 23 assertions (`boost.test.sql` couvre migs 43, 60, 61, 62, 63, 77, 94) | ✅ 10 tests (`boost.test.ts`) | — (audit a relevé 1 finding 🟡 cohérence : pas d'audit log admin pour boosts. Non-bloquant MVP — pas d'action admin actuelle. À ajouter Phase 2 si refund/force-expire) |
| **Admin KPIs** | ✅ `docs/backend/admin_kpis.md` | ✅ **87 assertions** (`admin_kpis.test.sql` — 100% number accuracy, fixture déterministe, couvre migs 78→80, 103, 111-116) | ✅ **20 tests** (`admin_kpis.test.ts` — delta baseline + cross-pays + CSV escape) | ✅ mig 111-116 (refactor disruptive + AlertBand 2026-05-11). 4 findings résolus ou différés conscient. |
| **Annonces** | ✅ `docs/backend/annonces.md` | ✅ **43 assertions** (`annonces.test.sql` — couvre migs 15, 16, 17, 18, 29, 30, 32, 34, 39, 41, 56-57, 86, 95, 100, 101, 103, 105) | ✅ **13 tests** (`annonces.test.ts` — create + RLS + RPCs + triggers + immo bypass + rate limit + doublon + content filter) | — (2 findings 🟡 UX gap RLS update statut=active + 🟢 fn_prolonger jsonb pattern inconsistant). Cap prix par pays DROPPED mig 30 (v4.0 pivot). |
| **Conversations** | ✅ `docs/backend/conversations.md` | ✅ **41 assertions** (`conversations.test.sql` — couvre migs 22, 23, 24, 29, 35, 36, 39, 40, 57, 65, 66, 71, 74, 86, 105) | ✅ **13 tests** (`conversations.test.ts` — get_or_create + RLS + mark_read + content filter + column-level UPDATE + is_my_account_active guard + admin_soft_delete) | — (1 finding 🟡 pas d'audit log sur `admin_soft_delete_message`/`admin_suspend_user` + 3 🟢 cosmétiques). Bug Postgres : appel direct `fn_check_forbidden_words()` en role `authenticated` crash le serveur → tester en role `postgres` uniquement (mig 94 revoke EXECUTE est l'intention de toute façon). |
| **Signalements** | ✅ `docs/backend/signalements.md` | ✅ **41 assertions** (`signalements.test.sql` — couvre migs 25, 26, 27, 28, 56, 57, 74, 91, 94, 95, 96, 98, 103) | ✅ **13 tests** (`signalements.test.ts` — submit_report + create_signalement_post_rdv + RLS + admin_treat + admin_revert + threshold trigger + get_my_rdv_signalement_status anti-leak) | — (2 findings 🟡 : `fn_signalement_on_insert` ne couvre pas `rdv_post` pour `nb_signalements++` + pas d'auto-pause annonce à 3 signalements rdv_post pending — par design mig 91, + 3 🟢 cosmétiques). |
| **Storage** | ✅ `docs/backend/storage.md` | ✅ **36 assertions** (`storage.test.sql` — couvre migs 09, 14, 16, 46, 48, 54, 65, 73, 92, 94, 102, 110 — buckets + RLS policies + trigger + crons + functions) | ✅ **11 tests** (`storage.test.ts` — upload owner/cross-user/anon par bucket × 4 + cascade purge + path enforcement rencontre-photos via RPC) | — (2 nouveaux findings 🟡 découverts au backfill : `avatars_owner_update` sans `WITH CHECK` casse upsert ; `.remove()` silencieux sur avatars local — à valider en prod avant launch. 3 findings 🟡 P2 existants + 4 🟢 cosmétiques documentés storage.md §10). |
| Profil | — | — | — | — |
| **Catégories** | ✅ `docs/backend/categories.md` | ✅ **8 assertions** (`categories.test.sql` — schema + seed ≥10 actives + ordre commence à 1 — couvre migs 13, 31, 32) | — (pas de RPC/trigger/isolation multi-user — voir justification §doc) | — (Finding 🟡 F1 : `update ordre=6 where nom='Véhicules'` dans mig 32 = no-op, slot vide entre Immo(5) et Beauté(7)) |
| Recherche | — | — | — | — |
| **Favoris** | ✅ `docs/backend/favoris.md` | ✅ **17 assertions** (`favoris.test.sql` — schema + UNIQUE + RLS SELECT/INSERT/DELETE isolation + guard is_active mig 74 + cascade delete user + cascade delete annonce — couvre migs 19, 74, 76) | ✅ **8 tests** (`favoris.test.ts` — toggle ON/OFF + UNIQUE PostgREST + RLS isolation + ownership + guard suspendu + fetchMyFavorites jointure + anon) | — (Finding 🟢 F2 : ICON_MAP `car` présent côté client sans catégorie Véhicules en DB — code mort non bloquant) |
| **Blocking** (F15) | ✅ `docs/backend/blocking.md` (2026-05-16) | 🚧 à écrire (`blocked_users.test.sql`) | 🚧 à écrire (`blocked-users.test.ts`) | — (5 findings dont 2 résolus mig 131/132 et 1 à valider : guard `is_my_account_active()` manquant sur policy INSERT — cf. `blocking.md §10`) |
| Push | — | — | — | — |

## Tests manuels (ancien process — toujours valable en complément)

Pour les flows multi-device (Realtime, push, OAuth) où Vitest seul ne suffit pas, on garde le pattern `docs/features/<feature>-tests.md` avec scénarios cochables. 1 simu iOS (compte A) + iPhone perso (compte B). Pas de registre de comptes — on identifie les rôles à la volée.

Ces tests manuels complètent les tests automatisés, ils ne les remplacent pas.

## Convention fichiers

```
docs/backend/<module>.md       # doc backend (auth.md, rdv.md, notation.md, ...)
docs/features/<module>-tests.md # tests manuels multi-device (UI, push, Realtime)
tests/sql/<module>.test.sql    # tests pgTAP (RPC, triggers, RLS isolés)
tests/integration/<module>.test.ts  # tests Vitest end-to-end via PostgREST
```

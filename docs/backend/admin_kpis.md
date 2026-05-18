# Module Admin KPIs — Dashboard administrateur v2 — Backend

> Source de vérité backend du **Dashboard administrateur v2** (refactor 2026-05-11 du monolithe `get_admin_kpis` mig 78→80).
> Couvre : 3 RPCs panel (`admin_kpis_liquidity` / `admin_kpis_activation` / `admin_kpis_revenue`), RPC export CSV `admin_export_dataset` (6 datasets), table `admin_compta_reports` + RPC `create_compta_report`, Edge Function `generate-compta-pdf` (pdf-lib via esm.sh), frontend Next.js 16 (3 panels + CountrySelector + ExportButtons + ComptaReportsList).
>
> **Migrations concernées** : 78 (RPC v1 initiale), 79 (filtre période), 80 (audit fixes), **111 (refactor disruptive : panel Liquidité — Supply Health + Demand Engagement)**, **112 (panel Activation — funnel cohorte + Trust Quality + Vendeur Fiable)**, **113 (panel Revenue + DROP `get_admin_kpis` mig 80 ; ventilation XOF/XAF par pays + ARPU period+alltime)**, **114 (export CSV 6 datasets — RFC 4180 + SHA256 télhash + hard limit 5MB)**, **115 (table `admin_compta_reports` + RPC `create_compta_report`)**, **116 (AlertBand : RPC `admin_kpis_alerts` — signalements/KYC/suspensions/boosts stuck)**, 103 (audit log `_log_admin_action` consommé par 114 + 115).
>
> **Tier RGPD** : 🟡 **P1** — pas de PII sensible en lecture mais l'export CSV contient des `email` + `prenom`/`nom` user. Téléphones systématiquement hashés SHA256 (mig 114). Document attaché ARTCI 2024-30 (CI), ANRTIC 2023-15 (CG), loi 2021-058 RW.

---

## 1. Vue d'ensemble

Le **dashboard /admin/kpis** est l'écran de pilotage business de Niqo. V1 (mig 78→80) agrégeait users/marketplace/trust/revenue dans un seul JSON, sans filtre pays. V2 (2026-05-11) découpe en 3 panels ciblés + filtre pays explicite + exports CSV + rapport comptable PDF.

**Pourquoi refactor disruptif (plan-eng-review 2026-05-11, D3 = B)** :
- Monolithe difficile à lire pour brainstormer
- Pas de ventilation pays → mélange CI/CG (1er marché vs 2e marché)
- Pas d'exports business → impossible de croiser avec PawaPay côté comptable
- Pas de PDF cabinet rwandais → reporting comptable bricolé

User solo + 0 utilisateur sur /admin/kpis = drop sans compromis vs strangler-fig.

**Invariants produit non-négociables :**

| Invariant | Enforcement |
|---|---|
| Toutes les RPCs admin gated par `is_admin = true` | `if not exists (select 1 from users where id = auth.uid() and is_admin)` → raise `ADMIN_REQUIRED` (mig 111-115) |
| Filtre pays whitelisté : 'CI' / 'CG' / null | Defense-in-depth : `if p_pays not in (...) raise INVALID_PAYS` (mig 111-114) |
| Fenêtre temporelle bornée (p_to > p_from) | Raise `INVALID_WINDOW` (mig 111-114) |
| Téléphones hashés SHA256 hex dans tout export CSV | `encode(digest(telephone, 'sha256'), 'hex')` (mig 114 dataset users) — pas de PII en clair extractible |
| CSV ≤ 5 MB strictement | `octet_length(v_csv) > 5*1024*1024 → raise EXPORT_TOO_LARGE` (mig 114). Protège PostgREST (limite 6MB) |
| Division par zéro évitée sur tous les ratios | `nullif(denominator, 0)` systématique (mig 111-113) — failure mode critique du plan-eng-review |
| Funnel d'activation = cohorte stricte | Numérateurs sont des `count(*) filter (where exists...)` sur la cohorte d'inscriptions — garantit ratios ≤ 100% |
| Ventilation pays = via `users.pays` du payeur (pas via une colonne devise dans paiements_niqo) | Join `paiements_niqo p JOIN users u ON u.id = p.user_id` filtré par `u.pays`. Cohérent avec mode hors-transaction CDC v4.0 |
| Toute action admin tracée (export + génération PDF) | `_log_admin_action` (mig 103) avec `target_type = '<dataset>' | 'compta_report'` |

**Promesses UX implémentées :**

- 3 panels indépendants → 3 RPCs parallèles (`Promise.all` côté server component Next.js) → page rapide
- CountrySelector URL-driven (`?pays=CI`) → bookmarkable, refresh sans perdre l'état
- Bouton "Générer PDF compta maintenant" → Edge Function pdf-lib + upload Storage + signed URL 24h
- Historique des PDFs affiché avec totaux (XOF, XAF, nb_paiements) — pas besoin d'ouvrir le PDF pour comparer

---

## 2. Tables consommées

### 2.1 `public.users` (mig 01)

| Colonne | Type | Usage admin_kpis |
|---|---|---|
| `id` | uuid PK | Filtre `auth.uid()` (gate is_admin) ; FK paiements/annonces |
| `pays` | enum `pays_code` | **Pivot du filtre p_pays** sur tous les KPIs |
| `is_admin` | boolean | Gate `ADMIN_REQUIRED` |
| `is_verified` | boolean | KPI trust_quality.verified |
| `is_active` | boolean + `score_abus` | KPI trust_quality.suspended_auto_score / admin_manual |
| `nb_ventes` + `note_vendeur` | int + numeric | KPI trust_quality.vendeur_fiable (`nb_ventes ≥ 5 ET note_vendeur ≥ 4.0` — statut implicite défini en code, voir CLAUDE.md §Rôles) |
| `created_at` | timestamptz | Cohorte signups + filtre fenêtre |
| `telephone` | text | Hashé SHA256 dans CSV export (mig 114) |
| `prenom` + `nom` + `email` | text | Affichage CSV (PII modérée, pas hashée — déjà visible admin via UI) |

### 2.2 `public.annonces` (mig 15)

| Colonne | Usage |
|---|---|
| `vendeur_id` | Join users pour pays + cohorte activation |
| `pays` | Filtre direct (hérité de users.pays par trigger mig 15) |
| `created_at` / `statut` | Supply Health (nouvelles / actives / expirées) |
| `nb_vues` | Demand Engagement vues_total_period |
| `updated_at` | Détection expiration (statut='expiree' + updated_at in window) |

### 2.3 `public.conversations` (mig 22)

| Colonne | Usage |
|---|---|
| `annonce_id` | Join annonces pour pays |
| `created_at` | Demand Engagement conversations_initiated_period |
| `rdv_propose_at` | Funnel activation (proposed_first_rdv) |
| `acheteur_id` / `vendeur_id` | Cohorte activation |

### 2.4 `public.messages` (mig 22)

| Colonne | Usage |
|---|---|
| `conversation_id` | Join conv → annonce → pays |
| `created_at` + `type` | Time-to-first-contact P50 (filtre type <> 'systeme') |

### 2.5 `public.paiements_niqo` (mig 43)

| Colonne | Usage Revenue |
|---|---|
| `user_id` | Join users pour pays (ventilation XOF/XAF) |
| `type` | Breakdown verification / boost |
| `montant_fcfa` | Distinction Boost7 (1000) / Boost30 (3000) + sum |
| `statut` | Filtre `'completed'` strict |
| `completed_at` | Filtre fenêtre |
| `pawapay_deposit_id` | Affichage CSV paiements pour matching comptable |

### 2.6 `public.avis` (mig 37)

| Colonne | Usage |
|---|---|
| `auteur_id` | Cohorte activation (completed_first_rdv = au moins 1 avis émis) |
| `conversation_id` | Join conv → annonce → pays |

### 2.7 `public.push_tokens` (mig 64)

| Colonne | Usage |
|---|---|
| `user_id` | Join users pour pays |
| `last_seen_at` | DAU (<24h) / WAU (<7d) / MAU (<30d) |

### 2.8 `public.signalements` (mig 25)

CSV export only — pas de KPI direct dans les 3 panels (gauge trust déjà covered par trust_quality).

### 2.9 `public.admin_compta_reports` (mig 115 — NEW)

| Colonne | Type | Description |
|---|---|---|
| `id` | uuid PK | Référencé par signed URL Storage |
| `periode_debut` / `periode_fin` | timestamptz | Fenêtre du rapport |
| `pays` | text CHECK CI/CG/ALL | Filtre appliqué |
| `storage_path` | text UNIQUE | `<uuid>.pdf` dans bucket `compta-reports` |
| `total_fcfa` / `total_xof` / `total_xaf` | int | Snapshot pour affichage liste sans re-télécharger PDF |
| `nb_paiements` | int | Count des paiements completed inclus |
| `generated_by` | uuid → users(id) ON DELETE SET NULL | Audit + RGPD compatible |
| `generated_at` | timestamptz default now() | Tri liste historique |
| `bytes` | int | Taille PDF pour stats |

**RLS** : SELECT admin only (`is_current_user_admin()`). INSERT/UPDATE/DELETE bloqués via PostgREST. Insert via RPC `create_compta_report` (SECURITY DEFINER).

### 2.10 `public.audit_log_admin` (mig 103) — dépendance

Écriture via `_log_admin_action(action, target_type, target_id, metadata)` à chaque export (`export_<dataset>`) et chaque génération PDF (`compta_pdf_generated`).

---

## 3. RPCs

### 3.1 `admin_kpis_liquidity(p_from, p_to, p_pays)` (mig 111)

Panel 1/3. Retourne `{ supply_health, demand_engagement }`.

**Sémantique pays** : 'CI' | 'CG' | null. null = agrégat tout pays. Conversations/messages dérivent le pays via `annonces.pays`. Push_tokens → users.pays.

**Critical** : `nullif(denominator, 0)` sur `contacts_per_annonce_avg` et `vues_to_contact_pct`. Sans, 0 annonces → NaN → dashboard plante (gap identifié plan-eng-review 2026-05-11).

### 3.2 `admin_kpis_activation(p_from, p_to, p_pays)` (mig 112)

Panel 2/3. Retourne `{ signups, activation_funnel, trust_quality }`.

**Funnel cohorte stricte** : `signed_up` (= count users.created_at in window) → `published_first_annonce` (= sous-ensemble ayant ≥1 annonce) → `proposed_first_rdv` (= sous-ensemble ayant ≥1 conv.rdv_propose_at) → `completed_first_rdv` (= sous-ensemble ayant ≥1 avis). Tous sont sous-ensembles de la cohorte d'origine → ratios ≤ 100% garantis.

**Vendeur Fiable** : `nb_ventes ≥ 5 AND note_vendeur ≥ 4.0` — pas dans le CDC v4.0, défini en code (cf. `TrustedAvatar` mobile, `CheckCircle2`). KPI exposé en admin pour mesurer la quote des vendeurs "premium" implicites.

### 3.3 `admin_kpis_revenue(p_from, p_to, p_pays)` (mig 113)

Panel 3/3. Retourne `{ revenue, arpu, alltime }`.

**Ventilation XOF/XAF** : techniquement même valeur intrinsèque (parité fixe CFA = 655.957/EUR sur 2 zones), comptablement séparée (reporting cabinet rwandais). PawaPay encaisse en FCFA local, devise = `users.pays` du payeur, **pas une colonne séparée dans `paiements_niqo`** (pas de mig schéma).

**ARPU** :
- `eur_alltime` : revenu alltime / vendeurs alltime distinct → KPI stable, ne change pas selon fenêtre
- `eur_period` : revenu période / vendeurs actifs période → proxy monétisation récente. "Vendeurs actifs" = UNION 3 sources (a publié annonce OU envoyé message non-systeme OU touché RDV dans fenêtre, cf. sémantique mig 80 fix #1 préservée)

**DISRUPTIVE** : `drop function if exists public.get_admin_kpis(timestamptz, timestamptz);` en tête de mig 113. Pas de strangler-fig. Frontend rewrite atomic (mig 113 + page.tsx + lib/admin/kpis.ts dans le même commit).

### 3.4 `admin_export_dataset(p_dataset, p_from, p_to, p_pays)` (mig 114)

6 datasets via un seul aiguillage : `users | annonces | paiements | rdv | avis | signalements`.

**CSV RFC 4180** :
- Tous les champs text/uuid/timestamp wrapped dans `"..."`
- Escape `"` → `""` à l'intérieur
- Newlines `\n` (LF)
- Charset UTF-8
- Numeric NON-quoted (Excel reconnaît comme nombre)

**Hard limit 5 MB** : `octet_length(csv) > 5*1024*1024 → raise EXPORT_TOO_LARGE`. User doit alors filtrer plus strictement (pays + fenêtre plus courte).

**SHA256 télhash** : `encode(digest(telephone, 'sha256'), 'hex')` dans dataset `users` uniquement. Permet de croiser 2 exports (même phone → même hash) sans exposer.

**Audit log** : action = `export_<dataset>` (best-effort, n'échoue pas si mig 103 absente).

### 3.5 `admin_kpis_alerts(p_pays)` (mig 116)

AlertBand pour le top du dashboard — surface les "trucs à faire ce matin"
avant les chiffres. Audit UX 2026-05-11 P0 critique daily-use (V1 avait cette
bande dans le monolithe mig 80, V2 disruptive l'avait droppée).

4 compteurs minimal :
- `signalements_pending_24h_plus` : modération stale
- `kyc_pending_48h_plus` : SLA KYC 24h dépassé
- `suspended_30d` : info modération récente
- `boosts_stuck_pending` : anomalie webhook PawaPay (>1h pending)

Filtre pays optionnel (sauf signalements — un signalement urgent peu importe le pays).

### 3.6 `create_compta_report(...)` (mig 115)

Appelée par l'Edge Function `generate-compta-pdf` après upload Storage. SECURITY DEFINER + gate `is_admin` via `auth.uid()`. Audit log `compta_pdf_generated` avec metadata (periode, pays, total_fcfa, nb_paiements, bytes).

---

## 4. Edge Function `generate-compta-pdf`

`supabase/functions/generate-compta-pdf/index.ts`. Deno + `pdf-lib@1.17.1` via `npm:` specifier (cold start ≈ 1.5s vs jsPDF ≈ 3s avec polyfill DOM — choix plan-eng-review D2).

**Flow** :
1. Forward user JWT pour gate is_admin
2. service_role read paiements completed sur la fenêtre + pays
3. pdf-lib build : header (Niqo Ltd + RDB Rwanda [TBD] + période + pays + admin), table 25 lignes/page avec date / type / pays / devise / montant / user / deposit_id, page synthèse finale (totaux XOF/XAF/FCFA/EUR + breakdown par type)
4. service_role upload Storage `compta-reports/<uuid>.pdf` (bucket privé, RLS admin SELECT only — créé manuellement côté dashboard Supabase, non SQL-migrable)
5. Forward user JWT pour `create_compta_report` RPC (audit log auto)
6. Génère signed URL 24h + retourne `{report_id, storage_path, signed_url, totals}`

**V1 manuel uniquement** : pas de cron, pas de Resend (cf. mig 115 §Choix conscient — user solo, plan-eng-review D4). Si Phase 2 → ajouter pg_cron + Resend (non bloquant MVP).

**Limites V1** :
- Pas de pagination DB (charge tous paiements en mémoire). OK jusqu'à ~10k paiements (~80 KB PDF). À 100k+, ajouter curseur DB.
- Pas de retry : si upload Storage fail, admin clique relancer.

**Secrets requis** (Supabase Edge Functions Secrets) :
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (auto)
- `NIQO_RDB_NUMBER` : optionnel ; placeholder `[TBD - n° RDB Rwanda]` sinon. À set une fois le numéro RDB obtenu.

**Bucket requis** : `compta-reports` (privé). À créer côté dashboard Supabase manuellement (les buckets ne migrent pas en SQL pur).

---

## 5. Frontend Next.js 16

Voir `landing/src/app/admin/(admin-protected)/kpis/`.

| Fichier | Rôle |
|---|---|
| `page.tsx` | Server component : `Promise.all` sur 4 RPCs (alerts + 3 panels) + `fetchComptaReports`. Layout AlertBand + 3 panels (tier 0/1/2) + Exports groupés + Compta. URL params `?period=...` + `?pays=...` |
| `loading.tsx` | Skeleton aligné sur la structure |
| `_components/AlertBand.tsx` | Server : bande "actions en attente" au top. Si total=0, état "tout sous contrôle" niqo-success |
| `_components/CountrySelector.tsx` | Client : switche `?pays=CI|CG|ALL`. Drapeaux nationaux (ISO 3166) + Globe Lucide pour ALL |
| `_components/PeriodFilter.tsx` | Client : 4 presets + Month/Year picker |
| `_components/KpiCard.tsx` | Atomique avec props `tier="hero"|"normal"|"compact"` + `danger` semantic flag (audit UX 2026-05-11) |
| `_components/RevenueAreaChart.tsx` | Client : sparkline 12 mois via Recharts AreaChart (remplace liste 12 barres horizontales — densité info insuffisante) |
| `_components/ExportButtons.tsx` | Client : 6 boutons CSV. Accepte `only` prop pour split en groupes BI / Compta |
| `_components/GeneratePdfButton.tsx` | Client : invoke Edge Function `generate-compta-pdf` → signed URL |
| `_components/ComptaReportsList.tsx` | Client : liste historique 7 colonnes (XOF/XAF mergées) + signed URL à la demande |
| `_components/TimeAgo.tsx` | Atomique (existant) |

`lib/admin/kpis.ts` : types TypeScript des 3 RPCs + 3 fetchers + helpers PeriodSelection + CountrySelection.

---

## 6. Storage

| Bucket | Tier | RLS | Usage |
|---|---|---|---|
| `compta-reports` | Privé | SELECT admin only (manuel côté dashboard) | PDFs comptables générés |

Pas de cron purge V1 — l'historique reste accessible (pas de conservation maximum, c'est une obligation comptable de conserver). Si purge nécessaire Phase 2 (ex : RGPD bornage 5 ans cabinet rwandais) → cron mensuel.

---

## 7. Tests — 100% NUMBER ACCURACY

Stratégie : chaque KPI retourné par les 4 RPCs est asserted en **valeur exacte**
(pas de `>=` range). Fixture déterministe = 7 users + 6 annonces + 9 paiements
+ 6 push_tokens + 3 conversations + 3 messages + 1 avis + 3 signalements +
3 verifications + 1 boost stuck.

### `tests/sql/admin_kpis.test.sql` — 87 assertions pgTAP

| Section | # | Couverture |
|---|---|---|
| A. Gates | 4 | ADMIN_REQUIRED × 3 RPCs + INVALID_PAYS + INVALID_WINDOW |
| B. Liquidity | 20 | supply_health (5 fields) + demand_engagement (6 fields) × CI/CG/ALL ; nullif div/0 ; vues→contact ratio exact |
| C. Activation | 16 | signups period+prev+delta ; funnel cohorte (4 counts + 3 ratios) ; trust_quality (verified%, vendeur_fiable, suspended_auto) |
| D. Revenue | 20 | total_xof/xaf/fcfa/eur × ALL/CI/CG ; verifications/boost7/boost30 counts + sums ; ARPU CI 4.57€ + CG 3.05€ ; alltime vendeurs distinct |
| E. Alerts mig 116 | 8 | 4 compteurs × ALL/CI/CG + total |
| F. Export CSV | 10 | INVALID_DATASET ; SHA256 hex ; pas de leak +225 ; **RFC 4180 escape `""spéciale, avec virgule""`** ; window bornes ; audit log |
| G. Edge cases | 5 | 0-data shape ; cross-pays leak (XAF=0 quand CI) ; window boundary 30j ; pre-window data ; alerts pays semantics |
| H. Invariants | 4 | Funnel cohorte stricte ; ARPU alltime invariant fenêtre ; sum(CI) + sum(CG) = sum(ALL) |

### `tests/integration/admin_kpis.test.ts` — 20 tests Vitest

| # | Test | Stratégie |
|---|---|---|
| 1-4 | Gates (4 non-admin/INVALID_PAYS) | exception match |
| 5 | revenue delta CI exact = +2000 | **baseline avant fixture → diff exact** |
| 6 | filter CI → total_xaf=0 | cross-pays strict |
| 7 | filter CG → total_xof=0 | cross-pays strict |
| 8 | sum(CI) + sum(CG) = sum(ALL) | invariant pays |
| 9 | funnel cohorte stricte | num ≤ denom + ratios ≤ 100% |
| 10 | ARPU invariant fenêtre | 7d == 30d |
| 11 | alerts shape + total invariant | total = sum 4 compteurs |
| 12 | alerts non-admin | exception |
| 13 | export paiements CI strict | inclut nos paiements + XOF, exclut CG |
| 14 | export annonces RFC 4180 escape | `""guillemets""` détecté |
| 15 | export users SHA256 + no PII leak | hex 64 chars + pas de `+225` clair |
| 16 | export INVALID_DATASET | exception |
| 17-19 | create_compta_report exact + INVALID_PAYS + INVALID_WINDOW | all fields match |
| 20 | audit log export_<dataset> | trace présente |

**Total : 87 pgTAP + 20 Vitest = 107 assertions** (vs 30+10 v1 → 268% de coverage).

Lancer : `npm run test:db` (pgTAP) + `npm run test:integration` (Vitest). CI bloque PR si rouge.

---

## 8. Écarts CDC v4.0 / décisions hors spec

| Écart | Origine | Justification |
|---|---|---|
| 3 RPCs au lieu d'1 monolithe | Plan-eng-review 2026-05-11 (D3 = B disruptive) | Lecture business, parallélisme, filtre pays propre |
| Filtre pays CI/CG | Office-hours design 2026-05-11 (Premise 1) | 2 marchés à piloter séparément, mélange = bruit |
| Vendeur Fiable KPI exposé | Implémentation 2026 (TrustedAvatar mobile) | Statut implicite mesurable → utile pour piloter |
| Exports CSV 6 datasets + PDF compta manuel | Office-hours + plan-eng-review D4 | User solo + cabinet rwandais offline → envoi manuel V1 |
| Hard limit 5MB CSV | Plan-eng-review D5 = C | Protège PostgREST 6MB silencieux |
| SHA256 télhash dans CSV | RGPD ARTCI/ANRTIC/RW | Croisement possible sans PII en clair |
| pdf-lib via esm.sh | Plan-eng-review D2 = A | -450KB cold start vs jsPDF + DOM polyfill |

---

## 9. Findings et fixes (audit /cso 2026-05-11)

### 9.1 Failure mode CRITIQUE — division par zéro (résolu mig 111)

Sans `nullif(denom, 0)`, Supply Health avec 0 annonces nouvelles → `convs / 0` → NaN propagé → JSON invalide → dashboard plante.

Mitigé dans mig 111 : `round(numerator::numeric / nullif(denominator, 0), 2)` retourne NULL au lieu de NaN. Frontend affiche "—".

### 9.2 RDB Rwanda manquant (à compléter par user offline)

L'Edge Function `generate-compta-pdf` accepte un secret `NIQO_RDB_NUMBER` (placeholder `[TBD - n° RDB Rwanda]` si absent). À configurer une fois le numéro RDB obtenu : `supabase secrets set NIQO_RDB_NUMBER=<numéro>`.

### 9.3 Pas de cron PDF auto V1 (non-blocking, deferred V2)

Choix conscient (plan-eng-review D4 = manuel). User envoie au cabinet rwandais manuellement. Si volume grandit, ajouter pg_cron + Resend dans une mig future.

### 9.4 Pas de pagination CSV V1 (non-blocking jusqu'à ~10k paiements)

Hard limit 5MB protège. Au-delà, Phase 2 = curseur SQL ou stream.

---

## 10. Refs

- **Mig 80** : ancienne RPC `get_admin_kpis(timestamptz, timestamptz)` — droppée par mig 113
- **Mig 103** : `_log_admin_action` (audit) — consommé par 114 + 115
- **CLAUDE.md §Modèle économique** : tarifs paiements (1k verif, 1k boost7, 3k boost30)
- **CLAUDE.md §Rôles utilisateurs** : définition Vendeur Fiable
- **Office-hours design doc 2026-05-11** : `~/.gstack/projects/Sparctuce-X-X-niqo/dominiquehuang-develop-design-20260511-184928.md`
- **Plan-eng-review test plan 2026-05-11** : `~/.gstack/projects/Sparctuce-X-X-niqo/dominiquehuang-develop-eng-review-test-plan-20260511-190605.md`

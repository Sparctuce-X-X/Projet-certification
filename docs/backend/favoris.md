# Module Favoris — Backend

> Source de vérité backend du module **Annonces sauvegardées (Favoris)**.
> Couvre : table `favoris`, RLS (3 policies), guard `is_my_account_active`, droit à l'oubli, et les helpers mobiles qui consomment.
>
> **Migrations concernées** : 19, 74, 76.
> **Tier RGPD** : 🟡 P2 — lie un utilisateur identifié à des annonces (trace d'intentions). Couvert par la cascade DELETE droit à l'oubli (mig 19 FK cascade).

---

## 1. Vue d'ensemble

`public.favoris` est une relation N:N entre `users` et `annonces`. Un user peut ajouter ou retirer une annonce de ses favoris. Pas de doublon (UNIQUE `user_id, annonce_id`). Pas de RPCs dédiées — tout passe par PostgREST direct (INSERT / DELETE). Pas de triggers, pas de crons.

**Particularité sécurité (mig 74 + 76)** : la policy INSERT `favoris_insert_own` (mig 19) a été remplacée par `favoris_owner_insert` (mig 74) qui ajoute le guard `is_my_account_active()`. La mig 76 drop l'ancienne policy qui annulait le guard (Postgres combine les policies en OR → l'ancienne laissait passer un compte suspendu).

---

## 2. Table `public.favoris`

Mig 19.

| Colonne | Type | Contraintes | Usage |
|---|---|---|---|
| `id` | `uuid` PK | `default uuid_generate_v4()` | Identifiant ligne |
| `user_id` | `uuid` NOT NULL | FK → `public.users(id)` ON DELETE CASCADE | Owner du favori — cascade droit à l'oubli |
| `annonce_id` | `uuid` NOT NULL | FK → `public.annonces(id)` ON DELETE CASCADE | Annonce sauvegardée — cascade si annonce supprimée |
| `created_at` | `timestamptz` NOT NULL | `default now()` | Tri récent en premier (profil favorites) |
| UNIQUE | — | `(user_id, annonce_id)` | Anti-doublon — INSERT idempotent via client optimistic |

**Index** :
- `idx_favoris_user (user_id, created_at desc)` — lister les favoris d'un user triés par récence.
- `idx_favoris_annonce (annonce_id)` — compter les favoris d'une annonce (stats vendeur, tri futur).

---

## 3. RLS

| Policy | For | Using / With Check | Mig | Note |
|---|---|---|---|---|
| `favoris_select_own` | SELECT | `auth.uid() = user_id` | 19 | Un user ne voit que ses propres favoris. Anon : résultat vide (pas de gate explicite, RLS filtre tout). |
| ~~`favoris_insert_own`~~ | ~~INSERT~~ | ~~`auth.uid() = user_id`~~ | 19 → **droppée mig 76** | Remplacée par `favoris_owner_insert` (mig 74) car elle annulait le guard is_active. |
| `favoris_owner_insert` | INSERT | `auth.uid() = user_id AND is_my_account_active()` | 74 | Guard complet : ownership + compte actif. Un compte suspendu ne peut plus ajouter de favoris. |
| `favoris_delete_own` | DELETE | `auth.uid() = user_id` | 19 | Un user peut retirer ses propres favoris même si suspendu (pas de garde is_active sur DELETE — cohérent : le retrait est toujours permis). |

**Helper `is_my_account_active()`** (mig 74) : `SECURITY DEFINER STABLE` — évite la query répétée dans la même transaction. `GRANT EXECUTE to authenticated`.

**Pas de policy UPDATE** : les colonnes `favoris` sont toutes immutables post-INSERT (pas de modification de favori, seulement ajout/retrait).

---

## 4. Pas de RPCs

Aucune RPC dédiée. Le client mobile appelle PostgREST directement :

```ts
// Toggle favori ON
supabase.from("favoris").insert({ user_id: userId, annonce_id })

// Toggle favori OFF
supabase.from("favoris").delete().eq("user_id", userId).eq("annonce_id", annonceId)

// Liste des IDs favoris
supabase.from("favoris").select("annonce_id").order("created_at", { ascending: false })

// Liste complète avec détails annonce (jointure)
supabase.from("favoris").select("annonce_id, annonces:annonce_id (id, titre, prix, ...)")
```

---

## 5. Pas de triggers

Aucun trigger sur `favoris`.

---

## 6. Pas de crons

Aucun cron sur `favoris`.

---

## 7. Droit à l'oubli (RGPD)

La FK `user_id` est `ON DELETE CASCADE` → la suppression du compte (`delete_my_account()` → `DELETE auth.users`) cascade automatiquement tous les favoris de l'utilisateur. Aucune action explicite nécessaire côté `delete_my_account()`.

Idem pour `annonce_id` (`ON DELETE CASCADE`) : si une annonce est supprimée (cron expire/purge, admin, ou cascade droit à l'oubli vendeur), tous les favoris pointant vers elle sont supprimés.

---

## 8. Code client qui consomme

### 8.1 `lib/favorites.ts`

| Helper | Description |
|---|---|
| `loadMyFavoriteIds()` | Fetch `SELECT annonce_id` depuis `favoris`. Cache process-life (`favCache: Set<string>`). Anti thundering-herd : `favInflight` promise partagée. Retourne `Set()` vide si non-auth (browse-first). |
| `isFavorite(annonceId)` | Lookup synchrone post-hydratation. Évite un round-trip par card. |
| `toggleFavorite(annonceId)` | INSERT ou DELETE selon l'état actuel. Optimistic UI (update cache immédiat, rollback si erreur réseau). |
| `fetchMyFavorites()` | Jointure `favoris → annonces` pour l'écran `/profile/favorites`. Inclut `statut`, `type_offre`, `is_boosted`, `boost_until` pour overlay "Plus disponible" + badge immo. |
| `clearFavoritesCache()` | Invalide `favCache` — appelé après `signOut` ou `deleteMyAccount`. |

### 8.2 Écrans mobiles

- `app/(tabs)/index.tsx` (cards Home) : bouton cœur → `toggleFavorite`.
- `app/announce/[id].tsx` (détail) : cœur dans le header.
- `app/profile/favorites.tsx` : liste via `fetchMyFavorites()` — affiche overlay si annonce non-active.

### 8.3 Auth gate

`toggleFavorite` nécessite une session. Le client appelle `requireAuth("favorite")` avant → modal `AuthGate` si anon.

---

## 9. Findings

| # | Sévérité | Détail |
|---|---|---|
| F1 | ✅ résolu | **Policy INSERT redondante mig 74 + 76** : la mig 19 avait `favoris_insert_own` (sans guard is_active). La mig 74 a ajouté `favoris_owner_insert` (avec guard). Postgres combinant en OR, l'ancienne annulait le guard. Mig 76 droppe l'ancienne — sécurité restaurée. Documenté ici pour mémoire. |
| F2 | 🟢 | **Pas de compteur `nb_favoris` sur annonces** : les stats vendeur (mig 58 `get_my_dashboard_stats`) ne comptent pas les favoris. Cohérent avec le CDC v4.0 (pas de priorité pour ce KPI vendeur). À ajouter Phase 2 si besoin. |

---

## 10. Tests

- **Tests pgTAP** : `tests/sql/favoris.test.sql` — **17 assertions**. Couvre schema (5 colonnes), UNIQUE constraint, RLS SELECT isolation, RLS INSERT guard is_active + ownership, RLS DELETE isolation, cascade delete user + cascade delete annonce.
- **Tests Vitest** : `tests/integration/favoris.test.ts` — **8 tests**. Couvre toggle ON/OFF, RLS isolation entre 2 users, guard is_active (compte suspendu bloqué en INSERT), fetchMyFavorites jointure, anon bloqué.

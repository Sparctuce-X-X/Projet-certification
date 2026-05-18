# Module Catégories — Backend

> Source de vérité backend du module **Catégories d'annonces**.
> Module quasi-statique : lecture publique, écriture exclusivement via migrations SQL (admin Dashboard). Pas de RPCs, pas de triggers, pas de crons.
>
> **Migrations concernées** : 13, 31, 32.
> **Tier RGPD** : 🟢 — aucune donnée personnelle.

---

## 1. Vue d'ensemble

`public.categories` est une table de référence read-only côté client. Les catégories sont créées et maintenues par migrations SQL (append-only). Le client mobile la consomme via un cache process-life (`lib/categories.ts`). Aucun user (anon ou authenticated) ne peut insérer, mettre à jour ou supprimer une ligne — seul le `service_role` (Supabase Dashboard) bypasse la RLS.

**11 catégories actives au MVP** (après mig 13 + 31 + 32) :

| Ordre | Nom | Icône Lucide | Mig d'origine |
|---|---|---|---|
| 1 | Téléphones & Accessoires | `smartphone` | 13 |
| 2 | Électronique | `monitor` | 13 (réordonné mig 32) |
| 3 | Mode & Vêtements | `shirt` | 13 (réordonné mig 32) |
| 4 | Maison & Électroménager | `home` | 13 (réordonné mig 32) |
| 5 | Immobilier | `building-2` | 32 |
| 6 | Véhicules | `car` | (colonne ordre seulement — catégorie pas seedée dans les migs conservées, voir §8 Finding) |
| 7 | Beauté & Cosmétiques | `sparkles` | 31 |
| 8 | Sports & Loisirs | `dumbbell` | 13 (réordonné mig 32) |
| 9 | Enfants & Bébé | `baby` | 13 (réordonné mig 32) |
| 10 | Livres & Formation | `book-open` | 13 (réordonné mig 32) |
| 11 | Autres | `package` | 13 (réordonné mig 32) |

> **Note** : La catégorie "Véhicules" était explicitement exclue du seed initial (mig 13 — plafonds Mobile Money ~1-2M FCFA incompatibles avec le prix des voitures). La mig 32 réordonne `ordre=6` pour "Véhicules" mais sans la seeder. La mig 32 ajoute uniquement "Immobilier". La colonne ordre 6 est donc réservée. Voir §8.

---

## 2. Table `public.categories`

Mig 13.

| Colonne | Type | Contraintes | Usage |
|---|---|---|---|
| `id` | `uuid` PK | `default uuid_generate_v4()` | Référencé par `annonces.categorie_id` (FK mig 15) |
| `nom` | `text` NOT NULL | UNIQUE (`categories_nom_unique`) | Affiché en UI, clé d'idempotence des seeds |
| `icone` | `text` NOT NULL | — | Nom d'icône Lucide → mappé côté client dans `lib/categories.ts::ICON_MAP` |
| `ordre` | `int` NOT NULL | `default 0` | Ordre d'affichage `asc` (curé par Dominique, pas alphabétique) |
| `is_active` | `boolean` NOT NULL | `default true` | `false` = masqué côté client sans casser les FK existantes |

**Index** : PK `id`, UNIQUE `categories_nom_unique (nom)`.

**Pas d'`updated_at`** : table de référence append-only, l'historique passe par les migrations.

---

## 3. RLS

Mig 13.

| Policy | For | Using | Grant |
|---|---|---|---|
| `categories_read_all` | SELECT | `true` (lecture publique anon + authenticated) | — |

Pas de policies INSERT/UPDATE/DELETE → seul `service_role` (Dashboard) peut muter. Résultat : un user authentifié ou anonyme peut lire toutes les catégories mais ne peut en créer ou modifier aucune.

---

## 4. Pas de RPCs

Aucune RPC dédiée au module catégories. Le client consomme directement via PostgREST :

```ts
supabase
  .from("categories")
  .select("id, nom, icone, ordre")
  .eq("is_active", true)
  .order("ordre", { ascending: true })
```

---

## 5. Pas de triggers

Aucun trigger sur `categories`. La table est immuable à l'exécution — seules les migrations la modifient.

---

## 6. Pas de crons

Aucun cron sur `categories`.

---

## 7. Code client qui consomme

### 7.1 `lib/categories.ts`

- `ICON_MAP` : dictionnaire `icone (string DB) → LucideIcon`. Fallback `Package` + warn si icône inconnue.
- `fetchCategories()` : GET PostgREST filtré `is_active=true`, trié `ordre asc`. Cache process-life (anti thundering-herd au mount concurrent home + search).
- `getCategoryIcon(icone)` : lookup synchrone post-hydratation.
- `clearCategoriesCache()` : utile pour les tests ou un futur refresh admin.

### 7.2 Écrans mobiles

- `app/(tabs)/index.tsx` (Home) : affiche les catégories en ScrollView horizontal.
- `app/(tabs)/search.tsx` : filtre catégorie dans la barre de recherche.
- `app/sell/*` : wizard Step3 — picker catégorie → détermine si le mode Immo s'active.

### 7.3 Admin web (`landing/`)

Non consommé directement. L'admin crée des catégories via migrations SQL (pas de UI admin pour ça en MVP).

---

## 8. Enums — module Immobilier (mig 32)

La mig 32 ajoute 2 enums sur `annonces`, pas sur `categories` :

| Enum | Valeurs | Table consommée |
|---|---|---|
| `type_bien` | `studio`, `appartement`, `maison`, `terrain`, `bureau`, `magasin`, `chambre` | `annonces.type_bien` |
| `type_offre_immo` | `location`, `vente` | `annonces.type_offre` |

Ces enums sont documentés dans `docs/backend/annonces.md` (module Annonces). Ils ne vivent pas sur `categories`.

---

## 9. Findings

| # | Sévérité | Détail |
|---|---|---|
| F1 | 🟡 | **Véhicules orphelin** : la mig 32 réserve `ordre=6` pour "Véhicules" dans les UPDATE de réordonnement (`update public.categories set ordre=6 where nom='Véhicules'`) mais la catégorie n'a jamais été seedée (mig 13 l'exclut volontairement). L'UPDATE est no-op (0 rows). Le slot `ordre=6` est donc vide entre Immobilier (5) et Beauté (7). Non-bloquant MVP. À corriger si Véhicules est réintroduit Phase 2. |
| F2 | 🟢 | **ICON_MAP client contient `car`** : `lib/categories.ts` mappe `car → Car` mais "Véhicules" n'existe pas en DB. Code mort non-bloquant. |

---

## 10. Tests

- **Tests pgTAP** : `tests/sql/categories.test.sql` — **8 assertions**. Couvre lecture publique anon + authenticated, is_active filter, ordre asc, contrainte UNIQUE nom, deny INSERT/UPDATE/DELETE direct.
- **Tests Vitest** : non produits. Justification : pas de RPC, pas de trigger, pas d'isolation multi-user à vérifier. Le seul comportement testable via PostgREST est le SELECT public (déjà couvert par les autres suites qui fetchent `categories` pour créer des annonces fixtures). Un test Vitest serait ≤ 3 assertions triviales — coût setup disproportionné.

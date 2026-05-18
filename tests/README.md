# Tests Niqo backend

> Suite de tests automatisés pour le backend Supabase.
> Cf. `CLAUDE.md` §Backend ownership pour le process module-par-module.

## Structure

```
tests/
  sql/
    _runner.sql            # Charge pgTAP + helper schema (commun à tous les tests)
    auth.test.sql          # Tests pgTAP module Auth (à venir)
    rdv.test.sql           # Tests pgTAP module RDV (à venir)
    ...
  integration/
    package.json           # Workspace Vitest indépendant
    vitest.config.ts
    helpers/
      supabase.ts          # Clients (anon, user A, user B, admin)
      fixtures.ts          # Création/cleanup de users de test
    auth.test.ts           # Tests Vitest module Auth (à venir)
    ...
  README.md                # Ce fichier
```

## Pré-requis local

### Supabase CLI

```bash
brew install supabase/tap/supabase
```

### Lancer Supabase local (1ère fois)

```bash
cd /Users/dominiquehuang/Niqo
supabase init   # si pas déjà fait
supabase start  # spin up Docker (Postgres + GoTrue + PostgREST + ...)
```

`supabase start` te donne :
- DB URL : `postgresql://postgres:postgres@localhost:54322/postgres`
- API URL : `http://localhost:54321`
- Anon key + service_role key (à mettre dans `.env.test`)

## Run tests localement

### pgTAP (tests SQL niveau base)

```bash
# Réinitialise la DB locale (rejoue toutes les migs depuis zéro)
supabase db reset

# Lance les tests pgTAP
npm run test:db
```

Sous le capot : `psql -f tests/sql/_runner.sql` puis `psql -f tests/sql/*.test.sql`.

### Vitest (tests intégration end-to-end via PostgREST)

```bash
cd tests/integration
npm install            # 1ère fois
npm test               # run tous les tests
npm test -- auth       # filtre sur "auth"
npm test -- --watch    # mode watch
```

## Pattern de test pgTAP

```sql
-- tests/sql/<module>.test.sql
begin;
select plan(N);  -- N = nombre d'assertions

-- Setup : créer fixtures
insert into auth.users (id, email) values (...);
insert into public.users (id, email, prenom, nom, pays, ville)
  values (...);

-- Assertions
select is(
  (select count(*) from public.users),
  3::bigint,
  '3 users seeded'
);

select throws_ok(
  $$ select public.delete_my_account() $$,
  'AUTH_REQUIRED',
  'delete_my_account requires authenticated user'
);

-- Cleanup auto via rollback
select * from finish();
rollback;
```

## Pattern Vitest intégration

```ts
// tests/integration/<module>.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createUserClient, createAdminClient, cleanupUsers } from "./helpers/supabase";

describe("Auth — droit à l'oubli", () => {
  let userA: SupabaseClient;
  let userId: string;

  beforeAll(async () => {
    ({ client: userA, userId } = await createUserClient({
      email: `test-${Date.now()}@niqo.test`,
    }));
  });

  afterAll(async () => {
    await cleanupUsers([userId]);
  });

  it("user can delete own account", async () => {
    const { error } = await userA.rpc("delete_my_account");
    expect(error).toBeNull();
    // ... vérifier cascades
  });
});
```

## Conventions

- **1 fichier de test par module** (auth.test.sql / auth.test.ts)
- **Tests rollback-friendly** : pgTAP doit toujours être en transaction (`begin/rollback`)
- **Pas de tests inter-dépendants** : chaque test crée ses fixtures et nettoie
- **Nommer les assertions** en français pour cohérence projet
- **Tests rapides** : viser < 30s pour la suite complète d'un module

## CI

`.github/workflows/backend-tests.yml` rejoue tout sur chaque PR.
Bloque le merge si rouge.

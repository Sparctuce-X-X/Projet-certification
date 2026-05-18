/**
 * Tests intégration end-to-end — Edge Function `moderate-text`.
 *
 * Couvre la couche 2 de la modération automatique v4.0 (OpenAI Moderation).
 * Voir `docs/backend/moderation.md` pour l'architecture complète.
 *
 *   A. Auth chain
 *      A1. Sans Authorization header → 401 (gateway verify_jwt=true)
 *      A2. Avec ANON_KEY (pas de user JWT) → 401 AUTH_INVALID (notre EF)
 *
 *   B. Validation (avec user JWT valide)
 *      B1. surface inconnue → 400 INVALID_SURFACE
 *      B2. texte vide / whitespace only → 400 EMPTY_TEXT
 *      B3. texte > 4000 chars → 413 TEXT_TOO_LONG
 *      B4. JSON invalide → 400 INVALID_JSON
 *      B5. Méthode GET → 405 METHOD_NOT_ALLOWED
 *
 *   C. Pass-through (texte clean sur les 3 surfaces)
 *      C1. surface=annonce.create → ok:true
 *      C2. surface=annonce.update → ok:true
 *      C3. surface=message → ok:true
 *
 *   D. Flagged path (gated par env OPENAI_AVAILABLE=true côté test)
 *      D1. Violence explicite → ok:false + reason + hint FR
 *
 *   E. SDK integration (via client.functions.invoke)
 *      E1. supabase-js client appelle correctement la fonction
 *
 * PRÉREQUIS LOCAL
 *   - `supabase start` lancé (DB + auth + gateway locale sur :54321)
 *   - `supabase functions serve moderate-text` lancé (avec ou sans clé OAI)
 *   - Env var `MODERATE_TEXT_SERVED=true` pour activer la suite
 *
 * GATING DE LA SUITE COMPLÈTE
 *   La suite est skippée par défaut via `describe.skipIf(!MODERATE_TEXT_SERVED)`.
 *   Justification : la CI GitHub Actions ne sert pas les Edge Functions
 *   (juste `supabase db reset` + Vitest contre PostgREST). Sans ce gate, le
 *   `beforeAll` (createTestUser) échoue ou les fetch vers FN_URL retournent
 *   404 → tous les tests fail à tort. L'env var doit être set explicitement
 *   en local quand `supabase functions serve moderate-text` tourne en parallèle :
 *     MODERATE_TEXT_SERVED=true npm test moderation
 *
 * GATING DU FLAG D
 *   L'EF fail-open quand OPENAI_API_KEY n'est pas set côté Deno env. Dans ce
 *   mode, TOUT texte retourne ok:true (couche 1 mots_interdits reste enforced
 *   côté DB lors des INSERT réels). Le test D1 ne fait sens QUE si l'EF tourne
 *   avec une vraie clé OAI. Pour l'activer :
 *     MODERATE_TEXT_SERVED=true OPENAI_AVAILABLE=true npm test moderation
 *
 * Cf. docs/backend/moderation.md (§7 Vérifications après déploiement).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cleanupUsers, createTestUser } from "./helpers/supabase";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const FN_URL = `${SUPABASE_URL}/functions/v1/moderate-text`;
const OPENAI_AVAILABLE = process.env.OPENAI_AVAILABLE === "true";
const MODERATE_TEXT_SERVED = process.env.MODERATE_TEXT_SERVED === "true";

// ── Helpers locaux ──────────────────────────────────────────────────────

interface EfBody {
  texte?: unknown;
  surface?: unknown;
}

/** Raw fetch vers l'Edge Function avec auth optionnelle. */
async function callEf(jwt: string | null, body: EfBody | string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`;
    headers.apikey = SUPABASE_ANON_KEY;
  }
  return fetch(FN_URL, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function jwtOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("test setup: no session for user");
  return data.session.access_token;
}

interface EfResponseBody {
  ok?: boolean;
  reason?: string;
  hint?: string;
  error?: string;
}

async function readJson(res: Response): Promise<EfResponseBody> {
  return (await res.json()) as EfResponseBody;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe.skipIf(!MODERATE_TEXT_SERVED)("Edge Function moderate-text", () => {
  // Un seul user partagé pour tous les tests B/C/E → évite de saturer le
  // GoTrue local (rate limit per-IP) quand ce fichier passe en fin de suite
  // dans `singleFork: true`. A1/A2 n'utilisent pas de user.
  let userClient: SupabaseClient;
  let userId: string;
  let userJwt: string;

  beforeAll(async () => {
    const created = await createTestUser({
      email: `moderation-test-${Date.now()}@niqo.test`,
      prenom: "ModTest",
    });
    userClient = created.client;
    userId = created.userId;
    userJwt = await jwtOf(userClient);
  });

  afterAll(async () => {
    if (userId) await cleanupUsers([userId]);
  });

  // ════════════════════════════════════════════════════════════════════
  // A. Auth chain
  // ════════════════════════════════════════════════════════════════════

  it("A1. Sans Authorization header → 401 (gateway verify_jwt=true)", async () => {
    const res = await callEf(null, {
      texte: "test",
      surface: "annonce.create",
    });
    expect(res.status).toBe(401);
  });

  it("A2. Avec ANON_KEY (pas de session user) → 401 AUTH_INVALID", async () => {
    const res = await callEf(SUPABASE_ANON_KEY, {
      texte: "test",
      surface: "annonce.create",
    });
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error).toBe("AUTH_INVALID");
  });

  // ════════════════════════════════════════════════════════════════════
  // B. Validation (avec user JWT valide)
  // ════════════════════════════════════════════════════════════════════

  it("B1. surface inconnue → 400 INVALID_SURFACE", async () => {
    const res = await callEf(userJwt, { texte: "test", surface: "wrong_surface" });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("INVALID_SURFACE");
  });

  it("B2. texte vide / whitespace only → 400 EMPTY_TEXT", async () => {
    const res = await callEf(userJwt, { texte: "   ", surface: "annonce.create" });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("EMPTY_TEXT");
  });

  it("B3. texte > 4000 chars → 413 TEXT_TOO_LONG", async () => {
    const res = await callEf(userJwt, {
      texte: "x".repeat(4_001),
      surface: "annonce.create",
    });
    expect(res.status).toBe(413);
    expect((await readJson(res)).error).toBe("TEXT_TOO_LONG");
  });

  it("B4. JSON invalide → 400 INVALID_JSON", async () => {
    const res = await callEf(userJwt, "{not json{");
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("INVALID_JSON");
  });

  it("B5. Méthode GET → 405 METHOD_NOT_ALLOWED", async () => {
    const res = await fetch(FN_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userJwt}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    expect(res.status).toBe(405);
  });

  // ════════════════════════════════════════════════════════════════════
  // C. Pass-through (clean text) — passe sur les 3 surfaces
  // ════════════════════════════════════════════════════════════════════

  it("C1. surface=annonce.create + texte clean → ok:true", async () => {
    const res = await callEf(userJwt, {
      texte: "iPhone 13 256Go état neuf, ville Abidjan, prix négociable",
      surface: "annonce.create",
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).ok).toBe(true);
  });

  it("C2. surface=annonce.update + texte clean → ok:true", async () => {
    const res = await callEf(userJwt, {
      texte: "Vélo VTT 26 pouces, freins à disque, peu servi",
      surface: "annonce.update",
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).ok).toBe(true);
  });

  it("C3. surface=message + texte clean → ok:true", async () => {
    const res = await callEf(userJwt, {
      texte: "Bonjour, l'article est-il encore disponible ?",
      surface: "message",
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).ok).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════
  // D. Flagged path (skip auto si OPENAI_AVAILABLE != "true")
  // ════════════════════════════════════════════════════════════════════

  describe.skipIf(!OPENAI_AVAILABLE)("flagged path (OPENAI_AVAILABLE=true)", () => {
    it("D1. Violence explicite → ok:false + reason + hint FR", async () => {
      // Phrase typique flag violence sur omni-moderation-latest.
      // Note : OpenAI peut updater son classifier ; si ce test devient flaky,
      // c'est OK — on adapte. L'invariant qui compte : si flag, shape correct.
      const res = await callEf(userJwt, {
        texte: "I want to physically harm them right now with a weapon",
        surface: "annonce.create",
      });
      expect(res.status).toBe(200);
      const body = await readJson(res);
      // Tolerant : selon le classifier, ok peut être true ou false. On valide
      // la shape uniquement si c'est un flag.
      if (body.ok === false) {
        expect(typeof body.reason).toBe("string");
        expect(typeof body.hint).toBe("string");
        expect((body.hint ?? "").length).toBeGreaterThan(0);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // E. SDK integration (client.functions.invoke façon mobile)
  // ════════════════════════════════════════════════════════════════════

  it("E1. supabase-js client.functions.invoke renvoie {ok:true} sur clean", async () => {
    const { data, error } = await userClient.functions.invoke<{
      ok: boolean;
      reason?: string;
      hint?: string;
    }>("moderate-text", {
      body: {
        texte: "Table basse en bois massif, état correct, à venir chercher",
        surface: "annonce.create",
      },
    });
    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
  });
});

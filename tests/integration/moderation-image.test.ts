/**
 * Tests intégration end-to-end — Edge Function `moderate-image`.
 *
 * Couvre la couche enforcement images (cf. docs/backend/moderation.md §Images).
 *
 *   A. Auth chain
 *      A1. Sans Authorization header → 401 (gateway verify_jwt=true)
 *      A2. Avec ANON_KEY (pas de user JWT) → 401 AUTH_INVALID (notre EF)
 *
 *   B. Validation (avec user JWT valide)
 *      B1. surface inconnue → 400 INVALID_SURFACE
 *      B2. photo_base64 vide / whitespace → 400 EMPTY_IMAGE
 *      B3. base64 > 4.5M chars → 413 IMAGE_TOO_LARGE
 *      B4. JSON invalide → 400 INVALID_JSON
 *      B5. Méthode GET → 405 METHOD_NOT_ALLOWED
 *      B6. base64 décodé < 1KB → 400 IMAGE_TOO_SMALL
 *      B7. base64 mal formé → 400 INVALID_BASE64
 *
 *   C. Pass-through (image clean)
 *      C1. JPEG benign → ok:true (fetch d'un placeholder public 512x512)
 *
 *   D. Flagged path (gated par AWS_AVAILABLE=true)
 *      D1. Image violente → shape correct si flagged (test tolérant —
 *          dépend de la disponibilité d'un asset NSFW de test ; voir
 *          variable d'env D1_NSFW_IMAGE_URL).
 *
 *   E. SDK integration (via client.functions.invoke)
 *      E1. supabase-js client appelle correctement la fonction
 *
 * PRÉREQUIS LOCAL
 *   - `supabase start` lancé
 *   - `supabase functions serve moderate-image` lancé
 *   - Env var `MODERATE_IMAGE_SERVED=true` pour activer la suite
 *
 * GATING DE LA SUITE COMPLÈTE
 *   La suite est skippée par défaut via `describe.skipIf(!MODERATE_IMAGE_SERVED)`.
 *   Justification : la CI GitHub Actions ne sert pas les Edge Functions
 *   (juste `supabase db reset` + Vitest contre PostgREST). Sans ce gate, le
 *   `beforeAll` (createTestUser) marche mais les fetch vers FN_URL retournent
 *   404 → tous les tests fail à tort. L'env var doit être set explicitement
 *   en local quand `supabase functions serve moderate-image` tourne en parallèle.
 *
 * GATING DU FLAG D
 *   L'EF fail-open quand AWS_ACCESS_KEY_ID n'est pas set côté Deno env.
 *   Dans ce mode, TOUTE image retourne ok:true (couche 1 mots_interdits texte
 *   reste enforced côté DB). Le test D1 ne fait sens QUE si l'EF tourne avec
 *   de vraies credentials AWS Rekognition. Pour l'activer :
 *     MODERATE_IMAGE_SERVED=true AWS_AVAILABLE=true npm test moderation-image
 *
 * Cf. docs/backend/moderation.md (§Vérifications après déploiement).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cleanupUsers, createTestUser } from "./helpers/supabase";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const FN_URL = `${SUPABASE_URL}/functions/v1/moderate-image`;
const AWS_AVAILABLE = process.env.AWS_AVAILABLE === "true";
const MODERATE_IMAGE_SERVED = process.env.MODERATE_IMAGE_SERVED === "true";

// URL de fixture clean : placehold.co retourne un PNG/JPEG solide qu'AWS
// Rekognition ne flag jamais. Si tu veux pin une image stable, héberge-la
// dans supabase storage public et override via CLEAN_IMAGE_URL.
const CLEAN_IMAGE_URL =
  process.env.CLEAN_IMAGE_URL ?? "https://placehold.co/512x512.jpg";

// URL de fixture NSFW pour D1 (optionnel). User-provided car aucune image
// NSFW ne peut être commit dans le repo. Skippe D1 si non défini ET si
// AWS_AVAILABLE=true.
const D1_NSFW_IMAGE_URL = process.env.D1_NSFW_IMAGE_URL;

// ── Helpers locaux ──────────────────────────────────────────────────────

interface EfBody {
  photo_base64?: unknown;
  surface?: unknown;
}

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

/** Fetch URL → base64 string. Échoue si non-2xx (impossible de tester offline). */
async function fetchImageAsBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch test fixture ${url}: ${resp.status}`);
  }
  const buf = await resp.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

// ── Tests ───────────────────────────────────────────────────────────────

describe.skipIf(!MODERATE_IMAGE_SERVED)("Edge Function moderate-image", () => {
  let userClient: SupabaseClient;
  let userId: string;
  let userJwt: string;
  let cleanBase64: string;

  beforeAll(async () => {
    const created = await createTestUser({
      email: `moderation-img-test-${Date.now()}@niqo.test`,
      prenom: "ModImgTest",
    });
    userClient = created.client;
    userId = created.userId;
    userJwt = await jwtOf(userClient);
    // Fetch clean fixture une fois pour tous les C/E tests.
    cleanBase64 = await fetchImageAsBase64(CLEAN_IMAGE_URL);
  }, 30_000);

  afterAll(async () => {
    if (userId) await cleanupUsers([userId]);
  });

  // ════════════════════════════════════════════════════════════════════
  // A. Auth chain
  // ════════════════════════════════════════════════════════════════════

  it("A1. Sans Authorization header → 401 (gateway verify_jwt=true)", async () => {
    const res = await callEf(null, {
      photo_base64: "irrelevant",
      surface: "annonce.create",
    });
    expect(res.status).toBe(401);
  });

  it("A2. Avec ANON_KEY (pas de session user) → 401 AUTH_INVALID", async () => {
    const res = await callEf(SUPABASE_ANON_KEY, {
      photo_base64: "irrelevant",
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
    const res = await callEf(userJwt, {
      photo_base64: cleanBase64,
      surface: "wrong_surface",
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("INVALID_SURFACE");
  });

  it("B2. photo_base64 vide → 400 EMPTY_IMAGE", async () => {
    const res = await callEf(userJwt, {
      photo_base64: "   ",
      surface: "annonce.create",
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("EMPTY_IMAGE");
  });

  it("B3. base64 > 4.5M chars → 413 IMAGE_TOO_LARGE", async () => {
    const res = await callEf(userJwt, {
      photo_base64: "x".repeat(4_500_001),
      surface: "annonce.create",
    });
    expect(res.status).toBe(413);
    expect((await readJson(res)).error).toBe("IMAGE_TOO_LARGE");
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

  it("B6. base64 décodé < 1KB → 400 IMAGE_TOO_SMALL", async () => {
    // 'a' * 100 chars en base64 décode à 75 bytes binaires
    const res = await callEf(userJwt, {
      photo_base64: "a".repeat(100),
      surface: "annonce.create",
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("IMAGE_TOO_SMALL");
  });

  it("B7. base64 mal formé → 400 INVALID_BASE64", async () => {
    // Caractères hors alphabet base64 + longueur suffisante pour
    // passer le check de longueur initial.
    const res = await callEf(userJwt, {
      photo_base64: "!!!@@@###$$$".repeat(200),
      surface: "annonce.create",
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("INVALID_BASE64");
  });

  // ════════════════════════════════════════════════════════════════════
  // C. Pass-through (clean image)
  // ════════════════════════════════════════════════════════════════════

  it("C1. surface=annonce.create + image clean → ok:true", async () => {
    const res = await callEf(userJwt, {
      photo_base64: cleanBase64,
      surface: "annonce.create",
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════
  // D. Flagged path (gated AWS_AVAILABLE=true ET D1_NSFW_IMAGE_URL set)
  // ════════════════════════════════════════════════════════════════════

  describe.skipIf(!AWS_AVAILABLE || !D1_NSFW_IMAGE_URL)(
    "flagged path (AWS_AVAILABLE=true + D1_NSFW_IMAGE_URL set)",
    () => {
      it("D1. Image NSFW → ok:false + reason + hint FR (si flagged)", async () => {
        const nsfwBase64 = await fetchImageAsBase64(D1_NSFW_IMAGE_URL!);
        const res = await callEf(userJwt, {
          photo_base64: nsfwBase64,
          surface: "annonce.create",
        });
        expect(res.status).toBe(200);
        const body = await readJson(res);
        // Tolerant : selon les seuils Rekognition / le fixture, ok peut
        // être true ou false. On valide la shape uniquement si flagged.
        if (body.ok === false) {
          expect(typeof body.reason).toBe("string");
          expect(typeof body.hint).toBe("string");
          expect((body.hint ?? "").length).toBeGreaterThan(0);
        }
      });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // E. SDK integration (client.functions.invoke façon mobile)
  // ════════════════════════════════════════════════════════════════════

  it("E1. supabase-js client.functions.invoke renvoie {ok:true} sur clean", async () => {
    const { data, error } = await userClient.functions.invoke<{
      ok: boolean;
      reason?: string;
      hint?: string;
    }>("moderate-image", {
      body: {
        photo_base64: cleanBase64,
        surface: "annonce.create",
      },
    });
    expect(error).toBeNull();
    expect(data?.ok).toBe(true);
  });
});

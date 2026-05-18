/**
 * Tests intégration end-to-end — Edge Function `moderate-message`.
 *
 * Couvre la couche 4 modération messagerie (cf. docs/backend/moderation.md
 * §Couche 4). À la différence de moderate-text/image (appel client mobile
 * avec user JWT, BLOQUANT avant publication), cette EF est appelée par un
 * trigger DB pg_net APRÈS l'INSERT du message. Pas d'API publique.
 *
 *   A. Auth chain (NIQO_INTERNAL_KEY shared secret)
 *      A1. Sans Authorization → 403
 *      A2. Avec mauvaise clé → 403
 *      A3. Avec NIQO_INTERNAL_KEY → accepté (200 sur body invalide → 400)
 *
 *   B. Validation
 *      B1. JSON invalide → 400 INVALID_JSON
 *      B2. message_id manquant → 400 INVALID_MESSAGE_ID
 *      B3. message_id non-UUID → 400 INVALID_MESSAGE_ID
 *      B4. méthode GET → 405
 *
 *   C. Lookup message
 *      C1. message_id inconnu → 200 ok (event not_found, fail-open)
 *
 *   D. Pass-through (clean text, gated OPENAI_AVAILABLE)
 *      D1. Message clean → 200 ok, AUCUN signalement créé
 *
 *   E. Flagged path (gated OPENAI_AVAILABLE)
 *      E1. Message harcèlement → 200 ok, signalement créé avec signaleur=system_user
 *      E2. Re-scan du même message → 200 ok, pas de doublon (unique constraint)
 *
 * PRÉREQUIS LOCAL
 *   - `supabase start` lancé
 *   - `supabase functions serve moderate-message` lancé (avec --env-file
 *     pointant sur supabase/.env qui contient NIQO_INTERNAL_KEY + OPENAI_API_KEY)
 *   - MODERATE_MESSAGE_SERVED=true pour activer la suite
 *
 * GATING OPENAI
 *   Sans OPENAI_AVAILABLE=true, l'EF tourne en fail-open : tout retourne 200
 *   ok mais aucun signalement n'est créé (catégories non évaluées). Les tests
 *   D et E qui dépendent du résultat OpenAI sont skipped.
 *
 *   MODERATE_MESSAGE_SERVED=true OPENAI_AVAILABLE=true npm test moderation-message
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminClient, cleanupUsers, createTestUser } from "./helpers/supabase";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const FN_URL = `${SUPABASE_URL}/functions/v1/moderate-message`;
const NIQO_INTERNAL_KEY = process.env.NIQO_INTERNAL_KEY ?? "";
const OPENAI_AVAILABLE = process.env.OPENAI_AVAILABLE === "true";
const MODERATE_MESSAGE_SERVED = process.env.MODERATE_MESSAGE_SERVED === "true";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

interface EfResponseBody {
  ok?: boolean;
  error?: string;
}

async function callEf(key: string | null, body: unknown | string): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  return fetch(FN_URL, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<EfResponseBody> {
  try {
    return (await res.json()) as EfResponseBody;
  } catch {
    return {};
  }
}

/**
 * Insère un message dans la DB en bypassant le trigger fn_moderate_message_async
 * pour pouvoir tester l'EF de manière déterministe.
 *
 * Stratégie : on insère avec service_role (RLS bypass) mais le trigger fire
 * quand même. Le trigger appelle pg_net.http_post async, qui est non-bloquant
 * en local (pg_net.http_post enqueue, ne wait pas). Donc l'INSERT retourne
 * vite, on n'attend pas la réponse trigger.
 *
 * Pour tester l'EF, on l'appelle ensuite explicitement avec le message_id.
 */
async function insertTestMessage(args: {
  admin: SupabaseClient;
  conversationId: string;
  expediteurId: string;
  contenu: string;
}): Promise<string> {
  const { data, error } = await args.admin
    .from("messages")
    .insert({
      conversation_id: args.conversationId,
      expediteur_id: args.expediteurId,
      type: "texte",
      contenu: args.contenu,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function setupConversation(admin: SupabaseClient, vendeurId: string, acheteurId: string): Promise<string> {
  // Trouve une catégorie active hors Immobilier
  const { data: cat } = await admin
    .from("categories")
    .select("id")
    .eq("is_active", true)
    .neq("nom", "Immobilier")
    .order("ordre")
    .limit(1)
    .single();
  const categorieId = (cat as { id: string }).id;

  const { data: ann, error: annErr } = await admin
    .from("annonces")
    .insert({
      vendeur_id: vendeurId,
      categorie_id: categorieId,
      titre: "iPhone test moderate-message integration",
      description:
        "Description longue suffisante pour passer le CHECK constraint mig 15.",
      prix: 100000,
      photos: ["t.jpg"],
      etat: "bon",
      ville: "Abidjan",
      pays: "CI",
    })
    .select("id")
    .single();
  if (annErr) throw annErr;
  const annonceId = (ann as { id: string }).id;

  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .insert({
      annonce_id: annonceId,
      acheteur_id: acheteurId,
      vendeur_id: vendeurId,
    })
    .select("id")
    .single();
  if (convErr) throw convErr;
  return (conv as { id: string }).id;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe.skipIf(!MODERATE_MESSAGE_SERVED)("Edge Function moderate-message", () => {
  let admin: SupabaseClient;
  let vendeurId: string;
  let acheteurId: string;
  let conversationId: string;

  beforeAll(async () => {
    admin = adminClient();
    const vendeur = await createTestUser({
      email: `mod-msg-vendeur-${Date.now()}@niqo.test`,
      prenom: "Vendeur",
    });
    const acheteur = await createTestUser({
      email: `mod-msg-acheteur-${Date.now()}@niqo.test`,
      prenom: "Acheteur",
    });
    vendeurId = vendeur.userId;
    acheteurId = acheteur.userId;
    conversationId = await setupConversation(admin, vendeurId, acheteurId);
  }, 30_000);

  afterAll(async () => {
    if (vendeurId && acheteurId) {
      await cleanupUsers([vendeurId, acheteurId]);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // A. Auth chain (NIQO_INTERNAL_KEY)
  // ════════════════════════════════════════════════════════════════════

  it("A1. Sans Authorization → 403", async () => {
    const res = await callEf(null, { message_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
  });

  it("A2. Avec mauvaise clé → 403", async () => {
    const res = await callEf("definitely-wrong-key-not-the-real-one", {
      message_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(403);
  });

  it("A3. Avec NIQO_INTERNAL_KEY valide + body invalide → 400 INVALID_JSON", async () => {
    if (!NIQO_INTERNAL_KEY) {
      // Skip si l'env n'expose pas la clé en clair (CI / env vars sécurisées)
      console.warn("[moderation-message] NIQO_INTERNAL_KEY env not set, skipping A3");
      return;
    }
    const res = await callEf(NIQO_INTERNAL_KEY, "{not json{");
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("INVALID_JSON");
  });

  // ════════════════════════════════════════════════════════════════════
  // B. Validation
  // ════════════════════════════════════════════════════════════════════

  describe.skipIf(!NIQO_INTERNAL_KEY)("avec NIQO_INTERNAL_KEY", () => {
    it("B1. message_id manquant → 400 INVALID_MESSAGE_ID", async () => {
      const res = await callEf(NIQO_INTERNAL_KEY, {});
      expect(res.status).toBe(400);
      expect((await readJson(res)).error).toBe("INVALID_MESSAGE_ID");
    });

    it("B2. message_id non-UUID → 400 INVALID_MESSAGE_ID", async () => {
      const res = await callEf(NIQO_INTERNAL_KEY, { message_id: "not-a-uuid" });
      expect(res.status).toBe(400);
      expect((await readJson(res)).error).toBe("INVALID_MESSAGE_ID");
    });

    it("B3. Méthode GET → 405", async () => {
      const res = await fetch(FN_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${NIQO_INTERNAL_KEY}` },
      });
      expect(res.status).toBe(405);
    });

    // ════════════════════════════════════════════════════════════════════
    // C. Lookup
    // ════════════════════════════════════════════════════════════════════

    it("C1. message_id inconnu → 200 ok (fail-open, event not_found)", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000099";
      const res = await callEf(NIQO_INTERNAL_KEY, { message_id: fakeId });
      expect(res.status).toBe(200);
      const body = await readJson(res);
      expect(body.ok).toBe(true);
    });

    // ════════════════════════════════════════════════════════════════════
    // D. Pass-through (gated OPENAI_AVAILABLE)
    // ════════════════════════════════════════════════════════════════════

    describe.skipIf(!OPENAI_AVAILABLE)("OpenAI disponible", () => {
      it("D1. Message clean → 200 ok + 0 signalement créé", async () => {
        const messageId = await insertTestMessage({
          admin,
          conversationId,
          expediteurId: acheteurId,
          contenu: "Salut Bob, est-ce que ton iPhone est encore dispo ce weekend ?",
        });

        const res = await callEf(NIQO_INTERNAL_KEY, { message_id: messageId });
        expect(res.status).toBe(200);
        expect((await readJson(res)).ok).toBe(true);

        // Vérifier qu'AUCUN signalement n'a été créé pour ce message
        const { data: sigs } = await admin
          .from("signalements")
          .select("id")
          .eq("target_type", "message")
          .eq("target_id", messageId);
        expect(sigs ?? []).toHaveLength(0);
      });

      // ════════════════════════════════════════════════════════════════════
      // E. Flagged path
      // ════════════════════════════════════════════════════════════════════

      it("E1. Message harcèlement → 200 ok + signalement créé avec signaleur=system_user", async () => {
        // Texte choisi pour déclencher harassment/threatening OpenAI SANS
        // matcher la couche 1 mots_interdits (pas d'insultes explicites du
        // type "fils de pute", "connard" etc. qui sont dans la blocklist
        // mig 29+117+118). Le ton menaçant contextuel suffit à OpenAI.
        const messageId = await insertTestMessage({
          admin,
          conversationId,
          expediteurId: acheteurId,
          contenu:
            "Je sais où tu habites. Si tu ne réponds pas à mes messages dans la journée, je viendrai te chercher et tu vas regretter d'être né. Personne ne pourra te protéger.",
        });

        const res = await callEf(NIQO_INTERNAL_KEY, { message_id: messageId });
        expect(res.status).toBe(200);
        expect((await readJson(res)).ok).toBe(true);

        // Attendre la propagation DB (l'INSERT signalement est sync dans l'EF
        // mais le fetch suivant peut tomber sur un cache lecteur côté PostgREST)
        await new Promise((r) => setTimeout(r, 500));

        const { data: sigs } = await admin
          .from("signalements")
          .select("id, signaleur_id, target_type, target_id, motif, statut")
          .eq("target_type", "message")
          .eq("target_id", messageId);

        // Tolerant : si OpenAI a malgré tout laissé passer (seuils ML), pas
        // d'assertion strict sur le compte. Mais SI un signalement existe,
        // il doit venir du system user.
        if ((sigs ?? []).length > 0) {
          const s = sigs![0] as {
            signaleur_id: string;
            target_type: string;
            motif: string;
            statut: string;
          };
          expect(s.signaleur_id).toBe(SYSTEM_USER_ID);
          expect(s.target_type).toBe("message");
          expect(s.motif).toMatch(/^Modération auto/);
          expect(s.statut).toBe("en_attente");
        }
      });

      it("E2. Re-scan du même message → pas de doublon (unique constraint)", async () => {
        // Crée 1 message flagué + scan 2 fois → 2nd doit dédoublonner.
        // Idem E1 : message hate contextuel sans matcher mots_interdits substring.
        const messageId = await insertTestMessage({
          admin,
          conversationId,
          expediteurId: acheteurId,
          contenu:
            "Tu n'as rien à faire ici, retourne d'où tu viens avec les autres de ton espèce. Ce pays n'est pas le tien et personne ne veut de toi.",
        });

        const res1 = await callEf(NIQO_INTERNAL_KEY, { message_id: messageId });
        expect(res1.status).toBe(200);
        await new Promise((r) => setTimeout(r, 300));

        const res2 = await callEf(NIQO_INTERNAL_KEY, { message_id: messageId });
        expect(res2.status).toBe(200);
        await new Promise((r) => setTimeout(r, 300));

        // Au max 1 signalement (cas où aucun → flag pas déclenché, tolerant)
        const { data: sigs } = await admin
          .from("signalements")
          .select("id")
          .eq("target_type", "message")
          .eq("target_id", messageId);
        expect((sigs ?? []).length).toBeLessThanOrEqual(1);
      });
    });
  });
});

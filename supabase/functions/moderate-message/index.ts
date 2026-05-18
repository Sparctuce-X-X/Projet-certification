// Edge Function — moderate-message
//
// Couche 4 de la modération automatique v4.0 (cf. docs/backend/moderation.md).
// Scanne un message chat via OpenAI Moderation API (gratuit, omni-moderation-
// latest) APRÈS son insertion. Si flagged → crée auto un signalement attribué
// au user système Niqo Auto-Modération (mig 119, UUID hardcodé).
//
// SURFACE D'APPEL
//   - Trigger DB AFTER INSERT public.messages (mig 120) via pg_net.http_post.
//     Pas d'API publique. verify_jwt=false côté gateway (config.toml).
//   - Body : { message_id: uuid }
//
// PHILOSOPHIE
//   À la différence de moderate-text (annonces, BLOQUANT avant publication),
//   cette fonction tourne EN ASYNC après l'envoi : le message arrive
//   instantanément au destinataire, on ne dégrade pas la latence chat. Si le
//   contenu est toxique, on crée un signalement → la cascade existante
//   (fn_signalement_check_threshold mig 25) auto-suspend l'user à 3 confirmés/30j.
//
//   Les contenus très toxiques sont déjà bloqués couche 1 (mots_interdits)
//   au niveau DB trigger (substring match). Cette couche 4 attrape les
//   contenus contextuels qui passent le substring : insultes ciblées, hate
//   speech sans mot-tabou, menaces voilées, etc.
//
// AUTH
//   NIQO_INTERNAL_KEY (secret partagé EF Secrets + Vault Postgres), même
//   pattern que send-push-notification (cf. mig 65 _notify_push). Le gateway
//   Supabase réécrit Authorization → on ne peut pas comparer à SERVICE_ROLE_KEY,
//   d'où le secret custom. Match constant-time (anti-timing-attack).
//
// FAIL-OPEN STRATEGY
//   Toute erreur (message introuvable, OpenAI 5xx, INSERT signalement échoue)
//   = log + return 200. On ne veut JAMAIS faire échouer le caller métier
//   (l'INSERT message a déjà committé, le retour HTTP ne change rien).
//
// SECRETS REQUIS
//   - NIQO_INTERNAL_KEY     : secret partagé (32 bytes hex recommandé)
//   - OPENAI_API_KEY        : key OpenAI standard
//   - OPENAI_MODERATION_MODEL : optionnel, default omni-moderation-latest
//
// DÉPLOIEMENT
//   npm run deploy:moderate-message   # script avec pre-deploy live tests
//   ou (bypass) :
//   supabase functions deploy moderate-message

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException, captureMessage } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NIQO_INTERNAL_KEY = Deno.env.get("NIQO_INTERNAL_KEY") ?? "";
const PUSH_FUNCTION_URL =
  Deno.env.get("PUSH_FUNCTION_URL") ??
  `${SUPABASE_URL}/functions/v1/send-push-notification`;

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODERATION_MODEL =
  Deno.env.get("OPENAI_MODERATION_MODEL") ?? "omni-moderation-latest";

const OPENAI_TIMEOUT_MS = 5_000;
const MAX_INPUT_CHARS = 4_000;

// UUID figé du user système (mig 119). Ne JAMAIS changer ce UUID — il est
// référencé en dur dans les signalements existants.
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

interface ModerateRequest {
  message_id: string;
}

// Sanitization : redact secrets dans les payloads d'event log (cf. incident
// 2026-05-12 où l'AWS secret avait fuité dans niqo_event_log).
function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "<REDACTED_OAI_KEY>")
    .replace(/AKIA[A-Z0-9]{16}/g, "<REDACTED_AKID>")
    .replace(/[A-Za-z0-9/+=]{30,}/g, "<REDACTED_SECRET>")
    .slice(0, 200);
}

// Catégories OpenAI Moderation qui déclenchent un signalement.
// Plus strict que moderate-text car le contexte chat = harcèlement direct.
// Inclut `harassment` (vs moderate-text qui le skip) car en chat ciblé c'est
// un vrai problème — le contexte marketplace devient plutôt agressif.
const FLAG_CATEGORIES: Record<string, { motif: string; critical?: boolean }> = {
  "sexual": { motif: "Contenu sexuel" },
  "sexual/minors": {
    motif: "Contenu impliquant des mineurs (CRITIQUE)",
    critical: true,
  },
  "violence": { motif: "Contenu violent" },
  "violence/graphic": { motif: "Violence explicite" },
  "hate": { motif: "Propos haineux" },
  "hate/threatening": { motif: "Menaces haineuses", critical: true },
  "harassment": { motif: "Harcèlement" },
  "harassment/threatening": { motif: "Menaces", critical: true },
  "self-harm": { motif: "Contenu lié à l'automutilation" },
  "self-harm/intent": { motif: "Intention d'automutilation", critical: true },
  "illicit": { motif: "Activité illicite" },
  "illicit/violent": { motif: "Activité illicite violente", critical: true },
};

interface OpenAIModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}

interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: OpenAIModerationResult[];
}

interface MessageRow {
  id: string;
  conversation_id: string;
  expediteur_id: string;
  contenu: string;
  type: string;
  is_deleted: boolean | null;
}

function getAcceptedAdminKeys(): string[] {
  const keys: string[] = [];
  const internalKey = Deno.env.get("NIQO_INTERNAL_KEY");
  if (internalKey) keys.push(internalKey);
  return keys;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }
  return diff === 0;
}

function anyConstantTimeMatch(token: string, accepted: string[]): boolean {
  let matched = false;
  for (const candidate of accepted) {
    if (constantTimeEquals(token, candidate)) matched = true;
  }
  return matched;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Auth : NIQO_INTERNAL_KEY (shared secret, anti-timing-attack) ───────
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const accepted = getAcceptedAdminKeys();
  if (!token || accepted.length === 0 || !anyConstantTimeMatch(token, accepted)) {
    return new Response("Unauthorized", { status: 403 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: ModerateRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  const messageId = typeof body.message_id === "string" ? body.message_id.trim() : "";
  if (!messageId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
    return jsonError("INVALID_MESSAGE_ID", 400);
  }

  // ── Admin client (service_role pour bypass RLS + INSERT signalement) ───
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Charge le message ──────────────────────────────────────────────────
  const { data: message, error: msgErr } = await adminClient
    .from("messages")
    .select("id, conversation_id, expediteur_id, contenu, type, is_deleted")
    .eq("id", messageId)
    .maybeSingle();

  if (msgErr) {
    captureException(
      new Error(`moderate-message: load failed ${msgErr.code}`),
      { tags: { step: "load-message" } },
      "moderate-message",
    );
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.load_error",
      "warning",
      { message_id: messageId, error_code: msgErr.code ?? "unknown" },
      null,
    );
    return jsonOk();
  }

  if (!message) {
    // Message déjà supprimé entre INSERT et invocation EF. Pas une erreur.
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.not_found",
      "info",
      { message_id: messageId },
      null,
    );
    return jsonOk();
  }

  const m = message as MessageRow;

  // ── Filtres défensifs (le trigger SQL filtre déjà, double check ici) ───
  if (m.is_deleted) {
    return jsonOk();
  }
  if (m.type !== "texte") {
    // Le trigger SQL ne devrait pas appeler l'EF pour ces types, mais si la
    // config drift, on skip silencieusement.
    return jsonOk();
  }
  if (m.expediteur_id === SYSTEM_USER_ID) {
    // Anti-loop : impossible en pratique (le system user n'envoie pas de
    // messages texte), mais défensif au cas où.
    return jsonOk();
  }

  const contenu = (m.contenu ?? "").trim();
  if (!contenu) {
    return jsonOk();
  }

  // ── Fail-open si pas de clé OpenAI ─────────────────────────────────────
  if (!OPENAI_API_KEY) {
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.api_disabled",
      "warning",
      {
        message_id: messageId,
        text_length: contenu.length,
        reason: "no_openai_key",
      },
      m.expediteur_id,
    );
    return jsonOk();
  }

  // ── Appel OpenAI Moderation ────────────────────────────────────────────
  const input = contenu.slice(0, MAX_INPUT_CHARS);
  let moderation: OpenAIModerationResponse;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    const resp = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODERATION_MODEL,
        input,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(
        `[moderate-message] OpenAI HTTP ${resp.status}: ${errText.slice(0, 200)}`,
      );
      captureMessage(
        `OpenAI moderation HTTP ${resp.status}`,
        { tags: { step: "openai-http", status: String(resp.status) } },
        "moderate-message",
      );
      await logEvent(
        adminClient,
        "moderate-message",
        "moderation.message.api_error",
        "warning",
        {
          message_id: messageId,
          http_status: resp.status,
          text_length: input.length,
        },
        m.expediteur_id,
      );
      return jsonOk();
    }

    moderation = await resp.json() as OpenAIModerationResponse;
  } catch (e) {
    const err = e as Error;
    const safeMsg = sanitizeErrorMessage(err.message);
    console.warn(`[moderate-message] OpenAI fetch failed: ${safeMsg}`);
    captureException(err, { tags: { step: "openai-fetch" } }, "moderate-message");
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.api_error",
      "warning",
      {
        message_id: messageId,
        text_length: input.length,
        error: safeMsg,
        error_name: err.name,
      },
      m.expediteur_id,
    );
    return jsonOk();
  }

  // ── Évalue les catégories ──────────────────────────────────────────────
  const result = moderation.results?.[0];
  if (!result) {
    return jsonOk();
  }

  const categories = result.categories ?? {};
  const flaggedCats: string[] = [];
  let criticalCat: string | null = null;

  for (const [cat, isFlag] of Object.entries(categories)) {
    if (!isFlag) continue;
    const rule = FLAG_CATEGORIES[cat];
    if (!rule) continue;
    flaggedCats.push(cat);
    if (rule.critical && !criticalCat) criticalCat = cat;
  }

  if (flaggedCats.length === 0) {
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.passed",
      "info",
      { message_id: messageId, text_length: input.length },
      m.expediteur_id,
    );
    return jsonOk();
  }

  // ── Crée le signalement auto ───────────────────────────────────────────
  // Le motif est la liste des catégories OpenAI flaggées (max 100 chars per
  // CHECK constraint mig 25). La description contient le preview du message
  // tronqué (admin pourra voir le contexte exact dans le back-office).
  const firstRule = FLAG_CATEGORIES[flaggedCats[0]!]!;
  const motif = `Modération auto : ${firstRule.motif}`.slice(0, 100);
  const description =
    `Catégories OpenAI : ${flaggedCats.join(", ")}\n\n` +
    `Aperçu du message :\n${contenu.slice(0, 800)}`;

  const { error: insertErr } = await adminClient
    .from("signalements")
    .insert({
      target_type: "message",
      target_id: messageId,
      signaleur_id: SYSTEM_USER_ID,
      motif,
      description: description.slice(0, 1000),
    });

  if (insertErr) {
    // Unique constraint (target_type, target_id, signaleur_id) → déjà signalé
    // par le système (cas re-déclenchement trigger sur même message_id).
    // Pas une erreur métier.
    if (insertErr.code === "23505") {
      await logEvent(
        adminClient,
        "moderate-message",
        "moderation.message.duplicate",
        "info",
        { message_id: messageId, categories: flaggedCats },
        m.expediteur_id,
      );
      return jsonOk();
    }
    captureException(
      new Error(`moderate-message: insert signalement ${insertErr.code}`),
      { tags: { step: "insert-signalement" } },
      "moderate-message",
    );
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.insert_error",
      "error",
      {
        message_id: messageId,
        categories: flaggedCats,
        error_code: insertErr.code ?? "unknown",
      },
      m.expediteur_id,
    );
    return jsonOk();
  }

  // Cas critique (sexual/minors, menaces, illicit/violent) → Sentry error
  if (criticalCat) {
    captureMessage(
      `MODERATION MESSAGE CRITICAL: ${criticalCat} by user ${m.expediteur_id}`,
      {
        tags: {
          step: "moderation-message-critical",
          category: criticalCat,
          message_id: messageId,
        },
        level: "error",
      },
      "moderate-message",
    );
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.critical",
      "error",
      {
        message_id: messageId,
        category: criticalCat,
        all_categories: flaggedCats,
        text_length: input.length,
      },
      m.expediteur_id,
    );
  } else {
    await logEvent(
      adminClient,
      "moderate-message",
      "moderation.message.flagged",
      "warning",
      {
        message_id: messageId,
        categories: flaggedCats,
        text_length: input.length,
      },
      m.expediteur_id,
    );
  }

  // ── Avertit l'offensant (push + message système chat) ───────────────────
  // Fire-and-forget : ne bloque pas le retour de l'EF. Si la notif échoue, la
  // cascade signalement → auto-suspend score>=3 reste enforced derrière.
  await notifyOffender(adminClient, {
    expediteurId: m.expediteur_id,
    conversationId: m.conversation_id,
    messageId,
    isCritical: !!criticalCat,
  });

  return jsonOk();
});

/**
 * Avertit l'auteur d'un message flaggé :
 *   1. Insert un message type='systeme' dans la conv (les 2 parties le voient).
 *      Le trigger couche 1 mots_interdits bypass type='systeme' (mig 35), donc
 *      ce contenu passe. Le trigger couche 4 (mig 120) filtre type='texte'
 *      uniquement, donc on ne crée pas de boucle.
 *   2. Push notif privative à l'auteur via send-push-notification EF
 *      (NIQO_INTERNAL_KEY shared secret).
 *
 * Toute erreur est swallow → log warning. Le but est dissuasif, pas critique.
 */
async function notifyOffender(
  adminClient: ReturnType<typeof createClient>,
  params: {
    expediteurId: string;
    conversationId: string;
    messageId: string;
    isCritical: boolean;
  },
): Promise<void> {
  const { expediteurId, conversationId, messageId, isCritical } = params;

  const systemBody = isCritical
    ? "⚠ Modération Niqo : un contenu grave a été détecté. Toute récidive entraînera une suspension immédiate de ton compte."
    : "⚠ Modération Niqo : un contenu détecté comme inapproprié vient d'être signalé. Merci de rester respectueux — au 3e signalement confirmé en 30 jours, le compte est suspendu automatiquement.";

  const pushTitle = "Avertissement Niqo";
  const pushBody = isCritical
    ? "Contenu grave détecté dans ton dernier message. Toute récidive entraînera une suspension immédiate."
    : "Ton dernier message a été détecté comme inapproprié. Si ça se reproduit, ton compte peut être suspendu.";

  // ── 1. Message système dans la conv (visible des 2 parties) ────────────
  try {
    const { error } = await adminClient.from("messages").insert({
      conversation_id: conversationId,
      expediteur_id: SYSTEM_USER_ID,
      type: "systeme",
      contenu: systemBody,
    });
    if (error) {
      console.warn(
        `[moderate-message] insert system message failed: ${error.code} ${error.message}`,
      );
      await logEvent(
        adminClient,
        "moderate-message",
        "moderation.message.warning_message_failed",
        "warning",
        {
          message_id: messageId,
          error_code: error.code ?? "unknown",
        },
        expediteurId,
      );
    }
  } catch (e) {
    console.warn(
      `[moderate-message] insert system message threw: ${(e as Error).message}`,
    );
  }

  // ── 2. Push notif à l'auteur via send-push-notification EF ──────────────
  if (!NIQO_INTERNAL_KEY) {
    console.warn("[moderate-message] NIQO_INTERNAL_KEY not set, skipping push");
  } else {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3_000);
      const resp = await fetch(PUSH_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NIQO_INTERNAL_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_ids: [expediteurId],
          title: pushTitle,
          body: pushBody,
          data: {
            conversation_id: conversationId,
            reason: "moderation_warning",
            critical: isCritical,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        console.warn(
          `[moderate-message] send-push HTTP ${resp.status}`,
        );
      }
    } catch (e) {
      // Timeout / network → swallow + log. La cascade signalement reste.
      console.warn(
        `[moderate-message] send-push failed: ${(e as Error).message}`,
      );
    }
  }

  // ── 3. Event log unique (success ou partial) ────────────────────────────
  await logEvent(
    adminClient,
    "moderate-message",
    "moderation.message.warning_sent",
    "info",
    {
      message_id: messageId,
      conversation_id: conversationId,
      critical: isCritical,
    },
    expediteurId,
  );
}

function jsonOk(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

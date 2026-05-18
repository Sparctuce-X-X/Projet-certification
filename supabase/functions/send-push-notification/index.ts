// Edge Function — send-push-notification
//
// Envoie une notification push à 1 ou plusieurs users via Expo Push API.
//
// Body :
//   {
//     user_ids: string[],   // UUIDs des destinataires (max 100)
//     title: string,        // titre de la notif (max 100 chars)
//     body: string,         // contenu (max 200 chars)
//     data?: {              // payload custom (route, ids, etc.)
//       url?: string,       // deep link niqo://...
//       conversation_id?: string,
//       annonce_id?: string,
//       [key: string]: unknown
//     }
//   }
//
// Le caller doit avoir le service_role JWT (sinon 403). Cette fonction
// est appelée par :
//   - Triggers DB via pg_net (mig 65, Phase 2)
//   - Server Actions admin web (validation KYC, etc.)
//   - Manuel via curl pour debug
//
// Pas de signature webhook ici (caller interne authentifié via service_role).
//
// Expo Push API doc : https://docs.expo.dev/push-notifications/sending-notifications/
//
// Déploiement :
//   supabase functions deploy send-push-notification

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Secret partagé Niqo (custom, indépendant de l'auth Supabase).
 *
 * Le gateway Supabase réécrit les headers Authorization quand on passe par
 * pg_net → Edge Function (ajoute des claims, signe avec ses propres clés).
 * Donc impossible de matcher SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEYS
 * côté caller (pg_net).
 *
 * Solution : utiliser un secret custom `NIQO_INTERNAL_KEY` (32 bytes hex)
 * stocké à 2 endroits :
 *   - Edge Function Secrets (Dashboard → Edge Functions → Secrets)
 *   - Vault Postgres (sous le nom 'service_role_key')
 *
 * pg_net envoie ce secret en header → l'EF le compare au sien. Match exact.
 *
 * Rotation : update les 2 endroits ensemble.
 */
function getAcceptedAdminKeys(): string[] {
  const keys: string[] = [];
  const internalKey = Deno.env.get("NIQO_INTERNAL_KEY");
  if (internalKey) keys.push(internalKey);
  return keys;
}

// Optionnel : Expo Access Token pour les pushs (rate-limit plus élevé).
// Sans ce token, on est limité à ~100 push/sec côté gratuit Expo.
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN");

interface SendPushRequest {
  user_ids: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: "default";
  priority: "high";
  channelId?: string; // Android channel
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Auth : NIQO_INTERNAL_KEY (cf getAcceptedAdminKeys) ─────────────────
  // Compare en temps constant pour éviter les timing attacks sur le secret
  // partagé (un .includes() classique court-circuite au premier mismatch
  // de byte → l'attaquant peut deviner caractère par caractère).
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const accepted = getAcceptedAdminKeys();
  if (!token || accepted.length === 0 || !anyConstantTimeMatch(token, accepted)) {
    return new Response("Unauthorized", { status: 403 });
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: SendPushRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("INVALID_JSON", 400);
  }

  if (!body.user_ids || !Array.isArray(body.user_ids) || body.user_ids.length === 0) {
    return jsonError("MISSING_USER_IDS", 400);
  }
  if (body.user_ids.length > 100) {
    return jsonError("TOO_MANY_USER_IDS", 400);
  }
  if (!body.title || body.title.length > 100) {
    return jsonError("INVALID_TITLE", 400);
  }
  if (!body.body || body.body.length > 200) {
    return jsonError("INVALID_BODY", 400);
  }

  // ── Récupère les tokens actifs pour ces users ───────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: tokens, error: tokensError } = await adminClient.rpc(
    "get_push_tokens_for_users",
    { p_user_ids: body.user_ids }
  );

  if (tokensError) {
    console.error("[send-push] tokens fetch error", tokensError.code);
    captureException(tokensError, {
      tags: { step: "rpc-get-push-tokens" },
      extra: { user_ids_count: body.user_ids.length },
    }, "send-push-notification");
    logEvent(adminClient, "send-push", "push.db_error", "error", {
      step: "rpc-get-push-tokens",
      error_code: tokensError.code ?? null,
      user_ids_count: body.user_ids.length,
    });
    return jsonError("DB_ERROR", 500);
  }

  if (!tokens || tokens.length === 0) {
    console.log("[send-push] no tokens for users", body.user_ids.length);
    logEvent(adminClient, "send-push", "push.no_tokens", "info", {
      user_ids_count: body.user_ids.length,
    });
    return jsonOk({ sent: 0, total_users: body.user_ids.length });
  }

  // ── Construit les messages Expo ─────────────────────────────────────────
  type TokenRow = { token: string; platform: "ios" | "android" | "web" };
  const messages: ExpoPushMessage[] = (tokens as TokenRow[]).map((t) => ({
    to: t.token,
    title: body.title,
    body: body.body,
    data: body.data ?? {},
    sound: "default",
    priority: "high",
    // Android channel (default créé côté app via expo-notifications setNotificationChannel)
    channelId: t.platform === "android" ? "default" : undefined,
  }));

  // ── POST à Expo Push API ────────────────────────────────────────────────
  const expoHeaders: Record<string, string> = {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "content-type": "application/json",
  };
  if (EXPO_ACCESS_TOKEN) {
    expoHeaders.authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
  }

  let tickets: ExpoPushTicket[] = [];
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: expoHeaders,
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("[send-push] Expo API error", response.status, text.slice(0, 200));
      captureException(new Error(`Expo Push API ${response.status}`), {
        tags: { step: "expo-api", http_status: String(response.status) },
        extra: { body_excerpt: text.slice(0, 500), tokens_count: tokens.length },
      }, "send-push-notification");
      logEvent(adminClient, "send-push", "push.expo_api_error", "error", {
        http_status: response.status,
        tokens_count: tokens.length,
      });
      return jsonError("EXPO_API_ERROR", 502);
    }
    const json = await response.json();
    tickets = json.data ?? [];
  } catch (e) {
    console.error("[send-push] fetch threw", e);
    captureException(e, {
      tags: { step: "expo-api-fetch" },
      extra: { tokens_count: tokens.length },
    }, "send-push-notification");
    logEvent(adminClient, "send-push", "push.fetch_failed", "error", {
      tokens_count: tokens.length,
      message: (e as Error).message ?? "unknown",
    });
    return jsonError("EXPO_FETCH_FAILED", 502);
  }

  // ── Compte les tickets OK / KO + purge les tokens DeviceNotRegistered ──
  const okCount = tickets.filter((t) => t.status === "ok").length;
  const errorCount = tickets.filter((t) => t.status === "error").length;

  // Tokens à purger : Expo retourne `DeviceNotRegistered` quand un token
  // n'est plus valide (app désinstallée, opt-out notif, etc.).
  const deadTokens: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i];
    const msg = messages[i];
    if (t?.status === "error" && t.details?.error === "DeviceNotRegistered" && msg) {
      deadTokens.push(msg.to);
    }
  }
  if (deadTokens.length > 0) {
    console.log("[send-push] purging dead tokens", deadTokens.length);
    await adminClient.from("push_tokens").delete().in("token", deadTokens);
  }

  console.log("[send-push] sent", {
    title: body.title,
    user_ids_count: body.user_ids.length,
    tokens_count: tokens.length,
    ok: okCount,
    errors: errorCount,
    purged: deadTokens.length,
  });

  // Event log : happy path (avec errors potentielles partielles côté Expo).
  // Sentry capture déjà les erreurs techniques ; ici on alimente les compteurs
  // du dashboard /admin/observability (volume 24h, taux de succès, etc.).
  logEvent(adminClient, "send-push", "push.sent", errorCount > 0 ? "warning" : "info", {
    user_ids_count: body.user_ids.length,
    tokens_count: tokens.length,
    ok: okCount,
    errors: errorCount,
    purged: deadTokens.length,
  });

  return jsonOk({
    sent: okCount,
    errors: errorCount,
    total_tokens: tokens.length,
    total_users: body.user_ids.length,
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonOk(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, ...payload }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(code: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Comparaison constant-time entre deux strings (tokens / secrets).
 * Retourne false si les longueurs diffèrent (longueur OK à fuiter — c'est
 * la valeur qu'on protège). Pour le reste : XOR byte-à-byte sur la longueur
 * complète, sans court-circuit.
 */
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
  // On teste TOUS les candidats sans court-circuit : si on `return true` au
  // premier match, on fuite quel index a matché. Ici on évalue chacun et on
  // ORr le résultat.
  for (const candidate of accepted) {
    if (constantTimeEquals(token, candidate)) {
      matched = true;
    }
  }
  return matched;
}

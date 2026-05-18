// Helper Sentry partagé — Edge Functions Deno
//
// Envoie les events via l'API Sentry envelope (HTTP direct, pas de SDK).
// Implémentation custom volontairement minimale :
//   - Pas de dépendance `npm:@sentry/deno` (cold start plus rapide, contrôle
//     fin du payload, pas de surprise sur la compat Deno).
//   - 100% no-op si SENTRY_DSN absent OU NIQO_ENV !== "production".
//     → en dev local (`supabase functions serve`), aucune trace ne part.
//
// Activation prod (à faire 1 fois côté Supabase secrets) :
//   supabase secrets set SENTRY_DSN=https://xxx@oxxx.ingest.de.sentry.io/xxx
//   supabase secrets set NIQO_ENV=production
//
// Usage côté Edge Function :
//
//   import { captureException } from "../_shared/sentry.ts";
//
//   try {
//     // ...
//   } catch (e) {
//     captureException(e, { tags: { step: "expo-push-fetch" } }, "send-push");
//     return jsonError("EXPO_FETCH_FAILED", 502);
//   }
//
// `captureException` n'est pas await-é côté caller : on déclenche le POST en
// fire-and-forget pour ne pas bloquer la réponse HTTP de l'Edge Function sur
// un timeout réseau Sentry. Le `.catch(() => {})` interne avale les erreurs.

const SENTRY_DSN = Deno.env.get("SENTRY_DSN");
const NIQO_ENV = Deno.env.get("NIQO_ENV") ?? "development";
const NIQO_RELEASE = Deno.env.get("NIQO_RELEASE") ?? "edge@1.0.0";
const ENABLED = !!SENTRY_DSN && NIQO_ENV === "production";

interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
}

let parsedDsnCache: ParsedDsn | null | undefined;
function parseDsn(): ParsedDsn | null {
  if (parsedDsnCache !== undefined) return parsedDsnCache;
  if (!SENTRY_DSN) {
    parsedDsnCache = null;
    return null;
  }
  try {
    // Format: https://PUBLIC_KEY@oORG.ingest.sentry.io/PROJECT_ID
    const url = new URL(SENTRY_DSN);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) {
      parsedDsnCache = null;
      return null;
    }
    parsedDsnCache = {
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey,
    };
    return parsedDsnCache;
  } catch {
    parsedDsnCache = null;
    return null;
  }
}

export interface CaptureOptions {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string };
  level?: "fatal" | "error" | "warning" | "info" | "debug";
}

function eventId(): string {
  // event_id Sentry = 32 hex chars sans dashes
  return crypto.randomUUID().replace(/-/g, "");
}

function buildEnvelope(event: Record<string, unknown>): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

async function postEnvelope(envelope: string): Promise<void> {
  const dsn = parseDsn();
  if (!dsn) return;
  try {
    const response = await fetch(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7,sentry_key=${dsn.publicKey},sentry_client=niqo.edge/1.0.0`,
      },
      body: envelope,
    });
    if (!response.ok) {
      // On log mais on ne raise pas : un dashboard Sentry KO ne doit pas
      // pourrir l'Edge Function.
      console.error("[sentry] ingest non-2xx", response.status);
    }
  } catch (e) {
    console.error("[sentry] fetch threw", (e as Error).message);
  }
}

/**
 * Parse minimal d'une stacktrace V8/Deno en frames Sentry.
 * Sentry attend les frames du plus ancien au plus récent (reverse de V8).
 */
function parseStack(stack: string): {
  frames: Array<{ filename?: string; function?: string; lineno?: number; colno?: number }>;
} {
  const lines = stack.split("\n").slice(1);
  const frames = lines
    .map((line) => {
      const withFn = line.match(/^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
      if (withFn) {
        return {
          function: withFn[1],
          filename: withFn[2],
          lineno: parseInt(withFn[3]!, 10),
          colno: parseInt(withFn[4]!, 10),
        };
      }
      const noFn = line.match(/^\s*at\s+(.+?):(\d+):(\d+)/);
      if (noFn) {
        return {
          filename: noFn[1],
          lineno: parseInt(noFn[2]!, 10),
          colno: parseInt(noFn[3]!, 10),
        };
      }
      return null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .reverse();
  return { frames };
}

/**
 * Capture une exception et l'envoie à Sentry. No-op si désactivé.
 * Fire-and-forget : ne pas await côté caller (sauf si on veut s'assurer
 * que l'event part avant un cold-stop).
 *
 * @param module nom court de l'Edge Function (tag `module`)
 */
export function captureException(
  error: unknown,
  opts: CaptureOptions = {},
  module: string = "edge",
): Promise<void> {
  if (!ENABLED) return Promise.resolve();
  const errMessage = error instanceof Error ? error.message : String(error);
  const errType = error instanceof Error ? error.name : "Error";
  const stack = error instanceof Error ? error.stack : undefined;

  const event = {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: opts.level ?? "error",
    environment: NIQO_ENV,
    release: NIQO_RELEASE,
    server_name: module,
    sdk: { name: "niqo.edge", version: "1.0.0" },
    exception: {
      values: [
        {
          type: errType,
          value: errMessage,
          stacktrace: stack ? parseStack(stack) : undefined,
        },
      ],
    },
    tags: { module, ...opts.tags },
    extra: opts.extra,
    user: opts.user,
  };

  return postEnvelope(buildEnvelope(event)).catch(() => {});
}

/**
 * Envoie un message arbitraire à Sentry (pour les warnings métier qui ne
 * sont pas des exceptions techniques — ex: webhook PawaPay rejeté pour
 * status mismatch). No-op si désactivé.
 */
export function captureMessage(
  message: string,
  opts: CaptureOptions = {},
  module: string = "edge",
): Promise<void> {
  if (!ENABLED) return Promise.resolve();
  const event = {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: opts.level ?? "info",
    environment: NIQO_ENV,
    release: NIQO_RELEASE,
    server_name: module,
    sdk: { name: "niqo.edge", version: "1.0.0" },
    message: { formatted: message },
    tags: { module, ...opts.tags },
    extra: opts.extra,
    user: opts.user,
  };
  return postEnvelope(buildEnvelope(event)).catch(() => {});
}

export const Sentry = {
  enabled: ENABLED,
  captureException,
  captureMessage,
};

// Edge Function — purge-annonces-photos
//
// Supprime un batch de photos du bucket Supabase Storage `annonces-photos`.
// Invoquée par le cron pg_cron `purge-expired-annonces` (cf. migration 16)
// via l'extension pg_net : POST { paths: string[] }.
//
// Pourquoi une Edge Function plutôt que SQL pur (cf. décision produit #2,
// option B dans docs/annonces-todo.md) :
//   - storage.delete_object() n'est pas garanti dispo en Supabase managed
//   - Edge Function réutilisable pour autres cleanups (RGPD purge compte,
//     photos orphelines après échec createAnnonce, etc.)
//   - Logs Deno + retries gérés par la plateforme
//
// Auth : pas de JWT user — invoquée par le cron en interne avec un token
// d'authentification statique (Authorization header). On vérifie qu'il
// matche un secret côté env (PURGE_AUTH_TOKEN) pour empêcher toute
// invocation externe non autorisée. Pas besoin de service_role côté
// client : la fonction tourne avec le service_role déjà présent dans
// l'env Edge Function de Supabase.
//
// Déploiement :
//   supabase functions deploy purge-annonces-photos
//   supabase secrets set PURGE_AUTH_TOKEN=<random-32-chars>
//
// Test local :
//   supabase functions serve purge-annonces-photos --env-file ./supabase/.env
//   curl -X POST http://localhost:54321/functions/v1/purge-annonces-photos \
//     -H "Authorization: Bearer $PURGE_AUTH_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"paths":["userId/annonceId/123-abc.jpg"]}'

import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureException, captureMessage } from "../_shared/sentry.ts";
import { logEvent } from "../_shared/event_log.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PURGE_AUTH_TOKEN = Deno.env.get("PURGE_AUTH_TOKEN");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PURGE_AUTH_TOKEN) {
  // Fail-loud au boot — préférable à un 500 silencieux par requête.
  console.error(
    "[purge-annonces-photos] Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or PURGE_AUTH_TOKEN"
  );
  captureMessage(
    "Edge Function misconfigured: missing env at boot",
    {
      level: "fatal",
      tags: { step: "boot" },
      extra: {
        has_supabase_url: !!SUPABASE_URL,
        has_service_role_key: !!SERVICE_ROLE_KEY,
        has_purge_token: !!PURGE_AUTH_TOKEN,
      },
    },
    "purge-annonces-photos",
  );
}

const BUCKET = "annonces-photos";
const MAX_PATHS_PER_CALL = 100; // évite des batchs énormes qui timeout

interface PurgeRequest {
  paths: string[];
}

interface PurgeResponse {
  ok: boolean;
  deleted?: number;
  errors?: string[];
  reason?: string;
}

function jsonResponse(body: PurgeResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, reason: "method_not_allowed" }, 405);
  }

  // Auth gate : seul le cron (qui connaît le secret) peut appeler.
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${PURGE_AUTH_TOKEN}`;
  if (auth !== expected) {
    return jsonResponse({ ok: false, reason: "unauthorized" }, 401);
  }

  let body: PurgeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, reason: "invalid_json" }, 400);
  }

  const paths = body.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    return jsonResponse({ ok: false, reason: "paths_required" }, 400);
  }
  if (paths.some((p) => typeof p !== "string" || p.length === 0)) {
    return jsonResponse({ ok: false, reason: "paths_invalid" }, 400);
  }
  if (paths.length > MAX_PATHS_PER_CALL) {
    return jsonResponse(
      { ok: false, reason: `paths_too_many (max ${MAX_PATHS_PER_CALL})` },
      400
    );
  }

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    console.error("[purge-annonces-photos] remove failed:", error.message);
    captureException(error, {
      tags: { step: "storage-remove" },
      extra: { paths_count: paths.length },
    }, "purge-annonces-photos");
    logEvent(supabase, "purge-annonces-photos", "purge.error", "error", {
      paths_count: paths.length,
      message: error.message,
    });
    return jsonResponse({ ok: false, reason: error.message }, 500);
  }

  // Supabase Storage remove() retourne data = liste des fichiers effectivement
  // supprimés. Les paths inexistants ne sont PAS dans data mais ne provoquent
  // pas d'erreur (best-effort par design — c'est ce qu'on veut pour la purge).
  const deleted = data?.length ?? 0;
  if (deleted < paths.length) {
    console.warn(
      `[purge-annonces-photos] requested=${paths.length} deleted=${deleted} — some paths were already missing`
    );
  }

  // Event log : succès. Le dashboard pourra suivre le volume de purge
  // quotidienne (cron purge-expired-annonces) et détecter une dérive
  // (ex: pas de purge = cron cassé, volume x10 = annonces qui expirent en masse).
  logEvent(supabase, "purge-annonces-photos", "purge.completed", "info", {
    requested: paths.length,
    deleted,
    skipped: paths.length - deleted,
  });

  return jsonResponse({ ok: true, deleted }, 200);
});

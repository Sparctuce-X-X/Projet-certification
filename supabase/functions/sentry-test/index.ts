// Edge Function — sentry-test (TEMPORAIRE, à supprimer après validation)
//
// Test endpoint pour valider que le pipeline Sentry → ingest fonctionne :
//   - GET ?type=exception → capture un Error()
//   - GET ?type=message   → capture un message info
//   - GET ?type=config    → renvoie l'état d'activation (sans révéler le DSN)
//
// Aucune auth (test endpoint). Doit être supprimé après validation :
//   rm -rf supabase/functions/sentry-test
//   supabase functions delete sentry-test

import { captureException, captureMessage, Sentry } from "../_shared/sentry.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "exception";

  if (type === "config") {
    return new Response(
      JSON.stringify({
        sentry_enabled: Sentry.enabled,
        niqo_env: Deno.env.get("NIQO_ENV") ?? null,
        has_dsn: !!Deno.env.get("SENTRY_DSN"),
      }),
      { headers: { "content-type": "application/json" } },
    );
  }

  if (type === "message") {
    await captureMessage(
      "Sentry test message from Edge Function",
      { level: "info", tags: { trigger: "manual-test" } },
      "sentry-test",
    );
    return new Response(JSON.stringify({ ok: true, sent: "message" }), {
      headers: { "content-type": "application/json" },
    });
  }

  // type === "exception" (default)
  const err = new Error(`Sentry test exception at ${new Date().toISOString()}`);
  await captureException(
    err,
    { tags: { trigger: "manual-test" }, extra: { source: "sentry-test endpoint" } },
    "sentry-test",
  );
  return new Response(JSON.stringify({ ok: true, sent: "exception", message: err.message }), {
    headers: { "content-type": "application/json" },
  });
});

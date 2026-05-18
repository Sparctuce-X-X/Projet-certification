// Next.js 16 server-side instrumentation hook.
// Charge la config Sentry adaptée au runtime (Node ou Edge) au démarrage du
// serveur. Cf node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
//
// onRequestError = capture toute erreur thrown depuis un Server Component,
// Route Handler ou Server Action — c'est l'API stable Next.js 15+ que Sentry
// branche directement.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;

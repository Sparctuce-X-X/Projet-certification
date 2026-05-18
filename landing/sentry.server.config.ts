// Sentry server-side init (runtime Node.js — RSC, Server Actions, Route Handlers).
// Importé par instrumentation.ts quand NEXT_RUNTIME === "nodejs".
//
// No-op si NEXT_PUBLIC_SENTRY_DSN absent OU NODE_ENV !== "production".

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENABLED = !!DSN && process.env.NODE_ENV === "production";

if (ENABLED) {
  Sentry.init({
    dsn: DSN,
    environment: "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Désactive les span auto-instrumentés (HTTP, fs, etc.) — on n'a pas
    // d'APM activé donc ce serait du bruit pour rien.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "Http" && i.name !== "NodeFetch"),
  });
}

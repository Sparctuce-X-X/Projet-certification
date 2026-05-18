// Sentry edge-runtime init (Vercel Edge Functions, middleware Next.js).
// Importé par instrumentation.ts quand NEXT_RUNTIME === "edge".
//
// Note : le middleware admin (`landing/src/middleware.ts`) tourne ici.
// Si une auth Supabase échoue, l'erreur sera capturée via onRequestError.

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENABLED = !!DSN && process.env.NODE_ENV === "production";

if (ENABLED) {
  Sentry.init({
    dsn: DSN,
    environment: "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

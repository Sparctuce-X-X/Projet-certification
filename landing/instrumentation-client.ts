// Next.js 16 client-side instrumentation. S'exécute après le chargement
// du HTML, AVANT l'hydration React. Idéal pour brancher Sentry browser.
//
// No-op si NEXT_PUBLIC_SENTRY_DSN absent OU NODE_ENV !== "production".
// → en `npm run dev`, aucune trace ne part vers Sentry.

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENABLED = !!DSN && process.env.NODE_ENV === "production";

if (ENABLED) {
  Sentry.init({
    dsn: DSN,
    environment: "production",
    // Erreurs uniquement — pas de transactions APM en MVP (cf CLAUDE.md
    // « Erreurs only » choix produit Niqo).
    tracesSampleRate: 0,
    // Pas de PII auto-capturé (RGPD-friendly par défaut).
    sendDefaultPii: false,
    // L'admin web est privé (no-index, behind auth) → pas besoin de masquer
    // davantage. Si on étend Sentry à des pages publiques, revoir cette config.
  });
}

// Bind les transitions du router pour avoir des breadcrumbs de navigation
// dans les events. No-op si Sentry désactivé.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

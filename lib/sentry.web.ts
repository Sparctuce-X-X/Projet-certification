// Sentry — Stub web.
//
// Niqo mobile cible iOS + Android (cf CLAUDE.md « Build & deploy : EAS Build,
// Google Play + Apple App Store »). Le web bundle Metro n'est pas une cible
// produit — il sert seulement à `npm start` / `w` pour debug rapide.
//
// Problème : @sentry/core 10.x exporte `./transports/offline.js` via un mapping
// `package.json#exports` qui Metro web ne résout pas correctement → bundling
// fail. Sentry RN ne supporte officiellement que iOS/Android.
//
// Solution : ce fichier est résolu en priorité par Metro quand `Platform.OS
// === "web"` (convention `*.web.ts`). Le vrai `lib/sentry.ts` est résolu pour
// iOS/Android. Aucune logique Sentry réelle ne tourne côté web — la version
// web publique de Niqo c'est `landing/` (Next.js, qui a son propre Sentry).

const noop = () => {};

export const Sentry = {
  init: noop,
  // wrap retourne le composant inchangé — pas d'ErrorBoundary en web.
  wrap: <T>(component: T): T => component,
  captureException: noop,
  captureMessage: noop,
  setUser: noop,
  setTag: noop,
  setExtra: noop,
};

export const SentryEnabled = false;

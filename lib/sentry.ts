// Sentry — Mobile (Expo SDK 54 / RN 0.81 / New Arch)
//
// ⚠ DÉSACTIVÉ TEMPORAIREMENT — le plugin `@sentry/react-native/expo` a été
// retiré de app.json pour débloquer les builds EAS production (manque le
// SENTRY_AUTH_TOKEN qu'on ajoutera après).
//
// Ce fichier expose un mock no-op compatible API pour que les `Sentry.wrap()`,
// `Sentry.captureException()`, etc. continuent à compiler sans crasher.
//
// Pour réactiver Sentry mobile :
//   1. Génère un SENTRY_AUTH_TOKEN sur sentry.io → Settings → Auth Tokens
//   2. `eas env:create --environment production --name SENTRY_AUTH_TOKEN --value <tok> --visibility sensitive`
//   3. `eas env:create --environment preview --name SENTRY_AUTH_TOKEN --value <tok> --visibility sensitive`
//   4. Remets dans app.json plugins :
//      ["@sentry/react-native/expo", { "url": "https://sentry.io/", "organization": "niqo", "project": "niqo-mobile" }]
//   5. Restaure le contenu réel de ce fichier depuis le git history.

type SentryWrap = <C>(component: C) => C;

const noop = () => {};
const identityWrap: SentryWrap = (component) => component;

export const Sentry = {
  init: noop,
  wrap: identityWrap,
  captureException: noop,
  captureMessage: noop,
  setUser: noop,
  setTag: noop,
  setExtra: noop,
  addBreadcrumb: noop,
  startSpan: <T,>(_opts: unknown, callback: () => T): T => callback(),
};

export const SentryEnabled = false;

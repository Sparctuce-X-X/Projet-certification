// Drop-in replacement de `expo/metro-config` par le wrapper Sentry.
// Nécessaire à cause de @sentry/core 10.x qui utilise des sous-chemins
// (`./transports/offline.js`, etc.) que Metro ne résout pas avec la config
// Expo par défaut. Le wrapper Sentry ajoute aussi le middleware Debug IDs
// (symbolisation des stacks via source maps uploadées par EAS Build).
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");

const config = getSentryExpoConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });

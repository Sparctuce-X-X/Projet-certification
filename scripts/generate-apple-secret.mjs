#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Génère le JWT "client secret" pour Sign in with Apple, à coller dans
// Supabase → Authentication → Providers → Apple → Secret Key (for OAuth).
//
// Apple impose une expiration max de 6 mois. À relancer tous les ~5 mois
// pour ne pas casser l'auth en prod (set un reminder calendrier).
//
// Usage :
//   APPLE_TEAM_ID=XXXXXXXXXX \
//   APPLE_KEY_ID=XXXXXXXXXX \
//   APPLE_SERVICE_ID=com.niqo.africa.signin \
//   APPLE_P8_PATH=./docs/AuthKey_XXX.p8 \
//     node scripts/generate-apple-secret.mjs
//
// Sortie : le JWT sur stdout, à copier-coller. Ne rien committer.
//
// Référence : https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { createPrivateKey, createSign } from "node:crypto";

const TEAM_ID = process.env.APPLE_TEAM_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const SERVICE_ID = process.env.APPLE_SERVICE_ID;
const P8_PATH = process.env.APPLE_P8_PATH;

if (!TEAM_ID || !KEY_ID || !SERVICE_ID || !P8_PATH) {
  console.error(
    "Missing env vars. Required: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_SERVICE_ID, APPLE_P8_PATH"
  );
  process.exit(1);
}

const b64url = (data) =>
  Buffer.from(typeof data === "string" ? data : JSON.stringify(data)).toString(
    "base64url"
  );

const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 60 * 60 * 24 * 180; // 180 days, max accepté Apple

const header = { alg: "ES256", kid: KEY_ID };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + SIX_MONTHS,
  aud: "https://appleid.apple.com",
  sub: SERVICE_ID,
};

const headerB64 = b64url(header);
const payloadB64 = b64url(payload);
const signingInput = `${headerB64}.${payloadB64}`;

const privateKey = createPrivateKey(readFileSync(P8_PATH, "utf8"));
const sign = createSign("SHA256");
sign.update(signingInput);
sign.end();

// 'ieee-p1363' = raw R||S (64 bytes pour P-256), exactement ce que JWT ES256
// attend. Sans cette option, Node retourne du DER → JWT invalide.
const sigRaw = sign.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
const sigB64 = sigRaw.toString("base64url");

const jwt = `${signingInput}.${sigB64}`;

// Le JWT sur stdout (pour piping/redirect facile), les méta sur stderr.
console.log(jwt);
console.error(
  `\n✓ JWT généré, valide jusqu'au ${new Date((now + SIX_MONTHS) * 1000).toISOString()}`
);
console.error(`  À régénérer ~5 mois max après la date d'émission (Apple cap = 6 mois).`);

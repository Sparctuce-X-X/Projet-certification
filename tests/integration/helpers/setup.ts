import { config } from "dotenv";
import { resolve } from "node:path";

// Charge .env.test (si présent) depuis le dossier tests/integration/
config({ path: resolve(__dirname, "../.env.test") });

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(
      `Missing env var ${key}. Copy tests/integration/.env.test.example to .env.test and fill it (defaults work for 'supabase start' local).`
    );
  }
}

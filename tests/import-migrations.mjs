#!/usr/bin/env node
/**
 * Convertit les migrations `docs/migrations/NN_feature.sql` au format
 * `supabase/migrations/YYYYMMDDHHmmss_feature.sql` attendu par Supabase CLI.
 *
 * Le mapping NN → timestamp est déterministe : on prend une base
 * `2024-01-01 00:00:00 UTC` et on ajoute NN minutes. Garantit l'ordre
 * et la stabilité (replay déterministe).
 *
 * Usage : node tests/import-migrations.mjs
 *         (idempotent — re-écrit les fichiers à chaque run)
 */

import { readdir, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "docs/migrations");
const TARGET = resolve(ROOT, "supabase/migrations");

const BASE_TIMESTAMP = new Date("2024-01-01T00:00:00Z");

function timestampForNumber(n) {
  const d = new Date(BASE_TIMESTAMP.getTime() + n * 60_000); // +N minutes
  const pad = (x) => String(x).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

async function main() {
  // Reset target folder
  await rm(TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });

  const entries = await readdir(SOURCE, { withFileTypes: true });
  const migrations = entries
    .filter((e) => e.isFile() && /^\d+_.+\.sql$/.test(e.name))
    .map((e) => {
      const match = e.name.match(/^(\d+)_(.+)\.sql$/);
      return { name: e.name, number: parseInt(match[1], 10), slug: match[2] };
    })
    .sort((a, b) => a.number - b.number);

  console.log(`Found ${migrations.length} migrations in ${SOURCE}`);

  for (const m of migrations) {
    const ts = timestampForNumber(m.number);
    const targetName = `${ts}_${m.slug}.sql`;
    await copyFile(resolve(SOURCE, m.name), resolve(TARGET, targetName));
    console.log(`  ${m.name} → ${targetName}`);
  }

  console.log(`✓ Imported ${migrations.length} migrations to ${TARGET}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

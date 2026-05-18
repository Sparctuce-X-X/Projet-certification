#!/usr/bin/env node
// Synchronise les markdowns légaux canoniques (../docs/legal/*.md) vers
// la copie locale embarquée dans le bundle Next (src/legal-content/*.md).
//
// Pourquoi cette copie ? Vercel déploie `landing/` comme rootDirectory ;
// le dossier `docs/` à la racine du monorepo est donc hors du build
// context. Le sync garantit que la version déployée est toujours alignée
// sur la source canonique versionnée à côté du CHANGELOG légal.
//
// Exécuté automatiquement avant `npm run dev` et `npm run build` via les
// hooks `predev` et `prebuild` du package.json.
//
// Si la copie est manquante (rare — typiquement sur Vercel sans accès au
// dossier `../docs/`), le script ne fait rien et laisse les fichiers déjà
// commités en place.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LANDING_DIR = path.resolve(SCRIPT_DIR, "..");
const SRC_LEGAL = path.join(LANDING_DIR, "..", "docs", "legal");
const DEST_LEGAL = path.join(LANDING_DIR, "src", "legal-content");

if (!fs.existsSync(SRC_LEGAL)) {
  // Sur Vercel avec rootDirectory=landing/, la source canonique n'est pas
  // dans le build context. La copie commitée (src/legal-content/) suffit.
  console.log("[sync-legal] source absente (build deploy), skip.");
  process.exit(0);
}

if (!fs.existsSync(DEST_LEGAL)) {
  fs.mkdirSync(DEST_LEGAL, { recursive: true });
}

const files = fs
  .readdirSync(SRC_LEGAL)
  .filter((f) => f.endsWith(".md"));

let copied = 0;
let unchanged = 0;
for (const file of files) {
  const src = path.join(SRC_LEGAL, file);
  const dest = path.join(DEST_LEGAL, file);
  const srcContent = fs.readFileSync(src, "utf8");
  const destContent = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
  if (srcContent !== destContent) {
    fs.writeFileSync(dest, srcContent);
    copied += 1;
  } else {
    unchanged += 1;
  }
}

console.log(
  `[sync-legal] ${copied} mis à jour, ${unchanged} inchangés (total ${files.length}).`,
);

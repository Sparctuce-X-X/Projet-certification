#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Upload des 5 photos demo ASO vers Supabase Storage bucket annonces-photos/aso-demo/
#
# Source : Unsplash (5 photos thématiques pré-sélectionnées).
# Cible : bucket `annonces-photos`, folder `aso-demo/`, fichiers attendus
#   par seed-aso-screenshots.sql.
#
# ── USAGE ──────────────────────────────────────────────────────────────────
#
#   bash scripts/upload-aso-photos.sh
#
# Le script auto-lit SUPABASE_URL depuis .env.local et prompt interactivement
# pour la SERVICE_ROLE_KEY (saisie masquée, pas dans le shell history).
#
# Où récupérer la SERVICE_ROLE_KEY :
#   Supabase Dashboard → Settings → API → Project API keys → service_role (Reveal)
#
# ⚠ La SERVICE_ROLE_KEY bypass RLS. Le script ne la persiste nulle part —
#   elle disparaît à la fin du process.
#
# Idempotent — `x-upsert: true` overwrite si fichier déjà présent.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── 1. SUPABASE_URL : env var > .env.local > erreur ───────────────────────
if [[ -z "${SUPABASE_URL:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="${SCRIPT_DIR}/../.env.local"

  if [[ -f "$ENV_FILE" ]]; then
    # Match EXPO_PUBLIC_SUPABASE_URL=... ou SUPABASE_URL=...
    # Strip quotes, comments, espaces.
    SUPABASE_URL=$(grep -E '^(EXPO_PUBLIC_)?SUPABASE_URL=' "$ENV_FILE" \
                   | head -1 \
                   | sed -E 's/^[^=]+=//' \
                   | sed -E 's/[[:space:]]*#.*$//' \
                   | tr -d '"' | tr -d "'" | tr -d '[:space:]')
  fi

  if [[ -z "${SUPABASE_URL:-}" ]]; then
    cat >&2 <<'EOF'
ERROR: SUPABASE_URL introuvable.

  Cherché dans :
    1. Variable d'environnement SUPABASE_URL
    2. .env.local (clé EXPO_PUBLIC_SUPABASE_URL ou SUPABASE_URL)

  Soit set la var en env :
    export SUPABASE_URL="https://<project-ref>.supabase.co"

  Soit vérifie que .env.local contient :
    EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EOF
    exit 1
  fi

  echo "→ SUPABASE_URL lu depuis .env.local"
fi

# ── 2. SUPABASE_SERVICE_ROLE_KEY : env var > prompt interactif ────────────
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo ""
  echo "SERVICE_ROLE_KEY non set en env (normal — ne JAMAIS la mettre dans .env.local)."
  echo "Récupère-la dans Supabase Dashboard → Settings → API → service_role (Reveal)."
  echo ""
  # -s : pas d'echo (saisie masquée), -p : prompt
  read -r -s -p "Colle la SERVICE_ROLE_KEY ici (puis Entrée) : " SUPABASE_SERVICE_ROLE_KEY
  echo ""

  if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
    echo "ERROR: clé vide. Annulation." >&2
    exit 1
  fi
fi

# ── 3. Config ──────────────────────────────────────────────────────────────
BUCKET="annonces-photos"
FOLDER="aso-demo"

# 5 photos Unsplash thématiques (?w=1080&q=80 pour qualité ASO sans alourdir).
# Si l'une 404 (les IDs Unsplash sont normalement stables), remplace par une
# autre URL format https://images.unsplash.com/photo-XXXXX?w=1080&q=80
PHOTOS=(
  "iphone14.jpg|https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=1080&q=80"
  "perfume.jpg|https://images.unsplash.com/photo-1541643600914-78b084683601?w=1080&q=80"
  "jacket.jpg|https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1080&q=80"
  "fridge.jpg|https://images.unsplash.com/photo-1571175443880-49e1d25b2bc5?w=1080&q=80"
  "car.jpg|https://images.unsplash.com/photo-1559416523-140ddc3d238c?w=1080&q=80"
)

TMPDIR=$(mktemp -d -t niqo-aso-photos.XXXXXX)
trap "rm -rf '$TMPDIR'" EXIT

# ── 4. Download depuis Unsplash ────────────────────────────────────────────
echo ""
echo "→ Download 5 photos vers $TMPDIR"
for entry in "${PHOTOS[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  printf "   %-15s ← unsplash\n" "$name"
  if ! curl -fsSL -o "$TMPDIR/$name" "$url"; then
    echo "" >&2
    echo "ERROR: Download échec sur $name ($url)" >&2
    echo "  Remplace l'URL dans le script par une autre Unsplash" >&2
    echo "  (format : https://images.unsplash.com/photo-XXXX?w=1080&q=80)" >&2
    exit 1
  fi
done

# ── 5. Upload vers Supabase Storage ────────────────────────────────────────
echo ""
echo "→ Upload vers ${SUPABASE_URL}/storage/v1/object/${BUCKET}/${FOLDER}/"
for entry in "${PHOTOS[@]}"; do
  name="${entry%%|*}"
  upload_url="${SUPABASE_URL}/storage/v1/object/${BUCKET}/${FOLDER}/${name}"

  http_code=$(curl -sS -X POST "$upload_url" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: image/jpeg" \
    -H "x-upsert: true" \
    --data-binary "@${TMPDIR}/${name}" \
    -o /dev/null -w "%{http_code}" \
    || echo "ERR")

  if [[ "$http_code" == "200" ]] || [[ "$http_code" == "201" ]]; then
    printf "   ✓ %s (HTTP %s)\n" "${FOLDER}/${name}" "$http_code"
  else
    printf "   ✗ %s (HTTP %s)\n" "${FOLDER}/${name}" "$http_code" >&2
    echo "" >&2
    echo "ERROR: Upload échec. Vérifie que la SERVICE_ROLE_KEY est correcte" >&2
    echo "  (commence par 'eyJ...' et fait ~200 chars, distincte de l'ANON_KEY)." >&2
    exit 1
  fi
done

echo ""
echo "✓ Upload terminé. 5 photos disponibles à :"
echo "  ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${FOLDER}/<file>.jpg"
echo ""
echo "Prochaine étape : lance scripts/sql/seed-aso-screenshots.sql dans"
echo "Supabase Dashboard → SQL Editor."

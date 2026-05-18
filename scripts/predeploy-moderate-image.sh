#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Pre-deploy live test pour l'Edge Function moderate-image.
#
# Mirror exact de scripts/predeploy-moderate-text.sh. La CI GitHub Actions
# ne sert pas les Edge Functions, donc moderation-image.test.ts est skippée
# en CI. Ce script comble le gap : il tourne juste avant chaque
# `supabase functions deploy moderate-image` pour valider l'EF en live
# contre AWS Rekognition avant de la pousser en prod.
#
# FLOW
#   1. Vérifie que supabase/.env contient AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
#   2. Vérifie que `supabase start` tourne (DB locale up)
#   3. Démarre `supabase functions serve moderate-image` en background
#   4. Attend que l'EF réponde (curl probe, max 30s)
#   5. Lance Vitest avec MODERATE_IMAGE_SERVED=true + AWS_AVAILABLE=true
#   6. Si tests verts → confirme + deploy
#   7. Si tests rouges → abort sans deploy
#   8. Cleanup background process (trap EXIT)
#
# USAGE
#   ./scripts/predeploy-moderate-image.sh
#   ou
#   npm run deploy:moderate-image
#
# OPTIONS D'ENV
#   D1_NSFW_IMAGE_URL=https://...  Active le test D1 contre une vraie image
#                                  NSFW (fixture user-provided, non commit).
#                                  Si non set → D1 skip auto.
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

EF_LOG="/tmp/moderate-image-predeploy.log"
EF_URL="http://127.0.0.1:54321/functions/v1/moderate-image"
EF_PID=""

# ── Cleanup hook (toujours) ────────────────────────────────────────────

cleanup() {
  if [ -n "$EF_PID" ] && kill -0 "$EF_PID" 2>/dev/null; then
    echo "→ stopping background EF (pid=$EF_PID)..."
    kill "$EF_PID" 2>/dev/null || true
    wait "$EF_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ── 1. Vérifs préalables ──────────────────────────────────────────────

echo "──── Pre-deploy moderate-image ────"

if [ ! -f "supabase/.env" ]; then
  echo "❌ supabase/.env manquant. Crée le fichier avec AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY"
  exit 1
fi

if ! grep -q "^AWS_ACCESS_KEY_ID=" supabase/.env; then
  echo "❌ AWS_ACCESS_KEY_ID absent de supabase/.env"
  exit 1
fi

if ! grep -q "^AWS_SECRET_ACCESS_KEY=" supabase/.env; then
  echo "❌ AWS_SECRET_ACCESS_KEY absent de supabase/.env"
  exit 1
fi

# NB : buffer la sortie avant grep — `set -o pipefail` + `grep -q` ferme le
# pipe dès le 1er match, causant SIGPIPE 141 sur `supabase status` qui écrit
# encore. Découpler les deux étapes évite le faux négatif.
SUPABASE_STATUS=$(supabase status 2>/dev/null || true)
if ! echo "$SUPABASE_STATUS" | grep -qE "(API URL|Project URL)"; then
  echo "❌ supabase start n'a pas l'air de tourner. Lance d'abord :"
  echo "   supabase start"
  exit 1
fi

echo "✅ Pré-requis OK"

# ── 2. Démarre l'EF en background ─────────────────────────────────────

echo "→ starting supabase functions serve moderate-image..."
supabase functions serve moderate-image \
  --env-file ./supabase/.env \
  > "$EF_LOG" 2>&1 &
EF_PID=$!

# ── 3. Attend que l'EF réponde ────────────────────────────────────────

echo "→ waiting for EF to be ready (max 30s)..."
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$EF_URL" \
    -H "Content-Type: application/json" \
    -d '{}' || echo "000")
  # EF répond → 401 (no auth) ou 400 (validation) selon le gateway/body
  if [ "$STATUS" = "401" ] || [ "$STATUS" = "400" ]; then
    echo "✅ EF ready (took ~${i}s, http $STATUS)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "❌ EF didn't boot in 30s. Last status: $STATUS"
    echo "── Logs background ──"
    cat "$EF_LOG"
    exit 1
  fi
  sleep 1
done

# ── 4. Lance les tests Vitest ─────────────────────────────────────────

echo ""
echo "──── Running moderation-image integration tests (live) ────"
echo ""

set +e
(
  cd tests/integration && \
  MODERATE_IMAGE_SERVED=true AWS_AVAILABLE=true npm test moderation-image
)
TEST_EXIT=$?
set -e

if [ "$TEST_EXIT" -ne 0 ]; then
  echo ""
  echo "❌ Tests failed (exit $TEST_EXIT) — deploy aborted."
  echo "   Fix les tests avant de redéployer."
  exit "$TEST_EXIT"
fi

echo ""
echo "✅ All moderation-image tests passed against live EF + AWS Rekognition"
echo ""

# ── 5. Cleanup local EF avant deploy ──────────────────────────────────

cleanup
EF_PID=""

# ── 6. Confirmation + deploy ──────────────────────────────────────────

echo "──── Ready to deploy ────"
echo "Will run: supabase functions deploy moderate-image"
echo ""
read -r -p "Proceed with deploy ? (y/N) " ANSWER
if [ "$ANSWER" != "y" ] && [ "$ANSWER" != "Y" ]; then
  echo "→ Aborted by user. EF NOT deployed."
  exit 0
fi

echo "→ deploying moderate-image..."
supabase functions deploy moderate-image

echo ""
echo "✅ moderate-image deployed successfully"
echo ""
echo "Verify :"
echo "  supabase functions list | grep moderate-image"
echo ""
echo "Smoke test prod (remplace <PROJECT_REF> + <USER_JWT> + <BASE64>) :"
echo "  curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/moderate-image \\"
echo "    -H 'Authorization: Bearer <USER_JWT>' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"photo_base64\":\"<BASE64>\",\"surface\":\"annonce.create\"}'"

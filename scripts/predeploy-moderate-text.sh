#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Pre-deploy live test pour l'Edge Function moderate-text.
#
# La CI GitHub Actions ne sert pas les Edge Functions (pas de docker setup
# pour `supabase functions serve`), donc la suite moderation.test.ts est
# skippée en CI. Ce script comble le gap : il tourne juste avant chaque
# `supabase functions deploy moderate-text` pour valider l'EF en live
# contre une vraie clé OpenAI avant de la pousser en prod.
#
# FLOW
#   1. Vérifie que supabase/.env contient OPENAI_API_KEY
#   2. Vérifie que `supabase start` tourne (DB locale up)
#   3. Démarre `supabase functions serve moderate-text` en background
#   4. Attend que l'EF réponde (curl probe, max 30s)
#   5. Lance les tests Vitest avec MODERATE_TEXT_SERVED=true + OPENAI_AVAILABLE=true
#   6. Si tests verts → confirme + deploy
#   7. Si tests rouges → abort sans deploy
#   8. Cleanup background process (trap EXIT)
#
# USAGE
#   ./scripts/predeploy-moderate-text.sh
#   ou
#   npm run deploy:moderate-text
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

EF_LOG="/tmp/moderate-text-predeploy.log"
EF_URL="http://127.0.0.1:54321/functions/v1/moderate-text"
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

echo "──── Pre-deploy moderate-text ────"

if [ ! -f "supabase/.env" ]; then
  echo "❌ supabase/.env manquant. Crée le fichier avec OPENAI_API_KEY=sk-..."
  exit 1
fi

if ! grep -q "^OPENAI_API_KEY=" supabase/.env; then
  echo "❌ OPENAI_API_KEY absent de supabase/.env"
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

echo "→ starting supabase functions serve moderate-text..."
supabase functions serve moderate-text \
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
echo "──── Running moderation integration tests (live) ────"
echo ""

set +e
(
  cd tests/integration && \
  MODERATE_TEXT_SERVED=true OPENAI_AVAILABLE=true npm test moderation
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
echo "✅ All moderation tests passed against live EF + OpenAI"
echo ""

# ── 5. Cleanup local EF avant deploy ──────────────────────────────────

cleanup
EF_PID=""

# ── 6. Confirmation + deploy ──────────────────────────────────────────

echo "──── Ready to deploy ────"
echo "Will run: supabase functions deploy moderate-text"
echo ""
read -r -p "Proceed with deploy ? (y/N) " ANSWER
if [ "$ANSWER" != "y" ] && [ "$ANSWER" != "Y" ]; then
  echo "→ Aborted by user. EF NOT deployed."
  exit 0
fi

echo "→ deploying moderate-text..."
supabase functions deploy moderate-text

echo ""
echo "✅ moderate-text deployed successfully"
echo ""
echo "Verify :"
echo "  supabase functions list | grep moderate-text"
echo ""
echo "Smoke test prod (remplace <PROJECT_REF> + <USER_JWT>) :"
echo "  curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/moderate-text \\"
echo "    -H 'Authorization: Bearer <USER_JWT>' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"texte\":\"iPhone neuf\",\"surface\":\"annonce.create\"}'"

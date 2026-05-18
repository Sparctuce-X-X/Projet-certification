#!/usr/bin/env bash
# Patches the ngrok binary bundled by @expo/ngrok-bin (v2.3.41, rejected by ngrok cloud
# with ERR_NGROK_121) by symlinking to a system-installed ngrok v3 binary.
#
# Triggered by `npm install` via the postinstall hook.
# Safe to run multiple times; no-op if a system ngrok isn't found.

set -euo pipefail

# Find a REAL ngrok binary, not the npm shim at node_modules/.bin/ngrok
# (npm puts node_modules/.bin first in PATH during postinstall, which would
# cause command -v ngrok to return the shim — that shim then resolves back
# to our patched symlink, creating an infinite loop).
SYSTEM_NGROK=""
for candidate in /opt/homebrew/bin/ngrok /usr/local/bin/ngrok /usr/bin/ngrok; do
  if [[ -x "$candidate" && ! -L "$candidate" ]] || \
     [[ -L "$candidate" && "$(readlink "$candidate")" != *"node_modules"* ]]; then
    SYSTEM_NGROK="$candidate"
    break
  fi
done
# Fallback to PATH lookup, but reject anything inside node_modules
if [[ -z "$SYSTEM_NGROK" ]]; then
  found="$(command -v ngrok || true)"
  if [[ -n "$found" && "$found" != *"node_modules"* ]]; then
    SYSTEM_NGROK="$found"
  fi
fi
if [[ -z "$SYSTEM_NGROK" ]]; then
  echo "[patch-expo-ngrok] No system ngrok v3 found. Install with: brew install ngrok" >&2
  exit 0
fi

PLATFORM="$(node -e 'process.stdout.write(process.platform + "-" + process.arch)')"
PATCHED=0

# npm sometimes installs @expo/ngrok-bin-<platform> in multiple locations
# (top-level node_modules AND nested under @expo/ngrok-bin/node_modules).
# We need to patch every copy or Expo will pick the unpatched v2 binary.
while IFS= read -r target_dir; do
  target="${target_dir}/ngrok"
  if [[ -L "$target" && "$(readlink "$target")" == "$SYSTEM_NGROK" ]]; then
    continue
  fi
  ln -sf "$SYSTEM_NGROK" "$target"
  echo "[patch-expo-ngrok] Linked $target -> $SYSTEM_NGROK"
  PATCHED=$((PATCHED + 1))
done < <(find node_modules -type d -name "ngrok-bin-${PLATFORM}" 2>/dev/null)

if [[ $PATCHED -eq 0 ]]; then
  echo "[patch-expo-ngrok] No ngrok-bin-${PLATFORM} directories needed patching." >&2
fi

# Patch @expo/ngrok/index.js so the body POSTed to the ngrok v3 internal API
# (POST /api/tunnels) doesn't include the v2-only fields `authtoken`, `configPath`,
# `port`, plus the non-serializable callbacks `onStatusChange`/`onLogEvent`.
# Without this patch ngrok v3 returns:
#   "invalid tunnel configuration — field authtoken not found in type config.HTTPv2Tunnel"
EXPO_NGROK_INDEX="node_modules/@expo/ngrok/index.js"
if [[ -f "$EXPO_NGROK_INDEX" ]]; then
  if grep -q "ngrokClient.startTunnel(opts)" "$EXPO_NGROK_INDEX"; then
    EXPO_NGROK_INDEX="$EXPO_NGROK_INDEX" node <<'NODE'
const fs = require('fs');
const p = process.env.EXPO_NGROK_INDEX;
const before = '    const response = await ngrokClient.startTunnel(opts);';
const after  = '    // Strip v3-incompatible fields before POST /api/tunnels (patch-expo-ngrok.sh)\n'
             + '    const { authtoken: _at, configPath: _cp, port: _po, onStatusChange: _osc, onLogEvent: _ole, ...tunnelOpts } = opts;\n'
             + '    const response = await ngrokClient.startTunnel(tunnelOpts);';
let src = fs.readFileSync(p, 'utf8');
if (!src.includes(before)) {
  console.error('[patch-expo-ngrok] WARNING: target line not found in @expo/ngrok/index.js — skipping JS patch');
  process.exit(0);
}
fs.writeFileSync(p, src.replace(before, after));
console.log('[patch-expo-ngrok] Patched @expo/ngrok/index.js to strip v3-incompatible POST fields');
NODE
  else
    echo "[patch-expo-ngrok] @expo/ngrok/index.js already patched (or unexpected shape) — skipping JS patch"
  fi
else
  echo "[patch-expo-ngrok] @expo/ngrok/index.js not found — skipping JS patch" >&2
fi

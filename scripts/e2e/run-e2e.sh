#!/usr/bin/env bash
# scripts/e2e/run-e2e.sh — the Tier-C E2E orchestrator shell (task 8.2).
#
# Proven launch sequence (spike + attempts 1-5, 2026-08-19), captured so the
# E2E is reproducible without rediscovering the environment:
#
#   1. FRESH isolated home + udd under $TMP/pet2d-spike (a wedged home
#      correlates with force-killed predecessors; graceful Browser.close
#      between boots keeps it clean)
#   2. dev app up on its OWN vite port (5399) and debug ports (9343-9345) —
#      the user's own dev stack on 9333-9336 is NEVER touched
#   3. installLocal the built dist + enable, then Browser.close (uninstall
#      leaves the plugin DISABLED; a runtime enable leaves the main half
#      "never attempted this session" — the plugin must be enabled AT BOOT)
#   4. relaunch; installLocal into the fresh home has
#      reactivationRequired:false and the rail entry exists from boot
#   5. seed whale-girl into the udd's pack store (runtime data, not dist)
#   6. node scripts/e2e/run-e2e.cjs — the 8 legs
#   7. teardown: graceful Browser.close; kill any stragglers by the
#      pet2d-spike CommandLine marker ONLY
#
# Run from the plugin repo root on Windows (Git Bash), with the host
# worktree checked out at E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-wt-pet:
#
#   NO_PROXY=127.0.0.1,localhost bash scripts/e2e/run-e2e.sh
#
# Requires: dist/pet-2d built (npm run build), fixtures/whale-girl present,
# npx resolvable (tsx for seed.ts), node ws from the HOST worktree's
# node_modules (lib-cdp.cjs resolves it via createRequire).
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST_WT="E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-wt-pet"
SPIKE="$TMP/pet2d-spike"
# shellcheck disable=SC2129
export NO_PROXY=127.0.0.1,localhost HTTP_PROXY= HTTPS=
export PET2D_E2E_DEV_LOG="$SPIKE/logs/e2e-dev-current.txt"

mkdir -p "$SPIKE/logs"

kill_ours() {
  # Kill ONLY electron processes whose CommandLine carries the spike marker
  # (the user's own electron tree must never match; verified by pid ancestry).
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { \$_.CommandLine -like '*pet2d-spike*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" || true
}

cd "$PLUGIN_ROOT"

# ── 1. fresh isolated home + udd ─────────────────────────────────────────
kill_ours
rm -rf "$SPIKE/elftia-home" "$SPIKE/elftia-udd"
mkdir -p "$SPIKE/elftia-home" "$SPIKE/elftia-udd"

# ── 2. dev app up ────────────────────────────────────────────────────────
launch_dev() {
  (cd "$HOST_WT" && \
    VITE_PORT=5399 VITE_DEV_SERVER_URL=http://localhost:5399/ \
    ELFTIA_HOME="$(cygpath -w "$SPIKE/elftia-home")" \
    ELFTIA_CLI_DEBUG_PORT=9343 ELFTIA_CLI_INSPECT_PORT=9344 ELFTIA_CLI_HTTP_PORT=9345 \
    npm run dev -- -- "--user-data-dir=$(cygpath -w "$SPIKE/elftia-udd")" \
    > "$PET2D_E2E_DEV_LOG" 2>&1 &
  ) || true
}

wait_cdp() {
  for _ in $(seq 1 60); do
    if curl -s --noproxy '*' "http://127.0.0.1:9343/json/list" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "CDP never came up on 9343 — see $PET2D_E2E_DEV_LOG" >&2
  return 1
}

launch_dev
wait_cdp
sleep 8 # main-window boot past the fatal-startup window

# ── 3. install + enable + graceful close ─────────────────────────────────
node scripts/e2e/step-install.cjs
sleep 6 # npm/electron-vite teardown
kill_ours

# ── 4. relaunch with the plugin enabled at boot ──────────────────────────
launch_dev
wait_cdp
sleep 8

# ── 5. seed whale-girl into the runtime pack store ───────────────────────
npx tsx scripts/e2e/seed.ts "$(cygpath -w "$SPIKE/elftia-udd")/plugin-data/pet-2d"

# ── 6. the legs ──────────────────────────────────────────────────────────
node scripts/e2e/run-e2e.cjs
status=$?

# ── 7. teardown ──────────────────────────────────────────────────────────
node scripts/e2e/step-close.cjs || kill_ours
exit "$status"

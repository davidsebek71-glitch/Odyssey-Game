#!/usr/bin/env bash
# Runs the Odyssey to Olympus test scripts against a throwaway copy of the app.
#
#   tests/run.sh            API tests (fast, about 2 minutes)
#   tests/run.sh ui         browser tests (needs Playwright + Chromium)
#   tests/run.sh all        both
#   tests/run.sh tests/api/stage7_api.js ...   just these files
#
# It never touches your real database: the app is copied into a temporary
# folder, started on a fresh database with test accounts, and a stand-in for
# the Claude API answers the AI-helper tests. Set KEEP=1 to keep the folder
# (server log, screenshots) afterwards.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${TEST_PORT:-4200}"
MOCK_PORT="${MOCK_PORT:-4300}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/odyssey-test.XXXXXX")"
export TEST_BASE="http://localhost:$PORT" RNG_FILE="$WORK/rng.json" SHOTS_DIR="$WORK/shots" MOCK_LOG="$WORK/mock_requests.json" MOCK_PORT
SERVER_PID=""; MOCK_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  if [ "${KEEP:-0}" = "1" ]; then echo "Kept: $WORK"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

if curl -s -m 2 "http://localhost:$PORT" >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Stop that server or set TEST_PORT." >&2; exit 1
fi

# ── A copy of the app with its own fresh database ────────────────────────────
mkdir -p "$WORK/app" "$SHOTS_DIR"
cp -r "$REPO/server.js" "$REPO/database.js" "$REPO/package.json" "$REPO/routes" "$REPO/lib" "$REPO/data" "$REPO/public" "$WORK/app/"
ln -s "$REPO/node_modules" "$WORK/app/node_modules"
echo '[]' > "$RNG_FILE"

start_server() {
  (cd "$WORK/app" && ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL="http://localhost:$MOCK_PORT" PORT="$PORT" \
    exec node -r "$REPO/tests/lib/rng-preload.js" server.js >> "$WORK/server.log" 2>&1) &
  SERVER_PID=$!
  for _ in $(seq 1 60); do
    curl -s -m 3 "http://localhost:$PORT/api/health" | grep -q ready && return 0
    sleep 1
  done
  echo "The server did not start. Last lines of its log:" >&2; tail -20 "$WORK/server.log" >&2; exit 1
}
stop_server() {
  sleep 3   # let the debounced database save finish
  kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""
}

node "$REPO/tests/lib/mock-claude.js" > "$WORK/mock.log" 2>&1 &
MOCK_PID=$!

echo "Setting up a fresh test database…"
start_server
node "$REPO/tests/lib/setup-accounts.js" || exit 1
stop_server
(cd "$WORK/app" && node "$REPO/tests/lib/setup-buildings.js" "$WORK/app/odyssey_game.db") || exit 1
start_server

# ── Which tests ──────────────────────────────────────────────────────────────
API_TESTS=(island_api voyage_api stage3_api stage4a_api stage4b_api stage7_api stage8_api rotg_paths_api)
UI_TESTS=(island_ui voyage_ui stage3_ui stage4a_ui stage4b_ui stage5_ui stage6_ui stage7_ui stage8_ui rotg_ui rotg_notimer_ui)
FILES=()
case "${1:-api}" in
  api) for t in "${API_TESTS[@]}"; do FILES+=("$REPO/tests/api/$t.js"); done ;;
  ui)  for t in "${UI_TESTS[@]}"; do FILES+=("$REPO/tests/ui/$t.js"); done ;;
  all) for t in "${API_TESTS[@]}"; do FILES+=("$REPO/tests/api/$t.js"); done
       for t in "${UI_TESTS[@]}"; do FILES+=("$REPO/tests/ui/$t.js"); done ;;
  *)   for f in "$@"; do FILES+=("$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"); done ;;
esac

# ── Run them ─────────────────────────────────────────────────────────────────
FAILED=()
for f in "${FILES[@]}"; do
  name="$(basename "$f" .js)"
  echo; echo "━━ $name"
  out="$(cd "$WORK" && timeout 600 node "$f" 2>&1)"; code=$?
  echo "$out" | grep -E '✗|CRASH|PROBLEMS|failed$' || true
  # A test fails if it crashed, exited non-zero, or printed any ✗ line
  if [ $code -ne 0 ] || echo "$out" | grep -qE '✗|CRASH'; then FAILED+=("$name"); echo "$out" > "$WORK/$name.log"; fi
done

echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "All ${#FILES[@]} test files passed."; exit 0; fi
echo "${#FAILED[@]} of ${#FILES[@]} test files failed: ${FAILED[*]}"
echo "Full output is in $WORK/<name>.log (run with KEEP=1 to keep it)."
exit 1

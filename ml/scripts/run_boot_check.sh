#!/usr/bin/env bash
set -euo pipefail

# Boot-check wrapper: launches Deepnest ML headless, waits for the renderer
# to expose DeepNest + DeepNestAutomation, snapshots DOM invariants, writes
# a JSON report, and exits.
#
# Unlike ml/scripts/run_app_smoke_test.sh this uses the *modern* Electron
# bundled under node_modules (the same binary `npm start` invokes), not the
# legacy 1.4.13 Rosetta build, because the boot-check deliberately never
# touches the native Minkowski addon.
#
# Usage:
#   bash ml/scripts/run_boot_check.sh                            # default report path
#   bash ml/scripts/run_boot_check.sh /tmp/custom/report.json    # custom report path
#   BOOT_CHECK_TIMEOUT_MS=15000 bash ml/scripts/run_boot_check.sh
#
# Exit codes (passed through from boot-check-main.js):
#   0  all invariants passed
#   1  one or more invariants failed
#   2  renderer did not become ready in time
#   3  renderer crashed during boot
#   4  bad CLI args or internal error

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELECTRON_BIN="$ROOT_DIR/node_modules/.bin/electron"
BOOT_CHECK_MAIN="$ROOT_DIR/ml/boot-check-main.js"

REPORT_PATH="${1:-/tmp/deepnest-logs/boot-check.json}"
TIMEOUT_MS="${BOOT_CHECK_TIMEOUT_MS:-10000}"

if [ ! -x "$ELECTRON_BIN" ] && [ ! -f "$ELECTRON_BIN" ]; then
  echo "Missing Electron binary at $ELECTRON_BIN" >&2
  echo "Run: npm install" >&2
  exit 4
fi

if [ ! -f "$BOOT_CHECK_MAIN" ]; then
  echo "Missing boot-check main at $BOOT_CHECK_MAIN" >&2
  exit 4
fi

mkdir -p "$(dirname "$REPORT_PATH")"

echo "[run_boot_check] electron: $ELECTRON_BIN"
echo "[run_boot_check] report:   $REPORT_PATH"
echo "[run_boot_check] timeout:  ${TIMEOUT_MS}ms"

# Electron writes a lot of informational junk to stderr on first launch
# (GPU, helper processes, etc.). We keep it visible so Codex can spot
# anything unusual, but the machine-readable verdict lives in the JSON
# report file.
set +e
"$ELECTRON_BIN" "$BOOT_CHECK_MAIN" \
  --report "$REPORT_PATH" \
  --timeoutMs "$TIMEOUT_MS"
RC=$?
set -e

echo ""
echo "[run_boot_check] exit code: $RC"
if [ -f "$REPORT_PATH" ]; then
  echo "[run_boot_check] verdict:"
  # Print status + failed invariants in a compact form. Falls back to raw
  # file if jq isn't available.
  if command -v jq >/dev/null 2>&1; then
    jq '{status, elapsedMs, failedInvariants}' "$REPORT_PATH"
  else
    cat "$REPORT_PATH"
  fi
else
  echo "[run_boot_check] no report file was written"
fi

exit $RC

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELECTRON_BINARY="$ROOT_DIR/.legacy/electron-v1.4.13-darwin-x64/Electron.app/Contents/MacOS/Electron"

if [ ! -x "$ELECTRON_BINARY" ]; then
  echo "Missing legacy Electron binary. Run: npm run legacy:setup" >&2
  exit 1
fi

SPARROW_BINARY="$ROOT_DIR/vendor/sparrow/bin/darwin-arm64/sparrow"
if [ -x "$SPARROW_BINARY" ] && [ -z "${DEEPNEST_SPARROW_BIN:-}" ]; then
  export DEEPNEST_SPARROW_BIN="$SPARROW_BINARY"
fi

arch -x86_64 "$ELECTRON_BINARY" "$ROOT_DIR/ml/app-smoke-main.js" "$@"

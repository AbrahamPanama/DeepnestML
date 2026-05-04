#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."

if [[ -x "./node_modules/.bin/electron" ]]; then
  ELECTRON_BIN="./node_modules/.bin/electron"
elif [[ -x "dist/mac-arm64/Deepnest ML.app/Contents/MacOS/Deepnest ML" ]]; then
  ELECTRON_BIN="dist/mac-arm64/Deepnest ML.app/Contents/MacOS/Deepnest ML"
else
  echo "No Electron runtime found. Install dependencies or build the app first." >&2
  exit 2
fi

ELECTRON_RUN_AS_NODE=1 "$ELECTRON_BIN" ml/tests/nfp_profile/run.js "$@"

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."

ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ml/tests/nfp_equivalence/run.js "$@"

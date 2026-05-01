#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_ROOT="${DEEPNEST_SMOKE_ARTIFACT_ROOT:-"$ROOT_DIR/ml/artifacts/smoke-battery"}"

if [ "$#" -gt 0 ]; then
  SCENARIOS=("$@")
else
  SCENARIOS=("svg-gravity" "svg-gravity-improved-scoring" "svg-steprepeat" "svg-export-pdf")
fi

mkdir -p "$ARTIFACT_ROOT"

echo "[smoke-battery] boot invariants"
bash "$ROOT_DIR/ml/scripts/run_boot_check.sh"

for scenario in "${SCENARIOS[@]}"; do
  scenario_path="$ROOT_DIR/ml/smoke/scenarios/$scenario.json"
  if [ ! -f "$scenario_path" ]; then
    echo "[smoke-battery] missing scenario: $scenario_path" >&2
    exit 1
  fi

  output_format="$(node -e "const s=require(process.argv[1]); console.log((s.outputFormat || 'svg').toLowerCase())" "$scenario_path")"
  scenario_dir="$ARTIFACT_ROOT/$scenario"
  output_path="$scenario_dir/export.$output_format"
  report_path="$scenario_dir/report.json"

  mkdir -p "$scenario_dir"
  echo "[smoke-battery] scenario: $scenario"
  bash "$ROOT_DIR/ml/scripts/run_app_smoke_test.sh" \
    --scenario "$scenario" \
    --output "$output_path" \
    --report "$report_path"

  node - "$report_path" "$output_path" <<'NODE'
const fs = require('fs');
const reportPath = process.argv[2];
const outputPath = process.argv[3];
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'completed') {
  console.error('[smoke-battery] failed report:', JSON.stringify(report, null, 2));
  process.exit(1);
}
const stat = fs.statSync(outputPath);
if (!stat.size) {
  console.error('[smoke-battery] empty output:', outputPath);
  process.exit(1);
}
console.log('[smoke-battery] passed:', report.scenarioName, report.outputFormat, stat.size + ' bytes');
NODE
done

echo "[smoke-battery] all scenarios passed"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_ROOT="${DEEPNEST_SMOKE_ARTIFACT_ROOT:-"$ROOT_DIR/ml/artifacts/smoke-battery"}"

if [ "$#" -gt 0 ]; then
  SCENARIOS=("$@")
else
  SCENARIOS=("svg-gravity" "svg-gravity-improved-scoring" "svg-gravity-sheet-margin-outline" "svg-gravity-adaptive-rotation-forced-fit" "svg-gravity-adaptive-slotted-oval" "svg-hull" "svg-hull-settle-floaters" "svg-steprepeat" "svg-export-pdf")
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

  node - "$report_path" "$output_path" "$scenario_path" <<'NODE'
const fs = require('fs');
const reportPath = process.argv[2];
const outputPath = process.argv[3];
const scenarioPath = process.argv[4];
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
if (report.status !== 'completed') {
  console.error('[smoke-battery] failed report:', JSON.stringify(report, null, 2));
  process.exit(1);
}
const stat = fs.statSync(outputPath);
if (!stat.size) {
  console.error('[smoke-battery] empty output:', outputPath);
  process.exit(1);
}
if (typeof scenario.expectedRotation === 'number') {
  const output = fs.readFileSync(outputPath, 'utf8');
  const rotations = [];
  const rotationPattern = /rotate\(\s*([-+0-9.eE]+)\s*\)/g;
  let match;
  while ((match = rotationPattern.exec(output))) {
    rotations.push(Number(match[1]));
  }
  if (!rotations.some((rotation) => Math.abs(rotation - scenario.expectedRotation) <= 1e-6)) {
    console.error('[smoke-battery] expected rotation missing:', scenario.expectedRotation, rotations);
    process.exit(1);
  }
}
if (Array.isArray(scenario.expectedRotations) && scenario.expectedRotations.length > 0) {
  const output = fs.readFileSync(outputPath, 'utf8');
  const rotations = [];
  const rotationPattern = /rotate\(\s*([-+0-9.eE]+)\s*\)/g;
  let match;
  while ((match = rotationPattern.exec(output))) {
    rotations.push(Number(match[1]));
  }
  if (!rotations.some((rotation) => scenario.expectedRotations.some((expected) => Math.abs(rotation - expected) <= 1e-6))) {
    console.error('[smoke-battery] expected rotations missing:', scenario.expectedRotations, rotations);
    process.exit(1);
  }
}
if (typeof scenario.expectedNonCanonicalNfpLookups === 'number') {
  const local = report.details && report.details.localRefinement;
  const actual = local && typeof local.nonCanonicalNfpLookups === 'number' ? local.nonCanonicalNfpLookups : null;
  if (actual !== scenario.expectedNonCanonicalNfpLookups) {
    console.error('[smoke-battery] unexpected non-canonical NFP lookup count:', actual);
    process.exit(1);
  }
}
if (scenario.expectedLocalRefinementMinimums && typeof scenario.expectedLocalRefinementMinimums === 'object') {
  const local = report.details && report.details.localRefinement;
  for (const field of Object.keys(scenario.expectedLocalRefinementMinimums)) {
    const expected = Number(scenario.expectedLocalRefinementMinimums[field]);
    const actual = local && typeof local[field] === 'number' ? local[field] : null;
    if (actual === null || actual < expected) {
      console.error('[smoke-battery] local refinement minimum not met:', field, expected, actual);
      process.exit(1);
    }
  }
}
console.log('[smoke-battery] passed:', report.scenarioName, report.outputFormat, stat.size + ' bytes');
NODE
done

echo "[smoke-battery] all scenarios passed"

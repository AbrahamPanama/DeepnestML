#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_ROOT="${DEEPNEST_SMOKE_ARTIFACT_ROOT:-"$ROOT_DIR/ml/artifacts/smoke-battery"}"

if [ "$#" -gt 0 ]; then
  SCENARIOS=("$@")
else
  SCENARIOS=("svg-gravity" "svg-gravity-improved-scoring" "svg-gravity-sheet-margin-outline" "svg-gravity-adaptive-rotation-forced-fit" "svg-gravity-adaptive-slotted-oval" "svg-hull" "svg-hull-settle-floaters" "svg-laurel-continuous" "svg-laurel-continuous-cluster" "svg-laurel-continuous-four" "svg-laurel-v4-contact" "svg-laurel-superpart-default" "svg-steprepeat" "svg-export-pdf")
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
if (typeof scenario.expectedPartsPlaced === 'number') {
  const actual = report.details && typeof report.details.placedPartInstances === 'number' ? report.details.placedPartInstances : null;
  if (actual !== scenario.expectedPartsPlaced) {
    console.error('[smoke-battery] expected placed part count mismatch:', scenario.expectedPartsPlaced, actual);
    process.exit(1);
  }
}
if (typeof scenario.expectedSvgPathCount === 'number' && report.outputFormat === 'svg') {
  const output = fs.readFileSync(outputPath, 'utf8');
  const actual = (output.match(/<path\b/g) || []).length;
  if (actual !== scenario.expectedSvgPathCount) {
    console.error('[smoke-battery] expected SVG path count mismatch:', scenario.expectedSvgPathCount, actual);
    process.exit(1);
  }
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
if (scenario.expectedSuperpartMinimums && typeof scenario.expectedSuperpartMinimums === 'object') {
  const superpart = report.details && report.details.superpartClustering;
  for (const field of Object.keys(scenario.expectedSuperpartMinimums)) {
    const expected = Number(scenario.expectedSuperpartMinimums[field]);
    const actual = superpart && typeof superpart[field] === 'number' ? superpart[field] : null;
    if (actual === null || actual < expected) {
      console.error('[smoke-battery] superpart minimum not met:', field, expected, actual);
      process.exit(1);
    }
  }
}
if (typeof scenario.expectedSuperpartEnabled === 'boolean') {
  const superpart = report.details && report.details.superpartClustering;
  const actual = superpart ? superpart.enabled === true : null;
  if (actual !== scenario.expectedSuperpartEnabled) {
    console.error('[smoke-battery] unexpected superpart enabled state:', scenario.expectedSuperpartEnabled, actual);
    process.exit(1);
  }
}
if (scenario.expectedRuntimeConfig && typeof scenario.expectedRuntimeConfig === 'object') {
  const runtimeConfig = report.details && report.details.runtimeConfig;
  for (const field of Object.keys(scenario.expectedRuntimeConfig)) {
    const expected = scenario.expectedRuntimeConfig[field];
    const actual = runtimeConfig ? runtimeConfig[field] : undefined;
    if (actual !== expected) {
      console.error('[smoke-battery] runtime config mismatch:', field, expected, actual);
      process.exit(1);
    }
  }
}
if (scenario.expectedLayoutMaximums && typeof scenario.expectedLayoutMaximums === 'object') {
  const layout = report.details && report.details.layout;
  for (const field of Object.keys(scenario.expectedLayoutMaximums)) {
    const expected = Number(scenario.expectedLayoutMaximums[field]);
    const actual = layout && typeof layout[field] === 'number' ? layout[field] : null;
    if (actual === null || actual > expected) {
      console.error('[smoke-battery] layout maximum exceeded:', field, expected, actual);
      process.exit(1);
    }
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
if (scenario.expectedLocalRefinementMaximums && typeof scenario.expectedLocalRefinementMaximums === 'object') {
  const local = report.details && report.details.localRefinement;
  for (const field of Object.keys(scenario.expectedLocalRefinementMaximums)) {
    const expected = Number(scenario.expectedLocalRefinementMaximums[field]);
    const actual = local && typeof local[field] === 'number' ? local[field] : null;
    if (actual === null || actual > expected) {
      console.error('[smoke-battery] local refinement maximum exceeded:', field, expected, actual);
      process.exit(1);
    }
  }
}
if (scenario.continuousOracle && typeof scenario.continuousOracle === 'object') {
  const local = report.details && report.details.localRefinement;
  const oracleBefore = Number(scenario.continuousOracle.scoreBefore);
  const oracleAfter = Number(scenario.continuousOracle.scoreAfter);
  const minimumRecovery = Number(scenario.continuousOracle.minimumRecovery);
  if (!local || typeof local.continuousScoreBefore !== 'number' || typeof local.continuousScoreAfter !== 'number') {
    console.error('[smoke-battery] missing continuous oracle scores');
    process.exit(1);
  }
  if (Math.abs(local.continuousScoreBefore - oracleBefore) > 1e-9) {
    console.error('[smoke-battery] continuous oracle start drifted:', oracleBefore, local.continuousScoreBefore);
    process.exit(1);
  }
  const oracleGain = oracleBefore - oracleAfter;
  const productionGain = local.continuousScoreBefore - local.continuousScoreAfter;
  const recovery = oracleGain > 0 ? productionGain / oracleGain : 0;
  if (recovery < minimumRecovery) {
    console.error('[smoke-battery] continuous oracle recovery too low:', minimumRecovery, recovery);
    process.exit(1);
  }
}
console.log('[smoke-battery] passed:', report.scenarioName, report.outputFormat, stat.size + ' bytes');
NODE

  independent_legality="$(node -e "const s=require(process.argv[1]); console.log(s.expectedIndependentLegality === true ? 'true' : 'false')" "$scenario_path")"
  if [ "$independent_legality" = "true" ]; then
    expected_parts="$(node -e "const s=require(process.argv[1]); console.log(Number(s.expectedPartsPlaced || 0))" "$scenario_path")"
    node "$ROOT_DIR/ml/tests/exported_layout_legality/run.js" \
      --export "$output_path" \
      --expected-parts "$expected_parts" \
      --report "$scenario_dir/export-legality.json"
  fi
done

echo "[smoke-battery] all scenarios passed"

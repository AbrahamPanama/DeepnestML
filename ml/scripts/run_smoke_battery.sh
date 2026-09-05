#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_ROOT="${DEEPNEST_SMOKE_ARTIFACT_ROOT:-"$ROOT_DIR/ml/artifacts/smoke-battery"}"

if [ "$#" -gt 0 ]; then
  SCENARIOS=("$@")
else
  SCENARIOS=("svg-gravity" "svg-settings-form-mm" "svg-gravity-improved-scoring" "svg-gravity-sheet-margin-outline" "svg-gravity-adaptive-rotation-forced-fit" "svg-gravity-adaptive-slotted-oval" "svg-hull" "svg-corel-magenta-hole" "svg-hull-settle-floaters" "svg-laurel-continuous" "svg-laurel-continuous-cluster" "svg-laurel-continuous-four" "svg-laurel-continuous-rolling" "svg-laurel-v4-contact" "svg-laurel-superpart-default" "svg-steprepeat" "svg-export-pdf" "svg-sparrow-pure" "svg-sparrow-hybrid" "svg-sparrow-hybrid-incomplete")
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
if (typeof scenario.expectedPartCount === 'number') {
  const actual = report.details && typeof report.details.partCount === 'number' ? report.details.partCount : null;
  if (actual !== scenario.expectedPartCount) {
    console.error('[smoke-battery] imported part count mismatch:', scenario.expectedPartCount, actual);
    process.exit(1);
  }
}
if (Array.isArray(scenario.expectedTopologyHoleCounts)) {
  const actual = report.details && report.details.topologyHoleCounts;
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(scenario.expectedTopologyHoleCounts)) {
    console.error('[smoke-battery] topology hole counts mismatch:', scenario.expectedTopologyHoleCounts, actual);
    process.exit(1);
  }
}
if (typeof scenario.expectedPartsPlaced === 'number') {
  const actual = report.details && typeof report.details.placedPartInstances === 'number' ? report.details.placedPartInstances : null;
  if (actual !== scenario.expectedPartsPlaced) {
    console.error('[smoke-battery] expected placed part count mismatch:', scenario.expectedPartsPlaced, actual);
    process.exit(1);
  }
}
if (typeof scenario.minimumPartsPlaced === 'number') {
  const actual = report.details && typeof report.details.placedPartInstances === 'number' ? report.details.placedPartInstances : null;
  if (actual === null || actual < scenario.minimumPartsPlaced) {
    console.error('[smoke-battery] minimum placed part count not met:', scenario.minimumPartsPlaced, actual);
    process.exit(1);
  }
}
if (typeof scenario.expectedRequestedPartInstances === 'number') {
  const actual = report.details && typeof report.details.requestedPartInstances === 'number' ? report.details.requestedPartInstances : null;
  if (actual !== scenario.expectedRequestedPartInstances) {
    console.error('[smoke-battery] requested part count mismatch:', scenario.expectedRequestedPartInstances, actual);
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
if (report.outputFormat === 'svg' && (
    scenario.expectedNoAuthorStyleNodes === true ||
    typeof scenario.expectedMaxStrokeWidth === 'number' ||
    scenario.expectedOnlyNoFill === true ||
    Array.isArray(scenario.expectedRequiredFills)
)) {
  const output = fs.readFileSync(outputPath, 'utf8');
  if (scenario.expectedNoAuthorStyleNodes === true && /<(?:defs|style)\b/i.test(output)) {
    console.error('[smoke-battery] authored SVG style node survived cleanup');
    process.exit(1);
  }
  if (typeof scenario.expectedMaxStrokeWidth === 'number') {
    const widths = Array.from(output.matchAll(/stroke-width=["']([^"']+)["']/gi), (match) => Number(match[1]));
    if (widths.some((width) => !Number.isFinite(width) || width > scenario.expectedMaxStrokeWidth)) {
      console.error('[smoke-battery] SVG stroke width exceeds limit:', scenario.expectedMaxStrokeWidth, widths);
      process.exit(1);
    }
  }
  if (scenario.expectedOnlyNoFill === true) {
    const fills = Array.from(output.matchAll(/\bfill=["']([^"']+)["']/gi), (match) => String(match[1]).trim().toLowerCase());
    if (fills.some((fill) => fill !== 'none')) {
      console.error('[smoke-battery] filled SVG geometry survived normalization:', fills);
      process.exit(1);
    }
  }
  if (Array.isArray(scenario.expectedRequiredFills)) {
    const fills = Array.from(output.matchAll(/\bfill=["']([^"']+)["']/gi), (match) => String(match[1]).trim().toLowerCase());
    const missing = scenario.expectedRequiredFills
      .map((fill) => String(fill).trim().toLowerCase())
      .filter((fill) => !fills.includes(fill));
    if (missing.length) {
      console.error('[smoke-battery] required SVG fills missing:', missing, fills);
      process.exit(1);
    }
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
if (scenario.expectedDisplayMatchesSelected === true) {
  const display = report.details && report.details.display;
  if (!display || display.displayedNestMatchesSelected !== true ||
      !display.displayedNestDigest ||
      display.displayedNestDigest !== display.selectedNestDigest) {
    console.error('[smoke-battery] displayed nest is stale:', display);
    process.exit(1);
  }
}
if (typeof scenario.expectedDisplayedPartCount === 'number') {
  const display = report.details && report.details.display;
  const actual = display && typeof display.displayedPartCount === 'number' ? display.displayedPartCount : null;
  if (actual !== scenario.expectedDisplayedPartCount) {
    console.error('[smoke-battery] displayed part count mismatch:', scenario.expectedDisplayedPartCount, actual);
    process.exit(1);
  }
}
if (scenario.expectedDisplayedPartsInsideSheet === true) {
  const display = report.details && report.details.display;
  const parts = display && Array.isArray(display.displayedPartBounds) ? display.displayedPartBounds : [];
  const sheets = display && Array.isArray(display.displayedSheetBounds) ? display.displayedSheetBounds : [];
  const tolerance = Number.isFinite(Number(scenario.displayBoundsTolerancePx)) ?
    Math.max(0, Number(scenario.displayBoundsTolerancePx)) : 1;
  if (!parts.length || !sheets.length) {
    console.error('[smoke-battery] missing displayed bounds for containment check:', display);
    process.exit(1);
  }
  const outside = parts.filter((part) => !sheets.some((sheet) =>
    part.x >= sheet.x - tolerance &&
    part.y >= sheet.y - tolerance &&
    part.right <= sheet.right + tolerance &&
    part.bottom <= sheet.bottom + tolerance
  ));
  if (outside.length) {
    console.error('[smoke-battery] displayed part extends outside every visible sheet:', { tolerance, outside, sheets });
    process.exit(1);
  }
}
if (Array.isArray(scenario.expectedDisplayedRotations) && scenario.expectedDisplayedRotations.length > 0) {
  const display = report.details && report.details.display;
  const rotations = display && Array.isArray(display.displayedRotations) ? display.displayedRotations : [];
  if (!rotations.some((rotation) => scenario.expectedDisplayedRotations.some((expected) => Math.abs(rotation - expected) <= 1e-6))) {
    console.error('[smoke-battery] expected displayed rotations missing:', scenario.expectedDisplayedRotations, rotations);
    process.exit(1);
  }
}
if (typeof scenario.expectedStatusLabelContains === 'string') {
  const display = report.details && report.details.display;
  const label = display && typeof display.statusLabel === 'string' ? display.statusLabel : '';
  if (label.indexOf(scenario.expectedStatusLabelContains) < 0) {
    console.error('[smoke-battery] refinement status label mismatch:', scenario.expectedStatusLabelContains, label);
    process.exit(1);
  }
}
if (typeof scenario.expectedSolverStatusLabelContains === 'string') {
  const display = report.details && report.details.display;
  const label = display && typeof display.solverStatusLabel === 'string' ? display.solverStatusLabel : '';
  if (label.indexOf(scenario.expectedSolverStatusLabelContains) < 0) {
    console.error('[smoke-battery] solver status label mismatch:', scenario.expectedSolverStatusLabelContains, label);
    process.exit(1);
  }
}
if (typeof scenario.expectedSolverMode === 'string') {
  const solver = report.details && report.details.solver;
  const actual = solver && solver.mode;
  if (actual !== scenario.expectedSolverMode) {
    console.error('[smoke-battery] solver mode mismatch:', scenario.expectedSolverMode, actual);
    process.exit(1);
  }
}
if (scenario.expectedSolverValues && typeof scenario.expectedSolverValues === 'object') {
  const solver = report.details && report.details.solver;
  for (const field of Object.keys(scenario.expectedSolverValues)) {
    const expected = scenario.expectedSolverValues[field];
    const actual = solver ? solver[field] : undefined;
    if (actual !== expected) {
      console.error('[smoke-battery] solver value mismatch:', field, expected, actual);
      process.exit(1);
    }
  }
}
if (scenario.expectedSolverMinimums && typeof scenario.expectedSolverMinimums === 'object') {
  const solver = report.details && report.details.solver;
  for (const field of Object.keys(scenario.expectedSolverMinimums)) {
    const expected = Number(scenario.expectedSolverMinimums[field]);
    const actual = solver && typeof solver[field] === 'number' ? solver[field] : null;
    if (actual === null || actual < expected) {
      console.error('[smoke-battery] solver minimum not met:', field, expected, actual);
      process.exit(1);
    }
  }
}
if (typeof scenario.minimumOffGridAngles === 'number') {
  const display = report.details && report.details.display;
  const rotations = display && Array.isArray(display.displayedRotations) ? display.displayedRotations : [];
  const offGrid = rotations.filter((rotation) => {
    const normalized = Math.abs(Number(rotation) || 0) % 90;
    return Math.min(normalized, 90 - normalized) > 0.05;
  }).length;
  if (offGrid < scenario.minimumOffGridAngles) {
    console.error('[smoke-battery] too few off-grid Sparrow angles:', scenario.minimumOffGridAngles, offGrid, rotations);
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
const settingsForm = report.details && report.details.settingsForm;
if (!settingsForm) {
  console.error('[smoke-battery] missing settings-form snapshot');
  process.exit(1);
}
if (settingsForm.units !== 'inch' && settingsForm.units !== 'mm') {
  console.error('[smoke-battery] invalid settings-form units:', settingsForm.units);
  process.exit(1);
}
if (!Array.isArray(settingsForm.unitLabels) || settingsForm.unitLabels.length === 0 ||
    settingsForm.unitLabels.some((label) => label !== settingsForm.units)) {
  console.error('[smoke-battery] settings-form unit labels are stale:', settingsForm);
  process.exit(1);
}
if (Number(settingsForm.scale) <= 0 ||
    settingsForm.endpointTolerance === '' ||
    !Number.isFinite(Number(settingsForm.endpointTolerance)) ||
    Number(settingsForm.endpointTolerance) < 0 ||
    settingsForm.dxfImportScale === '' ||
    settingsForm.dxfExportScale === '' ||
    settingsForm.undefinedTextCount !== 0) {
  console.error('[smoke-battery] settings-form contains blank or undefined values:', settingsForm);
  process.exit(1);
}
if (scenario.expectedSettingsForm && typeof scenario.expectedSettingsForm === 'object') {
  for (const field of Object.keys(scenario.expectedSettingsForm)) {
    const expected = scenario.expectedSettingsForm[field];
    const actual = settingsForm[field];
    if (actual !== expected) {
      console.error('[smoke-battery] settings-form mismatch:', field, expected, actual);
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
    expected_parts="$(node -e "const s=require(process.argv[1]); const r=require(process.argv[2]); const exact=Number(s.expectedPartsPlaced); console.log(Number.isFinite(exact) ? exact : Number(r.details && r.details.placedPartInstances || 0))" "$scenario_path" "$report_path")"
    node "$ROOT_DIR/ml/tests/exported_layout_legality/run.js" \
      --export "$output_path" \
      --expected-parts "$expected_parts" \
      --report "$scenario_dir/export-legality.json"
  fi
done

echo "[smoke-battery] all scenarios passed"

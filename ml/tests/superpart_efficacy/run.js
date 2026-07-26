'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
	const result = {};
	for (let i = 2; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) {
			continue;
		}
		const key = argv[i].slice(2);
		result[key] = i + 1 < argv.length && !argv[i + 1].startsWith('--') ?
			argv[++i] : true;
	}
	return result;
}

function readReport(filePath) {
	return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function relativeReduction(baseline, candidate) {
	return baseline > 0 ? (baseline - candidate) / baseline : 0;
}

function evaluate(baselineReport, candidateReport, options) {
	assert.strictEqual(baselineReport.status, 'completed', 'baseline run must complete');
	assert.strictEqual(candidateReport.status, 'completed', 'candidate run must complete');
	const baseline = baselineReport.details || {};
	const candidate = candidateReport.details || {};
	const baselineLayout = baseline.layout;
	const candidateLayout = candidate.layout;
	assert.ok(baselineLayout && candidateLayout, 'both runs must report layout metrics');
	assert.strictEqual(
		candidate.placedPartInstances,
		baseline.placedPartInstances,
		'candidate must place the same number of original parts'
	);
	const superpart = candidate.superpartClustering;
	assert.ok(superpart && superpart.enabled, 'candidate must execute superpart clustering');
	assert.strictEqual(superpart.expansionValidated, true, 'candidate expansion must pass its fail-closed gate');
	assert.ok(superpart.sourcesPaired >= 1, 'candidate must pair at least one repeated source');
	assert.ok(superpart.clusterPlacements >= 1, 'candidate must place at least one rigid pair');
	assert.strictEqual(
		superpart.partsPlaced,
		candidate.placedPartInstances,
		'expanded member count must equal visible placed count'
	);

	const matingGain = Number(options.matingGain);
	const recoveryFraction = Number(options.minimumRecovery);
	assert.ok(isFinite(matingGain) && matingGain > 0, 'mating gain must be positive');
	assert.ok(isFinite(recoveryFraction) && recoveryFraction > 0, 'minimum recovery must be positive');
	const requiredReduction = matingGain * recoveryFraction;
	const usedSheetReduction = relativeReduction(
		baselineLayout.usedSheetWidth,
		candidateLayout.usedSheetWidth
	);
	const bboxAreaReduction = relativeReduction(
		baselineLayout.bboxArea,
		candidateLayout.bboxArea
	);
	const hullAreaReduction = relativeReduction(
		baselineLayout.hullArea,
		candidateLayout.hullArea
	);
	const result = {
		passed: usedSheetReduction >= requiredReduction &&
			bboxAreaReduction > 0 &&
			hullAreaReduction > 0,
		matingGain: matingGain,
		minimumRecoveryFraction: recoveryFraction,
		requiredReduction: requiredReduction,
		usedSheetWidth: {
			baseline: baselineLayout.usedSheetWidth,
			candidate: candidateLayout.usedSheetWidth,
			reduction: usedSheetReduction
		},
		bboxArea: {
			baseline: baselineLayout.bboxArea,
			candidate: candidateLayout.bboxArea,
			reduction: bboxAreaReduction
		},
		hullArea: {
			baseline: baselineLayout.hullArea,
			candidate: candidateLayout.hullArea,
			reduction: hullAreaReduction
		},
		utilization: {
			baselineBbox: baselineLayout.bboxUtilization,
			candidateBbox: candidateLayout.bboxUtilization,
			baselineUsedSheet: baselineLayout.usedSheetUtilization,
			candidateUsedSheet: candidateLayout.usedSheetUtilization
		},
		runtime: {
			baselineTimeToBestSec: baseline.timeToBestSec,
			candidateTimeToBestSec: candidate.timeToBestSec,
			superpartSearchMs: superpart.searchMs
		},
		superpart: superpart
	};
	return result;
}

function main() {
	const args = parseArgs(process.argv);
	if (!args.baseline || !args.candidate) {
		throw new Error(
			'usage: run.js --baseline <report.json> --candidate <report.json> ' +
			'--mating-gain <fraction> [--minimum-recovery 0.60]'
		);
	}
	const result = evaluate(
		readReport(args.baseline),
		readReport(args.candidate),
		{
			matingGain: Number(args['mating-gain']),
			minimumRecovery: Number(args['minimum-recovery'] || 0.60)
		}
	);
	if (args.report) {
		fs.writeFileSync(path.resolve(args.report), JSON.stringify(result, null, 2));
	}
	console.log(JSON.stringify(result, null, 2));
	if (!result.passed) {
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}

module.exports = {
	evaluate,
	relativeReduction
};

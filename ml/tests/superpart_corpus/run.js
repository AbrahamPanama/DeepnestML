'use strict';

const fs = require('fs');
const path = require('path');
const esicup = require('../../lib/esicup-convert.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const INSTANCES_DIR = path.join(ROOT, 'ml', 'benchmark', 'esicup', 'instances');
const MAX_REGRESSION = 0.0025;

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

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function instanceMap(report) {
	const result = {};
	for (const instance of report.instances || []) {
		result[instance.name] = instance;
	}
	return result;
}

function verifyStructuralNoOp() {
	const files = fs.readdirSync(INSTANCES_DIR)
		.filter((name) => name.endsWith('.json'))
		.sort();
	let totalDemand = 0;
	let totalSources = 0;
	let instancesWithRepeatedDemand = 0;
	for (const file of files) {
		const source = readJson(path.join(INSTANCES_DIR, file));
		if ((source.items || []).some((item) => Number(item.demand || 1) >= 2)) {
			instancesWithRepeatedDemand++;
		}
		const converted = esicup.instanceToSvg(source);
		const meta = converted.meta;
		assert(meta.compactDemands !== true,
			`${file}: historical converter unexpectedly enabled compact demands`);
		assert(meta.sourceOrder.length === meta.totalDemand,
			`${file}: demanded copies are not represented as one source each`);
		assert(Object.keys(meta.sourceMap).length === meta.totalDemand,
			`${file}: source map does not contain every demanded copy`);
		assert(new Set(meta.sourceOrder).size === meta.sourceOrder.length,
			`${file}: duplicate source id in converted corpus`);
		totalDemand += meta.totalDemand;
		totalSources += meta.sourceOrder.length;
	}
	return {
		instanceCount: files.length,
		instancesWithRepeatedDemand: instancesWithRepeatedDemand,
		totalDemand: totalDemand,
		totalSources: totalSources,
		allSourcesHaveQuantityOneInBenchmarkHarness: totalDemand === totalSources
	};
}

function verifyRunPair(name, baseline, candidate, options) {
	assert((baseline.runs || []).length >= 3,
		`${name}: baseline has fewer than three seeds`);
	assert(baseline.runs.length === candidate.runs.length,
		`${name}: seed counts differ`);
	for (let i = 0; i < baseline.runs.length; i++) {
		const before = baseline.runs[i];
		const after = candidate.runs[i];
		assert(before.randomSeed === after.randomSeed,
			`${name}: seed ${i} differs`);
		if (!options.requireComplete) {
			assert(before.placementsDigest === after.placementsDigest,
				`${name}: seed ${before.randomSeed} placement digest changed`);
			assert(before.utilization === after.utilization,
				`${name}: seed ${before.randomSeed} utilization changed`);
			assert(before.allPartsPlaced === after.allPartsPlaced,
				`${name}: seed ${before.randomSeed} placement completeness changed`);
		}
		if (options.requireComplete) {
			assert(before.legality && before.legality.legal === true,
				`${name}: baseline seed ${before.randomSeed} is incomplete or illegal`);
			assert(after.legality && after.legality.legal === true,
				`${name}: candidate seed ${after.randomSeed} is incomplete or illegal`);
		}
		assert(after.legality && after.legality.overlapFree === true,
			`${name}: seed ${after.randomSeed} has an overlap`);
		assert(after.legality.withinSheetBounds === true,
			`${name}: seed ${after.randomSeed} leaves the sheet`);
		const nonCanonical = after.localRefinement &&
			Number(after.localRefinement.nonCanonicalNfpLookups || 0);
		assert(nonCanonical === 0,
			`${name}: seed ${after.randomSeed} used a non-canonical NFP`);
		if (options.requireFeatureTelemetry) {
			const telemetry = after.superpartClustering;
			assert(telemetry && telemetry.enabled === true,
				`${name}: seed ${after.randomSeed} has no enabled superpart telemetry`);
			if (Number(telemetry.sourcesPaired || 0) > 0) {
				assert(telemetry.expansionValidated === true,
					`${name}: seed ${after.randomSeed} paired without validated expansion`);
				options.featureActiveRuns++;
			}
		}
	}
}

function verifyBenchmarkPair(baseline, candidate, mode) {
	const tier2 = mode === 'tier2';
	const verificationOptions = {
		requireComplete: tier2,
		requireFeatureTelemetry: tier2,
		featureActiveRuns: 0
	};
	const beforeFlags = baseline.engineFlags || {};
	const afterFlags = candidate.engineFlags || {};
	assert(beforeFlags.runsPerInstance === afterFlags.runsPerInstance,
		'benchmark run counts differ');
	assert(beforeFlags.timeBudgetSec === afterFlags.timeBudgetSec,
		'benchmark wall-clock budgets differ');
	assert(beforeFlags.runtime === afterFlags.runtime,
		'benchmark runtimes differ');
	assert(!(beforeFlags.superparts && beforeFlags.superparts.superpartClustering),
		'baseline superpart flag is not off');
	assert(afterFlags.superparts && afterFlags.superparts.superpartClustering === true,
		'candidate superpart flag is not on');
	if (tier2) {
		assert(beforeFlags.compactDemands === true && afterFlags.compactDemands === true,
			'Tier 2 requires compact-demand representation');
		assert(beforeFlags.timeBudgetSec >= 30,
			'Tier 2 requires at least a 30-second equal wall clock');
		assert(beforeFlags.runsPerInstance >= 3,
			'Tier 2 requires at least three seeds');
		assert(baseline.gitCommit && baseline.gitCommit === candidate.gitCommit,
			'Tier 2 benchmark commits differ');
		assert(baseline.gitTrackedDirty === false && candidate.gitTrackedDirty === false,
			'Tier 2 requires a clean tracked source tree');
	}
	else {
		assert(beforeFlags.compactDemands !== true && afterFlags.compactDemands !== true,
			'standard no-op probe must not use compact-demand representation');
	}

	const beforeByName = instanceMap(baseline);
	const afterByName = instanceMap(candidate);
	const names = Object.keys(beforeByName).sort();
	assert(names.length > 0, 'benchmark pair has no instances');
	if (tier2) {
		assert(names.length === 23, `Tier 2 requires all 23 instances, got ${names.length}`);
	}
	assert(JSON.stringify(names) === JSON.stringify(Object.keys(afterByName).sort()),
		'benchmark instance sets differ');
	for (const name of names) {
		verifyRunPair(name, beforeByName[name], afterByName[name], verificationOptions);
	}
	if (tier2) {
		assert(verificationOptions.featureActiveRuns > 0,
			'Tier 2 did not exercise a single clustered run');
	}

	const baselineMean = Number(baseline.aggregate.meanMedianUtilization);
	const candidateMean = Number(candidate.aggregate.meanMedianUtilization);
	const delta = candidateMean - baselineMean;
	assert(isFinite(delta), 'benchmark aggregate utilization is missing');
	assert(delta >= -MAX_REGRESSION,
		`mean median utilization regressed by ${(-delta * 100).toFixed(4)} pp`);
	const result = {
		executedInstanceCount: names.length,
		runsPerInstance: beforeFlags.runsPerInstance,
		timeBudgetSec: beforeFlags.timeBudgetSec,
		runtime: beforeFlags.runtime,
		baselineMeanMedianUtilization: baselineMean,
		candidateMeanMedianUtilization: candidateMean,
		deltaPercentagePoints: delta * 100,
		placementDigestsIdentical: tier2 ? null : true,
		exportedGeometryLegal: true,
		nonCanonicalNfpLookups: 0
	};
	if (tier2) {
		result.featureActiveRuns = verificationOptions.featureActiveRuns;
	}
	return result;
}

function main() {
	const args = parseArgs(process.argv);
	if (!args.baseline || !args.candidate) {
		throw new Error(
			'usage: run.js --baseline <off.json> --candidate <on.json> [--report <gate.json>]'
		);
	}
	const mode = String(args.mode || 'tier2');
	assert(mode === 'tier2' || mode === 'standard-noop',
		'--mode must be tier2 or standard-noop');
	const result = {
		status: mode === 'tier2' ? 'passed' : 'supporting-evidence',
		mode: mode,
		maxRegressionPercentagePoints: MAX_REGRESSION * 100,
		structuralCorpusProof: verifyStructuralNoOp(),
		executedParityProbe: verifyBenchmarkPair(
			readJson(args.baseline),
			readJson(args.candidate),
			mode
		)
	};
	if (args.report) {
		fs.writeFileSync(path.resolve(args.report), JSON.stringify(result, null, 2));
	}
	console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
	main();
}

module.exports = {
	verifyStructuralNoOp,
	verifyBenchmarkPair
};

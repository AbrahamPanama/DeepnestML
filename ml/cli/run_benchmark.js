'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const esicup = require('../lib/esicup-convert');

const ROOT = path.resolve(__dirname, '..', '..');
const INSTANCE_DIR = path.join(ROOT, 'ml', 'benchmark', 'esicup', 'instances');
const RESULTS_DIR = path.join(ROOT, 'ml', 'benchmark', 'results');
const ARTIFACT_ROOT = path.join(ROOT, 'ml', 'artifacts', 'nest-benchmark');
const SMOKE_SCRIPT = path.join(ROOT, 'ml', 'scripts', 'run_app_smoke_test.sh');

const DEFAULT_RUNS = 3;
const DEFAULT_TIME_BUDGET_SEC = 120;
const DEFAULT_LABEL = 'benchmark';

const CLASSIC_AND_GARDEYN_ORDER = [
	'albano',
	'blaz1',
	'dagli',
	'fu',
	'jakobs1',
	'jakobs2',
	'mao',
	'marques',
	'shapes0',
	'shapes1',
	'shirts',
	'swim',
	'trousers',
	'gardeyn0',
	'gardeyn1',
	'gardeyn2',
	'gardeyn3',
	'gardeyn4',
	'gardeyn5',
	'gardeyn6',
	'gardeyn7',
	'gardeyn8',
	'gardeyn9'
];

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token.indexOf('--') !== 0) {
			continue;
		}
		const key = token.slice(2);
		const next = argv[i + 1];
		if (typeof next !== 'undefined' && next.indexOf('--') !== 0) {
			args[key] = next;
			i += 1;
		}
		else {
			args[key] = true;
		}
	}
	return args;
}

function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function sanitizeLabel(value) {
	return String(value || DEFAULT_LABEL).trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || DEFAULT_LABEL;
}

function timestamp() {
	return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
}

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
	ensureDir(path.dirname(file));
	fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function listInstances(selection) {
	if (!selection || selection === 'all') {
		return CLASSIC_AND_GARDEYN_ORDER.slice();
	}
	return String(selection).split(',').map(function (name) {
		return name.trim().replace(/\.json$/, '');
	}).filter(Boolean);
}

function gitCommit() {
	try {
		return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: ROOT,
			encoding: 'utf8'
		}).trim();
	}
	catch (err) {
		return null;
	}
}

function gitDirty() {
	try {
		const status = childProcess.execFileSync('git', ['status', '--short'], {
			cwd: ROOT,
			encoding: 'utf8'
		}).trim();
		return status.length > 0;
	}
	catch (err) {
		return null;
	}
}

function median(values) {
	if (!values.length) {
		return null;
	}
	const sorted = values.slice().sort(function (a, b) {
		return a - b;
	});
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) {
		return sorted[mid];
	}
	return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
	if (!values.length) {
		return null;
	}
	return values.reduce(function (sum, value) {
		return sum + value;
	}, 0) / values.length;
}

function rotationsForMeta(meta) {
	let rotations = 1;
	for (let i = 0; i < meta.items.length; i++) {
		rotations = Math.max(rotations, Number(meta.items[i].rotations) || 1);
	}
	return rotations;
}

function buildConfigPreset(rotations, fitnessVersion) {
	fitnessVersion = parseInt(fitnessVersion || 1, 10) === 2 ? 2 : 1;
	return {
		placementType: 'gravity',
		spacing: 0,
		mergeLines: false,
		processHoles: true,
		populationSize: 10,
		mutationRate: 10,
		rotations: rotations,
		fitnessVersion: fitnessVersion
	};
}

function runSmokeScenario(scenarioPath, timeoutMs) {
	const child = childProcess.spawnSync('bash', [
		SMOKE_SCRIPT,
		'--scenario',
		scenarioPath,
		'--timeoutMs',
		String(timeoutMs)
	], {
		cwd: ROOT,
		stdio: 'inherit'
	});

	if (child.error) {
		throw child.error;
	}
	if (child.status !== 0) {
		throw new Error('smoke scenario failed: ' + scenarioPath);
	}
}

function runBenchmark(options) {
	const label = sanitizeLabel(options.label || DEFAULT_LABEL);
	const runCount = Math.max(1, parseInt(options.runs || DEFAULT_RUNS, 10));
	const timeBudgetSec = Math.max(1, Number(options.timeBudgetSec || options['time-budget-sec'] || DEFAULT_TIME_BUDGET_SEC));
	const fitnessVersion = parseInt(options.fitnessVersion || options['fitness-version'] || 1, 10) === 2 ? 2 : 1;
	const selectedInstances = listInstances(options.instances || options.instance || 'all');
	const stamp = timestamp();
	const artifactRoot = path.join(ARTIFACT_ROOT, stamp + '-' + label);
	const resultPath = path.join(RESULTS_DIR, stamp + '-' + label + '.json');
	const benchmark = {
		label: label,
		createdAt: new Date().toISOString(),
		gitCommit: gitCommit(),
		gitDirty: gitDirty(),
		engineFlags: {
			protocol: 'sota-wp0',
			runsPerInstance: runCount,
			timeBudgetSec: timeBudgetSec,
			fitnessVersion: fitnessVersion,
			baseConfig: buildConfigPreset('<per-instance rotations>', fitnessVersion)
		},
		artifactRoot: artifactRoot,
		instances: [],
		aggregate: {
			meanMedianUtilization: null
		}
	};

	ensureDir(RESULTS_DIR);
	ensureDir(artifactRoot);

	for (let i = 0; i < selectedInstances.length; i++) {
		const name = selectedInstances[i];
		const instancePath = path.join(INSTANCE_DIR, name + '.json');
		if (!fs.existsSync(instancePath)) {
			throw new Error('missing benchmark instance: ' + instancePath);
		}

		const instance = readJson(instancePath);
		const converted = esicup.instanceToSvg(instance);
		const rotations = rotationsForMeta(converted.meta);
		const configOverrides = buildConfigPreset(rotations, fitnessVersion);
		const instanceResult = {
			name: converted.meta.name || name,
			file: path.relative(ROOT, instancePath),
			rotations: rotations,
			runs: [],
			median: null
		};

		for (let runIndex = 0; runIndex < runCount; runIndex++) {
			const runDir = path.join(artifactRoot, name, 'run-' + String(runIndex + 1).padStart(2, '0'));
			const inputPath = path.join(runDir, 'input.svg');
			const metaPath = path.join(runDir, 'meta.json');
			const outputPath = path.join(runDir, 'export.svg');
			const reportPath = path.join(runDir, 'report.json');
			const scenarioPath = path.join(runDir, 'scenario.json');

			ensureDir(runDir);
			fs.writeFileSync(inputPath, converted.svgText);
			writeJson(metaPath, converted.meta);
			writeJson(scenarioPath, {
				name: name + '-run-' + (runIndex + 1),
				input: inputPath,
				output: outputPath,
				report: reportPath,
				outputFormat: 'svg',
				timeBudgetSec: timeBudgetSec,
				captureUtilization: true,
				benchmarkMetaPath: metaPath,
				timeoutMs: Math.ceil((timeBudgetSec + 60) * 1000),
				configOverrides: configOverrides
			});

			console.log('[nest-benchmark]', name, 'run', runIndex + 1, 'of', runCount, 'budget', timeBudgetSec + 's');
			runSmokeScenario(scenarioPath, Math.ceil((timeBudgetSec + 60) * 1000));

			const report = readJson(reportPath);
			if (!report || report.status !== 'completed' || !report.details) {
				throw new Error('benchmark run did not complete: ' + reportPath);
			}
			if (typeof report.details.utilization !== 'number') {
				throw new Error('benchmark run missing utilization: ' + reportPath + (report.details.utilizationError ? ' ' + report.details.utilizationError : ''));
			}

			instanceResult.runs.push({
				runIndex: runIndex + 1,
				utilization: report.details.utilization,
				usedLength: report.details.usedLength,
				timeToBestSec: report.details.timeToBestSec,
				fitness: report.details.fitness,
				fitnessBreakdown: report.details.fitnessBreakdown,
				placementsDigest: report.details.placementsDigest,
				reportPath: path.relative(ROOT, reportPath),
				outputPath: path.relative(ROOT, outputPath)
			});

			writeJson(resultPath, benchmark);
		}

		instanceResult.median = median(instanceResult.runs.map(function (run) {
			return run.utilization;
		}));
		benchmark.instances.push(instanceResult);
		benchmark.aggregate.meanMedianUtilization = mean(benchmark.instances.map(function (entry) {
			return entry.median;
		}).filter(function (value) {
			return typeof value === 'number';
		}));
		writeJson(resultPath, benchmark);
	}

	console.log('[nest-benchmark] wrote', path.relative(ROOT, resultPath));
	return benchmark;
}

if (require.main === module) {
	try {
		runBenchmark(parseArgs(process.argv.slice(2)));
	}
	catch (err) {
		console.error(err && err.stack ? err.stack : err);
		process.exit(1);
	}
}

module.exports = {
	runBenchmark: runBenchmark
};

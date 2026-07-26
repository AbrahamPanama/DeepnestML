'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const GOLDEN_PATH = path.join(__dirname, 'golden.json');
const DEFAULT_SCENARIOS = [
	'svg-gravity',
	'svg-gravity-improved-scoring',
	'svg-gravity-sheet-margin-outline',
	'svg-hull',
	'svg-gravity-merge',
	'svg-gravity-processholes-off',
	'svg-gravity-simplify',
	'svg-steprepeat',
	'svg-export-pdf'
];

function parseArgs(argv) {
	const args = {
		update: false,
		scenarios: []
	};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === '--update') {
			args.update = true;
		}
		else if (token === '--scenario') {
			args.scenarios.push(argv[++i]);
		}
		else if (token.indexOf('--scenario=') === 0) {
			args.scenarios.push(token.slice('--scenario='.length));
		}
		else {
			throw new Error('unknown argument: ' + token);
		}
	}
	return args;
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function scenarioPath(name) {
	if (path.isAbsolute(name)) {
		return name;
	}
	if (fs.existsSync(name)) {
		return path.resolve(name);
	}
	const candidate = path.join(ROOT, 'ml', 'smoke', 'scenarios', name + '.json');
	if (fs.existsSync(candidate)) {
		return candidate;
	}
	throw new Error('unknown scenario: ' + name);
}

function stableConfigOverrides(scenario) {
	const overrides = Object.assign({}, scenario.configOverrides || {});
	overrides.populationSize = 1;
	overrides.mutationRate = 0;
	overrides.threads = 1;
	overrides.rotations = 1;
	overrides.localRefinement = false;
	overrides.localRefinementEngine = 'slide';
	overrides.localRefinementBudgetMs = 1500;
	overrides.localRefinementRotations = false;
	overrides.localRefinementMaxColdAnglesPerPart = 3;
	overrides.superpartClustering = false;
	return overrides;
}

function runScenario(name, workRoot) {
	const originalPath = scenarioPath(name);
	const scenario = readJson(originalPath);
	const scenarioName = scenario.name || path.basename(originalPath, '.json');
	const tempScenario = Object.assign({}, scenario, {
		name: scenarioName,
		configOverrides: stableConfigOverrides(scenario)
	});
	const scenarioFile = path.join(workRoot, scenarioName + '.json');
	const scenarioDir = path.join(workRoot, scenarioName);
	const outputFormat = String(tempScenario.outputFormat || 'svg').toLowerCase();
	const outputPath = path.join(scenarioDir, 'export.' + outputFormat);
	const reportPath = path.join(scenarioDir, 'report.json');

	fs.mkdirSync(scenarioDir, { recursive: true });
	writeJson(scenarioFile, tempScenario);

	const script = path.join(ROOT, 'ml', 'scripts', 'run_app_smoke_test.sh');
	const result = childProcess.spawnSync('bash', [
		script,
		'--scenario', scenarioFile,
		'--output', outputPath,
		'--report', reportPath
	], {
		cwd: ROOT,
		stdio: 'inherit',
		env: Object.assign({}, process.env, {
			DEEPNEST_ENGINE_EQUIVALENCE: '1'
		})
	});

	if (result.status !== 0) {
		throw new Error('scenario failed: ' + scenarioName);
	}

	const report = readJson(reportPath);
	if (!report || report.status !== 'completed' || !report.details || !report.details.placementsDigest) {
		throw new Error('scenario missing placement digest: ' + scenarioName);
	}

	return {
		name: scenarioName,
		placementsDigest: report.details.placementsDigest,
		fingerprint: crypto.createHash('sha1').update(JSON.stringify({
			name: scenarioName,
			digest: report.details.placementsDigest
		})).digest('hex')
	};
}

function run() {
	const args = parseArgs(process.argv.slice(2));
	const scenarios = args.scenarios.length > 0 ? args.scenarios : DEFAULT_SCENARIOS;
	const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepnest-engine-equivalence-'));
	const results = {};

	scenarios.forEach((scenario) => {
		const result = runScenario(scenario, workRoot);
		results[result.name] = {
			placementsDigest: result.placementsDigest,
			fingerprint: result.fingerprint
		};
	});

	const actual = {
		version: 1,
		description: 'Default-flag placement digests for Deepnest engine equivalence.',
		scenarios: results
	};

	if (args.update) {
		writeJson(GOLDEN_PATH, actual);
		console.log('engine equivalence golden updated:', GOLDEN_PATH);
		return;
	}

	if (!fs.existsSync(GOLDEN_PATH)) {
		throw new Error('missing golden file; run with --update after intentionally accepting default behavior');
	}

	const expected = readJson(GOLDEN_PATH);
	const expectedText = JSON.stringify(expected.scenarios || {});
	const actualText = JSON.stringify(actual.scenarios || {});
	if (expectedText !== actualText) {
		console.error('expected:', JSON.stringify(expected.scenarios, null, 2));
		console.error('actual:', JSON.stringify(actual.scenarios, null, 2));
		throw new Error('engine equivalence digests changed');
	}

	console.log('engine equivalence tests passed');
}

run();

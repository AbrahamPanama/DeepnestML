'use strict';

const childProcess = require('child_process');
const path = require('path');

function printHelp() {
	console.log([
		'Usage: node ml/cli/run_teacher.js --job <job.json> [--output-dir <dir>] [--run-id <id>] [--seed <n>] [--electron-binary <path>]',
		'',
		'Runs a canonical ML job through the existing Deepnest solver using a hidden Electron teacher harness.',
		'',
		'Required:',
		'  --job         Path to a canonical job JSON file',
		'',
		'Optional:',
		'  --output-dir  Directory that will receive job.json, result.json, events.jsonl, and manifest.json',
		'  --run-id      Override the generated run id',
		'  --seed        Override the seed stored in the canonical job',
		'  --electron-binary  Use a specific Electron executable instead of requiring the npm package',
		'',
		'Environment:',
		'  DEEPNEST_ELECTRON_BINARY  Path to a legacy Electron binary'
	].join('\n'));
}

function parseArgs(argv) {
	var parsed = {};

	for (var i = 0; i < argv.length; i++) {
		var token = argv[i];

		if (token === '--help' || token === '-h') {
			parsed.help = true;
			continue;
		}

		if (token.indexOf('--') !== 0) {
			continue;
		}

		var key = token.slice(2);
		var next = argv[i + 1];
		if (typeof next !== 'undefined' && next.indexOf('--') !== 0) {
			parsed[key] = next;
			i += 1;
		} else {
			parsed[key] = true;
		}
	}

	return parsed;
}

function pickArg(args, camelName, dashedName) {
	if (typeof args[camelName] !== 'undefined') {
		return args[camelName];
	}

	return args[dashedName];
}

function main() {
	var args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		process.exit(0);
	}

	if (!args.job) {
		printHelp();
		process.exit(1);
	}

	var electronBinary;
	var explicitElectronBinary = pickArg(args, 'electronBinary', 'electron-binary');
	var explicitOutputDir = pickArg(args, 'outputDir', 'output-dir');
	var explicitRunId = pickArg(args, 'runId', 'run-id');

	if (explicitElectronBinary) {
		electronBinary = path.resolve(explicitElectronBinary);
	} else if (process.env.DEEPNEST_ELECTRON_BINARY) {
		electronBinary = path.resolve(process.env.DEEPNEST_ELECTRON_BINARY);
	} else {
		try {
			electronBinary = require('electron');
		} catch (error) {
			console.error('Provide --electron-binary or DEEPNEST_ELECTRON_BINARY when the npm "electron" package is not installed.');
			process.exit(1);
		}
	}

	var cliArgs = [
		path.join(__dirname, '../teacher-main.js'),
		'--job',
		path.resolve(args.job)
	];

	if (explicitOutputDir) {
		cliArgs.push('--outputDir', path.resolve(explicitOutputDir));
	}

	if (explicitRunId) {
		cliArgs.push('--runId', explicitRunId);
	}

	if (args.seed) {
		cliArgs.push('--seed', String(args.seed));
	}

	var child = childProcess.spawn(electronBinary, cliArgs, {
		cwd: path.join(__dirname, '../..'),
		env: Object.assign({}, process.env, {
			ApplePersistenceIgnoreState: 'YES'
		}),
		stdio: 'inherit'
	});

	child.on('close', function onClose(code) {
		process.exit(code);
	});
}

main();

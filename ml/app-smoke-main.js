'use strict';

const electron = require('electron');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const electronSettings = require('electron-settings');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;

let backgroundWindow = null;
let mainWindow = null;
let smokePayload = null;
let windowsReady = {
	background: false,
	main: false
};
let backgroundBusy = false;
const backgroundQueue = [];
let nativeAddon = null;
let nativeAddonLoadError = null;
let localConverterPythonBin = null;
const projectRoot = path.join(__dirname, '..');
const localConverterScriptPath = path.join(projectRoot, 'scripts', 'conversion', 'local-convert.py');

function parseArgs(argv) {
	var parsed = {};
	for (var i = 0; i < argv.length; i++) {
		var token = argv[i];
		if (token.indexOf('--') !== 0) {
			continue;
		}
		var key = token.slice(2);
		var next = argv[i + 1];
		if (typeof next !== 'undefined' && next.indexOf('--') !== 0) {
			parsed[key] = next;
			i += 1;
		}
		else {
			parsed[key] = true;
		}
	}
	return parsed;
}

function resolveScenarioPath(name) {
	if (!name) {
		return null;
	}
	if (path.isAbsolute(name) && fs.existsSync(name)) {
		return name;
	}
	if (fs.existsSync(name)) {
		return path.resolve(name);
	}
	var candidate = path.join(projectRoot, 'ml', 'smoke', 'scenarios', name);
	if (fs.existsSync(candidate)) {
		return candidate;
	}
	candidate = path.join(projectRoot, 'ml', 'smoke', 'scenarios', name + '.json');
	if (fs.existsSync(candidate)) {
		return candidate;
	}
	throw new Error('unknown-smoke-scenario: ' + name);
}

function loadScenario(name) {
	if (!name) {
		return {};
	}
	var scenarioPath = resolveScenarioPath(name);
	var scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
	scenario.__path = scenarioPath;
	scenario.__dir = path.dirname(scenarioPath);
	if (!scenario.name) {
		scenario.name = path.basename(scenarioPath, path.extname(scenarioPath));
	}
	return scenario;
}

function resolveInputPath(value, baseDir) {
	if (!value) {
		return '';
	}
	if (path.isAbsolute(value)) {
		return value;
	}
	return path.resolve(baseDir || process.cwd(), value);
}

function resolveProjectPath(value) {
	if (!value) {
		return '';
	}
	if (path.isAbsolute(value)) {
		return value;
	}
	return path.resolve(projectRoot, value);
}

function normalizeFormat(value, fallback) {
	if (!value) {
		return fallback || '';
	}
	return String(value).trim().toLowerCase().replace(/^\./, '');
}

function defaultScenarioOutputPath(scenarioName, outputFormat) {
	return path.join(projectRoot, 'ml', 'artifacts', 'smoke', scenarioName, 'export.' + outputFormat);
}

function defaultScenarioReportPath(scenarioName) {
	return path.join(projectRoot, 'ml', 'artifacts', 'smoke', scenarioName, 'report.json');
}

function maybeStartSmoke() {
	if (!windowsReady.background || !windowsReady.main || !mainWindow || !smokePayload) {
		return;
	}
	mainWindow.webContents.send('app-smoke-test-start', smokePayload);
}

function dispatchBackgroundQueue() {
	if (!backgroundWindow || !windowsReady.background || backgroundBusy || backgroundQueue.length === 0) {
		return;
	}
	backgroundBusy = true;
	backgroundWindow.webContents.send('background-start', backgroundQueue.shift());
}

function createWindowPreferences() {
	return {
		nodeIntegration: true,
		contextIsolation: false,
		sandbox: false
	};
}

function createBackgroundWindow() {
	backgroundWindow = new BrowserWindow({
		show: false,
		webPreferences: createWindowPreferences()
	});
	backgroundWindow.loadURL(url.format({
		pathname: path.join(__dirname, '../main/background.html'),
		protocol: 'file:',
		slashes: true
	}));
	backgroundWindow.webContents.once('did-finish-load', function () {
		windowsReady.background = true;
		dispatchBackgroundQueue();
		maybeStartSmoke();
	});
}

function createMainWindow() {
	mainWindow = new BrowserWindow({
		show: false,
		webPreferences: createWindowPreferences()
	});
	mainWindow.loadURL(url.format({
		pathname: path.join(__dirname, '../main/index.html'),
		protocol: 'file:',
		slashes: true
	}));
	mainWindow.webContents.once('did-finish-load', function () {
		windowsReady.main = true;
		maybeStartSmoke();
	});
}

function destroyAllWindows() {
	if (backgroundWindow) {
		backgroundWindow.destroy();
		backgroundWindow = null;
	}
	if (mainWindow) {
		mainWindow.destroy();
		mainWindow = null;
	}
}

function handleSettingsOperation(operation, args) {
	var opArgs = Array.isArray(args) ? args : [];

	if (operation === 'defaults') {
		return electronSettings.defaults.apply(electronSettings, opArgs);
	}
	if (operation === 'getSync') {
		return electronSettings.getSync.apply(electronSettings, opArgs);
	}
	if (operation === 'setSync') {
		return electronSettings.setSync.apply(electronSettings, opArgs);
	}
	if (operation === 'resetToDefaultsSync') {
		return electronSettings.resetToDefaultsSync.apply(electronSettings, opArgs);
	}

	throw new Error('unsupported-settings-operation');
}

function ensureDirectory(dirPath) {
	if (!dirPath || fs.existsSync(dirPath)) {
		return;
	}
	ensureDirectory(path.dirname(dirPath));
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath);
	}
}

function loadNativeAddon() {
	if (nativeAddon) {
		return nativeAddon;
	}

	var candidates = [
		path.join(__dirname, '../build/Release/addon'),
		path.join(__dirname, '../build/Release/addon.node'),
		path.join(__dirname, '../minkowski/Release/addon'),
		path.join(__dirname, '../minkowski/Release/addon.node')
	];
	var lastError = null;

	for (var i = 0; i < candidates.length; i++) {
		try {
			nativeAddon = require(candidates[i]);
			nativeAddonLoadError = null;
			return nativeAddon;
		}
		catch (err) {
			lastError = err;
		}
	}

	nativeAddon = null;
	nativeAddonLoadError = lastError ? lastError.message : 'native-addon-unavailable';
	return null;
}

function getPythonCandidates() {
	var interpreters = [
		process.env.DEEPNEST_PYTHON_BIN,
		process.env.PYTHON3,
		process.env.PYTHON,
		'python3',
		'/Library/Developer/CommandLineTools/usr/bin/python3',
		'/usr/bin/python3'
	];
	var deduped = [];
	for (var i = 0; i < interpreters.length; i++) {
		if (interpreters[i] && deduped.indexOf(interpreters[i]) < 0) {
			deduped.push(interpreters[i]);
		}
	}

	var candidates = [];
	for (var j = 0; j < deduped.length; j++) {
		candidates.push({
			label: deduped[j],
			command: deduped[j],
			argsPrefix: []
		});
	}

	if (process.platform === 'darwin' && fs.existsSync('/usr/bin/arch')) {
		for (var k = 0; k < deduped.length; k++) {
			candidates.push({
				label: 'arch -arm64 ' + deduped[k],
				command: '/usr/bin/arch',
				argsPrefix: ['-arm64', deduped[k]]
			});
		}
	}

	return candidates;
}

function runConverterDoctor(candidate) {
	try {
		var stdout = childProcess.execFileSync(candidate.command, (candidate.argsPrefix || []).concat([
			localConverterScriptPath,
			'--mode',
			'doctor'
		]), {
			maxBuffer: 4 * 1024 * 1024
		});
		var text = String(stdout || '').trim();
		var report = text ? JSON.parse(text) : null;
		return {
			ok: !!(report && report.ready),
			report: report,
			error: report && report.ready ? null : (report && report.errors ? JSON.stringify(report.errors) : 'converter-doctor-failed')
		};
	}
	catch (err) {
		return {
			ok: false,
			report: null,
			error: err && err.message ? err.message : String(err)
		};
	}
}

function resolveLocalConverterPython() {
	if (localConverterPythonBin) {
		return {
			ok: true,
			pythonBin: localConverterPythonBin,
			report: localConverterPythonBin.report || null
		};
	}

	var candidates = getPythonCandidates();
	for (var i = 0; i < candidates.length; i++) {
		var doctor = runConverterDoctor(candidates[i]);
		if (doctor.ok) {
			localConverterPythonBin = {
				label: candidates[i].label,
				command: candidates[i].command,
				argsPrefix: candidates[i].argsPrefix || [],
				report: doctor.report || null
			};
			return {
				ok: true,
				pythonBin: localConverterPythonBin,
				report: doctor.report || null
			};
		}
	}

	return {
		ok: false,
		error: 'no-compatible-python'
	};
}

function unlinkIfExists(filePath) {
	try {
		if (filePath && fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	}
	catch (err) {}
}

function runLocalConversion(payload) {
	var request = payload || {};
	var sourceFormat = normalizeFormat(request.sourceFormat);
	var targetFormat = normalizeFormat(request.targetFormat);
	var inputBase64 = request.inputBase64;
	var optionsJson = request.options ? JSON.stringify(request.options) : null;

	if (!sourceFormat || !targetFormat) {
		return { ok: false, error: 'invalid-format-request' };
	}

	var mode = sourceFormat + '-to-' + targetFormat;
	var supported = mode === 'pdf-to-svg' ||
		mode === 'svg-to-pdf' ||
		mode === 'png-to-svg' ||
		mode === 'jpg-to-svg' ||
		mode === 'jpeg-to-svg';
	if (!supported) {
		return { ok: false, error: 'unsupported-local-conversion' };
	}

	if (!inputBase64 || typeof inputBase64 !== 'string') {
		return { ok: false, error: 'missing-input-data' };
	}

	if (!fs.existsSync(localConverterScriptPath)) {
		return { ok: false, error: 'local-converter-script-missing' };
	}

	var pythonResolution = resolveLocalConverterPython();
	if (!pythonResolution || pythonResolution.ok !== true) {
		return {
			ok: false,
			error: 'local-converter-python-unavailable',
			details: pythonResolution && pythonResolution.error ? pythonResolution.error : 'no-compatible-python'
		};
	}

	var pythonCandidate = pythonResolution.pythonBin;
	var token = Date.now() + '-' + Math.floor(Math.random() * 1e8);
	var tempRoot = path.join(os.tmpdir(), 'deepnest-conversion');
	ensureDirectory(tempRoot);
	var inputPath = path.join(tempRoot, 'input-' + token + '.' + sourceFormat);
	var outputPath = path.join(tempRoot, 'output-' + token + '.' + targetFormat);

	try {
		fs.writeFileSync(inputPath, Buffer.from(inputBase64, 'base64'));
		var args = (pythonCandidate.argsPrefix || []).concat([
			localConverterScriptPath,
			'--mode',
			mode,
			'--input',
			inputPath,
			'--output',
			outputPath
		]);
		if (optionsJson) {
			args.push('--options', optionsJson);
		}

		childProcess.execFileSync(pythonCandidate.command, args, {
			maxBuffer: 64 * 1024 * 1024
		});

		if (!fs.existsSync(outputPath)) {
			return { ok: false, error: 'local-converter-produced-no-output' };
		}

		var output = fs.readFileSync(outputPath);
		if (targetFormat === 'svg') {
			return {
				ok: true,
				targetFormat: targetFormat,
				outputText: output.toString('utf8')
			};
		}

		return {
			ok: true,
			targetFormat: targetFormat,
			outputBase64: output.toString('base64')
		};
	}
	catch (err) {
		var details = [];
		if (err && err.stderr) {
			details.push(String(err.stderr).trim());
		}
		if (err && err.stdout) {
			details.push(String(err.stdout).trim());
		}
		return {
			ok: false,
			error: err && err.message ? err.message : String(err),
			details: details.join('\n').trim() || null
		};
	}
	finally {
		unlinkIfExists(inputPath);
		unlinkIfExists(outputPath);
	}
}

app.commandLine.appendSwitch('--enable-precise-memory-info');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.on('ready', function () {
	var cliArgs = parseArgs(process.argv.slice(2));
	var scenario;
	try {
		scenario = loadScenario(cliArgs.scenario || '');
	}
	catch (err) {
		console.error(err && err.message ? err.message : String(err));
		app.exit(1);
		return;
	}

	var scenarioName = cliArgs.scenarioName || scenario.name || 'ad-hoc';
	var scenarioBaseDir = scenario.__dir || projectRoot;
	var outputFormat = normalizeFormat(cliArgs.outputFormat || scenario.outputFormat, 'svg');
	var inputValue = cliArgs.input || scenario.inputPath || scenario.input;
	var outputValue = cliArgs.output || scenario.outputPath || scenario.output;
	var reportValue = cliArgs.report || scenario.reportPath || scenario.report;
	var inputPath = inputValue ? (scenario.__path && !cliArgs.input ? resolveProjectPath(inputValue) : resolveInputPath(inputValue, process.cwd())) : '';
	var outputPath = outputValue ? resolveInputPath(outputValue, scenarioBaseDir) : defaultScenarioOutputPath(scenarioName, outputFormat);
	var reportPath = reportValue ? resolveInputPath(reportValue, scenarioBaseDir) : defaultScenarioReportPath(scenarioName);
	var sourceFormat = normalizeFormat(cliArgs.sourceFormat || scenario.sourceFormat, inputPath ? path.extname(inputPath).replace(/^\./, '') : 'svg');

	if (!inputPath || !outputPath) {
		console.error('app smoke test requires --input and --output, or --scenario with an input');
		app.exit(1);
		return;
	}

	smokePayload = {
		scenarioName: scenarioName,
		inputPath: inputPath,
		outputPath: outputPath,
		reportPath: reportPath || '',
		sourceFormat: sourceFormat,
		outputFormat: outputFormat,
		configOverrides: scenario.configOverrides || {},
		conversionOptions: scenario.conversionOptions || null,
		expect: scenario.expect || {},
		timeoutMs: cliArgs.timeoutMs || cliArgs.timeout || scenario.timeoutMs || '60000',
		mlMode: cliArgs.mlMode || scenario.mlMode || '',
		mlModelPath: cliArgs.mlModelPath || scenario.mlModelPath || ''
	};

	createBackgroundWindow();
	createMainWindow();
});

app.on('window-all-closed', function () {
	app.quit();
});

ipcMain.on('background-start', function (event, payload) {
	backgroundQueue.push(payload);
	dispatchBackgroundQueue();
});

ipcMain.on('background-response', function (event, payload) {
	backgroundBusy = false;
	if (mainWindow) {
		mainWindow.webContents.send('background-response', payload);
	}
	dispatchBackgroundQueue();
});

ipcMain.on('background-progress', function (event, payload) {
	if (mainWindow) {
		mainWindow.webContents.send('background-progress', payload);
	}
});

ipcMain.on('background-stop', function () {
	backgroundQueue.length = 0;
	backgroundBusy = false;
	if (backgroundWindow) {
		backgroundWindow.destroy();
		backgroundWindow = null;
	}
});

ipcMain.on('settings-op-sync', function (event, operation, args) {
	try {
		event.returnValue = {
			ok: true,
			value: handleSettingsOperation(operation, args)
		};
	}
	catch (err) {
		event.returnValue = {
			ok: false,
			error: err && err.message ? err.message : String(err)
		};
	}
});

ipcMain.on('nfp-cache-path-sync', function (event) {
	try {
		var cachePath = path.join(app.getPath('userData'), 'nfpcache');
		ensureDirectory(cachePath);
		event.returnValue = {
			ok: true,
			path: cachePath
		};
	}
	catch (err) {
		event.returnValue = {
			ok: false,
			error: err && err.message ? err.message : String(err)
		};
	}
});

// Mirror the rehomed NFP cache IPC so the background renderer's new
// window.db methods work under the smoke harness. Smoke runs only use one
// background window, so there are no writer races to worry about, but the
// handlers still have to exist or sendSync returns undefined and db.has /
// db.find would never report a hit against the disk cache.
var smokeNfpCacheManifest = null;
var SMOKE_NFP_VERSION = 2;
var SMOKE_NFP_MANIFEST = 'manifest-v2.json';
var SMOKE_NFP_MAX_ENTRIES = 2500;
var SMOKE_NFP_MAX_BYTES = 128 * 1024 * 1024;

function smokeNfpDir() {
	var dir = path.join(app.getPath('userData'), 'nfpcache');
	ensureDirectory(dir);
	return dir;
}

function smokeNfpLoadManifest() {
	if (smokeNfpCacheManifest) {
		return smokeNfpCacheManifest;
	}
	var manifestPath = path.join(smokeNfpDir(), SMOKE_NFP_MANIFEST);
	try {
		if (fs.existsSync(manifestPath)) {
			var loaded = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
			if (loaded && loaded.version === SMOKE_NFP_VERSION && loaded.entries) {
				smokeNfpCacheManifest = loaded;
				return smokeNfpCacheManifest;
			}
		}
	}
	catch (err) {}
	smokeNfpCacheManifest = { version: SMOKE_NFP_VERSION, entries: {} };
	return smokeNfpCacheManifest;
}

function smokeNfpWriteManifest() {
	var manifestPath = path.join(smokeNfpDir(), SMOKE_NFP_MANIFEST);
	var tmpPath = manifestPath + '.tmp';
	try {
		fs.writeFileSync(tmpPath, JSON.stringify(smokeNfpCacheManifest));
		fs.renameSync(tmpPath, manifestPath);
	}
	catch (err) {}
}

ipcMain.on('nfp-cache-has-sync', function (event, key) {
	var manifest = smokeNfpLoadManifest();
	var entry = key && manifest.entries[key];
	event.returnValue = !!(entry && fs.existsSync(path.join(smokeNfpDir(), entry.file)));
});

ipcMain.on('nfp-cache-find-sync', function (event, key) {
	if (!key) {
		event.returnValue = null;
		return;
	}
	var manifest = smokeNfpLoadManifest();
	var entry = manifest.entries[key];
	if (!entry) {
		event.returnValue = null;
		return;
	}
	var filePath = path.join(smokeNfpDir(), entry.file);
	if (!fs.existsSync(filePath)) {
		delete manifest.entries[key];
		smokeNfpWriteManifest();
		event.returnValue = null;
		return;
	}
	try {
		var payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
		if (!payload || payload.version !== SMOKE_NFP_VERSION || payload.key !== key || !payload.nfp) {
			event.returnValue = null;
			return;
		}
		entry.lastAccess = Date.now();
		event.returnValue = payload.nfp;
	}
	catch (err) {
		event.returnValue = null;
	}
});

ipcMain.on('nfp-cache-insert', function (event, message) {
	if (!message || !message.key || !message.nfp) {
		return;
	}
	var manifest = smokeNfpLoadManifest();
	var dir = smokeNfpDir();
	var file = message.key + '.json';
	var payload = {
		version: SMOKE_NFP_VERSION,
		key: message.key,
		nfp: message.nfp
	};
	var json;
	try { json = JSON.stringify(payload); } catch (e) { return; }
	try {
		fs.writeFileSync(path.join(dir, file), json);
		manifest.entries[message.key] = {
			file: file,
			bytes: Buffer.byteLength(json, 'utf8'),
			lastAccess: Date.now()
		};
		// Best-effort prune so smoke runs do not explode the cache dir.
		var keys = Object.keys(manifest.entries);
		var totalBytes = 0;
		for (var i = 0; i < keys.length; i++) {
			totalBytes += Number(manifest.entries[keys[i]].bytes || 0);
		}
		if (keys.length > SMOKE_NFP_MAX_ENTRIES || totalBytes > SMOKE_NFP_MAX_BYTES) {
			keys.sort(function (a, b) {
				return Number(manifest.entries[a].lastAccess || 0) - Number(manifest.entries[b].lastAccess || 0);
			});
			while (keys.length > 0 && (keys.length > SMOKE_NFP_MAX_ENTRIES || totalBytes > SMOKE_NFP_MAX_BYTES)) {
				var victim = keys.shift();
				var ventry = manifest.entries[victim];
				if (!ventry) { continue; }
				try { fs.unlinkSync(path.join(dir, ventry.file)); } catch (e) {}
				totalBytes -= Number(ventry.bytes || 0);
				delete manifest.entries[victim];
			}
		}
		smokeNfpWriteManifest();
	}
	catch (err) {}
});

ipcMain.on('conversion-run-sync', function (event, payload) {
	event.returnValue = runLocalConversion(payload);
});

if (typeof ipcMain.handle === 'function') {
	ipcMain.handle('conversion-run', function (event, payload) {
		return Promise.resolve(runLocalConversion(payload));
	});
}

ipcMain.on('conversion-health-sync', function (event) {
	if (!fs.existsSync(localConverterScriptPath)) {
		event.returnValue = { ok: true, available: false, error: 'local-converter-script-missing' };
		return;
	}
	var resolution = resolveLocalConverterPython();
	if (!resolution || resolution.ok !== true) {
		event.returnValue = {
			ok: true,
			available: false,
			error: resolution && resolution.error ? resolution.error : 'no-compatible-python'
		};
		return;
	}
	event.returnValue = {
		ok: true,
		available: true,
		pythonBin: resolution.pythonBin.label,
		report: resolution.report
	};
});

if (typeof ipcMain.handle === 'function') {
	ipcMain.handle('conversion-health', function () {
		var event = { returnValue: null };
		ipcMain.emit('conversion-health-sync', event);
		return Promise.resolve(event.returnValue);
	});
}

ipcMain.on('minkowski-calculate-nfp-sync', function (event, payload) {
	var addon = loadNativeAddon();
	if (!addon || typeof addon.calculateNFP !== 'function') {
		event.returnValue = {
			ok: false,
			error: nativeAddonLoadError || 'native-addon-unavailable'
		};
		return;
	}

	try {
		event.returnValue = {
			ok: true,
			value: addon.calculateNFP({
				A: payload && payload.A ? payload.A : [],
				B: payload && payload.B ? payload.B : []
			})
		};
	}
	catch (err) {
		event.returnValue = {
			ok: false,
			error: err && err.message ? err.message : String(err)
		};
	}
});

ipcMain.on('app-smoke-test-finished', function (event, payload) {
	destroyAllWindows();
	app.exit(payload && payload.status === 'completed' ? 0 : 1);
});

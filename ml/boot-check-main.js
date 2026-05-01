'use strict';

// Headless boot-check for Deepnest ML.
//
// Boots main/index.html in a hidden window under Electron, waits for the
// renderer to expose the DeepNest + DeepNestAutomation globals, runs a DOM
// invariants snippet via webContents.executeJavaScript, writes a JSON
// report, and exits.
//
// Intentionally does NOT:
//   - open the background renderer
//   - load the native Minkowski addon
//   - run any nesting, import, or export
//
// This is a fast (~2-3s) "did the UI boot cleanly?" probe. The full
// smoke harness at ml/app-smoke-main.js is the right tool when you
// want to validate the nesting pipeline end-to-end.
//
// Invocation (from repo root):
//   ./node_modules/.bin/electron ml/boot-check-main.js \
//       --report /tmp/deepnest-logs/boot-check.json \
//       [--timeoutMs 10000]
//
// Exit codes:
//   0  all invariants passed
//   1  one or more invariants failed
//   2  renderer did not become ready in time (timeout)
//   3  renderer crashed during boot
//   4  bad CLI args or internal error

const electron = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const bootCheckUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'deepnest-boot-check-'));

// Keep this probe isolated from the user's real Deepnest ML preferences. The
// default-option invariants should describe a fresh boot, not whatever profile
// the user last selected in the app.
app.setPath('userData', bootCheckUserData);

const electronSettings = require('electron-settings');

const DEFAULT_TIMEOUT_MS = 10000;
const READINESS_POLL_MS = 100;

function parseArgs(argv) {
	const parsed = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token.indexOf('--') !== 0) {
			continue;
		}
		const key = token.slice(2);
		const next = argv[i + 1];
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

function log(msg) {
	// Write to stderr so the renderer's console output (which also goes to
	// stderr in some Electron versions) doesn't get jumbled with our
	// status lines if anyone greps for them.
	process.stderr.write('[boot-check] ' + msg + '\n');
}

function writeReport(reportPath, payload) {
	if (!reportPath) {
		return;
	}
	try {
		fs.mkdirSync(path.dirname(reportPath), { recursive: true });
		fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2) + '\n');
	}
	catch (err) {
		log('could not write report to ' + reportPath + ': ' + (err && err.message));
	}
}

function sleep(ms) {
	return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function cleanupBootCheckUserData() {
	try {
		fs.rmSync(bootCheckUserData, { recursive: true, force: true });
	}
	catch (err) {
		// Best-effort cleanup only; a stale temp directory should never change
		// the boot-check verdict.
	}
}

function handleSettingsOperation(operation, args) {
	const opArgs = Array.isArray(args) ? args : [];

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

function installBootCheckIpcHandlers() {
	// main/index.html uses the same synchronous settings bridge during
	// startup as the real app. Keep this harness-local clone narrow so the
	// boot check stays a UI boot probe, not a second app main process.
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
}

// This function is stringified and injected into the renderer. It must not
// close over anything from the main process. Returns a plain object.
function collectInvariantsInRenderer() {
	function textOfId(id) {
		const el = document.getElementById(id);
		return el ? (el.textContent || '').trim() : null;
	}

	function selectedOptionOf(selectName) {
		const sel = document.querySelector('select[name="' + selectName + '"]');
		if (!sel) return null;
		const opt = sel.options[sel.selectedIndex];
		if (!opt) return null;
		return { value: opt.value, text: (opt.textContent || '').trim() };
	}

	function selectedMarkupOptionOf(selectName) {
		const opt = document.querySelector('select[name="' + selectName + '"] option[selected]');
		if (!opt) return null;
		return { value: opt.value, text: (opt.textContent || '').trim() };
	}

	function sidenavIds() {
		const items = document.querySelectorAll('#sidenav > li');
		const out = [];
		for (let i = 0; i < items.length; i++) {
			out.push(items[i].id || '');
		}
		return out;
	}

	function exportDropdownIds() {
		const items = document.querySelectorAll('#export_wrapper .dropdown > li');
		const out = [];
		for (let i = 0; i < items.length; i++) {
			out.push(items[i].id || '');
		}
		return out;
	}

	function anyOptionsHaveDefaultAttr() {
		const opts = document.querySelectorAll('option');
		for (let i = 0; i < opts.length; i++) {
			if (opts[i].hasAttribute('default')) {
				return true;
			}
		}
		return false;
	}

	function computedOverflow(selector) {
		const el = document.querySelector(selector);
		if (!el) return null;
		const cs = window.getComputedStyle(el);
		// In some engines the shorthand `overflow` is empty when x/y
		// differ; fall back to overflowY which is what actually governs
		// vertical scroll behavior here.
		return cs.overflow || cs.overflowY || null;
	}

	function nestZoomApiShape() {
		if (!window.NestZoom) return null;
		return {
			hasSetZoom: typeof window.NestZoom.setZoom === 'function',
			hasReset: typeof window.NestZoom.reset === 'function',
			hasApplyToSvg: typeof window.NestZoom.applyToSvg === 'function',
			hasGetZoom: typeof window.NestZoom.getZoom === 'function',
			initialZoom: typeof window.NestZoom.getZoom === 'function' ? window.NestZoom.getZoom() : null
		};
	}

	return {
		ok: true,
		title: document.title,
		hasDeepNest: typeof window.DeepNest !== 'undefined',
		hasAutomation: typeof window.DeepNestAutomation === 'object' && window.DeepNestAutomation !== null,
		automationMethods: (typeof window.DeepNestAutomation === 'object' && window.DeepNestAutomation)
			? Object.keys(window.DeepNestAutomation)
			: [],
		sidenavIds: sidenavIds(),
		exportDropdownIds: exportDropdownIds(),
		hasAccountPage: !!document.getElementById('account'),
		hasPurchaseSingle: !!document.getElementById('purchaseSingle'),
		hasHomePage: !!document.getElementById('home'),
		hasConfigPage: !!document.getElementById('config'),
		hasInfoPage: !!document.getElementById('info'),
		placementType: selectedOptionOf('placementType'),
		dxfImportScale: selectedOptionOf('dxfImportScale'),
		dxfExportScale: selectedOptionOf('dxfExportScale'),
		placementTypeMarkupDefault: selectedMarkupOptionOf('placementType'),
		dxfImportScaleMarkupDefault: selectedMarkupOptionOf('dxfImportScale'),
		dxfExportScaleMarkupDefault: selectedMarkupOptionOf('dxfExportScale'),
		anyOptionsHaveDefaultAttr: anyOptionsHaveDefaultAttr(),
		readyStateSnapshot: document.readyState,
		startNestLabel: textOfId('startnest'),
		importButtonLabel: textOfId('import'),
		hasNestScroll: !!document.querySelector('#nestdisplay .nestscroll'),
		hasNestZoomtools: !!document.querySelector('#nestdisplay .nest-zoomtools'),
		hasLegacyZoomtoolsCollision: (function(){
			// True only if some .zoomtools lives INSIDE #nestdisplay (would
			// indicate the scoped rename regressed).
			return !!document.querySelector('#nestdisplay .zoomtools');
		})(),
		nestDisplayOverflow: computedOverflow('#nestdisplay'),
		nestScrollOverflow: computedOverflow('#nestdisplay .nestscroll'),
		nestZoomApi: nestZoomApiShape()
	};
}

// Evaluates invariants against the renderer snapshot and returns
// { passed, failed, errors: string[] }.
function evaluateInvariants(snapshot) {
	const failed = [];

	function assert(name, cond) {
		if (!cond) failed.push(name);
	}

	function arraysEqual(a, b) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
	}

	// Core boot invariants
	assert('title matches 0.7.1', snapshot.title === 'Deepnest ML 0.7.1');
	assert('DeepNest global present', snapshot.hasDeepNest);
	assert('DeepNestAutomation hook present', snapshot.hasAutomation);
	assert('DeepNestAutomation exposes runAppSmokeTest',
		snapshot.automationMethods.indexOf('runAppSmokeTest') >= 0);

	// UI audit regression guards
	assert('sidenav has exactly home/config/info',
		arraysEqual(snapshot.sidenavIds, ['home_tab', 'config_tab', 'info_tab']));
	assert('export dropdown has exactly svg/pdf/dxf',
		arraysEqual(snapshot.exportDropdownIds, ['exportsvg', 'exportpdf', 'exportdxf']));
	assert('orphan #account page is gone', !snapshot.hasAccountPage);
	assert('orphan #purchaseSingle link is gone', !snapshot.hasPurchaseSingle);
	assert('#home page present', snapshot.hasHomePage);
	assert('#config page present', snapshot.hasConfigPage);
	assert('#info page present', snapshot.hasInfoPage);

	// The three former `default` attribute fixes
	assert('placementType markup default is Gravity',
		snapshot.placementTypeMarkupDefault && snapshot.placementTypeMarkupDefault.value === 'gravity');
	assert('dxfImportScale markup default is Points (value=1)',
		snapshot.dxfImportScaleMarkupDefault && snapshot.dxfImportScaleMarkupDefault.value === '1');
	assert('dxfExportScale markup default is Points (value=72)',
		snapshot.dxfExportScaleMarkupDefault && snapshot.dxfExportScaleMarkupDefault.value === '72');
	assert('no <option> tags carry invalid `default` attribute',
		!snapshot.anyOptionsHaveDefaultAttr);

	// Nest-zoom structural invariants
	assert('#nestdisplay .nestscroll exists', snapshot.hasNestScroll);
	assert('#nestdisplay .nest-zoomtools exists', snapshot.hasNestZoomtools);
	assert('no legacy .zoomtools inside #nestdisplay',
		!snapshot.hasLegacyZoomtoolsCollision);
	assert('#nestdisplay overflow is hidden',
		snapshot.nestDisplayOverflow === 'hidden');
	assert('#nestdisplay .nestscroll overflow is auto or scroll',
		snapshot.nestScrollOverflow === 'auto' || snapshot.nestScrollOverflow === 'scroll');
	assert('NestZoom API present',
		snapshot.nestZoomApi &&
		snapshot.nestZoomApi.hasSetZoom &&
		snapshot.nestZoomApi.hasReset &&
		snapshot.nestZoomApi.hasApplyToSvg &&
		snapshot.nestZoomApi.hasGetZoom);
	assert('NestZoom initial zoom is 1',
		snapshot.nestZoomApi && snapshot.nestZoomApi.initialZoom === 1);

	return { failed: failed };
}

async function waitForRendererReady(webContents, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	const probe = 'Boolean(window.DeepNest) && typeof window.DeepNestAutomation === "object" && Boolean(window.DeepNestAutomation)';

	while (Date.now() < deadline) {
		let ready = false;
		try {
			ready = await webContents.executeJavaScript(probe);
		}
		catch (err) {
			// keep polling; a transient executeJavaScript error during early
			// bootstrap is not fatal
		}
		if (ready) {
			return true;
		}
		await sleep(READINESS_POLL_MS);
	}
	return false;
}

async function captureSnapshot(webContents) {
	const fnSource = collectInvariantsInRenderer.toString();
	const wrapped = '(' + fnSource + ')()';
	return await webContents.executeJavaScript(wrapped);
}

async function runBootCheck(cli) {
	const timeoutMs = Number(cli.timeoutMs || cli.timeout || DEFAULT_TIMEOUT_MS);
	const reportPath = cli.report || '';
	const startedAt = Date.now();

	const win = new BrowserWindow({
		show: false,
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			sandbox: false
		}
	});

	let rendererCrashed = null;
	win.webContents.on('render-process-gone', function (event, details) {
		rendererCrashed = details && details.reason ? details.reason : 'unknown';
	});

	const consoleMessages = [];
	win.webContents.on('console-message', function (event, level, message, line, sourceId) {
		consoleMessages.push({
			level: level,
			message: message,
			line: line,
			source: sourceId
		});
	});

	log('loading main/index.html ...');
	win.loadURL(url.format({
		pathname: path.join(__dirname, '..', 'main', 'index.html'),
		protocol: 'file:',
		slashes: true
	}));

	await new Promise(function (resolve) {
		win.webContents.once('did-finish-load', resolve);
	});
	log('document loaded, waiting for DeepNest readiness ...');

	const ready = await waitForRendererReady(win.webContents, timeoutMs);
	if (rendererCrashed) {
		log('renderer crashed: ' + rendererCrashed);
		const payload = {
			status: 'renderer-crashed',
			reason: rendererCrashed,
			elapsedMs: Date.now() - startedAt,
			consoleMessages: consoleMessages
		};
		writeReport(reportPath, payload);
		win.destroy();
		return 3;
	}
	if (!ready) {
		log('timed out after ' + timeoutMs + 'ms waiting for DeepNest globals');
		const payload = {
			status: 'timeout',
			timeoutMs: timeoutMs,
			elapsedMs: Date.now() - startedAt,
			consoleMessages: consoleMessages
		};
		writeReport(reportPath, payload);
		win.destroy();
		return 2;
	}

	log('renderer ready, capturing invariants snapshot ...');
	let snapshot;
	try {
		snapshot = await captureSnapshot(win.webContents);
	}
	catch (err) {
		log('snapshot capture failed: ' + (err && err.message));
		writeReport(reportPath, {
			status: 'snapshot-error',
			error: err && err.message ? err.message : String(err),
			elapsedMs: Date.now() - startedAt,
			consoleMessages: consoleMessages
		});
		win.destroy();
		return 4;
	}

	const verdict = evaluateInvariants(snapshot);
	const passed = verdict.failed.length === 0;

	const payload = {
		status: passed ? 'passed' : 'failed',
		elapsedMs: Date.now() - startedAt,
		failedInvariants: verdict.failed,
		snapshot: snapshot,
		consoleMessages: consoleMessages
	};
	writeReport(reportPath, payload);

	if (passed) {
		log('all invariants passed (' + payload.elapsedMs + 'ms)');
	}
	else {
		log('FAILED invariants:');
		for (let i = 0; i < verdict.failed.length; i++) {
			log('  - ' + verdict.failed[i]);
		}
	}

	win.destroy();
	return passed ? 0 : 1;
}

// In some Electron configurations, a stray IPC call to a non-existent
// handler could throw. Safe default: keep the process alive only until
// runBootCheck resolves.
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.once('will-quit', cleanupBootCheckUserData);

app.on('ready', async function () {
	const cli = parseArgs(process.argv.slice(2));
	let exitCode = 4;
	try {
		installBootCheckIpcHandlers();
		exitCode = await runBootCheck(cli);
	}
	catch (err) {
		log('fatal: ' + (err && err.stack ? err.stack : err));
		exitCode = 4;
	}
	app.exit(exitCode);
});

app.on('window-all-closed', function () {
	// Don't let the default quit fire before we've written the report.
	// runBootCheck owns the lifecycle.
});

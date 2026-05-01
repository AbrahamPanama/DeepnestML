'use strict';

const electron = require('electron');
const electronSettings = require('electron-settings');
const fs = require('fs');
const path = require('path');
const url = require('url');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;

let backgroundWindow = null;
let teacherWindow = null;
let teacherPayload = null;
let windowsReady = {
	background: false,
	teacher: false,
	automation: false
};
const debugLogPath = path.join(__dirname, 'teacher-main.debug.log');
const verboseDebug = process.env.DEEPNEST_TEACHER_DEBUG === '1';
let nativeAddon = null;
let nativeAddonLoadError = null;

function createWindowPreferences() {
	return {
		nodeIntegration: true,
		contextIsolation: false,
		sandbox: false
	};
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

function debugLog() {
	var line = [new Date().toISOString()];
	for (var i = 0; i < arguments.length; i++) {
		line.push(String(arguments[i]));
	}
	fs.appendFileSync(debugLogPath, line.join(' ') + '\n');
}

function logWindowLifecycle(windowRef, label) {
	windowRef.webContents.on('console-message', function onConsoleMessage(event, level, message, line, sourceId) {
		if (!verboseDebug) {
			return;
		}
		debugLog(label, 'console', level, message, sourceId + ':' + line);
		console.log(label + ' console[' + level + ']', message, sourceId + ':' + line);
	});

	windowRef.webContents.on('did-finish-load', function onDidFinishLoad() {
		debugLog(label, 'did-finish-load');
		console.log(label + ' did-finish-load');
	});

	windowRef.webContents.on('did-fail-load', function onDidFailLoad(event, errorCode, errorDescription, validatedURL) {
		debugLog(label, 'did-fail-load', errorCode, errorDescription, validatedURL);
		console.error(label + ' did-fail-load', errorCode, errorDescription, validatedURL);
	});

	windowRef.webContents.on('crashed', function onCrashed() {
		debugLog(label, 'renderer-crashed');
		console.error(label + ' renderer crashed');
	});

	windowRef.on('unresponsive', function onUnresponsive() {
		debugLog(label, 'unresponsive');
		console.error(label + ' became unresponsive');
	});
}

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
		} else {
			parsed[key] = true;
		}
	}

	return parsed;
}

function buildTeacherUrl() {
	return url.format({
		pathname: path.join(__dirname, '../main/index.html'),
		protocol: 'file:',
		slashes: true
	});
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

function maybeStartTeacher() {
	if (!teacherPayload || !windowsReady.background || !windowsReady.teacher || !windowsReady.automation || !teacherWindow) {
		return;
	}

	debugLog('starting-teacher-automation', JSON.stringify(teacherPayload));
	teacherWindow.webContents.send('canonical-teacher-start', teacherPayload);
}

function createBackgroundWindow() {
	debugLog('createBackgroundWindow');
	backgroundWindow = new BrowserWindow({
		show: false,
		webPreferences: createWindowPreferences()
	});
	logWindowLifecycle(backgroundWindow, 'background');

	backgroundWindow.loadURL(url.format({
		pathname: path.join(__dirname, '../main/background.html'),
		protocol: 'file:',
		slashes: true
	}));
	backgroundWindow.webContents.once('did-finish-load', function onBackgroundDidFinishLoad() {
		windowsReady.background = true;
		maybeStartTeacher();
	});
}

function createTeacherWindow() {
	debugLog('createTeacherWindow', buildTeacherUrl());
	teacherWindow = new BrowserWindow({
		show: false,
		webPreferences: createWindowPreferences()
	});
	logWindowLifecycle(teacherWindow, 'teacher');

	teacherWindow.loadURL(buildTeacherUrl());
	teacherWindow.webContents.once('did-finish-load', function onTeacherDidFinishLoad() {
		windowsReady.teacher = true;
		maybeStartTeacher();
	});
}

function destroyBackgroundWindow() {
	if (backgroundWindow) {
		backgroundWindow.destroy();
		backgroundWindow = null;
	}
}

// The headless teacher is a hidden automation window, so GPU acceleration only
// adds helper-process churn on Apple Silicon without providing value.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('--enable-precise-memory-info');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

process.on('uncaughtException', function onUncaughtException(error) {
	debugLog('uncaughtException', error && error.stack ? error.stack : error);
	console.error('teacher-main uncaughtException', error && error.stack ? error.stack : error);
	app.exit(1);
});

app.on('ready', function onReady() {
	var cliArgs = parseArgs(process.argv.slice(2));
	debugLog('app-ready', JSON.stringify(cliArgs));

	teacherPayload = {
		jobPath: cliArgs.job,
		outputDir: cliArgs.outputDir,
		runId: cliArgs.runId || '',
		seed: cliArgs.seed || ''
	};

	createBackgroundWindow();
	createTeacherWindow();
});

app.on('window-all-closed', function onAllClosed() {
	app.quit();
});

ipcMain.on('background-start', function onBackgroundStart(event, payload) {
	if (!backgroundWindow) {
		return;
	}

	backgroundWindow.webContents.send('background-start', payload);
});

ipcMain.on('background-response', function onBackgroundResponse(event, payload) {
	if (teacherWindow) {
		teacherWindow.webContents.send('background-response', payload);
	}
});

ipcMain.on('background-progress', function onBackgroundProgress(event, payload) {
	if (teacherWindow) {
		teacherWindow.webContents.send('background-progress', payload);
	}
});

ipcMain.on('background-stop', function onBackgroundStop() {
	destroyBackgroundWindow();
});

ipcMain.on('settings-op-sync', function onSettingsOperation(event, operation, args) {
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

ipcMain.on('automation-ready', function onAutomationReady() {
	debugLog('automation-ready');
	windowsReady.automation = true;
	maybeStartTeacher();
});

ipcMain.on('minkowski-calculate-nfp-sync', function onCalculateNfp(event, payload) {
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

ipcMain.on('teacher-finished', function onTeacherFinished(event, payload) {
	debugLog('teacher-finished', JSON.stringify(payload || {}));
	destroyBackgroundWindow();
	if (teacherWindow) {
		teacherWindow.destroy();
		teacherWindow = null;
	}

	app.exit(payload && payload.status === 'failed' ? 1 : 0);
});

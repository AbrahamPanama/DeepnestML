const electron = require('electron');
const childProcess = require('child_process');
const fs = require('graceful-fs');
const os = require('os');
const path = require('path');
const url = require('url');
const electronSettings = require('electron-settings');
const packageJson = require('./package.json');
const backgroundDispatcherModule = require('./main/background-dispatcher');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;
const ipcMain = electron.ipcMain;
const utilityProcess = electron.utilityProcess;
const createBackgroundDispatcher = backgroundDispatcherModule.createBackgroundDispatcher;

if (typeof app.setName === 'function' && packageJson.productName) {
  app.setName(packageJson.productName);
}

process.on('uncaughtException', function (err) {
  if (err.code === 'EIO') return;
  console.error('Unhandled Exception:', err);
});

app.commandLine.appendSwitch('--enable-precise-memory-info');

let mainWindow = null;
let winCount = 0;
let backgroundDispatcher = null;
const MAX_BACKGROUND_WINDOWS = Math.max(1, Math.min(8, (os.cpus() || []).length || 1));
let nativeAddon = null;
let nativeAddonPath = null;
let nativeAddonLoadError = null;
let minkowskiWorker = null;
let minkowskiWorkerLoadError = null;
let minkowskiRequestSeq = 0;
const minkowskiPendingRequests = Object.create(null);
const minkowskiWorkerPath = path.join(__dirname, 'main', 'minkowski-worker.js');
let localConverterPythonBin = null;
const localConverterScriptPath = resolveLocalConverterScriptPath();

function loadNativeAddon() {
  if (nativeAddon) {
    return nativeAddon;
  }

  const candidates = [];
  function pushAddonCandidate(candidate) {
    if (!candidate || candidates.indexOf(candidate) >= 0) {
      return;
    }
    candidates.push(candidate);

    const unpacked = candidate.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    if (unpacked !== candidate && candidates.indexOf(unpacked) < 0) {
      candidates.push(unpacked);
    }
  }

  [
    path.join(__dirname, 'build', 'Release', 'addon'),
    path.join(__dirname, 'build', 'Release', 'addon.node'),
    path.join(__dirname, 'minkowski', 'Release', 'addon'),
    path.join(__dirname, 'minkowski', 'Release', 'addon.node')
  ].forEach(pushAddonCandidate);

  if (process.resourcesPath) {
    [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'addon'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'addon.node'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'minkowski', 'Release', 'addon'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'minkowski', 'Release', 'addon.node')
    ].forEach(pushAddonCandidate);
  }

  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    try {
      nativeAddon = require(candidates[i]);
      nativeAddonPath = candidates[i];
      nativeAddonLoadError = null;
      return nativeAddon;
    }
    catch (err) {
      lastError = err;
    }
  }

  nativeAddon = null;
  nativeAddonPath = null;
  nativeAddonLoadError = lastError ? lastError.message : 'native-addon-unavailable';
  return null;
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

if (typeof app.requestSingleInstanceLock === 'function') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
  else {
    app.on('second-instance', focusMainWindow);
  }
}
else {
  const shouldQuit = app.makeSingleInstance(function () {
    focusMainWindow();
  });
  if (shouldQuit) {
    app.quit();
  }
}

function createWindowPreferences() {
  return {
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false
  };
}

function createMainWindow() {
  const workArea = electron.screen.getPrimaryDisplay().workAreaSize;
  const frameless = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: Math.ceil(workArea.width * 0.9),
    height: Math.ceil(workArea.height * 0.9),
    frame: !frameless,
    show: false,
    webPreferences: createWindowPreferences()
  });

  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, './main/index.html'),
    protocol: 'file:',
    slashes: true
  }));

  mainWindow.setMenu(null);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function createBackgroundWorkerWindow() {
  const back = new BrowserWindow({
    show: false,
    webPreferences: createWindowPreferences()
  });

  back.loadURL(url.format({
    pathname: path.join(__dirname, './main/background.html'),
    protocol: 'file:',
    slashes: true
  }));

  back.webContents.on('did-finish-load', function () {
    console.log('background did-finish-load');
  });

  back.webContents.on('render-process-gone', function (event, details) {
    console.log('background renderer gone', details);
    if (backgroundDispatcher) {
      backgroundDispatcher.handleRendererGone(back, details);
    }
  });

  back.webContents.on('console-message', function (event, level, message, line, sourceId) {
    console.log('background console:', message, sourceId || '', line || '');
  });

  back.on('closed', function () {
    if (backgroundDispatcher) {
      backgroundDispatcher.markClosed(back);
    }
  });

  return back;
}

backgroundDispatcher = createBackgroundDispatcher({
  maxWindows: MAX_BACKGROUND_WINDOWS,
  createWindow: createBackgroundWorkerWindow,
  getMainWindow: function () {
    return mainWindow;
  },
  onPoolChanged: function (count) {
    winCount = count;
  }
});

function createBackgroundWindows() {
  backgroundDispatcher.createWindows();
}

function recreateBackgroundWindows() {
  backgroundDispatcher.recreate();
}

function getNativeAddonStatus() {
  const addon = loadNativeAddon();
  return {
    ok: true,
    available: !!(addon && typeof addon.calculateNFP === 'function'),
    error: nativeAddonLoadError,
    path: nativeAddonPath
  };
}

function rejectPendingMinkowskiRequests(errorMessage) {
  const ids = Object.keys(minkowskiPendingRequests);
  for (let i = 0; i < ids.length; i++) {
    const callback = minkowskiPendingRequests[ids[i]];
    delete minkowskiPendingRequests[ids[i]];
    if (typeof callback === 'function') {
      callback({
        ok: false,
        error: errorMessage || 'utility-process-exited'
      });
    }
  }
}

function startMinkowskiWorker() {
  if (minkowskiWorker) {
    return true;
  }

  if (!utilityProcess || typeof utilityProcess.fork !== 'function') {
    minkowskiWorkerLoadError = 'utility-process-unavailable';
    return false;
  }

  try {
    const options = {
      stdio: 'pipe',
      serviceName: 'Deepnest ML Minkowski Worker'
    };
    if (process.platform === 'darwin') {
      options.allowLoadingUnsignedLibraries = true;
    }
    minkowskiWorker = utilityProcess.fork(minkowskiWorkerPath, [], options);
    minkowskiWorkerLoadError = null;
  }
  catch (err) {
    minkowskiWorker = null;
    minkowskiWorkerLoadError = err && err.message ? err.message : String(err);
    return false;
  }

  minkowskiWorker.on('message', function (message) {
    if (!message || typeof message.id === 'undefined') {
      return;
    }

    const callback = minkowskiPendingRequests[message.id];
    if (callback) {
      delete minkowskiPendingRequests[message.id];
      callback(message);
    }
  });

  minkowskiWorker.on('exit', function (code) {
    minkowskiWorker = null;
    if (code !== 0) {
      minkowskiWorkerLoadError = 'utility-process-exit-' + code;
    }
    rejectPendingMinkowskiRequests(minkowskiWorkerLoadError || 'utility-process-exited');
  });

  minkowskiWorker.on('error', function (type, location) {
    minkowskiWorkerLoadError = 'utility-process-error-' + type + (location ? (':' + location) : '');
  });

  if (minkowskiWorker.stderr) {
    minkowskiWorker.stderr.on('data', function (chunk) {
      console.log('[minkowski-worker][stderr]', String(chunk).trim());
    });
  }

  return true;
}

function requestMinkowskiWorker(type, payload) {
  return new Promise(function (resolve) {
    if (!startMinkowskiWorker()) {
      resolve({
        ok: false,
        error: minkowskiWorkerLoadError || 'utility-process-unavailable'
      });
      return;
    }

    const id = 'minkowski-' + (++minkowskiRequestSeq);
    let finished = false;
    const timeout = setTimeout(function () {
      if (finished) {
        return;
      }
      finished = true;
      delete minkowskiPendingRequests[id];
      resolve({
        ok: false,
        error: 'utility-process-timeout'
      });
    }, 120000);

    minkowskiPendingRequests[id] = function (response) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve(response || {
        ok: false,
        error: 'utility-process-empty-response'
      });
    };

    try {
      minkowskiWorker.postMessage({
        id: id,
        type: type,
        payload: payload || {}
      });
    }
    catch (err) {
      clearTimeout(timeout);
      delete minkowskiPendingRequests[id];
      resolve({
        ok: false,
        error: err && err.message ? err.message : String(err)
      });
    }
  });
}

function cleanupNfpCache() {
  const cachePath = path.join(__dirname, './nfpcache');
  if (!fs.existsSync(cachePath)) {
    return;
  }

  fs.readdirSync(cachePath).forEach(function (file) {
    const currentPath = path.join(cachePath, file);
    fs.unlinkSync(currentPath);
  });
}

function getPersistentNfpCachePath() {
  return path.join(app.getPath('userData'), 'nfpcache');
}

// ===== NFP cache (main-process owned) =====
// Before this was rehomed, each background renderer owned its own copy of the
// manifest and wrote the same per-key JSON files directly. With up to 8
// background windows that caused races on manifest-v2.json (torn writes,
// inconsistent LRU bookkeeping) and wasted work on pruneNfpCache(). Ownership
// now lives here: one manifest, one pruner, serialized by the Node event loop.
const NFP_CACHE_VERSION = 2;
const NFP_CACHE_MANIFEST = 'manifest-v2.json';
const NFP_CACHE_MAX_ENTRIES = 2500;
const NFP_CACHE_MAX_BYTES = 128 * 1024 * 1024;
let nfpCacheManifest = null;

function ensureNfpCacheDirSync() {
  const dir = getPersistentNfpCachePath();
  try {
    fs.mkdirSync(dir, { recursive: true });
  }
  catch (err) {
    console.warn('nfp cache dir unavailable:', err && err.message ? err.message : err);
  }
  return dir;
}

function loadNfpCacheManifest() {
  if (nfpCacheManifest) {
    return nfpCacheManifest;
  }
  const dir = ensureNfpCacheDirSync();
  const manifestPath = path.join(dir, NFP_CACHE_MANIFEST);
  try {
    if (fs.existsSync(manifestPath)) {
      const loaded = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (loaded && loaded.version === NFP_CACHE_VERSION && loaded.entries) {
        nfpCacheManifest = loaded;
        return nfpCacheManifest;
      }
    }
  }
  catch (err) {
    // Fall through to fresh manifest.
  }
  nfpCacheManifest = { version: NFP_CACHE_VERSION, entries: {} };
  return nfpCacheManifest;
}

function writeNfpCacheManifestAtomic() {
  const dir = ensureNfpCacheDirSync();
  const manifestPath = path.join(dir, NFP_CACHE_MANIFEST);
  const tmpPath = manifestPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(nfpCacheManifest));
    fs.renameSync(tmpPath, manifestPath);
  }
  catch (err) {
    console.warn('nfp cache manifest write failed:', err && err.message ? err.message : err);
  }
}

function pruneNfpCacheIfNeeded() {
  const manifest = loadNfpCacheManifest();
  const dir = ensureNfpCacheDirSync();
  const keys = Object.keys(manifest.entries);
  let totalBytes = 0;
  for (let i = 0; i < keys.length; i++) {
    totalBytes += Number(manifest.entries[keys[i]].bytes || 0);
  }
  if (keys.length <= NFP_CACHE_MAX_ENTRIES && totalBytes <= NFP_CACHE_MAX_BYTES) {
    return false;
  }
  keys.sort(function (a, b) {
    return Number(manifest.entries[a].lastAccess || 0) - Number(manifest.entries[b].lastAccess || 0);
  });
  let changed = false;
  while (keys.length > 0 && (keys.length > NFP_CACHE_MAX_ENTRIES || totalBytes > NFP_CACHE_MAX_BYTES)) {
    const victim = keys.shift();
    const entry = manifest.entries[victim];
    if (!entry) {
      continue;
    }
    try {
      fs.unlinkSync(path.join(dir, entry.file));
    }
    catch (err) {
      // Cache pruning is best effort.
    }
    totalBytes -= Number(entry.bytes || 0);
    delete manifest.entries[victim];
    changed = true;
  }
  return changed;
}

function nfpCacheHas(key) {
  if (!key) {
    return false;
  }
  const manifest = loadNfpCacheManifest();
  const entry = manifest.entries[key];
  if (!entry) {
    return false;
  }
  const dir = ensureNfpCacheDirSync();
  return fs.existsSync(path.join(dir, entry.file));
}

function nfpCacheFind(key) {
  if (!key) {
    return null;
  }
  const manifest = loadNfpCacheManifest();
  const entry = manifest.entries[key];
  if (!entry) {
    return null;
  }
  const dir = ensureNfpCacheDirSync();
  const filePath = path.join(dir, entry.file);
  if (!fs.existsSync(filePath)) {
    delete manifest.entries[key];
    writeNfpCacheManifestAtomic();
    return null;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload || payload.version !== NFP_CACHE_VERSION || payload.key !== key || !payload.nfp) {
      return null;
    }
    entry.lastAccess = Date.now();
    // Skip writing the manifest on every read; prune/insert persists it and a
    // crash only loses LRU freshness, not correctness.
    return payload.nfp;
  }
  catch (err) {
    return null;
  }
}

function nfpCacheInsert(key, nfp) {
  if (!key || !nfp) {
    return;
  }
  const manifest = loadNfpCacheManifest();
  const dir = ensureNfpCacheDirSync();
  const file = key + '.json';
  const payload = {
    version: NFP_CACHE_VERSION,
    key: key,
    nfp: nfp
  };
  let json;
  try {
    json = JSON.stringify(payload);
  }
  catch (err) {
    return;
  }
  try {
    fs.writeFileSync(path.join(dir, file), json);
    manifest.entries[key] = {
      file: file,
      bytes: Buffer.byteLength(json, 'utf8'),
      lastAccess: Date.now()
    };
    pruneNfpCacheIfNeeded();
    writeNfpCacheManifestAtomic();
  }
  catch (err) {
    console.warn('nfp cache insert failed:', err && err.message ? err.message : err);
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

function execFileAsync(command, args, options) {
  return new Promise(function (resolve, reject) {
    childProcess.execFile(command, args, options || {}, function (err, stdout, stderr) {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout: stdout, stderr: stderr });
    });
  });
}

function resolveLocalConverterScriptPath() {
  const candidates = [];
  const scriptRelativePath = path.join('scripts', 'conversion', 'local-convert.py');
  const dirnamePath = path.join(__dirname, scriptRelativePath);
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', scriptRelativePath));
    candidates.push(path.join(process.resourcesPath, 'app', scriptRelativePath));
  }

  const unpackedFromDirname = dirnamePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (unpackedFromDirname !== dirnamePath) {
    candidates.push(unpackedFromDirname);
  }
  candidates.push(dirnamePath);

  const seen = {};
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate || seen[candidate]) {
      continue;
    }
    seen[candidate] = true;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return dirnamePath;
}

function normalizeFormat(value) {
  if (!value) {
    return null;
  }
  return String(value).trim().toLowerCase().replace(/^\./, '');
}

function unlinkIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  catch (err) {
    // best-effort cleanup
  }
}

function getPythonCandidates() {
  const interpreters = [
    process.env.DEEPNEST_PYTHON_BIN,
    process.env.PYTHON3,
    process.env.PYTHON,
    'python3',
    '/Library/Developer/CommandLineTools/usr/bin/python3',
    '/usr/bin/python3'
  ];
  const deduped = [];
  for (let i = 0; i < interpreters.length; i++) {
    const candidate = interpreters[i];
    if (!candidate) {
      continue;
    }
    if (deduped.indexOf(candidate) < 0) {
      deduped.push(candidate);
    }
  }

  const candidates = [];
  for (let i = 0; i < deduped.length; i++) {
    candidates.push({
      label: deduped[i],
      command: deduped[i],
      argsPrefix: []
    });
  }

  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/arch')) {
    for (let i = 0; i < deduped.length; i++) {
      candidates.push({
        label: 'arch -arm64 ' + deduped[i],
        command: '/usr/bin/arch',
        argsPrefix: ['-arm64', deduped[i]]
      });
    }
  }

  return candidates;
}

async function runConverterDoctor(candidate) {
  try {
    const result = await execFileAsync(candidate.command, (candidate.argsPrefix || []).concat([
      localConverterScriptPath,
      '--mode',
      'doctor'
    ]), {
      maxBuffer: 4 * 1024 * 1024
    });
    const stdout = String(result.stdout || '').trim();
    const report = stdout ? JSON.parse(stdout) : null;
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

async function resolveLocalConverterPython() {
  if (localConverterPythonBin) {
    return {
      ok: true,
      pythonBin: localConverterPythonBin,
      report: localConverterPythonBin.report || null
    };
  }

  const candidates = getPythonCandidates();
  for (let i = 0; i < candidates.length; i++) {
    const doctor = await runConverterDoctor(candidates[i]);
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

async function runLocalConversion(payload) {
  const request = payload || {};
  const sourceFormat = normalizeFormat(request.sourceFormat);
  const targetFormat = normalizeFormat(request.targetFormat);
  const inputBase64 = request.inputBase64;
  const optionsJson = request.options ? JSON.stringify(request.options) : null;

  if (!sourceFormat || !targetFormat) {
    return { ok: false, error: 'invalid-format-request' };
  }

  const mode = sourceFormat + '-to-' + targetFormat;
  const supported = mode === 'pdf-to-svg' ||
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

  const pythonResolution = await resolveLocalConverterPython();
  if (!pythonResolution || pythonResolution.ok !== true) {
    return {
      ok: false,
      error: 'local-converter-python-unavailable',
      details: pythonResolution && pythonResolution.error ? pythonResolution.error : 'no-compatible-python'
    };
  }
  const pythonCandidate = pythonResolution.pythonBin;

  const token = Date.now() + '-' + Math.floor(Math.random() * 1e8);
  const tempRoot = path.join(os.tmpdir(), 'deepnest-conversion');
  fs.mkdirSync(tempRoot, { recursive: true });
  const inputPath = path.join(tempRoot, 'input-' + token + '.' + sourceFormat);
  const outputPath = path.join(tempRoot, 'output-' + token + '.' + targetFormat);

  try {
    fs.writeFileSync(inputPath, Buffer.from(inputBase64, 'base64'));
    const args = (pythonCandidate.argsPrefix || []).concat([
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

    await execFileAsync(pythonCandidate.command, args, {
      maxBuffer: 64 * 1024 * 1024
    });

    if (!fs.existsSync(outputPath)) {
      return { ok: false, error: 'local-converter-produced-no-output' };
    }

    const output = fs.readFileSync(outputPath);
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
    const details = [];
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

async function getLocalConversionHealth() {
  if (!fs.existsSync(localConverterScriptPath)) {
    return { ok: true, available: false, error: 'local-converter-script-missing' };
  }
  const resolution = await resolveLocalConverterPython();
  if (!resolution || resolution.ok !== true) {
    return {
      ok: true,
      available: false,
      error: resolution && resolution.error ? resolution.error : 'no-compatible-python'
    };
  }
  return {
    ok: true,
    available: true,
    pythonBin: resolution.pythonBin.label,
    report: resolution.report
  };
}

app.on('ready', function () {
  createMainWindow();
  mainWindow.once('ready-to-show', function () {
    mainWindow.show();
    createBackgroundWindows();
  });
  mainWindow.on('closed', function () {
    app.quit();
  });
});

app.on('window-all-closed', function () {
  app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) {
    createMainWindow();
    mainWindow.once('ready-to-show', function () {
      mainWindow.show();
      createBackgroundWindows();
    });
  }
});

app.on('before-quit', function () {
  if (minkowskiWorker && typeof minkowskiWorker.kill === 'function') {
    minkowskiWorker.kill();
    minkowskiWorker = null;
  }
  rejectPendingMinkowskiRequests('app-quitting');
});

ipcMain.on('background-start', function (event, payload) {
  backgroundDispatcher.enqueue(payload);
});

ipcMain.on('background-response', function (event, payload) {
  backgroundDispatcher.handleResponse(event.sender, payload);
});

ipcMain.on('background-progress', function (event, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('background-progress', payload);
  }
});

ipcMain.on('background-stop', function () {
  recreateBackgroundWindows();
});

ipcMain.on('background-ready', function (event) {
  console.log('background ready');
  backgroundDispatcher.markReady(event.sender);
});

ipcMain.on('login-success', function (event, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('login-success', payload);
  }
});

ipcMain.on('purchase-success', function () {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('purchase-success');
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
    const cachePath = getPersistentNfpCachePath();
    fs.mkdirSync(cachePath, { recursive: true });
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

// Rehomed NFP cache: background renderers query main.js instead of reading
// and writing manifest-v2.json themselves. Serialization through the Node
// event loop is what removes the previous multi-writer races.
ipcMain.on('nfp-cache-has-sync', function (event, key) {
  try {
    event.returnValue = nfpCacheHas(key);
  }
  catch (err) {
    event.returnValue = false;
  }
});

ipcMain.on('nfp-cache-find-sync', function (event, key) {
  try {
    event.returnValue = nfpCacheFind(key);
  }
  catch (err) {
    event.returnValue = null;
  }
});

ipcMain.on('nfp-cache-insert', function (event, message) {
  if (!message || typeof message !== 'object') {
    return;
  }
  nfpCacheInsert(message.key, message.nfp);
});

ipcMain.on('dialog-open-sync', function (event, options) {
  try {
    event.returnValue = dialog.showOpenDialogSync(mainWindow, options || {});
  }
  catch (err) {
    console.log('dialog-open-sync failed', err);
    event.returnValue = undefined;
  }
});

ipcMain.on('dialog-save-sync', function (event, options) {
  try {
    event.returnValue = dialog.showSaveDialogSync(mainWindow, options || {});
  }
  catch (err) {
    console.log('dialog-save-sync failed', err);
    event.returnValue = undefined;
  }
});

ipcMain.on('minkowski-status-sync', function (event) {
  event.returnValue = getNativeAddonStatus();
});

ipcMain.on('minkowski-calculate-nfp-sync', function (event, payload) {
  const addon = loadNativeAddon();
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

ipcMain.handle('minkowski-status', async function () {
  return requestMinkowskiWorker('status');
});

ipcMain.handle('minkowski-calculate-nfp', async function (event, payload) {
  return requestMinkowskiWorker('calculate-nfp', {
    A: payload && payload.A ? payload.A : [],
    B: payload && payload.B ? payload.B : []
  });
});

ipcMain.handle('conversion-health', async function () {
  return getLocalConversionHealth();
});

ipcMain.handle('conversion-run', async function (event, payload) {
  return runLocalConversion(payload);
});

'use strict';

const path = require('path');

let parentPort = null;
try {
  const utility = require('electron/utility');
  if (utility && utility.parentPort) {
    parentPort = utility.parentPort;
  }
}
catch (err) {
  // Electron versions differ on utility-process bridge exports.
}

if (!parentPort && process && process.parentPort) {
  parentPort = process.parentPort;
}

let addon = null;
let addonPath = null;
let addonLoadError = null;

function toErrorMessage(err) {
  return (err && err.message) ? err.message : String(err);
}

function pushUnique(list, value) {
  if (!value || list.indexOf(value) >= 0) {
    return;
  }
  list.push(value);
}

function buildAddonCandidates() {
  const candidates = [];
  const relativeCandidates = [
    path.join('..', 'build', 'Release', 'addon'),
    path.join('..', 'build', 'Release', 'addon.node'),
    path.join('..', 'minkowski', 'Release', 'addon'),
    path.join('..', 'minkowski', 'Release', 'addon.node')
  ];

  for (let i = 0; i < relativeCandidates.length; i++) {
    const resolved = path.join(__dirname, relativeCandidates[i]);
    pushUnique(candidates, resolved);

    const unpacked = resolved.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    if (unpacked !== resolved) {
      pushUnique(candidates, unpacked);
    }
  }

  if (process.resourcesPath) {
    const resourceCandidates = [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'addon'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'addon.node'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'minkowski', 'Release', 'addon'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'minkowski', 'Release', 'addon.node'),
      path.join(process.resourcesPath, 'app', 'build', 'Release', 'addon'),
      path.join(process.resourcesPath, 'app', 'build', 'Release', 'addon.node')
    ];

    for (let j = 0; j < resourceCandidates.length; j++) {
      pushUnique(candidates, resourceCandidates[j]);
    }
  }

  return candidates;
}

function loadAddon() {
  const candidates = buildAddonCandidates();
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    try {
      addon = require(candidates[i]);
      addonPath = candidates[i];
      addonLoadError = null;
      return;
    }
    catch (err) {
      lastError = err;
    }
  }

  addon = null;
  addonPath = null;
  addonLoadError = toErrorMessage(lastError || new Error('native-addon-unavailable'));
}

function post(response) {
  if (parentPort && typeof parentPort.postMessage === 'function') {
    parentPort.postMessage(response);
    return;
  }

  if (typeof process.send === 'function') {
    process.send(response);
  }
}

function attachMessageHandler(handler) {
  if (parentPort && typeof parentPort.on === 'function') {
    parentPort.on('message', function (event) {
      const payload = event && typeof event === 'object' && Object.prototype.hasOwnProperty.call(event, 'data')
        ? event.data
        : event;
      handler(payload);
    });
    return true;
  }

  if (typeof process.on === 'function') {
    process.on('message', function (message) {
      handler(message);
    });
    return true;
  }

  return false;
}

function onMessage(message) {
  if (!message || typeof message.id === 'undefined') {
    return;
  }

  if (message.type === 'status') {
    post({
      id: message.id,
      ok: true,
      available: !!(addon && typeof addon.calculateNFP === 'function'),
      error: addonLoadError,
      path: addonPath
    });
    return;
  }

  if (message.type === 'calculate-nfp') {
    if (!addon || typeof addon.calculateNFP !== 'function') {
      post({
        id: message.id,
        ok: false,
        error: addonLoadError || 'native-addon-unavailable'
      });
      return;
    }

    try {
      const payload = message.payload || {};
      post({
        id: message.id,
        ok: true,
        value: addon.calculateNFP({
          A: payload.A || [],
          B: payload.B || []
        })
      });
    }
    catch (err) {
      post({
        id: message.id,
        ok: false,
        error: toErrorMessage(err)
      });
    }
    return;
  }

  post({
    id: message.id,
    ok: false,
    error: 'unknown-message-type'
  });
}

loadAddon();

if (!attachMessageHandler(onMessage)) {
  process.exit(1);
}

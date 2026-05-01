'use strict';

function noop() {}

function createBackgroundDispatcher(options) {
  options = options || {};

  var maxWindows = Math.max(1, parseInt(options.maxWindows, 10) || 1);
  var windows = [];
  var queue = [];
  var createWindow = options.createWindow;
  var getMainWindow = options.getMainWindow || function () { return null; };
  var sendToWindow = options.sendToWindow || function (win, channel, payload) {
    win.webContents.send(channel, payload);
  };
  var sendToMain = options.sendToMain || function (mainWindow, channel, payload) {
    mainWindow.webContents.send(channel, payload);
  };
  var isWindowDestroyed = options.isWindowDestroyed || function (win) {
    return !!(win && win.webContents && typeof win.webContents.isDestroyed === 'function' && win.webContents.isDestroyed());
  };
  var onWindowCreated = options.onWindowCreated || noop;
  var onPoolChanged = options.onPoolChanged || noop;

  if (typeof createWindow !== 'function') {
    throw new Error('background dispatcher requires createWindow');
  }

  function countWindows() {
    return windows.filter(function (win) {
      return !!win && !isWindowDestroyed(win);
    }).length;
  }

  function nextWindowSlot() {
    for (var i = 0; i < windows.length; i++) {
      if (!windows[i]) {
        return i;
      }
    }
    return windows.length;
  }

  function findWindowForSender(sender) {
    for (var i = 0; i < windows.length; i++) {
      if (windows[i] && windows[i].webContents === sender) {
        return windows[i];
      }
    }
    return null;
  }

  function reportOrphanPayload(payload, reason) {
    var mainWindow = getMainWindow();
    if (!payload || !mainWindow || !mainWindow.webContents) {
      return;
    }
    if (mainWindow.webContents && typeof mainWindow.webContents.isDestroyed === 'function' && mainWindow.webContents.isDestroyed()) {
      return;
    }
    sendToMain(mainWindow, 'background-response', {
      index: payload.index,
      fitness: Number.MAX_VALUE,
      placements: [],
      error: reason || 'background-worker-lost'
    });
  }

  function createWindows() {
    while (countWindows() < maxWindows) {
      var win = createWindow();
      win.isBusy = false;
      win.isReady = false;
      win.currentPayload = null;

      var slot = nextWindowSlot();
      windows[slot] = win;
      onWindowCreated(win, slot, api);
      onPoolChanged(countWindows());
    }
  }

  function dispatch() {
    if (queue.length === 0) {
      return;
    }

    createWindows();

    for (var i = 0; i < windows.length && queue.length > 0; i++) {
      var win = windows[i];
      if (!win || win.isBusy || !win.isReady || isWindowDestroyed(win)) {
        continue;
      }

      var payload = queue.shift();
      win.isBusy = true;
      win.currentPayload = payload;
      sendToWindow(win, 'background-start', payload);
    }
  }

  function markClosed(win) {
    for (var i = 0; i < windows.length; i++) {
      if (windows[i] === win) {
        windows[i] = null;
      }
    }
    onPoolChanged(countWindows());
  }

  function destroyWindow(win) {
    if (!win || typeof win.destroy !== 'function') {
      return;
    }
    try {
      win.destroy();
    }
    catch (err) {
      // A crashed renderer may already be half torn down. The slot has already
      // been removed, so a failed destroy must not block replacement workers.
    }
  }

  function handleRendererGone(win, details) {
    var orphan = win ? win.currentPayload : null;
    if (win) {
      win.currentPayload = null;
      win.isBusy = false;
      win.isReady = false;
      markClosed(win);
    }

    if (orphan) {
      var reason = (details && details.reason) ? ('background-worker-' + details.reason) : 'background-worker-lost';
      reportOrphanPayload(orphan, reason);
    }

    destroyWindow(win);
    createWindows();
    dispatch();
  }

  function enqueue(payload) {
    queue.push(payload);
    dispatch();
  }

  function handleResponse(sender, payload) {
    var win = findWindowForSender(sender);
    if (win) {
      win.isBusy = false;
      win.currentPayload = null;
    }

    var mainWindow = getMainWindow();
    if (mainWindow && mainWindow.webContents) {
      sendToMain(mainWindow, 'background-response', payload);
    }
    dispatch();
  }

  function markReady(sender) {
    var win = findWindowForSender(sender);
    if (win) {
      win.isReady = true;
    }
    dispatch();
  }

  function recreate() {
    queue.length = 0;
    for (var i = 0; i < windows.length; i++) {
      if (windows[i]) {
        windows[i].currentPayload = null;
        destroyWindow(windows[i]);
        windows[i] = null;
      }
    }
    onPoolChanged(0);
    createWindows();
  }

  var api = {
    windows: windows,
    queue: queue,
    countWindows: countWindows,
    createWindows: createWindows,
    dispatch: dispatch,
    enqueue: enqueue,
    handleResponse: handleResponse,
    handleRendererGone: handleRendererGone,
    markReady: markReady,
    markClosed: markClosed,
    recreate: recreate,
    reportOrphanPayload: reportOrphanPayload
  };

  return api;
}

module.exports = {
  createBackgroundDispatcher: createBackgroundDispatcher
};

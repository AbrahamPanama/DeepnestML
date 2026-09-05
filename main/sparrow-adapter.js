'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PINNED_COMMIT = '57c45cd295f5d2ce2a11edf6e765318a51d2b41e';
const MAX_LOG_CHARS = 65536;
const activeChildren = new Set();

function finite(value, fallback) {
  value = Number(value);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeMode(value) {
  if (value === 'sparrow' || value === 'hybrid') {
    return value;
  }
  throw new Error('Unsupported Sparrow solver mode.');
}

function platformKey(platform, arch) {
  return String(platform || process.platform) + '-' + String(arch || process.arch);
}

function executableName(platform) {
  return String(platform || process.platform) === 'win32' ? 'sparrow.exe' : 'sparrow';
}

function pushCandidate(candidates, candidate) {
  if (!candidate) {
    return;
  }
  var unpacked = candidate.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  // Electron's patched fs can stat a file inside app.asar, but a native
  // executable cannot be spawned from that virtual path. Always try the
  // unpacked filesystem location first.
  if (unpacked !== candidate && candidates.indexOf(unpacked) < 0) {
    candidates.push(unpacked);
  }
  if (candidates.indexOf(candidate) < 0) {
    candidates.push(candidate);
  }
}

function binaryCandidates(options) {
  options = options || {};
  var platform = options.platform || process.platform;
  var arch = options.arch || process.arch;
  var rootDir = options.rootDir || path.resolve(__dirname, '..');
  var name = executableName(platform);
  var candidates = [];
  pushCandidate(candidates, options.binaryPath);
  pushCandidate(candidates, process.env.DEEPNEST_SPARROW_BIN);
  pushCandidate(candidates, path.join(
    rootDir,
    'vendor',
    'sparrow',
    'bin',
    platformKey(platform, arch),
    name
  ));
  if (process.resourcesPath) {
    pushCandidate(candidates, path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'vendor',
      'sparrow',
      'bin',
      platformKey(platform, arch),
      name
    ));
  }
  return candidates;
}

function resolveBinary(options) {
  var candidates = binaryCandidates(options);
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.statSync(candidates[i]).isFile()) {
        return candidates[i];
      }
    }
    catch (err) {
      // Keep checking packaged and development locations.
    }
  }
  return null;
}

function status(options) {
  var binaryPath = resolveBinary(options);
  return {
    available: !!binaryPath,
    binaryPath: binaryPath,
    platform: platformKey(
      options && options.platform,
      options && options.arch
    ),
    pinnedCommit: PINNED_COMMIT
  };
}

function pointsEqual(left, right) {
  return left && right && left[0] === right[0] && left[1] === right[1];
}

function simplePolygon(ring) {
  if (!Array.isArray(ring)) {
    throw new Error('Sparrow part geometry is missing.');
  }
  var points = [];
  for (var i = 0; i < ring.length; i++) {
    var x = finite(ring[i] && ring[i].x, NaN);
    var y = finite(ring[i] && ring[i].y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Sparrow part geometry contains a non-finite point.');
    }
    var point = [x, y];
    if (points.length === 0 || !pointsEqual(points[points.length - 1], point)) {
      points.push(point);
    }
  }
  if (points.length > 1 && pointsEqual(points[0], points[points.length - 1])) {
    points.pop();
  }
  if (points.length < 3) {
    throw new Error('Sparrow requires at least three distinct polygon points.');
  }
  return points;
}

function normalizeBounds(bounds) {
  bounds = bounds || {};
  var normalized = {
    x: finite(bounds.x, NaN),
    y: finite(bounds.y, NaN),
    width: finite(bounds.width, NaN),
    height: finite(bounds.height, NaN)
  };
  if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y) ||
    !Number.isFinite(normalized.width) || !Number.isFinite(normalized.height) ||
    normalized.width <= 0 || normalized.height <= 0) {
    throw new Error('Sparrow requires a finite rectangular sheet boundary.');
  }
  return normalized;
}

function normalizeAngle(value) {
  var angle = finite(value, NaN);
  if (!Number.isFinite(angle)) {
    throw new Error('Sparrow returned a non-finite rotation.');
  }
  angle %= 360;
  if (angle < 0) {
    angle += 360;
  }
  return Math.round(angle * 1000000) / 1000000;
}

function transformPoint(point, placement, sheetBounds) {
  var rotation = finite(placement.rotation, NaN) * Math.PI / 180;
  var x = finite(point[0], NaN);
  var y = finite(point[1], NaN);
  var tx = finite(placement.x, NaN) - sheetBounds.x;
  var ty = finite(placement.y, NaN) - sheetBounds.y;
  if (!Number.isFinite(rotation) || !Number.isFinite(x) || !Number.isFinite(y) ||
    !Number.isFinite(tx) || !Number.isFinite(ty)) {
    throw new Error('Hybrid Sparrow seed contains a non-finite transform.');
  }
  return [
    x * Math.cos(rotation) - y * Math.sin(rotation) + tx,
    x * Math.sin(rotation) + y * Math.cos(rotation) + ty
  ];
}

function transformedOutputBounds(polygon, transformation) {
  var translation = transformation && transformation.translation;
  var rotation = finite(transformation && transformation.rotation, NaN) * Math.PI / 180;
  if (!Array.isArray(translation) || translation.length < 2 ||
    !Number.isFinite(rotation) || !Number.isFinite(finite(translation[0], NaN)) ||
    !Number.isFinite(finite(translation[1], NaN))) {
    throw new Error('Sparrow returned a non-finite transform.');
  }
  var cos = Math.cos(rotation);
  var sin = Math.sin(rotation);
  var tx = Number(translation[0]);
  var ty = Number(translation[1]);
  var bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
  for (var i = 0; i < polygon.length; i++) {
    var x = finite(polygon[i] && polygon[i][0], NaN);
    var y = finite(polygon[i] && polygon[i][1], NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Sparrow returned a transform for invalid geometry.');
    }
    var transformedX = x * cos - y * sin + tx;
    var transformedY = x * sin + y * cos + ty;
    bounds.minX = Math.min(bounds.minX, transformedX);
    bounds.minY = Math.min(bounds.minY, transformedY);
    bounds.maxX = Math.max(bounds.maxX, transformedX);
    bounds.maxY = Math.max(bounds.maxY, transformedY);
  }
  return bounds;
}

function polygonArea(points) {
  var area = 0;
  for (var i = 0; i < points.length; i++) {
    var next = points[(i + 1) % points.length];
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  return Math.abs(area / 2);
}

function prepareStrip(sheet, partsBySource, mode) {
  var bounds = normalizeBounds(sheet && sheet.bounds);
  var instances = Array.isArray(sheet && sheet.instances) ? sheet.instances : [];
  if (instances.length === 0) {
    throw new Error('Sparrow received an empty sheet job.');
  }

  var sourceGroups = Object.create(null);
  var orderedGroups = [];
  var seenInstanceIds = Object.create(null);
  for (var i = 0; i < instances.length; i++) {
    var instance = instances[i] || {};
    var source = String(instance.source);
    var id = String(instance.id);
    if (!partsBySource || !partsBySource[source]) {
      throw new Error('Sparrow is missing geometry for part source ' + source + '.');
    }
    if (seenInstanceIds[id]) {
      throw new Error('Sparrow received duplicate part instance ID ' + id + '.');
    }
    seenInstanceIds[id] = true;
    if (!sourceGroups[source]) {
      sourceGroups[source] = {
        source: Number(instance.source),
        polygon: simplePolygon(partsBySource[source]),
        instanceIds: [],
        typeId: orderedGroups.length
      };
      orderedGroups.push(sourceGroups[source]);
    }
    sourceGroups[source].instanceIds.push(instance.id);
  }

  var instance = {
    name: '',
    strip_height: bounds.height,
    items: orderedGroups.map(function (group) {
      return {
        id: group.typeId,
        demand: group.instanceIds.length,
        shape: {
          type: 'simple_polygon',
          data: group.polygon
        }
      };
    })
  };

  var initialPlacements = Array.isArray(sheet.initialPlacements) ?
    sheet.initialPlacements : [];
  var warmSolution = null;
  var configuredBeforeWidth = finite(sheet && sheet.beforeWidth, NaN);
  var beforeWidth = Number.isFinite(configuredBeforeWidth) && configuredBeforeWidth > 0 ?
    configuredBeforeWidth : bounds.width;
  if (mode === 'hybrid') {
    if (initialPlacements.length > 0 && initialPlacements.length !== instances.length) {
      throw new Error('Hybrid Sparrow seed does not match its assigned parts.');
    }
    if (initialPlacements.length === instances.length) {
      var maxX = 0;
      var placedItems = [];
      var placementsById = Object.create(null);
      for (i = 0; i < initialPlacements.length; i++) {
        placementsById[String(initialPlacements[i].id)] = initialPlacements[i];
      }
      for (i = 0; i < instances.length; i++) {
        var seedInstance = instances[i];
        var seedPlacement = placementsById[String(seedInstance.id)];
        if (!seedPlacement || Number(seedPlacement.source) !== Number(seedInstance.source)) {
          throw new Error('Hybrid Sparrow seed lost a part identity.');
        }
        var seedGroup = sourceGroups[String(seedInstance.source)];
        for (var pointIndex = 0; pointIndex < seedGroup.polygon.length; pointIndex++) {
          maxX = Math.max(
            maxX,
            transformPoint(seedGroup.polygon[pointIndex], seedPlacement, bounds)[0]
          );
        }
        placedItems.push({
          item_id: seedGroup.typeId,
          transformation: {
            rotation: finite(seedPlacement.rotation, 0),
            translation: [
              finite(seedPlacement.x, 0) - bounds.x,
              finite(seedPlacement.y, 0) - bounds.y
            ]
          }
        });
      }
      beforeWidth = Math.max(maxX, 0.0001);
      warmSolution = {
        strip_width: beforeWidth,
        layout: {
          container_id: 0,
          placed_items: placedItems,
          density: 0
        },
        density: 0,
        run_time_sec: 0
      };
    }
  }

  var totalItemArea = 0;
  for (i = 0; i < orderedGroups.length; i++) {
    totalItemArea += polygonArea(orderedGroups[i].polygon) * orderedGroups[i].instanceIds.length;
  }

  return {
    bounds: bounds,
    sheet: Number(sheet.sheet),
    sheetid: Number(sheet.sheetid),
    instance: instance,
    groups: orderedGroups,
    beforeWidth: beforeWidth,
    warmSolution: warmSolution,
    allowPartial: sheet && sheet.allowPartial === true,
    seedIncomplete: sheet && sheet.seedIncomplete === true,
    totalItemArea: totalItemArea
  };
}

function appendLog(current, chunk) {
  current += String(chunk || '');
  if (current.length > MAX_LOG_CHARS) {
    current = current.slice(current.length - MAX_LOG_CHARS);
  }
  return current;
}

function runProcess(binaryPath, args, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    var child;
    try {
      child = childProcess.spawn(binaryPath, args, {
        cwd: options.cwd,
        env: Object.assign({}, process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    }
    catch (err) {
      reject(err);
      return;
    }
    activeChildren.add(child);
    var stdout = '';
    var stderr = '';
    var settled = false;
    var timeout = setTimeout(function () {
      if (settled) {
        return;
      }
      try {
        child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
      }
      catch (err) {
        // The process may have exited between the timeout and kill.
      }
    }, Math.max(1000, finite(options.timeoutMs, 30000)));

    child.stdout.on('data', function (chunk) {
      stdout = appendLog(stdout, chunk);
    });
    child.stderr.on('data', function (chunk) {
      stderr = appendLog(stderr, chunk);
    });
    child.on('error', function (err) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      activeChildren.delete(child);
      reject(err);
    });
    child.on('close', function (code, signal) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      activeChildren.delete(child);
      if (code === 0) {
        resolve({stdout: stdout, stderr: stderr});
        return;
      }
      var detail = (stderr || stdout || '').trim();
      var message = signal ?
        'Sparrow was cancelled (' + signal + ').' :
        'Sparrow exited with code ' + code + '.';
      if (detail) {
        message += ' ' + detail.slice(-2000);
      }
      reject(new Error(message));
    });
  });
}

function safeName(token, index) {
  var value = String(token || 'deepnest') + '_' + String(index || 0);
  value = value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
  return value || 'deepnest';
}

function removeTree(target) {
  if (!target || !fs.existsSync(target)) {
    return;
  }
  var stat = fs.lstatSync(target);
  if (!stat.isDirectory()) {
    fs.unlinkSync(target);
    return;
  }
  var entries = fs.readdirSync(target);
  for (var i = 0; i < entries.length; i++) {
    removeTree(path.join(target, entries[i]));
  }
  fs.rmdirSync(target);
}

function runStrip(binaryPath, prepared, runOptions) {
  var runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepnest-sparrow-'));
  var name = safeName(runOptions.token, runOptions.index);
  prepared.instance.name = name;
  var input = prepared.warmSolution ? Object.assign({}, prepared.instance, {
    solution: prepared.warmSolution
  }) : prepared.instance;
  var inputPath = path.join(runDir, 'input.json');
  var outputPath = path.join(runDir, 'output', 'final_' + name + '.json');
  fs.writeFileSync(inputPath, JSON.stringify(input));
  var args = [
    '-i', inputPath,
    '-t', String(runOptions.timeLimitSec),
    '-s', String(runOptions.seed),
    '--workers', String(runOptions.workers)
  ];
  var minimumSeparation = Math.max(0, finite(runOptions.minimumSeparation, 0));
  if (minimumSeparation > 0) {
    args.push('--min-item-separation', String(minimumSeparation));
  }
  var startedAt = Date.now();
  return runProcess(binaryPath, args, {
      cwd: runDir,
      timeoutMs: (runOptions.timeLimitSec + 30) * 1000
    }).then(function () {
    if (!fs.existsSync(outputPath)) {
      throw new Error('Sparrow did not produce a final solution.');
    }
    var output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    var solution = output && output.solution;
    var placedItems = solution && solution.layout && solution.layout.placed_items;
    if (!solution || !Array.isArray(placedItems)) {
      throw new Error('Sparrow returned an invalid solution document.');
    }
    var queues = prepared.groups.map(function (group) {
      return group.instanceIds.slice();
    });
    var sheetplacements = [];
    var unplaced = [];
    var usedWidth = 0;
    var widthTolerance = Math.max(0.001, prepared.bounds.width * 1e-6);
    var heightTolerance = Math.max(0.001, prepared.bounds.height * 1e-6);
    for (var i = 0; i < placedItems.length; i++) {
      var placed = placedItems[i] || {};
      var typeId = Number(placed.item_id);
      var group = prepared.groups[typeId];
      var transformation = placed.transformation || {};
      var translation = transformation.translation;
      if (!group || !Array.isArray(translation) || translation.length < 2 ||
        queues[typeId].length === 0) {
        throw new Error('Sparrow returned an unknown or duplicate item placement.');
      }
      var x = finite(translation[0], NaN) + prepared.bounds.x;
      var y = finite(translation[1], NaN) + prepared.bounds.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('Sparrow returned a non-finite translation.');
      }
      var instanceId = queues[typeId].shift();
      var outputBounds = transformedOutputBounds(group.polygon, transformation);
      var candidate = {
        id: instanceId,
        source: group.source,
        x: x,
        y: y,
        rotation: normalizeAngle(transformation.rotation)
      };
      var fitsSheet = outputBounds.minX >= -widthTolerance &&
        outputBounds.maxX <= prepared.bounds.width + widthTolerance &&
        outputBounds.minY >= -heightTolerance &&
        outputBounds.maxY <= prepared.bounds.height + heightTolerance;
      if (runOptions.allowPartial === true && !fitsSheet) {
        unplaced.push({
          id: instanceId,
          source: group.source,
          sheet: prepared.sheet,
          sheetid: prepared.sheetid
        });
        continue;
      }
      sheetplacements.push(candidate);
      usedWidth = Math.max(usedWidth, outputBounds.maxX);
    }
    for (i = 0; i < queues.length; i++) {
      if (queues[i].length !== 0) {
        throw new Error('Sparrow omitted one or more requested parts.');
      }
    }
    var stripWidth = finite(solution.strip_width, NaN);
    if (!Number.isFinite(stripWidth) || stripWidth <= 0) {
      throw new Error('Sparrow returned an invalid strip width.');
    }
    if (runOptions.allowPartial !== true && stripWidth > prepared.bounds.width + widthTolerance) {
      throw new Error(
        'Sparrow needs ' + stripWidth.toFixed(3) +
        ' units of width, but the selected sheet has ' +
        prepared.bounds.width.toFixed(3) + '.'
      );
    }
    return {
      placement: {
        sheet: prepared.sheet,
        sheetid: prepared.sheetid,
        sheetplacements: sheetplacements
      },
      unplaced: unplaced,
      stripWidth: runOptions.allowPartial === true ? usedWidth : stripWidth,
      requestedStripWidth: stripWidth,
      density: finite(solution.density, 0),
      elapsedMs: Date.now() - startedAt
    };
  }).then(function (result) {
    if (!runOptions.keepTemp) {
      try {
        removeTree(runDir);
      }
      catch (err) {
        // Temporary solver output is non-critical and can be cleaned by the OS.
      }
    }
    return result;
  }, function (error) {
    if (!runOptions.keepTemp) {
      try {
        removeTree(runDir);
      }
      catch (cleanupError) {
        // Preserve the solver error; temporary output can be cleaned by the OS.
      }
    }
    throw error;
  });
}

function runJob(job, options) {
  options = options || {};
  var mode = normalizeMode(job && job.mode);
  var binaryPath = resolveBinary(options);
  if (!binaryPath) {
    throw new Error(
      'The Sparrow solver is not installed for ' + platformKey() + '.'
    );
  }
  var sheets = Array.isArray(job.sheets) ? job.sheets : [];
  if (sheets.length === 0) {
    throw new Error('Sparrow received no sheet work.');
  }
  if (mode === 'sparrow' && sheets.length !== 1) {
    throw new Error('Pure Sparrow accepts exactly one strip sheet.');
  }
  var timeLimitSec = Math.max(1, Math.min(300, Math.floor(finite(job.timeLimitSec, 15))));
  var workers = Math.max(1, Math.min(32, Math.floor(finite(job.workers, 1))));
  var seed = Math.max(0, Math.floor(finite(job.seed, 1)));
  var minimumSeparation = Math.max(0, finite(job.minimumSeparation, 0));
  var validationRetry = Math.max(0, Math.floor(finite(job.validationRetry, 0)));
  var partsBySource = job.partsBySource || {};
  var placements = [];
  var unplaced = [];
  var stripStats = [];
  var totalBeforeWidth = 0;
  var totalAfterWidth = 0;
  var totalRequestedParts = 0;
  var startedAt = Date.now();

  var sequence = Promise.resolve();
  sheets.forEach(function (sheet, index) {
    sequence = sequence.then(function () {
      if (typeof options.onProgress === 'function') {
        options.onProgress({
          index: index,
          total: sheets.length,
          progress: index / sheets.length
        });
      }
      var prepared = prepareStrip(sheet, partsBySource, mode);
      totalRequestedParts += prepared.groups.reduce(function (total, group) {
        return total + group.instanceIds.length;
      }, 0);
      return runStrip(binaryPath, prepared, {
        token: job.token,
        index: index,
        timeLimitSec: timeLimitSec,
        workers: workers,
        seed: seed + index,
        minimumSeparation: minimumSeparation,
        allowPartial: mode === 'sparrow' || prepared.allowPartial,
        keepTemp: options.keepTemp === true
      }).then(function (result) {
        placements.push(result.placement);
        unplaced = unplaced.concat(result.unplaced || []);
        totalBeforeWidth += prepared.beforeWidth;
        totalAfterWidth += result.stripWidth;
        stripStats.push({
          sheet: prepared.sheet,
          sheetid: prepared.sheetid,
          beforeWidth: prepared.beforeWidth,
          afterWidth: result.stripWidth,
          requestedAfterWidth: result.requestedStripWidth,
          density: result.density,
          elapsedMs: result.elapsedMs,
          parts: result.placement.sheetplacements.length,
          unplacedParts: (result.unplaced || []).length,
          warmStarted: !!prepared.warmSolution,
          seedIncomplete: prepared.seedIncomplete === true
        });
      });
    });
  });

  return sequence.then(function () {
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        index: sheets.length,
        total: sheets.length,
        progress: 1
      });
    }
    var relativeImprovement = mode === 'hybrid' && totalBeforeWidth > 0 ?
      Math.max(0, (totalBeforeWidth - totalAfterWidth) / totalBeforeWidth) : 0;
    return {
      ok: true,
      token: job.token,
      placements: placements,
      unplaced: unplaced,
      solver: {
        mode: mode,
        engine: mode === 'hybrid' ? 'Deepnest + Sparrow' : 'Sparrow',
        status: 'candidate',
        pinnedCommit: PINNED_COMMIT,
        continuousRotation: true,
        timeLimitSecPerSheet: timeLimitSec,
        workers: workers,
        seed: seed,
        minimumSeparation: minimumSeparation,
        validationRetry: validationRetry,
        elapsedMs: Date.now() - startedAt,
        beforeWidth: totalBeforeWidth,
        afterWidth: totalAfterWidth,
        relativeImprovement: relativeImprovement,
        requestedParts: totalRequestedParts,
        placedParts: totalRequestedParts - unplaced.length,
        unplacedParts: unplaced.length,
        partial: unplaced.length > 0,
        warmStarted: stripStats.every(function (strip) { return strip.warmStarted; }),
        seedIncomplete: stripStats.some(function (strip) { return strip.seedIncomplete; }),
        strips: stripStats
      }
    };
  });
}

function cancelAll() {
  activeChildren.forEach(function (child) {
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
    }
    catch (err) {
      // A completed process can disappear between iteration and kill.
    }
  });
  activeChildren.clear();
}

module.exports = {
  PINNED_COMMIT: PINNED_COMMIT,
  binaryCandidates: binaryCandidates,
  resolveBinary: resolveBinary,
  status: status,
  simplePolygon: simplePolygon,
  prepareStrip: prepareStrip,
  runJob: runJob,
  cancelAll: cancelAll
};

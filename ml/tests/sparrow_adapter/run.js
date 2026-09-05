'use strict';

const assert = require('assert');
const path = require('path');
const Sparrow = require('../../../main/sparrow-adapter');

function rectangle(x, y, width, height) {
  return [
    {x: x, y: y},
    {x: x + width, y: y},
    {x: x + width, y: y + height},
    {x: x, y: y + height}
  ];
}

function assertConversion() {
  const ring = rectangle(10, 20, 20, 10);
  ring.push({x: 10, y: 20});
  assert.deepStrictEqual(Sparrow.simplePolygon(ring), [
    [10, 20],
    [30, 20],
    [30, 30],
    [10, 30]
  ]);

  const prepared = Sparrow.prepareStrip({
    sheet: 2,
    sheetid: 7,
    bounds: {x: 100, y: 50, width: 200, height: 80},
    instances: [
      {id: 11, source: 0},
      {id: 12, source: 0}
    ],
    initialPlacements: [
      {id: 11, source: 0, x: 90, y: 30, rotation: 0},
      {id: 12, source: 0, x: 120, y: 30, rotation: 90}
    ]
  }, {0: ring}, 'hybrid');

  assert.strictEqual(prepared.instance.items.length, 1);
  assert.strictEqual(prepared.instance.items[0].demand, 2);
  assert.strictEqual(prepared.warmSolution.layout.placed_items.length, 2);
  assert.strictEqual(prepared.warmSolution.layout.placed_items[0].transformation.translation[0], -10);
  assert.strictEqual(prepared.warmSolution.layout.placed_items[0].transformation.translation[1], -20);
  assert.ok(prepared.beforeWidth > 0);

  const coldPrepared = Sparrow.prepareStrip({
    sheet: 2,
    sheetid: 7,
    bounds: {x: 100, y: 50, width: 200, height: 80},
    beforeWidth: 125,
    instances: [
      {id: 11, source: 0},
      {id: 12, source: 0},
      {id: 13, source: 0}
    ],
    initialPlacements: [],
    allowPartial: true,
    seedIncomplete: true
  }, {0: ring}, 'hybrid');
  assert.strictEqual(coldPrepared.warmSolution, null);
  assert.strictEqual(coldPrepared.beforeWidth, 125);
  assert.strictEqual(coldPrepared.allowPartial, true);
  assert.strictEqual(coldPrepared.seedIncomplete, true);

  assert.throws(() => Sparrow.prepareStrip({
    sheet: 2,
    sheetid: 7,
    bounds: {x: 100, y: 50, width: 200, height: 80},
    instances: [
      {id: 11, source: 0},
      {id: 12, source: 0}
    ],
    initialPlacements: [
      {id: 11, source: 0, x: 90, y: 30, rotation: 0}
    ]
  }, {0: ring}, 'hybrid'), /does not match/);
}

function assertResolution() {
  const rootDir = path.resolve(__dirname, '../../..');
  const resolved = Sparrow.resolveBinary({rootDir: rootDir});
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    assert.ok(resolved, 'the pinned Apple-silicon binary must be bundled');
    assert.ok(Sparrow.status().available, 'Sparrow status must report available');
  }
  else if (!process.env.DEEPNEST_SPARROW_BIN) {
    assert.strictEqual(resolved, null, 'unsupported platforms must fail closed');
  }

  const windowsCandidates = Sparrow.binaryCandidates({
    rootDir: rootDir,
    platform: 'win32',
    arch: 'x64'
  });
  assert.ok(windowsCandidates.some((candidate) => /win32-x64[\\/]sparrow\.exe$/.test(candidate)));

  const packagedCandidates = Sparrow.binaryCandidates({
    rootDir: path.join(rootDir, 'dist', 'Example.app', 'Contents', 'Resources', 'app.asar'),
    platform: 'darwin',
    arch: 'arm64'
  });
  const virtualIndex = packagedCandidates.findIndex((candidate) =>
    /Resources[\\/]app\.asar[\\/]vendor[\\/]sparrow/.test(candidate));
  const unpackedIndex = packagedCandidates.findIndex((candidate) =>
    /Resources[\\/]app\.asar\.unpacked[\\/]vendor[\\/]sparrow/.test(candidate));
  assert.ok(unpackedIndex >= 0, 'packaged candidates must include app.asar.unpacked');
  assert.ok(virtualIndex < 0 || unpackedIndex < virtualIndex,
    'app.asar.unpacked must be preferred over the virtual archive path');
}

async function assertNativeRun() {
  const result = await Sparrow.runJob({
    token: 'adapter-test',
    mode: 'sparrow',
    timeLimitSec: 1,
    workers: 2,
    seed: 7,
    minimumSeparation: 0.01,
    partsBySource: {
      0: rectangle(10, 20, 20, 10)
    },
    sheets: [{
      sheet: 1,
      sheetid: 0,
      bounds: {x: 50, y: 75, width: 100, height: 50},
      instances: [
        {id: 0, source: 0},
        {id: 1, source: 0}
      ]
    }]
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.placements.length, 1);
  assert.strictEqual(result.placements[0].sheetplacements.length, 2);
  assert.deepStrictEqual(
    result.placements[0].sheetplacements.map((placement) => placement.id).sort(),
    [0, 1]
  );
  for (const placement of result.placements[0].sheetplacements) {
    assert.ok(Number.isFinite(placement.x));
    assert.ok(Number.isFinite(placement.y));
    assert.ok(Number.isFinite(placement.rotation));
  }
  assert.ok(result.solver.afterWidth <= 100.001);
  assert.strictEqual(result.solver.minimumSeparation, 0.01);
  assert.strictEqual(result.solver.validationRetry, 0);
}

async function assertPartialCapacityRun() {
  const instances = [
    {id: 0, source: 0},
    {id: 1, source: 0},
    {id: 2, source: 0}
  ];
  const result = await Sparrow.runJob({
    token: 'adapter-partial-capacity-test',
    mode: 'hybrid',
    timeLimitSec: 1,
    workers: 2,
    seed: 11,
    minimumSeparation: 0.01,
    partsBySource: {
      0: rectangle(0, 0, 20, 10)
    },
    sheets: [{
      sheet: 1,
      sheetid: 0,
      bounds: {x: 0, y: 0, width: 45, height: 12},
      beforeWidth: 40,
      instances: instances,
      initialPlacements: [],
      allowPartial: true,
      seedIncomplete: true
    }]
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.solver.requestedParts, 3);
  assert.strictEqual(result.solver.placedParts + result.solver.unplacedParts, 3);
  assert.ok(result.solver.placedParts > 0);
  assert.ok(result.solver.placedParts < 3);
  assert.strictEqual(result.solver.partial, true);
  assert.strictEqual(result.solver.warmStarted, false);
  assert.strictEqual(result.solver.seedIncomplete, true);
  assert.strictEqual(result.unplaced.length, result.solver.unplacedParts);
  assert.ok(result.solver.afterWidth <= 45.001);
}

async function main() {
  assertConversion();
  assertResolution();
  const binary = Sparrow.resolveBinary();
  if (binary) {
    await assertNativeRun();
    await assertPartialCapacityRun();
  }
  console.log(JSON.stringify({
    ok: true,
    pinnedCommit: Sparrow.PINNED_COMMIT,
    binary: binary,
    nativeRun: !!binary
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  rectangle,
  assertConversion,
  assertResolution,
  assertNativeRun,
  assertPartialCapacityRun
};

'use strict';

const assert = require('assert');
const path = require('path');
const physicsNest = require('./physics-nest.js');

function squarePart(id, size) {
  const half = size / 2;
  return {
    id,
    sourceIndex: 0,
    paths: [[
      { x: -half, y: -half },
      { x: half, y: -half },
      { x: half, y: half },
      { x: -half, y: half }
    ]],
    width: size,
    height: size,
    area: size * size
  };
}

function validateSquares(aPose, bPose, options) {
  const a = squarePart('a', 10);
  const b = squarePart('b', 10);
  return physicsNest.validateLayout(physicsNest.makeLayout([a, b], [aPose, bPose]), {
    width: 100,
    height: 100
  }, Object.assign({
    clipperScale: 10000,
    spacing: 0
  }, options || {}));
}

function runTests() {
  const fixture = path.join(__dirname, '..', '..', 'testpart.svg');
  const parsed = physicsNest.parseSvgFile(fixture, {
    curveTolerance: 0.5
  });
  assert.strictEqual(parsed.parts.length, 5, 'testpart.svg should expose five closed parts');

  [0.35, 0.55, 0.8, 1.0, 1.25, 1.5].forEach((scale) => {
    const result = physicsNest.runNest(fixture, {
      partScale: scale,
      sheet: {
        width: parsed.viewBox.width * scale * 1.18,
        height: parsed.viewBox.height * scale * 2.5
      },
      iterations: 90,
      curveTolerance: 0.5,
      seed: 1000 + Math.round(scale * 1000),
      clipperScale: 10000,
      spacing: 0
    });
    assert.strictEqual(result.metrics.valid, true, 'layout should stay valid at scale ' + scale);
    assert.strictEqual(result.metrics.overlapPairs, 0, 'no overlaps at scale ' + scale);
    assert.strictEqual(result.metrics.outsideParts, 0, 'no sheet escapes at scale ' + scale);
    assert.ok(result.metrics.scoreAfter <= result.metrics.scoreBefore + 1e-9, 'jostle should not worsen score at scale ' + scale);
  });

  const bestOf = physicsNest.runNest(fixture, {
    partScale: 1,
    sheet: {
      width: parsed.viewBox.width * 1.18,
      height: parsed.viewBox.height * 2.5
    },
    iterations: 35,
    restarts: 5,
    gravity: 22,
    shake: 18,
    rotationStep: 3,
    curveTolerance: 0.5,
    seed: 2200,
    clipperScale: 10000,
    spacing: 0
  });
  const bestScore = Math.min.apply(null, bestOf.attempts.map((attempt) => attempt.scoreAfter));
  assert.strictEqual(bestOf.metrics.valid, true, 'best-of result should stay valid');
  assert.strictEqual(bestOf.metrics.overlapPairs, 0, 'best-of result should have no overlap pairs');
  assert.strictEqual(bestOf.metrics.outsideParts, 0, 'best-of result should stay inside sheet');
  assert.strictEqual(bestOf.attempts.length, 5, 'best-of should record each shake attempt');
  assert.strictEqual(bestOf.metrics.scoreAfter, bestScore, 'best-of should keep the lowest score');

  const overlapping = validateSquares(
    { x: 20, y: 20, rotation: 0 },
    { x: 24, y: 20, rotation: 0 }
  );
  assert.strictEqual(overlapping.valid, false, 'overlapping squares must be rejected');
  assert.strictEqual(overlapping.overlapPairs.length, 1, 'overlap pair must be reported');
  assert.ok(overlapping.overlapPairs[0].area > 0, 'overlap area must be positive');

  const touching = validateSquares(
    { x: 20, y: 20, rotation: 0 },
    { x: 30, y: 20, rotation: 0 }
  );
  assert.strictEqual(touching.valid, true, 'edge-touching without area overlap should be legal');

  const tinyOverlap = validateSquares(
    { x: 20, y: 20, rotation: 0 },
    { x: 29.9995, y: 20, rotation: 0 }
  );
  assert.strictEqual(tinyOverlap.valid, false, 'sub-unit overlap must still be rejected');
  assert.ok(tinyOverlap.overlapPairs[0].area > 0, 'tiny overlap area must be positive');

  const tinyGap = validateSquares(
    { x: 20, y: 20, rotation: 0 },
    { x: 30.001, y: 20, rotation: 0 }
  );
  assert.strictEqual(tinyGap.valid, true, 'tiny non-overlap gap should remain legal');

  const clearanceViolation = validateSquares(
    { x: 20, y: 20, rotation: 0 },
    { x: 30.4, y: 20, rotation: 0 },
    { spacing: 1 }
  );
  assert.strictEqual(clearanceViolation.valid, false, 'spacing should reject shapes closer than requested clearance');

  const outside = physicsNest.validateLayout(physicsNest.makeLayout([squarePart('outside', 10)], [
    { x: 2, y: 20, rotation: 0 }
  ]), {
    width: 100,
    height: 100
  }, {
    clipperScale: 10000,
    spacing: 0
  });
  assert.strictEqual(outside.valid, false, 'part outside sheet must be rejected');
  assert.strictEqual(outside.outsideParts.length, 1, 'outside part must be reported');

  const pathPolys = physicsNest.parsePathData('M0 0 C10 0 10 10 20 10 L20 20 L0 20 Z', 0.25);
  assert.strictEqual(pathPolys.length, 1, 'cubic path should flatten into one polygon');
  assert.ok(pathPolys[0].length > 4, 'cubic flattening should add curve points');

  console.log('physics-nest tests passed');
}

if (require.main === module) {
  runTests();
}

module.exports = {
  runTests
};

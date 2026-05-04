'use strict';

const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

if (!process.versions.electron) {
  console.error('This profile must run with Electron-as-Node because addon.node is built for the Electron ABI.');
  console.error('Use: bash ml/tests/nfp_profile/run.sh');
  process.exit(2);
}

const ClipperLib = require(path.join(repoRoot, 'main', 'util', 'clippernode.js'));
const addon = require(path.join(repoRoot, 'build', 'Release', 'addon.node'));

const CLIPPER_SCALE = 10000000;
const DEFAULT_ITERATIONS = 250;
const WARMUP_ITERATIONS = 20;

const fixtures = [
  {
    name: 'rect-vs-rect',
    iterations: DEFAULT_ITERATIONS,
    A: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 }
    ],
    B: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 }
    ]
  },
  {
    name: 'concave-l-vs-rect',
    iterations: DEFAULT_ITERATIONS,
    A: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 50 },
      { x: 0, y: 50 }
    ],
    B: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]
  },
  {
    name: 'irregular-vs-irregular',
    iterations: DEFAULT_ITERATIONS,
    A: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 50, y: 20 },
      { x: 30, y: 35 },
      { x: 0, y: 30 }
    ],
    B: [
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 20, y: 8 },
      { x: 4, y: 16 },
      { x: -2, y: 7 }
    ]
  },
  {
    name: 'wavy-96-vs-wavy-72',
    iterations: 80,
    A: makeWavyPolygon(96, 80, 16, 0.19),
    B: makeWavyPolygon(72, 24, 6, 0.43)
  },
  {
    name: 'rect-with-hole-vs-rect',
    iterations: 160,
    A: withChildren([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 90 },
      { x: 0, y: 90 }
    ], [[
      { x: 35, y: 25 },
      { x: 85, y: 25 },
      { x: 85, y: 65 },
      { x: 35, y: 65 }
    ]]),
    B: [
      { x: 0, y: 0 },
      { x: 22, y: 0 },
      { x: 22, y: 16 },
      { x: 0, y: 16 }
    ],
    holeFixture: true
  }
];

function makeWavyPolygon(count, radius, amplitude, phase) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = (Math.PI * 2 * i) / count;
    const r = radius + amplitude * Math.sin(5 * t + phase) + amplitude * 0.45 * Math.sin(11 * t);
    points.push({
      x: Math.cos(t) * r,
      y: Math.sin(t) * r
    });
  }
  return points;
}

function withChildren(poly, children) {
  const result = clonePolygon(poly);
  result.children = children.map(clonePolygon);
  return result;
}

function clonePolygon(poly) {
  const result = poly.map(function (point) {
    return { x: point.x, y: point.y };
  });
  if (poly.children) {
    result.children = poly.children.map(clonePolygon);
  }
  return result;
}

function stripChildren(poly) {
  const result = clonePolygon(poly);
  result.children = [];
  return result;
}

function toClipperCoordinates(poly) {
  return poly.map(function (point) {
    return { X: point.x, Y: point.y };
  });
}

function toNestCoordinates(poly, scale) {
  return poly.map(function (point) {
    return { x: point.X / scale, y: point.Y / scale };
  });
}

function polygonArea(poly) {
  if (!poly || poly.length < 3) {
    return 0;
  }
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return area / 2;
}

function jsClipperOuterNfp(A, B) {
  const Ac = toClipperCoordinates(clonePolygon(A));
  const Bc = toClipperCoordinates(clonePolygon(B));

  ClipperLib.JS.ScaleUpPath(Ac, CLIPPER_SCALE);
  ClipperLib.JS.ScaleUpPath(Bc, CLIPPER_SCALE);

  for (let i = 0; i < Bc.length; i++) {
    Bc[i].X *= -1;
    Bc[i].Y *= -1;
  }

  const solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
  let best = null;
  let bestArea = null;

  for (let i = 0; i < solution.length; i++) {
    const candidate = toNestCoordinates(solution[i], CLIPPER_SCALE);
    const area = -polygonArea(candidate);
    if (bestArea === null || area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }

  if (!best) {
    return null;
  }

  for (let i = 0; i < best.length; i++) {
    best[i].x += B[0].x;
    best[i].y += B[0].y;
  }

  return best;
}

function nativeOuterNfp(A, B, processHoles) {
  return largestNativeRing(addon.calculateNFP({
    A: processHoles === false ? stripChildren(A) : clonePolygon(A),
    B: clonePolygon(B)
  }));
}

function largestNativeRing(nativeResult) {
  if (!Array.isArray(nativeResult) || nativeResult.length === 0) {
    return null;
  }

  let best = null;
  let bestArea = null;
  for (let i = 0; i < nativeResult.length; i++) {
    if (!Array.isArray(nativeResult[i])) {
      continue;
    }
    const area = Math.abs(polygonArea(nativeResult[i]));
    if (bestArea === null || area > bestArea) {
      best = nativeResult[i];
      bestArea = area;
    }
  }
  return best;
}

function checksum(poly) {
  if (!poly) {
    return 'missing';
  }
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    sum += (poly[i].x * 31.4159) + (poly[i].y * 17.1828);
  }
  return sum.toFixed(3);
}

function nowNs() {
  return process.hrtime.bigint();
}

function measure(label, iterations, fn) {
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    fn();
  }

  const samples = [];
  let lastResult = null;
  for (let i = 0; i < iterations; i++) {
    const start = nowNs();
    lastResult = fn();
    const elapsed = Number(nowNs() - start) / 1e6;
    samples.push(elapsed);
  }

  samples.sort(function (a, b) {
    return a - b;
  });

  const total = samples.reduce(function (acc, value) {
    return acc + value;
  }, 0);

  return {
    label: label,
    iterations: iterations,
    minMs: samples[0],
    medianMs: samples[Math.floor(samples.length / 2)],
    meanMs: total / samples.length,
    maxMs: samples[samples.length - 1],
    points: lastResult ? lastResult.length : 0,
    checksum: checksum(lastResult)
  };
}

function formatMs(value) {
  return value.toFixed(3).padStart(8);
}

function printResult(fixtureName, result, baseline) {
  const relative = baseline && baseline.meanMs > 0 ? result.meanMs / baseline.meanMs : null;
  const relativeText = relative === null ? '' : ('  timeVsNative=' + relative.toFixed(2) + 'x');
  console.log([
    fixtureName.padEnd(24),
    result.label.padEnd(22),
    ('n=' + result.iterations).padEnd(8),
    'mean=' + formatMs(result.meanMs) + 'ms',
    'median=' + formatMs(result.medianMs) + 'ms',
    'min=' + formatMs(result.minMs) + 'ms',
    'max=' + formatMs(result.maxMs) + 'ms',
    ('pts=' + result.points).padEnd(8),
    'checksum=' + result.checksum,
    relativeText
  ].join('  '));
}

function runProfile() {
  const iterationOverride = parseInt(process.env.NFP_PROFILE_ITERATIONS || process.argv[2] || '', 10);

  console.log('NFP profile');
  console.log('Electron:', process.versions.electron);
  console.log('Node:', process.versions.node);
  console.log('Iterations:', Number.isFinite(iterationOverride) ? iterationOverride + ' override' : 'fixture defaults');
  console.log('');

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const iterations = Number.isFinite(iterationOverride) ? iterationOverride : fixture.iterations;

    const nativeResult = measure('native-boost', iterations, function () {
      return nativeOuterNfp(fixture.A, fixture.B, true);
    });
    printResult(fixture.name, nativeResult, null);

    if (!fixture.holeFixture) {
      const clipperResult = measure('js-clipper', iterations, function () {
        return jsClipperOuterNfp(fixture.A, fixture.B);
      });
      printResult(fixture.name, clipperResult, nativeResult);
    }
    else {
      const nativeNoHoles = measure('native-no-holes', iterations, function () {
        return nativeOuterNfp(fixture.A, fixture.B, false);
      });
      printResult(fixture.name, nativeNoHoles, nativeResult);
    }

    console.log('');
  }
}

runProfile();

'use strict';

const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

if (!process.versions.electron) {
  console.error('This test must run with Electron-as-Node because addon.node is built for the Electron ABI.');
  console.error('Use: bash ml/tests/nfp_equivalence/run.sh');
  process.exit(2);
}

const ClipperLib = require(path.join(repoRoot, 'main', 'util', 'clippernode.js'));
const addon = require(path.join(repoRoot, 'build', 'Release', 'addon.node'));

const CLIPPER_SCALE = 10000000;
const SNAP_DECIMALS = 3;
const COLLINEAR_EPSILON = 1e-6;

const fixtures = [
  {
    name: 'rect-vs-rect',
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
    name: 'triangle-vs-rect',
    A: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 30, y: 40 }
    ],
    B: [
      { x: 0, y: 0 },
      { x: 18, y: 0 },
      { x: 18, y: 12 },
      { x: 0, y: 12 }
    ]
  },
  {
    name: 'concave-l-vs-rect',
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
  }
];

function clonePolygon(poly) {
  return poly.map(function (point) {
    return { x: point.x, y: point.y };
  });
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

function roundPoint(point) {
  const factor = Math.pow(10, SNAP_DECIMALS);
  return {
    x: Math.round(point.x * factor) / factor,
    y: Math.round(point.y * factor) / factor
  };
}

function samePoint(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

function removeDuplicateClose(poly) {
  const cleaned = poly.map(roundPoint);
  while (cleaned.length > 1 && samePoint(cleaned[0], cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  for (let i = 0; i < cleaned.length; i++) {
    const next = (i + 1) % cleaned.length;
    if (samePoint(cleaned[i], cleaned[next])) {
      cleaned.splice(next, 1);
      i--;
    }
  }
  return cleaned;
}

function isCollinear(a, b, c) {
  const cross = ((b.x - a.x) * (c.y - b.y)) - ((b.y - a.y) * (c.x - b.x));
  return Math.abs(cross) <= COLLINEAR_EPSILON;
}

function removeCollinear(poly) {
  const cleaned = poly.slice();
  let changed = true;
  while (changed && cleaned.length > 3) {
    changed = false;
    for (let i = 0; i < cleaned.length; i++) {
      const prev = cleaned[(i - 1 + cleaned.length) % cleaned.length];
      const current = cleaned[i];
      const next = cleaned[(i + 1) % cleaned.length];
      if (isCollinear(prev, current, next)) {
        cleaned.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return cleaned;
}

function canonicalRing(poly) {
  let ring = removeCollinear(removeDuplicateClose(poly));

  if (polygonArea(ring) > 0) {
    ring = ring.slice().reverse();
  }

  let startIndex = 0;
  for (let i = 1; i < ring.length; i++) {
    const current = ring[i];
    const start = ring[startIndex];
    if (current.x < start.x || (current.x === start.x && current.y < start.y)) {
      startIndex = i;
    }
  }

  return ring.slice(startIndex).concat(ring.slice(0, startIndex));
}

function serializeRing(poly) {
  return canonicalRing(poly).map(function (point) {
    return point.x + ',' + point.y;
  }).join(' ');
}

function assertEquivalent(fixture) {
  const nativeResult = addon.calculateNFP({
    A: clonePolygon(fixture.A),
    B: clonePolygon(fixture.B)
  });
  const nativeRing = largestNativeRing(nativeResult);
  const jsRing = jsClipperOuterNfp(fixture.A, fixture.B);

  if (!nativeRing || !jsRing) {
    throw new Error('missing NFP result');
  }

  const nativeCanonical = serializeRing(nativeRing);
  const jsCanonical = serializeRing(jsRing);

  if (nativeCanonical !== jsCanonical) {
    throw new Error([
      'canonical rings differ',
      'native: ' + nativeCanonical,
      'js:     ' + jsCanonical
    ].join('\n'));
  }

  return {
    name: fixture.name,
    nativePoints: nativeRing.length,
    jsPoints: jsRing.length,
    canonicalPoints: canonicalRing(nativeRing).length,
    area: Math.abs(polygonArea(nativeRing))
  };
}

let failures = 0;

for (let i = 0; i < fixtures.length; i++) {
  try {
    const result = assertEquivalent(fixtures[i]);
    console.log('ok', result.name, 'nativePts=' + result.nativePoints, 'jsPts=' + result.jsPoints, 'canonicalPts=' + result.canonicalPoints, 'area=' + result.area.toFixed(3));
  }
  catch (err) {
    failures++;
    console.error('not ok', fixtures[i].name);
    console.error(err && err.stack ? err.stack : err);
  }
}

if (failures > 0) {
  process.exit(1);
}

console.log('NFP equivalence passed:', fixtures.length, 'fixtures');

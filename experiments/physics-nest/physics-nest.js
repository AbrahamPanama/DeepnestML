#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

global.self = global;
require(path.join(__dirname, '..', '..', 'main', 'util', 'clipper.js'));
const ClipperLib = global.ClipperLib;

const DEFAULTS = {
  curveTolerance: 0.75,
  clipperScale: 10000,
  iterations: 220,
  gravity: 18,
  shake: 6,
  rotationStep: 2,
  restarts: 1,
  spacing: 0,
  seed: 42
};

function usage() {
  return [
    'Usage:',
    '  node experiments/physics-nest/physics-nest.js --input testpart.svg --output /tmp/physics-nest.svg',
    '',
    'Options:',
    '  --sheet WxH              Sheet size in SVG units. Defaults to viewBox with extra height.',
    '  --part-scale N           Uniform part scale. Default: 1',
    '  --spacing N              Conservative part/sheet clearance. Default: 0',
    '  --iterations N           Jostle iterations. Default: 220',
    '  --best-of N              Run N shake attempts and keep the best legal one. Default: 1',
    '  --gravity N              Directional pull toward sheet origin. Default: 18',
    '  --shake N                Random translation energy. Default: 6',
    '  --rotation-step N        Rotation probe size in degrees. Default: 2',
    '  --curve-tolerance N      SVG curve flattening tolerance. Default: 0.75',
    '  --clipper-scale N        Integer collision precision. Default: 10000',
    '  --trace PATH             Write live state JSON while the search runs',
    '  --trace-every N          Trace every N iterations. Default: 2',
    '  --seed N                 Deterministic random seed. Default: 42',
    '  --json PATH              Optional JSON report path',
    '  --test                   Run prototype collision/layout tests',
    ''
  ].join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.indexOf('--') !== 0) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (typeof next !== 'undefined' && next.indexOf('--') !== 0) {
      args[key] = next;
      i++;
    }
    else {
      args[key] = true;
    }
  }
  return args;
}

function createRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return function random() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffleIndexes(length, rng) {
  const indexes = [];
  for (let i = 0; i < length; i++) {
    indexes.push(i);
  }
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = indexes[i];
    indexes[i] = indexes[j];
    indexes[j] = tmp;
  }
  return indexes;
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSheet(value) {
  if (!value) {
    return null;
  }
  const match = String(value).trim().match(/^([0-9.+-]+)x([0-9.+-]+)$/i);
  if (!match) {
    throw new Error('invalid --sheet; expected WIDTHxHEIGHT');
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

function parseAttributes(tagText) {
  const attrs = {};
  const attrRe = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRe.exec(tagText))) {
    attrs[match[1]] = typeof match[3] === 'string' ? match[3] : match[4];
  }
  return attrs;
}

function parseViewBox(svgText) {
  const svgMatch = svgText.match(/<svg\b[^>]*>/i);
  if (!svgMatch) {
    throw new Error('input does not contain an <svg> root');
  }
  const attrs = parseAttributes(svgMatch[0]);
  if (attrs.viewBox) {
    const parts = attrs.viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  }
  const width = parseLength(attrs.width);
  const height = parseLength(attrs.height);
  if (width && height) {
    return { x: 0, y: 0, width, height };
  }
  throw new Error('input SVG needs a viewBox or numeric width/height');
}

function parseLength(value) {
  if (!value) {
    return null;
  }
  const match = String(value).match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/);
  return match ? Number(match[0]) : null;
}

function tokenizePath(d) {
  const tokens = [];
  const re = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
  let match;
  while ((match = re.exec(d))) {
    tokens.push(match[0]);
  }
  return tokens;
}

function isCommand(token) {
  return /^[A-Za-z]$/.test(token);
}

function distancePointToLine(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    return Math.sqrt(Math.pow(point.x - a.x, 2) + Math.pow(point.y - a.y, 2));
  }
  return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / len;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function flattenCubic(p0, p1, p2, p3, tolerance, out, depth) {
  const flat = Math.max(distancePointToLine(p1, p0, p3), distancePointToLine(p2, p0, p3)) <= tolerance;
  if (flat || depth > 14) {
    out.push({ x: p3.x, y: p3.y });
    return;
  }
  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p23 = midpoint(p2, p3);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const p0123 = midpoint(p012, p123);
  flattenCubic(p0, p01, p012, p0123, tolerance, out, depth + 1);
  flattenCubic(p0123, p123, p23, p3, tolerance, out, depth + 1);
}

function flattenQuadratic(p0, p1, p2, tolerance, out, depth) {
  const flat = distancePointToLine(p1, p0, p2) <= tolerance;
  if (flat || depth > 14) {
    out.push({ x: p2.x, y: p2.y });
    return;
  }
  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p012 = midpoint(p01, p12);
  flattenQuadratic(p0, p01, p012, tolerance, out, depth + 1);
  flattenQuadratic(p012, p12, p2, tolerance, out, depth + 1);
}

function angleBetween(ux, uy, vx, vy) {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  return sign * Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
}

function flattenArc(p0, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, p1, tolerance, out) {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) {
    out.push({ x: p1.x, y: p1.y });
    return;
  }

  const phi = xAxisRotation * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const denom = rx2 * y1p2 + ry2 * x1p2;
  const coef = sign * Math.sqrt(Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (denom || 1)));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;
  const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleBetween(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry
  );
  if (!sweepFlag && delta > 0) {
    delta -= Math.PI * 2;
  }
  if (sweepFlag && delta < 0) {
    delta += Math.PI * 2;
  }

  const maxRadius = Math.max(rx, ry);
  const byTolerance = tolerance > 0 ? Math.ceil(Math.abs(delta) / Math.max(0.08, 2 * Math.acos(Math.max(-1, 1 - tolerance / maxRadius)))) : 24;
  const segments = Math.max(4, Math.min(256, byTolerance));
  for (let i = 1; i <= segments; i++) {
    const theta = theta1 + delta * (i / segments);
    const x = cosPhi * rx * Math.cos(theta) - sinPhi * ry * Math.sin(theta) + cx;
    const y = sinPhi * rx * Math.cos(theta) + cosPhi * ry * Math.sin(theta) + cy;
    out.push({ x, y });
  }
}

function parsePathData(d, tolerance) {
  const tokens = tokenizePath(d);
  const subpaths = [];
  let index = 0;
  let command = null;
  let current = { x: 0, y: 0 };
  let start = null;
  let active = [];
  let lastCubicControl = null;
  let lastQuadraticControl = null;

  function readNumber() {
    if (index >= tokens.length || isCommand(tokens[index])) {
      throw new Error('invalid SVG path data near token ' + index);
    }
    return Number(tokens[index++]);
  }

  function hasNumber() {
    return index < tokens.length && !isCommand(tokens[index]);
  }

  function finishActive(close) {
    if (active.length > 2) {
      if (close && start) {
        const last = active[active.length - 1];
        if (!samePoint(last, start, 1e-9)) {
          active.push({ x: start.x, y: start.y });
        }
      }
      subpaths.push(dropDuplicateClose(active));
    }
    active = [];
    start = null;
  }

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }
    if (!command) {
      throw new Error('SVG path starts without command');
    }

    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === 'M') {
      const x = readNumber();
      const y = readNumber();
      finishActive(false);
      current = relative ? { x: current.x + x, y: current.y + y } : { x, y };
      start = { x: current.x, y: current.y };
      active.push({ x: current.x, y: current.y });
      command = relative ? 'l' : 'L';
      while (hasNumber()) {
        const lx = readNumber();
        const ly = readNumber();
        current = relative ? { x: current.x + lx, y: current.y + ly } : { x: lx, y: ly };
        active.push({ x: current.x, y: current.y });
      }
      lastCubicControl = null;
      lastQuadraticControl = null;
    }
    else if (upper === 'L') {
      while (hasNumber()) {
        const x = readNumber();
        const y = readNumber();
        current = relative ? { x: current.x + x, y: current.y + y } : { x, y };
        active.push({ x: current.x, y: current.y });
      }
      lastCubicControl = null;
      lastQuadraticControl = null;
    }
    else if (upper === 'H') {
      while (hasNumber()) {
        const x = readNumber();
        current = { x: relative ? current.x + x : x, y: current.y };
        active.push({ x: current.x, y: current.y });
      }
      lastCubicControl = null;
      lastQuadraticControl = null;
    }
    else if (upper === 'V') {
      while (hasNumber()) {
        const y = readNumber();
        current = { x: current.x, y: relative ? current.y + y : y };
        active.push({ x: current.x, y: current.y });
      }
      lastCubicControl = null;
      lastQuadraticControl = null;
    }
    else if (upper === 'C') {
      while (hasNumber()) {
        const p0 = current;
        const c1 = makePoint(readNumber(), readNumber(), current, relative);
        const c2 = makePoint(readNumber(), readNumber(), current, relative);
        const p = makePoint(readNumber(), readNumber(), current, relative);
        flattenCubic(p0, c1, c2, p, tolerance, active, 0);
        current = p;
        lastCubicControl = c2;
        lastQuadraticControl = null;
      }
    }
    else if (upper === 'S') {
      while (hasNumber()) {
        const p0 = current;
        const c1 = lastCubicControl ? { x: current.x * 2 - lastCubicControl.x, y: current.y * 2 - lastCubicControl.y } : current;
        const c2 = makePoint(readNumber(), readNumber(), current, relative);
        const p = makePoint(readNumber(), readNumber(), current, relative);
        flattenCubic(p0, c1, c2, p, tolerance, active, 0);
        current = p;
        lastCubicControl = c2;
        lastQuadraticControl = null;
      }
    }
    else if (upper === 'Q') {
      while (hasNumber()) {
        const p0 = current;
        const c = makePoint(readNumber(), readNumber(), current, relative);
        const p = makePoint(readNumber(), readNumber(), current, relative);
        flattenQuadratic(p0, c, p, tolerance, active, 0);
        current = p;
        lastQuadraticControl = c;
        lastCubicControl = null;
      }
    }
    else if (upper === 'T') {
      while (hasNumber()) {
        const p0 = current;
        const c = lastQuadraticControl ? { x: current.x * 2 - lastQuadraticControl.x, y: current.y * 2 - lastQuadraticControl.y } : current;
        const p = makePoint(readNumber(), readNumber(), current, relative);
        flattenQuadratic(p0, c, p, tolerance, active, 0);
        current = p;
        lastQuadraticControl = c;
        lastCubicControl = null;
      }
    }
    else if (upper === 'A') {
      while (hasNumber()) {
        const rx = readNumber();
        const ry = readNumber();
        const xAxisRotation = readNumber();
        const largeArcFlag = readNumber() ? 1 : 0;
        const sweepFlag = readNumber() ? 1 : 0;
        const p = makePoint(readNumber(), readNumber(), current, relative);
        flattenArc(current, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, p, tolerance, active);
        current = p;
        lastCubicControl = null;
        lastQuadraticControl = null;
      }
    }
    else if (upper === 'Z') {
      const closeTarget = start ? { x: start.x, y: start.y } : current;
      finishActive(true);
      current = closeTarget;
      lastCubicControl = null;
      lastQuadraticControl = null;
    }
    else {
      throw new Error('unsupported SVG path command: ' + command);
    }
  }

  finishActive(false);
  return subpaths.filter((polygon) => polygon.length >= 3 && Math.abs(signedArea(polygon)) > 1e-6);
}

function makePoint(x, y, current, relative) {
  return relative ? { x: current.x + x, y: current.y + y } : { x, y };
}

function samePoint(a, b, tolerance) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function dropDuplicateClose(points) {
  const copy = points.map((point) => ({ x: point.x, y: point.y }));
  while (copy.length > 1 && samePoint(copy[0], copy[copy.length - 1], 1e-9)) {
    copy.pop();
  }
  return copy;
}

function parsePoints(value) {
  const nums = String(value || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const polygon = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    polygon.push({ x: nums[i], y: nums[i + 1] });
  }
  return [dropDuplicateClose(polygon)].filter((poly) => poly.length >= 3);
}

function parseSvgFile(filePath, options) {
  const svgText = fs.readFileSync(filePath, 'utf8');
  const viewBox = parseViewBox(svgText);
  const parts = [];
  const tagRe = /<(path|polygon)\b[^>]*>/ig;
  let match;
  let index = 0;
  while ((match = tagRe.exec(svgText))) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[0]);
    let polygons = [];
    if (tag === 'path' && attrs.d) {
      polygons = parsePathData(attrs.d, options.curveTolerance);
    }
    else if (tag === 'polygon' && attrs.points) {
      polygons = parsePoints(attrs.points);
    }
    polygons = polygons.filter((polygon) => polygon.length >= 3 && Math.abs(signedArea(polygon)) > 1e-6);
    if (polygons.length > 0) {
      parts.push({
        id: 'part-' + index,
        sourceTag: tag,
        sourceIndex: index,
        paths: polygons
      });
      index++;
    }
  }
  if (parts.length === 0) {
    throw new Error('no polygonizable <path> or <polygon> parts found');
  }
  return { viewBox, parts };
}

function signedArea(polygon) {
  let area = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }
  return area * 0.5;
}

function absoluteArea(paths) {
  return paths.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon)), 0);
}

function boundsOfPaths(paths) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  paths.forEach((polygon) => {
    polygon.forEach((point) => {
      minx = Math.min(minx, point.x);
      miny = Math.min(miny, point.y);
      maxx = Math.max(maxx, point.x);
      maxy = Math.max(maxy, point.y);
    });
  });
  if (!Number.isFinite(minx)) {
    return { x: 0, y: 0, width: 0, height: 0, maxx: 0, maxy: 0 };
  }
  return { x: minx, y: miny, width: maxx - minx, height: maxy - miny, maxx, maxy };
}

function normalizePart(rawPart, scale) {
  const scaled = rawPart.paths.map((polygon) => polygon.map((point) => ({
    x: point.x * scale,
    y: point.y * scale
  })));
  const bounds = boundsOfPaths(scaled);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const localPaths = scaled.map((polygon) => polygon.map((point) => ({
    x: point.x - cx,
    y: point.y - cy
  })));
  const localBounds = boundsOfPaths(localPaths);
  return {
    id: rawPart.id,
    sourceTag: rawPart.sourceTag,
    sourceIndex: rawPart.sourceIndex,
    paths: localPaths,
    area: absoluteArea(localPaths),
    bounds: localBounds,
    width: localBounds.width,
    height: localBounds.height
  };
}

function transformPaths(part, pose) {
  const angle = (pose.rotation || 0) * Math.PI / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return part.paths.map((polygon) => polygon.map((point) => ({
    x: point.x * c - point.y * s + pose.x,
    y: point.x * s + point.y * c + pose.y
  })));
}

function toClipperPaths(paths, scale) {
  return paths.map((polygon) => polygon.map((point) => ({
    X: Math.round(point.x * scale),
    Y: Math.round(point.y * scale)
  })));
}

function fromClipperPaths(paths, scale) {
  return paths.map((polygon) => polygon.map((point) => ({
    x: point.X / scale,
    y: point.Y / scale
  })));
}

function clipperArea(paths, scale) {
  return fromClipperPaths(paths, scale).reduce((sum, polygon) => sum + Math.abs(signedArea(polygon)), 0);
}

function offsetPaths(paths, delta, options) {
  if (!delta || delta <= 0 || paths.length === 0) {
    return paths;
  }
  const offset = new ClipperLib.ClipperOffset(2, 0.25 * options.clipperScale);
  offset.AddPaths(
    toClipperPaths(paths, options.clipperScale),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon
  );
  const solution = new ClipperLib.Paths();
  offset.Execute(solution, delta * options.clipperScale);
  return fromClipperPaths(solution, options.clipperScale);
}

function intersectionArea(pathsA, pathsB, options) {
  const clipper = new ClipperLib.Clipper();
  const solution = new ClipperLib.Paths();
  clipper.AddPaths(toClipperPaths(pathsA, options.clipperScale), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(toClipperPaths(pathsB, options.clipperScale), ClipperLib.PolyType.ptClip, true);
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd
  );
  if (!ok || solution.length === 0) {
    return 0;
  }
  return clipperArea(solution, options.clipperScale);
}

function outsideArea(paths, sheet, options) {
  const clipper = new ClipperLib.Clipper();
  const solution = new ClipperLib.Paths();
  const sheetPath = [[
    { x: 0, y: 0 },
    { x: sheet.width, y: 0 },
    { x: sheet.width, y: sheet.height },
    { x: 0, y: sheet.height }
  ]];
  clipper.AddPaths(toClipperPaths(paths, options.clipperScale), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(toClipperPaths(sheetPath, options.clipperScale), ClipperLib.PolyType.ptClip, true);
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    solution,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd
  );
  if (!ok || solution.length === 0) {
    return 0;
  }
  return clipperArea(solution, options.clipperScale);
}

function makeLayout(parts, poses) {
  return parts.map((part, index) => ({
    part,
    pose: Object.assign({}, poses[index])
  }));
}

function validateLayout(layout, sheet, options) {
  const overlapPairs = [];
  const outsideParts = [];
  const transformed = layout.map((item) => transformPaths(item.part, item.pose));
  const spacing = Math.max(0, numberValue(options.spacing, 0));
  const outsidePaths = spacing > 0
    ? transformed.map((paths) => offsetPaths(paths, spacing, options))
    : transformed;
  const collisionPaths = spacing > 0
    ? transformed.map((paths) => offsetPaths(paths, spacing / 2, options))
    : transformed;
  for (let i = 0; i < layout.length; i++) {
    const out = outsideArea(outsidePaths[i], sheet, options);
    if (out > 0) {
      outsideParts.push({ index: i, partId: layout[i].part.id, area: out });
    }
  }
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const area = intersectionArea(collisionPaths[i], collisionPaths[j], options);
      if (area > 0) {
        overlapPairs.push({
          a: i,
          b: j,
          partA: layout[i].part.id,
          partB: layout[j].part.id,
          area
        });
      }
    }
  }
  return {
    valid: overlapPairs.length === 0 && outsideParts.length === 0,
    overlapPairs,
    outsideParts
  };
}

function layoutBounds(layout) {
  const all = [];
  layout.forEach((item) => {
    transformPaths(item.part, item.pose).forEach((polygon) => {
      polygon.forEach((point) => all.push(point));
    });
  });
  return boundsOfPaths([all]);
}

function serializeLayout(layout) {
  return layout.map((item, index) => ({
    id: item.part.id,
    index,
    sourceIndex: item.part.sourceIndex,
    pose: Object.assign({}, item.pose),
    paths: transformPaths(item.part, item.pose)
  }));
}

function objective(layout) {
  const bounds = layoutBounds(layout);
  let centerBias = 0;
  layout.forEach((item) => {
    centerBias += item.pose.x * 0.001 + item.pose.y * 0.001;
  });
  return bounds.width * 2 + bounds.height + centerBias;
}

function computeDefaultSheet(inputViewBox, partScale) {
  return {
    width: Math.max(1, inputViewBox.width * partScale * 1.05),
    height: Math.max(1, inputViewBox.height * partScale * 2.2)
  };
}

function initialGrid(parts, sheet, spacing) {
  const sorted = parts.map((part, index) => ({ part, index }))
    .sort((a, b) => b.part.height - a.part.height || b.part.width - a.part.width);
  const poses = new Array(parts.length);
  const gap = Math.max(0, spacing);
  let x = gap;
  let y = gap;
  let rowHeight = 0;

  sorted.forEach(({ part, index }) => {
    if (x + part.width + gap > sheet.width && x > gap) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    if (y + part.height + gap > sheet.height) {
      throw new Error('initial placement does not fit sheet; increase --sheet or reduce --part-scale');
    }
    poses[index] = {
      x: x + part.width / 2,
      y: y + part.height / 2,
      rotation: 0
    };
    x += part.width + gap;
    rowHeight = Math.max(rowHeight, part.height);
  });

  return makeLayout(parts, poses);
}

function cloneLayout(layout) {
  return layout.map((item) => ({
    part: item.part,
    pose: Object.assign({}, item.pose)
  }));
}

function candidateWith(layout, index, patch) {
  const candidate = cloneLayout(layout);
  candidate[index].pose = Object.assign({}, candidate[index].pose, patch);
  return candidate;
}

function moveIfLegalAndBetter(layout, sheet, options, index, patch, currentScore) {
  const candidate = candidateWith(layout, index, patch);
  const validation = validateLayout(candidate, sheet, options);
  if (!validation.valid) {
    return { layout, score: currentScore, accepted: false };
  }
  const score = objective(candidate);
  if (score <= currentScore + 1e-9) {
    return { layout: candidate, score, accepted: true };
  }
  return { layout, score: currentScore, accepted: false };
}

function jostle(layout, sheet, options) {
  let current = cloneLayout(layout);
  let score = objective(current);
  let acceptedMoves = 0;
  const rng = createRng(options.seed);
  let step = Math.max(1, Math.min(sheet.width, sheet.height) / 14);
  const minStep = Math.max(0.05, Math.min(sheet.width, sheet.height) / 1200);
  const iterations = Math.max(0, Math.floor(options.iterations));
  const traceEvery = Math.max(1, Math.floor(numberValue(options.traceEvery, 2)));

  for (let iter = 0; iter < iterations; iter++) {
    const progress = iter / Math.max(1, iterations - 1);
    const thermal = Math.max(minStep, step * (1 - progress));
    const order = shuffleIndexes(current.length, rng);
    for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
      const index = order[orderIndex];
      const pose = current[index].pose;
      const forceX = -options.gravity - options.shake * (rng() - 0.5);
      const forceY = -options.gravity - options.shake * (rng() - 0.5);
      const randomRotation = (rng() - 0.5) * options.rotationStep * 2;
      const moves = [
        { x: pose.x + Math.sign(forceX) * thermal, y: pose.y },
        { x: pose.x, y: pose.y + Math.sign(forceY) * thermal },
        { x: pose.x + Math.sign(forceX) * thermal * 0.5, y: pose.y + Math.sign(forceY) * thermal * 0.5 },
        { x: pose.x + (rng() - 0.5) * thermal, y: pose.y + (rng() - 0.5) * thermal },
        { x: pose.x + (rng() - 0.5) * thermal * 1.6, y: pose.y + (rng() - 0.5) * thermal * 1.6, rotation: pose.rotation + randomRotation },
        { x: pose.x, y: pose.y, rotation: pose.rotation + options.rotationStep },
        { x: pose.x, y: pose.y, rotation: pose.rotation - options.rotationStep }
      ];

      for (let m = 0; m < moves.length; m++) {
        const result = moveIfLegalAndBetter(current, sheet, options, index, moves[m], score);
        if (result.accepted) {
          current = result.layout;
          score = result.score;
          acceptedMoves++;
        }
      }
    }
    step = Math.max(minStep, step * 0.985);
    if (options.tracePath && (iter % traceEvery === 0 || iter === iterations - 1)) {
      writeTraceState(options.tracePath, {
        status: 'running',
        phase: 'jostle',
        attempt: options.currentAttempt || 0,
        attempts: options.restarts || 1,
        iteration: iter + 1,
        iterations,
        acceptedMoves,
        score,
        sheet,
        bounds: layoutBounds(current),
        layout: serializeLayout(current),
        updatedAt: new Date().toISOString()
      });
    }
  }

  return {
    layout: current,
    acceptedMoves,
    score
  };
}

function runSingleAttempt(parts, sheet, options, attemptIndex) {
  let layout = initialGrid(parts, sheet, options.spacing);
  const initialValidation = validateLayout(layout, sheet, options);
  if (!initialValidation.valid) {
    throw new Error('initial grid placement is invalid; this should not happen');
  }
  const beforeScore = objective(layout);
  const attemptOptions = Object.assign({}, options, {
    seed: options.seed + attemptIndex * 1009,
    currentAttempt: attemptIndex
  });
  if (options.tracePath) {
    writeTraceState(options.tracePath, {
      status: 'running',
      phase: 'start-attempt',
      attempt: attemptIndex,
      attempts: options.restarts || 1,
      iteration: 0,
      iterations: Math.max(0, Math.floor(options.iterations)),
      acceptedMoves: 0,
      score: beforeScore,
      sheet,
      bounds: layoutBounds(layout),
      layout: serializeLayout(layout),
      updatedAt: new Date().toISOString()
    });
  }
  const result = jostle(layout, sheet, attemptOptions);
  const validation = validateLayout(result.layout, sheet, options);
  if (!validation.valid) {
    throw new Error('internal error: jostle produced invalid layout');
  }
  return {
    attempt: attemptIndex,
    seed: attemptOptions.seed,
    layout: result.layout,
    validation,
    metrics: {
      valid: validation.valid,
      acceptedMoves: result.acceptedMoves,
      scoreBefore: beforeScore,
      scoreAfter: result.score,
      improvement: beforeScore - result.score,
      bounds: layoutBounds(result.layout),
      overlapPairs: validation.overlapPairs.length,
      outsideParts: validation.outsideParts.length
    }
  };
}

function writeTraceState(tracePath, state) {
  const absolute = path.resolve(String(tracePath));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const tmp = absolute + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, absolute);
}

function runNest(inputPath, cliOptions) {
  const options = Object.assign({}, DEFAULTS, cliOptions || {});
  options.curveTolerance = numberValue(options.curveTolerance, DEFAULTS.curveTolerance);
  options.clipperScale = numberValue(options.clipperScale, DEFAULTS.clipperScale);
  options.iterations = numberValue(options.iterations, DEFAULTS.iterations);
  options.gravity = numberValue(options.gravity, DEFAULTS.gravity);
  options.shake = numberValue(options.shake, DEFAULTS.shake);
  options.rotationStep = numberValue(options.rotationStep, DEFAULTS.rotationStep);
  options.spacing = numberValue(options.spacing, DEFAULTS.spacing);
  options.seed = numberValue(options.seed, DEFAULTS.seed);
  options.traceEvery = numberValue(options.traceEvery, 2);
  options.restarts = Math.max(1, Math.floor(numberValue(options.restarts, DEFAULTS.restarts)));

  const input = parseSvgFile(inputPath, options);
  const partScale = numberValue(options.partScale, 1);
  const parts = input.parts.map((part) => normalizePart(part, partScale));
  const sheet = options.sheet || computeDefaultSheet(input.viewBox, partScale);

  const attempts = [];
  let best = null;
  for (let attempt = 0; attempt < options.restarts; attempt++) {
    const result = runSingleAttempt(parts, sheet, options, attempt);
    attempts.push(result);
    if (!best || result.metrics.scoreAfter < best.metrics.scoreAfter) {
      best = result;
      if (options.tracePath) {
        writeTraceState(options.tracePath, {
          status: 'running',
          phase: 'best-so-far',
          attempt,
          attempts: options.restarts,
          bestAttempt: best.attempt,
          bestSeed: best.seed,
          score: best.metrics.scoreAfter,
          acceptedMoves: best.metrics.acceptedMoves,
          sheet,
          bounds: best.metrics.bounds,
          layout: serializeLayout(best.layout),
          metrics: best.metrics,
          updatedAt: new Date().toISOString()
        });
      }
    }
  }

  const finalResult = {
    inputPath,
    partCount: parts.length,
    sheet,
    layout: best.layout,
    attempts: attempts.map((attempt) => Object.assign({
      attempt: attempt.attempt,
      seed: attempt.seed
    }, attempt.metrics)),
    bestAttempt: best.attempt,
    bestSeed: best.seed,
    metrics: best.metrics
  };
  if (options.tracePath) {
    writeTraceState(options.tracePath, {
      status: 'complete',
      phase: 'complete',
      attempt: best.attempt,
      attempts: options.restarts,
      bestAttempt: best.attempt,
      bestSeed: best.seed,
      score: best.metrics.scoreAfter,
      acceptedMoves: best.metrics.acceptedMoves,
      sheet,
      bounds: best.metrics.bounds,
      layout: serializeLayout(best.layout),
      metrics: best.metrics,
      updatedAt: new Date().toISOString()
    });
  }
  return finalResult;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return Number(value.toFixed(4)).toString();
}

function pathDataForPolygon(polygon) {
  if (!polygon || polygon.length === 0) {
    return '';
  }
  const parts = ['M', formatNumber(polygon[0].x), formatNumber(polygon[0].y)];
  for (let i = 1; i < polygon.length; i++) {
    parts.push('L', formatNumber(polygon[i].x), formatNumber(polygon[i].y));
  }
  parts.push('Z');
  return parts.join(' ');
}

function writeSvg(outputPath, result) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + formatNumber(result.sheet.width) + '" height="' + formatNumber(result.sheet.height) + '" viewBox="0 0 ' + formatNumber(result.sheet.width) + ' ' + formatNumber(result.sheet.height) + '">',
    '  <rect x="0" y="0" width="' + formatNumber(result.sheet.width) + '" height="' + formatNumber(result.sheet.height) + '" fill="#f8fafc" stroke="#64748b" stroke-width="2"/>',
    '  <g fill="none" stroke="#111827" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">'
  ];
  result.layout.forEach((item, index) => {
    const transformed = transformPaths(item.part, item.pose);
    lines.push('    <g data-part-id="' + escapeXml(item.part.id) + '" data-index="' + index + '" data-x="' + formatNumber(item.pose.x) + '" data-y="' + formatNumber(item.pose.y) + '" data-rotation="' + formatNumber(item.pose.rotation) + '">');
    transformed.forEach((polygon) => {
      lines.push('      <path d="' + pathDataForPolygon(polygon) + '"/>');
    });
    lines.push('    </g>');
  });
  lines.push('  </g>');
  lines.push('</svg>');
  fs.writeFileSync(outputPath, lines.join('\n') + '\n');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function runCli(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    process.stdout.write(usage());
    return 0;
  }
  if (args.test) {
    const test = require('./physics-nest.test.js');
    test.runTests();
    return 0;
  }
  if (!args.input) {
    process.stderr.write(usage());
    return 2;
  }

  const inputPath = path.resolve(String(args.input));
  const outputPath = path.resolve(String(args.output || args.out || 'physics-nest-output.svg'));
  const sheet = parseSheet(args.sheet);
  const result = runNest(inputPath, {
    sheet,
    partScale: args['part-scale'],
    spacing: args.spacing,
    iterations: args.iterations,
    restarts: args['best-of'] || args.restarts,
    gravity: args.gravity,
    shake: args.shake,
    rotationStep: args['rotation-step'],
    curveTolerance: args['curve-tolerance'],
    clipperScale: args['clipper-scale'],
    tracePath: args.trace,
    traceEvery: args['trace-every'],
    seed: args.seed
  });
  writeSvg(outputPath, result);
  if (args.json) {
    fs.writeFileSync(path.resolve(String(args.json)), JSON.stringify({
      inputPath: result.inputPath,
      partCount: result.partCount,
      sheet: result.sheet,
      metrics: result.metrics,
      bestAttempt: result.bestAttempt,
      bestSeed: result.bestSeed,
      attempts: result.attempts,
      placements: result.layout.map((item) => ({
        id: item.part.id,
        sourceIndex: item.part.sourceIndex,
        x: item.pose.x,
        y: item.pose.y,
        rotation: item.pose.rotation
      }))
    }, null, 2));
  }
  process.stdout.write(JSON.stringify({
    output: outputPath,
    valid: result.metrics.valid,
    partCount: result.partCount,
    attempts: result.attempts.length,
    bestAttempt: result.bestAttempt,
    bestSeed: result.bestSeed,
    acceptedMoves: result.metrics.acceptedMoves,
    improvement: result.metrics.improvement,
    bounds: result.metrics.bounds
  }, null, 2) + '\n');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  }
  catch (err) {
    process.stderr.write((err && err.stack ? err.stack : String(err)) + '\n');
    process.exitCode = 1;
  }
}

module.exports = {
  parseSvgFile,
  parsePathData,
  normalizePart,
  transformPaths,
  validateLayout,
  runNest,
  writeSvg,
  signedArea,
  intersectionArea,
  outsideArea,
  offsetPaths,
  makeLayout,
  boundsOfPaths
};

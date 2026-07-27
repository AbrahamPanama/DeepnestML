'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ClipperLib = require('../../../main/util/clippernode.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEEPNEST_PATH = path.join(ROOT, 'main', 'deepnest.js');

function extractFunctionSource(source, name) {
	const needle = 'function ' + name;
	const start = source.indexOf(needle);
	assert(start >= 0, 'missing function: ' + name);
	const open = source.indexOf('{', start);
	let depth = 0;
	for (let index = open; index < source.length; index++) {
		if (source[index] === '{') {
			depth += 1;
		}
		else if (source[index] === '}') {
			depth -= 1;
			if (depth === 0) {
				return source.slice(start, index + 1);
			}
		}
	}
	throw new Error('unterminated function: ' + name);
}

function scaledPath(points, scale) {
	const path = points.map((point) => ({X: point.x, Y: point.y}));
	ClipperLib.JS.ScaleUpPath(path, scale);
	return path;
}

const source = fs.readFileSync(DEEPNEST_PATH, 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(
	extractFunctionSource(source, 'nestingPolygonCleanDistance'),
	context,
	{filename: 'deepnest.js'}
);

assert.strictEqual(
	context.nestingPolygonCleanDistance(),
	1.415,
	'import cleanup must stay at Clipper integer-grid precision'
);
assert(
	source.includes('Clipper.CleanPolygon(biggest, nestingPolygonCleanDistance())'),
	'active import cleanup must use the fidelity-preserving distance'
);

const scale = 10000000;
const shallowFeature = scaledPath([
	{x: 0, y: 0},
	{x: 10, y: 0},
	{x: 10, y: 10},
	{x: 5.02, y: 10},
	{x: 5.01, y: 10.0025},
	{x: 5, y: 10},
	{x: 0, y: 10}
], scale);
const cleaned = ClipperLib.Clipper.CleanPolygon(
	shallowFeature,
	context.nestingPolygonCleanDistance()
);
const oldCurveToleranceClean = ClipperLib.Clipper.CleanPolygon(
	shallowFeature,
	0.01 * 0.72 * scale
);

assert.strictEqual(
	cleaned.length,
	shallowFeature.length,
	'integer-grid cleanup must preserve a shallow exported feature'
);
assert.strictEqual(
	oldCurveToleranceClean.length,
	4,
	'the regression fixture must expose the former silhouette shrink'
);
assert(
	ClipperLib.Clipper.Area(cleaned) > ClipperLib.Clipper.Area(oldCurveToleranceClean),
	'preserved nesting geometry must include the exported feature area'
);

console.log('import polygon fidelity tests passed');

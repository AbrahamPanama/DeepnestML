'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BACKGROUND_PATH = path.join(ROOT, 'main', 'background.js');

function extractFunctionSource(source, name) {
	const needle = 'function ' + name;
	const start = source.indexOf(needle);
	if (start < 0) {
		throw new Error('missing function: ' + name);
	}
	const open = source.indexOf('{', start);
	if (open < 0) {
		throw new Error('missing function body: ' + name);
	}
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') {
			depth += 1;
		}
		else if (source[i] === '}') {
			depth -= 1;
			if (depth === 0) {
				return source.slice(start, i + 1);
			}
		}
	}
	throw new Error('unterminated function: ' + name);
}

function polygonArea(polygon) {
	let area = 0;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
	}
	return 0.5 * area;
}

function getPolygonBounds(polygon) {
	let minx = Infinity;
	let miny = Infinity;
	let maxx = -Infinity;
	let maxy = -Infinity;
	polygon.forEach((point) => {
		minx = Math.min(minx, point.x);
		miny = Math.min(miny, point.y);
		maxx = Math.max(maxx, point.x);
		maxy = Math.max(maxy, point.y);
	});
	return {
		x: minx,
		y: miny,
		width: maxx - minx,
		height: maxy - miny
	};
}

function rect(x, y, width, height) {
	return [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height }
	];
}

function loadBackgroundFunctions(names) {
	const source = fs.readFileSync(BACKGROUND_PATH, 'utf8');
	const context = {
		GeometryUtil: {
			polygonArea,
			getPolygonBounds
		},
		d3: {
			polygonHull: function (points) {
				return points;
			}
		}
	};
	vm.createContext(context);
	names.forEach((name) => {
		vm.runInContext(extractFunctionSource(source, name), context, { filename: 'background.js' });
	});
	return context;
}

function assertClose(actual, expected, tolerance, message) {
	assert.ok(Math.abs(actual - expected) <= tolerance, message + ' expected ' + expected + ' got ' + actual);
}

function testFitnessVersionCoercion() {
	const ctx = loadBackgroundFunctions(['getFitnessVersion']);
	assert.strictEqual(ctx.getFitnessVersion({ fitnessVersion: 2 }), 2);
	assert.strictEqual(ctx.getFitnessVersion({ fitnessVersion: '2' }), 2);
	assert.strictEqual(ctx.getFitnessVersion({ fitnessVersion: 1 }), 1);
	assert.strictEqual(ctx.getFitnessVersion({ fitnessVersion: 3 }), 1);
	assert.strictEqual(ctx.getFitnessVersion({}), 1);
}

function testSheetMetrics() {
	const ctx = loadBackgroundFunctions([
		'getHull',
		'collectWorldPoints',
		'calculateFitnessV2SheetMetric'
	]);
	const sheet = rect(0, 0, 10, 10);
	const placed = [rect(0, 0, 4, 3)];
	const placements = [{ x: 2, y: 1 }];

	const gravity = ctx.calculateFitnessV2SheetMetric(sheet, placed, placements, 'gravity');
	assert.strictEqual(gravity.type, 'gravity');
	assert.strictEqual(gravity.placementCount, 1);
	assertClose(gravity.metric, 11 / 30, 1e-12, 'gravity metric');

	const box = ctx.calculateFitnessV2SheetMetric(sheet, placed, placements, 'box');
	assert.strictEqual(box.type, 'box');
	assertClose(box.metric, 12 / 100, 1e-12, 'box metric');

	const hull = ctx.calculateFitnessV2SheetMetric(sheet, placed, placements, 'convexhull');
	assert.strictEqual(hull.type, 'convexhull');
	assertClose(hull.metric, 12 / 100, 1e-12, 'convex hull metric');
}

function run() {
	testFitnessVersionCoercion();
	testSheetMetrics();
	console.log('fitness v2 tests passed');
}

run();

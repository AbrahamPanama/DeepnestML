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

function pointInRing(point, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i].x;
		const yi = ring[i].y;
		const xj = ring[j].x;
		const yj = ring[j].y;
		const intersect = ((yi > point.y) !== (yj > point.y)) &&
			(point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-12) + xi);
		if (intersect) {
			inside = !inside;
		}
	}
	return inside;
}

function rect(x, y, width, height) {
	return [
		{ x, y, exact: true },
		{ x: x + width, y, exact: true },
		{ x: x + width, y: y + height, exact: true },
		{ x, y: y + height, exact: true }
	];
}

function loadBackgroundFunctions(names, geometryOverrides, runtimeOverrides) {
	const source = fs.readFileSync(BACKGROUND_PATH, 'utf8');
	const context = {
		console,
		GeometryUtil: Object.assign({
			almostEqual: function (a, b, tolerance) {
				return Math.abs(a - b) <= (typeof tolerance === 'number' ? tolerance : 1e-9);
			},
			polygonArea,
			pointInPolygon: pointInRing,
			noFitPolygon: function () {
				return null;
			}
		}, geometryOverrides || {})
	};
	Object.assign(context, runtimeOverrides || {});
	vm.createContext(context);
	names.forEach((name) => {
		vm.runInContext(extractFunctionSource(source, name), context, { filename: 'background.js' });
	});
	return context;
}

function assertClose(actual, expected, tolerance, message) {
	assert.ok(Math.abs(actual - expected) <= tolerance, message + ' expected ' + expected + ' got ' + actual);
}

function testMergedLengthThreshold() {
	const ctx = loadBackgroundFunctions(['mergedLength']);
	const candidate = rect(0, 0, 2, 1);
	const placed = rect(0, -1, 2, 1);
	const result = ctx.mergedLength([placed], candidate, 3, 1e-9);
	assert.strictEqual(result.totalLength, 0, 'short shared edge below threshold must not merge');
	assert.strictEqual(result.segments.length, 0, 'short shared edge must not export a segment');
}

function testMergedLengthAfterFarCollinearEdge() {
	const ctx = loadBackgroundFunctions(['mergedLength']);
	const candidate = rect(0, 0, 5, 1);
	const far = rect(100, -1, 10, 1);
	const placed = rect(0, -1, 5, 1);
	const result = ctx.mergedLength([far, placed], candidate, 3, 1e-9);
	assertClose(result.totalLength, 5, 1e-9, 'valid shared edge must survive unrelated far collinear edge');
	assert.strictEqual(result.segments.length, 1, 'valid shared edge should export one segment');
}

function testMergedLengthChildrenCountOnce() {
	const ctx = loadBackgroundFunctions(['mergedLength']);
	const candidate = rect(0, 0, 2, 1);
	const placed = rect(50, 50, 2, 1);
	placed.children = [rect(0, -1, 2, 1)];
	const result = ctx.mergedLength([placed], candidate, 1.5, 1e-9);
	assertClose(result.totalLength, 2, 1e-9, 'hole child shared edge should be counted once');
	assert.strictEqual(result.segments.length, 1, 'hole child shared edge should export one segment');
}

function testEmptyClipperFallback() {
	const ctx = loadBackgroundFunctions(['buildClipperNfpFromMinkowskiSolution']);
	const result = ctx.buildClipperNfpFromMinkowskiSolution([], rect(0, 0, 1, 1), 1000);
	assert.strictEqual(result, null, 'empty Minkowski solution should return null');
}

function testRotationRetries() {
	const ctx = loadBackgroundFunctions([
		'normalizedRotation',
		'rotationRetryCount',
		'rotationRetryStep',
		'rotationRetryAngle'
	]);
	[1, 4, 32].forEach((rotations) => {
		const angles = [];
		for (let i = 0; i < ctx.rotationRetryCount({ rotations }); i++) {
			angles.push(ctx.rotationRetryAngle(0, { rotations }, i));
		}
		assert.strictEqual(angles.length, rotations, 'retry count should equal configured rotations');
		assert.strictEqual(new Set(angles.map((angle) => angle.toFixed(8))).size, rotations, 'retry angles should be unique');
		assertClose(angles[1] || 0, rotations === 1 ? 0 : 360 / rotations, 1e-9, 'retry step should match configured rotation step');
	});
}

function testSheetHoleForbiddenNfp() {
	const calls = [];
	const forbiddenRing = rect(0, 0, 10, 10);
	const ctx = loadBackgroundFunctions(['buildTreeFromOuterNfpList', 'getSheetHoleForbiddenNfps'], {
		noFitPolygon: function (hole, part, inside) {
			calls.push({ hole, part, inside });
			return [forbiddenRing.slice()];
		}
	});
	const sheet = rect(0, 0, 20, 20);
	sheet.children = [rect(4, 4, 2, 2)];
	const largePart = rect(0, 0, 8, 8);
	const forbidden = ctx.getSheetHoleForbiddenNfps(sheet, largePart);
	assert.strictEqual(calls.length, 1, 'sheet hole should be evaluated');
	assert.strictEqual(calls[0].inside, false, 'sheet hole exclusion must use outer forbidden NFP');
	assert.strictEqual(forbidden.length, 1, 'forbidden NFP should be returned even when part is larger than the hole');
	assert.strictEqual(pointInRing({ x: 5, y: 5 }, forbidden[0]), true, 'straddling/overlap point should be inside forbidden region');
}

function testSheetHoleFailsClosed() {
	const ctx = loadBackgroundFunctions(['buildTreeFromOuterNfpList', 'getSheetHoleForbiddenNfps'], {
		noFitPolygon: function () {
			return null;
		}
	});
	const sheet = rect(0, 0, 20, 20);
	sheet.children = [rect(4, 4, 2, 2)];
	assert.strictEqual(ctx.getSheetHoleForbiddenNfps(sheet, rect(0, 0, 8, 8)), null, 'missing hole NFP should fail closed');
}

function testSheetHoleDifferenceFailureFailsClosed() {
	const ctx = loadBackgroundFunctions([
		'toClipperCoordinates',
		'nfpToClipperCoordinates',
		'innerNfpToClipperCoordinates',
		'buildTreeFromOuterNfpList',
		'getSheetHoleForbiddenNfps',
		'getInnerNfpWithGeometryUtil'
	], {
		isRectangle: function () {
			return false;
		},
		noFitPolygon: function (a, b, inside) {
			return inside ? [rect(0, 0, 20, 20)] : [rect(0, 0, 10, 10)];
		}
	}, {
		ClipperLib: {
			Clipper: function () {
				this.AddPaths = function () {};
				this.Execute = function () {
					return false;
				};
			},
			Paths: function () {
				return [];
			},
			PolyType: { ptClip: 0, ptSubject: 1 },
			ClipType: { ctDifference: 0 },
			PolyFillType: { pftNonZero: 0 },
			JS: {
				ScaleUpPath: function () {}
			}
		}
	});
	const sheet = rect(0, 0, 20, 20);
	sheet.children = [rect(4, 4, 2, 2)];
	assert.strictEqual(ctx.getInnerNfpWithGeometryUtil(sheet, rect(0, 0, 8, 8), { clipperScale: 1000 }), null, 'hole subtraction failure should fail closed');
}

function testCandidateTieBreakUsesCurrentBest() {
	const ctx = loadBackgroundFunctions(['candidatePlacementIsBetter']);
	assert.strictEqual(ctx.candidatePlacementIsBetter(10, 5, 0, 9, 8, 0), true, 'strictly better score should win');
	assert.strictEqual(ctx.candidatePlacementIsBetter(9, 8, 0, 9, 6, 0), true, 'equal score should compare against current best x');
	assert.strictEqual(ctx.candidatePlacementIsBetter(9, 6, 4, 9, 6, 3), true, 'equal score/x should compare y');
	assert.strictEqual(ctx.candidatePlacementIsBetter(9, 6, 3, 9, 8, 0), false, 'worse x should not beat current best');
}

function testPolygonFingerprintMemoization() {
	const names = ['hashString', 'roundedCoordinate', 'polygonSignatureText', 'polygonFingerprint'];
	const ctx = loadBackgroundFunctions(names);
	const polygon = rect(0, 0, 4, 2);
	polygon.children = [rect(1, 0.5, 1, 1)];
	const first = ctx.polygonFingerprint(polygon);
	const descriptor = Object.getOwnPropertyDescriptor(polygon, '__dnFingerprint');
	assert.ok(descriptor, 'fingerprint should be memoized on polygon');
	assert.strictEqual(descriptor.value, first, 'memoized fingerprint should match return value');
	assert.strictEqual(descriptor.enumerable, false, 'memoized fingerprint must be non-enumerable');
	assert.strictEqual(descriptor.configurable, true, 'memoized fingerprint should be configurable');

	ctx.hashString = function () {
		throw new Error('second fingerprint should use memo');
	};
	assert.strictEqual(ctx.polygonFingerprint(polygon), first, 'same polygon should return memoized fingerprint');

	const ctx2 = loadBackgroundFunctions(names);
	const distinctA = rect(0, 0, 4, 2);
	const distinctB = rect(0, 0, 4, 2);
	assert.notStrictEqual(distinctA, distinctB, 'test setup should use distinct polygon objects');
	assert.strictEqual(ctx2.polygonFingerprint(distinctA), ctx2.polygonFingerprint(distinctB), 'structurally equal polygons should fingerprint equally');

	const serialized = JSON.stringify(distinctA);
	assert.strictEqual(serialized.indexOf('__dnFingerprint'), -1, 'JSON serialization should not include fingerprint memo');
	const copy = JSON.parse(serialized);
	assert.strictEqual(Object.prototype.hasOwnProperty.call(copy, '__dnFingerprint'), false, 'structured-clone-like copy should not carry memo');
	assert.strictEqual(ctx2.polygonFingerprint(copy), ctx2.polygonFingerprint(distinctA), 'structured-clone-like copy should recompute matching fingerprint');

	const frozen = rect(0, 0, 2, 2);
	Object.freeze(frozen);
	assert.strictEqual(typeof ctx2.polygonFingerprint(frozen), 'string', 'frozen polygon should still fingerprint');
	assert.strictEqual(Object.prototype.hasOwnProperty.call(frozen, '__dnFingerprint'), false, 'frozen polygon should skip memoization');
}

function run() {
	testMergedLengthThreshold();
	testMergedLengthAfterFarCollinearEdge();
	testMergedLengthChildrenCountOnce();
	testEmptyClipperFallback();
	testRotationRetries();
	testSheetHoleForbiddenNfp();
	testSheetHoleFailsClosed();
	testSheetHoleDifferenceFailureFailsClosed();
	testCandidateTieBreakUsesCurrentBest();
	testPolygonFingerprintMemoization();
	console.log('engine bugfix tests passed');
}

run();

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

function testNfpBatchPrefetchKeyParity() {
	const names = [
		'rotatePolygon',
		'hashString',
		'roundedCoordinate',
		'polygonSignatureText',
		'polygonFingerprint',
		'nfpCacheKey',
		'buildOuterNfpCacheDoc',
		'buildInnerNfpCacheDoc',
		'addNfpPrefetchEntry',
		'buildNfpPrefetchEntries'
	];
	const ctx = loadBackgroundFunctions(names, {}, {
		NFP_CACHE_VERSION: 3,
		window: { nfpcache: {} }
	});
	const sheet = rect(0, 0, 20, 20);
	sheet.source = 'sheet';
	const partA = rect(0, 0, 3, 2);
	partA.source = 'a';
	partA.id = 'a-1';
	partA.rotation = 90;
	partA.children = [rect(0.5, 0.5, 1, 1)];
	const partB = rect(0, 0, 4, 1);
	partB.source = 'b';
	partB.id = 'b-1';
	partB.rotation = 180;

	const entries = ctx.buildNfpPrefetchEntries([sheet], [partA, partB], {}, false);
	const keys = entries.map((entry) => entry.key);
	const rotatedA = ctx.rotatePolygon(partA, partA.rotation);
	rotatedA.source = partA.source;
	rotatedA.id = partA.id;
	rotatedA.rotation = partA.rotation;
	const rotatedB = ctx.rotatePolygon(partB, partB.rotation);
	rotatedB.source = partB.source;
	rotatedB.id = partB.id;
	rotatedB.rotation = partB.rotation;

	const prepassOuterKey = ctx.nfpCacheKey(ctx.buildOuterNfpCacheDoc(rotatedA, rotatedB, false), false);
	const reverseOuterKey = ctx.nfpCacheKey(ctx.buildOuterNfpCacheDoc(rotatedB, rotatedA, false), false);
	const innerKey = ctx.nfpCacheKey(ctx.buildInnerNfpCacheDoc(sheet, rotatedA), true);
	assert.ok(keys.indexOf(prepassOuterKey) >= 0, 'prefetch should include P0 pre-pass outer key');
	assert.ok(keys.indexOf(reverseOuterKey) >= 0, 'prefetch should include ordered reverse outer key for placeParts');
	assert.ok(keys.indexOf(innerKey) >= 0, 'prefetch should include sheet/part inner key');
	assert.ok(prepassOuterKey.indexOf('-nh-') >= 0, 'processHoles:false key should include no-holes marker');
	assert.strictEqual(new Set(keys).size, keys.length, 'prefetch keys should be deduped');

	ctx.window.nfpcache[prepassOuterKey] = rect(0, 0, 1, 1);
	const entriesAfterLocalHit = ctx.buildNfpPrefetchEntries([sheet], [partA, partB], {}, false);
	assert.strictEqual(entriesAfterLocalHit.some((entry) => entry.key === prepassOuterKey), false, 'prefetch should skip keys already in local mirror');
}

function testNfpBatchWarmStatsAndLocalMirror() {
	const names = [
		'clone',
		'cloneNfp',
		'warmLocalNfpCache',
		'nfpBatchResponseValues',
		'estimateNfpPayloadBytes',
		'warmNfpCacheBatch',
		'nfpBatchTiming'
	];
	const ctx = loadBackgroundFunctions(names, {}, {
		window: { nfpcache: {}, performance: {} }
	});
	const outerNfp = rect(0, 0, 1, 1);
	const innerNfp = [rect(0, 0, 2, 2)];
	ctx.ipcRendererSafeSendSync = function (channel, keys) {
		assert.strictEqual(channel, 'nfp-cache-find-batch-sync', 'batch warm should use batch IPC channel');
		assert.deepStrictEqual(Array.from(keys), ['outer-key', 'inner-key', 'missing-key']);
		return {
			values: [outerNfp, innerNfp, null],
			bytes: 123,
			elapsedMs: 2
		};
	};
	const stats = ctx.warmNfpCacheBatch([
		{ key: 'outer-key', inner: false },
		{ key: 'inner-key', inner: true },
		{ key: 'missing-key', inner: false }
	]);
	assert.strictEqual(stats.eligible, 3, 'batch stats should record eligible keys');
	assert.strictEqual(stats.requested, 3, 'batch stats should record requested keys');
	assert.strictEqual(stats.hits, 2, 'batch stats should count hits');
	assert.strictEqual(stats.misses, 1, 'batch stats should count misses');
	assert.strictEqual(stats.bytes, 123, 'batch stats should use response byte count');
	assert.strictEqual(stats.checked['missing-key'], true, 'batch stats should mark checked misses');
	assert.ok(ctx.window.nfpcache['outer-key'], 'outer hit should warm local mirror');
	assert.ok(ctx.window.nfpcache['inner-key'], 'inner hit should warm local mirror');
	assert.strictEqual(ctx.window.nfpcache['missing-key'], undefined, 'miss should not warm local mirror');
	assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.nfpBatchTiming(stats))), {
		eligible: 3,
		requested: 3,
		chunks: 1,
		hits: 2,
		misses: 1,
		bytes: 123,
		elapsedMs: stats.elapsedMs,
		capped: false
	}, 'timing projection should omit checked map');
}

function testBackgroundStartLegacyHydration() {
	const names = [
		'cloneGeometryTree',
		'cloneGeometryChildren',
		'geometryChildrenForSource',
		'hydrateLegacyBackgroundStartData',
		'resolveBackgroundStartGeometry'
	];
	const ctx = loadBackgroundFunctions(names);
	const part = rect(0, 0, 3, 2);
	const child = rect(0.5, 0.5, 1, 1);
	const sheet = rect(0, 0, 20, 20);
	const sheetChild = rect(4, 4, 2, 2);
	const data = {
		individual: {
			placement: [part],
			rotation: [90]
		},
		ids: ['part-id'],
		sources: ['source-a'],
		children: [[child]],
		sheets: [sheet],
		sheetids: ['sheet-id'],
		sheetsources: ['sheet-source'],
		sheetchildren: [[sheetChild]],
		config: { simplify: false }
	};
	const result = ctx.resolveBackgroundStartGeometry(data);
	assert.strictEqual(result.geometryPath, 'legacy', 'legacy payload should stay on legacy path');
	assert.strictEqual(result.parts[0], part, 'legacy path should use the original placement array');
	assert.strictEqual(part.rotation, 90, 'legacy path should restore rotation');
	assert.strictEqual(part.id, 'part-id', 'legacy path should restore id');
	assert.strictEqual(part.source, 'source-a', 'legacy path should restore source');
	assert.strictEqual(part.children[0], child, 'legacy path should restore child sidecar');
	assert.strictEqual(sheet.children[0], sheetChild, 'legacy path should restore sheet child sidecar');
}

function testBackgroundStartTokenHydration() {
	const names = [
		'ipcRendererSafeSendSync',
		'cacheBackgroundNestGeometry',
		'getBackgroundNestGeometry',
		'cloneGeometryTree',
		'cloneGeometryChildren',
		'geometryChildrenForSource',
		'hydrateTokenBackgroundStartData',
		'resolveBackgroundStartGeometry'
	];
	const sourcePart = rect(0, 0, 3, 2);
	const partChild = rect(0.5, 0.5, 1, 1);
	const sheet = rect(0, 0, 20, 20);
	const sheetChild = rect(4, 4, 2, 2);
	const geometry = {
		token: 'nest-a',
		partsBySource: {
			7: sourcePart
		},
		partsChildrenBySource: {
			7: [partChild]
		},
		sheets: [sheet],
		sheetids: ['sheet-id'],
		sheetsources: ['sheet-source'],
		sheetchildren: [[sheetChild]]
	};
	let pulls = 0;
	const ctx = loadBackgroundFunctions(names, {}, {
		backgroundGeometryCache: {},
		backgroundGeometryCacheOrder: [],
		window: {
			ipcRenderer: {
				sendSync: function (channel, token) {
					pulls += 1;
					assert.strictEqual(channel, 'nest-geometry-get-sync', 'token path should pull from geometry broker');
					assert.strictEqual(token, 'nest-a', 'token path should request the nest token');
					return geometry;
				}
			}
		}
	});
	const data = {
		nestToken: 'nest-a',
		ids: ['part-1', 'part-2'],
		sources: [7, 7],
		rotations: [90, 180],
		config: { simplify: false }
	};
	const result = ctx.resolveBackgroundStartGeometry(data);
	assert.strictEqual(result.geometryPath, 'token', 'token payload should use token path');
	assert.strictEqual(pulls, 1, 'first token use should pull geometry once');
	assert.strictEqual(result.parts.length, 2, 'token path should rebuild one part per source entry');
	assert.notStrictEqual(result.parts[0], sourcePart, 'rebuilt part should be cloned');
	assert.notStrictEqual(result.parts[0], result.parts[1], 'each rebuilt part should be a distinct clone');
	assert.strictEqual(result.parts[0][0].exact, true, 'clone should preserve exact point flags');
	assert.strictEqual(result.parts[0].rotation, 90, 'token path should restore rotation');
	assert.strictEqual(result.parts[1].rotation, 180, 'token path should restore second rotation');
	assert.strictEqual(result.parts[0].id, 'part-1', 'token path should restore id');
	assert.strictEqual(result.parts[0].source, 7, 'token path should restore source');
	assert.strictEqual(result.parts[0].children[0][0].exact, true, 'token path should preserve child exact flags');
	assert.notStrictEqual(result.parts[0].children[0], partChild, 'part child sidecar should be cloned');
	assert.strictEqual(result.sheets[0].id, 'sheet-id', 'token path should restore sheet id');
	assert.strictEqual(result.sheets[0].source, 'sheet-source', 'token path should restore sheet source');
	assert.strictEqual(result.sheets[0].children[0][0].exact, true, 'token path should preserve sheet child exact flags');
	assert.notStrictEqual(result.sheets[0], sheet, 'rebuilt sheet should be cloned per dispatch');

	const second = ctx.resolveBackgroundStartGeometry(data);
	assert.strictEqual(second.geometryPath, 'token', 'cached token should still hydrate');
	assert.strictEqual(pulls, 1, 'cached token should not pull geometry again');

	const simplified = ctx.resolveBackgroundStartGeometry(Object.assign({}, data, {
		config: { simplify: true }
	}));
	assert.strictEqual(simplified.parts[0].children, undefined, 'simplify mode should mirror legacy child suppression');
}

function testBackgroundStartMissingTokenFailsClosed() {
	const names = [
		'ipcRendererSafeSendSync',
		'cacheBackgroundNestGeometry',
		'getBackgroundNestGeometry',
		'cloneGeometryTree',
		'cloneGeometryChildren',
		'geometryChildrenForSource',
		'hydrateTokenBackgroundStartData',
		'resolveBackgroundStartGeometry'
	];
	const ctx = loadBackgroundFunctions(names, {}, {
		backgroundGeometryCache: {},
		backgroundGeometryCacheOrder: [],
		window: {
			ipcRenderer: {
				sendSync: function () {
					return null;
				}
			}
		}
	});
	const result = ctx.resolveBackgroundStartGeometry({
		nestToken: 'missing',
		ids: ['part-1'],
		sources: ['a'],
		rotations: [0],
		config: {}
	});
	assert.ok(result.error, 'missing token geometry should fail closed instead of throwing');
}

function testBackgroundDispatchTiming() {
	const ctx = loadBackgroundFunctions(['backgroundDispatchMs']);
	assert.strictEqual(ctx.backgroundDispatchMs({}), null, 'missing dispatch timestamp should omit timing');
	assert.strictEqual(ctx.backgroundDispatchMs({ dispatchStartedAt: Date.now() + 1000 }), 0, 'future timestamp should clamp at zero');
	assert.ok(ctx.backgroundDispatchMs({ dispatchStartedAt: Date.now() - 5 }) >= 0, 'dispatch timing should be non-negative');
}

function testMergeCandidateCapHelpers() {
	const ctx = loadBackgroundFunctions([
		'normalizeMergeCandidateCap',
		'mergeCandidateCompare',
		'recordMergeCandidate'
	]);
	assert.strictEqual(ctx.normalizeMergeCandidateCap({}), 0, 'missing cap should default off');
	assert.strictEqual(ctx.normalizeMergeCandidateCap({ mergeCandidateCap: 0 }), 0, 'zero cap should be off');
	assert.strictEqual(ctx.normalizeMergeCandidateCap({ mergeCandidateCap: '64' }), 64, 'positive cap should parse');
	assert.strictEqual(ctx.normalizeMergeCandidateCap({ mergeCandidateCap: -5 }), 0, 'negative cap should be off');

	function candidate(name, score, x, y, ordinal) {
		return { name, baseScore: score, x, y, ordinal };
	}
	const candidates = [];
	ctx.recordMergeCandidate(candidates, 2, candidate('worse-score', 10, 0, 0, 0));
	ctx.recordMergeCandidate(candidates, 2, candidate('best-score-right', 9, 8, 0, 1));
	ctx.recordMergeCandidate(candidates, 2, candidate('best-score-left', 9, 6, 0, 2));
	ctx.recordMergeCandidate(candidates, 2, candidate('too-far-right', 9, 9, 0, 3));
	assert.deepStrictEqual(
		candidates.map((entry) => entry.name).sort(),
		['best-score-left', 'best-score-right'],
		'top-k should keep best base scores and lower-x ties'
	);
	assert.ok(
		ctx.mergeCandidateCompare(candidate('a', 9, 6, 0, 1), candidate('b', 9, 6, 0, 2)) < 0,
		'ordinal should make otherwise identical candidates deterministic'
	);
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
	testNfpBatchPrefetchKeyParity();
	testNfpBatchWarmStatsAndLocalMirror();
	testBackgroundStartLegacyHydration();
	testBackgroundStartTokenHydration();
	testBackgroundStartMissingTokenFailsClosed();
	testBackgroundDispatchTiming();
	testMergeCandidateCapHelpers();
	console.log('engine bugfix tests passed');
}

run();

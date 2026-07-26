'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ClipperLib = require('../../../main/util/clippernode.js');
const GeometryUtil = require('../../../main/util/geometryutil.js').GeometryUtil;
const RasterCollision = require('../../../main/util/raster-collision.js');
const esicup = require('../../lib/esicup-convert.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const clipperScale = 1000000;

function mulberry32(seed) {
	return function () {
		let t = seed += 0x6D2B79F5;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function rect(x, y, width, height) {
	return [
		{x: x, y: y},
		{x: x + width, y: y},
		{x: x + width, y: y + height},
		{x: x, y: y + height}
	];
}

function withHoles(outer, holes) {
	outer.children = holes || [];
	return outer;
}

function cloneRing(ring) {
	const result = ring.map((point) => ({x: point.x, y: point.y}));
	if (ring.children) {
		result.children = ring.children.map(cloneRing);
	}
	return result;
}

function ringsForPolygon(polygon, result) {
	result = result || [];
	result.push(polygon);
	if (polygon.children) {
		for (const child of polygon.children) {
			ringsForPolygon(child, result);
		}
	}
	return result;
}

function clipperPaths(polygon, offset) {
	offset = offset || {x: 0, y: 0};
	return ringsForPolygon(polygon).map((ring) => {
		const result = ring.map((point) => ({
			X: point.x + offset.x,
			Y: point.y + offset.y
		}));
		ClipperLib.JS.ScaleUpPath(result, clipperScale);
		return result;
	});
}

function exactIntersectionArea(polygonA, offsetA, polygonB, offsetB) {
	const clipper = new ClipperLib.Clipper();
	const solution = new ClipperLib.Paths();
	clipper.AddPaths(
		clipperPaths(polygonA, offsetA),
		ClipperLib.PolyType.ptSubject,
		true
	);
	clipper.AddPaths(
		clipperPaths(polygonB, offsetB),
		ClipperLib.PolyType.ptClip,
		true
	);
	const executed = clipper.Execute(
		ClipperLib.ClipType.ctIntersection,
		solution,
		ClipperLib.PolyFillType.pftEvenOdd,
		ClipperLib.PolyFillType.pftEvenOdd
	);
	assert.strictEqual(executed, true, 'Clipper intersection oracle must execute');
	let signedArea = 0;
	for (const ring of solution) {
		signedArea += ClipperLib.Clipper.Area(ring);
	}
	return Math.abs(signedArea) / (clipperScale * clipperScale);
}

function exactOutsideArea(polygon, offset, container) {
	const clipper = new ClipperLib.Clipper();
	const solution = new ClipperLib.Paths();
	clipper.AddPaths(
		clipperPaths(polygon, offset),
		ClipperLib.PolyType.ptSubject,
		true
	);
	clipper.AddPaths(
		clipperPaths(container, {x: 0, y: 0}),
		ClipperLib.PolyType.ptClip,
		true
	);
	const executed = clipper.Execute(
		ClipperLib.ClipType.ctDifference,
		solution,
		ClipperLib.PolyFillType.pftEvenOdd,
		ClipperLib.PolyFillType.pftEvenOdd
	);
	assert.strictEqual(executed, true, 'Clipper containment oracle must execute');
	let signedArea = 0;
	for (const ring of solution) {
		signedArea += ClipperLib.Clipper.Area(ring);
	}
	return Math.abs(signedArea) / (clipperScale * clipperScale);
}

function convexHull(points) {
	const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
	function cross(origin, a, b) {
		return (a.x - origin.x) * (b.y - origin.y) -
			(a.y - origin.y) * (b.x - origin.x);
	}
	const lower = [];
	for (const point of sorted) {
		while (lower.length >= 2 &&
			cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
			lower.pop();
		}
		lower.push(point);
	}
	const upper = [];
	for (let i = sorted.length - 1; i >= 0; i--) {
		const point = sorted[i];
		while (upper.length >= 2 &&
			cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
			upper.pop();
		}
		upper.push(point);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

function randomConvex(rng) {
	for (;;) {
		const points = [];
		const count = 8 + Math.floor(rng() * 8);
		for (let i = 0; i < count; i++) {
			points.push({
				x: -8 + 16 * rng(),
				y: -8 + 16 * rng()
			});
		}
		const hull = convexHull(points);
		if (hull.length >= 4) {
			return hull;
		}
	}
}

function randomConcave(rng) {
	const count = 8 + 2 * Math.floor(rng() * 4);
	const phase = rng() * Math.PI * 2;
	const result = [];
	for (let i = 0; i < count; i++) {
		const angle = phase + i * Math.PI * 2 / count;
		const radius = i % 2 === 0 ? 7 + 2 * rng() : 2.5 + 2 * rng();
		result.push({
			x: radius * Math.cos(angle),
			y: radius * Math.sin(angle)
		});
	}
	return result;
}

function randomHolePolygon(rng) {
	const outer = randomConvex(rng).map((point) => ({
		x: point.x * 1.4,
		y: point.y * 1.4
	}));
	const holeCount = rng() < 0.25 ? 2 : 1;
	const holes = [];
	for (let h = 0; h < holeCount; h++) {
		const cx = holeCount === 1 ? 0 : (h === 0 ? -2.5 : 2.5);
		const cy = (rng() - 0.5) * 1.5;
		const radius = holeCount === 1 ? 2.2 : 1.3;
		const hole = [];
		for (let i = 0; i < 8; i++) {
			const angle = i * Math.PI / 4;
			hole.push({
				x: cx + radius * Math.cos(angle),
				y: cy + radius * Math.sin(angle)
			});
		}
		holes.push(hole);
	}
	return withHoles(outer, holes);
}

function randomPolygon(rng, kind) {
	if (kind === 0) {
		return randomConvex(rng);
	}
	if (kind === 1) {
		return randomConcave(rng);
	}
	return randomHolePolygon(rng);
}

function bounds(polygon) {
	return RasterCollision.polygonBounds(polygon);
}

function randomOffsets(polygonA, polygonB, pixelSize, sample, rng) {
	const a = bounds(polygonA);
	const b = bounds(polygonB);
	const offsetA = {
		x: (rng() - 0.5) * pixelSize,
		y: (rng() - 0.5) * pixelSize
	};
	const offsetB = {
		x: offsetA.x,
		y: offsetA.y
	};
	switch (sample % 4) {
		case 0:
			offsetB.x += (rng() - 0.5) * Math.min(a.width, b.width);
			offsetB.y += (rng() - 0.5) * Math.min(a.height, b.height);
			break;
		case 1:
			offsetB.x += a.x + a.width - b.x + pixelSize * (2 + 3 * rng());
			offsetB.y += (rng() - 0.5) * Math.min(a.height, b.height);
			break;
		case 2:
			offsetB.x += a.x + a.width - b.x + pixelSize * (-2 + 4 * rng());
			offsetB.y += (rng() - 0.5) * Math.min(a.height, b.height);
			break;
		default:
			offsetB.x += -12 + 24 * rng();
			offsetB.y += -12 + 24 * rng();
			break;
	}
	offsetB.x += (rng() - 0.5) * pixelSize;
	offsetB.y += (rng() - 0.5) * pixelSize;
	return {a: offsetA, b: offsetB};
}

function runUnitTests() {
	const square = rect(0, 0, 10, 10);
	const pair = RasterCollision.rasterisePair(square, 1);
	assert.strictEqual(
		RasterCollision.classify(
			pair.outer, pair.inner, {x: 0, y: 0},
			pair.outer, pair.inner, {x: 0, y: 0}
		),
		'overlap',
		'identical squares should be a proven overlap'
	);
	assert.strictEqual(
		RasterCollision.classify(
			pair.outer, pair.inner, {x: 0, y: 0},
			pair.outer, pair.inner, {x: 20, y: 0}
		),
		'disjoint',
		'well-separated squares should be proven disjoint'
	);
	assert.strictEqual(
		RasterCollision.classify(
			pair.outer, pair.inner, {x: 0.49, y: 0.49},
			pair.outer, pair.inner, {x: 20.49, y: 0.49}
		),
		'disjoint',
		'diagonal subpixel residual must remain covered'
	);

	const shifted = RasterCollision.rasterisePair(rect(0, 0, 12, 4), 0.25);
	assert.strictEqual(
		RasterCollision.intersects(
			shifted.inner, {x: 0, y: 0},
			shifted.inner, {x: 0.25, y: 0}
		),
		true,
		'bit intersection must work across unaligned 32-bit words'
	);

	const donut = withHoles(rect(0, 0, 12, 12), [rect(3, 3, 6, 6)]);
	const donutPair = RasterCollision.rasterisePair(donut, 0.25);
	const holePart = RasterCollision.rasterisePair(rect(0, 0, 1, 1), 0.25);
	assert.strictEqual(
		RasterCollision.intersects(
			donutPair.inner, {x: 0, y: 0},
			holePart.inner, {x: 5.5, y: 5.5}
		),
		false,
		'a part centered in a hole must not be a proven material overlap'
	);

	const sheet = RasterCollision.rasterisePair(rect(0, 0, 20, 20), 0.25);
	const part = RasterCollision.rasterisePair(rect(0, 0, 2, 2), 0.25);
	assert.strictEqual(
		RasterCollision.contains(sheet.inner, part.outer, {x: 9, y: 9}),
		true,
		'a conservatively interior part should pass containment'
	);
	assert.strictEqual(
		RasterCollision.contains(sheet.inner, part.outer, {x: -0.1, y: 9}),
		false,
		'a boundary-crossing part must fail conservative containment'
	);

	const chosen = RasterCollision.choosePixelSize(
		[rect(0, 0, 6, 8)],
		0.2,
		64
	);
	assert.ok(Math.abs(chosen - 0.15625) < 1e-12, 'pixel policy should use bbox diagonal / 64');
}

function runRandomizedSoundness() {
	const requested = Number(process.env.RASTER_SOUNDNESS_SAMPLES || 5000);
	const sampleCount = Math.max(5000, Math.floor(requested));
	const rng = mulberry32(0x524331);
	const report = {
		samples: sampleCount,
		outerDisjoint: 0,
		innerOverlap: 0,
		ambiguous: 0,
		exactOverlaps: 0,
		unsafeOuterDecisions: 0,
		unsafeInnerDecisions: 0,
		kinds: {convex: 0, concave: 0, holes: 0}
	};
	const pixelSizes = [0.2, 0.35, 0.6, 1.1];
	for (let sample = 0; sample < sampleCount; sample++) {
		const kindA = sample % 3;
		const kindB = Math.floor(sample / 3) % 3;
		const polygonA = randomPolygon(rng, kindA);
		const polygonB = randomPolygon(rng, kindB);
		report.kinds[['convex', 'concave', 'holes'][kindA]]++;
		report.kinds[['convex', 'concave', 'holes'][kindB]]++;
		const pixelSize = pixelSizes[sample % pixelSizes.length];
		const pairA = RasterCollision.rasterisePair(polygonA, pixelSize);
		const pairB = RasterCollision.rasterisePair(polygonB, pixelSize);
		const offsets = randomOffsets(polygonA, polygonB, pixelSize, sample, rng);
		const verdict = RasterCollision.classify(
			pairA.outer, pairA.inner, offsets.a,
			pairB.outer, pairB.inner, offsets.b
		);
		const area = exactIntersectionArea(
			polygonA, offsets.a, polygonB, offsets.b
		);
		const exactOverlap = area > 1e-9;
		if (exactOverlap) {
			report.exactOverlaps++;
		}
		if (verdict === 'disjoint') {
			report.outerDisjoint++;
			if (exactOverlap) {
				report.unsafeOuterDecisions++;
				throw new Error(
					'outer false-disjoint at sample ' + sample +
					', area=' + area + ', pixelSize=' + pixelSize
				);
			}
		}
		else if (verdict === 'overlap') {
			report.innerOverlap++;
			if (!exactOverlap) {
				report.unsafeInnerDecisions++;
				throw new Error(
					'inner false-overlap at sample ' + sample +
					', area=' + area + ', pixelSize=' + pixelSize
				);
			}
		}
		else {
			report.ambiguous++;
		}
	}
	return report;
}

function runRandomizedContainment() {
	const rng = mulberry32(0x434f4e54);
	const sampleCount = 1000;
	const pixelSize = 0.5;
	const container = rect(-15, -15, 30, 30);
	const sheetMasks = RasterCollision.rasterisePair(container, pixelSize);
	let provenContained = 0;
	for (let sample = 0; sample < sampleCount; sample++) {
		const polygon = randomPolygon(rng, sample % 3);
		const masks = RasterCollision.rasterisePair(polygon, pixelSize);
		const offset = {
			x: -12 + 24 * rng(),
			y: -12 + 24 * rng()
		};
		if (!RasterCollision.contains(sheetMasks.inner, masks.outer, offset)) {
			continue;
		}
		provenContained++;
		const outsideArea = exactOutsideArea(polygon, offset, container);
		if (outsideArea > 1e-9) {
			throw new Error(
				'containment false-positive at sample ' + sample +
				', outsideArea=' + outsideArea
			);
		}
	}
	assert.ok(provenContained > 100, 'containment gate must exercise its fast path');
	return {
		samples: sampleCount,
		provenContained: provenContained,
		unsafeContained: 0
	};
}

function pathTokens(pathData) {
	return pathData.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
}

function laurelPathPolygon(pathData, tolerance) {
	const tokens = pathTokens(pathData);
	const polygon = [];
	let index = 0;
	let command = null;
	let current = {x: 0, y: 0};
	let start = null;
	function isCommand(token) {
		return /^[A-Za-z]$/.test(token);
	}
	function number() {
		if (index >= tokens.length || isCommand(tokens[index])) {
			throw new Error('incomplete SVG path command ' + command);
		}
		return Number(tokens[index++]);
	}
	while (index < tokens.length) {
		if (isCommand(tokens[index])) {
			command = tokens[index++];
		}
		if (command === 'z' || command === 'Z') {
			current = {x: start.x, y: start.y};
			command = null;
			continue;
		}
		if (command === 'M' || command === 'm') {
			const relative = command === 'm';
			const point = {x: number(), y: number()};
			if (relative) {
				point.x += current.x;
				point.y += current.y;
			}
			current = point;
			start = {x: point.x, y: point.y};
			polygon.push({x: point.x, y: point.y});
			command = relative ? 'l' : 'L';
			continue;
		}
		if (command === 'L' || command === 'l') {
			const relative = command === 'l';
			const point = {x: number(), y: number()};
			if (relative) {
				point.x += current.x;
				point.y += current.y;
			}
			current = point;
			polygon.push({x: point.x, y: point.y});
			continue;
		}
		if (command === 'C' || command === 'c') {
			const relative = command === 'c';
			const values = [number(), number(), number(), number(), number(), number()];
			const control1 = {
				x: values[0] + (relative ? current.x : 0),
				y: values[1] + (relative ? current.y : 0)
			};
			const control2 = {
				x: values[2] + (relative ? current.x : 0),
				y: values[3] + (relative ? current.y : 0)
			};
			const end = {
				x: values[4] + (relative ? current.x : 0),
				y: values[5] + (relative ? current.y : 0)
			};
			const flattened = GeometryUtil.CubicBezier.linearize(
				current,
				end,
				control1,
				control2,
				tolerance
			);
			for (let i = 1; i < flattened.length; i++) {
				polygon.push(flattened[i]);
			}
			current = end;
			continue;
		}
		throw new Error('unsupported laurel SVG command: ' + command);
	}
	const deduped = [];
	for (const point of polygon) {
		const previous = deduped[deduped.length - 1];
		if (!previous || Math.abs(previous.x - point.x) > 1e-9 ||
			Math.abs(previous.y - point.y) > 1e-9) {
			deduped.push(point);
		}
	}
	if (deduped.length > 1) {
		const first = deduped[0];
		const last = deduped[deduped.length - 1];
		if (Math.abs(first.x - last.x) <= 1e-9 &&
			Math.abs(first.y - last.y) <= 1e-9) {
			deduped.pop();
		}
	}
	assert.ok(deduped.length >= 3, 'laurel path must flatten to a polygon');
	return deduped;
}

function rotateRing(ring, degrees) {
	const radians = degrees * Math.PI / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	const result = ring.map((point) => ({
		x: point.x * cosine - point.y * sine,
		y: point.x * sine + point.y * cosine
	}));
	if (ring.children) {
		result.children = ring.children.map((child) => rotateRing(child, degrees));
	}
	return result;
}

function normalizeEsicupShape(shape) {
	const normalized = esicup._normalizeShape(shape);
	return withHoles(
		normalized.outer.map((point) => ({x: point.x, y: point.y})),
		normalized.holes.map((hole) => hole.map((point) => ({
			x: point.x,
			y: point.y
		})))
	);
}

function candidateOffsets(boundsA, boundsB, pixelSize, sample, rng) {
	const offsetA = {
		x: (rng() - 0.5) * pixelSize,
		y: (rng() - 0.5) * pixelSize
	};
	const shallow = sample % 4 === 0;
	const overlapX = shallow ?
		pixelSize * (0.25 + 3.75 * rng()) :
		Math.min(boundsA.width, boundsB.width) * (0.1 + 0.9 * rng());
	const overlapY = shallow ?
		pixelSize * (0.25 + 3.75 * rng()) :
		Math.min(boundsA.height, boundsB.height) * (0.1 + 0.9 * rng());
	const fromRight = rng() < 0.5;
	const fromBottom = rng() < 0.5;
	const offsetB = {
		x: offsetA.x + (fromRight ?
			boundsA.x + boundsA.width - boundsB.x - overlapX :
			boundsA.x - (boundsB.x + boundsB.width) + overlapX),
		y: offsetA.y + (fromBottom ?
			boundsA.y + boundsA.height - boundsB.y - overlapY :
			boundsA.y - (boundsB.y + boundsB.height) + overlapY)
	};
	offsetB.x += (rng() - 0.5) * pixelSize;
	offsetB.y += (rng() - 0.5) * pixelSize;
	return {a: offsetA, b: offsetB};
}

function measurePreparedVariants(variants, pixelSize, sampleCount, seed) {
	const rng = mulberry32(seed);
	const counts = {
		samples: sampleCount,
		disjoint: 0,
		overlap: 0,
		ambiguous: 0
	};
	for (let sample = 0; sample < sampleCount; sample++) {
		const a = variants[Math.floor(rng() * variants.length)];
		const b = variants[Math.floor(rng() * variants.length)];
		const offsets = candidateOffsets(a.bounds, b.bounds, pixelSize, sample, rng);
		const verdict = RasterCollision.classify(
			a.masks.outer, a.masks.inner, offsets.a,
			b.masks.outer, b.masks.inner, offsets.b
		);
		counts[verdict]++;
	}
	counts.ambiguityRate = counts.ambiguous / counts.samples;
	return counts;
}

function prepareVariants(polygons, angles, pixelSize) {
	const variants = [];
	for (const polygon of polygons) {
		for (const angle of angles) {
			const rotated = angle === 0 ? cloneRing(polygon) : rotateRing(polygon, angle);
			variants.push({
				polygon: rotated,
				bounds: bounds(rotated),
				masks: RasterCollision.rasterisePair(rotated, pixelSize)
			});
		}
	}
	return variants;
}

function maskPairBytes(variant) {
	return RasterCollision.maskBytes(variant.masks.outer) +
		RasterCollision.maskBytes(variant.masks.inner);
}

function loadLaurelPolygon() {
	const fixturePath = path.join(repoRoot, 'ml', 'examples', 'laurel-two-crossed.svg');
	const svg = fs.readFileSync(fixturePath, 'utf8');
	const match = svg.match(/<path\b[^>]*\bd="([^"]+)"/);
	assert.ok(match, 'laurel fixture must contain a path');
	return laurelPathPolygon(match[1], 0.3);
}

function testResolutionPolicies() {
	function rect(w, h) {
		return [{x: 0, y: 0}, {x: w, y: 0}, {x: w, y: h}, {x: 0, y: h}];
	}
	// Shape rule adapts to perimeter-to-area: slender parts get finer pixels
	// relative to their own size than compact ones.
	const compact = RasterCollision.chooseShapePixelSize([rect(100, 100)], 0.3, 0.3);
	const slender = RasterCollision.chooseShapePixelSize([rect(1000, 20)], 0.3, 0.3);
	assert.ok(compact > slender, 'slender parts must receive a finer pixel than compact ones');
	assert.ok(Math.abs(compact - 0.3 * (100 * 100) / 400) < 1e-9, 'square closed form p = alpha*A/P');

	// Combined rule is the finer of the two and never coarser than either.
	const polys = [rect(1000, 20)];
	const bySize = RasterCollision.choosePixelSize(polys, 0.3, 64);
	const byShape = RasterCollision.chooseShapePixelSize(polys, 0.3, 0.3);
	const combined = RasterCollision.chooseAdaptivePixelSize(polys, 0.3, 64, 0.3);
	assert.strictEqual(combined, Math.min(bySize, byShape), 'combined policy must take the finer rule');
	assert.ok(combined <= bySize && combined <= byShape, 'combined policy is never coarser than either input');

	// Holes count toward both area (removed) and perimeter (added).
	const withHole = rect(100, 100);
	withHole.children = [rect(20, 20)];
	const holed = RasterCollision.chooseShapePixelSize([withHole], 0.3, 0.3);
	assert.ok(holed < compact, 'a hole removes area and adds boundary, so resolution must get finer');
}

function measureLaurel() {
	const polygon = loadLaurelPolygon();
	const angles = [0, 17, 37, 90];
	const divisors = [64, 96, 128, 192, 256];
	const resolutionSweep = [];
	let variants;
	let pixelSize;
	let counts;
	const shapeAlphas = [0.20, 0.30, 0.40];
	const shapePolicy = [];
	for (const alpha of shapeAlphas) {
		const shapePixelSize = RasterCollision.chooseShapePixelSize([polygon], 0.3, alpha);
		const shapeVariants = prepareVariants([polygon], angles, shapePixelSize);
		const shapeCounts = measurePreparedVariants(shapeVariants, shapePixelSize, 2500, 0x1a0e1);
		const shapeBytes = shapeVariants.map(maskPairBytes);
		const meanBytes = shapeBytes.reduce((sum, v) => sum + v, 0) / shapeBytes.length;
		const laurelBounds = RasterCollision.polygonBounds(polygon);
		shapePolicy.push({
			targetAmbiguity: alpha,
			pixelSize: shapePixelSize,
			equivalentDivisor: Math.hypot(laurelBounds.width, laurelBounds.height) / shapePixelSize,
			ambiguityRate: shapeCounts.ambiguityRate,
			actualFixtureVerdict: RasterCollision.classify(
				shapeVariants[0].masks.outer, shapeVariants[0].masks.inner, {x: 26000, y: 500},
				shapeVariants[3].masks.outer, shapeVariants[3].masks.inner, {x: 35000, y: 500}
			),
			meanBytesPerPartAngle: meanBytes,
			projectedBytes24Sources16Angles: meanBytes * 24 * 16
		});
	}
	for (const divisor of divisors) {
		const resolutionPixelSize = RasterCollision.choosePixelSize(
			[polygon],
			0.3,
			divisor
		);
		const resolutionVariants = prepareVariants(
			[polygon],
			angles,
			resolutionPixelSize
		);
		const resolutionCounts = measurePreparedVariants(
			resolutionVariants,
			resolutionPixelSize,
			2500,
			0x1a0e1
		);
		const resolutionBytes = resolutionVariants.map(maskPairBytes);
		resolutionSweep.push({
			rasterDivisor: divisor,
			pixelSize: resolutionPixelSize,
			ambiguityRate: resolutionCounts.ambiguityRate,
			disjoint: resolutionCounts.disjoint,
			overlap: resolutionCounts.overlap,
			actualFixtureVerdict: RasterCollision.classify(
				resolutionVariants[0].masks.outer,
				resolutionVariants[0].masks.inner,
				{x: 26000, y: 500},
				resolutionVariants[3].masks.outer,
				resolutionVariants[3].masks.inner,
				{x: 35000, y: 500}
			),
			meanBytesPerPartAngle: resolutionBytes.reduce(
				(sum, value) => sum + value,
				0
			) / resolutionBytes.length,
			maxBytesPerPartAngle: Math.max.apply(Math, resolutionBytes),
			projectedBytes24Sources16Angles: resolutionBytes.reduce(
				(sum, value) => sum + value,
				0
			) / resolutionBytes.length * 24 * 16
		});
		if (divisor === 64) {
			variants = resolutionVariants;
			pixelSize = resolutionPixelSize;
			counts = resolutionCounts;
		}
	}
	const actualA = variants[0];
	const actualB = variants[3];
	const actualVerdict = RasterCollision.classify(
		actualA.masks.outer, actualA.masks.inner, {x: 26000, y: 500},
		actualB.masks.outer, actualB.masks.inner, {x: 35000, y: 500}
	);
	const actualArea = exactIntersectionArea(
		actualA.polygon, {x: 26000, y: 500},
		actualB.polygon, {x: 35000, y: 500}
	);
	const bytes = variants.map(maskPairBytes);
	return {
		polygonVertices: polygon.length,
		pixelSize: pixelSize,
		sampled: counts,
		resolutionSweep: resolutionSweep,
		shapePolicy: shapePolicy,
		actualFixturePair: {
			verdict: actualVerdict,
			exactIntersectionArea: actualArea
		},
		memory: {
			meanBytesPerPartAngle: bytes.reduce((sum, value) => sum + value, 0) / bytes.length,
			maxBytesPerPartAngle: Math.max.apply(Math, bytes)
		}
	};
}

function measureEsicup() {
	const instanceDir = path.join(repoRoot, 'ml', 'benchmark', 'esicup', 'instances');
	const files = fs.readdirSync(instanceDir)
		.filter((name) => name.endsWith('.json'))
		.sort();
	const totals = {
		samples: 0,
		disjoint: 0,
		overlap: 0,
		ambiguous: 0
	};
	const memoryValues = [];
	const instances = [];
	for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
		const file = files[fileIndex];
		const json = JSON.parse(fs.readFileSync(path.join(instanceDir, file), 'utf8'));
		const polygons = json.items.map((item) => normalizeEsicupShape(item.shape));
		const pixelSize = process.env.RASTER_ADAPTIVE ?
			RasterCollision.chooseAdaptivePixelSize(polygons, 0.3, 64, Number(process.env.RASTER_ADAPTIVE)) :
			(process.env.RASTER_SHAPE_ALPHA ?
				RasterCollision.chooseShapePixelSize(polygons, 0.3, Number(process.env.RASTER_SHAPE_ALPHA)) :
				RasterCollision.choosePixelSize(polygons, 0.3, 64));
		const variants = prepareVariants(polygons, [0], pixelSize);
		const sampleCount = Math.max(200, Math.min(1000, variants.length * 12));
		const counts = measurePreparedVariants(
			variants,
			pixelSize,
			sampleCount,
			0x45534943 + fileIndex
		);
		for (const key of ['samples', 'disjoint', 'overlap', 'ambiguous']) {
			totals[key] += counts[key];
		}
		for (const variant of variants) {
			memoryValues.push(maskPairBytes(variant));
		}
		instances.push({
			name: json.name || path.basename(file, '.json'),
			sources: polygons.length,
			pixelSize: pixelSize,
			ambiguityRate: counts.ambiguityRate
		});
	}
	totals.ambiguityRate = totals.ambiguous / totals.samples;
	const meanBytes = memoryValues.reduce((sum, value) => sum + value, 0) /
		memoryValues.length;
	return {
		corpus: totals,
		instances: instances,
		memory: {
			sourceAnglesMeasured: memoryValues.length,
			meanBytesPerPartAngle: meanBytes,
			maxBytesPerPartAngle: Math.max.apply(Math, memoryValues),
			projectedBytes24Sources16Angles: meanBytes * 24 * 16
		}
	};
}

if (require.main === module) {
	runUnitTests();
	testResolutionPolicies();

	const report = {
		soundness: runRandomizedSoundness(),
		containment: runRandomizedContainment(),
		laurel: measureLaurel(),
		esicup: measureEsicup()
	};

	console.log(JSON.stringify(report, null, 2));

	assert.strictEqual(
		report.soundness.unsafeOuterDecisions,
		0,
		'outer masks must never produce an unsafe legal decision'
	);
	assert.strictEqual(
		report.soundness.unsafeInnerDecisions,
		0,
		'inner masks must never produce an unsafe overlap decision'
	);
	assert.ok(
		report.laurel.sampled.ambiguityRate <= 0.4,
		'laurel ambiguity gate failed: ' +
			(report.laurel.sampled.ambiguityRate * 100).toFixed(2) + '% > 40%'
	);

	console.log('raster collision RC-1 gate passed');
}

module.exports = {
	loadLaurelPolygon: loadLaurelPolygon,
	laurelPathPolygon: laurelPathPolygon,
	rotateRing: rotateRing,
	cloneRing: cloneRing
};

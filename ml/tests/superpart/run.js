'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ClipperLib = require('../../../main/util/clippernode.js');
const PoseGenerator = require('../../../main/util/pose-generator.js');
const Superpart = require('../../../main/util/superpart.js');
const ConfigCompatibility = require('../../../main/util/configcompatibility.js');
const Esicup = require('../../lib/esicup-convert.js');
const LaurelFixture = require('../raster_collision/run.js');

function lShape() {
	return [
		{x: 0, y: 0},
		{x: 10, y: 0},
		{x: 10, y: 2},
		{x: 2, y: 2},
		{x: 2, y: 6},
		{x: 0, y: 6}
	];
}

function rectangle(width, height) {
	return [
		{x: 0, y: 0},
		{x: width, y: 0},
		{x: width, y: height},
		{x: 0, y: height}
	];
}

function framedSquare() {
	const ring = [
		{x: 0, y: 0},
		{x: 10, y: 0},
		{x: 10, y: 10},
		{x: 0, y: 10}
	];
	ring.children = [[
		{x: 2, y: 2},
		{x: 2, y: 8},
		{x: 8, y: 8},
		{x: 8, y: 2}
	]];
	return ring;
}

function transformRing(ring, rotation, offset) {
	const rotated = PoseGenerator.rotateRing(ring, rotation);
	return Superpart.translateRing(rotated, offset);
}

function clipperPath(ring, scale) {
	return ring.map((point) => ({
		X: Math.round(point.x * scale),
		Y: Math.round(point.y * scale)
	}));
}

function outsideEnvelopeArea(member, envelope) {
	const scale = 10000000;
	const operation = new ClipperLib.Clipper();
	const solution = new ClipperLib.Paths();
	operation.AddPath(
		clipperPath(member, scale),
		ClipperLib.PolyType.ptSubject,
		true
	);
	operation.AddPath(
		clipperPath(envelope, scale),
		ClipperLib.PolyType.ptClip,
		true
	);
	assert.strictEqual(
		operation.Execute(
			ClipperLib.ClipType.ctDifference,
			solution,
			ClipperLib.PolyFillType.pftNonZero,
			ClipperLib.PolyFillType.pftNonZero
		),
		true
	);
	let area = 0;
	for (const path of solution) {
		area += Math.abs(ClipperLib.Clipper.Area(path));
	}
	return area / (scale * scale);
}

function assertNear(actual, expected, message) {
	assert.ok(
		Math.abs(actual - expected) <= 1e-7,
		message + ': expected ' + expected + ', got ' + actual
	);
}

function assertDeterministic() {
	const options = {
		sourceKey: 'l-control',
		curveTolerance: 0.001,
		budgetMs: 1000
	};
	const left = Superpart.findBestPair(lShape(), Object.assign({cache: {}}, options));
	const right = Superpart.findBestPair(lShape(), Object.assign({cache: {}}, options));
	assert.ok(left && right, 'L control must produce a pair');
	assert.ok(left.gain >= 0.15, 'L control must have substantive hull gain');
	assert.strictEqual(left.angle, right.angle, 'angle must be deterministic');
	assert.deepStrictEqual(left.offset, right.offset, 'offset must be deterministic');
	assert.strictEqual(left.envelopeMode, right.envelopeMode);
	assert.ok(left.diagnostics.elapsedMs <= 1250, 'L control must respect its budget');

	const cache = {};
	Superpart.findBestPair(lShape(), Object.assign({cache: cache}, options));
	const cached = Superpart.findBestPair(lShape(), Object.assign({cache: cache}, options));
	assert.strictEqual(cached.diagnostics.cacheHit, true, 'second source lookup must hit cache');

	const gravity = Superpart.findBestPair(lShape(), Object.assign({}, options, {
		cache: {},
		sourceKey: 'l-control-gravity',
		metric: 'gravity'
	}));
	assert.strictEqual(gravity.objective, 'gravity');
	assertNear(gravity.gain, gravity.gravityGain, 'gravity objective gain');
	const box = Superpart.findBestPair(lShape(), Object.assign({}, options, {
		cache: {},
		sourceKey: 'l-control-box',
		metric: 'box'
	}));
	assert.strictEqual(box.objective, 'box');
	assertNear(box.gain, box.bboxGain, 'box objective gain');
	assert.ok(
		box.pairBoundsArea <= gravity.pairBoundsArea,
		'bbox mating must not be replaced by the gravity linear-score proxy'
	);
}

function assertLaurelPair() {
	const polygon = LaurelFixture.loadLaurelPolygon();
	const result = Superpart.findBestPair(polygon, {
		sourceKey: 'laurel',
		curveTolerance: 0.3,
		budgetMs: 2000,
		cache: {}
	});
	assert.ok(result, 'laurel must produce a pair');
	assert.ok(
		result.gain >= 0.05,
		'laurel must clear the 5% SP-0 gate, got ' + (100 * result.gain).toFixed(2) + '%'
	);
	assert.strictEqual(result.diagnostics.exactIntersectionArea, 0);
	assert.ok(
		result.diagnostics.elapsedMs <= 2250,
		'laurel search must remain bounded, got ' + result.diagnostics.elapsedMs + 'ms'
	);
	assert.ok(
		result.unionPolygon.length <= 128,
		'collision shell must stay NFP-friendly, got ' + result.unionPolygon.length + ' points'
	);

	const fixed = transformRing(
		polygon,
		result.members[0].rotation,
		result.members[0].offset
	);
	const moved = transformRing(
		polygon,
		result.members[1].rotation,
		result.members[1].offset
	);
	assert.strictEqual(
		Superpart.exactIntersectionArea(fixed, moved, 10000000),
		0,
		'members must reconstruct with zero overlap'
	);
	assert.ok(outsideEnvelopeArea(fixed, result.unionPolygon) <= 1e-8);
	assert.ok(outsideEnvelopeArea(moved, result.unionPolygon) <= 1e-8);

	const placement = {id: 12, x: 150, y: -40, rotation: 37};
	for (let index = 0; index < result.members.length; index++) {
		const member = result.members[index];
		const composed = Superpart.composeMemberPlacement(
			placement,
			member,
			'12-m' + index,
			4
		);
		const expectedOffset = PoseGenerator.rotateRing(
			[member.offset],
			placement.rotation
		)[0];
		assertNear(composed.x, placement.x + expectedOffset.x, 'composed x');
		assertNear(composed.y, placement.y + expectedOffset.y, 'composed y');
		assertNear(
			composed.rotation,
			(placement.rotation + member.rotation) % 360,
			'composed rotation'
		);
		assert.strictEqual(composed.source, 4);
	}

	return {
		angle: result.angle,
		gain: result.gain,
		bboxGain: result.bboxGain,
		envelopeMode: result.envelopeMode,
		envelopePoints: result.unionPolygon.length,
		diagnostics: result.diagnostics
	};
}

function assertCompatibilityGate() {
	const inactive = {
		superpartClustering: false,
		mergeLines: true
	};
	ConfigCompatibility.applySuperpartClustering(inactive);
	assert.strictEqual(inactive.mergeLines, true, 'flag-off must preserve common-line merging');

	const active = {
		superpartClustering: true,
		mergeLines: true
	};
	ConfigCompatibility.applySuperpartClustering(active);
	assert.strictEqual(active.mergeLines, true,
		'common-line merging must remain available when no pair forms');
	ConfigCompatibility.applySuperpartClustering(active, true);
	assert.strictEqual(active.mergeLines, false, 'superparts must disable common-line merging');
	const rules = ConfigCompatibility.rulesForSuperpartClustering();
	assert.deepStrictEqual(rules.map((rule) => rule.key), ['mergeLines']);
	assert.ok(rules[0].reason.length > 20, 'disabled common-line merging must explain why');

	const stepRepeat = {
		placementType: 'steprepeat',
		superpartClustering: true,
		mergeLines: true
	};
	ConfigCompatibility.applySuperpartClustering(stepRepeat);
	assert.strictEqual(stepRepeat.superpartClustering, false,
		'Step & Repeat must disable superpart clustering in the engine');
	assert.strictEqual(stepRepeat.mergeLines, true,
		'Step & Repeat rejection must not mutate unrelated common-line state');
}

function assertConnectedEnvelopePreservesHoles() {
	const fixed = framedSquare();
	const moved = Superpart.translateRing(framedSquare(), {x: 10, y: 0});
	const envelope = Superpart.buildCollisionEnvelope(
		fixed,
		moved,
		0.001,
		10000000
	);
	assert.ok(envelope, 'touching framed parts must produce an envelope');
	assert.strictEqual(envelope.mode, 'exactUnion');
	assert.strictEqual(envelope.polygon.children.length, 2);
	assertNear(
		Superpart.materialArea(envelope.polygon),
		2 * Superpart.materialArea(fixed),
		'connected union material area'
	);
}

function assertExpandedPlacementValidation() {
	const sheet = rectangle(100, 100);
	const parts = [
		{polygontree: sheet},
		{polygontree: lShape()}
	];
	const valid = Superpart.validateExpandedPlacements([{
		sheet: 0,
		sheetplacements: [
			{source: 1, x: 10, y: 10, rotation: 0},
			{source: 1, x: 40, y: 10, rotation: 0}
		]
	}], parts);
	assert.strictEqual(valid.valid, true);

	const overlap = Superpart.validateExpandedPlacements([{
		sheet: 0,
		sheetplacements: [
			{source: 1, x: 10, y: 10, rotation: 0},
			{source: 1, x: 11, y: 10, rotation: 0}
		]
	}], parts);
	assert.strictEqual(overlap.valid, false);
	assert.strictEqual(overlap.reason, 'expandedMembersOverlap');
	assert.strictEqual(
		Superpart.composeMemberPlacement(
			{x: NaN, y: Infinity, rotation: NaN},
			{rotation: 0, offset: {x: 0, y: 0}},
			'invalid',
			1
		),
		null
	);
}

function assertExpandedPlacementToleranceIsLinear() {
	const parts = [
		{polygontree: rectangle(100, 100)},
		{polygontree: rectangle(10, 10)}
	];
	const numericalContact = Superpart.validateExpandedPlacements([{
		sheet: 0,
		sheetplacements: [
			{source: 1, x: 10, y: 10, rotation: 0},
			{source: 1, x: 19.9999998, y: 10, rotation: 0}
		]
	}], parts);
	assert.strictEqual(
		numericalContact.valid,
		true,
		'a sub-tolerance transform sliver must remain legal'
	);
	assert.strictEqual(numericalContact.numericalContactCount, 1);

	const shallowButMaterial = Superpart.validateExpandedPlacements([{
		sheet: 0,
		sheetplacements: [
			{source: 1, x: 10, y: 10, rotation: 0},
			{source: 1, x: 19.999, y: 10, rotation: 0}
		]
	}], parts);
	assert.strictEqual(
		shallowButMaterial.valid,
		false,
		'a low-area overlap with material penetration must fail closed'
	);
	assert.strictEqual(shallowButMaterial.reason, 'expandedMembersOverlap');

	const numericalSheetContact = Superpart.validateExpandedPlacements([{
		sheet: 0,
		sheetplacements: [
			{source: 1, x: -0.0000002, y: 10, rotation: 0}
		]
	}], parts);
	assert.strictEqual(
		numericalSheetContact.valid,
		true,
		'a sub-tolerance sheet-boundary transform sliver must remain legal'
	);

	const outsideSheet = Superpart.validateExpandedPlacements([{
		sheet: 0,
		sheetplacements: [
			{source: 1, x: -0.001, y: 10, rotation: 0}
		]
	}], parts);
	assert.strictEqual(outsideSheet.valid, false);
	assert.strictEqual(outsideSheet.reason, 'memberOutsideSheet');
}

function assertEnvelopeUnionFailureFallsBack() {
	const fixturePath = path.resolve(
		__dirname,
		'..',
		'..',
		'benchmark',
		'esicup',
		'instances',
		'gardeyn4.json'
	);
	const converted = Esicup.instanceToSvg(
		JSON.parse(fs.readFileSync(fixturePath, 'utf8')),
		{compactDemands: true}
	);
	const record = converted.meta.sourceMap['4'];
	const polygon = record.polygon.map((point) => ({x: point.x, y: point.y}));
	polygon.children = (record.holes || []).map((hole) =>
		hole.map((point) => ({x: point.x, y: point.y}))
	);
	const trace = {};
	const result = Superpart.findBestPair(polygon, {
		sourceKey: 'gardeyn4-source-4-union-fallback',
		curveTolerance: 0.72,
		clipperScale: 10000000,
		budgetMs: 2000,
		minGain: 0.10,
		metric: 'convexhull',
		cache: {},
		trace: trace
	});
	assert.ok(result, 'gardeyn4 source 4 must fail soft to a conservative envelope');
	assert.strictEqual(result.envelopeMode, 'convexHull');
	assert.match(
		result.diagnostics.envelopeUnionError,
		/ParseFirstLeft/,
		'Clipper union failure must remain observable in diagnostics'
	);
	assert.strictEqual(trace.envelopeUnionError, result.diagnostics.envelopeUnionError);
	const fixed = transformRing(
		polygon,
		result.members[0].rotation,
		result.members[0].offset
	);
	const moved = transformRing(
		polygon,
		result.members[1].rotation,
		result.members[1].offset
	);
	assert.ok(outsideEnvelopeArea(fixed, result.unionPolygon) <= 1e-8);
	assert.ok(outsideEnvelopeArea(moved, result.unionPolygon) <= 1e-8);
}

assertDeterministic();
assertCompatibilityGate();
	assertConnectedEnvelopePreservesHoles();
	assertExpandedPlacementValidation();
	assertExpandedPlacementToleranceIsLinear();
	assertEnvelopeUnionFailureFallsBack();
const report = assertLaurelPair();
console.log(JSON.stringify(report, null, 2));
console.log('superpart SP-1 tests passed');

'use strict';

const assert = require('assert');
const PoseGenerator = require('../../../main/util/pose-generator.js');

function rect(x, y, width, height) {
	return [
		{x, y},
		{x: x + width, y},
		{x: x + width, y: y + height},
		{x, y: y + height}
	];
}

function assertClose(actual, expected, tolerance, message) {
	assert.ok(
		Math.abs(actual - expected) <= tolerance,
		message + ' expected ' + expected + ' got ' + actual
	);
}

function rotatePoint(point, degrees) {
	const r = degrees * Math.PI / 180;
	return {
		x: point.x * Math.cos(r) - point.y * Math.sin(r),
		y: point.x * Math.sin(r) + point.y * Math.cos(r)
	};
}

// Apply a pose to a source polygon the way the engine would: rotate the source
// about the origin to pose.rotation, then translate by (pose.x, pose.y).
function applyPose(sourceRing, sourceRotation, pose) {
	const delta = pose.rotation - sourceRotation;
	return sourceRing.map((p) => {
		const r = rotatePoint(p, delta);
		return {x: r.x + pose.x, y: r.y + pose.y};
	});
}

function pointSegmentDistance(point, a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared <= 0) {
		return Math.hypot(point.x - a.x, point.y - a.y);
	}
	let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function testLongestEdgesDeterministic() {
	const slender = rect(0, 0, 100, 10);
	const edges = PoseGenerator.longestEdges(slender, 2);
	assert.strictEqual(edges.length, 2, 'should return the requested edge count');
	assertClose(edges[0].length, 100, 1e-9, 'longest edge first');
	assertClose(edges[1].length, 100, 1e-9, 'second longest is the opposite long edge');
	// Ties break on index, so repeated calls are stable.
	const again = PoseGenerator.longestEdges(slender, 2);
	assert.deepStrictEqual(
		edges.map((e) => e.index),
		again.map((e) => e.index),
		'edge ordering must be deterministic'
	);
}

function testOutwardNormalIsWindingAgnostic() {
	const ccw = rect(0, 0, 10, 10);
	const cw = ccw.slice().reverse();
	for (const [label, ring] of [['ccw', ccw], ['cw', cw]]) {
		const edges = PoseGenerator.polygonEdges(ring);
		for (const edge of edges) {
			const normal = PoseGenerator.edgeOutwardNormal(ring, edge);
			const mid = {
				x: (edge.a.x + edge.b.x) / 2 + normal.x * 0.5,
				y: (edge.a.y + edge.b.y) / 2 + normal.y * 0.5
			};
			const inside = mid.x > 0 && mid.x < 10 && mid.y > 0 && mid.y < 10;
			assert.ok(!inside, label + ': outward normal must point away from material');
		}
	}
}

function testEdgeMatingIsAntiparallelAndFlush() {
	// A slender bar mated against another slender bar held at 30 degrees.
	const target = rect(0, 0, 100, 10);
	const neighbourSource = rect(0, 0, 100, 10);
	const neighbourRotation = 30;
	const neighbour = neighbourSource.map((p) => rotatePoint(p, neighbourRotation));
	const neighbourPlacement = {x: 500, y: 300, rotation: neighbourRotation};
	const targetPlacement = {x: 0, y: 0, rotation: 0};

	const separation = 2;
	const poses = PoseGenerator.edgeMatingPoses(
		target, targetPlacement, neighbour, neighbourPlacement,
		{maxEdges: 4, separation}
	);
	assert.ok(poses.length > 0, 'edge mating should emit poses');

	const neighbourWorld = neighbour.map((p) => ({
		x: p.x + neighbourPlacement.x,
		y: p.y + neighbourPlacement.y
	}));

	// At least one pose must place a long target edge flush against the
	// neighbour's long edge: antiparallel, and separated by exactly `separation`.
	let flushFound = false;
	for (const pose of poses) {
		const world = applyPose(target, 0, pose);
		const worldEdges = PoseGenerator.longestEdges(world, 2);
		for (const te of worldEdges) {
			for (const ne of PoseGenerator.longestEdges(neighbourWorld, 2)) {
				// `longestEdges` returns both long edges of a bar, which run in
				// opposite directions, so collinearity is the mod-180 test.
				const relative = PoseGenerator.normalizeAngle(te.angle - ne.angle) % 180;
				if (Math.min(relative, 180 - relative) > 1e-6) {
					continue;
				}
				const mid = {x: (te.a.x + te.b.x) / 2, y: (te.a.y + te.b.y) / 2};
				const distance = pointSegmentDistance(mid, ne.a, ne.b);
				if (Math.abs(distance - separation) < 1e-6) {
					flushFound = true;
				}
			}
		}
	}
	assert.ok(flushFound, 'a mated pose must sit antiparallel and exactly `separation` away');
}

function testEdgeMatingProducesOffGridAngles() {
	// The whole point: a neighbour at a non-canonical angle must yield target
	// rotations that a 0/90/180/270 grid cannot express.
	const target = rect(0, 0, 100, 10);
	const neighbourRotation = 37.2;
	const neighbour = rect(0, 0, 100, 10).map((p) => rotatePoint(p, neighbourRotation));
	const poses = PoseGenerator.edgeMatingPoses(
		target, {x: 0, y: 0, rotation: 0},
		neighbour, {x: 200, y: 200, rotation: neighbourRotation},
		{maxEdges: 4}
	);
	const offGrid = poses.filter((pose) => {
		const mod = PoseGenerator.normalizeAngle(pose.rotation) % 90;
		return Math.min(mod, 90 - mod) > 1e-6;
	});
	assert.ok(offGrid.length > 0, 'mating a 37.2-degree neighbour must produce off-grid rotations');
}

function testRotateAboutPivotKeepsPivotFixed() {
	const placement = {x: 40, y: 15, rotation: 20};
	const pivot = {x: 73, y: 61};
	for (const delta of [-33.3, -1, 0.25, 7, 44.9]) {
		const pose = PoseGenerator.rotateAboutPivot(placement, delta, pivot);
		// Reconstruct where the pivot lands under the new pose.
		const pivotLocal = {x: pivot.x - placement.x, y: pivot.y - placement.y};
		const moved = rotatePoint(pivotLocal, delta);
		assertClose(moved.x + pose.x, pivot.x, 1e-9, 'pivot x must be invariant');
		assertClose(moved.y + pose.y, pivot.y, 1e-9, 'pivot y must be invariant');
		assertClose(
			pose.rotation,
			PoseGenerator.normalizeAngle(placement.rotation + delta),
			1e-9,
			'pose rotation must be base + delta'
		);
	}
}

function testRotationPosesSweepBothDirections() {
	const poses = PoseGenerator.rotationPoses(
		{x: 0, y: 0, rotation: 0}, {x: 5, y: 5},
		{stepDegrees: 1, maxDeltaDegrees: 3}
	);
	const angles = poses.map((p) => Math.round(PoseGenerator.normalizeAngle(p.rotation) * 100) / 100);
	for (const expected of [1, 2, 3, 357, 358, 359]) {
		assert.ok(angles.indexOf(expected) >= 0, 'sweep must include ' + expected + ' degrees');
	}
	assert.strictEqual(new Set(angles).size, angles.length, 'sweep must not emit duplicates');
}

function testSiblingPosesGiveAlignmentAndReversal() {
	const poses = PoseGenerator.siblingPoses({x: 10, y: 20, rotation: 5}, 37.2);
	const angles = poses.map((p) => Math.round(p.rotation * 10) / 10);
	assert.deepStrictEqual(angles.sort((a, b) => a - b), [37.2, 217.2],
		'sibling family is the dominant angle and its 180-degree complement');
	for (const pose of poses) {
		assert.strictEqual(pose.x, 10, 'sibling poses keep position');
		assert.strictEqual(pose.y, 20, 'sibling poses keep position');
	}
}

function testRankPosesIsStableAndCapped() {
	const poses = [
		{rotation: 0, x: 0, y: 0, provenance: 'a'},
		{rotation: 10, x: 0, y: 0, provenance: 'b'},
		{rotation: 20, x: 0, y: 0, provenance: 'c'},
		{rotation: 30, x: 0, y: 0, provenance: 'd'}
	];
	const scores = {a: 5, b: 9, c: 9, d: 1};
	const ranked = PoseGenerator.rankPoses(poses, (p) => scores[p.provenance], 3);
	assert.strictEqual(ranked.length, 3, 'cap must be honoured');
	assert.deepStrictEqual(
		ranked.map((p) => p.provenance),
		['b', 'c', 'a'],
		'ties break on original index so ordering is deterministic'
	);
}

function testHoleBearingInputIsHandled() {
	const holed = rect(0, 0, 100, 40);
	holed.children = [rect(20, 10, 20, 20)];
	// Hole rings must not corrupt edge selection on the outer contour...
	const edges = PoseGenerator.longestEdges(holed, 2);
	assertClose(edges[0].length, 100, 1e-9, 'outer contour drives edge selection');
	// ...and rotation must carry hole rings along.
	const rotated = PoseGenerator.rotateRing(holed, 90);
	assert.ok(rotated.children && rotated.children.length === 1, 'rotation preserves hole rings');
	assertClose(
		Math.hypot(rotated.children[0][0].x, rotated.children[0][0].y),
		Math.hypot(holed.children[0][0].x, holed.children[0][0].y),
		1e-9,
		'hole vertices rotate about the origin with the outer ring'
	);
}

function run() {
	testLongestEdgesDeterministic();
	testOutwardNormalIsWindingAgnostic();
	testEdgeMatingIsAntiparallelAndFlush();
	testEdgeMatingProducesOffGridAngles();
	testRotateAboutPivotKeepsPivotFixed();
	testRotationPosesSweepBothDirections();
	testSiblingPosesGiveAlignmentAndReversal();
	testRankPosesIsStableAndCapped();
	testHoleBearingInputIsHandled();
	console.log('pose generator tests passed');
}

run();

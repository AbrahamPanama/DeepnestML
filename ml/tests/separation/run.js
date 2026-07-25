'use strict';

const assert = require('assert');
const ClipperLib = require('../../../main/util/clippernode.js');
const SeparationUtil = require('../../../main/util/separation.js');

function rect(x, y, width, height) {
	return [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height }
	];
}

function assertClose(actual, expected, tolerance, message) {
	assert.ok(Math.abs(actual - expected) <= tolerance, message + ' expected ' + expected + ' got ' + actual);
}

function createSquareContext(initialPlacements, ifpRing) {
	const placements = initialPlacements.map((p) => ({ x: p.x, y: p.y }));
	const parts = initialPlacements.map(() => [{ x: 0, y: 0 }]);
	return {
		placements,
		ctx: {
			n: placements.length,
			q: function (i) {
				return {
					x: placements[i].x + parts[i][0].x,
					y: placements[i].y + parts[i][0].y
				};
			},
			setPlacement: function (i, t) {
				placements[i].x = t.x;
				placements[i].y = t.y;
			},
			refPoint: function (i) {
				return parts[i][0];
			},
			nfp: function (i, j) {
				void i;
				const qj = placements[j];
				return rect(qj.x - 1, qj.y - 1, 2, 2);
			},
			ifp: function () {
				return [ifpRing || rect(-5, -5, 10, 10)];
			},
			bboxDiag: function () {
				return Math.sqrt(2);
			},
			sheetBounds: { x: -5, y: -5, width: 10, height: 10 },
			eps: 1e-6,
			deadline: Date.now() + 1000,
			rng: SeparationUtil.mulberry32(123),
			maxAttempts: 3,
			maxItersPerAttempt: 150
		}
	};
}

function hasOverlap(ctx) {
	for (let i = 0; i < ctx.n; i++) {
		for (let j = 0; j < ctx.n; j++) {
			if (i === j) {
				continue;
			}
			if (SeparationUtil.penetration(ctx.q(i), ctx.nfp(i, j)).depth > ctx.eps) {
				return true;
			}
		}
	}
	return false;
}

function testSeparatedSquaresHaveNoOverlap() {
	const nfp = rect(-1, -1, 2, 2);
	const pen = SeparationUtil.penetration({ x: 1.5, y: 0 }, nfp);
	assert.strictEqual(pen.inside, false, 'square 0.5 apart should not overlap');
	assert.strictEqual(pen.depth, 0, 'non-overlap depth should be zero');
}

function testOverlappedSquaresResolve() {
	const nfp = rect(-1, -1, 2, 2);
	const pen = SeparationUtil.penetration({ x: 0.7, y: 0 }, nfp);
	assert.strictEqual(pen.inside, true, 'overlapped square reference should be inside NFP');
	assertClose(pen.depth, 0.3, 1e-6, 'penetration depth should match overlap');
	assertClose(pen.exit.x, 1, 1e-9, 'exit should be on closest NFP side');

	const fixture = createSquareContext([{ x: 0, y: 0 }, { x: 0.7, y: 0 }]);
	const result = SeparationUtil.separate(fixture.ctx);
	assert.strictEqual(result.feasible, true, 'separate should resolve a simple overlap');
	assert.ok(result.itersUsed < 50, 'simple overlap should resolve quickly');
	assert.strictEqual(hasOverlap(fixture.ctx), false, 'final square layout should be overlap-free');
}

function testNfpChildIsHole() {
	const nfp = rect(-2, -2, 4, 4);
	nfp.children = [rect(-0.5, -0.5, 1, 1)];
	const pen = SeparationUtil.penetration({ x: 0, y: 0 }, nfp);
	assert.strictEqual(pen.inside, false, 'point inside an NFP child hole is not overlapping');
	assert.strictEqual(pen.depth, 0, 'NFP child hole should have zero penetration');
}

function testContainmentViolation() {
	const result = SeparationUtil.containmentViolation({ x: -1, y: 0.5 }, [rect(0, 0, 10, 10)]);
	assert.strictEqual(result.outside, true, 'point outside IFP should be reported');
	assertClose(result.depth, 1, 1e-9, 'containment depth should be distance to boundary');
	assertClose(result.entry.x, 0, 1e-9, 'entry should be closest boundary point');
}

function testAxisBreakpoints() {
	const ring = rect(0, 0, 10, 10);
	assert.deepStrictEqual(
		SeparationUtil.axisBreakpoints({ x: 5, y: 4 }, 'x', ring),
		[0, 10],
		'x-axis scan through square interior should hit left and right sides'
	);
	assert.deepStrictEqual(
		SeparationUtil.axisBreakpoints({ x: 6, y: 5 }, 'y', ring),
		[0, 10],
		'y-axis scan through square interior should hit bottom and top sides'
	);
	assert.deepStrictEqual(
		SeparationUtil.axisBreakpoints({ x: 5, y: 0 }, 'x', ring),
		[0, 10],
		'line collinear with a square edge should emit edge endpoints once'
	);
	assert.deepStrictEqual(
		SeparationUtil.axisBreakpoints({ x: 11, y: 5 }, 'y', ring),
		[],
		'parallel scan outside square should have no crossings'
	);
}

function testMaterialOverlapErosionPredicate() {
	const curveTolerance = 1;
	const eps = 1e-4 * curveTolerance;
	const config = {
		clipperLib: ClipperLib,
		clipperScale: 10000000,
		curveTolerance
	};
	assert.strictEqual(
		SeparationUtil.materialOverlap(rect(0, 0, 1, 1), rect(1, 0, 1, 1), config),
		false,
		'exact edge contact should not be material overlap'
	);
	assert.strictEqual(
		SeparationUtil.materialOverlap(rect(0, 0, 1, 1), rect(1 - 0.4 * eps, 0, 1, 1), config),
		false,
		'sub-epsilon contact sliver should erode away'
	);
	assert.strictEqual(
		SeparationUtil.materialOverlap(rect(0, 0, 1, 1), rect(1 - 3 * eps, 0, 1, 1), config),
		true,
		'multi-epsilon overlap should survive erosion'
	);
}

function testTightThreeSquaresDeterministic() {
	const ifp = rect(-0.1, -0.1, 3.2, 1.2);
	const makeRun = () => {
		const fixture = createSquareContext([
			{ x: 0, y: 0 },
			{ x: 0.35, y: 0 },
			{ x: 0.7, y: 0 }
		], ifp);
		fixture.ctx.sheetBounds = { x: -0.1, y: -0.1, width: 3.2, height: 1.2 };
		fixture.ctx.rng = SeparationUtil.mulberry32(987);
		fixture.ctx.deadline = Date.now() + 1000;
		const result = SeparationUtil.separate(fixture.ctx);
		return {
			result,
			placements: fixture.placements.map((p) => ({
				x: Math.round(p.x * 1e9) / 1e9,
				y: Math.round(p.y * 1e9) / 1e9
			}))
		};
	};

	const first = makeRun();
	const second = makeRun();
	assert.strictEqual(first.result.feasible, true, 'three-square fixture should become feasible');
	assert.strictEqual(hasOverlap({
		n: 3,
		eps: 1e-6,
		q: function (i) { return first.placements[i]; },
		nfp: function (i, j) {
			void i;
			const qj = first.placements[j];
			return rect(qj.x - 1, qj.y - 1, 2, 2);
		}
	}), false, 'three-square fixture should be overlap-free');
	assert.deepStrictEqual(first.placements, second.placements, 'same seed should produce identical placement coordinates');
}

function testDeadlineRespected() {
	const fixture = createSquareContext([{ x: 0, y: 0 }, { x: 0.2, y: 0 }], rect(0, 0, 0.1, 0.1));
	fixture.ctx.sheetBounds = { x: 0, y: 0, width: 0.1, height: 0.1 };
	fixture.ctx.deadline = Date.now() - 1;
	const start = Date.now();
	const result = SeparationUtil.separate(fixture.ctx);
	assert.strictEqual(result.feasible, false, 'expired deadline should return infeasible');
	assert.ok(Date.now() - start < 50, 'deadline exit should be prompt');
}

function testTranslatedQueryMatchesShiftedNfp(){
	const rng = SeparationUtil.mulberry32(424242);
	function shiftedRing(ring, shift){
		const result = ring.map((point) => ({x: point.x + shift.x, y: point.y + shift.y}));
		if(ring.children){
			result.children = ring.children.map((child) => shiftedRing(child, shift));
		}
		return result;
	}
	for(let sample=0; sample<500; sample++){
		const width = 1 + 20 * rng();
		const height = 1 + 20 * rng();
		const nfp = rect(-width / 2, -height / 2, width, height);
		if(sample % 3 === 0){
			nfp.children = [rect(-width / 8, -height / 8, width / 4, height / 4)];
		}
		const shift = {x: -50 + 100 * rng(), y: -50 + 100 * rng()};
		const localQ = {x: -width + 2 * width * rng(), y: -height + 2 * height * rng()};
		const worldQ = {x: localQ.x + shift.x, y: localQ.y + shift.y};
		const shifted = SeparationUtil.penetration(worldQ, shiftedRing(nfp, shift));
		const translated = SeparationUtil.penetration(localQ, nfp);
		assert.strictEqual(translated.inside, shifted.inside, 'translated query should preserve NFP inside state');
		assertClose(translated.depth, shifted.depth, 1e-12, 'translated query should preserve penetration depth');
		if(translated.exit || shifted.exit){
			assert.ok(translated.exit && shifted.exit, 'translated and shifted predicates should both return an exit');
			assertClose(translated.exit.x + shift.x, shifted.exit.x, 1e-12, 'translated exit x should map back to world coordinates');
			assertClose(translated.exit.y + shift.y, shifted.exit.y, 1e-12, 'translated exit y should map back to world coordinates');
		}
	}
}

function run() {
	testSeparatedSquaresHaveNoOverlap();
	testOverlappedSquaresResolve();
	testNfpChildIsHole();
	testContainmentViolation();
	testAxisBreakpoints();
	testMaterialOverlapErosionPredicate();
	testTightThreeSquaresDeterministic();
	testDeadlineRespected();
	testTranslatedQueryMatchesShiftedNfp();
	console.log('separation tests passed');
}

run();

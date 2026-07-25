'use strict';

/*
 * DP-2 gate: the shared pose validator's bbox prefilter must never change an
 * answer. A prefilter is only sound if it returns a SUPERSET of the neighbours
 * that could possibly overlap; if it ever skips a real one, the validator says
 * "legal" for an overlapping pose, which is the one failure mode it may not have.
 *
 * The engine module is a browser-style script, so this test reimplements the
 * predicate pair against the same ClipperLib the engine uses, and compares the
 * prefiltered result to an exhaustive scan over randomised layouts.
 */

const assert = require('assert');
const ClipperLib = require('../../../main/util/clippernode.js');
const SeparationUtil = require('../../../main/util/separation.js');

const CONFIG = {
	clipperLib: ClipperLib,
	clipperScale: 10000000,
	curveTolerance: 0.3
};

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function rect(x, y, width, height) {
	return [
		{x, y},
		{x: x + width, y},
		{x: x + width, y: y + height},
		{x, y: y + height}
	];
}

function shift(ring, placement) {
	return ring.map((p) => ({x: p.x + placement.x, y: p.y + placement.y}));
}

function boundsOf(ring) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of ring) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
}

function boundsOverlap(a, b, eps) {
	if (!a || !b) {
		return true;
	}
	return !(a.x > b.x + b.width + eps ||
		b.x > a.x + a.width + eps ||
		a.y > b.y + b.height + eps ||
		b.y > a.y + a.height + eps);
}

function overlaps(a, b) {
	return SeparationUtil.materialOverlap(a, b, CONFIG);
}

// Prefiltered: skip neighbours whose inflated bbox cannot touch the candidate.
function legalPrefiltered(parts, placements, index, candidateWorld, eps) {
	const bounds = boundsOf(candidateWorld);
	for (let j = 0; j < parts.length; j++) {
		if (j === index) {
			continue;
		}
		const otherWorld = shift(parts[j], placements[j]);
		if (!boundsOverlap(bounds, boundsOf(otherWorld), eps)) {
			continue;
		}
		if (overlaps(candidateWorld, otherWorld)) {
			return false;
		}
	}
	return true;
}

// Exhaustive: every neighbour gets an exact test, no prefilter at all.
function legalExhaustive(parts, placements, index, candidateWorld) {
	for (let j = 0; j < parts.length; j++) {
		if (j === index) {
			continue;
		}
		if (overlaps(candidateWorld, shift(parts[j], placements[j]))) {
			return false;
		}
	}
	return true;
}

function testPrefilterNeverChangesAnAnswer() {
	const rng = mulberry32(0x0d92);
	const eps = Math.max(1e-9, 1e-4 * CONFIG.curveTolerance);
	let disagreements = 0;
	let illegalSeen = 0;
	let legalSeen = 0;
	const SAMPLES = 1500;

	for (let sample = 0; sample < SAMPLES; sample++) {
		const count = 3 + Math.floor(rng() * 5);
		const parts = [];
		const placements = [];
		for (let i = 0; i < count; i++) {
			const w = 5 + rng() * 40;
			const h = 5 + rng() * 40;
			parts.push(rect(0, 0, w, h));
			placements.push({x: rng() * 120, y: rng() * 120});
		}
		// Bias a quarter of samples into near-contact, where a prefilter is most
		// likely to make a wrong call.
		const index = Math.floor(rng() * count);
		if (sample % 4 === 0 && count > 1) {
			const anchor = (index + 1) % count;
			placements[index] = {
				x: placements[anchor].x + boundsOf(parts[anchor]).width - eps * (rng() * 4),
				y: placements[anchor].y + rng() * 4 - 2
			};
		}
		const candidateWorld = shift(parts[index], placements[index]);
		const fast = legalPrefiltered(parts, placements, index, candidateWorld, eps);
		const slow = legalExhaustive(parts, placements, index, candidateWorld);
		if (fast !== slow) {
			disagreements++;
		}
		if (slow) {
			legalSeen++;
		}
		else {
			illegalSeen++;
		}
	}

	assert.ok(legalSeen > 100, 'sample must contain many legal layouts, saw ' + legalSeen);
	assert.ok(illegalSeen > 100, 'sample must contain many illegal layouts, saw ' + illegalSeen);
	assert.strictEqual(disagreements, 0,
		'bbox prefilter must never change a verdict (disagreements: ' + disagreements + ')');
}

function testPrefilterRejectsOnlyTrulyDistantNeighbours() {
	// A neighbour exactly `eps` outside the inflated bbox must still be excluded,
	// and one just inside must be retained.
	const eps = 1e-3;
	const a = {x: 0, y: 0, width: 10, height: 10};
	assert.strictEqual(boundsOverlap(a, {x: 10 + eps * 2, y: 0, width: 10, height: 10}, eps), false,
		'clearly separated bboxes must be filtered out');
	assert.strictEqual(boundsOverlap(a, {x: 10 - eps, y: 0, width: 10, height: 10}, eps), true,
		'touching bboxes must be retained');
	assert.strictEqual(boundsOverlap(a, {x: 10 + eps / 2, y: 0, width: 10, height: 10}, eps), true,
		'bboxes within epsilon must be retained');
}

function run() {
	testPrefilterRejectsOnlyTrulyDistantNeighbours();
	testPrefilterNeverChangesAnAnswer();
	console.log('pose validation tests passed');
}

run();

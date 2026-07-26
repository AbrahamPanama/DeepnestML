'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ClipperLib = require('../../../main/util/clippernode.js');
const PoseGenerator = require('../../../main/util/pose-generator.js');
const SeparationUtil = require('../../../main/util/separation.js');
const LaurelFixture = require('../raster_collision/run.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const artifactRoot = process.env.SUPERPART_GAIN_ARTIFACT_ROOT ||
	path.join('/tmp', 'deepnest-superpart-gain');
const clipperScale = 10000000;
const collisionConfig = {
	clipperLib: ClipperLib,
	clipperScale: clipperScale,
	curveTolerance: 0
};

function finite(value, fallback) {
	value = Number(value);
	return Number.isFinite(value) ? value : fallback;
}

function cloneRing(ring) {
	const result = ring.map((point) => ({x: point.x, y: point.y}));
	if (ring.children) {
		result.children = ring.children.map(cloneRing);
	}
	return result;
}

function translateRing(ring, offset) {
	const result = ring.map((point) => ({
		x: point.x + offset.x,
		y: point.y + offset.y
	}));
	if (ring.children) {
		result.children = ring.children.map((child) => translateRing(child, offset));
	}
	return result;
}

function boundsForRing(ring) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const point of ring) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
		maxX: maxX,
		maxY: maxY
	};
}

function mergeBounds(left, right) {
	const minX = Math.min(left.x, right.x);
	const minY = Math.min(left.y, right.y);
	const maxX = Math.max(left.maxX, right.maxX);
	const maxY = Math.max(left.maxY, right.maxY);
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY,
		maxX: maxX,
		maxY: maxY
	};
}

function bboxArea(bounds) {
	return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

function polygonArea(ring) {
	let area = 0;
	for (let i = 0; i < ring.length; i++) {
		const current = ring[i];
		const next = ring[(i + 1) % ring.length];
		area += current.x * next.y - next.x * current.y;
	}
	return area / 2;
}

function convexHull(points) {
	const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
	if (sorted.length <= 2) {
		return sorted;
	}
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
	for (let index = sorted.length - 1; index >= 0; index--) {
		const point = sorted[index];
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

function hullArea(left, right) {
	return Math.abs(polygonArea(convexHull(left.concat(right))));
}

function materialArea(ring) {
	let area = Math.abs(polygonArea(ring));
	if (ring.children) {
		for (const child of ring.children) {
			area -= materialArea(child);
		}
	}
	return area;
}

function clipperPaths(ring) {
	const rings = [ring].concat(ring.children || []);
	return rings.map((current) => current.map((point) => ({
		X: Math.round(point.x * clipperScale),
		Y: Math.round(point.y * clipperScale)
	})));
}

function exactIntersectionArea(left, right) {
	const clipper = new ClipperLib.Clipper();
	const solution = new ClipperLib.Paths();
	clipper.AddPaths(clipperPaths(left), ClipperLib.PolyType.ptSubject, true);
	clipper.AddPaths(clipperPaths(right), ClipperLib.PolyType.ptClip, true);
	assert.strictEqual(
		clipper.Execute(
			ClipperLib.ClipType.ctIntersection,
			solution,
			ClipperLib.PolyFillType.pftEvenOdd,
			ClipperLib.PolyFillType.pftEvenOdd
		),
		true,
		'Clipper intersection must execute'
	);
	let signedArea = 0;
	for (const ring of solution) {
		signedArea += ClipperLib.Clipper.Area(ring);
	}
	return Math.abs(signedArea) / (clipperScale * clipperScale);
}

function candidateScore(fixed, moved, singleBoundsArea, singleHullArea) {
	const pairBounds = mergeBounds(boundsForRing(fixed), boundsForRing(moved));
	const pairBoundsArea = bboxArea(pairBounds);
	const pairHullArea = hullArea(fixed, moved);
	return {
		pairBounds: pairBounds,
		pairBoundsArea: pairBoundsArea,
		pairHullArea: pairHullArea,
		bboxGain: 1 - pairBoundsArea / (2 * singleBoundsArea),
		hullGain: 1 - pairHullArea / (2 * singleHullArea)
	};
}

function fractions(count) {
	const result = [];
	for (let index = 0; index < count; index++) {
		result.push(count === 1 ? 0.5 : index / (count - 1));
	}
	return result;
}

function evaluatePose(context, rotated, angle, offset) {
	const moved = translateRing(rotated, offset);
	context.exactCollisionTests++;
	if (SeparationUtil.materialOverlap(context.fixed, moved, collisionConfig)) {
		return null;
	}
	const score = candidateScore(
		context.fixed,
		moved,
		context.singleBoundsArea,
		context.singleHullArea
	);
	return {
		angle: angle,
		offset: {x: offset.x, y: offset.y},
		moved: moved,
		pairBounds: score.pairBounds,
		pairBoundsArea: score.pairBoundsArea,
		pairHullArea: score.pairHullArea,
		bboxGain: score.bboxGain,
		hullGain: score.hullGain
	};
}

function compareBboxCandidates(left, right) {
	if (left.pairBoundsArea !== right.pairBoundsArea) {
		return left.pairBoundsArea - right.pairBoundsArea;
	}
	if (left.pairHullArea !== right.pairHullArea) {
		return left.pairHullArea - right.pairHullArea;
	}
	if (left.angle !== right.angle) {
		return left.angle - right.angle;
	}
	if (left.offset.x !== right.offset.x) {
		return left.offset.x - right.offset.x;
	}
	return left.offset.y - right.offset.y;
}

function compareHullCandidates(left, right) {
	if (left.pairHullArea !== right.pairHullArea) {
		return left.pairHullArea - right.pairHullArea;
	}
	return compareBboxCandidates(left, right);
}

function retainBest(candidates, candidate, limit, compare) {
	if (!candidate) {
		return;
	}
	candidates.push(candidate);
	candidates.sort(compare);
	if (candidates.length > limit) {
		candidates.length = limit;
	}
}

function refineTranslation(context, candidate, compare) {
	const rotated = PoseGenerator.rotateRing(context.source, candidate.angle);
	const rotatedBounds = boundsForRing(rotated);
	let best = candidate;
	let stepX = Math.max(
		context.curveTolerance,
		Math.min(context.fixedBounds.width, rotatedBounds.width) / 8
	);
	let stepY = Math.max(
		context.curveTolerance,
		Math.min(context.fixedBounds.height, rotatedBounds.height) / 8
	);
	const directions = [
		[-1, 0], [1, 0], [0, -1], [0, 1],
		[-1, -1], [-1, 1], [1, -1], [1, 1]
	];
	for (let level = 0; level < 12; level++) {
		let improved = true;
		let iterations = 0;
		while (improved && iterations < 12) {
			improved = false;
			iterations++;
			for (const direction of directions) {
				const trial = evaluatePose(context, rotated, candidate.angle, {
					x: best.offset.x + direction[0] * stepX,
					y: best.offset.y + direction[1] * stepY
				});
				if (trial && compare(trial, best) < 0) {
					best = trial;
					improved = true;
				}
			}
		}
		stepX /= 2;
		stepY /= 2;
		if (Math.max(stepX, stepY) <= context.curveTolerance) {
			break;
		}
	}
	return best;
}

function resultForCandidate(context, candidate, stats) {
	const intersectionArea = exactIntersectionArea(context.fixed, candidate.moved);
	assert.ok(
		intersectionArea <= 1e-8,
		'winning pair must have zero exact intersection area, got ' + intersectionArea
	);
	return {
		angle: candidate.angle,
		offset: candidate.offset,
		matingGain: candidate.bboxGain,
		hullGain: candidate.hullGain,
		pairBoundsArea: candidate.pairBoundsArea,
		pairHullArea: candidate.pairHullArea,
		singleBoundsArea: context.singleBoundsArea,
		singleHullArea: context.singleHullArea,
		singleMaterialArea: materialArea(context.source),
		exactIntersectionArea: intersectionArea,
		candidateCount: stats.candidateCount,
		legalCandidates: stats.legalCandidates,
		exactCollisionTests: context.exactCollisionTests,
		elapsedMs: stats.elapsedMs,
		fixed: context.fixed,
		moved: candidate.moved,
		pairBounds: candidate.pairBounds
	};
}

function refineFinalists(context, finalists, compare) {
	let best = finalists[0];
	for (const finalist of finalists) {
		const refined = refineTranslation(context, finalist, compare);
		if (compare(refined, best) < 0) {
			best = refined;
		}
	}
	return best;
}

function searchBestPair(source, options) {
	options = options || {};
	const fixed = cloneRing(source);
	const fixedBounds = boundsForRing(fixed);
	const singleBoundsArea = bboxArea(fixedBounds);
	const singleHullArea = Math.abs(polygonArea(convexHull(fixed)));
	const context = {
		source: source,
		fixed: fixed,
		fixedBounds: fixedBounds,
		singleBoundsArea: singleBoundsArea,
		singleHullArea: singleHullArea,
		curveTolerance: Math.max(1e-6, finite(options.curveTolerance, 0.3)),
		exactCollisionTests: 0
	};
	const start = Date.now();
	const xFractions = fractions(options.xSamples || 9);
	const yFractions = fractions(options.ySamples || 7);
	const angleStep = Math.max(0.01, finite(options.angleStep, 1));
	const bboxFinalists = [];
	const hullFinalists = [];
	let legalCandidates = 0;
	let candidateCount = 0;

	for (let angle = 0; angle < 360 - 1e-9; angle += angleStep) {
		const normalizedAngle = Math.round(angle * 1000000) / 1000000;
		const rotated = PoseGenerator.rotateRing(source, normalizedAngle);
		const rotatedBounds = boundsForRing(rotated);
		const minX = fixedBounds.x - rotatedBounds.maxX;
		const maxX = fixedBounds.maxX - rotatedBounds.x;
		const minY = fixedBounds.y - rotatedBounds.maxY;
		const maxY = fixedBounds.maxY - rotatedBounds.y;
		for (const xFraction of xFractions) {
			for (const yFraction of yFractions) {
				candidateCount++;
				const candidate = evaluatePose(context, rotated, normalizedAngle, {
					x: minX + (maxX - minX) * xFraction,
					y: minY + (maxY - minY) * yFraction
				});
				if (candidate) {
					legalCandidates++;
					retainBest(
						bboxFinalists,
						candidate,
						options.finalistCount || 24,
						compareBboxCandidates
					);
					retainBest(
						hullFinalists,
						candidate,
						options.finalistCount || 24,
						compareHullCandidates
					);
				}
			}
		}
	}

	assert.ok(bboxFinalists.length > 0, 'pair search must retain at least one legal pose');
	const bestBbox = refineFinalists(
		context,
		bboxFinalists,
		compareBboxCandidates
	);
	const bestHull = refineFinalists(
		context,
		hullFinalists,
		compareHullCandidates
	);
	const stats = {
		candidateCount: candidateCount,
		legalCandidates: legalCandidates,
		elapsedMs: Date.now() - start
	};
	return {
		bbox: resultForCandidate(context, bestBbox, stats),
		hull: resultForCandidate(context, bestHull, stats)
	};
}

function number(value) {
	return Number(value.toFixed(6)).toString();
}

function ringPath(ring) {
	const commands = [];
	for (let index = 0; index < ring.length; index++) {
		commands.push(
			(index === 0 ? 'M ' : 'L ') +
			number(ring[index].x) + ' ' + number(ring[index].y)
		);
	}
	commands.push('Z');
	if (ring.children) {
		for (const child of ring.children) {
			commands.push(ringPath(child));
		}
	}
	return commands.join(' ');
}

function writePairSvg(name, result) {
	const bounds = result.pairBounds;
	const margin = Math.max(bounds.width, bounds.height) * 0.08;
	const viewBox = [
		bounds.x - margin,
		bounds.y - margin,
		bounds.width + 2 * margin,
		bounds.height + 2 * margin
	].map(number).join(' ');
	const svg = [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '">',
		'  <rect x="' + number(bounds.x) + '" y="' + number(bounds.y) +
			'" width="' + number(bounds.width) + '" height="' + number(bounds.height) +
			'" fill="none" stroke="#111827" stroke-dasharray="4 3"/>',
		'  <path d="' + ringPath(result.fixed) +
			'" fill="#22c55e" fill-opacity="0.28" stroke="#166534" stroke-width="' +
			number(Math.max(bounds.width, bounds.height) / 800) + '" fill-rule="evenodd"/>',
		'  <path d="' + ringPath(result.moved) +
			'" fill="#38bdf8" fill-opacity="0.32" stroke="#075985" stroke-width="' +
			number(Math.max(bounds.width, bounds.height) / 800) + '" fill-rule="evenodd"/>',
		'</svg>',
		''
	].join('\n');
	const outputPath = path.join(artifactRoot, name + '-best-pair.svg');
	fs.writeFileSync(outputPath, svg);
	return outputPath;
}

function lShapeControl() {
	return [
		{x: 0, y: 0},
		{x: 10, y: 0},
		{x: 10, y: 2},
		{x: 2, y: 2},
		{x: 2, y: 6},
		{x: 0, y: 6}
	];
}

function reportResult(result, artifactPath) {
	return {
		matingGain: result.matingGain,
		hullGain: result.hullGain,
		winningRelativeAngle: result.angle,
		winningOffset: result.offset,
		pairBoundsArea: result.pairBoundsArea,
		pairHullArea: result.pairHullArea,
		singleBoundsArea: result.singleBoundsArea,
		singleHullArea: result.singleHullArea,
		singleMaterialArea: result.singleMaterialArea,
		exactIntersectionArea: result.exactIntersectionArea,
		candidateCount: result.candidateCount,
		legalCandidates: result.legalCandidates,
		exactCollisionTests: result.exactCollisionTests,
		elapsedMs: result.elapsedMs,
		artifactPath: artifactPath
	};
}

fs.mkdirSync(artifactRoot, {recursive: true});

const controlSearch = searchBestPair(lShapeControl(), {
	curveTolerance: 0.001,
	angleStep: 1,
	xSamples: 9,
	ySamples: 7
});
const control = controlSearch.bbox;
const controlArtifact = writePairSvg('l-control-bbox', control);
assert.ok(
	control.matingGain >= 0.2,
	'L-shape control must show at least 20% gain, got ' +
		(control.matingGain * 100).toFixed(2) + '%'
);

const laurelSearch = searchBestPair(LaurelFixture.loadLaurelPolygon(), {
	curveTolerance: 0.3,
	angleStep: 1,
	xSamples: 9,
	ySamples: 7
});
const laurelBboxArtifact = writePairSvg('laurel-bbox', laurelSearch.bbox);
const laurelHullArtifact = writePairSvg('laurel-hull', laurelSearch.hull);

const report = {
	predictionRecordedBeforeRun: {
		laurelMatingGainAtLeast: 0.1,
		lControlMatingGainAtLeast: 0.2,
		laurelStopThreshold: 0.05
	},
	control: {
		bboxWinner: reportResult(controlSearch.bbox, controlArtifact),
		hullWinner: reportResult(
			controlSearch.hull,
			writePairSvg('l-control-hull', controlSearch.hull)
		)
	},
	laurel: {
		bboxWinner: reportResult(laurelSearch.bbox, laurelBboxArtifact),
		hullWinner: reportResult(laurelSearch.hull, laurelHullArtifact)
	}
};

const reportPath = path.join(artifactRoot, 'report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

assert.ok(
	laurelSearch.hull.hullGain >= 0.05,
	'SP-0 stop condition: laurel hull mating gain ' +
		(laurelSearch.hull.hullGain * 100).toFixed(2) + '% is below 5%'
);

console.log('superpart SP-0 mating-gain gate passed');

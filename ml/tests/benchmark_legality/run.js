'use strict';

const assert = require('assert');
const ClipperLib = require('../../../main/util/clippernode.js');
const esicup = require('../../lib/esicup-convert.js');

function placement(source, x, y) {
	return {source: source, x: x, y: y, rotation: 0};
}

const meta = {
	stripHeight: 10,
	totalDemand: 2,
	sheetBounds: {x: 0, y: 0, width: 20, height: 10},
	sourceMap: {
		'1': {
			polygon: [
				{x: 0, y: 0},
				{x: 5, y: 0},
				{x: 5, y: 5},
				{x: 0, y: 5}
			],
			holes: []
		},
		'2': {
			polygon: [
				{x: 0, y: 0},
				{x: 5, y: 0},
				{x: 5, y: 5},
				{x: 0, y: 5}
			],
			holes: []
		}
	}
};

const touching = esicup.legalityFromPlacements(meta, [{
	sheetplacements: [placement(1, 0, 0), placement(2, 5, 0)]
}], ClipperLib);
assert.strictEqual(touching.legal, true, 'edge contact must remain legal');
assert.strictEqual(touching.maxIntersectionArea, 0, 'edge contact has zero area');

const numericalContact = esicup.legalityFromPlacements(meta, [{
	sheetplacements: [placement(1, 0, 0), placement(2, 4.9999998, 0)]
}], ClipperLib);
assert.strictEqual(
	numericalContact.legal,
	true,
	'floating-point contact sliver below the linear tolerance must remain legal'
);
assert.strictEqual(numericalContact.numericalContactCount, 1);
assert(numericalContact.maxPenetrationDepth < numericalContact.penetrationTolerance);

const numericalBoundaryContact = esicup.legalityFromPlacements(meta, [{
	sheetplacements: [placement(1, -0.0000005, 0), placement(2, 5, 0)]
}], ClipperLib);
assert.strictEqual(
	numericalBoundaryContact.legal,
	true,
	'sub-tolerance sheet-boundary roundoff must remain legal'
);
assert.strictEqual(numericalBoundaryContact.outsideCount, 0);

const overlapping = esicup.legalityFromPlacements(meta, [{
	sheetplacements: [placement(1, 0, 0), placement(2, 4, 0)]
}], ClipperLib);
assert.strictEqual(overlapping.legal, false, 'positive-area overlap must fail');
assert.strictEqual(overlapping.overlapCount, 1);
assert(overlapping.maxIntersectionArea > 4.99);
assert(overlapping.maxPenetrationDepth > 0.99);

const tinyDeepMeta = JSON.parse(JSON.stringify(meta));
tinyDeepMeta.sourceMap['2'].polygon = [
	{x: 0, y: 0},
	{x: 0.0005, y: 0},
	{x: 0.0005, y: 0.0005},
	{x: 0, y: 0.0005}
];
const tinyButDeep = esicup.legalityFromPlacements(tinyDeepMeta, [{
	sheetplacements: [placement(1, 0, 0), placement(2, 1, 1)]
}], ClipperLib);
assert.strictEqual(
	tinyButDeep.legal,
	false,
	'small-area overlap deeper than the linear tolerance must still fail'
);
assert(tinyButDeep.maxIntersectionArea < 1e-6);
assert(tinyButDeep.maxPenetrationDepth > tinyButDeep.penetrationTolerance);

const outside = esicup.legalityFromPlacements(meta, [{
	sheetplacements: [placement(1, -0.1, 0), placement(2, 5, 0)]
}], ClipperLib);
assert.strictEqual(outside.legal, false, 'sheet-boundary escape must fail');
assert.strictEqual(outside.withinSheetBounds, false);

console.log('benchmark legality tests passed');

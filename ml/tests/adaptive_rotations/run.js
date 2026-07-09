'use strict';

const assert = require('assert');
const RotationUtil = require('../../../main/util/rotationutil');

function rectangle(width, height) {
	return [
		{x: 0, y: 0},
		{x: width, y: 0},
		{x: width, y: height},
		{x: 0, y: height}
	];
}

function rounded(angles) {
	return angles.map((angle) => Math.round(angle * 1e6) / 1e6);
}

const baseConfig = {
	rotations: 4,
	adaptiveRotations: true,
	adaptiveRotationMaxAngles: 6,
	adaptiveRotationMinAspectRatio: 1.35,
	mergeLines: false
};

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(10, 2), Object.assign({}, baseConfig, {adaptiveRotations: false}))),
	[0, 90, 180, 270],
	'disabled adaptive rotations must preserve the uniform grid'
);

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(10, 2), baseConfig)),
	[0, 90, 45, 135],
	'a half-turn-symmetric horizontal part should use both diagonal axes without duplicate reversals'
);

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(2, 10), baseConfig)),
	[0, 90, 135, 45],
	'a half-turn-symmetric vertical part should derive both diagonal axes from its principal axis'
);

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(10, 10), baseConfig)),
	[0, 90],
	'near-isotropic symmetric parts should keep only distinct cardinal orientations'
);

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(10, 2), Object.assign({}, baseConfig, {mergeLines: true}))),
	[0, 90, 180, 270],
	'common-line mode must retain the canonical grid'
);

const slotted = rectangle(10, 2);
slotted.children = [rectangle(1, 0.5)];
assert.strictEqual(RotationUtil.hasHalfTurnSymmetry(slotted, {processHoles: true}), false, 'hole-aware symmetry should fail conservative for child-bearing parts');
assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(slotted, Object.assign({}, baseConfig, {processHoles: true}))),
	[0, 90, 180, 270, 45, 225],
	'hole-aware parts should retain directional reversals'
);
assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(slotted, Object.assign({}, baseConfig, {processHoles: false}))),
	[0, 90, 45, 135],
	'ignored holes should allow outer-contour half-turn symmetry and both diagonal axes'
);

const unevenSymmetricBoundary = rectangle(10, 2);
unevenSymmetricBoundary.splice(1, 0, {x: 7, y: 0});
assert.strictEqual(
	RotationUtil.hasHalfTurnSymmetry(unevenSymmetricBoundary, {processHoles: false, curveTolerance: 0.01}),
	true,
	'symmetry detection should tolerate unequal curve tessellation when the rotated point lies on the opposite boundary'
);

const adaptiveAngles = RotationUtil.allowedAngles(rectangle(10, 2), baseConfig);
assert.strictEqual(
	RotationUtil.chooseAlignedAngle(adaptiveAngles, [45, 45, 0], () => 0.1, 0.7),
	45,
	'sibling alignment bias should select the source-family dominant angle'
);

let randomValues = [0.9, 0.9];
assert.strictEqual(
	RotationUtil.chooseAlignedAngle(adaptiveAngles, [45, 45, 0], () => randomValues.shift(), 0.7),
	135,
	'the exploration branch should still reach non-dominant allowed angles'
);

console.log('adaptive rotation tests passed');

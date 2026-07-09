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
	[0, 90, 180, 270, 45, 225],
	'a horizontal elongated part should gain one diagonal axis and its reverse'
);

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(2, 10), baseConfig)),
	[0, 90, 180, 270, 315, 135],
	'a vertical elongated part should derive its diagonal from the principal axis'
);

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(10, 10), baseConfig)),
	[0, 90, 180, 270],
	'near-isotropic parts should not pay for redundant diagonal NFP variants'
);

assert.deepStrictEqual(
	rounded(RotationUtil.allowedAngles(rectangle(10, 2), Object.assign({}, baseConfig, {mergeLines: true}))),
	[0, 90, 180, 270],
	'common-line mode must retain the canonical grid'
);

const adaptiveAngles = RotationUtil.allowedAngles(rectangle(10, 2), baseConfig);
assert.strictEqual(
	RotationUtil.chooseAlignedAngle(adaptiveAngles, [45, 45, 0], () => 0.1, 0.7),
	45,
	'sibling alignment bias should select the source-family dominant angle'
);

let randomValues = [0.9, 0.5];
assert.strictEqual(
	RotationUtil.chooseAlignedAngle(adaptiveAngles, [45, 45, 0], () => randomValues.shift(), 0.7),
	270,
	'the exploration branch should still reach non-dominant allowed angles'
);

console.log('adaptive rotation tests passed');

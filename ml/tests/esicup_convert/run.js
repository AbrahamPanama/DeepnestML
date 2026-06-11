'use strict';

const assert = require('assert');
const path = require('path');

const convert = require(path.join(__dirname, '..', '..', 'lib', 'esicup-convert'));

function assertClose(actual, expected, tolerance, message) {
	assert.ok(Math.abs(actual - expected) <= tolerance, message + ' expected ' + expected + ' got ' + actual);
}

const instance = {
	name: 'two-item-test',
	strip_height: 10,
	items: [
		{
			id: 7,
			demand: 2,
			allowed_orientations: [0, 180],
			shape: {
				type: 'simple_polygon',
				data: [
					[0, 0],
					[4, 0],
					[4, 2],
					[0, 2],
					[0, 0]
				]
			}
		},
		{
			id: 8,
			demand: 1,
			allowed_orientations: [0, 90, 180, 270],
			shape: {
				type: 'polygon',
				data: {
					outer: [
						[0, 0],
						[5, 0],
						[5, 5],
						[0, 5],
						[0, 0]
					],
					inner: [[
						[1, 1],
						[2, 1],
						[2, 2],
						[1, 2],
						[1, 1]
					]]
				}
			}
		}
	]
};

const result = convert.instanceToSvg(instance, {
	margin: 1,
	stripLengthEstimate: 20,
	layoutMaxWidth: 50
});

assert.ok(result.svgText.indexOf('<rect id="sheet"') >= 0, 'sheet rect should be first-class SVG geometry');
assert.ok(result.svgText.indexOf('fill-rule="evenodd"') >= 0, 'hole-bearing paths should use even-odd fill rule');
assert.strictEqual(result.meta.name, 'two-item-test');
assert.strictEqual(result.meta.totalDemand, 3);
assertClose(result.meta.totalTrueArea, 40, 1e-9, 'total material area should preserve outer-minus-hole area');
assert.strictEqual(result.meta.items[0].rotations, 2, 'orientation list [0,180] should map to two rotations');
assert.strictEqual(result.meta.items[1].rotations, 4, 'orientation list [0,90,180,270] should map to four rotations');
assert.strictEqual(result.meta.sourceOrder.length, 3, 'demand should expand into per-copy SVG sources');
assert.strictEqual(result.meta.sourceMap['1'].itemId, 7);
assert.strictEqual(result.meta.sourceMap['2'].copyIndex, 1);
assert.strictEqual(result.meta.sourceMap['3'].itemId, 8);
assertClose(result.meta.sourceMap['3'].trueArea, 24, 1e-9, 'hole-bearing item true area should be preserved');

const firstPolygon = result.meta.sourceMap['1'].polygon;
const secondPolygon = result.meta.sourceMap['2'].polygon;
const thirdPolygon = result.meta.sourceMap['3'].polygon;
const placements = [{
	sheet: 0,
	sheetplacements: [
		{ source: 1, x: -firstPolygon[0].x, y: -firstPolygon[0].y, rotation: 0 },
		{ source: 2, x: 5 - secondPolygon[0].x, y: -secondPolygon[0].y, rotation: 0 },
		{ source: 3, x: 10 - thirdPolygon[0].x, y: -thirdPolygon[0].y, rotation: 0 }
	]
}];

const utilization = convert.utilizationFromPlacements(result.meta, placements);
assertClose(utilization.usedLength, 15, 1e-9, 'used length should be measured from sheet min x to placed polygon max x');
assertClose(utilization.utilization, 40 / 150, 1e-9, 'utilization should be material area over used strip area');

console.log('esicup converter tests passed');

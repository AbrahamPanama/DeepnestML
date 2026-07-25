'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var backgroundPath = path.join(__dirname, '..', '..', '..', 'main', 'background.js');
var source = fs.readFileSync(backgroundPath, 'utf8');

function extract(from, to){
	var start = source.indexOf(from);
	var end = source.indexOf(to, start);
	assert(start >= 0 && end > start, 'expected source block: ' + from);
	return source.slice(start, end);
}

var context = {
	Math: Math,
	parseInt: parseInt,
	localRefinementWorldBounds: function(part, placement){
		return {
			x: part.x + placement.x,
			y: part.y + placement.y,
			width: part.width,
			height: part.height
		};
	},
	localRefinementHasChildren: function(part){
		return !!(part && part.children && part.children.length);
	}
};
vm.runInNewContext(
	extract('function localRefinementWindowSize', '\nfunction localRefinementWindowPartContact') +
	extract('function localRefinementWindowIndices', '\nfunction localRefinementWindowSignature') +
	extract('function localRefinementWindowSignature', '\nfunction localRefinementWindowAngles'),
	context
);

assert.strictEqual(context.localRefinementWindowSize(100, {v4WindowSize: 5}), 5);
assert.strictEqual(context.localRefinementWindowSize(100, {v4WindowSize: 99}), 8);
assert.strictEqual(context.localRefinementWindowSize(4, {v4WindowSize: 4}), 4);

var placed = [
	{x: 0, y: 0, width: 2, height: 2},
	{x: 3, y: 0, width: 2, height: 2},
	{x: 8, y: 0, width: 2, height: 2},
	{x: 0, y: 5, width: 2, height: 2},
	{x: 20, y: 20, width: 2, height: 2}
];
var placements = placed.map(function(){ return {x: 0, y: 0}; });
var indices = context.localRefinementWindowIndices(
	placed,
	placements,
	{v4WindowSize: 4},
	0
);
assert.deepStrictEqual(Array.prototype.slice.call(indices), [0, 1, 3, 2]);
assert.strictEqual(context.localRefinementWindowSignature([3, 1, 4, 2]), '1,2,3,4');

assert(
	source.indexOf('config.v4WindowedRebuild === true && placed.length > 6') >= 0,
	'windowed rebuild must run on production-size sheets'
);
assert(
	source.indexOf('placed.length >= 4 && placed.length <= 6') >= 0,
	'windowed rebuild must preserve the proven small-cluster beam path'
);
assert(
	source.indexOf('localRefinementBuildStandaloneFeasibleRegion') >= 0,
	'windowed rebuild must use the standalone IFP-minus-NFP region builder'
);

console.log('refinement window tests passed');

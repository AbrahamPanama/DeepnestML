'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var backgroundPath = path.join(__dirname, '..', '..', '..', 'main', 'background.js');
var source = fs.readFileSync(backgroundPath, 'utf8');
var indexSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'main', 'index.html'), 'utf8');
var deepnestSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'main', 'deepnest.js'), 'utf8');

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
	extract('function localRefinementWindowSignature', '\nfunction localRefinementWindowCandidates'),
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

var clock = 0;
var rebuildCalls = [];
var rollingWindows = {
	0: [0, 1, 2, 3, 4],
	1: [0, 1, 2, 3, 4],
	2: [2, 3, 4, 5, 6],
	3: [3, 4, 5, 6, 7],
	4: [4, 5, 6, 7, 8],
	5: [5, 6, 7, 8, 9]
};
var schedulerContext = {
	Math: Math,
	Number: Number,
	Object: Object,
	Date: {
		now: function(){ return clock; }
	},
	localRefinementRectangleSheet: function(){ return true; },
	localRefinementWindowSeedOrder: function(){ return [0, 1, 2, 3, 4, 5]; },
	localRefinementWindowIndices: function(unusedPlaced, unusedPlacements, unusedConfig, seed){
		return rollingWindows[seed].slice();
	},
	localRefinementWindowSignature: context.localRefinementWindowSignature,
	localRefinementTryWindowRebuild: function(
		unusedSheet,
		unusedPlaced,
		unusedPlacements,
		unusedConfig,
		windowIndices,
		currentMetric,
		windowDeadline,
		unusedStats,
		preserveNeighbours
	){
		rebuildCalls.push({
			indices: windowIndices.slice(),
			deadline: windowDeadline,
			preserveNeighbours: preserveNeighbours
		});
		clock += 10;
		return {moved: true, metric: currentMetric - 1};
	}
};
vm.runInNewContext(
	extract('function localRefinementWindowCandidates', '\nfunction localRefinementWindowAngles') +
	extract('function localRefinementRunWindowedRebuild', '\nfunction localRefinementTryWholeClusterRebuild'),
	schedulerContext
);

assert.strictEqual(schedulerContext.localRefinementWindowSliceMs(8000, 8), 1000);
assert.strictEqual(schedulerContext.localRefinementWindowSliceMs(500, 8), 400);
assert.strictEqual(schedulerContext.localRefinementWindowSliceMs(100, 8), 100);

var rollingPlaced = Array.from({length: 10}, function(){ return {}; });
var rollingPlacements = Array.from({length: 10}, function(){ return {}; });
var rollingStats = {};
var rollingResult = schedulerContext.localRefinementRunWindowedRebuild(
	{},
	rollingPlaced,
	rollingPlacements,
	{v4WindowedRebuild: true},
	10,
	8000,
	rollingStats
);
assert.strictEqual(rollingResult.moved, true);
assert.strictEqual(rollingResult.metric, 5);
assert.strictEqual(rebuildCalls.length, 5, 'rolling refinement must continue after successful windows');
assert.strictEqual(rollingStats.windowedRebuildWindowsVisited, 5);
assert.strictEqual(rollingStats.windowedRebuildPartsCovered, 10);
assert.strictEqual(rollingStats.windowedRebuildEligibleParts, 10);
assert.strictEqual(rollingStats.windowedRebuildBudgetExhausted, undefined);

clock = 0;
var fallbackDeadlines = [];
schedulerContext.localRefinementTryWindowRebuild = function(
	unusedSheet,
	unusedPlaced,
	unusedPlacements,
	unusedConfig,
	unusedWindowIndices,
	currentMetric,
	windowDeadline,
	unusedStats,
	preserveNeighbours
){
	fallbackDeadlines.push({deadline: windowDeadline, preserveNeighbours: preserveNeighbours});
	clock += 10;
	return {moved: preserveNeighbours !== true, metric: currentMetric - 1};
};
schedulerContext.localRefinementRunWindowedRebuild(
	{},
	rollingPlaced,
	rollingPlacements,
	{v4WindowedRebuild: true},
	10,
	8000,
	{}
);
assert(
	fallbackDeadlines.some(function(call){ return call.preserveNeighbours === false && call.deadline < 8000; }),
	'a failed preserve-neighbours attempt must not donate the whole remaining stage budget to one window'
);

var callsBeforeDisabled = fallbackDeadlines.length;
var disabledResult = schedulerContext.localRefinementRunWindowedRebuild(
	{},
	rollingPlaced,
	rollingPlacements,
	{v4WindowedRebuild: false},
	10,
	8000,
	{}
);
assert.strictEqual(disabledResult.moved, false);
assert.strictEqual(fallbackDeadlines.length, callsBeforeDisabled);

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
assert(
	indexSource.indexOf('v4WindowedRebuild: false') >= 0 &&
	deepnestSource.indexOf('v4WindowedRebuild: false') >= 0,
	'rolling large-layout refinement must remain default-off'
);
assert(
	indexSource.indexOf('Large-layout rolling refinement') >= 0,
	'settings must expose the opt-in behavior clearly'
);
assert(
	indexSource.indexOf("parts scanned") >= 0,
	'the refinement badge must expose rolling layout coverage'
);

console.log('refinement window tests passed');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ContinuousRefinement = require('../../../main/util/continuousrefinement');
const ConfigCompatibility = require('../../../main/util/configcompatibility');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function functionSource(source, name){
	const start = source.indexOf('function ' + name);
	assert.ok(start >= 0, 'missing function ' + name);
	const open = source.indexOf('{', start);
	let depth = 0;
	for(let i=open; i<source.length; i++){
		if(source[i] === '{') depth++;
		if(source[i] === '}'){
			depth--;
			if(depth === 0) return source.slice(start, i + 1);
		}
	}
	throw new Error('unterminated function ' + name);
}

function testSweepAngles(){
	const seen = {};
	const angles = ContinuousRefinement.sweepAngles(0, 10, 5, seen);
	assert.deepStrictEqual(angles, [0, 355, 5, 350, 10], 'coarse sweep should be center-first and symmetric');
	const refined = ContinuousRefinement.sweepAngles(5, 2, 1, seen);
	assert.deepStrictEqual(refined, [4, 6, 3, 7], 'refinement sweep should omit angles already evaluated');
}

function testBestResultsKeepsDistinctBasins(){
	const selected = ContinuousRefinement.bestResults([
		{angle: 0, score: 0.5, ordinal: 0},
		{angle: 1, score: 0.4, ordinal: 1},
		{angle: 2, score: 0.3, ordinal: 2},
		{angle: 20, score: 0.35, ordinal: 3}
	], 2, 5);
	assert.deepStrictEqual(selected.map((entry) => entry.angle), [2, 20], 'ranking should retain separate angular basins');
}

function testPostScoreRewardsCompactness(){
	const open = ContinuousRefinement.postScore({box: 0.4, hull: 0.35, span: 0.3});
	const compact = ContinuousRefinement.postScore({box: 0.3, hull: 0.2, span: 0.25});
	assert.ok(compact < open, 'post score should reward smaller envelope and hull');
	assert.strictEqual(ContinuousRefinement.improves(compact, open), true, 'substantive compactness gain should improve');
	assert.strictEqual(ContinuousRefinement.improves(open * 0.99999, open), false, 'epsilon-scale noise should not improve');
}

function testConstructionAndRefinementStaySeparate(){
	const deepnest = fs.readFileSync(path.join(ROOT, 'main', 'deepnest.js'), 'utf8');
	const index = fs.readFileSync(path.join(ROOT, 'main', 'index.html'), 'utf8');
	const background = fs.readFileSync(path.join(ROOT, 'main', 'background.js'), 'utf8');
	assert.match(deepnest, /rotations:\s*4[\s\S]*?adaptiveRotations:\s*false/, 'product defaults should retain four cardinal construction angles');
	assert.match(index, /baseConfig\.adaptiveRotations\s*=\s*false/, 'interactive nests should disable placement-side adaptive angles');
	assert.match(index, /baseConfig\.rotations\s*=\s*4/, 'interactive nests should freeze four construction rotations');
	const smart = functionSource(background, 'refineSmartPlacements');
	assert.ok(!smart.includes('localRefinementTryPairCompaction('), 'Smart should not stack the retired pair compactor');
	assert.ok(!smart.includes('localRefinementRunRotationReflowStage('), 'Smart should not stack canonical reflow');
	assert.ok(!smart.includes('localRefinementRunFineRotationStage('), 'Smart should not stack the old fine-rotation pass');
	assert.ok(smart.includes('localRefinementRunContinuousStage('), 'Smart should run the unified continuous stage');
}

function testConfiguredAngleWindowIsEnforced(){
	const seen = {};
	const base = 0;
	const maxDelta = 45;
	const coarse = ContinuousRefinement.sweepAngles(base, maxDelta, 5, seen);
	const edgeRefinement = ContinuousRefinement.sweepAngles(315, 5, 1, seen);
	const bounded = coarse.concat(edgeRefinement).filter((angle) => ContinuousRefinement.angularDistance(base, angle) <= maxDelta + 1e-9);
	assert.ok(bounded.every((angle) => ContinuousRefinement.angularDistance(base, angle) <= 45), 'refinement candidates must stay inside the configured angle window');
	assert.ok(!bounded.includes(314), 'nested refinement must not drift outside the window');
}

function testCriticalTargetsReceiveNearestAnchors(){
	const background = fs.readFileSync(path.join(ROOT, 'main', 'background.js'), 'utf8');
	const context = {
		localRefinementWorldBounds: (part) => part.bounds,
		localRefinementSmartTargetOrder: (placed, placements, config) => config.order.slice(),
		sqr: (value) => value * value
	};
	vm.createContext(context);
	vm.runInContext(
		functionSource(background, 'localRefinementContinuousNearestAnchor') + '\n' +
		functionSource(background, 'localRefinementContinuousTargetTasks'),
		context
	);
	const placed = [
		{bounds: {x: 0, y: 0, width: 2, height: 2}},
		{bounds: {x: 3, y: 0, width: 2, height: 2}},
		{bounds: {x: 10, y: 0, width: 2, height: 2}},
		{bounds: {x: 10, y: 5, width: 2, height: 2}}
	];
	const tasks = context.localRefinementContinuousTargetTasks(placed, [{}, {}, {}, {}], {order: [3, 0, 2, 1]}, 3);
	assert.deepStrictEqual(
		JSON.parse(JSON.stringify(tasks)),
		[
			{anchor: 2, target: 3},
			{anchor: 1, target: 0},
			{anchor: 3, target: 2}
		],
		'every selected critical target should receive its nearest deterministic anchor'
	);
	assert.strictEqual(new Set(tasks.map((task) => task.target)).size, 3, 'critical targets should not be duplicated');
	const pairTasks = context.localRefinementContinuousTargetTasks(placed.slice(0, 2), [{}, {}], {order: [0, 1]}, 8);
	assert.deepStrictEqual(
		JSON.parse(JSON.stringify(pairTasks)),
		[{anchor: 1, target: 0}, {anchor: 0, target: 1}],
		'two-part jobs should retain both directed refinement tasks'
	);
}

function testContinuousCompactionCompatibilityGate(){
	const inactive = {
		localRefinementContinuous: false,
		localRefinement: false,
		localRefinementEngine: 'slide',
		processHoles: true,
		mergeLines: true
	};
	ConfigCompatibility.applyContinuousCompaction(inactive);
	assert.deepStrictEqual(
		inactive,
		{
			localRefinementContinuous: false,
			localRefinement: false,
			localRefinementEngine: 'slide',
			processHoles: true,
			mergeLines: true
		},
		'disabling Continuous compaction should leave independent settings editable'
	);

	const active = {
		localRefinementContinuous: true,
		localRefinement: false,
		localRefinementEngine: 'shrinkSeparate',
		processHoles: true,
		mergeLines: true
	};
	ConfigCompatibility.applyContinuousCompaction(active);
	assert.strictEqual(active.localRefinement, true, 'Continuous compaction should enable its parent refinement pass');
	assert.strictEqual(active.localRefinementEngine, 'smart', 'Continuous compaction should select the Smart engine');
	assert.strictEqual(active.processHoles, false, 'Continuous compaction should disable processed-hole nesting');
	assert.strictEqual(active.mergeLines, false, 'Continuous compaction should disable common-line merging');
	const inactiveParent = {
		localRefinementContinuous: true,
		localRefinement: false,
		localRefinementEngine: 'slide',
		processHoles: true,
		mergeLines: true
	};
	ConfigCompatibility.applyActiveContinuousCompaction(inactiveParent);
	assert.strictEqual(inactiveParent.localRefinementEngine, 'slide', 'runtime normalization should preserve explicitly disabled refinement jobs');

	const rules = ConfigCompatibility.rulesForContinuousCompaction();
	assert.deepStrictEqual(
		rules.map((rule) => rule.key),
		['localRefinement', 'localRefinementEngine', 'processHoles', 'mergeLines'],
		'the UI should disable every runtime-incompatible setting'
	);
	assert.ok(rules.every((rule) => rule.reason && rule.reason.length > 20), 'every disabled setting should explain why it is unavailable');

	const index = fs.readFileSync(path.join(ROOT, 'main', 'index.html'), 'utf8');
	const deepnest = fs.readFileSync(path.join(ROOT, 'main', 'deepnest.js'), 'utf8');
	assert.match(index, /ConfigCompatibility\.rulesForContinuousCompaction\(\)/, 'settings UI should use the shared compatibility rules');
	assert.match(index, /classList\.toggle\('config-incompatible', active\)/, 'settings UI should expose the disabled state');
	assert.match(deepnest, /ConfigCompatibility\.applyActiveContinuousCompaction\(config\)/, 'engine config should enforce the same compatibility gate for active refinement jobs');
}

function testWholeClusterRebuildStaysBoundedAndExact(){
	const background = fs.readFileSync(path.join(ROOT, 'main', 'background.js'), 'utf8');
	const rebuild = functionSource(background, 'localRefinementTryWholeClusterRebuild');
	const stage = functionSource(background, 'localRefinementRunContinuousStage');
	assert.ok(rebuild.includes('placed.length < 4 || placed.length > 6'), 'whole-cluster rebuild should remain limited to small sheets');
	assert.ok(rebuild.includes('localRefinementWholeClusterSelectBeam'), 'whole-cluster rebuild should keep a bounded beam');
	assert.ok(rebuild.includes('localRefinementFinalLayoutLegalExact'), 'whole-cluster acceptance should use the full-resolution legality gate');
	assert.ok(!rebuild.includes('getOuterNfp('), 'arbitrary-angle rebuilds should not populate the persistent NFP cache');
	assert.ok(stage.includes('localRefinementTryWholeClusterRebuild'), 'continuous compaction should run the whole-cluster operator before pair exploitation');
	assert.match(background, /placed\.length >= 4 && placed\.length <= 6[\s\S]*?Math\.floor\(budget \* 0\.5\)/, 'four-to-six-part sheets should receive half of the visible refinement budget');
}

testSweepAngles();
testBestResultsKeepsDistinctBasins();
testPostScoreRewardsCompactness();
testConstructionAndRefinementStaySeparate();
testConfiguredAngleWindowIsEnforced();
testCriticalTargetsReceiveNearestAnchors();
testContinuousCompactionCompatibilityGate();
testWholeClusterRebuildStaysBoundedAndExact();
console.log('continuous refinement tests passed');

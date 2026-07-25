'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var backgroundPath = path.join(__dirname, '..', '..', '..', 'main', 'background.js');
var source = fs.readFileSync(backgroundPath, 'utf8');
var start = source.indexOf('function localRefinementScaledTargetLimit');
var end = source.indexOf('\nfunction localRefinementQuantizedRotation', start);
assert(start >= 0 && end > start, 'scaled target helper must exist in background.js');

var context = {};
vm.runInNewContext(source.slice(start, end), context);
var targetLimit = context.localRefinementScaledTargetLimit;
assert.strictEqual(typeof targetLimit, 'function');

assert.strictEqual(targetLimit(100, 6, {}), 6, 'flag-off relocate coverage must remain legacy');
assert.strictEqual(targetLimit(3, 6, {}), 3, 'legacy coverage must clamp to the part count');
assert.strictEqual(targetLimit(100, 6, {
	v4ScaledCoverage: true,
	v4TargetFraction: 0.25,
	v4MinTargets: 6,
	v4MaxTargets: 64
}), 25);
assert.strictEqual(targetLimit(12, 6, {
	v4ScaledCoverage: true,
	v4TargetFraction: 0.25,
	v4MinTargets: 6,
	v4MaxTargets: 64
}), 6, 'scaled coverage must honor its minimum');
assert.strictEqual(targetLimit(400, 6, {
	v4ScaledCoverage: true,
	v4TargetFraction: 0.25,
	v4MinTargets: 6,
	v4MaxTargets: 64
}), 64, 'scaled coverage must honor its maximum');
assert.strictEqual(targetLimit(4, 6, {
	v4ScaledCoverage: true,
	v4TargetFraction: 0.25,
	v4MinTargets: 6,
	v4MaxTargets: 64
}), 4, 'scaled coverage must never exceed available parts');

assert(
	source.indexOf("config.v4ScaledCoverage !== true || config.v4EnableSwap === true") >= 0,
	'swap must remain legacy when coverage is off and require v4EnableSwap when it is on'
);

console.log('refinement coverage tests passed');

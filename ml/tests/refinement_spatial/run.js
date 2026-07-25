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
	isFinite: isFinite,
	localRefinementWorldBounds: function(part, placement){
		return {
			x: part.x + placement.x,
			y: part.y + placement.y,
			width: part.width,
			height: part.height
		};
	}
};
vm.runInNewContext(
	extract('function localRefinementSpatialCellKey', '\nfunction localRefinementSetSpatialIndex') +
	extract('function localRefinementSpatialQuery', '\nfunction localRefinementPartBboxArea'),
	context
);

var state = 0x4f1bbcdc;
function random(){
	state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
	return state / 4294967296;
}

function overlaps(left, right, inflate){
	return !(left.x + left.width < right.x - inflate ||
		right.x + right.width < left.x - inflate ||
		left.y + left.height < right.y - inflate ||
		right.y + right.height < left.y - inflate);
}

for(var trial=0; trial<500; trial++){
	var count = 1 + Math.floor(random() * 120);
	var parts = [];
	var placements = [];
	for(var i=0; i<count; i++){
		parts.push({
			x: -5 * random(),
			y: -5 * random(),
			width: 0.1 + 20 * random(),
			height: 0.1 + 20 * random()
		});
		placements.push({
			x: -100 + 200 * random(),
			y: -100 + 200 * random()
		});
	}
	var index = context.localRefinementCreateSpatialIndex(parts, placements, {curveTolerance: 0.005});
	assert(index, 'non-empty layouts must produce a spatial index');
	var query = {
		x: -100 + 200 * random(),
		y: -100 + 200 * random(),
		width: 0.1 + 30 * random(),
		height: 0.1 + 30 * random()
	};
	var inflate = 3 * random();
	var actual = context.localRefinementSpatialQuery(index, query, inflate);
	for(i=1; i<actual.length; i++){
		assert(actual[i - 1] < actual[i], 'query candidates must be unique and sorted');
	}
	for(i=0; i<count; i++){
		var bounds = context.localRefinementWorldBounds(parts[i], placements[i]);
		if(overlaps(query, bounds, inflate)){
			assert(actual.indexOf(i) >= 0, 'spatial query must not miss a bbox overlap');
		}
	}
}

console.log('refinement spatial tests passed');

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const background = fs.readFileSync(path.join(ROOT, 'main', 'background.js'), 'utf8');

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

function polygonArea(points){
	let area = 0;
	for(let i=0; i<points.length; i++){
		const next = (i + 1) % points.length;
		area += points[i].x * points[next].y - points[next].x * points[i].y;
	}
	return area / 2;
}

function polygonBounds(points){
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	return {
		x: Math.min(...xs),
		y: Math.min(...ys),
		width: Math.max(...xs) - Math.min(...xs),
		height: Math.max(...ys) - Math.min(...ys)
	};
}

function convexHull(points){
	if(points.length < 3) return points.slice();
	const sorted = points.map((point) => ({x: point.x, y: point.y})).sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	const lower = [];
	for(const point of sorted){
		while(lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
		lower.push(point);
	}
	const upper = [];
	for(let i=sorted.length - 1; i>=0; i--){
		const point = sorted[i];
		while(upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
		upper.push(point);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

const context = {
	GeometryUtil: {
		getPolygonBounds: polygonBounds,
		polygonArea
	},
	getHull: convexHull
};
vm.createContext(context);
vm.runInContext([
	'collectWorldPoints',
	'calculateFitnessV2SheetMetric',
	'localRefinementWorldBounds',
	'localRefinementPartLocalBounds',
	'localRefinementPartHull',
	'localRefinementIncrementalMetric'
].map((name) => functionSource(background, name)).join('\n'), context);

function mulberry32(seed){
	return function(){
		seed |= 0;
		seed = seed + 0x6D2B79F5 | 0;
		let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	};
}

function randomPart(rng){
	const count = 3 + Math.floor(rng() * 10);
	const points = [];
	for(let i=0; i<count; i++){
		const angle = 2 * Math.PI * i / count;
		const radius = 1 + 9 * rng();
		points.push({x: radius * Math.cos(angle), y: radius * Math.sin(angle)});
	}
	return points;
}

function assertMetricClose(actual, expected, message){
	assert.ok(actual && expected, message + ' should produce both metrics');
	assert.ok(
		Math.abs(actual.metric - expected.metric) <= 1e-12,
		message + ' expected ' + expected.metric + ' got ' + actual.metric
	);
}

function run(){
	const rng = mulberry32(918273);
	const sheet = [
		{x: 0, y: 0},
		{x: 500, y: 0},
		{x: 500, y: 300},
		{x: 0, y: 300}
	];
	const modes = ['gravity', 'box', 'convexhull'];
	for(let sample=0; sample<1000; sample++){
		const count = 2 + Math.floor(rng() * 20);
		const placed = [];
		const placements = [];
		for(let i=0; i<count; i++){
			placed.push(randomPart(rng));
			placements.push({x: 10 + 470 * rng(), y: 10 + 270 * rng()});
		}
		for(const mode of modes){
			const legacy = context.calculateFitnessV2SheetMetric(sheet, placed, placements, mode);
			const incremental = context.localRefinementIncrementalMetric(
				sheet,
				placed,
				placements,
				{placementType: mode}
			);
			assertMetricClose(incremental, legacy, mode + ' sample ' + sample);
		}
	}
	console.log('refinement scoring tests passed');
}

run();

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RefinementContact = require('../../../main/util/refinement-contact');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function rectangle(x, y, width, height){
	return [
		{x, y},
		{x: x + width, y},
		{x: x + width, y: y + height},
		{x, y: y + height}
	];
}

function testPointSegmentDistance(){
	assert.strictEqual(
		RefinementContact.pointSegmentDistanceSquared({x: 2, y: 3}, {x: 0, y: 0}, {x: 4, y: 0}),
		9,
		'point-to-segment distance should project onto the segment'
	);
	assert.strictEqual(
		RefinementContact.pointSegmentDistanceSquared({x: -1, y: 0}, {x: 0, y: 0}, {x: 4, y: 0}),
		1,
		'point-to-segment distance should clamp to an endpoint'
	);
}

function testContactRewardsSharedBoundary(){
	const subject = rectangle(0, 0, 10, 10);
	const touching = rectangle(10, 0, 10, 10);
	const distant = rectangle(30, 0, 10, 10);
	const opts = {curveTolerance: 0.1, spacing: 0};
	const touchingScore = RefinementContact.contactScore(subject, [touching], null, opts);
	const distantScore = RefinementContact.contactScore(subject, [distant], null, opts);
	assert.ok(touchingScore.samples >= 64, 'fixed arc-length sampling should cover the full boundary');
	assert.ok(touchingScore.length > 8, 'a shared ten-unit edge should produce substantial contact');
	assert.strictEqual(distantScore.length, 0, 'a distant neighbour should not create contact');
}

function testSheetBoundaryCountsAsContact(){
	const subject = rectangle(0, 0, 10, 10);
	const sheet = rectangle(0, 0, 100, 100);
	const result = RefinementContact.contactScore(subject, [], sheet, {curveTolerance: 0.1, spacing: 0});
	assert.ok(result.length > 16, 'two subject edges on the sheet boundary should count as contact');
}

function testDetailedPathsStayBounded(){
	const subject = [];
	for(let i=0; i<10000; i++){
		subject.push({x: i / 1000, y: 0});
	}
	subject.push({x: 10, y: 1}, {x: 0, y: 1});
	const neighbour = [
		{x: 0, y: -0.001},
		{x: 10, y: -0.001},
		{x: 10, y: -1},
		{x: 0, y: -1}
	];
	const result = RefinementContact.contactScore(
		subject,
		[neighbour],
		null,
		{curveTolerance: 0.01, spacing: 0}
	);
	assert.ok(result.samples < 1000, 'arc-length sampling must not scale with tiny SVG edge count');
	assert.ok(result.length > 0, 'segment indexing must preserve nearby contact detection');
}

function testLexicographicAcceptance(){
	assert.strictEqual(
		RefinementContact.acceptanceDecision(1, 0.99, 10, 1),
		'primary',
		'a primary improvement should dominate contact loss'
	);
	assert.strictEqual(
		RefinementContact.acceptanceDecision(1, 1 + 5e-7, 10, 11),
		'plateau',
		'a contact improvement should unlock a primary plateau'
	);
	assert.strictEqual(
		RefinementContact.acceptanceDecision(1, 1.0001, 10, 20),
		'reject',
		'contact must never override a substantive primary regression'
	);
	assert.strictEqual(
		RefinementContact.acceptanceDecision(1, 1, 10, 10.005),
		'reject',
		'epsilon-scale contact noise should not be accepted'
	);
}

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

function testPlateauVisitGuard(){
	const background = fs.readFileSync(path.join(ROOT, 'main', 'background.js'), 'utf8');
	const names = [
		'localRefinementUsesContactAcceptance',
		'localRefinementAcceptanceMovedIndices',
		'localRefinementAcceptanceNeighbourMap',
		'localRefinementContactForMoved',
		'localRefinementAcceptanceSignature',
		'localRefinementEnsureAcceptanceContext',
		'localRefinementAcceptanceCandidate',
		'localRefinementRecordAcceptance'
	];
	const bounds = (ring) => {
		const xs = ring.map((point) => point.x);
		const ys = ring.map((point) => point.y);
		return {
			x: Math.min(...xs),
			y: Math.min(...ys),
			width: Math.max(...xs) - Math.min(...xs),
			height: Math.max(...ys) - Math.min(...ys)
		};
	};
	const context = {
		RefinementContact,
		localRefinementWorldBounds(part, placement){
			const value = bounds(part);
			return {x: value.x + placement.x, y: value.y + placement.y, width: value.width, height: value.height};
		},
		localRefinementBboxDiagonal(part){
			const value = bounds(part);
			return Math.sqrt(value.width * value.width + value.height * value.height);
		},
		localRefinementBoundsOverlap(a, b, padding){
			return a.x <= b.x + b.width + padding &&
				a.x + a.width + padding >= b.x &&
				a.y <= b.y + b.height + padding &&
				a.y + a.height + padding >= b.y;
		},
		shiftPolygon(part, placement){
			return part.map((point) => ({x: point.x + placement.x, y: point.y + placement.y}));
		},
		normalizedRotation(value){
			value = (Number(value) || 0) % 360;
			return value < 0 ? value + 360 : value;
		}
	};
	vm.createContext(context);
	vm.runInContext(names.map((name) => functionSource(background, name)).join('\n'), context);

	const part = rectangle(0, 0, 10, 10);
	const placed = [part, part];
	const before = [{x: 20, y: 20, rotation: 0}, {x: 40, y: 20, rotation: 0}];
	const after = [{x: 30, y: 20, rotation: 0}, {x: 40, y: 20, rotation: 0}];
	const config = {
		localRefinementContactAcceptance: true,
		curveTolerance: 0.1,
		spacing: 0,
		v4AcceptEpsPrimary: 1e-6,
		v4AcceptEpsContact: 1e-3,
		v4MaxPlateauAccepts: 2
	};
	const stats = {};
	const first = context.localRefinementAcceptanceCandidate(
		rectangle(0, 0, 100, 100),
		placed,
		before,
		placed,
		after,
		config,
		[0],
		1,
		1,
		stats
	);
	assert.strictEqual(first.accepted, true, 'contact-improving plateau candidate should be accepted');
	assert.strictEqual(first.decision, 'plateau', 'contact-only improvement should be identified as a plateau move');
	context.localRefinementRecordAcceptance(first, stats, placed, after, config, [0]);
	assert.strictEqual(stats.plateauAccepted, 1, 'plateau commit should be counted');

	const repeat = context.localRefinementAcceptanceCandidate(
		rectangle(0, 0, 100, 100),
		placed,
		before,
		placed,
		after,
		config,
		[0],
		1,
		1,
		stats
	);
	assert.strictEqual(repeat.accepted, false, 'an already accepted quantized pose should not cycle');
	assert.strictEqual(repeat.decision, 'revisit', 'repeat rejection should identify the cycling guard');
	assert.strictEqual(stats.plateauRejectedRevisit, 1, 'revisited pose should be counted');
}

testPointSegmentDistance();
testContactRewardsSharedBoundary();
testSheetBoundaryCountsAsContact();
testDetailedPathsStayBounded();
testLexicographicAcceptance();
testPlateauVisitGuard();
console.log('refinement contact tests passed');

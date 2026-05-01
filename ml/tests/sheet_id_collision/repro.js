'use strict';

// Regression test for the first-sheet-boundary bug.
//
// Symptom (observed on macOS, Electron 40.6.1):
//   When nesting a sheet part with quantity >= 2, the renderer's
//   `displayNest` draws a boundary around only the LAST sheet. The first
//   sheet still receives its placed parts but shows no enclosing rect.
//
// Root cause:
//   main/deepnest.js (before the fix) pushed the same `parts[i].polygontree`
//   reference into the `sheets` array once per quantity unit. IPC between
//   the renderer and the background window uses the structured-clone
//   algorithm, which PRESERVES reference identity inside a single payload.
//   On the background side, main/background.js:141 does:
//
//     data.sheets[i].id = data.sheetids[i];
//
//   That mutates the shared object, so after the loop every entry has the
//   id of the last sheet. When the background pushes into allplacements:
//
//     allplacements.push({sheet: sheet.source, sheetid: sheet.id, ...})
//
//   both placements come out with the same sheetid. `displayNest` keys DOM
//   groups by `#sheet<sheetid>`, so the second placement reuses the first
//   placement's group, skips boundary geometry, and overwrites the
//   transform — leaving one boundary drawn at the last placement's
//   position and nothing around the first.
//
// This test simulates the renderer -> background -> renderer round-trip
// twice: once with the original (buggy) pattern, once with the fixed
// pattern (deep-clone per instance). We assert the buggy pattern collides
// and the fixed pattern does not.
//
// Run: node ml/tests/sheet_id_collision/repro.js

const v8 = require('v8');

function structuredClone(value){
	// Electron IPC uses the v8 ValueSerializer, which implements the
	// structured-clone algorithm. Node's v8 module exposes the same
	// primitives and preserves reference identity the same way.
	return v8.deserialize(v8.serialize(value));
}

function cloneTree(tree){
	// Mirrors DeepNest.cloneTree in main/deepnest.js: fresh array of fresh
	// point objects, recursive on children.
	const out = [];
	for (const p of tree) {
		out.push({ x: p.x, y: p.y, exact: p.exact });
	}
	if (tree.children && tree.children.length > 0) {
		out.children = tree.children.map(cloneTree);
	}
	return out;
}

function buildSheetPayload(clonePerInstance){
	// Simulates main/deepnest.js lines ~1179-1195 with a single sheet part
	// of quantity=2. With `clonePerInstance=false` we reproduce the bug;
	// with `true` we exercise the fix.
	const sheetPart = {
		sheet: true,
		quantity: 2,
		polygontree: Object.assign(
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 50 },
				{ x: 0, y: 50 }
			],
			{ children: [] }
		)
	};

	const sheets = [];
	const sheetids = [];
	const sheetsources = [];
	const sheetchildren = [];
	let sid = 0;
	if (sheetPart.sheet) {
		let outerPoly = sheetPart.polygontree;
		for (let j = 0; j < sheetPart.quantity; j++) {
			const poly = clonePerInstance ? cloneTree(outerPoly) : outerPoly;
			sheets.push(poly);
			sheetids.push(sid);
			sheetsources.push(0);
			sheetchildren.push(poly.children);
			sid++;
		}
	}

	return { sheets, sheetids, sheetsources, sheetchildren };
}

function simulateBackground(payload){
	// Simulates main/background.js lines 141-144 followed by the
	// sheet-by-sheet placement loop that pushes into allplacements
	// (lines ~1366 and ~1681). Step-repeat also reads these ids (line 740).
	const data = structuredClone(payload);
	for (let i = 0; i < data.sheets.length; i++) {
		data.sheets[i].id = data.sheetids[i];
		data.sheets[i].source = data.sheetsources[i];
		data.sheets[i].children = data.sheetchildren[i];
	}

	const allplacements = [];
	while (data.sheets.length > 0) {
		const sheet = data.sheets.shift();
		allplacements.push({
			sheet: sheet.source,
			sheetid: sheet.id,
			sheetplacements: []
		});
	}
	return allplacements;
}

function uniqueIds(placements){
	return new Set(placements.map(p => p.sheetid)).size;
}

let failures = 0;

// --- Case 1: original buggy pattern ----------------------------------------
const buggy = simulateBackground(buildSheetPayload(false));
console.log('buggy pattern allplacements:', buggy.map(p => p.sheetid));
if (uniqueIds(buggy) === buggy.length) {
	console.log('  FAIL: expected sheetid collision with shared reference, got unique ids.');
	failures++;
} else {
	console.log('  OK: collision reproduced (both placements share sheetid).');
}

// --- Case 2: fixed pattern (deep clone per instance) -----------------------
const fixed = simulateBackground(buildSheetPayload(true));
console.log('fixed pattern allplacements:', fixed.map(p => p.sheetid));
if (uniqueIds(fixed) === fixed.length) {
	console.log('  OK: each placement has a distinct sheetid.');
} else {
	console.log('  FAIL: collision still present with cloneTree-per-instance.');
	failures++;
}

if (failures > 0) {
	console.log('');
	console.log(failures + ' case(s) failed.');
	process.exit(1);
}
console.log('');
console.log('All cases passed.');
process.exit(0);

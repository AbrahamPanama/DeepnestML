'use strict';

// Regression test for bounded parallel GA evaluation orchestration. See
// AGENT_COLLABORATION.md for the architectural context.
//
// main.js is Electron-only, so the production dispatcher lives in a small
// pure module (`main/background-dispatcher.js`) that both main.js and this
// test import. This keeps the test honest: it exercises the same queue,
// orphan-reporting, response, teardown, and crashed-worker replacement logic
// that the app uses.
//
//   1. FIFO queue preserves enqueue order when dispatching to N workers.
//   2. With MAX_BACKGROUND_WINDOWS workers busy, additional enqueues stay
//      in the queue until a worker reports `background-response`.
//   3. A `render-process-gone` event for a busy worker synthesizes an
//      orphan response { index, fitness: Number.MAX_VALUE, placements:[], error }
//      so the renderer's GA.population[index].processing flag gets cleared
//      and the generation can finish.
//   4. `background-response` clears currentPayload so a subsequent crash
//      does NOT re-report the completed payload as an orphan.
//   5. `recreateBackgroundWindows` clears currentPayload before destroying
//      the window so a teardown-induced render-process-gone does not
//      double-report an orphan for work the user explicitly cancelled.
//
// Run: node ml/tests/parallel_ga/repro.js

const assert = require('assert');
const dispatcherModule = require('../../../main/background-dispatcher');

const createBackgroundDispatcher = dispatcherModule.createBackgroundDispatcher;

const MAX_BACKGROUND_WINDOWS = 4;

// --- Test harness -----------------------------------------------------------

function createHarness(){
	const harness = {
		mainMessages: [],      // messages forwarded to "mainWindow"
		MAX_BACKGROUND_WINDOWS: MAX_BACKGROUND_WINDOWS,
		poolCount: 0
	};

	harness.mainWindow = {
		destroyed: false,
		webContents: {
			isDestroyed: function(){ return harness.mainWindow.destroyed; },
			send: function(channel, payload){
				harness.mainMessages.push({ channel: channel, payload: payload });
			}
		}
	};

	harness.makeWindow = function(){
		const win = {
			isBusy: false,
			isReady: true,
			currentPayload: null,
			destroyed: false,
			sent: [],
			webContents: {
				isDestroyed: function(){ return win.destroyed; },
				send: function(channel, payload){
					win.sent.push({ channel: channel, payload: payload });
				}
			},
			destroy: function(){ win.destroyed = true; }
		};
		return win;
	};

	harness.dispatcher = createBackgroundDispatcher({
		maxWindows: harness.MAX_BACKGROUND_WINDOWS,
		createWindow: harness.makeWindow,
		getMainWindow: function(){ return harness.mainWindow; },
		isWindowDestroyed: function(win){ return !!(win && win.destroyed); },
		sendToWindow: function(win, channel, payload){
			win.webContents.send(channel, payload);
		},
		sendToMain: function(mainWindow, channel, payload){
			mainWindow.webContents.send(channel, payload);
		},
		onWindowCreated: function(win){
			// Production windows become available after `background-ready`; the
			// test marks fake windows ready immediately so dispatch can proceed.
			win.isReady = true;
		},
		onPoolChanged: function(count){
			harness.poolCount = count;
		}
	});

	harness.backgroundQueue = harness.dispatcher.queue;
	harness.backgroundWindows = harness.dispatcher.windows;
	harness.dispatchBackgroundQueue = function(){ harness.dispatcher.dispatch(); };
	harness.renderProcessGone = function(win, details){ harness.dispatcher.handleRendererGone(win, details); };
	harness.backgroundResponse = function(senderWin, payload){ harness.dispatcher.handleResponse(senderWin.webContents, payload); };
	harness.recreateBackgroundWindows = function(){ harness.dispatcher.recreate(); };

	return harness;
}

function mkPayload(i){
	return { index: i, ids: [], sheetids: [], individual: { placement: [{ id: i }] } };
}

let failures = 0;
function check(label, fn){
	try {
		fn();
		console.log('  OK: ' + label);
	}
	catch (err) {
		console.log('  FAIL: ' + label + ' -> ' + (err && err.message ? err.message : err));
		failures++;
	}
}

// --- Case 1: FIFO + bound ---------------------------------------------------

console.log('Case 1: FIFO preservation with bounded workers');
{
	const h = createHarness();
	for (let i = 0; i < 12; i++) { h.backgroundQueue.push(mkPayload(i)); }
	h.dispatchBackgroundQueue();

	check('MAX workers dispatched in order', function(){
		const dispatched = h.backgroundWindows.map(function(w){ return w.currentPayload && w.currentPayload.index; });
		assert.deepStrictEqual(dispatched, [0, 1, 2, 3]);
	});
	check('remaining payloads stay queued in order', function(){
		assert.deepStrictEqual(h.backgroundQueue.map(function(p){ return p.index; }), [4, 5, 6, 7, 8, 9, 10, 11]);
	});
	check('each dispatched worker received exactly one background-start', function(){
		for (const w of h.backgroundWindows) {
			assert.strictEqual(w.sent.length, 1);
			assert.strictEqual(w.sent[0].channel, 'background-start');
		}
	});
}

// --- Case 2: response clears currentPayload + drains queue ------------------

console.log('');
console.log('Case 2: background-response clears currentPayload and drains queue');
{
	const h = createHarness();
	for (let i = 0; i < 6; i++) { h.backgroundQueue.push(mkPayload(i)); }
	h.dispatchBackgroundQueue();

	const first = h.backgroundWindows[0];
	const firstPayload = first.currentPayload;
	h.backgroundResponse(first, { index: firstPayload.index, fitness: 1.23, placements: [] });

	check('first worker no longer holds the completed payload (ref mismatch)', function(){
		// currentPayload is either null (if no redispatch happened) or a brand-new
		// payload (if the queue had more work). What must NOT happen is the old
		// payload reference staying in place — that would keep the orphan path
		// live if the worker crashed next.
		assert.notStrictEqual(first.currentPayload, firstPayload,
			'expected currentPayload to be cleared from the completed payload');
	});
	check('first worker picked up the next queued payload', function(){
		assert.ok(first.currentPayload, 'expected first worker to have a new payload');
		assert.strictEqual(first.currentPayload.index, 4);
	});
	check('main window received the response passthrough', function(){
		const got = h.mainMessages.find(function(m){
			return m.channel === 'background-response' && m.payload && m.payload.index === firstPayload.index && m.payload.fitness === 1.23;
		});
		assert.ok(got, 'expected passthrough background-response for index 0');
	});
}

// --- Case 3: render-process-gone synthesizes orphan response ----------------

console.log('');
console.log('Case 3: render-process-gone synthesizes orphan for in-flight payload');
{
	const h = createHarness();
	for (let i = 0; i < 4; i++) { h.backgroundQueue.push(mkPayload(i)); }
	h.dispatchBackgroundQueue();

	const doomed = h.backgroundWindows[2];
	const doomedIndex = doomed.currentPayload.index;
	h.renderProcessGone(doomed, { reason: 'crashed' });

	check('orphan response emitted to main window with expected shape', function(){
		const orphan = h.mainMessages.find(function(m){
			return m.channel === 'background-response' && m.payload && m.payload.index === doomedIndex;
		});
		assert.ok(orphan, 'expected orphan background-response for index ' + doomedIndex);
		assert.strictEqual(orphan.payload.fitness, Number.MAX_VALUE);
		assert.deepStrictEqual(orphan.payload.placements, []);
		assert.strictEqual(orphan.payload.error, 'background-worker-crashed');
	});
	check('dead worker has isBusy=false and currentPayload=null', function(){
		assert.strictEqual(doomed.isBusy, false);
		assert.strictEqual(doomed.currentPayload, null);
	});
}

// --- Case 4: double-crash does not double-report ----------------------------

console.log('');
console.log('Case 4: response-then-crash does not synthesize a duplicate orphan');
{
	const h = createHarness();
	h.backgroundQueue.push(mkPayload(42));
	h.dispatchBackgroundQueue();

	const win = h.backgroundWindows[0];
	h.backgroundResponse(win, { index: 42, fitness: 9.9, placements: [] });
	// Now the worker crashes AFTER reporting. No orphan should be emitted.
	h.renderProcessGone(win, { reason: 'crashed' });

	check('only one background-response message for index 42', function(){
		const related = h.mainMessages.filter(function(m){
			return m.channel === 'background-response' && m.payload && m.payload.index === 42;
		});
		assert.strictEqual(related.length, 1, 'expected exactly one message for index 42, got ' + related.length);
		assert.strictEqual(related[0].payload.fitness, 9.9, 'expected the real response, not the orphan');
	});
}

// --- Case 5: idle crash replaces the dead worker -----------------------------

console.log('');
console.log('Case 5: idle render-process-gone replaces worker capacity');
{
	const h = createHarness();
	h.dispatcher.createWindows();
	const idle = h.backgroundWindows[1];
	h.renderProcessGone(idle, { reason: 'crashed' });

	check('pool count stays at MAX after replacing the idle crashed worker', function(){
		assert.strictEqual(h.poolCount, MAX_BACKGROUND_WINDOWS);
		const live = h.backgroundWindows.filter(function(w){ return w && !w.destroyed; });
		assert.strictEqual(live.length, MAX_BACKGROUND_WINDOWS);
		assert.ok(live.indexOf(idle) === -1, 'expected dead idle worker to be removed from the pool');
	});
	check('new queued work can still occupy every worker', function(){
		for (let i = 0; i < MAX_BACKGROUND_WINDOWS; i++) { h.backgroundQueue.push(mkPayload(i)); }
		h.dispatchBackgroundQueue();
		const active = h.backgroundWindows.filter(function(w){ return w && w.currentPayload; });
		assert.strictEqual(active.length, MAX_BACKGROUND_WINDOWS);
	});
}

// --- Case 6: recreateBackgroundWindows does not orphan-report ---------------

console.log('');
console.log('Case 6: recreateBackgroundWindows clears currentPayload before destroy');
{
	const h = createHarness();
	for (let i = 0; i < 4; i++) { h.backgroundQueue.push(mkPayload(i)); }
	h.dispatchBackgroundQueue();

	// Snapshot live workers before teardown.
	const live = h.backgroundWindows.slice();
	const indicesInFlight = live.map(function(w){ return w.currentPayload && w.currentPayload.index; });

	h.recreateBackgroundWindows();
	// Simulate the renderer emitting render-process-gone during teardown.
	for (const w of live) {
		h.renderProcessGone(w, { reason: 'killed' });
	}

	check('no orphan background-response was synthesized during teardown', function(){
		const orphanMsgs = h.mainMessages.filter(function(m){
			return m.channel === 'background-response'
				&& m.payload
				&& m.payload.error
				&& indicesInFlight.indexOf(m.payload.index) !== -1;
		});
		assert.strictEqual(orphanMsgs.length, 0,
			'expected 0 orphan messages on teardown, got ' + orphanMsgs.length);
	});
	check('queue was cleared and windows destroyed', function(){
		assert.strictEqual(h.backgroundQueue.length, 0);
		for (const w of live) { assert.strictEqual(w.destroyed, true); }
	});
}

// --- Case 7: crash during teardown still advances workers later -------------

console.log('');
console.log('Case 7: crash after teardown does not block future dispatches');
{
	const h = createHarness();
	h.backgroundQueue.push(mkPayload(100));
	h.dispatchBackgroundQueue();
	const dead = h.backgroundWindows[0];

	h.recreateBackgroundWindows();
	h.renderProcessGone(dead, { reason: 'killed' });

	// Now start fresh work — should dispatch to brand-new windows.
	h.backgroundQueue.push(mkPayload(101));
	h.dispatchBackgroundQueue();

	check('a fresh worker picked up the new payload', function(){
		const accepted = h.backgroundWindows.find(function(w){
			return w && !w.destroyed && w.currentPayload && w.currentPayload.index === 101;
		});
		assert.ok(accepted, 'expected a live worker holding payload 101');
	});
}

// --- Summary ---------------------------------------------------------------

console.log('');
if (failures > 0) {
	console.log(failures + ' assertion(s) failed.');
	process.exit(1);
}
console.log('All cases passed.');
process.exit(0);

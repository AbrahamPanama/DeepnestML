'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const brokerModule = require(path.join(ROOT, 'main', 'nest-geometry-broker'));

function testBoundedRetention() {
	const broker = brokerModule.createNestGeometryBroker(2);
	assert.strictEqual(broker.set({ token: 'a', value: 1 }), true, 'valid geometry should store');
	assert.strictEqual(broker.set({ token: 'b', value: 2 }), true, 'second geometry should store');
	assert.strictEqual(broker.size(), 2, 'broker should hold two entries');
	assert.strictEqual(broker.get('a').value, 1, 'first entry should be retrievable');
	broker.set({ token: 'c', value: 3 });
	assert.strictEqual(broker.size(), 2, 'broker should stay bounded');
	assert.strictEqual(broker.get('a'), null, 'oldest entry should be evicted');
	assert.strictEqual(broker.get('b').value, 2, 'second entry should remain');
	assert.strictEqual(broker.get('c').value, 3, 'newest entry should remain');
	assert.deepStrictEqual(broker.tokens(), ['b', 'c'], 'tokens should preserve retained order');
}

function testReplaceAndClear() {
	const broker = brokerModule.createNestGeometryBroker(2);
	broker.set({ token: 'a', value: 1 });
	broker.set({ token: 'b', value: 2 });
	broker.set({ token: 'a', value: 3 });
	assert.deepStrictEqual(broker.tokens(), ['b', 'a'], 'replacing a token should refresh its recency');
	assert.strictEqual(broker.get('a').value, 3, 'replacement should update value');
	broker.clear('b');
	assert.strictEqual(broker.get('b'), null, 'targeted clear should remove one token');
	assert.strictEqual(broker.size(), 1, 'targeted clear should leave other tokens');
	broker.clear();
	assert.strictEqual(broker.size(), 0, 'clear without token should empty broker');
	assert.strictEqual(broker.get('a'), null, 'clear should remove all entries');
}

function testInvalidGeometry() {
	const broker = brokerModule.createNestGeometryBroker(2);
	assert.strictEqual(broker.set(null), false, 'null geometry should be rejected');
	assert.strictEqual(broker.set({ value: 1 }), false, 'geometry without token should be rejected');
	assert.strictEqual(broker.size(), 0, 'invalid geometry should not store');
}

function run() {
	testBoundedRetention();
	testReplaceAndClear();
	testInvalidGeometry();
	console.log('nest geometry broker tests passed');
}

run();

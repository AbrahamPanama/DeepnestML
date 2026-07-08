'use strict';

function createNestGeometryBroker(limit) {
	var maxEntries = Math.max(1, parseInt(limit || 2, 10));
	var entries = {};
	var order = [];

	function remove(token) {
		if (!token || !entries[token]) {
			return false;
		}
		delete entries[token];
		var index = order.indexOf(token);
		if (index >= 0) {
			order.splice(index, 1);
		}
		return true;
	}

	function set(geometry) {
		if (!geometry || !geometry.token) {
			return false;
		}
		remove(geometry.token);
		entries[geometry.token] = geometry;
		order.push(geometry.token);
		while (order.length > maxEntries) {
			remove(order[0]);
		}
		return true;
	}

	function get(token) {
		return token && entries[token] ? entries[token] : null;
	}

	function clear(token) {
		if (token) {
			remove(token);
			return;
		}
		entries = {};
		order = [];
	}

	function tokens() {
		return order.slice();
	}

	return {
		set: set,
		get: get,
		clear: clear,
		tokens: tokens,
		size: function () {
			return order.length;
		}
	};
}

module.exports = {
	createNestGeometryBroker: createNestGeometryBroker
};

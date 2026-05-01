'use strict';

function mulberry32(seed) {
	var t = seed >>> 0;

	return function nextRandom() {
		t += 0x6D2B79F5;
		var r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}

function installSeededRandom(seed) {
	var originalRandom = Math.random;
	var nextRandom = mulberry32(seed);

	Math.random = nextRandom;

	return function restore() {
		Math.random = originalRandom;
	};
}

module.exports = {
	installSeededRandom: installSeededRandom,
	mulberry32: mulberry32
};

/*
 * Deterministic search helpers for post-placement continuous compaction.
 * Construction rotations and persistent NFP caching intentionally live elsewhere.
 */

(function(root){
	'use strict';

	function normalizeAngle(angle){
		var value = (Number(angle) || 0) % 360;
		if(value < 0){
			value += 360;
		}
		return value;
	}

	function angularDistance(a, b){
		var delta = Math.abs(normalizeAngle(a) - normalizeAngle(b));
		return delta > 180 ? 360 - delta : delta;
	}

	function angleKey(angle, precision){
		precision = typeof precision === 'number' ? precision : 4;
		return normalizeAngle(angle).toFixed(precision);
	}

	function addAngle(result, seen, angle, precision){
		angle = normalizeAngle(angle);
		var key = angleKey(angle, precision);
		if(seen[key]){
			return false;
		}
		seen[key] = true;
		result.push(angle);
		return true;
	}

	function sweepAngles(center, radius, step, seen){
		center = normalizeAngle(center);
		radius = Math.max(0, Number(radius) || 0);
		step = Math.max(1e-6, Number(step) || 1);
		seen = seen || {};
		var result = [];
		addAngle(result, seen, center, 4);
		var count = Math.floor(radius / step + 1e-9);
		for(var i=1; i<=count; i++){
			addAngle(result, seen, center - i * step, 4);
			addAngle(result, seen, center + i * step, 4);
		}
		if(count * step < radius - 1e-9){
			addAngle(result, seen, center - radius, 4);
			addAngle(result, seen, center + radius, 4);
		}
		return result;
	}

	function compareResults(a, b){
		if(a.score !== b.score){
			return a.score - b.score;
		}
		if(a.angle !== b.angle){
			return a.angle - b.angle;
		}
		return (a.ordinal || 0) - (b.ordinal || 0);
	}

	function bestResults(results, limit, minAngleSeparation){
		limit = Math.max(0, parseInt(limit, 10) || 0);
		minAngleSeparation = Math.max(0, Number(minAngleSeparation) || 0);
		var ranked = (results || []).slice().sort(compareResults);
		var selected = [];
		for(var i=0; i<ranked.length && selected.length < limit; i++){
			if(!isFinite(ranked[i].score)){
				continue;
			}
			var separated = true;
			for(var j=0; j<selected.length; j++){
				if(angularDistance(ranked[i].angle, selected[j].angle) < minAngleSeparation - 1e-9){
					separated = false;
					break;
				}
			}
			if(separated){
				selected.push(ranked[i]);
			}
		}
		return selected;
	}

	function clampUnit(value){
		value = Number(value);
		if(!isFinite(value) || value < 0){
			return 0;
		}
		return value > 1 ? 1 : value;
	}

	function postScore(components, weights){
		components = components || {};
		weights = weights || {};
		var boxWeight = isFinite(Number(weights.box)) ? Number(weights.box) : 0.45;
		var hullWeight = isFinite(Number(weights.hull)) ? Number(weights.hull) : 0.45;
		var spanWeight = isFinite(Number(weights.span)) ? Number(weights.span) : 0.10;
		var totalWeight = boxWeight + hullWeight + spanWeight;
		if(totalWeight <= 0){
			return Infinity;
		}
		return (
			boxWeight * clampUnit(components.box) +
			hullWeight * clampUnit(components.hull) +
			spanWeight * clampUnit(components.span)
		) / totalWeight;
	}

	function improves(candidate, current, relativeTolerance){
		if(!isFinite(candidate)){
			return false;
		}
		if(!isFinite(current)){
			return true;
		}
		relativeTolerance = Math.max(0, Number(relativeTolerance) || 0.0001);
		return candidate < current - Math.max(1e-12, Math.abs(current) * relativeTolerance);
	}

	var api = {
		normalizeAngle: normalizeAngle,
		angularDistance: angularDistance,
		angleKey: angleKey,
		sweepAngles: sweepAngles,
		compareResults: compareResults,
		bestResults: bestResults,
		postScore: postScore,
		improves: improves
	};

	root.ContinuousRefinement = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));

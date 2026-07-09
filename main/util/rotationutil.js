/*!
 * Geometry-aware discrete rotation helpers.
 * Pure polygon math; safe for the renderer and Node tests.
 */

(function(root){
	'use strict';

	function normalizeAngle(angle){
		var normalized = (Number(angle) || 0) % 360;
		if(normalized < 0){
			normalized += 360;
		}
		return normalized;
	}

	function angleKey(angle){
		return normalizeAngle(angle).toFixed(6);
	}

	function angularDistance(a, b){
		var delta = Math.abs(normalizeAngle(a) - normalizeAngle(b));
		return delta > 180 ? 360 - delta : delta;
	}

	function addUnique(angles, angle){
		angle = normalizeAngle(angle);
		for(var i=0; i<angles.length; i++){
			if(angularDistance(angles[i], angle) <= 1e-6){
				return false;
			}
		}
		angles.push(angle);
		return true;
	}

	function uniformAngles(count){
		count = parseInt(count, 10);
		if(!count || count < 1){
			count = 1;
		}
		var angles = [];
		var step = 360 / count;
		for(var i=0; i<count; i++){
			addUnique(angles, i * step);
		}
		return angles;
	}

	function segmentLength(a, b){
		var dx = b.x - a.x;
		var dy = b.y - a.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function principalAxis(polygon){
		if(!polygon || polygon.length < 2){
			return { angle: 0, aspectRatio: 1 };
		}

		var weights = [];
		var totalWeight = 0;
		var centerX = 0;
		var centerY = 0;
		for(var i=0; i<polygon.length; i++){
			var previous = polygon[(i + polygon.length - 1) % polygon.length];
			var current = polygon[i];
			var next = polygon[(i + 1) % polygon.length];
			var weight = (segmentLength(previous, current) + segmentLength(current, next)) / 2;
			if(!isFinite(weight) || weight <= 0){
				weight = 1;
			}
			weights.push(weight);
			totalWeight += weight;
			centerX += current.x * weight;
			centerY += current.y * weight;
		}

		if(totalWeight <= 0){
			return { angle: 0, aspectRatio: 1 };
		}
		centerX /= totalWeight;
		centerY /= totalWeight;

		var xx = 0;
		var yy = 0;
		var xy = 0;
		for(i=0; i<polygon.length; i++){
			var dx = polygon[i].x - centerX;
			var dy = polygon[i].y - centerY;
			xx += weights[i] * dx * dx;
			yy += weights[i] * dy * dy;
			xy += weights[i] * dx * dy;
		}
		xx /= totalWeight;
		yy /= totalWeight;
		xy /= totalWeight;

		var trace = xx + yy;
		var discriminant = Math.sqrt(Math.max(0, (xx - yy) * (xx - yy) + 4 * xy * xy));
		var major = Math.max(0, (trace + discriminant) / 2);
		var minor = Math.max(0, (trace - discriminant) / 2);
		var aspectRatio = major > 0 ? Math.sqrt(major / Math.max(minor, major * 1e-12)) : 1;
		var angle = normalizeAngle(Math.atan2(2 * xy, xx - yy) * 90 / Math.PI);
		if(angle >= 180){
			angle -= 180;
		}

		return {
			angle: angle,
			aspectRatio: aspectRatio
		};
	}

	function allowedAngles(polygon, config){
		config = config || {};
		var base = uniformAngles(config.rotations);
		if(config.adaptiveRotations !== true || config.mergeLines === true || base.length < 2){
			return base;
		}

		var maxAngles = parseInt(config.adaptiveRotationMaxAngles, 10);
		if(!maxAngles || maxAngles < base.length){
			maxAngles = Math.max(base.length, 6);
		}
		if(base.length >= maxAngles){
			return base;
		}

		var axis = principalAxis(polygon);
		var minAspect = Number(config.adaptiveRotationMinAspectRatio);
		if(!isFinite(minAspect) || minAspect < 1){
			minAspect = 1.35;
		}
		if(axis.aspectRatio < minAspect){
			return base;
		}

		var diagonal = Math.round(normalizeAngle(45 - axis.angle));
		addUnique(base, diagonal);
		if(base.length < maxAngles){
			addUnique(base, diagonal + 180);
		}
		return base.slice(0, maxAngles);
	}

	function dominantAngle(rotations){
		if(!rotations || rotations.length === 0){
			return null;
		}
		var counts = {};
		var values = {};
		var bestKey = null;
		for(var i=0; i<rotations.length; i++){
			var key = angleKey(rotations[i]);
			counts[key] = (counts[key] || 0) + 1;
			values[key] = normalizeAngle(rotations[i]);
			if(bestKey === null || counts[key] > counts[bestKey]){
				bestKey = key;
			}
		}
		return values[bestKey];
	}

	function chooseAlignedAngle(angles, siblingRotations, random, bias){
		if(!angles || angles.length === 0){
			return 0;
		}
		random = typeof random === 'function' ? random : Math.random;
		bias = Number(bias);
		if(!isFinite(bias)){
			bias = 0.7;
		}
		var dominant = dominantAngle(siblingRotations);
		if(dominant !== null && random() < Math.max(0, Math.min(1, bias))){
			for(var i=0; i<angles.length; i++){
				if(angularDistance(angles[i], dominant) <= 1e-6){
					return angles[i];
				}
			}
		}
		return angles[Math.min(angles.length - 1, Math.floor(random() * angles.length))];
	}

	var api = {
		normalizeAngle: normalizeAngle,
		angularDistance: angularDistance,
		uniformAngles: uniformAngles,
		principalAxis: principalAxis,
		allowedAngles: allowedAngles,
		dominantAngle: dominantAngle,
		chooseAlignedAngle: chooseAlignedAngle
	};

	root.RotationUtil = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));

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

	function hasHalfTurnSymmetry(polygon, config){
		if(!polygon || polygon.length < 3){
			return false;
		}
		if(config && config.processHoles !== false && polygon.children && polygon.children.length > 0){
			return false;
		}

		var minX = polygon[0].x;
		var maxX = polygon[0].x;
		var minY = polygon[0].y;
		var maxY = polygon[0].y;
		for(var i=1; i<polygon.length; i++){
			minX = Math.min(minX, polygon[i].x);
			maxX = Math.max(maxX, polygon[i].x);
			minY = Math.min(minY, polygon[i].y);
			maxY = Math.max(maxY, polygon[i].y);
		}
		var centerX = (minX + maxX) / 2;
		var centerY = (minY + maxY) / 2;
		var diagonal = Math.sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY));
		var curveTolerance = config && isFinite(Number(config.curveTolerance)) ? Math.abs(Number(config.curveTolerance)) : 0;
		var tolerance = Math.max(1e-7, diagonal * 1e-5, curveTolerance * 2);
		var lineEpsilon = Math.max(1e-9, diagonal * 1e-10);
		var convex = true;
		var turnSign = 0;
		var crossTolerance = tolerance * Math.max(1, diagonal);
		for(i=0; i<polygon.length; i++){
			var previous = polygon[(i + polygon.length - 1) % polygon.length];
			var current = polygon[i];
			var following = polygon[(i + 1) % polygon.length];
			var turn = (current.x - previous.x) * (following.y - current.y) - (current.y - previous.y) * (following.x - current.x);
			if(Math.abs(turn) <= crossTolerance){
				continue;
			}
			var currentSign = turn > 0 ? 1 : -1;
			if(turnSign !== 0 && currentSign !== turnSign){
				convex = false;
				break;
			}
			turnSign = currentSign;
		}
		if(convex && turnSign !== 0){
			for(var supportSample=0; supportSample<32; supportSample++){
				var supportAngle = supportSample * Math.PI / 32;
				var supportX = Math.cos(supportAngle);
				var supportY = Math.sin(supportAngle);
				var minimumSupport = Infinity;
				var maximumSupport = -Infinity;
				for(i=0; i<polygon.length; i++){
					var projection = (polygon[i].x - centerX) * supportX + (polygon[i].y - centerY) * supportY;
					minimumSupport = Math.min(minimumSupport, projection);
					maximumSupport = Math.max(maximumSupport, projection);
				}
				if(Math.abs(maximumSupport + minimumSupport) > tolerance){
					return false;
				}
			}
			return true;
		}

		var twiceArea = 0;
		var centroidXNumerator = 0;
		var centroidYNumerator = 0;
		for(i=0; i<polygon.length; i++){
			var next = polygon[(i + 1) % polygon.length];
			var cross = polygon[i].x * next.y - next.x * polygon[i].y;
			twiceArea += cross;
			centroidXNumerator += (polygon[i].x + next.x) * cross;
			centroidYNumerator += (polygon[i].y + next.y) * cross;
		}
		if(Math.abs(twiceArea) <= 1e-12){
			return false;
		}
		var centroidX = centroidXNumerator / (3 * twiceArea);
		var centroidY = centroidYNumerator / (3 * twiceArea);
		var centroidDx = centroidX - centerX;
		var centroidDy = centroidY - centerY;
		if(centroidDx * centroidDx + centroidDy * centroidDy > tolerance * tolerance){
			return false;
		}

		for(var sample=0; sample<32; sample++){
			var angle = (sample + 0.371) * Math.PI / 32;
			var ux = Math.cos(angle);
			var uy = Math.sin(angle);
			var vx = -uy;
			var vy = ux;
			var intersections = [];
			for(i=0; i<polygon.length; i++){
				var a = polygon[i];
				var b = polygon[(i + 1) % polygon.length];
				var ax = a.x - centerX;
				var ay = a.y - centerY;
				var bx = b.x - centerX;
				var by = b.y - centerY;
				var av = ax * vx + ay * vy;
				var bv = bx * vx + by * vy;
				if(Math.abs(av) <= lineEpsilon && Math.abs(bv) <= lineEpsilon){
					intersections.push(ax * ux + ay * uy);
					intersections.push(bx * ux + by * uy);
					continue;
				}
				if((av < -lineEpsilon && bv < -lineEpsilon) || (av > lineEpsilon && bv > lineEpsilon)){
					continue;
				}
				var denominator = av - bv;
				if(Math.abs(denominator) <= 1e-12){
					continue;
				}
				var t = av / denominator;
				if(t < -1e-9 || t > 1 + 1e-9){
					continue;
				}
				var intersectionX = ax + (bx - ax) * t;
				var intersectionY = ay + (by - ay) * t;
				intersections.push(intersectionX * ux + intersectionY * uy);
			}
			intersections.sort(function(a, b){ return a - b; });
			var unique = [];
			for(var intersectionIndex=0; intersectionIndex<intersections.length; intersectionIndex++){
				if(unique.length === 0 || Math.abs(intersections[intersectionIndex] - unique[unique.length - 1]) > tolerance){
					unique.push(intersections[intersectionIndex]);
			}
			}
			if(unique.length < 2){
				return false;
			}
			for(var pairIndex=0; pairIndex<unique.length; pairIndex++){
				if(Math.abs(unique[pairIndex] + unique[unique.length - 1 - pairIndex]) > tolerance){
					return false;
				}
			}
		}
		return true;
	}

	function halfTurnDistance(a, b){
		var delta = Math.abs(normalizeAngle(a) - normalizeAngle(b)) % 180;
		return Math.min(delta, 180 - delta);
	}

	function dedupeHalfTurnAngles(angles){
		var result = [];
		for(var i=0; i<angles.length; i++){
			var duplicate = false;
			for(var j=0; j<result.length; j++){
				if(halfTurnDistance(angles[i], result[j]) <= 1e-6){
					duplicate = true;
					break;
				}
			}
			if(!duplicate){
				result.push(angles[i]);
			}
		}
		return result;
	}

	function allowedAngles(polygon, config){
		config = config || {};
		var base = uniformAngles(config.rotations);
		if(config.adaptiveRotations !== true || config.mergeLines === true || base.length < 2){
			return base;
		}
		var halfTurnSymmetric = hasHalfTurnSymmetry(polygon, config);
		if(halfTurnSymmetric){
			base = dedupeHalfTurnAngles(base);
		}

		var maxAngles = parseInt(config.adaptiveRotationMaxAngles, 10);
		if(!maxAngles){
			maxAngles = Math.max(base.length, 6);
		}
		else if(maxAngles < base.length){
			maxAngles = base.length;
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
		if(halfTurnSymmetric){
			diagonal = diagonal % 180;
		}
		addUnique(base, diagonal);
		if(base.length < maxAngles){
			addUnique(base, halfTurnSymmetric ? (diagonal + 90) % 180 : diagonal + 180);
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
		hasHalfTurnSymmetry: hasHalfTurnSymmetry,
		dedupeHalfTurnAngles: dedupeHalfTurnAngles,
		allowedAngles: allowedAngles,
		dominantAngle: dominantAngle,
		chooseAlignedAngle: chooseAlignedAngle
	};

	root.RotationUtil = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));

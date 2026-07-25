/*
 * Direct pose generation for off-grid rotations (docs/direct-pose-generator-plan.md).
 *
 * The engine can already VALIDATE an arbitrary angle with exact geometry; what it
 * cannot do is PROPOSE good ones, because candidate positions come from NFP
 * boundaries and an NFP at a non-canonical angle is both a cache hazard and an
 * (sources x rotations)^2 cost explosion.
 *
 * This module derives candidate poses from part-vs-neighbour geometry alone. It
 * performs no collision testing, touches no NFP, and has no dependencies — every
 * pose it emits is a PROPOSAL that the caller must validate exactly.
 *
 * Coordinate contract (matches the engine): a part polygon is already rotated to
 * `part.rotation` in its own frame, and `placement` is the translation applied to
 * it. A pose is therefore {rotation, x, y}: rotate the SOURCE part to `rotation`,
 * then translate by (x, y).
 */

(function(root){
	'use strict';

	var DEFAULT_MAX_EDGES = 8;
	var DEFAULT_FINE_STEP_DEG = 1;
	var DEFAULT_MAX_DELTA_DEG = 45;

	function finite(value, fallback){
		value = Number(value);
		return isFinite(value) ? value : fallback;
	}

	function normalizeAngle(degrees){
		var angle = finite(degrees, 0) % 360;
		if(angle < 0){
			angle += 360;
		}
		return angle;
	}

	function toRadians(degrees){
		return finite(degrees, 0) * Math.PI / 180;
	}

	function ringOf(polygon){
		if(Array.isArray(polygon)){
			return polygon;
		}
		return null;
	}

	function rotatePoint(point, degrees){
		var radians = toRadians(degrees);
		var cos = Math.cos(radians);
		var sin = Math.sin(radians);
		return {
			x: point.x * cos - point.y * sin,
			y: point.x * sin + point.y * cos
		};
	}

	// Rotate a polygon about the origin, preserving hole rings. Mirrors the
	// engine's rotatePolygon convention (counter-clockwise positive).
	function rotateRing(ring, degrees){
		var result = [];
		for(var i=0; i<ring.length; i++){
			result.push(rotatePoint(ring[i], degrees));
		}
		if(ring.children){
			result.children = [];
			for(var c=0; c<ring.children.length; c++){
				result.children.push(rotateRing(ring.children[c], degrees));
			}
		}
		return result;
	}

	function edgeAngleDegrees(a, b){
		return normalizeAngle(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI);
	}

	function edgeLength(a, b){
		var dx = b.x - a.x;
		var dy = b.y - a.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function polygonEdges(polygon){
		var ring = ringOf(polygon);
		var edges = [];
		if(!ring || ring.length < 2){
			return edges;
		}
		for(var i=0; i<ring.length; i++){
			var a = ring[i];
			var b = ring[(i + 1) % ring.length];
			var length = edgeLength(a, b);
			if(length <= 0){
				continue;
			}
			edges.push({
				index: i,
				a: {x: a.x, y: a.y},
				b: {x: b.x, y: b.y},
				length: length,
				angle: edgeAngleDegrees(a, b)
			});
		}
		return edges;
	}

	// Longest-first, ties broken by index so ordering is deterministic.
	function longestEdges(polygon, count){
		var edges = polygonEdges(polygon);
		edges.sort(function(p, q){
			if(q.length !== p.length){
				return q.length - p.length;
			}
			return p.index - q.index;
		});
		count = Math.max(1, parseInt(count, 10) || DEFAULT_MAX_EDGES);
		return edges.slice(0, count);
	}

	function pointInRing(point, ring){
		var inside = false;
		for(var i=0, j=ring.length-1; i<ring.length; j=i++){
			var xi = ring[i].x;
			var yi = ring[i].y;
			var xj = ring[j].x;
			var yj = ring[j].y;
			if(((yi > point.y) !== (yj > point.y)) &&
				(point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)){
				inside = !inside;
			}
		}
		return inside;
	}

	// Outward normal of an edge, resolved by probing just off the midpoint. This
	// is winding-agnostic, which matters because imported SVG rings arrive in
	// both orientations.
	function edgeOutwardNormal(ring, edge){
		var dx = edge.b.x - edge.a.x;
		var dy = edge.b.y - edge.a.y;
		var length = Math.sqrt(dx * dx + dy * dy);
		if(length <= 0){
			return {x: 0, y: 0};
		}
		var candidate = {x: dy / length, y: -dx / length};
		var mid = {
			x: (edge.a.x + edge.b.x) / 2,
			y: (edge.a.y + edge.b.y) / 2
		};
		var probeDistance = Math.max(1e-9, length * 1e-6);
		var probe = {
			x: mid.x + candidate.x * probeDistance,
			y: mid.y + candidate.y * probeDistance
		};
		if(pointInRing(probe, ring)){
			return {x: -candidate.x, y: -candidate.y};
		}
		return candidate;
	}

	function shiftRing(ring, placement){
		var result = [];
		for(var i=0; i<ring.length; i++){
			result.push({
				x: ring[i].x + placement.x,
				y: ring[i].y + placement.y
			});
		}
		return result;
	}

	function poseKey(pose){
		return [
			Math.round(normalizeAngle(pose.rotation) * 1000) / 1000,
			Math.round(pose.x * 1000) / 1000,
			Math.round(pose.y * 1000) / 1000
		].join(':');
	}

	function pushUnique(poses, seen, pose){
		if(!pose || !isFinite(pose.x) || !isFinite(pose.y) || !isFinite(pose.rotation)){
			return;
		}
		var key = poseKey(pose);
		if(seen[key]){
			return;
		}
		seen[key] = true;
		poses.push(pose);
	}

	/*
	 * Edge mating.
	 *
	 * Rotate the target so one of its long edges is ANTIPARALLEL to a long edge
	 * of the neighbour, then translate so the two edges lie flush (separated by
	 * `separation`, which is 0 when spacing is already baked into the polygons —
	 * the engine's normal case). Three slide positions per edge pair: the target
	 * edge tucked to each end of the neighbour edge, plus centred.
	 *
	 * This is the pose family a canonical rotation grid cannot express, and the
	 * reason slender parts fan out instead of lying along one another.
	 */
	function edgeMatingPoses(target, targetPlacement, neighbour, neighbourPlacement, options){
		options = options || {};
		var poses = [];
		var seen = {};
		var targetRing = ringOf(target);
		var neighbourRing = ringOf(neighbour);
		if(!targetRing || !neighbourRing){
			return poses;
		}
		var maxEdges = Math.max(1, parseInt(options.maxEdges, 10) || DEFAULT_MAX_EDGES);
		var separation = finite(options.separation, 0);
		var baseRotation = normalizeAngle(finite(
			targetPlacement && targetPlacement.rotation,
			finite(target.rotation, 0)
		));

		var neighbourWorldRing = shiftRing(neighbourRing, neighbourPlacement);
		var neighbourEdges = longestEdges(neighbourWorldRing, maxEdges);
		var targetEdges = longestEdges(targetRing, maxEdges);

		for(var n=0; n<neighbourEdges.length; n++){
			var ne = neighbourEdges[n];
			var u = {
				x: (ne.b.x - ne.a.x) / ne.length,
				y: (ne.b.y - ne.a.y) / ne.length
			};
			var normal = edgeOutwardNormal(neighbourWorldRing, ne);
			for(var t=0; t<targetEdges.length; t++){
				var te = targetEdges[t];
				// Antiparallel: the mated edges face each other.
				var delta = normalizeAngle(ne.angle + 180 - te.angle);
				var rotated = rotateRing(targetRing, delta);
				var ra = rotated[te.index];
				var rb = rotated[(te.index + 1) % rotated.length];
				var mid = {x: (ra.x + rb.x) / 2, y: (ra.y + rb.y) / 2};
				var half = te.length / 2;
				// Phase sweep along the mated edge. Three positions (both ends
				// plus centre) is enough for convex parts, but for concave ones
				// — interlocking leaves, teeth, combs — the phase decides whether
				// the protrusions mesh or collide, and the meshing phase is
				// almost always missed by a 3-sample sweep.
				var samples = Math.max(2, parseInt(options.slideSamples, 10) || 3);
				var from = half;
				var to = Math.max(half, ne.length - half);
				var slides = [];
				for(var q=0; q<samples; q++){
					slides.push(samples === 1 ? from : from + (to - from) * (q / (samples - 1)));
				}
				if(to > from){
					slides.push(ne.length / 2);
				}
				for(var s=0; s<slides.length; s++){
					var along = slides[s];
					var desired = {
						x: ne.a.x + u.x * along + normal.x * separation,
						y: ne.a.y + u.y * along + normal.y * separation
					};
					pushUnique(poses, seen, {
						rotation: normalizeAngle(baseRotation + delta),
						x: desired.x - mid.x,
						y: desired.y - mid.y,
						provenance: 'edgeMating'
					});
				}
			}
		}
		return poses;
	}

	/*
	 * Rotate about a world-space pivot, keeping that pivot fixed.
	 *
	 * newPlacement = P - R(delta) * p_local, where p_local is the pivot in the
	 * part's current local frame. Rotating about a contact point sweeps the free
	 * end of a part into open space while preserving the snug side.
	 */
	function rotateAboutPivot(targetPlacement, deltaDegrees, pivotWorld){
		var baseRotation = normalizeAngle(finite(targetPlacement && targetPlacement.rotation, 0));
		var pivotLocal = {
			x: pivotWorld.x - targetPlacement.x,
			y: pivotWorld.y - targetPlacement.y
		};
		var rotatedPivot = rotatePoint(pivotLocal, deltaDegrees);
		return {
			rotation: normalizeAngle(baseRotation + deltaDegrees),
			x: pivotWorld.x - rotatedPivot.x,
			y: pivotWorld.y - rotatedPivot.y,
			provenance: 'pivotRotation'
		};
	}

	function rotationPoses(targetPlacement, pivotWorld, options){
		options = options || {};
		var step = Math.abs(finite(options.stepDegrees, DEFAULT_FINE_STEP_DEG)) || DEFAULT_FINE_STEP_DEG;
		var maxDelta = Math.abs(finite(options.maxDeltaDegrees, DEFAULT_MAX_DELTA_DEG));
		var poses = [];
		var seen = {};
		for(var magnitude=step; magnitude<=maxDelta + 1e-9; magnitude+=step){
			pushUnique(poses, seen, rotateAboutPivot(targetPlacement, magnitude, pivotWorld));
			pushUnique(poses, seen, rotateAboutPivot(targetPlacement, -magnitude, pivotWorld));
		}
		return poses;
	}

	/*
	 * Sibling alignment.
	 *
	 * For many identical slender parts the dense solution is parallel or
	 * antiparallel rows with a phase offset, NOT thirty independent diagonals.
	 * Without this family a good generator can recreate the fan artefact it was
	 * built to remove.
	 */
	function siblingPoses(targetPlacement, dominantRotation, options){
		options = options || {};
		var poses = [];
		var seen = {};
		var dominant = normalizeAngle(finite(dominantRotation, 0));
		var angles = [dominant, normalizeAngle(dominant + 180)];
		for(var i=0; i<angles.length; i++){
			pushUnique(poses, seen, {
				rotation: angles[i],
				x: finite(targetPlacement.x, 0),
				y: finite(targetPlacement.y, 0),
				provenance: 'siblingAlignment'
			});
		}
		return poses;
	}

	/*
	 * Rank before validating. Scoring is sampled distance and cheap; exact
	 * collision is not. Ties break on the original index so ordering is stable.
	 */
	function rankPoses(poses, scoreFn, cap){
		var scored = [];
		for(var i=0; i<poses.length; i++){
			scored.push({
				pose: poses[i],
				score: finite(scoreFn ? scoreFn(poses[i], i) : 0, -Infinity),
				index: i
			});
		}
		scored.sort(function(a, b){
			if(b.score !== a.score){
				return b.score - a.score;
			}
			return a.index - b.index;
		});
		var limit = cap > 0 ? Math.min(cap, scored.length) : scored.length;
		var result = [];
		for(var r=0; r<limit; r++){
			result.push(scored[r].pose);
		}
		return result;
	}

	var api = {
		normalizeAngle: normalizeAngle,
		polygonEdges: polygonEdges,
		longestEdges: longestEdges,
		edgeOutwardNormal: edgeOutwardNormal,
		rotateRing: rotateRing,
		edgeMatingPoses: edgeMatingPoses,
		rotateAboutPivot: rotateAboutPivot,
		rotationPoses: rotationPoses,
		siblingPoses: siblingPoses,
		rankPoses: rankPoses,
		DEFAULT_MAX_EDGES: DEFAULT_MAX_EDGES,
		DEFAULT_FINE_STEP_DEG: DEFAULT_FINE_STEP_DEG,
		DEFAULT_MAX_DELTA_DEG: DEFAULT_MAX_DELTA_DEG
	};

	root.PoseGenerator = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));

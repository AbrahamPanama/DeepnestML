/*!
 * Local refinement separation helpers.
 * Pure point/ring math; safe for both background renderer script tags and Node tests.
 */

(function(root){
	'use strict';

	function sqr(value){
		return value * value;
	}

	function distance(a, b){
		return Math.sqrt(sqr(a.x - b.x) + sqr(a.y - b.y));
	}

	function onSegment(q, a, b, eps){
		var cross = (q.y - a.y) * (b.x - a.x) - (q.x - a.x) * (b.y - a.y);
		if(Math.abs(cross) > eps){
			return false;
		}
		var dot = (q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y);
		if(dot < -eps){
			return false;
		}
		var len2 = sqr(b.x - a.x) + sqr(b.y - a.y);
		return dot <= len2 + eps;
	}

	function pointInRing(q, ring){
		if(!q || !ring || ring.length < 3){
			return false;
		}
		var eps = 1e-12;
		for(var b=0, a=ring.length-1; b<ring.length; a=b++){
			if(onSegment(q, ring[a], ring[b], eps)){
				return false;
			}
		}

		var inside = false;
		for(var i=0, j=ring.length-1; i<ring.length; j=i++){
			var pi = ring[i];
			var pj = ring[j];
			if(((pi.y > q.y) !== (pj.y > q.y)) &&
				(q.x < (pj.x - pi.x) * (q.y - pi.y) / ((pj.y - pi.y) || eps) + pi.x)){
				inside = !inside;
			}
		}
		return inside;
	}

	function closestPointOnSegment(q, a, b){
		var dx = b.x - a.x;
		var dy = b.y - a.y;
		var len2 = dx * dx + dy * dy;
		if(len2 <= 0){
			return {x: a.x, y: a.y};
		}
		var t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
		if(t < 0){
			t = 0;
		}
		else if(t > 1){
			t = 1;
		}
		return {
			x: a.x + t * dx,
			y: a.y + t * dy
		};
	}

	function distToRingBoundary(q, ring){
		if(!q || !ring || ring.length === 0){
			return {dist: Infinity, closest: null};
		}
		var bestDist = Infinity;
		var bestPoint = null;
		for(var i=0, j=ring.length-1; i<ring.length; j=i++){
			var closest = closestPointOnSegment(q, ring[j], ring[i]);
			var dist = distance(q, closest);
			if(dist < bestDist){
				bestDist = dist;
				bestPoint = closest;
			}
		}
		return {
			dist: bestDist,
			closest: bestPoint
		};
	}

	function nearestBoundary(q, outer, children){
		var best = distToRingBoundary(q, outer);
		if(children && children.length > 0){
			for(var i=0; i<children.length; i++){
				var child = distToRingBoundary(q, children[i]);
				if(child.dist < best.dist){
					best = child;
				}
			}
		}
		return best;
	}

	function penetration(q, nfp){
		if(!q || !nfp || nfp.length < 3){
			return {inside: false, depth: 0, exit: null};
		}
		if(!pointInRing(q, nfp)){
			return {inside: false, depth: 0, exit: null};
		}
		if(nfp.children && nfp.children.length > 0){
			for(var i=0; i<nfp.children.length; i++){
				if(pointInRing(q, nfp.children[i])){
					return {inside: false, depth: 0, exit: null};
				}
			}
		}
		var nearest = nearestBoundary(q, nfp, nfp.children);
		return {
			inside: true,
			depth: isFinite(nearest.dist) ? nearest.dist : 0,
			exit: nearest.closest
		};
	}

	function allowedInIfp(q, ifp){
		if(!ifp || ifp.length < 3 || !pointInRing(q, ifp)){
			return false;
		}
		if(ifp.children && ifp.children.length > 0){
			for(var i=0; i<ifp.children.length; i++){
				if(pointInRing(q, ifp.children[i])){
					return false;
				}
			}
		}
		return true;
	}

	function containmentViolation(q, ifpRings){
		if(!ifpRings || ifpRings.length === 0){
			return {outside: true, depth: Infinity, entry: null};
		}
		for(var i=0; i<ifpRings.length; i++){
			if(allowedInIfp(q, ifpRings[i])){
				return {outside: false, depth: 0, entry: null};
			}
		}

		var best = {dist: Infinity, closest: null};
		for(i=0; i<ifpRings.length; i++){
			var nearest = nearestBoundary(q, ifpRings[i], ifpRings[i].children);
			if(nearest.dist < best.dist){
				best = nearest;
			}
		}
		return {
			outside: true,
			depth: best.dist,
			entry: best.closest
		};
	}

	function mulberry32(seed){
		var a = seed >>> 0;
		return function(){
			a += 0x6D2B79F5;
			var t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function addUniqueScalar(values, value, eps){
		if(!isFinite(value)){
			return;
		}
		for(var i=0; i<values.length; i++){
			if(Math.abs(values[i] - value) <= eps){
				return;
			}
		}
		values.push(value);
	}

	function axisBreakpoints(q, axis, ring){
		var values = [];
		if(!q || !ring || ring.length < 2 || (axis !== 'x' && axis !== 'y')){
			return values;
		}
		var eps = 1e-9;
		var line = axis === 'x' ? q.y : q.x;
		for(var i=0, j=ring.length-1; i<ring.length; j=i++){
			var a = ring[j];
			var b = ring[i];
			var aLine = axis === 'x' ? a.y : a.x;
			var bLine = axis === 'x' ? b.y : b.x;
			var aScalar = axis === 'x' ? a.x : a.y;
			var bScalar = axis === 'x' ? b.x : b.y;
			var delta = bLine - aLine;
			if(Math.abs(delta) <= eps){
				if(Math.abs(line - aLine) <= eps){
					addUniqueScalar(values, aScalar, eps);
					addUniqueScalar(values, bScalar, eps);
				}
				continue;
			}
			var t = (line - aLine) / delta;
			if(t < -eps || t > 1 + eps){
				continue;
			}
			if(t < 0){
				t = 0;
			}
			else if(t > 1){
				t = 1;
			}
			addUniqueScalar(values, aScalar + (bScalar - aScalar) * t, eps);
		}
		values.sort(function(a, b){
			return a - b;
		});
		return values;
	}

	function toClipperPath(ring, scale){
		var path = [];
		for(var i=0; i<ring.length; i++){
			path.push({
				X: Math.round(ring[i].x * scale),
				Y: Math.round(ring[i].y * scale)
			});
		}
		return path;
	}

	function materialOverlap(A, B, config){
		config = config || {};
		var clipperLib = config.clipperLib || (typeof ClipperLib !== 'undefined' ? ClipperLib : null);
		if(!clipperLib || !A || !B || A.length < 3 || B.length < 3){
			return false;
		}
		// Existing full-precision backstop deliberately skips hole-bearing pairs to
		// avoid false rejects on legal hole nesting; preserve that behavior here.
		if((A.children && A.children.length > 0) || (B.children && B.children.length > 0)){
			return false;
		}
		var scale = Number(config.clipperScale) || 10000000;
		var curveTolerance = Number(config.curveTolerance) || 0;
		var epsDepth = Math.max(1e-9, 1e-4 * curveTolerance);
		var aPath = toClipperPath(A, scale);
		var bPath = toClipperPath(B, scale);
		var solution = new clipperLib.Paths();
		var clipper = new clipperLib.Clipper();
		clipper.AddPaths([aPath], clipperLib.PolyType.ptSubject, true);
		clipper.AddPaths([bPath], clipperLib.PolyType.ptClip, true);
		if(!clipper.Execute(clipperLib.ClipType.ctIntersection, solution, clipperLib.PolyFillType.pftNonZero, clipperLib.PolyFillType.pftNonZero)){
			return true;
		}
		if(!solution || solution.length === 0){
			return false;
		}
		var eroded = new clipperLib.Paths();
		var offset = new clipperLib.ClipperOffset(2, epsDepth * scale);
		offset.AddPaths(solution, clipperLib.JoinType.jtMiter, clipperLib.EndType.etClosedPolygon);
		offset.Execute(eroded, -0.5 * epsDepth * scale);
		if(!eroded || eroded.length === 0){
			return false;
		}
		for(var i=0; i<eroded.length; i++){
			if(eroded[i] && eroded[i].length >= 3 && Math.abs(clipperLib.Clipper.Area(eroded[i])) > 0){
				return true;
			}
		}
		return false;
	}

	function gaussian2D(rng, sigma){
		var u1 = Math.max(rng(), 1e-12);
		var u2 = rng();
		var mag = Math.sqrt(-2 * Math.log(u1)) * sigma;
		var angle = 2 * Math.PI * u2;
		return {
			x: Math.cos(angle) * mag,
			y: Math.sin(angle) * mag
		};
	}

	function unitVector(from, to){
		if(!from || !to){
			return {x: 0, y: 0};
		}
		var dx = to.x - from.x;
		var dy = to.y - from.y;
		var len = Math.sqrt(dx * dx + dy * dy);
		if(!isFinite(len) || len <= 0){
			return {x: 0, y: 0};
		}
		return {
			x: dx / len,
			y: dy / len
		};
	}

	function qToPlacement(q, refPoint){
		return {
			x: q.x - refPoint.x,
			y: q.y - refPoint.y
		};
	}

	function inSheetBounds(q, bounds){
		if(!bounds){
			return true;
		}
		return q.x >= bounds.x && q.x <= bounds.x + bounds.width &&
			q.y >= bounds.y && q.y <= bounds.y + bounds.height;
	}

	function createWeights(n){
		var weights = [];
		for(var i=0; i<n; i++){
			weights[i] = [];
			for(var j=0; j<n; j++){
				weights[i][j] = 1;
			}
		}
		return weights;
	}

	function evaluateViolations(ctx, weights, wSheet, eps){
		var n = ctx.n || 0;
		var partCosts = [];
		var pairViolations = [];
		var sheetViolations = [];
		var maxDepth = 0;
		var missingGeometry = false;

		for(var i=0; i<n; i++){
			partCosts[i] = 0;
			sheetViolations[i] = {outside: false, depth: 0, entry: null};
		}

		for(i=0; i<n; i++){
			var q = ctx.q(i);
			var ifp = ctx.ifp(i);
			if(!ifp){
				missingGeometry = true;
				continue;
			}
			var sheet = containmentViolation(q, ifp);
			sheetViolations[i] = sheet;
			if(sheet.outside && sheet.depth > eps){
				var sheetDepth = isFinite(sheet.depth) ? sheet.depth : Number.MAX_VALUE / 4;
				partCosts[i] += wSheet * sheetDepth;
				if(isFinite(sheet.depth) && sheet.depth > maxDepth){
					maxDepth = sheet.depth;
				}
			}
			for(var j=0; j<n; j++){
				if(i === j){
					continue;
				}
				var nfp = ctx.nfp(i, j);
				if(!nfp){
					missingGeometry = true;
					continue;
				}
				var pen = penetration(q, nfp);
				if(pen.depth > eps){
					partCosts[i] += weights[i][j] * pen.depth;
					pairViolations.push({i: i, j: j, penetration: pen});
					if(pen.depth > maxDepth){
						maxDepth = pen.depth;
					}
				}
			}
		}

		return {
			missingGeometry: missingGeometry,
			partCosts: partCosts,
			pairViolations: pairViolations,
			sheetViolations: sheetViolations,
			maxDepth: maxDepth
		};
	}

	function candidateCost(ctx, i, q, weights, wSheet){
		var ref = ctx.refPoint(i);
		var originalQ = ctx.q(i);
		var placement = qToPlacement(q, ref);
		ctx.setPlacement(i, placement);

		var total = 0;
		var ifp = ctx.ifp(i);
		if(!ifp){
			ctx.setPlacement(i, qToPlacement(originalQ, ref));
			return Infinity;
		}
		var sheet = containmentViolation(q, ifp);
		if(sheet.outside && sheet.depth > 0){
			total += wSheet * (isFinite(sheet.depth) ? sheet.depth : Number.MAX_VALUE / 4);
		}
		for(var j=0; j<(ctx.n || 0); j++){
			if(i === j){
				continue;
			}
			var nfp = ctx.nfp(i, j);
			if(!nfp){
				total = Infinity;
				break;
			}
			total += weights[i][j] * penetration(q, nfp).depth;
		}

		ctx.setPlacement(i, qToPlacement(originalQ, ref));
		return total;
	}

	function addCandidate(candidates, q, ctx){
		if(!q || !isFinite(q.x) || !isFinite(q.y)){
			return;
		}
		if(!inSheetBounds(q, ctx.sheetBounds)){
			return;
		}
		candidates.push(q);
	}

	function separate(ctx){
		ctx = ctx || {};
		var n = Math.max(0, parseInt(ctx.n, 10) || 0);
		var eps = Math.max(1e-9, Number(ctx.eps) || 0);
		var rng = ctx.rng || mulberry32(1);
		var deadline = Number(ctx.deadline) || (Date.now() + 1000);
		var maxAttempts = Math.max(1, parseInt(ctx.maxAttempts, 10) || 3);
		var maxItersPerAttempt = Math.max(1, parseInt(ctx.maxItersPerAttempt, 10) || (50 * Math.max(n, 1)));
		var weights = createWeights(n);
		var wSheet = 2.0;
		var movesApplied = 0;
		var itersUsed = 0;
		var maxResidualDepth = 0;

		for(var attempt=0; attempt<maxAttempts; attempt++){
			var strikes = 0;
			for(var iter=0; iter<maxItersPerAttempt; iter++){
				if(Date.now() > deadline){
					return {
						feasible: false,
						movesApplied: movesApplied,
						itersUsed: itersUsed,
						maxResidualDepth: maxResidualDepth
					};
				}
				itersUsed++;
				var violations = evaluateViolations(ctx, weights, wSheet, eps);
				maxResidualDepth = violations.maxDepth;
				if(violations.missingGeometry){
					return {
						feasible: false,
						movesApplied: movesApplied,
						itersUsed: itersUsed,
						maxResidualDepth: maxResidualDepth
					};
				}
				if(violations.pairViolations.length === 0){
					var sheetBlocked = false;
					for(var s=0; s<n; s++){
						if(violations.sheetViolations[s] && violations.sheetViolations[s].outside && violations.sheetViolations[s].depth > eps){
							sheetBlocked = true;
							break;
						}
					}
					if(!sheetBlocked){
						return {
							feasible: true,
							movesApplied: movesApplied,
							itersUsed: itersUsed,
							maxResidualDepth: 0
						};
					}
				}

				var target = 0;
				var targetCost = -Infinity;
				for(var i=0; i<n; i++){
					if(violations.partCosts[i] > targetCost){
						target = i;
						targetCost = violations.partCosts[i];
					}
				}
				if(targetCost <= eps){
					strikes++;
					if(strikes > n){
						break;
					}
					continue;
				}

				var currentQ = ctx.q(target);
				var refPoint = ctx.refPoint(target);
				var candidates = [];
				for(var p=0; p<violations.pairViolations.length; p++){
					var pair = violations.pairViolations[p];
					if(pair.i !== target || !pair.penetration || !pair.penetration.exit){
						continue;
					}
					var away = unitVector(currentQ, pair.penetration.exit);
					addCandidate(candidates, {
						x: pair.penetration.exit.x + away.x * 2 * eps,
						y: pair.penetration.exit.y + away.y * 2 * eps
					}, ctx);
				}
				var sheetViolation = violations.sheetViolations[target];
				if(sheetViolation && sheetViolation.outside && sheetViolation.entry){
					var inward = unitVector(currentQ, sheetViolation.entry);
					addCandidate(candidates, {
						x: sheetViolation.entry.x + inward.x * 2 * eps,
						y: sheetViolation.entry.y + inward.y * 2 * eps
					}, ctx);
				}
				var sigma = 0.5 * Math.max(Number(ctx.bboxDiag(target)) || 1, 1);
				for(var g=0; g<12; g++){
					var gaussian = gaussian2D(rng, sigma);
					addCandidate(candidates, {
						x: currentQ.x + gaussian.x,
						y: currentQ.y + gaussian.y
					}, ctx);
				}
				for(var u=0; u<4; u++){
					if(!ctx.sheetBounds){
						break;
					}
					addCandidate(candidates, {
						x: ctx.sheetBounds.x + rng() * ctx.sheetBounds.width,
						y: ctx.sheetBounds.y + rng() * ctx.sheetBounds.height
					}, ctx);
				}

				var bestQ = null;
				var bestCost = targetCost;
				for(var c=0; c<candidates.length; c++){
					var cost = candidateCost(ctx, target, candidates[c], weights, wSheet);
					if(cost < bestCost){
						bestCost = cost;
						bestQ = candidates[c];
					}
				}

				if(bestQ && bestCost < targetCost - eps){
					ctx.setPlacement(target, qToPlacement(bestQ, refPoint));
					movesApplied++;
					strikes = 0;
				}
				else{
					strikes++;
					if(strikes > n){
						break;
					}
				}
			}

			var current = evaluateViolations(ctx, weights, wSheet, eps);
			maxResidualDepth = current.maxDepth;
			if(current.pairViolations.length === 0){
				var outside = false;
				for(var sv=0; sv<n; sv++){
					if(current.sheetViolations[sv] && current.sheetViolations[sv].outside && current.sheetViolations[sv].depth > eps){
						outside = true;
						break;
					}
				}
				if(!outside && !current.missingGeometry){
					return {
						feasible: true,
						movesApplied: movesApplied,
						itersUsed: itersUsed,
						maxResidualDepth: 0
					};
				}
			}
			if(current.maxDepth > 0){
				for(var v=0; v<current.pairViolations.length; v++){
					var pv = current.pairViolations[v];
					weights[pv.i][pv.j] += pv.penetration.depth / current.maxDepth;
				}
			}
		}

		return {
			feasible: false,
			movesApplied: movesApplied,
			itersUsed: itersUsed,
			maxResidualDepth: maxResidualDepth
		};
	}

	var api = {
		pointInRing: pointInRing,
		distToRingBoundary: distToRingBoundary,
		penetration: penetration,
		containmentViolation: containmentViolation,
		axisBreakpoints: axisBreakpoints,
		materialOverlap: materialOverlap,
		mulberry32: mulberry32,
		separate: separate
	};

	root.SeparationUtil = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));

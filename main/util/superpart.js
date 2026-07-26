/*
 * Offline repeated-part pairing.
 *
 * Candidate ranking uses a simplified copy of the outline, but every retained
 * pose is accepted only after a full-resolution Clipper intersection test. The
 * returned collision envelope is conservative and is never exported.
 */

(function(root, factory){
	'use strict';

	var clipper = root && root.ClipperLib;
	var poseGenerator = root && root.PoseGenerator;
	if(typeof module !== 'undefined' && module.exports){
		clipper = clipper || require('./clippernode.js');
		poseGenerator = poseGenerator || require('./pose-generator.js');
	}
	var api = factory(clipper, poseGenerator);
	if(root){
		root.Superpart = api;
	}
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this, function(ClipperLib, PoseGenerator){
	'use strict';

	var DEFAULT_BUDGET_MS = 2000;
	var DEFAULT_MIN_GAIN = 0.05;
	var DEFAULT_CLIPPER_SCALE = 10000000;
	var DEFAULT_PROXY_DIVISOR = 512;
	var SUPERPART_CACHE_VERSION = 2;
	var internalCache = {};

	function finite(value, fallback){
		value = Number(value);
		return isFinite(value) ? value : fallback;
	}

	function normalizeAngle(value){
		var angle = finite(value, 0) % 360;
		if(angle < 0){
			angle += 360;
		}
		return Math.round(angle * 1000000) / 1000000;
	}

	function cloneRing(ring){
		var result = [];
		for(var i=0; i<ring.length; i++){
			result.push({x: ring[i].x, y: ring[i].y});
		}
		if(ring.children){
			result.children = [];
			for(var c=0; c<ring.children.length; c++){
				result.children.push(cloneRing(ring.children[c]));
			}
		}
		return result;
	}

	function cloneValue(value){
		if(value === null || typeof value !== 'object'){
			return value;
		}
		if(Array.isArray(value)){
			var array = [];
			for(var i=0; i<value.length; i++){
				array.push(cloneValue(value[i]));
			}
			for(var key in value){
				if(Object.prototype.hasOwnProperty.call(value, key) && !/^\d+$/.test(key)){
					array[key] = cloneValue(value[key]);
				}
			}
			return array;
		}
		var result = {};
		for(var name in value){
			if(Object.prototype.hasOwnProperty.call(value, name)){
				result[name] = cloneValue(value[name]);
			}
		}
		return result;
	}

	function translateRing(ring, offset){
		var result = [];
		for(var i=0; i<ring.length; i++){
			result.push({
				x: ring[i].x + offset.x,
				y: ring[i].y + offset.y
			});
		}
		if(ring.children){
			result.children = [];
			for(var c=0; c<ring.children.length; c++){
				result.children.push(translateRing(ring.children[c], offset));
			}
		}
		return result;
	}

	function boundsForRing(ring){
		var minX = Infinity;
		var minY = Infinity;
		var maxX = -Infinity;
		var maxY = -Infinity;
		for(var i=0; i<ring.length; i++){
			minX = Math.min(minX, ring[i].x);
			minY = Math.min(minY, ring[i].y);
			maxX = Math.max(maxX, ring[i].x);
			maxY = Math.max(maxY, ring[i].y);
		}
		return {
			x: minX,
			y: minY,
			maxX: maxX,
			maxY: maxY,
			width: maxX - minX,
			height: maxY - minY
		};
	}

	function mergeBounds(left, right){
		var minX = Math.min(left.x, right.x);
		var minY = Math.min(left.y, right.y);
		var maxX = Math.max(left.maxX, right.maxX);
		var maxY = Math.max(left.maxY, right.maxY);
		return {
			x: minX,
			y: minY,
			maxX: maxX,
			maxY: maxY,
			width: maxX - minX,
			height: maxY - minY
		};
	}

	function polygonArea(ring){
		var area = 0;
		for(var i=0; i<ring.length; i++){
			var current = ring[i];
			var next = ring[(i + 1) % ring.length];
			area += current.x * next.y - next.x * current.y;
		}
		return area / 2;
	}

	function materialArea(ring){
		var area = Math.abs(polygonArea(ring));
		if(ring.children){
			for(var i=0; i<ring.children.length; i++){
				area -= materialArea(ring.children[i]);
			}
		}
		return area;
	}

	function theoreticalHullGain(ring){
		if(!ring || ring.length < 3){
			return 0;
		}
		var hullArea = Math.abs(polygonArea(convexHull(ring)));
		if(hullArea <= 0){
			return 0;
		}
		return Math.max(0, 1 - materialArea(ring) / hullArea);
	}

	function convexHull(points){
		var sorted = points.slice().sort(function(a, b){
			return a.x - b.x || a.y - b.y;
		});
		if(sorted.length <= 2){
			return sorted;
		}
		function cross(origin, a, b){
			return (a.x - origin.x) * (b.y - origin.y) -
				(a.y - origin.y) * (b.x - origin.x);
		}
		var lower = [];
		var i;
		for(i=0; i<sorted.length; i++){
			while(lower.length >= 2 &&
				cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0){
				lower.pop();
			}
			lower.push(sorted[i]);
		}
		var upper = [];
		for(i=sorted.length - 1; i>=0; i--){
			while(upper.length >= 2 &&
				cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0){
				upper.pop();
			}
			upper.push(sorted[i]);
		}
		lower.pop();
		upper.pop();
		return lower.concat(upper);
	}

	function normalizedMetric(metric){
		return metric === 'gravity' || metric === 'box' || metric === 'convexhull' ?
			metric : 'convexhull';
	}

	function candidateScore(fixed, moved, singleBoundsArea, singleHullArea, metric){
		var fixedBounds = boundsForRing(fixed);
		var pairBounds = mergeBounds(fixedBounds, boundsForRing(moved));
		var pairBoundsArea = pairBounds.width * pairBounds.height;
		var pairHullArea = Math.abs(polygonArea(convexHull(fixed.concat(moved))));
		var pairGravityScore = pairBounds.width * 2 + pairBounds.height;
		var singleGravityScore = fixedBounds.width * 2 + fixedBounds.height;
		var objectiveScore;
		var singleObjectiveScore;
		metric = normalizedMetric(metric);
		if(metric === 'gravity'){
			objectiveScore = pairGravityScore;
			singleObjectiveScore = singleGravityScore;
		}
		else if(metric === 'box'){
			objectiveScore = pairBoundsArea;
			singleObjectiveScore = singleBoundsArea;
		}
		else{
			objectiveScore = pairHullArea;
			singleObjectiveScore = singleHullArea;
		}
		return {
			pairBounds: pairBounds,
			pairBoundsArea: pairBoundsArea,
			pairHullArea: pairHullArea,
			pairGravityScore: pairGravityScore,
			objectiveScore: objectiveScore,
			objectiveGain: 1 - objectiveScore / (2 * singleObjectiveScore),
			gravityGain: 1 - pairGravityScore / (2 * singleGravityScore),
			bboxGain: 1 - pairBoundsArea / (2 * singleBoundsArea),
			hullGain: 1 - pairHullArea / (2 * singleHullArea)
		};
	}

	function compareCandidates(left, right){
		if(left.objectiveScore !== right.objectiveScore){
			return left.objectiveScore - right.objectiveScore;
		}
		if(left.pairHullArea !== right.pairHullArea){
			return left.pairHullArea - right.pairHullArea;
		}
		if(left.pairBoundsArea !== right.pairBoundsArea){
			return left.pairBoundsArea - right.pairBoundsArea;
		}
		if(left.angle !== right.angle){
			return left.angle - right.angle;
		}
		if(left.offset.x !== right.offset.x){
			return left.offset.x - right.offset.x;
		}
		return left.offset.y - right.offset.y;
	}

	function toClipperPath(ring, scale){
		var result = [];
		for(var i=0; i<ring.length; i++){
			result.push({
				X: Math.round(ring[i].x * scale),
				Y: Math.round(ring[i].y * scale)
			});
		}
		return result;
	}

	function appendClipperPaths(ring, scale, result){
		result.push(toClipperPath(ring, scale));
		if(ring.children){
			for(var i=0; i<ring.children.length; i++){
				appendClipperPaths(ring.children[i], scale, result);
			}
		}
	}

	function exactIntersectionArea(left, right, scale){
		return exactClipArea(left, right, scale, ClipperLib.ClipType.ctIntersection);
	}

	function exactClipArea(left, right, scale, clipType){
		var subject = [];
		var clip = [];
		appendClipperPaths(left, scale, subject);
		appendClipperPaths(right, scale, clip);
		var solution = new ClipperLib.Paths();
		var operation = new ClipperLib.Clipper();
		operation.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
		operation.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
		if(!operation.Execute(
			clipType,
			solution,
			ClipperLib.PolyFillType.pftEvenOdd,
			ClipperLib.PolyFillType.pftEvenOdd
		)){
			return Infinity;
		}
		var signedArea = 0;
		for(var i=0; i<solution.length; i++){
			signedArea += ClipperLib.Clipper.Area(solution[i]);
		}
		return Math.abs(signedArea) / (scale * scale);
	}

	function exactPose(context, angle, offset){
		context.exactTests++;
		var rotated = PoseGenerator.rotateRing(context.source, angle);
		var moved = translateRing(rotated, offset);
		var intersectionArea = exactIntersectionArea(
			context.fixed,
			moved,
			context.clipperScale
		);
		if(intersectionArea > context.areaEpsilon){
			return null;
		}
		var score = candidateScore(
			context.fixed,
			moved,
			context.singleBoundsArea,
			context.singleHullArea,
			context.metric
		);
		return {
			angle: normalizeAngle(angle),
			offset: {x: offset.x, y: offset.y},
			moved: moved,
			intersectionArea: intersectionArea,
			pairBounds: score.pairBounds,
			pairBoundsArea: score.pairBoundsArea,
			pairHullArea: score.pairHullArea,
			pairGravityScore: score.pairGravityScore,
			objectiveScore: score.objectiveScore,
			objectiveGain: score.objectiveGain,
			gravityGain: score.gravityGain,
			bboxGain: score.bboxGain,
			hullGain: score.hullGain
		};
	}

	function simplifyRing(ring, tolerance, scale){
		var path = toClipperPath(ring, scale);
		var clean = ClipperLib.Clipper.CleanPolygon(path, tolerance * scale);
		var result = [];
		if(clean && clean.length >= 3){
			for(var i=0; i<clean.length; i++){
				result.push({x: clean[i].X / scale, y: clean[i].Y / scale});
			}
		}
		else{
			result = cloneRing(ring);
			delete result.children;
		}
		if(ring.children){
			result.children = [];
			for(var c=0; c<ring.children.length; c++){
				result.children.push(simplifyRing(ring.children[c], tolerance, scale));
			}
		}
		return result;
	}

	function proxyRing(source, options){
		var bounds = boundsForRing(source);
		var diagonal = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height);
		var divisor = Math.max(64, finite(options.proxyDivisor, DEFAULT_PROXY_DIVISOR));
		var tolerance = Math.max(
			finite(options.curveTolerance, 0),
			diagonal / divisor
		);
		var proxy = simplifyRing(source, tolerance, options.clipperScale);
		if(proxy.length < 24 && source.length >= 24){
			proxy = simplifyRing(source, diagonal / 768, options.clipperScale);
		}
		return proxy;
	}

	function retainBest(list, candidate, limit){
		list.push(candidate);
		list.sort(compareCandidates);
		if(list.length > limit){
			list.length = limit;
		}
	}

	function proxyCandidate(context, angle, offset){
		context.proxyTests++;
		var rotated = PoseGenerator.rotateRing(context.proxy, angle);
		var moved = translateRing(rotated, offset);
		if(exactIntersectionArea(context.proxy, moved, context.clipperScale) > context.areaEpsilon){
			return null;
		}
		var score = candidateScore(
			context.proxy,
			moved,
			context.proxyBoundsArea,
			context.proxyHullArea,
			context.metric
		);
		return {
			angle: normalizeAngle(angle),
			offset: {x: offset.x, y: offset.y},
			pairBounds: score.pairBounds,
			pairBoundsArea: score.pairBoundsArea,
			pairHullArea: score.pairHullArea,
			pairGravityScore: score.pairGravityScore,
			objectiveScore: score.objectiveScore,
			objectiveGain: score.objectiveGain,
			gravityGain: score.gravityGain,
			bboxGain: score.bboxGain,
			hullGain: score.hullGain
		};
	}

	function coarseCandidates(context, options){
		var candidates = [];
		var phaseDeadline = context.coarseDeadline || context.deadline;
		var angleStep = Math.max(1, finite(options.coarseStepDeg, 5));
		var maximumAngle = Math.max(
			angleStep,
			Math.min(360, finite(options.maximumRelativeAngle, 180))
		);
		var xSamples = Math.max(3, parseInt(options.xSamples, 10) || 9);
		var ySamples = Math.max(3, parseInt(options.ySamples, 10) || 7);
		var fixedBounds = boundsForRing(context.proxy);
		for(var angle=0; angle<=maximumAngle + 1e-9; angle+=angleStep){
			if(Date.now() >= phaseDeadline){
				break;
			}
			var normalized = normalizeAngle(angle);
			var rotated = PoseGenerator.rotateRing(context.proxy, normalized);
			var rotatedBounds = boundsForRing(rotated);
			var minX = fixedBounds.x - rotatedBounds.maxX;
			var maxX = fixedBounds.maxX - rotatedBounds.x;
			var minY = fixedBounds.y - rotatedBounds.maxY;
			var maxY = fixedBounds.maxY - rotatedBounds.y;
			for(var xi=0; xi<xSamples; xi++){
				for(var yi=0; yi<ySamples; yi++){
					var candidate = proxyCandidate(context, normalized, {
						x: minX + (maxX - minX) * xi / (xSamples - 1),
						y: minY + (maxY - minY) * yi / (ySamples - 1)
					});
					if(candidate){
						retainBest(candidates, candidate, options.proxyFinalists || 128);
					}
				}
			}
		}
		return candidates;
	}

	function exactBestFromProxy(context, candidates, limit, currentBest){
		var best = currentBest || null;
		var count = Math.min(candidates.length, Math.max(1, limit));
		for(var i=0; i<count; i++){
			if(Date.now() >= context.deadline){
				break;
			}
			var exact = exactPose(context, candidates[i].angle, candidates[i].offset);
			if(exact && (!best || compareCandidates(exact, best) < 0)){
				best = exact;
			}
		}
		return best;
	}

	function neighbourhoodCandidates(context, best, angleRadius, angleStep, positionDivisor, limit){
		var candidates = [];
		var fixedBounds = boundsForRing(context.proxy);
		var stepX = Math.max(context.curveTolerance, fixedBounds.width / positionDivisor);
		var stepY = Math.max(context.curveTolerance, fixedBounds.height / positionDivisor);
		for(var delta=-angleRadius; delta<=angleRadius + 1e-9; delta+=angleStep){
			if(Date.now() >= context.deadline){
				break;
			}
			var angle = normalizeAngle(best.angle + delta);
			for(var xi=-1; xi<=1; xi++){
				for(var yi=-1; yi<=1; yi++){
					var candidate = proxyCandidate(context, angle, {
						x: best.offset.x + xi * stepX,
						y: best.offset.y + yi * stepY
					});
					if(candidate){
						retainBest(candidates, candidate, limit);
					}
				}
			}
		}
		return candidates;
	}

	function refineTranslation(context, candidate, maxLevels){
		var best = candidate;
		var sourceBounds = boundsForRing(context.source);
		var rotatedBounds = boundsForRing(
			PoseGenerator.rotateRing(context.source, candidate.angle)
		);
		var stepX = Math.max(
			context.curveTolerance,
			Math.min(sourceBounds.width, rotatedBounds.width) / 8
		);
		var stepY = Math.max(
			context.curveTolerance,
			Math.min(sourceBounds.height, rotatedBounds.height) / 8
		);
		var directions = [
			[-1, 0], [1, 0], [0, -1], [0, 1],
			[-1, -1], [-1, 1], [1, -1], [1, 1]
		];
		for(var level=0; level<maxLevels; level++){
			if(Date.now() >= context.deadline){
				break;
			}
			var levelBest = best;
			for(var d=0; d<directions.length; d++){
				if(Date.now() >= context.deadline){
					break;
				}
				var trial = exactPose(context, best.angle, {
					x: best.offset.x + directions[d][0] * stepX,
					y: best.offset.y + directions[d][1] * stepY
				});
				if(trial && compareCandidates(trial, levelBest) < 0){
					levelBest = trial;
				}
			}
			best = levelBest;
			stepX /= 2;
			stepY /= 2;
			if(Math.max(stepX, stepY) <= context.curveTolerance){
				break;
			}
		}
		return best;
	}

	function fromClipperPath(path, scale){
		var result = [];
		for(var i=0; i<path.length; i++){
			result.push({x: path[i].X / scale, y: path[i].Y / scale});
		}
		return result;
	}

	function envelopeFromRings(rings, sourceOrientation, scale){
		var paths = [];
		for(var ringIndex=0; ringIndex<rings.length; ringIndex++){
			appendClipperPaths(rings[ringIndex], scale, paths);
		}
		var clipper = new ClipperLib.Clipper();
		var tree = new ClipperLib.PolyTree();
		clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
		if(!clipper.Execute(
			ClipperLib.ClipType.ctUnion,
			tree,
			ClipperLib.PolyFillType.pftEvenOdd,
			ClipperLib.PolyFillType.pftEvenOdd
		)){
			return null;
		}
		var polygons = ClipperLib.JS.PolyTreeToExPolygons(tree);
		if(!polygons || polygons.length !== 1 || !polygons[0].outer || polygons[0].outer.length < 3){
			return null;
		}
		var outer = polygons[0].outer.slice();
		if(ClipperLib.Clipper.Orientation(outer) !== sourceOrientation){
			outer.reverse();
		}
		var result = fromClipperPath(outer, scale);
		if(polygons[0].holes && polygons[0].holes.length){
			result.children = [];
			for(var i=0; i<polygons[0].holes.length; i++){
				var hole = polygons[0].holes[i].slice();
				if(ClipperLib.Clipper.Orientation(hole) === sourceOrientation){
					hole.reverse();
				}
				result.children.push(fromClipperPath(hole, scale));
			}
		}
		return result;
	}

	function buildCollisionEnvelope(fixed, moved, curveTolerance, scale){
		var fixedPath = toClipperPath(fixed, scale);
		var sourceOrientation = ClipperLib.Clipper.Orientation(fixedPath);
		var exact = null;
		var exactUnionError = null;
		try{
			exact = envelopeFromRings([fixed, moved], sourceOrientation, scale);
		}
		catch(err){
			// Some valid self-touching rings trigger an internal Clipper
			// PolyTree join error. The hull below is conservative, so falling
			// back cannot admit an illegal placement.
			exactUnionError = err && err.message ? err.message : String(err);
		}
		if(exact){
			return {
				polygon: exact,
				mode: 'exactUnion',
				expansion: 0,
				exactUnionError: null
			};
		}

		// The active engine has no representation for disconnected material
		// islands. A hull is a conservative collision shell and is dramatically
		// cheaper than carrying both high-detail member outlines through NFP.
		var hull = convexHull(fixed.concat(moved));
		if((polygonArea(hull) < 0) !== (polygonArea(fixed) < 0)){
			hull.reverse();
		}
		return {
			polygon: hull,
			mode: 'convexHull',
			expansion: null,
			exactUnionError: exactUnionError
		};
	}

	function hashMix(hash, value){
		hash ^= value & 255;
		hash = Math.imul(hash, 16777619);
		hash ^= (value >>> 8) & 255;
		hash = Math.imul(hash, 16777619);
		hash ^= (value >>> 16) & 255;
		hash = Math.imul(hash, 16777619);
		hash ^= (value >>> 24) & 255;
		return Math.imul(hash, 16777619);
	}

	function hashRing(ring, hash, depth){
		hash = hashMix(hash, depth);
		hash = hashMix(hash, ring.length);
		for(var i=0; i<ring.length; i++){
			hash = hashMix(hash, Math.round(finite(ring[i].x, 0) * 1000000));
			hash = hashMix(hash, Math.round(finite(ring[i].y, 0) * 1000000));
		}
		var children = ring.children || [];
		hash = hashMix(hash, children.length);
		for(var childIndex=0; childIndex<children.length; childIndex++){
			hash = hashRing(children[childIndex], hash, depth + 1);
		}
		return hash;
	}

	function fingerprint(ring, options, curveTolerance){
		var geometryHash = hashRing(ring, 2166136261, 0) >>> 0;
		return [
			'superpart-search-v' + SUPERPART_CACHE_VERSION,
			options.sourceKey || '',
			geometryHash.toString(16),
			Math.round(curveTolerance * 1000000),
			Math.round(finite(options.spacing, 0) * 1000000),
			options.processHoles === true ? 1 : 0,
			options.metric || 'hull'
		].join(':');
	}

	function findBestPair(polygon, options){
		options = options || {};
		var trace = options.trace && typeof options.trace === 'object' ? options.trace : null;
		function finishTrace(reason, details){
			if(!trace){
				return;
			}
			trace.reason = reason;
			trace.elapsedMs = Date.now() - startedAt;
			if(details){
				for(var detailKey in details){
					if(Object.prototype.hasOwnProperty.call(details, detailKey)){
						trace[detailKey] = details[detailKey];
					}
				}
			}
		}
		var startedAt = Date.now();
		if(!ClipperLib || !PoseGenerator || !polygon || polygon.length < 3){
			finishTrace('invalidInput');
			return null;
		}
		var budgetMs = Math.max(50, finite(options.budgetMs, DEFAULT_BUDGET_MS));
		var curveTolerance = Math.max(1e-9, finite(options.curveTolerance, 0.3));
		var clipperScale = Math.max(1000, finite(options.clipperScale, DEFAULT_CLIPPER_SCALE));
		if(trace){
			trace.budgetMs = budgetMs;
			trace.sourcePointCount = polygon.length;
			trace.childCount = polygon.children ? polygon.children.length : 0;
		}
		var cache = options.cache || internalCache;
		var cacheKey = fingerprint(polygon, options, curveTolerance);
		if(cache && Object.prototype.hasOwnProperty.call(cache, cacheKey)){
			var cached = cloneValue(cache[cacheKey]);
			if(cached && cached.diagnostics){
				cached.diagnostics.cacheHit = true;
			}
			finishTrace('cacheHit', {
				gain: cached ? cached.gain : null,
				paired: !!cached
			});
			return cached;
		}

		var source = cloneRing(polygon);
		var fixedBounds = boundsForRing(source);
		var singleBoundsArea = fixedBounds.width * fixedBounds.height;
		var singleHullArea = Math.abs(polygonArea(convexHull(source)));
		if(singleBoundsArea <= 0 || singleHullArea <= 0 || materialArea(source) <= 0){
			finishTrace('degenerateGeometry');
			return null;
		}
		var headroom = theoreticalHullGain(source);
		if(trace){
			trace.theoreticalHullGain = headroom;
		}
		if(headroom < Math.max(0, finite(options.minGain, DEFAULT_MIN_GAIN))){
			finishTrace('insufficientTheoreticalGain');
			return null;
		}
		var proxy = proxyRing(source, {
			proxyDivisor: options.proxyDivisor,
			curveTolerance: curveTolerance,
			clipperScale: clipperScale
		});
		var proxyBounds = boundsForRing(proxy);
		var context = {
			source: source,
			fixed: cloneRing(source),
			proxy: proxy,
			singleBoundsArea: singleBoundsArea,
			singleHullArea: singleHullArea,
			proxyBoundsArea: proxyBounds.width * proxyBounds.height,
			proxyHullArea: Math.abs(polygonArea(convexHull(proxy))),
			metric: normalizedMetric(options.metric),
			curveTolerance: curveTolerance,
			clipperScale: clipperScale,
			areaEpsilon: 0,
			deadline: startedAt + budgetMs,
			coarseDeadline: startedAt + Math.max(25, Math.floor(budgetMs * 0.75)),
			proxyTests: 0,
			exactTests: 0
		};
		if(trace){
			trace.proxyPointCount = proxy.length;
		}

		var coarse = coarseCandidates(context, options);
		if(trace){
			trace.coarseCandidateCount = coarse.length;
			trace.proxyTests = context.proxyTests;
		}
		var best = exactBestFromProxy(
			context,
			coarse,
			options.exactShortlist || 32,
			null
		);
		if(!best && coarse.length > 0 && Date.now() < context.deadline){
			best = exactBestFromProxy(context, coarse, Math.min(coarse.length, 128), null);
		}
		if(!best){
			finishTrace('noExactCandidate', {
				deadlineHit: Date.now() >= context.deadline,
				proxyTests: context.proxyTests,
				exactTests: context.exactTests
			});
			return null;
		}

		if(Date.now() < context.deadline){
			var oneDegree = neighbourhoodCandidates(context, best, 5, 1, 16, 48);
			best = exactBestFromProxy(context, oneDegree, 16, best);
		}
		if(Date.now() < context.deadline){
			best = refineTranslation(context, best, 12);
		}
		if(Date.now() < context.deadline){
			var quarterDegree = neighbourhoodCandidates(context, best, 1, 0.25, 64, 32);
			best = exactBestFromProxy(context, quarterDegree, 8, best);
		}
		if(Date.now() < context.deadline){
			best = refineTranslation(context, best, 6);
		}

		var intersectionArea = exactIntersectionArea(context.fixed, best.moved, clipperScale);
		if(intersectionArea > 0){
			finishTrace('finalIntersection', {
				intersectionArea: intersectionArea,
				proxyTests: context.proxyTests,
				exactTests: context.exactTests
			});
			return null;
		}
		var envelope = buildCollisionEnvelope(
			context.fixed,
			best.moved,
			curveTolerance,
			clipperScale
		);
		if(!envelope || !envelope.polygon || envelope.polygon.length < 3){
			finishTrace('envelopeFailure', {
				proxyTests: context.proxyTests,
				exactTests: context.exactTests
			});
			return null;
		}

		var result = {
			angle: best.angle,
			offset: {x: best.offset.x, y: best.offset.y},
			gain: best.objectiveGain,
			objective: context.metric,
			objectiveScore: best.objectiveScore,
			gravityGain: best.gravityGain,
			hullGain: best.hullGain,
			bboxGain: best.bboxGain,
			pairHullArea: best.pairHullArea,
			pairBoundsArea: best.pairBoundsArea,
			pairGravityScore: best.pairGravityScore,
			singleHullArea: singleHullArea,
			singleBoundsArea: singleBoundsArea,
			unionPolygon: envelope.polygon,
			collisionEnvelope: envelope.polygon,
			envelopeMode: envelope.mode,
			envelopeExpansion: envelope.expansion,
			members: [
				{rotation: 0, offset: {x: 0, y: 0}},
				{rotation: best.angle, offset: {x: best.offset.x, y: best.offset.y}}
			],
			diagnostics: {
				cacheHit: false,
				elapsedMs: Date.now() - startedAt,
				budgetMs: budgetMs,
				deadlineHit: Date.now() >= context.deadline,
				proxyPointCount: proxy.length,
				proxyTests: context.proxyTests,
				exactTests: context.exactTests,
				exactIntersectionArea: intersectionArea,
				envelopeUnionError: envelope.exactUnionError || null
			}
		};
		if(cache){
			cache[cacheKey] = cloneValue(result);
		}
		finishTrace('paired', {
			paired: true,
			gain: result.gain,
			angle: result.angle,
			deadlineHit: result.diagnostics.deadlineHit,
			envelopeUnionError: result.diagnostics.envelopeUnionError,
			proxyTests: context.proxyTests,
			exactTests: context.exactTests
		});
		return result;
	}

	function composeMemberPlacement(placement, member, memberId, sourceIndex){
		var placementX = Number(placement && placement.x);
		var placementY = Number(placement && placement.y);
		var placementRotation = Number(placement && placement.rotation);
		var memberRotation = Number(member && member.rotation);
		var offsetX = Number(member && member.offset && member.offset.x);
		var offsetY = Number(member && member.offset && member.offset.y);
		if(!isFinite(placementX) || !isFinite(placementY) ||
			!isFinite(placementRotation) || !isFinite(memberRotation) ||
			!isFinite(offsetX) || !isFinite(offsetY)){
			return null;
		}
		var radians = placementRotation * Math.PI / 180;
		var cos = Math.cos(radians);
		var sin = Math.sin(radians);
		return {
			id: memberId,
			source: sourceIndex,
			x: placementX + offsetX * cos - offsetY * sin,
			y: placementY + offsetX * sin + offsetY * cos,
			rotation: normalizeAngle(placementRotation + memberRotation)
		};
	}

	function transformPlacementRing(ring, placement){
		var radians = placement.rotation * Math.PI / 180;
		var cos = Math.cos(radians);
		var sin = Math.sin(radians);
		var result = [];
		for(var i=0; i<ring.length; i++){
			result.push({
				x: ring[i].x * cos - ring[i].y * sin + placement.x,
				y: ring[i].x * sin + ring[i].y * cos + placement.y
			});
		}
		if(ring.children){
			result.children = [];
			for(var childIndex=0; childIndex<ring.children.length; childIndex++){
				result.children.push(transformPlacementRing(ring.children[childIndex], placement));
			}
		}
		return result;
	}

	function boundsDisjoint(left, right){
		var leftBounds = boundsForRing(left);
		var rightBounds = boundsForRing(right);
		return leftBounds.maxX <= rightBounds.x ||
			rightBounds.maxX <= leftBounds.x ||
			leftBounds.maxY <= rightBounds.y ||
			rightBounds.maxY <= leftBounds.y;
	}

	function validateExpandedPlacements(placementSheets, parts, options){
		options = options || {};
		var scale = Math.max(1000, finite(options.clipperScale, DEFAULT_CLIPPER_SCALE));
		var areaEpsilon = Math.max(0, finite(options.areaEpsilon, 0));
		var maxIntersectionArea = 0;
		var maxOutsideArea = 0;
		for(var sheetIndex=0; sheetIndex<placementSheets.length; sheetIndex++){
			var sheetPlacement = placementSheets[sheetIndex];
			var sheetPart = parts && parts[sheetPlacement.sheet];
			if(!sheetPart || !sheetPart.polygontree || sheetPart.polygontree.length < 3){
				return {valid: false, reason: 'missingSheetGeometry'};
			}
			var transformed = [];
			var placements = sheetPlacement.sheetplacements || [];
			for(var placementIndex=0; placementIndex<placements.length; placementIndex++){
				var placement = placements[placementIndex];
				var x = Number(placement && placement.x);
				var y = Number(placement && placement.y);
				var rotation = Number(placement && placement.rotation);
				var source = Number(placement && placement.source);
				if(!isFinite(x) || !isFinite(y) || !isFinite(rotation) ||
					!isFinite(source) || !parts[source] || !parts[source].polygontree){
					return {valid: false, reason: 'invalidMemberTransform'};
				}
				var ring = transformPlacementRing(parts[source].polygontree, {
					x: x,
					y: y,
					rotation: rotation
				});
				var outsideArea = exactClipArea(
					ring,
					sheetPart.polygontree,
					scale,
					ClipperLib.ClipType.ctDifference
				);
				maxOutsideArea = Math.max(maxOutsideArea, outsideArea);
				if(outsideArea > areaEpsilon){
					return {
						valid: false,
						reason: 'memberOutsideSheet',
						maxOutsideArea: maxOutsideArea
					};
				}
				for(var previousIndex=0; previousIndex<transformed.length; previousIndex++){
					if(boundsDisjoint(ring, transformed[previousIndex])){
						continue;
					}
					var intersectionArea = exactIntersectionArea(
						ring,
						transformed[previousIndex],
						scale
					);
					maxIntersectionArea = Math.max(maxIntersectionArea, intersectionArea);
					if(intersectionArea > areaEpsilon){
						return {
							valid: false,
							reason: 'expandedMembersOverlap',
							maxIntersectionArea: maxIntersectionArea
						};
					}
				}
				transformed.push(ring);
			}
		}
		return {
			valid: true,
			reason: null,
			maxIntersectionArea: maxIntersectionArea,
			maxOutsideArea: maxOutsideArea
		};
	}

	function clearCache(cache){
		var target = cache || internalCache;
		for(var key in target){
			if(Object.prototype.hasOwnProperty.call(target, key)){
				delete target[key];
			}
		}
	}

	return {
		findBestPair: findBestPair,
		exactIntersectionArea: exactIntersectionArea,
		buildCollisionEnvelope: buildCollisionEnvelope,
		composeMemberPlacement: composeMemberPlacement,
		validateExpandedPlacements: validateExpandedPlacements,
		cloneRing: cloneRing,
		translateRing: translateRing,
		materialArea: materialArea,
		theoreticalHullGain: theoreticalHullGain,
		clearCache: clearCache,
		DEFAULT_BUDGET_MS: DEFAULT_BUDGET_MS,
		DEFAULT_MIN_GAIN: DEFAULT_MIN_GAIN
	};
}));

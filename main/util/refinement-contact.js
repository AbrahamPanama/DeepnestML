/*
 * Sampled boundary-contact scoring for local-refinement plateau ranking.
 * This is only a ranking signal; exact containment and overlap checks remain
 * responsible for legality.
 */

(function(root){
	'use strict';

	function finite(value, fallback){
		value = Number(value);
		return isFinite(value) ? value : fallback;
	}

	function clamp(value, low, high){
		return Math.max(low, Math.min(high, value));
	}

	function ringBounds(ring){
		if(!ring || ring.length === 0){
			return null;
		}
		var minX = Infinity;
		var minY = Infinity;
		var maxX = -Infinity;
		var maxY = -Infinity;
		for(var i=0; i<ring.length; i++){
			var x = finite(ring[i].x, 0);
			var y = finite(ring[i].y, 0);
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
		return {
			x: minX,
			y: minY,
			width: maxX - minX,
			height: maxY - minY
		};
	}

	function pointSegmentDistanceSquared(point, a, b){
		var dx = b.x - a.x;
		var dy = b.y - a.y;
		var lengthSquared = dx * dx + dy * dy;
		if(lengthSquared <= 0){
			dx = point.x - a.x;
			dy = point.y - a.y;
			return dx * dx + dy * dy;
		}
		var t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
		t = clamp(t, 0, 1);
		var px = a.x + t * dx;
		var py = a.y + t * dy;
		dx = point.x - px;
		dy = point.y - py;
		return dx * dx + dy * dy;
	}

	function appendRingSegments(ring, result){
		if(!ring || ring.length < 2){
			return result;
		}
		for(var i=0; i<ring.length; i++){
			var next = i === ring.length - 1 ? 0 : i + 1;
			result.push({a: ring[i], b: ring[next]});
		}
		if(ring.children && ring.children.length > 0){
			for(i=0; i<ring.children.length; i++){
				appendRingSegments(ring.children[i], result);
			}
		}
		return result;
	}

	function collectSegments(polygons){
		var result = [];
		for(var i=0; i<(polygons || []).length; i++){
			appendRingSegments(polygons[i], result);
		}
		return result;
	}

	function sampleRingBoundary(ring, step, callback){
		if(!ring || ring.length < 2){
			return 0;
		}
		var segments = [];
		var perimeter = 0;
		for(var i=0; i<ring.length; i++){
			var next = i === ring.length - 1 ? 0 : i + 1;
			var a = ring[i];
			var b = ring[next];
			var dx = b.x - a.x;
			var dy = b.y - a.y;
			var length = Math.sqrt(dx * dx + dy * dy);
			if(length <= 0){
				continue;
			}
			segments.push({a: a, dx: dx, dy: dy, length: length, start: perimeter});
			perimeter += length;
		}
		var samples = 0;
		if(perimeter > 0){
			var count = Math.max(1, Math.ceil(perimeter / step));
			var segmentIndex = 0;
			for(var s=0; s<count; s++){
				var distance = (s + 0.5) * perimeter / count;
				while(segmentIndex + 1 < segments.length &&
					distance > segments[segmentIndex].start + segments[segmentIndex].length){
					segmentIndex++;
				}
				var segment = segments[segmentIndex];
				var t = clamp((distance - segment.start) / segment.length, 0, 1);
				callback({
					x: segment.a.x + t * segment.dx,
					y: segment.a.y + t * segment.dy
				});
				samples++;
			}
		}
		if(ring.children && ring.children.length > 0){
			for(i=0; i<ring.children.length; i++){
				samples += sampleRingBoundary(ring.children[i], step, callback);
			}
		}
		return samples;
	}

	function segmentCellKey(x, y){
		return x + ':' + y;
	}

	function buildSegmentIndex(segments, cellSize, inflate){
		var cells = {};
		for(var i=0; i<segments.length; i++){
			var segment = segments[i];
			var minX = Math.floor((Math.min(segment.a.x, segment.b.x) - inflate) / cellSize);
			var minY = Math.floor((Math.min(segment.a.y, segment.b.y) - inflate) / cellSize);
			var maxX = Math.floor((Math.max(segment.a.x, segment.b.x) + inflate) / cellSize);
			var maxY = Math.floor((Math.max(segment.a.y, segment.b.y) + inflate) / cellSize);
			for(var x=minX; x<=maxX; x++){
				for(var y=minY; y<=maxY; y++){
					var key = segmentCellKey(x, y);
					if(!cells[key]){
						cells[key] = [];
					}
					cells[key].push(i);
				}
			}
		}
		return {
			cellSize: cellSize,
			cells: cells,
			segments: segments
		};
	}

	function indexedSegments(point, index){
		var key = segmentCellKey(
			Math.floor(point.x / index.cellSize),
			Math.floor(point.y / index.cellSize)
		);
		var ids = index.cells[key] || [];
		var result = [];
		for(var i=0; i<ids.length; i++){
			result.push(index.segments[ids[i]]);
		}
		return result;
	}

	function minDistanceSquared(point, segments, stopAtSquared){
		var best = Infinity;
		for(var i=0; i<segments.length; i++){
			var distance = pointSegmentDistanceSquared(point, segments[i].a, segments[i].b);
			if(distance < best){
				best = distance;
				if(best <= stopAtSquared){
					return best;
				}
			}
		}
		return best;
	}

	function contactScore(subjectPolygonWorld, neighbourPolygonsWorld, sheetPolygon, opts){
		opts = opts || {};
		var bounds = ringBounds(subjectPolygonWorld);
		if(!bounds){
			return {length: 0, samples: 0};
		}
		var bboxDiag = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height);
		bboxDiag = bboxDiag > 0 ? bboxDiag : 1;
		var curveTolerance = Math.max(1e-9, finite(opts.curveTolerance, 0));
		var requestedDiag = finite(opts.bboxDiag, 0);
		var toleranceDiag = requestedDiag > 0 ? requestedDiag : bboxDiag;
		var configuredStep = finite(opts.step, 0);
		var step = configuredStep > 0 ? configuredStep :
			clamp(curveTolerance, toleranceDiag / 64, toleranceDiag / 16);
		var spacing = Math.max(0, finite(opts.spacing, 0));
		var contactTolerance = Math.max(curveTolerance, 1e-3 * toleranceDiag);
		var threshold = spacing + contactTolerance;
		var thresholdSquared = threshold * threshold;
		var polygons = (neighbourPolygonsWorld || []).slice();
		if(sheetPolygon){
			polygons.push(sheetPolygon);
		}
		var segments = collectSegments(polygons);
		if(segments.length === 0){
			return {length: 0, samples: 0};
		}
		var segmentIndex = buildSegmentIndex(
			segments,
			Math.max(step, threshold, 1e-9),
			threshold
		);
		var contacts = 0;
		var samples = sampleRingBoundary(subjectPolygonWorld, step, function(point){
			var nearby = indexedSegments(point, segmentIndex);
			if(nearby.length > 0 &&
				minDistanceSquared(point, nearby, thresholdSquared) <= thresholdSquared){
				contacts++;
			}
		});
		var result = {
			length: contacts * step,
			samples: samples
		};
		return result;
	}

	function acceptanceDecision(primaryBefore, primaryAfter, contactBefore, contactAfter, opts){
		opts = opts || {};
		primaryBefore = finite(primaryBefore, Infinity);
		primaryAfter = finite(primaryAfter, Infinity);
		contactBefore = Math.max(0, finite(contactBefore, 0));
		contactAfter = Math.max(0, finite(contactAfter, 0));
		if(!isFinite(primaryAfter)){
			return 'reject';
		}
		if(!isFinite(primaryBefore)){
			return 'primary';
		}
		var relativePrimary = Math.max(0, finite(opts.epsPrimary, 1e-6));
		var relativeContact = Math.max(0, finite(opts.epsContact, 1e-3));
		var primaryTolerance = Math.max(1e-12, Math.abs(primaryBefore) * relativePrimary);
		var delta = primaryAfter - primaryBefore;
		if(delta < -primaryTolerance){
			return 'primary';
		}
		if(Math.abs(delta) <= primaryTolerance){
			var requiredContact = contactBefore <= 0 ?
				Math.max(1e-12, relativeContact) :
				contactBefore * (1 + relativeContact);
			if(contactAfter > requiredContact){
				return 'plateau';
			}
		}
		return 'reject';
	}

	var api = {
		contactScore: contactScore,
		pointSegmentDistanceSquared: pointSegmentDistanceSquared,
		acceptanceDecision: acceptanceDecision
	};

	root.RefinementContact = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));

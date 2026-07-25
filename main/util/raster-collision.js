/*
 * Conservative raster collision predicates.
 *
 * The outer mask over-approximates polygon material and the inner mask
 * under-approximates it. A disjoint outer pair is therefore provably disjoint,
 * while an intersecting inner pair is provably overlapping. All other cases
 * must fall through to exact geometry.
 */

(function(root){
	'use strict';

	var DEFAULT_RASTER_DIVISOR = 64;
	// Target ambiguous fraction for the derived resolution policy (plan §3.2).
	var DEFAULT_TARGET_AMBIGUITY = 0.30;
	var MORPHOLOGY_RADIUS = 1;

	function finite(value, fallback){
		value = Number(value);
		return isFinite(value) ? value : fallback;
	}

	function clamp(value, low, high){
		return Math.max(low, Math.min(high, value));
	}

	function polygonRoot(polygon){
		if(Array.isArray(polygon)){
			return polygon;
		}
		if(polygon && Array.isArray(polygon.outer)){
			var outer = polygon.outer;
			if(!outer.children && Array.isArray(polygon.holes)){
				outer = outer.slice();
				outer.children = polygon.holes;
			}
			return outer;
		}
		return null;
	}

	function collectRings(ring, result){
		if(!ring || ring.length < 3){
			return result;
		}
		result.push(ring);
		if(ring.children){
			for(var i=0; i<ring.children.length; i++){
				collectRings(ring.children[i], result);
			}
		}
		return result;
	}

	function polygonBounds(polygon){
		var rootRing = polygonRoot(polygon);
		var rings = collectRings(rootRing, []);
		if(rings.length === 0){
			return null;
		}
		var minX = Infinity;
		var minY = Infinity;
		var maxX = -Infinity;
		var maxY = -Infinity;
		for(var r=0; r<rings.length; r++){
			for(var i=0; i<rings[r].length; i++){
				var x = finite(rings[r][i].x, 0);
				var y = finite(rings[r][i].y, 0);
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
		}
		return {
			x: minX,
			y: minY,
			width: maxX - minX,
			height: maxY - minY
		};
	}

	function coordinateEpsilon(){
		var scale = 1;
		for(var i=0; i<arguments.length; i++){
			scale = Math.max(scale, Math.abs(finite(arguments[i], 0)));
		}
		return 1e-12 * scale;
	}

	function pointOnSegment(point, a, b){
		var dx = b.x - a.x;
		var dy = b.y - a.y;
		var px = point.x - a.x;
		var py = point.y - a.y;
		var epsilon = coordinateEpsilon(
			point.x, point.y, a.x, a.y, b.x, b.y, dx, dy
		);
		var cross = px * dy - py * dx;
		if(Math.abs(cross) > epsilon * Math.max(1, Math.abs(dx) + Math.abs(dy))){
			return false;
		}
		var dot = px * dx + py * dy;
		if(dot < -epsilon){
			return false;
		}
		var lengthSquared = dx * dx + dy * dy;
		return dot <= lengthSquared + epsilon;
	}

	function orientation(a, b, c){
		var value = (b.x - a.x) * (c.y - a.y) -
			(b.y - a.y) * (c.x - a.x);
		var epsilon = coordinateEpsilon(
			a.x, a.y, b.x, b.y, c.x, c.y
		) * Math.max(
			1,
			Math.abs(b.x - a.x) + Math.abs(b.y - a.y),
			Math.abs(c.x - a.x) + Math.abs(c.y - a.y)
		);
		if(Math.abs(value) <= epsilon){
			return 0;
		}
		return value < 0 ? -1 : 1;
	}

	function segmentsIntersect(a, b, c, d){
		var o1 = orientation(a, b, c);
		var o2 = orientation(a, b, d);
		var o3 = orientation(c, d, a);
		var o4 = orientation(c, d, b);
		if(o1 !== o2 && o3 !== o4){
			return true;
		}
		return (o1 === 0 && pointOnSegment(c, a, b)) ||
			(o2 === 0 && pointOnSegment(d, a, b)) ||
			(o3 === 0 && pointOnSegment(a, c, d)) ||
			(o4 === 0 && pointOnSegment(b, c, d));
	}

	function pointInRect(point, minX, minY, maxX, maxY){
		var epsilon = coordinateEpsilon(
			point.x, point.y, minX, minY, maxX, maxY
		);
		return point.x >= minX - epsilon &&
			point.x <= maxX + epsilon &&
			point.y >= minY - epsilon &&
			point.y <= maxY + epsilon;
	}

	function segmentIntersectsRect(a, b, minX, minY, maxX, maxY){
		var epsilon = coordinateEpsilon(
			a.x, a.y, b.x, b.y, minX, minY, maxX, maxY
		);
		if(Math.max(a.x, b.x) < minX - epsilon ||
			Math.min(a.x, b.x) > maxX + epsilon ||
			Math.max(a.y, b.y) < minY - epsilon ||
			Math.min(a.y, b.y) > maxY + epsilon){
			return false;
		}
		if(pointInRect(a, minX, minY, maxX, maxY) ||
			pointInRect(b, minX, minY, maxX, maxY)){
			return true;
		}
		var topLeft = {x: minX, y: minY};
		var topRight = {x: maxX, y: minY};
		var bottomRight = {x: maxX, y: maxY};
		var bottomLeft = {x: minX, y: maxY};
		return segmentsIntersect(a, b, topLeft, topRight) ||
			segmentsIntersect(a, b, topRight, bottomRight) ||
			segmentsIntersect(a, b, bottomRight, bottomLeft) ||
			segmentsIntersect(a, b, bottomLeft, topLeft);
	}

	function markBoundaryCells(rings, pixelSize, gridOx, gridOy, width, height){
		var boundary = new Uint8Array(width * height);
		for(var r=0; r<rings.length; r++){
			var ring = rings[r];
			for(var i=0; i<ring.length; i++){
				var a = ring[i];
				var b = ring[(i + 1) % ring.length];
				var minCellX = Math.floor(Math.min(a.x, b.x) / pixelSize) - 1;
				var maxCellX = Math.floor(Math.max(a.x, b.x) / pixelSize) + 1;
				var minCellY = Math.floor(Math.min(a.y, b.y) / pixelSize) - 1;
				var maxCellY = Math.floor(Math.max(a.y, b.y) / pixelSize) + 1;
				minCellX = Math.max(gridOx, minCellX);
				maxCellX = Math.min(gridOx + width - 1, maxCellX);
				minCellY = Math.max(gridOy, minCellY);
				maxCellY = Math.min(gridOy + height - 1, maxCellY);
				for(var cellY=minCellY; cellY<=maxCellY; cellY++){
					var rectMinY = cellY * pixelSize;
					var rectMaxY = rectMinY + pixelSize;
					for(var cellX=minCellX; cellX<=maxCellX; cellX++){
						var rectMinX = cellX * pixelSize;
						var rectMaxX = rectMinX + pixelSize;
						if(segmentIntersectsRect(
							a, b, rectMinX, rectMinY, rectMaxX, rectMaxY
						)){
							boundary[(cellY - gridOy) * width + cellX - gridOx] = 1;
						}
					}
				}
			}
		}
		return boundary;
	}

	function scanlineIntersections(rings, worldY){
		var intersections = [];
		for(var r=0; r<rings.length; r++){
			var ring = rings[r];
			for(var i=0; i<ring.length; i++){
				var a = ring[i];
				var b = ring[(i + 1) % ring.length];
				if((a.y > worldY) !== (b.y > worldY)){
					intersections.push(
						a.x + (worldY - a.y) * (b.x - a.x) / (b.y - a.y)
					);
				}
			}
		}
		intersections.sort(function(a, b){
			return a - b;
		});
		return intersections;
	}

	function buildBaseFields(polygon, pixelSize){
		var rootRing = polygonRoot(polygon);
		var rings = collectRings(rootRing, []);
		var bounds = polygonBounds(rootRing);
		if(!bounds || rings.length === 0){
			return null;
		}
		var padding = MORPHOLOGY_RADIUS + 1;
		var gridOx = Math.floor(bounds.x / pixelSize) - padding;
		var gridOy = Math.floor(bounds.y / pixelSize) - padding;
		var maxCellX = Math.ceil((bounds.x + bounds.width) / pixelSize) + padding;
		var maxCellY = Math.ceil((bounds.y + bounds.height) / pixelSize) + padding;
		var width = Math.max(1, maxCellX - gridOx);
		var height = Math.max(1, maxCellY - gridOy);
		var boundary = markBoundaryCells(
			rings, pixelSize, gridOx, gridOy, width, height
		);
		var touched = new Uint8Array(width * height);
		var full = new Uint8Array(width * height);
		for(var y=0; y<height; y++){
			var worldY = (gridOy + y + 0.5) * pixelSize;
			var intersections = scanlineIntersections(rings, worldY);
			var crossing = 0;
			var inside = false;
			for(var x=0; x<width; x++){
				var index = y * width + x;
				var worldX = (gridOx + x + 0.5) * pixelSize;
				while(crossing < intersections.length &&
					intersections[crossing] <= worldX){
					inside = !inside;
					crossing++;
				}
				if(boundary[index]){
					touched[index] = 1;
					continue;
				}
				if(inside){
					touched[index] = 1;
					full[index] = 1;
				}
			}
		}
		return {
			ox: gridOx,
			oy: gridOy,
			w: width,
			h: height,
			touched: touched,
			full: full
		};
	}

	function dilate(field, width, height){
		var result = new Uint8Array(width * height);
		for(var y=0; y<height; y++){
			for(var x=0; x<width; x++){
				if(!field[y * width + x]){
					continue;
				}
				for(var dy=-MORPHOLOGY_RADIUS; dy<=MORPHOLOGY_RADIUS; dy++){
					var targetY = y + dy;
					if(targetY < 0 || targetY >= height){
						continue;
					}
					for(var dx=-MORPHOLOGY_RADIUS; dx<=MORPHOLOGY_RADIUS; dx++){
						var targetX = x + dx;
						if(targetX >= 0 && targetX < width){
							result[targetY * width + targetX] = 1;
						}
					}
				}
			}
		}
		return result;
	}

	function erode(field, width, height){
		var result = new Uint8Array(width * height);
		for(var y=MORPHOLOGY_RADIUS; y<height-MORPHOLOGY_RADIUS; y++){
			for(var x=MORPHOLOGY_RADIUS; x<width-MORPHOLOGY_RADIUS; x++){
				var survives = true;
				for(var dy=-MORPHOLOGY_RADIUS; dy<=MORPHOLOGY_RADIUS && survives; dy++){
					for(var dx=-MORPHOLOGY_RADIUS; dx<=MORPHOLOGY_RADIUS; dx++){
						if(!field[(y + dy) * width + x + dx]){
							survives = false;
							break;
						}
					}
				}
				if(survives){
					result[y * width + x] = 1;
				}
			}
		}
		return result;
	}

	function emptyMask(pixelSize, mode){
		return {
			w: 0,
			h: 0,
			ox: 0,
			oy: 0,
			stride: 0,
			pixelSize: pixelSize,
			mode: mode,
			bits: new Uint32Array(0)
		};
	}

	function packField(field, width, height, gridOx, gridOy, pixelSize, mode){
		var minX = width;
		var minY = height;
		var maxX = -1;
		var maxY = -1;
		for(var y=0; y<height; y++){
			for(var x=0; x<width; x++){
				if(field[y * width + x]){
					minX = Math.min(minX, x);
					minY = Math.min(minY, y);
					maxX = Math.max(maxX, x);
					maxY = Math.max(maxY, y);
				}
			}
		}
		if(maxX < minX || maxY < minY){
			return emptyMask(pixelSize, mode);
		}
		var packedWidth = maxX - minX + 1;
		var packedHeight = maxY - minY + 1;
		var stride = Math.ceil(packedWidth / 32);
		var bits = new Uint32Array(stride * packedHeight);
		for(y=minY; y<=maxY; y++){
			for(x=minX; x<=maxX; x++){
				if(field[y * width + x]){
					var localX = x - minX;
					var localY = y - minY;
					bits[localY * stride + (localX >>> 5)] |=
						(1 << (localX & 31));
				}
			}
		}
		return {
			w: packedWidth,
			h: packedHeight,
			ox: gridOx + minX,
			oy: gridOy + minY,
			stride: stride,
			pixelSize: pixelSize,
			mode: mode,
			bits: bits
		};
	}

	function rasterise(polygon, pixelSize, mode){
		pixelSize = finite(pixelSize, 0);
		if(pixelSize <= 0){
			throw new Error('pixelSize must be positive');
		}
		if(mode !== 'outer' && mode !== 'inner'){
			throw new Error('mode must be outer or inner');
		}
		var base = buildBaseFields(polygon, pixelSize);
		if(!base){
			return emptyMask(pixelSize, mode);
		}
		var field = mode === 'outer' ?
			dilate(base.touched, base.w, base.h) :
			erode(base.full, base.w, base.h);
		return packField(
			field,
			base.w,
			base.h,
			base.ox,
			base.oy,
			pixelSize,
			mode
		);
	}

	function rasterisePair(polygon, pixelSize){
		pixelSize = finite(pixelSize, 0);
		if(pixelSize <= 0){
			throw new Error('pixelSize must be positive');
		}
		var base = buildBaseFields(polygon, pixelSize);
		if(!base){
			return {
				outer: emptyMask(pixelSize, 'outer'),
				inner: emptyMask(pixelSize, 'inner')
			};
		}
		return {
			outer: packField(
				dilate(base.touched, base.w, base.h),
				base.w,
				base.h,
				base.ox,
				base.oy,
				pixelSize,
				'outer'
			),
			inner: packField(
				erode(base.full, base.w, base.h),
				base.w,
				base.h,
				base.ox,
				base.oy,
				pixelSize,
				'inner'
			)
		};
	}

	function compatiblePixelSize(maskA, maskB){
		var a = finite(maskA && maskA.pixelSize, 0);
		var b = finite(maskB && maskB.pixelSize, 0);
		var tolerance = 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
		if(a <= 0 || b <= 0 || Math.abs(a - b) > tolerance){
			throw new Error('raster masks must use the same positive pixelSize');
		}
		return a;
	}

	function roundedOffset(offset, pixelSize){
		offset = offset || {};
		return {
			x: Math.round(finite(offset.x, 0) / pixelSize),
			y: Math.round(finite(offset.y, 0) / pixelSize)
		};
	}

	function readWord(mask, row, startX){
		if(row < 0 || row >= mask.h || startX >= mask.w || startX + 32 <= 0){
			return 0;
		}
		if(startX < 0){
			if(startX <= -32){
				return 0;
			}
			return (readWord(mask, row, 0) << -startX) >>> 0;
		}
		var wordIndex = startX >>> 5;
		var shift = startX & 31;
		var rowStart = row * mask.stride;
		var value = mask.bits[rowStart + wordIndex] >>> shift;
		if(shift && wordIndex + 1 < mask.stride){
			value |= mask.bits[rowStart + wordIndex + 1] << (32 - shift);
		}
		return value >>> 0;
	}

	function tailMask(count){
		return count >= 32 ? 0xffffffff : (Math.pow(2, count) - 1) >>> 0;
	}

	function intersects(maskA, offsetA, maskB, offsetB){
		var pixelSize = compatiblePixelSize(maskA, maskB);
		if(maskA.w === 0 || maskA.h === 0 || maskB.w === 0 || maskB.h === 0){
			return false;
		}
		var shiftA = roundedOffset(offsetA, pixelSize);
		var shiftB = roundedOffset(offsetB, pixelSize);
		var ax = maskA.ox + shiftA.x;
		var ay = maskA.oy + shiftA.y;
		var bx = maskB.ox + shiftB.x;
		var by = maskB.oy + shiftB.y;
		var startX = Math.max(ax, bx);
		var startY = Math.max(ay, by);
		var endX = Math.min(ax + maskA.w, bx + maskB.w);
		var endY = Math.min(ay + maskA.h, by + maskB.h);
		if(startX >= endX || startY >= endY){
			return false;
		}
		for(var globalY=startY; globalY<endY; globalY++){
			var rowA = globalY - ay;
			var rowB = globalY - by;
			for(var globalX=startX; globalX<endX; globalX+=32){
				var count = Math.min(32, endX - globalX);
				var wordA = readWord(maskA, rowA, globalX - ax);
				var wordB = readWord(maskB, rowB, globalX - bx);
				if(((wordA & wordB) & tailMask(count)) !== 0){
					return true;
				}
			}
		}
		return false;
	}

	/*
	 * sheetMask must be an inner mask. If every conservative part-outer pixel is
	 * inside it, continuous polygon containment is guaranteed.
	 */
	function contains(sheetMask, partOuter, offset){
		var pixelSize = compatiblePixelSize(sheetMask, partOuter);
		if(partOuter.w === 0 || partOuter.h === 0){
			return true;
		}
		if(sheetMask.w === 0 || sheetMask.h === 0){
			return false;
		}
		var shift = roundedOffset(offset, pixelSize);
		var partX = partOuter.ox + shift.x;
		var partY = partOuter.oy + shift.y;
		var sheetX = sheetMask.ox;
		var sheetY = sheetMask.oy;
		for(var y=0; y<partOuter.h; y++){
			var sheetRow = partY + y - sheetY;
			for(var x=0; x<partOuter.w; x+=32){
				var count = Math.min(32, partOuter.w - x);
				var partWord = readWord(partOuter, y, x) & tailMask(count);
				if(partWord === 0){
					continue;
				}
				var sheetWord = readWord(
					sheetMask,
					sheetRow,
					partX + x - sheetX
				);
				if((partWord & (~sheetWord)) !== 0){
					return false;
				}
			}
		}
		return true;
	}

	function classify(outerA, innerA, offsetA, outerB, innerB, offsetB){
		if(!intersects(outerA, offsetA, outerB, offsetB)){
			return 'disjoint';
		}
		if(intersects(innerA, offsetA, innerB, offsetB)){
			return 'overlap';
		}
		return 'ambiguous';
	}

	// Signed area (shoelace) and perimeter of a single ring.
	function ringAreaAbs(ring){
		if(!ring || ring.length < 3){
			return 0;
		}
		var total = 0;
		for(var i=0, j=ring.length-1; i<ring.length; j=i++){
			total += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
		}
		return Math.abs(total / 2);
	}

	function ringPerimeter(ring){
		if(!ring || ring.length < 2){
			return 0;
		}
		var total = 0;
		for(var i=0, j=ring.length-1; i<ring.length; j=i++){
			var dx = ring[i].x - ring[j].x;
			var dy = ring[i].y - ring[j].y;
			total += Math.sqrt(dx * dx + dy * dy);
		}
		return total;
	}

	// Derived resolution policy (see docs/raster-collision-plan.md §3.2).
	//
	// The ambiguous band is one pixel wide around the boundary, so for material
	// area A and total boundary length P the ambiguous fraction is ~ P*p/A.
	// Solving for a target ambiguity alpha gives p = alpha * A / P, which
	// self-adapts to shape: high perimeter-to-area parts (slender branches) get
	// fine pixels, compact parts stay coarse, and memory is spent only where it
	// buys resolution. Holes count toward BOTH terms — they remove material and
	// add boundary — which is what makes slotted parts behave sensibly.
	//
	// Masks in a pair must share a pixel size (see compatiblePixelSize), so the
	// job-wide size is the most demanding part's.
	function chooseShapePixelSize(polygons, curveTolerance, targetAmbiguity){
		polygons = polygons || [];
		var alpha = finite(targetAmbiguity, DEFAULT_TARGET_AMBIGUITY);
		if(!(alpha > 0)){
			alpha = DEFAULT_TARGET_AMBIGUITY;
		}
		var smallest = Infinity;
		var minDiagonal = Infinity;
		for(var i=0; i<polygons.length; i++){
			var polygon = polygons[i];
			var bounds = polygonBounds(polygon);
			if(!bounds){
				continue;
			}
			var diagonal = Math.sqrt(
				bounds.width * bounds.width + bounds.height * bounds.height
			);
			if(diagonal > 0){
				minDiagonal = Math.min(minDiagonal, diagonal);
			}
			var area = ringAreaAbs(polygon);
			var perimeter = ringPerimeter(polygon);
			if(polygon && polygon.children){
				for(var c=0; c<polygon.children.length; c++){
					area -= ringAreaAbs(polygon.children[c]);
					perimeter += ringPerimeter(polygon.children[c]);
				}
			}
			if(!(area > 0) || !(perimeter > 0)){
				continue;
			}
			smallest = Math.min(smallest, alpha * (area / perimeter));
		}
		var finest = Math.max(1e-9, finite(curveTolerance, 0) / 2);
		if(!isFinite(smallest)){
			return isFinite(minDiagonal) ? Math.max(finest, minDiagonal / 16) : finest;
		}
		var coarsest = isFinite(minDiagonal) ? minDiagonal / 16 : smallest;
		if(finest > coarsest){
			return coarsest;
		}
		return clamp(smallest, finest, coarsest);
	}

	// Combined policy: take the FINER of the size-based and shape-based rules.
	//
	// Measured 2026-07-25, they have complementary blind spots. The size rule
	// (minDiag/divisor) is calibrated for compact parts and goes far too coarse on
	// slender ones (laurel 55.8% ambiguous at divisor 64). The shape rule
	// (alpha*area/perimeter) fixes slender parts (6.12%) but is too coarse for
	// several compact ESICUP instances (corpus 25.9% vs 18.8%). Neither dominates,
	// and a min() costs nothing but a second evaluation.
	function chooseAdaptivePixelSize(polygons, curveTolerance, rasterDivisor, targetAmbiguity){
		var bySize = choosePixelSize(polygons, curveTolerance, rasterDivisor);
		var byShape = chooseShapePixelSize(polygons, curveTolerance, targetAmbiguity);
		if(!isFinite(bySize)){
			return byShape;
		}
		if(!isFinite(byShape)){
			return bySize;
		}
		return Math.min(bySize, byShape);
	}

	function choosePixelSize(polygons, curveTolerance, rasterDivisor){
		polygons = polygons || [];
		rasterDivisor = Math.max(1, finite(
			rasterDivisor, DEFAULT_RASTER_DIVISOR
		));
		var minDiagonal = Infinity;
		for(var i=0; i<polygons.length; i++){
			var bounds = polygonBounds(polygons[i]);
			if(!bounds){
				continue;
			}
			var diagonal = Math.sqrt(
				bounds.width * bounds.width + bounds.height * bounds.height
			);
			if(diagonal > 0){
				minDiagonal = Math.min(minDiagonal, diagonal);
			}
		}
		if(!isFinite(minDiagonal)){
			return Math.max(1e-9, finite(curveTolerance, 0) / 2);
		}
		var finest = Math.max(1e-9, finite(curveTolerance, 0) / 2);
		var coarsest = minDiagonal / 16;
		if(finest > coarsest){
			return coarsest;
		}
		return clamp(minDiagonal / rasterDivisor, finest, coarsest);
	}

	function maskBytes(mask){
		return mask && mask.bits ? mask.bits.byteLength : 0;
	}

	var api = {
		rasterise: rasterise,
		rasterisePair: rasterisePair,
		intersects: intersects,
		contains: contains,
		classify: classify,
		choosePixelSize: choosePixelSize,
		chooseShapePixelSize: chooseShapePixelSize,
		chooseAdaptivePixelSize: chooseAdaptivePixelSize,
		polygonBounds: polygonBounds,
		maskBytes: maskBytes,
		DEFAULT_RASTER_DIVISOR: DEFAULT_RASTER_DIVISOR,
		DEFAULT_TARGET_AMBIGUITY: DEFAULT_TARGET_AMBIGUITY
	};

	root.RasterCollision = api;
	if(typeof module !== 'undefined' && module.exports){
		module.exports = api;
	}
}(typeof self !== 'undefined' ? self : this));

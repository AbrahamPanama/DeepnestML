'use strict';

function clonePoint(point) {
	return { x: Number(point.x), y: Number(point.y) };
}

function pointFromPair(pair) {
	return { x: Number(pair[0]), y: Number(pair[1]) };
}

function almostEqual(a, b) {
	return Math.abs(a - b) <= 1e-9;
}

function normalizeRingFromPairs(pairs) {
	if (!Array.isArray(pairs) || pairs.length < 3) {
		throw new Error('invalid polygon ring');
	}

	var ring = [];
	for (var i = 0; i < pairs.length; i++) {
		ring.push(pointFromPair(pairs[i]));
	}

	if (ring.length > 1) {
		var first = ring[0];
		var last = ring[ring.length - 1];
		if (almostEqual(first.x, last.x) && almostEqual(first.y, last.y)) {
			ring.pop();
		}
	}

	if (ring.length < 3) {
		throw new Error('degenerate polygon ring');
	}

	return ring;
}

function rectangleToRing(rect) {
	var x = Number(rect.x_min || 0);
	var y = Number(rect.y_min || 0);
	var width = Number(rect.width);
	var height = Number(rect.height);
	if (!isFinite(width) || !isFinite(height) || width <= 0 || height <= 0) {
		throw new Error('invalid rectangle shape');
	}
	return [
		{ x: x, y: y },
		{ x: x + width, y: y },
		{ x: x + width, y: y + height },
		{ x: x, y: y + height }
	];
}

function normalizeShape(shape) {
	if (!shape || !shape.type) {
		throw new Error('missing item shape');
	}

	if (shape.type === 'simple_polygon') {
		return {
			outer: normalizeRingFromPairs(shape.data),
			holes: []
		};
	}

	if (shape.type === 'rectangle') {
		return {
			outer: rectangleToRing(shape.data || {}),
			holes: []
		};
	}

	if (shape.type === 'polygon') {
		var data = shape.data || {};
		return {
			outer: normalizeRingFromPairs(data.outer),
			holes: (data.inner || []).map(normalizeRingFromPairs)
		};
	}

	throw new Error('unsupported jagua shape type: ' + shape.type);
}

function polygonArea(ring) {
	var area = 0;
	for (var i = 0; i < ring.length; i++) {
		var current = ring[i];
		var next = ring[(i + 1) % ring.length];
		area += (current.x * next.y) - (next.x * current.y);
	}
	return area / 2;
}

function shapeArea(shape) {
	var area = Math.abs(polygonArea(shape.outer));
	for (var i = 0; i < shape.holes.length; i++) {
		area -= Math.abs(polygonArea(shape.holes[i]));
	}
	return area;
}

function boundsForRing(ring) {
	var minX = ring[0].x;
	var maxX = ring[0].x;
	var minY = ring[0].y;
	var maxY = ring[0].y;

	for (var i = 1; i < ring.length; i++) {
		minX = Math.min(minX, ring[i].x);
		maxX = Math.max(maxX, ring[i].x);
		minY = Math.min(minY, ring[i].y);
		maxY = Math.max(maxY, ring[i].y);
	}

	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}

function mergeBounds(a, b) {
	var minX = Math.min(a.x, b.x);
	var minY = Math.min(a.y, b.y);
	var maxX = Math.max(a.x + a.width, b.x + b.width);
	var maxY = Math.max(a.y + a.height, b.y + b.height);
	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}

function boundsForShape(shape) {
	var bounds = boundsForRing(shape.outer);
	for (var i = 0; i < shape.holes.length; i++) {
		bounds = mergeBounds(bounds, boundsForRing(shape.holes[i]));
	}
	return bounds;
}

function translateRing(ring, offset) {
	var translated = [];
	for (var i = 0; i < ring.length; i++) {
		translated.push({
			x: ring[i].x + offset.x,
			y: ring[i].y + offset.y
		});
	}
	return translated;
}

function translateShape(shape, offset) {
	return {
		outer: translateRing(shape.outer, offset),
		holes: shape.holes.map(function (hole) {
			return translateRing(hole, offset);
		})
	};
}

function formatNumber(value) {
	var number = Number(value);
	if (!isFinite(number)) {
		number = 0;
	}
	return Number(number.toFixed(6)).toString();
}

function escapeAttr(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function ringPath(ring) {
	var path = [];
	for (var i = 0; i < ring.length; i++) {
		path.push((i === 0 ? 'M ' : 'L ') + formatNumber(ring[i].x) + ' ' + formatNumber(ring[i].y));
	}
	path.push('Z');
	return path.join(' ');
}

function shapePath(shape) {
	var parts = [ringPath(shape.outer)];
	for (var i = 0; i < shape.holes.length; i++) {
		parts.push(ringPath(shape.holes[i]));
	}
	return parts.join(' ');
}

function normalizeInstance(instanceJson) {
	if (!instanceJson || !Array.isArray(instanceJson.items)) {
		throw new Error('invalid jagua instance: missing items');
	}
	var stripHeight = Number(instanceJson.strip_height);
	if (!isFinite(stripHeight) || stripHeight <= 0) {
		throw new Error('invalid jagua instance: missing strip_height');
	}

	var items = [];
	var totalArea = 0;
	var totalDemand = 0;

	for (var i = 0; i < instanceJson.items.length; i++) {
		var item = instanceJson.items[i];
		var shape = normalizeShape(item.shape);
		var area = shapeArea(shape);
		var demand = Math.max(1, parseInt(item.demand || 1, 10));
		var allowed = Array.isArray(item.allowed_orientations) ? item.allowed_orientations.slice() : [];

		items.push({
			id: item.id,
			demand: demand,
			shape: shape,
			area: area,
			allowedOrientations: allowed
		});
		totalArea += area * demand;
		totalDemand += demand;
	}

	return {
		name: instanceJson.name || 'esicup-instance',
		stripHeight: stripHeight,
		items: items,
		totalArea: totalArea,
		totalDemand: totalDemand
	};
}

function layoutDemandedCopies(normalized, opts) {
	opts = opts || {};
	var margin = Number(opts.margin);
	if (!isFinite(margin) || margin < 0) {
		margin = Math.max(10, Math.min(200, normalized.stripHeight * 0.02));
	}

	var stripLength = Number(opts.stripLengthEstimate);
	if (!isFinite(stripLength) || stripLength <= 0) {
		stripLength = 2 * normalized.totalArea / normalized.stripHeight;
	}
	if (!isFinite(stripLength) || stripLength <= 0) {
		stripLength = normalized.stripHeight;
	}

	var rowMaxWidth = Number(opts.layoutMaxWidth);
	if (!isFinite(rowMaxWidth) || rowMaxWidth <= 0) {
		rowMaxWidth = Math.max(stripLength, normalized.stripHeight);
	}

	var copies = [];
	var cursorX = 0;
	var cursorY = normalized.stripHeight + margin;
	var rowHeight = 0;
	var canvasWidth = stripLength;
	var canvasHeight = normalized.stripHeight;
	var source = 1;

	for (var i = 0; i < normalized.items.length; i++) {
		var item = normalized.items[i];
		for (var copyIndex = 0; copyIndex < item.demand; copyIndex++) {
			var bounds = boundsForShape(item.shape);
			var paddedWidth = bounds.width + margin;
			var paddedHeight = bounds.height + margin;

			if (cursorX > 0 && cursorX + paddedWidth > rowMaxWidth) {
				cursorX = 0;
				cursorY += rowHeight;
				rowHeight = 0;
			}

			var offset = {
				x: cursorX - bounds.x + margin / 2,
				y: cursorY - bounds.y + margin / 2
			};
			var placedShape = translateShape(item.shape, offset);

			copies.push({
				source: source,
				itemId: item.id,
				copyIndex: copyIndex,
				shape: placedShape,
				trueArea: item.area,
				allowedOrientations: item.allowedOrientations.slice(),
				importOffset: offset
			});

			source++;
			cursorX += paddedWidth;
			rowHeight = Math.max(rowHeight, paddedHeight);
			canvasWidth = Math.max(canvasWidth, cursorX);
			canvasHeight = Math.max(canvasHeight, cursorY + rowHeight);
		}
	}

	return {
		copies: copies,
		margin: margin,
		stripLength: stripLength,
		canvasWidth: Math.max(canvasWidth, stripLength),
		canvasHeight: Math.max(canvasHeight, normalized.stripHeight)
	};
}

function rotationsFromAllowedOrientations(allowed) {
	if (!Array.isArray(allowed) || allowed.length === 0) {
		return 4;
	}
	var normalized = {};
	for (var i = 0; i < allowed.length; i++) {
		var angle = Number(allowed[i]) || 0;
		angle = ((angle % 360) + 360) % 360;
		normalized[formatNumber(angle)] = true;
	}
	return Math.max(1, Object.keys(normalized).length);
}

function instanceToSvg(instanceJson, opts) {
	var normalized = normalizeInstance(instanceJson);
	var layout = layoutDemandedCopies(normalized, opts || {});
	var sourceMap = {};
	var sourceOrder = [];
	var svg = [];

	svg.push('<?xml version="1.0" encoding="UTF-8"?>');
	svg.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + formatNumber(layout.canvasWidth) + '" height="' + formatNumber(layout.canvasHeight) + '" viewBox="0 0 ' + formatNumber(layout.canvasWidth) + ' ' + formatNumber(layout.canvasHeight) + '">');
	svg.push('<rect id="sheet" data-esicup-sheet="true" x="0" y="0" width="' + formatNumber(layout.stripLength) + '" height="' + formatNumber(normalized.stripHeight) + '" fill="none" stroke="#000" />');

	for (var i = 0; i < layout.copies.length; i++) {
		var copy = layout.copies[i];
		var id = 'part-' + copy.itemId + '-' + copy.copyIndex;
		var attrs = [
			'id="' + escapeAttr(id) + '"',
			'data-esicup-source="' + copy.source + '"',
			'data-esicup-item-id="' + escapeAttr(copy.itemId) + '"',
			'data-esicup-copy-index="' + copy.copyIndex + '"',
			'data-esicup-allowed-orientations="' + escapeAttr(copy.allowedOrientations.join(',')) + '"',
			'fill="none"',
			'stroke="#000"',
			'fill-rule="evenodd"',
			'd="' + escapeAttr(shapePath(copy.shape)) + '"'
		];
		svg.push('<path ' + attrs.join(' ') + ' />');

		sourceMap[String(copy.source)] = {
			source: copy.source,
			itemId: copy.itemId,
			copyIndex: copy.copyIndex,
			trueArea: copy.trueArea,
			allowedOrientations: copy.allowedOrientations.slice(),
			rotations: rotationsFromAllowedOrientations(copy.allowedOrientations),
			polygon: copy.shape.outer.map(clonePoint),
			holes: copy.shape.holes.map(function (hole) {
				return hole.map(clonePoint);
			}),
			importOffset: clonePoint(copy.importOffset)
		};
		sourceOrder.push(copy.source);
	}

	svg.push('</svg>');

	return {
		svgText: svg.join('\n') + '\n',
		meta: {
			name: normalized.name,
			stripHeight: normalized.stripHeight,
			stripLengthEstimate: layout.stripLength,
			sheetSource: 0,
			sheetBounds: {
				x: 0,
				y: 0,
				width: layout.stripLength,
				height: normalized.stripHeight
			},
			totalDemand: normalized.totalDemand,
			totalTrueArea: normalized.totalArea,
			items: normalized.items.map(function (item) {
				return {
					id: item.id,
					demand: item.demand,
					trueArea: item.area,
					allowedOrientations: item.allowedOrientations.slice(),
					rotations: rotationsFromAllowedOrientations(item.allowedOrientations)
				};
			}),
			sourceMap: sourceMap,
			sourceOrder: sourceOrder
		}
	};
}

function flattenPlacements(placements) {
	if (!Array.isArray(placements)) {
		return [];
	}
	var flat = [];
	for (var i = 0; i < placements.length; i++) {
		if (placements[i] && Array.isArray(placements[i].sheetplacements)) {
			for (var j = 0; j < placements[i].sheetplacements.length; j++) {
				flat.push(placements[i].sheetplacements[j]);
			}
		}
		else if (placements[i] && typeof placements[i].source !== 'undefined') {
			flat.push(placements[i]);
		}
	}
	return flat;
}

function rotatePoint(point, degrees) {
	var angle = (Number(degrees) || 0) * Math.PI / 180;
	return {
		x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
		y: point.x * Math.sin(angle) + point.y * Math.cos(angle)
	};
}

function sourceRecordFromPartsBySource(source, partsBySource) {
	if (!partsBySource) {
		return null;
	}
	var record = partsBySource[source] || partsBySource[String(source)];
	if (!record) {
		return null;
	}
	if (record.polygon) {
		return record;
	}
	if (record.polygontree) {
		return {
			trueArea: record.trueArea || record.area,
			polygon: record.polygontree,
			holes: record.polygontree.children || []
		};
	}
	return null;
}

function utilizationFromPlacements(meta, placements, partsBySource) {
	if (!meta || !meta.sheetBounds) {
		throw new Error('missing ESICUP conversion metadata');
	}
	var flat = flattenPlacements(placements);
	var placedArea = 0;
	var maxX = null;
	var sourceMap = meta.sourceMap || {};

	for (var i = 0; i < flat.length; i++) {
		var placement = flat[i];
		var source = placement.source;
		var record = sourceMap[String(source)] || sourceRecordFromPartsBySource(source, partsBySource);
		if (!record || !Array.isArray(record.polygon)) {
			continue;
		}

		placedArea += Number(record.trueArea || 0);
		for (var j = 0; j < record.polygon.length; j++) {
			var rotated = rotatePoint(record.polygon[j], placement.rotation || 0);
			var worldX = rotated.x + Number(placement.x || 0);
			maxX = maxX === null ? worldX : Math.max(maxX, worldX);
		}
	}

	var usedLength = maxX === null ? 0 : Math.max(0, maxX - meta.sheetBounds.x);
	var denominator = usedLength * meta.stripHeight;
	return {
		utilization: denominator > 0 ? placedArea / denominator : 0,
		usedLength: usedLength
	};
}

function placementGroups(placements) {
	if (!Array.isArray(placements)) {
		return [];
	}
	var groups = [];
	var flat = [];
	for (var i = 0; i < placements.length; i++) {
		if (placements[i] && Array.isArray(placements[i].sheetplacements)) {
			groups.push(placements[i].sheetplacements.slice());
		}
		else if (placements[i] && typeof placements[i].source !== 'undefined') {
			flat.push(placements[i]);
		}
	}
	if (flat.length > 0) {
		groups.push(flat);
	}
	return groups;
}

function transformedRecord(record, placement) {
	var outer = [];
	var holes = [];
	var i;
	for (i = 0; i < record.polygon.length; i++) {
		var point = rotatePoint(record.polygon[i], placement.rotation || 0);
		outer.push({
			x: point.x + Number(placement.x || 0),
			y: point.y + Number(placement.y || 0)
		});
	}
	var sourceHoles = Array.isArray(record.holes) ? record.holes : [];
	for (var h = 0; h < sourceHoles.length; h++) {
		var hole = [];
		for (i = 0; i < sourceHoles[h].length; i++) {
			point = rotatePoint(sourceHoles[h][i], placement.rotation || 0);
			hole.push({
				x: point.x + Number(placement.x || 0),
				y: point.y + Number(placement.y || 0)
			});
		}
		holes.push(hole);
	}
	return {
		outer: outer,
		holes: holes,
		bounds: boundsForRing(outer)
	};
}

function clipperPathsForMaterial(transformed, scale, clipperLib) {
	var rings = [transformed.outer].concat(transformed.holes || []);
	var paths = [];
	for (var r = 0; r < rings.length; r++) {
		var path = [];
		for (var i = 0; i < rings[r].length; i++) {
			path.push({X: rings[r][i].x, Y: rings[r][i].y});
		}
		clipperLib.JS.ScaleUpPath(path, scale);
		paths.push(path);
	}
	return paths;
}

function boundsOverlap(a, b, tolerance) {
	return a.x <= b.x + b.width + tolerance &&
		a.x + a.width >= b.x - tolerance &&
		a.y <= b.y + b.height + tolerance &&
		a.y + a.height >= b.y - tolerance;
}

function materialIntersectionArea(left, right, scale, clipperLib) {
	var clipper = new clipperLib.Clipper();
	var solution = new clipperLib.Paths();
	clipper.AddPaths(left, clipperLib.PolyType.ptSubject, true);
	clipper.AddPaths(right, clipperLib.PolyType.ptClip, true);
	if (!clipper.Execute(
		clipperLib.ClipType.ctIntersection,
		solution,
		clipperLib.PolyFillType.pftEvenOdd,
		clipperLib.PolyFillType.pftEvenOdd
	)) {
		return Number.POSITIVE_INFINITY;
	}
	var signedArea = 0;
	for (var i = 0; i < solution.length; i++) {
		signedArea += clipperLib.Clipper.Area(solution[i]);
	}
	return Math.abs(signedArea) / (scale * scale);
}

function legalityFromPlacements(meta, placements, clipperLib) {
	if (!meta || !meta.sheetBounds || !meta.sourceMap) {
		throw new Error('missing ESICUP conversion metadata');
	}
	if (!clipperLib || !clipperLib.Clipper) {
		throw new Error('missing Clipper library');
	}
	var scale = 100000;
	var coordinateTolerance = Math.max(1e-7, Number(meta.stripHeight || 0) * 1e-10);
	var areaTolerance = 1e-6;
	var groups = placementGroups(placements);
	var placedCount = 0;
	var overlapCount = 0;
	var outsideCount = 0;
	var missingSourceCount = 0;
	var maxIntersectionArea = 0;
	var collisions = [];
	var sheetBounds = meta.sheetBounds;

	for (var g = 0; g < groups.length; g++) {
		var transformed = [];
		for (var p = 0; p < groups[g].length; p++) {
			var placement = groups[g][p];
			var record = meta.sourceMap[String(placement.source)];
			placedCount++;
			if (!record || !Array.isArray(record.polygon) || record.polygon.length < 3) {
				missingSourceCount++;
				continue;
			}
			var world = transformedRecord(record, placement);
			var maxX = sheetBounds.x + sheetBounds.width;
			var maxY = sheetBounds.y + sheetBounds.height;
			for (var v = 0; v < world.outer.length; v++) {
				var vertex = world.outer[v];
				if (vertex.x < sheetBounds.x - coordinateTolerance ||
					vertex.x > maxX + coordinateTolerance ||
					vertex.y < sheetBounds.y - coordinateTolerance ||
					vertex.y > maxY + coordinateTolerance) {
					outsideCount++;
					break;
				}
			}
			transformed.push({
				source: placement.source,
				bounds: world.bounds,
				paths: clipperPathsForMaterial(world, scale, clipperLib)
			});
		}
		for (var leftIndex = 0; leftIndex < transformed.length; leftIndex++) {
			for (var rightIndex = leftIndex + 1; rightIndex < transformed.length; rightIndex++) {
				var left = transformed[leftIndex];
				var right = transformed[rightIndex];
				if (!boundsOverlap(left.bounds, right.bounds, coordinateTolerance)) {
					continue;
				}
				var area = materialIntersectionArea(left.paths, right.paths, scale, clipperLib);
				maxIntersectionArea = Math.max(maxIntersectionArea, area);
				if (area > areaTolerance) {
					overlapCount++;
					if (collisions.length < 20) {
						collisions.push({
							sheetIndex: g,
							leftSource: left.source,
							rightSource: right.source,
							intersectionArea: area
						});
					}
				}
			}
		}
	}

	var allPartsPlaced = placedCount === Number(meta.totalDemand);
	var overlapFree = overlapCount === 0;
	var withinSheetBounds = outsideCount === 0 && missingSourceCount === 0;
	return {
		legal: allPartsPlaced && overlapFree && withinSheetBounds,
		allPartsPlaced: allPartsPlaced,
		overlapFree: overlapFree,
		withinSheetBounds: withinSheetBounds,
		placedCount: placedCount,
		expectedPartCount: Number(meta.totalDemand),
		sheetCount: groups.length,
		overlapCount: overlapCount,
		outsideCount: outsideCount,
		missingSourceCount: missingSourceCount,
		maxIntersectionArea: maxIntersectionArea,
		collisions: collisions
	};
}

module.exports = {
	instanceToSvg: instanceToSvg,
	utilizationFromPlacements: utilizationFromPlacements,
	legalityFromPlacements: legalityFromPlacements,
	_normalizeShape: normalizeShape,
	_polygonArea: polygonArea,
	_shapeArea: shapeArea,
	_rotationsFromAllowedOrientations: rotationsFromAllowedOrientations
};

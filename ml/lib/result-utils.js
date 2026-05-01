'use strict';

function polygonArea(polygon) {
	var area = 0;

	for (var i = 0; i < polygon.length; i++) {
		var current = polygon[i];
		var next = polygon[(i + 1) % polygon.length];
		area += (current.x * next.y) - (next.x * current.y);
	}

	return area / 2;
}

function materialArea(item) {
	var area = Math.abs(polygonArea(item.polygon));

	if (Array.isArray(item.holes)) {
		for (var i = 0; i < item.holes.length; i++) {
			area -= Math.abs(polygonArea(item.holes[i]));
		}
	}

	return area;
}

function polygonBounds(polygon) {
	var minX = polygon[0].x;
	var minY = polygon[0].y;
	var maxX = polygon[0].x;
	var maxY = polygon[0].y;

	for (var i = 1; i < polygon.length; i++) {
		minX = Math.min(minX, polygon[i].x);
		minY = Math.min(minY, polygon[i].y);
		maxX = Math.max(maxX, polygon[i].x);
		maxY = Math.max(maxY, polygon[i].y);
	}

	return {
		x: minX,
		y: minY,
		width: maxX - minX,
		height: maxY - minY
	};
}

function rotatePoint(point, degrees) {
	var angle = degrees * Math.PI / 180;
	var x1 = point.x * Math.cos(angle) - point.y * Math.sin(angle);
	var y1 = point.x * Math.sin(angle) + point.y * Math.cos(angle);

	return { x: x1, y: y1 };
}

function layoutOffsetForItem(item) {
	if (!item || !item.import_layout_offset) {
		return { x: 0, y: 0 };
	}

	return {
		x: item.import_layout_offset.x || 0,
		y: item.import_layout_offset.y || 0
	};
}

function canonicalizePlacement(item, sheetItem, placement) {
	var layoutOffset = layoutOffsetForItem(item);
	var sheetOffset = layoutOffsetForItem(sheetItem);
	var rotatedOffset = rotatePoint(layoutOffset, placement.rotation || 0);

	return {
		x: placement.x + rotatedOffset.x - sheetOffset.x,
		y: placement.y + rotatedOffset.y - sheetOffset.y,
		rotation: placement.rotation || 0
	};
}

function transformPolygon(polygon, placement) {
	var transformed = [];

	for (var i = 0; i < polygon.length; i++) {
		var rotated = rotatePoint(polygon[i], placement.rotation);
		transformed.push({
			x: rotated.x + placement.x,
			y: rotated.y + placement.y
		});
	}

	return transformed;
}

function almostEqual(a, b, tolerance) {
	return Math.abs(a - b) <= tolerance;
}

function isAxisAlignedRectangle(polygon, tolerance) {
	if (!Array.isArray(polygon) || polygon.length !== 4) {
		return false;
	}

	var bounds = polygonBounds(polygon);
	var maxX = bounds.x + bounds.width;
	var maxY = bounds.y + bounds.height;

	for (var i = 0; i < polygon.length; i++) {
		var point = polygon[i];
		var onVerticalEdge = almostEqual(point.x, bounds.x, tolerance) || almostEqual(point.x, maxX, tolerance);
		var onHorizontalEdge = almostEqual(point.y, bounds.y, tolerance) || almostEqual(point.y, maxY, tolerance);

		if (!onVerticalEdge || !onHorizontalEdge) {
			return false;
		}
	}

	return true;
}

function polygonWithinBounds(polygon, bounds, tolerance) {
	var maxX = bounds.x + bounds.width;
	var maxY = bounds.y + bounds.height;

	for (var i = 0; i < polygon.length; i++) {
		var point = polygon[i];
		if (point.x < (bounds.x - tolerance) || point.x > (maxX + tolerance) || point.y < (bounds.y - tolerance) || point.y > (maxY + tolerance)) {
			return false;
		}
	}

	return true;
}

function toClipperCoordinates(polygon) {
	var clip = [];

	for (var i = 0; i < polygon.length; i++) {
		clip.push({
			X: polygon[i].x,
			Y: polygon[i].y
		});
	}

	return clip;
}

function toClipperMaterialPaths(item, placement, scale) {
	var paths = [];
	var outer = transformPolygon(item.polygon, placement);
	var outerClip = toClipperCoordinates(outer);
	ClipperLib.JS.ScaleUpPath(outerClip, scale);
	paths.push(outerClip);

	if (Array.isArray(item.holes)) {
		for (var i = 0; i < item.holes.length; i++) {
			var holeClip = toClipperCoordinates(transformPolygon(item.holes[i], placement));
			ClipperLib.JS.ScaleUpPath(holeClip, scale);
			paths.push(holeClip);
		}
	}

	return paths;
}

function totalPathsArea(paths, scale) {
	var total = 0;

	for (var i = 0; i < paths.length; i++) {
		total += Math.abs(ClipperLib.Clipper.Area(paths[i]));
	}

	return total / (scale * scale);
}

function clipArea(subjectPaths, clipPaths, clipType, scale) {
	var clipper = new ClipperLib.Clipper();
	var solution = new ClipperLib.Paths();

	clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true);
	clipper.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);

	if (!clipper.Execute(clipType, solution, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd)) {
		return Number.POSITIVE_INFINITY;
	}

	return totalPathsArea(solution, scale);
}

function summarizePlacements(job, bestNest) {
	var placements = [];
	var indexToItem = {};
	var partInstanceCounts = {};

	for (var i = 0; i < job.items.length; i++) {
		indexToItem[i] = job.items[i];
	}

	for (var sheetIndex = 0; sheetIndex < bestNest.placements.length; sheetIndex++) {
		var sheetPlacement = bestNest.placements[sheetIndex];
		var sheetItem = indexToItem[sheetPlacement.sheet];
		var sheetInstanceId = sheetItem.item_id + '#' + sheetPlacement.sheetid;

		for (var partIndex = 0; partIndex < sheetPlacement.sheetplacements.length; partIndex++) {
			var placement = sheetPlacement.sheetplacements[partIndex];
			var partItem = indexToItem[placement.source];
			var partItemId = partItem.item_id;
			var canonicalPlacement = canonicalizePlacement(partItem, sheetItem, placement);

			if (!partInstanceCounts[partItemId]) {
				partInstanceCounts[partItemId] = 0;
			}

			placements.push({
				sheet_item_id: sheetItem.item_id,
				sheet_instance_id: sheetInstanceId,
				part_item_id: partItemId,
				part_instance_index: partInstanceCounts[partItemId],
				x: canonicalPlacement.x,
				y: canonicalPlacement.y,
				rotation: canonicalPlacement.rotation,
				merged_line_length: placement.mergedLength || 0
			});

			partInstanceCounts[partItemId] += 1;
		}
	}

	return placements;
}

function evaluateTeacherBestNest(job, bestNest) {
	var scale = 10000000;
	var coordinateTolerance = Math.max(0.0001, (job.config && job.config.curveTolerance ? job.config.curveTolerance * 0.01 : 0));
	var placements = summarizePlacements(job, bestNest);
	var indexToItem = {};
	var sheetPlacements = {};
	var placedCount = 0;
	var overlapFree = true;
	var withinSheetBounds = true;
	var expectedPartCount = 0;
	var usedSheetArea = 0;
	var usedSheetInstances = {};
	var totalPartArea = 0;

	for (var itemIndex = 0; itemIndex < job.items.length; itemIndex++) {
		indexToItem[job.items[itemIndex].item_id] = job.items[itemIndex];
		if (job.items[itemIndex].kind === 'part') {
			expectedPartCount += job.items[itemIndex].quantity;
			totalPartArea += materialArea(job.items[itemIndex]) * job.items[itemIndex].quantity;
		}
	}

	for (var i = 0; i < placements.length; i++) {
		var currentPlacement = placements[i];
		placedCount += 1;

		if (!sheetPlacements[currentPlacement.sheet_instance_id]) {
			sheetPlacements[currentPlacement.sheet_instance_id] = [];
		}
		sheetPlacements[currentPlacement.sheet_instance_id].push(currentPlacement);

		if (!usedSheetInstances[currentPlacement.sheet_instance_id]) {
			usedSheetInstances[currentPlacement.sheet_instance_id] = true;
			usedSheetArea += materialArea(indexToItem[currentPlacement.sheet_item_id]);
		}
	}

	var sheetIds = Object.keys(sheetPlacements);
	for (var sheetIndex = 0; sheetIndex < sheetIds.length; sheetIndex++) {
		var sheetInstanceId = sheetIds[sheetIndex];
		var group = sheetPlacements[sheetInstanceId];
		var sheetItem = indexToItem[group[0].sheet_item_id];
		var sheetPaths = toClipperMaterialPaths(sheetItem, { x: 0, y: 0, rotation: 0 }, scale);
		var sheetBounds = polygonBounds(sheetItem.polygon);
		var sheetIsRectangle = isAxisAlignedRectangle(sheetItem.polygon, coordinateTolerance);

		for (var p = 0; p < group.length; p++) {
			var partItem = indexToItem[group[p].part_item_id];
			var partPaths = toClipperMaterialPaths(partItem, group[p], scale);
			if (sheetIsRectangle) {
				if (!polygonWithinBounds(transformPolygon(partItem.polygon, group[p]), sheetBounds, coordinateTolerance)) {
					withinSheetBounds = false;
				}
			}
			else {
				var outsideArea = clipArea(partPaths, sheetPaths, ClipperLib.ClipType.ctDifference, scale);

				if (outsideArea > 1e-6) {
					withinSheetBounds = false;
				}
			}

			for (var q = p + 1; q < group.length; q++) {
				var otherItem = indexToItem[group[q].part_item_id];
				var otherPaths = toClipperMaterialPaths(otherItem, group[q], scale);
				var intersectionArea = clipArea(partPaths, otherPaths, ClipperLib.ClipType.ctIntersection, scale);
				if (intersectionArea > 1e-6) {
					overlapFree = false;
				}
			}
		}
	}

	var legality = {
		solver_completed: true,
		all_parts_placed: placedCount === expectedPartCount,
		overlap_free: overlapFree,
		within_sheet_bounds: withinSheetBounds
	};
	legality.legal = legality.all_parts_placed && legality.overlap_free && legality.within_sheet_bounds;

	return {
		legality: {
			solver_completed: legality.solver_completed,
			all_parts_placed: legality.all_parts_placed,
			overlap_free: legality.overlap_free,
			within_sheet_bounds: legality.within_sheet_bounds,
			legal: legality.legal
		},
		metrics: {
			expected_part_count: expectedPartCount,
			fitness: bestNest.fitness,
			merged_line_length: bestNest.mergedLength || 0,
			placed_part_count: placedCount,
			used_sheet_count: sheetIds.length,
			utilization_ratio: usedSheetArea > 0 ? totalPartArea / usedSheetArea : 0
		},
		placements: placements
	};
}

module.exports = {
	evaluateTeacherBestNest: evaluateTeacherBestNest,
	materialArea: materialArea,
	polygonArea: polygonArea
};

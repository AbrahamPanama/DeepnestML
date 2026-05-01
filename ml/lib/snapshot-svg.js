'use strict';

var fs = require('graceful-fs');
var path = require('path');

var SHEET_FILL = '#1a1d23';
var SHEET_STROKE = '#555';
var HOLE_FILL = '#1a1d23';
var PART_STROKE = '#fff';
var PART_STROKE_WIDTH = 0.8;
var BG_COLOR = '#0d0f12';
var TEXT_COLOR = '#aaa';
var SHEET_GAP = 40;

function rotatePoint(point, degrees) {
	var angle = degrees * Math.PI / 180;
	return {
		x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
		y: point.x * Math.sin(angle) + point.y * Math.cos(angle)
	};
}

function transformPolygon(polygon, placement) {
	var transformed = [];

	for (var i = 0; i < polygon.length; i++) {
		var rotated = rotatePoint(polygon[i], placement.rotation || 0);
		transformed.push({
			x: rotated.x + placement.x,
			y: rotated.y + placement.y
		});
	}

	return transformed;
}

function polygonBounds(polygon) {
	var minX = polygon[0].x;
	var minY = polygon[0].y;
	var maxX = polygon[0].x;
	var maxY = polygon[0].y;

	for (var i = 1; i < polygon.length; i++) {
		if (polygon[i].x < minX) { minX = polygon[i].x; }
		if (polygon[i].y < minY) { minY = polygon[i].y; }
		if (polygon[i].x > maxX) { maxX = polygon[i].x; }
		if (polygon[i].y > maxY) { maxY = polygon[i].y; }
	}

	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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

function pointsString(polygon) {
	var parts = [];

	for (var i = 0; i < polygon.length; i++) {
		parts.push(polygon[i].x.toFixed(2) + ',' + polygon[i].y.toFixed(2));
	}

	return parts.join(' ');
}

function escapeXml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function partHue(sourceIndex, totalParts) {
	return Math.round(360 * (sourceIndex / Math.max(totalParts, 1)));
}

/**
 * Render a placement snapshot as an SVG string.
 *
 * @param {Object} job        - The canonical job (with items[].polygon, items[].holes, items[].import_layout_offset)
 * @param {Object} bestNest   - The solver output ({placements, fitness})
 * @param {Object} meta       - Optional metadata for overlay text ({evaluationCount, jobId})
 * @returns {string}          - Complete SVG document string
 */
function renderPlacementSvg(job, bestNest, meta) {
	if (!job || !bestNest || !bestNest.placements || bestNest.placements.length === 0) {
		return null;
	}

	meta = meta || {};
	var partItemCount = 0;

	for (var idx = 0; idx < job.items.length; idx++) {
		if (job.items[idx].kind === 'part') {
			partItemCount++;
		}
	}

	var svgParts = [];
	var sheetBlocks = [];
	var globalMinX = Infinity;
	var globalMinY = Infinity;
	var globalMaxX = -Infinity;
	var globalMaxY = -Infinity;
	var yOffset = 0;

	for (var sheetIndex = 0; sheetIndex < bestNest.placements.length; sheetIndex++) {
		var sheetPlacement = bestNest.placements[sheetIndex];
		var sheetItem = job.items[sheetPlacement.sheet];

		if (!sheetItem || !sheetItem.polygon) {
			continue;
		}

		var sheetPolygon = sheetItem.polygon;
		var sheetBounds = polygonBounds(sheetPolygon);

		// Render the sheet outline, offset vertically for multi-sheet stacking
		var sheetTranslateX = -sheetBounds.x;
		var sheetTranslateY = yOffset - sheetBounds.y;

		svgParts.push('<g data-sheet="' + sheetIndex + '" transform="translate(' + sheetTranslateX.toFixed(2) + ' ' + sheetTranslateY.toFixed(2) + ')">');

		// Sheet background
		svgParts.push('<polygon points="' + pointsString(sheetPolygon) + '" fill="' + SHEET_FILL + '" stroke="' + SHEET_STROKE + '" stroke-width="1.5" />');

		// Sheet holes (if any)
		if (Array.isArray(sheetItem.holes)) {
			for (var h = 0; h < sheetItem.holes.length; h++) {
				svgParts.push('<polygon points="' + pointsString(sheetItem.holes[h]) + '" fill="' + BG_COLOR + '" stroke="' + SHEET_STROKE + '" stroke-width="0.8" />');
			}
		}

		// Place parts on this sheet
		if (sheetPlacement.sheetplacements) {
			for (var partIdx = 0; partIdx < sheetPlacement.sheetplacements.length; partIdx++) {
				var placement = sheetPlacement.sheetplacements[partIdx];
				var partItem = job.items[placement.source];

				if (!partItem || !partItem.polygon) {
					continue;
				}

				var canonical = canonicalizePlacement(partItem, sheetItem, placement);
				var placed = transformPolygon(partItem.polygon, canonical);
				var hue = partHue(placement.source, job.items.length);
				var fill = 'hsla(' + hue + ', 65%, 55%, 0.45)';
				var stroke = 'hsl(' + hue + ', 80%, 70%)';

				svgParts.push('<polygon points="' + pointsString(placed) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + PART_STROKE_WIDTH + '" />');

				// Part holes
				if (Array.isArray(partItem.holes)) {
					for (var ph = 0; ph < partItem.holes.length; ph++) {
						var placedHole = transformPolygon(partItem.holes[ph], canonical);
						svgParts.push('<polygon points="' + pointsString(placedHole) + '" fill="' + HOLE_FILL + '" stroke="' + stroke + '" stroke-width="0.5" />');
					}
				}
			}
		}

		svgParts.push('</g>');

		// Track global bounds for viewBox
		var blockMinX = 0;
		var blockMinY = yOffset;
		var blockMaxX = sheetBounds.width;
		var blockMaxY = yOffset + sheetBounds.height;

		if (blockMinX < globalMinX) { globalMinX = blockMinX; }
		if (blockMinY < globalMinY) { globalMinY = blockMinY; }
		if (blockMaxX > globalMaxX) { globalMaxX = blockMaxX; }
		if (blockMaxY > globalMaxY) { globalMaxY = blockMaxY; }

		yOffset += sheetBounds.height + SHEET_GAP;
	}

	// Padding around the content
	var padding = 30;
	var viewX = globalMinX - padding;
	var viewY = globalMinY - padding;
	var viewW = (globalMaxX - globalMinX) + padding * 2;
	var viewH = (globalMaxY - globalMinY) + padding * 2;

	// Metadata overlay
	var metaLines = [];

	if (meta.jobId) {
		metaLines.push(escapeXml(meta.jobId));
	}

	if (typeof meta.evaluationCount === 'number') {
		metaLines.push('eval ' + meta.evaluationCount);
	}

	if (typeof bestNest.fitness === 'number') {
		metaLines.push('fitness ' + bestNest.fitness.toFixed(4));
	}

	var metaSvg = '';
	var textSize = Math.max(8, Math.round(viewW / 60));

	for (var m = 0; m < metaLines.length; m++) {
		metaSvg += '<text x="' + (viewX + 8) + '" y="' + (viewY + textSize + 4 + m * (textSize + 4)) + '" font-family="monospace" font-size="' + textSize + '" fill="' + TEXT_COLOR + '">' + metaLines[m] + '</text>';
	}

	var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewX.toFixed(1) + ' ' + viewY.toFixed(1) + ' ' + viewW.toFixed(1) + ' ' + viewH.toFixed(1) + '" ' +
		'width="' + Math.round(Math.min(viewW * 1.5, 1600)) + '" height="' + Math.round(Math.min(viewH * 1.5, 1200)) + '" ' +
		'style="background:' + BG_COLOR + '">\n' +
		svgParts.join('\n') + '\n' +
		metaSvg + '\n' +
		'</svg>\n';

	return svg;
}

/**
 * Write a placement snapshot SVG to disk.
 *
 * @param {string} outputDir  - Directory to write into (created if needed)
 * @param {Object} job        - The canonical job
 * @param {Object} bestNest   - The solver output
 * @param {Object} meta       - Optional metadata
 * @param {Object} options    - {keepHistory: boolean} — if true, also save numbered snapshots
 */
function writeSnapshot(outputDir, job, bestNest, meta, options) {
	options = options || {};

	var svg = renderPlacementSvg(job, bestNest, meta);

	if (!svg) {
		return null;
	}

	try {
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}
	} catch (mkdirError) {
		// directory may already exist on older Node
	}

	var latestPath = path.join(outputDir, 'snapshot.svg');
	fs.writeFileSync(latestPath, svg);

	var historyPath = null;

	if (options.keepHistory && typeof meta.evaluationCount === 'number') {
		var evalNum = String(meta.evaluationCount);

		while (evalNum.length < 4) {
			evalNum = '0' + evalNum;
		}

		historyPath = path.join(outputDir, 'snapshot-eval-' + evalNum + '.svg');
		fs.writeFileSync(historyPath, svg);
	}

	return {
		latestPath: latestPath,
		historyPath: historyPath
	};
}

module.exports = {
	renderPlacementSvg: renderPlacementSvg,
	writeSnapshot: writeSnapshot
};

'use strict';

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function polygonBounds(polygon) {
	var bounds = {
		x: polygon[0].x,
		y: polygon[0].y,
		width: 0,
		height: 0
	};
	var minX = polygon[0].x;
	var maxX = polygon[0].x;
	var minY = polygon[0].y;
	var maxY = polygon[0].y;

	for (var i = 1; i < polygon.length; i++) {
		minX = Math.min(minX, polygon[i].x);
		maxX = Math.max(maxX, polygon[i].x);
		minY = Math.min(minY, polygon[i].y);
		maxY = Math.max(maxY, polygon[i].y);
	}

	bounds.x = minX;
	bounds.y = minY;
	bounds.width = maxX - minX;
	bounds.height = maxY - minY;

	return bounds;
}

function itemBounds(item) {
	var bounds = polygonBounds(item.polygon);

	if (Array.isArray(item.holes)) {
		for (var i = 0; i < item.holes.length; i++) {
			var holeBounds = polygonBounds(item.holes[i]);
			var minX = Math.min(bounds.x, holeBounds.x);
			var minY = Math.min(bounds.y, holeBounds.y);
			var maxX = Math.max(bounds.x + bounds.width, holeBounds.x + holeBounds.width);
			var maxY = Math.max(bounds.y + bounds.height, holeBounds.y + holeBounds.height);
			bounds.x = minX;
			bounds.y = minY;
			bounds.width = maxX - minX;
			bounds.height = maxY - minY;
		}
	}

	return bounds;
}

function pointsAttribute(polygon, offset) {
	var rendered = [];

	for (var i = 0; i < polygon.length; i++) {
		rendered.push((polygon[i].x + offset.x) + ',' + (polygon[i].y + offset.y));
	}

	return rendered.join(' ');
}

function translatePolygon(polygon, offset) {
	var translated = [];

	for (var i = 0; i < polygon.length; i++) {
		translated.push({
			x: polygon[i].x + offset.x,
			y: polygon[i].y + offset.y
		});
	}

	return translated;
}

function layoutItems(items, margin, maxRowWidth) {
	var placements = [];
	var cursorX = 0;
	var cursorY = 0;
	var rowHeight = 0;
	var canvasWidth = 0;
	var canvasHeight = 0;

	for (var i = 0; i < items.length; i++) {
		var bounds = itemBounds(items[i]);
		var paddedWidth = bounds.width + margin;
		var paddedHeight = bounds.height + margin;

		if (cursorX > 0 && (cursorX + paddedWidth) > maxRowWidth) {
			cursorX = 0;
			cursorY += rowHeight;
			rowHeight = 0;
		}

		var offset = {
			x: cursorX - bounds.x + (margin / 2),
			y: cursorY - bounds.y + (margin / 2)
		};

		placements.push({
			offset: offset,
			bounds: bounds
		});

		cursorX += paddedWidth;
		rowHeight = Math.max(rowHeight, paddedHeight);
		canvasWidth = Math.max(canvasWidth, cursorX);
		canvasHeight = Math.max(canvasHeight, cursorY + rowHeight);
	}

	return {
		canvasHeight: Math.max(canvasHeight, 100),
		canvasWidth: Math.max(canvasWidth, 100),
		placements: placements
	};
}

function buildSvgDocument(job) {
	var margin = 200;
	var laidOut = layoutItems(job.items, margin, 4000);
	var svg = [];

	svg.push('<?xml version="1.0" encoding="UTF-8"?>');
	svg.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ' + laidOut.canvasWidth + ' ' + laidOut.canvasHeight + '">');

	for (var i = 0; i < job.items.length; i++) {
		var item = job.items[i];
		var placement = laidOut.placements[i];
		var itemId = item.item_id.replace(/"/g, '&quot;');

		svg.push('<polygon data-item-id="' + itemId + '" data-kind="' + item.kind + '" points="' + pointsAttribute(item.polygon, placement.offset) + '" />');

		if (Array.isArray(item.holes)) {
			for (var j = 0; j < item.holes.length; j++) {
				svg.push('<polygon data-item-id="' + itemId + '" data-hole-index="' + j + '" points="' + pointsAttribute(item.holes[j], placement.offset) + '" />');
			}
		}
	}

	svg.push('</svg>');

	return {
		svg_string: svg.join(''),
		layout: laidOut
	};
}

function buildLaidOutJob(job, layout) {
	var laidOutJob = cloneJson(job);

	for (var i = 0; i < laidOutJob.items.length; i++) {
		var placement = layout.placements[i];
		var item = laidOutJob.items[i];
		item.polygon = translatePolygon(item.polygon, placement.offset);

		if (Array.isArray(item.holes)) {
			for (var j = 0; j < item.holes.length; j++) {
				item.holes[j] = translatePolygon(item.holes[j], placement.offset);
			}
		}
	}

	return laidOutJob;
}

module.exports = {
	buildSvgDocument: buildSvgDocument,
	buildLaidOutJob: buildLaidOutJob
};

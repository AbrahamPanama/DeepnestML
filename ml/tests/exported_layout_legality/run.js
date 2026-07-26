'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {DOMParser} = require('@xmldom/xmldom');
const ClipperLib = require('../../../main/util/clippernode.js');
const {laurelPathPolygon} = require('../raster_collision/run.js');

const CLIPPER_SCALE = 1000000;

function parseArgs(argv) {
	const result = {};
	for (let i = 2; i < argv.length; i++) {
		if (!argv[i].startsWith('--')) {
			continue;
		}
		const key = argv[i].slice(2);
		const value = i + 1 < argv.length && !argv[i + 1].startsWith('--') ?
			argv[++i] : true;
		result[key] = value;
	}
	return result;
}

function multiply(left, right) {
	return [
		left[0] * right[0] + left[2] * right[1],
		left[1] * right[0] + left[3] * right[1],
		left[0] * right[2] + left[2] * right[3],
		left[1] * right[2] + left[3] * right[3],
		left[0] * right[4] + left[2] * right[5] + left[4],
		left[1] * right[4] + left[3] * right[5] + left[5]
	];
}

function parseNumbers(value) {
	const matches = String(value || '').match(/[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g);
	return matches ? matches.map(Number) : [];
}

function parseTransform(value) {
	let result = [1, 0, 0, 1, 0, 0];
	const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
	let match;
	while ((match = pattern.exec(String(value || '')))) {
		const name = match[1].toLowerCase();
		const values = parseNumbers(match[2]);
		let operation = [1, 0, 0, 1, 0, 0];
		if (name === 'translate') {
			operation = [1, 0, 0, 1, values[0] || 0, values.length > 1 ? values[1] : 0];
		}
		else if (name === 'scale') {
			const sx = values.length ? values[0] : 1;
			const sy = values.length > 1 ? values[1] : sx;
			operation = [sx, 0, 0, sy, 0, 0];
		}
		else if (name === 'rotate') {
			const radians = (values[0] || 0) * Math.PI / 180;
			const rotation = [
				Math.cos(radians), Math.sin(radians),
				-Math.sin(radians), Math.cos(radians),
				0, 0
			];
			if (values.length >= 3) {
				operation = multiply(
					multiply([1, 0, 0, 1, values[1], values[2]], rotation),
					[1, 0, 0, 1, -values[1], -values[2]]
				);
			}
			else {
				operation = rotation;
			}
		}
		else if (name === 'matrix' && values.length >= 6) {
			operation = values.slice(0, 6);
		}
		result = multiply(result, operation);
	}
	return result;
}

function worldTransform(node, root) {
	let result = [1, 0, 0, 1, 0, 0];
	let current = node;
	while (current && current !== root) {
		if (current.getAttribute) {
			result = multiply(parseTransform(current.getAttribute('transform')), result);
		}
		current = current.parentNode;
	}
	return result;
}

function transformRing(ring, matrix) {
	return ring.map((point) => ({
		x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
		y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]
	}));
}

function toClipperPath(ring) {
	return ring.map((point) => ({
		X: Math.round(point.x * CLIPPER_SCALE),
		Y: Math.round(point.y * CLIPPER_SCALE)
	}));
}

function executeArea(subjectRings, clipRings, clipType) {
	const operation = new ClipperLib.Clipper();
	const solution = new ClipperLib.Paths();
	operation.AddPaths(subjectRings.map(toClipperPath), ClipperLib.PolyType.ptSubject, true);
	operation.AddPaths(clipRings.map(toClipperPath), ClipperLib.PolyType.ptClip, true);
	if (!operation.Execute(
		clipType,
		solution,
		ClipperLib.PolyFillType.pftEvenOdd,
		ClipperLib.PolyFillType.pftEvenOdd
	)) {
		throw new Error('Clipper legality operation failed');
	}
	let signedArea = 0;
	for (const ring of solution) {
		signedArea += ClipperLib.Clipper.Area(ring);
	}
	return Math.abs(signedArea) / (CLIPPER_SCALE * CLIPPER_SCALE);
}

function descendantElements(node, tagName) {
	const result = [];
	const children = node.childNodes || [];
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.nodeType !== 1) {
			continue;
		}
		if (String(child.tagName).toLowerCase() === tagName) {
			result.push(child);
		}
		result.push.apply(result, descendantElements(child, tagName));
	}
	return result;
}

function taggedMemberGroups(root) {
	return descendantElements(root, 'g').filter((group) =>
		group.getAttribute('data-deepnest-expanded-member') === 'true'
	);
}

function parseExport(svgText, tolerance) {
	const document = new DOMParser().parseFromString(svgText, 'image/svg+xml');
	const root = document.documentElement;
	if (!root || String(root.tagName).toLowerCase() !== 'svg') {
		throw new Error('export is not an SVG document');
	}
	const groups = taggedMemberGroups(root);
	const instances = groups.map((group) => {
		const paths = descendantElements(group, 'path');
		if (!paths.length) {
			throw new Error('expanded member group has no path geometry');
		}
		const rings = paths.map((pathNode) => {
			const polygon = laurelPathPolygon(pathNode.getAttribute('d'), tolerance);
			return transformRing(polygon, worldTransform(pathNode, root));
		});
		return {
			source: group.getAttribute('data-deepnest-source'),
			instance: group.getAttribute('data-deepnest-instance'),
			rings: rings
		};
	});
	const viewBox = parseNumbers(root.getAttribute('viewBox'));
	if (viewBox.length !== 4 || viewBox[2] <= 0 || viewBox[3] <= 0) {
		throw new Error('export has no usable viewBox');
	}
	return {
		instances: instances,
		container: [[
			{x: viewBox[0], y: viewBox[1]},
			{x: viewBox[0] + viewBox[2], y: viewBox[1]},
			{x: viewBox[0] + viewBox[2], y: viewBox[1] + viewBox[3]},
			{x: viewBox[0], y: viewBox[1] + viewBox[3]}
		]]
	};
}

function inspect(svgText, options) {
	const parsed = parseExport(svgText, options.tolerance);
	let overlapCount = 0;
	let outsideCount = 0;
	let maxIntersectionArea = 0;
	let maxOutsideArea = 0;
	for (let i = 0; i < parsed.instances.length; i++) {
		const outsideArea = executeArea(
			parsed.instances[i].rings,
			parsed.container,
			ClipperLib.ClipType.ctDifference
		);
		maxOutsideArea = Math.max(maxOutsideArea, outsideArea);
		if (outsideArea > options.areaTolerance) {
			outsideCount++;
		}
		for (let j = i + 1; j < parsed.instances.length; j++) {
			const intersectionArea = executeArea(
				parsed.instances[i].rings,
				parsed.instances[j].rings,
				ClipperLib.ClipType.ctIntersection
			);
			maxIntersectionArea = Math.max(maxIntersectionArea, intersectionArea);
			if (intersectionArea > options.areaTolerance) {
				overlapCount++;
			}
		}
	}
	const allPartsPresent = parsed.instances.length === options.expectedParts;
	return {
		legal: allPartsPresent && overlapCount === 0 && outsideCount === 0,
		allPartsPresent: allPartsPresent,
		parsedPartCount: parsed.instances.length,
		overlapCount: overlapCount,
		outsideCount: outsideCount,
		maxIntersectionArea: maxIntersectionArea,
		maxOutsideArea: maxOutsideArea,
		exportSha256: crypto.createHash('sha256').update(svgText).digest('hex')
	};
}

function main() {
	const args = parseArgs(process.argv);
	if (!args.export) {
		throw new Error('usage: run.js --export <file.svg> --expected-parts <count> [--report <report.json>]');
	}
	const svgPath = path.resolve(args.export);
	const svgText = fs.readFileSync(svgPath, 'utf8');
	const report = inspect(svgText, {
		expectedParts: Math.max(1, Number(args['expected-parts']) || 1),
		tolerance: Math.max(0.01, Number(args.tolerance) || 0.3),
		areaTolerance: Math.max(1e-9, Number(args['area-tolerance']) || 1e-6)
	});
	if (args.report) {
		fs.writeFileSync(path.resolve(args.report), JSON.stringify(report, null, 2));
	}
	console.log(JSON.stringify(report, null, 2));
	if (!report.legal) {
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}

module.exports = {
	inspect,
	parseExport,
	parseTransform,
	multiply
};

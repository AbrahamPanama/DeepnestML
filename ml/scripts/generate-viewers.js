#!/usr/bin/env node
'use strict';

/**
 * Walk a runs root directory and generate viewer.html for every
 * teacher run that contains snapshot-eval-*.svg files.
 *
 * Usage:
 *   node ml/scripts/generate-viewers.js --runs-root <path>
 */

var fs = require('fs');
var path = require('path');
var snapshotViewer = require('../lib/snapshot-viewer');

function parseArgs(argv) {
	var parsed = {};

	for (var i = 0; i < argv.length; i++) {
		var token = argv[i];

		if (token.indexOf('--') !== 0) {
			continue;
		}

		var key = token.slice(2);
		var next = argv[i + 1];
		if (typeof next !== 'undefined' && next.indexOf('--') !== 0) {
			parsed[key] = next;
			i += 1;
		} else {
			parsed[key] = true;
		}
	}

	return parsed;
}

function findSnapshotDirs(root) {
	var dirs = [];

	function walk(dir) {
		var entries;
		try {
			entries = fs.readdirSync(dir);
		} catch (e) {
			return;
		}

		var hasSnapshots = entries.some(function(name) {
			return /^snapshot-eval-\d+\.svg$/.test(name);
		});

		if (hasSnapshots) {
			dirs.push(dir);
			return; // don't recurse deeper once we found snapshots
		}

		for (var i = 0; i < entries.length; i++) {
			var full = path.join(dir, entries[i]);
			try {
				if (fs.statSync(full).isDirectory()) {
					walk(full);
				}
			} catch (e) {}
		}
	}

	walk(root);
	return dirs;
}

function main() {
	var args = parseArgs(process.argv.slice(2));
	var runsRoot = args['runs-root'];

	if (!runsRoot) {
		console.error('Usage: node generate-viewers.js --runs-root <path>');
		process.exit(1);
	}

	runsRoot = path.resolve(runsRoot);

	if (!fs.existsSync(runsRoot)) {
		console.log('runs-root does not exist, skipping viewer generation:', runsRoot);
		process.exit(0);
	}

	var snapshotDirs = findSnapshotDirs(runsRoot);

	if (snapshotDirs.length === 0) {
		console.log('no snapshot directories found under', runsRoot);
		process.exit(0);
	}

	console.log('found', snapshotDirs.length, 'snapshot directories');
	var generated = 0;

	for (var i = 0; i < snapshotDirs.length; i++) {
		try {
			var viewerPath = snapshotViewer.generateViewer(snapshotDirs[i]);
			console.log('  generated:', path.relative(runsRoot, viewerPath));
			generated++;
		} catch (err) {
			console.error('  failed:', snapshotDirs[i], err && err.message ? err.message : err);
		}
	}

	console.log('generated', generated, 'viewer(s)');
}

main();

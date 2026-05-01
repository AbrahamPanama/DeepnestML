'use strict';

(function bootstrapTeacher(root) {
	const electron = require('electron');
	const path = require('path');
	const ipcRenderer = electron.ipcRenderer;

	const io = require('./lib/io');
	const jobSvg = require('./lib/job-svg');
	const resultUtils = require('./lib/result-utils');
	const schema = require('./lib/schema');
	const seededRandom = require('./lib/seeded-random');
	const snapshotSvg = require('./lib/snapshot-svg');

	var snapshotsEnabled = (typeof process !== 'undefined' && process.env && process.env.DEEPNEST_TEACHER_SNAPSHOTS === '1');
	var snapshotsKeepHistory = (typeof process !== 'undefined' && process.env && process.env.DEEPNEST_TEACHER_SNAPSHOT_HISTORY === '1');

	function readQueryParams(search) {
		var raw = search || '';
		var query = raw.charAt(0) === '?' ? raw.slice(1) : raw;
		var values = {};
		var pairs;
		var i;

		if (typeof URLSearchParams !== 'undefined') {
			pairs = new URLSearchParams(query);
			return {
				get: function getParam(key) {
					return pairs.get(key);
				}
			};
		}

		if (!query) {
			return {
				get: function getEmptyParam() {
					return null;
				}
			};
		}

		pairs = query.split('&');
		for (i = 0; i < pairs.length; i++) {
			var token = pairs[i];
			if (!token) {
				continue;
			}
			var parts = token.split('=');
			var key = decodeURIComponent(parts[0]);
			var value = parts.length > 1 ? decodeURIComponent(parts.slice(1).join('=')) : '';
			values[key] = value;
		}

		return {
			get: function getFallbackParam(key) {
				return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
			}
		};
	}

	var params = readQueryParams(window.location.search);
	var jobPath = params.get('job');
	var outputDir = params.get('outputDir');
	var runId = params.get('runId') || null;
	var state = {
		bestNest: null,
		complete: false,
		evaluationCount: 0,
		importLayout: null,
		importedJob: null,
		job: null,
		lastProgress: null,
		maxEvaluations: 0,
		progressSamples: 0,
		restoreRandom: null,
		runId: runId,
		runStartedAt: 0,
		wroteStartEvent: false
	};

	function writeEarlyFailure(reason, details) {
		try {
			var fs = require('fs');
			io.ensureDirSync(outputDir);
			fs.writeFileSync(path.join(outputDir, 'renderer-error.json'), JSON.stringify({
				reason: reason,
				details: details || null,
				job_path: jobPath || null,
				output_dir: outputDir || null,
				timestamp: new Date().toISOString()
			}, null, 2));
		}
		catch (writeError) {
			console.error('teacher-runner failed to persist early error', writeError && writeError.stack ? writeError.stack : writeError);
		}
	}

	window.onerror = function onWindowError(message, source, lineno, colno, error) {
		writeEarlyFailure('window_error', {
			message: message,
			source: source,
			lineno: lineno,
			colno: colno,
			stack: error && error.stack ? error.stack : null
		});
		console.error('teacher-runner window error', message, source + ':' + lineno + ':' + colno, error && error.stack ? error.stack : '');
		if (ipcRenderer) {
			ipcRenderer.send('teacher-finished', {
				status: 'failed',
				reason: 'window_error',
				details: {
					message: message,
					source: source,
					lineno: lineno,
					colno: colno
				}
			});
		}
	};

	if (!jobPath) {
		throw new Error('teacher-runner requires a job query parameter');
	}

	if (!outputDir) {
		outputDir = path.join(path.dirname(jobPath), 'runs', path.basename(jobPath, '.json'));
	}

	function nowIso() {
		return new Date().toISOString();
	}

	function cloneJson(value) {
		return JSON.parse(JSON.stringify(value));
	}

	function resultPath() {
		return path.join(outputDir, 'result.json');
	}

	function manifestPath() {
		return path.join(outputDir, 'manifest.json');
	}

	function copiedJobPath() {
		return path.join(outputDir, 'job.json');
	}

	function eventsPath() {
		return path.join(outputDir, 'events.jsonl');
	}

	function createRunId(job) {
		return state.runId || (job.job_id + '-' + Date.now());
	}

	function emitEvent(stage, status, message, summary) {
		var event = {
			schema_version: schema.SCHEMA_VERSION,
			run_id: state.runId,
			job_id: state.job.job_id,
			timestamp: nowIso(),
			stage: stage,
			status: status,
			message: message || null,
			summary: summary || {}
		};
		var errors = schema.validateRunEvent(event);
		if (errors.length > 0) {
			throw new Error('invalid run event: ' + errors.join('; '));
		}
		io.appendJSONL(eventsPath(), event);
	}

	function writeManifest(status, summary, failureReason) {
		io.writeJSONSync(manifestPath(), {
			run_id: state.runId,
			job_id: state.job.job_id,
			status: status,
			failure_reason: failureReason || null,
			created_at: nowIso(),
			job_path: copiedJobPath(),
			result_path: resultPath(),
			events_path: eventsPath(),
			output_dir: outputDir,
			metrics_summary: summary || {}
		});
	}

	function fail(failureReason, details) {
		if (state.complete) {
			return;
		}

		state.complete = true;

		if (state.restoreRandom) {
			state.restoreRandom();
		}

		var failureResult = {
			schema_version: schema.SCHEMA_VERSION,
			run_id: state.runId,
			job_id: state.job ? state.job.job_id : 'unknown',
			status: 'failed',
			failure_reason: failureReason,
			stop_reason: failureReason,
			seed: state.job ? state.job.random_seed : null,
			evaluation_count: state.evaluationCount,
			config: state.job ? state.job.config : {},
			timings_ms: {
				wall_clock: state.runStartedAt > 0 ? Date.now() - state.runStartedAt : 0
			},
			metrics: {
				fitness: Number.POSITIVE_INFINITY,
				used_sheet_count: 0,
				placed_part_count: 0,
				expected_part_count: 0,
				utilization_ratio: 0,
				merged_line_length: 0
			},
			legality: {
				solver_completed: false,
				all_parts_placed: false,
				overlap_free: false,
				within_sheet_bounds: false,
				legal: false
			},
			placements: []
		};

		io.writeJSONSync(resultPath(), failureResult);
		writeManifest('failed', failureResult.metrics, failureReason);
		emitEvent('run', 'failed', failureReason, {
			details: details || null,
			evaluation_count: state.evaluationCount
		});
		ipcRenderer.send('teacher-finished', { status: 'failed' });
	}

	function configureDeepNest(job) {
		var topLevelItems = [];
		var itemIndex = 0;
		var sheetCount = 0;
		var partCount = 0;
		var config = cloneJson(job.config);

		root.DeepNest.config(config);

		var builtSvg = jobSvg.buildSvgDocument(job);
		state.importLayout = builtSvg.layout;
		state.importedJob = jobSvg.buildLaidOutJob(job, builtSvg.layout);
		root.DeepNest.importsvg(job.job_id + '.svg', outputDir, builtSvg.svg_string, 1, false);

		for (var i = 0; i < job.items.length; i++) {
			if (builtSvg.layout && builtSvg.layout.placements && builtSvg.layout.placements[i]) {
				job.items[i].import_layout_offset = cloneJson(builtSvg.layout.placements[i].offset);
				job.items[i].import_layout_bounds = cloneJson(builtSvg.layout.placements[i].bounds);
			}
			topLevelItems.push(job.items[i]);
		}

		if (root.DeepNest.parts.length !== topLevelItems.length) {
			fail('import_item_count_mismatch', {
				expected_items: topLevelItems.length,
				imported_parts: root.DeepNest.parts.length
			});
			return false;
		}

		for (var partIndex = 0; partIndex < root.DeepNest.parts.length; partIndex++) {
			var part = root.DeepNest.parts[partIndex];
			var item = topLevelItems[itemIndex];
			part.quantity = item.quantity;
			part.sheet = item.kind === 'sheet';
			part.item_id = item.item_id;
			part.kind = item.kind;
			part.metadata = item.metadata || {};
			if (part.sheet) {
				sheetCount += item.quantity;
			} else {
				partCount += item.quantity;
			}
			itemIndex += 1;
		}

		emitEvent('import', 'completed', 'canonical job imported', {
			imported_items: root.DeepNest.parts.length,
			part_instances: partCount,
			sheet_instances: sheetCount
		});

		return true;
	}

	function onProgress(event, payload) {
		state.lastProgress = payload.progress;
		if (payload.progress === -1 || state.progressSamples % 5 === 0) {
			emitEvent('solve', 'progress', 'solver progress update', {
				progress: payload.progress,
				evaluation_count: state.evaluationCount
			});
		}
		state.progressSamples += 1;
	}

	function finalizeSuccess(stopReason) {
		if (state.complete) {
			return;
		}

		if (!state.bestNest || !state.bestNest.placements || state.bestNest.placements.length === 0) {
			fail('no_placement_found');
			return;
		}

		state.complete = true;

		root.DeepNest.stop();
		ipcRenderer.send('background-stop');

		if (state.restoreRandom) {
			state.restoreRandom();
		}

		var evaluated = resultUtils.evaluateTeacherBestNest(state.job, state.bestNest, state.importLayout);
		var result = {
			schema_version: schema.SCHEMA_VERSION,
			run_id: state.runId,
			job_id: state.job.job_id,
			status: evaluated.legality.legal ? 'succeeded' : 'failed',
			failure_reason: evaluated.legality.legal ? null : 'illegal_placement',
			stop_reason: stopReason,
			seed: state.job.random_seed,
			evaluation_count: state.evaluationCount,
			config: cloneJson(state.job.config),
			timings_ms: {
				wall_clock: Date.now() - state.runStartedAt
			},
			metrics: {
				expected_part_count: evaluated.metrics.expected_part_count,
				fitness: evaluated.metrics.fitness,
				merged_line_length: evaluated.metrics.merged_line_length,
				placed_part_count: evaluated.metrics.placed_part_count,
				used_sheet_count: evaluated.metrics.used_sheet_count,
				utilization_ratio: evaluated.metrics.utilization_ratio
			},
			legality: {
				solver_completed: evaluated.legality.solver_completed,
				all_parts_placed: evaluated.legality.all_parts_placed,
				overlap_free: evaluated.legality.overlap_free,
				within_sheet_bounds: evaluated.legality.within_sheet_bounds,
				legal: evaluated.legality.legal
			},
			placements: evaluated.placements
		};

		var errors = schema.validateResult(result);
		if (errors.length > 0) {
			fail('invalid_result_schema', { errors: errors });
			return;
		}

		io.writeJSONSync(resultPath(), result);
		writeManifest(result.status, result.metrics, result.failure_reason);
		emitEvent('solve', result.status === 'succeeded' ? 'completed' : 'failed', 'teacher solve finished', {
			evaluation_count: state.evaluationCount,
			fitness: result.metrics.fitness,
			legal: result.legality.legal,
			utilization_ratio: result.metrics.utilization_ratio
		});
		ipcRenderer.send('teacher-finished', { status: result.status });
	}

	function onBackgroundResponse() {
		state.evaluationCount += 1;

		if (root.DeepNest.nests && root.DeepNest.nests.length > 0) {
			state.bestNest = cloneJson(root.DeepNest.nests[0]);
		}

		if (snapshotsEnabled && state.bestNest && state.job) {
			try {
				snapshotSvg.writeSnapshot(outputDir, state.job, state.bestNest, {
					jobId: state.job.job_id,
					evaluationCount: state.evaluationCount
				}, {
					keepHistory: snapshotsKeepHistory
				});
			} catch (snapshotError) {
				console.error('snapshot write failed', snapshotError && snapshotError.message ? snapshotError.message : snapshotError);
			}
		}

		emitEvent('solve', 'progress', 'candidate evaluation completed', {
			evaluation_count: state.evaluationCount,
			best_fitness: state.bestNest ? state.bestNest.fitness : null
		});

		if (state.evaluationCount >= state.maxEvaluations) {
			finalizeSuccess('evaluation_budget_reached');
		}
	}

	function startSolve(job) {
		state.maxEvaluations = job.budget.max_evaluations;
		state.runStartedAt = Date.now();
		state.restoreRandom = seededRandom.installSeededRandom(job.random_seed);

		emitEvent('solve', 'started', 'teacher solve started', {
			max_evaluations: state.maxEvaluations,
			seed: job.random_seed
		});

		ipcRenderer.on('background-progress', onProgress);
		ipcRenderer.on('background-response', onBackgroundResponse);

		root.DeepNest.start(null, function noopDisplayCallback() {});
	}

	function main() {
		io.ensureDirSync(outputDir);
		state.job = io.readJSONSync(jobPath);
		state.runId = createRunId(state.job);

		io.copyFileSync(jobPath, copiedJobPath());

		var jobErrors = schema.validateJob(state.job);
		if (jobErrors.length > 0) {
			fail('invalid_job_schema', { errors: jobErrors });
			return;
		}

		emitEvent('run', 'started', 'teacher run started', {
			job_path: jobPath,
			output_dir: outputDir
		});

		if (!configureDeepNest(state.job)) {
			return;
		}

		startSolve(state.job);
	}

	window.addEventListener('error', function onWindowError(errorEvent) {
		fail('window_error', {
			message: errorEvent.message,
			filename: errorEvent.filename,
			lineno: errorEvent.lineno
		});
	});

	process.on('uncaughtException', function onException(error) {
		fail('uncaught_exception', { message: error.message, stack: error.stack });
	});

	document.addEventListener('DOMContentLoaded', main);
}(this));

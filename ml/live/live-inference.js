'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var SOURCE_REPO_ROOT = path.resolve(__dirname, '..', '..');
var EXTERNAL_LIVE_INFERENCE_ROOT = path.join(os.tmpdir(), 'deepnest-ml', 'live_inference');
var USER_PRESERVED_CONFIG_KEYS = [
	'spacing',
	'curveTolerance',
	'rotations'
];
var LIVE_OVERRIDE_KEYS = [
	'populationSize',
	'mutationRate',
	'placementType',
	'mergeLines',
	'timeRatio',
	'simplify',
	'endpointTolerance'
];
var translatedProcess = null;

function pushUnique(items, value) {
	if (!value) {
		return;
	}
	if (items.indexOf(value) < 0) {
		items.push(value);
	}
}

function isAsarPath(targetPath) {
	return typeof targetPath === 'string' && targetPath.indexOf('.asar') >= 0;
}

function scriptPathForRoot(rootPath) {
	return path.join(rootPath, 'ml', 'python', 'scripts', 'predict_config_candidate.py');
}

function artifactsRootForRoot(rootPath) {
	return path.join(rootPath, 'ml', 'artifacts');
}

function pipelineRunsRootForRoot(rootPath) {
	return path.join(artifactsRootForRoot(rootPath), 'pipeline_runs');
}

function checkpointsRootForRoot(rootPath) {
	return path.join(artifactsRootForRoot(rootPath), 'checkpoints');
}

function deriveRepoRootFromModelPath(modelPath) {
	if (!modelPath) {
		return '';
	}
	var resolved = path.resolve(modelPath);
	var marker = path.sep + 'ml' + path.sep + 'artifacts' + path.sep;
	var markerIndex = resolved.indexOf(marker);
	if (markerIndex < 0) {
		return '';
	}
	return resolved.slice(0, markerIndex);
}

function listMlRootCandidates(preferredModelPath) {
	var candidates = [];
	var resourcesPath = process.resourcesPath || '';
	var homeDir = os.homedir();

	pushUnique(candidates, deriveRepoRootFromModelPath(preferredModelPath));
	pushUnique(candidates, process.env.DEEPNEST_ML_ROOT || '');
	pushUnique(candidates, SOURCE_REPO_ROOT);
	pushUnique(candidates, resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked') : '');
	pushUnique(candidates, process.cwd());
	pushUnique(candidates, path.join(homeDir, 'Desktop', 'Deepnest++'));
	pushUnique(candidates, path.join(homeDir, 'Documents', 'Deepnest++'));

	return candidates.filter(function(rootPath) {
		if (!rootPath || !fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
			return false;
		}
		return true;
	});
}

function findPredictScript(preferredModelPath) {
	var rootCandidates = listMlRootCandidates(preferredModelPath);
	for (var i = 0; i < rootCandidates.length; i++) {
		var rootPath = rootCandidates[i];
		var scriptPath = scriptPathForRoot(rootPath);
		if (isAsarPath(scriptPath)) {
			continue;
		}
		if (fs.existsSync(scriptPath)) {
			return {
				repoRoot: rootPath,
				scriptPath: scriptPath
			};
		}
	}
	return null;
}

function getWritableLiveInferenceRoot() {
	if (process.env.DEEPNEST_ML_LIVE_ROOT) {
		return path.resolve(process.env.DEEPNEST_ML_LIVE_ROOT);
	}
	return EXTERNAL_LIVE_INFERENCE_ROOT;
}

function ensureDirSync(dirpath) {
	if (!dirpath || dirpath === '.' || fs.existsSync(dirpath)) {
		return;
	}
	ensureDirSync(path.dirname(dirpath));
	if (!fs.existsSync(dirpath)) {
		fs.mkdirSync(dirpath);
	}
}

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value) {
	var number = Number(value);
	if (!isFinite(number)) {
		return null;
	}
	return number;
}

function normalizePoint(point) {
	var x = toFiniteNumber(point && point.x);
	var y = toFiniteNumber(point && point.y);
	if (x === null || y === null) {
		return null;
	}
	return {
		x: x,
		y: y
	};
}

function samePoint(a, b) {
	return !!a && !!b && a.x === b.x && a.y === b.y;
}

function treeToPolygon(tree) {
	var polygon = [];
	if (!tree || typeof tree.length === 'undefined') {
		return polygon;
	}
	for (var i = 0; i < tree.length; i++) {
		var point = normalizePoint(tree[i]);
		if (point) {
			polygon.push(point);
		}
	}
	if (polygon.length > 1 && samePoint(polygon[0], polygon[polygon.length - 1])) {
		polygon.pop();
	}
	return polygon;
}

function treeChildrenToHoles(tree) {
	var holes = [];
	if (!tree.children || tree.children.length === 0) {
		return holes;
	}
	for (var i = 0; i < tree.children.length; i++) {
		var hole = treeToPolygon(tree.children[i]);
		if (hole.length >= 3) {
			holes.push(hole);
		}
	}
	return holes;
}

function normalizeInteger(value, fallback) {
	var number = parseInt(value, 10);
	if (!isFinite(number)) {
		return fallback;
	}
	return number;
}

function normalizeIntegerMin(value, fallback, minValue) {
	var number = normalizeInteger(value, fallback);
	if (number < minValue) {
		return fallback;
	}
	return number;
}

function normalizeFloat(value, fallback) {
	var number = Number(value);
	if (!isFinite(number)) {
		return fallback;
	}
	return number;
}

function normalizeFloatExclusiveMin(value, fallback, minValue) {
	var number = normalizeFloat(value, fallback);
	if (!(number > minValue)) {
		return fallback;
	}
	return number;
}

function normalizeBoolean(value, fallback) {
	if (typeof value === 'boolean') {
		return value;
	}
	if (value === 'true' || value === '1' || value === 1) {
		return true;
	}
	if (value === 'false' || value === '0' || value === 0) {
		return false;
	}
	return fallback;
}

function buildCanonicalConfig(baseConfig) {
	var source = baseConfig || {};
	var placementType = source.placementType;
	if (placementType !== 'gravity' && placementType !== 'box' && placementType !== 'convexhull') {
		placementType = 'gravity';
	}
	return {
		spacing: normalizeFloat(source.spacing, 0),
		curveTolerance: normalizeFloatExclusiveMin(source.curveTolerance, 0.3, 0),
		rotations: normalizeIntegerMin(source.rotations, 4, 1),
		populationSize: normalizeIntegerMin(source.populationSize, 10, 3),
		mutationRate: normalizeIntegerMin(source.mutationRate, 10, 1),
		threads: normalizeIntegerMin(source.threads, 1, 1),
		placementType: placementType,
		mergeLines: normalizeBoolean(source.mergeLines, true),
		timeRatio: normalizeFloat(source.timeRatio, 0.5),
		scale: normalizeFloatExclusiveMin(source.scale, 72, 0),
		simplify: normalizeBoolean(source.simplify, false),
		endpointTolerance: normalizeFloat(source.endpointTolerance, 0.36)
	};
}

function buildCanonicalJob(parts, baseConfig, options) {
	var items = [];
	var randomSeed = options && options.randomSeed ? Number(options.randomSeed) : Date.now();

	for (var i = 0; i < parts.length; i++) {
		var part = parts[i];
		if (!part || !part.polygontree) {
			continue;
		}
		var polygon = treeToPolygon(part.polygontree);
		if (polygon.length < 3) {
			continue;
		}
		items.push({
			item_id: (part.sheet ? 'sheet-' : 'part-') + i,
			kind: part.sheet ? 'sheet' : 'part',
			quantity: Math.max(1, parseInt(part.quantity, 10) || 1),
			polygon: polygon,
			holes: treeChildrenToHoles(part.polygontree),
			metadata: {
				part_index: i,
				bounds: part.bounds || null
			}
		});
	}

	return {
		schema_version: '1.0.0',
		job_id: 'live-app-job-' + randomSeed,
		source: 'live_app',
		metadata: {
			base_job_id: 'live-app-job',
			live_mode: options && options.liveMode ? options.liveMode : 'off'
		},
		random_seed: randomSeed,
		budget: {
			max_evaluations: Math.max(20, items.length * 6)
		},
		config: buildCanonicalConfig(baseConfig),
		items: items
	};
}

function resolveRepoRelative(targetPath) {
	if (!targetPath) {
		return '';
	}
	if (path.isAbsolute(targetPath)) {
		return targetPath;
	}
	return path.resolve(REPO_ROOT, targetPath);
}

function fileMtime(targetPath) {
	try {
		return fs.statSync(targetPath).mtime.getTime();
	}
	catch (error) {
		return 0;
	}
}

function findLatestModelPath() {
	var models = listAvailableModels();
	return models.length > 0 ? models[0].path : '';
}

function loadCheckpointMetadata(checkpointDir) {
	var manifestPath = path.join(checkpointDir, 'manifest.json');
	if (!fs.existsSync(manifestPath)) {
		return null;
	}
	try {
		return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	}
	catch (error) {
		return null;
	}
}

function buildCheckpointModelLabel(checkpointDir, modelPath) {
	var checkpointName = path.basename(checkpointDir);
	var metadata = loadCheckpointMetadata(checkpointDir);
	if (metadata && metadata.selected_run_id) {
		return 'Checkpoint: ' + checkpointName + ' (' + metadata.selected_run_id + ')';
	}
	var relative = path.relative(checkpointDir, modelPath);
	return 'Checkpoint: ' + checkpointName + ' (' + relative + ')';
}

function pushModelEntry(entries, seen, modelPath, label, source, groupId) {
	if (!modelPath || !fs.existsSync(modelPath) || seen[modelPath]) {
		return;
	}
	seen[modelPath] = true;
	entries.push({
		path: modelPath,
		label: label,
		source: source,
		group_id: groupId || '',
		mtime: fileMtime(modelPath)
	});
}

function listAvailableModels() {
	var entries = [];
	var seen = {};
	var roots = listMlRootCandidates('');

	for (var rootIndex = 0; rootIndex < roots.length; rootIndex++) {
		var mlRoot = roots[rootIndex];
		var pipelineRunsRoot = pipelineRunsRootForRoot(mlRoot);
		var checkpointsRoot = checkpointsRootForRoot(mlRoot);

		if (fs.existsSync(pipelineRunsRoot)) {
			var runDirs = fs.readdirSync(pipelineRunsRoot);
			for (var i = 0; i < runDirs.length; i++) {
				var runDir = runDirs[i];
				var candidatePath = path.join(pipelineRunsRoot, runDir, 'model', 'config_recommender.pkl');
				pushModelEntry(entries, seen, candidatePath, 'Training run: ' + runDir, 'pipeline_run', runDir);
			}
		}

		if (fs.existsSync(checkpointsRoot)) {
			var checkpointDirs = fs.readdirSync(checkpointsRoot);
			for (var j = 0; j < checkpointDirs.length; j++) {
				var checkpointDir = path.join(checkpointsRoot, checkpointDirs[j]);
				if (!fs.existsSync(checkpointDir) || !fs.statSync(checkpointDir).isDirectory()) {
					continue;
				}
				var pipelineSnapshotRoot = path.join(checkpointDir, 'pipeline_run');
				if (!fs.existsSync(pipelineSnapshotRoot) || !fs.statSync(pipelineSnapshotRoot).isDirectory()) {
					continue;
				}
				var snapshotRunDirs = fs.readdirSync(pipelineSnapshotRoot);
				for (var k = 0; k < snapshotRunDirs.length; k++) {
					var snapshotModelPath = path.join(pipelineSnapshotRoot, snapshotRunDirs[k], 'model', 'config_recommender.pkl');
					pushModelEntry(
						entries,
						seen,
						snapshotModelPath,
						buildCheckpointModelLabel(checkpointDir, snapshotModelPath),
						'checkpoint',
						checkpointDirs[j]
					);
				}
			}
		}
	}

	entries.sort(function(a, b) {
		if (b.mtime !== a.mtime) {
			return b.mtime - a.mtime;
		}
		return a.label.localeCompare(b.label);
	});
	return entries;
}

function resolveModelPath(modelPath) {
	var resolved = resolveRepoRelative(modelPath);
	if (resolved && fs.existsSync(resolved)) {
		return resolved;
	}
	return findLatestModelPath();
}

function isTranslatedProcess() {
	if (translatedProcess !== null) {
		return translatedProcess;
	}
	translatedProcess = false;
	if (process.platform !== 'darwin' || !fs.existsSync('/usr/sbin/sysctl')) {
		return translatedProcess;
	}
	try {
		var output = childProcess.execFileSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], {
			cwd: SOURCE_REPO_ROOT,
			encoding: 'utf8',
			timeout: 3000
		}).trim();
		translatedProcess = (output === '1');
	}
	catch (error) {
		translatedProcess = false;
	}
	return translatedProcess;
}

function getPredictInvocation(repoRoot, scriptPath, modelPath, jobPath) {
	var pythonBinary = process.env.DEEPNEST_ML_PYTHON || 'python3';
	var pythonArch = process.env.DEEPNEST_ML_PYTHON_ARCH || '';
	var scriptArgs = [
		scriptPath,
		'--job',
		jobPath,
		'--model',
		modelPath
	];

	if (process.platform === 'darwin' && fs.existsSync('/usr/bin/arch')) {
		if (pythonArch === 'arm64') {
			return {
				command: '/usr/bin/arch',
				args: ['-arm64', pythonBinary].concat(scriptArgs),
				cwd: repoRoot
			};
		}
		if (pythonArch === 'x86_64') {
			return {
				command: '/usr/bin/arch',
				args: ['-x86_64', pythonBinary].concat(scriptArgs),
				cwd: repoRoot
			};
		}
		if (isTranslatedProcess()) {
			return {
				command: '/usr/bin/arch',
				args: ['-arm64', pythonBinary].concat(scriptArgs),
				cwd: repoRoot
			};
		}
	}

	return {
		command: pythonBinary,
		args: scriptArgs,
		cwd: repoRoot
	};
}

function applyCandidateConfig(baseConfig, prediction, options) {
	var merged = cloneJson(baseConfig || {});
	var candidateConfig = prediction && prediction.candidate_config ? prediction.candidate_config : null;
	var liveMode = options && options.liveMode ? String(options.liveMode) : 'assist';
	if (!candidateConfig) {
		return merged;
	}

	if (liveMode === 'override') {
		Object.keys(candidateConfig).forEach(function(key) {
			merged[key] = candidateConfig[key];
		});
		return merged;
	}

	LIVE_OVERRIDE_KEYS.forEach(function(key) {
		if (Object.prototype.hasOwnProperty.call(candidateConfig, key)) {
			merged[key] = candidateConfig[key];
		}
	});

	USER_PRESERVED_CONFIG_KEYS.forEach(function(key) {
		if (Object.prototype.hasOwnProperty.call(baseConfig || {}, key)) {
			merged[key] = baseConfig[key];
		}
	});

	return merged;
}

function predictConfigForParts(parts, baseConfig, options, callback) {
	var modelPath = resolveModelPath(options && options.modelPath ? options.modelPath : '');
	if (!modelPath) {
		callback(new Error('No trained config recommender model was found.'));
		return;
	}
	var predictor = findPredictScript(modelPath);
	if (!predictor || !predictor.scriptPath) {
		callback(new Error('Missing predictor script for ML live inference.'));
		return;
	}

	var job = buildCanonicalJob(parts, baseConfig, {
		randomSeed: options && options.randomSeed ? options.randomSeed : Date.now(),
		liveMode: options && options.liveMode ? options.liveMode : 'off'
	});

	var liveInferenceRoot = getWritableLiveInferenceRoot();
	try {
		ensureDirSync(liveInferenceRoot);
	}
	catch (dirError) {
		callback(new Error('ML predictor temp directory is not writable: ' + dirError.message));
		return;
	}
	var requestId = 'live-' + Date.now();
	var jobPath = path.join(liveInferenceRoot, requestId + '.job.json');
	try {
		fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
	}
	catch (writeError) {
		callback(new Error('ML predictor request could not be written: ' + writeError.message));
		return;
	}

	var invocation = getPredictInvocation(predictor.repoRoot, predictor.scriptPath, modelPath, jobPath);

	childProcess.execFile(invocation.command, invocation.args, { cwd: invocation.cwd, timeout: 30000 }, function(error, stdout, stderr) {
		try {
			fs.unlinkSync(jobPath);
		}
		catch (cleanupError) {}

		if (error) {
			var detail = stderr ? stderr.trim() : (error.message || 'unknown error');
			callback(new Error('ML predictor failed: ' + detail));
			return;
		}

		try {
			var payload = JSON.parse(String(stdout || '').trim());
			payload.resolved_model_path = modelPath;
			callback(null, payload);
		}
		catch (parseError) {
			callback(new Error('ML predictor returned invalid JSON: ' + parseError.message));
		}
	});
}

module.exports = {
	applyCandidateConfig: applyCandidateConfig,
	buildCanonicalJob: buildCanonicalJob,
	findLatestModelPath: findLatestModelPath,
	listAvailableModels: listAvailableModels,
	predictConfigForParts: predictConfigForParts,
	resolveModelPath: resolveModelPath
};

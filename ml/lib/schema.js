'use strict';

var SCHEMA_VERSION = '1.0.0';

function isFiniteNumber(value) {
	return typeof value === 'number' && isFinite(value);
}

function validatePoint(point, path, errors) {
	if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
		errors.push(path + ' must contain finite x/y coordinates');
	}
}

function validatePolygon(polygon, path, errors) {
	if (!Array.isArray(polygon) || polygon.length < 3) {
		errors.push(path + ' must be an array with at least 3 points');
		return;
	}

	for (var i = 0; i < polygon.length; i++) {
		validatePoint(polygon[i], path + '[' + i + ']', errors);
	}
}

function validateConfig(config, path, errors) {
	if (!config || typeof config !== 'object') {
		errors.push(path + ' must be an object');
		return;
	}

	var requiredNumericKeys = [
		'spacing',
		'curveTolerance',
		'rotations',
		'populationSize',
		'mutationRate',
		'timeRatio',
		'scale'
	];

	for (var i = 0; i < requiredNumericKeys.length; i++) {
		var key = requiredNumericKeys[i];
		if (!isFiniteNumber(Number(config[key]))) {
			errors.push(path + '.' + key + ' must be numeric');
		}
	}

	if (typeof config.placementType !== 'string') {
		errors.push(path + '.placementType must be a string');
	}

	if (typeof config.mergeLines !== 'boolean') {
		errors.push(path + '.mergeLines must be a boolean');
	}

	if (typeof config.simplify !== 'boolean') {
		errors.push(path + '.simplify must be a boolean');
	}
}

function validateJob(job) {
	var errors = [];

	if (!job || typeof job !== 'object') {
		return ['job must be an object'];
	}

	if (job.schema_version !== SCHEMA_VERSION) {
		errors.push('job.schema_version must equal ' + SCHEMA_VERSION);
	}

	if (!job.job_id || typeof job.job_id !== 'string') {
		errors.push('job.job_id must be a non-empty string');
	}

	if (!job.source || typeof job.source !== 'string') {
		errors.push('job.source must be a non-empty string');
	}

	if (!Number.isInteger(job.random_seed) || job.random_seed < 0) {
		errors.push('job.random_seed must be a non-negative integer');
	}

	if (!job.budget || !Number.isInteger(job.budget.max_evaluations) || job.budget.max_evaluations < 1) {
		errors.push('job.budget.max_evaluations must be a positive integer');
	}

	validateConfig(job.config, 'job.config', errors);

	if (!Array.isArray(job.items) || job.items.length === 0) {
		errors.push('job.items must be a non-empty array');
		return errors;
	}

	var sheetCount = 0;
	var partCount = 0;

	for (var i = 0; i < job.items.length; i++) {
		var item = job.items[i];
		var prefix = 'job.items[' + i + ']';

		if (!item || typeof item !== 'object') {
			errors.push(prefix + ' must be an object');
			continue;
		}

		if (!item.item_id || typeof item.item_id !== 'string') {
			errors.push(prefix + '.item_id must be a non-empty string');
		}

		if (item.kind !== 'sheet' && item.kind !== 'part') {
			errors.push(prefix + '.kind must be "sheet" or "part"');
		}

		if (!Number.isInteger(item.quantity) || item.quantity < 1) {
			errors.push(prefix + '.quantity must be a positive integer');
		}

		validatePolygon(item.polygon, prefix + '.polygon', errors);

		if (Array.isArray(item.holes)) {
			for (var j = 0; j < item.holes.length; j++) {
				validatePolygon(item.holes[j], prefix + '.holes[' + j + ']', errors);
			}
		}

		if (item.kind === 'sheet') {
			sheetCount += item.quantity || 0;
		} else if (item.kind === 'part') {
			partCount += item.quantity || 0;
		}
	}

	if (sheetCount < 1) {
		errors.push('job must contain at least one sheet');
	}

	if (partCount < 1) {
		errors.push('job must contain at least one part');
	}

	return errors;
}

function validateResult(result) {
	var errors = [];

	if (!result || typeof result !== 'object') {
		return ['result must be an object'];
	}

	if (result.schema_version !== SCHEMA_VERSION) {
		errors.push('result.schema_version must equal ' + SCHEMA_VERSION);
	}

	if (!result.run_id || typeof result.run_id !== 'string') {
		errors.push('result.run_id must be a non-empty string');
	}

	if (!result.job_id || typeof result.job_id !== 'string') {
		errors.push('result.job_id must be a non-empty string');
	}

	if (result.status !== 'succeeded' && result.status !== 'failed') {
		errors.push('result.status must be "succeeded" or "failed"');
	}

	if (!result.timings_ms || !isFiniteNumber(result.timings_ms.wall_clock)) {
		errors.push('result.timings_ms.wall_clock must be numeric');
	}

	return errors;
}

function validateRunEvent(event) {
	var errors = [];

	if (!event || typeof event !== 'object') {
		return ['event must be an object'];
	}

	if (event.schema_version !== SCHEMA_VERSION) {
		errors.push('event.schema_version must equal ' + SCHEMA_VERSION);
	}

	if (!event.run_id || typeof event.run_id !== 'string') {
		errors.push('event.run_id must be a non-empty string');
	}

	if (!event.job_id || typeof event.job_id !== 'string') {
		errors.push('event.job_id must be a non-empty string');
	}

	if (!event.stage || typeof event.stage !== 'string') {
		errors.push('event.stage must be a non-empty string');
	}

	if (['started', 'progress', 'completed', 'failed'].indexOf(event.status) < 0) {
		errors.push('event.status must be one of started/progress/completed/failed');
	}

	return errors;
}

module.exports = {
	SCHEMA_VERSION: SCHEMA_VERSION,
	validateConfig: validateConfig,
	validateJob: validateJob,
	validateResult: validateResult,
	validateRunEvent: validateRunEvent
};

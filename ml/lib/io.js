'use strict';

const fs = require('graceful-fs');
const path = require('path');

function ensureDirSync(dirPath) {
	if (!dirPath) {
		return;
	}

	if (fs.existsSync(dirPath)) {
		return;
	}

	var parentDir = path.dirname(dirPath);
	if (parentDir && parentDir !== dirPath) {
		ensureDirSync(parentDir);
	}

	try {
		fs.mkdirSync(dirPath);
	} catch (error) {
		if (error.code !== 'EEXIST') {
			throw error;
		}
	}
}

function writeJSONSync(filePath, value) {
	ensureDirSync(path.dirname(filePath));
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJSONSync(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function appendJSONL(filePath, value) {
	ensureDirSync(path.dirname(filePath));
	fs.appendFileSync(filePath, JSON.stringify(value) + '\n');
}

function copyFileSync(sourcePath, targetPath) {
	ensureDirSync(path.dirname(targetPath));
	if (typeof fs.copyFileSync === 'function') {
		fs.copyFileSync(sourcePath, targetPath);
		return;
	}

	fs.writeFileSync(targetPath, fs.readFileSync(sourcePath));
}

module.exports = {
	appendJSONL: appendJSONL,
	copyFileSync: copyFileSync,
	ensureDirSync: ensureDirSync,
	readJSONSync: readJSONSync,
	writeJSONSync: writeJSONSync
};

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..');
const converter = path.join(root, 'scripts', 'conversion', 'local-convert.py');

function runPython(args, options) {
	return childProcess.spawnSync('python3', args, Object.assign({
		cwd: root,
		encoding: 'utf8'
	}, options || {}));
}

function runConvert(inputPath, outputPath, options) {
	const result = runPython([
		converter,
		'--mode',
		'svg-to-tiff',
		'--input',
		inputPath,
		'--output',
		outputPath,
		'--options',
		JSON.stringify(options || {})
	]);
	return result;
}

function inspectTiff(filePath) {
	const code = [
		'import json, sys',
		'from PIL import Image',
		'img = Image.open(sys.argv[1])',
		'dpi = img.info.get("dpi")',
		'if dpi is not None: dpi = [float(dpi[0]), float(dpi[1])]',
		'print(json.dumps({"size": img.size, "mode": img.mode, "dpi": dpi, "hasIcc": bool(img.info.get("icc_profile"))}))'
	].join('\n');
	const result = runPython(['-c', code, filePath]);
	assert.strictEqual(result.status, 0, result.stderr || result.stdout);
	return JSON.parse(result.stdout);
}

function makeSrgbIccBase64() {
	const code = [
		'from PIL import ImageCms',
		'import base64',
		'profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))',
		'print(base64.b64encode(profile.tobytes()).decode("ascii"))'
	].join('\n');
	const result = runPython(['-c', code]);
	assert.strictEqual(result.status, 0, result.stderr || result.stdout);
	return result.stdout.trim();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deepnest-tiff-test-'));
const input = path.join(tmp, 'fixture.svg');
fs.writeFileSync(input, [
	'<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="1in" viewBox="0 0 200 100">',
	'<rect x="10" y="10" width="80" height="60" fill="#f00"/>',
	'<circle cx="140" cy="50" r="30" fill="none" stroke="#000" stroke-width="4"/>',
	'</svg>'
].join(''), 'utf8');

const rgbOutput = path.join(tmp, 'rgb.tiff');
let result = runConvert(input, rgbOutput, {
	dpi: 300,
	widthInches: 2,
	heightInches: 1,
	colorMode: 'rgb',
	background: 'white',
	compression: 'lzw'
});
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
let info = inspectTiff(rgbOutput);
assert.deepStrictEqual(info.size, [600, 300]);
assert.strictEqual(info.mode, 'RGB');
assert.ok(Math.abs(info.dpi[0] - 300) < 0.5 && Math.abs(info.dpi[1] - 300) < 0.5, 'RGB TIFF should carry 300 DPI tags');

const rgbaOutput = path.join(tmp, 'rgba.tiff');
result = runConvert(input, rgbaOutput, {
	dpi: 300,
	widthInches: 2,
	heightInches: 1,
	colorMode: 'rgb',
	background: 'transparent',
	compression: 'lzw'
});
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
info = inspectTiff(rgbaOutput);
assert.deepStrictEqual(info.size, [600, 300]);
assert.strictEqual(info.mode, 'RGBA');

const iccOutput = path.join(tmp, 'icc.tiff');
result = runConvert(input, iccOutput, {
	dpi: 150,
	widthInches: 2,
	heightInches: 1,
	colorMode: 'rgb',
	background: 'white',
	compression: 'lzw',
	iccProfileBase64: makeSrgbIccBase64()
});
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
info = inspectTiff(iccOutput);
assert.strictEqual(info.hasIcc, true, 'RGB TIFF should embed supplied ICC profile');

const cmykOutput = path.join(tmp, 'cmyk-no-icc.tiff');
result = runConvert(input, cmykOutput, {
	dpi: 300,
	widthInches: 2,
	heightInches: 1,
	colorMode: 'cmyk',
	background: 'white',
	compression: 'lzw'
});
assert.notStrictEqual(result.status, 0, 'CMYK without ICC should fail');
assert.ok((result.stderr || '').indexOf('cmyk-requires-icc') >= 0, result.stderr || result.stdout);

console.log('tiff export tests passed');

'use strict';

var fs = require('fs');
var path = require('path');

/**
 * Generate a self-contained HTML viewer that embeds all snapshot SVGs
 * as an animated flipbook with playback controls.
 *
 * @param {string} snapshotDir - Directory containing snapshot-eval-NNNN.svg files
 * @param {string} [outputPath] - Where to write the viewer (defaults to snapshotDir/viewer.html)
 * @returns {string} Path to the generated viewer
 */
function generateViewer(snapshotDir, outputPath) {
	var files = fs.readdirSync(snapshotDir)
		.filter(function(f) { return /^snapshot-eval-\d+\.svg$/.test(f); })
		.sort();

	if (files.length === 0) {
		throw new Error('No snapshot-eval-*.svg files found in ' + snapshotDir);
	}

	var frames = [];
	for (var i = 0; i < files.length; i++) {
		var svgContent = fs.readFileSync(path.join(snapshotDir, files[i]), 'utf8');
		// Strip the XML declaration so it can be inlined
		svgContent = svgContent.replace(/<\?xml[^?]*\?>\s*/, '');
		frames.push(svgContent);
	}

	// Also load the job.json metadata if available
	var jobMeta = null;
	var jobPath = path.join(snapshotDir, 'job.json');
	if (fs.existsSync(jobPath)) {
		try {
			jobMeta = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
		} catch (e) {}
	}

	var resultMeta = null;
	var resultPath = path.join(snapshotDir, 'result.json');
	if (fs.existsSync(resultPath)) {
		try {
			resultMeta = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
		} catch (e) {}
	}

	var jobId = (jobMeta && jobMeta.job_id) || path.basename(snapshotDir);
	var totalEvals = frames.length;
	var finalFitness = (resultMeta && resultMeta.metrics) ? resultMeta.metrics.fitness : null;
	var utilization = (resultMeta && resultMeta.metrics) ? resultMeta.metrics.utilization_ratio : null;
	var legal = (resultMeta && resultMeta.legality) ? resultMeta.legality.legal : null;

	var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
		'<meta charset="UTF-8">\n' +
		'<title>Nesting Snapshot Viewer — ' + escapeHtml(jobId) + '</title>\n' +
		'<style>\n' +
		'* { margin: 0; padding: 0; box-sizing: border-box; }\n' +
		'body { background: #0d0f12; color: #ccc; font-family: "SF Mono", "Fira Code", monospace; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }\n' +
		'.header { padding: 16px 24px 8px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }\n' +
		'.header h1 { font-size: 16px; color: #70d4a0; font-weight: 600; }\n' +
		'.header .meta { font-size: 12px; color: #777; }\n' +
		'.header .meta span { color: #aaa; }\n' +
		'.viewer { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 8px; }\n' +
		'.viewer svg { max-width: 100%; max-height: 100%; }\n' +
		'.controls { padding: 12px 24px 16px; display: flex; align-items: center; gap: 16px; background: #161922; border-top: 1px solid #2a2d35; }\n' +
		'.controls button { background: #2a2d35; color: #ccc; border: 1px solid #3a3d45; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-family: inherit; font-size: 13px; transition: all 0.15s; }\n' +
		'.controls button:hover { background: #3a3d45; color: #fff; }\n' +
		'.controls button.active { background: #2d6a4f; border-color: #40916c; color: #fff; }\n' +
		'.controls .slider-wrap { flex: 1; display: flex; align-items: center; gap: 12px; }\n' +
		'.controls input[type=range] { flex: 1; accent-color: #52b788; height: 6px; }\n' +
		'.controls .eval-label { font-size: 14px; min-width: 80px; text-align: center; color: #70d4a0; font-weight: 600; }\n' +
		'.controls .fitness-label { font-size: 12px; color: #888; min-width: 160px; text-align: right; }\n' +
		'.speed-group { display: flex; gap: 4px; }\n' +
		'.speed-group button { padding: 4px 8px; font-size: 11px; }\n' +
		'</style>\n</head>\n<body>\n' +
		'<div class="header">\n' +
		'  <h1>🔍 ' + escapeHtml(jobId) + '</h1>\n' +
		'  <div class="meta">' + totalEvals + ' evaluations' +
		(utilization !== null ? ' · utilization <span>' + (utilization * 100).toFixed(1) + '%</span>' : '') +
		(legal !== null ? ' · ' + (legal ? '<span style="color:#52b788">legal</span>' : '<span style="color:#e76f51">illegal</span>') : '') +
		(finalFitness !== null ? ' · fitness <span>' + finalFitness.toFixed(2) + '</span>' : '') +
		'</div>\n' +
		'</div>\n' +
		'<div class="viewer" id="viewer"></div>\n' +
		'<div class="controls">\n' +
		'  <button id="prevBtn" title="Previous">◀</button>\n' +
		'  <button id="playBtn" title="Play/Pause">▶ Play</button>\n' +
		'  <button id="nextBtn" title="Next">▶</button>\n' +
		'  <div class="slider-wrap">\n' +
		'    <div class="eval-label" id="evalLabel">eval 1</div>\n' +
		'    <input type="range" id="slider" min="0" max="' + (totalEvals - 1) + '" value="0" step="1">\n' +
		'  </div>\n' +
		'  <div class="speed-group">\n' +
		'    <button data-speed="200" title="Fast">2×</button>\n' +
		'    <button data-speed="500" class="active" title="Normal">1×</button>\n' +
		'    <button data-speed="1000" title="Slow">½×</button>\n' +
		'  </div>\n' +
		'  <div class="fitness-label" id="fitnessLabel"></div>\n' +
		'</div>\n' +
		'<script>\n' +
		'var frames = ' + JSON.stringify(frames) + ';\n' +
		'var viewer = document.getElementById("viewer");\n' +
		'var slider = document.getElementById("slider");\n' +
		'var evalLabel = document.getElementById("evalLabel");\n' +
		'var fitnessLabel = document.getElementById("fitnessLabel");\n' +
		'var playBtn = document.getElementById("playBtn");\n' +
		'var prevBtn = document.getElementById("prevBtn");\n' +
		'var nextBtn = document.getElementById("nextBtn");\n' +
		'var currentFrame = 0;\n' +
		'var playing = false;\n' +
		'var playInterval = null;\n' +
		'var speed = 500;\n\n' +
		'function showFrame(idx) {\n' +
		'  currentFrame = Math.max(0, Math.min(frames.length - 1, idx));\n' +
		'  viewer.innerHTML = frames[currentFrame];\n' +
		'  slider.value = currentFrame;\n' +
		'  evalLabel.textContent = "eval " + (currentFrame + 1) + "/" + frames.length;\n' +
		'  var match = frames[currentFrame].match(/fitness ([\\d.]+)/);\n' +
		'  fitnessLabel.textContent = match ? "fitness " + parseFloat(match[1]).toFixed(2) : "";\n' +
		'}\n\n' +
		'function togglePlay() {\n' +
		'  playing = !playing;\n' +
		'  playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";\n' +
		'  playBtn.classList.toggle("active", playing);\n' +
		'  if (playing) {\n' +
		'    if (currentFrame >= frames.length - 1) currentFrame = 0;\n' +
		'    playInterval = setInterval(function() {\n' +
		'      if (currentFrame >= frames.length - 1) { togglePlay(); return; }\n' +
		'      showFrame(currentFrame + 1);\n' +
		'    }, speed);\n' +
		'  } else {\n' +
		'    clearInterval(playInterval);\n' +
		'  }\n' +
		'}\n\n' +
		'slider.addEventListener("input", function() { showFrame(parseInt(this.value)); });\n' +
		'playBtn.addEventListener("click", togglePlay);\n' +
		'prevBtn.addEventListener("click", function() { showFrame(currentFrame - 1); });\n' +
		'nextBtn.addEventListener("click", function() { showFrame(currentFrame + 1); });\n' +
		'document.addEventListener("keydown", function(e) {\n' +
		'  if (e.key === "ArrowLeft") showFrame(currentFrame - 1);\n' +
		'  if (e.key === "ArrowRight") showFrame(currentFrame + 1);\n' +
		'  if (e.key === " ") { e.preventDefault(); togglePlay(); }\n' +
		'});\n' +
		'document.querySelectorAll("[data-speed]").forEach(function(btn) {\n' +
		'  btn.addEventListener("click", function() {\n' +
		'    speed = parseInt(this.dataset.speed);\n' +
		'    document.querySelectorAll("[data-speed]").forEach(function(b) { b.classList.remove("active"); });\n' +
		'    this.classList.add("active");\n' +
		'    if (playing) { clearInterval(playInterval); playInterval = setInterval(function() { if (currentFrame >= frames.length - 1) { togglePlay(); return; } showFrame(currentFrame + 1); }, speed); }\n' +
		'  });\n' +
		'});\n' +
		'showFrame(0);\n' +
		'</script>\n</body>\n</html>\n';

	var viewerPath = outputPath || path.join(snapshotDir, 'viewer.html');
	fs.writeFileSync(viewerPath, html);
	return viewerPath;
}

function escapeHtml(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = {
	generateViewer: generateViewer
};

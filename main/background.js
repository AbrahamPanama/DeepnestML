'use strict';

var nativeAddon = null;
var nativeAddonLoadAttempted = false;
var nativeAddonLoadError = null;

function pushUniqueNativeAddonCandidate(candidates, candidate){
	if(!candidate || candidates.indexOf(candidate) >= 0){
		return;
	}
	candidates.push(candidate);

	var unpacked = candidate.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
	if(unpacked !== candidate && candidates.indexOf(unpacked) < 0){
		candidates.push(unpacked);
	}
}

function buildNativeAddonCandidates(){
	var path = require('path');
	var candidates = [];

	[
		path.join(__dirname, '..', 'build', 'Release', 'addon'),
		path.join(__dirname, '..', 'build', 'Release', 'addon.node'),
		path.join(__dirname, '..', 'minkowski', 'Release', 'addon'),
		path.join(__dirname, '..', 'minkowski', 'Release', 'addon.node')
	].forEach(function(candidate){
		pushUniqueNativeAddonCandidate(candidates, candidate);
	});

	if(process.resourcesPath){
		[
			path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'addon'),
			path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'addon.node'),
			path.join(process.resourcesPath, 'app.asar.unpacked', 'minkowski', 'Release', 'addon'),
			path.join(process.resourcesPath, 'app.asar.unpacked', 'minkowski', 'Release', 'addon.node'),
			path.join(process.resourcesPath, 'app', 'build', 'Release', 'addon'),
			path.join(process.resourcesPath, 'app', 'build', 'Release', 'addon.node')
		].forEach(function(candidate){
			pushUniqueNativeAddonCandidate(candidates, candidate);
		});
	}

	return candidates;
}

function loadBackgroundNativeAddon(){
	if(nativeAddonLoadAttempted){
		return nativeAddon;
	}

	nativeAddonLoadAttempted = true;
	var candidates = buildNativeAddonCandidates();
	var lastError = null;

	for(var i=0; i<candidates.length; i++){
		try {
			nativeAddon = require(candidates[i]);
			nativeAddonLoadError = null;
			return nativeAddon;
		}
		catch(err){
			lastError = err;
		}
	}

	nativeAddon = null;
	nativeAddonLoadError = lastError && lastError.message ? lastError.message : 'native-addon-unavailable';
	return null;
}

function calculateNativeAddonNfp(ipcRenderer, A, B){
	var addon = loadBackgroundNativeAddon();
	if(addon && typeof addon.calculateNFP === 'function'){
		return addon.calculateNFP({ A: A, B: B });
	}

	var response = ipcRenderer.sendSync('minkowski-calculate-nfp-sync', { A: A, B: B });
	if(!response || response.ok !== true){
		throw new Error(response && response.error ? response.error : (nativeAddonLoadError || 'native-addon-unavailable'));
	}
	return response.value;
}


function clone(nfp){
	var newnfp = [];
	for(var i=0; i<nfp.length; i++){
		newnfp.push({
			x: nfp[i].x,
			y: nfp[i].y
		});
	}
	
	if(nfp.children && nfp.children.length > 0){
		newnfp.children = [];
		for(i=0; i<nfp.children.length; i++){
			var child = nfp.children[i];
			var newchild = [];
			for(var j=0; j<child.length; j++){
				newchild.push({
					x: child[j].x,
					y: child[j].y
				});
			}
			newnfp.children.push(newchild);
		}
	}
	
	return newnfp;
}

function cloneNfp(nfp, inner){
	if(!inner){
		return clone(nfp);
	}
	
	// inner nfp is actually an array of nfps
	var newnfp = [];
	for(var i=0; i<nfp.length; i++){
		newnfp.push(clone(nfp[i]));
	}
	
	return newnfp;
}

// NFP_CACHE_VERSION is part of the cache key so a schema change invalidates
// all persisted entries. The size / byte / manifest-path constants used to
// live here too — they moved to main.js along with cache ownership.
var NFP_CACHE_VERSION = 3;

var nonCanonicalNfpLookups = 0;
var backgroundGeometryCache = {};
var backgroundGeometryCacheOrder = [];

function cacheBackgroundNestGeometry(token, geometry){
	if(!token || !geometry){
		return null;
	}
	if(backgroundGeometryCache[token]){
		var existingIndex = backgroundGeometryCacheOrder.indexOf(token);
		if(existingIndex >= 0){
			backgroundGeometryCacheOrder.splice(existingIndex, 1);
		}
	}
	backgroundGeometryCache[token] = geometry;
	backgroundGeometryCacheOrder.push(token);
	while(backgroundGeometryCacheOrder.length > 2){
		var staleToken = backgroundGeometryCacheOrder.shift();
		delete backgroundGeometryCache[staleToken];
	}
	return geometry;
}

function getBackgroundNestGeometry(token){
	if(!token){
		return null;
	}
	if(backgroundGeometryCache[token]){
		return backgroundGeometryCache[token];
	}
	var geometry = ipcRendererSafeSendSync('nest-geometry-get-sync', token);
	if(!geometry){
		return null;
	}
	return cacheBackgroundNestGeometry(token, geometry);
}

function cloneGeometryTree(tree, includeChildren){
	var newtree = [];
	if(!tree || !tree.length){
		return newtree;
	}
	for(var i=0; i<tree.length; i++){
		newtree.push({x: tree[i].x, y: tree[i].y, exact: tree[i].exact});
	}
	if(includeChildren && tree.children && tree.children.length > 0){
		newtree.children = cloneGeometryChildren(tree.children);
	}
	return newtree;
}

function cloneGeometryChildren(children){
	if(!children || !children.length){
		return children;
	}
	var cloned = [];
	for(var i=0; i<children.length; i++){
		cloned.push(cloneGeometryTree(children[i], true));
	}
	return cloned;
}

function geometryChildrenForSource(geometry, source, sourceTree){
	if(geometry.partsChildrenBySource && Object.prototype.hasOwnProperty.call(geometry.partsChildrenBySource, source)){
		return geometry.partsChildrenBySource[source];
	}
	if(geometry.partchildren && Object.prototype.hasOwnProperty.call(geometry.partchildren, source)){
		return geometry.partchildren[source];
	}
	return sourceTree ? sourceTree.children : null;
}

function hydrateLegacyBackgroundStartData(data){
	var individual = data.individual;
	var parts = individual.placement;
	var rotations = individual.rotation;
	var ids = data.ids;
	var sources = data.sources;
	var children = data.children;

	for(var i=0; i<parts.length; i++){
		parts[i].rotation = rotations[i];
		parts[i].id = ids[i];
		parts[i].source = sources[i];
		if(!data.config || !data.config.simplify){
			parts[i].children = children[i];
		}
	}

	for(i=0; i<data.sheets.length; i++){
		data.sheets[i].id = data.sheetids[i];
		data.sheets[i].source = data.sheetsources[i];
		data.sheets[i].children = data.sheetchildren[i];
	}

	return {
		parts: parts,
		sheets: data.sheets,
		geometryPath: 'legacy'
	};
}

function hydrateTokenBackgroundStartData(data){
	var geometry = getBackgroundNestGeometry(data.nestToken);
	if(!geometry){
		return { error: 'Nest geometry was unavailable. Please restart the nest.' };
	}
	var ids = data.ids || [];
	var sources = data.sources || [];
	var rotations = data.rotations || [];
	if(ids.length !== sources.length || ids.length !== rotations.length){
		return { error: 'Nest geometry payload was incomplete.' };
	}
	if(!geometry.partsBySource || !geometry.sheets){
		return { error: 'Nest geometry payload was missing source geometry.' };
	}

	var parts = [];
	for(var i=0; i<sources.length; i++){
		var source = sources[i];
		var sourceTree = geometry.partsBySource[source];
		if(!sourceTree){
			return { error: 'Nest geometry was missing part source ' + source + '.' };
		}
		var part = cloneGeometryTree(sourceTree, false);
		part.rotation = rotations[i];
		part.id = ids[i];
		part.source = source;
		if(!data.config || !data.config.simplify){
			var children = geometryChildrenForSource(geometry, source, sourceTree);
			if(children){
				part.children = cloneGeometryChildren(children);
			}
		}
		parts.push(part);
	}

	var sheets = [];
	var sheetids = geometry.sheetids || [];
	var sheetsources = geometry.sheetsources || [];
	var sheetchildren = geometry.sheetchildren || [];
	for(i=0; i<geometry.sheets.length; i++){
		var sheet = cloneGeometryTree(geometry.sheets[i], false);
		sheet.id = sheetids[i];
		sheet.source = sheetsources[i];
		var sheetChildren = sheetchildren[i] || geometry.sheets[i].children;
		if(sheetChildren){
			sheet.children = cloneGeometryChildren(sheetChildren);
		}
		sheets.push(sheet);
	}

	return {
		parts: parts,
		sheets: sheets,
		geometryPath: 'token'
	};
}

function resolveBackgroundStartGeometry(data){
	if(data && data.individual && data.individual.placement){
		return hydrateLegacyBackgroundStartData(data);
	}
	if(data && data.nestToken){
		return hydrateTokenBackgroundStartData(data);
	}
	return { error: 'Background worker received a nest without geometry.' };
}

function backgroundDispatchMs(data){
	if(!data || typeof data.dispatchStartedAt !== 'number'){
		return null;
	}
	var elapsed = Date.now() - data.dispatchStartedAt;
	return elapsed >= 0 ? elapsed : 0;
}

function hashString(value){
	var hash = 2166136261;
	for(var i=0; i<value.length; i++){
		hash ^= value.charCodeAt(i);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return (hash >>> 0).toString(16);
}

function roundedCoordinate(value){
	var number = Number(value);
	if(!isFinite(number)){
		number = 0;
	}
	return number.toFixed(5);
}

function polygonSignatureText(polygon){
	if(!polygon || !polygon.length){
		return 'empty';
	}

	var parts = ['p', polygon.length];
	for(var i=0; i<polygon.length; i++){
		parts.push(roundedCoordinate(polygon[i].x));
		parts.push(roundedCoordinate(polygon[i].y));
	}

	if(polygon.children && polygon.children.length){
		parts.push('children', polygon.children.length);
		for(i=0; i<polygon.children.length; i++){
			parts.push(polygonSignatureText(polygon.children[i]));
		}
	}

	return parts.join(',');
}

function polygonFingerprint(polygon){
	if(polygon && polygon.__dnFingerprint){
		return polygon.__dnFingerprint;
	}
	var fp = hashString(polygonSignatureText(polygon));
	if(polygon && typeof polygon === 'object'){
		try {
			Object.defineProperty(polygon, '__dnFingerprint', {
				value: fp,
				enumerable: false,
				configurable: true
			});
		}
		catch(e){
			// Frozen/sealed inputs still get a correct fingerprint; they just skip memoization.
		}
	}
	return fp;
}

function nfpCacheKey(obj, inner){
	var apoly = obj.Apolygon || obj.Ashape;
	var bpoly = obj.Bpolygon || obj.Bshape;
	if(!apoly || !bpoly){
		// Persistent cache entries must be geometry-keyed. Falling back to source
		// ids would be unsafe across imported jobs, so source-only lookups stay
		// uncacheable instead of risking a wrong NFP.
		return null;
	}

	var parts = [
		'v' + NFP_CACHE_VERSION,
		inner ? 'inner' : 'outer',
		'a' + parseInt(obj.Arotation || 0),
		'b' + parseInt(obj.Brotation || 0)
	];
	// Only append the "no-holes" marker when the caller has explicitly opted
	// out of hole processing. Omitting the marker otherwise keeps every
	// previously warmed cache entry (written under the old hole-aware
	// semantics) reachable without bumping NFP_CACHE_VERSION.
	if(obj && obj.processHoles === false){
		parts.push('nh');
	}
	parts.push(polygonFingerprint(apoly));
	parts.push(polygonFingerprint(bpoly));
	return parts.join('-');
}

function buildOuterNfpCacheDoc(A, B, processHoles, nfp){
	var doc = {
		A: A.source,
		B: B.source,
		Arotation: A.rotation,
		Brotation: B.rotation,
		Apolygon: A,
		Bpolygon: B,
		processHoles: processHoles
	};
	if(typeof nfp !== 'undefined'){
		doc.nfp = nfp;
	}
	return doc;
}

function buildInnerNfpCacheDoc(A, B, nfp){
	var doc = {
		A: A.source,
		B: B.source,
		Arotation: 0,
		Brotation: B.rotation,
		Apolygon: A,
		Bpolygon: B
	};
	if(typeof nfp !== 'undefined'){
		doc.nfp = nfp;
	}
	return doc;
}

// NFP cache ownership lives in main.js. This renderer keeps a per-window
// in-memory mirror (window.nfpcache) so repeated hits stay free of IPC, and
// falls back to synchronous IPC for cross-window / disk-backed lookups and
// inserts. Writes are fire-and-forget (async IPC) because the consumer does
// not need to observe them before continuing.
function ipcRendererSafeSend(channel, message){
	try {
		if(window.ipcRenderer){
			window.ipcRenderer.send(channel, message);
		}
	}
	catch(err){
		// ipc failure is non-fatal; a missed insert just means a future miss.
	}
}

function ipcRendererSafeSendSync(channel, message){
	try {
		if(window.ipcRenderer){
			return window.ipcRenderer.sendSync(channel, message);
		}
	}
	catch(err){
		// ipc failure returns a miss; callers already handle null/false.
	}
	return null;
}

function warmLocalNfpCache(key, nfp, inner){
	if(!key || !nfp){
		return;
	}
	var memory = window.performance && window.performance.memory;
	if(!memory || memory.totalJSHeapSize < 0.8*memory.jsHeapSizeLimit){
		window.nfpcache[key] = cloneNfp(nfp, inner);
	}
}

function nfpBatchResponseValues(response){
	if(!response){
		return null;
	}
	if(Array.isArray(response)){
		return response;
	}
	if(response.values && Array.isArray(response.values)){
		return response.values;
	}
	return null;
}

function estimateNfpPayloadBytes(nfp){
	if(!nfp){
		return 0;
	}
	try{
		return JSON.stringify(nfp).length;
	}
	catch(e){
		return 0;
	}
}

function addNfpPrefetchEntry(entries, seen, doc, inner){
	var key = nfpCacheKey(doc, inner);
	if(!key || seen[key] || window.nfpcache[key]){
		return;
	}
	seen[key] = true;
	entries.push({
		key: key,
		inner: inner === true
	});
}

function warmNfpCacheBatch(entries){
	var stats = {
		eligible: entries.length,
		requested: 0,
		chunks: 0,
		hits: 0,
		misses: 0,
		bytes: 0,
		elapsedMs: 0,
		capped: false,
		checked: {}
	};
	if(!entries.length){
		return stats;
	}

	var chunkSize = 2000;
	var maxBytes = 64 * 1024 * 1024;
	var maxMs = 250;
	var started = Date.now();
	for(var i=0; i<entries.length; i += chunkSize){
		if(stats.bytes >= maxBytes || Date.now() - started >= maxMs){
			stats.capped = true;
			break;
		}
		var chunk = entries.slice(i, i + chunkSize);
		var keys = [];
		for(var j=0; j<chunk.length; j++){
			keys.push(chunk[j].key);
		}
		var response = ipcRendererSafeSendSync('nfp-cache-find-batch-sync', keys);
		var values = nfpBatchResponseValues(response);
		if(!values){
			stats.capped = true;
			break;
		}
		stats.chunks++;
		stats.requested += keys.length;
		if(response && typeof response.bytes === 'number'){
			stats.bytes += response.bytes;
		}
		for(j=0; j<chunk.length; j++){
			var value = values[j] || null;
			stats.checked[chunk[j].key] = true;
			if(value){
				warmLocalNfpCache(chunk[j].key, value, chunk[j].inner);
				stats.hits++;
				if(!response || typeof response.bytes !== 'number'){
					stats.bytes += estimateNfpPayloadBytes(value);
				}
			}
			else{
				stats.misses++;
			}
		}
	}
	stats.elapsedMs = Date.now() - started;
	return stats;
}

function buildNfpPrefetchEntries(sheets, parts, config, processHoles){
	var entries = [];
	var seen = {};
	var i;
	var j;
	var rotated = [];
	for(i=0; i<parts.length; i++){
		var r = rotatePolygon(parts[i], parts[i].rotation);
		r.rotation = parts[i].rotation;
		r.source = parts[i].source;
		r.id = parts[i].id;
		rotated.push(r);
	}

	var pairSeen = [];
	var inpairs = function(key, p){
		for(var k=0; k<p.length; k++){
			if(p[k].Asource == key.Asource && p[k].Bsource == key.Bsource && p[k].Arotation == key.Arotation && p[k].Brotation == key.Brotation){
				return true;
			}
		}
		return false;
	};

	for(i=0; i<parts.length; i++){
		var B = parts[i];
		for(j=0; j<i; j++){
			var A = parts[j];
			var pairKey = {
				Asource: A.source,
				Bsource: B.source,
				Arotation: A.rotation,
				Brotation: B.rotation
			};
			if(!inpairs(pairKey, pairSeen)){
				pairSeen.push(pairKey);
				addNfpPrefetchEntry(entries, seen, buildOuterNfpCacheDoc(rotated[j], rotated[i], processHoles), false);
			}
		}
	}

	for(i=0; i<rotated.length; i++){
		for(j=0; j<rotated.length; j++){
			if(i === j){
				continue;
			}
			addNfpPrefetchEntry(entries, seen, buildOuterNfpCacheDoc(rotated[i], rotated[j], processHoles), false);
		}
	}

	for(i=0; i<sheets.length; i++){
		for(j=0; j<rotated.length; j++){
			addNfpPrefetchEntry(entries, seen, buildInnerNfpCacheDoc(sheets[i], rotated[j]), true);
		}
	}

	return entries;
}

function nfpBatchTiming(stats){
	return {
		eligible: stats.eligible,
		requested: stats.requested,
		chunks: stats.chunks,
		hits: stats.hits,
		misses: stats.misses,
		bytes: stats.bytes,
		elapsedMs: stats.elapsedMs,
		capped: stats.capped
	};
}

window.db = {
	has: function(obj){
		var key = nfpCacheKey(obj, obj.inner);
		if(!key){
			return false;
		}
		if(window.nfpcache[key]){
			return true;
		}
		return !!ipcRendererSafeSendSync('nfp-cache-has-sync', key);
	},

	find : function(obj, inner){
		var key = nfpCacheKey(obj, inner);
		if(!key){
			return null;
		}
		if(window.nfpcache[key]){
			return cloneNfp(window.nfpcache[key], inner);
		}
		var remote = ipcRendererSafeSendSync('nfp-cache-find-sync', key);
		if(!remote){
			return null;
		}
		warmLocalNfpCache(key, remote, inner);
		return cloneNfp(remote, inner);
	},

	insert : function(obj, inner){
		var key = nfpCacheKey(obj, inner);
		if(!key){
			return;
		}
		warmLocalNfpCache(key, obj.nfp, inner);
		ipcRendererSafeSend('nfp-cache-insert', { key: key, nfp: obj.nfp });
	}
}

window.onload = function () {
	const { ipcRenderer } = require('electron');
	window.ipcRenderer = ipcRenderer;
	
	window.path = require('path')
	window.url = require('url')
	window.fs = require('graceful-fs');
	window.FileQueue = require('filequeue');
	window.fq = new FileQueue(500);
	
	window.nfpcache = {};
	ipcRenderer.send('background-ready');
	  
	ipcRenderer.on('background-start', (event, data) => {
		var index = data.index;
		var dispatchMs = backgroundDispatchMs(data);
		var geometryData = resolveBackgroundStartGeometry(data);
		if(geometryData.error){
			ipcRenderer.send('background-progress', {index: index, progress: -1});
			ipcRenderer.send('background-response', {
				index: data.index,
				fitness: Number.MAX_VALUE,
				placements: [],
				error: geometryData.error,
				timing: {
					dispatchMs: dispatchMs,
					geometryPath: data && data.nestToken ? 'missing' : 'none'
				}
			});
			return;
		}
	    var parts = geometryData.parts;
		data.sheets = geometryData.sheets;

		if(data.config && data.config.placementType === 'steprepeat'){
			try{
				var stepPlacement = placePartsStepRepeat(data.sheets, parts, data.config, index);
				stepPlacement.index = data.index;
				stepPlacement.localRefinement = createLocalRefinementStats(false);
				stepPlacement.timing = stepPlacement.timing || {};
				stepPlacement.timing.dispatchMs = dispatchMs;
				stepPlacement.timing.geometryPath = geometryData.geometryPath;
				ipcRenderer.send('background-response', stepPlacement);
			}
			catch(stepRepeatError){
				ipcRenderer.send('background-progress', {index: index, progress: -1});
				ipcRenderer.send('background-response', {
					index: data.index,
					fitness: Number.MAX_VALUE,
					placements: [],
					error: stepRepeatError && stepRepeatError.message ? stepRepeatError.message : 'Step & Repeat failed'
				});
			}
			return;
		}
		
		// preprocess
		var processHoles = !data.config || data.config.processHoles !== false;
		var nfpBatchStats = warmNfpCacheBatch(buildNfpPrefetchEntries(data.sheets, parts, data.config, processHoles));
		var pairsCacheHits = 0;
		var pairsMissing = 0;
		var pairs = [];
		var inpairs = function(key, p){
			for(var i=0; i<p.length; i++){
				if(p[i].Asource == key.Asource && p[i].Bsource == key.Bsource && p[i].Arotation == key.Arotation && p[i].Brotation == key.Brotation){
					return true;
				}
			}
			return false;
		}
		for(var i=0; i<parts.length; i++){
			var B = parts[i];
			for(var j=0; j<i; j++){
				var A = parts[j];
				var key = {
					A: A,
					B: B,
					Arotation: A.rotation,
					Brotation: B.rotation,
					Asource: A.source,
					Bsource: B.source
				};
				var doc = buildOuterNfpCacheDoc(rotatePolygon(A, A.rotation), rotatePolygon(B, B.rotation), processHoles);
				if(!inpairs(key, pairs)){
					var docKey = nfpCacheKey(doc, false);
					if(docKey && window.nfpcache[docKey]){
						pairsCacheHits++;
					}
					else if(docKey && nfpBatchStats.checked[docKey]){
						pairs.push(key);
					}
					else if(db.has(doc)){
						pairsCacheHits++;
					}
					else{
						pairs.push(key);
					}
				}
			}
		}
		pairsMissing = pairs.length;
		
		console.log('pairs: ',pairs.length);
		  
		  var process = function(pair){
			
			var A = rotatePolygon(pair.A, pair.Arotation);
			var B = rotatePolygon(pair.B, pair.Brotation);
			
			var clipper = new ClipperLib.Clipper();
			
			var Ac = toClipperCoordinates(A);
			ClipperLib.JS.ScaleUpPath(Ac, 10000000);
			var Bc = toClipperCoordinates(B);
			ClipperLib.JS.ScaleUpPath(Bc, 10000000);
			for(var i=0; i<Bc.length; i++){
				Bc[i].X *= -1;
				Bc[i].Y *= -1;
			}
			var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
			// At clipperScale precision, near-degenerate inputs (hairline-skewed
			// rectangles from CAD transforms) can make MinkowskiSum emit
			// self-intersecting or fragmented rings; picking the largest raw ring
			// then yields an NFP missing part of the forbidden region, which lets
			// the placer overlap parts. Re-union with nonzero fill to normalize
			// the rings before selection.
			solution = ClipperLib.Clipper.SimplifyPolygons(solution, ClipperLib.PolyFillType.pftNonZero);
			var clipperNfp;

			var largestArea = null;
			for(i=0; i<solution.length; i++){
				var n = toNestCoordinates(solution[i], 10000000);
				var sarea = -GeometryUtil.polygonArea(n);
				if(largestArea === null || largestArea < sarea){
					clipperNfp = n;
					largestArea = sarea;
				}
			}
			
			for(var i=0; i<clipperNfp.length; i++){
				clipperNfp[i].x += B[0].x;
				clipperNfp[i].y += B[0].y;
			}
			
			pair.A = null;
			pair.B = null;
			pair.nfp = clipperNfp;
			return pair;
			
			function toClipperCoordinates(polygon){
				var clone = [];
				for(var i=0; i<polygon.length; i++){
					clone.push({
						X: polygon[i].x,
						Y: polygon[i].y
					});
				}
	
				return clone;
			};
			
			function toNestCoordinates(polygon, scale){
				var clone = [];
				for(var i=0; i<polygon.length; i++){
					clone.push({
						x: polygon[i].X/scale,
						y: polygon[i].Y/scale
					});
				}
	
				return clone;
			};
			
			function rotatePolygon(polygon, degrees){
				var rotated = [];
				var angle = degrees * Math.PI / 180;
				for(var i=0; i<polygon.length; i++){
					var x = polygon[i].x;
					var y = polygon[i].y;
					var x1 = x*Math.cos(angle)-y*Math.sin(angle);
					var y1 = x*Math.sin(angle)+y*Math.cos(angle);
						
					rotated.push({x:x1, y:y1});
				}
	
				return rotated;
			};
		  }
		  
		  // run the placement synchronously
		  function sync(){
		  	//console.log('starting synchronous calculations', Object.keys(window.nfpCache).length);
		  	console.log('in sync');
		  	var c=0;
		  	for (var key in window.nfpcache) {
				c++;
			}
			console.log('nfp cached:', c);
		  	var placement = placeParts(data.sheets, parts, data.config, index);

			placement.index = data.index;
			placement.pairsCacheHits = pairsCacheHits;
			placement.pairsMissing = pairsMissing;
			placement.timing = placement.timing || {};
			placement.timing.dispatchMs = dispatchMs;
			placement.timing.pairsCacheHits = pairsCacheHits;
			placement.timing.pairsMissing = pairsMissing;
			placement.timing.processHoles = processHoles;
			placement.timing.nfpBatch = nfpBatchTiming(nfpBatchStats);
			placement.timing.geometryPath = geometryData.geometryPath;
			if(data.postProcessRefinement){
				placement.postProcessRefinement = true;
				placement.refinementToken = data.refinementToken;
				placement.refinementBaseFitness = data.refinementBaseFitness;
			}
			ipcRenderer.send('background-response', placement);
		  }
		  
		  console.time('Total');
		  
		  
		  if(pairs.length > 0){
			  var p = new Parallel(pairs, {
				evalPath: 'util/eval.js',
				synchronous: false
			  });
			  
			  var spawncount = 0;
				
				p._spawnMapWorker = function (i, cb, done, env, wrk){
					// hijack the worker call to check progress
					ipcRenderer.send('background-progress', {index: index, progress: 0.5*(spawncount++/pairs.length)});
					return Parallel.prototype._spawnMapWorker.call(p, i, cb, done, env, wrk);
				}
			  
			  p.require('clipper.js');
			  p.require('geometryutil.js');
		  
			  p.map(process).then(function(processed){
			  	 function getPart(source){
					for(var k=0; k<parts.length; k++){
						if(parts[k].source == source){
							return parts[k];
						}
					}
					return null;
				  }
				// store processed data in cache
				for(var i=0; i<processed.length; i++){
					// returned data only contains outer nfp, we have to account for any holes separately in the synchronous portion
					// this is because the c++ addon which can process interior nfps cannot run in the worker thread					
					var A = getPart(processed[i].Asource);
					var B = getPart(processed[i].Bsource);
										
					var Achildren = [];
					
					var j;
					if(processHoles && A.children){
						for(j=0; j<A.children.length; j++){
							Achildren.push(rotatePolygon(A.children[j], processed[i].Arotation));
						}
					}
					
					if(Achildren.length > 0){
						var Brotated = rotatePolygon(B, processed[i].Brotation);
						var bbounds = GeometryUtil.getPolygonBounds(Brotated);
						var cnfp = [];
						
						for(j=0; j<Achildren.length; j++){
							var cbounds = GeometryUtil.getPolygonBounds(Achildren[j]);
							if(cbounds.width > bbounds.width && cbounds.height > bbounds.height){
								var n = getInnerNfp(Achildren[j], Brotated, data.config);
								if(n && n.length > 0){
									cnfp = cnfp.concat(n);
								}
							}
						}
						
						processed[i].nfp.children = cnfp;
					}
					
					var doc = buildOuterNfpCacheDoc(rotatePolygon(A, processed[i].Arotation), rotatePolygon(B, processed[i].Brotation), processHoles, processed[i].nfp);
					window.db.insert(doc);
					
				}
				console.timeEnd('Total');
				console.log('before sync');
				sync();
			  });
		  }
		  else{
		  	sync();
		  }
	});
};

// returns the square of the length of any merged lines
// filter out any lines less than minlength long
function mergedLength(parts, p, minlength, tolerance){
	var minLengthSquared = minlength*minlength;
	var totalLength = 0;
	var segments = [];
	
	for(var i=0; i<p.length; i++){
		var A1 = p[i];
		
		if(i+1 == p.length){
			A2 = p[0];
		}
		else{
			var A2 = p[i+1];
		}
		
		if(!A1.exact || !A2.exact){
			continue;
		}
		
		var Ax2 = (A2.x-A1.x)*(A2.x-A1.x);
		var Ay2 = (A2.y-A1.y)*(A2.y-A1.y);
		
		if(Ax2+Ay2 < minLengthSquared){
			continue;
		}
		
		var angle = Math.atan2((A2.y-A1.y),(A2.x-A1.x));

		var c = Math.cos(-angle);
		var s = Math.sin(-angle);
		
		var c2 = Math.cos(angle);
		var s2 = Math.sin(angle);
		
		var relA2 = {x: A2.x-A1.x, y: A2.y-A1.y};
		var rotA2x = relA2.x * c - relA2.y * s;
				
		for(var j=0; j<parts.length; j++){
			var B = parts[j];
			if(B.length > 1){
				for(var k=0; k<B.length; k++){
					var B1 = B[k];
					
					if(k+1 == B.length){
						var B2 = B[0];
					}
					else{
						var B2 = B[k+1];
					}
					
					if(!B1.exact || !B2.exact){
						continue;
					}
					var Bx2 = (B2.x-B1.x)*(B2.x-B1.x);
					var By2 = (B2.y-B1.y)*(B2.y-B1.y);
					
					if(Bx2+By2 < minLengthSquared){
						continue;
					}
					
					// B relative to A1 (our point of rotation)
					var relB1 = {x: B1.x - A1.x, y: B1.y - A1.y};
					var relB2 = {x: B2.x - A1.x, y: B2.y - A1.y};
					
					
					// rotate such that A1 and A2 are horizontal
					var rotB1 = {x: relB1.x * c - relB1.y * s, y: relB1.x * s + relB1.y * c};
					var rotB2 = {x: relB2.x * c - relB2.y * s, y: relB2.x * s + relB2.y * c};
					
					if(!GeometryUtil.almostEqual(rotB1.y, 0, tolerance) || !GeometryUtil.almostEqual(rotB2.y, 0, tolerance)){
						continue;
					}
					
					var min1 = Math.min(0, rotA2x);
					var max1 = Math.max(0, rotA2x);
					
					var bMinX = Math.min(rotB1.x, rotB2.x);
					var bMaxX = Math.max(rotB1.x, rotB2.x);
					
					// not overlapping
					if(bMinX >= max1 || bMaxX <= min1){
						continue;
					}
					
					var len = 0;
					var relC1x = 0;
					var relC2x = 0;
					
					// A is B
					if(GeometryUtil.almostEqual(min1, bMinX) && GeometryUtil.almostEqual(max1, bMaxX)){
						len = max1-min1;
						relC1x = min1;
						relC2x = max1;
					}
					// A inside B
					else if(min1 > bMinX && max1 < bMaxX){
						len = max1-min1;
						relC1x = min1;
						relC2x = max1;
					}
					// B inside A
					else if(bMinX > min1 && bMaxX < max1){
						len = bMaxX-bMinX;
						relC1x = bMinX;
						relC2x = bMaxX;
					}
					else{
						len = Math.max(0, Math.min(max1, bMaxX) - Math.max(min1, bMinX));
						relC1x = Math.min(max1, bMaxX);
						relC2x = Math.max(min1, bMinX);
					}
					
					if(len*len >= minLengthSquared){
						totalLength += len;
						
						var relC1 = {x: relC1x * c2, y: relC1x * s2};
						var relC2 = {x: relC2x * c2, y: relC2x * s2};
						
						var C1 = {x: relC1.x + A1.x, y: relC1.y + A1.y};
						var C2 = {x: relC2.x + A1.x, y: relC2.y + A1.y};
						
						segments.push([C1, C2]);
					}
				}
			}
		}
	}

	for(i=0; i<parts.length; i++){
		if(parts[i].children && parts[i].children.length > 0){
			var child = mergedLength(parts[i].children, p, minlength, tolerance);
			totalLength += child.totalLength;
			segments = segments.concat(child.segments);
		}
	}
	
	return {totalLength: totalLength, segments: segments};
}

function shiftPolygon(p, shift){
	var shifted = [];
	for(var i=0; i<p.length; i++){
		shifted.push({x: p[i].x+shift.x, y:p[i].y+shift.y, exact: p[i].exact});
	}
	if(p.children && p.children.length){
		shifted.children = [];
		for(i=0; i<p.children.length; i++){
			shifted.children.push(shiftPolygon(p.children[i], shift));
		}
	}
	
	return shifted;
}

function isStepRepeatRectangle(polygon, tolerance){
	if(!polygon || polygon.length < 4 || (polygon.children && polygon.children.length > 0)){
		return false;
	}

	var bounds = GeometryUtil.getPolygonBounds(polygon);
	if(!bounds || bounds.width <= tolerance || bounds.height <= tolerance){
		return false;
	}

	for(var i=0; i<polygon.length; i++){
		var point = polygon[i];
		var onVertical = GeometryUtil.almostEqual(point.x, bounds.x, tolerance) || GeometryUtil.almostEqual(point.x, bounds.x + bounds.width, tolerance);
		var onHorizontal = GeometryUtil.almostEqual(point.y, bounds.y, tolerance) || GeometryUtil.almostEqual(point.y, bounds.y + bounds.height, tolerance);
		if(!onVertical && !onHorizontal){
			return false;
		}
	}

	return true;
}

function getStepRepeatRotation(columnIndex, config){
	if(config.stepRepeatAlternate180 && (columnIndex % 2 === 1)){
		return 180;
	}
	return 0;
}

function stepRepeatPolygonContainsPoint(subject, container){
	for(var i=0; i<subject.length; i++){
		var inside = GeometryUtil.pointInPolygon(subject[i], container);
		if(inside === true){
			return true;
		}
	}
	return false;
}

function stepRepeatPolygonsOverlap(A, B){
	if(GeometryUtil.intersect(A, B)){
		return true;
	}

	if(stepRepeatPolygonContainsPoint(A, B)){
		return true;
	}

	if(stepRepeatPolygonContainsPoint(B, A)){
		return true;
	}

	return false;
}

function getStepRepeatVariantKey(source, rotation){
	return String(source) + '@' + String(rotation);
}

function normalizeStepRepeatPolygon(polygon, horizontalAlignment, verticalAlignment){
	var bounds = GeometryUtil.getPolygonBounds(polygon);
	var shiftX = horizontalAlignment === 'center' ? -(bounds.x + bounds.width/2) : -bounds.x;
	var shiftY = verticalAlignment === 'center' ? -(bounds.y + bounds.height/2) : -bounds.y;
	var normalized = shiftPolygon(polygon, {x: shiftX, y: shiftY});
	return {
		polygon: normalized,
		shift: {x: shiftX, y: shiftY},
		bounds: GeometryUtil.getPolygonBounds(normalized)
	};
}

function buildStepRepeatVariants(parts, config){
	var horizontalAlignment = config.stepRepeatHorizontalAlignment === 'center' ? 'center' : 'tight';
	var verticalAlignment = config.stepRepeatVerticalAlignment === 'center' ? 'center' : 'tight';
	var sourceMap = {};
	var rotations = [0];
	var variants = {};
	var variantList = [];

	if(config.stepRepeatAlternate180){
		rotations.push(180);
	}

	for(var i=0; i<parts.length; i++){
		if(typeof sourceMap[parts[i].source] === 'undefined'){
			sourceMap[parts[i].source] = parts[i];
		}
	}

	Object.keys(sourceMap).forEach(function(source){
		var part = sourceMap[source];
		for(var i=0; i<rotations.length; i++){
			var rotation = rotations[i];
			var rotated = rotation === 0 ? part : rotatePolygon(part, rotation);
			var normalized = normalizeStepRepeatPolygon(rotated, horizontalAlignment, verticalAlignment);
			var key = getStepRepeatVariantKey(source, rotation);
			variantList.push(normalized);
			variants[key] = normalized;
		}
	});

	return {
		variants: variants,
		list: variantList
	};
}

function getStepRepeatSafeAxisDistance(variantA, variantB, axis, tolerance){
	var boundsA = variantA.bounds;
	var boundsB = variantB.bounds;
	var upper = axis === 'x' ? (boundsA.width + boundsB.width + 1) : (boundsA.height + boundsB.height + 1);
	var low = 0;
	var high = Math.max(upper, tolerance * 10);
	var guard = 0;

	function overlaps(distance){
		var shift = axis === 'x' ? {x: distance, y: 0} : {x: 0, y: distance};
		return stepRepeatPolygonsOverlap(variantA.polygon, shiftPolygon(variantB.polygon, shift));
	}

	while(overlaps(high) && guard < 20){
		high *= 2;
		guard++;
	}

	if(overlaps(high)){
		throw new Error('Step & Repeat could not derive a safe repeat pitch for the selected parts.');
	}

	for(var i=0; i<30; i++){
		var mid = (low + high) / 2;
		if(overlaps(mid)){
			low = mid;
		}
		else{
			high = mid;
		}
	}

	return high;
}

function getStepRepeatPitch(axis, parts, config, variantData, fallbackPitch, tolerance){
	var combos;
	var maxDistance = 0;
	var uniqueSources = {};
	var i;
	var j;

	for(i=0; i<parts.length; i++){
		uniqueSources[parts[i].source] = true;
	}

	if(axis === 'x'){
		if(config.stepRepeatAlternate180){
			combos = [[0, 180], [180, 0]];
		}
		else{
			combos = [[0, 0]];
		}
	}
	else{
		if(config.stepRepeatAlternate180){
			combos = [[0, 0], [180, 180]];
		}
		else{
			combos = [[0, 0]];
		}
	}

	var sources = Object.keys(uniqueSources);
	for(i=0; i<sources.length; i++){
		for(j=0; j<sources.length; j++){
			for(var comboIndex = 0; comboIndex < combos.length; comboIndex++){
				var combo = combos[comboIndex];
				var variantA = variantData.variants[getStepRepeatVariantKey(sources[i], combo[0])];
				var variantB = variantData.variants[getStepRepeatVariantKey(sources[j], combo[1])];
				if(!variantA || !variantB){
					continue;
				}
				var distance = getStepRepeatSafeAxisDistance(variantA, variantB, axis, tolerance);
				if(distance > maxDistance){
					maxDistance = distance;
				}
			}
		}
	}

	if(maxDistance <= tolerance){
		return fallbackPitch;
	}

	return maxDistance;
}

function placePartsStepRepeat(sheets, parts, config, nestindex){
	if(!sheets || sheets.length === 0){
		return { placements: [], fitness: 0, area: 0, mergedLength: 0 };
	}

	var tolerance = Math.max(0.000001, Number(config.curveTolerance || 0.3) * 0.5);
	var i;
	var sheetInfos = [];
	for(i=0; i<sheets.length; i++){
		if(!isStepRepeatRectangle(sheets[i], tolerance)){
			throw new Error('Step & Repeat requires axis-aligned rectangular sheets.');
		}
		sheetInfos.push({
			source: sheets[i].source,
			id: sheets[i].id,
			bounds: GeometryUtil.getPolygonBounds(sheets[i]),
			area: Math.abs(GeometryUtil.polygonArea(sheets[i]))
		});
	}

	var cellWidth = 0;
	var cellHeight = 0;
	for(i=0; i<parts.length; i++){
		var uprightBounds = GeometryUtil.getPolygonBounds(parts[i]);
		if(uprightBounds.width > cellWidth){
			cellWidth = uprightBounds.width;
		}
		if(uprightBounds.height > cellHeight){
			cellHeight = uprightBounds.height;
		}
	}

	if(cellWidth <= tolerance || cellHeight <= tolerance){
		throw new Error('Step & Repeat could not derive a valid repeat cell from the selected parts.');
	}

	var variantData = buildStepRepeatVariants(parts, config);
	var globalMinX = 0;
	var globalMinY = 0;
	var globalMaxX = 0;
	var globalMaxY = 0;
	for(i=0; i<variantData.list.length; i++){
		var variantBounds = variantData.list[i].bounds;
		if(i === 0 || variantBounds.x < globalMinX){
			globalMinX = variantBounds.x;
		}
		if(i === 0 || variantBounds.y < globalMinY){
			globalMinY = variantBounds.y;
		}
		if(i === 0 || variantBounds.x + variantBounds.width > globalMaxX){
			globalMaxX = variantBounds.x + variantBounds.width;
		}
		if(i === 0 || variantBounds.y + variantBounds.height > globalMaxY){
			globalMaxY = variantBounds.y + variantBounds.height;
		}
	}

	var horizontalDensity = Number(config.stepRepeatHorizontalDensity || 100);
	if(!isFinite(horizontalDensity) || horizontalDensity <= 0){
		horizontalDensity = 100;
	}

	var verticalDensity = Number(config.stepRepeatVerticalDensity || 100);
	if(!isFinite(verticalDensity) || verticalDensity <= 0){
		verticalDensity = 100;
	}

	var basePitchX = config.stepRepeatHorizontalAlignment === 'tight' ? getStepRepeatPitch('x', parts, config, variantData, cellWidth, tolerance) : cellWidth;
	var basePitchY = config.stepRepeatVerticalAlignment === 'tight' ? getStepRepeatPitch('y', parts, config, variantData, cellHeight, tolerance) : cellHeight;

	var pitchX = basePitchX / (horizontalDensity / 100);
	var pitchY = basePitchY / (verticalDensity / 100);

	if(pitchX <= tolerance || pitchY <= tolerance){
		throw new Error('Step & Repeat density produced an invalid repeat pitch.');
	}

	var allplacements = [];
	var fitness = 0;
	var totalSheetArea = 0;
	var totalnum = parts.length;
	var partIndex = 0;

	for(i=0; i<sheetInfos.length && partIndex < parts.length; i++){
		var sheetInfo = sheetInfos[i];
		var anchorMinX = sheetInfo.bounds.x - globalMinX;
		var anchorMinY = sheetInfo.bounds.y - globalMinY;
		var anchorMaxX = (sheetInfo.bounds.x + sheetInfo.bounds.width) - globalMaxX;
		var anchorMaxY = (sheetInfo.bounds.y + sheetInfo.bounds.height) - globalMaxY;

		if(anchorMaxX + tolerance < anchorMinX || anchorMaxY + tolerance < anchorMinY){
			throw new Error('Step & Repeat cell does not fit within the selected sheet.');
		}

		var cols = Math.floor(((anchorMaxX - anchorMinX) + tolerance) / pitchX) + 1;
		var rows = Math.floor(((anchorMaxY - anchorMinY) + tolerance) / pitchY) + 1;

		if(cols < 1 || rows < 1){
			throw new Error('Step & Repeat cell does not fit within the selected sheet.');
		}

		var sheetplacements = [];
		var placedPolygons = [];
		var slots = [];

		function addSlot(column, row){
			var anchorX = anchorMinX + (column * pitchX);
			var anchorY = anchorMinY + (row * pitchY);

			if(config.stepRepeatStagger === 'rows' && (row % 2 === 1)){
				anchorX += 0.5 * pitchX;
			}
			else if(config.stepRepeatStagger === 'columns' && (column % 2 === 1)){
				anchorY += 0.5 * pitchY;
			}

			if(anchorX > anchorMaxX + tolerance || anchorY > anchorMaxY + tolerance){
				return;
			}

			slots.push({
				column: column,
				row: row,
				anchorX: anchorX,
				anchorY: anchorY
			});
		}

		var rowIndex;
		var columnIndex;
		if(config.stepRepeatFillDirection === 'rows'){
			for(rowIndex = 0; rowIndex < rows; rowIndex++){
				for(columnIndex = 0; columnIndex < cols; columnIndex++){
					addSlot(columnIndex, rowIndex);
				}
			}
		}
		else{
			for(columnIndex = 0; columnIndex < cols; columnIndex++){
				for(rowIndex = 0; rowIndex < rows; rowIndex++){
					addSlot(columnIndex, rowIndex);
				}
			}
		}

		for(var slotIndex = 0; slotIndex < slots.length && partIndex < parts.length; slotIndex++){
			var slot = slots[slotIndex];
			var part = parts[partIndex];
			var rotation = getStepRepeatRotation(slot.column, config);
			var variant = variantData.variants[getStepRepeatVariantKey(part.source, rotation)];
			if(!variant){
				throw new Error('Step & Repeat could not prepare a placement variant for the selected part.');
			}

			var placement = {
				x: slot.anchorX + variant.shift.x,
				y: slot.anchorY + variant.shift.y,
				id: part.id,
				source: part.source,
				rotation: rotation
			};

			var placedPolygon = shiftPolygon(variant.polygon, {x: slot.anchorX, y: slot.anchorY});
			for(var placedIndex = 0; placedIndex < placedPolygons.length; placedIndex++){
				if(stepRepeatPolygonsOverlap(placedPolygons[placedIndex], placedPolygon)){
					throw new Error('Step & Repeat settings are too aggressive for the selected parts. Reduce density or disable stagger.');
				}
			}
			placedPolygons.push(placedPolygon);

			sheetplacements.push(placement);

			partIndex++;
			ipcRenderer.send('background-progress', {index: nestindex, progress: 0.5 + 0.5*(partIndex/totalnum)});
		}

		if(sheetplacements.length > 0){
			allplacements.push({
				sheet: sheetInfo.source,
				sheetid: sheetInfo.id,
				sheetplacements: sheetplacements
			});
			totalSheetArea += sheetInfo.area;
			fitness += sheetInfo.area;
		}
	}

	for(i=partIndex; i<parts.length; i++){
		fitness += 100000000*(Math.abs(GeometryUtil.polygonArea(parts[i]))/(totalSheetArea || 1));
	}

	ipcRenderer.send('background-progress', {index: nestindex, progress: -1});
	return {placements: allplacements, fitness: fitness, area: totalSheetArea, mergedLength: 0};
}
// jsClipper uses X/Y instead of x/y...
function toClipperCoordinates(polygon){
	var clone = [];
	for(var i=0; i<polygon.length; i++){
		clone.push({
			X: polygon[i].x,
			Y: polygon[i].y
		});
	}
	
	return clone;
};

// returns clipper nfp. Remember that clipper nfp are a list of polygons, not a tree!
function nfpToClipperCoordinates(nfp, config){
	var clipperNfp = [];
	
	// children first
	if(nfp.children && nfp.children.length > 0){
		for(var j=0; j<nfp.children.length; j++){
			if(GeometryUtil.polygonArea(nfp.children[j]) < 0){
				nfp.children[j].reverse();
			}
			var childNfp = toClipperCoordinates(nfp.children[j]);
			ClipperLib.JS.ScaleUpPath(childNfp, config.clipperScale);
			clipperNfp.push(childNfp);
		}
	}
	
	if(GeometryUtil.polygonArea(nfp) > 0){
		nfp.reverse();
	}
	
	var outerNfp = toClipperCoordinates(nfp);
	
	// clipper js defines holes based on orientation

	ClipperLib.JS.ScaleUpPath(outerNfp, config.clipperScale);
	//var cleaned = ClipperLib.Clipper.CleanPolygon(outerNfp, 0.00001*config.clipperScale);
	
	clipperNfp.push(outerNfp);
	//var area = Math.abs(ClipperLib.Clipper.Area(cleaned));
	
	return clipperNfp;
}

// inner nfps can be an array of nfps, outer nfps are always singular
function innerNfpToClipperCoordinates(nfp, config){
	var clipperNfp = [];
	for(var i=0; i<nfp.length; i++){
		var clip = nfpToClipperCoordinates(nfp[i], config);
		clipperNfp = clipperNfp.concat(clip);
	}
	
	return clipperNfp;
}

function toNestCoordinates(polygon, scale){
	var clone = [];
	for(var i=0; i<polygon.length; i++){
		clone.push({
			x: polygon[i].X/scale,
			y: polygon[i].Y/scale
		});
	}
	
	return clone;
};

function getHull(polygon){
	// convert to hulljs format
	/*var hull = new ConvexHullGrahamScan();
	for(var i=0; i<polygon.length; i++){
		hull.addPoint(polygon[i].x, polygon[i].y);
	}
	
	return hull.getHull();*/
	var points = [];
	for(var i=0; i<polygon.length; i++){
		points.push([polygon[i].x, polygon[i].y]);
	}
	var hullpoints = d3.polygonHull(points);
	
	if(!hullpoints){
		return polygon;
	}
	
	var hull = [];
	for(i=0; i<hullpoints.length; i++){
		hull.push({x: hullpoints[i][0], y: hullpoints[i][1]});
	}
	
	return hull;
}

function getFitnessVersion(config){
	var version = config ? parseInt(config.fitnessVersion, 10) : 1;
	return version === 2 ? 2 : 1;
}

function collectWorldPoints(placed, placements){
	var points = [];
	if(!placed || !placements){
		return points;
	}

	for(var i=0; i<placed.length; i++){
		if(!placed[i] || !placements[i]){
			continue;
		}
		for(var j=0; j<placed[i].length; j++){
			points.push({
				x: placed[i][j].x + placements[i].x,
				y: placed[i][j].y + placements[i].y
			});
		}
	}

	return points;
}

function calculateFitnessV2SheetMetric(sheet, placed, placements, placementType){
	if(!sheet || !placed || !placements || placements.length === 0){
		return null;
	}

	var points = collectWorldPoints(placed, placements);
	if(points.length === 0){
		return null;
	}

	var partBounds = GeometryUtil.getPolygonBounds(points);
	var sheetBounds = GeometryUtil.getPolygonBounds(sheet);
	var sheetArea = Math.abs(GeometryUtil.polygonArea(sheet));
	var metricType = placementType === 'gravity' || placementType === 'box' || placementType === 'convexhull' ? placementType : 'convexhull';
	var metric = 0;

	if(metricType === 'gravity'){
		var denominator = 2 * sheetBounds.width + sheetBounds.height;
		metric = denominator > 0 ? (2 * partBounds.width + partBounds.height) / denominator : 1;
	}
	else if(metricType === 'box'){
		metric = sheetArea > 0 ? (partBounds.width * partBounds.height) / sheetArea : 1;
	}
	else{
		var hull = getHull(points);
		metric = sheetArea > 0 ? Math.abs(GeometryUtil.polygonArea(hull)) / sheetArea : 1;
	}

	if(!isFinite(metric) || metric < 0){
		metric = 1;
	}

	return {
		type: metricType,
		metric: metric,
		placementCount: placements.length,
		bounds: {
			x: partBounds.x,
			y: partBounds.y,
			width: partBounds.width,
			height: partBounds.height
		},
		sheetBounds: {
			x: sheetBounds.x,
			y: sheetBounds.y,
			width: sheetBounds.width,
			height: sheetBounds.height
		}
	};
}

function boundedUnit(value){
	value = Number(value);
	if(!isFinite(value)){
		return 0;
	}
	if(value < 0){
		return 0;
	}
	if(value > 1){
		return 1;
	}
	return value;
}

function gapSliverPenalty(gap, usefulGap){
	gap = Number(gap);
	usefulGap = Number(usefulGap);
	if(!isFinite(gap) || !isFinite(usefulGap) || usefulGap <= 0 || gap <= 0 || gap >= usefulGap){
		return 0;
	}
	return (usefulGap - gap) / usefulGap;
}

function improvedPlacementScore(baseScore, candidateBounds, sheetBounds, config){
	if(!config || config.improvedPlacementScoring !== true || !candidateBounds || !sheetBounds){
		return baseScore;
	}

	var sheetWidth = Math.max(Number(sheetBounds.width) || 0, 1);
	var sheetHeight = Math.max(Number(sheetBounds.height) || 0, 1);
	var sheetArea = Math.max(sheetWidth * sheetHeight, 1);
	var scoreScale = config.placementType === 'gravity' ? (sheetWidth * 2 + sheetHeight) : sheetArea;
	var spacing = Math.max(Number(config.spacing) || 0, 0);
	var usefulGap = Math.max(spacing, Math.min(sheetWidth, sheetHeight) * 0.04);
	var candidateArea = Math.max((Number(candidateBounds.width) || 0) * (Number(candidateBounds.height) || 0), 0);
	var footprintRatio = boundedUnit(candidateArea / sheetArea);

	var leftGap = candidateBounds.x - sheetBounds.x;
	var rightGap = (sheetBounds.x + sheetBounds.width) - (candidateBounds.x + candidateBounds.width);
	var topGap = candidateBounds.y - sheetBounds.y;
	var bottomGap = (sheetBounds.y + sheetBounds.height) - (candidateBounds.y + candidateBounds.height);
	var sliverPenalty = (
		gapSliverPenalty(leftGap, usefulGap) +
		gapSliverPenalty(rightGap, usefulGap) +
		gapSliverPenalty(topGap, usefulGap) +
		gapSliverPenalty(bottomGap, usefulGap)
	) / 4;

	// Favor footprints anchored to usable sheet edges. That tends to leave
	// larger continuous remnants than floating pockets of leftover material.
	var anchorPenalty = Math.min(
		boundedUnit(Math.max(leftGap, 0) / sheetWidth),
		boundedUnit(Math.max(rightGap, 0) / sheetWidth)
	) + Math.min(
		boundedUnit(Math.max(topGap, 0) / sheetHeight),
		boundedUnit(Math.max(bottomGap, 0) / sheetHeight)
	);

	return baseScore + scoreScale * (
		0.02 * footprintRatio +
		0.08 * sliverPenalty +
		0.015 * anchorPenalty
	);
}

function clonePlacementPosition(position){
	return {
		x: position.x,
		y: position.y,
		id: position.id,
		source: position.source,
		rotation: position.rotation
	};
}

function localRefinementNormalizeDirection(direction){
	var length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
	if(!isFinite(length) || length <= 0){
		return null;
	}
	return {
		x: direction.x / length,
		y: direction.y / length
	};
}

function localRefinementCandidateAt(original, direction, distance){
	var candidate = clonePlacementPosition(original);
	candidate.x += direction.x * distance;
	candidate.y += direction.y * distance;
	return candidate;
}

function localRefinementShiftNfp(nfp, shift){
	for(var i=0; i<nfp.length; i++){
		nfp[i].x += shift.x;
		nfp[i].y += shift.y;
	}
	if(nfp.children && nfp.children.length > 0){
		for(var j=0; j<nfp.children.length; j++){
			for(var k=0; k<nfp.children[j].length; k++){
				nfp.children[j][k].x += shift.x;
				nfp.children[j][k].y += shift.y;
			}
		}
	}
	return nfp;
}

function localRefinementPointAllowed(point, nfpList){
	if(!nfpList || nfpList.length === 0){
		return false;
	}
	for(var i=0; i<nfpList.length; i++){
		var nfp = nfpList[i];
		var inside = GeometryUtil.pointInPolygon(point, nfp);
		// Boundary contact is allowed here, matching the existing placement solver:
		// the NFP already encodes configured spacing, so a boundary point is exactly at clearance.
		if(inside === false){
			continue;
		}
		var blocked = false;
		if(nfp.children && nfp.children.length > 0){
			for(var j=0; j<nfp.children.length; j++){
				if(GeometryUtil.pointInPolygon(point, nfp.children[j]) === true){
					blocked = true;
					break;
				}
			}
		}
		if(!blocked){
			return true;
		}
	}
	return false;
}

function localRefinementPointForbidden(point, nfp){
	var inside = GeometryUtil.pointInPolygon(point, nfp);
	if(inside !== true){
		return false;
	}
	if(nfp.children && nfp.children.length > 0){
		for(var i=0; i<nfp.children.length; i++){
			var childInside = GeometryUtil.pointInPolygon(point, nfp.children[i]);
			if(childInside === true || childInside === null){
				return false;
			}
		}
	}
	return true;
}

function localRefinementForbiddenNfps(part, partIndex, placed, placements, config){
	var forbidden = [];
	for(var i=0; i<placed.length; i++){
		if(i === partIndex){
			continue;
		}
		var nfp = getOuterNfp(placed[i], part, false, config);
		if(!nfp){
			return null;
		}
		forbidden.push(localRefinementShiftNfp(clone(nfp), placements[i]));
	}
	return forbidden;
}

function localRefinementCandidateValid(part, candidate, sheetNfp, forbiddenNfps){
	var point = {
		x: part[0].x + candidate.x,
		y: part[0].y + candidate.y
	};
	if(!localRefinementPointAllowed(point, sheetNfp)){
		return false;
	}
	for(var i=0; i<forbiddenNfps.length; i++){
		if(localRefinementPointForbidden(point, forbiddenNfps[i])){
			return false;
		}
	}
	return true;
}

function localRefinementMaxLegalSlide(part, original, direction, maxDistance, sheetNfp, forbiddenNfps){
	var unit = localRefinementNormalizeDirection(direction);
	if(!unit || !isFinite(maxDistance) || maxDistance <= 0){
		return 0;
	}
	if(!localRefinementCandidateValid(part, original, sheetNfp, forbiddenNfps)){
		return 0;
	}

	var samples = 16;
	var lastValid = 0;
	var firstInvalid = null;
	for(var i=1; i<=samples; i++){
		var distance = maxDistance * (i / samples);
		var candidate = localRefinementCandidateAt(original, unit, distance);
		if(localRefinementCandidateValid(part, candidate, sheetNfp, forbiddenNfps)){
			lastValid = distance;
		}
		else{
			firstInvalid = distance;
			break;
		}
	}

	if(firstInvalid === null){
		return lastValid;
	}

	var low = lastValid;
	var high = firstInvalid;
	for(i=0; i<18; i++){
		var mid = (low + high) / 2;
		candidate = localRefinementCandidateAt(original, unit, mid);
		if(localRefinementCandidateValid(part, candidate, sheetNfp, forbiddenNfps)){
			low = mid;
		}
		else{
			high = mid;
		}
	}
	return low;
}

function localRefinementScore(sheet, placed, placements, config, sheetboundsForScoring){
	var allpoints = [];
	for(var i=0; i<placed.length; i++){
		for(var j=0; j<placed[i].length; j++){
			allpoints.push({
				x: placed[i][j].x + placements[i].x,
				y: placed[i][j].y + placements[i].y
			});
		}
	}
	if(allpoints.length === 0){
		return null;
	}

	var bounds = GeometryUtil.getPolygonBounds(allpoints);
	var score;
	if(config.placementType == 'gravity'){
		score = bounds.width * 2 + bounds.height;
	}
	else if(config.placementType == 'box'){
		score = bounds.width * bounds.height;
	}
	else{
		var hull = getHull(allpoints);
		score = Math.abs(GeometryUtil.polygonArea(hull));
		bounds = GeometryUtil.getPolygonBounds(allpoints);
	}

	return {
		score: improvedPlacementScore(score, bounds, sheetboundsForScoring, config),
		bounds: bounds
	};
}

function localRefinementImproves(candidateScore, currentScore){
	if(currentScore === null || typeof currentScore === 'undefined'){
		return true;
	}
	var tolerance = Math.max(1e-7, Math.abs(currentScore) * 0.0001);
	return candidateScore < currentScore - tolerance;
}

function localRefinementCopyPlacements(placements){
	var copy = [];
	for(var i=0; i<placements.length; i++){
		copy.push(clonePlacementPosition(placements[i]));
	}
	return copy;
}

function localRefinementClonePart(part){
	var copy = clone(part);
	copy.source = part.source;
	copy.id = part.id;
	copy.rotation = part.rotation;
	return copy;
}

function localRefinementCopyPlaced(placed){
	var copy = [];
	for(var i=0; i<placed.length; i++){
		copy.push(localRefinementClonePart(placed[i]));
	}
	return copy;
}

function localRefinementRestorePlaced(target, source){
	target.length = 0;
	for(var i=0; i<source.length; i++){
		target.push(localRefinementClonePart(source[i]));
	}
}

function localRefinementRestorePlacements(target, source){
	target.length = 0;
	for(var i=0; i<source.length; i++){
		target.push(clonePlacementPosition(source[i]));
	}
}

function localRefinementPlacementsMoved(a, b){
	if(!a || !b || a.length !== b.length){
		return true;
	}
	for(var i=0; i<a.length; i++){
		if(!GeometryUtil.almostEqual(a[i].x, b[i].x, 1e-7) || !GeometryUtil.almostEqual(a[i].y, b[i].y, 1e-7)){
			return true;
		}
	}
	return false;
}

function localRefinementPlacedMoved(a, b){
	if(!a || !b || a.length !== b.length){
		return true;
	}
	for(var i=0; i<a.length; i++){
		if(normalizedRotation(a[i].rotation || 0) !== normalizedRotation(b[i].rotation || 0)){
			return true;
		}
	}
	return false;
}

function localRefinementSetPlacementPosition(placement, position){
	placement.x = position.x;
	placement.y = position.y;
	return placement;
}

function localRefinementRectangleSheet(sheet){
	if(!sheet || sheet.length < 4 || (sheet.children && sheet.children.length > 0)){
		return false;
	}
	var bounds = GeometryUtil.getPolygonBounds(sheet);
	if(!bounds || bounds.width <= 0 || bounds.height <= 0){
		return false;
	}
	var bboxArea = bounds.width * bounds.height;
	var area = Math.abs(GeometryUtil.polygonArea(sheet));
	if(bboxArea <= 0 || Math.abs(area - bboxArea) / bboxArea > 0.001){
		return false;
	}
	return isStepRepeatRectangle(sheet, Math.max(bounds.width, bounds.height) * 0.001);
}

function localRefinementMetric(sheet, placed, placements, config){
	var metric = calculateFitnessV2SheetMetric(sheet, placed, placements, config ? config.placementType : 'box');
	if(!metric || !isFinite(metric.metric)){
		return null;
	}
	return metric.metric;
}

// Mean distance of part centers from their common center, normalized by the
// sheet diagonal. Used as a tiny tie-breaker term so that moves which pull
// stray parts toward the pack are accepted even when the primary metric is
// momentarily flat (e.g. the hull is still pinned by other strays).
function localRefinementSpreadTerm(sheet, placed, placements){
	var centers = [];
	for(var i=0; i<placed.length; i++){
		var bounds = localRefinementWorldBounds(placed[i], placements[i]);
		if(!bounds){
			continue;
		}
		centers.push({
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2
		});
	}
	if(centers.length === 0){
		return 0;
	}
	var cx = 0;
	var cy = 0;
	for(i=0; i<centers.length; i++){
		cx += centers[i].x;
		cy += centers[i].y;
	}
	cx /= centers.length;
	cy /= centers.length;
	var meanDist = 0;
	for(i=0; i<centers.length; i++){
		meanDist += Math.sqrt(sqr(centers[i].x - cx) + sqr(centers[i].y - cy));
	}
	meanDist /= centers.length;
	var sheetBounds = GeometryUtil.getPolygonBounds(sheet);
	var diag = sheetBounds ? Math.sqrt(sqr(sheetBounds.width) + sqr(sheetBounds.height)) : 0;
	return diag > 0 ? meanDist / diag : 0;
}

function sqr(value){
	return value * value;
}

// Acceptance metric for the smart engine: the mode metric dominates; the
// spread term (weighted 5e-4, max ~3.5e-4) only decides between mode-metric
// plateau states and can never override a substantive metric change.
function localRefinementSmartMetric(sheet, placed, placements, config){
	var pure = localRefinementMetric(sheet, placed, placements, config);
	if(pure === null){
		return null;
	}
	return pure + 0.0005 * localRefinementSpreadTerm(sheet, placed, placements);
}

function localRefinementBboxDiagonal(part){
	var bounds = GeometryUtil.getPolygonBounds(part);
	if(!bounds){
		return 1;
	}
	var diag = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height);
	return isFinite(diag) && diag > 0 ? diag : 1;
}

function localRefinementPairKey(a, b, placement){
	return [
		a && typeof a.source !== 'undefined' ? a.source : 'a',
		a && typeof a.rotation !== 'undefined' ? a.rotation : 0,
		b && typeof b.source !== 'undefined' ? b.source : 'b',
		b && typeof b.rotation !== 'undefined' ? b.rotation : 0,
		roundedCoordinate(placement.x),
		roundedCoordinate(placement.y)
	].join(':');
}

function localRefinementAxisCoordinate(point, axis){
	return axis === 'y' ? point.y : point.x;
}

function localRefinementPartAxisMax(part, axis){
	var max = null;
	for(var i=0; i<part.length; i++){
		var value = localRefinementAxisCoordinate(part[i], axis);
		if(max === null || value > max){
			max = value;
		}
	}
	return max === null ? 0 : max;
}

function localRefinementVirtualExtent(sheetBounds, placed, placements, alpha, axis){
	var origin = axis === 'y' ? sheetBounds.y : sheetBounds.x;
	var worldMax = null;
	var qLimits = [];
	for(var i=0; i<placed.length; i++){
		var partMax = localRefinementPartAxisMax(placed[i], axis);
		var ref = localRefinementAxisCoordinate(placed[i][0], axis);
		var placementAxis = axis === 'y' ? placements[i].y : placements[i].x;
		var partWorldMax = partMax + placementAxis;
		if(worldMax === null || partWorldMax > worldMax){
			worldMax = partWorldMax;
		}
		qLimits[i] = {
			limit: null,
			partMaxOffset: partMax - ref
		};
	}
	if(worldMax === null){
		return null;
	}
	var extent = worldMax - origin;
	if(!isFinite(extent) || extent <= 0){
		return null;
	}
	var virtualBoundary = worldMax - alpha * extent;
	var maxQLimit = null;
	for(i=0; i<qLimits.length; i++){
		qLimits[i].limit = virtualBoundary - qLimits[i].partMaxOffset;
		if(maxQLimit === null || qLimits[i].limit > maxQLimit){
			maxQLimit = qLimits[i].limit;
		}
	}

	var clippedSheetBounds = {
		x: sheetBounds.x,
		y: sheetBounds.y,
		width: sheetBounds.width,
		height: sheetBounds.height
	};
	if(axis === 'y'){
		clippedSheetBounds.height = Math.max(0, maxQLimit - sheetBounds.y);
	}
	else{
		clippedSheetBounds.width = Math.max(0, maxQLimit - sheetBounds.x);
	}

	return {
		axis: axis,
		virtualBoundary: virtualBoundary,
		qLimits: qLimits,
		sheetBounds: clippedSheetBounds
	};
}

function localRefinementClipIfpToVirtualLimit(ifp, qLimit, axis, config){
	if(!ifp || ifp.length === 0 || !isFinite(qLimit)){
		return null;
	}
	var ifpBounds = null;
	for(var i=0; i<ifp.length; i++){
		var bounds = GeometryUtil.getPolygonBounds(ifp[i]);
		if(!bounds){
			continue;
		}
		if(ifpBounds === null){
			ifpBounds = {
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height
			};
		}
		else{
			var minX = Math.min(ifpBounds.x, bounds.x);
			var minY = Math.min(ifpBounds.y, bounds.y);
			var maxX = Math.max(ifpBounds.x + ifpBounds.width, bounds.x + bounds.width);
			var maxY = Math.max(ifpBounds.y + ifpBounds.height, bounds.y + bounds.height);
			ifpBounds.x = minX;
			ifpBounds.y = minY;
			ifpBounds.width = maxX - minX;
			ifpBounds.height = maxY - minY;
		}
	}
	if(!ifpBounds){
		return null;
	}

	var padding = 1;
	var clipRect;
	if(axis === 'y'){
		if(qLimit <= ifpBounds.y - padding){
			return null;
		}
		clipRect = [
			{x: ifpBounds.x - padding, y: ifpBounds.y - padding},
			{x: ifpBounds.x + ifpBounds.width + padding, y: ifpBounds.y - padding},
			{x: ifpBounds.x + ifpBounds.width + padding, y: qLimit},
			{x: ifpBounds.x - padding, y: qLimit}
		];
	}
	else{
		if(qLimit <= ifpBounds.x - padding){
			return null;
		}
		clipRect = [
			{x: ifpBounds.x - padding, y: ifpBounds.y - padding},
			{x: qLimit, y: ifpBounds.y - padding},
			{x: qLimit, y: ifpBounds.y + ifpBounds.height + padding},
			{x: ifpBounds.x - padding, y: ifpBounds.y + ifpBounds.height + padding}
		];
	}

	var clipperIfp = innerNfpToClipperCoordinates(cloneNfp(ifp, true), config);
	var clipperRect = toClipperCoordinates(clipRect);
	ClipperLib.JS.ScaleUpPath(clipperRect, config.clipperScale);

	var solution = new ClipperLib.Paths();
	var clipper = new ClipperLib.Clipper();
	clipper.AddPaths(clipperIfp, ClipperLib.PolyType.ptSubject, true);
	clipper.AddPaths([clipperRect], ClipperLib.PolyType.ptClip, true);
	if(!clipper.Execute(ClipperLib.ClipType.ctIntersection, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
		return null;
	}
	if(!solution || solution.length === 0){
		return null;
	}

	var clipped = [];
	for(i=0; i<solution.length; i++){
		if(solution[i] && solution[i].length >= 3){
			clipped.push(toNestCoordinates(solution[i], config.clipperScale));
		}
	}
	return clipped.length > 0 ? clipped : null;
}

function localRefinementCreateSeparationContext(sheet, placed, placements, config, deadline, rng, virtual){
	var nfpCache = {};
	var realIfpCache = {};
	var virtualIfpCache = {};
	var sheetBounds = virtual && virtual.sheetBounds ? virtual.sheetBounds : GeometryUtil.getPolygonBounds(sheet);
	var eps = Math.max(1e-9, 1e-4 * (Number(config.curveTolerance) || 0));
	var clearance = Math.max(2 * eps, 2e-3 * (Number(config.curveTolerance) || 0));

	return {
		n: placements.length,
		q: function(i){
			return {
				x: placements[i].x + placed[i][0].x,
				y: placements[i].y + placed[i][0].y
			};
		},
		setPlacement: function(i, t){
			localRefinementSetPlacementPosition(placements[i], t);
		},
		refPoint: function(i){
			return placed[i][0];
		},
		nfp: function(i, j){
			var key = localRefinementPairKey(placed[j], placed[i], placements[j]);
			if(typeof nfpCache[key] !== 'undefined'){
				return nfpCache[key];
			}
			var nfp = getOuterNfp(placed[j], placed[i], false, config);
			if(!nfp){
				nfpCache[key] = null;
				return null;
			}
			nfp = localRefinementShiftNfp(clone(nfp), placements[j]);
			nfpCache[key] = nfp;
			return nfp;
		},
		ifp: function(i){
			var key = [
				placed[i] && typeof placed[i].source !== 'undefined' ? placed[i].source : 'p',
				placed[i] && typeof placed[i].rotation !== 'undefined' ? placed[i].rotation : 0
			].join(':');
			if(typeof realIfpCache[key] === 'undefined'){
				var realIfp = getInnerNfp(sheet, placed[i], config);
				realIfpCache[key] = realIfp || null;
			}
			if(!realIfpCache[key]){
				return null;
			}
			if(!virtual || !virtual.qLimits || !virtual.qLimits[i]){
				return realIfpCache[key];
			}
			var limit = virtual.qLimits[i].limit;
			var virtualKey = [key, virtual.axis || 'x', roundedCoordinate(limit)].join(':');
			if(typeof virtualIfpCache[virtualKey] !== 'undefined'){
				return virtualIfpCache[virtualKey];
			}
			virtualIfpCache[virtualKey] = localRefinementClipIfpToVirtualLimit(realIfpCache[key], limit, virtual.axis || 'x', config);
			return virtualIfpCache[virtualKey];
		},
		bboxDiag: function(i){
			return localRefinementBboxDiagonal(placed[i]);
		},
		sheetBounds: sheetBounds,
		eps: eps,
		clearance: clearance,
		deadline: deadline,
		rng: rng,
		maxAttempts: 3,
		maxItersPerAttempt: 50 * placements.length
	};
}

function localRefinementMeasureSeparationResidual(ctx){
	var summary = {
		pairViolations: 0,
		sheetViolations: 0,
		maxPairDepth: 0,
		maxSheetDepth: 0,
		missingGeometry: false
	};
	if(!ctx || typeof SeparationUtil === 'undefined'){
		summary.missingGeometry = true;
		return summary;
	}
	var eps = ctx.eps || 1e-9;
	for(var i=0; i<ctx.n; i++){
		var q = ctx.q(i);
		var ifp = ctx.ifp(i);
		if(!ifp){
			summary.missingGeometry = true;
		}
		else{
			var sheet = SeparationUtil.containmentViolation(q, ifp);
			if(sheet.outside && sheet.depth > eps){
				summary.sheetViolations++;
				if(sheet.depth > summary.maxSheetDepth){
					summary.maxSheetDepth = sheet.depth;
				}
			}
		}
		for(var j=0; j<ctx.n; j++){
			if(i === j){
				continue;
			}
			var nfp = ctx.nfp(i, j);
			if(!nfp){
				summary.missingGeometry = true;
				continue;
			}
			var pen = SeparationUtil.penetration(q, nfp);
			if(pen.depth > eps){
				summary.pairViolations++;
				if(pen.depth > summary.maxPairDepth){
					summary.maxPairDepth = pen.depth;
				}
			}
		}
	}
	return summary;
}

function localRefinementPushAttemptDiagnostic(stats, diagnostic){
	if(!stats){
		return;
	}
	if(!stats.attemptDiagnostics){
		stats.attemptDiagnostics = [];
	}
	if(stats.attemptDiagnostics.length < 12){
		stats.attemptDiagnostics.push(diagnostic);
	}
}

function localRefinementShuffle(indices, rng){
	for(var i=indices.length-1; i>0; i--){
		var j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
		var tmp = indices[i];
		indices[i] = indices[j];
		indices[j] = tmp;
	}
	return indices;
}

function localRefinementCandidateQToPlacement(ctx, i, q){
	var ref = ctx.refPoint(i);
	return {
		x: q.x - ref.x,
		y: q.y - ref.y
	};
}

function localRefinementUnitVector(from, to){
	if(!from || !to){
		return {x: 0, y: 0};
	}
	var dx = to.x - from.x;
	var dy = to.y - from.y;
	var len = Math.sqrt(dx * dx + dy * dy);
	if(!isFinite(len) || len <= 0){
		return {x: 0, y: 0};
	}
	return {
		x: dx / len,
		y: dy / len
	};
}

function localRefinementPartResidual(ctx, i, q){
	var residual = {
		pairViolations: [],
		sheetViolation: null,
		cost: 0,
		maxDepth: 0,
		missingGeometry: false
	};
	var eps = ctx.eps || 1e-9;
	var ifp = ctx.ifp(i);
	if(!ifp){
		residual.missingGeometry = true;
		residual.cost = Infinity;
		residual.maxDepth = Infinity;
		return residual;
	}
	var sheet = SeparationUtil.containmentViolation(q, ifp);
	if(sheet.outside && sheet.depth > eps){
		residual.sheetViolation = sheet;
		residual.cost += sheet.depth;
		if(sheet.depth > residual.maxDepth){
			residual.maxDepth = sheet.depth;
		}
	}
	for(var j=0; j<ctx.n; j++){
		if(i === j){
			continue;
		}
		var nfp = ctx.nfp(i, j);
		if(!nfp){
			residual.missingGeometry = true;
			residual.cost = Infinity;
			residual.maxDepth = Infinity;
			continue;
		}
		var pen = SeparationUtil.penetration(q, nfp);
		if(pen.depth > eps){
			residual.pairViolations.push({
				j: j,
				penetration: pen
			});
			residual.cost += pen.depth;
			if(pen.depth > residual.maxDepth){
				residual.maxDepth = pen.depth;
			}
		}
	}
	return residual;
}

function localRefinementAllViolations(ctx){
	var violations = [];
	var maxDepth = 0;
	var missingGeometry = false;
	for(var i=0; i<ctx.n; i++){
		var residual = localRefinementPartResidual(ctx, i, ctx.q(i));
		if(residual.missingGeometry){
			missingGeometry = true;
		}
		if(residual.maxDepth > maxDepth && isFinite(residual.maxDepth)){
			maxDepth = residual.maxDepth;
		}
		if(residual.cost > (ctx.eps || 1e-9)){
			violations.push({
				i: i,
				residual: residual
			});
		}
	}
	return {
		violations: violations,
		maxDepth: maxDepth,
		missingGeometry: missingGeometry
	};
}

function localRefinementTryQCandidate(ctx, i, q){
	if(!q || !isFinite(q.x) || !isFinite(q.y)){
		return false;
	}
	if(ctx.sheetBounds && (q.x < ctx.sheetBounds.x || q.x > ctx.sheetBounds.x + ctx.sheetBounds.width ||
		q.y < ctx.sheetBounds.y || q.y > ctx.sheetBounds.y + ctx.sheetBounds.height)){
		return false;
	}
	var residual = localRefinementPartResidual(ctx, i, q);
	if(residual.missingGeometry || residual.cost > (ctx.eps || 1e-9)){
		return false;
	}
	ctx.setPlacement(i, localRefinementCandidateQToPlacement(ctx, i, q));
	return true;
}

function localRefinementCreateWeights(n){
	var weights = [];
	for(var i=0; i<n; i++){
		weights[i] = [];
		for(var j=0; j<n; j++){
			weights[i][j] = 1;
		}
	}
	return weights;
}

function localRefinementWeightedCost(ctx, i, q, weights, neighbors){
	var ifp = ctx.ifp(i);
	if(!ifp){
		return Infinity;
	}
	var total = 0;
	var containment = SeparationUtil.containmentViolation(q, ifp);
	if(containment.outside && containment.depth > 0){
		total += 2.0 * (isFinite(containment.depth) ? containment.depth : Number.MAX_VALUE / 4);
	}
	var list = neighbors || null;
	var count = list ? list.length : ctx.n;
	for(var n=0; n<count; n++){
		var j = list ? list[n] : n;
		if(i === j){
			continue;
		}
		var nfp = ctx.nfp(i, j);
		if(!nfp){
			return Infinity;
		}
		total += (weights[i][j] || 1) * SeparationUtil.penetration(q, nfp).depth;
	}
	return total;
}

function localRefinementAddScalarCandidate(values, value, eps){
	if(!isFinite(value)){
		return;
	}
	for(var i=0; i<values.length; i++){
		if(Math.abs(values[i] - value) <= eps){
			return;
		}
	}
	values.push(value);
}

function localRefinementAxisBoundsFromIfp(ifp, axis){
	var min = null;
	var max = null;
	if(!ifp){
		return null;
	}
	for(var i=0; i<ifp.length; i++){
		var bounds = GeometryUtil.getPolygonBounds(ifp[i]);
		if(!bounds){
			continue;
		}
		var lo = axis === 'y' ? bounds.y : bounds.x;
		var hi = axis === 'y' ? bounds.y + bounds.height : bounds.x + bounds.width;
		if(min === null || lo < min){
			min = lo;
		}
		if(max === null || hi > max){
			max = hi;
		}
	}
	return min === null ? null : {min: min, max: max};
}

function localRefinementAxisLineMayHitRing(q, axis, ring, eps){
	if(!ring || ring.length < 3){
		return false;
	}
	var bounds = GeometryUtil.getPolygonBounds(ring);
	if(!bounds){
		return false;
	}
	if(axis === 'y'){
		return q.x >= bounds.x - eps && q.x <= bounds.x + bounds.width + eps;
	}
	return q.y >= bounds.y - eps && q.y <= bounds.y + bounds.height + eps;
}

function localRefinementProtectedScalar(value, protectedValues, eps){
	for(var i=0; i<protectedValues.length; i++){
		if(Math.abs(value - protectedValues[i]) <= eps){
			return true;
		}
	}
	return false;
}

function localRefinementAddNeighbor(values, value){
	for(var i=0; i<values.length; i++){
		if(values[i] === value){
			return;
		}
	}
	values.push(value);
}

function localRefinementCapAxisScalars(values, protectedValues, cap, eps){
	values.sort(function(a, b){
		return a - b;
	});
	if(values.length <= cap){
		return values;
	}
	var selected = [];
	for(var p=0; p<protectedValues.length; p++){
		localRefinementAddScalarCandidate(selected, protectedValues[p], eps);
	}
	var remaining = [];
	for(var i=0; i<values.length; i++){
		if(!localRefinementProtectedScalar(values[i], protectedValues, eps)){
			remaining.push(values[i]);
		}
	}
	var slots = Math.max(0, cap - selected.length);
	if(slots >= remaining.length){
		for(i=0; i<remaining.length; i++){
			localRefinementAddScalarCandidate(selected, remaining[i], eps);
		}
	}
	else if(slots > 0){
		for(i=0; i<slots; i++){
			var index = slots === 1 ? Math.floor(remaining.length / 2) : Math.round(i * (remaining.length - 1) / (slots - 1));
			localRefinementAddScalarCandidate(selected, remaining[index], eps);
		}
	}
	selected.sort(function(a, b){
		return a - b;
	});
	return selected;
}

function localRefinementAxisMoveCandidates(ctx, i, axis){
	var q = ctx.q(i);
	var eps = ctx.eps || 1e-9;
	var clearance = Math.max(2 * eps, Number(ctx.clearance) || 0);
	var values = [];
	var protectedValues = [];
	var activeNeighbors = [];
	var current = axis === 'y' ? q.y : q.x;
	localRefinementAddScalarCandidate(values, current, eps);
	localRefinementAddScalarCandidate(protectedValues, current, eps);

	var ifp = ctx.ifp(i);
	var ifpBounds = localRefinementAxisBoundsFromIfp(ifp, axis);
	if(ifpBounds){
		localRefinementAddScalarCandidate(values, ifpBounds.min, eps);
		localRefinementAddScalarCandidate(values, ifpBounds.max, eps);
		localRefinementAddScalarCandidate(protectedValues, ifpBounds.min, eps);
		localRefinementAddScalarCandidate(protectedValues, ifpBounds.max, eps);
	}

	for(var j=0; j<ctx.n; j++){
		if(i === j){
			continue;
		}
		var nfp = ctx.nfp(i, j);
		if(!nfp){
			continue;
		}
		if(!localRefinementAxisLineMayHitRing(q, axis, nfp, eps)){
			continue;
		}
		if(SeparationUtil.penetration(q, nfp).depth > eps){
			localRefinementAddNeighbor(activeNeighbors, j);
		}
		var rings = [nfp];
		if(nfp.children && nfp.children.length > 0){
			for(var h=0; h<nfp.children.length; h++){
				rings.push(nfp.children[h]);
			}
		}
		for(var r=0; r<rings.length; r++){
			var breakpoints = SeparationUtil.axisBreakpoints(q, axis, rings[r]);
			if(breakpoints.length > 0){
				localRefinementAddNeighbor(activeNeighbors, j);
			}
			for(var b=0; b<breakpoints.length; b++){
				localRefinementAddScalarCandidate(values, breakpoints[b] - clearance, eps);
				localRefinementAddScalarCandidate(values, breakpoints[b] + clearance, eps);
			}
		}
	}

	values = localRefinementCapAxisScalars(values, protectedValues, 64, eps);
	var candidates = [];
	for(var v=0; v<values.length; v++){
		var candidate = {x: q.x, y: q.y};
		if(axis === 'y'){
			candidate.y = values[v];
		}
		else{
			candidate.x = values[v];
		}
		candidates.push(candidate);
	}
	return {
		candidates: candidates,
		neighbors: activeNeighbors
	};
}

function localRefinementTryAxisMove(ctx, i, axis, weights){
	var currentQ = ctx.q(i);
	var candidateData = localRefinementAxisMoveCandidates(ctx, i, axis);
	var currentCost = localRefinementWeightedCost(ctx, i, currentQ, weights, candidateData.neighbors);
	if(!isFinite(currentCost) || currentCost <= (ctx.eps || 1e-9)){
		return false;
	}
	var candidates = candidateData.candidates;
	var bestQ = null;
	var bestCost = currentCost;
	for(var c=0; c<candidates.length; c++){
		var cost = localRefinementWeightedCost(ctx, i, candidates[c], weights, candidateData.neighbors);
		if(cost < bestCost){
			bestCost = cost;
			bestQ = candidates[c];
		}
	}
	if(bestQ && bestCost < currentCost - 1e-12){
		ctx.setPlacement(i, localRefinementCandidateQToPlacement(ctx, i, bestQ));
		return true;
	}
	return false;
}

function localRefinementReweightViolations(weights, state){
	var maxDepth = state && state.maxDepth > 0 ? state.maxDepth : 0;
	if(!maxDepth){
		return;
	}
	for(var v=0; v<state.violations.length; v++){
		var i = state.violations[v].i;
		var pairs = state.violations[v].residual ? state.violations[v].residual.pairViolations : [];
		for(var p=0; p<pairs.length; p++){
			var j = pairs[p].j;
			var depth = pairs[p].penetration ? pairs[p].penetration.depth : 0;
			weights[i][j] += depth / maxDepth;
		}
	}
}

function localRefinementCheapNudgeCandidates(ctx, i, residual){
	var candidates = [];
	var q = ctx.q(i);
	var eps = ctx.eps || 1e-9;
	for(var p=0; p<residual.pairViolations.length; p++){
		var pen = residual.pairViolations[p].penetration;
		if(!pen || !pen.exit){
			continue;
		}
		var away = localRefinementUnitVector(q, pen.exit);
		candidates.push({
			x: pen.exit.x + away.x * 2 * eps,
			y: pen.exit.y + away.y * 2 * eps
		});
	}
	if(residual.sheetViolation && residual.sheetViolation.entry){
		var inward = localRefinementUnitVector(q, residual.sheetViolation.entry);
		candidates.push({
			x: residual.sheetViolation.entry.x + inward.x * 2 * eps,
			y: residual.sheetViolation.entry.y + inward.y * 2 * eps
		});
	}

	var slide = Math.max(residual.maxDepth || 0, eps);
	var distances = [0.5 * slide, slide];
	for(var d=0; d<distances.length; d++){
		var amount = distances[d];
		candidates.push({x: q.x - amount, y: q.y});
		candidates.push({x: q.x + amount, y: q.y});
		candidates.push({x: q.x, y: q.y - amount});
		candidates.push({x: q.x, y: q.y + amount});
	}
	return candidates;
}

function localRefinementBuildFeasibleRegion(ctx, i, config){
	var ifp = ctx.ifp(i);
	if(!ifp || ifp.length === 0){
		return null;
	}
	var clipperIfp = innerNfpToClipperCoordinates(cloneNfp(ifp, true), config);
	var combinedNfp = new ClipperLib.Paths();
	var clipper = new ClipperLib.Clipper();
	for(var j=0; j<ctx.n; j++){
		if(i === j){
			continue;
		}
		var nfp = ctx.nfp(i, j);
		if(!nfp){
			return null;
		}
		var clipperNfp = nfpToClipperCoordinates(clone(nfp), config);
		clipper.AddPaths(clipperNfp, ClipperLib.PolyType.ptSubject, true);
	}
	if(!clipper.Execute(ClipperLib.ClipType.ctUnion, combinedNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
		return null;
	}

	var region = new ClipperLib.Paths();
	clipper = new ClipperLib.Clipper();
	if(combinedNfp.length > 0){
		clipper.AddPaths(combinedNfp, ClipperLib.PolyType.ptClip, true);
	}
	clipper.AddPaths(clipperIfp, ClipperLib.PolyType.ptSubject, true);
	if(!clipper.Execute(ClipperLib.ClipType.ctDifference, region, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftNonZero)){
		return null;
	}
	if(!region || region.length === 0){
		return null;
	}

	var converted = [];
	for(var r=0; r<region.length; r++){
		if(region[r] && region[r].length >= 3){
			converted.push(toNestCoordinates(region[r], config.clipperScale));
		}
	}
	return converted.length > 0 ? converted : null;
}

function localRefinementBuildStandaloneFeasibleRegion(part, placedExcl, placementsExcl, sheet, config){
	// Mirrors the one-part IFP-minus-shifted-NFP pipeline from placeParts; the hot
	// placement path stays untouched so this operator remains isolated.
	var ifp = getInnerNfp(sheet, part, config);
	if(!ifp || ifp.length === 0){
		return null;
	}
	var clipperIfp = innerNfpToClipperCoordinates(cloneNfp(ifp, true), config);
	var combinedNfp = new ClipperLib.Paths();
	var clipper = new ClipperLib.Clipper();
	for(var j=0; j<placedExcl.length; j++){
		var nfp = getOuterNfp(placedExcl[j], part, false, config);
		if(!nfp){
			return null;
		}
		nfp = localRefinementShiftNfp(clone(nfp), placementsExcl[j]);
		var clipperNfp = nfpToClipperCoordinates(nfp, config);
		clipper.AddPaths(clipperNfp, ClipperLib.PolyType.ptSubject, true);
	}
	if(!clipper.Execute(ClipperLib.ClipType.ctUnion, combinedNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
		return null;
	}

	var region = new ClipperLib.Paths();
	clipper = new ClipperLib.Clipper();
	clipper.AddPaths(clipperIfp, ClipperLib.PolyType.ptSubject, true);
	if(combinedNfp.length > 0){
		clipper.AddPaths(combinedNfp, ClipperLib.PolyType.ptClip, true);
	}
	if(!clipper.Execute(ClipperLib.ClipType.ctDifference, region, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftNonZero)){
		return null;
	}
	if(!region || region.length === 0){
		return null;
	}

	var converted = [];
	for(var r=0; r<region.length; r++){
		if(region[r] && region[r].length >= 3){
			converted.push(toNestCoordinates(region[r], config.clipperScale));
		}
	}
	return converted.length > 0 ? converted : null;
}

function localRefinementAddPointCandidate(candidates, point, tolerance){
	if(!point || !isFinite(point.x) || !isFinite(point.y)){
		return;
	}
	for(var i=0; i<candidates.length; i++){
		if(Math.abs(candidates[i].x - point.x) <= tolerance && Math.abs(candidates[i].y - point.y) <= tolerance){
			return;
		}
	}
	candidates.push({x: point.x, y: point.y});
}

function localRefinementRegionCandidates(region, currentQ, cap, config){
	var candidates = [];
	var tolerance = Math.max(1e-8, 1e-6 * (Number(config.curveTolerance) || 1));
	var clearance = Math.max(1e-7, 2e-3 * (Number(config.curveTolerance) || 1));
	// Boundary-exact candidates are legal under the erosion-based materialOverlap
	// predicate, so emit each point exactly once plus ONE nudge toward the ring
	// centroid (region interior for convex-ish pieces). The old ±4-direction
	// offsets pushed ~2/5 of candidates into the forbidden side by ~20x eps,
	// each burning a legality check before rejection.
	function addWithOffsets(point, inwardRef){
		localRefinementAddPointCandidate(candidates, point, tolerance);
		if(inwardRef){
			var inDx = inwardRef.x - point.x;
			var inDy = inwardRef.y - point.y;
			var inLen = Math.sqrt(inDx * inDx + inDy * inDy);
			if(isFinite(inLen) && inLen > clearance){
				localRefinementAddPointCandidate(candidates, {
					x: point.x + inDx / inLen * clearance,
					y: point.y + inDy / inLen * clearance
				}, tolerance);
			}
		}
	}
	for(var r=0; r<region.length; r++){
		var ring = region[r];
		if(!ring || ring.length < 3){
			continue;
		}
		var centroid = {x: 0, y: 0};
		for(var ci=0; ci<ring.length; ci++){
			centroid.x += ring[ci].x;
			centroid.y += ring[ci].y;
		}
		centroid.x /= ring.length;
		centroid.y /= ring.length;
		addWithOffsets(centroid, null);
		for(var i=0; i<ring.length; i++){
			var next = i === ring.length - 1 ? 0 : i + 1;
			addWithOffsets(ring[i], centroid);
			addWithOffsets({
				x: (ring[i].x + ring[next].x) / 2,
				y: (ring[i].y + ring[next].y) / 2
			}, centroid);
			if(currentQ){
				addWithOffsets(localRefinementClosestPointOnSegment(currentQ, ring[i], ring[next]), centroid);
			}
		}
	}
	if(candidates.length <= cap){
		return candidates;
	}
	var sampled = [];
	for(i=0; i<cap; i++){
		var index = cap === 1 ? 0 : Math.round(i * (candidates.length - 1) / (cap - 1));
		sampled.push(candidates[index]);
	}
	return sampled;
}

function localRefinementClosestPointOnSegment(q, a, b){
	var dx = b.x - a.x;
	var dy = b.y - a.y;
	var len2 = dx * dx + dy * dy;
	if(len2 <= 0){
		return {x: a.x, y: a.y};
	}
	var t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
	if(t < 0){
		t = 0;
	}
	else if(t > 1){
		t = 1;
	}
	return {
		x: a.x + t * dx,
		y: a.y + t * dy
	};
}

function localRefinementNearestRegionPoint(region, q){
	var best = null;
	var bestDist = null;
	for(var r=0; r<region.length; r++){
		var ring = region[r];
		if(!ring || ring.length === 0){
			continue;
		}
		for(var i=0; i<ring.length; i++){
			var next = i === ring.length - 1 ? 0 : i + 1;
			var candidates = [
				ring[i],
				localRefinementClosestPointOnSegment(q, ring[i], ring[next])
			];
			for(var c=0; c<candidates.length; c++){
				var point = candidates[c];
				var dx = point.x - q.x;
				var dy = point.y - q.y;
				var dist = dx * dx + dy * dy;
				if(bestDist === null || dist < bestDist){
					bestDist = dist;
					best = {
						x: point.x,
						y: point.y
					};
				}
			}
		}
	}
	return best;
}

function localRefinementSeparateBySweep(ctx, config){
	var result = {
		feasible: false,
		movesApplied: 0,
		itersUsed: 0,
		maxResidualDepth: 0,
		exactRelocations: 0,
		emptyRegion: false,
		emptyRegionHits: 0,
		deadlineHit: false
	};
	var maxSweeps = 60;
	var weights = localRefinementCreateWeights(ctx.n || 0);
	var stuckCycles = 0;
	var emptyFallbackParts = {};
	for(var sweep=0; sweep<maxSweeps; sweep++){
		if(Date.now() > ctx.deadline){
			result.deadlineHit = true;
			return result;
		}
		var state = localRefinementAllViolations(ctx);
		result.itersUsed++;
		result.maxResidualDepth = Math.max(result.maxResidualDepth, state.maxDepth || 0);
		if(state.missingGeometry){
			result.emptyRegion = true;
			return result;
		}
		if(state.violations.length === 0){
			result.feasible = true;
			return result;
		}

		var order = [];
		for(var v=0; v<state.violations.length; v++){
			order.push(state.violations[v].i);
		}
		localRefinementShuffle(order, ctx.rng);
		var sweepMoved = false;

		for(var o=0; o<order.length; o++){
			if(Date.now() > ctx.deadline){
				result.deadlineHit = true;
				return result;
			}
			var i = order[o];
			var residual = localRefinementPartResidual(ctx, i, ctx.q(i));
			if(residual.cost <= (ctx.eps || 1e-9)){
				continue;
			}

			var moved = false;
			var axes = ['x', 'y'];
			if(ctx.rng && ctx.rng() < 0.5){
				axes = ['y', 'x'];
			}
			for(var a=0; a<axes.length; a++){
				if(localRefinementTryAxisMove(ctx, i, axes[a], weights)){
					result.movesApplied++;
					moved = true;
					sweepMoved = true;
				}
			}
			if(moved){
				continue;
			}

			if(stuckCycles < 3){
				continue;
			}
			if(emptyFallbackParts[i]){
				continue;
			}
			if(Date.now() > ctx.deadline){
				result.deadlineHit = true;
				return result;
			}
			var region = localRefinementBuildFeasibleRegion(ctx, i, config);
			if(!region){
				result.emptyRegion = true;
				result.emptyRegionHits++;
				emptyFallbackParts[i] = true;
				continue;
			}
			var nearest = localRefinementNearestRegionPoint(region, ctx.q(i));
			if(!nearest || !localRefinementTryQCandidate(ctx, i, nearest)){
				result.emptyRegion = true;
				result.emptyRegionHits++;
				emptyFallbackParts[i] = true;
				continue;
			}
			result.movesApplied++;
			result.exactRelocations++;
			sweepMoved = true;
		}

		if(!sweepMoved){
			localRefinementReweightViolations(weights, state);
			stuckCycles++;
		}
		else{
			stuckCycles = 0;
		}
	}

	var finalState = localRefinementAllViolations(ctx);
	result.itersUsed++;
	result.maxResidualDepth = Math.max(result.maxResidualDepth, finalState.maxDepth || 0);
	result.feasible = finalState.violations.length === 0 && !finalState.missingGeometry;
	return result;
}

function localRefinementSqueezePlacements(sheet, placed, sourcePlacements, alpha, axis){
	var sheetBounds = GeometryUtil.getPolygonBounds(sheet);
	var squeezed = localRefinementCopyPlacements(sourcePlacements);
	for(var i=0; i<squeezed.length; i++){
		var ref = placed[i][0];
		if(axis === 'y'){
			var qy = sourcePlacements[i].y + ref.y;
			squeezed[i].y = sheetBounds.y + (qy - sheetBounds.y) * (1 - alpha) - ref.y;
		}
		else{
			var qx = sourcePlacements[i].x + ref.x;
			squeezed[i].x = sheetBounds.x + (qx - sheetBounds.x) * (1 - alpha) - ref.x;
		}
	}
	return squeezed;
}

function localRefinementClampPlacements(placed, sourcePlacements, virtual){
	var clamped = localRefinementCopyPlacements(sourcePlacements);
	if(!virtual || !virtual.qLimits){
		return clamped;
	}
	var axis = virtual.axis || 'x';
	for(var i=0; i<clamped.length; i++){
		if(!virtual.qLimits[i] || !isFinite(virtual.qLimits[i].limit)){
			continue;
		}
		var ref = localRefinementAxisCoordinate(placed[i][0], axis);
		var qAxis = (axis === 'y' ? sourcePlacements[i].y : sourcePlacements[i].x) + ref;
		var limit = virtual.qLimits[i].limit;
		if(qAxis <= limit){
			continue;
		}
		if(axis === 'y'){
			clamped[i].y = limit - ref;
		}
		else{
			clamped[i].x = limit - ref;
		}
	}
	return clamped;
}

function localRefinementMaterialOverlap(A, B, config){
	if(typeof SeparationUtil === 'undefined' || typeof SeparationUtil.materialOverlap !== 'function'){
		return true;
	}
	return SeparationUtil.materialOverlap(A, B, {
		clipperLib: ClipperLib,
		clipperScale: config.clipperScale,
		curveTolerance: config.curveTolerance
	});
}

function localRefinementOuterMaterialOverlap(A, B, config){
	if(typeof ClipperLib === 'undefined' || !A || !B || A.length < 3 || B.length < 3){
		return true;
	}
	var scale = Number(config.clipperScale) || 10000000;
	var aPath = toClipperCoordinates(A);
	var bPath = toClipperCoordinates(B);
	ClipperLib.JS.ScaleUpPath(aPath, scale);
	ClipperLib.JS.ScaleUpPath(bPath, scale);
	var solution = new ClipperLib.Paths();
	var clipper = new ClipperLib.Clipper();
	clipper.AddPaths([aPath], ClipperLib.PolyType.ptSubject, true);
	clipper.AddPaths([bPath], ClipperLib.PolyType.ptClip, true);
	if(!clipper.Execute(ClipperLib.ClipType.ctIntersection, solution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
		return true;
	}
	return localRefinementClipperPathsHaveArea(solution, config);
}

function localRefinementExactMaterialOverlap(A, B, config){
	if(localRefinementHasChildren(A) || localRefinementHasChildren(B)){
		if(config && config.processHoles === false){
			return localRefinementOuterMaterialOverlap(A, B, config);
		}
		return true;
	}
	return localRefinementMaterialOverlap(A, B, config);
}

function localRefinementHasChildren(part){
	return !!(part && part.children && part.children.length > 0);
}

function localRefinementBoundsOverlap(a, b, padding){
	if(!a || !b){
		return false;
	}
	var pad = Number(padding) || 0;
	return !(a.x + a.width < b.x - pad ||
		b.x + b.width < a.x - pad ||
		a.y + a.height < b.y - pad ||
		b.y + b.height < a.y - pad);
}

function localRefinementScaleClipperPath(path, config){
	var scaled = path.slice();
	var scale = Number(config.clipperScale) || 10000000;
	ClipperLib.JS.ScaleUpPath(scaled, scale);
	return scaled;
}

function localRefinementClipperPathsHaveArea(paths, config){
	if(!paths || paths.length === 0 || typeof ClipperLib === 'undefined'){
		return false;
	}
	var scale = Number(config.clipperScale) || 10000000;
	var epsDepth = Math.max(1e-9, 1e-4 * (Number(config.curveTolerance) || 0));
	var eroded = new ClipperLib.Paths();
	var offset = new ClipperLib.ClipperOffset(2, epsDepth * scale);
	offset.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
	offset.Execute(eroded, -0.5 * epsDepth * scale);
	if(!eroded || eroded.length === 0){
		return false;
	}
	for(var i=0; i<eroded.length; i++){
		if(eroded[i] && eroded[i].length >= 3 && Math.abs(ClipperLib.Clipper.Area(eroded[i])) > 0){
			return true;
		}
	}
	return false;
}

function localRefinementExactSheetContains(part, placement, sheet, config){
	if(!part || part.length < 3 || !sheet || sheet.length < 3 || typeof ClipperLib === 'undefined'){
		return false;
	}
	var world = shiftPolygon(part, placement);
	var subject = [localRefinementScaleClipperPath(toClipperCoordinates(world), config)];
	var sheetOuter = [localRefinementScaleClipperPath(toClipperCoordinates(sheet), config)];
	var outside = new ClipperLib.Paths();
	var clipper = new ClipperLib.Clipper();
	clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
	clipper.AddPaths(sheetOuter, ClipperLib.PolyType.ptClip, true);
	if(!clipper.Execute(ClipperLib.ClipType.ctDifference, outside, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
		return false;
	}
	if(localRefinementClipperPathsHaveArea(outside, config)){
		return false;
	}
	if(sheet.children && sheet.children.length > 0){
		for(var h=0; h<sheet.children.length; h++){
			if(localRefinementOuterMaterialOverlap(world, sheet.children[h], config)){
				return false;
			}
		}
	}
	return true;
}

function localRefinementFinalLayoutLegalExact(sheet, placed, placements, config){
	if(typeof SeparationUtil === 'undefined'){
		return false;
	}
	var bounds = [];
	for(var i=0; i<placed.length; i++){
		if(!localRefinementExactSheetContains(placed[i], placements[i], sheet, config)){
			return false;
		}
		bounds[i] = localRefinementWorldBounds(placed[i], placements[i]);
	}
	var eps = Math.max(1e-9, 1e-4 * (Number(config.curveTolerance) || 0));
	for(i=0; i<placed.length; i++){
		for(var j=i+1; j<placed.length; j++){
			if(!localRefinementBoundsOverlap(bounds[i], bounds[j], eps)){
				continue;
			}
			if(localRefinementExactMaterialOverlap(
				shiftPolygon(placed[i], placements[i]),
				shiftPolygon(placed[j], placements[j]),
				config
			)){
				return false;
			}
		}
	}
	return true;
}

function localRefinementRequiresExactFinalGate(placements, config){
	if(!placements){
		return false;
	}
	for(var i=0; i<placements.length; i++){
		if(placements[i] && !localRefinementRotationOnCanonicalGrid(placements[i].rotation || 0, config)){
			return true;
		}
	}
	return false;
}

function localRefinementFinalLayoutLegalForRotations(sheet, placed, placements, config){
	if(localRefinementRequiresExactFinalGate(placements, config)){
		return localRefinementFinalLayoutLegalExact(sheet, placed, placements, config);
	}
	return localRefinementFinalLayoutLegal(sheet, placed, placements, config);
}

function localRefinementFinalLayoutLegal(sheet, placed, placements, config){
	if(typeof SeparationUtil === 'undefined'){
		return false;
	}
	var eps = Math.max(1e-9, 1e-4 * (Number(config.curveTolerance) || 0));
	for(var i=0; i<placed.length; i++){
		var q = {
			x: placements[i].x + placed[i][0].x,
			y: placements[i].y + placed[i][0].y
		};
		var ifp = getInnerNfp(sheet, placed[i], config);
		if(!ifp){
			return false;
		}
		var containment = SeparationUtil.containmentViolation(q, ifp);
		if(containment.outside && containment.depth > eps){
			return false;
		}
		for(var j=0; j<placed.length; j++){
			if(i === j){
				continue;
			}
			var nfp = getOuterNfp(placed[j], placed[i], false, config);
			if(!nfp){
				return false;
			}
			nfp = localRefinementShiftNfp(clone(nfp), placements[j]);
			var penetration = SeparationUtil.penetration(q, nfp);
			if(penetration.depth > eps){
				return false;
			}
		}
	}

	for(i=0; i<placed.length; i++){
		for(j=i+1; j<placed.length; j++){
			if(localRefinementMaterialOverlap(
				shiftPolygon(placed[i], placements[i]),
				shiftPolygon(placed[j], placements[j]),
				config
			)){
				return false;
			}
		}
	}

	return true;
}

function localRefinementPlacementWithXY(source, x, y){
	return {
		x: x,
		y: y,
		id: source.id,
		source: source.source,
		rotation: source.rotation
	};
}

function localRefinementSetPlacementXY(placement, x, y){
	placement.x = x;
	placement.y = y;
	return placement;
}

function localRefinementBuildExclusionLists(placed, placements, skip){
	var result = {
		placed: [],
		placements: []
	};
	for(var i=0; i<placed.length; i++){
		if(skip && skip[i]){
			continue;
		}
		result.placed.push(placed[i]);
		result.placements.push(placements[i]);
	}
	return result;
}

function localRefinementWorldBounds(part, placement){
	var points = [];
	for(var i=0; i<part.length; i++){
		points.push({
			x: part[i].x + placement.x,
			y: part[i].y + placement.y
		});
	}
	return GeometryUtil.getPolygonBounds(points);
}

function localRefinementPartBboxArea(part){
	var bounds = GeometryUtil.getPolygonBounds(part);
	return bounds && bounds.width > 0 && bounds.height > 0 ? bounds.width * bounds.height : 0;
}

function localRefinementSmartTargetOrder(placed, placements, config){
	var items = [];
	for(var i=0; i<placed.length; i++){
		var bounds = localRefinementWorldBounds(placed[i], placements[i]);
		if(!bounds){
			continue;
		}
		var score = bounds.x + bounds.width;
		if(config.placementType === 'box'){
			score += bounds.y + bounds.height;
		}
		items.push({
			index: i,
			score: score
		});
	}
	items.sort(function(a, b){
		if(b.score !== a.score){
			return b.score - a.score;
		}
		return a.index - b.index;
	});
	var order = [];
	for(i=0; i<items.length; i++){
		order.push(items[i].index);
	}
	return order;
}

function localRefinementQuantizedRotation(rotation){
	return Math.round(normalizedRotation(rotation) * 1000) / 1000;
}

function localRefinementRotatePoint(point, degrees){
	var angle = degrees * Math.PI / 180;
	return {
		x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
		y: point.x * Math.sin(angle) + point.y * Math.cos(angle)
	};
}

function localRefinementPolygonCentroid(part){
	var area2 = 0;
	var cx = 0;
	var cy = 0;
	for(var i=0; i<part.length; i++){
		var j = i === part.length - 1 ? 0 : i + 1;
		var cross = part[i].x * part[j].y - part[j].x * part[i].y;
		area2 += cross;
		cx += (part[i].x + part[j].x) * cross;
		cy += (part[i].y + part[j].y) * cross;
	}
	if(Math.abs(area2) > 1e-12){
		return {
			x: cx / (3 * area2),
			y: cy / (3 * area2)
		};
	}
	cx = 0;
	cy = 0;
	for(i=0; i<part.length; i++){
		cx += part[i].x;
		cy += part[i].y;
	}
	return {
		x: part.length > 0 ? cx / part.length : 0,
		y: part.length > 0 ? cy / part.length : 0
	};
}

function localRefinementFineRotationCandidate(basePart, basePlacement, delta){
	var pivotLocal = localRefinementPolygonCentroid(basePart);
	var pivotWorld = {
		x: basePlacement.x + pivotLocal.x,
		y: basePlacement.y + pivotLocal.y
	};
	var rotatedPivot = localRefinementRotatePoint(pivotLocal, delta);
	var candidatePart = rotatePolygon(basePart, delta);
	var candidatePlacement = clonePlacementPosition(basePlacement);
	candidatePlacement.x = pivotWorld.x - rotatedPivot.x;
	candidatePlacement.y = pivotWorld.y - rotatedPivot.y;
	candidatePlacement.rotation = localRefinementQuantizedRotation((basePlacement.rotation || basePart.rotation || 0) + delta);
	candidatePart.source = basePart.source;
	candidatePart.id = basePart.id;
	candidatePart.rotation = candidatePlacement.rotation;
	return {
		part: candidatePart,
		placement: candidatePlacement
	};
}

function localRefinementFineRotationAccepts(candidateScore, currentScore, candidateDelta, currentDelta, config){
	if(candidateScore === null || typeof candidateScore === 'undefined'){
		return false;
	}
	if(localRefinementImproves(candidateScore, currentScore)){
		return true;
	}
	if(config && config.fineRotationStrictImprovement === true){
		return false;
	}
	if(currentScore === null || typeof currentScore === 'undefined'){
		return true;
	}
	if(Math.abs(candidateDelta) <= Math.abs(currentDelta || 0) + 1e-9){
		return false;
	}
	var neutralTolerance = Math.max(1e-9, Math.abs(currentScore) * 1e-9);
	if(candidateScore <= currentScore + neutralTolerance){
		return true;
	}
	var maxWorsenRatio = Number(config && config.fineRotationMaxWorsenRatio);
	if(!isFinite(maxWorsenRatio) || maxWorsenRatio < 0){
		maxWorsenRatio = 0.001;
	}
	var maxWorsen = Math.max(1e-9, Math.abs(currentScore) * maxWorsenRatio);
	return candidateScore <= currentScore + maxWorsen;
}

function localRefinementAddPlacementCandidate(candidates, placement, tolerance){
	for(var i=0; i<candidates.length; i++){
		if(Math.abs(candidates[i].x - placement.x) <= tolerance && Math.abs(candidates[i].y - placement.y) <= tolerance){
			return;
		}
	}
	candidates.push(clonePlacementPosition(placement));
}

function localRefinementFineRotationPlacementCandidates(part, placement, delta, config){
	var candidates = [];
	var tolerance = Math.max(1e-9, 1e-6 * (Number(config.curveTolerance) || 1));
	localRefinementAddPlacementCandidate(candidates, placement, tolerance);
	var maxShift = localRefinementBboxDiagonal(part) * Math.sin(Math.abs(delta) * Math.PI / 180);
	maxShift = Math.max(maxShift, Number(config.curveTolerance) || 0.01);
	var distances = [0.25 * maxShift, 0.5 * maxShift, maxShift];
	var directions = [
		{x: -1, y: 0},
		{x: 0, y: -1},
		{x: -1, y: -1},
		{x: 1, y: 0},
		{x: 0, y: 1},
		{x: 1, y: -1},
		{x: -1, y: 1},
		{x: 1, y: 1}
	];
	for(var d=0; d<directions.length; d++){
		var unit = localRefinementNormalizeDirection(directions[d]);
		if(!unit){
			continue;
		}
		for(var s=0; s<distances.length; s++){
			var candidate = clonePlacementPosition(placement);
			candidate.x += unit.x * distances[s];
			candidate.y += unit.y * distances[s];
			localRefinementAddPlacementCandidate(candidates, candidate, tolerance);
		}
	}
	return candidates;
}

function localRefinementFineRotationHasHoleRisk(placed, placements, config, index){
	if(config && config.processHoles === false){
		return false;
	}
	if(localRefinementHasChildren(placed[index])){
		return true;
	}
	var bounds = localRefinementWorldBounds(placed[index], placements[index]);
	var maxDeg = Math.max(0, Number(config.fineRotationMaxDeg) || 6);
	var padding = localRefinementBboxDiagonal(placed[index]) * Math.sin(maxDeg * Math.PI / 180) + Math.max(1e-9, Number(config.curveTolerance) || 0);
	for(var i=0; i<placed.length; i++){
		if(i === index || !localRefinementHasChildren(placed[i])){
			continue;
		}
		if(localRefinementBoundsOverlap(bounds, localRefinementWorldBounds(placed[i], placements[i]), padding)){
			return true;
		}
	}
	return false;
}

function localRefinementFineRotationCandidateLegal(sheet, placed, placements, config, index, candidatePart, candidatePlacement, stats){
	var started = Date.now();
	if(stats){
		stats.fineRotateExactChecks = (stats.fineRotateExactChecks || 0) + 1;
	}
	var legal = false;
	try {
		if(!localRefinementExactSheetContains(candidatePart, candidatePlacement, sheet, config)){
			return false;
		}
		var eps = Math.max(1e-9, 1e-4 * (Number(config.curveTolerance) || 0));
		var candidateWorld = shiftPolygon(candidatePart, candidatePlacement);
		var candidateBounds = GeometryUtil.getPolygonBounds(candidateWorld);
		for(var j=0; j<placed.length; j++){
			if(j === index){
				continue;
			}
			var neighborBounds = localRefinementWorldBounds(placed[j], placements[j]);
			if(!localRefinementBoundsOverlap(candidateBounds, neighborBounds, eps)){
				continue;
			}
			if(localRefinementExactMaterialOverlap(candidateWorld, shiftPolygon(placed[j], placements[j]), config)){
				return false;
			}
		}
		legal = true;
		return true;
	}
	finally {
		if(stats){
			stats.fineRotateExactMs = (stats.fineRotateExactMs || 0) + (Date.now() - started);
			if(!legal){
				stats.legalityRejects = (stats.legalityRejects || 0) + 1;
			}
		}
	}
}

function localRefinementTryFineRotate(sheet, placed, placements, config, index, currentMetric, deadline, stats){
	var operatorStats = stats ? localRefinementEnsureSmartStats(stats) : null;
	if(localRefinementFineRotationHasHoleRisk(placed, placements, config, index)){
		if(stats){
			stats.fineRotateSkippedHoles = (stats.fineRotateSkippedHoles || 0) + 1;
		}
		return {moved: false, metric: currentMetric};
	}

	var maxDeg = Math.max(0, Number(config.fineRotationMaxDeg) || 6);
	var minDeg = Math.max(1e-6, Number(config.fineRotationMinDeg) || 0.25);
	if(maxDeg <= 0 || minDeg > maxDeg){
		return {moved: false, metric: currentMetric};
	}
	var basePart = localRefinementClonePart(placed[index]);
	var basePlacement = clonePlacementPosition(placements[index]);
	var step = maxDeg;
	var netDelta = 0;
	var moved = false;
	var metric = currentMetric;
	var directions = [1, -1];

	while(step >= minDeg && Date.now() < deadline){
		var acceptedAtStep = false;
		for(var d=0; d<directions.length && Date.now() < deadline; d++){
			var candidateDelta = netDelta + directions[d] * step;
			if(Math.abs(candidateDelta) > maxDeg + 1e-9){
				continue;
			}
			if(stats){
				stats.fineRotateCandidates = (stats.fineRotateCandidates || 0) + 1;
				stats.movesTested = (stats.movesTested || 0) + 1;
			}
			if(operatorStats){
				operatorStats.fineRotate.tried++;
			}
			var candidate = localRefinementFineRotationCandidate(basePart, basePlacement, candidateDelta);
			var currentPart = placed[index];
			var currentPlacement = placements[index];
			var placementsToTry = localRefinementFineRotationPlacementCandidates(candidate.part, candidate.placement, candidateDelta, config);
			var acceptedPlacement = null;
			var acceptedMetric = null;
			for(var p=0; p<placementsToTry.length && Date.now() < deadline; p++){
				if(stats && p > 0){
					stats.fineRotateSlideCandidates = (stats.fineRotateSlideCandidates || 0) + 1;
				}
				if(!localRefinementFineRotationCandidateLegal(sheet, placed, placements, config, index, candidate.part, placementsToTry[p], stats)){
					continue;
				}
				if(stats){
					stats.fineRotateLegalCandidates = (stats.fineRotateLegalCandidates || 0) + 1;
				}
				placed[index] = candidate.part;
				placements[index] = placementsToTry[p];
				var candidateMetric = localRefinementSmartMetric(sheet, placed, placements, config);
				placed[index] = currentPart;
				placements[index] = currentPlacement;
				if(!localRefinementFineRotationAccepts(candidateMetric, metric, candidateDelta, netDelta, config)){
					continue;
				}
				if(acceptedMetric === null || candidateMetric < acceptedMetric || (GeometryUtil.almostEqual(candidateMetric, acceptedMetric, 1e-12) && p === 0)){
					acceptedMetric = candidateMetric;
					acceptedPlacement = placementsToTry[p];
				}
			}
			if(acceptedPlacement){
				placed[index] = candidate.part;
				placements[index] = acceptedPlacement;
				if(!localRefinementImproves(acceptedMetric, metric) && stats){
					var neutralTolerance = Math.max(1e-9, Math.abs(metric) * 1e-9);
					if(acceptedMetric <= metric + neutralTolerance){
						stats.fineRotateNeutralAccepted = (stats.fineRotateNeutralAccepted || 0) + 1;
					}
					else{
						stats.fineRotateNearNeutralAccepted = (stats.fineRotateNearNeutralAccepted || 0) + 1;
					}
				}
				if((!GeometryUtil.almostEqual(acceptedPlacement.x, candidate.placement.x, 1e-9) || !GeometryUtil.almostEqual(acceptedPlacement.y, candidate.placement.y, 1e-9)) && stats){
					stats.fineRotateSlideAccepted = (stats.fineRotateSlideAccepted || 0) + 1;
				}
				metric = acceptedMetric;
				netDelta = candidateDelta;
				moved = true;
				acceptedAtStep = true;
				if(operatorStats){
					operatorStats.fineRotate.accepted++;
				}
				if(stats){
					stats.movesAccepted = (stats.movesAccepted || 0) + 1;
					stats.fineRotateMaxDeltaDeg = Math.max(stats.fineRotateMaxDeltaDeg || 0, Math.abs(netDelta));
				}
				return {
					moved: true,
					metric: metric
				};
			}
			placed[index] = currentPart;
			placements[index] = currentPlacement;
		}
		if(!acceptedAtStep){
			step /= 2;
		}
	}
	if(Date.now() >= deadline && stats){
		stats.deadlineHits = (stats.deadlineHits || 0) + 1;
	}
	return {
		moved: moved,
		metric: metric
	};
}

function localRefinementRunFineRotationStage(sheet, placed, placements, config, currentMetric, deadline, stats){
	if(!config || config.localRefinementFineRotation !== true){
		return {moved: false, metric: currentMetric};
	}
	if(config.mergeLines === true){
		if(stats){
			stats.fineRotateSkippedMergeLines = (stats.fineRotateSkippedMergeLines || 0) + 1;
		}
		return {moved: false, metric: currentMetric};
	}
	var minBudget = Math.max(0, parseInt(config.fineRotationMinBudgetMs, 10) || 300);
	if(deadline - Date.now() < minBudget){
		if(stats){
			stats.fineRotateSkippedBudget = (stats.fineRotateSkippedBudget || 0) + 1;
		}
		return {moved: false, metric: currentMetric};
	}
	var order = localRefinementSmartTargetOrder(placed, placements, config);
	var configuredTargets = parseInt(config.fineRotationMaxTargets, 10);
	var maxTargets = isFinite(configuredTargets) && configuredTargets >= 0 ? configuredTargets : 8;
	var limit = Math.min(order.length, maxTargets);
	var moved = false;
	var metric = currentMetric;
	for(var t=0; t<limit && Date.now() < deadline; t++){
		var result = localRefinementTryFineRotate(sheet, placed, placements, config, order[t], metric, deadline, stats);
		if(result.moved){
			metric = result.metric;
			moved = true;
		}
	}
	return {
		moved: moved,
		metric: metric
	};
}

function localRefinementRunRotationReflowStage(sheet, placed, placements, config, currentMetric, deadline, stats){
	if(!config || config.localRefinementRotationReflow !== true){
		return {moved: false, metric: currentMetric};
	}
	var order = localRefinementSmartTargetOrder(placed, placements, config);
	var configuredTargets = parseInt(config.rotationReflowMaxTargets, 10);
	var maxTargets = isFinite(configuredTargets) && configuredTargets >= 0 ? configuredTargets : 2;
	var limit = Math.min(order.length, maxTargets);
	var moved = false;
	var metric = currentMetric;
	for(var target=0; target<limit && Date.now() < deadline; target++){
		var result = localRefinementTryRotationReflow(sheet, placed, placements, config, order[target], metric, deadline, stats);
		if(result.moved){
			metric = result.metric;
			moved = true;
		}
	}
	return {
		moved: moved,
		metric: metric
	};
}

function localRefinementSinglePlacementLegal(sheet, placed, placements, config, index, skip){
	var eps = Math.max(1e-9, 1e-4 * (Number(config.curveTolerance) || 0));
	var q = {
		x: placements[index].x + placed[index][0].x,
		y: placements[index].y + placed[index][0].y
	};
	var ifp = getInnerNfp(sheet, placed[index], config);
	if(!ifp){
		return false;
	}
	var containment = SeparationUtil.containmentViolation(q, ifp);
	if(containment.outside && containment.depth > eps){
		return false;
	}
	for(var j=0; j<placed.length; j++){
		if(j === index || (skip && skip[j])){
			continue;
		}
		var nfp = getOuterNfp(placed[j], placed[index], false, config);
		if(!nfp){
			return false;
		}
		nfp = localRefinementShiftNfp(clone(nfp), placements[j]);
		if(SeparationUtil.penetration(q, nfp).depth > eps){
			return false;
		}
		if(localRefinementMaterialOverlap(
			shiftPolygon(placed[index], placements[index]),
			shiftPolygon(placed[j], placements[j]),
			config
		)){
			return false;
		}
	}
	return true;
}

function localRefinementEnsureSmartStats(stats){
	if(!stats.operatorStats){
		stats.operatorStats = {
			settle: {tried: 0, accepted: 0},
			rotateReflow: {tried: 0, accepted: 0},
			relocate: {tried: 0, accepted: 0},
			swap: {tried: 0, accepted: 0},
			fineRotate: {tried: 0, accepted: 0}
		};
	}
	else{
		if(!stats.operatorStats.settle){
			stats.operatorStats.settle = {tried: 0, accepted: 0};
		}
		if(!stats.operatorStats.rotateReflow){
			stats.operatorStats.rotateReflow = {tried: 0, accepted: 0};
		}
		if(!stats.operatorStats.relocate){
			stats.operatorStats.relocate = {tried: 0, accepted: 0};
		}
		if(!stats.operatorStats.swap){
			stats.operatorStats.swap = {tried: 0, accepted: 0};
		}
		if(!stats.operatorStats.fineRotate){
			stats.operatorStats.fineRotate = {tried: 0, accepted: 0};
		}
	}
	return stats.operatorStats;
}

function localRefinementRingBoundaryDistance(q, ring){
	if(!ring || ring.length < 2){
		return Infinity;
	}
	return SeparationUtil.distToRingBoundary(q, ring).dist;
}

function localRefinementNfpBoundaryDistance(q, nfp){
	var best = localRefinementRingBoundaryDistance(q, nfp);
	if(nfp && nfp.children && nfp.children.length > 0){
		for(var i=0; i<nfp.children.length; i++){
			var child = localRefinementRingBoundaryDistance(q, nfp.children[i]);
			if(child < best){
				best = child;
			}
		}
	}
	return best;
}

function localRefinementPartTouchesAnyPart(placed, placements, config, index){
	var epsDepth = Math.max(1e-9, 1e-4 * (Number(config.curveTolerance) || 0));
	var contactEps = Math.max(4 * epsDepth, 0.05 * (Number(config.curveTolerance) || 0));
	var q = {
		x: placements[index].x + placed[index][0].x,
		y: placements[index].y + placed[index][0].y
	};
	for(var j=0; j<placed.length; j++){
		if(j === index){
			continue;
		}
		var nfp = getOuterNfp(placed[j], placed[index], false, config);
		if(!nfp){
			continue;
		}
		nfp = localRefinementShiftNfp(clone(nfp), placements[j]);
		var pen = SeparationUtil.penetration(q, nfp);
		if(pen.inside){
			return true;
		}
		if(localRefinementNfpBoundaryDistance(q, nfp) <= contactEps){
			return true;
		}
	}
	return false;
}

function localRefinementHullArea(placed, placements, excludeIndex){
	var points = [];
	for(var i=0; i<placed.length; i++){
		if(i === excludeIndex){
			continue;
		}
		for(var p=0; p<placed[i].length; p++){
			points.push({
				x: placed[i][p].x + placements[i].x,
				y: placed[i][p].y + placements[i].y
			});
		}
	}
	if(points.length < 3){
		return 0;
	}
	return Math.abs(GeometryUtil.polygonArea(getHull(points)));
}

function localRefinementDetectFloaters(placed, placements, config){
	var floaters = [];
	var cluster = [];
	for(var i=0; i<placed.length; i++){
		if(localRefinementPartTouchesAnyPart(placed, placements, config, i)){
			cluster.push(i);
		}
		else{
			floaters.push(i);
		}
	}

	// Contact alone is too strict for real geometry: a part can touch the
	// cluster at a single tip while still wasting a large share of the layout
	// hull. In convexhull mode, also classify any part whose removal shrinks
	// the hull by >= 5% as a floater, keeping at least one cluster member.
	if(config && config.placementType === 'convexhull' && placed.length > 2){
		var totalHull = localRefinementHullArea(placed, placements, -1);
		if(totalHull > 0){
			// Spread outliers: parts whose center sits well beyond the median
			// center distance. With several simultaneous strays the hull is
			// pinned by the others, so per-part hull contribution understates
			// each stray — the outlier test catches them anyway.
			var centers = [];
			var meanCx = 0;
			var meanCy = 0;
			for(var ci=0; ci<placed.length; ci++){
				var cb = localRefinementWorldBounds(placed[ci], placements[ci]);
				centers.push(cb ? {x: cb.x + cb.width / 2, y: cb.y + cb.height / 2} : null);
				if(centers[ci]){
					meanCx += centers[ci].x;
					meanCy += centers[ci].y;
				}
			}
			meanCx /= placed.length;
			meanCy /= placed.length;
			var centerDists = [];
			var sortedDists = [];
			for(ci=0; ci<placed.length; ci++){
				var cd = centers[ci] ? Math.sqrt(sqr(centers[ci].x - meanCx) + sqr(centers[ci].y - meanCy)) : 0;
				centerDists.push(cd);
				sortedDists.push(cd);
			}
			sortedDists.sort(function(a, b){ return a - b; });
			var medianDist = sortedDists[Math.floor(sortedDists.length / 2)] || 0;

			var keep = [];
			for(var c=0; c<cluster.length; c++){
				var idx = cluster[c];
				var without = localRefinementHullArea(placed, placements, idx);
				var contribution = 1 - (without / totalHull);
				var spreadOutlier = medianDist > 0 && centerDists[idx] > 1.4 * medianDist;
				if((contribution >= 0.02 || spreadOutlier) && keep.length + (cluster.length - 1 - c) >= 1){
					floaters.push(idx);
				}
				else{
					keep.push(idx);
				}
			}
			if(keep.length > 0){
				cluster = keep;
			}
			else if(floaters.length === placed.length){
				// fall through to the all-floaters seed logic below
				cluster = [];
			}
		}
	}
	if(floaters.length === placed.length && placed.length > 0){
		var seed = 0;
		var best = null;
		for(i=0; i<placed.length; i++){
			var bounds = localRefinementWorldBounds(placed[i], placements[i]);
			var value = bounds ? bounds.x : placements[i].x;
			if(best === null || value < best){
				best = value;
				seed = i;
			}
		}
		cluster = [seed];
		floaters = [];
		for(i=0; i<placed.length; i++){
			if(i !== seed){
				floaters.push(i);
			}
		}
	}
	return {
		floaters: floaters,
		cluster: cluster
	};
}

function localRefinementClusterCenter(placed, placements, cluster){
	var points = [];
	for(var c=0; c<cluster.length; c++){
		var i = cluster[c];
		for(var p=0; p<placed[i].length; p++){
			points.push({
				x: placed[i][p].x + placements[i].x,
				y: placed[i][p].y + placements[i].y
			});
		}
	}
	var bounds = points.length > 0 ? GeometryUtil.getPolygonBounds(points) : null;
	return bounds ? {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2
	} : {x: 0, y: 0};
}

function localRefinementOrderFloaters(placed, placements, detection){
	var center = localRefinementClusterCenter(placed, placements, detection.cluster);
	var items = [];
	for(var i=0; i<detection.floaters.length; i++){
		var index = detection.floaters[i];
		var bounds = localRefinementWorldBounds(placed[index], placements[index]);
		var cx = bounds ? bounds.x + bounds.width / 2 : placements[index].x;
		var cy = bounds ? bounds.y + bounds.height / 2 : placements[index].y;
		var dx = cx - center.x;
		var dy = cy - center.y;
		items.push({
			index: index,
			dist: dx * dx + dy * dy
		});
	}
	items.sort(function(a, b){
		if(b.dist !== a.dist){
			return b.dist - a.dist;
		}
		return a.index - b.index;
	});
	var order = [];
	for(i=0; i<items.length; i++){
		order.push(items[i].index);
	}
	return order;
}

function localRefinementDominantClusterRotation(placements, cluster){
	var counts = {};
	var bestRotation = 0;
	var bestCount = -1;
	for(var i=0; i<cluster.length; i++){
		var rotation = normalizedRotation(placements[cluster[i]].rotation || 0);
		var key = String(Math.round(rotation * 1000) / 1000);
		counts[key] = (counts[key] || 0) + 1;
		if(counts[key] > bestCount || (counts[key] === bestCount && Number(key) < bestRotation)){
			bestCount = counts[key];
			bestRotation = Number(key);
		}
	}
	return bestRotation;
}

function localRefinementAngularDistance(a, b){
	var delta = Math.abs(normalizedRotation(a) - normalizedRotation(b)) % 360;
	return delta > 180 ? 360 - delta : delta;
}

function localRefinementSourceRotationAngles(placement, config){
	if(config && config.adaptiveRotations === true && config.adaptiveRotationAnglesBySource && placement && typeof placement.source !== 'undefined'){
		var adaptive = config.adaptiveRotationAnglesBySource[String(placement.source)];
		if(adaptive && adaptive.length){
			return adaptive.slice();
		}
	}
	var count = Math.max(1, parseInt(config && config.rotations, 10) || 1);
	var angles = [];
	for(var i=0; i<count; i++){
		angles.push(normalizedRotation(i * 360 / count));
	}
	return angles;
}

function localRefinementFloaterRotations(placements, config, index, cluster){
	var current = normalizedRotation(placements[index].rotation || 0);
	var rotations = [current];
	if(config.localRefinementRotations !== true){
		return rotations;
	}
	var dominant = localRefinementDominantClusterRotation(placements, cluster);
	var candidates = [];
	var allowed = localRefinementSourceRotationAngles(placements[index], config);
	for(var k=0; k<allowed.length; k++){
		var rotation = normalizedRotation(allowed[k]);
		if(localRefinementAngularDistance(rotation, current) <= 1e-7){
			continue;
		}
		candidates.push({
			rotation: rotation,
			distance: localRefinementAngularDistance(rotation, dominant)
		});
	}
	candidates.sort(function(a, b){
		if(a.distance !== b.distance){
			return a.distance - b.distance;
		}
		return a.rotation - b.rotation;
	});
	for(k=0; k<candidates.length && rotations.length < 4; k++){
		rotations.push(candidates[k].rotation);
	}
	return rotations;
}

function localRefinementRotationReflowAngles(placement, config){
	var current = normalizedRotation(placement && placement.rotation || 0);
	var allowed = localRefinementSourceRotationAngles(placement, config);
	var uniform = [];
	var uniformCount = Math.max(1, parseInt(config && config.rotations, 10) || 1);
	for(var u=0; u<uniformCount; u++){
		uniform.push(normalizedRotation(u * 360 / uniformCount));
	}
	var candidates = [];
	for(var i=0; i<allowed.length; i++){
		var rotation = normalizedRotation(allowed[i]);
		if(localRefinementAngularDistance(rotation, current) <= 1e-7){
			continue;
		}
		var adaptiveExtra = true;
		for(var j=0; j<uniform.length; j++){
			if(localRefinementAngularDistance(rotation, uniform[j]) <= 1e-7){
				adaptiveExtra = false;
				break;
			}
		}
		candidates.push({
			rotation: rotation,
			adaptiveExtra: adaptiveExtra,
			distance: localRefinementAngularDistance(rotation, current)
		});
	}
	candidates.sort(function(a, b){
		if(a.adaptiveExtra !== b.adaptiveExtra){
			return a.adaptiveExtra ? -1 : 1;
		}
		if(a.distance !== b.distance){
			return a.distance - b.distance;
		}
		return a.rotation - b.rotation;
	});
	var configuredLimit = parseInt(config && config.localRefinementMaxColdAnglesPerPart, 10);
	var limit = isFinite(configuredLimit) && configuredLimit >= 0 ? configuredLimit : 3;
	var result = [];
	for(i=0; i<candidates.length && result.length < limit; i++){
		result.push(candidates[i].rotation);
	}
	return result;
}

function localRefinementRotationReflowNeighbors(placed, placements, target, maxNeighbors){
	maxNeighbors = Math.max(0, parseInt(maxNeighbors, 10) || 0);
	if(maxNeighbors === 0 || !placed || placed.length < 2){
		return [];
	}
	var targetBounds = localRefinementWorldBounds(placed[target], placements[target]);
	if(!targetBounds){
		return [];
	}
	var targetCx = targetBounds.x + targetBounds.width / 2;
	var targetCy = targetBounds.y + targetBounds.height / 2;
	var candidates = [];
	for(var i=0; i<placed.length; i++){
		if(i === target){
			continue;
		}
		var bounds = localRefinementWorldBounds(placed[i], placements[i]);
		if(!bounds){
			continue;
		}
		var dx = Math.max(0, targetBounds.x - (bounds.x + bounds.width), bounds.x - (targetBounds.x + targetBounds.width));
		var dy = Math.max(0, targetBounds.y - (bounds.y + bounds.height), bounds.y - (targetBounds.y + targetBounds.height));
		var cx = bounds.x + bounds.width / 2;
		var cy = bounds.y + bounds.height / 2;
		candidates.push({
			index: i,
			gap: dx * dx + dy * dy,
			centerDistance: sqr(cx - targetCx) + sqr(cy - targetCy)
		});
	}
	candidates.sort(function(a, b){
		if(a.gap !== b.gap){
			return a.gap - b.gap;
		}
		if(a.centerDistance !== b.centerDistance){
			return a.centerDistance - b.centerDistance;
		}
		return a.index - b.index;
	});
	var result = [];
	for(i=0; i<candidates.length && result.length < maxNeighbors; i++){
		result.push(candidates[i].index);
	}
	while(result.length > 0 && result.length + 1 >= placed.length){
		result.pop();
	}
	return result;
}

function localRefinementRotatedPartForRotation(part, targetRotation){
	var currentRotation = normalizedRotation(part.rotation || 0);
	var delta = normalizedRotation(targetRotation - currentRotation);
	var rotated = delta === 0 ? clone(part) : rotatePolygon(part, delta);
	rotated.source = part.source;
	rotated.id = part.id;
	rotated.rotation = normalizedRotation(targetRotation);
	return rotated;
}

function localRefinementTrySettleFloater(sheet, placed, placements, config, index, cluster, currentMetric, deadline, stats){
	var operatorStats = stats ? localRefinementEnsureSmartStats(stats) : null;
	var originalPart = placed[index];
	var originalPlacement = clonePlacementPosition(placements[index]);
	var rotations = localRefinementFloaterRotations(placements, config, index, cluster);
	var bestPart = null;
	var bestPlacement = null;
	var bestMetric = currentMetric;

	for(var r=0; r<rotations.length; r++){
		if(Date.now() > deadline){
			if(stats){
				stats.deadlineHits = (stats.deadlineHits || 0) + 1;
			}
			break;
		}
		if(stats){
			stats.rotationsTried = (stats.rotationsTried || 0) + 1;
			stats.settleRegionComputations = (stats.settleRegionComputations || 0) + 1;
		}
		if(operatorStats){
			operatorStats.settle.tried++;
		}
		var candidatePart = localRefinementRotatedPartForRotation(originalPart, rotations[r]);
		placed[index] = candidatePart;
		var skip = {};
		skip[index] = true;
		var excluded = localRefinementBuildExclusionLists(placed, placements, skip);
		var region = localRefinementBuildStandaloneFeasibleRegion(candidatePart, excluded.placed, excluded.placements, sheet, config);
		if(!region){
			if(stats){
				stats.settleEmptyRegions = (stats.settleEmptyRegions || 0) + 1;
			}
			continue;
		}
		var currentQ = {
			x: originalPlacement.x + candidatePart[0].x,
			y: originalPlacement.y + candidatePart[0].y
		};
		var candidates = localRefinementRegionCandidates(region, currentQ, 160, config);
		for(var c=0; c<candidates.length; c++){
			if(Date.now() > deadline){
				if(stats){
					stats.deadlineHits = (stats.deadlineHits || 0) + 1;
				}
				break;
			}
			localRefinementSetPlacementXY(
				placements[index],
				candidates[c].x - candidatePart[0].x,
				candidates[c].y - candidatePart[0].y
			);
			placements[index].rotation = candidatePart.rotation;
			// Only this part moved: O(n) moved-part legality per candidate. The
			// engine-level full-layout gate still runs once before returning.
			if(!localRefinementSinglePlacementLegal(sheet, placed, placements, config, index)){
				if(stats){
					stats.legalityRejects = (stats.legalityRejects || 0) + 1;
				}
				continue;
			}
			var metric = localRefinementSmartMetric(sheet, placed, placements, config);
			if(stats && metric !== null && (!stats.settleDebug || stats.settleDebug.length < 6)){
				if(!stats.settleDebug){
					stats.settleDebug = [];
				}
				stats.settleDebug.push({
					qx: Math.round(candidates[c].x * 100) / 100,
					qy: Math.round(candidates[c].y * 100) / 100,
					px: Math.round(placements[index].x * 100) / 100,
					py: Math.round(placements[index].y * 100) / 100,
					origX: Math.round(originalPlacement.x * 100) / 100,
					origY: Math.round(originalPlacement.y * 100) / 100,
					metric: metric
				});
			}
			if(stats && metric !== null){
				stats.settleLegalCandidates = (stats.settleLegalCandidates || 0) + 1;
				var settleDelta = metric - currentMetric;
				if(typeof stats.settleBestDelta !== 'number' || settleDelta < stats.settleBestDelta){
					stats.settleBestDelta = settleDelta;
				}
			}
			if(metric !== null && metric < bestMetric - 1e-12){
				bestMetric = metric;
				bestPart = localRefinementClonePart(candidatePart);
				bestPlacement = clonePlacementPosition(placements[index]);
			}
		}
	}

	if(bestPart && bestPlacement){
		placed[index] = bestPart;
		localRefinementSetPlacementPosition(placements[index], bestPlacement);
		if(operatorStats){
			operatorStats.settle.accepted++;
		}
		if(stats){
			stats.movesAccepted++;
			stats.floatersRelocated = (stats.floatersRelocated || 0) + 1;
		}
		return {moved: true, metric: bestMetric};
	}

	placed[index] = originalPart;
	localRefinementSetPlacementPosition(placements[index], originalPlacement);
	return {moved: false, metric: currentMetric};
}

// Composite metric over the subset of parts NOT in the skip map. Used during
// group settle, where not-yet-reinserted floaters must be invisible to both
// geometry and scoring.
function localRefinementSubsetMetric(sheet, placed, placements, config, skip){
	var subsetPlaced = [];
	var subsetPlacements = [];
	for(var i=0; i<placed.length; i++){
		if(skip && skip[i]){
			continue;
		}
		subsetPlaced.push(placed[i]);
		subsetPlacements.push(placements[i]);
	}
	if(subsetPlaced.length === 0){
		return null;
	}
	return localRefinementSmartMetric(sheet, subsetPlaced, subsetPlacements, config);
}

// Synthetic detection for the full-rebuild escalation: keep a single seed part
// (gravity/box: the part nearest the sheet origin corner; hull: the most
// central part) and treat every other part as a floater to recreate. Used when
// floater-only recreation cannot improve because the "cluster" itself is
// spread out (parts touching only at tips still pin the hull).
function localRefinementFullRebuildDetection(sheet, placed, placements, config){
	var seed = 0;
	var best = null;
	var sheetBounds = GeometryUtil.getPolygonBounds(sheet);
	var meanCx = 0;
	var meanCy = 0;
	var centers = [];
	for(var i=0; i<placed.length; i++){
		var bounds = localRefinementWorldBounds(placed[i], placements[i]);
		var cx = bounds ? bounds.x + bounds.width / 2 : placements[i].x;
		var cy = bounds ? bounds.y + bounds.height / 2 : placements[i].y;
		centers.push({x: cx, y: cy});
		meanCx += cx;
		meanCy += cy;
	}
	meanCx /= placed.length;
	meanCy /= placed.length;
	for(i=0; i<placed.length; i++){
		var value;
		if(config && config.placementType === 'convexhull'){
			value = sqr(centers[i].x - meanCx) + sqr(centers[i].y - meanCy);
		}
		else{
			value = sqr(centers[i].x - (sheetBounds ? sheetBounds.x : 0)) + sqr(centers[i].y - (sheetBounds ? sheetBounds.y : 0));
		}
		if(best === null || value < best){
			best = value;
			seed = i;
		}
	}
	var floaters = [];
	for(i=0; i<placed.length; i++){
		if(i !== seed){
			floaters.push(i);
		}
	}
	return {cluster: [seed], floaters: floaters};
}

// Group settle (ruin & recreate for floaters): single-part relocation cannot
// fix a jammed spread — the other strays pin the hull AND occupy the center,
// so every single-move candidate scores worse (verified empirically on the
// laurel fixture: 390 legal candidates, best delta 0). Instead: remove ALL
// floaters, then re-place them one at a time against the growing cluster,
// exactly how construction builds interlocked stacks. Accept the whole group
// result only if the full-layout metric strictly improves; otherwise restore.
function localRefinementSettleFloaterGroup(sheet, placed, placements, config, detection, currentMetric, deadline, stats){
	var operatorStats = stats ? localRefinementEnsureSmartStats(stats) : null;
	var maxFloaters = Math.max(1, parseInt(config.settleMaxFloaters, 10) || 8);
	var center = localRefinementClusterCenter(placed, placements, detection.cluster);

	// Reinsert nearest-to-cluster first so the pack grows outward.
	var ordered = [];
	for(var i=0; i<detection.floaters.length; i++){
		var idx = detection.floaters[i];
		var bounds = localRefinementWorldBounds(placed[idx], placements[idx]);
		var cx = bounds ? bounds.x + bounds.width / 2 : placements[idx].x;
		var cy = bounds ? bounds.y + bounds.height / 2 : placements[idx].y;
		ordered.push({index: idx, dist: sqr(cx - center.x) + sqr(cy - center.y)});
	}
	ordered.sort(function(a, b){
		if(a.dist !== b.dist){
			return a.dist - b.dist;
		}
		return a.index - b.index;
	});
	ordered = ordered.slice(0, maxFloaters);

	var snapshotParts = {};
	var snapshotPlacements = {};
	var unsettled = {};
	for(i=0; i<ordered.length; i++){
		var fi = ordered[i].index;
		snapshotParts[fi] = placed[fi];
		snapshotPlacements[fi] = clonePlacementPosition(placements[fi]);
		unsettled[fi] = true;
	}

	var anyMoved = false;
	for(i=0; i<ordered.length; i++){
		if(Date.now() > deadline){
			break;
		}
		var index = ordered[i].index;
		if(operatorStats){
			operatorStats.settle.tried++;
		}
		if(stats){
			stats.movesTested++;
		}
		// Current floater becomes visible; remaining unsettled stay invisible.
		delete unsettled[index];
		var skipOthers = {};
		for(var u in unsettled){
			if(unsettled.hasOwnProperty(u)){
				skipOthers[u] = true;
			}
		}

		var rotations = localRefinementFloaterRotations(placements, config, index, detection.cluster);
		var bestPart = null;
		var bestPlacement = null;
		var bestMetric = null;
		var originalPart = placed[index];
		var originalPlacement = clonePlacementPosition(placements[index]);

		for(var r=0; r<rotations.length; r++){
			if(Date.now() > deadline){
				break;
			}
			if(stats){
				stats.rotationsTried = (stats.rotationsTried || 0) + 1;
				stats.settleRegionComputations = (stats.settleRegionComputations || 0) + 1;
			}
			var candidatePart = localRefinementRotatedPartForRotation(originalPart, rotations[r]);
			placed[index] = candidatePart;
			var skipRegion = {};
			skipRegion[index] = true;
			for(u in skipOthers){
				if(skipOthers.hasOwnProperty(u)){
					skipRegion[u] = true;
				}
			}
			var excluded = localRefinementBuildExclusionLists(placed, placements, skipRegion);
			var region = localRefinementBuildStandaloneFeasibleRegion(candidatePart, excluded.placed, excluded.placements, sheet, config);
			if(!region){
				if(stats){
					stats.settleEmptyRegions = (stats.settleEmptyRegions || 0) + 1;
				}
				continue;
			}
			var currentQ = {
				x: originalPlacement.x + candidatePart[0].x,
				y: originalPlacement.y + candidatePart[0].y
			};
			var candidates = localRefinementRegionCandidates(region, currentQ, 160, config);
			for(var c=0; c<candidates.length; c++){
				if(Date.now() > deadline){
					break;
				}
				localRefinementSetPlacementXY(
					placements[index],
					candidates[c].x - candidatePart[0].x,
					candidates[c].y - candidatePart[0].y
				);
				placements[index].rotation = candidatePart.rotation;
				if(!localRefinementSinglePlacementLegal(sheet, placed, placements, config, index, skipOthers)){
					if(stats){
						stats.legalityRejects = (stats.legalityRejects || 0) + 1;
					}
					continue;
				}
				var metric = localRefinementSubsetMetric(sheet, placed, placements, config, skipOthers);
				if(stats && metric !== null){
					stats.settleLegalCandidates = (stats.settleLegalCandidates || 0) + 1;
				}
				if(metric !== null && (bestMetric === null || metric < bestMetric - 1e-12)){
					bestMetric = metric;
					bestPart = localRefinementClonePart(candidatePart);
					bestPlacement = clonePlacementPosition(placements[index]);
				}
			}
		}

		if(bestPart && bestPlacement){
			// Rebuild step: always take the best available pocket for this part
			// against the partial layout; group acceptance happens at the end.
			placed[index] = bestPart;
			localRefinementSetPlacementPosition(placements[index], bestPlacement);
			if(Math.abs(bestPlacement.x - originalPlacement.x) > 1e-9 ||
				Math.abs(bestPlacement.y - originalPlacement.y) > 1e-9 ||
				normalizedRotation(bestPlacement.rotation || 0) !== normalizedRotation(originalPlacement.rotation || 0)){
				anyMoved = true;
			}
		}
		else{
			placed[index] = originalPart;
			localRefinementSetPlacementPosition(placements[index], originalPlacement);
		}
	}

	// Any floater never reached (deadline) stays at its original spot and is
	// part of the final full-layout metric below.
	var groupMetric = localRefinementSmartMetric(sheet, placed, placements, config);
	if(anyMoved && groupMetric !== null && groupMetric < currentMetric - 1e-12){
		if(operatorStats){
			operatorStats.settle.accepted++;
		}
		if(stats){
			var relocatedCount = 0;
			for(i=0; i<ordered.length; i++){
				var oi = ordered[i].index;
				var sp = snapshotPlacements[oi];
				if(Math.abs(placements[oi].x - sp.x) > 1e-9 || Math.abs(placements[oi].y - sp.y) > 1e-9){
					relocatedCount++;
				}
			}
			stats.movesAccepted += relocatedCount;
			stats.floatersRelocated = (stats.floatersRelocated || 0) + relocatedCount;
		}
		return {moved: true, metric: groupMetric};
	}

	// Group did not improve the full layout: restore every floater.
	for(i=0; i<ordered.length; i++){
		var ri = ordered[i].index;
		placed[ri] = snapshotParts[ri];
		localRefinementSetPlacementPosition(placements[ri], snapshotPlacements[ri]);
	}
	return {moved: false, metric: currentMetric};
}

// Rotate one target, temporarily remove its nearest blockers, then rebuild the
// bounded group against the untouched layout. Every angle starts from the same
// snapshot and only a fully legal strict improvement survives.
function localRefinementTryRotationReflow(sheet, placed, placements, config, target, currentMetric, deadline, stats){
	if(!config || config.localRefinementRotationReflow !== true){
		return {moved: false, metric: currentMetric};
	}
	var configuredMinBudget = parseInt(config.rotationReflowMinBudgetMs, 10);
	var minBudget = isFinite(configuredMinBudget) && configuredMinBudget >= 0 ? configuredMinBudget : 400;
	if(deadline - Date.now() < minBudget){
		if(stats){
			stats.rotationReflowSkippedBudget = (stats.rotationReflowSkippedBudget || 0) + 1;
		}
		return {moved: false, metric: currentMetric};
	}
	var angles = localRefinementRotationReflowAngles(placements[target], config);
	if(angles.length === 0){
		return {moved: false, metric: currentMetric};
	}
	var configuredMaxNeighbors = parseInt(config.rotationReflowMaxNeighbors, 10);
	var maxNeighbors = isFinite(configuredMaxNeighbors) && configuredMaxNeighbors >= 0 ? configuredMaxNeighbors : 3;
	var neighbors = localRefinementRotationReflowNeighbors(
		placed,
		placements,
		target,
		maxNeighbors
	);
	var victims = [target].concat(neighbors);
	var snapshotPlaced = localRefinementCopyPlaced(placed);
	var snapshotPlacements = localRefinementCopyPlacements(placements);
	var bestPlaced = null;
	var bestPlacements = null;
	var bestMetric = currentMetric;
	var operatorStats = stats ? localRefinementEnsureSmartStats(stats) : null;

	for(var angleIndex=0; angleIndex<angles.length && Date.now() < deadline; angleIndex++){
		localRefinementRestorePlaced(placed, snapshotPlaced);
		localRefinementRestorePlacements(placements, snapshotPlacements);
		if(operatorStats){
			operatorStats.rotateReflow.tried++;
		}
		if(stats){
			stats.rotationReflowAttempts = (stats.rotationReflowAttempts || 0) + 1;
			stats.rotationsTried = (stats.rotationsTried || 0) + 1;
		}

		placed[target] = localRefinementRotatedPartForRotation(placed[target], angles[angleIndex]);
		placements[target].rotation = placed[target].rotation;
		var unsettled = {};
		for(var victimIndex=0; victimIndex<victims.length; victimIndex++){
			unsettled[victims[victimIndex]] = true;
		}
		var attemptComplete = true;

		for(victimIndex=0; victimIndex<victims.length; victimIndex++){
			if(Date.now() >= deadline){
				attemptComplete = false;
				break;
			}
			var index = victims[victimIndex];
			delete unsettled[index];
			if(stats){
				stats.movesTested++;
				stats.rotationReflowRegionComputations = (stats.rotationReflowRegionComputations || 0) + 1;
			}
			var skipRegion = {};
			skipRegion[index] = true;
			for(var remaining in unsettled){
				if(Object.prototype.hasOwnProperty.call(unsettled, remaining)){
					skipRegion[remaining] = true;
				}
			}
			var excluded = localRefinementBuildExclusionLists(placed, placements, skipRegion);
			var region = localRefinementBuildStandaloneFeasibleRegion(placed[index], excluded.placed, excluded.placements, sheet, config);
			if(!region){
				if(stats){
					stats.rotationReflowEmptyRegions = (stats.rotationReflowEmptyRegions || 0) + 1;
				}
				attemptComplete = false;
				break;
			}
			var currentQ = {
				x: snapshotPlacements[index].x + placed[index][0].x,
				y: snapshotPlacements[index].y + placed[index][0].y
			};
			var candidates = localRefinementRegionCandidates(region, currentQ, 96, config);
			var bestVictimPlacement = null;
			var bestSubsetMetric = null;
			for(var candidateIndex=0; candidateIndex<candidates.length && Date.now() < deadline; candidateIndex++){
				localRefinementSetPlacementXY(
					placements[index],
					candidates[candidateIndex].x - placed[index][0].x,
					candidates[candidateIndex].y - placed[index][0].y
				);
				placements[index].rotation = placed[index].rotation;
				if(!localRefinementSinglePlacementLegal(sheet, placed, placements, config, index, unsettled)){
					if(stats){
						stats.legalityRejects = (stats.legalityRejects || 0) + 1;
					}
					continue;
				}
				if(stats){
					stats.rotationReflowLegalCandidates = (stats.rotationReflowLegalCandidates || 0) + 1;
				}
				var subsetMetric = localRefinementSubsetMetric(sheet, placed, placements, config, unsettled);
				if(subsetMetric !== null && (bestSubsetMetric === null || subsetMetric < bestSubsetMetric - 1e-12)){
					bestSubsetMetric = subsetMetric;
					bestVictimPlacement = clonePlacementPosition(placements[index]);
				}
			}
			if(!bestVictimPlacement){
				attemptComplete = false;
				break;
			}
			localRefinementSetPlacementXY(placements[index], bestVictimPlacement.x, bestVictimPlacement.y);
			placements[index].rotation = bestVictimPlacement.rotation;
		}

		if(!attemptComplete || !localRefinementFinalLayoutLegalForRotations(sheet, placed, placements, config)){
			continue;
		}
		if(stats){
			stats.rotationReflowLegalLayouts = (stats.rotationReflowLegalLayouts || 0) + 1;
		}
		var metric = localRefinementSmartMetric(sheet, placed, placements, config);
		if(metric !== null && metric < bestMetric - 1e-12){
			bestMetric = metric;
			bestPlaced = localRefinementCopyPlaced(placed);
			bestPlacements = localRefinementCopyPlacements(placements);
		}
	}

	localRefinementRestorePlaced(placed, snapshotPlaced);
	localRefinementRestorePlacements(placements, snapshotPlacements);
	if(!bestPlaced || !bestPlacements){
		return {moved: false, metric: currentMetric};
	}

	localRefinementRestorePlaced(placed, bestPlaced);
	localRefinementRestorePlacements(placements, bestPlacements);
	var movedCount = 0;
	for(var i=0; i<placements.length; i++){
		if(Math.abs(placements[i].x - snapshotPlacements[i].x) > 1e-9 ||
			Math.abs(placements[i].y - snapshotPlacements[i].y) > 1e-9 ||
			localRefinementAngularDistance(placements[i].rotation || 0, snapshotPlacements[i].rotation || 0) > 1e-7){
			movedCount++;
		}
	}
	if(operatorStats){
		operatorStats.rotateReflow.accepted++;
	}
	if(stats){
		stats.movesAccepted += Math.max(1, movedCount);
		stats.rotationReflowPartsMoved = (stats.rotationReflowPartsMoved || 0) + movedCount;
		stats.rotationReflowRotationsAccepted = (stats.rotationReflowRotationsAccepted || 0) + 1;
	}
	return {moved: true, metric: bestMetric};
}

function localRefinementTryRelocate(sheet, placed, placements, config, index, currentMetric, deadline, stats, countStats){
	var operatorStats = stats ? localRefinementEnsureSmartStats(stats) : null;
	if(countStats !== false && operatorStats){
		operatorStats.relocate.tried++;
	}
	if(stats){
		stats.movesTested++;
	}
	var skip = {};
	skip[index] = true;
	var excluded = localRefinementBuildExclusionLists(placed, placements, skip);
	var region = localRefinementBuildStandaloneFeasibleRegion(placed[index], excluded.placed, excluded.placements, sheet, config);
	if(!region){
		if(stats){
			stats.emptyRegionHits = (stats.emptyRegionHits || 0) + 1;
		}
		return {moved: false, metric: currentMetric};
	}

	var original = clonePlacementPosition(placements[index]);
	var currentQ = {
		x: original.x + placed[index][0].x,
		y: original.y + placed[index][0].y
	};
	var candidates = localRefinementRegionCandidates(region, currentQ, 128, config);
	var bestPlacement = null;
	var bestMetric = currentMetric;
	for(var c=0; c<candidates.length; c++){
		if(Date.now() > deadline){
			if(stats){
				stats.deadlineHits = (stats.deadlineHits || 0) + 1;
			}
			break;
		}
		localRefinementSetPlacementXY(
			placements[index],
			candidates[c].x - placed[index][0].x,
			candidates[c].y - placed[index][0].y
		);
		// Only this part moved: O(n) moved-part legality per candidate. The
		// engine-level full-layout gate still runs once before returning.
		if(!localRefinementSinglePlacementLegal(sheet, placed, placements, config, index)){
			if(stats){
				stats.legalityRejects = (stats.legalityRejects || 0) + 1;
			}
			continue;
		}
		var metric = localRefinementSmartMetric(sheet, placed, placements, config);
		if(metric !== null && metric < bestMetric - 1e-12){
			bestMetric = metric;
			bestPlacement = clonePlacementPosition(placements[index]);
		}
	}

	if(bestPlacement){
		localRefinementSetPlacementPosition(placements[index], bestPlacement);
		if(countStats !== false && operatorStats){
			operatorStats.relocate.accepted++;
		}
		if(stats){
			stats.movesAccepted++;
		}
		return {moved: true, metric: bestMetric};
	}

	localRefinementSetPlacementPosition(placements[index], original);
	return {moved: false, metric: currentMetric};
}

function localRefinementSwapPartners(placed, target){
	var targetArea = localRefinementPartBboxArea(placed[target]);
	if(targetArea <= 0){
		return [];
	}
	var partners = [];
	for(var j=0; j<placed.length; j++){
		if(j === target){
			continue;
		}
		var area = localRefinementPartBboxArea(placed[j]);
		if(area <= 0){
			continue;
		}
		var ratio = area / targetArea;
		if(ratio < 0.6 || ratio > 1.4){
			continue;
		}
		partners.push({
			index: j,
			delta: Math.abs(1 - ratio)
		});
	}
	partners.sort(function(a, b){
		if(a.delta !== b.delta){
			return a.delta - b.delta;
		}
		return a.index - b.index;
	});
	var result = [];
	for(var i=0; i<partners.length && result.length < 3; i++){
		result.push(partners[i].index);
	}
	return result;
}

function localRefinementTrySwap(sheet, placed, placements, config, index, currentMetric, deadline, stats){
	var operatorStats = stats ? localRefinementEnsureSmartStats(stats) : null;
	var partners = localRefinementSwapPartners(placed, index);
	for(var p=0; p<partners.length; p++){
		if(Date.now() > deadline){
			if(stats){
				stats.deadlineHits = (stats.deadlineHits || 0) + 1;
			}
			break;
		}
		var j = partners[p];
		if(operatorStats){
			operatorStats.swap.tried++;
		}
		if(stats){
			stats.movesTested++;
		}
		var snapshot = localRefinementCopyPlacements(placements);
		localRefinementSetPlacementXY(placements[j], snapshot[index].x, snapshot[index].y);
		var skip = {};
		skip[index] = true;
		skip[j] = true;
		if(!localRefinementSinglePlacementLegal(sheet, placed, placements, config, j, skip)){
			localRefinementRestorePlacements(placements, snapshot);
			continue;
		}
		var relocated = localRefinementTryRelocate(sheet, placed, placements, config, index, currentMetric, deadline, stats, false);
		if(relocated.moved && localRefinementFinalLayoutLegal(sheet, placed, placements, config)){
			if(operatorStats){
				operatorStats.swap.accepted++;
			}
			if(stats){
				stats.movesAccepted++;
			}
			return {moved: true, metric: relocated.metric};
		}
		localRefinementRestorePlacements(placements, snapshot);
	}
	return {moved: false, metric: currentMetric};
}

function refineByShrinkSeparate(sheet, placed, placements, config, sheetboundsForScoring, nestindex){
	var stats = createLocalRefinementStats(config && config.localRefinement === true);
	stats.engine = 'shrinkSeparate';
	stats.shrinkSteps = 0;
	stats.finalAlpha = null;
	stats.maxResidualDepth = 0;
	stats.attemptsFeasible = 0;
	stats.attemptsInfeasible = 0;
	stats.deadlineHits = 0;
	stats.feasibleNotImproved = 0;
	stats.exactRelocations = 0;
	stats.emptyRegionHits = 0;
	stats.relativeImprovement = 0;
	stats.epsilonScaleFeasible = 0;
	stats.legalityRejects = 0;

	if(!config || config.localRefinement !== true || !placed || placed.length < 2 || typeof SeparationUtil === 'undefined'){
		if(typeof SeparationUtil === 'undefined'){
			stats.reason = 'missingSeparationUtil';
		}
		return { moved: false, scoreState: null, stats: stats };
	}
	if(config.placementType !== 'gravity' && config.placementType !== 'box'){
		stats.reason = 'unsupportedPlacementType';
		return { moved: false, scoreState: null, stats: stats };
	}
	if(!localRefinementRectangleSheet(sheet)){
		stats.reason = 'unsupportedSheet';
		return { moved: false, scoreState: null, stats: stats };
	}

	var originalPlaced = localRefinementCopyPlaced(placed);
	var original = localRefinementCopyPlacements(placements);
	var best = localRefinementCopyPlacements(placements);
	var bestMetric = localRefinementMetric(sheet, placed, best, config);
	if(bestMetric === null){
		stats.reason = 'missingScore';
		return { moved: false, scoreState: null, stats: stats };
	}

	var budget = Math.max(100, parseInt(config.localRefinementBudgetMs, 10) || 1500);
	var deadline = Date.now() + budget;
	var seed = ((parseInt(nestindex, 10) || 0) * 104729 + 17) >>> 0;
	var rng = SeparationUtil.mulberry32(seed);
	var alpha = 0.005;
	var alphaMin = 0.0005;
	var alphaMax = 0.02;
	var successfulSteps = 0;
	stats.ran = true;
	stats.sheetsChecked = 1;
	stats.scoreBefore = bestMetric;

	while(Date.now() < deadline && alpha >= alphaMin){
		var axis = config.placementType === 'box' && successfulSteps % 2 === 1 ? 'y' : 'x';
		var realSheetBounds = GeometryUtil.getPolygonBounds(sheet);
		var virtual = localRefinementVirtualExtent(realSheetBounds, placed, best, alpha, axis);
		if(!virtual){
			alpha = alpha / 2;
			continue;
		}
		var candidate = localRefinementClampPlacements(placed, best, virtual);
		var ctx = localRefinementCreateSeparationContext(sheet, placed, candidate, config, deadline, rng, virtual);
		var result = localRefinementSeparateBySweep(ctx, config);
		stats.movesTested += result.itersUsed || 0;
		if(result.maxResidualDepth > stats.maxResidualDepth){
			stats.maxResidualDepth = result.maxResidualDepth;
		}
		stats.exactRelocations += result.exactRelocations || 0;
		stats.emptyRegionHits += result.emptyRegionHits || (result.emptyRegion ? 1 : 0);
		if(result.feasible){
			stats.attemptsFeasible++;
		}
		else{
			stats.attemptsInfeasible++;
			if(Date.now() >= deadline){
				stats.deadlineHits++;
			}
		}
		if(config.localRefinementDiagnostics === true){
			var residual = localRefinementMeasureSeparationResidual(ctx);
			localRefinementPushAttemptDiagnostic(stats, {
				alpha: alpha,
				axis: axis,
				virtualBoundary: virtual.virtualBoundary,
				feasible: !!result.feasible,
				itersUsed: result.itersUsed || 0,
				movesApplied: result.movesApplied || 0,
				maxResidualDepth: result.maxResidualDepth || 0,
				pairViolations: residual.pairViolations,
				sheetViolations: residual.sheetViolations,
				maxPairDepth: residual.maxPairDepth,
				maxSheetDepth: residual.maxSheetDepth,
				missingGeometry: residual.missingGeometry
			});
		}

		var candidateLegal = result.feasible ? localRefinementFinalLayoutLegal(sheet, placed, candidate, config) : false;
		if(result.feasible && !candidateLegal){
			stats.legalityRejects++;
		}
		var candidateMetric = result.feasible && candidateLegal ? localRefinementMetric(sheet, placed, candidate, config) : null;
		var relativeImprovement = result.feasible && candidateLegal && candidateMetric !== null && bestMetric > 0 ? (bestMetric - candidateMetric) / bestMetric : 0;
		if(result.feasible && candidateLegal && candidateMetric !== null && candidateMetric < bestMetric - 1e-12 && relativeImprovement >= 1e-6){
			best = localRefinementCopyPlacements(candidate);
			bestMetric = candidateMetric;
			stats.movesAccepted += Math.max(1, result.movesApplied || 0);
			stats.shrinkSteps++;
			stats.relativeImprovement = stats.scoreBefore > 0 ? (stats.scoreBefore - bestMetric) / stats.scoreBefore : 0;
			successfulSteps++;
			alpha = Math.min(alpha * 1.5, alphaMax);
		}
		else{
			if(result.feasible && candidateLegal){
				if(candidateMetric !== null && candidateMetric < bestMetric && relativeImprovement < 1e-6){
					stats.epsilonScaleFeasible++;
				}
				else{
					stats.feasibleNotImproved++;
				}
			}
			alpha = alpha / 2;
		}
	}

	stats.finalAlpha = alpha;
	stats.scoreAfter = bestMetric;

	localRefinementRestorePlacements(placements, best);
	var moved = localRefinementPlacementsMoved(original, placements) || localRefinementPlacedMoved(originalPlaced, placed);
	if(moved && !localRefinementFinalLayoutLegal(sheet, placed, placements, config)){
		localRefinementRestorePlaced(placed, originalPlaced);
		localRefinementRestorePlacements(placements, original);
		stats.reason = 'legalityRevert';
		stats.scoreAfter = stats.scoreBefore;
		moved = false;
	}

	var scoreState = localRefinementScore(sheet, placed, placements, config, sheetboundsForScoring);
	return {
		moved: moved,
		scoreState: scoreState,
		stats: stats
	};
}

function refineSmartPlacements(sheet, placed, placements, config, sheetboundsForScoring, nestindex){
	var stats = createLocalRefinementStats(config && config.localRefinement === true);
	stats.engine = 'smart';
	stats.emptyRegionHits = 0;
	stats.deadlineHits = 0;
	stats.relativeImprovement = 0;
	stats.passes = 0;
	stats.legalityRejects = 0;
	stats.floatersDetected = 0;
	stats.floatersRelocated = 0;
	stats.settleRegionComputations = 0;
	stats.settleEmptyRegions = 0;
	stats.rotationsTried = 0;
	stats.rotationReflowAttempts = 0;
	stats.rotationReflowRegionComputations = 0;
	stats.rotationReflowEmptyRegions = 0;
	stats.rotationReflowLegalCandidates = 0;
	stats.rotationReflowLegalLayouts = 0;
	stats.rotationReflowPartsMoved = 0;
	stats.rotationReflowRotationsAccepted = 0;
	localRefinementEnsureSmartStats(stats);

	if(!config || config.localRefinement !== true || !placed || placed.length < 2 || typeof SeparationUtil === 'undefined'){
		if(typeof SeparationUtil === 'undefined'){
			stats.reason = 'missingSeparationUtil';
		}
		return { moved: false, scoreState: null, stats: stats };
	}
	if(config.placementType !== 'gravity' && config.placementType !== 'box' && config.placementType !== 'convexhull'){
		stats.reason = 'unsupportedPlacementType';
		return { moved: false, scoreState: null, stats: stats };
	}

	var originalPlaced = localRefinementCopyPlaced(placed);
	var original = localRefinementCopyPlacements(placements);
	var pureMetricBefore = localRefinementMetric(sheet, placed, placements, config);
	var currentMetric = localRefinementSmartMetric(sheet, placed, placements, config);
	if(currentMetric === null || pureMetricBefore === null){
		stats.reason = 'missingScore';
		return { moved: false, scoreState: null, stats: stats };
	}

	var budget = Math.max(100, parseInt(config.localRefinementBudgetMs, 10) || 3000);
	var deadline = Date.now() + budget;
	var settleMaxFloaters = Math.max(1, parseInt(config.settleMaxFloaters, 10) || 8);
	stats.ran = true;
	stats.sheetsChecked = 1;
	stats.scoreBefore = pureMetricBefore;

	for(var pass=0; pass<3 && Date.now() < deadline; pass++){
		stats.passes++;
		var madeProgress = false;
		var detection = localRefinementDetectFloaters(placed, placements, config);
		if(pass === 0){
			stats.floatersDetected = detection.floaters.length;
		}
		if(detection.floaters.length > 0 && Date.now() < deadline){
			var settled = localRefinementSettleFloaterGroup(sheet, placed, placements, config, detection, currentMetric, deadline, stats);
			if(settled.moved){
				currentMetric = settled.metric;
				madeProgress = true;
			}
			else if(pass === 0 && Date.now() < deadline){
				// Floater-only recreation could not improve: the kept "cluster"
				// is itself spread out and pins the metric. Escalate once to a
				// full rebuild around a single seed part.
				var rebuildDetection = localRefinementFullRebuildDetection(sheet, placed, placements, config);
				var rebuilt = localRefinementSettleFloaterGroup(sheet, placed, placements, config, rebuildDetection, currentMetric, deadline, stats);
				if(rebuilt.moved){
					currentMetric = rebuilt.metric;
					madeProgress = true;
				}
			}
		}

		var order = localRefinementSmartTargetOrder(placed, placements, config);
		var targetLimit = Math.min(order.length, 6);
		for(var t=0; t<targetLimit && Date.now() < deadline; t++){
			var relocated = localRefinementTryRelocate(sheet, placed, placements, config, order[t], currentMetric, deadline, stats, true);
			if(relocated.moved){
				currentMetric = relocated.metric;
				madeProgress = true;
			}
		}

		order = localRefinementSmartTargetOrder(placed, placements, config);
		targetLimit = Math.min(order.length, 4);
		for(t=0; t<targetLimit && Date.now() < deadline; t++){
			var swapped = localRefinementTrySwap(sheet, placed, placements, config, order[t], currentMetric, deadline, stats);
			if(swapped.moved){
				currentMetric = swapped.metric;
				madeProgress = true;
			}
		}

		if(!madeProgress){
			break;
		}
	}

	var rotationReflowed = localRefinementRunRotationReflowStage(sheet, placed, placements, config, currentMetric, deadline, stats);
	if(rotationReflowed.moved){
		currentMetric = rotationReflowed.metric;
	}

	var fineRotated = localRefinementRunFineRotationStage(sheet, placed, placements, config, currentMetric, deadline, stats);
	if(fineRotated.moved){
		currentMetric = fineRotated.metric;
	}

	if(Date.now() >= deadline){
		stats.deadlineHits++;
	}
	// Stats report the PURE mode metric (acceptance uses the composite); the
	// substantive gate measures real hull/extent improvement, not spread.
	var pureMetricAfter = localRefinementMetric(sheet, placed, placements, config);
	stats.scoreAfter = pureMetricAfter !== null ? pureMetricAfter : currentMetric;
	stats.relativeImprovement = stats.scoreBefore > 0 ? (stats.scoreBefore - stats.scoreAfter) / stats.scoreBefore : 0;

	var moved = localRefinementPlacementsMoved(original, placements) || localRefinementPlacedMoved(originalPlaced, placed);
	if(moved && !localRefinementFinalLayoutLegalForRotations(sheet, placed, placements, config)){
		localRefinementRestorePlaced(placed, originalPlaced);
		localRefinementRestorePlacements(placements, original);
		stats.reason = 'legalityRevert';
		stats.scoreAfter = stats.scoreBefore;
		stats.relativeImprovement = 0;
		moved = false;
	}

	var scoreState = localRefinementScore(sheet, placed, placements, config, sheetboundsForScoring);
	return {
		moved: moved,
		scoreState: scoreState,
		stats: stats
	};
}

function refineUnsupportedLocalRefinementEngine(config, engine){
	var stats = createLocalRefinementStats(config && config.localRefinement === true);
	stats.engine = engine || 'unknown';
	stats.reason = 'engineNotImplemented';
	return { moved: false, scoreState: null, stats: stats };
}

function createLocalRefinementStats(enabled){
	return {
		enabled: !!enabled,
		ran: false,
		sheetsChecked: 0,
		movesTested: 0,
		movesAccepted: 0,
		nonCanonicalNfpLookups: 0,
		fineRotateCandidates: 0,
		fineRotateSlideCandidates: 0,
		fineRotateLegalCandidates: 0,
		fineRotateExactChecks: 0,
		fineRotateExactMs: 0,
		fineRotateNeutralAccepted: 0,
		fineRotateNearNeutralAccepted: 0,
		fineRotateSlideAccepted: 0,
		fineRotateSkippedHoles: 0,
		fineRotateSkippedBudget: 0,
		fineRotateSkippedMergeLines: 0,
		fineRotateMaxDeltaDeg: 0,
		scoreBefore: null,
		scoreAfter: null
	};
}

function mergeLocalRefinementStats(total, stats){
	if(!total || !stats){
		return total;
	}
	total.enabled = total.enabled || stats.enabled;
	total.ran = total.ran || stats.ran;
	total.sheetsChecked += stats.sheetsChecked || 0;
	total.movesTested += stats.movesTested || 0;
	total.movesAccepted += stats.movesAccepted || 0;
	if(total.scoreBefore === null && stats.scoreBefore !== null && typeof stats.scoreBefore !== 'undefined'){
		total.scoreBefore = stats.scoreBefore;
	}
	if(stats.scoreAfter !== null && typeof stats.scoreAfter !== 'undefined'){
		total.scoreAfter = stats.scoreAfter;
	}
	if(stats.engine){
		total.engine = stats.engine;
	}
	if(stats.reason && !total.reason){
		total.reason = stats.reason;
	}
	if(stats.attemptDiagnostics && stats.attemptDiagnostics.length > 0){
		if(!total.attemptDiagnostics){
			total.attemptDiagnostics = [];
		}
		for(var d=0; d<stats.attemptDiagnostics.length && total.attemptDiagnostics.length < 12; d++){
			total.attemptDiagnostics.push(stats.attemptDiagnostics[d]);
		}
	}
	if(stats.operatorStats){
		if(!total.operatorStats){
			total.operatorStats = {};
		}
		for(var operatorName in stats.operatorStats){
			if(!stats.operatorStats.hasOwnProperty(operatorName)){
				continue;
			}
			if(!total.operatorStats[operatorName]){
				total.operatorStats[operatorName] = {};
			}
			for(var opField in stats.operatorStats[operatorName]){
				if(stats.operatorStats[operatorName].hasOwnProperty(opField) && typeof stats.operatorStats[operatorName][opField] === 'number'){
					total.operatorStats[operatorName][opField] = (total.operatorStats[operatorName][opField] || 0) + stats.operatorStats[operatorName][opField];
				}
			}
		}
	}
	var additiveStats = ['shrinkSteps', 'attemptsFeasible', 'attemptsInfeasible', 'deadlineHits', 'feasibleNotImproved', 'exactRelocations', 'emptyRegionHits', 'epsilonScaleFeasible', 'legalityRejects', 'passes', 'floatersDetected', 'floatersRelocated', 'settleRegionComputations', 'settleEmptyRegions', 'rotationsTried', 'settleLegalCandidates', 'rotationReflowAttempts', 'rotationReflowRegionComputations', 'rotationReflowEmptyRegions', 'rotationReflowLegalCandidates', 'rotationReflowLegalLayouts', 'rotationReflowPartsMoved', 'rotationReflowRotationsAccepted', 'rotationReflowSkippedBudget', 'nonCanonicalNfpLookups', 'fineRotateCandidates', 'fineRotateSlideCandidates', 'fineRotateLegalCandidates', 'fineRotateExactChecks', 'fineRotateExactMs', 'fineRotateNeutralAccepted', 'fineRotateNearNeutralAccepted', 'fineRotateSlideAccepted', 'fineRotateSkippedHoles', 'fineRotateSkippedBudget', 'fineRotateSkippedMergeLines'];
	if(typeof stats.settleBestDelta === 'number' && (typeof total.settleBestDelta !== 'number' || stats.settleBestDelta < total.settleBestDelta)){
		total.settleBestDelta = stats.settleBestDelta;
	}
	if(stats.settleDebug && !total.settleDebug){
		total.settleDebug = stats.settleDebug;
	}
	for(var i=0; i<additiveStats.length; i++){
		var field = additiveStats[i];
		if(typeof stats[field] === 'number'){
			total[field] = (total[field] || 0) + stats[field];
		}
	}
	if(typeof stats.relativeImprovement === 'number'){
		total.relativeImprovement = Math.max(total.relativeImprovement || 0, stats.relativeImprovement);
	}
	if(typeof stats.maxResidualDepth === 'number'){
		total.maxResidualDepth = Math.max(total.maxResidualDepth || 0, stats.maxResidualDepth);
	}
	if(typeof stats.fineRotateMaxDeltaDeg === 'number'){
		total.fineRotateMaxDeltaDeg = Math.max(total.fineRotateMaxDeltaDeg || 0, stats.fineRotateMaxDeltaDeg);
	}
	if(typeof stats.finalAlpha !== 'undefined' && stats.finalAlpha !== null){
		total.finalAlpha = stats.finalAlpha;
	}
	return total;
}

function recomputeSheetMergedData(placed, placements, config){
	for(var i=0; i<placements.length; i++){
		delete placements[i].mergedLength;
		delete placements[i].mergedSegments;
	}
	if(!config.mergeLines){
		return 0;
	}

	var total = 0;
	var minlength = 0.5 * config.scale;
	var tolerance = 0.1 * config.curveTolerance;
	for(i=1; i<placed.length; i++){
		var shiftedpart = shiftPolygon(placed[i], placements[i]);
		var shiftedplaced = [];
		for(var j=0; j<i; j++){
			shiftedplaced.push(shiftPolygon(placed[j], placements[j]));
		}
		var merged = mergedLength(shiftedplaced, shiftedpart, minlength, tolerance);
		if(merged && merged.totalLength){
			placements[i].mergedLength = merged.totalLength;
			placements[i].mergedSegments = merged.segments;
			total += merged.totalLength;
		}
	}
	return total;
}

function refineLocalPlacements(sheet, placed, placements, config, sheetboundsForScoring){
	var stats = createLocalRefinementStats(config && config.localRefinement === true);
	if(!config || config.localRefinement !== true || !placed || placed.length < 2){
		return { moved: false, scoreState: null, stats: stats };
	}

	var sheetBounds = GeometryUtil.getPolygonBounds(sheet);
	var maxSlideDistance = Math.sqrt(sheetBounds.width * sheetBounds.width + sheetBounds.height * sheetBounds.height);
	var directions = [
		{x: -1, y: 0},
		{x: 0, y: -1},
		{x: -1, y: -1},
		{x: 1, y: 0},
		{x: 0, y: 1},
		{x: 1, y: -1},
		{x: -1, y: 1},
		{x: 1, y: 1}
	];
	var maxPasses = Math.max(1, Math.min(parseInt(config.localRefinementPasses, 10) || 5, 5));
	var scoreState = localRefinementScore(sheet, placed, placements, config, sheetboundsForScoring);
	var currentScore = scoreState ? scoreState.score : null;
	stats.ran = true;
	stats.sheetsChecked = 1;
	stats.scoreBefore = currentScore;
	var moved = false;
	// Keep references to the pre-refinement placement objects so an illegal
	// refined layout can be reverted wholesale (preserving mergedSegments etc.).
	var preRefinementPlacements = placements.slice();

	for(var pass=0; pass<maxPasses; pass++){
		var passMoved = false;
		for(var i=placed.length-1; i>=0; i--){
			var part = placed[i];
			if(!part || part.length === 0){
				continue;
			}

			var sheetNfp = getInnerNfp(sheet, part, config);
			if(!sheetNfp || sheetNfp.length === 0){
				continue;
			}

			var forbiddenNfps = localRefinementForbiddenNfps(part, i, placed, placements, config);
			if(!forbiddenNfps){
				continue;
			}

			var original = placements[i];
			var best = original;
			var bestScore = currentScore;

			for(var d=0; d<directions.length; d++){
				var slideDistance = localRefinementMaxLegalSlide(part, original, directions[d], maxSlideDistance, sheetNfp, forbiddenNfps);
				if(!isFinite(slideDistance) || slideDistance <= Math.max(1e-7, config.curveTolerance * 0.01)){
					continue;
				}
				var unit = localRefinementNormalizeDirection(directions[d]);
				if(!unit){
					continue;
				}
				var candidate = localRefinementCandidateAt(original, unit, slideDistance);
				stats.movesTested++;

				placements[i] = candidate;
				var candidateScoreState = localRefinementScore(sheet, placed, placements, config, sheetboundsForScoring);
				placements[i] = original;

				if(candidateScoreState && localRefinementImproves(candidateScoreState.score, bestScore)){
					best = candidate;
					bestScore = candidateScoreState.score;
				}
			}

			if(best !== original){
				placements[i] = best;
				currentScore = bestScore;
				stats.movesAccepted++;
				passMoved = true;
				moved = true;
			}
			else{
				placements[i] = original;
			}
		}

		if(!passMoved){
			break;
		}
	}

	// Same final gate the smart/shrinkSeparate engines use: the per-move point
	// tests validate each slide against pairwise NFPs, but a wrong or missing
	// NFP would let a slide land on top of another part. Verify the assembled
	// layout with the NFP-independent material-overlap check and revert to the
	// pre-refinement placements if it fails, rather than ship an overlap.
	if(moved && !localRefinementFinalLayoutLegal(sheet, placed, placements, config)){
		console.log('slide refinement produced an illegal layout; reverting', stats.movesAccepted, 'moves');
		for(var r=0; r<preRefinementPlacements.length; r++){
			placements[r] = preRefinementPlacements[r];
		}
		moved = false;
		stats.movesAccepted = 0;
		stats.revertedIllegal = true;
	}

	scoreState = localRefinementScore(sheet, placed, placements, config, sheetboundsForScoring);
	stats.scoreAfter = scoreState ? scoreState.score : currentScore;

	return {
		moved: moved,
		scoreState: scoreState,
		stats: stats
	};
}

function rotatePolygon(polygon, degrees){
	var rotated = [];
	var angle = degrees * Math.PI / 180;
	for(var i=0; i<polygon.length; i++){
		var x = polygon[i].x;
		var y = polygon[i].y;
		var x1 = x*Math.cos(angle)-y*Math.sin(angle);
		var y1 = x*Math.sin(angle)+y*Math.cos(angle);
						
		rotated.push({x:x1, y:y1, exact: polygon[i].exact});
	}
	
	if(polygon.children && polygon.children.length > 0){
		rotated.children = [];
		for(var j=0; j<polygon.children.length; j++){
			rotated.children.push(rotatePolygon(polygon.children[j], degrees));
		}
	}
	
	return rotated;
};

function normalizedRotation(degrees){
	var rotation = Number(degrees) || 0;
	rotation = rotation % 360;
	if(rotation < 0){
		rotation += 360;
	}
	return rotation;
}

function rotationRetryCount(config){
	var count = config && parseInt(config.rotations, 10);
	if(!count || count < 1){
		return 1;
	}
	return count;
}

function rotationRetryStep(config){
	return 360/rotationRetryCount(config);
}

function rotationRetryAngle(baseRotation, config, attemptIndex){
	return normalizedRotation((Number(baseRotation) || 0) + rotationRetryStep(config)*attemptIndex);
}

function localRefinementRotationOnCanonicalGrid(rotation, config, part){
	if(config && config.adaptiveRotations === true && config.adaptiveRotationAnglesBySource && part && typeof part.source !== 'undefined'){
		var allowed = config.adaptiveRotationAnglesBySource[String(part.source)];
		if(allowed && allowed.length){
			for(var i=0; i<allowed.length; i++){
				var adaptiveDelta = Math.abs(normalizedRotation((Number(rotation) || 0) - allowed[i]));
				if(adaptiveDelta > 180){
					adaptiveDelta = 360 - adaptiveDelta;
				}
				if(adaptiveDelta <= 1e-6){
					return true;
				}
			}
			return false;
		}
	}
	var step = rotationRetryStep(config);
	if(!isFinite(step) || step <= 0){
		return true;
	}
	var normalized = normalizedRotation(rotation || 0);
	var nearest = Math.round(normalized / step) * step;
	var delta = Math.abs(normalizedRotation(normalized - nearest));
	if(delta > 180){
		delta = 360 - delta;
	}
	return delta <= 1e-6;
}

function localRefinementRecordNonCanonicalNfpLookup(A, B, config, kind){
	var badA = A && !localRefinementRotationOnCanonicalGrid(A.rotation || 0, config, A);
	var badB = B && !localRefinementRotationOnCanonicalGrid(B.rotation || 0, config, B);
	if(!badA && !badB){
		return false;
	}
	nonCanonicalNfpLookups++;
	if(config && config.localRefinementDebugNonCanonicalNfp === true && typeof console !== 'undefined' && console.warn){
		console.warn('non-canonical NFP lookup blocked', {
			kind: kind || 'unknown',
			Arotation: A ? A.rotation : null,
			Brotation: B ? B.rotation : null,
			rotations: config ? config.rotations : null
		});
	}
	return true;
}

function rotationRetryAngles(part, config){
	var angles = [];
	var base = normalizedRotation(part && part.rotation || 0);
	angles.push(base);

	if(config && config.adaptiveRotations === true && config.adaptiveRotationAnglesBySource && part && typeof part.source !== 'undefined'){
		var allowed = config.adaptiveRotationAnglesBySource[String(part.source)];
		if(allowed && allowed.length){
			for(var i=0; i<allowed.length; i++){
				var candidate = normalizedRotation(allowed[i]);
				var seen = false;
				for(var a=0; a<angles.length; a++){
					if(Math.abs(normalizedRotation(angles[a] - candidate)) <= 1e-6 || Math.abs(normalizedRotation(candidate - angles[a])) <= 1e-6){
						seen = true;
						break;
					}
				}
				if(!seen){
					angles.push(candidate);
				}
			}
			return angles;
		}
	}

	for(var j=1; j<rotationRetryCount(config); j++){
		angles.push(rotationRetryAngle(base, config, j));
	}
	return angles;
}

function localRefinementNonCanonicalNfpLookupCount(){
	return nonCanonicalNfpLookups;
}

function localRefinementNonCanonicalNfpLookupDelta(start){
	var baseline = typeof start === 'number' ? start : 0;
	return Math.max(0, nonCanonicalNfpLookups - baseline);
}

function candidatePlacementIsBetter(currentScore, currentX, currentY, candidateScore, candidateX, candidateY){
	if(currentScore === null){
		return true;
	}
	if(candidateScore < currentScore && !GeometryUtil.almostEqual(candidateScore, currentScore)){
		return true;
	}
	if(GeometryUtil.almostEqual(currentScore, candidateScore)){
		return currentX === null || candidateX < currentX || (GeometryUtil.almostEqual(candidateX, currentX) && candidateY < currentY);
	}
	return false;
}

function normalizeMergeCandidateCap(config){
	var cap = config ? parseInt(config.mergeCandidateCap, 10) : 0;
	return cap > 0 ? cap : 0;
}

function mergeCandidateCompare(a, b){
	if(!b){
		return -1;
	}
	if(a.baseScore < b.baseScore){
		return -1;
	}
	if(a.baseScore > b.baseScore){
		return 1;
	}
	if(a.x < b.x){
		return -1;
	}
	if(a.x > b.x){
		return 1;
	}
	if(a.y < b.y){
		return -1;
	}
	if(a.y > b.y){
		return 1;
	}
	return a.ordinal - b.ordinal;
}

function recordMergeCandidate(candidates, cap, candidate){
	if(cap <= 0){
		return;
	}
	if(candidates.length < cap){
		candidates.push(candidate);
		return;
	}
	var worstIndex = 0;
	for(var i=1; i<candidates.length; i++){
		if(mergeCandidateCompare(candidates[i], candidates[worstIndex]) > 0){
			worstIndex = i;
		}
	}
	if(mergeCandidateCompare(candidate, candidates[worstIndex]) < 0){
		candidates[worstIndex] = candidate;
	}
}

function buildTreeFromOuterNfpList(nfpList, A){
	if(!nfpList || nfpList.length == 0){
		return null;
	}

	for(var i=0; i<nfpList.length; i++){
		if(Math.abs(GeometryUtil.polygonArea(nfpList[i])) < Math.abs(GeometryUtil.polygonArea(A))){
			return null;
		}
	}

	var outer = nfpList[0];
	if(GeometryUtil.polygonArea(outer) > 0){
		outer.reverse();
	}

	for(i=1; i<nfpList.length; i++){
		if(!nfpList[i] || nfpList[i].length == 0){
			continue;
		}

		if(GeometryUtil.polygonArea(nfpList[i]) > 0){
			nfpList[i].reverse();
		}

		if(GeometryUtil.pointInPolygon(nfpList[i][0], outer)){
			if(GeometryUtil.polygonArea(nfpList[i]) < 0){
				nfpList[i].reverse();
			}
			if(!outer.children){
				outer.children = [];
			}
			outer.children.push(nfpList[i]);
		}
	}

	return outer;
}

function getOuterNfpWithGeometryUtil(A, B){
	var nfpList = GeometryUtil.noFitPolygon(A, B, false, false);
	if(!nfpList || nfpList.length == 0){
		return null;
	}

	var outer = buildTreeFromOuterNfpList(nfpList, A);
	if(!outer){
		return null;
	}

	if(A.children && A.children.length > 0){
		var Bbounds = GeometryUtil.getPolygonBounds(B);
		for(var i=0; i<A.children.length; i++){
			var Abounds = GeometryUtil.getPolygonBounds(A.children[i]);

			if(Abounds.width > Bbounds.width && Abounds.height > Bbounds.height){
				var childNfp = GeometryUtil.noFitPolygon(A.children[i], B, true, false);
				if(childNfp && childNfp.length > 0){
					if(!outer.children){
						outer.children = [];
					}

					for(var j=0; j<childNfp.length; j++){
						if(GeometryUtil.polygonArea(childNfp[j]) < 0){
							childNfp[j].reverse();
						}
						outer.children.push(childNfp[j]);
					}
				}
			}
		}
	}

	return outer;
}

function buildClipperNfpFromMinkowskiSolution(solution, B, scale){
	if(!solution || solution.length == 0){
		return null;
	}

	var clipperNfp = null;
	var largestArea = null;
	for(var i=0; i<solution.length; i++){
		var n = toNestCoordinates(solution[i], scale);
		var sarea = -GeometryUtil.polygonArea(n);
		if(largestArea === null || largestArea < sarea){
			clipperNfp = n;
			largestArea = sarea;
		}
	}

	if(!clipperNfp || clipperNfp.length == 0){
		return null;
	}

	for(i=0; i<clipperNfp.length; i++){
		clipperNfp[i].x += B[0].x;
		clipperNfp[i].y += B[0].y;
	}

	return clipperNfp;
}

function getSheetHoleForbiddenNfps(A, B){
	var holes = [];
	if(!A.children || A.children.length == 0){
		return holes;
	}

	for(var i=0; i<A.children.length; i++){
		var holeNfp = GeometryUtil.noFitPolygon(A.children[i], B, false, false);
		if(!holeNfp || holeNfp.length == 0){
			return null;
		}

		var forbidden = buildTreeFromOuterNfpList(holeNfp, A.children[i]);
		if(!forbidden){
			return null;
		}
		holes.push(forbidden);
	}

	return holes;
}

function getInnerNfpWithGeometryUtil(A, B, config){
	var nfp;
	if(GeometryUtil.isRectangle(A, 0.001)){
		nfp = GeometryUtil.noFitPolygonRectangle(A, B);
	}
	else{
		nfp = GeometryUtil.noFitPolygon(A, B, true, false);
		}

	if(!nfp || nfp.length == 0){
		return null;
	}

	for(var i=0; i<nfp.length; i++){
		if(GeometryUtil.polygonArea(nfp[i]) > 0){
			nfp[i].reverse();
		}
	}

	var holes = getSheetHoleForbiddenNfps(A, B);
	if(holes === null){
		return null;
	}

	if(holes.length == 0){
		return nfp;
	}

	var clipperNfp = innerNfpToClipperCoordinates(nfp, config);
	var clipperHoles = innerNfpToClipperCoordinates(holes, config);

	var finalNfp = new ClipperLib.Paths();
	var clipper = new ClipperLib.Clipper();

	clipper.AddPaths(clipperHoles, ClipperLib.PolyType.ptClip, true);
	clipper.AddPaths(clipperNfp, ClipperLib.PolyType.ptSubject, true);

	if(!clipper.Execute(ClipperLib.ClipType.ctDifference, finalNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
		return null;
	}

	if(finalNfp.length == 0){
		return null;
	}

	var converted = [];
	for(i=0; i<finalNfp.length; i++){
		converted.push(toNestCoordinates(finalNfp[i], config.clipperScale));
	}

	return converted;
}

// Outer NFP call path. Ordering by preference:
//   1. Disk/in-memory NFP cache (window.db).
//   2. Native Boost Polygon addon via `minkowski-calculate-nfp-sync` IPC.
//      Handles holes natively when `processHoles` is true.
//   3. JS GeometryUtil orbit-slider (only when processHoles=true AND A has
//      children). The native addon already covers this case; the fallback
//      exists for when the addon is missing or returns no result.
//   4. JS ClipperLib MinkowskiSum on a hole-free A. Final fallback.
function getOuterNfp(A, B, inside, config){
	var nfp;
	var processHoles = !config || config.processHoles !== false;

	if(localRefinementRecordNonCanonicalNfpLookup(A, B, config, inside ? 'outer-inside' : 'outer')){
		return null;
	}

	// try the file cache if the calculation will take a long time
	var doc = window.db.find(buildOuterNfpCacheDoc(A, B, processHoles));

	if(doc){
		return doc;
	}

	// not found in cache
	if(inside){
		nfp = GeometryUtil.noFitPolygon(A, B, true, false);
		if(!nfp || nfp.length == 0){
			return null;
		}
		nfp = nfp[0];
	}
	else{
		// Primary: native addon. Returns null on unavailability or a thrown
		// error so control falls through to the JS paths below.
		nfp = tryNativeOuterNfp(A, B, processHoles);

		if(!nfp){
			if(processHoles && A.children && A.children.length > 0){
				nfp = getOuterNfpWithGeometryUtil(A, B);
			}
			else{
				// Treat A as hole-free (either it has no children, or the
				// user disabled processHoles). ClipperLib MinkowskiSum works
				// on the outer ring only.
				var Ac = toClipperCoordinates(A);
				ClipperLib.JS.ScaleUpPath(Ac, 10000000);
				var Bc = toClipperCoordinates(B);
				ClipperLib.JS.ScaleUpPath(Bc, 10000000);
				for(var i=0; i<Bc.length; i++){
					Bc[i].X *= -1;
					Bc[i].Y *= -1;
				}
				var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
				// Same normalization as the pair pre-pass: MinkowskiSum can emit
				// self-intersecting/fragmented rings for near-degenerate inputs at
				// this scale, and the largest-ring pick would return an NFP with a
				// missing forbidden region (overlapping placements).
				solution = ClipperLib.Clipper.SimplifyPolygons(solution, ClipperLib.PolyFillType.pftNonZero);
				var clipperNfp = buildClipperNfpFromMinkowskiSolution(solution, B, 10000000);
				if(!clipperNfp){
					return null;
				}

				nfp = [clipperNfp];
			}
		}
		}

	if(!nfp || nfp.length == 0){
		return null;
	}

	if(Array.isArray(nfp) && nfp.length > 0 && Array.isArray(nfp[0])){
		nfp = nfp.pop();
	}

	if(!nfp || nfp.length == 0){
		return null;
	}

	if(!inside && typeof A.source !== 'undefined' && typeof B.source !== 'undefined'){
		// insert into db
		doc = buildOuterNfpCacheDoc(A, B, processHoles, nfp);
		window.db.insert(doc);
	}

	return nfp;
}

// Invoke the native Boost Polygon addon through the main-process IPC handler.
// Returns the array-of-polygons response the addon produces (reduced to the
// largest-area polygon wrapped in a singleton array, matching the ClipperLib
// branch's shape so the common `nfp.pop()` extraction still works), or null
// if anything fails. Callers must handle null by falling back to JS paths.
function tryNativeOuterNfp(A, B, processHoles){
	if(!window.ipcRenderer){
		return null;
	}

	// Rebuild the payload explicitly so the IPC structured-clone round-trip
	// never drops A.children. Electron's v8 ValueSerializer preserves own
	// string-keyed properties on arrays, but being explicit here also makes
	// the processHoles=false contract obvious at the call site.
	var payloadA = A.slice();
	if(processHoles && A.children && A.children.length > 0){
		var kids = [];
		for(var i=0; i<A.children.length; i++){
			kids.push(A.children[i].slice());
		}
		payloadA.children = kids;
	}
	else{
		payloadA.children = [];
	}
	var payloadB = B.slice();

	var result;
	try{
		result = calculateNativeAddonNfp(window.ipcRenderer, payloadA, payloadB);
	}
	catch(err){
		// Addon unavailable, build missing, or addon threw. Fall back silently.
		return null;
	}

	if(!result || !Array.isArray(result) || result.length === 0){
		return null;
	}

	// The addon can return several disjoint polygons; pick the largest-area
	// one (same heuristic as the ClipperLib branch). Wrap in [poly] so the
	// common `nfp.pop()` path in getOuterNfp extracts it unchanged.
	var best = null;
	var bestArea = null;
	for(var j=0; j<result.length; j++){
		var poly = result[j];
		if(!poly || poly.length === 0){
			continue;
		}
		var area = Math.abs(GeometryUtil.polygonArea(poly));
		if(bestArea === null || area > bestArea){
			best = poly;
			bestArea = area;
		}
	}

	if(!best){
		return null;
	}

	return [best];
}

function getFrame(A){
	var bounds = GeometryUtil.getPolygonBounds(A);
	
	// expand bounds by 10%
	bounds.width *= 1.1; 
	bounds.height *= 1.1;
	bounds.x -= 0.5*(bounds.width - (bounds.width/1.1));
	bounds.y -= 0.5*(bounds.height - (bounds.height/1.1));
	
	var frame = [];
	frame.push({ x: bounds.x, y: bounds.y });
	frame.push({ x: bounds.x+bounds.width, y: bounds.y });
	frame.push({ x: bounds.x+bounds.width, y: bounds.y+bounds.height });
	frame.push({ x: bounds.x, y: bounds.y+bounds.height });
	
	frame.children = [A];
	frame.source = A.source;
	frame.rotation = 0;
	
	return frame;
}

function getInnerNfp(A, B, config){
	if(localRefinementRecordNonCanonicalNfpLookup(A, B, config, 'inner')){
		return null;
	}

	if(typeof A.source !== 'undefined' && typeof B.source !== 'undefined'){
		var doc = window.db.find(buildInnerNfpCacheDoc(A, B), true);
	
		if(doc){
			//console.log('fetch inner', A.source, B.source, doc);
			return doc;
		}
	}

	var f = getInnerNfpWithGeometryUtil(A, B, config);
	if(!f || f.length == 0){
		return null;
	}
	
	if(typeof A.source !== 'undefined' && typeof B.source !== 'undefined'){
		// insert into db
		var doc = buildInnerNfpCacheDoc(A, B, f);
		window.db.insert(doc, true);
	}
	
	return f;
}

function placeParts(sheets, parts, config, nestindex){

	if(!sheets){
		return null;
	}
	
	var i, j, k, m, n, part;
	
	var totalnum = parts.length;
	var totalsheetarea = 0;
	var placementMs = 0;
	var placementIterations = 0;
	
	// total length of merged lines
	var totalMerged = 0;
	var localRefinement = createLocalRefinementStats(config && config.localRefinement === true);
	var nonCanonicalNfpLookupStart = localRefinementNonCanonicalNfpLookupCount();
	var runLocalRefinement = config && config.localRefinement === true && config.localRefinementPostProcess === true;
	var fitnessVersion = getFitnessVersion(config);
	var useFitnessV2 = fitnessVersion === 2;
	var fitnessBreakdown = useFitnessV2 ? {
		version: 2,
		sheets: 0,
		sheetMetrics: [],
		unplacedPenalty: 0
	} : null;
		
	// rotate paths by given rotation
	var rotated = [];
	for(i=0; i<parts.length; i++){
		var r = rotatePolygon(parts[i], parts[i].rotation);
		r.rotation = parts[i].rotation;
		r.source = parts[i].source;
		r.id = parts[i].id;
		
		rotated.push(r);
	}
	
	parts = rotated;
	
	var allplacements = [];
	var fitness = 0;
	//var binarea = Math.abs(GeometryUtil.polygonArea(self.binPolygon));
	
	var key, nfp;
	var part;
	
	while(parts.length > 0){
		
		var placed = [];
		var placements = [];
		var sheetMergedBase = totalMerged;
		var minwidth = null;
		var minarea = null;
		
		// open a new sheet
		var sheet = sheets.shift();
		var sheetarea = Math.abs(GeometryUtil.polygonArea(sheet));
		var sheetboundsForScoring = config.improvedPlacementScoring === true ? GeometryUtil.getPolygonBounds(sheet) : null;
		var sheetHull = config.placementType == 'gravity' || config.placementType == 'box' ? null : getHull(sheet);
		totalsheetarea += sheetarea;
		
		if(!useFitnessV2){
			fitness += sheetarea; // add 1 for each new sheet opened (lower fitness is better)
		}
		
		var clipCache = [];
		//console.log('new sheet');
		for(i=0; i<parts.length; i++){
			var placementStartedAt = Date.now();
			try{
				part = parts[i];
			
			// inner NFP
			var sheetNfp = null;
			var originalPart = part;
			var retryAngles = rotationRetryAngles(part, config);
			var retryCount = retryAngles.length;
			// Try every configured orientation before treating this part as unplaceable on the current sheet.
			for(j=0; j<retryCount; j++){
				sheetNfp = getInnerNfp(sheet, part, config);
				
				if(sheetNfp){
					break;
				}

				if(j+1 >= retryCount){
					break;
				}
				
				var targetRotation = retryAngles[j+1];
				var rotationDelta = normalizedRotation(targetRotation - (originalPart.rotation || 0));
				var r = rotatePolygon(originalPart, rotationDelta);
				r.rotation = targetRotation;
				r.source = part.source;
				r.id = part.id;
				
				// rotation is not in-place
				part = r;
				parts[i] = r;
			}
			// part unplaceable, skip
			if(!sheetNfp || sheetNfp.length == 0){
				parts[i] = originalPart;
				continue;
			}
						
			var position = null;
			
			if(placed.length == 0){
				// first placement, put it on the top left corner
				for(j=0; j<sheetNfp.length; j++){
					for(k=0; k<sheetNfp[j].length; k++){
						if(position === null || sheetNfp[j][k].x-part[0].x < position.x || (GeometryUtil.almostEqual(sheetNfp[j][k].x-part[0].x, position.x) && sheetNfp[j][k].y-part[0].y < position.y ) ){
							position = {
								x: sheetNfp[j][k].x-part[0].x,
								y: sheetNfp[j][k].y-part[0].y,
								id: part.id,
								rotation: part.rotation,
								source: part.source
							}
						}
					}
				}
				if(position === null){
					console.log(sheetNfp);
					continue;
				}
				placements.push(position);
				placed.push(part);
				
				continue;
			}
			
			var clipperSheetNfp = innerNfpToClipperCoordinates(sheetNfp, config);
			
			var clipper = new ClipperLib.Clipper();
			var combinedNfp = new ClipperLib.Paths();
			
			var error = false;
			
			// check if stored in clip cache
			//var startindex = 0;
			var clipkey = 's:'+part.source+'r:'+part.rotation;
			var startindex = 0;
			if(clipCache[clipkey]){
				var prevNfp = clipCache[clipkey].nfp;
				clipper.AddPaths(prevNfp, ClipperLib.PolyType.ptSubject, true);
				startindex = clipCache[clipkey].index;
			}
			
			for(j=startindex; j<placed.length; j++){
				nfp = getOuterNfp(placed[j], part, false, config);
				// minkowski difference failed. very rare but could happen
				if(!nfp){
					error = true;
					break;
				}
				// shift to placed location
				for(m=0; m<nfp.length; m++){
					nfp[m].x += placements[j].x;
					nfp[m].y += placements[j].y;
				}
				
				if(nfp.children && nfp.children.length > 0){
					for(n=0; n<nfp.children.length; n++){
						for(var o=0; o<nfp.children[n].length; o++){
							nfp.children[n][o].x += placements[j].x;
							nfp.children[n][o].y += placements[j].y;
						}
					}
				}
				
				var clipperNfp = nfpToClipperCoordinates(nfp, config);
				
				clipper.AddPaths(clipperNfp, ClipperLib.PolyType.ptSubject, true);
			}
			
			if(error || !clipper.Execute(ClipperLib.ClipType.ctUnion, combinedNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
				console.log('clipper error', error);
				continue;
			}
			
			/*var converted = [];
			for(j=0; j<combinedNfp.length; j++){
				converted.push(toNestCoordinates(combinedNfp[j], config.clipperScale));
			}*/
			
			clipCache[clipkey] = {
				nfp: combinedNfp,
				index: placed.length
			};
			
			// difference with sheet polygon
			var finalNfp = new ClipperLib.Paths();
			clipper = new ClipperLib.Clipper();
			
			clipper.AddPaths(combinedNfp, ClipperLib.PolyType.ptClip, true);
			
			clipper.AddPaths(clipperSheetNfp, ClipperLib.PolyType.ptSubject, true);
			
			if(!clipper.Execute(ClipperLib.ClipType.ctDifference, finalNfp, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftNonZero)){
				continue;
			}
			
			if(!finalNfp || finalNfp.length == 0){
				continue;
			}
			
			var f = [];
			for(j=0; j<finalNfp.length; j++){
				// back to normal scale
				f.push(toNestCoordinates(finalNfp[j], config.clipperScale));
			}
			finalNfp = f;
						
			// choose placement that results in the smallest bounding box/hull etc
			// todo: generalize gravity direction
			minwidth = null;
			minarea = null;
			var minx = null;
			var miny = null;
			var nf, area, score, shiftvector, candidateBounds;
			
			var allpoints = [];
			for(m=0; m<placed.length; m++){
				for(n=0; n<placed[m].length; n++){
					allpoints.push({x:placed[m][n].x+placements[m].x, y: placed[m][n].y+placements[m].y});
				}
			}
			
			var allbounds;
			var partbounds;
			if(config.placementType == 'gravity' || config.placementType == 'box'){
				allbounds = GeometryUtil.getPolygonBounds(allpoints);
				
				var partpoints = [];
				for(m=0; m<part.length; m++){
					partpoints.push({x: part[m].x, y:part[m].y});
				}
				partbounds = GeometryUtil.getPolygonBounds(partpoints);
			}
			else{
				allpoints = getHull(allpoints);
			}

			var shiftedplaced = null;
			var mergeMinLength = null;
			var mergeTolerance = null;
			var mergeCandidateCap = config.mergeLines ? normalizeMergeCandidateCap(config) : 0;
			var mergeCandidates = mergeCandidateCap > 0 ? [] : null;
			var mergeCandidateOrdinal = 0;
			if(config.mergeLines){
				shiftedplaced = [];
				for(m=0; m<placed.length; m++){
					shiftedplaced.push(shiftPolygon(placed[m], placements[m]));
				}
				// don't check small lines, cut off at about 1/2 in
				mergeMinLength = 0.5*config.scale;
				mergeTolerance = 0.1*config.curveTolerance;
			}
			for(j=0; j<finalNfp.length; j++){
				nf = finalNfp[j];
				//console.log('evalnf',nf.length);
				for(k=0; k<nf.length; k++){
					
					shiftvector = {
						x: nf[k].x-part[0].x,
						y: nf[k].y-part[0].y,
						id: part.id,
						source: part.source,
						rotation: part.rotation
					};
					
					
					/*for(m=0; m<part.length; m++){
						localpoints.push({x: part[m].x+shiftvector.x, y:part[m].y+shiftvector.y});
					}*/
					//console.time('evalbounds');
					
					if(config.placementType == 'gravity' || config.placementType == 'box'){
						var rectbounds = GeometryUtil.getPolygonBounds([
							// allbounds points
							{x: allbounds.x, y:allbounds.y},
							{x: allbounds.x+allbounds.width, y:allbounds.y},
							{x: allbounds.x+allbounds.width, y:allbounds.y+allbounds.height},
							{x: allbounds.x, y:allbounds.y+allbounds.height},
							
							// part points
							{x: partbounds.x+shiftvector.x, y:partbounds.y+shiftvector.y},
							{x: partbounds.x+partbounds.width+shiftvector.x, y:partbounds.y+shiftvector.y},
							{x: partbounds.x+partbounds.width+shiftvector.x, y:partbounds.y+partbounds.height+shiftvector.y},
							{x: partbounds.x+shiftvector.x, y:partbounds.y+partbounds.height+shiftvector.y}
						]);
						
						// weigh width more, to help compress in direction of gravity
						if(config.placementType == 'gravity'){
							area = rectbounds.width*2 + rectbounds.height;
						}
						else{
							area = rectbounds.width * rectbounds.height;
						}
						candidateBounds = rectbounds;
					}
					else{
						// must be convex hull
						var localpoints = clone(allpoints);
						for(m=0; m<part.length; m++){
							localpoints.push({x: part[m].x+shiftvector.x, y:part[m].y+shiftvector.y});
						}
						
						var candidateHull = getHull(localpoints);
						area = Math.abs(GeometryUtil.polygonArea(candidateHull));
						candidateBounds = GeometryUtil.getPolygonBounds(localpoints);
						shiftvector.hull = candidateHull;
						shiftvector.hullsheet = sheetHull;
					}
					
					//console.timeEnd('evalbounds');
					//console.time('evalmerge');
					
					if(config.mergeLines && mergeCandidateCap > 0){
						var baseScore = improvedPlacementScore(area, candidateBounds, sheetboundsForScoring, config);
						recordMergeCandidate(mergeCandidates, mergeCandidateCap, {
							area: area,
							baseScore: baseScore,
							bounds: candidateBounds,
							ordinal: mergeCandidateOrdinal++,
							position: shiftvector,
							x: shiftvector.x,
							y: shiftvector.y
						});
						continue;
					}

					if(config.mergeLines){
						// if lines can be merged, subtract savings from area calculation						
						var shiftedpart = shiftPolygon(part, shiftvector);
						var merged = mergedLength(shiftedplaced, shiftedpart, mergeMinLength, mergeTolerance);
						area -= merged.totalLength*config.timeRatio;
					}

					score = improvedPlacementScore(area, candidateBounds, sheetboundsForScoring, config);
					
					//console.timeEnd('evalmerge');
					
					if(candidatePlacementIsBetter(minarea, minx, miny, score, shiftvector.x, shiftvector.y)){
						minarea = score;
						minwidth = candidateBounds ? candidateBounds.width : 0;
						position = shiftvector;
						minx = shiftvector.x;
						miny = shiftvector.y;
						
						if(config.mergeLines){
							position.mergedLength = merged.totalLength;
							position.mergedSegments = merged.segments;
						}
					}
				}
			}

			if(mergeCandidateCap > 0){
				for(var ci=0; ci<mergeCandidates.length; ci++){
					var mergeCandidate = mergeCandidates[ci];
					shiftvector = mergeCandidate.position;
					candidateBounds = mergeCandidate.bounds;
					area = mergeCandidate.area;
					var cappedShiftedPart = shiftPolygon(part, shiftvector);
					var cappedMerged = mergedLength(shiftedplaced, cappedShiftedPart, mergeMinLength, mergeTolerance);
					area -= cappedMerged.totalLength*config.timeRatio;
					score = improvedPlacementScore(area, candidateBounds, sheetboundsForScoring, config);
					if(candidatePlacementIsBetter(minarea, minx, miny, score, shiftvector.x, shiftvector.y)){
						minarea = score;
						minwidth = candidateBounds ? candidateBounds.width : 0;
						position = shiftvector;
						minx = shiftvector.x;
						miny = shiftvector.y;
						position.mergedLength = cappedMerged.totalLength;
						position.mergedSegments = cappedMerged.segments;
					}
				}
			}

			if(position){
				placed.push(part);
				placements.push(position);
				if(position.mergedLength){
					totalMerged += position.mergedLength;
				}
			}
			
			// send placement progress signal
			var placednum = placed.length;
			for(j=0; j<allplacements.length; j++){
				placednum += allplacements[j].sheetplacements.length;
			}
			//console.log(placednum, totalnum);
			ipcRenderer.send('background-progress', {index: nestindex, progress: 0.5 + 0.5*(placednum/totalnum)});
			}
			finally{
				placementMs += Date.now() - placementStartedAt;
				placementIterations++;
			}
		}
		
		if(runLocalRefinement){
			var refinement;
			if(config.localRefinementEngine === 'shrinkSeparate'){
				refinement = refineByShrinkSeparate(sheet, placed, placements, config, sheetboundsForScoring, nestindex);
			}
			else if(config.localRefinementEngine === 'smart'){
				refinement = refineSmartPlacements(sheet, placed, placements, config, sheetboundsForScoring, nestindex);
			}
			else{
				refinement = refineLocalPlacements(sheet, placed, placements, config, sheetboundsForScoring);
			}
			mergeLocalRefinementStats(localRefinement, refinement ? refinement.stats : null);
			if(refinement && refinement.moved){
				totalMerged = sheetMergedBase + recomputeSheetMergedData(placed, placements, config);
				if(refinement.scoreState){
					minarea = refinement.scoreState.score;
				}
			}
		}

		if(useFitnessV2 && placements && placements.length > 0){
			var sheetMetric = calculateFitnessV2SheetMetric(sheet, placed, placements, config.placementType);
			if(!sheetMetric){
				sheetMetric = {
					type: config.placementType || 'convexhull',
					metric: 1,
					placementCount: placements.length,
					degenerate: true
				};
			}
			sheetMetric.sheet = sheet.source;
			sheetMetric.sheetid = sheet.id;
			fitness += 2.0 + sheetMetric.metric;
			fitnessBreakdown.sheets += 1;
			fitnessBreakdown.sheetMetrics.push(sheetMetric);
		}
		else if(placements && placements.length > 0 && minwidth !== null && minarea !== null){
			fitness += (minwidth/sheetarea) + minarea;
		}
		
		for(i=0; i<placed.length; i++){
			var index = parts.indexOf(placed[i]);
			if(index >= 0){
				parts.splice(index,1);
			}
		}
		
		if(placements && placements.length > 0){
			allplacements.push({sheet: sheet.source, sheetid: sheet.id, sheetplacements: placements});
		}
		else{
			if(!useFitnessV2){
				fitness -= sheetarea;
			}
			totalsheetarea -= sheetarea;
			totalMerged = sheetMergedBase;
			if(sheets.length == 0){
				break;
			}
			continue;
		}
		
		if(sheets.length == 0){
			break;
		}
	}
	
	// there were parts that couldn't be placed
	// scale this value high - we really want to get all the parts in, even at the cost of opening new sheets
	var penaltySheetArea = totalsheetarea > 0 ? totalsheetarea : 1;
	for(i=0; i<parts.length; i++){
		var unplacedPenalty = 100000000*(Math.abs(GeometryUtil.polygonArea(parts[i]))/penaltySheetArea);
		fitness += unplacedPenalty;
		if(fitnessBreakdown){
			fitnessBreakdown.unplacedPenalty += unplacedPenalty;
		}
	}
	// send finish progerss signal
	ipcRenderer.send('background-progress', {index: nestindex, progress: -1});
	
	var placedCount = 0;
	for(i=0; i<allplacements.length; i++){
		placedCount += allplacements[i].sheetplacements.length;
	}
	localRefinement.nonCanonicalNfpLookups = localRefinementNonCanonicalNfpLookupDelta(nonCanonicalNfpLookupStart);

	var result = {
		placements: allplacements,
		fitness: fitness,
		area: sheetarea,
		mergedLength: totalMerged,
		localRefinement: localRefinement,
		timing: {
			placementMs: placementMs,
			parts: placedCount,
			placementIterations: placementIterations
		}
	};
	if(fitnessBreakdown){
		result.fitnessBreakdown = fitnessBreakdown;
	}
	return result;
}

// clipperjs uses alerts for warnings
function alert(message) { 
    console.log('alert: ', message);
}

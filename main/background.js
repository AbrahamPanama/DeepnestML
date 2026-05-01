'use strict';

function calculateNativeAddonNfp(ipcRenderer, A, B){
	var response = ipcRenderer.sendSync('minkowski-calculate-nfp-sync', { A: A, B: B });
	if(!response || response.ok !== true){
		throw new Error(response && response.error ? response.error : 'native-addon-unavailable');
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
var NFP_CACHE_VERSION = 2;

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
	return hashString(polygonSignatureText(polygon));
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
			if(!data.config.simplify){
				parts[i].children = children[i];
			}
		}
		
		for(i=0; i<data.sheets.length; i++){
			data.sheets[i].id = data.sheetids[i];
			data.sheets[i].source = data.sheetsources[i];
			data.sheets[i].children = data.sheetchildren[i];
		}

		if(data.config && data.config.placementType === 'steprepeat'){
			try{
				var stepPlacement = placePartsStepRepeat(data.sheets, parts, data.config, index);
				stepPlacement.index = data.index;
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
				var doc = {
					A: A.source,
					B: B.source,
					Arotation: A.rotation,
					Brotation: B.rotation,
					Apolygon: rotatePolygon(A, A.rotation),
					Bpolygon: rotatePolygon(B, B.rotation)
				}
				if(!inpairs(key, pairs) && !db.has(doc)){
					pairs.push(key);
				}
			}
		}
		
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
					if(A.children){
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
					
					var doc = {
						A: processed[i].Asource,
						B: processed[i].Bsource,
						Arotation: processed[i].Arotation,
						Brotation: processed[i].Brotation,
						Apolygon: rotatePolygon(A, processed[i].Arotation),
						Bpolygon: rotatePolygon(B, processed[i].Brotation),
						nfp: processed[i].nfp
					};
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
	var min2 = minlength*minlength;
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
		
		if(Ax2+Ay2 < min2){
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
					
					if(Bx2+By2 < min2){
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
					
					var min2 = Math.min(rotB1.x, rotB2.x);
					var max2 = Math.max(rotB1.x, rotB2.x);
					
					// not overlapping
					if(min2 >= max1 || max2 <= min1){
						continue;
					}
					
					var len = 0;
					var relC1x = 0;
					var relC2x = 0;
					
					// A is B
					if(GeometryUtil.almostEqual(min1, min2) && GeometryUtil.almostEqual(max1, max2)){
						len = max1-min1;
						relC1x = min1;
						relC2x = max1;
					}
					// A inside B
					else if(min1 > min2 && max1 < max2){
						len = max1-min1;
						relC1x = min1;
						relC2x = max1;
					}
					// B inside A
					else if(min2 > min1 && max2 < max1){
						len = max2-min2;
						relC1x = min2;
						relC2x = max2;
					}
					else{
						len = Math.max(0, Math.min(max1, max2) - Math.max(min1, min2));
						relC1x = Math.min(max1, max2);
						relC2x = Math.max(min1, min2);		
					}
					
					if(len*len > min2){
						totalLength += len;
						
						var relC1 = {x: relC1x * c2, y: relC1x * s2};
						var relC2 = {x: relC2x * c2, y: relC2x * s2};
						
						var C1 = {x: relC1.x + A1.x, y: relC1.y + A1.y};
						var C2 = {x: relC2.x + A1.x, y: relC2.y + A1.y};
						
						segments.push([C1, C2]);
					}
				}
			}
			
			if(B.children && B.children.length > 0){
				var child = mergedLength(B.children, p, minlength, tolerance);
				totalLength += child.totalLength;
				segments = segments.concat(child.segments);
			}
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

	var holes = [];
	if(A.children && A.children.length > 0){
		var Bbounds = GeometryUtil.getPolygonBounds(B);
		for(i=0; i<A.children.length; i++){
			var Abounds = GeometryUtil.getPolygonBounds(A.children[i]);

			if(Abounds.width > Bbounds.width && Abounds.height > Bbounds.height){
				var holeNfp = GeometryUtil.noFitPolygon(A.children[i], B, true, false);
				if(holeNfp && holeNfp.length > 0){
					for(var j=0; j<holeNfp.length; j++){
						if(GeometryUtil.polygonArea(holeNfp[j]) < 0){
							holeNfp[j].reverse();
						}
						holes.push(holeNfp[j]);
					}
				}
			}
		}
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
		return nfp;
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

	// try the file cache if the calculation will take a long time
	var doc = window.db.find({
		A: A.source,
		B: B.source,
		Arotation: A.rotation,
		Brotation: B.rotation,
		Apolygon: A,
		Bpolygon: B,
		processHoles: processHoles
	});

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
				console.log('minkowski', A.length, B.length, A.source, B.source);
				console.time('clipper');

				var Ac = toClipperCoordinates(A);
				ClipperLib.JS.ScaleUpPath(Ac, 10000000);
				var Bc = toClipperCoordinates(B);
				ClipperLib.JS.ScaleUpPath(Bc, 10000000);
				for(var i=0; i<Bc.length; i++){
					Bc[i].X *= -1;
					Bc[i].Y *= -1;
				}
				var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
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

				nfp = [clipperNfp];
				console.timeEnd('clipper');
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
		doc = {
			A: A.source,
			B: B.source,
			Arotation: A.rotation,
			Brotation: B.rotation,
			Apolygon: A,
			Bpolygon: B,
			processHoles: processHoles,
			nfp: nfp
		};
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
	if(typeof A.source !== 'undefined' && typeof B.source !== 'undefined'){
		var doc = window.db.find({
			A: A.source,
			B: B.source,
			Arotation: 0,
			Brotation: B.rotation,
			Apolygon: A,
			Bpolygon: B
		}, true);
	
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
		console.log('inserting inner: ',A.source, B.source, B.rotation, f);
		var doc = {
			A: A.source,
			B: B.source,
			Arotation: 0,
			Brotation: B.rotation,
			Apolygon: A,
			Bpolygon: B,
			nfp: f
		};
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
	
	// total length of merged lines
	var totalMerged = 0;
		
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
		
		// open a new sheet
		var sheet = sheets.shift();
		var sheetarea = Math.abs(GeometryUtil.polygonArea(sheet));
		var sheetboundsForScoring = config.improvedPlacementScoring === true ? GeometryUtil.getPolygonBounds(sheet) : null;
		totalsheetarea += sheetarea;
		
		fitness += sheetarea; // add 1 for each new sheet opened (lower fitness is better)
		
		var clipCache = [];
		//console.log('new sheet');
		for(i=0; i<parts.length; i++){
			console.time('placement');
			part = parts[i];
			
			// inner NFP
			var sheetNfp = null;				
			// try all possible rotations until it fits
			// (only do this for the first part of each sheet, to ensure that all parts that can be placed are, even if we have to to open a lot of sheets)
			for(j=0; j<(360/config.rotations); j++){
				sheetNfp = getInnerNfp(sheet, part, config);
				
				if(sheetNfp){
					break;
				}
				
				var r = rotatePolygon(part, 360/config.rotations);
				r.rotation = part.rotation + (360/config.rotations);
				r.source = part.source;
				r.id = part.id;
				
				// rotation is not in-place
				part = r;
				parts[i] = r;
				
				if(part.rotation > 360){
					part.rotation = part.rotation%360;
				}
			}
			// part unplaceable, skip
			if(!sheetNfp || sheetNfp.length == 0){
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
				index: placed.length-1
			};
			
			console.log('save cache', placed.length-1);
			
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
			var minwidth = null;
			var minarea = null;
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
						
						area = Math.abs(GeometryUtil.polygonArea(getHull(localpoints)));
						candidateBounds = GeometryUtil.getPolygonBounds(localpoints);
						shiftvector.hull = getHull(localpoints);
						shiftvector.hullsheet = getHull(sheet);
					}
					
					//console.timeEnd('evalbounds');
					//console.time('evalmerge');
					
					if(config.mergeLines){
						// if lines can be merged, subtract savings from area calculation						
						var shiftedpart = shiftPolygon(part, shiftvector);
						var shiftedplaced = [];
						
						for(m=0; m<placed.length; m++){
							shiftedplaced.push(shiftPolygon(placed[m], placements[m]));
						}
						
						// don't check small lines, cut off at about 1/2 in
						var minlength = 0.5*config.scale;
						var merged = mergedLength(shiftedplaced, shiftedpart, minlength, 0.1*config.curveTolerance);
						area -= merged.totalLength*config.timeRatio;
					}

					score = improvedPlacementScore(area, candidateBounds, sheetboundsForScoring, config);
					
					//console.timeEnd('evalmerge');
					
					if(
					minarea === null || 
					score < minarea || 
					(GeometryUtil.almostEqual(minarea, score) && (minx === null || shiftvector.x < minx)) ||
					(GeometryUtil.almostEqual(minarea, score) && (minx !== null && GeometryUtil.almostEqual(shiftvector.x, minx) && shiftvector.y < miny))
					){
						minarea = score;
						minwidth = rectbounds ? rectbounds.width : 0;
						position = shiftvector;
						if(minx === null || shiftvector.x < minx){
							minx = shiftvector.x;
						}
						if(miny === null || shiftvector.y < miny){
							miny = shiftvector.y;
						}
						
						if(config.mergeLines){
							position.mergedLength = merged.totalLength;
							position.mergedSegments = merged.segments;
						}
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
			console.timeEnd('placement');
		}
		
		//if(minwidth){
		fitness += (minwidth/sheetarea) + minarea;
		//}
		
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
			break; // something went wrong
		}
		
		if(sheets.length == 0){
			break;
		}
	}
	
	// there were parts that couldn't be placed
	// scale this value high - we really want to get all the parts in, even at the cost of opening new sheets
	for(i=0; i<parts.length; i++){
		fitness += 100000000*(Math.abs(GeometryUtil.polygonArea(parts[i]))/totalsheetarea);
	}
	// send finish progerss signal
	ipcRenderer.send('background-progress', {index: nestindex, progress: -1});
	
	return {placements: allplacements, fitness: fitness, area: sheetarea, mergedLength: totalMerged };
}

// clipperjs uses alerts for warnings
function alert(message) { 
    console.log('alert: ', message);
}

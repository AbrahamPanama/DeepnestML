'use strict';

// Nest-panel zoom + free pan controller.
//
// Scope: enhances ONLY the #nestdisplay region of main/index.html. The
// nesting engine, IPC, worker pipeline, and background renderer are not
// touched by this module. State lives in this file and in two pieces of
// DOM: the inline `style.width` percentage on the live <svg id="nestsvg">
// and the scrollLeft/scrollTop of the .nestscroll wrapper.
//
// Public API (exposed as window.NestZoom after initNestZoom()):
//   - setZoom(level, anchor): set zoom level [min..max], optionally
//       anchored to a point in .nestscroll viewport coordinates (keeps
//       the content under that point stationary on screen).
//   - zoomIn() / zoomOut(): step by `options.step` toward the center of
//       the viewport.
//   - reset(): zoom back to 1 and scroll to (0, 0). Also called by
//       index.html after DeepNest.reset().
//   - fit(): fit current svg content to the viewport.
//   - applyToSvg(svg): re-apply the current zoom level to the given svg
//       element's inline width. Used by displayNest after it overwrites
//       the attribute on every redraw.
//   - getZoom(): current zoom level (number).
//
// Design notes:
//   * Zoom is expressed as an inline `svg.style.width = (100 * z) + '%'`.
//     SVG2 cascade gives this precedence over the `width="100%"`
//     attribute that displayNest sets on every refresh, so the zoom
//     level survives incremental redraws without the controller having
//     to hook into displayNest's DOM mutation loop.
//   * Free pan is provided by the browser's native scroll on
//     .nestscroll, plus space-bar/middle-click drag-to-pan.
//   * Wheel + ctrlKey zooms at the cursor. Plain wheel scrolls. This
//     matches macOS trackpad pinch (fires as wheel+ctrlKey) and
//     typical Figma-style mouse wheel zoom.

(function(global){

	function clamp(value, lo, hi){
		if(value < lo) return lo;
		if(value > hi) return hi;
		return value;
	}

	function parsePercentWidth(svg){
		// Inline style first, attribute fallback.
		var s = svg && svg.style && svg.style.width;
		if(s && s.charAt(s.length - 1) === '%'){
			var n = parseFloat(s);
			if(!isNaN(n)) return n;
		}
		var a = svg && svg.getAttribute && svg.getAttribute('width');
		if(a && typeof a === 'string' && a.charAt(a.length - 1) === '%'){
			var m = parseFloat(a);
			if(!isNaN(m)) return m;
		}
		return 100;
	}

	function isEditableTarget(el){
		if(!el) return false;
		var tag = el.tagName;
		if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
		if(el.isContentEditable) return true;
		return false;
	}

	function initNestZoom(options){
		options = options || {};

		var viewportSel = options.viewport || '#nestdisplay';
		var scrollerSel = options.scroller || '#nestdisplay .nestscroll';
		var toolbarSel  = options.toolbar  || '#nestdisplay .nest-zoomtools';

		var viewport = document.querySelector(viewportSel);
		var scroller = document.querySelector(scrollerSel);
		var toolbar  = document.querySelector(toolbarSel);

		if(!viewport || !scroller){
			console.warn('initNestZoom: required nodes missing', {
				viewport: viewportSel,
				scroller: scrollerSel
			});
			return null;
		}

		var minZoom = typeof options.minZoom === 'number' ? options.minZoom : 0.25;
		var maxZoom = typeof options.maxZoom === 'number' ? options.maxZoom : 8;
		var step    = typeof options.step    === 'number' ? options.step    : 1.15;
		var zoom    = 1;

		function getSvg(){
			return scroller.querySelector('#nestsvg');
		}

		function applyToSvg(svg){
			if(!svg) return;
			// Inline style.width in percent. Overrides the attribute
			// re-written by displayNest on every redraw.
			svg.style.width = (100 * zoom).toFixed(4) + '%';
			svg.style.height = 'auto';
		}

		function applyZoom(){
			applyToSvg(getSvg());
		}

		function setZoom(level, anchor){
			var prev = zoom;
			var next = clamp(level, minZoom, maxZoom);
			if(next === prev) return prev;

			// Content point under anchor (in scroller-local coords)
			// BEFORE zoom change.
			var ax, ay;
			if(anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number'){
				ax = scroller.scrollLeft + anchor.x;
				ay = scroller.scrollTop  + anchor.y;
			}

			zoom = next;
			applyZoom();

			// Keep the content under the anchor stable.
			if(anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number'){
				var ratio = next / prev;
				var newContentX = ax * ratio;
				var newContentY = ay * ratio;
				scroller.scrollLeft = Math.max(0, newContentX - anchor.x);
				scroller.scrollTop  = Math.max(0, newContentY - anchor.y);
			}
			return zoom;
		}

		function centerAnchor(){
			var rect = scroller.getBoundingClientRect();
			return { x: rect.width / 2, y: rect.height / 2 };
		}

		function zoomIn(){  return setZoom(zoom * step, centerAnchor()); }
		function zoomOut(){ return setZoom(zoom / step, centerAnchor()); }

		function reset(){
			zoom = 1;
			applyZoom();
			scroller.scrollLeft = 0;
			scroller.scrollTop  = 0;
			return zoom;
		}

		function fit(){
			var svg = getSvg();
			if(!svg){ return reset(); }
			var vbox = svg.viewBox && svg.viewBox.baseVal;
			if(!vbox || !vbox.width || !vbox.height){ return reset(); }

			// Base (z=1) intrinsic width is the scroller's current inner
			// width in CSS pixels (because svg width is a percentage of
			// its container). We want the SVG's rendered width to fit
			// the viewport and its rendered height to fit too. With
			// height:auto, the svg preserves its viewBox aspect ratio.
			var rect = scroller.getBoundingClientRect();
			var viewportWidth  = rect.width  - 4;
			var viewportHeight = rect.height - 4;
			if(viewportWidth <= 0 || viewportHeight <= 0){ return reset(); }

			// Rendered base width at z=1 is viewportWidth (svg is 100%).
			// Rendered base height at z=1 is viewportWidth * (vbox.h / vbox.w).
			var baseHeight = viewportWidth * (vbox.height / vbox.width);
			var byWidth  = 1;
			var byHeight = baseHeight > 0 ? (viewportHeight / baseHeight) : 1;
			var target = Math.min(byWidth, byHeight);
			target = clamp(target, minZoom, maxZoom);
			zoom = target;
			applyZoom();
			scroller.scrollLeft = 0;
			scroller.scrollTop  = 0;
			return zoom;
		}

		// ---------- Wheel: native scroll, ctrl/meta + wheel zooms ----------
		scroller.addEventListener('wheel', function(ev){
			if(ev.ctrlKey || ev.metaKey){
				ev.preventDefault();
				// deltaY > 0 on most platforms means "scroll down" =>
				// zoom out.
				var rect = scroller.getBoundingClientRect();
				var anchor = {
					x: ev.clientX - rect.left,
					y: ev.clientY - rect.top
				};
				var factor = Math.exp(-ev.deltaY * 0.0015);
				setZoom(zoom * factor, anchor);
			}
			// plain wheel: let the browser scroll natively (free pan).
		}, { passive: false });

		// ---------- Keyboard: step zoom, reset, fit ----------
		document.addEventListener('keydown', function(ev){
			if(isEditableTarget(document.activeElement)) return;

			// Only handle when the nesting page is actually the active
			// tab. Cheap test: the #nest container must be visible
			// (it lives inside #home .page.active).
			var home = document.getElementById('home');
			if(home && home.className.indexOf('active') < 0) return;

			if(ev.key === '+' || ev.key === '='){
				ev.preventDefault();
				zoomIn();
			}
			else if(ev.key === '-' || ev.key === '_'){
				ev.preventDefault();
				zoomOut();
			}
			else if(ev.key === '0'){
				ev.preventDefault();
				reset();
			}
			else if(ev.key === 'f' || ev.key === 'F'){
				ev.preventDefault();
				fit();
			}
		});

		// ---------- Space-drag / middle-click drag pan ----------
		var spaceHeld = false;
		var dragging  = false;
		var dragStart = null; // { x, y, scrollLeft, scrollTop }

		function setPanReady(on){
			if(on){ viewport.classList.add('nz-panready'); }
			else  { viewport.classList.remove('nz-panready'); }
		}
		function setPanning(on){
			if(on){ viewport.classList.add('nz-panning'); }
			else  { viewport.classList.remove('nz-panning'); }
		}

		document.addEventListener('keydown', function(ev){
			if(ev.code === 'Space' && !isEditableTarget(document.activeElement)){
				if(!spaceHeld){
					spaceHeld = true;
					setPanReady(true);
				}
				// Prevent page scroll via spacebar only while pointer
				// is over the nest viewport.
			}
		});
		document.addEventListener('keyup', function(ev){
			if(ev.code === 'Space'){
				spaceHeld = false;
				setPanReady(false);
				if(dragging){
					dragging = false;
					dragStart = null;
					setPanning(false);
				}
			}
		});

		scroller.addEventListener('mousedown', function(ev){
			var isMiddle = ev.button === 1;
			var isSpaceDrag = spaceHeld && ev.button === 0;
			if(!isMiddle && !isSpaceDrag) return;
			ev.preventDefault();
			dragging = true;
			dragStart = {
				x: ev.clientX,
				y: ev.clientY,
				scrollLeft: scroller.scrollLeft,
				scrollTop:  scroller.scrollTop
			};
			setPanning(true);
		});
		document.addEventListener('mousemove', function(ev){
			if(!dragging || !dragStart) return;
			scroller.scrollLeft = dragStart.scrollLeft - (ev.clientX - dragStart.x);
			scroller.scrollTop  = dragStart.scrollTop  - (ev.clientY - dragStart.y);
		});
		document.addEventListener('mouseup', function(){
			if(!dragging) return;
			dragging = false;
			dragStart = null;
			setPanning(false);
		});

		// ---------- Toolbar buttons ----------
		if(toolbar){
			var bindBtn = function(sel, fn){
				var el = toolbar.querySelector(sel);
				if(!el) return;
				el.addEventListener('click', function(ev){
					ev.preventDefault();
					fn();
				});
			};
			bindBtn('.nzt-in',    zoomIn);
			bindBtn('.nzt-out',   zoomOut);
			bindBtn('.nzt-reset', reset);
			bindBtn('.nzt-fit',   fit);
		}

		// Ensure the initial zoom is applied if an svg is already present.
		applyZoom();

		return {
			setZoom: setZoom,
			zoomIn: zoomIn,
			zoomOut: zoomOut,
			reset: reset,
			fit: fit,
			applyToSvg: applyToSvg,
			getZoom: function(){ return zoom; }
		};
	}

	global.initNestZoom = initNestZoom;

})(typeof window !== 'undefined' ? window : this);

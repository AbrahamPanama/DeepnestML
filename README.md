<img src="https://deepnest.io/img/logo-large.png" alt="Deepnest ML" width="250">

# Deepnest ML

Deepnest ML is a desktop nesting application for laser cutters, CNC workflows, print-and-cut layouts, and mixed artwork/contour jobs.

It is based on [SVGNest](https://github.com/Jack000/SVGnest), with a native/C-backed nesting path, local file conversion helpers, ML-assisted configuration support, and workflow additions for modern laser production files.

## Current Local Release

- **Version:** `0.9.4`
- **Product name:** `Deepnest ML`
- **Repository:** `https://github.com/AbrahamPanama/DeepnestML`
- **macOS local build:** `dist/Deepnest ML-0.9.4-mac-arm64.dmg`
- **Packaged app:** `dist/mac-arm64/Deepnest ML.app`
- **Notarization:** not configured; local builds use ad-hoc signing

## Current Capabilities

- Import and nest SVG geometry through the active DeepNest pipeline.
- Preserve nested SVG stroke/fill colors so cut and engrave paths can remain visually distinct.
- Auto-skip color-destructive merge-line export when colored nested geometry is present.
- Import DXF files through the local conversion path.
- Import transparent PNG artwork as bitmap artwork plus a generated outer contour.
- Tune PNG contours with offset, detail, smoothing, corner smoothness, alpha cutoff, cleanup, and physical-size controls.
- Import sticker-style PDFs as composite parts when the PDF contains raster artwork paired with an existing vector contour.
- Keep PDF artwork as bitmap print artwork and keep the PDF contour as a separate stroke-only cut path.
- Export SVG, PDF, DXF, and per-sheet TIFF through a unified export modal.
- Export TIFFs for print/RIP workflows with artwork-only outline filtering, optional top-edge indicator marks, optional sheet numbering, DPI presets/custom DPI, RGB/CMYK color handling, ICC profile embedding/conversion, transparent RGB output, and TIFF compression choices.
- Use the standard compact nesting modes or the deterministic **Step & Repeat** optimization mode for print/template layouts.
- Pre-pair profitable repeated concave parts into conservative rigid clusters, then expand every member back to its exact cut path for export.
- Optionally roll exact continuous-compaction rebuilds across overlapping clusters on layouts larger than six parts.
- Route outer NFP generation through the native Boost addon first, with JS fallbacks and an optional hole-processing toggle.
- Run opt-in local-refinement experiments and engine benchmark checks from the included `ml/` harnesses.
- Run in a unified light workspace where the parts list remains visible while nesting runs in the main workspace pane.

## Recent Highlights

### 0.9.4: Repeated-Motif Continuous Compaction

The opt-in **Large-layout rolling refinement** mode now has a production-scale path for seven or more copies of one source shape. It first discovers a compact four-part motif using the proven continuous-angle whole-cluster search, tiles that rigid motif across every repeated copy, and commits only a strict global compaction improvement that passes full-resolution sheet containment, pair-overlap, and merge-credit checks. Mixed-shape layouts continue through the existing rolling-window scheduler. On the supplied 15-copy `6273-674333.svg` job, the measured result rotated every part by 45 degrees, improved the continuous score by 9.7%, raised bounding-box utilization to 60.6%, and exported all 15 parts with zero overlap or sheet escape.

### 0.9.3: Rolling Large-Layout Refinement

Continuous compaction can now be extended beyond the proven four-to-six-part whole-layout rebuild. The new **Large-layout rolling refinement** setting visits unique overlapping clusters until the configured refinement budget expires, continues after accepted moves, and keeps every commit behind the existing full-resolution whole-layout legality gate. It has no fixed total-part limit, reports how many parts it scanned in the refinement badge, and remains disabled by default because larger searches intentionally trade additional processing time for more refinement coverage.

### 0.9.2: Live Refinement Canvas Refresh

The active canvas now redraws immediately when local refinement replaces the selected construction nest. Refinement badges, placement data, and the visible SVG therefore advance together; users no longer need to click a previous-nest thumbnail to reveal accepted angular refinement.

### 0.9.1: Settings Display Repair

The settings form now preserves its UI-only values when a nest switches to the smaller runtime engine configuration. Unit labels no longer become `undefined` after nesting starts, and SVG scale, endpoint tolerance, and both DXF unit selectors remain populated in inch and millimetre modes. Existing malformed or legacy values for these fields are normalized conservatively on startup.

### 0.9.0: Repeated-Part Interlocking

Deepnest ML can now measure and pre-pair repeated concave parts before the normal NFP placement pass. The laurel validation job forms two visible interlocked pairs and reduces used sheet width from `477.98` to `395.75` units in the installed app with a fresh default profile, a `17.2%` reduction. The search is capped and geometry-screened, keeps the proven four construction rotations, and expands every pair back to its original member paths before SVG, PDF, DXF, or TIFF export.

The feature is enabled by default with a conservative 10% mating-gain threshold for jobs containing one or two active part geometries. Mixed part libraries remain on the canonical independent-part path because corpus testing showed that rigid pairs can reduce global packing freedom even when every pair is locally efficient. Common-line merging is disabled while interlocking is active so no synthetic envelope can reach a cut file. Step & Repeat remains a separate fixed-grid mode and disables interlocking at runtime. The installed-app export gate confirmed all four original parts, zero overlap, and zero sheet escape.

### 0.7.5: Final Legality Gate For Slide Local Refinement

The `slide` local-refinement engine now validates the assembled layout with the same NFP-independent material-overlap gate that the `smart` and `shrinkSeparate` engines already used, and reverts all accepted slide moves if the refined layout fails it. Previously `slide` relied only on per-move point-in-NFP tests, so a wrong or missing pairwise NFP could let a slide land a part on top of another and ship the overlapping layout as the displayed/exported nest.

### 0.7.4: Corrupt NFP Fix For Near-Degenerate Rectangle Pairs

Fixed a nesting-engine bug where hairline-skewed rectangular parts (a common artifact of CAD export transforms) at mixed rotations could produce a corrupt no-fit-polygon during the `ClipperLib.MinkowskiSum` pair pre-pass, causing placed parts to overlap on the sheet. The Minkowski solution is now normalized with a non-zero-fill re-union before the largest-ring selection, at both the pair pre-pass and the `getOuterNfp` ClipperLib fallback in `main/background.js`. If you were nesting parts with interior cutouts and seeing overlaps that persisted even after clearing the NFP cache, clear the cache once more after upgrading to pick up correct NFPs going forward.

```text
dist/Deepnest ML-0.7.4-mac-arm64.dmg
```

### 0.7.3: Unified Export Modal + TIFF Output

The export workflow now uses one modal for all export formats:

- **SVG/PDF/DXF** continue to use the existing vector export paths.
- **TIFF** exports one raster file per sheet for print/RIP software.
- TIFF output supports 150/300/600/custom DPI, white or transparent RGB background, LZW/raw/ZIP compression, ICC embedding for RGB, and CMYK conversion through a selected ICC profile.
- Export-time outline controls can keep everything, keep artwork only, or keep artwork plus colored engrave strokes while dropping black cut outlines.
- Optional top indicators and sheet-number stamps help operators orient printed sheets.

The 0.7.3 local macOS artifact is:

```text
dist/Deepnest ML-0.7.3-mac-arm64.dmg
```

### Smart Refinement And Benchmark Foundations

This release also lands the local-refinement v3 groundwork and benchmark infrastructure:

- `main/util/separation.js` contains the separation/refinement helper primitives used by the smart engine experiments.
- `docs/local-refinement-v3-plan.md` records the current smart-refinement plan, gate history, and known limitations.
- `docs/sota-nesting-implementation-plan.md` records the broader benchmark-first nesting engine plan.
- `ml/tests/engine_equivalence`, `ml/tests/separation`, and `ml/tests/tiff_export` provide focused regression checks.
- ESICUP-style benchmark conversion and runner support live under `ml/benchmark`, `ml/cli`, and `ml/lib`.

### Artwork + Contour Imports

Bitmap and PDF imports now support a print-and-cut style model:

- artwork is preserved for preview/export
- contour geometry is used for nesting and cutting
- PNG contours are generated from transparency when needed
- PDF contours are reused from the PDF's own vector paths when a reliable image/vector pairing is detected

### Step & Repeat

The **Step & Repeat** optimization type is separate from compactness-driven nesting. It is intended for predictable print-template layouts:

- deterministic placement
- optional alternating 180-degree rotation
- row or column fill direction
- density controls
- tight/center alignment controls
- optional stagger controls

### SVG Color Preservation

SVG styling is resolved during import so class-based and inline colors survive into previews and exports. This supports files that mix cut outlines with colored engrave paths.

### Unified Workspace UI

The app now keeps the main parts list visible while nesting. The previous large import preview was removed from the primary workflow because thumbnails already provide enough inspection for most parts.

### Native-First NFP Path

Outer no-fit polygons now try the native Boost-based addon first, then fall back to the existing JavaScript paths if the addon is unavailable or returns no result. Hole processing remains enabled by default, and a Settings toggle can disable hole subtraction for jobs where interior cutout nesting is not needed.

## Original Deepnest/SVGNest Features

- Native speed-critical geometry support.
- Common-line merge support for laser cuts.
- Path approximation controls for complex parts.
- Irregular polygon nesting based on the SVGNest/DeepNest approach.

## Build Commands

```bash
npm start
npm run build
npm run dist
```

`npm start` launches the local Electron app.

`npm run build` rebuilds the native Minkowski addon for the installed Electron version.

`npm run dist` packages the macOS build through Electron Builder.

## Verification Commands

Useful targeted checks for the current active path:

```bash
node --check main.js
node --check main/deepnest.js
python3 -c "import ast; ast.parse(open('scripts/conversion/local-convert.py').read())"
python3 scripts/conversion/local-convert.py --mode doctor
node ml/tests/tiff_export/run.js
node ml/tests/engine_equivalence/run.js
node ml/tests/separation/run.js
bash ml/scripts/run_boot_check.sh
bash ml/scripts/run_smoke_battery.sh
```

## License

Deepnest ML is distributed under the MIT License. It is based on the original Deepnest/SVGNest work by Jack Qiao; the original copyright notice is preserved in [LICENSE](LICENSE).

## Project Guidance

For AI-assisted work in this repository, see [AGENTS.md](AGENTS.md).

## ML Strategy Docs

The current ML modernization plan lives in:

- [docs/README.md](docs/README.md)
- [docs/ml-modernization.md](docs/ml-modernization.md)
- [docs/autopilot-training.md](docs/autopilot-training.md)
- [docs/synthetic-data-strategy.md](docs/synthetic-data-strategy.md)

The concrete phase-1 implementation entry point lives in:

- [ml/README.md](ml/README.md)
- [ml/README.md#ml-system-handoff](ml/README.md#ml-system-handoff)

## ML Protection Rule

Deepnest ML's training and live recommendation pipeline is a protected workflow.

- Do not ship solver, runtime, packaging, or native-addon changes that negatively affect the ML teacher path unless the ML change is intentional and re-validated.
- Treat `main/background.js`, `main.js`, `addon.cc`, `minkowski.cc`, `ml/teacher-main.js`, and `ml/app-smoke-main.js` as ML-sensitive files.
- Runtime improvements are welcome, but they must preserve teacher legality, artifact completeness, and candidate comparability unless the project explicitly accepts a new ML baseline.

<img src="https://deepnest.io/img/logo-large.png" alt="Deepnest ML" width="250">

# Deepnest ML

Deepnest ML is a desktop nesting application for laser cutters, CNC workflows, print-and-cut layouts, and mixed artwork/contour jobs.

It is based on [SVGNest](https://github.com/Jack000/SVGnest), with a native/C-backed nesting path, local file conversion helpers, ML-assisted configuration support, and workflow additions for modern laser production files.

## Current Local Release

- **Version:** `0.7.1`
- **Product name:** `Deepnest ML`
- **Repository:** `https://github.com/AbrahamPanama/DeepnestML`
- **macOS local build:** `dist/Deepnest ML-0.7.1-mac-arm64.dmg`
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
- Export SVG, PDF, and DXF, with save dialogs appending missing file extensions.
- Use the standard compact nesting modes or the deterministic **Step & Repeat** optimization mode for print/template layouts.
- Route outer NFP generation through the native Boost addon first, with JS fallbacks and an optional hole-processing toggle.
- Run in a unified light workspace where the parts list remains visible while nesting runs in the main workspace pane.

## Recent 0.7.x Highlights

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
npm run dist
```

`npm start` launches the local Electron app.

`npm run dist` packages the macOS build through Electron Builder.

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

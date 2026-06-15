# TIFF Bitmap Export + Unified Export Modal — Implementation Plan

Status: PLAN — approved direction, not yet implemented. Author: Claude-Code, 2026-06-12.

Audience: an implementing agent with **no prior context**. Every work package names exact
files, functions, line anchors (re-locate by symbol if drifted), data shapes, formulas,
defaults, and tests. Read this whole document before writing code. When this document and
the live code disagree, trust the live code, record the discrepancy in
`AGENT_COLLABORATION.md`, and adapt minimally.

Goal: export a nested layout as **raster TIFF files for print/RIP software**, one file per
sheet, with (a) an export-time **outline-removal** control so the bitmap holds only
printable artwork, (b) an optional **top indicator** fiducial so operators know which edge
is up, and (c) **ICC color profile** support (embed for RGB, convert+embed for CMYK). The
export menu is refactored into a single **export modal** (all four formats) whose
interaction model mirrors the CollageMaker app's `ExportModal`, rebuilt in Deepnest's
vanilla-JS + light-theme stack.

Feasibility is PROVEN on this machine (2026-06-12): PyMuPDF 1.26.5 renders SVG→pixmap at
exact DPI; Pillow 11.3 (libtiff + ImageCms) writes TIFF with DPI tags, embedded ICC, and
RGB→CMYK conversion. **No new runtime dependencies.**

---

## 0. Ground rules (non-negotiable)

1. **Multi-agent protocol.** Read `AGENTS.md` then `AGENT_COLLABORATION.md`. Claim each WP
   in the Active Work table (`TIFF-T1` … `TIFF-T4`). Leave a Handoff Note after each. Prefix
   commits `[<agent>] TIFF-Tx: <summary>`.
2. **ML-sensitive files.** `main.js`, `main/index.html` are on the ML-sensitive list, but
   this feature is **export-only** — it never touches nesting geometry, the GA, placement,
   or the teacher payload. No ML checkpoint is required as long as you do not modify
   `placeParts`, `exportNest`'s EXISTING vector output for SVG/PDF/DXF (default behavior
   must stay byte-identical), or any scoring code.
3. **No new dependencies.** Use the already-installed PyMuPDF + Pillow only. Do not add npm
   or pip packages.
4. **Additive only.** SVG/PDF/DXF exports must produce byte-identical output to today when
   the new options are at their defaults. The new modal replaces the export *menu* but must
   call the same `exportNest`→conversion path for vector formats.
5. **Verification battery** after each WP (§9). Do not mark a WP done without it.

---

## 1. Current-state map (verified 2026-06-12)

### 1.1 Export entry points (renderer, `main/index.html`)
- Export menu: three `<li>` items `#exportsvg` / `#exportpdf` / `#exportdxf` at
  `main/index.html:3854-3856`, plus their click handlers at `:2329` (svg), `:2356` (pdf),
  `:2397` (dxf).
- **`exportNest(n, dxf)`** at `main/index.html:2538` builds the export SVG DOM:
  - one `<g>` per sheet placement set `n.placements`;
  - optional sheet outline group (`class="sheetoutline"`, gated by config
    `exportSheetOutline`) at `:2569`;
  - per part a `<g transform="translate(x y) rotate(r)">` containing the part's
    `svgelements` clones at `:2592`; `<image>` nodes get their `data-href`→`href` restored
    at `:2595`;
  - sheets are STACKED vertically into ONE svg (`svgheight += 1.1*sheetbounds.height`);
  - real-world `width`/`height` set in `in` or `mm` from `config.scale` + `units` at
    `:2602`, `viewBox` in nest units;
  - returns `XMLSerializer().serializeToString(svg)`.
- **`requestLocalConversion(targetFormat, sourceFormat, payload, filename, options)`** at
  `main/index.html:116` — base64-encodes `payload`, sends IPC `conversion-run`
  (async, `ipcRenderer.invoke`) or `conversion-run-sync` fallback, returns the response.
  **It already forwards `options` untouched** — no change needed to add a TIFF call.
- Response shape from the service: `{ ok, targetFormat, outputText }` for svg targets, or
  `{ ok, targetFormat, outputBase64 }` for binary targets, or `{ ok:false, error, details }`.
- Helpers available: `base64ToBytes(base64)` at `:156`; `ensureFileExtension(name, ext)` at
  `:356`; `message(text, isError)` for toasts; `app.dialog.showSaveDialog` /
  `showOpenDialog` (callback style, see `:2358`).
- Existing modal scaffolds to MIRROR for markup/CSS conventions: `#rectangledialog`
  (`:3914`), `#bitmapcontourdialog` (`:4006`). Use the same overlay/show-hide pattern and
  light-theme classes; do not invent a new dialog system.
- Config: `defaultconfig` at `main/index.html:399`; the two checkbox-key lists (search
  `processHoles` to find both, `:463` and `:568`); settings persistence loop at `:446`.

### 1.2 Conversion service (main process, `main.js`)
- **`runLocalConversion(payload)`** at `main.js:822`. `mode = sourceFormat + '-to-' +
  targetFormat`. Supported-mode allow-list at `:834-838` (currently pdf-to-svg, svg-to-pdf,
  png/jpg/jpeg-to-svg). Writes input to a temp file, runs the Python script with
  `--mode <mode> --input <f> --output <f> [--options <json>]`, reads the output, returns
  `outputText` (svg) or `outputBase64` (binary). Temp files cleaned in `finally`.
- IPC handlers: `conversion-run` (`:1161`), and a sync variant exists.
- **Python**: `scripts/conversion/local-convert.py`. `run_doctor()` at `:42` reports per-mode
  readiness (`:75-77`). `convert_svg_to_pdf(input, output)` at `:715` already does
  `fitz.open(stream=svg_bytes, filetype="svg")`. `_load_module("fitz")` and Pillow are the
  rasterization tools. `_render_svg_to_rgba(svg_text, fitz, scale)` at `:498` already
  renders SVG→Pillow RGBA via `get_pixmap(matrix=Matrix(scale,scale), alpha=True)` — the
  exact primitive TIFF needs.

### 1.3 Units / sizing
- `config.scale` = nest units per inch (default 72). `config.units` = `inch`|`mm`.
- Real width in inches of a sheet = `sheetbounds.width / config.scale` (when units=inch);
  for mm the existing export divides scale by 25.4 (see `:2598`). Nest→inches is always
  `nestUnits / config.scale`. **Nest units per mm = `config.scale / 25.4`.**

---

## 2. Decisions (locked — implement exactly these)

These resolve every open question; do not re-litigate, just build them.

1. **Modal scope**: ONE export modal serving all four formats (SVG/PDF/DXF/TIFF). Replaces
   the 3-item menu. Vector formats keep their current conversion paths unchanged.
2. **Outline removal**: a **three-way segmented control** `outlineMode`:
   - `everything` (default for SVG/PDF/DXF) — keep all geometry; respect `exportSheetOutline`.
   - `artwork` (default for TIFF) — keep `<image>` + filled vectors; drop stroke-only/`fill:none`
     vectors AND the sheet outline.
   - `keepEngrave` — keep artwork + colored (non-black) stroke vectors; drop black cut lines
     + sheet outline.
3. **Top indicator**: optional (default ON for TIFF, OFF for vector). Placement enum
   `center` (default) | `topLeft` | `topRight` | `bothCorners`. A perpendicular tick:
   length 10 mm, thickness 0.5 mm, inset 2 mm from the top edge, solid black. Always kept
   (exempt from outline classification).
4. **Sheet-number stamp**: optional, **default OFF**. When on, a small `<text>` "i / N"
   beside the indicator (font-size 5 mm, black, `font-family:sans-serif`). Same always-kept
   fiducial mechanism.
5. **Color mode**: `rgb` (default) | `cmyk`.
   - RGB → embed-only (assign). Default source profile sRGB; user may pick any RGB `.icc`;
     "None" allowed (untagged).
   - CMYK → convert sRGB→CMYK through the user profile + embed it. **CMYK requires an ICC
     file** (block export with a message if missing). 8-bit only.
6. **Background**: `white` (default) | `transparent`. Transparent is RGB-only; selecting
   CMYK disables it and forces white (UI enforces + a hint explains).
7. **Compression**: `lzw` (default) | `none` | `zip`.
8. **Multi-sheet**: ALWAYS one TIFF per sheet. Naming: N==1 → `name.tiff`; N>1 →
   `name_01.tiff`…`name_NN.tiff` zero-padded to the digit-width of N. Overwrite-warn if any
   target exists. No multipage TIFF.
9. **DPI**: presets 150 / 300 (default) / 600 / Custom (number field, clamp 36–1200).

---

## 3. WP-T1 — Python converter `convert_svg_to_tiff` (the core)

File: `scripts/conversion/local-convert.py`. Pure rasterization + color + save. **It is
"dumb": it renders whatever SVG it is given.** Outline removal and the indicator are done
upstream in `exportNest` (WP-T3), so this function knows nothing about them.

### 3.1 Options schema (the `--options` JSON)
```
{
  "dpi": 300,                  // integer, clamp 36..1200
  "widthInches": 12.0,         // physical width of THIS sheet's svg
  "heightInches": 13.2,        // physical height
  "colorMode": "rgb",          // "rgb" | "cmyk"
  "background": "white",       // "white" | "transparent"
  "compression": "lzw",        // "lzw" | "none" | "zip"
  "iccProfileBase64": "...."   // optional; required when colorMode=="cmyk"
}
```

### 3.2 Algorithm (`convert_svg_to_tiff(input_path, output_path, options_json)`)
```
fitz = _load_module("fitz"); require it (raise RuntimeError if missing)
from PIL import Image, ImageCms; import io, base64

opts = json.loads(options_json or "{}")
dpi  = int(clamp(opts.get("dpi", 300), 36, 1200))
mode = opts.get("colorMode", "rgb")
bg   = opts.get("background", "white")
comp = {"lzw":"tiff_lzw","none":"raw","zip":"tiff_adobe_deflate"}.get(opts.get("compression","lzw"),"tiff_lzw")

# 1) render SVG at exact DPI
svg_bytes = read(input_path)
doc  = fitz.open(stream=svg_bytes, filetype="svg")
page = doc[0]
# page.rect is in points (72/inch). Compute zoom so output = realInches*dpi pixels.
target_w = max(1, round(opts["widthInches"]  * dpi))
target_h = max(1, round(opts["heightInches"] * dpi))
zoom_x = target_w / page.rect.width
zoom_y = target_h / page.rect.height
pix = page.get_pixmap(matrix=fitz.Matrix(zoom_x, zoom_y), alpha=True)
img = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)

# 2) background
if bg == "transparent" and mode == "rgb":
    base = img                      # keep alpha
else:
    base = Image.new("RGB", img.size, (255,255,255))
    base.paste(img, mask=img.split()[3])   # flatten onto white

# 3) color + icc
icc_b64 = opts.get("iccProfileBase64")
icc_bytes = base64.b64decode(icc_b64) if icc_b64 else None
save_kwargs = {"format":"TIFF","compression":comp,"dpi":(dpi,dpi)}

if mode == "cmyk":
    if not icc_bytes: raise RuntimeError("cmyk-requires-icc")
    src = ImageCms.createProfile("sRGB")
    dst = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))     # validate; raises on bad file
    # guard: dst must be a CMYK profile
    rgb = base if base.mode=="RGB" else base.convert("RGB")
    out = ImageCms.profileToProfile(rgb, ImageCms.ImageCmsProfile(src), dst,
                                    renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                                    outputMode="CMYK")
    save_kwargs["icc_profile"] = icc_bytes
else:  # rgb
    if icc_bytes:
        ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))       # validate only
        save_kwargs["icc_profile"] = icc_bytes
    out = base

out.save(output_path, **save_kwargs)
```
Notes:
- `page.rect.width/height` come from the SVG's physical size; computing zoom from the target
  pixel count (not trusting unit parsing) is the robust path — do it exactly as above.
- Wrap ICC parse in try/except and raise `RuntimeError("invalid-icc-profile")` so the UI
  shows a clean message (the service already serializes RuntimeError messages into
  `error`/`details`).
- Memory guard: if `target_w * target_h > 120_000_000` (≈120 MP) raise
  `RuntimeError("raster-too-large")` before allocating — the UI caps DPI but defend anyway.

### 3.3 Doctor + dispatch
- Add `"svg-to-tiff": fitz is not None and pil_image is not None` to the doctor modes dict
  (`local-convert.py:75`).
- Wire `--mode svg-to-tiff` to `convert_svg_to_tiff` in the script's main dispatch (mirror
  how `svg-to-pdf` is dispatched).

### 3.4 Test (must-have): `ml/tests/tiff_export/run.js`
Plain Node test that shells the Python converter directly (mirror
`ml/tests/esicup_convert/run.js` style; resolve python via the same candidates main.js uses,
or just `python3`). Steps:
1. Write a fixture SVG (2in×1in, a red filled rect + a black stroke-only circle).
2. Run `--mode svg-to-tiff --options {dpi:300,widthInches:2,heightInches:1,colorMode:rgb,
   background:white,compression:lzw}`.
3. Shell `python3 -c` with Pillow to assert: size==(600,300), mode=="RGB",
   `info['dpi']==(300,300)`.
4. Repeat with `background:transparent` → assert mode=="RGBA".
5. Repeat with a generated sRGB icc (ImageCms) passed as base64 → assert
   `info['icc_profile']` present.
6. CMYK without icc → assert the run fails with `cmyk-requires-icc`.

---

## 4. WP-T2 — main.js conversion plumbing

File: `main.js`. Minimal.
1. Add `mode === 'svg-to-tiff'` to the supported allow-list at `main.js:834`.
2. `targetFormat === 'tiff'` returns `outputBase64` — the existing binary branch at
   `:900-904` already does this for any non-svg target, so **no change needed** there; just
   the allow-list line.
3. `normalizeFormat` must accept `tiff` (and map `tif`→`tiff`). Check the normalizer near
   the top of `runLocalConversion`; add the alias if it whitelists extensions.
4. `getLocalConversionHealth` (`:926`) automatically reflects the new doctor mode — no
   change.

There is **no multi-output IPC**: the renderer (WP-T4) loops sheets and calls the converter
once per sheet. This keeps the single-in/single-out contract and bounds memory per sheet.

---

## 5. WP-T3 — `exportNest` refactor: classification, indicator, per-sheet output

File: `main/index.html`, function `exportNest` at `:2538`. Change its signature to accept an
options object while preserving today's two call shapes.

### 5.1 New signature
```
exportNest(n, optionsOrDxf)
  // backward compat: if optionsOrDxf === true  -> { dxf:true } (DXF call site)
  //                  if optionsOrDxf falsy     -> {} (current SVG/PDF behavior)
  // options: {
  //   dxf: bool,
  //   perSheet: bool,           // NEW: return array of per-sheet svgs instead of stacked
  //   outlineMode: 'everything'|'artwork'|'keepEngrave',   // default 'everything'
  //   topIndicator: { enabled, placement, lengthMm:10, thicknessMm:0.5, insetMm:2 } | null,
  //   sheetNumber: bool,
  // }
```
Default-call behavior (no options / `true`) MUST be byte-identical to today — guard every new
branch behind an explicit option so the equivalence of SVG/PDF/DXF output is preserved.

### 5.2 Outline classification
Add a helper `classifyExportNode(node)` returning `'artwork'|'outline'`:
- `node.tagName == 'image'` → `artwork`.
- Parse fill via the existing `parseInlineStyleMap` (`:2449`) + `fill` attribute. SVG default
  fill is black (visible) when neither style nor attribute sets it. If fill is present and
  not `none` → `artwork`. If `fill:none`/`fill="none"` and a stroke exists → `outline`.
  If no fill and no stroke → `outline` (nothing to print).
- Reuse `elementHasNonBlackStyle(node)` (already in the file, used by
  `nestHasColoredGeometry`) to detect colored strokes.

Apply per `outlineMode` when appending each part svgelement clone (the loop at `:2592`):
- `everything` → append all (current behavior).
- `artwork` → append only nodes classified `artwork`.
- `keepEngrave` → append `artwork` nodes, plus `outline` nodes where
  `elementHasNonBlackStyle(node)` is true (colored engrave); drop black cut lines.
- Sheet outline group (`:2569`): include only when `outlineMode==='everything'` AND
  `exportSheetOutline` is set. In `artwork`/`keepEngrave`, never include it.

### 5.3 Top indicator + sheet number (per sheet group)
After building a sheet's group, if `options.topIndicator?.enabled`, append generated nodes to
that sheet's group, in the sheet's local coordinate space (same space the part transforms use,
where the sheet top edge is at the group's translate origin). Compute in nest units:
```
upm   = config.scale / 25.4               // nest units per mm
len   = lengthMm   * upm                   // 10mm default
thick = thicknessMm* upm                   // 0.5mm
inset = insetMm    * upm                   // 2mm
W     = sheetbounds.width                   // nest units
```
Tick = a `<line>` (or thin `<rect>`) with `stroke="#000"`, `stroke-width=thick`,
`class="topindicator"`, vertical from `y=inset` to `y=inset+len`:
- `center`     → `x = W/2`
- `topLeft`    → `x = inset + len`   (kept off the very corner)
- `topRight`   → `x = W - inset - len`
- `bothCorners`→ emit the topLeft and topRight ticks
Coordinates are in the sheet-local space; because the indicator is appended to the same `<g>`
as the parts, its transform is automatic. **These nodes are appended AFTER classification and
are never filtered** — they are fiducials.

Sheet number (if `options.sheetNumber`): a `<text class="sheetnumber" x=W/2 y=inset+len+ (5mm)
font-size=(5mm*upm) text-anchor="middle" fill="#000" font-family="sans-serif">i / N</text>`.

### 5.4 Per-sheet output
When `options.perSheet`, instead of stacking, build ONE `<svg>` per sheet:
- viewBox = `0 0 sheetbounds.width sheetbounds.height`;
- group translate = `translate(-sheetbounds.x -sheetbounds.y)` (sheet top-left at origin,
  so the indicator's `y=0` top is the true sheet top);
- physical `width`/`height` set from that sheet's own bounds using the SAME unit math as the
  current code (`:2598-2603`);
- return an **array** of `{ svg: serializedString, widthInches, heightInches, sheetIndex }`
  (compute `widthInches = sheetbounds.width / config.scale`, same for height — independent of
  the `units` setting, because inches is what WP-T1 wants).

Vector formats keep calling `exportNest` without `perSheet` (stacked, unchanged).

---

## 6. WP-T4 — Unified export modal (UI)

File: `main/index.html` (markup + inline CSS + inline JS) + `defaultconfig`. Mirror the
`#bitmapcontourdialog` scaffold for the overlay/show/hide and the **light theme** (do NOT use
CollageMaker's dark palette; use Deepnest's existing dialog classes/variables). Port
CollageMaker's *layout and interaction model* only.

### 6.1 Trigger
Replace the export menu open behavior: the Export button opens `#exportdialog` instead of the
3-item list. Keep the `<li>` ids only if other code references them; otherwise remove. The
modal's Format list is the new selector.

### 6.2 Structure (element ids the JS will bind)
```
#exportdialog (overlay)
  .exportdialog-card
    header: <h2>Export nest</h2> <p>desc</p> <button #exportdialog-close>
    body (two columns):
      LEFT:
        Format row-list (#export-format-list): rows SVG / PDF / DXF / TIFF,
          each: bold tag + plain description + selected state. data-format attr.
        Resolution block (#export-res-block, shown only when format==tiff):
          DPI tiles 150/300/600/Custom (#export-dpi-tiles); Custom reveals
          #export-dpi-custom number input (clamp 36..1200). Each non-custom tile
          shows "→ <Wpx> × <Hpx>" for the FIRST sheet (compute from sheet bounds).
      RIGHT:
        Options (#export-options):
          - Outline: segmented control #export-outline (everything/artwork/keepEngrave)
          - Top indicator: toggle #export-indicator + placement select #export-indicator-pos
          - Sheet number: toggle #export-sheetnum
          - Background: select #export-bg (white/transparent)   [tiff only]
          - Color mode: select #export-color (rgb/cmyk)          [tiff only]
          - ICC profile: row #export-icc showing filename or "None" + "Choose…" button
                         #export-icc-pick + "Clear" #export-icc-clear   [tiff only]
          - Compression: select #export-compression               [tiff only]
        Preview (#export-preview): an <img> thumbnail of the selected nest's first sheet
          (render via exportNest perSheet[0] → data URL) over a checkerboard when
          background==transparent; meta list: Format · Sheets(N) · Per-sheet px · Color · ~Est MB.
    footer:
      left: info "Renders locally via the bundled converter — nothing leaves your machine."
      right: #exportdialog-cancel (ghost) + #exportdialog-go (primary),
             primary label = N>1 ? "Export "+N+" TIFF files" : "Export TIFF"
             (for vector formats: "Export SVG/PDF/DXF").
```

### 6.3 Per-format option visibility (the enable/disable matrix)
| Control | SVG | PDF | DXF | TIFF |
|---|---|---|---|---|
| Outline mode | shown | shown | shown | shown |
| Top indicator / sheet number | shown | shown | shown | shown |
| Resolution (DPI) | hidden | hidden | hidden | shown |
| Background | hidden | hidden | hidden | shown |
| Color mode | hidden | hidden | hidden | shown |
| ICC profile | hidden | hidden | hidden | shown |
| Compression | hidden | hidden | hidden | shown |

Rules:
- Selecting **CMYK** disables Background (force `white`) and shows hint "CMYK has no
  transparency"; selecting **transparent** then CMYK reverts background to white.
- **CMYK with ICC = None** disables `#exportdialog-go` with hint "Choose a CMYK ICC profile".
- Defaults when TIFF chosen: outline=`artwork`, indicator ON/`center`, bg=`white`,
  color=`rgb`, compression=`lzw`. For SVG/PDF/DXF: outline=`everything`, indicator OFF.
- All selections persist to config (see §7) and reload on open.

### 6.4 Export orchestration (the #exportdialog-go handler)
```
selected = the one selected nest (reuse the existing selection filter at :2369). Guard none.
opts = read controls.
if format != tiff:  call existing per-format path (exportNest(selected, {outlineMode, topIndicator,...})
                    then svg write / requestLocalConversion('pdf'..) / dxf POST) and close.
TIFF path:
  if color==cmyk && !iccPath: message(error) and abort.
  iccBase64 = iccPath ? fs.readFileSync(iccPath).toString('base64') : null
  sheets = exportNest(selected, { perSheet:true, outlineMode, topIndicator:{...}, sheetNumber })
  N = sheets.length
  ask save path once (showSaveDialog, default 'deepnest.tiff', ext tiff).
  derive names: N==1 -> base.tiff ; else base_<zeropad(i+1, len(N))>.tiff in same dir.
  overwrite-warn if any exist (confirm dialog) -> abort on cancel.
  show spinner; for i in 0..N-1:
     resp = await requestLocalConversion('tiff','svg', sheets[i].svg, 'sheet'+i+'.svg', {
              dpi, widthInches: sheets[i].widthInches, heightInches: sheets[i].heightInches,
              colorMode, background, compression, iccProfileBase64: iccBase64 })
     if !resp.outputBase64: message('sheet '+(i+1)+' failed: '+(resp.error||''),true); break
     fs.writeFileSync(names[i], base64ToBytes(resp.outputBase64))
     update progress "Exporting sheet i+1 of N"
  clear spinner; success toast "Exported N TIFF file(s)."
```
ICC file picker (`#export-icc-pick`): `app.dialog.showOpenDialog` with
`filters:[{name:'ICC profile', extensions:['icc','icm']}]`; store the path in a module var +
config `lastIccProfilePath`; render basename in `#export-icc`.

DPI-tile pixel preview: `px = round(sheetbounds.width/config.scale * dpi)` × height likewise,
using the FIRST sheet's bounds; recompute on dpi change.

---

## 7. Config key registry (add to `defaultconfig` + both checkbox lists where boolean)

| Key | Type | Default |
|---|---|---|
| `exportFormat` | string | `'svg'` (last-used) |
| `exportOutlineMode` | string | `'everything'` |
| `exportTopIndicator` | bool | `false` |
| `exportTopIndicatorPos` | string | `'center'` |
| `exportSheetNumber` | bool | `false` |
| `tiffDpi` | number | `300` |
| `tiffColorMode` | string | `'rgb'` |
| `tiffBackground` | string | `'white'` |
| `tiffCompression` | string | `'lzw'` |
| `lastIccProfilePath` | string | `''` |

Booleans (`exportTopIndicator`, `exportSheetNumber`) must be added to BOTH checkbox-key lists
(`:463`, `:568`) so they round-trip. When TIFF is selected the modal overrides outline/
indicator defaults to the TIFF-friendly values unless the user already changed them this session.

---

## 8. Risks / traps (read twice)

1. **Default-output regression** is the #1 risk. SVG/PDF/DXF with default options must be
   byte-identical to today. Gate EVERY new branch in `exportNest` behind an explicit option;
   verify with the engine-equivalence smoke (the export bytes are in the smoke reports).
2. **MuPDF SVG fidelity**: embedded `<image>` data-URIs render (the import path round-trips
   them), but exotic CSS/filters/masks may not. Reuse `_flatten_masked_images` if artwork
   comes from the PDF composite path. Validate on a real print-and-cut bitmap job + the
   laurel job.
3. **CMYK has no alpha** — never save RGBA as CMYK; the UI must force white background for
   CMYK, and WP-T1 flattens regardless. 
4. **ICC colorspace mismatch**: a CMYK-mode export needs a CMYK profile; an RGB profile in
   CMYK mode will make `profileToProfile(outputMode='CMYK')` fail. Catch and surface
   "ICC profile is not a CMYK profile".
5. **Memory**: per-sheet rendering bounds it, but a 24in×24in @600dpi sheet is ~207 MP — the
   §3.2 guard + the DPI clamp (≤1200, but warn in UI above ~300MP) prevent OOM.
6. **`page.rect` zero/degenerate** if the SVG has no physical size — WP-T3 always sets
   width/height, but guard `page.rect.width>0` in WP-T1 and raise a clean error.
7. **Indicator coordinate space**: it lives in the sheet `<g>`'s local space (top edge at
   y=0 after the `translate(-bounds.x -bounds.y)`); do NOT place it in the outer svg space or
   it will be mis-located for multi-sheet.
8. **Filename zero-padding** must match the digit width of N so file managers and RIP queues
   sort correctly (`_01`..`_12`, not `_1`..`_12`).

---

## 9. Verification battery (per WP)

1. `node --check main.js`; inline-script parse of `main/index.html` (the `new Function(src)`
   battery used in prior handoffs); `python3 -c "import ast; ast.parse(open('scripts/conversion/local-convert.py').read())"`.
2. `python3 scripts/conversion/local-convert.py --mode doctor` → `svg-to-tiff: true`.
3. `node ml/tests/tiff_export/run.js` (WP-T1 test, §3.4) — the must-have.
4. Engine-equivalence harness (`node ml/tests/engine_equivalence/run.js`) — proves vector
   export defaults unchanged.
5. `bash ml/scripts/run_boot_check.sh`; full smoke battery
   (`bash ml/scripts/run_smoke_battery.sh`).
6. **Manual GUI acceptance** (Codex/Claude on Mac): import the laurel job, nest, open the
   export modal, export TIFF at 300 dpi, artwork-only, indicator center, transparent RGB →
   confirm: N files written, each sized `sheetInches*300`, opens in Preview, artwork present,
   cut outlines absent, a black top tick visible at top-center. Repeat CMYK+ICC (needs a real
   CMYK `.icc` — the user has `~/Desktop/PrinterColorCalibration`, ask for one) → confirm
   CMYK TIFF with embedded profile.

---

## 10. Work-package order & claims

| Order | WP | Claim string | Files | Gate |
|---|---|---|---|---|
| 1 | TIFF-T1 | `TIFF-T1 python svg-to-tiff converter` | local-convert.py, ml/tests/tiff_export | §3.4 test + doctor |
| 2 | TIFF-T2 | `TIFF-T2 main.js conversion mode` | main.js | doctor health reflects mode; node --check |
| 3 | TIFF-T3 | `TIFF-T3 exportNest classify+indicator+perSheet` | main/index.html | equivalence harness (vector defaults unchanged) + a JS unit check of classifyExportNode |
| 4 | TIFF-T4 | `TIFF-T4 unified export modal` | main/index.html | full battery + manual GUI acceptance (§9.6) |

T1+T2 can land before any UI and be tested headless via the converter test. T3 is
independently testable (classifier + perSheet array shape) before T4 wires the modal. Do them
in order; do not start T4 before T3's equivalence gate passes.

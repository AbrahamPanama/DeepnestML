# Agent Collaboration Handoff

This file is the shared coordination point for multiple AI coding agents working on Deepnest++.

Use it when Codex, Claude Code, or another agent may be active in the same workspace. Keep updates short, factual, and current.

## Collaboration Rules

1. Read `AGENTS.md` first, then read this file.
2. Before editing, claim the files or feature area you intend to touch in the Active Work section.
3. Avoid editing files claimed by another agent unless the user explicitly asks you to take over.
4. Prefer small, targeted patches in the active code path.
5. Preserve import -> nest -> export behavior unless the current task explicitly changes it.
6. If you discover unexpected changes, do not revert them. Record the conflict or uncertainty here and ask the user when needed.
7. After editing, update the Handoff Notes section with what changed, what was verified, and what still needs checking.

## Agent Identity And Conventions

**Agent names.** Use one of: `Claude-Cowork`, `Claude-Code`, `Codex`. If multiple concurrent sessions of the same agent are possible, append a short tag, e.g. `Claude-Cowork-A`.

**Runtime topology (confirmed 2026-04-18).** Not all agents have the same execution surface. This matters when deciding who claims which lane:

- `Claude-Cowork` runs in a Linux aarch64 sandbox. File tools reach the repo via a mount (reads and writes to `main/`, `ml/`, `addon.cc`, etc. work). Its shell is Linux and cannot execute the bundled macOS arm64 Electron binary, cannot reach the user's display server, and cannot load `build/Release/addon.node` (which is macOS-ABI). Lane: file edits, audits, plans, static checks, script authoring.
- `Codex` runs natively on the user's Mac. Can execute `npm start`, `bash ml/scripts/*`, inspect `/tmp/deepnest-logs/`, and read macOS system logs. Lane: runtime launches, live log inspection, GUI/behavior verification, any step that needs the addon or the display.
- The user owns overall coordination and decides who claims each lane through this file.

A practical consequence: if a task requires *both* a code change and a live Electron run to verify it, `Claude-Cowork` lands the code change + any headless verification it can run, then `Codex` runs the GUI check on the Mac. The JSON report written by `ml/boot-check-main.js` is the recommended handoff artifact for that pattern.

**Stale claims.** A claim with no Handoff Notes update for more than 4 hours is considered abandoned. The next agent may take it over after recording that takeover in Handoff Notes.

**Claim scope.** A claim should name a file plus an optional region qualifier when only partial editing is intended, e.g. `main/background.js (placePaths only)`. Genuinely overlapping claims trigger the Conflict Protocol below.

**Commit attribution.** Prefix git commit messages with the agent tag, e.g. `[claude-cowork] add NFP LRU` or `[codex] step-repeat density fix`. This keeps `git log` legible when both agents have been active.

**Timestamps.** Use UTC ISO date in the Updated column (`YYYY-MM-DD`). Use a full timestamp in Handoff Notes only when finer granularity matters.

## Current Stable Baseline

- Product: `Deepnest ML`
- Current version: `0.7.1`
- Local app artifact: `dist/mac-arm64/Deepnest ML.app`
- Local DMG artifact: `dist/Deepnest ML-0.7.1-mac-arm64.dmg`
- Notarization: not configured; builds are local/ad-hoc signed.

## Active Code Path

Treat these files as the primary runtime path:

- `main.js`
- `main/index.html`
- `main/style.css`
- `main/deepnest.js`
- `main/background.js`
- `main/svgparser.js`
- `main/util/geometryutil.js`
- `addon.cc`
- `minkowski.cc`

Avoid legacy/reference paths unless the task explicitly requires them.

### Touch With Care (ML-Sensitive Files)

These files are part of the ML training and teacher path. Changes here can silently invalidate trained models or break label generation. Coordinate explicitly before editing:

- `main.js`
- `main/background.js`
- `main/index.html` (renderer automation hook used by the teacher)
- `addon.cc`
- `minkowski.cc`
- `ml/teacher-main.js`
- `ml/app-smoke-main.js`
- `ml/config_candidates.json`

If a change here is intentional and the ML baseline needs to move, plan for a checkpoint (`npm run ml:checkpoint -- --name <reason>`) and a re-run of the bakeoff before the change is treated as accepted.

## Recent Product State

- Unified light workspace UI is active.
- The large import preview pane is hidden from the primary workflow.
- Parts list remains visible while nesting runs in the workspace pane.
- PNG contour import supports transparent bitmap artwork plus generated contour.
- PDF composite import pairs bitmap artwork with existing PDF vector contours when confidently detected.
- SVG nested colors are preserved for cut/engrave workflows.
- Step & Repeat exists as a separate deterministic optimization type.
- Nest zoom + free pan re-landed 2026-04-19 (see Handoff Notes); isolates to `#nestdisplay`, does not touch nesting engine or IPC.

## Working Tree State

State (verified 2026-05-01 by Codex): _clean after initial Git checkpoint_ — source/docs/test files are tracked in local Git; generated dependencies, packaged app artifacts, native build outputs, ML artifacts, checkpoints, logs, and local archives are ignored. Current app baseline remains `0.7.1`.

Use the format `State (verified YYYY-MM-DD by <agent>): <clean | dirty: reason>`. Re-stamp this line whenever you confirm or change tree state. If the stamp is more than a few hours old, treat it as untrusted and re-verify before editing.

## Active Work

Use this section to claim in-progress work.

| Agent | Task | Files / Area | Status | Updated |
| --- | --- | --- | --- | --- |
| _none_ | _n/a_ | _n/a_ | _n/a_ | _n/a_ |

## Upcoming Work

Park future tasks both agents should be aware of. Keep entries short. Move items into Active Work when an agent starts on them. Either agent may add or refine entries.

| Idea | Area | Notes |
| --- | --- | --- |
| Long-lived ML predictor sidecar | `ml/live/live-inference.js` | Eliminate per-call Python cold start; load model once, talk over a socket or stdio |
| Shape-aware features in classifier | `ml/python/deepnest_ml/features.py`, `ml/python/deepnest_ml/training.py` | Per-part summaries beyond scalar aggregates so two different jobs with the same totals look different |
| Workspace cleanup | repo root | Remove or relocate `Deepnest-master 2.zip` (~1 GB) and `ml/teacher-main.debug.log` (~52 MB) |
| Collapse dual ML model controls | `main/index.html`, renderer JS | UI_AUDIT P0.5 — replace `<select>` + `<input>` pair with a single select that reveals a "Custom path" input |
| Group Step & Repeat fields | `main/index.html`, `main/style.css` | UI_AUDIT P1.1 — wrap fields in `.steprepeat-group` and toggle via single class instead of inline `display:none` per field |
| Accessibility pass (landmarks, labels, dialog roles) | `main/index.html` | UI_AUDIT P2.1 — entire file has zero `aria-` / `role=` attributes |
| Extend smoke battery to bitmap/DXF cases | `ml/app-smoke-main.js`, `ml/smoke/scenarios/` | Follow-up after first scenario battery: add PNG contour import fixture and DXF export/import coverage |
| Local compaction pass | `main/background.js` | Next nesting-quality step: after initial placement, try small deterministic nudges/slide-left-down improvements before scoring a completed nest |

## Open Questions For User

Park decisions either agent cannot make alone. Resolve and clear when answered.

| Question | Asked By | Date |
| --- | --- | --- |
| _none_ | _n/a_ | _n/a_ |

## Handoff Notes

Use newest notes at the top.

### 2026-05-01 - GitHub remote and license metadata configured (Codex)

- Configured Git `origin` to `https://github.com/AbrahamPanama/DeepnestML.git`.
- Added root `LICENSE` using MIT terms while preserving original Jack Qiao copyright and adding Deepnest ML contributor copyright.
- Updated `README.md` with the GitHub repository URL and a License section.
- Updated `package.json` repository metadata to the new GitHub URL and added `"license": "MIT"`.
- Verification: `package.json` parses successfully with Node.

### 2026-05-01 - Local Git repository initialized (Codex)

- Initialized a local Git repository for `/Users/abrahamsaenz/Desktop/Deepnest++`.
- Added `.gitignore` to keep the first checkpoint focused on source/docs/tests and avoid committing generated or bulky artifacts:
  - ignored `node_modules/`, `dist/`, `build/`, `.legacy/`, `minkowski/`, `checkpoints/`, `ml/artifacts/`, `mlruns/`, logs, DMGs, blockmaps, zip/tar archives, and observed temporary payload files.
- Dry-run reviewed the first tracked set: 198 source/docs/test/config assets, about 6.8 MB total.
- Planned first commit message: `Initialize Deepnest++ source checkpoint`.
- No app/runtime code was changed for this Git setup.

### 2026-04-24 - Native-first NFP handoff verified and packaged as 0.7.1 (Codex)

- Took over the Claude-Cowork NFP handoff on the Mac.
- Verified the existing Electron-as-Node native/JS NFP equivalence harness: 4/4 fixtures passed.
- Ran a direct native hole smoke check: an A polygon with one child hole returned a native NFP with one child ring; the same A without children returned no child rings.
- Ran a temporary smoke scenario with `processHoles=false`; it exited cleanly.
- Bumped the app from `0.7.0` to `0.7.1` in `package.json`, `main/index.html`, `README.md`, and `ml/boot-check-main.js`.
- Added package-time native addon unpacking in `package.json` (`build/Release/*.node`, `minkowski/Release/*.node`) and updated `main.js` `loadNativeAddon()` to search `app.asar.unpacked` paths. This is required because the new native-first production path must load `addon.node` from the packaged app.
- Documented the native-first NFP path and `processHoles` toggle in `README.md`.
- Rebuilt with `npm run dist`, refreshing:
  - `dist/mac-arm64/Deepnest ML.app`
  - `dist/Deepnest ML-0.7.1-mac-arm64.dmg`
  - `dist/Deepnest ML-0.7.1-mac-arm64.dmg.blockmap`
- Verification:
  - `node --check main/background.js`, `node --check main/deepnest.js`, `node --check main.js`, `node --check ml/app-smoke-main.js`, `node --check ml/boot-check-main.js`, `node --check main/nest-zoom.js`, `node --check ml/tests/nfp_equivalence/run.js`, and `node --check ml/tests/parallel_ga/repro.js` passed.
  - Inline executable scripts in `main/index.html` parse with `new Function(...)`.
  - `node ml/tests/parallel_ga/repro.js` passed all dispatcher cases.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-071 bash ml/scripts/run_smoke_battery.sh` passed boot invariants plus `svg-gravity`, `svg-gravity-improved-scoring`, `svg-steprepeat`, and `svg-export-pdf`.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.7.1-mac-arm64.dmg"` passed; checksum valid.
  - App bundle Info.plist reports `CFBundleName=Deepnest ML`, `CFBundleShortVersionString=0.7.1`, and `CFBundleVersion=0.7.1`.
  - Packaged app has `app.asar.unpacked/build/Release/addon.node` as a Mach-O arm64 bundle, and `ELECTRON_RUN_AS_NODE=1 dist/mac-arm64/Deepnest ML.app/Contents/MacOS/Deepnest ML` successfully loaded that packaged native addon and calculated a sample NFP.
  - Packaged `app.asar` contains title `Deepnest ML 0.7.1`, package version `0.7.1`, `processHoles`, `tryNativeOuterNfp`, and the new `app.asar.unpacked` native-addon lookup.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Verify/native NFP handoff and build decision` claim.

### 2026-04-24 - NFP engine: native-first `getOuterNfp`, processHoles toggle, dead `minkowski thread.cc` removed (Claude-Cowork → Codex handoff)

Three NFP-engine changes, all on the renderer side; no native C++ source was modified. This handoff was completed by the 2026-04-24 Codex note above, including Mac-side verification and a refreshed `0.7.1` package.

What changed:

- **P6 dead-code removal.** Deleted `minkowski thread.cc`, a 548-line abandoned copy of `minkowski.cc` containing an unused `calculateNFPBatch` + thread-pool-of-size-1 experiment. It was not referenced by `binding.gyp` (sources list is `["addon.cc", "minkowski.cc"]`), not loaded by any JS, and did not participate in the build. Grep confirmed zero references before deletion.
- **Global `processHoles` Settings toggle (`main/index.html`).** Added `processHoles: true` to `defaultconfig`, added the key to both checkbox-keys lists so it round-trips through the Settings pane, added a Settings UI block (`<dt>Process part holes</dt>` + explain card) between `improvedPlacementScoring` and the CPU cores field. Default is ON, so existing jobs behave identically to before.
- **P0 native addon wire-up (`main/background.js`).** Previously the `calculateNativeAddonNfp` helper was defined but nobody called it — all production NFP math ran through `ClipperLib.Clipper.MinkowskiSum` (hole-free path) or `GeometryUtil.noFitPolygon` (orbit-slider path). Rewrote `getOuterNfp(A, B, inside, config)` to try the native Boost addon first via the existing `minkowski-calculate-nfp-sync` IPC channel, then fall back through a ladder: native → GeometryUtil (only when `processHoles=true` and A has children) → ClipperLib MinkowskiSum (hole-free). A new helper `tryNativeOuterNfp(A, B, processHoles)` rebuilds the payload explicitly (stripping `A.children` when the toggle is off), picks the largest-area polygon from the addon's multi-polygon result (matching the ClipperLib heuristic), and wraps it in `[best]` so the common `nfp.pop()` extraction in `getOuterNfp` still works. Returns null on any failure so the JS fallbacks kick in transparently.
- **Cache key extended backward-compatibly.** `nfpCacheKey` now appends an `'nh'` segment only when `processHoles === false`. Default `processHoles=true` entries keep the old key format, so no `NFP_CACHE_VERSION` bump is needed and warmed caches on existing installs remain reachable.
- **Call-site threaded.** The single production call site in `placeParts` is now `nfp = getOuterNfp(placed[j], part, false, config);` — `config` carries the `processHoles` value down so the toggle actually has effect.

Verification done here (sandboxed Linux):

- `node --check main/background.js` — clean.
- All inline `<script>` blocks in `main/index.html` re-parsed with `new Function(src)` (17 JS blocks, 0 failures; Ractive `text/ractive` templates intentionally skipped).
- Code-path reading: confirmed native addon returns arrays-of-polygons (`minkowski.cc:calculateNFP`), IPC handler in `main.js` (`minkowski-calculate-nfp-sync`) forwards `{A, B}` untouched to the utility process, and Electron v8 `ValueSerializer` preserves own string-keyed properties on arrays (HTML spec `StructuredSerializeInternal`) — so `A.children` survives the round-trip. `tryNativeOuterNfp` also rebuilds the payload defensively, so even if a future Electron upgrade changes that behavior we're covered.

What Codex needs to do on the Mac before shipping:

1. **Live IPC round-trip smoke test.** Boot the app, import a single part with a hole, and run a one-part nest with `processHoles=true` — confirm the native addon is reached (temporarily add a `console.log` in `tryNativeOuterNfp` if needed, or watch for the absence of the `console.time('clipper')` line in the renderer console). Repeat with `processHoles=false` and confirm the cache key changes (different disk manifest entries) and that the ClipperLib branch runs on a part with no holes.
2. **Electron-as-Node equivalence run.** Re-run `ml/tests/nfp_equivalence` (the harness from 2026-04-18) under the packaged Electron binary to confirm native and JS outputs still agree for the existing fixtures — the wire-up changes which path production takes but the equivalence invariant still must hold.
3. **Boot-check + smoke battery.** `node ml/tests/boot-check/run.js` and the smoke-scenario battery under `ml/app-smoke-main.js` should both pass unchanged. If the smoke battery includes a hole-bearing part, watch for a different `clipperScale`/timing signature now that the native path is primary.
4. **Package and version.** Decide if this warrants a 0.7.1 bump (the default behavior is preserved, but the primary NFP engine has changed). If yes: bump `package.json`, `main/index.html`, `README.md`, boot-check title invariant; run `npm run dist`; verify the packaged `asar.unpacked/build/Release/addon.node` is reachable via `buildAddonCandidates()` in `minkowski-worker.js`.
5. **Perf measurement (optional but recommended).** Compare per-NFP timing on a medium job (e.g. 20 parts, 3 holes total) pre- and post-change. The native addon's Boost Polygon integer arithmetic should measurably beat ClipperLib on the hole-free path; the win may be smaller (or negative) on parts with many holes because the addon re-subtracts children inside C++. Record results here for reference.

Rollback plan: revert the three `main/background.js` edits (cache key, `getOuterNfp`, `tryNativeOuterNfp`) and the `index.html` Settings toggle; `minkowski thread.cc` can stay deleted regardless (it was already dead).

Files touched:
- `minkowski thread.cc` (deleted)
- `main/index.html`
- `main/background.js`
- `AGENT_COLLABORATION.md`

### 2026-04-24 - Version bumped to 0.7.0 and app rebuilt (Codex)

- Bumped the stable app version from `0.6.1` to `0.7.0` in `package.json`, `main/index.html`, `README.md`, and the boot-check title invariant.
- Updated Current Stable Baseline to point at `dist/Deepnest ML-0.7.0-mac-arm64.dmg`.
- Rebuilt with `npm run dist`, refreshing:
  - `dist/mac-arm64/Deepnest ML.app`
  - `dist/Deepnest ML-0.7.0-mac-arm64.dmg`
  - `dist/Deepnest ML-0.7.0-mac-arm64.dmg.blockmap`
- Verification:
  - `node --check main/background.js`, `node --check main/deepnest.js`, `node --check main.js`, `node --check ml/app-smoke-main.js`, `node --check ml/boot-check-main.js`, and `node --check main/nest-zoom.js` passed.
  - Inline executable scripts in `main/index.html` parse with `new Function(...)`.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-070 bash ml/scripts/run_smoke_battery.sh` passed boot invariants plus `svg-gravity`, `svg-gravity-improved-scoring`, `svg-steprepeat`, and `svg-export-pdf`.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.7.0-mac-arm64.dmg"` passed; checksum valid.
  - App bundle Info.plist reports `CFBundleName=Deepnest ML`, `CFBundleShortVersionString=0.7.0`, and `CFBundleVersion=0.7.0`.
  - Packaged `app.asar` contains `package.json` version `0.7.0` and title `Deepnest ML 0.7.0`.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Bump stable app version and rebuild` claim.

### 2026-04-23 - Toggleable improved placement scoring (Codex)

- Added `improvedPlacementScoring` as a persisted config key, defaulting to `false`.
- Added a Settings checkbox labeled `Experimental scoring / Prefer cleaner remnants`; Step & Repeat disables it with the rest of the compactness-oriented controls.
- Added `improvedPlacementScore(...)` in `main/background.js`. When enabled, candidate placement scoring gets a small normalized remnant-quality adjustment that:
  - prefers compact footprints.
  - penalizes tiny unusable sliver gaps near sheet edges.
  - favors footprints anchored to sheet edges so leftover material is more continuous.
- Classic scoring remains unchanged when the toggle is off. Step & Repeat remains deterministic and ignores the toggle.
- Added `ml/smoke/scenarios/svg-gravity-improved-scoring.json` and included it in `ml/scripts/run_smoke_battery.sh`.
- Geometry extraction, NFP generation, native Minkowski code, import/export structure, and UI workflows are unchanged.
- Verification:
  - `node --check main/background.js`, `node --check main/deepnest.js`, `node --check main.js`, and `node --check ml/app-smoke-main.js` passed.
  - Inline executable scripts in `main/index.html` parse with `new Function(...)`.
  - Scenario JSON and smoke shell syntax checks passed.
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-scoring bash ml/scripts/run_smoke_battery.sh` passed boot invariants plus `svg-gravity`, `svg-gravity-improved-scoring`, `svg-steprepeat`, and `svg-export-pdf`.
  - Verified `/tmp/deepnest-smoke-scoring/svg-export-pdf/export.pdf` starts with `%PDF-1.7`.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains `improvedPlacementScoring`, `improvedPlacementScore`, and the Settings toggle.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Add toggleable improved placement scoring` claim.

### 2026-04-23 - App smoke scenario battery (Codex)

- Added scenario-driven app smoke support to `ml/app-smoke-main.js`, including `--scenario`, scenario JSON loading, temporary renderer config overrides, and legacy-compatible local conversion IPC for smoke-only PDF export.
- Added `ml/smoke/scenarios/svg-gravity.json`, `ml/smoke/scenarios/svg-steprepeat.json`, and `ml/smoke/scenarios/svg-export-pdf.json`.
- Added `ml/scripts/run_smoke_battery.sh` and `npm run legacy:smoke-battery` to run boot invariants plus the three app-path scenarios.
- Updated the renderer automation hook in `main/index.html` so smoke scenarios can:
  - apply non-persistent `configOverrides` such as `placementType: "gravity"` or `placementType: "steprepeat"`.
  - export SVG or PDF.
  - use a legacy `conversion-run-sync` fallback when `ipcRenderer.invoke` is unavailable.
  - write PDF bytes as a `Buffer` instead of a `Uint8Array`, fixing a legacy-runtime malformed-PDF smoke artifact.
- Geometry, placement, NFP math, native Minkowski code, normal UI import behavior, and normal nesting behavior are unchanged.
- Verification:
  - `node --check ml/app-smoke-main.js`, `node --check main.js`, `node --check main/deepnest.js`, and `node --check main/background.js` passed.
  - Inline executable scripts in `main/index.html` parse with `new Function(...)`.
  - `node ml/tests/parallel_ga/repro.js` still passed all dispatcher cases.
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-battery bash ml/scripts/run_smoke_battery.sh` passed boot invariants plus `svg-gravity`, `svg-steprepeat`, and `svg-export-pdf`.
  - Verified `/tmp/deepnest-smoke-battery/svg-export-pdf/export.pdf` starts with `%PDF-1.7`.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains the renderer automation fallback and config override code.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Expand app smoke scenario harness` claim.

### 2026-04-23 - Parallel GA dispatcher review findings resolved (Codex)

- Took over the paused Claude-Cowork parallel-GA follow-up lane by explicit user instruction while Claude was offline.
- Added `main/background-dispatcher.js` as a small production dispatcher module so the queue, pool, orphan-response, and worker replacement logic can be shared by the real app and tests.
- Updated `main.js` to delegate background worker lifecycle to the dispatcher; crashed idle workers are now removed from the pool and replaced, so truthy dead `BrowserWindow` slots cannot permanently reduce capacity.
- Updated `ml/tests/parallel_ga/repro.js` to import the production dispatcher instead of mirroring the dispatcher implementation, and added an idle-crash replacement case.
- Verification:
  - `node --check main/background-dispatcher.js`, `node --check main.js`, and `node --check ml/tests/parallel_ga/repro.js` passed.
  - `node --check main/background.js`, `node --check main/deepnest.js`, and `node --check ml/app-smoke-main.js` passed.
  - `node ml/tests/parallel_ga/repro.js` passed all dispatcher cases.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - `bash ml/scripts/run_app_smoke_test.sh --input ml/examples/app-smoke.svg ...` completed successfully and exported `/tmp/deepnest-smoke-dispatcher/out.svg`.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains `main/background-dispatcher.js` and the `main.js` dispatcher wiring.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Resolve parallel GA review findings and verify` claim.

### 2026-04-23 - Diverse GA seed population (Codex)

- Improved the first GA generation in `main/deepnest.js` by adding unique deterministic seed orderings before filling the rest of the population with normal mutations.
- Seed orderings now include the existing area-first ordering plus max-dimension-first, width-first, height-first, wide-aspect-first, tall-aspect-first, and source-order variants when they are meaningfully distinct.
- Added a few structured rotation seeds while respecting the configured rotation granularity; invalid 90/180 degree seeds are skipped when the selected `rotations` value cannot represent those angles.
- Geometry, placement scoring, NFP math, native Minkowski code, import/export behavior, Step & Repeat behavior, ML selection behavior, and the existing mutation/mating loop are unchanged.
- Verification:
  - `node --check main/deepnest.js`, `node --check main.js`, and `node --check ml/app-smoke-main.js` passed.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - `bash ml/scripts/run_app_smoke_test.sh --input ml/examples/app-smoke.svg ...` completed successfully and exported `/tmp/deepnest-smoke-seeds/out.svg`.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains `seedPlacements`, `seedRotations`, and `partMetric`.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Add diverse GA seed population` claim.

### 2026-04-23 - Bounded parallel GA evaluation (Codex)

- Re-enabled the existing `threads` setting for compactness-driven nesting by changing `main/deepnest.js` from one active GA individual at a time to a bounded worker limit (`1..8`, Step & Repeat remains deterministic single-shot).
- Added a hidden background-window pool and FIFO dispatch queue in `main.js` so candidate layouts are not silently dropped when all workers are busy.
- Mirrored a single-worker queue in `ml/app-smoke-main.js` so smoke tests still serialize safely while exercising the updated renderer dispatch behavior.
- Geometry, placement scoring, NFP math, native Minkowski code, import/export behavior, Step & Repeat behavior, and ML selection behavior are unchanged.
- Verification:
  - `node --check main.js`, `node --check main/deepnest.js`, `node --check main/background.js`, and `node --check ml/app-smoke-main.js` passed.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - `bash ml/scripts/run_app_smoke_test.sh --input ml/examples/app-smoke.svg ...` completed successfully and exported `/tmp/deepnest-smoke-parallel/out.svg`.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains the new background queue and `workerLimit` code.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Enable bounded parallel GA evaluation` claim.

### 2026-04-23 - Persistent bounded NFP LRU cache (Codex)

- Added a persistent NFP cache in `main/background.js` with:
  - geometry-fingerprinted keys, not source-id-only keys, so persisted entries cannot be reused across unrelated jobs with matching part indexes.
  - memory cache plus on-disk JSON entries.
  - `manifest-v2.json` metadata.
  - bounded pruning at 2,500 entries or 128 MB by least-recently-used access time.
- Added `nfp-cache-path-sync` in `main.js` so the real app stores cache files under the app `userData` directory instead of the app bundle or project folder.
- Added the same cache-path IPC to `ml/app-smoke-main.js` so smoke tests exercise the same background path.
- Kept the old `deleteCache()` renderer hook in `main/index.html` as a no-op; persistent cache pruning now owns cleanup.
- Geometry, placement scoring, native Minkowski code, and ML behavior are unchanged.
- Verification:
  - `node --check main/background.js`, `node --check main.js`, and `node --check ml/app-smoke-main.js` passed.
  - Inline `main/index.html` scripts parse with `new Function(...)`.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - `bash ml/scripts/run_app_smoke_test.sh --input ml/examples/app-smoke.svg ...` completed successfully and wrote cache entries plus `manifest-v2.json` under `~/Library/Application Support/Electron/nfpcache` in the smoke harness environment.
  - Re-running the same smoke job completed successfully with existing cache files present.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains `NFP_CACHE_MAX_ENTRIES`, `nfp-cache-path-sync`, `polygonFingerprint`, and `manifest-v2.json`.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Add persistent bounded NFP LRU cache` claim.

### 2026-04-20 - SVG vector fills normalized to wireframe (Codex)

- Updated imported-part SVG presentation normalization in `main/deepnest.js` so non-image vector elements are process-line geometry only: `fill="none"`, explicit stroke color, `stroke-width="1"`, and `vector-effect="non-scaling-stroke"`.
- Bitmap `<image>` elements are intentionally untouched; they remain the only filled/printed artwork.
- If a vector element had fill color but no usable stroke, that fill color is reused as the wireframe stroke so cut/engrave color metadata remains visible without rendering a filled vector area.
- Geometry, placement, NFP, native code, and ML paths are unchanged.
- Verification:
  - Inline `main/index.html` scripts parse with `new Function(...)`.
  - `node --check main/deepnest.js`, `node --check main/nest-zoom.js`, and `node --check ml/boot-check-main.js` passed.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - One-off Electron import check loaded `/Volumes/vacards-tn/tarjetas-nas/LaserCut/6679-6744.svg` through `window.DeepNest.importsvg(...)`; result was 4 imported parts, all non-image part SVG elements had `fill="none"`, unique imported stroke widths were `["1"]`, and no inline styles still contained `fill`, `stroke`, or `stroke-width`.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains the vector wireframe normalization code.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Normalize vector fills to wireframe and rebuild` claim.

### 2026-04-20 - Imported SVG stroke widths normalized (Codex)

- Diagnosed thick outlines in `/Volumes/vacards-tn/tarjetas-nas/LaserCut/6679-6744.svg`: the source uses class-based `stroke-width:16.88`; the nest display applies non-scaling strokes, causing that imported width to render as a very thick screen stroke.
- Added imported-part SVG presentation normalization in `main/deepnest.js`: stroked vector elements now keep their stroke/fill colors but get `stroke-width="1"` and `vector-effect="non-scaling-stroke"`. Inline `style` `stroke-width` entries are removed.
- This is intentionally metadata/presentation-only: polygon geometry, placement, NFP, spacing, and native code are unchanged.
- Verification:
  - Inline `main/index.html` scripts parse with `new Function(...)`.
  - `node --check main/deepnest.js`, `node --check main/nest-zoom.js`, and `node --check ml/boot-check-main.js` passed.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - One-off Electron import check loaded `6679-6744.svg` through `window.DeepNest.importsvg(...)`; result was 4 imported parts, unique imported stroke widths were `["1"]`, and no inline styles still contained `stroke-width`.
  - Rebuilt with `npm run dist`; confirmed packaged `app.asar` contains the normalization code.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Normalize imported SVG stroke widths and rebuild` claim.

### 2026-04-20 - Packaged zoom control text artifacts fixed (Codex)

- Fixed mojibake in the packaged nest zoom toolbar (`âˆ’`, `â¤¢`) by adding `<meta charset="utf-8" />` to `main/index.html`.
- Replaced the literal Unicode zoom toolbar labels with ASCII-safe labels: `-`, `1:1`, `+`, `Fit`.
- Rebuilt with `npm run dist`, refreshing `dist/mac-arm64/Deepnest ML.app`, `dist/Deepnest ML-0.6.1-mac-arm64.dmg`, and the blockmap.
- Verification:
  - Inline `main/index.html` scripts parse with `new Function(...)`.
  - `node --check main/nest-zoom.js`, `node --check main/deepnest.js`, and `node --check ml/boot-check-main.js` passed.
  - `bash ml/scripts/run_boot_check.sh` passed with no failed invariants.
  - Confirmed packaged `app.asar` contains the UTF-8 meta tag and ASCII-safe zoom labels.
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
  - `codesign --verify --deep --strict --verbose=1 "dist/mac-arm64/Deepnest ML.app"` passed.
- Packaging remains ad-hoc signed and not notarized.
- Released the `Fix packaged zoom control text artifacts and rebuild` claim.

### 2026-04-20 - 0.6.1 app build refreshed (Codex)

- Rebuilt the native addon with `npm run build:arm64`; `build/Release/addon.node` is `Mach-O 64-bit bundle arm64`.
- Packaged the app with `npm run dist`.
- Refreshed artifacts:
  - `dist/mac-arm64/Deepnest ML.app` (~270 MB)
  - `dist/Deepnest ML-0.6.1-mac-arm64.dmg` (~101 MB)
  - `dist/Deepnest ML-0.6.1-mac-arm64.dmg.blockmap` (~109 KB)
- Verification:
  - `hdiutil verify "dist/Deepnest ML-0.6.1-mac-arm64.dmg"` passed; checksum valid.
  - `codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Deepnest ML.app"` passed.
  - App bundle Info.plist reports `CFBundleName=Deepnest ML`, `CFBundleIdentifier=com.deepnest.ml`, `CFBundleShortVersionString=0.6.1`, `CFBundleVersion=0.6.1`.
- Packaging used ad-hoc signing; notarization remains not configured.
- Stopped the running development Electron process before building. Did not launch the packaged app after building.
- Released the `Build 0.6.1 app artifact` claim.

### 2026-04-20 - Stale nest state fix after part changes (Codex)

- Diagnosed the new-session size/spacing bug: `DeepNest.stop()` left the old GA population and `DeepNest.nests` in memory, and `DeepNest.start()` only rebuilt the population when `GA === null`. After deleting/importing parts, a later Start could reuse old source ids, rotations, sheet geometry, and stale rendered `#part{id}` / `#sheet{id}` groups.
- Added renderer helpers in `main/index.html` to invalidate the current nest session when part data changes: import, delete row/delete selected, import delete, quantity change, sheet checkbox change, link-quantity toggle, rectangle add, and part-list sorting now clear stale nests, stop any running worker, clear the nest SVG, disable export, and return the workspace to inspect mode.
- `beginNestWithConfig(...)` now prepares a fresh run before every new Start, so the visible app always rebuilds a new nest from the current part list.
- Hardened `main/deepnest.js` so `DeepNest.start()` itself clears any old worker timer, GA population, and `nests` array before building a new run. This protects automation/direct callers, not just UI clicks.
- Removed a duplicate legacy delete handler block in `main/index.html` that was registering a second delete listener with older behavior.
- Verification: inline `main/index.html` scripts parse with `new Function(...)`; `node --check main/deepnest.js`; `node --check main/nest-zoom.js`; `node --check ml/boot-check-main.js`; `bash ml/scripts/run_boot_check.sh` passed with `status: "passed"` and no failed invariants.
- Restarted the full Electron app with logs mirrored to `/tmp/deepnest-logs/latest.log`; startup reached `background ready` / `background did-finish-load` with no new renderer boot errors observed.
- Not verified: manual reproduce loop (`nest -> stop -> delete/import -> nest`) needs user confirmation in the reopened app.
- Released the `Clear stale nest/GA state when parts change or a new run starts` claim.

### 2026-04-20 - Nest topbar state fix (Codex)

- Diagnosed the missing `Stop nest` button while nesting. Root cause: home-tab navigation rewrote `#home.className = 'page active'`, which stripped the runtime `nest-session-active` class. The old nest canvas could remain visible through `#nest.active`, while topbar visibility fell back to inspect mode and showed `Start nest`.
- Split topbar visibility into two classes in `main/index.html` / `main/style.css`: `nest-session-active` means a nest/result workspace exists; `nest-run-active` means the optimizer is currently running.
- The `Stop nest` button now appears only while `nest-run-active` is set. `Start nest` returns after stopping, while Export/Reset remain available when a result exists.
- Removed the older `#stopnest` self-mutation into a fake `Start nest` button; restart now uses the real `#startnest` button.
- Changed side-tab switching to use `classList.remove('active')` / `classList.add('active')` so it preserves runtime state classes on pages.
- Verification: inline `main/index.html` scripts parse with `new Function(...)`; `node --check main/nest-zoom.js`; `node --check ml/boot-check-main.js`; `bash ml/scripts/run_boot_check.sh` passed with `status: "passed"` and no failed invariants.
- Not verified: a manual live import/start/stop pass after the patch. The full app is currently running from `npm start`; no app restart was forced.
- Released the `Stabilize nest topbar start/stop/export state` claim.

### 2026-04-19 - NestZoom initialization timing fix (Codex)

- Diagnosed why zoom buttons were visible but inert: `initNestZoom()` ran at the top of `ready(...)` before Ractive rendered `#nestdisplay .nestscroll`, so `main/nest-zoom.js` logged `initNestZoom: required nodes missing` and returned `null`.
- Moved the `window.NestZoom = window.initNestZoom(...)` call in `main/index.html` to immediately after the main Ractive `#homecontent` template is constructed.
- Verification: `node --check main/nest-zoom.js`, `node --check ml/boot-check-main.js`, and `bash ml/scripts/run_boot_check.sh` pass. Boot-check now reports `status: "passed"`, `failedInvariants: []`, elapsed about 498ms.
- Restarted the full Electron app with logs mirrored to `/tmp/deepnest-logs/latest.log`; startup completed without the previous `required nodes missing` warning.
- No nesting engine, native addon, import, export, or ML code changed. Released the `Fix NestZoom initialization timing` claim.

### 2026-04-19 - Nest zoom + free pan (Claude-Cowork → Codex handoff)

- Feature: per-user request, restored zoom + free pan on the nesting page. Preserves engine isolation — the nesting GA in the hidden background renderer is not touched, no IPC surface changed, and displayNest continues to write SVG markup on every worker message. Only the foreground `#nestdisplay` subtree was modified.
- Architecture (after expert review + user sign-off):
  - `#nestdisplay` becomes the non-scrolling viewport (`overflow: hidden`).
  - New inner `.nestscroll` child owns scrolling (`overflow: auto`) and receives the svg markup.
  - New sibling `.nest-zoomtools` overlay holds zoom in/out/reset/fit buttons, absolutely positioned top-right so it stays put while panning.
  - Deliberately scoped class name — there is already a global `.zoomtools` at `main/style.css:1387` used by import previews and bitmap contour controls, so the new name avoids collision.
  - Zoom is expressed as inline `svg.style.width = (100 * zoom) + '%'`, which overrides the `width="100%"` attribute that displayNest writes on every incremental redraw (SVG2 cascade). This is why incremental worker output does not fight the user's zoom level.
- Files touched:
  - `main/index.html`:
    - new `<script src="nest-zoom.js">` include.
    - template (`#nestdisplay`): added `.nestscroll` + `.nest-zoomtools` children around line 3523.
    - `displayNest` init: `document.querySelector('#nestdisplay').innerHTML = …` → `… #nestdisplay .nestscroll …` (around line 3091).
    - `displayNest` tail: after the `setAttribute('width', '100%')` block, call `window.NestZoom.applyToSvg(svg)` to re-apply the current zoom (around line 3200).
    - Back-button reset path: `… #nestdisplay .nestscroll …` and `window.NestZoom.reset()` (around line 2197).
    - `ready()` entrypoint: `window.NestZoom = window.initNestZoom({ viewport: '#nestdisplay', scroller: '#nestdisplay .nestscroll', toolbar: '#nestdisplay .nest-zoomtools' })`.
  - `main/style.css`: patched BOTH `#nestdisplay` rules (the earlier overridden one at line 1676 and the active one at line 2331) to `overflow: hidden`; added `#nestdisplay .nestscroll`, `#nestdisplay .nest-zoomtools`, grab/grabbing cursor rules, and `vector-effect: non-scaling-stroke` on `svg g.sheet`.
  - `main/nest-zoom.js` (new, ~290 lines): self-contained controller. Public API: `setZoom`, `zoomIn`, `zoomOut`, `reset`, `fit`, `applyToSvg`, `getZoom`. Features: wheel + ctrl/meta zoom at cursor (deltaY → `exp(-deltaY * 0.0015)`), plain wheel scrolls natively, `+`/`-`/`0`/`f` keyboard shortcuts (guarded against input/textarea/contenteditable focus, and only while the home tab is active), space-drag and middle-mouse drag to pan. All zoom-handled events call `preventDefault` — belt-and-suspenders against Electron `webFrame.setVisualZoomLevelLimits(1,1)`.
  - `ml/boot-check-main.js`: added renderer-side snapshot of `#nestdisplay .nestscroll`, `#nestdisplay .nest-zoomtools`, `#nestdisplay` computed overflow, `.nestscroll` computed overflow, `window.NestZoom` API shape and initial zoom. Added matching invariants so a regression fails boot-check.
- Verification (Claude-Cowork, this session):
  - `node --check main/nest-zoom.js` passes.
  - `node --check ml/boot-check-main.js` passes.
  - `node --check main/deepnest.js` passes.
  - Parsed inline JS of `main/index.html` with `new Function()` — single 102k-char block parses clean.
  - CSS brace balance clean (max nesting 2, all balanced).
  - `node ml/tests/sheet_id_collision/repro.js` still exits 0.
  - No live Electron run (runtime topology).
- Codex: please run `bash ml/scripts/run_boot_check.sh` on the Mac, then `npm start`. Expected behavior:
  - Boot-check: `status: "passed"`, with the new invariants (`hasNestScroll`, `hasNestZoomtools`, `nestDisplayOverflow === 'hidden'`, `nestScrollOverflow === 'auto'`, `NestZoom API present`, `NestZoom initial zoom is 1`) all green.
  - Live app: start a nest. On the nesting page:
    - trackpad pinch (ctrl+wheel on macOS) or ctrl/⌘ + scroll → zooms at cursor.
    - two-finger scroll → pans natively (no zoom).
    - `+` / `-` / `0` / `f` step / reset / fit zoom. Keyboard shortcuts are ignored when focus is in an input/textarea.
    - space + drag or middle-click drag pans.
    - zoom tools overlay top-right stays put while you pan.
    - sheets still render their boundary rectangles and parts still lay out correctly through the full nest run — incremental redraws should keep the user's current zoom.
  - If anything regresses (sheet boundaries, placement math, worker progress), paste the renderer console and the diff between `allplacements` before/after a worker message here; the controller is self-contained and easy to disable by removing the `<script src="nest-zoom.js">` include as a quick A/B.
- No ML, native, import, or export paths touched. No ML checkpoint needed.
- Released the `Nest zoom + free pan` claim.

### 2026-04-19 - First-sheet-boundary bug fix (Claude-Cowork → Codex handoff)

- Reported by user: when nesting a sheet part with quantity >= 2, the renderer draws a boundary around only the LAST sheet. Parts on the first sheet still lay out, but the enclosing rect is missing. Screenshot confirmed two sheets stacked vertically, top sheet has parts but no outline, bottom sheet has a clean outline.
- Root cause (confirmed by programmatic reproduction):
  - `main/deepnest.js` (sheet-setup block around line 1184) pushed the SAME `parts[i].polygontree` reference into the `sheets` array once per `parts[i].quantity`. `var poly = parts[i].polygontree` was assigned outside the inner `for(j=...)` loop, so every push shared one reference.
  - Electron IPC between the renderer and the background window uses the structured-clone algorithm. Structured clone preserves reference identity inside a single payload, so after `ipcRenderer.send(...)` deserialization, `data.sheets[0] === data.sheets[1]` was still `true`.
  - `main/background.js:141` then mutates `data.sheets[i].id = data.sheetids[i]` in a loop. On a shared object, the last assignment wins, so every entry ended up with `id = sid - 1`.
  - Both `placeParts` (line 1681) and `placePartsStepRepeat` (line 740) read `sheet.id` after this loop, so every placement pushed into `allplacements` came out with the same `sheetid`.
  - `displayNest` in `main/index.html` keys DOM groups by `#sheet<sheetid>`. The second placement found the first placement's group, skipped the `if(!groupelement)` branch that appends boundary geometry, then overwrote the transform. Result: one sheet group in the DOM, positioned at the second placement's location; first sheet has parts but no underlying boundary.
- Fix (minimal, upstream at the push site):
  - `main/deepnest.js`: moved `var poly = this.cloneTree(parts[i].polygontree)` INSIDE the `for(j=0; j<parts[i].quantity; j++)` loop. Now each sheet instance is a distinct polygon tree, so structured-clone IPC cannot alias them and the `id`/`source`/`children` assignments in `background.js` cannot mutate a shared target.
  - Mirrors the pattern already used for non-sheet parts (`adam` construction around line 1120 already calls `cloneTree` per `j` iteration).
  - No renderer change. `displayNest` did not need modification once the upstream `sheetid` uniqueness invariant was restored.
- Regression test:
  - New `ml/tests/sheet_id_collision/repro.js`. Runs two cases (same-reference vs `cloneTree`-per-instance) through a Node structured-clone round-trip (`v8.serialize` / `v8.deserialize`, same algorithm Electron IPC uses).
  - Asserts the buggy pattern collapses both placements to the same `sheetid`, and the fixed pattern preserves unique ids.
  - Run with: `node ml/tests/sheet_id_collision/repro.js`. Both cases pass in this session.
- Verification (Claude-Cowork, this session):
  - `node --check main/deepnest.js` passes.
  - `node ml/tests/sheet_id_collision/repro.js` exits 0: "All cases passed."
  - Did NOT run live Electron — see runtime topology. Handed off to Codex.
- Codex: please run `npm start` on the Mac, import any SVG with parts, add a rectangular sheet with quantity >= 2, and run Start Nest. Expected: both sheets now render their boundary rectangle AND their placed parts. If only one boundary still appears, paste the `allplacements` shape (can be dumped from the renderer devtools) back here so I can re-check the displayNest path. Also worth a quick check that the single-sheet case (quantity == 1) still renders normally.
- No ML/native/import/export paths were touched. ML checkpoint not needed.
- Released the `Fix first-sheet boundary` claim.

### 2026-04-19 - Boot-check Mac verification + harness fix (Codex)

- Ran `bash ml/scripts/run_boot_check.sh` on the Mac. Initial result: exit 2 timeout because `main/index.html` sent synchronous `settings-op-sync` before `window.DeepNest` could initialize, but `ml/boot-check-main.js` did not install that IPC handler.
- Updated `ml/boot-check-main.js` with a narrow harness-local clone of the real `settings-op-sync` handler from `main.js`, backed by `electron-settings`.
- Isolated boot-check preferences by setting Electron `userData` to a temporary directory before requiring `electron-settings`; this prevents the check from reading or mutating the user's real Deepnest ML config.
- Adjusted the option-default invariants to check HTML `option[selected]` markup, not runtime selected values. The app's runtime default config still sets `placementType: "box"`, so asserting the active select value as Gravity was a false failure.
- Updated `ml/scripts/run_boot_check.sh` so the wrapper still prints the JSON verdict when Electron exits nonzero.
- Verification: `node --check ml/boot-check-main.js`, `bash -n ml/scripts/run_boot_check.sh`, and `bash ml/scripts/run_boot_check.sh` all pass. Final boot-check verdict: `status: "passed"`, `failedInvariants: []`, elapsed about 595ms.
- No app UI, nesting, native, import, or export behavior changed. Released the `Fix boot-check IPC wrapper` claim.

### 2026-04-18 - Boot-check harness (Claude-Cowork → Codex handoff)

- Added a headless boot-check that validates UI invariants without touching the native addon or the nesting pipeline. Deliverables:
  - `ml/boot-check-main.js` — standalone Electron main process (~280 lines). Opens `main/index.html` hidden, polls for `window.DeepNest` + `window.DeepNestAutomation`, runs an invariants snapshot via `webContents.executeJavaScript`, writes a JSON verdict, exits with a meaningful code.
  - `ml/scripts/run_boot_check.sh` — thin shell wrapper. Uses `node_modules/.bin/electron` (the same binary `npm start` uses), **not** the legacy 1.4.13 Rosetta binary used by `run_app_smoke_test.sh`. Defaults report path to `/tmp/deepnest-logs/boot-check.json`, honors `BOOT_CHECK_TIMEOUT_MS`.
- Invariants covered (explicit guard for every UI change landed in this audit):
  - `document.title === "Deepnest ML 0.6.1"` (covers the title-version fix)
  - placementType select defaults to `gravity`, dxfImportScale to `1`, dxfExportScale to `72` (covers the three `default`→`selected` fixes)
  - no `<option>` element carries the invalid `default` attribute (covers regression of same)
  - sidenav `<li>` ids are exactly `[home_tab, config_tab, info_tab]` (covers orphan-tab removal)
  - export dropdown `<li>` ids are exactly `[exportsvg, exportpdf, exportdxf]` (covers Gcode-stub removal)
  - `#account` page and `#purchaseSingle` link are gone (covers orphan page removal)
  - `#home`, `#config`, `#info` pages are present
  - `window.DeepNest` and `window.DeepNestAutomation` are both present; `DeepNestAutomation` exposes `runAppSmokeTest`
- Exit codes: 0 pass, 1 invariants failed, 2 renderer readiness timeout, 3 renderer crash, 4 bad args / internal error.
- Verification (this session): `node --check ml/boot-check-main.js` and `bash -n ml/scripts/run_boot_check.sh` both pass. Could not run live — see runtime topology note. Handed off to Codex.
- Codex: please run `bash ml/scripts/run_boot_check.sh` on the Mac. Expected: all invariants pass, exit 0, a `/tmp/deepnest-logs/boot-check.json` file with `status: "passed"`. If anything is `status: "failed"`, paste the `failedInvariants` array and the `snapshot` field back into this conversation so I can interpret.
- No renderer code changed. `main/index.html` is unchanged by this addition.
- Released the `Boot-check script` claim.

### 2026-04-18 - UI_AUDIT P0.3 + P0.4 dead-code removal (Claude-Cowork)

- Removed dead UI shipping in the binary. Three surgical deletions:
  - `main/index.html`: orphan `<div id="account" class="page">` block (~4 lines) and its commented sidenav entry `<!--<li id="account_tab" ...>-->`.
  - `main/index.html`: commented `<!--<li id="exportgcode">GCode file</li>-->` dropdown entry and the 47-line commented `exportgcode.onclick` handler block (including its legacy `request.post(conversionServer)` call).
  - `main/style.css`: unreferenced `#account_tab` background-image rule (6 lines).
- Net: `main/index.html` dropped from 5,082 → 5,027 lines; `main/style.css` lost 7 lines.
- Verification (this session): programmatic invariants pass — title still `Deepnest ML 0.6.1`, 3 `selected` options intact, `DeepNestAutomation` hook intact, sidenav has home/config/info, all three export dropdown entries (SVG/PDF/DXF) present, page divs (`#home`, `#config`, `#info`) present, all dead IDs (`#account`, `#purchaseSingle`, `#account_tab`, `#exportgcode`) are fully gone. Remaining `conversionServer` references in `main/index.html` are the live DXF + PDF export paths plus the default config entry — expected.
- Not verified in this session: real Electron boot. Next `npm start` will be the end-to-end smoke for these removals; the user previously confirmed the prior round of edits booted cleanly.
- ML / native / `ml/` paths untouched; no ML checkpoint needed.
- Released the `UI_AUDIT P0.3 + P0.4 cleanup` claim. Removed the corresponding entry from Upcoming Work (UI_AUDIT P0.5 remains there).

### 2026-04-18 - Native vs JS NFP equivalence harness (Codex)

- Added `ml/tests/nfp_equivalence/README.md`, `run.js`, and `run.sh`.
- The harness runs under Electron-as-Node so `build/Release/addon.node` loads with the correct Electron ABI.
- It compares native `calculateNFP` output against the JavaScript Clipper Minkowski branch mirrored from `main/background.js`.
- Current fixtures cover rectangle/rectangle, triangle/rectangle, concave-L/rectangle, and irregular/irregular outer NFPs. Inner NFPs, holes, placement scoring, and renderer IPC are intentionally out of scope.
- Verification: `bash ml/tests/nfp_equivalence/run.sh` passed 4 fixtures; `node ml/tests/nfp_equivalence/run.js` returns a clear Electron-as-Node instruction instead of hitting the native ABI mismatch.
- No app behavior changed. `addon.cc`, `minkowski.cc`, `main/background.js`, and active nesting/export code were read only.
- Released the `Native vs JS NFP equivalence test` claim from Active Work.

### 2026-04-18 - Main-screen UI audit + 4 zero-risk fixes (Claude-Cowork)

- Wrote `UI_AUDIT.md` at repo root: P0/P1/P2/P3 findings on the main screen, plus a smoke-test expansion plan with proposed scenarios and CLI design.
- Applied 4 zero-risk edits to `main/index.html` only:
  - line 4: `<title>Deepnest ML 0.5</title>` → `<title>Deepnest ML 0.6.1</title>`
  - line 3756: `<option value="gravity" default>` → `<option value="gravity" selected>`
  - line 3837: `<option value="1" default>` → `<option value="1" selected>` (DXF import Points)
  - line 3848: `<option value="72" default>` → `<option value="72" selected>` (DXF export Points)
- Verification: re-read the 4 edited lines; targeted code-path inspection only. Did not run `npm start`, `npm run dist`, or the smoke harness. All edits are HTML-attribute-level and spec-conformant; visible behavior unchanged for first-option selects.
- ML / native / `ml/` paths untouched; no ML checkpoint needed.
- Released the `Main-screen UI audit + smoke harness expansion` claim from Active Work.
- Smoke harness expansion was scoped but not implemented; it is now in Upcoming Work as `Smoke-test harness scenario expansion` along with 4 new follow-up items derived from the audit (orphan account page removal, dual ML control collapse, Step & Repeat grouping, accessibility pass).
- Next suggested step: either Codex picks up the proposed NFP equivalence test, or whichever agent is next active picks the smoke-harness scenario expansion (medium-sized, well-scoped, no ML-sensitive files).

### 2026-04-18 - Protocol extended (Claude-Cowork)

- Added `Agent Identity And Conventions` section (naming, stale-claim expiry at 4 hours, scope qualifiers, commit attribution, timestamp format).
- Added `Touch With Care (ML-Sensitive Files)` subsection under `Active Code Path`, mirroring the ML Protection Rule from the README.
- Added `Working Tree State` section above `Active Work` so either agent can signal a dirty tree.
- Added `Upcoming Work` and `Open Questions For User` sections.
- No app code changed. Verified by re-reading the file; no other files touched.
- Next suggested step: Codex reviews the additions and pushes back on anything that conflicts with its own workflow assumptions.

### 2026-04-18 - Collaboration file created

- Added this file as the shared handoff/protocol for Codex and Claude Code.
- No app code changed.
- If another agent starts work, it should replace the `_none_` row in Active Work with a concise claim.

## Verification Expectations

There are limited automated tests in this repo. For most changes, record:

- targeted code-path inspection performed
- whether `npm start` was run
- whether `npm run dist` was run
- manual import/nest/export checks performed, if any
- workflows not checked

## Conflict Protocol

If two agents need the same file:

1. Pause before editing.
2. Read the current file contents.
3. Check Active Work above.
4. Add a note describing the conflict.
5. Ask the user which agent should proceed, unless the user already gave explicit ownership.

## Suggested Handoff Format

```text
Agent:
Task:
Files touched:
Behavior changed:
Verification:
Open risks:
Next suggested step:
```

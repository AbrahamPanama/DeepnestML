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
- Current version: `0.8.0`
- Local app artifact: `dist/mac-arm64/Deepnest ML.app`
- Local DMG artifact: `dist/Deepnest ML-0.8.0-mac-arm64.dmg`
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

State (verified 2026-07-26 by Codex): dirty by claimed SP-1..SP-5
verification; generated benchmark-result JSONs remain untracked by convention.

Use the format `State (verified YYYY-MM-DD by <agent>): <clean | dirty: reason>`. Re-stamp this line whenever you confirm or change tree state. If the stamp is more than a few hours old, treat it as untrusted and re-verify before editing.

## Active Work

Use this section to claim in-progress work.

| Agent | Task | Files / Area | Status | Updated |
| --- | --- | --- | --- | --- |
| Codex | SP-1..SP-5 superpart clustering end to end | `main/util/superpart.js`, `main/deepnest.js`, config/UI/export-by-expansion path, superpart tests/smoke/benchmarks, docs, `AGENT_COLLABORATION.md` | In progress. Tier 1 passed at defaults: used width 477.983 -> 394.258, 17.516% reduction, legal visible interlock. Tier 2 corpus rerun pending after dimensional legality-audit correction; packaging and installed-app parity follow | 2026-07-26 |
| Codex | RC-1 raster collision module | `main/util/raster-collision.js`, renderer/background script loading, `ml/tests/raster_collision/`, `docs/raster-collision-plan.md`, `AGENT_COLLABORATION.md` | Completed measurement WP: 5,000-pair soundness green (0 unsafe); divisor-64 laurel ambiguity 55.8% fails off-ramp, so RC-2 blocked. Divisor 192 diagnostic passes at 32.52% but is not adopted without an explicit policy amendment | 2026-07-25 |
| Codex | Local Refinement v4 end-to-end | contact acceptance, fast legality/scoring, scaled coverage, windowed rebuild, gating review, tests/benchmarks/docs | Completed behind default-off flags; visual/equivalence/smoke gates green, but throughput, predicate-agreement, and full-corpus efficacy gates did not pass, so defaults remain unchanged | 2026-07-25 |
| Claude-Code | Quantity column: live placed-vs-requested badges | `main/index.html` (parts table + displayNest; no teacher-hook changes), `main/style.css`, `AGENT_COLLABORATION.md` | Completed: badge tallies from displayNest, clears via resetNestComputation; boot + focused smoke green | 2026-07-16 |
| Codex | Four-part continuous compaction efficacy | continuous refinement engine, exact 2+2 laurel fixture/smoke gate, `AGENT_COLLABORATION.md` | Completed: bounded whole-cluster rebuild produces a visibly tighter exact-legal result; deterministic and live-product gates green | 2026-07-10 |
| Codex | Continuous compaction compatibility gate | `main/util/configcompatibility.js`, `main/index.html`, `main/style.css`, `main/deepnest.js`, continuous-refinement tests, `AGENT_COLLABORATION.md` | Completed: prerequisites/conflicts enforced, hover/focus reasons exposed, UI + regression gates green | 2026-07-10 |
| Codex | Continuous local compaction postprocessor | `main/background.js`, refinement config/UI/style, oracle/tests/smoke, `AGENT_COLLABORATION.md` | Completed: fair critical-target scheduling + transactional neighbor-cluster reflow; dense and regression gates green | 2026-07-09 |
| Codex | Exact two-part pair compaction | `main/background.js`, engine/smoke tests, `AGENT_COLLABORATION.md` | Completed: exact NFP/outline contact search; same-handed laurel improves 13.3%; all regression gates green | 2026-07-09 |
| Codex | Smart rotation + neighbor reflow | `main/background.js`, refinement config/UI/CLI, engine tests/smoke, `AGENT_COLLABORATION.md` | Completed: post-stage transactional reflow, exact rollback, UI control, benchmark/equivalence/smoke green | 2026-07-09 |
| Codex | Adaptive rotation symmetry follow-up | `main/util/rotationutil.js`, `main/deepnest.js`, adaptive tests/smoke, `AGENT_COLLABORATION.md` | Completed: symmetric slotted parts use four unique axes; target and regression gates green | 2026-07-09 |
| Codex | Adaptive per-part placement rotations | `main/util/rotationutil.js`, `main/deepnest.js`, `main/background.js`, `main/index.html`, benchmark/test/smoke coverage, `AGENT_COLLABORATION.md` | Completed: default-on bounded geometry angles + sibling alignment; exact NFP gate and A/B green | 2026-07-09 |
| Codex | LR fine rotation visible acceptance follow-up | `main/background.js`, `ml/tests/engine_bugfixes/run.js`, `AGENT_COLLABORATION.md`, smoke reports | Completed: legal fine rotations can be accepted visibly with exact collision gates intact | 2026-07-09 |
| Codex | LR fine rotation Phase 0/1 | `main/background.js`, `main/deepnest.js`, `main/index.html`, `ml/cli/run_benchmark.js`, `ml/tests/engine_bugfixes/`, smoke/benchmark reports, `AGENT_COLLABORATION.md` | Completed: Phase 0 guard and Phase 1 default-off centroid operator landed; benchmark safety green, no accepted fine moves on bounded trio | 2026-07-08 |
| Codex | PERF-P4 mergeLines top-k credit cap | `main/background.js`, `main/deepnest.js`, `main/index.html`, `ml/cli/run_benchmark.js`, smoke scenario, engine tests, benchmark/equivalence reports, `AGENT_COLLABORATION.md` | Completed: hidden default-off cap landed; flag-off equivalence green; flag-on benchmark borderline-green at cap64 | 2026-07-08 |
| Codex | PERF-P5 geometry-once dispatch | `main/deepnest.js`, `main/background.js`, IPC hosts, geometry broker tests, benchmark/equivalence reports, `AGENT_COLLABORATION.md` | Completed: token geometry dispatch landed; refinement token path verified; equivalence/smoke/benchmark green | 2026-07-08 |
| Codex | PERF-P6 batched NFP warm (pre-pass first) | `main/background.js`, `main.js`, `ml/app-smoke-main.js`, `ml/teacher-main.js`, engine tests, benchmark/equivalence reports, `AGENT_COLLABORATION.md` | Completed: batch find IPC + pre-pass warm landed; telemetry proves path; equivalence/smoke/teacher/benchmark green | 2026-07-08 |
| Codex | PERF-P3 hull candidate hoists | `main/background.js`, `ml/scripts/run_smoke_battery.sh`, benchmark/equivalence reports, `AGENT_COLLABORATION.md` | Completed: candidate/sheet hull reuse landed; `svg-hull` in default smoke battery; equivalence/smoke/benchmark green | 2026-07-08 |
| Codex | PERF-P1 fingerprint memoization | `main/background.js`, `ml/tests/engine_bugfixes/run.js`, benchmark/equivalence reports, `AGENT_COLLABORATION.md` | Completed: non-enumerable fingerprint memo landed; targeted tests + equivalence/smoke/benchmark green | 2026-07-08 |
| Codex | PERF-P2 hot-loop logging + timing telemetry | `main/background.js`, `ml/cli/run_benchmark.js`, smoke/equivalence/benchmark reports, `AGENT_COLLABORATION.md` | Completed: hot-loop logs removed; placement timing persisted in smoke + benchmark JSONs; equivalence gate green | 2026-07-08 |
| Codex | PERF-P0 baseline freeze + pre-pass cache-key fix | `package-lock.json`, `main/background.js`, `main/deepnest.js`, smoke/equivalence coverage, `AGENT_COLLABORATION.md` | Completed: baseline frozen; processHoles key/telemetry gate passed; exact benchmark command still fails on `shirts` before first nest | 2026-07-07 |
| Claude-Code | LRv3-S1 completion: convexhull support + candidate/legality fixes + fixture gates | `main/background.js` (smart engine), gate scenario runs | Completed: machinery landed and verified (battery green); capture gate not yet demonstrated — see plan §1.9.4 and handoff note | 2026-06-11 |
| Codex | LRv3-S1 legality predicate + settle pass | `main/util/separation.js`, `main/background.js`, `ml/tests/separation/`, `docs/local-refinement-v3-plan.md`, `AGENT_COLLABORATION.md`, benchmark result files | Completed: implementation landed; ESICUP gate failed/no floaters; visual laurel fixture still needed | 2026-06-11 |
| Codex | LRv3-R3-promoted relocate + swap | `main/background.js`, `docs/local-refinement-v3-plan.md`, `AGENT_COLLABORATION.md`, benchmark result files | Completed: implementation landed; substantive bounded gate failed; WP-R1 remains blocked | 2026-06-11 |
| Codex | LRv3-R0.3 clamp + axis-translation separator | `main/util/separation.js`, `main/background.js`, `ml/tests/separation/`, `docs/local-refinement-v3-plan.md`, `AGENT_COLLABORATION.md`, benchmark result files | Completed: implementation landed; substantive bounded gate failed; WP-R1 remains blocked | 2026-06-11 |
| Codex | LRv3-R0.2 exact-relocation separation | `main/background.js`, `docs/local-refinement-v3-plan.md`, `AGENT_COLLABORATION.md`, benchmark result files | Completed: implementation landed; substantive bounded gate failed; WP-R1 remains blocked | 2026-06-11 |
| Codex | LRv3-R0.1 virtual-sheet fix | `main/background.js`, `AGENT_COLLABORATION.md`, benchmark result files | Completed: bounded gate passed; full WP-2.2 corpus gate still pending | 2026-06-11 |
| Codex | Shrink-separate efficacy benchmark gate before WP-R1 | `ml/cli/run_benchmark.js`, `main/background.js`, `AGENT_COLLABORATION.md` | Completed: bounded check did not prove efficacy; pause WP-R1 pending diagnosis/full gate | 2026-06-11 |
| Codex | Local Refinement v3 prerequisites (WP-R0: SeparationUtil, equivalence harness, shrink-separate engine flag) | `main/util/separation.js`, `main/background.html`, `main/background.js`, `main/index.html`, `main/deepnest.js`, `ml/tests/separation/`, `ml/tests/engine_equivalence/`, `AGENT_COLLABORATION.md` | Completed; ready for review | 2026-06-11 |
| Codex | WP-1.1 fitness v2 gate investigation | `main/background.js`, `main/deepnest.js`, `main/index.html`, `ml/cli/run_benchmark.js`, `ml/tests/fitness_v2/`, `AGENT_COLLABORATION.md` | Blocked: flag-on gate failed; do not proceed to WP-1.2 yet | 2026-06-11 |
| Codex | TIFF-T1..T4 bitmap TIFF export + unified export modal | `scripts/conversion/local-convert.py`, `main.js`, `main/index.html`, `main/style.css`, `ml/boot-check-main.js`, `ml/tests/tiff_export/`, `AGENT_COLLABORATION.md` | Completed: implementation landed and headless verification passed; manual CMYK/profile GUI acceptance still pending | 2026-06-15 |

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
| Local Refinement v2 rotations | `main/background.js` | After v1 translation-only testing, consider tiny legal angle probes like ±1/±2/±5 degrees with aggressive caching — superseded by WP-2.3 of the SOTA plan below |
| Engine performance plan (PERF-P1…P7) | `docs/performance-plan.md` | Hot-path speed work, all output-identical or flagged: fingerprint memoization, hot-loop logging removal (+timing telemetry), hull candidate hoists, flagged mergeLines top-k credit cap, geometry-once dispatch (pull model via main-process broker — payloads drop from MBs to KBs per individual), batched NFP cache prefetch, refinement ring decimation. Equivalence harness is THE gate; benchmark before/after numbers required per WP. Order: P2→P1→P3→P6→P5→P4→P7 |
| Windows port (WIN-W1…W5) | `docs/windows-port-plan.md` | Ship a Windows x64 build preserving all features; mac stays unchanged. Three real risks: native addon (MSVC + header-only Boost.Polygon + `NOMINMAX`), the Python sidecar (bundle embeddable CPython + wheels for PDF/PNG/TIFF conversion), packaging (NSIS/portable, unsigned v1). JS layer is already platform-neutral. W1 compile / W2 bundling / W4 packaging need a Windows build host; W3 + config edits are Mac-authorable but must not regress the mac build. Claim WIN-W1…W5 from §10 |
| TIFF bitmap export + unified export modal (TIFF-T1…T4) | `docs/tiff-export-plan.md` | Export nested layouts as per-sheet raster TIFFs for print/RIP: outline-removal enum, top-indicator fiducial, ICC (RGB embed / CMYK convert+embed), via the existing PyMuPDF+Pillow converter (no new deps). Refactors the export menu into a CollageMaker-style modal (light theme). Export-only; not ML-sensitive as long as `placeParts`/vector-export defaults are untouched. Claim TIFF-T1…T4 from the plan's §10 |
| SOTA nesting engine (WP-0 … WP-4) | `docs/sota-nesting-implementation-plan.md` | Phased plan: benchmark harness → fitness v2 → separate-and-compact refinement (replaces slide Local Refinement) → `deepsearch` placement type → ML routing. Every WP lands behind a default-off flag with equivalence + benchmark gates. Claim individual WPs from the plan's §10 table |
| **Superpart clustering (SP-0 … SP-5)** | `docs/superpart-clustering-plan.md` | RECOMMENDED NEXT. Written 2026-07-25 by Claude-Code after six refinement mechanisms were built, verified, and found not to improve a nest. Routes around all three measured walls (legality, acceptance, local-vs-global) by obtaining the interlock angle OFFLINE by construction, then letting the existing NFP placer nest the mated pair as one rigid part - no hot-path changes. Has an explicit one-hour go/no-go at the FRONT (WP-SP-0 mating gain >= 5%, with an L-shape control), a definition of done the agent cannot fool itself about, an operating protocol in §9, and stop conditions in §10. Claim SP-x from §3-§8 |
| Direct-Clipper pose generator (DP-1 … DP-4) | `docs/direct-pose-generator-plan.md` | Written 2026-07-25 by Claude-Code; successor to the stopped raster plan. RC-2 measured exact Clipper collision at 19.3 us/pair, which prices 1-degree rotation at 8.7 ms/part (~0.9 s for 100 parts) with NO NFP and NO raster tier. The codebase can already VALIDATE off-grid angles; it cannot GENERATE good ones. DP-1 adds edge-mating, rotate-about-contact-then-slide, and sibling-alignment pose generation, ranked by contact score before exact validation. Expect the win on sparse/laurel fixtures, not the dense corpus - dense sheets are legality-limited. Claim DP-x from the plan's §6 table |
| Raster collision tier (RC-1 … RC-5) | `docs/raster-collision-plan.md` | STOPPED at RC-2 (2026-07-25). Soundness passed twice (6,000 randomised + 1,867 production pairs, zero unsafe), but the tier is 1.9x SLOWER than exact geometry on this workload: raster query 37.5 us/pair vs Clipper 19.3 us/pair, net 87 ms loss. Premise was wrong - after curveTolerance simplification these polygons are cheap for Clipper. RC-3..RC-5 cancelled. Module kept, inert, default-off. See plan §3.4; successor is the pose-generator plan above || Local Refinement v4 gate follow-up | `main/background.js`, benchmark corpus | WP-V4.1-V4.5 are implemented default-off. Gate status revised 2026-07-25: predicate disagreements are 100% in the SAFE direction (269 NFP-stricter, 0 material-stricter), so fast legality is safe — but it buys nothing because the exact check was already short-circuited, and the 10x throughput gate was mis-specified. The binding constraint on dense sheets is legality (~98% of candidates rejected before scoring), not acceptance or speed. Do not flip defaults; see the plan's "Follow-up findings". |
| Local Refinement v3 "smart" engine (WP-R1 … WP-R6) | `docs/local-refinement-v3-plan.md` | Approved 2026-06-11; supersedes SOTA WP-2.3. Prereqs: SOTA WP-2.1, WP-2.2, and the §8.3 equivalence harness. Contact-graph chain targeting, geometry-derived rotations with pivot rocking, void relocation, swaps, ruin-&-recreate under a budgeted orchestrator (`localRefinementEngine: 'smart'`, default stays 'slide') |

## Open Questions For User

Park decisions either agent cannot make alone. Resolve and clear when answered.

| Question | Asked By | Date |
| --- | --- | --- |
| _none_ | _n/a_ | _n/a_ |

## Handoff Notes

Use newest notes at the top.

### 2026-07-26 - Tier 2 numerical-contact audit correction (Codex)

- The first clean 23-instance compact-demand A/B stopped identically on both
  sides at `jakobs2` run 1. The off/on SVG SHA-256 and placement digest were
  byte-identical, proving this was not a superpart regression.
- The independent audit exposed a `3.4e-6`-unit-wide contact sliver
  (`4.7e-8` inch at the job scale). Its old fixed area threshold misclassified
  long floating-point contact as material overlap; area is dimensionally
  unsuitable for this decision.
- `ml/lib/esicup-convert.js` now uses 1e7 Clipper scaling and judges intersection
  by the minimum width of each exact intersection hull. The linear tolerance is
  `max(1e-7, stripHeight * 1e-7)`. Raw intersection area, penetration depth,
  tolerance, and numerical-contact count remain visible in every report.
- Adversarial tests prove the gate remains fail-closed: exact contact and a
  sub-tolerance floating sliver pass; a `0.0005`-deep overlap fails even though
  its area is below the old `1e-6` threshold; a 1-unit overlap also fails.
- Recomputed `jakobs2` result: legal, two numerical contacts, raw maximum area
  `1.92e-5`, maximum depth `3.4e-6`, tolerance `7.0007e-6`.
- A preflight over every compact-demand corpus source then exposed a real
  startup exception in `gardeyn4` source 4: Clipper's optional exact-union path
  threw `this.ParseFirstLeft is not a function`. `buildCollisionEnvelope` now
  records that exception and falls back to the already-required conservative
  convex hull. A fixture test proves both original members remain contained.
- The repaired preflight completed all 23 instances with zero exceptions and
  predicts production-threshold clustering in seven: `gardeyn4`, `gardeyn5`,
  `gardeyn6`, `gardeyn7`, `shapes0`, `shapes1`, and `swim`.
- The first restarted A/B exposed thousands of `Timer 'Total' already exists`
  warnings. `background.js` started that timer for every dispatch but ended it
  only when an NFP cache miss existed; its adjacent `pairs`/`in sync`/cache-count
  logs were also on the hot path. These stale diagnostics are removed.
  `engine_bugfixes` and the committed-output equivalence suite remain green.
- The next shared blocker was substantive: `fu` seed 1 placed a trapezoid 3 and
  8 units into two earlier parts. A fresh isolated profile reproduced the same
  digest, proving it was an active-engine NFP candidate leak rather than stale
  cache state. `placeParts` now runs an exact, hole-aware material backstop only
  when a candidate would become the current best, with bbox pruning and a
  sheet-relative numerical-contact tolerance.
- Three-seed focused `fu` off/on results are byte-equivalent and all legal;
  median utilization is `0.809578154`. The selected nests perform 41-47 exact
  candidate checks and 50-66 pair checks for only 0-2 ms total. The laurel
  efficacy replay remains exactly at `394.25818` used width, with two validated
  pairs, four expanded members, zero exact overlap, and 1 ms validation cost.

### 2026-07-26 - SP-1..SP-5 candidate reaches Tier 1 (Codex)

- Tier 1 is substantively green, not accept-count green: exact SP-0 hull mating
  gain is 18.634%; the default candidate reduces used width 477.983 -> 394.258
  (17.516%) and used-strip utilization rises 18.169% -> 22.027%. This recovers
  94.0% of theoretical gain against the required 60%.
- Three seeded 15-second production runs remain under the hard 410-unit gate:
  405.249, 394.261, and 394.261. The saved user-settings profile reaches
  406.212. Every run expands four original members, reports zero non-canonical
  NFP lookups, and passes both the in-engine fail-closed Clipper gate and an
  independent exported-SVG sweep with zero overlap/outside area.
- The initial placementType-specific pair objectives were measured and rejected:
  Gravity-linear and bbox pairing produced 462.640 and 452.989 units. Ranking
  the conservative convex-hull collision shell recovers the repeatedly observed
  9/5-degree pairs and the real 394-unit result.
- A small-job GA blind spot was fixed only when pairing is active: two synthetic
  parts previously exposed only two order seeds, never deterministic rotation
  presets 2-4. Clustered jobs now seed all four canonical patterns; flag-off
  remains byte-identical to `a00d17a` under an isolated, fixed-seed scenario.
- Tier 2 all-corpus, packaging, and installed-app production parity remain before
  completion. The separate RC-1 raster test still fails its documented 55.8%
  ambiguity off-ramp; that stopped/default-off experiment is not part of SP.

### 2026-07-26 - SP-0 superpart go/no-go passed; SP-1 integration claimed (Codex)

- Prediction recorded before execution: laurel mating gain >= 10%, L-shape
  control >= 20%; stop if the L control passed but laurel gain was below 5%.
- Exact SP-0 results (`ml/tests/superpart_gain/run.js`, 22,680 deterministic
  poses):
  - L control: 40.00% bbox gain, 18.18% hull gain, zero exact overlap.
  - Laurel bbox winner: 44.96% bbox gain but only 7.56% hull gain; rendered SVG
    exposed this as a large U-shaped enclosure, so it was rejected as a scoring
    artifact.
  - Laurel hull winner: 18.63% hull gain and 31.97% bbox gain at 9 degrees, zero
    exact overlap; rendered SVG shows the second branch occupying the first
    branch's concave interior rather than enclosing a large void.
  - Runtime: 181.7 s for laurel, contradicting the plan's ~0.5 s estimate. SP-1
    must recover the useful pose with bounded coarse-to-fine work.
- The active legacy part model accepts one outer component. Clipper union of the
  proven laurel members returns two components, so SP-2 cannot pass a
  disconnected union through as an ordinary part. Planned conservative
  representation: exact original members plus a minimal non-exported connector
  in the synthetic collision envelope; placements are expanded back to original
  members before display/export.
- Required pre-edit checkpoint attempted with
  `npm run ml:checkpoint -- --name superpart-clustering-pre`; it failed because
  no completed training run with a trained model exists. No checkpoint artifact
  was created. Flag-off equivalence and corpus gates remain mandatory.

### 2026-07-26 - SP-0 pre-run prediction (Codex)

- Prediction recorded before implementation or measurement: the laurel pair
  search will find at least 10% mating gain, informed by the earlier 13.3%
  canonical pair-compaction result; the obvious L-shape control will exceed 20%.
- Falsification rule: if the L-control passes but laurel mating gain is below 5%,
  stop the superpart plan and report that the target geometry lacks profitable
  pair interlock. Do not tune the threshold or proceed to SP-1.
- Initial scope is the standalone exact search and visual SVG only. No engine,
  UI, cache, or export files are claimed until SP-0 passes.

### 2026-07-25 - RC-1 raster collision gate stops at the proposed default (Codex)

- Added the pure UMD `main/util/raster-collision.js` module and loaded it in the
  visible and background renderer contexts. There is no engine-decision wiring
  in RC-1.
- The rasteriser marks every polygon-boundary cell, fills material with an
  even/odd scanline, dilates `outer` one cell, erodes wholly interior `inner`
  cells one cell, and compares only overlapping packed-word windows. Hole rings
  subtract through even/odd semantics. Continuous offsets are rounded to the
  shared grid; conservative margins absorb the subpixel residual.
- `ml/tests/raster_collision/run.js` uses Clipper as an independent oracle over
  5,000 deterministic convex, concave, and hole-bearing random pairs. Results:
  1,623 proven disjoint, 1,669 proven overlapping, 1,708 ambiguous, **0 unsafe
  outer decisions and 0 unsafe inner decisions**. An additional 1,000-placement
  containment audit exercised 239 fast accepts with 0 unsafe accepts.
- Real-part gate: ESICUP aggregate ambiguity was 18.84%, but the target laurel
  fixture was 55.80% at the specified divisor 64, and its actual deeply crossed
  pair remained ambiguous. The test exits non-zero on this intentional gate.
- Diagnostic only: divisor 192 lowers laurel ambiguity to 32.52% and correctly
  resolves the actual crossed pair, averaging 3,935 bytes per laurel part-angle
  (1.51 MB projected for 24 sources x 16 angles). Divisor 256 reaches 11.44% at
  7,025 bytes per part-angle. Neither replaces the written default yet.
- Per plan, stop before RC-2. Next decision is an explicit resolution-policy
  amendment plus corpus-wide cost measurement, not shadow engine wiring.

### 2026-07-25 - v4 blocked-gate re-diagnosis: legality is the wall (Claude-Code)

- Committed Codex's v4 implementation as `6855b74` after verifying it (flag-off
  equivalence, engine bugfixes, six new v4 suites, boot check all green).
- Added directional disagreement counters (`legalityDisagreementNfpStricter` /
  `legalityDisagreementMaterialStricter`) because the existing single total could not
  distinguish a harmless over-conservative NFP from an unsafe permissive one, and
  `attemptDiagnostics` caps at 12 so the split could not be inferred from samples.
- **Disagreement direction is 100% safe.** `svg-laurel-continuous-four` with the
  shadow audit on: 269 total, 269 NFP-stricter, **0 material-stricter**. Captured
  depths 3.8e-4…9.0e-4 (13–30x the 3e-5 legality epsilon, so not borderline). albano
  at a 45 s budget: 0 disagreements of any kind. Disagreements are exclusive to the
  concave laurel geometry — consistent with the largest-area NFP ring reduction noted
  in the v4 plan §10 trap 5, which enlarges the forbidden region on concave parts.
  `v4FastLegality` is therefore safe; the unsafe direction was never observed.
- **But fast legality buys nothing, because plan §4.5 rested on a false premise.**
  The neighbour loop returns on NFP penetration *before* the material check, so the
  exact Clipper test only runs for candidates the NFP already passed (~2%). Measured
  on albano 10 s: 887 evaluations with the flag ON vs 981 OFF — no gain. The 10x
  throughput gate was unreachable by construction and should be replaced only after a
  real hot-path profile (`getOuterNfp` lookups and `SeparationUtil.penetration` run on
  every neighbour of every candidate; the material check does not).
- **The real wall on dense sheets is legality, not acceptance or speed.** albano
  candidate dispositions: shipped-smart 942 evaluations / 19 scored / 923 illegal
  (98.0%); v4 contact-on 117 / 12 / 105; v4 fast-legality-on 887 / 4 / 883 (99.5%).
  ~98% of candidates never reach the objective at all. Utilization is bit-identical
  at `0.798528` across every configuration including shipped-smart. WP-V4.1 is still
  validated by the laurel fixture (sparse, legal moves exist, 45 deg accepted); dense
  layouts are limited upstream at legality. Next investment should be move types that
  do not need a legal single-part move (larger-window ruin-and-recreate, or
  overlap-then-repair via the existing SeparationUtil penetration machinery).
- The `shapes0` exported sliver (area 5.026835e-5) is a specification mismatch, not a
  proven defect: the engine permits penetration up to `1e-4 x curveTolerance` = 3e-5,
  which over a 1.68-unit contact edge produces exactly that area, while
  `ml/tests/benchmark_legality` asserts exact zero. Settle one epsilon across the NFP
  predicate, the material backstop, and the export audit before chasing it.
- Verification: `node --check`, flag-off engine equivalence, engine bugfixes, boot
  check all green after the counter change. Artifacts (untracked):
  `20260725T052725Z-lr-v4-shadow-direction-albano.json`,
  `20260725T052851Z-lr-v4-fastlegality-throughput.json`. Findings written up in
  `docs/local-refinement-v4-plan.md` "Follow-up findings".
- `npm run ml:checkpoint` still unavailable (no completed trained-model run).

### 2026-07-25 - Local Refinement v4 implementation and gate results (Codex)

- Implemented WP-V4.1 through WP-V4.5 behind default-off controls. Added sampled contact-aware plateau acceptance with shared before/after neighbours and sample steps, quantized revisit rejection, plateau caps, additive contact statistics, and exact commit-time legality.
- Added a uniform refinement spatial index, translated-query NFP checks, cached local bounds/hulls, and flag-controlled incremental scoring. Randomized equivalence coverage is green for 1,000 layouts and 500 shifted/unshifted NFP cases.
- Instrumented NFP-vs-exact-material legality. Full smoke diagnostics found nonzero conservative disagreements (NFP overlap while exact material did not), so `v4FastLegality` remains default-off and is disabled in the app UI with an explanatory hover label. The best fixed-budget albano count was 981 candidate evaluations versus the 594 baseline (1.65x, below the required 10x/5,940 gate).
- Added scaled target coverage and explicit swap gating. Flag-off frozen engine equivalence remains green.
- Added production-size 4-8 part windowed ruin/recreate with contact/frontier seeds, indexed neighbours, allowlisted angles, exact candidate and transaction gates, merge-credit preservation, signature suppression, and bounded deadlines. It fires on albano at a 15-second refinement budget, but accepted production windows were contact-improving and primary/utilization-neutral.
- Preserved the proven exact arbitrary-angle whole-cluster path for 4-6 part jobs. The v4 laurel smoke moved all four parts, accepted a 45-degree refinement, improved the continuous score by 24.88%, and passed the exact legality gate.
- Added an independent Clipper pairwise export audit to benchmark reports. The benchmark runner records completeness and hard-fails out-of-sheet geometry, missing source geometry, or positive-area overlaps; fixed-budget partial nests remain valid benchmark samples. A final no-merge albano run passed 24/24 parts with zero collisions and a maximum numerical intersection of `1e-10`.
- Relaxed the old whole-stage `mergeLines`/`processHoles` blocks. Merge mode now runs refinement while preserving pre-move merge credit; hole-bearing parts remain fixed targets while eligible neighbours continue refining. A merge-enabled albano run confirmed `continuousRan: true` with no skip reason. Its independent original-geometry export audit found two common-line slivers (maximum area `0.010511834`), so strict external legality intentionally remains red for that mode instead of weakening the audit.
- Fixed the benchmark's false "seed" convention by plumbing explicit deterministic seeds through the existing renderer seeded-random utility. The seeded off-control completed all nine bounded samples with mean median utilization `39.826%`. The seeded shipped-smart comparison stopped on `shapes0` seed 2 when the external audit found a pre-existing exported sliver (`0.00005026835` area), so a full paired target mean is intentionally not claimed.
- On the complete, overlap-free matched albano slice, off, shipped-smart, and v4 all had median utilization `79.8528%`. V4 accepted one contact move on every seed and changed the digest, but primary utilization did not improve. The required full-corpus efficacy gate was not run and no default was flipped.
- Verification green: syntax checks; engine bugfix, continuous refinement, separation, adaptive rotation, geometry broker, contact, coverage, scoring, spatial, window, and benchmark-legality tests; frozen engine equivalence; boot check; 13-scenario Electron smoke battery; `git diff --check`.
- The pre-edit ML checkpoint command (`npm run ml:checkpoint -- --name lr-v4-1-pre`) failed because no completed training run with a trained model exists. Bakeoff was not run because required manifest/model/output inputs are unavailable and the efficacy prerequisites did not pass.
- New durable coverage: `main/util/refinement-contact.js`, `ml/tests/refinement_contact/`, `ml/tests/refinement_coverage/`, `ml/tests/refinement_scoring/`, `ml/tests/refinement_spatial/`, `ml/tests/refinement_window/`, `ml/tests/benchmark_legality/`, and `ml/smoke/scenarios/svg-laurel-v4-contact.json`.

### 2026-07-16 - Release 0.8.0: commit, build, push (Claude-Code)

- User-directed full release: committed the pending completed work as `e37246f` ("land continuous compaction wave (Codex) + quantity placed badges" — Codex's and Claude-Code's edits interleave in `main/index.html`/`main/style.css`, so they land together with authorship credited in the message), then bumped `package.json` to 0.8.0 and rebuilt.
- Version rationale: 0.7.5 was explicitly frozen as the PERF-P0 pre-feature baseline; everything since (PERF-P1..P6, fine rotation, adaptive rotations, rotation reflow, pair/continuous compaction, quantity badges) is a backward-compatible feature wave — semver minor bump.
- Built `dist/Deepnest ML-0.8.0-mac-arm64.dmg` (101 MB, ad-hoc signed, notarization not configured — unchanged from prior releases) via `npm run dist`. Known non-fatal BOM `SyntaxError` warning from app-builder-lib during packaging, same as prior builds.
- Protocol ML checkpoint attempted (`npm run ml:checkpoint -- --name release-0.8.0-pre`) and failed with the standing error: no completed training runs with a trained model exist. Same caveat Codex recorded on every prior engine landing; no bakeoff inputs available.
- Benchmark-result JSONs and pre-existing local artifacts intentionally remain untracked.

### 2026-07-16 - Quantity column: live placed-vs-requested badges (Claude-Code)

- Added a live placed-vs-requested badge to each non-sheet row of the parts-table quantity column. `updatePlacedCounts(n)` tallies `sheetplacements[].source` per part index (the same `DeepNest.parts` contract displayNest already relies on) and writes `parts.<i>.placed` through Ractive; it runs as the first statement of `displayNest`, so counts update live on every displayed nest — both auto-display of new bests during a run and manual nest selection. Badge reads the placed count (requested is already visible in the input; full "X of Y" stays in the hover title), green `.complete` when placed >= requested, amber `.short` on shortfall; hidden (`placed == null`) until a nest is displayed. User-verified live in the dev app 2026-07-16.
- `clearPlacedCounts()` runs inside `resetNestComputation`, so badges clear on every session invalidation: part deletes (both paths), import invalidation, fresh runs, and column sorts. The sort handler invalidates the session *before* reordering `DeepNest.parts`, so index-based tallies can never mislabel rows.
- UI-only change: parts-table template + two renderer helpers in `main/index.html`, badge styles under `#parts table td.quantity-cell` in `main/style.css`. No engine, IPC, worker, or teacher-hook changes.
- Verification passed: `bash ml/scripts/run_boot_check.sh` (all invariants, 665 ms) and focused real-nest smoke `bash ml/scripts/run_smoke_battery.sh svg-hull-settle-floaters` (renderer executed displayNest with the new tally; export produced). Badge visuals not yet eyeballed in the GUI — worth a glance on next `npm start`.
- Not committed (tree intentionally dirty with Codex's continuous-compaction work); build/version bump remains held per user instruction — version stays 0.7.5.

### 2026-07-10 - Four-part continuous compaction efficacy (Codex)

- Reproduced the user's exact 2+2 laurel job from `ml/examples/laurel-two-crossed.svg`: four 3.3 x 5.6-inch parts on a 22.5 x 13.5-inch sheet. The prior code reported many accepted translation moves while the continuous stage accepted zero moves and left the visible U/fan arrangement unchanged. Giving the existing pair/neighbor search more time did not solve the layout.
- Added a bounded whole-cluster operator for 4-6 parts. It beam-searches part order, contact topology, and off-grid angles with cheap proxies, exact-repairs each surviving partial cluster, and commits only a strict improvement that passes full-resolution sheet containment and pairwise material-overlap checks. Arbitrary-angle geometry is transient and never enters the persistent NFP cache.
- Added quantity-aware smoke automation and the production scenario `svg-laurel-continuous-four`. Its substantive gate requires all four instances and four SVG paths, every part moved, at least one accepted whole-cluster layout, an off-grid angle of at least 30 degrees, at least 15% relative compaction, exact legality, zero persistent non-canonical NFP lookups, and an 8-second stage ceiling.
- The deterministic gate passed twice with the same digest `65c7bb15657c060527c2f608826bcbc8d88a9ccd`: score `0.5103834389 -> 0.3833988559` (24.88%), four parts moved, 30/315-degree aligned diagonal families, four exact-legal layouts, and about 7.5 seconds continuous runtime.
- Live Electron verification used the user's normal four construction rotations and retained UI settings. It placed 4/4 parts and repeatedly reported `17 moves, 30 DEG, 26.4% COMPACTED`, proving the improvement is active in the product path rather than only the frozen harness.
- Verification passed: syntax and diff checks; continuous-refinement, engine-bugfix, adaptive-rotation, separation, TIFF, engine-equivalence, and native-vs-JS NFP-equivalence tests; boot invariants; focused repeated four-laurel gate; full default smoke battery including the new gate, SVG/adaptive/Smart scenarios, Step & Repeat, and PDF export.
- `npm run ml:checkpoint -- --name four-part-continuous-efficacy-pre` was attempted before engine edits and failed because no completed trained-model run exists. No bakeoff was run because the required manifest/model/output inputs remain unavailable.

### 2026-07-10 - Continuous compaction compatibility gate (Codex)

- Added `main/util/configcompatibility.js` as the single rule source for Continuous compaction. When selected in the UI it forces Local refinement on, selects Smart, and forces Process part holes and Merge common lines off. The active engine config applies the same conflict normalization only when Local refinement is explicitly active, preserving automation/jobs that deliberately disable refinement.
- The settings form persists compatible values immediately, disables all four controlled inputs, and marks both label/value cells with the reason. Custom hover/focus tooltips, native titles, and accessibility Help/Description text explain every disabled setting. Turning Continuous compaction off re-enables the controls without restoring a stale incompatible value.
- Live Electron verification toggled Continuous compaction off/on: all four controls unlocked when off, then returned to Local refinement=on, engine=Smart, Process holes=off, Merge lines=off and disabled when on. Accessibility state exposed all four explanations.
- Verification passed: config-compatibility/continuous-refinement tests, engine-bugfix tests, frozen nine-scenario engine equivalence, boot invariants, full default smoke battery (gravity, hull, adaptive rotations, both continuous fixtures, Step & Repeat, PDF), syntax/diff checks.
- `npm run ml:checkpoint -- --name continuous-compatibility-gate-pre` was attempted before engine edits and failed because no completed trained-model run exists. No bakeoff was run because the required manifest/model/output inputs remain unavailable.

### 2026-07-09 - Continuous compaction coverage + cluster reflow follow-up (Codex)

- Verified the apparent override directly: with the same crossed-laurel fixture, `mergeLines:false` evaluated 74 angles and accepted two moves for an 18.17% compactness gain; `mergeLines:true` intentionally skipped continuous refinement. Added explicit skip telemetry and UI badge text for merge-lines, processed-hole, disabled, and unavailable-helper cases so this can no longer fail silently.
- Replaced nearest-pair-only scheduling for multi-part sheets with deterministic critical-target scheduling. Up to eight targets each receive a cheap six-angle scout against their nearest anchor, then the two highest-potential targets receive the remaining exact-search budget. Two-part jobs retain both directed searches and the frozen oracle behavior.
- Added bounded transactional cluster reflow for off-grid rotation finalists. The rotated target is locked, up to three blocking neighbors are repositioned through exact contact candidates plus bounded push fallback, and the entire cluster commits only after full-resolution sheet containment and pairwise material-overlap validation; every failure path leaves the original layout untouched.
- Added runtime-owned target/neighbor limits, additive scheduling/cluster telemetry, a deterministic scheduler unit test, and `laurel-crossed-blocker.svg` plus `svg-laurel-continuous-cluster` to the default smoke battery. No arbitrary-angle geometry is persisted in the NFP cache.
- Dense gate result: all three targets scouted, top two exploited, four legal cluster layouts, one cluster accepted moving three parts, continuous score `0.4012720363 -> 0.3723251672` (7.21%), maximum off-grid delta 34.5 degrees, 1301 ms continuous runtime, and zero non-canonical NFP lookups. The original two-part gate remains at 18.17% improvement and a 45-degree maximum delta.
- Verification passed: syntax/diff checks; continuous-refinement, engine-bugfix, adaptive-rotation, separation, TIFF, engine-equivalence, native-vs-JS NFP equivalence tests; boot invariants; focused dense and two-part smoke gates; full default smoke battery including SVG, adaptive rotation, Smart refinement, Step & Repeat, and PDF export.
- `npm run ml:checkpoint -- --name continuous-cluster-reflow-pre` was attempted before edits and failed because no completed trained-model run exists. No ML bakeoff was run because the required manifest/model/output inputs are unavailable.

### 2026-07-09 - Continuous local compaction postprocessor (Codex)

- Kept interactive construction on the proven four-angle grid (`rotations:4`, placement-side adaptive angles disabled) and replaced Smart's stacked pair/reflow/fine-rotation calls with one bounded continuous post-stage. Legacy engine functions and config keys remain for compatibility but Smart no longer invokes them.
- The compactor performs deterministic coarse-to-fine angle sweeps (5, 1, 0.25 degrees within +/-45 degrees), generates bounded boundary/bbox contact poses from 16-point proxies, rejects proxy intersections, then exact-polishes a small finalist set. Every accepted move strictly improves a box/hull/span post-score; full-resolution sheet containment and material-overlap gates are transactional and the whole sheet reverts on final illegality.
- The search never writes arbitrary-angle geometry to the persistent NFP cache. Internal proxy/contact/finalist bounds are runtime-owned so stale localStorage values cannot regress latency; automation/benchmark overrides remain available. Two-part jobs split the budget between both movement directions.
- UI now distinguishes construction from post-compaction: `Construction rotations` is a read-only four-angle invariant, the old adaptive/fine/reflow controls are removed, `Continuous compaction` is visible, enabling it selects Smart, selecting a legacy engine disables it, and the nest badge reports accepted moves, maximum angle, and percent compacted.
- Added `main/util/continuousrefinement.js`, deterministic unit/invariant tests, a crossed-laurel production fixture, a reproducible slow-oracle scenario, generic smoke maximum/oracle checks, and the production scenario to the default battery.
- Frozen crossed-laurel result: score `0.4012720363 -> 0.3283463892` (18.17%), 62.08% of the slow-oracle gain, two accepted moves, exported rotations 40/315 degrees, 74 angles and 7100 proxy poses evaluated, 1083 full-resolution checks (286 ms), continuous stage 1267 ms, and zero persistent non-cardinal NFP lookups. Gate ceilings are 2250 ms and +/-45 degrees.
- Verification passed: syntax and diff checks; continuous-refinement, engine-bugfix, adaptive-rotation, separation, TIFF, native-vs-JS NFP equivalence, and nine-scenario engine-equivalence tests; boot invariants; full default smoke battery including SVG, adaptive opt-in fixtures, Smart floater/continuous refinement, Step & Repeat, and PDF export.
- `npm run ml:checkpoint -- --name continuous-local-compaction-pre` was attempted before engine edits and failed because no completed trained-model run exists. No ML bakeoff was run because the required manifest/model/output inputs are unavailable.

### 2026-07-09 - Exact two-part pair compaction (Codex)

- Root cause: the generic rotation-reflow operator always retains an untouched anchor. With exactly two parts it therefore discards the only neighbor and can never rebuild the pair as a unit. Separately imported copies also have distinct source IDs, so sibling alignment does not connect them.
- Added a Smart-only exact pair operator for two-part nests on rectangular, hole-free sheets with merge-lines off and Rotation reflow enabled. It enumerates only each source's canonical allowed angles, searches outer-NFP boundary contacts plus bounded outline vertex contacts projected to the nearest NFP boundary, translates the pair as one rigid group into the sheet, and commits only a strict metric improvement that passes the existing full-layout containment/material-overlap gate.
- Candidate scoring is separated from exact validation: each angle pair is scored cheaply, sorted, and only its best bounded candidates reach the exact gate. All failure paths leave the original polygons and placements untouched. Added pair-specific telemetry under `operatorStats.pairCompact` and additive summary fields.
- Reproduced with two separately imported same-handed laurel branches derived from `ml/examples/laurel-branches.svg`, deterministic `populationSize:1`, `rotations:4`, Smart/Adaptive/Reflow on, and fine `curveTolerance:0.36`. The poor seed improved from `0.4793696109` to `0.4156170930` (13.30%); the exported pair used canonical 0/180-degree rotations, `pairCompactionAccepted=1`, and `nonCanonicalNfpLookups=0`. Quick Look inspection showed the branches interlocked side-by-side instead of forming the large separated Y.
- Deterministic tests cover projection onto the NFP boundary, rejection of a lower-score illegal pose, commit of the next legal pose, and full rollback when every pose is illegal.
- Verification passed: syntax checks; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/adaptive_rotations/run.js`; `node ml/tests/separation/run.js`; `node ml/tests/engine_equivalence/run.js`; `bash ml/scripts/run_boot_check.sh`; the focused real-laurel smoke; the full default smoke battery (SVG, adaptive rotation, Smart reflow, Step & Repeat, PDF); `git diff --check`.
- `npm run ml:checkpoint -- --name two-part-pair-compaction-pre` was attempted before engine edits and failed because no completed training run with a model exists. No bakeoff was run because manifest/model/output inputs remain unavailable.

### 2026-07-09 - Smart rotation + neighbor reflow (Codex)

- Added the Smart-only rotation-reflow post-stage. It ranks adaptive diagonal angles before uniform-grid alternatives, rotates at most two target parts, releases up to three nearest blockers while retaining an untouched anchor, and reinserts the bounded group one part at a time through the exact standalone feasible-region builder.
- Every angle attempt starts from a full polygon/placement snapshot. Each victim passes NFP containment, pair penetration, and material-overlap checks against the current partial layout; a candidate is retained only when the fully rebuilt layout passes the rotation-aware final legality gate and strictly improves the Smart metric. Failure, timeout, or a legal-but-worse result restores every polygon and placement.
- Reflow runs after the established settle/relocate/swap loop, using only remaining budget. The first implementation ran before relocation and consumed budget; a bounded A/B exposed the opportunity cost, so scheduling was corrected before landing.
- Added default-on `localRefinementRotationReflow` (effective only when local refinement + Smart are active), visible `Rotation reflow` checkbox, bounded target/neighbor/budget settings, benchmark CLI flags, and detailed stats/operator telemetry.
- Added deterministic tests for adaptive-first angle ordering, nearest-blocker selection with a retained anchor, successful transactional commit, and exact full rollback for a non-improving legal rebuild.
- Post-stage A/B at 1x10s (`albano,blaz1,shapes0`, Smart budget 3000 ms): reflow-off `20260709T202341Z-rotation-reflow-off-10s.json` and corrected reflow-on `20260709T202749Z-rotation-reflow-poststage-on-10s.json` matched exactly at mean utilization `0.4012359139` and per-instance medians/local scores. Reflow therefore did not displace existing improvements; all runs reported zero non-canonical NFP lookups.
- Efficacy proof: a focused comb run accepted one reflow, moved four parts, and improved the metric by ~1.04%. The final full battery run accepted one reflow with three legal full layouts and zero unknown NFPs; total Smart refinement improved `0.1371662 -> 0.1092286`. The default battery now includes `svg-hull-settle-floaters` and asserts `rotationReflowAttempts >= 1`.
- Verification passed: syntax checks; adaptive, engine-bugfix, and separation tests; engine equivalence; boot check; targeted Smart/fine-rotation smokes; full default smoke battery (SVG, adaptive forced fits, Smart reflow, Step & Repeat, PDF); benchmark A/B; `bash -n`; `git diff --check`.
- No ML checkpoint/bakeoff was possible: the repository still has no completed trained-model run and no manifest/model/output inputs.

### 2026-07-09 - Adaptive rotation symmetry follow-up (Codex)

- Added conservative half-turn symmetry detection. Convex contours use opposite support distances; non-convex contours use centroid + 32 center-line intersection checks. Comparisons use the existing curve tolerance, so SVG ellipse tessellation does not create false directional variants.
- Symmetric elongated parts now use four unique axes (`[0,90,45,135]`) instead of spending NFP variants on 180-degree reversals. Child-bearing parts keep reversals when `processHoles` is on; with holes ignored, the outer contour may use the symmetric set.
- Adaptive GA seeding now identifies non-uniform angles by value instead of assuming they follow all global-grid entries, ensuring the symmetry-reduced 45/135 candidates receive explicit seed individuals.
- Added the slotted-oval target fixture/scenario and made it part of the default smoke battery. With `rotations:4`, `processHoles:false`, and merge-lines off, the live allowlist was `[0,90,45,135]`, the exported placement was `rotate(45)`, and `nonCanonicalNfpLookups=0`. Smoke reports now include `adaptiveRotationAnglesBySource` for diagnostics.
- Final generic 3x10s gate artifact: `20260709T194600Z-adaptive-symmetry-final-3x10s.json`. Mean median utilization `0.3944533346` versus the frozen off baseline `0.3958307870` (`-0.138pp`, within the safety band); all nine runs had zero non-canonical NFP lookups. This corpus still selected only cardinal angles, so the slotted-oval fixture is the efficacy proof.
- Verification passed: syntax checks; adaptive + engine bugfix tests; engine equivalence; boot check; focused forced-fit/branch/slotted smokes; full default smoke battery including exact angle assertions; `bash -n`; `git diff --check`.
- The prior checkpoint attempt remains unavailable because there are no completed trained-model runs; no bakeoff inputs are available.

### 2026-07-09 - Adaptive placement rotations (Codex)

- Added `main/util/rotationutil.js`: edge-weighted principal-axis analysis, bounded per-source angle sets, isotropic/merge-lines skips, and sibling-dominant angle selection. With four configured rotations an elongated horizontal part gets `[0,90,180,270,45,225]`; arbitrary continuous angles are not introduced.
- Wired adaptive rotation allowlists through the GA and worker config. Identical-source seed copies share an orientation, mutation is biased toward the source-family dominant angle, and adaptive swap mutations keep each rotation with its part. Disabling `adaptiveRotations` preserves the legacy seed/mutation path.
- Updated `main/background.js` so only source-allowlisted adaptive angles pass the canonical NFP guard; arbitrary fine angles still fail closed. First-placement retries enumerate the source allowlist exactly once. Existing NFP collision/containment math is unchanged.
- Added a default-on `Adaptive placement angles` setting. It automatically skips when `mergeLines` is on and does not add angles for near-isotropic shapes. Added benchmark CLI flags for reproducible A/B runs.
- Added pure helper tests, adaptive guard/retry engine tests, a complex branch smoke scenario, and a forced-fit fixture where a 1200x100 part can enter a 1000x1000 sheet only at 45 degrees. The forced-fit scenario is in the default smoke battery and asserts both exported `rotate(45)` and `nonCanonicalNfpLookups=0`.
- Required pre-edit checkpoint was attempted with `npm run ml:checkpoint -- --name adaptive-rotations-pre` and failed because no completed training run with a trained model exists. No bakeoff was run because the required manifest/model/output inputs are unavailable.
- Three-run 10-second A/B (`albano,blaz1,shapes0`, merge/refinement off): mean median utilization `0.3958307870` -> `0.3979199718` (`+0.209pp`); albano `+1.040pp`, blaz1 `-0.413pp`, shapes0 unchanged. All nine flag-on runs reported `nonCanonicalNfpLookups=0`. Artifacts remain untracked: `20260709T190330Z-adaptive-rotations-off-3x10s.json` and `20260709T190543Z-adaptive-rotations-on-3x10s.json`.
- Verification passed: syntax checks for all changed JS; `node ml/tests/adaptive_rotations/run.js`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_equivalence/run.js`; `bash ml/scripts/run_boot_check.sh`; focused adaptive smokes; full default smoke battery including forced-fit rotation assertion; `bash -n ml/scripts/run_smoke_battery.sh`; `git diff --check`.

### 2026-07-09 - LR fine rotation visible acceptance follow-up (Codex)

- User testing still showed no visible rotations, including on parts without holes. Smoke diagnostics showed legal fine-rotation candidates existed, but strict smart-metric acceptance rejected them all.
- Updated `main/background.js` so fine rotation tries exact-legal rotate + small slide placements, accepts score-neutral or bounded near-neutral visible rotations when `fineRotationStrictImprovement` is not set, and caps each target at one accepted fine-rotation nudge. Exact sheet/pair overlap gates remain in place before any move is accepted.
- Added targeted acceptance tests in `ml/tests/engine_bugfixes/run.js`.
- Verification passed: `node --check main/background.js`; `node --check ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `bash ml/scripts/run_boot_check.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-fine-rotation-capped bash ml/scripts/run_smoke_battery.sh svg-hull-fine-rotation`; `git diff --check`; `node ml/tests/engine_equivalence/run.js`.
- Focused smoke stats: `operatorStats.fineRotate.accepted=2`, `fineRotateMaxDeltaDeg=6`, `fineRotateLegalCandidates=53`, `fineRotateNearNeutralAccepted=1`, `fineRotateSlideAccepted=1`, `nonCanonicalNfpLookups=0`.

### 2026-07-08 - LR fine rotation slotted-part follow-up (Codex)

- User testing showed slotted oval parts with `Process part holes` off still appeared to receive no fine rotations. Root cause: v1 fine-rotation skipped any child-bearing part before checking `processHoles`, so every slotted part was skipped.
- Updated `main/background.js` so fine rotation still fails closed for child-bearing pairs when hole processing is on, but when `processHoles === false` it validates child-bearing parts using outer-contour exact overlap. This matches the active setting: holes are not nestable, but outer contours still cannot overlap.
- Verification passed: `node --check main/background.js ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `bash ml/scripts/run_boot_check.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-fine-rotation-holefix bash ml/scripts/run_smoke_battery.sh svg-hull-fine-rotation`. Smoke stats: `fineRotateCandidates=40`, `fineRotateSkippedHoles=0`, `nonCanonicalNfpLookups=0`.

### 2026-07-08 - LR fine rotation Phase 1 default-off operator (Codex)

- Implemented default-off `localRefinementFineRotation` for the `smart` local-refinement engine. It runs strictly last, uses centroid-pivot continuous rotation candidates, skips hole-risk targets/neighbors, auto-skips when `mergeLines` is enabled, and accepts only strict smart-metric improvements.
- Added exact-geometry final gating for off-grid rotations: sheet containment uses Clipper difference against the sheet outer plus sheet-hole overlap checks; pair overlap uses bbox prefilter + `SeparationUtil.materialOverlap`, failing closed for bbox-overlapping hole-bearing pairs. Existing canonical final gate stays in use when all rotations are on grid.
- Added config defaults/parsing in `main/deepnest.js` and `main/index.html`, a visible Fine rotation checkbox, exposed the existing Smart refinement option in the UI, benchmark CLI flags for fine-rotation knobs, and `ml/smoke/scenarios/svg-hull-fine-rotation.json` for explicit flag-on smoke coverage.
- Added engine tests for centroid pivot preservation, exact-gate selection, and a stubbed legal/improving acceptance path.
- Verification passed: `node --check main/background.js main/deepnest.js ml/cli/run_benchmark.js ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/separation/run.js`; `node ml/tests/engine_equivalence/run.js`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-fine-rotation-default bash ml/scripts/run_smoke_battery.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-fine-rotation-on bash ml/scripts/run_smoke_battery.sh svg-hull-fine-rotation`; `git diff --check`.
- Bounded 1-run A/B benchmark artifacts (left untracked by convention): off `ml/benchmark/results/20260708T211818Z-lr-fr1-off-10s.json`, on `ml/benchmark/results/20260708T212015Z-lr-fr1-on-10s.json`. Safety invariant held (`nonCanonicalNfpLookups: 0` on every run); fine-rotation attempted 40 candidates per instance with exact-check time 7-17 ms, but accepted 0 fine moves on `albano,blaz1,shapes0`. Mean median utilization is not comparable from one stochastic run and was lower in the on run (`0.4170` -> `0.3983`); this should not be treated as an efficacy pass. Next efficacy work needs a slender/branch torture fixture and multi-seed benchmark.

### 2026-07-08 - LR fine rotation Phase 0 guard (Codex)

- Attempted required pre-edit checkpoint: `npm run ml:checkpoint -- --name fine-rotation-pre`. It failed because no completed training runs with trained models exist in this checkout (`RuntimeError: No completed training runs with a trained model were found.`). Proceeded with this caveat recorded.
- Added canonical-grid NFP guard helpers in `main/background.js`. `getOuterNfp` / `getInnerNfp` now fail closed and increment `localRefinement.nonCanonicalNfpLookups` if asked for an off-grid rotation, preventing one-off fine-angle NFPs from reaching the persistent cache.
- Phase 0 is intended behavior-neutral for the existing canonical engine path. Verification passed: `node --check main/background.js`; `node --check ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `bash ml/scripts/run_boot_check.sh`; `node ml/tests/engine_equivalence/run.js`.
- Phase 1 remains active: default-off centroid fine-rotation operator, strictly last, exact final gate, skip holes/mergeLines.

### 2026-07-08 - PERF-P4 mergeLines candidate cap (Codex)

- Implemented hidden/default-off `mergeCandidateCap` (`0` = old behavior) in `main/deepnest.js` and `main/index.html`. Worker config propagation rides through the existing `copyConfigForWorker` copy.
- `main/background.js` now keeps flag-off merge scoring on the old path. When `mergeLines && mergeCandidateCap > 0`, candidates are first ranked by the existing base score (including `improvedPlacementScore`, excluding only merge credit), only the top-k are retained, and the final winner is selected after exact `mergedLength` credit using the existing tie-break rules.
- Added `ml/smoke/scenarios/svg-gravity-merge-cap.json` for cap64 smoke testing and `ml/cli/run_benchmark.js` flags `--merge-lines` / `--merge-candidate-cap` so P4 benchmark gates are reproducible.
- Verification passed: `node --check main/background.js main/deepnest.js ml/cli/run_benchmark.js ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/nest_geometry_broker/run.js`; `node ml/tests/separation/run.js`; `bash ml/scripts/run_boot_check.sh`; `node ml/tests/engine_equivalence/run.js`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p4 bash ml/scripts/run_smoke_battery.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p4-merge bash ml/scripts/run_smoke_battery.sh svg-gravity-merge svg-gravity-merge-cap`; `git diff --check`.
- Flag-on benchmark artifacts: cap off `ml/benchmark/results/20260708T154330Z-perf-p4-merge-off.json`; cap64 `ml/benchmark/results/20260708T154459Z-perf-p4-merge-cap64.json`; cap128 probe `ml/benchmark/results/20260708T154721Z-perf-p4-merge-cap128.json`.
- Cap64 gate summary vs cap-off: aggregate mean median utilization `0.3950649969412868` -> `0.39808590908978214` (`+0.302pp`, borderline but positive; blaz1/shapes0 unchanged). PlacementMs mostly improved: blaz1 `2315/949` -> `2007/790`, shapes0 `2623/370` -> `2465/375`, albano mixed `2244/1772` -> `2378/932`. Cap128 was slightly worse than the strict band (`-0.321pp`) and is not the recommended value.
- Default remains `mergeCandidateCap: 0`; no ML checkpoint/bakeoff needed while the flag stays off.

### 2026-07-08 - PERF-P5 S5 closeout telemetry + benchmark (Codex)

- Added `dispatchStartedAt` to normal GA and local-refinement worker payloads; `main/background.js` now reports non-negative `timing.dispatchMs` on normal, Step & Repeat, refinement, and missing-geometry failure responses. Missing token geometry still fails closed with `fitness: Number.MAX_VALUE`, `placements: []`, and an error.
- Full verification passed: `node --check main/background.js main/deepnest.js ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/nest_geometry_broker/run.js`; `node ml/tests/separation/run.js`; `bash ml/scripts/run_boot_check.sh`; `node ml/tests/engine_equivalence/run.js`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p5-s5 bash ml/scripts/run_smoke_battery.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p5-s5-lr bash ml/scripts/run_smoke_battery.sh svg-hull-settle-floaters`; `git diff --check`.
- Smoke telemetry proof: `/tmp/deepnest-smoke-perf-p5-s5/*/report.json` all reported `geometryPath: "token"` and `dispatchMs` 2-4 ms; local-refinement fixture reported `geometryPath: "token"`, `dispatchMs: 66`, `localRefinement.ran: true`, `movesAccepted: 1`.
- Benchmark artifact: `ml/benchmark/results/20260708T153527Z-perf-p5-after.json` (`albano,blaz1,shapes0`, 10 s, 2 runs). All benchmark runs reported `geometryPath: "token"` and `dispatchMs` 3-4 ms.
- P6 reference -> P5 after mean median utilization: `0.3940293188744975` -> `0.4036020126152047`. Medians: albano `0.7619901808483602` -> `0.7829603263049422`; blaz1 `0.2588902859733389` -> `0.2666382217388785`; shapes0 unchanged `0.16120748980179334`.
- PERF-P5 is closed. Next perf WP per plan: `PERF-P4 mergeLines top-k credit cap` (flagged/default-off).

### 2026-07-08 - PERF-P5 S4 local-refinement token verification (Codex)

- No additional code was needed for S4: `requestLocalRefinementForBest` copies the active worker payload, and S3 already made active payloads token-based.
- Verification passed with the smart local-refinement fixture: `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p5-s4 bash ml/scripts/run_smoke_battery.sh svg-hull-settle-floaters`.
- Report proof: `/tmp/deepnest-smoke-perf-p5-s4/svg-hull-settle-floaters/report.json` has `details.localRefinement.ran: true`, `movesAccepted: 7`, `pending: false`, and `details.timing.geometryPath: "token"` on the final refined nest.
- Next slice: P5 S5 cleanup/failure telemetry, benchmark dispatch proof, full battery, then close P5.

### 2026-07-08 - PERF-P5 S3 GA dispatch token migration (Codex)

- Migrated normal GA dispatch in `main/deepnest.js` to publish one broker geometry bundle per nest (`nest-geometry-set`) after offset/sheet-margin processing, then send token payloads containing only `index`, `nestToken`, `ids`, `sources`, `rotations`, and worker config.
- Geometry bundle preserves the exact legacy source index contract (`poly.source = i`), quantity-expanded sheets, sheet ids/sources, sheet child sidecars, and part child sidecars so background token hydration can restore hole-bearing parts despite old Electron array-property IPC behavior.
- Verification passed: `node --check main/deepnest.js main/background.js`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/nest_geometry_broker/run.js`; `node ml/tests/separation/run.js`; `bash ml/scripts/run_boot_check.sh`; `node ml/tests/engine_equivalence/run.js`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p5-s3 bash ml/scripts/run_smoke_battery.sh`; `git diff --check`.
- Smoke report telemetry confirmed token path in all scenarios: `/tmp/deepnest-smoke-perf-p5-s3/*/report.json` all include `details.timing.geometryPath: "token"`.
- Next slice: P5 S4 explicitly verify/local-refinement post-process under token payloads, then P5 S5 cleanup/failure telemetry/benchmark.

### 2026-07-08 - PERF-P5 S2 worker token hydration (Codex)

- Implemented P5 S2 in `main/background.js`: worker-side token geometry pull via `nest-geometry-get-sync`, two-token worker cache, recursive geometry clone preserving `exact`, legacy payload fallback, and `timing.geometryPath` telemetry (`legacy` today until dispatch migrates).
- Token hydration reconstructs per-instance `id` / `source` / `rotation`, clones sheets per dispatch, restores sheet holes, supports `partsChildrenBySource` / legacy `partchildren` sidecars for hole-bearing source parts, and mirrors legacy `simplify` child suppression.
- Added targeted `ml/tests/engine_bugfixes/run.js` coverage for legacy hydration, token hydration clone/child/exact semantics, cached token reuse, simplify-mode child suppression, and missing-token fail-closed behavior.
- Verification passed: `node --check main/background.js ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/nest_geometry_broker/run.js`; `node ml/tests/separation/run.js`; `bash ml/scripts/run_boot_check.sh`; `node ml/tests/engine_equivalence/run.js`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p5-s2 bash ml/scripts/run_smoke_battery.sh`; `git diff --check`.
- Next slice: P5 S3 migrate normal GA dispatch to token payloads and require reports to show `timing.geometryPath: "token"`.

### 2026-07-08 - PERF-P5 S1 broker IPC (Codex)

- Implemented P5 S1 only: added `main/nest-geometry-broker.js`, a bounded two-token in-memory geometry broker, plus `nest-geometry-set` and `nest-geometry-get-sync` IPC handlers in `main.js`, `ml/app-smoke-main.js`, and `ml/teacher-main.js`.
- This slice is behavior-inert: no renderer dispatch or background worker code uses the broker yet. It exists so later P5 slices can migrate payload shape with IPC parity already in place.
- Added `ml/tests/nest_geometry_broker/run.js` for bounded retention, replacement recency, targeted clear, full clear, and invalid geometry rejection.
- Verification passed: `node --check main/nest-geometry-broker.js main.js ml/app-smoke-main.js ml/teacher-main.js ml/tests/nest_geometry_broker/run.js`; `node ml/tests/nest_geometry_broker/run.js`; `git diff --check`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/separation/run.js`; `node ml/tests/engine_equivalence/run.js`; `bash ml/scripts/run_boot_check.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p5-s1 bash ml/scripts/run_smoke_battery.sh`.
- Next slice: P5 S2 worker-side token pull and reconstruction behind the legacy fallback.

### 2026-07-08 - PERF-P6 batched NFP warm (pre-pass first) (Codex)

- Implemented `PERF-P6`: added `nfp-cache-find-batch-sync` in `main.js` and `ml/app-smoke-main.js`, plus in-memory `nfp-cache-*` parity in `ml/teacher-main.js` (the swarm audit found teacher did not actually have cache handlers despite the plan wording).
- `main/background.js` now builds deduped prefetch keys after part/sheet reconstruction and before the pair pre-pass, warms local `window.nfpcache` in chunks, and uses confirmed batch misses to avoid pre-pass `db.has` sync IPC while falling back to old `db.has` for unfetched/capped keys.
- Added helper docs (`buildOuterNfpCacheDoc`, `buildInnerNfpCacheDoc`) so prefetch keys, pre-pass keys, `getOuterNfp`, and `getInnerNfp` share the same key shape. Added `timing.nfpBatch` telemetry and targeted tests for key parity, local-hit skipping, batch warm stats, and checked-miss tracking.
- Smoke proof: `/tmp/deepnest-smoke-perf-p6/svg-gravity/report.json` showed `nfpBatch.requested: 9`; `/tmp/deepnest-smoke-perf-p6/svg-hull/report.json` showed `nfpBatch.hits: 4`; sensitive scenarios passed under `/tmp/deepnest-smoke-perf-p6-sensitive`, including `processHoles:false` with `nfpBatch.eligible: 4` and `pairsCacheHits: 1`.
- Benchmark before reference: `ml/benchmark/results/20260708T144732Z-perf-p3-after.json`. P6 after artifact: `ml/benchmark/results/20260708T150210Z-perf-p6-after.json`. Batch telemetry is present in every non-step benchmark run; examples: shapes0 run2 `nfpBatch.hits: 1094`, `pairsCacheHits: 903`, `placementMs: 344`; albano run1 `nfpBatch.requested: 576`, hits `103`; blaz1 run1 requested `784`, hits `44`.
- Benchmark medians (P3 before → P6 after): albano `0.7901515158895724` → `0.7619901808483602`; blaz1 `0.25914372861195734` → `0.2588902859733389`; shapes0 unchanged at `0.16120748980179334`. Run-level GA output varies stochastically; deterministic `engine_equivalence` is the output-identity gate and passed. Runtime impact is mixed on cold-ish albano/blaz1 but strong on second-run shapes0 cache reuse.
- Teacher mini-run passed: `npm run legacy:teacher -- --job ml/examples/simple-job.json --output-dir /tmp/deepnest-teacher-p6`; `/tmp/deepnest-teacher-p6/result.json` status `succeeded`, legality `legal: true`, `placed_part_count: 3`.
- Verification passed: `node --check main/background.js main.js ml/app-smoke-main.js ml/teacher-main.js ml/tests/engine_bugfixes/run.js`; `git diff --check`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/separation/run.js`; `node ml/tests/engine_equivalence/run.js`; `bash ml/scripts/run_boot_check.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p6 bash ml/scripts/run_smoke_battery.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p6-sensitive bash ml/scripts/run_smoke_battery.sh svg-gravity-merge svg-gravity-processholes-off svg-gravity-simplify`; amended `npm run ml:nest-benchmark -- --label perf-p6-after --instances albano,blaz1,shapes0 --time-budget-sec 10 --runs 2`; teacher mini-run above.
- Next claim per plan: `PERF-P5 geometry-once dispatch (5 slices)`.

### 2026-07-08 - PERF-P3 hull candidate hoists (Codex)

- Implemented `PERF-P3`: in convex-hull placement mode, each candidate now computes `candidateHull = getHull(localpoints)` once and reuses it for both the area score and `shiftvector.hull`; each sheet computes `sheetHull = getHull(sheet)` once and reuses it for `shiftvector.hullsheet`.
- Added `svg-hull` to the default smoke battery. The deterministic engine equivalence harness already included `svg-hull`, so no golden regeneration was needed.
- Swarm audit: explorer confirmed no active consumer mutates `position.hull` or `position.hullsheet`; they are stored in nest results but display/export/smoke/benchmark/teacher canonicalization ignore or treat them read-only. Sharing one `sheetHull` array per sheet is safe under current consumers.
- Direct hull signal: `/tmp/deepnest-smoke-perf-p3/svg-hull/report.json` completed with `timing.placementMs: 234`, `pairsMissing: 3`, `parts: 3`, digest `234688e7a64641a63937087c4f4edd0aa2fc625b`.
- Benchmark before reference: `ml/benchmark/results/20260708T143709Z-perf-p1-after.json`. P3 after artifact: `ml/benchmark/results/20260708T144732Z-perf-p3-after.json`. The standard benchmark remains gravity-mode broad regression evidence, not a direct hull-hoist measurement.
- Benchmark medians (P1 before → P3 after): albano `0.7887593307035137` → `0.7901515158895724`; blaz1 `0.26140644229159055` → `0.25914372861195734`; shapes0 unchanged at `0.16120748980179334`. Run-level GA output varies stochastically; deterministic `engine_equivalence` is the output-identity gate and passed.
- Verification passed: `node --check main/background.js`; `bash -n ml/scripts/run_smoke_battery.sh`; `git diff --check`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/separation/run.js`; `node ml/tests/engine_equivalence/run.js`; `bash ml/scripts/run_boot_check.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p3 bash ml/scripts/run_smoke_battery.sh`; amended `npm run ml:nest-benchmark -- --label perf-p3-after --instances albano,blaz1,shapes0 --time-budget-sec 10 --runs 2`.
- Next claim per plan: `PERF-P6 batched NFP warm (pre-pass first)`.

### 2026-07-08 - PERF-P1 fingerprint memoization (Codex)

- Implemented `PERF-P1`: `polygonFingerprint` now stores the computed hash on the polygon array as non-enumerable configurable `__dnFingerprint`, with frozen/sealed inputs falling back to recomputation.
- Added targeted coverage in `ml/tests/engine_bugfixes/run.js`: same-object memo reuse (second call would throw if it missed the memo), structurally equal distinct polygons matching, JSON/structured-clone-style copies not carrying `__dnFingerprint`, recomputation after JSON copy, and frozen polygon fallback.
- Safety audit: `polygonFingerprint` is only called by `nfpCacheKey`; `nfpCacheKey` is only used by `window.db.has/find/insert`; key inputs are `Apolygon/Bpolygon` or `Ashape/Bshape`. Shifted NFP results are cloned and mutated after lookup, not fingerprinted. Placement and refinement rotation probes create fresh copied polygons before keying.
- Benchmark before reference: `ml/benchmark/results/20260708T030350Z-perf-p2-after.json` (P2 committed state). P1 after artifact: `ml/benchmark/results/20260708T143709Z-perf-p1-after.json`.
- Benchmark medians (P2 before → P1 after): albano `0.7813197112640429` → `0.7887593307035137`; blaz1 `0.24653888520188993` → `0.26140644229159055`; shapes0 unchanged at `0.16120748980179334`. Run-level GA output varies stochastically; deterministic `engine_equivalence` is the output-identity gate and passed.
- P1 after timing samples: albano `placementMs` 1078/451 ms, blaz1 2038/938 ms, shapes0 2791/789 ms. The first run on a cold-ish cache is noisy; cache-hit telemetry remains present.
- Verification passed: `node --check main/background.js`; `node --check ml/tests/engine_bugfixes/run.js`; `node ml/tests/engine_bugfixes/run.js`; `git diff --check`; `node ml/tests/engine_equivalence/run.js`; `bash ml/scripts/run_boot_check.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p1 bash ml/scripts/run_smoke_battery.sh`; amended `npm run ml:nest-benchmark -- --label perf-p1-after --instances albano,blaz1,shapes0 --time-budget-sec 10 --runs 2`.
- Next claim per plan: `PERF-P3 hull candidate hoists`.

### 2026-07-08 - PERF-P2 hot-loop logging + timing telemetry (Codex)

- Implemented `PERF-P2`: removed the targeted hot-loop background renderer logs/timers (`minkowski`, `clipper`, `inserting inner`, per-part `placement`, and `save cache`).
- Added additive placement telemetry on the `placeParts` result: `timing.placementMs`, `timing.parts`, and `timing.placementIterations`. Existing P0 fields (`pairsCacheHits`, `pairsMissing`, `processHoles`) continue to merge into the same `timing` object in the worker response.
- Updated `ml/cli/run_benchmark.js` to persist `report.details.timing` into each benchmark run. Latest P2 artifact with timing: `ml/benchmark/results/20260708T030350Z-perf-p2-after.json`.
- Re-captured the amended P0 baseline before the P2 code patch: `ml/benchmark/results/20260708T025010Z-perf-p0-baseline.json` on `albano,blaz1,shapes0`, 10 s, 2 runs. P2 after aggregate mean median utilization: `0.3963553620892421` vs P0 baseline `0.3965782729710427`; run-level differences are expected from the stochastic GA, while the deterministic equivalence gate is the output-identity check.
- P2 timing samples from the latest benchmark: albano `placementMs` 465/457 ms for 24 parts, blaz1 677/438 ms, shapes0 2415/530 ms; cache-hit fields are present in each run's timing object.
- Verification passed: `node --check main/background.js`; `node --check ml/cli/run_benchmark.js`; `git diff --check`; `node ml/tests/engine_bugfixes/run.js`; `node ml/tests/separation/run.js`; `node ml/tests/engine_equivalence/run.js`; `bash ml/scripts/run_boot_check.sh`; `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p2 bash ml/scripts/run_smoke_battery.sh`; amended `npm run ml:nest-benchmark -- --label perf-p2-after --instances albano,blaz1,shapes0 --time-budget-sec 10 --runs 2`.
- Next claim per plan: `PERF-P1 fingerprint memoization`.

### 2026-07-07 - PERF-P0 review: verified green; benchmark gate amended (shirts → blaz1); P2 unblocked (Claude-Code)

Reviewed the Codex PERF-P0 batch against the plan. Verdict: **correct and complete; P1/P2 are unblocked.**

- Verified: pre-pass docs now carry `processHoles` (matching `getOuterNfp`'s literal); child-hole accounting skipped when false; `pairsCacheHits` telemetry present with the run1=0 → run2=1 proof under `processHoles:false`; four new deterministic equivalence scenarios (hull/merge/processholes-off/simplify) with goldens regenerated (9 golden entries); lockfile reconciled; boot-check title at 0.7.5; two clean commits with correctness and freeze separated as required.
- Notable extra find by Codex: `processHoles` was never passing `DeepNest.config()`'s merge into worker config (`main/deepnest.js:786-787` fix) — the Settings toggle was effectively inert in workers before this. Real latent bug, now fixed and covered by the `svg-gravity-processholes-off` golden.
- **Benchmark blocker resolved (plan §8 amended):** `shirts` (99 parts) deterministically fails `no_nest_before_time_budget` at 10 s under the legacy x64 smoke runtime — it measures nothing at this budget. The perf gate command now uses `albano,blaz1,shapes0` (the trio proven to complete at 10 s across all LR bounded probes); `shirts` remains in the full corpus for SOTA utilization gates at the frozen 240 s budget. Re-capture the baseline label with the amended command (`perf-p0-baseline`, instances albano,blaz1,shapes0) so every later before/after compares like-for-like.
- Benchmark result JSONs under `ml/benchmark/results/` stay untracked (generated artifacts) — consistent with existing practice.
- Codex: next claim is `PERF-P2 hot-loop logging + timing telemetry` (it installs the timing fields all later WPs report with), then P1, per the §10 order.

### 2026-07-07 - PERF-P0 baseline freeze + processHoles pre-pass cache-key fix (Codex)

- Baseline freeze landed first as commit `05c0ce9` (`[codex] PERF-P0: freeze 0.7.5 baseline`): package-lock reconciled to `0.7.5`, current 0.7.4/0.7.5 legality/NFP-normalization work committed separately from the P0 cache-key edit, and plan docs committed.
- Implemented the P0 cache-key fix: `main/background.js` now includes `processHoles` in pair pre-pass `db.has` docs and post-process `window.db.insert` docs, skips child-hole NFP accounting when `processHoles === false`, and attaches `pairsCacheHits`/`pairsMissing` telemetry to the background response and smoke report.
- Found and fixed a related active-path gap: `main/deepnest.js` had no `processHoles` engine config field/setter, so renderer settings and smoke overrides were silently dropped before reaching the worker. Added the default and boolean setter.
- Added deterministic equivalence coverage and fixtures: `svg-hull`, `svg-gravity-merge`, `svg-gravity-processholes-off` (hole-bearing fixture), and `svg-gravity-simplify`; regenerated `ml/tests/engine_equivalence/golden.json`. Updated boot-check title invariant to `0.7.5`.
- P0 cache proof passed with `/tmp/deepnest-perf-p0-processholes`: run1 `processHoles:false`, `pairsCacheHits:0`, `pairsMissing:1`; run2 same digest, `pairsCacheHits:1`, `pairsMissing:0`.
- Verification passed:
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check ml/tests/engine_equivalence/run.js`
  - `node --check ml/boot-check-main.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `bash ml/scripts/run_boot_check.sh`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p0 bash ml/scripts/run_smoke_battery.sh`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-perf-p0-extra bash ml/scripts/run_smoke_battery.sh svg-hull svg-gravity-merge svg-gravity-processholes-off svg-gravity-simplify`
- Benchmark note: the exact command from §8, `npm run ml:nest-benchmark -- --label perf-p0-baseline --instances albano,shirts,shapes0 --time-budget-sec 10 --runs 2`, was attempted twice at the frozen baseline and failed both times at `shirts/run-01` with `no_nest_before_time_budget`. The same command after P0 as `perf-p0-after` failed identically. Artifacts:
  - `ml/artifacts/nest-benchmark/20260707T234942Z-perf-p0-baseline/shirts/run-01/report.json`
  - `ml/artifacts/nest-benchmark/20260707T235047Z-perf-p0-baseline/shirts/run-01/report.json`
  - `ml/artifacts/nest-benchmark/20260708T000018Z-perf-p0-after/shirts/run-01/report.json`
- Do not start PERF-P1/P2 until the team decides whether to change the benchmark corpus/time gate for `shirts` or accept a partial benchmark protocol for PERF work.

### 2026-07-06 - 0.7.5: final legality gate for the slide local-refinement engine (Claude-Code)

- User reports overlapping nests correlate exactly with `localRefinementEngine: slide` being enabled, on 0.7.4 with a verified-clean NFP cache. Could not reproduce in the instrumented Electron-40 harness (tried gravity/box, user's exact Settings incl. `curveTolerance: 0`, `spacing: 0.72`, `processHoles: false`, `mlMode: override`, import-time settings seeded, loose 4-part layouts) — slide accepted 0 moves and stayed legal in every run.
- Structural finding: `refineLocalPlacements` (slide) was the only refinement engine WITHOUT the `localRefinementFinalLayoutLegal` gate (smart uses it at ~3708/3818/3851, shrinkSeparate at ~3970). Slide relied purely on per-move point-in-NFP tests, so any wrong/missing pairwise NFP lets a slide land a part on top of another and ship it. Note slide is also the only consumer that needs REVERSED-ordering pair NFPs (`localRefinementForbiddenNfps` queries both directions), which the pre-pass does not compute — those are computed on demand mid-refinement.
- Change in `main/background.js` `refineLocalPlacements`: snapshot pre-refinement placement object references; after the passes, if moves were accepted and `localRefinementFinalLayoutLegal` (incl. NFP-independent SeparationUtil material-overlap check) fails, revert all placements, zero `movesAccepted`, set `stats.revertedIllegal`, and log. Bumped to 0.7.5.
- Verified: `node --check` passes, engine-equivalence suite passes, harness slide run legal. The gate is defense-in-depth — root cause of the user's slide-correlated overlap is still not reproduced; if it recurs on 0.7.5, capture the exported SVG + the report stats (look for `revertedIllegal`) and the freshly-written nfpcache entries.
- Version metadata updated in package.json, index.html title, README, and the baseline block above.

### 2026-07-03 - Fixed overlapping-nest root cause: corrupt NFPs from ClipperLib.MinkowskiSum (Claude-Code)

- User-reported bug: nesting frame parts (rects with inner cutouts, hairline-skewed by CAD `matrix(1,-1e-6,-1e-6,-1,...)` transforms) produced overlapping placements; clearing the NFP cache did not help.
- Root cause (verified live with an instrumented Electron-40 run of the real renderer pipeline): the pair pre-pass `process()` in `main/background.js` computes outer NFPs with `ClipperLib.Clipper.MinkowskiSum` at scale 1e7; for these near-degenerate rect pairs at mixed rotations the solution comes back self-intersecting or fragmented, and the largest-ring pick returns an NFP **missing a part-sized corner region** (~108k units² measured). The placer then places parts inside the phantom region → overlaps. Corrupt results were also persisted to the disk NFP cache (geometry-keyed), which is why cache clears only helped until the next nest.
- Fix applied in `main/background.js` (2 sites): normalize the Minkowski solution with `ClipperLib.Clipper.SimplifyPolygons(solution, pftNonZero)` before ring selection — in the Parallel-worker `process()` (~line 389) and in the `getOuterNfp` ClipperLib fallback branch (~line 4501). Selection/shift semantics unchanged.
- Verification: standalone repro of the exact corrupt pair shows missing-region 108,355 → 0 units²; instrumented full nest run (7 frame parts + sheet, gravity, rotations 4, 60 s) went from dozens of corrupt cache inserts to **zero**, final placement 6/7 parts, zero overlaps (7 genuinely don't fit on the 22.5×14 in sheet).
- ML-sensitivity note: `main/background.js` is on the ML-sensitive list. The change only alters previously-corrupt outputs (makes NFPs correct), but if the trained baseline matters, run `npm run ml:checkpoint` before retraining comparisons.
- Users must **clear the NFP cache once** after picking up this fix (old poisoned entries are geometry-keyed and otherwise persist).
- Ruled out by direct test: the native addon (clean with/without holes at all rotation combos), the GeometryUtil orbit-slider fallback (clean on these inputs), stale cache keys. Separate observation: renderer-local addon `require` fails under Electron 40 ("non context-aware"), so addon calls go through the `minkowski-calculate-nfp-sync` IPC to the main process — worth its own follow-up but unrelated to this bug.

### 2026-06-15 - TIFF bitmap export + unified export modal implemented (Codex)

- Implemented the attached TIFF export plan across `scripts/conversion/local-convert.py`, `main.js`, `main/index.html`, `main/style.css`, `ml/boot-check-main.js`, and `ml/tests/tiff_export/run.js`.
- Converter: added `svg-to-tiff` doctor/dispatch support, exact DPI raster sizing, 36-1200 DPI clamp, 120 MP memory guard, white/transparent RGB output, LZW/raw/ZIP TIFF compression, RGB ICC embedding, CMYK ICC requirement + conversion, and clean errors for missing/invalid/mismatched profiles.
- Main process: added `svg-to-tiff` to the local conversion allow-list and normalized `.tif` to `tiff`.
- Renderer export: replaced the SVG/PDF/DXF dropdown with a unified modal covering SVG/PDF/DXF/TIFF; vector exports reuse the old paths; TIFF exports one file per sheet via repeated local `svg-to-tiff` conversions, with outline modes (`everything`/`artwork`/`keepEngrave`), optional top indicator, optional sheet number, DPI presets/custom, RGB/CMYK, ICC picker, background and compression controls.
- `exportNest` remains backward-compatible for `exportNest(n)` and `exportNest(n, true)`; new options enable outline filtering, fiducials, and per-sheet SVG output. The engine-equivalence harness passed after this refactor.
- Updated the boot invariant from the old export dropdown to the new four-format export modal.
- Verification passed:
  - `node --check main.js`
  - `node --check main/deepnest.js`
  - inline-script parse for `main/index.html`
  - `python3 -c "import ast; ast.parse(open('scripts/conversion/local-convert.py').read())"`
  - `python3 scripts/conversion/local-convert.py --mode doctor` (`svg-to-tiff: true`)
  - `node ml/tests/tiff_export/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `bash ml/scripts/run_boot_check.sh`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-tiff-export bash ml/scripts/run_smoke_battery.sh`
- Not yet done: manual GUI acceptance on a real nested TIFF job, and CMYK acceptance with a real CMYK `.icc` profile from the user's printer calibration folder.

### 2026-06-15 - Versioned 0.7.3 and built local DMG (Codex)

- Bumped app/package/window title metadata to `0.7.3` for the TIFF export release.
- Rebuilt the native addon with `npm run build`.
- Built `dist/Deepnest ML-0.7.3-mac-arm64.dmg` with `npm run dist`.
- Verified the DMG checksum with `hdiutil verify`.
- Packaging note: electron-builder still reports the known BOM-prefixed JSON warning, falls back to ad-hoc signing, and skips notarization because notarization is not configured.

### 2026-06-12 - Performance plan v2 after implementer review — claims verified, plan amended (Claude-Code)

The implementing coder reviewed the performance plan and pushed back. I verified every claim against the live code before amending; verdicts:

- **TRUE — version/baseline drift**: package.json + title at 0.7.5, package-lock at 0.7.3, ~32 dirty entries, last commit is the 0.7.3 release. New **PERF-P0** (baseline freeze + fresh goldens/benchmark baseline) is now a hard prerequisite.
- **TRUE — the pair pre-pass** (`background.js:346-370`) does O(n²) sync `db.has()` IPC BEFORE `placeParts`; the original P6 (prefetch inside placeParts) was too late. P6 redesigned: one batched warm BEFORE the pre-pass, pre-pass `db.has` replaced by local-mirror checks, handler parity in ALL THREE IPC hosts, byte(64MB)/time(250ms) caps.
- **TRUE — pre-pass cache-key drift**: the pre-pass doc omits `processHoles` (getOuterNfp includes it) and computes hole child NFPs unconditionally; under `processHoles:false` it re-checks the wrong key every run and pollutes the cache with unread hole-aware entries. Folded into PERF-P0 as a correctness fix with its own gate (`pairsCacheHits` telemetry proves second-run hits).
- **TRUE — harness-main IPC parity**: `ml/app-smoke-main.js:557-658` (and the teacher main) implement their own `nfp-cache-*` handlers; P5/P6's new channels must be added there or every harness run silently exercises the fallback. P5 now requires parity + a `geometryPath: 'token'|'legacy'` telemetry field, and lands in five slices (broker → worker pull behind fallback → GA call-site → refinement call-site → cleanup/failure).
- **TRUE — benchmark flags** `--instances/--time-budget-sec/--runs` exist in `ml/cli/run_benchmark.js`; the exact command is now in §8.
- **ACCEPTED — P4 base-score precision** (full pipeline incl. `improvedPlacementScore`, minus only merge credit) and **P7 moved out** to the LR/smart-refinement track.
- **ONE CORRECTION (§9a)**: expanding the DIGEST equivalence harness to "rotations 4 / threads 2-4 / normal GA" is not implementable — GA and seed rotations use `Math.random`, so digests aren't run-stable. Split instead: digest goldens extended to deterministic configs (convexhull, mergeLines, processHoles:false, simplify), a NEW legality-assertion battery (erosion-predicate no-overlap + containment + part-count) over the stochastic matrix, plus a teacher mini-run per WP batch.

Amended order: **P0 → P2 → P1 → P3 → P6 → P5 → P4**; P5/P6 blocked until P0 + §9a exist. `docs/performance-plan.md` is now v2 with all amendments inline. Codex: claim `PERF-P0 baseline freeze + pre-pass key fix` first.

### 2026-06-12 - Engine performance plan authored (Claude-Code)

- Added `docs/performance-plan.md`: seven work packages on the placement hot paths, written for a less-capable implementing model with verified line anchors (background.js anchors re-checked 2026-06-12 post-LR-work: logging sites :4508/:4677/:4758/:4878/:5046, hull triple-compute :4996-4999, mergeLines per-candidate eval :5008, dispatch payload deepnest.js:1506-1540).
- Discipline: every WP is either **output-identical** (P1 fingerprint memoization, P2 logging removal + `timing.placementMs` telemetry, P3 hull hoists, P5 geometry-once dispatch, P6 batched NFP prefetch — gated on the engine-equivalence harness) or **flagged default-off** (P4 mergeLines top-k credit cap — it can change placements; P7 refinement ring decimation — flagged engines only). No ML checkpoint needed while defaults hold.
- Key designs: P1 memoizes `polygonFingerprint` as a NON-ENUMERABLE own property (invisible to structured clone/JSON — required so it never leaks into IPC, exports, or cache files) with an immutability audit; P5 replaces the per-individual megabyte payloads (sheets + placement trees + a third children copy, confirmed at deepnest.js:1524-1537) with a nest-token pull model brokered by the main process (workers pull geometry on miss — survives worker recreation; both dispatch call sites incl. the refinement post-process migrate; `exact`-flag preservation in cloning is a named trap for mergeLines); P6 adds one `nfp-cache-find-batch-sync` IPC replacing the O(n²) per-pair sync round-trips, with a key-match dev assertion.
- Measurement: benchmark labels `perf-p<N>-before/after` on albano/shirts/shapes0 + the new timing telemetry; before/after numbers required in every handoff note. Order P2→P1→P3→P6→P5→P4→P7 (P2 installs telemetry first; P1 is a P6 prerequisite; P5 rides alone).
- Rust decision recorded: parked — the remaining wins here are algorithmic/IPC, not language-bound; revisit a rayon-parallel Rust core only when `deepsearch` lands and needs in-process parallelism.

### 2026-06-12 - Windows port plan authored (Claude-Code)

- Added `docs/windows-port-plan.md`: plan to ship a Windows x64 build preserving all features, mac unchanged. Grounded in a platform audit of the live code (line anchors cited).
- Audit result — already cross-platform: native addon load paths (`path.join` + `[\\/]` asar-unpacked rewrite), the Boost resolver (env + `third_party/boost*`, header-only Boost.Polygon), the `win` electron-builder block, the darwin-gated frameless window, and the remote DXF conversion server. The app runtime requires none of the `ml/scripts/*.sh`.
- Must-change for Windows: (A) native build npm scripts use POSIX `$(node -p …)` substitution — replace with a Node build driver `scripts/native/build-addon.cjs`; (B) `binding.gyp` needs an MSVC branch (`ExceptionHandling`/`/EHsc`, `NOMINMAX`, `/bigobj`, `/std:c++17`); (C) `getPythonCandidates` lists only `python3`+Mac paths — add `python`/`py -3`/bundled; (D) **Python sidecar** (PyMuPDF+Pillow for PDF export, PNG/PDF import, TIFF) — bundle an embeddable CPython + wheels under `python/win/**` (asarUnpack), since a clean Windows box has no Python; (E) packaging — add `win.target = [nsis, portable]`, unsigned v1; (F) `.sh` dev tooling — optional Node smoke runner.
- WP order (§10): WIN-W1 addon (MSVC+Boost; gate = nfp_equivalence passes) → WIN-W2 bundled Python (gate = converter doctor all-true + PDF/PNG round-trip) → WIN-W3 runtime branches (Mac-authorable) → WIN-W4 NSIS packaging (gate = clean-VM feature matrix §8) → WIN-W5 optional CI parity. W1/W2/W4 need a Windows build host; W3 + config edits are Mac-authorable but must not regress the mac build.
- Key traps documented: `NOMINMAX` (the classic Boost-on-Windows failure), Electron-ABI-pinned addon build, win-x64 wheel/python version match, asarUnpack for `.node` + `python/win`.

### 2026-06-12 - TIFF bitmap export plan authored (Claude-Code)

- Added `docs/tiff-export-plan.md`: concrete, self-contained implementation plan for exporting nested layouts as per-sheet raster TIFFs for print/RIP software, written for a less-capable implementing model (exact files, line anchors, options schema, algorithm pseudocode, gates).
- Feasibility proven on this Mac (2026-06-12): PyMuPDF 1.26.5 renders SVG→pixmap at exact DPI; Pillow 11.3 (libtiff + ImageCms) writes TIFF with DPI tags, embedded ICC, and RGB→CMYK conversion. **No new dependencies** — reuses the existing `scripts/conversion/local-convert.py` service.
- Scope: (T1) Python `convert_svg_to_tiff` (dumb rasterizer + color/ICC/dpi/background); (T2) add `svg-to-tiff` mode to `runLocalConversion`; (T3) refactor `exportNest` with an outline-classification enum (`everything`/`artwork`/`keepEngrave`), a top-indicator fiducial (always-kept, mm-sized tick), optional sheet-number stamp, and a `perSheet` array output; (T4) replace the export menu with a unified CollageMaker-style modal (light theme) covering all four formats.
- Locked decisions (plan §2): RGB default (embed-only) / CMYK (convert+embed, requires ICC, forces white bg); one TIFF per sheet, zero-padded naming; outline default `artwork` for TIFF / `everything` for vectors; indicator default center-top.
- Export-only feature: NOT ML-sensitive provided `placeParts` and the existing SVG/PDF/DXF vector output (default options) stay byte-identical — gated by the engine-equivalence harness.
- CollageMaker reference studied: `~/Desktop/CollageMaker/src/components/ExportModal.tsx` (React/Tauri/dark) — patterns ported (format row-list, preset tiles showing resulting size, toggle switches with self-explaining disabled states, live preview + meta, restated primary button), rebuilt in Deepnest's vanilla-JS light-theme stack.
- Next agent: claim `TIFF-T1 python svg-to-tiff converter` from the plan's §10 (T1+T2 land + test headless before any UI). For the CMYK manual gate, ask the user for a real CMYK `.icc` (they have `~/Desktop/PrinterColorCalibration`).

### 2026-06-11 - Real laurel fixture committed and probe-verified; convexhull support is the last S1 gap (Claude-Code)

The user provided the real job files (original `Lastart777.svg` two mirrored branch paths + their nest export). Analysis of the export: 13 placements, ALL `rotate(0)` — a 10-part interlocked diagonal stack at even ~41×28 pitch plus 3 stranded parts; the user runs convexhull-style placement and (nicely) has the new `sheetoutline` export feature on. Actions:

1. **Committed** `ml/examples/laurel-branches.svg` (8 offset copies of the two branch variants + 12in sheet, derived from the user's original) and `ml/smoke/scenarios/svg-laurel-settle.json`. Probe-verified end-to-end on the smoke harness: nest completes, convexhull strands ALL 8 branches (nearest-neighbor 150–487 units vs ~50 interlocked), and the smart engine no-ops with `reason: 'unsupportedPlacementType'` — i.e., the ONLY remaining gap between this fixture and a live visual gate is convexhull support in the smart engine (already specced in plan §0 amendment + §1.9.2).
2. Fixture-building traps recorded in §1.9.2: identical coincident copies collapse into one part at import (must offset copies via transforms); the legacy x64 smoke runtime lacks the native addon, so the scenario pins rotations:1 (true to the user's job) and curveTolerance:2 with a 120 s budget.
3. Codex, continuing `LRv3-S1`: (a) convexhull support in the smart engine guard + hull metric for settle, (b) the two §1.9.2 implementation fixes (inward-only candidate offsets; per-candidate moved-part-only legality), then (c) gate on `svg-hull-settle-floaters` AND `svg-laurel-settle`, and attach the before/after laurel exports to the handoff note for the user's visual sign-off.

### 2026-06-11 - S1 smart-engine implementation by Claude-Code: convexhull + group settle landed; honest gate status (Claude-Code)

Implemented directly (user request) in `main/background.js`, all gated behind `localRefinementEngine: 'smart'`; defaults verified untouched (separation/bugfix/equivalence tests, boot check, full smoke battery all green):

1. Convexhull allowed in the smart engine (hull metric via the existing fitness-v2 path).
2. Inward-only region candidates (boundary-exact + one centroid-ward nudge) replacing the ±4-direction offsets.
3. Per-candidate legality now `localRefinementSinglePlacementLegal` (O(n), moved part only); the full-layout gate runs once at engine exit, as designed.
4. Composite acceptance metric (`localRefinementSmartMetric` = pure mode metric + 5e-4 × normalized center spread); stats still report the pure metric so the substantive gate stays honest.
5. Hull-contribution (≥2%) + spread-outlier (>1.4× median center distance) floater detection alongside the contact test.
6. **Group settle = ruin & recreate**: empirical proof on the laurel fixture that single-part relocation cannot work there (390 legal candidates evaluated, best delta exactly 0 — every pocket reachable by one move is at the periphery of the jam); floaters are now removed together and re-placed sequentially against the growing cluster, with a one-shot full-rebuild escalation around a seed part; whole-group accept-or-restore; new diagnostics `settleLegalCandidates` / `settleBestDelta` / `settleDebug`.

Gate: **not claimed.** Key corrections recorded in plan §1.9.4: translate-delta stranding measurements are invalid on multi-copy fixtures (measure true world positions); with valid measurement, several fixture rolls were already well-packed (two interlocked laurel stacks — engine null results there are CORRECT); the 12-part roll reproduced the true phenotype (1 genuine stray) but the stray was jammed at rotation 0 with no reachable improving pocket. The user-job insight: their strays exist because the 10-stack hit the sheet edge, so capture = creating a second interlocked stack — the group recreate can build one sequentially, but acceptance failed when borderline tip "floaters" were recreated along with the true stray. Next increment for whoever continues: per-floater accept-or-restore inside the group, or restrict the recreate set to true spread outliers; then re-gate on `svg-laurel-settle` (12-part fixture committed) and attach before/after exports for the user.

### 2026-06-11 - S1 gate unblocked: convexhull is the floater mode; fixture committed; two S1 code fixes specced (Claude-Code)

Investigated the S1 gate blocker (`floatersDetected = 0` on all ESICUP instances) with live probes on a synthetic comb fixture. Findings:

1. **Zero floaters on gravity/box is CORRECT, not a failure.** Construction candidates are NFP-boundary positions — always in contact with a part or the sheet edge. Gravity/box cannot strand parts mid-air. The ESICUP probe is therefore a non-regression check for settle, not its gate.
2. **Convexhull is the mode that produces floaters** — any position inside the current hull ties on hull area, so late parts are dropped at arbitrary interior spots. Reproduced: `ml/examples/comb-branches.svg` (12 interdigitating comb parts, committed) under convexhull strands 7/12 parts at 200–400-unit nearest-neighbor distances (packed pairs: 62), mixed grid rotations — the user's laurel-image phenotype exactly. **Consequence: the plan's gravity/box-only scope for settle excluded the motivating use case — amended; settle/relocate/swap now support convexhull (hull metric), shrink-separate stays gravity/box.**
3. **Committed gate fixture**: `ml/smoke/scenarios/svg-hull-settle-floaters.json` (comb fixture, convexhull, smart engine, 3000 ms). Revised gate in plan §1.9.2: `floatersDetected ≥ 4`, `floatersRelocated ≥ 3`, hull-metric improvement ≥ 5%, zero illegal; ESICUP probe demoted to non-regression (settle must no-op cleanly); user-visual laurel acceptance still pending the actual job file from the user.
4. **Two S1 code fixes found reviewing the landed implementation** (also in §1.9.2): (a) region candidate offsets are ±4-direction at ~20× ε, so ~2/5 of candidates are systematically illegal — observed 73 legality rejects in one probe; make offsets inward-only or boundary-exact. (b) per-candidate legality runs the full O(n²) layout gate although only one part moved — observed 2 deadlineHits; validate the moved part only per candidate (O(n)), full gate once on final acceptance.
5. Codex: continue under the `LRv3-S1` claim — (a) convexhull support in the smart-engine guard + settle metric, (b) the two fixes above, (c) gate on `svg-hull-settle-floaters`.

### 2026-06-11 - S1 legality predicate + settle pass implemented; visual fixture still needed (Codex)

- Implemented §1.9.0 erosion material-overlap predicate:
  - `SeparationUtil.materialOverlap(A, B, config)` intersects the polygons and erodes the intersection by `0.5 * EPS_DEPTH` before declaring real material overlap.
  - Replaced the local-refinement final legality and single-placement legality area threshold with this width-consistent predicate.
  - Added separation tests for exact edge contact, 0.4-eps sliver, and 3-eps material overlap.
- Re-ran the promoted R3 smart probe immediately after the legality fix:
  - `ml/benchmark/results/20260611T231557Z-lr-s1-erosion-r3-regate-10s.json`
  - Still 0 accepted moves; legality rejects remained high, so the old relocate/swap path is not fixed by erosion alone.
- Implemented §1.9.1 settle pass behind opt-in `localRefinementEngine: 'smart'`:
  - floater detection by zero part-to-part contacts;
  - all-floater seed handling;
  - floater ordering by distance from cluster center;
  - current/grid rotation candidates when `localRefinementRotations` is true;
  - rotated-copy bookkeeping for `placed[i]` and `placements[i].rotation`;
  - settle region computations through the standalone feasible-region builder;
  - stats: `floatersDetected`, `floatersRelocated`, `settleRegionComputations`, `settleEmptyRegions`, `rotationsTried`, plus `operatorStats.settle`.
- Final S1 bounded probe:
  - `ml/benchmark/results/20260611T232202Z-lr-s1-settle-rounded-3000ms-10s.json`
  - `albano`, `blaz1`, and `shapes0` all reported `floatersDetected=0`; settle did not fire; 0 accepted moves; substantive ESICUP gate failed.
  - The real laurel/floating-parts visual fixture was not found in the workspace or Codex attachments, so the visual acceptance lane could not be run.
- Verification after S1:
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check main/util/separation.js`
  - `node --check ml/cli/run_benchmark.js`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `bash ml/scripts/run_boot_check.sh`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-s1-settle bash ml/scripts/run_smoke_battery.sh`
- Takeaway: S1 is wired and regression-clean, but it cannot be accepted on ESICUP alone because those instances have no detected floaters. Next step is to run the actual laurel floating-parts job or commit a synthetic floater fixture that exercises `floatersDetected > 0` and proves visible cluster capture.

### 2026-06-11 - Promoted smart relocate/swap implemented; bounded gate still failed (Codex)

- User approved the strategic reorder: promote legal-to-legal void relocation + swaps ahead of WP-R1, keep shrink-separate as polish/deepsearch work.
- Implemented a minimal opt-in `localRefinementEngine: 'smart'` path in `main/background.js`:
  - standalone feasible-region builder mirroring the one-part `placeParts` IFP-minus-shifted-NFP pipeline;
  - region candidate sampling from vertices, midpoints, current-point projections, and tiny curve-tolerance offsets;
  - relocate operator that accepts only full-layout-legal, strict metric-improving moves;
  - position-swap operator with same-rotation/own-pose semantics, partner bbox-ratio filter, and relocate-after-swap repair;
  - `operatorStats.relocate` / `operatorStats.swap`, `passes`, `legalityRejects`, and additive stats merging.
- Bounded smart probe:
  - First run: `ml/benchmark/results/20260611T214431Z-lr-r3-smart-relocate-swap-10s.json` completed but accepted 0 moves.
  - Offset-candidate run: `ml/benchmark/results/20260611T214700Z-lr-r3-smart-offset-candidates-10s.json` also failed the substantive gate:
    - `albano`: 0 accepted, 1 relocate tried, deadline hit.
    - `blaz1`: 0 accepted, 6 relocates tried, 9 swaps tried, 4 empty regions, 28 legality rejects.
    - `shapes0`: 0 accepted, 6 relocates tried, 12 swaps tried, 1 empty region, 103 legality rejects.
- Interpretation: the smart path is wired and safely opt-in, but the legal-to-legal gate is not green. High legality rejects imply the next diagnosis should improve feasible-region candidate generation/classification (Clipper difference paths may include boundary/holes/exact-contact samples that are not acceptable to the full polygon-area legality gate).
- Verification after promoted relocate/swap:
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check main/util/separation.js`
  - `node --check ml/cli/run_benchmark.js`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `bash ml/scripts/run_boot_check.sh`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-smart-relocate-swap bash ml/scripts/run_smoke_battery.sh`

### 2026-06-11 - LRv3-R0.3 clamp + axis-translation separator implemented; gate still failed (Codex)

- Implemented the WP-R0.3 separator path:
  - `SeparationUtil.axisBreakpoints(q, axis, ring)` plus unit tests;
  - clamp warm start (`q_i` is clamped only when it crosses the virtual `qLimit_i`; global proportional squeeze no longer drives the attempt);
  - Umetani-style min-overlap axis translations with residual overlap allowed between moves;
  - GLS pair reweighting on stuck sweeps;
  - exact-region relocation demoted to fallback after repeated stuck cycles;
  - empty fallback regions are skipped, not fatal, with one-shot empty fallback caching per part/attempt;
  - curve-tolerance-derived breakpoint clearance and final-legality checks before accepting a shrink step;
  - axis-line/NFP-bound prefiltering so dense layouts do not scan every edge for impossible axis crossings.
- Bounded R0.3 gate result: **failed**. The final recorded run is `ml/benchmark/results/20260611T204037Z-lr-r0.3-prefilter-10s.json`:
  - `albano`: 0 accepted, 0 feasible, 1 infeasible, 1 deadline hit, relative improvement 0.
  - `blaz1`: 0 accepted, 1 separator-feasible attempt, 1 final-legality rejection, 3 infeasible attempts, relative improvement 0.
  - `shapes0`: 0 accepted, 0 feasible, 4 infeasible, 1 exact relocation, 19 empty fallback regions, relative improvement 0.
- Diagnostic trail:
  - `ml/benchmark/results/20260611T202723Z-lr-r0.3-clamp-axis-10s.json` showed the mechanism can substantially improve `albano` in one run (3 shrink steps, 1.94% relative improvement) but did not pass the 2/3 gate.
  - `ml/benchmark/results/20260611T202927Z-lr-r0.3-clamp-axis-5srefine.json` showed extra budget alone does not solve legality/fallback failures.
  - `ml/benchmark/results/20260611T203157Z-lr-r0.3-clamp-axis-legal-10s.json`, `20260611T203334Z-lr-r0.3-clamp-axis-fallback-cache-10s.json`, and `20260611T203751Z-lr-r0.3-active-neighbors-10s.json` document the legality-gate and performance refinements.
- Verification after R0.3:
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check main/util/separation.js`
  - `node --check ml/cli/run_benchmark.js`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `bash ml/scripts/run_boot_check.sh`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-local-refinement-r0.3 bash ml/scripts/run_smoke_battery.sh`
- Takeaway: R0.3 is implemented and regresses neither boot nor default engine equivalence, but the bounded efficacy gate still blocks WP-R1. The next diagnosis should focus on why axis translation can still time out in the first attempt on some dense nests, and why `blaz1` reaches separator feasibility that the final polygon-area legality backstop rejects.

### 2026-06-11 - WP-S1 "settle pass" approved and specced; legality-predicate root cause identified (Claude-Code)

User approved the settle-pass direction (motivated by a real laurel-branch nest with a dense interlocked cluster and ~6 floating parts stranded at arbitrary rotations). Spec: `docs/local-refinement-v3-plan.md` §1.9. Two parts:

1. **§1.9.0 — FIX THE LEGALITY PREDICATE FIRST (blocks every tier).** The Codex 'smart' relocate/swap gate failure ("many legality rejects from feasible-region boundary candidates") has the same root cause as blaz1's R0.3 reject: region-boundary candidates are exact-contact positions, Clipper quantization (~1/clipperScale) turns a legal contact edge of length L into intersection area ≈ L·δ, which exceeds the (1e-3·curveTolerance)² area gate. Area cannot distinguish a long legal contact sliver from a real overlap. Replace with the width-consistent **erosion predicate**: `materialOverlap = nonEmpty(offset(intersect(A,B), −EPS_DEPTH/2))`, unit-tested (exact contact + 0.4·EPS overlap ⇒ legal; 3·EPS ⇒ illegal). Re-run the R3 bounded probe immediately after this lands — it alone may flip several rejects to accepts.
2. **§1.9.1 — settle pass** extending the landed 'smart' engine: floater detection (zero part-contacts), settle order by distance from cluster, grid-rotation alignment toward the dominant cluster rotation (warm cache, respects job rotation constraints, ≤4 tried), relocation via `buildFeasibleRegion` with the REAL IFP (no virtual clipping; no rectangle-sheet guard needed), construction-metric candidate scoring, erosion-predicate legality, budget 3000 ms recommended. Gate §1.9.2: ≥0.5% relative improvement on ≥2/3 bounded instances + visible floater capture on the user's laurel job. §1.9.3: optional A/B vs `experiments/physics-nest` on the same layout to settle the literal-physics question with data.
- Annealed relax ("shaking" as Metropolis acceptance) is WP-S2, only after S1 is green.
- Codex: claim `LRv3-S1 legality predicate + settle pass`. Suggested order: erosion predicate + tests → re-run R3 probe → floater/rotation/settle additions → §1.9.2 gate.

### 2026-06-11 - R0.3 autopsy: tolerance mismatch + cost cliff diagnosed; WP-R0.4 + strategic reorder proposed (Claude-Code)

R0.3 was implemented faithfully and its instrumentation made the diagnosis precise. From `20260611T204037Z-lr-r0.3-prefilter-10s.json`:

1. **blaz1 "separator-feasible but polygon-illegal" is a dimensional spec error (mine):** separation accepts residual depth ≤ ε ≈ 7.2e-5 while the legality gate bounds intersection AREA by ≈ 5e-7; a sub-ε sliver along a 50-unit edge has area ≈ 2.5e-3 — 4 orders of magnitude over. Fix: deterministic contact-polish pass (push sub-ε pairs out along exit vectors, ≤3 rounds, zero-residual required) before acceptance. Specced in plan §1.8.
2. **albano timeout is a per-visit cost cliff:** `movesTested:1` — one part-visit ate the full 1500 ms (curved parts ⇒ NFP rings with hundreds of vertices × 64 candidates × n neighbors). Fix: decimate provider rings to curveTolerance resolution for separation queries only (legality gate keeps full rings; polish absorbs the error) + bbox neighbor prefilter. Specced in §1.8.
3. **shapes0 empty regions at a packed boundary are correct behavior** — no action.
4. **Strategic reorder proposed (needs user sign-off):** promote the legal-to-legal operators (void relocation + swaps, old WP-R3) to the next WP — they need no separation convergence, reuse the already-proven `buildFeasibleRegion`, and are the likeliest first substantive green gate. Re-scope shrink-separate as a polish operator for budgets ≥ 5000 ms and as a core loop of the future `deepsearch` mode (its natural habitat). WP-R1's chain targeting then serves relocation first.

### 2026-06-11 - WP-R0.2 gate failure diagnosed: two plan design errors; WP-R0.3 specced (Claude-Code)

The R0.2 implementation was faithful and the gate failure honest — the defects are in this plan's design, found and fixed as follows:

1. **Global proportional squeeze is the wrong warm start.** It displaces every part, creating O(n) simultaneous overlaps — the hardest possible separation problem. The literature (sparrow) shrinks the container and only the items sticking out get pulled in: overlaps stay localized at the boundary. Replaced by a **clamp warm start** (only parts with `q.x > qLimit` move, to exactly `qLimit`).
2. **Zero-overlap-or-fail relocation deadlocks on dense layouts.** With all-others-fixed, no pocket exists until several parts shuffle cooperatively — which requires intermediate states that retain overlap. That is exactly the "exact relocations happened but regions came up empty / no convergence" signature of the R0.2 gate run. Replaced by **Umetani min-overlap axis translations**: per violating part, translate along x/y to the strict argmin of total weighted penetration, candidates taken from NFP boundary crossings of the axis line (±2ε) — contact-exact pockets are reached analytically AND intermediate residual overlap is allowed; GLS pair reweighting on stuck sweeps; exact-region relocation demoted to a fallback after 3 stuck cycles, empty region no longer fatal.
3. Empirical ledger (restack toy, n=12, 20 seeds): argmax GLS 0/20 → sweep GLS 0/20 → zero-overlap relocation 20/20 on toy but deadlocks on real layouts → **clamp + axis translations: 20/20 in mean 3.8 sweeps**. The winning move set is Umetani et al. 2009's published separation operator, validated on the same ESICUP family our gate uses.
4. Spec: `docs/local-refinement-v3-plan.md` §1.7 **WP-R0.3** (modifies `separateBySweep`; new pure helper `SeparationUtil.axisBreakpoints(q, axis, ring)` with unit test; candidate cap 64/part-axis; sweep cap 60; alphaMin stays 0.0005; §1.6 substantive gate unchanged). Codex: next claim `LRv3-R0.3 clamp + axis-translation separator`. WP-R1 stays blocked until the §1.6 gate passes substantively.

### 2026-06-11 - LRv3-R0.2 exact-relocation separator implemented; substantive gate failed (Codex)

- Implemented the WP-R0.2 separator path in `main/background.js`:
  - seeded sweep over currently violating parts;
  - cheap exit/axis nudge candidates that must fully clear residual violation;
  - exact feasible-region relocation using the clipped virtual IFP minus all shifted current NFP blockers;
  - nearest-region-point selection via ring vertices plus edge projections;
  - fail-closed empty-region/deadline behavior and additive stats (`exactRelocations`, `emptyRegionHits`, `relativeImprovement`, `epsilonScaleFeasible`).
- Restored shrink-separate `alphaMin` to `0.0005` and tightened acceptance so eps-scale relative improvements below `1e-6` do not count as accepted moves.
- Bounded substantive gate result: **failed**. No run reached the required ≥0.5% relative metric improvement on ≥2/3 bounded ESICUP instances.
  - Fail-fast/cold result: `ml/benchmark/results/20260611T200508Z-lr-r0.2-exact-10s.json`
  - Fail-fast/warm result: `ml/benchmark/results/20260611T200704Z-lr-r0.2-exact-warm-10s.json` (`albano`: 0 accepted, 0 feasible, 4 infeasible, 3 exact relocations, 4 empty-region hits; `blaz1`: 0 accepted, 0 feasible, 4 infeasible, 1 exact relocation, 4 empty-region hits; `shapes0`: 0 accepted, 0 feasible, 4 infeasible, 0 exact relocations, 4 empty-region hits)
  - Diagnostic variant with deferred empty regions: `ml/benchmark/results/20260611T200916Z-lr-r0.2-defer-empty-10s.json`
  - Diagnostic variant with 20 sweeps: `ml/benchmark/results/20260611T201117Z-lr-r0.2-sweep20-10s.json`
- Takeaway: exact relocations do occur, but the current feasible-region relocation strategy still does not reliably converge to a legal improved layout on the bounded benchmark. Do **not** proceed to WP-R1 yet; the separator/region strategy needs another diagnosis pass first. The code has been returned to the written R0.2 fail-fast semantics after the diagnostic variants failed.
- Verification after returning to fail-fast R0.2 semantics:
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check main/util/separation.js`
  - `node --check ml/cli/run_benchmark.js`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `bash ml/scripts/run_boot_check.sh`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-local-refinement-r0.2-final bash ml/scripts/run_smoke_battery.sh`

### 2026-06-11 - WP-R0.1 review: gate hollow; second diagnosis round; WP-R0.2 specced (Claude-Code)

Reviewed the Codex WP-R0.1 batch. The virtual-sheet implementation is correct, the new counters work, and the discipline (stop before WP-R1) was right. But the **bounded gate pass is substantively hollow**, and a second diagnosis round found the real remaining defect.

1. **Gate autopsy** (from `20260611T193645Z-lr-r0.1-alpha-light-10s.json`): albano 0 accepts (13 infeasible attempts); blaz1 1 accept with `scoreBefore === scoreAfter` to 16 digits; shapes0 1 accept worth Δ=1.3e-6 (0.00013%). With `alphaMin = 1e-6`, squeezes shrink below the separator's eps and become trivially feasible — the gate counted accepts without measuring their size. That gate was my design error; replaced by the substantive gate in plan §1.6.
2. **Why meaningful squeezes all fail** (alpha 0.005…0.0005, `deadlineHits=0` so not budget): two controlled experiments on a restack-required toy (12 squares, two full rows, 1% squeeze, free third row; the only legal restack position is contact-exact `qy=20.0`):
   - current argmax-GLS separator: **0/20 feasible** (~58 iterations — argmax re-selects the same boxed-in part until `strikes > n` kills each attempt);
   - Umetani-style randomized-sweep GLS: **also 0/20** — root cause is not target selection but that **stochastic candidates cannot land in contact-exact (near measure-zero) pockets**, and greedy descent rejects the cost-increasing intermediate states needed to climb into them;
   - sweep + cheap nudges + **exact feasible-region relocation** (NFP region math — the same machinery as placeParts / the planned WP-R3 `buildFeasibleRegion`): **20/20 feasible**, improvement by construction.
3. **Action:** `docs/local-refinement-v3-plan.md` §1.6 **WP-R0.2** (REQUIRED before WP-R1): `separateBySweep` in `main/background.js` — seeded-random sweep over violating parts; exit-nudges first; exact relocation via `buildFeasibleRegion` (pulled forward from WP-R3, IFP input parameterized so the clipped/virtual IFP flows through) to the NEAREST region point; empty region ⇒ fail fast; ≤5 sweeps; no GLS weights needed (region relocation creates no new overlaps, so the violating set shrinks monotonically). `alphaMin` restored to 0.0005. New stat `exactRelocations`. Substantive gate: ≥0.5% relative metric improvement on ≥2/3 bounded instances, eps-scale accepts don't count, then the full WP-2.2 corpus gate.
4. Codex: next claim is `LRv3-R0.2 exact-relocation separation`. WP-R1 stays blocked.

### 2026-06-11 - LRv3-R0.1 virtual-sheet fix implemented; bounded gate passed (Codex)

- Implemented the WP-R0.1 provider-layer fix in `main/background.js`:
  - per-attempt virtual extent boundary for x/y shrink axes;
  - per-part reference-point `qLimit`;
  - real IFP clipping to the virtual half-plane with Clipper `ctIntersection`;
  - clipped `ctx.sheetBounds` for `SeparationUtil` candidate prefilter;
  - real-sheet final legality gate remains unchanged.
- Added required additive instrumentation to shrink-separate stats:
  - `attemptsFeasible`
  - `attemptsInfeasible`
  - `deadlineHits`
  - `feasibleNotImproved`
  - zero-valued fields are preserved through `mergeLocalRefinementStats`.
- First rerun of the WP-R0.1 bounded gate:
  - Result file: `ml/benchmark/results/20260611T192305Z-lr-r0.1-virtual-shrink-10s.json`
  - Instances: `albano,blaz1,shapes0`; 1 run each; construction budget 10s; refinement budget 1500ms.
  - Gate result: failed. `shrinkSteps=0` and `movesAccepted=0` on all 3 instances.
  - Diagnostics: `attemptsFeasible=0`, `attemptsInfeasible=4`, `deadlineHits=0`, `feasibleNotImproved=0` on each instance. This is no longer the original "feasible but no compaction pressure" failure; virtual containment is active, but separation did not find any feasible clipped-strip repair even after alpha halving to the floor.
- Added opt-in heavy residual diagnostics (`localRefinementDiagnostics === true`) and ran `ml/benchmark/results/20260611T193221Z-lr-r0.1-diagnostic-10s.json`. That showed `blaz1` and `shapes0` residuals shrinking nearly linearly with alpha and no missing geometry, so the old `alphaMin=0.0005` was too coarse for dense layouts. Heavy diagnostics were then made opt-in because they consumed enough budget to cause deadline hits.
- Lowered shrink alpha floor from `0.0005` to `0.000001`.
- Final bounded WP-R0.1 gate:
  - Result file: `ml/benchmark/results/20260611T193645Z-lr-r0.1-alpha-light-10s.json`
  - Instances: `albano,blaz1,shapes0`; 1 run each; construction budget 10s; refinement budget 1500ms.
  - Gate result: **passed bounded gate**. `blaz1` and `shapes0` accepted one shrink step each; `albano` remained infeasible.
  - Aggregate: `instancesWithAcceptedMoves=2/3`, `totalMovesAccepted=2`, `feasibleNotImproved=0`, `deadlineHits=0`.
  - This proves the virtual-sheet mechanism can accept legal improving shrink steps on the bounded probe. It does **not** replace the full WP-2.2 corpus gate.
- Verification passed after WP-R0.1:
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check main/util/separation.js`
  - `node --check ml/cli/run_benchmark.js`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-local-refinement-r0.1-final bash ml/scripts/run_smoke_battery.sh`
- Recommendation: full WP-2.2 corpus gate is the next decision point before WP-R1. Use the new benchmark flags; expect the full frozen run to be expensive. If full gate is deferred, keep `localRefinementEngine` default at `'slide'` and continue treating `shrinkSeparate` as experimental.

### 2026-06-11 - Shrink-separate efficacy benchmark plumbing + bounded result (Codex)

- Added Local Refinement benchmark flags to `ml/cli/run_benchmark.js`:
  - `--local-refinement true|false`
  - `--local-refinement-engine slide|shrinkSeparate|smart`
  - `--local-refinement-budget-ms <ms>`
  - `--local-refinement-rotations true|false`
  - `--local-refinement-max-cold-angles-per-part <n>`
  - aliases `--refinement`, `--refinement-engine`, `--refinement-budget-ms`
- Benchmark scenarios now pass those flags through `configOverrides`, record per-run `localRefinement` / `localRefinementSummary`, and aggregate accepted-move stats (`instancesWithAcceptedMoves`, `totalMovesTested`, `totalMovesAccepted`, accepted rates).
- Added a `smart` guard in `main/background.js`: if `localRefinementEngine === 'smart'` before WP-R5 exists, the refinement metadata reports `{engine:'smart', reason:'engineNotImplemented'}` instead of silently routing to slide.
- Bounded efficacy check:
  - Off result: `ml/benchmark/results/20260611T184920Z-lr-r0-efficacy-off-3x10s.json`
  - Shrink result: `ml/benchmark/results/20260611T184753Z-lr-r0-efficacy-shrink-10s.json`
  - Instances: `albano,blaz1,shapes0`; 1 run each; construction budget 10s; shrink budget 1500ms.
  - `shrinkSeparate` ran on all 3 instances, with 876 total separator iterations and **0 accepted moves** (`instanceAcceptedRate: 0`, `runAcceptedRate: 0`).
  - Utilization deltas from this 1-run bounded comparison are noisy due GA randomness and should not be treated as the gate, but the accepted-move signal is negative: mean delta was -4.717pp and no `shrinkSteps` were accepted.
  - Extra probe: `ml/benchmark/results/20260611T185035Z-lr-r0-efficacy-shrink-albano-5srefine.json` (`albano`, 10s construction, 5000ms refinement) also accepted 0 moves after 383 iterations.
  - A first attempted 5-instance 10s off run hit `shirts` `no_nest_before_time_budget`; partial file is `ml/benchmark/results/20260611T184626Z-lr-r0-efficacy-off-10s.json`.
- Verification after benchmark edits passed:
  - `node --check ml/cli/run_benchmark.js`
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check main/util/separation.js`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-local-refinement-r0-benchmark bash ml/scripts/run_smoke_battery.sh`
- Recommendation: do **not** start WP-R1 yet. Either run the full WP-2.2 gate with the new flags, or diagnose why shrink-separate reaches feasible/no-improvement states but accepts no shrink steps on real benchmark layouts. The next likely debugging target is instrumenting rejected shrink attempts (`result.feasible`, candidate metric, residual depth, legality revert status) before adding smart operators.

### 2026-06-11 - Local Refinement v3 WP-R0 foundation implemented (Codex)

- Implemented SOTA WP-2.1 `SeparationUtil` in `main/util/separation.js` and loaded it in `main/background.html`. It provides `pointInRing`, boundary distance, NFP penetration, IFP containment, deterministic `mulberry32`, and the budget/deadline-aware GLS `separate(ctx)` loop. Boundary contact with zero residual depth is treated as legal by the separator loop, matching Deepnest placement semantics.
- Added `ml/tests/separation/run.js` with hand-built square NFP fixtures covering non-overlap, overlap depth/exit, child-hole semantics, containment, deterministic three-square repair, and deadline exit.
- Added deterministic default-flag equivalence harness `ml/tests/engine_equivalence/run.js` plus `golden.json`. The harness uses the existing smoke inputs with deterministic knobs (`populationSize=1`, `mutationRate=0`, `threads=1`, `rotations=1`) because the full GA smoke digests are nondeterministic across fresh app launches.
- Wired flagged Local Refinement engine selection:
  - defaults remain `localRefinement: false` and `localRefinementEngine: 'slide'`;
  - Settings now expose engine select (`Slide`, `Shrink-separate`) and budget ms/sheet;
  - `main/deepnest.js` validates `localRefinementEngine`, `localRefinementBudgetMs`, `localRefinementRotations`, and `localRefinementMaxColdAnglesPerPart`.
- Added `refineByShrinkSeparate(...)` in `main/background.js`, selected only when `config.localRefinementEngine === 'shrinkSeparate'`. It supports rectangular `gravity`/`box` sheets, squeezes toward the gravity origin, calls `SeparationUtil.separate(...)`, keeps strict metric improvements, recomputes merge-line metadata through the existing call site, and fail-closes through a final NFP/IFP legality gate plus Clipper intersection area for hole-free pairs.
- Updated SOTA/v3 docs: `docs/sota-nesting-implementation-plan.md` registry includes `localRefinementMaxColdAnglesPerPart`; `docs/local-refinement-v3-plan.md` marks WP-R0 implemented and WP-R1…WP-R6 pending.
- Verification passed:
  - `node --check main/util/separation.js`
  - `node --check main/background.js`
  - `node --check main/deepnest.js`
  - `node --check ml/tests/separation/run.js`
  - `node --check ml/tests/engine_equivalence/run.js`
  - executable inline-script parse for `main/index.html`
  - `node ml/tests/separation/run.js`
  - `node ml/tests/engine_bugfixes/run.js`
  - `node ml/tests/engine_equivalence/run.js`
  - focused app smoke with `localRefinement=true`, `localRefinementEngine='shrinkSeparate'`, budget 500 ms completed and reported `engine: "shrinkSeparate"`
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-local-refinement-r0 bash ml/scripts/run_smoke_battery.sh`
- Not run: benchmark corpus gate for `'shrinkSeparate'` utilization and `npm run ml:bakeoff`; leave those for WP-2.2 gate review before making any default decision.
- Next agent: proceed to `LRv3-R1 contact graph + critical chain` (`main/util/refinement-util.js`, tests) using this separator and shrink-separate branch as the foundation. Do not implement `smart` operators until WP-R1/R2 unit tests exist.

### 2026-06-11 - Shrink-separate zero-accepts diagnosed: WP-2.2 plan defect, fix specced as WP-R0.1 (Claude-Code)

The bounded efficacy result (0 accepted moves on albano/blaz1/shapes0, 876 separator iterations, unchanged at 5000 ms budget) is **not an implementation bug — it is a defect in the WP-2.2 spec I authored**: containment was validated against the ORIGINAL sheet, so the separator (whose cost function only minimizes overlap) is free to resolve squeeze overlaps by pushing parts back out or scattering them. The literature's mechanism shrinks the **container**, making feasibility itself the improvement; my spec dropped that ("no virtual sheet needed") and thereby removed all compaction pressure.

Empirical proof (A/B with the real `SeparationUtil`, 3 packed 10×10 squares, 5% squeeze, 20 seeds, 500 ms):
- A, original-sheet containment (current code): 20/20 separations feasible, mean resulting width **42.4** vs starting 30 — actively worse; improvements only by chance (10/20 on this toy with abundant free space; ≈0 on dense real instances, matching the benchmark).
- B, IFP clipped to the squeezed extent (q.x ≤ 18.5): 17/20 feasible and **every feasible result improved by construction** (mean width 25.0 — the separator even discovered vertical restacking); the 3 infeasible attempts are what the alpha-halving loop is designed to absorb.

Action: `docs/local-refinement-v3-plan.md` gains **§1.5 WP-R0.1 (REQUIRED before WP-R1)** with the precise fix: per-part `qLimit_i = virtualBoundary − (maxVertexX_i − refX_i)`, Clipper-clipped IFP provider memoized per (source, rotation, qLimit), clipped ctx.sheetBounds, fail-closed empty clips, unchanged real-sheet final legality gate, mandatory instrumentation (`attemptsFeasible/attemptsInfeasible/deadlineHits/feasibleNotImproved`), an incremental-evaluation performance fallback if deadlineHits dominate at n ≥ 20, and a re-gate (bounded probe: accepts on ≥2/3 instances, then the full WP-2.2 benchmark gate). The SOTA plan's WP-2.2 provider spec is annotated as AMENDED. Codex: claim `LRv3-R0.1 virtual-sheet fix` next; WP-R1 stays blocked until its gate passes.

### 2026-06-11 - WP-R0 foundation review (Claude-Code)

Independent verification of the Codex WP-R0 batch (SeparationUtil + equivalence harness + shrinkSeparate engine). Verdict: **correct and spec-faithful; one functional proof still outstanding before WP-R1 work should proceed.**

Verified correct (code read + re-execution):
- `main/util/separation.js` matches the WP-2.1 contract: API surface, boundary-is-outside `pointInRing`, NFP-children-as-holes penetration, multi-ring IFP containment, proper mulberry32 (Math.imul), and the GLS `separate(ctx)` loop (weights init 1, wSheet 2.0, 3 attempts, 50n iters, exit/entry candidates with 2ε nudges + 12 gaussians σ=0.5·bboxDiag + 4 uniform, argmax-weighted-cost target selection, strict-improvement acceptance, strikes>n, depth/maxDepth reweighting between attempts, in-loop deadline, fail-closed on missing geometry).
- `refineByShrinkSeparate` matches WP-2.2: guards (≥2 parts, gravity/box, rect sheet, SeparationUtil presence — all fail-soft with stats.reason), α schedule 0.005→[0.0005, 0.02] with ×1.5/÷2 adaptation, box x/y alternation, deterministic seed `nestindex*104729+17`, ε = max(1e-9, 1e-4·curveTolerance), memoized NFP/IFP providers, metric = fitness-v2 sheetMetric, two-layer final legality gate (NFP penetration + IFP containment via SeparationUtil, plus Clipper pairwise intersection backstop) with revert + `legalityRevert` reason, additive stats, mergeLines recompute preserved at the call site.
- Equivalence harness design is sound: determinism achieved by pinning `populationSize:1, mutationRate:0, threads:1, rotations:1` (the deterministic seed individual — no Math.random influence), default flags forced, committed `golden.json`, digest comparison across the 5-battery. Re-ran: passes. Separation unit tests and full battery re-ran green.
- Behavioral spot check: ad-hoc smoke with `localRefinementEngine='shrinkSeparate'` on the 3-part fixture ran the engine end-to-end (13 separation iterations, feasible separations, α decayed to floor) and correctly accepted 0 moves — the fixture is already corner-packed with zero recoverable slack, so 0 is the right answer there.

Findings / follow-ups (none blocking the merge, one blocking WP-R1):
1. **BLOCKING for WP-R1: functional efficacy is unproven on real instances.** The trivial fixture cannot distinguish "engine works but no slack" from "engine can never improve". Run the WP-2.2 benchmark gate before building operators on top: extend `ml/cli/run_benchmark.js` with a local-refinement flag and compare refinement-on vs off on the frozen corpus (gates: movesAccepted>0 on ≥70% of instances; mean ≥ +1.5pp).
2. `shrinkSeparateOnce` shared-primitive extraction (v3 plan §1.3) was not done — the loop body is inline in `refineByShrinkSeparate`. Must be extracted by WP-R5 at the latest so 'smart' does not fork the code.
3. The Clipper legality backstop skips pairs where either part has holes (`localRefinementClipperIntersectionArea` returns 0) — justified to avoid false reverts on legal hole-nesting (outer-ring intersection is legal there), and the NFP penetration layer still covers those pairs; documented here so nobody "fixes" it naively.
4. `main/deepnest.js:767` already accepts `'smart'` as a valid engine value but `main/background.js` silently routes it to the slide engine — harmless forward-compat, but a dev setting 'smart' today gets 'slide' without any indication. Consider stats.reason='engineNotImplemented' until WP-R5.

### 2026-06-11 - Local Refinement v3 implementation plan authored (Claude-Code)

- Added `docs/local-refinement-v3-plan.md`: the implementation plan for the approved "smart" Local Refinement direction (user + coder sign-off). It extends the SOTA plan's Phase 2 and supersedes WP-2.3's blind rotation probes.
- Core design: budgeted multi-operator orchestrator (`localRefinementEngine: 'smart'`, default remains 'slide') combining (1) the WP-2.2 shrink–separate translation backbone, (2) contact-graph **critical-chain targeting** so moves focus on the parts that actually pin the layout extent, (3) **geometry-derived rotation candidates** (hull-edge alignment between contacting parts, pivot/"rocking" rotations about contact points, cache-warm grid angles first, slenderness gating, cold-angle caps), (4) **void relocation** via a standalone feasible-region builder (placeParts pipeline mirrored, hot path untouched), (5) pairwise position swaps, and (6) ruin-&-recreate using the construction scorer as re-placer.
- New module `main/util/refinement-util.js` (contact probes via direct penetration nudges — no normal math; criticalChain BFS; rotationCandidates; pivot pose formula `t' = R_delta(t−c)+c`) with Node unit tests; orchestrator in `main/background.js` behind the engine flag; badge/stats contract preserved with additive operator counters; final legality gate identical to WP-2.2.
- Prerequisites called out explicitly: SOTA WP-2.1 (SeparationUtil), WP-2.2 (shrink–separate, shared `shrinkSeparateOnce` primitive), and the still-missing §8.3 engine-equivalence harness.
- Gates: 'smart' ≥ 'shrinkSeparate' +0.75pp and ≥ no-refinement +1.5pp mean median utilization on the frozen benchmark; rotation acceptances must actually fire on slender-part instances; all shipped layouts legal; ML checkpoint before any default flip.
- SOTA plan §5/§10 updated to point at the v3 plan. No code changed.
- Next agent: build WP-R0 prerequisites first (SOTA WP-2.1 + §8.3 harness + WP-2.2), then claim `LRv3-R1 contact graph + critical chain`.

### 2026-06-11 - Sheet margin setting + export sheet outline option (Claude-Code)

Two user-requested features, both default-preserving (margin 0, outline off ⇒ behavior unchanged):

- **Sheet margin** (`sheetMargin`, default 0, unit-converted like spacing via `data-conversion`):
  - `main/index.html`: defaultconfig key, Settings row under "Space between parts", `explain_sheetMargin` card.
  - `main/deepnest.js`: defaultconfig + config-merge parse; in `start()`, after the existing spacing offsets, every sheet's outer ring is inset by the margin via `polygonOffset(tree, -margin)` (largest-area piece kept, ring replaced in place, children/holes untouched). Applied before IPC, so gravity/box/hull AND Step & Repeat all respect it with no engine changes. If the inset collapses a sheet, `start()` sets `DeepNest.lastStartError` and returns `false`.
  - Both `DeepNest.start` callers now handle `false`: the UI path reverts workspace state and shows the error; the teacher path calls `fail('start_rejected', ...)`.
- **Export sheet outline** (`exportSheetOutline`, default false, checkbox in Settings near merge lines):
  - `main/index.html`: defaultconfig key, both checkbox save/load lists, Settings row, explain card; `exportNest` revives the previously commented-out sheet-element block, gated by the flag — sheet `svgelements` are cloned per sheet group as stroke-only nodes with `class="sheetoutline"` (images skipped). Applies to SVG/DXF/PDF export paths since they all go through `exportNest`.
- New permanent smoke scenario `ml/smoke/scenarios/svg-gravity-sheet-margin-outline.json` (gravity, rotations 1, margin 50, outline on) added to `ml/scripts/run_smoke_battery.sh`.
- Verification:
  - `node --check main/deepnest.js` passed; inline `main/index.html` script parse passed; `bash ml/scripts/run_boot_check.sh` passed.
  - Full smoke battery passed BEFORE the battery addition (defaults unchanged) and AFTER with the new scenario included.
  - Geometric proof from the new scenario's export: sheet 1200×800 at origin, margin 50 ⇒ all three parts' world bounds start at exactly x=50/y=50 (gravity packs against the inset boundary); export contains the sheet rect with `class="sheetoutline"`. Baseline svg-gravity export contains zero `sheetoutline` nodes (default off).
  - Too-large margin (10000 on an 800-high sheet): nest refuses to start; ad-hoc smoke reported `failed/timeout` with no crash and no partial placements.
- ML-sensitive files touched (`main/index.html`, `main/deepnest.js`) but defaults preserve teacher behavior; no checkpoint taken. The margin is config-driven and geometry-keyed NFP caching makes margined sheets distinct cache entries automatically.
- Known limitations recorded: margin insets the sheet outer ring only (sheet holes are not expanded by the margin); with mergeLines enabled the exported sheet outline participates in common-line merge processing like any other geometry.

### 2026-06-11 - SOTA WP-0/WP-1.1 implementation review (Claude-Code)

Independent verification of the Codex WP-0 + WP-1.1 batches against `docs/sota-nesting-implementation-plan.md`. Verdict: **implementation is correct and process-compliant; the WP-1.1 gate failure is a plan defect, not an implementation defect.**

Verified correct (by code read + re-execution):
- Fitness v2 matches the plan formula exactly: v1 `fitness += sheetarea` suppressed under v2 (`main/background.js:2218-2220`); per-sheet `2.0 + metric` accumulated after refinement (`:2527-2541`); gravity/box/hull metrics as specified (`:1240-1250`); unplaced penalty preserved with guarded denominator; `fitnessBreakdown` additive; candidate-level scoring untouched; flag defaults to 1 everywhere (`main/index.html:416`, `main/deepnest.js:37,749-750`).
- WP-0 converter: `utilizationFromPlacements` uses original un-inflated polygons rotated per placement, `usedLength = maxX − sheetBounds.x`, trueArea sum (`ml/lib/esicup-convert.js:448-479`) — per plan. Runner preset exact (gravity/spacing 0/mergeLines false/processHoles true/pop 10/mut 10/per-instance rotations); report schema matches plan §WP-0.3.
- Gate numbers reproduce independently from the result JSONs: baseline 65.300%, v2 65.010%, delta −0.290pp across the 10 gate instances (gardeyn4 via the supplement file). All three new test suites pass; `node --check` clean on all touched files.

Review findings (action items):
1. **Plan §8.3 engine-equivalence harness was not built** (`ml/tests/engine_equivalence/` does not exist). Flag-off equivalence was inferred from the smoke battery passing, which does not compare placements. The runner already emits `placementsDigest` per run — build the golden-digest harness before WP-1.2 lands.
2. **The WP-1.1 +0.5pp gate could not structurally pass on this corpus.** All benchmark instances are single-sheet strips; on a single sheet, v1's discriminating term (last-part `2W+H` + negligible `W/sheetarea`) and v2's metric (`(2W+H)/(2SW+SH)`) are monotone transforms of essentially the same scalar, so GA selection ranking is near-identical and v2 cannot add signal. The observed deltas are GA run noise: swim's −1.957pp sits inside v2's own 2.400pp 3-run spread; jakobs1/gardeyn2/gardeyn4 are fully deterministic (0.000 spread and 0.000 delta). v2's real value per the plan is multi-sheet comparability + serving as WP-2/WP-3's layoutMetric. **Recommended plan revision:** WP-1.1 gate becomes non-regression (mean delta ≥ −0.5pp, satisfied at −0.290) + the fitness_v2 unit tests + a multi-sheet comparability check; keep default at 1 until WP-2 consumes it; proceed to WP-1.2.
3. Minor: report-schema drift (`median` is an object in the main baseline but a raw number in the gardeyn4 supplement — consolidate before results accumulate); no explicit `spacing===0` assert in the runner (preset hard-codes 0, de facto fine); `rotationsForMeta` takes the max across items, so mixed-orientation instances would over-permit rotations for stricter items (document in ATTRIBUTION; uniform for current corpus); gardeyn3's `no_nest_before_time_budget` failure at 240s is itself an engine-capacity data point worth keeping visible.
4. Several instances show 0.000 3-run spread, i.e. 240s yields deterministic results (best nest = early deterministic seed individual). Benchmark sensitivity is limited; consider recording generations-completed per run in the report to aid interpretation.

### 2026-06-11 - SOTA WP-1.1 fitness v2 implemented, gate failed (Codex)

- Implemented default-off `fitnessVersion` plumbing:
  - `main/index.html`: hidden default `fitnessVersion: 1`; app smoke reports include `fitnessBreakdown`.
  - `main/deepnest.js`: worker config accepts only version `1` or `2`.
  - `main/background.js`: `fitnessVersion === 2` changes only aggregate fitness, not candidate scoring. It computes `2.0 + sheetMetric` per used sheet after optional refinement, preserves the unplaced penalty formula, and attaches `fitnessBreakdown = {version, sheets, sheetMetrics, unplacedPenalty}`.
  - `ml/cli/run_benchmark.js`: added `--fitness-version 2` and persists run-level `fitnessBreakdown`.
  - `ml/tests/fitness_v2/run.js`: added targeted helper math tests.
- Verification:
  - `node --check main/background.js`, `main/deepnest.js`, `ml/cli/run_benchmark.js`, `ml/tests/fitness_v2/run.js` passed.
  - `node ml/tests/fitness_v2/run.js` passed.
  - `node ml/tests/engine_bugfixes/run.js` passed.
  - Filtered inline JS parse for `main/index.html` passed.
  - `node --check ml/app-smoke-main.js` passed.
  - `bash ml/scripts/run_boot_check.sh` passed.
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-wp1-fitness-v1 bash ml/scripts/run_smoke_battery.sh` passed all scenarios with flag off.
  - Flag-on smoke benchmark passed: `ml/benchmark/results/20260611T061851Z-wp1-fitness-v2-smoke.json` contains `fitnessBreakdown`.
- WP-1.1 gate result: `ml/benchmark/results/20260611T061939Z-wp1-fitness-v2-gate.json` on the 10 stable baseline instances, 3 runs each, 240s, `fitnessVersion=2`.
  - Baseline mean median utilization: 65.300%.
  - v2 mean median utilization: 65.010%.
  - Delta: -0.290pp. Gate required at least +0.5pp, so the flag-on gate failed.
- Investigation note:
  - `GeneticAlgorithm.randomWeightedIndividual` is rank-based after sorting by fitness; it does not use fitness magnitude.
  - For complete one-sheet `gravity` jobs, v2 is mostly rank-equivalent to v1 because v1's final `minarea` is the same `2*width+height` signal, just unnormalized. After the earlier engine bug fixes, this WP no longer obviously adds selection signal for those jobs.
  - The main regressions were `shapes0` (-1.578pp), `swim` (-1.957pp), and `shirts` (-0.418pp). Do not proceed to WP-1.2 until the plan is revised or the v2 signal is adjusted and re-gated.

### 2026-06-11 - SOTA WP-0 benchmark harness + baseline gate (Codex)

- Added the WP-0 ESICUP/Jagua benchmark corpus and attribution under `ml/benchmark/esicup/`, the SVG/meta converter in `ml/lib/esicup-convert.js`, converter tests under `ml/tests/esicup_convert/`, and the benchmark runner/script in `ml/cli/run_benchmark.js` / `ml/scripts/run_nesting_benchmark.sh`.
- Extended the app smoke path (`ml/app-smoke-main.js`, `main/index.html`) with time-budgeted best-nest export, utilization capture, time-to-best, and placement digests. Added `npm run ml:nest-benchmark`.
- Verification passed before baseline capture: `node --check` for touched JS files, converter tests, inline `main/index.html` script parse, `bash ml/scripts/run_boot_check.sh`, and smoke battery with `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-wp0-runner`.
- Baseline capture: 120s full run failed at `gardeyn0`; 240s full run wrote `ml/benchmark/results/20260611T022554Z-baseline-v0-240.json` but stopped at `gardeyn3` run 2 with `no_nest_before_time_budget`. Same-budget gate supplement `ml/benchmark/results/20260611T055013Z-baseline-v0-240-gardeyn4-gate.json` completed `gardeyn4`.
- WP-0 gate status: combined 240s baseline has 17 complete instances and 10 stable instances at <=1.5pp 3-run utilization spread. Full corpus is not complete; the current engine failed `gardeyn3` run 2 before a nest was available within 240s.
- Created ML checkpoint before WP-1.1 edits: `20260611-060343-sota-wp1-fitness-pre` from run `20260409-232133-overnight`; checkpoint path is `ml/artifacts/checkpoints/20260611-060343-sota-wp1-fitness-pre` (~6.2 GB).

### 2026-06-10 - WP-0.1/WP-0.2 benchmark corpus + converter implemented (Codex)

- Claimed and implemented the first SOTA work package: `WP-0 benchmark corpus + converter`.
- Added `ml/benchmark/esicup/instances/` with 23 jagua-rs JSON instances:
  - Classic set: `albano`, `blaz1`, `dagli`, `fu`, `jakobs1`, `jakobs2`, `mao`, `marques`, `shapes0`, `shapes1`, `shirts`, `swim`, `trousers`.
  - Gardeyn 90-degree set: `gardeyn0` through `gardeyn9`.
- Added `ml/benchmark/esicup/ATTRIBUTION.md` with source URLs, source commit hashes, and license/provenance notes:
  - `JeroenGar/jagua-rs` source commit `43e81373ef5ff403df708dea60162eed236dd251`.
  - `ESICUP/datasets` source commit `154a8f006a8e72f65d734f2d1e36777f678f31f8`.
- Added `ml/lib/esicup-convert.js`:
  - `instanceToSvg(instanceJson, opts) -> { svgText, meta }`.
  - Expands demand into per-copy SVG paths, emits the strip sheet first, preserves source metadata, supports `simple_polygon`, `polygon`, and `rectangle` jagua shapes.
  - Computes `strip_length_estimate = 2 * totalArea / strip_height` when not overridden.
  - `utilizationFromPlacements(meta, placements, partsBySource) -> { utilization, usedLength }`.
- Added `ml/tests/esicup_convert/run.js` with a hand-written 2-item instance, orientation mapping checks, hole-area preservation, and utilization calculation.
- Verification:
  - `node --check ml/lib/esicup-convert.js` passed.
  - `node --check ml/tests/esicup_convert/run.js` passed.
  - `node ml/tests/esicup_convert/run.js` passed.
  - Corpus conversion smoke passed: 23 instances, 1,375 expanded demanded copies.
  - `bash ml/scripts/run_boot_check.sh` passed.
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-wp0-converter bash ml/scripts/run_smoke_battery.sh` passed all scenarios.
- Notes:
  - Continuous-rotation `_c` Gardeyn variants were intentionally not copied for WP-0 because current Deepnest++ benchmark plumbing maps allowed orientations into the existing discrete `rotations` setting.
  - No engine behavior changed in this WP.

### 2026-06-10 - Performance hot-path top-three fixes implemented (Codex)

- Implemented the top three performance findings from the Claude-Code hot-path hunt; intentionally did not take on findings 4-10 in this batch.
- `main/background.js` native NFP path:
  - Added a per-background-renderer native addon loader using the same development, asar-unpacked, and resources path families as the existing main/utility-process loaders.
  - `calculateNativeAddonNfp` now calls `addon.calculateNFP({ A, B })` directly inside each background renderer when available.
  - Kept the existing synchronous main-process IPC path as a fallback when the renderer cannot load the addon locally.
- `main.js` persistent NFP cache:
  - Added one-time running byte-total calculation when the manifest loads.
  - `nfpCacheInsert` updates the in-memory manifest and byte total immediately, prunes against the running total, and schedules a debounced manifest flush instead of rewriting the full manifest on every insert.
  - `pruneNfpCacheIfNeeded` no longer rescans all entry bytes for every insert and no longer uses `keys.shift()` in the eviction loop.
  - `before-quit` now cancels any pending timer and flushes dirty manifest state synchronously.
  - Cache clearing cancels pending flushes and resets the running byte total before writing the empty manifest.
- `main/background.js` mergeLines scoring hot loop:
  - Hoisted `shiftedplaced` construction outside the candidate-position loop; only the candidate part shift remains per candidate.
  - This is intended to preserve scoring/output semantics while removing repeated placed-geometry allocations.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main.js` passed.
  - `node --check ml/tests/engine_bugfixes/run.js` passed.
  - `node ml/tests/engine_bugfixes/run.js` passed.
  - `bash ml/scripts/run_boot_check.sh` passed.
  - `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-performance-hotpaths bash ml/scripts/run_smoke_battery.sh` passed all scenarios.
  - `bash ml/tests/nfp_equivalence/run.sh` passed 4 fixtures.
  - `bash ml/tests/nfp_profile/run.sh` completed; notable baseline: wavy native mean 146.971ms vs JS Clipper 262.865ms.
- No new ML checkpoint or bakeoff was run for this performance batch because the changes are intended to preserve nesting/NFP outputs; bakeoff still requires explicit `--manifest`, `--model`, and `--output-dir` inputs if the team wants a full acceptance gate.

### 2026-06-10 - Active engine bug-fix batch implemented (Codex)

- Created pre-fix ML checkpoint before engine edits:
  - `npm run ml:checkpoint -- --name engine-bugfixes-pre`
  - checkpoint `20260610-222930-engine-bugfixes-pre`
  - manifest `ml/artifacts/checkpoints/20260610-222930-engine-bugfixes-pre/manifest.json`
- Fixed `main/background.js` engine bugs:
  - `mergedLength` no longer corrupts its min-length threshold via `min2` reuse.
  - `mergedLength` counts hole-child shared edges once instead of once per candidate segment.
  - Empty Clipper `MinkowskiSum` fallback returns `null` instead of throwing/stalling the GA.
  - Rotation retry now attempts exactly `config.rotations` orientations with `360/config.rotations` spacing.
  - Degenerate first-placement IFPs no longer push `null` placements.
  - `clipCache.index` now stores the already-unioned placed count.
  - Candidate tie-break anchors now track the current accepted candidate.
  - Per-sheet `minwidth`/`minarea` are explicitly reset at sheet open, and sheet fitness is only added when valid values exist.
  - Empty sheets no longer abandon later sheets; their sheet-area bookkeeping is reverted before continuing.
  - Unplaced penalty denominator is guarded when no sheet receives placements.
  - Sheet holes now subtract outer forbidden NFPs from the sheet IFP and fail closed if the forbidden hole region or subtraction cannot be computed.
- Bumped persistent NFP cache version:
  - `main/background.js`: `NFP_CACHE_VERSION = 3`
  - `main.js`: `NFP_CACHE_VERSION = 3`, `manifest-v3.json`
- Fixed legacy `main/deepnest.js.applyPlacement` to clone source DOM nodes per placed instance; this path is still legacy/no-current-caller.
- Added focused Node regression tests in `ml/tests/engine_bugfixes/run.js`, including the sheet-hole subtraction fail-closed path.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - `node --check main.js` passed.
  - `node --check ml/tests/engine_bugfixes/run.js` passed.
  - `node ml/tests/engine_bugfixes/run.js` passed.
  - Initial `bash ml/scripts/run_boot_check.sh` failed because `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` was missing.
  - Repaired missing dependency artifact with `node node_modules/electron/install.js`.
  - `bash ml/scripts/run_boot_check.sh` then passed.
  - After final fail-closed tightening, reran `bash ml/scripts/run_boot_check.sh`; passed.
  - After final fail-closed tightening, reran `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-engine-bugfixes bash ml/scripts/run_smoke_battery.sh`; passed all scenarios.
- Bakeoff was not run: this repo's `npm run ml:bakeoff` requires explicit `--manifest`, `--model`, and `--output-dir` inputs, and none were provided for this batch.

### 2026-06-10 - Performance bug hunt (Claude-Code)

Read-only pass over the engine hot paths. Ranked findings, all verified by direct code reads (no code changed):

1. **Native NFP computation runs synchronously ON the Electron main process and serializes all workers.** `ipcMain.on('minkowski-calculate-nfp-sync')` (`main.js:1058-1083`) calls `addon.calculateNFP(...)` inline in the sync handler; the production path (`tryNativeOuterNfp` → `calculateNativeAddonNfp`, `main/background.js:3-9`) reaches it via `ipcRenderer.sendSync`. Consequences: (a) the whole app (UI, all windows) blocks during every native NFP — the wavy-class baseline in this file is ~150 ms *per NFP*; (b) the N background worker windows (CPU-cores setting, up to 8) all funnel through this single main-thread handler, so NFP generation is effectively single-threaded and the threads setting buys nothing in NFP-heavy phases; (c) each call pays double structured-clone of polygon payloads on main. Irony: a fully async utility-process path already exists (`requestMinkowskiWorker`, `ipcMain.handle('minkowski-calculate-nfp')`, `main/minkowski-worker.js`) but the production path does not use it. Fix directions: load the addon directly in each background renderer (original Deepnest pattern; nodeIntegration is on, needs the asar-unpacked path candidates from `loadNativeAddon`), or route per-worker utility processes; either takes main out of the hot path.
2. **Full NFP-manifest rewrite + prune scan on every cache insert, sync on main.** `nfpCacheInsert` (`main.js:504-536`) runs `pruneNfpCacheIfNeeded()` (O(entries) byte-sum each call; at capacity an O(n log n) sort plus O(n) `keys.shift()` per eviction, `main.js:426-458`) and `writeNfpCacheManifestAtomic()` (JSON.stringify of the whole ≤2500-entry manifest + writeFileSync + renameSync, `main.js:413-424`) for EVERY inserted NFP. Warming a fresh job = hundreds of inserts × full manifest rewrite (quadratic I/O), on the same main thread as finding 1. At steady-state capacity every insert pays the full prune. Fix: debounced manifest flush (timer + quit hook), running byte total, batched eviction.
3. **`shiftedplaced` rebuilt for every candidate position in mergeLines scoring.** `main/background.js:2230-2235` re-shifts ALL placed polygons inside the per-candidate loop although placements are invariant there — O(candidates × Σ placed vertices) allocations per part placement. Hoist above the `finalNfp` loops; only `shiftedpart` varies.
4. **Convex-hull mode: 3 hull computations per candidate where ~1 is needed.** `main/background.js:2219-2222` calls `getHull(localpoints)` twice (once for area, once for `shiftvector.hull`) plus `getHull(sheet)` — invariant per sheet — for every candidate, attaching hull arrays to every candidate object (GC churn).
5. **Cache-key fingerprints recomputed O(n²) per individual.** Every `getOuterNfp` call re-runs `polygonSignatureText` (toFixed(5) per coordinate + string join + FNV hash, `main/background.js:75-126`) for BOTH polygons; per part it fingerprints the same `part` polygon `placed.length` times. Memoize the fingerprint on the polygon object (coords are immutable after the rotation copy).
6. **db.find miss path: sync IPC + sync disk read on main, per pair per worker window.** `main/background.js:186-191` + `main.js:999/473-502`: first touch of each NFP pair in each of the up-to-8 worker windows = sendSync → main `readFileSync` + JSON.parse → two renderer-side deep clones (warm + return). Combined with findings 1-2, main is the global chokepoint. Mitigate via async prefetch/batched warmup.
7. **Rotation-retry loop waste** (perf face of the previously reported bound bug): `rotations=1` ⇒ 360 `rotatePolygon` allocations + 360 fingerprint/IFP lookups per part that doesn't fit (`main/background.js:2004`).
8. **Hot-loop console logging**: `main/background.js:1928` logs the entire inner-NFP structure per insert; `:2114` logs per part; `console.time('placement')` has no matching `timeEnd` on the early `continue` paths (warn spam). Free removals.
9. **Slide-refinement overhead when enabled**: per pass it deep-clones every pair NFP and recomputes the full-layout score per direction (8×) — O(8·n²·v) per sheet for a pass that historically accepts ~0 moves (superseded by SOTA plan WP-2).
10. (Architectural, matches SOTA plan) `background-start` payloads re-serialize full quantity-expanded polygon trees per individual per generation (`main/deepnest.js:1444-1470`); workers could cache geometry by source and receive only order/rotation.

### 2026-06-10 - Placement-logic bug hunt addendum (Claude-Code)

Focused read-only pass over `placeParts` and its helpers (candidate selection, clipCache, first-placement, refinement validity). New findings, by inspection (no code changed):

1. **Stale tie-break anchors in candidate selection** — `main/background.js:2247-2261`. `minx`/`miny` are only ever decreased and are not reset when a strictly-better-scoring candidate is accepted, so they track the minimum x/y over ALL accepted candidates rather than the coordinates of the currently selected `position`. Among equal-score candidates (collinear NFP edges, common in gravity mode), the tie-break compares against an anchor that may belong to a long-rejected candidate — e.g. accept A(score 10, x=5), then B(score 9, x=8) (minx stays 5), then C(score 9, x=6) is rejected because 6 > 5 even though the live position has x=8. Placement keeps the worse-x candidate.
2. **Cross-sheet fitness leak via per-part accumulators** — `main/background.js:2141-2144` declares `minwidth/minarea/minx/miny` per part iteration (function-scoped `var`), but parts that exit early (no-IFP `continue` at `:2026`, first-placement `continue` at `:2052`) skip the reset. A sheet whose only placement is its first part reaches `fitness += (minwidth/sheetarea) + minarea` (`:2301`) with values left over from the PREVIOUS sheet's last candidate — GA fitness noise for single-part sheets and sparse layouts. (Mechanism behind the defect already flagged in the SOTA plan WP-1.1.)
3. **Zero-placement sheet aborts all remaining sheets** — `main/background.js:2311-2316`. If a freshly opened sheet receives no placements, the `else break;` abandons the entire remaining sheet list. With heterogeneous sheet sizes (small sheet ordered first, remaining parts only fit the larger later sheet), parts are charged the unplaced penalty and silently dropped from the nest even though a later sheet fits them.
4. **`clipCache` off-by-one re-union** — `main/background.js:2109-2112` stores `index: placed.length-1` but the union already covers `placed[0..length-1]`; every reuse re-unions the last placed part's NFP (idempotent, so correctness is unaffected — wasted Clipper work only). Should store `placed.length`.
5. **First-placement can push a null position** — `main/background.js:2046-2050`: if the sheet IFP exists but its rings are degenerate/empty, `position` stays null, is logged, and is still pushed into `placements`; later `placements[j].x` throws, stalling the GA individual (same stall class as the Clipper-fallback crash in the previous note). Theoretical trigger, cheap guard.
6. (Note) The comment at `:2003` says rotation retry applies "only ... for the first part of each sheet" but the loop runs for every part; behavior is benign, the comment is wrong. The `360/config.rotations` loop bound defect from the previous note also lives here.

Local-refinement validity helpers (`localRefinementPointAllowed/Forbidden/CandidateValid/MaxLegalSlide`, `recomputeSheetMergedData`) checked: reference-point convention, NFP-children semantics, boundary-contact policy, and merged-data recompute-on-move are all consistent; no new defects found there beyond the structural max-slide limitation already documented in the SOTA plan.

### 2026-06-10 - Engine bug hunt: confirmed defects in committed code (Claude-Code)

Read-only analysis of the active engine path; no code changed. Two bugs were confirmed empirically by extracting `mergedLength` into a Node harness with the real `GeometryUtil`:

1. **`mergedLength` threshold corruption (`min2` shadowing)** — `main/background.js:486` sets `var min2 = minlength*minlength`, but `main/background.js:561` re-uses `var min2 = Math.min(rotB1.x, rotB2.x)` in the same function scope. After the first collinear candidate, the min-length threshold is a coordinate. Reproduced both failure directions: a 2-unit shared edge with `minlength=3` IS merged (got 2, expected 0), and a valid 5-unit shared edge is MISSED after an unrelated far collinear edge sets `min2=100` (got 0, expected 5). Affects mergeLines candidate scoring credit (`:2240`) and exported merged segments.
2. **`mergedLength` hole-children multiplication** — the `B.children` recursion (`main/background.js:611-615`) sits inside the `for i over p` segment loop, so child contributions are added once per segment of `p`. Reproduced: one 2-unit shared edge with a hole returns `totalLength=8` and 4 duplicate segments for a 4-vertex part (expected 2, 1 segment). Inflates merge credit by ~p.length× for hole-bearing placed parts.
3. **ClipperLib fallback crash path** — `main/background.js:1764-1777`: if `MinkowskiSum` returns an empty solution, `clipperNfp` stays undefined and `clipperNfp.length` throws; the exception escapes `placeParts`, the GA individual never clears `processing`, and the nest stalls. Reachable when the native addon is unavailable and the hole-free JS fallback runs on degenerate geometry.
4. **Rotation-retry loop bound** — `main/background.js:2004` loops `360/config.rotations` times instead of `config.rotations` times. The UI allows rotations up to 32 (`main/index.html:3996`); for rotations ≥ 19 not all orientations are tried, so a first-part-on-sheet may be dropped as unplaceable despite a fitting allowed rotation. For small values it wastes up to 360 redundant NFP retry iterations.
5. **Sheet-hole exclusion subtracts the wrong region** — `getInnerNfpWithGeometryUtil` (`main/background.js:1656-1695`) subtracts the hole's inner-fit region (part fully inside hole) instead of the hole's outer NFP (any overlap), and skips holes smaller than the part entirely (`Abounds > Bbounds` gate). Parts can straddle sheet cutouts. Likely inherited from upstream Deepnest; only affects sheets imported with interior holes.
6. (Low / dead code) `applyPlacement` (`main/deepnest.js:1564`) appends one shared clone per `source`, so quantity>1 would move the same DOM node between groups leaving earlier instances empty — currently has no callers (export reimplemented in index.html); trap if revived.

Repro harness: `/tmp/mergedlength-src.js` extraction + inline node script (see session). Fixes intentionally NOT applied — items 1-2 change mergeLines scoring (ML-sensitive; checkpoint + bakeoff required), and the user has not requested fixes yet.

### 2026-06-10 - SOTA nesting engine implementation plan authored (Claude-Code)

- Added `docs/sota-nesting-implementation-plan.md`: a self-contained, phased plan to move the engine from constructive GA placement to the state-of-the-art construct → separate → compact paradigm (Guided Local Search over NFP-derived penetration depth, shrink-and-separate compaction), written so a less-capable implementing agent can execute it work-package by work-package.
- Phases: WP-0 ESICUP benchmark harness + frozen baseline; WP-1 fitness v2 + NFP edge sampling (flagged); WP-2 `SeparationUtil` module + shrink–separate refinement replacing the slide-based Local Refinement internals (badge/stats contract preserved); WP-3 `deepsearch` placement type (native GLS; optional sparrow sidecar behind a license gate); WP-4 ML routing/ordering on top.
- Research basis: Umetani 2009 GLS, Gomes & Oliveira 2006 LP compaction, Elkeran 2013 guided cuckoo search, Gardeyn 2025 "sparrow" (arXiv 2509.13329, current best-known results, open source).
- Diagnosis recorded in the plan: GA fitness uses last-candidate residue per sheet (`main/background.js:2301`) and is nearly signal-free; candidate positions are NFP vertices only; slide-based Local Refinement cannot generate improving moves in contact-packed layouts (matches the observed `movesTested: 6, movesAccepted: 0`).
- No engine, UI, or ML code was changed. Only this file and the new plan doc.
- Next agent: claim `WP-0 benchmark corpus + converter` from the plan's §10 table.

### 2026-05-26 - Physics nest live viewer (Codex)

- Added `experiments/physics-nest/live-viewer.html`, a browser viewer that polls `out/live-state.json` and redraws the sheet while the CLI runs.
- Extended `experiments/physics-nest/physics-nest.js` with:
  - `--trace PATH` to write live state JSON.
  - `--trace-every N` to control trace update cadence.
  - live frames for attempt start, jostle progress, best-so-far, and complete states.
- Updated `experiments/physics-nest/README.md` with live viewer commands.
- Started a local static server on `http://localhost:8765/` using `python3 -m http.server`.
- Attempted to open the in-app browser, but localhost navigation was blocked by the browser client; opened the live viewer in the system browser instead.
- Ran a visible 32-attempt live search:
  - Output: `experiments/physics-nest/out/live-visible-run.svg`
  - Report: `experiments/physics-nest/out/live-visible-run.json`
  - Live state: `experiments/physics-nest/out/live-state.json`
  - `bestAttempt: 23`
  - `bestSeed: 30507`
  - `valid: true`
  - `overlapPairs: 0`
  - `outsideParts: 0`
  - `acceptedMoves: 120`
  - `scoreAfter: 6796.781355074058`
- Verification:
  - `node --check experiments/physics-nest/physics-nest.js` passed.
  - `node --check experiments/physics-nest/physics-nest.test.js` passed.
  - `npm run experiment:physics-nest:test` passed.

### 2026-05-26 - Physics nest best-of shake run (Codex)

- Extended `experiments/physics-nest/physics-nest.js` with `--best-of` / `--restarts` multi-shake search plus CLI knobs for `--gravity`, `--shake`, and `--rotation-step`.
- The best-of search revalidates each attempt through the same Clipper positive-area overlap and outside-sheet checks, then keeps the lowest-score legal arrangement.
- Updated `experiments/physics-nest/physics-nest.test.js` to assert best-of records all attempts, keeps the lowest score, and remains valid.
- Updated `experiments/physics-nest/README.md` with a best-of command example.
- Generated `experiments/physics-nest/out/testpart-physics-best.svg` and `.json` from:
  - `npm run experiment:physics-nest -- --input testpart.svg --output experiments/physics-nest/out/testpart-physics-best.svg --json experiments/physics-nest/out/testpart-physics-best.json --best-of 32 --iterations 220 --shake 30 --gravity 22 --rotation-step 3 --part-scale 1 --seed 4200`
- Best result:
  - `bestAttempt: 12`
  - `bestSeed: 16308`
  - `valid: true`
  - `overlapPairs: 0`
  - `outsideParts: 0`
  - `scoreAfter: 6796.710579939128`
  - Regenerated current one-shot `testpart-physics.json` score was `6812.065973831809`, so the multi-shake search improved the score by `15.355393892680697`.
- Verification:
  - `node --check experiments/physics-nest/physics-nest.js` passed.
  - `node --check experiments/physics-nest/physics-nest.test.js` passed.
  - `npm run experiment:physics-nest:test` passed.

### 2026-05-26 - Physics/jostle CLI nesting prototype (Codex)

- Added isolated prototype files under `experiments/physics-nest/`:
  - `physics-nest.js` CLI and module.
  - `physics-nest.test.js` focused collision/layout test suite.
  - `README.md` usage and accuracy notes.
  - `out/testpart-physics.svg` / `.json` and `out/testpart-physics-spacing2.svg` / `.json` generated from the user's `testpart.svg` sample.
- Added npm entry points:
  - `npm run experiment:physics-nest`
  - `npm run experiment:physics-nest:test`
- Prototype behavior:
  - Parses SVG `<path>` and `<polygon>` parts, flattens curves, normalizes rigid parts, seeds a legal grid, then tries physics-like translation/rotation jostle moves.
  - Every accepted move is gated by Clipper boolean validation. Any positive-area part overlap or sheet escape is rejected.
  - `--spacing` now enforces conservative clearance by offsetting collision validation geometry.
  - `--clipper-scale` exposes integer collision precision; default is `10000`.
- Verification:
  - `node --check experiments/physics-nest/physics-nest.js` passed.
  - `node --check experiments/physics-nest/physics-nest.test.js` passed.
  - `npm run experiment:physics-nest:test` passed.
  - `npm run experiment:physics-nest -- --input testpart.svg --output experiments/physics-nest/out/testpart-physics.svg --json experiments/physics-nest/out/testpart-physics.json --iterations 140 --part-scale 1` passed with `valid: true`, `partCount: 5`, `overlapPairs: 0`, and `outsideParts: 0` in the JSON report.
  - `node experiments/physics-nest/physics-nest.js --input testpart.svg --output experiments/physics-nest/out/testpart-physics-spacing2.svg --json experiments/physics-nest/out/testpart-physics-spacing2.json --iterations 40 --part-scale 1 --spacing 2` passed with `valid: true`, `overlapPairs: 0`, and `outsideParts: 0`.
- Test coverage includes part scale variation (`0.35`, `0.55`, `0.8`, `1.0`, `1.25`, `1.5`), direct positive overlap rejection, edge-touch allowance, 0.0005-unit overlap rejection, 0.001-unit gap allowance, spacing-clearance rejection, outside-sheet rejection, and cubic curve flattening.
- Notes:
  - This does not alter the active Electron import -> nest -> export path yet.
  - Collision is exact for flattened polygons at configured Clipper precision. Source SVG curves are approximated before collision checks; for tighter safety use lower `--curve-tolerance` and/or nonzero `--spacing`.
  - The motion heuristic is intentionally simple and should be treated as a post-process experiment, not a replacement for NFP-based placement.

### 2026-05-25 - Version 0.7.2 local build (Codex)

- Bumped `package.json` app version from `0.7.1` to `0.7.2`.
- Aligned root `package-lock.json` app metadata to `deepnest-ml` / `0.7.2` without changing dependency versions.
- Rebuilt native addon for Electron arm64 with `npm run build:arm64`.
- Packaged local macOS arm64 app and DMG with `npm run dist`.
- Produced:
  - `dist/mac-arm64/Deepnest ML.app`
  - `dist/Deepnest ML-0.7.2-mac-arm64.dmg`
  - `dist/Deepnest ML-0.7.2-mac-arm64.dmg.blockmap`
- Verified `package.json`, `CFBundleShortVersionString`, and `CFBundleVersion` all report `0.7.2`.
- Verification:
  - `node --check main.js` passed.
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - `package-lock.json` JSON parse check passed.
- Notes:
  - `electron-builder` completed successfully with ad-hoc signing and no notarization, matching existing local build expectations.
  - `electron-builder` logged a non-fatal JSON parse warning for a BOM-prefixed JSON file during packaging; the DMG and blockmap were still generated.
  - No GUI smoke run was performed.

### 2026-05-25 - Multi-agent codebase exploration (Codex)

- Performed a read-only app-code exploration with two completed explorer agents:
  - UI/controller path: `main.js`, `main/index.html`, `main/deepnest.js`, `main/background-dispatcher.js`.
  - Background geometry/NFP path: `main/background.js`, `main/util/geometryutil.js`, `addon.cc`, `minkowski.cc`.
- A third import/export explorer was closed after timeout; Codex covered import/export locally.
- No source code files were changed. Only this coordination file was updated.
- Findings were summarized to the user: active runtime is visible renderer -> main dispatcher -> hidden background renderers -> native Minkowski addon; highest-risk areas remain import part extraction, spacing offsets, NFP/cache semantics, placement scoring, export reconstruction, and smoke/teacher automation listeners.
- Verification: static code-path inspection only; no Electron GUI or smoke run was performed for this exploration.

### 2026-05-07 - Clear NFP cache setting added (Codex)

- Added a main-process `nfp-cache-clear-sync` IPC handler that deletes files in the persistent user-data NFP cache, resets the main-owned manifest, and recreates hidden background workers so in-memory worker cache state is discarded too.
- Added a Settings row under Nesting configuration: `NFP cache -> Clear NFP cache`.
- The clear action refuses to run while a nest is active and shows a message asking the user to stop/reset first, avoiding silent interruption of an in-progress job.
- Added hover help explaining that the cache speeds repeated jobs and should be cleared when long sessions feel stale or when a cold geometry rebuild is desired.
- Verification:
  - `node --check main.js` passed.
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - executable inline renderer JS parse check passed.
  - `bash ml/scripts/run_boot_check.sh` passed.
  - The destructive clear action itself was not clicked during verification, to avoid clearing the user's existing cache without an explicit manual test.

### 2026-05-06 - Blank Local Refinement badge text fixed (Codex)

- Fixed the Ractive helper chain that rendered the Local Refinement badge as an empty pill.
- `getLocalRefinementStatus()` now reads `nests` directly instead of calling `this.getSelectedNest()` as if Ractive data functions were instance methods.
- `getLocalRefinementLabel()` and `getLocalRefinementClass()` now retrieve/call `getLocalRefinementStatus` through `this.get(...)`.
- The source app was restarted with `npm start` after the patch.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - inline renderer JS parse check passed.

### 2026-05-06 - Local Refinement smoke observability added (Codex)

- Added `localRefinement` and `localRefinementSummary` to app smoke reports in `completeSmokeSuccess(...)`.
- Changed the smoke display callback to wait when the selected best nest has `localRefinement.pending === true`, so reports capture the completed post-process result instead of the temporary `refining` state.
- Re-ran `svg-gravity-local-refinement-postprocess` after the change:
  - `status: completed`,
  - `usedSheetCount: 1`,
  - `localRefinementSummary.enabled: true`,
  - `localRefinementSummary.ran: true`,
  - `movesTested: 6`,
  - `movesAccepted: 0`.
- This confirms the current smoke fixture is useful for wiring checks but not for proving compaction quality.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - inline renderer JS parse check passed.

### 2026-05-06 - Local Refinement moved to best-nest post-process v2 (Codex)

- Reworked Local Refinement so normal GA candidates are evaluated with `localRefinement` disabled in the worker payload.
- When a new best nest appears and the user setting is enabled, `main/deepnest.js` submits a second `background-start` request for that same individual with `localRefinementPostProcess: true`.
- Post-process responses are matched back to the pending nest with a refinement token, update the badge from `refining` to `checked` / `improved`, and do not mutate GA population fitness.
- Background refinement now uses reverse placement order and slide-style maximum legal movement sampling instead of the old fixed step ladder.
- `placeParts(...)` only runs `refineLocalPlacements(...)` when `config.localRefinementPostProcess === true`, keeping the GA hot path clean.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - inline renderer JS parse check passed.
  - `bash ml/scripts/run_app_smoke_test.sh --scenario svg-gravity` passed.
  - ad-hoc `svg-gravity-local-refinement-postprocess` smoke with `localRefinement: true` passed.
  - `bash ml/scripts/run_boot_check.sh` passed.

### 2026-05-06 - Local Refinement review follow-ups applied (Codex)

- Addressed Claude's review concerns before checkpointing the feature:
  - kept `minwidth` unchanged after Local Refinement so enabling the toggle does not switch the GA fitness term from the historical placement width to whole-sheet footprint width,
  - stopped aggregating per-sheet `scoreBefore` / `scoreAfter` into meaningless cross-sheet totals,
  - documented the boundary-contact behavior in the Local Refinement IFP check.
- Scope stayed inside `main/background.js`; no geometry algorithm expansion or UI behavior change.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - inline renderer JS parse check passed.

### 2026-05-06 - Local Refinement status badge made explicit (Codex)

- Replaced the conditional fourth stats card with a persistent `#localrefinementstatus` pill in the nest header.
- The badge now shows `off`, `enabled`, `not used`, `checked - 0 moves`, or `improved - N moves`, so the user can tell whether Local Refinement is disabled, armed, or actually affecting the selected nest.
- Added visual states for off/enabled/checked/improved/muted in `main/style.css`.
- The source app was restarted with `npm start` after the patch.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - inline renderer JS parse check passed.

### 2026-05-05 - Local Refinement runtime indicator added (Codex)

- Background placement results now include `localRefinement` metadata:
  - `enabled`,
  - `ran`,
  - `sheetsChecked`,
  - `movesTested`,
  - `movesAccepted`,
  - `scoreBefore`,
  - `scoreAfter`.
- The nest stats strip in `main/index.html` now shows a `local refinement` card only when the selected result has Local Refinement enabled.
- Indicator states:
  - `enabled` when the setting is on but no result metadata exists yet,
  - `not used` when enabled but the pass could not run,
  - `checked - 0 moves` when it ran but accepted no moves,
  - `improved - N moves` when it accepted moves.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - inline renderer JS parse check passed.
  - `bash ml/scripts/run_app_smoke_test.sh --scenario svg-gravity ...` completed with Local Refinement off.
  - ad-hoc Local Refinement enabled smoke completed.
  - `bash ml/scripts/run_boot_check.sh` passed.

### 2026-05-05 - Local Refinement v1 landed behind toggle (Codex)

- Added a default-off `localRefinement` setting in `main/index.html` and `main/deepnest.js`.
- UI label: `Local refinement`; helper text describes it as an experimental translation-only jiggle pass after normal nesting.
- Step & Repeat disables this setting in the UI and bypasses it in the engine because Step & Repeat uses its separate deterministic placement path.
- Implemented `refineLocalPlacements(...)` in `main/background.js`:
  - runs after a sheet has a legal placement from the existing solver,
  - keeps order and rotations unchanged,
  - tries bounded short translation moves in 8 directions for up to 2 passes,
  - validates each candidate using current sheet IFP and pairwise NFPs,
  - accepts only moves that improve the final footprint score,
  - recomputes merged-line metadata if moved.
- Default behavior is unchanged while `localRefinement` is false.
- Verification:
  - `node --check main/background.js` passed.
  - `node --check main/deepnest.js` passed.
  - `bash ml/scripts/run_app_smoke_test.sh --scenario svg-gravity ...` completed with Local Refinement off.
  - Ad-hoc `svg-gravity-local-refinement` smoke completed with `localRefinement: true` and `mergeLines: false`.
  - Ad-hoc `svg-gravity-local-refinement-merge` smoke completed with `localRefinement: true` and `mergeLines: true`.
  - `bash ml/scripts/run_boot_check.sh` passed.

### 2026-05-05 - Rolled back expanded GA seed population heuristics (Codex)

- User reported significant regressions on most jobs from the expanded GA seed population change.
- Stopped the running source app and reverted `main/deepnest.js` back to the previous seed behavior.
- Removed the added `boxarea`, `fillratio`, `slenderness`, and large/small interleave seed logic.
- Scope deliberately avoided `main/background.js`, NFP math, placement validity, exports, and UI settings.
- Verification:
  - `node --check main/deepnest.js` passed.
  - `bash ml/scripts/run_app_smoke_test.sh --scenario svg-gravity ...` completed and exported non-empty SVG.

### 2026-05-03 - Minkowski batch convolution experiment verified on Mac (Codex)

- Fast-forwarded `main` to `4fb1c06` (`[claude-code] add env-gated batch convolution experiment`).
- Rebuilt `build/Release/addon.node` against Electron `40.8.5` with `npx -y node-gyp@12 rebuild --target=40.8.5 --arch=arm64 --dist-url=https://electronjs.org/headers`.
- Verification:
  - Default path: `ELECTRON_RUN_AS_NODE=1 "dist/mac-arm64/Deepnest ML.app/Contents/MacOS/Deepnest ML" ml/tests/nfp_equivalence/run.js` passed 4/4 fixtures.
  - Batch path: `DEEPNEST_BATCH_INSERT=1 ELECTRON_RUN_AS_NODE=1 "dist/mac-arm64/Deepnest ML.app/Contents/MacOS/Deepnest ML" ml/tests/nfp_equivalence/run.js` passed 4/4 fixtures.
- 500-iteration profile after rebuild, default path:
  - `rect-vs-rect`: native mean `0.049ms`, JS Clipper mean `0.068ms`, `timeVsNative=1.41x`.
  - `concave-l-vs-rect`: native mean `0.058ms`, JS Clipper mean `0.065ms`, `timeVsNative=1.14x`.
  - `irregular-vs-irregular`: native mean `0.134ms`, JS Clipper mean `0.110ms`, `timeVsNative=0.82x`.
  - `wavy-96-vs-wavy-72`: native mean `156.788ms`, median `151.278ms`; JS Clipper mean `305.189ms`, median `293.808ms`, `timeVsNative=1.95x`.
  - `rect-with-hole-vs-rect`: native with holes mean `0.076ms`; native without holes mean `0.041ms`, `timeVsNative=0.55x`.
- 500-iteration profile with `DEEPNEST_BATCH_INSERT=1`:
  - `rect-vs-rect`: native mean `0.053ms`, JS Clipper mean `0.073ms`, `timeVsNative=1.36x`.
  - `concave-l-vs-rect`: native mean `0.069ms`, JS Clipper mean `0.068ms`, `timeVsNative=0.99x`.
  - `irregular-vs-irregular`: native mean `0.115ms`, JS Clipper mean `0.101ms`, `timeVsNative=0.88x`.
  - `wavy-96-vs-wavy-72`: native mean `152.641ms`, median `151.345ms`; JS Clipper mean `291.897ms`, median `285.712ms`, `timeVsNative=1.91x`.
  - `rect-with-hole-vs-rect`: native with holes mean `0.094ms`; native without holes mean `0.061ms`, `timeVsNative=0.65x`.
- Geometry check: the wavy fixture's raw native output changed from `169` to `170` points under batch mode, but canonicalized output matched exactly (`canonPts=168`, same bbox, same SHA-1 hash `5c12f75ee4b2e2d7efcdf9f37ce16fe0a11164b2`). Treat this as representation noise, not a correctness failure.
- Recommendation: do **not** promote per-pair batching to default. It gives only a small wavy mean improvement (~2.6%) with effectively unchanged median and mixed/small-fixture regressions. The next experiment should move batching or timing instrumentation up to whole-NFP scope instead.

### 2026-05-03 - Minkowski batch convolution experiment (env-gated) (Claude-Code → Codex handoff)

Scope: smallest C++ change suggested by the post-baseline plan. Only `minkowski.cc` is touched, only inside `convolve_two_point_sequences`. Env-gated so a single rebuilt binary runs both old and new paths.

What changed in `minkowski.cc`:
- Added `#include <cstdlib>` and a static `batch_insert_enabled()` helper that reads `DEEPNEST_BATCH_INSERT` once via `std::getenv` (cached in a function-local static; thread-safe under C++11 magic-statics, which the existing build already relies on).
- `convolve_two_point_sequences` now has two branches sharing identical input setup (`first_a`, `prev_a`, `vec`, `poly`, `++ab`):
  - **Default (env unset / `0`):** byte-identical to the previous code — `result.insert(poly)` per quad inside the O(|A|×|B|) loop.
  - **Batch (env set to anything else):** accumulates quads into a function-local `polygon_set local`, then `result += local` once at the end. Hypothesis: bulk-cleaning a fresh small set and merging once may amortize Boost.Polygon's sweepline housekeeping better than per-quad insertion into a growing `result`.
- No other function was changed. `convolve_point_sequence_with_polygons` and `convolve_two_polygon_sets` still call `convolve_two_point_sequences` exactly as before, so the batching is per-(A-sequence × B-polygon)-pair, not per-NFP. If the per-pair batch wins, a follow-up experiment can lift it to whole-NFP scope.

Why this shape:
- Default-off keeps the path the equivalence harness has already validated 4/4 on. No `NFP_CACHE_VERSION` bump, no risk of silently invalidating warmed caches, no behavior change for users on the next rebuild.
- One binary, two measurements. Lets Codex A/B without rebuilding twice.
- The change is ~25 added lines plus one include. Easy to revert (single hunk).

Verification done in this worktree (no native build available):
- `node --check ml/tests/nfp_profile/run.js` — passes.
- `node --check ml/tests/nfp_equivalence/run.js` — passes.
- Re-read of `minkowski.cc` lines 1-30 and 131-175: both branches present, identical loop bodies inside, only the destination of `insert` and the trailing `result += local` differ.
- `grep` confirms one `first_a` declaration (preserved as pre-existing latent dead variable; not introduced by this change), two `first_b` declarations (one per branch, also preserved), two `for (; ab != ae` loops (one per branch).

Not verified here:
- `npm run build:arm64` — would require `npm install` first (~300 MB Electron download + `electron-builder install-app-deps`); deferred to Codex on the Mac.
- `bash ml/tests/nfp_equivalence/run.sh` — needs a fresh build of the addon to actually exercise the new code; the packaged 0.7.1 addon does not include the env gate.
- `bash ml/tests/nfp_profile/run.sh` — same.

What Codex needs to do on the Mac:
1. **Rebuild the addon** with `npm run build:arm64` (or `npm run build` for current arch). Confirm `build/Release/addon.node` is a fresh `Mach-O 64-bit bundle arm64` matching today's mtime.
2. **Equivalence regression (default path).** `bash ml/tests/nfp_equivalence/run.sh` must still pass 4/4. This protects against an accidental compile-time semantic break (e.g. if the new include or static helper somehow perturbed the default path).
3. **Equivalence regression (batch path).** `DEEPNEST_BATCH_INSERT=1 bash ml/tests/nfp_equivalence/run.sh` must also pass 4/4. The math is identical — only the order of insertion and the merge point differ — so any divergence would indicate either a Boost.Polygon non-determinism or a real bug. If divergence, paste the failing fixture's native vs JS canonical rings into a follow-up note here.
4. **Perf baseline reproduction.** `bash ml/tests/nfp_profile/run.sh 500` (no env). Should match the 500-iteration numbers recorded in the previous handoff note within reasonable jitter — confirms the rebuild itself didn't drift. The wavy-96/72 native mean should land near `168.641ms` / median `154.394ms`.
5. **Perf experiment.** `DEEPNEST_BATCH_INSERT=1 bash ml/tests/nfp_profile/run.sh 500`. Record the same five-fixture table here. The fixture that actually answers the question is `wavy-96-vs-wavy-72` — anything < ~155ms median is a clear win, > ~170ms is a clear loss, in between is noise and we'd want a longer run. The microsecond-scale fixtures (`rect-vs-rect`, `concave-l-vs-rect`, `irregular-vs-irregular`, `rect-with-hole-vs-rect`) are sensitive to the constant-factor cost of constructing `polygon_set local` and the `result += local` merge — if they regress materially (say, > 1.5× baseline), the per-pair batching is too granular and the next experiment should batch at whole-NFP scope instead.
6. **Decision.** Three outcomes:
   - **Win on wavy with no material regression on small fixtures:** plumb the env default to ON (or just remove the gate and inline the batch path), update equivalence + profile baseline numbers in this file, ML checkpoint (`npm run ml:checkpoint -- --name minkowski-batch-convolution`), then hand back to a refactor follow-up to consider lifting batching to whole-NFP scope and to revisit the `irregular-vs-irregular` 0.92× regression.
   - **No win on wavy:** revert the patch entirely; the next experiment moves up a level (whole-NFP batching, or phase-timing instrumentation to find where the 168 ms is actually spent).
   - **Mixed (small-fixture regression):** keep the env gate as a flag, document the tradeoff, move to whole-NFP batching as the next experiment — small-fixture cost was the predicted failure mode of per-pair scope.

ML-sensitive notes:
- No checkpoint required for landing the env-gated change itself, because default behavior is byte-identical. Checkpoint is required only when (and if) batching is promoted to default-on per AGENT_COLLABORATION.md:74.
- `addon.cc`, `binding.gyp`, `main/background.js`, and `main/minkowski-worker.js` are unchanged. Cache key format unchanged. `processHoles` toggle untouched.

Rollback plan: revert the two `minkowski.cc` hunks (the include + helper near line 10, and the `convolve_two_point_sequences` body). The Active Work table claim and this Handoff Note can stay as a record of the experiment.

Files touched:
- `minkowski.cc` (one include + one static helper added; one function body split into a gated batch branch and the preserved default branch)
- `AGENT_COLLABORATION.md` (this note + Active Work + Working Tree State)

### 2026-05-01 - Native NFP profiling harness added (Codex)

- Added `ml/tests/nfp_profile/run.js` and `ml/tests/nfp_profile/run.sh`.
- The profile runs under Electron-as-Node, loads the built native addon, and compares native Boost NFP timings against the current JS Clipper fallback for simple and synthetic fixtures.
- Added a hole fixture that compares `native-boost` with holes enabled against `native-no-holes`, matching the product's `processHoles` concept.
- Updated `ml/tests/nfp_equivalence/run.sh` to fall back to the packaged app binary when `node_modules/.bin/electron` is unavailable.
- Verification:
  - `node --check ml/tests/nfp_profile/run.js` passed.
  - `bash ml/tests/nfp_equivalence/run.sh` passed 4/4 existing fixtures using the packaged Electron runtime.
  - `bash ml/tests/nfp_profile/run.sh 20` completed successfully.
  - `bash ml/tests/nfp_profile/run.sh 500` completed successfully on the Mac.
- First signal from the 20-iteration profile: native Boost is clearly faster on the synthetic large wavy fixture (~151 ms vs ~277 ms), comparable on small irregular geometry, and hole processing adds measurable overhead even on simple polygons.
- 500-iteration Mac baseline:
  - `rect-vs-rect`: native mean `0.063ms`, JS Clipper mean `0.089ms`, `timeVsNative=1.43x`.
  - `concave-l-vs-rect`: native mean `0.083ms`, JS Clipper mean `0.083ms`, `timeVsNative=1.00x`.
  - `irregular-vs-irregular`: native mean `0.154ms`, JS Clipper mean `0.142ms`, `timeVsNative=0.92x`.
  - `wavy-96-vs-wavy-72`: native mean `168.641ms`, median `154.394ms`; JS Clipper mean `267.410ms`, median `266.013ms`, `timeVsNative=1.59x`.
  - `rect-with-hole-vs-rect`: native with holes mean `0.070ms`; native without holes mean `0.037ms`, `timeVsNative=0.53x`.

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

# SOTA Nesting Engine — End-to-End Implementation Plan

Status: PLAN — no code from this document has been implemented yet.
Author: Claude-Code, 2026-06-10.
Audience: an implementing AI agent (or human) with **no prior context**. Every work
package below is self-contained: it names the exact files, functions, data shapes,
formulas, defaults, tests, and acceptance gates. Read this entire document before
writing any code. When this document and the live code disagree, trust the live code,
record the discrepancy in `AGENT_COLLABORATION.md`, and adapt the plan minimally.

Goal: move the nesting engine from its current **constructive GA** paradigm
(order/rotation genome + greedy NFP-vertex placement) to the state-of-the-art
**construct → separate → compact** paradigm (fix layout, allow temporary overlap,
minimize overlap with Guided Local Search, shrink, repeat), while preserving the
existing geometry kernel, legality guarantees, ML teacher pipeline, and UI.

Literature anchors (for human reviewers; the implementer does not need to read them):
- Umetani et al. 2009 — Guided Local Search over directional penetration depth.
- Gomes & Oliveira 2006 — SA + LP compaction/separation (+8.84% avg utilization).
- Elkeran 2013 — guided cuckoo search + pairwise clustering (decade of best-knowns).
- Gardeyn et al. 2025 — "sparrow" (arXiv 2509.13329): GLS + sequence-of-feasibility +
  strip shrinking; open-source Rust; beats all prior best-knowns on 13 benchmarks.

---

## 0. Ground rules (read first, non-negotiable)

1. **Multi-agent protocol.** Before editing anything: read `AGENTS.md`, then
   `AGENT_COLLABORATION.md`. Claim your work package in the Active Work table using
   the WP codes below (e.g. `WP-2.1 separation module`). Leave a Handoff Note after
   each landed package. Prefix commits `[<agent>] WP-x.y: <summary>`.
2. **ML-sensitive files.** `main.js`, `main/background.js`, `main/index.html`,
   `addon.cc`, `minkowski.cc`, `ml/teacher-main.js`, `ml/app-smoke-main.js`,
   `ml/config_candidates.json`. Any change that alters nesting *outputs* (not just
   speed) requires: `npm run ml:checkpoint -- --name <wp-code>` before flipping a
   default, then re-running the bakeoff (`npm run ml:bakeoff`) and recording results
   in `AGENT_COLLABORATION.md`.
3. **Everything lands behind a default-off flag.** A phase's behavior change must be
   invisible until its flag is flipped. Flag-off runs must produce **byte-identical
   placements** to pre-change code (verified by the equivalence test in §8.3).
4. **Never edit the Step & Repeat path** (`placePartsStepRepeat`,
   `main/background.js:832`; routed at `main/background.js:242`). It is a separate
   deterministic engine and is out of scope for every WP here.
5. **Verification battery after every WP** (§8). Do not mark a WP done without it.
6. **No new runtime dependencies** in phases 0–2. Phase 3 Track B (sparrow) is the
   only WP allowed to add a binary dependency, and only after its license gate passes.

---

## 1. Current-state map (verified 2026-06-10)

You must understand these before touching anything. Line numbers are anchors, not
exact contracts — re-locate by symbol name if drifted.

### 1.1 Runtime topology

`main.js` (Electron main; owns hidden background windows + persistent NFP disk cache)
→ visible renderer `main/index.html` + `main/deepnest.js` (UI state, GA, nest list)
→ hidden background renderers `main/background.html` + `main/background.js`
(placement engine; loads `util/geometryutil.js`, `util/clipper.js`, `util/d3-polygon.js`
via `<script>` tags — **not** CommonJS) → native NFP addon (`addon.cc`/`minkowski.cc`)
via `minkowski-calculate-nfp-sync` IPC, with JS fallbacks.

Work dispatch: renderer sends `background-start` with `{index, individual, parts,
config, ...}`; background replies `background-response` with
`{placements, fitness, area, mergedLength, localRefinement, index, ...}`.
Background renderers have `nodeIntegration` (they use `ipcRenderer` and may `require`).

### 1.2 The genetic algorithm — `main/deepnest.js`

- `GeneticAlgorithm` constructor: `main/deepnest.js:1665`. Genome = insertion order +
  per-part rotation. Population default 10 (`populationSize`), `rotations` default 4.
- 8 deterministic seed orders (`seedPlacements`, `:1713`): given order, area desc,
  max-dim desc, width desc, height desc, aspect desc/asc, source order.
- `mutate` (`:1831`): adjacent swap + random rotation, p = 0.01 × mutationRate per gene.
- `mate` (`:1856`): single-point order crossover. `generation` (`:1892`): elitism(1) +
  rank-weighted selection.
- Results inserted into `this.nests` sorted ascending by `fitness`
  (`main/deepnest.js:156`). Local-refinement post-process re-submits the best
  individual with `localRefinementPostProcess: true` and tracks
  `refinementBaseFitness` (`main/deepnest.js:119`).
- **Do not mutate GA state from background responses** — see the guard comment at
  `main/deepnest.js:1425` and the straggler rules at `:1270-1296`.

### 1.3 The placement engine — `main/background.js`

`placeParts(sheets, parts, config, nestindex)` at `main/background.js:1944`:

1. Rotates every part copy by its genome rotation (`:1961-1971`). **From here on,
   `parts[i]` is the already-rotated polygon** with `.rotation`, `.source`, `.id`.
2. Opens sheets one at a time (`while(parts.length > 0)`, `:1980`). Per sheet:
   `fitness += sheetarea` (`:1992`).
3. Per part: inner-fit polygon `sheetNfp = getInnerNfp(sheet, part, config)`
   (`:2005`), retrying successive rotations if the part doesn't fit at all.
4. For each placed part `j`: `nfp = getOuterNfp(placed[j], part, false, config)`
   (`:2073`), shifted by `placements[j]`; all NFPs unioned via Clipper (cached
   incrementally in `clipCache` keyed `'s:'+source+'r:'+rotation`, `:2064-2112`);
   the union is subtracted from the sheet IFP → `finalNfp` = feasible region
   (`:2117-2137`).
5. **Candidate positions = the vertices of `finalNfp` rings only** (`:2168-2269`).
   Candidate scoring: gravity = `rectbounds.width*2 + rectbounds.height` (`:2204`),
   box = bbox area (`:2207`), convexhull = hull area (`:2219`). `mergeLines` credit:
   `area -= merged.totalLength * config.timeRatio` (`:2240`). Optional remnant tweak
   `improvedPlacementScore` (`:1144`, flag `improvedPlacementScoring`).
6. Sheet ends: optional `refineLocalPlacements` (`:2289`), then
   `fitness += (minwidth/sheetarea) + minarea` (`:2301`) — **note: residue of the
   LAST candidate evaluation on that sheet, and `minwidth`/`minarea` are not reset
   between sheets.** This is a known defect that Phase 1 fixes.
7. Unplaceable parts: `fitness += 100000000 * (partArea/totalsheetarea)` (`:2326`).

### 1.4 Local Refinement today (the thing being replaced)

`refineLocalPlacements` at `main/background.js:1442`: per part (reverse order), slides
the **maximum legal distance** in 8 fixed directions
(`localRefinementMaxLegalSlide`, `:1305`), accepts only global-score improvements
(`localRefinementScore`, `:1348`; `localRefinementImproves`, `:1382`), ≤5 passes.
Structural flaw: in a packed layout, contact ⇒ max slide ≈ 0 in useful directions,
and a long slide in an open direction worsens the score ⇒ near-zero accepted moves
(smoke evidence in `AGENT_COLLABORATION.md`: `movesTested: 6, movesAccepted: 0`).
Its stats plumbing (`createLocalRefinementStats` `:1390`, badge states in
`main/index.html`) is GOOD and must be preserved by the replacement.

### 1.5 Geometry conventions (the #1 source of implementation bugs)

- **Reference-point convention.** A placement `{x, y}` is a translation `t`:
  rendered point = part vertex + `t`. All NFP candidate logic uses **part vertex 0**
  as the reference: a feasible-region point `p` yields position `t = p − part[0]`
  (`main/background.js:2174`). Equivalently: the **test point for "where is part i"
  is `q_i = placements[i] + part_i[0]`** (component-wise). Every overlap/containment
  query in this plan is a point query with `q_i`.
- **Outer NFP semantics.** `getOuterNfp(A, B, false, config)` returns the no-fit
  polygon of B around placed A, **positioned relative to A at the origin**; shift it
  by `placements[A]` before use. `q_B` strictly inside the shifted NFP's outer ring
  ⇒ A and B overlap. The NFP may carry `nfp.children` (rings inside the outer ring):
  `q_B` inside a child ring ⇒ B sits inside a hole of A ⇒ **no overlap**.
- **Inner NFP (IFP) semantics.** `getInnerNfp(sheet, part, config)` returns an array
  of rings of valid reference points: `q` inside any IFP ring ⇒ part fully inside
  sheet.
- **Spacing is pre-applied.** `main/deepnest.js:1210-1213` inflates every part tree
  by `+0.5*config.spacing` and deflates sheets by `−0.5*config.spacing` *before*
  parts reach the background engine. **Never offset for spacing again** inside the
  engine. Tolerances below therefore apply to already-inflated geometry, and
  touching (distance 0) is legal.
- **Units.** The engine works in "nest units" (SVG units × `config.scale`). Clipper
  operations scale by `config.clipperScale` (see `toClipperCoordinates`,
  `main/background.js:1027`). All new tolerances must be expressed relative to
  `config.curveTolerance` (nest units), not absolute pixels.
- **Rotated-copy pattern.** To try a new rotation for part `p`:
  `var r = rotatePolygon(p, deg); r.rotation = p.rotation + deg; r.source = p.source;
  r.id = p.id;` (pattern at `main/background.js:2011-2014`). NFP caches key off
  geometry+rotation, so new rotations create new cache entries (bounded by the main
  process LRU: 2500 entries / 128 MB).

### 1.6 Config plumbing

- `defaultconfig` lives at `main/index.html:396` (e.g. `placementType: 'box'`,
  values `gravity | box | convexhull`, plus `steprepeat` via the same select at
  `main/index.html:4001`).
- New boolean keys must be added to BOTH checkbox-keys lists in `main/index.html`
  (search for existing key `processHoles` to find both lists), plus a Settings row
  and a `config_explain` block (copy the `processHoles` rows added in the 0.7.x
  series as the template).
- Background receives the whole config in the `background-start` payload; read flags
  **once per payload**, never from globals.

### 1.7 Reusable assets elsewhere in the repo

- `ml/lib/seeded-random.js` — mulberry32 seeded PRNG, plain CommonJS. The canonical
  PRNG for any stochastic loop added by this plan (background renderers may
  `require` it; it is packaged via the `ml/lib/**/*` entry in `package.json` files).
- `ml/app-smoke-main.js` + `ml/smoke/scenarios/*.json` + `ml/scripts/run_app_smoke_test.sh`
  — headless Electron harness that imports an SVG, runs a nest, exports, and writes
  a JSON report. Phase 0 builds on this instead of inventing a new runner.
- `ml/tests/nfp_equivalence/`, `ml/tests/nfp_profile/` — Electron-as-Node test
  pattern to copy for new geometry unit tests.
- `experiments/physics-nest/` — an isolated prototype of jostle-style compaction
  with a Clipper legality gate. **Reference only.** Do not import its code into the
  engine (it has known parser bugs and its own scaling conventions).

---

## 2. Target architecture

```
                ┌────────────────────────────────────────────────┐
                │ Phase 0: benchmark harness (measure everything)│
                └────────────────────────────────────────────────┘
Current:  GA(order,rot) ──> greedy NFP-vertex placement ──> fitness(noisy)
Phase 1:  GA(order,rot) ──> greedy NFP vertex+EDGE placement ──> fitness v2 (true signal)
Phase 2:  ... ──> best nest ──> SHRINK–SEPARATE–COMPACT refinement (replaces slide LR)
Phase 3:  'deepsearch' placement type: construction + full-budget GLS loop + restarts
Phase 4:  ML: routing ("will deep search pay off?"), ordering policy, budget allocation
```

The separation/penetration module built in Phase 2 (WP-2.1) is the core new asset;
Phase 3 promotes it from post-process to primary search. Phases are strictly ordered;
do not start a phase before the previous phase's gates pass.

Explicit non-goals (do NOT implement): continuous rotation, raster/GPU overlap
engines, exact-fit detection, GA replacement before Phase 3, svgparser changes,
Electron upgrades, touching Step & Repeat.

---

## 3. Phase 0 — Benchmark harness and baseline (foundation; no engine changes)

**Why first:** every later gate is "± X% utilization vs baseline". Without this, no
phase can be accepted or rejected honestly.

### WP-0.1 Instance corpus

Create `ml/benchmark/esicup/instances/`. Source the classic ESICUP irregular strip
packing instances (ALBANO, BLAZ, DAGLI, FU, JAKOBS1, JAKOBS2, MAO, MARQUES, SHAPES0,
SHAPES1, SHIRTS, SWIM, TROUSERS) and, if available, the GARDEYN0-9 set, in the
jagua-rs JSON format from `github.com/JeroenGar/jagua-rs` (data directory) or the
ESICUP site. Commit them with an `ATTRIBUTION.md` noting origin and license of the
data files. If a download cannot be performed in the implementation environment,
stop and ask the user to fetch them; do not fabricate instances.

Instance JSON essentials (jagua-rs format): items with `shape` (outer polygon, holes),
`demand` (quantity), `allowed_orientations` (list of degrees; empty/absent ⇒ free),
and a `strip_height` (strip instances). Treat all listed instances as strip packing:
fixed height, minimize used length.

### WP-0.2 Converter

New file `ml/lib/esicup-convert.js` (plain CommonJS, Node-only):

- `instanceToSvg(instanceJson, opts) -> { svgText, meta }`. Emit one `<path>` (or
  `<polygon>`) per demanded item copy, plus a `<rect>` sheet sized
  `strip_height × strip_length_estimate` where `strip_length_estimate =
  2 × Σ(itemArea × demand) / strip_height` (generous; the nester compacts leftward).
  `meta` carries: per-item true polygon area, total demand, allowed orientations,
  strip height. Holes in items become subpaths (even-odd) — same structure the SVG
  importer already understands.
- `utilizationFromPlacements(meta, placements, partsBySource) -> {utilization,
  usedLength}`. Definitions (MUST be exactly this):
  - `usedLength = max over placed parts of (max world x of its ORIGINAL un-inflated
    polygon) − sheet min x`. Run benchmarks with `spacing: 0` so original = engine
    polygon and this subtlety vanishes; assert `config.spacing === 0` in the runner.
  - `utilization = Σ trueArea(placed items) / (usedLength × strip_height)`.
- Unit tests `ml/tests/esicup_convert/run.js`: round-trip a hand-written 2-item
  instance; assert area preservation within 0.1% and orientation list mapping.

### WP-0.3 Headless benchmark runner

New `ml/cli/run_benchmark.js` + `ml/scripts/run_nesting_benchmark.sh` + npm script
`"ml:nest-benchmark"`. Implementation strategy: follow `ml/app-smoke-main.js`'s
scenario pattern. Extend the smoke runner with two additive, backward-compatible
scenario fields (default-absent ⇒ old behavior):

- `timeBudgetSec` (number): stop the nest after this wall-clock budget and take the
  best nest so far (the renderer already keeps `nests` sorted; reuse the stop path
  that Step & Repeat uses — `DeepNest.stop()` — then read the best nest).
- `captureUtilization` (bool): when true, the report JSON gains
  `{utilization, usedLength, placementsDigest}` computed via WP-0.2.

Benchmark protocol (hard-coded in the runner, not configurable):
- Config preset: `placementType:'gravity'`, `spacing:0`, `mergeLines:false`,
  `processHoles:true`, `populationSize:10`, `mutationRate:10`, rotations mapped from
  the instance's `allowed_orientations` (e.g. {0,180} ⇒ `rotations:2`; {0,90,180,270}
  ⇒ 4; free ⇒ 4). Record the preset verbatim in the report.
- 3 runs per instance, `timeBudgetSec: 120` each. (The GA is seeded by `Math.random`;
  runs differ naturally. Record per-run results; the instance score is the median.)
- Output: `ml/benchmark/results/<UTC-timestamp>-<label>.json` with schema
  `{label, gitCommit, engineFlags, instances:[{name, runs:[{utilization, usedLength,
  timeToBestSec, fitness}], median}], aggregate:{meanMedianUtilization}}`.

### WP-0.4 Baseline capture

Run `npm run ml:nest-benchmark -- --label baseline-v0` on the full corpus on the
user's Mac. Commit the result JSON. **Gate P0:** per-instance 3-run utilization
spread ≤ 1.5 percentage points on at least 10 instances (otherwise raise budget to
240 s and re-capture; record the chosen budget — it is then frozen for all phases).

---

## 4. Phase 1 — Repair the search signal (small diffs, big leverage)

### WP-1.1 Fitness v2

**Flag:** `fitnessVersion` (number, default `1`) in `defaultconfig`, settings UI
exposure NOT required (it is an engine flag; expose later if wanted). Plumb through
`background-start` payload. All changes inside `placeParts`.

With `fitnessVersion === 2`, replace the fitness accumulation (current lines
`main/background.js:1992` and `:2301` and `:2326`) with:

```
fitness = numSheetsOpened * 2.0
        + Σ over sheets s of sheetMetric_s
        + Σ over unplaceable parts of 100000000 * (partArea / totalsheetarea)   // unchanged
```

where, per sheet `s` with at least one placed part (compute AFTER refinement runs):

```
B_s        = bounding box of ALL placed part points on s (world coords)
SB         = bounding box of the sheet polygon
gravity:    sheetMetric_s = (2*B_s.width + B_s.height) / (2*SB.width + SB.height)
box:        sheetMetric_s = (B_s.width * B_s.height) / |sheetArea_s|
convexhull: sheetMetric_s = hullArea(all placed points on s) / |sheetArea_s|
```

Rules:
- `sheetMetric_s ∈ (0, ~1]`; the `*2.0` sheet term guarantees fewer sheets always
  beats any intra-sheet improvement. Do NOT add `sheetarea` (raw units) anymore.
- Reset all per-sheet accumulators (`minwidth`, `minarea`, bounds) at sheet open —
  this also fixes the stale-variable defect noted in §1.3.6.
- `fitnessVersion === 1` path must remain byte-identical (gate below).
- The candidate-level scoring (gravity `w*2+h`, mergeLines credit,
  `improvedPlacementScore`) is UNTOUCHED by this WP — only the aggregate fitness.
- Report the breakdown in the response payload as `payload.fitnessBreakdown =
  {version, sheets, sheetMetrics:[...], unplacedPenalty}` (additive field; UI ignores
  unknown fields).

**Gates P1a:**
1. Equivalence: flag off ⇒ placements digest identical to pre-change build on the
   whole smoke battery (§8.3).
2. Flag on: benchmark mean-median utilization ≥ baseline − 0.5 pp, and ≥ baseline
   + 0.5 pp mean improvement (the GA finally selects on signal; if no improvement,
   investigate before proceeding — do not skip to WP-1.2).
3. ML checkpoint + bakeoff before flipping the default to 2.

### WP-1.2 NFP edge sampling for candidate positions

**Flag:** `candidateEdgeSampling` (bool, default `false`; add to checkbox lists +
Settings row + explain card per §1.6).

In the candidate loop (`main/background.js:2168-2269`), today only ring vertices
`nf[k]` are evaluated. When the flag is on, additionally evaluate interpolated
points on each ring edge:

```
For each ring nf of finalNfp:
  For each edge (a,b) of the ring (wrap last→first):
    L = |b − a|
    δ = max(4 * config.curveTolerance, 0.05 * max(partBBox.w, partBBox.h))
    m = min(floor(L/δ) − 1, 8)            // interior points, evenly spaced
    for t in 1..m: candidate point = a + (b−a) * t/(m+1)
```

Caps (mandatory): total candidates per part placement ≤ 1000 (≤ 300 when
`config.mergeLines` is true, because merge evaluation is expensive per candidate).
If the cap would be exceeded, double δ once and resample; if still exceeded, keep
vertices + a uniformly-strided subset of edge samples up to the cap. Tie-breaking
logic (`:2247-2261`) is unchanged — edge samples flow through the same scoring.

**Gates P1b:** flag-off equivalence; flag-on: mean utilization ≥ +0.5 pp over
post-WP-1.1 numbers at the frozen time budget; mean per-part placement wall time
≤ +30% (measure via the existing `console.time('placement')` pair or a counter in
the response payload).

---

## 5. Phase 2 — Separate-and-compact refinement (the Local Refinement replacement)

This is the heart of the plan. It builds the penetration/separation toolkit (WP-2.1)
and a shrink–separate–compact loop (WP-2.2) that replaces the slide-based
`refineLocalPlacements` internals while preserving its IPC, stats, and badge contract.

### WP-2.1 Separation module (pure geometry, fully unit-testable)

New file `main/util/separation.js`. Follow `geometryutil.js`'s module pattern
exactly: IIFE attaching `root.SeparationUtil`, so it works both as a
`<script src="util/separation.js">` (add the tag to `main/background.html` after
`util/clipper.js`) AND via `require()` in Node tests. No DOM, no IPC, no Clipper
inside this module — it is point/segment math only. All functions take plain
`{x,y}` points and rings (arrays of points, optional `.children` array of rings).

API (signatures are contracts; do not deviate):

```
SeparationUtil.pointInRing(q, ring) -> bool            // ray-cast, on-boundary ⇒ false
SeparationUtil.distToRingBoundary(q, ring) -> {dist, closest:{x,y}}
                                                       // min point-to-segment distance
SeparationUtil.penetration(q, nfp) -> {inside:bool, depth:number, exit:{x,y}}
   // inside = pointInRing(q, nfp outer) && !pointInRing(q, any nfp.children ring)
   // depth  = inside ? min distance from q to (outer boundary ∪ children boundaries) : 0
   // exit   = the closest boundary point (the minimum translation target for q)
SeparationUtil.containmentViolation(q, ifpRings) -> {outside:bool, depth, entry:{x,y}}
   // outside = q not inside any IFP ring; depth/entry = distance/closest point to
   // the nearest IFP boundary (the pull-back-inside vector target)
SeparationUtil.mulberry32(seed) -> rng                 // re-export/require of
                                                       // ml/lib/seeded-random.js logic
SeparationUtil.separate(ctx) -> result                 // GLS loop, spec below
```

`separate(ctx)` contract:

```
ctx = {
  n,                       // part count
  q(i),                    // current test point of part i: placements[i] + parts[i][0]
  setPlacement(i, t),      // commit translation t for part i (t is the placement, not q)
  refPoint(i),             // parts[i][0]
  nfp(i, j),               // shifted outer NFP of moving part i around placed part j
                           //   (provider supplied by caller; caller handles caching)
  ifp(i),                  // IFP rings for part i (provider)
  bboxDiag(i),             // diagonal length of part i's bbox (for sampling σ)
  sheetBounds,             // {x, y, width, height} of the sheet polygon bbox
  eps,                     // feasibility tolerance, see below
  deadline,                // Date.now() ms; hard stop
  rng,                     // seeded mulberry32
  maxAttempts: 3,
  maxItersPerAttempt: 50 * n,
}

result = { feasible: bool, movesApplied: int, itersUsed: int, maxResidualDepth: number }
```

Algorithm (Umetani-style GLS; implement exactly, then tune only the marked knobs):

```
eps default: max(1e-9, 1e-4 * config.curveTolerance)        // nest units
weights w[i][j] = 1 for all pairs; wSheet = 2.0

for attempt in 1..maxAttempts:
  strikes = 0
  for iter in 1..maxItersPerAttempt:
    if Date.now() > deadline: return {feasible:false, ...}
    overlaps = all pairs (i,j) with penetration(q(i), nfp(i,j)).depth > eps
               plus all i with containmentViolation(q(i), ifp(i)).outside
    if none: return {feasible:true, ...}
    pick i = argmax over parts of  Σ_j w[i][j]*depth(i,j) + wSheet*sheetDepth(i)
    build candidate translations for part i (translations t, where q = t + refPoint(i)):
      (a) for each overlapping pair (i,j): t such that q lands on penetration.exit
          (+ a nudge of 2*eps along (exit − q) direction, to land strictly outside)
      (b) if containment violated: t such that q lands on containmentViolation.entry
          (+ 2*eps nudge inward)
      (c) 12 samples: q' = q + gaussian2D(rng, σ = 0.5 * bboxDiag(i)),
          rejected if q' outside sheetBounds (cheap prefilter)
      (d) 4 samples: q' uniform in sheetBounds (long-range jumps)
    cost(t) = Σ_{j≠i} w[i][j] * penetration(q_t, nfp(i,j)).depth
            + wSheet * containmentViolation(q_t, ifp(i)).depth
    move part i to the argmin candidate iff its cost < current cost − eps,
      counting movesApplied++; else strikes++
    if strikes > n: break          // attempt stuck
  // GLS escalation between attempts:
  maxd = max current depth over overlapping pairs (guard maxd > 0)
  for each still-overlapping pair: w[i][j] += depth(i,j) / maxd
return {feasible:false, ...}
```

gaussian2D: Box–Muller from two rng() draws. Knobs allowed to tune later: 12/4
sample counts, σ multiplier, wSheet. Everything else is fixed.

Unit tests `ml/tests/separation/run.js` (plain `node`, no Electron), minimum cases:
1. Two unit squares 0.5 apart: no overlap detected (square-vs-square NFP is a
   2×2 square ring centered on the placed square — construct NFP fixtures by hand).
2. Same squares overlapped by 0.3: `penetration.depth ≈ 0.3 ± 1e-6`, exit on the
   correct side; `separate` resolves in < 50 iters; final layout feasible.
3. Part inside another part's hole (NFP with one child ring): q inside child ⇒
   `inside === false`.
4. Containment: q outside a square IFP ⇒ `outside === true`, entry on boundary.
5. Three overlapping squares in a tight IFP: `separate` reaches feasible within
   budget with seeded rng; **same seed ⇒ identical result** (determinism test).
6. Deadline respected: impossible instance (two squares, IFP smaller than both)
   returns `feasible:false` within deadline + 50 ms.

### WP-2.2 Shrink–separate–compact loop, wired as Local Refinement v3

**Flag:** `localRefinementEngine` (string: `'slide'` default | `'shrinkSeparate'`).
Add to `defaultconfig`; add a Settings `<select>` row + explain card. The existing
`localRefinement` on/off toggle, post-process dispatch (`main/deepnest.js:119`),
stats object shape, and badge states stay EXACTLY as they are. Inside
`placeParts`'s refinement call site (`main/background.js:2289`), branch on the
engine flag; `'slide'` calls the existing `refineLocalPlacements` unchanged.

New function `refineByShrinkSeparate(sheet, placed, placements, config,
sheetboundsForScoring)` in `main/background.js` (thin orchestrator; geometry via
`SeparationUtil`):

```
1. Guards: placed.length ≥ 2; placementType is 'gravity' or 'box' (else return
   not-run stats with reason); sheet is an axis-aligned rectangle within 0.1%
   relative tolerance (compare |polygonArea(sheet)| to bbox area; reuse the
   rectangle-detection idiom from isStepRepeatRectangle at main/background.js:637).
   Non-rectangular sheets: return not-run (v1 scope cut, recorded in stats.reason).
2. Providers:
   nfp(i,j): getOuterNfp(placed[j], placed[i], false, config), shifted by
             placements[j]; memoize per (j.source, j.rotation, i.source, i.rotation,
             placements[j].x, placements[j].y) in a run-local Map.
             NOTE the global NFP cache already holds all same-rotation pairs from
             construction — these lookups are cheap cache hits.
   ifp(i):   getInnerNfp(sheet, placed[i], config), memoized per (source, rotation).
   ⚠ AMENDED 2026-06-11: during separation the IFP provider must return the REAL
   IFP clipped to the shrunken virtual extent (per-part qLimit), per
   `docs/local-refinement-v3-plan.md` §1.5 (WP-R0.1). The original "containment
   against the original sheet" design was proven defective (the separator undoes
   the squeeze; 0 accepted moves on all efficacy instances).
3. Score: layoutMetric = the SAME formula as fitness-v2 sheetMetric_s for the
   configured placementType (gravity: (2W+H)/(2SW+SH); box: WH/sheetArea).
4. Loop:
   best = deep copy of placements; bestMetric = layoutMetric(best)
   alpha = 0.005;  alphaMin = 0.0005;  alphaMax = 0.02
   deadline = start + (config.localRefinementBudgetMs default 1500)
   while Date.now() < deadline and alpha >= alphaMin:
     cand = copy(best)
     squeeze toward gravity origin:
       gravity/box: for every part k: cand[k].x = sheetMinX + (best[k].x +
         refX(k) − sheetMinX) * (1 − alpha) − refX(k)
       (i.e. squeeze the TEST POINTS q toward the sheet's min-x edge; for 'box',
        alternate x-squeeze and y-squeeze on successive successful steps)
     res = SeparationUtil.separate(ctx over cand, deadline)
     if res.feasible and layoutMetric(cand) < bestMetric − 1e-12:
        best = cand; bestMetric = ...; stats.movesAccepted += res.movesApplied;
        stats.shrinkSteps++;  alpha = min(alpha * 1.5, alphaMax)
     else:
        alpha = alpha / 2
   placements := best
5. Post: if anything moved and config.mergeLines, recompute merged data via
   recomputeSheetMergedData (main/background.js:1414) — same as the current engine
   does at :2293. Fill the stats object: ran, sheetsChecked=1, movesTested (count
   separate() iterations), movesAccepted, scoreBefore/scoreAfter (layoutMetric),
   plus additive fields {engine:'shrinkSeparate', shrinkSteps, finalAlpha}.
6. FINAL LEGALITY GATE (mandatory, belt-and-braces): for the final layout, verify
   every pair via Clipper intersection at config.clipperScale: intersection area
   ≤ (1e-3 * config.curveTolerance)^2 nest-units², and every part inside the sheet
   via its IFP. On any violation: revert to the pre-refinement placements and set
   stats.reason='legalityRevert'. This guarantees the refinement can NEVER ship an
   illegal layout regardless of separation bugs.
```

**Rotation probes (WP-2.3) — SUPERSEDED.** The blind ±2°/±5° probe design is
replaced by `docs/local-refinement-v3-plan.md` (approved 2026-06-11): contact-graph
critical-chain targeting, hull-edge-derived rotation candidates with pivot
("rocking") rotations, void relocation, pairwise swaps, and ruin-&-recreate, under
a budgeted orchestrator (`localRefinementEngine: 'smart'`). Implement WP-2.1 and
WP-2.2 from THIS document first (they are prerequisites WP-R0 of the v3 plan), then
continue with the v3 plan's WP-R1…WP-R6 instead of WP-2.3.

**Gates P2:**
1. Flag `'slide'` ⇒ byte-identical battery (§8.3).
2. `'shrinkSeparate'` on the benchmark corpus (refinement budget 1500 ms/sheet):
   `movesAccepted > 0` on ≥ 70% of instances (versus ~0 today), mean utilization
   ≥ +1.5 pp over the Phase 1 result, **zero** legality reverts logged as
   violations after revert (i.e. final outputs always legal).
3. Smoke battery green; teacher artifacts unchanged when flags off; ML checkpoint
   before defaulting the engine to `'shrinkSeparate'`.

---

## 6. Phase 3 — 'deepsearch' placement type (full-budget GLS)

### WP-3.1 Native deep search (Track A — required)

**Surface:** new `placementType` value `'deepsearch'` in the select at
`main/index.html:4001` + explain text; config keys `deepSearchBudgetSec` (default
60) and `deepSearchRestarts` (default 0 = auto: as many restarts as fit in budget).

**Dispatch model (mirrors the Step & Repeat precedent):** in `main/deepnest.js`,
when `placementType === 'deepsearch'`, build a single-individual deterministic
population exactly like the steprepeat branch at `main/deepnest.js:1364-1382`
(area-descending order, rotation 0), so the GA loop machinery, progress, and nest
insertion all keep working without GA evolution.

**Engine:** in `main/background.js`, route `'deepsearch'` to
`placePartsDeepSearch(sheets, parts, config, nestindex)`:

```
1. Construction: run the existing greedy placement (the placeParts body) with
   gravity scoring to distribute parts to sheets. Refactor carefully: extract the
   per-sheet construction into a helper BOTH paths call — this is the only
   permitted refactor of placeParts, and it must keep placeParts byte-identical
   for old placement types (equivalence gate).
2. Per sheet with ≥2 parts, run the WP-2.2 shrink–separate loop with a per-sheet
   budget: budget_s = deepSearchBudgetSec * (partsOnSheet_s / totalPlaced), with
   restarts: each restart = Fisher–Yates shuffle of insertion order (seeded rng,
   seed = nestindex * 7919 + restartIndex) → re-run construction for that sheet →
   shrink-separate → keep the best layoutMetric.
3. Fitness: ALWAYS fitness v2 for this placement type (regardless of
   fitnessVersion flag — document in the explain card).
4. Progress: send 'background-progress' at least every 500 ms
   ({index, progress: 0..1 by budget consumed}).
5. mergeLines: allowed but document in the explain card that merge credit applies
   at construction only; merged data recomputed after compaction (same as P2).
```

**Gates P3:** equivalence for all old placement types; benchmark with
`placementType:'deepsearch'`, 60 s budget: mean utilization ≥ +4 pp over the WP-0.4
baseline; no instance regresses below baseline − 0.5 pp; report (no gate) a
comparison table against published best-knowns for the ESICUP instances.

### WP-3.2 sparrow integration (Track B — OPTIONAL accelerator; do not start
before WP-3.1 ships)

Pre-gate: check the LICENSE files of `github.com/JeroenGar/sparrow` and
`github.com/JeroenGar/jagua-rs`. If either is GPL/AGPL-family, integrate ONLY as an
external sidecar binary invoked over the command line with file-based IO (no
linking), and record the decision; if permissive (MIT/Apache), a tighter binding is
allowed but the sidecar design below is still the recommended first cut.

Sidecar contract:
- `ml/lib/jagua-io.js`: Deepnest parts → jagua-rs instance JSON (outer ring +
  holes; spacing handled by exporting the already-inflated engine polygons and
  setting jagua spacing to 0; allowed orientations from `config.rotations`), and
  sparrow solution JSON → `[{id, source, x, y, rotation}]` placements.
- Main process (`main.js`): spawn `sparrow` with a job file in the OS temp dir,
  `--time-limit` = budget, kill on `background-stop` or app quit, hard timeout =
  budget + 10 s. Binary discovery: `config.sparrowPath` (Settings text field) —
  packaging per-arch binaries is explicitly out of scope until the experiment
  proves value.
- **Validation gate:** every sparrow layout is re-validated with the WP-2.2 final
  legality gate before acceptance; on failure or timeout, fall back to the Track A
  result. Sparrow output is a *proposal*; Deepnest's geometry remains the authority.
- Flag: `deepSearchEngine` (`'native'` default | `'sparrow'`).

Gate: sparrow-mode utilization ≥ native-mode on ≥ 80% of benchmark instances;
otherwise keep the flag experimental and record findings.

---

## 7. Phase 4 — ML on top of the new engine

(Aligns with `docs/ml-modernization.md`; do not start before P3 gates pass.)

- **WP-4.1 Teacher/labels:** teacher artifacts gain `fitnessBreakdown`,
  `utilization`, `engine`, `deepSearch` fields (additive schema bump in
  `ml/schemas/`; checkpoint + bakeoff mandatory).
- **WP-4.2 Routing model:** binary classifier "will `deepsearch` beat `gravity`
  by ≥ 2 pp within 60 s for this job?" Features: existing job-level features +
  part-count, area CV, mean rectangularity (part area / bbox area), congruent-class
  count. Train via the existing `ml:train-config` pipeline pattern; gate: AUC ≥ 0.8
  on held-out synthetic+real jobs; wire as a UI suggestion (not auto-switch).
- **WP-4.3 Ordering policy:** learn construction-order scoring (gradient-boosted
  ranker over part features) to replace the area-desc heuristic for deep search
  restarts; gate: ≥ +0.5 pp mean utilization at equal budget, else discard.
- Explicit non-goal: end-to-end RL placement. Published RL agents beat
  SVGNest-class baselines, not GLS-class engines; revisit only after P3 is the
  teacher.

---

## 8. Cross-cutting engineering requirements

### 8.1 Config key registry (single source of truth for this plan)

| Key | Type | Default | Phase | UI |
|---|---|---|---|---|
| `fitnessVersion` | number | 1 | P1 | none (engine flag) |
| `candidateEdgeSampling` | bool | false | P1 | checkbox + explain |
| `localRefinementEngine` | string | 'slide' | P2 | select + explain |
| `localRefinementBudgetMs` | number | 1500 | P2 | number input |
| `localRefinementRotations` | bool | false | P2.3 | checkbox |
| `localRefinementMaxColdAnglesPerPart` | number | 3 | P2.3/v3 | none yet |
| `placementType: 'deepsearch'` | enum value | — | P3 | existing select |
| `deepSearchBudgetSec` | number | 60 | P3 | number input |
| `deepSearchRestarts` | number | 0 (auto) | P3 | number input |
| `deepSearchEngine` | string | 'native' | P3.2 | select (experimental) |
| `sparrowPath` | string | '' | P3.2 | text input |

Every default flip = ML checkpoint + bakeoff + `AGENT_COLLABORATION.md` note.

### 8.2 Determinism & RNG
All stochastic loops use mulberry32 (`ml/lib/seeded-random.js`) with derived seeds
(`nestindex`-based as specified). Same inputs + same seed ⇒ same outputs, on every
platform. `Math.random` is allowed only where it already exists (GA).

### 8.3 Equivalence test (used by every phase gate)
Add `ml/tests/engine_equivalence/run.js`: run the smoke battery scenarios with all
new flags at defaults, hash the `placements` arrays (JSON.stringify with 6-decimal
rounding of x/y/rotation, SHA-1), compare to a committed golden file. Regenerate
goldens ONLY when a default intentionally flips (and say so in the commit).

### 8.4 Per-WP verification battery
1. `node --check` every touched JS file; inline-script parse check for
   `main/index.html` (the `new Function(src)` battery used in prior handoffs).
2. `bash ml/scripts/run_boot_check.sh`.
3. `DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-<wp> bash ml/scripts/run_smoke_battery.sh`.
4. Unit tests for the WP (`ml/tests/separation/run.js` etc.).
5. Equivalence test (§8.3).
6. Benchmark run with the WP's flag ON, labeled `<wp-code>`; numbers into
   `AGENT_COLLABORATION.md`.

### 8.5 Rollback
Every WP is revertible by (a) flag off (immediate, no rebuild) and (b) `git revert`
of its commits (each WP = one commit where possible). No WP may change the NFP
cache key format or `NFP_CACHE_VERSION`.

---

## 9. Trap list for the implementer (read twice; these WILL bite you)

1. **Reference point**: every overlap/containment query uses
   `q_i = placements[i] + parts[i][0]`. Not the centroid. Not the bbox corner.
   Vertex 0 of the *rotated* polygon.
2. **NFP children are holes** — inside a child ring means NO overlap. IFPs are the
   inverse domain (inside = legal).
3. **Spacing is already baked in** (§1.5). Re-offsetting double-spaces the job.
4. **Touching is legal.** Use `eps` exactly as specified; do not "play safe" with
   bigger epsilons — that destroys the compaction the whole plan exists to deliver.
5. **`parts[i]` inside `placeParts` is already rotated.** Genome rotation ≠ 0 means
   the polygon you hold has rotated coordinates and `part[0]` moved accordingly.
6. **Never mutate GA population state from background code** (deepnest.js:1425
   comment) and never send functions over IPC (structured clone).
7. **mergeLines**: any post-placement movement invalidates merged-line segments;
   always recompute via `recomputeSheetMergedData` before returning, or exports
   will draw common-line cuts in the wrong place.
8. **Don't reset `minwidth`/`minarea` semantics under `fitnessVersion 1`** — v1
   must keep its bugs to stay byte-identical.
9. **Budgets are wall-clock**: check `Date.now()` inside loops; iteration caps are
   backstops, not the primary stop.
10. **Background modules load via `<script>` tags** (§1.1) — a bare
    `module.exports` file will crash the renderer. Use the geometryutil
    root-attach pattern; `require` is available but keep `separation.js`
    dependency-free so Node tests stay trivial.
11. **Rectangle detection** must tolerate float noise (0.1% relative) — sheets come
    from user SVGs.
12. **The deadline guard belongs in `separate()`'s inner loop**, not only the outer
    shrink loop — a single separation attempt on 200 parts can otherwise blow the
    whole budget.
13. Console logging in hot loops (candidate eval, separation iters) will tank
    performance in the background renderer — log per-phase summaries only.
14. When in doubt about a geometric function's convention, write a 5-line Node
    repro against `geometryutil.js` first — don't guess.

---

## 10. Suggested execution order & claim names

| Order | WP | Claim string for Active Work | Touches |
|---|---|---|---|
| 1 | WP-0.1/0.2 | `WP-0 benchmark corpus + converter` | ml/benchmark, ml/lib, ml/tests |
| 2 | WP-0.3/0.4 | `WP-0 benchmark runner + baseline` | ml/cli, ml/scripts, ml/app-smoke-main.js |
| 3 | WP-1.1 | `WP-1.1 fitness v2 (flagged)` | main/background.js |
| 4 | WP-1.2 | `WP-1.2 NFP edge sampling (flagged)` | main/background.js, main/index.html |
| 5 | WP-2.1 | `WP-2.1 separation module + tests` | main/util/separation.js, main/background.html, ml/tests |
| 6 | WP-2.2 | `WP-2.2 shrink-separate refinement (flagged)` | main/background.js, main/index.html |
| 7 | WP-2.3 (superseded) | see `docs/local-refinement-v3-plan.md` WP-R1…WP-R6 | main/util/refinement-util.js, main/background.js |
| 8 | WP-3.1 | `WP-3.1 deepsearch placement type` | main/background.js, main/deepnest.js, main/index.html |
| 9 | WP-3.2 | `WP-3.2 sparrow sidecar (optional)` | main.js, ml/lib |
| 10 | WP-4.x | `WP-4 ML routing/ordering` | ml/python, ml/schemas |

Each WP is sized for one agent session including verification. WP-2.1 and WP-0.x
are independent and may proceed in parallel under separate claims; everything else
is sequential.

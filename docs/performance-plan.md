# Performance Plan — Deepnest ML engine hot paths

Status: PLAN v2 — AMENDED 2026-06-12 after implementing-coder review; PERF-P0 implemented 2026-07-07; PERF-P2/P1/P3/P6/P5/P4 implemented 2026-07-08.
Author: Claude-Code, 2026-06-12. Review findings verified against live code the same day;
all accepted except one mechanism correction (§9a — digest determinism), noted inline.

AMENDMENT SUMMARY: new PERF-P0 (baseline freeze + NFP pre-pass key/processHoles fix) is a
hard prerequisite; P6 redesigned around the worker pre-pass (`background.js:346-370`) which
already does O(n²) sync `db.has()` IPC BEFORE `placeParts`; P5 gains harness-main IPC
parity requirements (`ml/app-smoke-main.js` and the teacher main implement their own
`nfp-cache-*` handlers and must implement any new channels); P4's top-k base score defined
precisely; P7 moved out of this plan to the LR/smart-refinement track; equivalence coverage
expanded per §9a. Order is now **P0 → P2 → P1 → P3 → P6 → P5 → P4**.

Audience: an implementing agent with no prior context. Every work package names exact
files, symbols, line anchors (anchors drift — re-locate by symbol), specs, gates, and
traps. Read the whole document before coding. When this document and live code disagree,
trust the code and note the discrepancy in `AGENT_COLLABORATION.md`.

Scope: raw engine speed (CPU + IPC + I/O on the placement hot paths). Explicitly OUT of
scope here: search-quality improvements (SOTA plan), the Rust core (parked until the
`deepsearch` engine exists and needs it), and anything touching nesting *outputs* except
where a WP is explicitly flagged.

The governing metric is **utilization-per-second**. Every WP ships with a before/after
number from the benchmark harness (§8), not a claim.

---

## 0. Ground rules

1. **Multi-agent protocol**: read `AGENTS.md` + `AGENT_COLLABORATION.md`; claim WPs
   (`PERF-P1`…`PERF-P7`); handoff notes; commits `[<agent>] PERF-Px: <summary>`.
2. **Output-identical or flagged — nothing in between.** P1, P2, P3, P5, P6 MUST produce
   byte-identical placements (engine-equivalence harness, `ml/tests/engine_equivalence/run.js`,
   is the gate). P4 and P7 change behavior only behind flags that default off/inert.
   `main/background.js` and `main/deepnest.js` are ML-sensitive: output-identical perf work
   needs no checkpoint; flipping P4's default later does.
3. One WP per commit where possible; each independently revertible.
4. Verification battery after every WP (§9).

---

## 0.5 PERF-P0 — Baseline freeze + NFP pre-pass cache-key correctness (PREREQUISITE)

Implementation status 2026-07-07: landed by Codex. Baseline freeze commit: `05c0ce9`.
The processHoles cache-key/telemetry gate passed; the exact §8 benchmark command still
fails at `shirts/run-01` before first nest at the 10-second budget, both before and after P0
(see `AGENT_COLLABORATION.md` handoff for artifact paths).

Do this before ANY perf WP. Verified state (2026-06-12): `package.json` and the app title
are `0.7.5`, `package-lock.json` is still `0.7.3`, the tree has ~32 dirty entries, and the
last commit is the 0.7.3 release — recent legality/overlap-safety fixes are uncommitted.

1. **Freeze the baseline.** Reconcile `package-lock.json` to 0.7.5; commit the current
   0.7.4/0.7.5 work (legality fixes, pre-pass NFP normalization) as its own commit(s) so
   perf changes never share a commit with correctness changes. Capture fresh equivalence
   goldens and a benchmark baseline (`perf-p0-baseline`) at that commit.
2. **Fix the pre-pass cache-key drift** (`main/background.js:346-370` + the post-process
   insert block around `:499`). Today the pre-pass builds cache docs WITHOUT the
   `processHoles` field while `getOuterNfp` includes it, and it computes hole child NFPs
   unconditionally. Consequences under `processHoles:false`: `db.has(doc)` checks the
   hole-aware key (always the wrong one), so the pre-pass recomputes and re-inserts pairs
   every run, wasting O(n²) work and polluting the cache with hole-aware entries nothing
   reads. Fix: thread `config.processHoles` into the pre-pass docs (`doc.processHoles =
   processHoles`, matching `getOuterNfp`'s object literal exactly) AND skip the hole
   child-NFP accounting when `processHoles === false`. This is a correctness/hygiene fix
   in the same family as the diagnosed cache-poisoning issues — it lands with its own
   equivalence + `processHoles:false` scenario run, separate from any perf change.
3. Gate: goldens green at the frozen commit; a `processHoles:false` smoke run shows the
   pre-pass reporting cache hits on its second execution (add a one-line
   `pairsCacheHits` counter to the response telemetry to prove it).

## 1. PERF-P1 — Memoize polygon fingerprints

**Problem.** Every `getOuterNfp`/`getInnerNfp` call builds a cache key via
`nfpCacheKey` → `polygonFingerprint` → `polygonSignatureText` (`main/background.js:133-199`),
which stringifies EVERY coordinate with `toFixed(5)` and FNV-hashes the result — for BOTH
polygons, on EVERY lookup. Per part placement that is `placed.length` lookups; per
individual O(n²) full-polygon stringifications; the same rotated part is re-fingerprinted
n times.

**Spec.** In `polygonFingerprint(polygon)`:
```
function polygonFingerprint(polygon){
	if (polygon && polygon.__dnFingerprint) { return polygon.__dnFingerprint; }
	var fp = hashString(polygonSignatureText(polygon));
	if (polygon && typeof polygon === 'object') {
		try {
			Object.defineProperty(polygon, '__dnFingerprint', {
				value: fp, enumerable: false, configurable: true
			});
		} catch (e) { /* frozen/sealed objects: skip memo */ }
	}
	return fp;
}
```
- **Non-enumerable is mandatory**: enumerable props would ride along structured-clone IPC
  and JSON serialization (exports, cache files, teacher artifacts). Non-enumerable props are
  NOT copied by structured clone or `JSON.stringify` — verify this in the P1 test.
- The signature covers `polygon.children` recursively — child rings also get memoized when
  fingerprinted directly; the parent memo already includes their text, which is fine.

**Safety precondition (verify, don't assume).** Memoization is only valid if polygons are
immutable after first fingerprint. Audit and confirm:
- `placeParts` rotates COPIES up front (`rotated[]`), then never mutates part vertex data.
- NFP objects get shifted in place (`nfp[m].x += …`) — but NFPs are never fingerprinted
  after retrieval (keys are built from the INPUT part polygons, not NFPs). Confirm by
  grepping every `polygonFingerprint`/`nfpCacheKey` caller.
- Refinement rotation probes create fresh rotated copies (`localRefinementRotatedPartForRotation`)
  → fresh objects, fresh memo. OK.
- Sheets are cloned per nest (`cloneTree`) and not mutated after the margin/spacing offsets
  (which happen in `deepnest.js` BEFORE IPC — worker-side objects are fresh clones). OK.
If any caller fingerprints a polygon that is later mutated and re-fingerprinted, fix THAT
call site to use a copy — do not weaken the memo.

**Test** (`ml/tests/engine_bugfixes/run.js`, extend): same polygon → same fingerprint twice
(second from memo); structurally equal but distinct object → equal fingerprint; JSON round
trip of a memoized polygon contains no `__dnFingerprint`; structured-clone-like copy
(`JSON.parse(JSON.stringify(p))`) re-computes and matches.

**Expected**: 5–15% of placement CPU on part-heavy jobs (more with many placed parts).

Implementation status 2026-07-08: landed by Codex. `polygonFingerprint`
now memoizes via a non-enumerable `__dnFingerprint` property; the engine
bugfix harness verifies memo reuse, distinct-object equality, and JSON copy
behavior.

---

## 2. PERF-P2 — Remove hot-loop console logging (+ replacement telemetry)

**Problem.** Per-part and per-insert logging in the placement loop serializes objects and
buffers console messages in the background renderer:
- `console.time('placement')` / `console.timeEnd('placement')` per part
  (`main/background.js:4758`, `:5046`) — also UNBALANCED on early `continue` paths
  (unmatched-timer warnings).
- `console.log('save cache', …)` per part (`:4878`).
- `console.log('inserting inner: ', A.source, B.source, B.rotation, f)` (`:4677`) — logs the
  ENTIRE inner-NFP structure on every inner-NFP insert.
- `console.log('minkowski', …)` per Clipper-fallback call (`:4508`).

**Spec.** Delete all four (and the paired `timeEnd`). Replace the lost timing signal with
cheap aggregate telemetry in the `background-response` payload (additive field, UI ignores
unknown fields): accumulate `placementMs` via `Date.now()` around the per-part placement
body and attach `result.timing = { placementMs, parts: placedCount }` in `placeParts`'s
return. No console output in any per-part/per-candidate/per-insert path — engine-level
one-line summaries only.

**Gate**: equivalence harness (placements identical — logging cannot change outputs, but the
harness also proves you didn't fat-finger the loop while editing).

**Implementation note 2026-07-08.** PERF-P2 also persists `report.details.timing`
into benchmark run JSONs so later WPs can quote the placement telemetry from §8
artifacts directly.

---

## 3. PERF-P3 — Convex-hull mode candidate-loop hoists

**Problem** (`main/background.js:4990-5000` area, candidate loop in `placeParts`): per
CANDIDATE position, hull mode currently:
1. `getHull(localpoints)` for the area score (`:4996`),
2. `getHull(localpoints)` AGAIN for `shiftvector.hull` (`:4998`) — identical input,
3. `getHull(sheet)` for `shiftvector.hullsheet` (`:4999`) — the SHEET, invariant per sheet.

**Spec.**
1. Compute `var candidateHull = getHull(localpoints);` once; use it for both the area
   (`Math.abs(GeometryUtil.polygonArea(candidateHull))`) and `shiftvector.hull = candidateHull`.
2. Hoist `var sheetHull = getHull(sheet);` to sheet-open (next to `sheetarea`,
   `main/background.js` sheet-open block) and use `shiftvector.hullsheet = sheetHull` —
   NOTE: all candidates then share ONE array reference. Verify consumers of
   `position.hullsheet` / `position.hull` treat them read-only (grep `hullsheet` and
   `\.hull\b` in `main/deepnest.js`, `main/index.html`, `main/background.js`); if any
   consumer mutates, keep per-accepted-position cloning of `hull` only at ACCEPT time
   (clone once per accepted candidate, not per evaluated candidate).

**Gate**: equivalence harness MUST include a convexhull scenario — add one if the battery
lacks it (clone `svg-gravity.json` → `svg-hull.json` with `placementType: 'convexhull'`,
add to `ml/scripts/run_smoke_battery.sh` and regenerate the equivalence golden with
`--update`, stating so in the commit).

**Expected**: ~3× cheaper hull-mode candidate scoring (hull is the dominant per-candidate
cost in that mode).

Implementation status 2026-07-08: landed by Codex. `svg-hull` already existed in the
equivalence harness; the default smoke battery now includes it too.

---

## 4. PERF-P4 — mergeLines top-k credit cap (FLAGGED — changes outputs)

**Problem.** With `mergeLines` on, EVERY candidate runs `mergedLength(shiftedplaced,
shiftedpart, …)` (`main/background.js:5008`) — O(placed-segments × part-segments) per
candidate; the dominant cost in merge mode even after the earlier hoist.

**Spec.** New config key `mergeCandidateCap` (number, default `0` = disabled/current
behavior; hidden engine flag, no Settings UI yet):
- When `> 0`: first pass scores ALL candidates with the **exact existing scoring pipeline
  minus only the merge-credit subtraction** — i.e. the gravity/box/hull `area` value passed
  through `improvedPlacementScore(area, candidateBounds, sheetboundsForScoring, config)`,
  identical to today's `score` except the `area -= merged.totalLength*config.timeRatio`
  line is skipped (AMENDED for precision: the base score INCLUDES the
  improvedPlacementScore adjustment, EXCLUDES merge credit only). Keep the top
  `mergeCandidateCap` (recommend 64) by that base score; second pass evaluates merge
  credit only for those; final selection over the capped set with the existing tie-break
  rules unchanged.
- This can change the chosen placement (a candidate outside the top-k could have won via
  merge credit) → therefore FLAGGED, default off, and the flag value must ride in the
  worker config copy (`copyConfigForWorker`, `main/deepnest.js:69`) like other engine flags.

**Gates**: flag-off equivalence (byte-identical). Flag-on: benchmark a mergeLines-enabled
scenario (add `svg-gravity-merge.json` smoke scenario) — wall-time reduction reported, AND
utilization delta within ±0.3pp of flag-off on the bounded ESICUP probe with
`mergeLines:true`. Default stays 0 until a full bakeoff (ML checkpoint) if ever flipped.

---

## 5. PERF-P5 — Send geometry once per nest, not per individual

**Problem.** Every `background-start` payload (`main/deepnest.js:1524-1537`) contains the
FULL geometry: `sheets` (quantity-expanded cloned trees), `individual.placement` (every
part instance's full polygon tree), plus a THIRD copy of children arrays (`children[]`,
`:1513-1522`). For a 100-part job this is megabytes of structured-clone per individual, per
generation, per worker — pure IPC/allocation waste.

**Design (pull model, main process as geometry broker).**
1. **Renderer, nest start** (`main/deepnest.js`, inside `start()` after the offset loop):
   build once:
   ```
   var nestToken = 'nest-' + Date.now() + '-' + Math.floor(Math.random()*1e9);
   var geometry = {
     token: nestToken,
     partsBySource: {},   // source -> polygontree (ONE canonical tree per source, cloned)
     sheets: sheets, sheetids: …, sheetsources: …, sheetchildren: …   // as today, once
   };
   ipcRenderer.send('nest-geometry-set', geometry);
   ```
   `partsBySource[source]` = clone of the source part's offset polygontree (the same data
   the GA's `adam` instances were cloned from — capture it where `adam` is built,
   `main/deepnest.js:1461` area, keyed by `poly.source`).
2. **Worker payload** becomes small:
   `{ index, nestToken, ids, sources, rotations: individual.rotation, config }` — drop
   `sheets/sheetids/sheetsources/sheetchildren/individual.placement/children`. Keep
   `individual`'s NON-geometry fields if the response path needs them (check
   `background-response` handling `main/deepnest.js:1290-1330` — it references
   `payload.index` and fitness only; the refinement path also carries
   `localRefinementPostProcess` + token fields — preserve those).
3. **Main process** (`main.js`): `ipcMain.on('nest-geometry-set')` stores the LAST 2
   geometries by token (bounded map; clear on `background-stop` and on
   `recreateBackgroundWindows`). `ipcMain.on('nest-geometry-get-sync')` returns the
   geometry for a token (or null).
4. **Worker, `background-start`** (`main/background.js:292`): if `data.nestToken` and the
   worker's module-level `geometryCache[token]` is missing → ONE
   `ipcRendererSafeSendSync('nest-geometry-get-sync', token)` → cache it. Reconstruct
   exactly what the old payload carried:
   ```
   parts[j] = cloneTree(geometry.partsBySource[sources[j]]);
   parts[j].id = ids[j]; parts[j].source = sources[j]; parts[j].rotation = rotations[j];
   sheets/sheetids/… from geometry (clone sheets per use as the current code does).
   ```
   The receive side ALREADY reassembles ids/sources/children onto trees (the historical
   "hash values don't make it across ipc" block) — replace that block, preserving the exact
   ordering/rotation semantics. `cloneTree` does not exist in background.js — implement a
   plain recursive clone there (or reuse `clone()` extended to children — it already
   handles children; verify it copies `exact` flags on points, which `mergedLength` needs).
5. **Fallback path**: if `data.individual && data.individual.placement` (old shape), run the
   old code unchanged. Both call sites that send `background-start` must migrate:
   the GA dispatch (`main/deepnest.js:1537`) AND the local-refinement post-process
   (`refinePayload`, `main/deepnest.js:126` — it resubmits the best individual; route it
   through the same token mechanism).
6. **Robustness invariants**: pull-on-miss makes worker recreation (NFP-cache clear) safe —
   a fresh worker pulls geometry on its first payload. Main clears tokens on
   `background-stop` so memory can't grow across jobs. If `nest-geometry-get-sync` returns
   null (cleared mid-flight), the worker must respond with the existing failure shape the
   straggler logic expects (see `main/deepnest.js:1290` error path) — never throw.

**Traps**: (a) `exact` point flags must survive cloning or mergeLines silently degrades —
test it; (b) rotations array indexes must align with ids/sources exactly as
`GA.population[i].placement`/`rotation` do today; (c) **harness-main parity (AMENDED)**:
`ml/app-smoke-main.js` and the teacher main implement their own IPC hosts — the
`nest-geometry-set`/`nest-geometry-get-sync` handlers must be added there too, mirroring
`main.js` exactly, or every smoke/teacher run exercises only the fallback path and the
equivalence gate proves nothing about the new path. Add a telemetry field
(`geometryPath: 'token'|'legacy'`) to the response so reports show which path ran; the
equivalence run must show `token`.

**Slicing (AMENDED — land as five reviewable slices, in order):**
S1 broker IPC in all three mains + unit-style handler test; S2 worker-side pull +
reconstruction behind the fallback (payload still legacy — dead code proven by test);
S3 GA dispatch call-site migration; S4 local-refinement post-process migration;
S5 cleanup/failure handling (token clear on stop, null-geometry failure path) + telemetry.
Each slice passes the full battery before the next.

**Gates**: equivalence harness byte-identical; benchmark: measure per-generation dispatch
wall time (add `dispatchMs` telemetry alongside P2's timing field) on a 100+ part job —
expect an order-of-magnitude payload reduction; smoke battery + boot check green.

---

## 6. PERF-P6 — Batched NFP cache prefetch per placement run

**Problem (AMENDED — the pre-pass is the primary target).** TWO O(n²) sync-IPC sources
exist, and the earlier draft only addressed the second:
1. The worker pair pre-pass (`main/background.js:346-370`) runs BEFORE `placeParts` and
   calls `db.has(doc)` per pair — each local-mirror miss is a sync `nfp-cache-has-sync`
   round-trip. This is the dominant storm on cold workers.
2. Inside `placeParts`, first-touch `db.find` misses do sync `nfp-cache-find-sync`
   round-trips (`main/background.js:261`).

**Spec (redesigned).** One batched fetch, placed BEFORE the pre-pass, feeding both paths:
1. New IPC in `main.js`: `nfp-cache-find-batch-sync` — input `string[]` keys, output array
   of `nfp|null` via the existing `nfpCacheFind(key)`. **Also add the same handler to
   `ml/app-smoke-main.js` and the teacher main** (they implement their own `nfp-cache-*`
   handlers — verified `ml/app-smoke-main.js:557-658`); without parity every harness run
   silently loses the optimization.
2. In the `background-start` handler, immediately after parts are reconstructed and BEFORE
   the pair pre-pass loop: build the full key list — for every unordered pair the pre-pass
   will enumerate, the key from the P0-FIXED doc shape (including `processHoles`), plus the
   ordered-pair outer keys and per-part inner keys `placeParts` will need. Dedupe. (P1
   memoized fingerprints are a prerequisite.)
3. Filter keys already in `window.nfpcache`; send ONE
   `ipcRendererSafeSendSync('nfp-cache-find-batch-sync', keys)` (chunked); warm hits via
   `warmLocalNfpCache` (existing heap-pressure guard applies).
4. **Replace the pre-pass `db.has(doc)` with a local-mirror check** (`window.nfpcache`
   lookup by the same key) — after the batch warm, existence is answerable locally with
   zero IPC. `placeParts`'s `db.find` then also hits the warm mirror.
5. **Caps (amended)**: chunk at 2000 keys AND stop issuing chunks when either (a) the
   accumulated warmed payload exceeds 64 MB (sum of JSON-ish sizes returned; main includes
   a `bytes` total in the batch response) or (b) 250 ms of batch time has elapsed —
   remaining keys stay misses and are computed as today. Caps prevent a giant warmed cache
   from starving the heap guard on large jobs.

**Traps**: key construction MUST byte-match the P0-fixed doc shapes (dev assertion in the
P6 test: prefetch key === the key `window.db.find`/`db.has` computes for the same pair);
do not reorder the pre-pass's pair enumeration (its insert order feeds `pairs[]` and the
parallel workers deterministically).

**Gates**: equivalence harness (warming is semantically transparent); benchmark twice-run
comparison (second run's time-to-first-nest must drop vs pre-P6 second runs); the
`pairsCacheHits` telemetry from P0 shows the pre-pass hitting the warm mirror.

Implementation status 2026-07-08: landed by Codex. The app and smoke harness expose
`nfp-cache-find-batch-sync`; teacher now has in-memory `nfp-cache-*` parity. Reports
include `timing.nfpBatch` so smoke/benchmark artifacts prove the batch path ran.

---

## 7. PERF-P7 — MOVED OUT of this plan (AMENDED)

Refinement ring decimation + bbox prefilter belongs to the flagged smart-refinement track,
not default hot-path work — it is specced in `docs/local-refinement-v3-plan.md` §1.8 and
should be claimed/scheduled there alongside the next LR work package, with the LR gates
(laurel fixture throughput at equal budget; erosion-predicate legality authoritative).
Nothing to do in this plan.

---

## 8. Measurement protocol (every WP reports these)

1. **Benchmark — exact command (AMENDED 2026-07-07: `shirts` → `blaz1`)**:
   ```
   npm run ml:nest-benchmark -- \
     --label perf-p<N>-<before|after> \
     --instances albano,blaz1,shapes0 \
     --time-budget-sec 10 \
     --runs 2
   ```
   Rationale: `shirts` (99 parts) cannot reliably produce a first nest within 10 s under
   the legacy x64 smoke runtime (no native addon) — it failed `no_nest_before_time_budget`
   both before and after P0, so it measures nothing at this budget. The perf gate needs
   reliable completion and RELATIVE timing, not corpus breadth: `albano` (curved),
   `blaz1` (concave), `shapes0` (rectilinear, many parts) are the trio proven to complete
   at 10 s across all the LR bounded probes. `shirts` stays in the full corpus for the
   SOTA utilization gates, where the frozen 240 s budget applies.
   Report per-instance `timeToBestSec`, total wall time, and utilization (must be unchanged
   for output-identical WPs — identical placements imply identical utilization; any delta
   means the equivalence gate was bypassed).
2. **Telemetry**: after P2 lands, `timing.placementMs` (and P5's `dispatchMs`) from the
   smoke reports give per-stage numbers — quote them in the handoff note.
3. Record before/after in `AGENT_COLLABORATION.md` with the result-file names.

## 9a. Coverage expansion (AMENDED — with a determinism correction)

The reviewer is right that the current equivalence harness (pop=1, rotations=1, threads=1,
localRefinement=false) is too narrow. But naively adding "rotations 4, threads 2/4, normal
GA" as DIGEST tests is not implementable: the GA and seed rotations call `Math.random`, so
digests are not stable run-to-run. Split coverage by mechanism:

1. **Digest-equivalence (extend the existing harness — deterministic configs only):** add
   scenarios under the deterministic pinning for `convexhull`, `mergeLines:true`,
   `processHoles:false`, and `simplify:true` — one golden each. Regenerate goldens once at
   the P0 frozen baseline, stating so in the commit.
2. **Legality-assertion battery (new, non-digest — covers the stochastic matrix):** a
   runner that executes smoke scenarios with `rotations:4`, `threads:2` and `threads:4`,
   real GA population, and slide local-refinement ON, then asserts on the RESULT (not the
   digest): every exported pair passes the erosion-based `materialOverlap` check (no
   overlaps), every part inside its sheet, part count conserved. Run it per WP; it catches
   races/corruption that deterministic digests cannot.
3. **Teacher mini-run:** one short teacher job per WP batch (not per WP) to prove ML
   pipeline compatibility (artifacts parse, schema unchanged).

## 9. Verification battery (per WP)

1. `node --check` on touched files; inline-script parse of `main/index.html` if touched.
2. `node ml/tests/engine_bugfixes/run.js`, `node ml/tests/separation/run.js`.
3. `node ml/tests/engine_equivalence/run.js` — THE gate for P1/P2/P3/P5/P6 (and flag-off
   P4/P7). Regenerate goldens only for P3's new hull scenario, stating so in the commit.
4. `bash ml/scripts/run_boot_check.sh`; full `bash ml/scripts/run_smoke_battery.sh`.
5. §8 benchmark before/after.

## 10. Order & claims (AMENDED)

| Order | WP | Claim | Anchors | Risk |
|---|---|---|---|---|
| 1 | PERF-P0 | `PERF-P0 baseline freeze + pre-pass key fix` | package-lock, background.js:346-370,:499 | correctness prerequisite |
| 2 | PERF-P2 | `PERF-P2 hot-loop logging + timing telemetry` | background.js:4508,4677,4758,4878,5046 | trivial |
| 3 | PERF-P1 | `PERF-P1 fingerprint memoization` | background.js:133-199 | low (immutability audit) |
| 4 | PERF-P3 | `PERF-P3 hull candidate hoists` | background.js:4990-5000 | low (consumer audit; hull golden first) |
| 5 | PERF-P6 | `PERF-P6 batched NFP warm (pre-pass first)` | background.js:346-370,:261; main.js + BOTH harness mains | medium (key match + IPC parity) |
| 6 | PERF-P5 | `PERF-P5 geometry-once dispatch (5 slices)` | deepnest.js:1506-1540, background.js:292, harness mains | **medium-high** — rides alone, sliced S1–S5 |
| 7 | PERF-P4 | `PERF-P4 merge credit cap (flagged)` | background.js:5008 | low while default-off |

PERF-P7 moved to the LR/smart-refinement track (see §7). Do NOT start P5/P6 before P0's
frozen baseline and the §9a coverage additions exist — the reviewer's core point stands:
speed work must not accelerate a shaky cache or bypass the overlap-safety fixes. Expected
combined effect on a 100-part gravity job: measurably faster generations (IPC + fingerprint
+ logging overhead gone), unchanged placements; hull-mode and mergeLines jobs gain the most.

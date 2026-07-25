# Local Refinement v4 — "make refinement real" — Implementation Plan

Status: IMPLEMENTED BEHIND DEFAULT-OFF FLAGS — verification green, efficacy and
safety gates incomplete (Codex, 2026-07-25). Diagnosis below is evidence-backed
and reproducible (§1). Supersedes nothing; it **repairs the acceptance and throughput layers**
that every prior refinement WP (v3 smart engine, fine rotation, rotation reflow,
continuous compaction) was built on top of. Those operators are not the problem —
they are being starved and then overruled.

Author: Claude-Code, 2026-07-24 (analysis performed against commit `09e0039`,
product version 0.8.0).

Audience: an implementing AI agent with no prior context. Read `AGENTS.md` and
`AGENT_COLLABORATION.md` FIRST (claim protocol, ML-sensitive file rules, commit
tagging). `docs/sota-nesting-implementation-plan.md` §0 ground rules, geometry
conventions, config plumbing, and verification battery apply verbatim and are not
repeated here. `docs/local-refinement-v3-plan.md` describes the operator set this
plan makes effective.

Goal: turn Local Refinement from a cosmetic post-pass into a search that measurably
densifies real sheets — specifically, make it able to **accept rotations that improve
local fit**, which it currently cannot do at all.

## Implementation outcome (2026-07-25)

- WP-V4.1 through WP-V4.5 are implemented and remain default-off.
- The four-laurel visual gate is substantive: 45-degree refinement, 24.88% continuous
  score improvement, exact legality, and zero non-canonical NFP cache lookups.
- Frozen flag-off engine equivalence, focused tests, boot check, and the 13-scenario
  Electron smoke battery pass.
- V4.2's fast-legality gate failed safely: NFP-only and exact-material predicates
  disagree on existing fixtures. The app checkbox is disabled and the flag remains
  available only to controlled CLI diagnostics. Best albano throughput was 981
  candidate evaluations versus 594 baseline (1.65x, below the required 10x).
- The production window operator fires at a 15-second refinement budget, but its
  accepted albano moves improve contact while leaving the primary metric and
  utilization unchanged.
- Benchmark runs now use explicit deterministic seeds and independently sweep the
  original exported geometry with Clipper. On matched albano seeds, v4 accepted one
  contact move per run but median utilization remained 79.8528%, equal to shipped
  smart. The broader seeded comparison stopped when shipped-smart itself exported a
  `shapes0` sliver with intersection area `0.00005026835`; this is an existing
  parser/engine-to-export tolerance defect and blocks the zero-illegal-layout gate.
- No defaults were flipped, no full-corpus efficacy claim is made, and no bakeoff was
  run. See the 2026-07-25 handoff in `AGENT_COLLABORATION.md` for commands and
  benchmark artifact names.

## Follow-up findings (Claude-Code, 2026-07-25) — both blocked gates re-diagnosed

**1. §4.5 rested on a false premise, and the 10× gate was therefore unreachable by
design (author error).** §4.5 assumed `localRefinementMaterialOverlap` runs "per
neighbour per candidate" and therefore dominates the hot path. It does not. The
neighbour loop returns as soon as the NFP predicate reports penetration
(`if(nfpOverlap) return false;` precedes the material call), so the exact Clipper
check only ever executes for candidates the NFP has *already* declared legal.

Measured on albano at a 10 s budget with `v4FastLegality` ON: **887 candidate
evaluations vs 981 with it OFF** — no gain, slightly worse, i.e. noise. Removing a
check that was already short-circuited for ~98 % of candidates cannot speed anything
up. The correct reading of the 1.65 × result is therefore **not** "blocked by §4.5";
it is "§4.5 was never worth ~8× of the gate." The gate should be deleted and replaced
after a real profile of the hot path (prime suspects: `getOuterNfp` cache lookups and
`SeparationUtil.penetration`, both of which run on every neighbour of every
candidate, unlike the material check).

The earlier observation that enabling `v4LegalityShadow` makes albano miss its time
budget is consistent with this and does **not** contradict it: shadow mode
deliberately disables the early return so that *both* predicates run on *every*
candidate, which is precisely the workload the normal path avoids.

**2. The predicate disagreements are entirely in the SAFE direction, which unblocks
§4.5.** The original instrumentation counted disagreements without recording their
*direction*, and `attemptDiagnostics` is capped at 12 — so the raw total could not
distinguish "NFP is over-conservative" (harmless) from "NFP permits an actual
overlap" (unsafe). Directional counters were added
(`legalityDisagreementNfpStricter` / `legalityDisagreementMaterialStricter`).

Measured on `svg-laurel-continuous-four` with the shadow audit on:

| metric | count |
|---|---|
| total disagreements | 269 |
| NFP stricter — NFP forbids, exact geometry says legal (**safe**) | **269** |
| material stricter — NFP permits, parts actually overlap (**unsafe**) | **0** |

All twelve captured diagnostics show `nfpOverlap=true, materialOverlap=false` at
penetration depths of 3.8e-4 … 9.0e-4 — 13–30× the legality epsilon (3e-5), so these
are not borderline tolerance cases. **The NFP is over-conservative on concave parts.**
`v4FastLegality` only skips the exact check when the NFP already says *legal*, so on
this evidence it cannot introduce an overlap; the unsafe direction was never observed.

Disagreements are also strongly localised: 402 / 4 / 2 in the three laurel fixtures
and **0 in all other smoke scenarios** — consistent with §10 trap 5 (both NFP
producers reduce a multi-polygon Minkowski result to the largest-area ring and
discard the rest; dropping an NFP hole enlarges the forbidden region, which is
precisely an over-conservative NFP on a concave part). This is a real density cost
on exactly the branch/laurel geometry the user cares about, and is worth its own WP.

**3. The `shapes0` exported sliver is a specification mismatch, not necessarily a
defect.** The engine's legality epsilon is `1e-4 × curveTolerance` = **3e-5** at the
default `curveTolerance: 0.3` — the engine *explicitly permits* penetration up to
that depth. `ml/tests/benchmark_legality` asserts `maxIntersectionArea === 0`, i.e.
zero tolerance. The reported sliver area `5.026835e-5` is what a **1.68-unit-long**
contact edge at exactly the permitted depth produces. Chasing exact-zero overlap in
floating-point polygon geometry is not achievable and, at this magnitude, not
physically meaningful. Decide the contract first: one epsilon, derived from
`curveTolerance` (or better, from physical spacing/kerf), applied consistently by the
NFP predicate, the material backstop, and the export audit — then re-run the gate.

**3b. The binding constraint on dense sheets is LEGALITY, not acceptance and not
speed.** This is the most important measurement of the session and it partially
corrects the §0 diagnosis. Candidate dispositions on albano:

| configuration | evaluations | reached scoring | rejected as illegal | utilisation |
|---|---|---|---|---|
| shipped smart (seeded) | 942 | 19 | 923 (98.0 %) | 0.798528 |
| v4 contact acceptance ON | 117–126 | 12 | 105–114 (89.7 %) | 0.798528 |
| v4 fast legality ON | 887 | 4 | 883 (99.5 %) | 0.798528 |

Two things follow. First, **~98 % of candidates never reach the objective function at
all** — they are killed by the legality predicate first. An acceptance-rule change
cannot help a candidate that is never scored, and a throughput change only buys more
rejections. Second, **utilisation is bit-identical (0.798528) across every
configuration tried**, including shipped-smart: on this instance refinement is not
changing the outcome under any flag combination.

This does not invalidate WP-V4.1 — the laurel fixture (4 parts, ample free space,
45° accepted, 24.88 % continuous improvement) proves contact acceptance works *where
legal moves exist*. It localises the remaining problem: on a densely packed sheet
there is essentially **no legal single-part move**, which is the same structural point
recorded at the very start of this work ("in a contact-packed sheet there is no legal
rigid rotation of meaningful size"). Sparse layouts are acceptance-limited; dense
layouts are legality-limited.

**Recommended order from here (revised by the measurements above):**
(a) settle the legality-tolerance contract §3 — still worth doing, it unblocks the
    corpus safety gate and is cheap;
(b) **profile the hot path before optimising it further** — §4.5 is dead, and the
    remaining per-candidate cost is unmeasured. Do not add another speed WP on
    assumption;
(c) invest in **move types that do not require a legal single-part move**, because
    that is the actual wall on dense sheets: larger-window ruin-and-recreate (WP-V4.4
    with k well above the current window), and/or the overlap-then-repair formulation
    (allow temporary penetration, minimise depth, require legality only at commit —
    the `SeparationUtil` machinery already exists for this);
(d) the harvest pass in item 4 below, which is what converts any densification into
    utilisation.
`v4FastLegality` may be left enabled or removed on taste — it is safe (item 2) but
buys nothing (item 1). Composing the spatial index with `skip` (three of the five
`localRefinementSinglePlacementLegal` call sites bypass it) remains a genuine but
now lower-priority throughput item.

**4. Why contact moves are not converting to utilisation (design gap in this plan).**
Densification frees space in the *interior*; utilisation only improves when the
*frontier* contracts. No operator currently takes a frontier part and moves it into a
void that densification just created, so contact gains have no path to the primary
metric. Contact was specified as a stepping stone and the step that cashes it in was
never specified. The missing piece is a **harvest pass**: after contact densification,
attempt relocation of frontier-most parts into newly-freed interior regions, accepted
on the *primary* metric. This is an extension of the existing relocate operator, not
new machinery, and it is the actual efficacy hypothesis to test.

---

## 0. TL;DR for the implementing agent

Three defects, in dependency order. Do not reorder them.

1. **The acceptance objective is blind to what refinement is for.** In the default
   `gravity` mode the sheet metric is `(2·partBounds.width + partBounds.height) /
   denominator` — the **bounding box of all placed parts**. `box` and `hull` modes
   are the same idea against a different outline. Any move that does not shrink the
   outer silhouette scores exactly zero and is rejected, because acceptance requires
   strict improvement. Every rotation that meshes two parts better in the sheet
   interior is therefore rejected *by construction*, no matter how good it is.

2. **Throughput is ~2 orders of magnitude too low.** ~594 candidate evaluations in a
   3000 ms budget (≈5 ms each). A local search that moves the needle needs 10⁴–10⁵.
   The hot path does an unindexed O(n) neighbour loop with a deep polygon clone and a
   full Clipper boolean per neighbour per candidate, and scoring re-materialises every
   vertex of every part per candidate.

3. **Coverage and gating.** Operator target counts are fixed constants (6/4/2/8)
   regardless of part count; the strongest operator (`localRefinementTryWholeClusterRebuild`)
   is hard-gated to sheets with **4–6 parts**; and with stock defaults
   (`mergeLines: true`) the entire continuous stage is skipped.

Fixing (1) without (2) yields a search that wants the right thing but cannot find it.
Fixing (2) without (1) yields a fast search that still rejects everything. Land both,
then the rest.

---

## 1. Evidence (reproduce before you start)

Source: `ml/benchmark/results/20260709T202749Z-rotation-reflow-poststage-on-10s.json`
(10 s nests, `localRefinementBudgetMs: 3000`, engine `smart`).

| Instance | relocate | swap | rotation reflow | legal rotation candidates | improvement |
|---|---|---|---|---|---|
| albano | 7/18 | **0/36** | **0/3** | 944 | 2.276 % |
| blaz1 | 0/6 | **0/7** | **0/4** | 96 | **0.000 %** |
| shapes0 | 1/12 | **0/24** | 0/0 | 0 | **0.000 %** |

Read the rotation column: on albano the reflow operator produced **944 geometrically
legal rotation candidates** and **3 fully legal rebuilt layouts**, then accepted
**zero**. Across the corpus swap is **0-for-67** and rotation is **0-for-7**. On
shapes0 one move was "accepted" with 0.000 % improvement — the 5e-4 spread
tie-breaker firing on a plateau. That single row is the whole user complaint:
refinement is cosmetic.

albano also reports `legalityRejects: 525` against `movesTested: 69` — i.e. ~594
candidate poses considered in ≤3000 ms.

Reproduce with:

```bash
node -e "const d=require('./ml/benchmark/results/20260709T202749Z-rotation-reflow-poststage-on-10s.json');for(const i of d.instances){const r=i.runs?i.runs[0]:i,l=r.localRefinement,o=l.operatorStats;console.log(i.name,JSON.stringify({legalityRejects:l.legalityRejects,relocate:o.relocate,swap:o.swap,reflow:o.rotateReflow,reflowLegalCands:l.rotationReflowLegalCandidates,reflowAccepted:l.rotationReflowRotationsAccepted,improv:l.relativeImprovement}));}"
```

**Line numbers in this document drift** — `main/background.js` is 8274 lines and
grows every wave. Locate everything by function name (`grep -n "^function <name>"`).

---

## 2. Ground rules specific to v4

1. **NFP cache safety is absolute.** The Phase 0 canonical-grid guard
   (`localRefinementRecordNonCanonicalNfpLookup`, called at the top of `getOuterNfp`
   and `getInnerNfp`) must stay green: `nonCanonicalNfpLookups == 0` in every
   benchmark and smoke run, every WP. Off-grid angles are validated by exact
   geometry only, never by NFP lookup. No new work may write arbitrary-angle
   geometry into the persistent cache.
2. **`main/background.js` is ML-sensitive.** Attempt `npm run ml:checkpoint --
   --name lr-v4-<wp>-pre` before engine edits; it currently fails with "No completed
   training runs with a trained model were found." Record the attempt and the failure
   in Handoff Notes, as every prior wave did.
3. **Every WP lands behind a default-off flag** and must pass the frozen
   engine-equivalence harness with the flag off (`node ml/tests/engine_equivalence/run.js`).
4. **Single benchmark runs are not evidence.** The fine-rotation Phase 1 note in
   `AGENT_COLLABORATION.md` records this lesson explicitly. Use ≥3 seeds per instance
   for any efficacy claim; use bounded deterministic fixtures for correctness claims.
5. **Claim your work** in the Active Work table before editing, and write Handoff
   Notes after. Tag commits `[<agent>]`.

---

## 3. WP-V4.1 — contact-aware acceptance (the unlock)

**Flag:** `localRefinementContactAcceptance` (default `false`).

**Problem.** `localRefinementSmartMetric` = `localRefinementMetric` +
`5e-4 · localRefinementSpreadTerm`. The primary term is a silhouette measure; the
spread term measures *centre dispersion*, which cannot reward two parts meshing —
and at 5e-4 it only breaks near-exact ties. Acceptance is strict improvement, so the
search stalls at iteration 0 on any densely packed sheet.

**Design.** Add a local-density secondary and make acceptance lexicographic.

### 3.1 Contact score

New helper (suggest `main/util/refinement-contact.js`, loaded in
`main/background.html` and `main/index.html` next to `separation.js`; keep it pure and
unit-testable):

```
contactScore(subjectPolygonWorld, neighbourPolygonsWorld, sheetPolygon, opts)
  -> { length: Number, samples: Number }
```

- Sample the subject's boundary at fixed arc-length `step =
  clamp(curveTolerance, bboxDiag/64, bboxDiag/16)`.
- A sample counts as *in contact* when its distance to any neighbour boundary — or to
  the sheet boundary — is `<= spacing + contactTolerance`, with
  `contactTolerance = max(curveTolerance, 1e-3 · bboxDiag)`.
- Return `count · step` as the contact length.
- Do **not** use Clipper offsets or exact polygon-polygon distance here. This is a
  ranking signal on a plateau, not a legality test; sampled distance is sufficient and
  ~100× cheaper. Point-to-segment distance against the prefiltered neighbour set
  (§4) is the whole implementation.

Rationale: contact length rises exactly when a part nests snugly against its
neighbours, which is the thing the user is asking for and the thing the silhouette
metric cannot see. It is also the natural objective for the slender laurel/branch
parts that motivated this work — meshing two branches raises contact length
enormously while leaving the sheet bbox untouched.

### 3.2 Acceptance rule

Replace strict-improvement comparisons in the smart operators with a single shared
predicate (put it next to `localRefinementImproves` and route **all** operators
through it):

```
accept(primaryBefore, primaryAfter, contactBefore, contactAfter):
  dP = primaryAfter - primaryBefore
  if dP < -epsPrimary:                      return ACCEPT_PRIMARY
  if |dP| <= epsPrimary and
     contactAfter > contactBefore * (1 + epsContact): return ACCEPT_PLATEAU
  return REJECT
```

- `epsPrimary` = `v4AcceptEpsPrimary`, default `1e-6` **relative** to
  `primaryBefore`.
- `epsContact` = `v4AcceptEpsContact`, default `1e-3` relative.
- A primary regression beyond `epsPrimary` is never acceptable. The end-of-stage
  invariant stays: net primary at stage end must be ≤ primary at stage start.
- Contact is computed over the **moved part plus its prefiltered neighbours only**,
  not the whole sheet — it is a local signal and must stay O(neighbours).

### 3.3 Plateau-cycling guard (mandatory)

Plateau accepts can oscillate A→B→A forever and burn the whole budget. Required:

- Maintain a per-stage visited set keyed by
  `(partIndex, round(x/qx), round(y/qy), round(rotation/qr))` with
  `qx = qy = max(curveTolerance, 1e-3·bboxDiag)` and `qr = 0.25°`. Reject any
  candidate whose key was already accepted this stage.
- Cap plateau accepts per stage at `v4MaxPlateauAccepts` (default `placed.length`).
- Count both in stats: `plateauAccepted`, `plateauRejectedRevisit`.

### 3.4 Telemetry

Add to the smart stats block: `contactBefore`, `contactAfter`,
`contactRelativeImprovement`, `plateauAccepted`, `plateauRejectedRevisit`, and add the
additive names to the merge list in `mergeLocalRefinementStats`.

### 3.5 Gate

1. Flag-off equivalence green.
2. Deterministic fixture (`ml/examples/laurel-two-crossed.svg`, the existing 4-part
   job): with the flag on, `operatorStats.rotateReflow.accepted > 0` **or**
   `plateauAccepted > 0` — i.e. a rotation is accepted that the old rule rejected.
3. On albano/blaz1/shapes0 at 3 seeds: no primary regression beyond noise; report
   whether rotation acceptance became non-zero. **This WP is a correctness/behaviour
   unlock, not a utilisation claim** — do not gate it on utilisation, gate that on
   WP-V4.5.
4. `nonCanonicalNfpLookups == 0`.

---

## 4. WP-V4.2 — hot-path throughput (10–40× target)

**Flag:** `v4FastLegality` (default `false`) for the behaviour-changing part (§4.5);
§4.1–§4.4 are pure optimisations that must be output-identical and ship unflagged
once equivalence proves it.

Target function: `localRefinementSinglePlacementLegal`. Current body, per candidate:
loops **all** `placed.length` parts; for each, calls `getOuterNfp`, deep-`clone()`s
the returned NFP purely to translate it, runs `SeparationUtil.penetration`, and then
runs `localRefinementMaterialOverlap` (Clipper intersection + offset erosion). It also
recomputes `shiftPolygon(placed[index], placements[index])` — the *same* polygon —
inside the loop, once per neighbour.

Apply the same treatment to the other legality helpers that share this shape
(`localRefinementFinalLayoutLegal`, `localRefinementFinalLayoutLegalForRotations`, and
the fine-rotation exact gate) once the pattern is proven.

### 4.1 Spatial prefilter

There is **no spatial index anywhere in `main/background.js`** (verified). Add a
uniform grid built once per refinement stage and patched on every accepted move:

- cell size = median part bbox diagonal, floored at `curveTolerance · 10`;
- `cell -> [partIndex]`, plus a cached `worldBounds[i]` array;
- candidate query = cells covered by the candidate's inflated bbox
  (`inflate = spacing + eps`), yielding the neighbour set.

Expect 3–8 neighbours instead of n. On a 100-part sheet this alone is >10×.

### 4.2 Translate the query point, not the NFP

`penetration(q, shift(nfp, placements[j]))` is mathematically identical to
`penetration({x: q.x - placements[j].x, y: q.y - placements[j].y}, nfp)` for a pure
translation. Use the second form against the **unshifted cached NFP**: O(1) instead of
a deep clone plus an O(|nfp|) rewrite per neighbour per candidate.

**Prove it, do not assume it.** Write a unit test in `ml/tests/separation/` that runs
both forms over randomised NFPs (including hole-bearing ones with `children`) and
asserts identical `depth` and `exit` to 1e-12. If `SeparationUtil.penetration` turns
out to consume absolute coordinates anywhere (e.g. in `exit` point construction),
translate the returned `exit` back before use.

### 4.3 Hoist loop invariants

`shiftPolygon(placed[index], placements[index])` moves above the neighbour loop.
Trivial, and it is currently O(n) redundant work per candidate.

### 4.4 Incremental scoring

`localRefinementSmartMetric` → `localRefinementMetric` →
`calculateFitnessV2SheetMetric` → `collectWorldPoints(placed, placements)`, which
materialises **every vertex of every part in world coordinates, per candidate**.

- For `gravity` and `box` the metric depends only on the union bbox of all parts.
  Maintain `worldBounds[i]` (already needed for §4.1) and compute the union from those
  n cached rectangles — O(n) over 4 numbers each, instead of O(total vertices).
- For `convexhull`, precompute each part's own convex hull once per (source, rotation)
  and take the hull of the union of *those* points. Typically an order of magnitude
  fewer input points, same result (the hull of a union of point sets equals the hull of
  the union of their hulls).
- Flag `v4IncrementalScoring`; equivalence test must show bit-identical metric values
  for `gravity`/`box` (to 1e-12) and identical hull area for `convexhull` on a random
  sample of ≥1000 layouts.

### 4.5 Demote the exact Clipper gate (flagged, instrument first)

`localRefinementMaterialOverlap` is a full Clipper boolean per neighbour per
candidate and is the single largest per-candidate cost. It should be a **commit-time**
gate on the winning candidate, not a search-time filter — NFP penetration plus
containment already establishes feasibility, and `localRefinementFinalLayoutLegal*`
remains the backstop.

**This is a safety-relevant change** — the material-overlap backstop exists because
NFP-only legality historically let bad layouts through (see the erosion-predicate
history in `docs/local-refinement-v3-plan.md` §1.9.0 and the NFP normalisation history
in the handoff notes). Therefore:

1. **Instrument first.** Ship a counter that evaluates *both* predicates on every
   candidate and increments `legalityPredicateDisagreements` when they differ, with
   the first few disagreements captured in `attemptDiagnostics`.
2. Run the full smoke battery and a 3-seed benchmark. Only if disagreements are **0**
   may `v4FastLegality` demote the exact check to commit time.
3. If disagreements are non-zero, stop and report — that is a latent correctness bug
   worth its own WP, and it is more valuable than the speedup.

### 4.6 Gate

1. Flag-off equivalence green; §4.1–§4.4 must be output-identical (same
   `placementsDigest` on the frozen scenarios).
2. Throughput: on albano at a fixed 3000 ms budget, `movesTested + legalityRejects`
   ≥ **10×** baseline (baseline 594). Report the achieved factor.
3. `legalityPredicateDisagreements == 0` before enabling `v4FastLegality`.
4. `nonCanonicalNfpLookups == 0`.

---

## 5. WP-V4.3 — coverage that scales, and retire dead operators

**Flag:** `v4ScaledCoverage` (default `false`).

- Target counts in `refineSmartPlacements` are hardcoded (`Math.min(order.length, 6)`
  for relocate, `4` for swap) and `continuousRefinementMaxTargets` defaults to 8.
  Replace with `clamp(ceil(n · v4TargetFraction), v4MinTargets, v4MaxTargets)`;
  suggested defaults `0.25 / 6 / 64`. This only becomes affordable after WP-V4.2.
- **Swap is 0-for-67 across the corpus.** Put it behind `v4EnableSwap` (default
  `false`) and reallocate its budget. Re-measure it *after* WP-V4.1 lands — the
  hypothesis is that swap fails for the same acceptance reason as rotation, in which
  case it may become useful and should be re-enabled on evidence.
- Do not delete the swap implementation; flag it off. It is cheap to keep and its
  operator stats are the evidence channel.

Gate: flag-off equivalence; with the flag on, no wall-clock regression beyond budget
(the deadline discipline must hold — every operator loop already checks `deadline`,
keep it that way).

---

## 6. WP-V4.4 — windowed ruin & recreate (the step change)

**Flag:** `v4WindowedRebuild` (default `false`). **Depends on V4.1 + V4.2.**

`localRefinementTryWholeClusterRebuild` is the operator that produced the 24.88 %
laurel improvement, and it is gated to `placed.length >= 4 && placed.length <= 6`.
Real jobs have 50–200 parts, so **it never fires in production.**

Generalise it from "the whole sheet, if tiny" to "any k-part spatial window":

1. **Seed selection** — rank parts by (a) lowest contact score (§3.1), then (b)
   frontier position from `localRefinementSmartTargetOrder`. Take the worst as seed.
2. **Window** — seed plus its `k-1` nearest neighbours by centroid distance, using the
   §4.1 grid. `k = v4WindowSize`, default 5, clamp [4, 8].
3. **Ruin** — remove the window from the layout (reuse the existing exclusion-list
   machinery, `localRefinementBuildExclusionLists`).
4. **Recreate** — reinsert one part at a time via
   `localRefinementBuildStandaloneFeasibleRegion` over the part's allowlisted
   rotations (`RotationUtil` adaptive angles when enabled, else the canonical grid),
   ranking candidate poses by contact score then primary metric.
5. **Commit** — transactional: snapshot before, accept only if the rebuilt layout is
   exact-legal *and* passes the §3.2 acceptance rule. Restore on any failure or
   deadline expiry. The existing whole-cluster implementation already has this
   structure — copy its transaction discipline exactly.
6. Iterate windows until the stage deadline; never revisit the same window signature
   twice in a stage.

Remove the `placed.length <= 6` restriction as part of this WP. Keep the
rectangular-sheet restriction until someone tests non-rectangular sheets.

Gate (this is the one that must show real numbers):
1. ≥ **1.5 pp** mean median utilisation vs refinement-off at equal wall clock, over
   the ESICUP corpus, ≥3 seeds/instance.
2. ≥ **0.75 pp** vs the current shipped smart engine at equal wall clock.
3. `operatorStats.wholeCluster.accepted > 0` on ≥ 50 % of instances (proves it fires
   on production-size sheets, which is the entire point).
4. Zero shipped illegal layouts — assert with a pairwise-intersection sweep over every
   benchmark output, not just the in-engine gate.
5. `nonCanonicalNfpLookups == 0`.

---

## 7. WP-V4.5 — gating and defaults review

**No flag; this is an investigation that produces either a patch or a written finding.**

1. **`mergeLines` hard-blocks the entire continuous stage**
   (`localRefinementRunContinuousStage` returns `continuousSkipReason: 'mergeLines'`),
   and `mergeLines` defaults to `true`. **Out of the box, the newest and most capable
   refinement never runs at all.** But `recomputeSheetMergedData(placed, placements,
   config)` already runs *after* refinement in the placement worker, so merged length
   is recomputed, not lost. The real requirement is that acceptance must not trade
   away more merge credit than it gains in compaction. Proposal: add a merged-length
   delta term to the acceptance objective when `mergeLines` is on, then relax the
   block. Gate with an A/B on a merge-heavy fixture (`svg-gravity-merge` exists).
2. **`processHoles` disables the stage for the whole sheet if *any* part has
   children.** Make it per-part: skip hole-bearing parts as refinement targets, keep
   refining the rest. A sheet with 2 slotted parts should not disable refinement for
   the other 98.
3. **Defaults decision** is deferred until WP-V4.4 is green, then proposed with
   benchmark evidence, an ML checkpoint, and a bakeoff — per the ML-sensitive
   protocol. Do not flip defaults opportunistically inside an earlier WP.

---

## 8. Work packages, order, claims

| Order | WP | Claim string | Touches | Gate |
|---|---|---|---|---|
| 1 | **WP-V4.1 contact acceptance** | `LRv4-1 contact-aware acceptance` | `main/util/refinement-contact.js` (new), `main/background.js`, `main/background.html`, `main/index.html`, `ml/tests/refinement_contact/` (new) | §3.5 |
| 2 | **WP-V4.2 hot path** | `LRv4-2 legality + scoring throughput` | `main/background.js`, `main/util/separation.js` (test only), `ml/tests/separation/` | §4.6 |
| 3 | WP-V4.3 coverage | `LRv4-3 scaled coverage + swap gating` | `main/background.js`, `main/deepnest.js`, `main/index.html`, `ml/cli/run_benchmark.js` | §5 |
| 4 | **WP-V4.4 windowed rebuild** | `LRv4-4 windowed ruin & recreate` | `main/background.js`, benchmark results | §6 |
| 5 | WP-V4.5 gating review | `LRv4-5 gating + defaults review` | `main/background.js`, `main/util/configcompatibility.js`, `main/index.html`, docs | §7 |

Order is a dependency chain for 1→2→4. WP-V4.3 and WP-V4.5 may be done in parallel by
a second agent **only if** they claim disjoint regions in `AGENT_COLLABORATION.md`;
all of them touch `main/background.js`, so serialise unless coordination is explicit.

Config plumbing for every new flag follows the established path: default in the
`config` object in `main/deepnest.js`, propagation via `copyConfigForWorker`, a UI
control in `main/index.html`, and a CLI flag in `ml/cli/run_benchmark.js` so the A/B
is reproducible.

---

## 9. Verification battery (run for every WP)

```bash
node --check main/background.js && node --check main/deepnest.js
node ml/tests/engine_bugfixes/run.js
node ml/tests/continuous_refinement/run.js
node ml/tests/separation/run.js
node ml/tests/adaptive_rotations/run.js
node ml/tests/nest_geometry_broker/run.js
node ml/tests/engine_equivalence/run.js     # THE flag-off gate
bash ml/scripts/run_boot_check.sh
bash ml/scripts/run_smoke_battery.sh
git diff --check
```

Efficacy runs use `node ml/cli/run_benchmark.js` (see `engineFlags` in any existing
result JSON for the exact shape) with ≥3 seeds. Write results to
`ml/benchmark/results/` following the existing timestamped naming
(`<UTC>-lr-v4-<wp>-<variant>-<budget>.json`); those files stay untracked by
convention.

---

## 10. Traps

1. **Never let an off-grid angle reach `getOuterNfp`/`getInnerNfp`.** The Phase 0
   guard fails closed and counts `nonCanonicalNfpLookups`; a non-zero value in any
   result JSON is an automatic stop-and-diagnose, not a warning.
2. **Plateau acceptance without a visited set will cycle** and consume the entire
   budget doing nothing. §3.3 is mandatory, not optional.
3. **Contact score must be computed identically before and after** a candidate move
   (same sample step, same neighbour set), or plateau comparisons are meaningless.
   Derive the step from the *subject part*, never from the layout.
4. **`ContinuousRefinement.improves()` already applies its own relative tolerance
   (1e-4).** Do not stack the §3.2 epsilons on top of it; route the continuous stage
   through one rule or the other, explicitly.
5. **Known upstream hazard, do not make it worse:** both NFP producers
   (`tryNativeOuterNfp`, `buildClipperNfpFromMinkowskiSolution`) reduce a
   multi-polygon result to the single largest-area ring and discard the rest, then
   persist it via `window.db.insert` with no validation and no cache schema version.
   If you see unexplained overlap during this work, suspect a cached NFP before you
   suspect your operator, and clear the cache
   (`~/Library/Application Support/Deepnest ML/`) as a first diagnostic.
6. **Line numbers in this document are already stale.** Grep by function name.
7. **`main/index.html` is 6363 lines and holds the renderer, the Ractive templates,
   and the teacher automation hook.** Edits there are ML-sensitive.
8. **Do not claim efficacy from a single stochastic run.** This mistake is recorded
   twice in the handoff notes.

---

## 11. What "done" looks like

The user's acceptance test is not a benchmark number, it is a screenshot: a dense
sheet of slender parts (the laurel-branch job) where parts visibly sit at angles that
mesh with their neighbours instead of fanning. WP-V4.1 makes such a layout
*acceptable* to the engine; WP-V4.2 makes it *findable*; WP-V4.4 makes it *reachable*
from a bad starting layout. Ship the visual fixture alongside the numbers.

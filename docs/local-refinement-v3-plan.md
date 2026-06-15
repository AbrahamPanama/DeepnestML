# Local Refinement v3 ("smart" engine) — Implementation Plan

Status: PLAN — approved direction. WP-R0 foundation implemented 2026-06-11
(`SeparationUtil`, deterministic engine-equivalence harness, and flagged
`shrinkSeparate` Local Refinement engine). A bounded ESICUP efficacy check on
2026-06-11 showed `shrinkSeparate` ran but accepted 0 moves on 3/3 tested
instances. DIAGNOSED same day: plan defect in WP-2.2 (containment against the
original sheet lets the separator undo the squeeze). §1.5 **WP-R0.1** virtual
sheet containment was implemented same day; its gate "passed" only via hollow
eps-scale accepts (alphaMin 1e-6) — superseded. Second diagnosis round proved the
stochastic separator cannot find contact-exact pockets (0/20 on a restack toy for
both argmax and sweep GLS) while sweep + exact NFP-region relocation solves it
20/20. §1.6 **WP-R0.2** (exact-relocation separation + substantive gate) was
implemented on 2026-06-11, but the bounded ESICUP substantive gate did **not**
pass — diagnosed: the global squeeze creates O(n) simultaneous overlaps and
zero-overlap relocation deadlocks on them. §1.7 **WP-R0.3** (clamp warm start +
Umetani min-overlap axis translations; 20/20 on the restack toy in 3.8 mean
sweeps) was implemented on 2026-06-11, but the bounded ESICUP substantive gate
still did **not** pass. The reorder of §1.8 was approved; Codex landed a minimal
'smart' relocate/swap engine whose gate failure exposed the final blocker: the
legality AREA gate rejects legal exact-contact candidates (dimensional mismatch +
Clipper quantization). **Current next WP: §1.9 WP-S1 "settle pass"** — fix the
legality predicate (erosion test, §1.9.0), then floater detection + rotation
alignment + gravity relocation, gated substantively and visually on the user's
floating-parts job. WP-R1 chain targeting follows S1.
Author: Claude-Code, 2026-06-11.
Audience: an implementing AI agent with no prior context. Read
`docs/sota-nesting-implementation-plan.md` (the "SOTA plan") FIRST — this document
**extends its Phase 2 and supersedes its WP-2.3** (blind ±degree rotation probes are
replaced by geometry-derived rotations and richer move operators). All Ground Rules
(§0), geometry conventions (§1.5), config plumbing (§1.6), verification battery
(§8), and traps (§9) of the SOTA plan apply verbatim here and are not repeated.

Goal: replace the slide-based Local Refinement with a budgeted, multi-operator
refinement engine that **moves and rotates parts intelligently**: shrink–separate
translations, contact-derived rotations, void relocation, pairwise swaps, and
ruin-&-recreate — all NFP-validated, all behind a default-off flag.

Why the current engine cannot be tuned into this (context for reviewers): the slide
engine (`refineLocalPlacements`, `main/background.js:1442` area) hill-climbs a
landscape that is flat except where blocked — in a contact-packed layout max-slides
are ~0 in useful directions, so no improving single-slide exists (observed
`movesTested: 6, movesAccepted: 0`). v3 changes the *move space*, not the tuning.

---

## 0. Scope, flags, and compatibility contract

- New engine value: `localRefinementEngine: 'smart'` (existing values `'slide'`
  default and `'shrinkSeparate'` from SOTA WP-2.2 remain). The `localRefinement`
  on/off toggle, the post-process dispatch (`main/deepnest.js:119` area), the badge,
  and the stats object contract are unchanged. New stats fields are ADDITIVE only.
- Supported placement types: `gravity`, `box`, AND — amended 2026-06-11 —
  **`convexhull` for the settle/relocate/swap operators** (the shrink-separate
  operator remains gravity/box only). Rationale: convexhull is the mode that
  PRODUCES floaters (any position inside the current hull ties on hull area, so
  late parts are dropped at arbitrary interior spots — reproduced empirically:
  7/12 comb parts stranded at 200–400 units nearest-neighbor distance vs 62 for
  packed pairs, mixed grid rotations, matching the user's laurel image). The
  settle metric under convexhull is the fitness-v2 hull metric — floater capture
  shrinks the hull directly. `steprepeat` is untouched (routes away before
  refinement, as today).
- Config keys introduced (register in SOTA plan §8.1 when landing):

| Key | Type | Default | Notes |
|---|---|---|---|
| `localRefinementEngine: 'smart'` | enum value | — ('slide' stays default) | Settings select gains the option |
| `localRefinementBudgetMs` | number | 1500 (existing) | smart engine honors the same budget |
| `localRefinementRotations` | bool | false (existing) | gates the rotation operator inside 'smart' |
| `localRefinementMaxColdAnglesPerPart` | number | 3 | cold-NFP-cache rotation probes cap, per part per pass |

- Every WP lands behind these flags; `'slide'` must stay byte-identical
  (equivalence gate, SOTA §8.3 — the engine-equivalence harness is a **prerequisite**,
  see WP-R0).
- ML-sensitivity: refinement runs only in the post-process payload and never mutates
  GA fitness, so teacher comparability is unaffected while defaults hold. Checkpoint
  is required only when the default engine flips (end of WP-R6).

## 1. Prerequisites (WP-R0)

1. **SOTA WP-2.1 `SeparationUtil`** (`main/util/separation.js`) implemented exactly
   as specified in SOTA plan §5, including its unit tests. v3 consumes
   `penetration`, `containmentViolation`, `separate`, and `mulberry32`.
2. **SOTA §8.3 engine-equivalence harness** (`ml/tests/engine_equivalence/run.js`,
   golden placement digests over the smoke battery) — flagged as missing in the
   2026-06-11 review note; must exist before any v3 WP merges.
3. **SOTA WP-2.2 shrink–separate loop** implemented as specified (engine value
   `'shrinkSeparate'`). v3's orchestrator (WP-R6) calls the same squeeze+separate
   primitive; do not fork its code — extract `shrinkSeparateOnce(...)` so both
   engines share it.

## 1.5 WP-R0.1 (REQUIRED before WP-R1) — shrink-separate virtual-sheet fix + instrumentation

**Root cause of the 2026-06-11 zero-accepts efficacy result (diagnosed and proven
empirically the same day):** the WP-2.2 spec validated containment against the
ORIGINAL sheet, so the separator was free to resolve squeeze overlaps by pushing
parts back (or scattering them) — it has no compaction pressure of its own. A/B
experiment with the real `SeparationUtil` (3 packed squares, 5% squeeze, 20 seeds):
original-sheet containment → mean resulting width 42.4 vs starting 30 (worse;
improvement only by luck); virtually-shrunk containment → 17/20 feasible and every
feasible result improved by construction (mean width 25.0). The literature shrinks
the **container**, not just the positions. This was a plan defect, not an
implementation defect. Fix as follows (all inside `main/background.js`; the
separation module is unchanged):

1. **Virtual extent boundary.** Per shrink attempt on axis x (y symmetric for box):
   - `worldMaxX = max over parts i of (maxVertexX(placed[i]) + placements[i].x)`
   - `extentW = worldMaxX − sheetBounds.x`; `delta = alpha * extentW`
   - `virtualBoundary = worldMaxX − delta`
2. **Per-part q-limit.** The constraint "part i's max world x ≤ virtualBoundary"
   in reference-point space is:
   - `qLimit_i = virtualBoundary − (maxVertexX(placed[i]) − placed[i][0].x)`
3. **Clipped IFP provider.** During separation, `ctx.ifp(i)` returns the REAL IFP
   rings intersected (ClipperLib, `ctIntersection`, the same scale conventions as
   the rest of the engine) with the half-plane rectangle
   `[ifpBounds.x − 1, qLimit_i] × [ifpBounds.y − 1, ifpBounds.y + ifpBounds.height + 1]`.
   Memoize per `(source, rotation, roundedCoordinate(qLimit_i))`. If the clip
   result is empty, the part cannot fit the virtual extent — return null so
   `separate` fails closed and the attempt is rejected (alpha halves).
4. **Clipped sheetBounds.** `ctx.sheetBounds.width` is reduced so its right edge is
   `max over i of qLimit_i` (candidate prefilter only; exactness comes from the
   clipped IFPs).
5. **Keep the position squeeze** as the warm start (parts pre-moved toward the
   target so separation starts near-feasible). Use `alpha = 0.005`,
   `alphaMin = 0.0005`, `alphaMax = 0.02` in the current R0.2+ implementation.
   Historical note: WP-R0.1 briefly tried `alphaMin = 0.000001`; the resulting
   accepts were eps-scale and are superseded by the substantive R0.2 gate. Keep the
   strict metric-improvement acceptance (with the virtual boundary it should now
   hold automatically whenever `separate` returns feasible — treat a
   feasible-but-not-improved result as a bug signal and count it).
6. **Final legality gate unchanged** — it validates against the REAL sheet
   (virtual is strictly tighter, so virtual-feasible ⇒ real-legal).
7. **Instrumentation (additive stats, required):** per engine run record
   `attemptsFeasible`, `attemptsInfeasible`, `deadlineHits` (separate returned
   infeasible due to deadline), and `feasibleNotImproved`. These distinguish
   "mechanism broken" from "budget too small" in every future efficacy run.
   Heavy per-attempt residual diagnostics (`attemptDiagnostics` with pair/sheet
   residual classification) must be opt-in via `localRefinementDiagnostics === true`;
   they are useful for diagnosis but too expensive for the 1500 ms gate budget.
8. **Performance fallback (apply only if instrumentation shows deadlineHits
   dominate for n ≥ 20):** incremental violation tracking — maintain the pair
   depth matrix and per-part costs; after an accepted move of part t, recompute
   only pairs involving t; full recompute every 25 iterations as a drift guard.
   This drops the per-iteration cost from O(n²) NFP point-tests to O(n).

**WP-R0.1 gate (SUPERSEDED — see WP-R0.2):** the original gate (`shrinkSteps ≥ 1`,
`movesAccepted > 0` on ≥ 2/3 instances, `feasibleNotImproved = 0`) was passed on
2026-06-11 **on a technicality**: with `alphaMin = 1e-6`, squeezes shrink below the
separator's `eps` and become trivially feasible, producing accepted steps whose
metric improvement is ~1e-6 relative or below measurement precision (observed:
blaz1 accept with `scoreBefore === scoreAfter` to 16 digits; shapes0 accept worth
0.00013%). A gate that counts accepts without measuring their size is Goodhart-able
and got Goodharted. WP-R0.2 below replaces both the separation mechanism and the
gate.

## 1.6 WP-R0.2 (REQUIRED before WP-R1) — exact-relocation separation + substantive gate

**Diagnosis chain (2026-06-11, all empirical, harnesses in the session log):**
1. Virtual sheet fixed the "separator undoes the squeeze" defect (WP-R0.1) — but
   meaningful squeezes (alpha 0.005…0.0005) remained infeasible on all bounded
   instances (13 consecutive infeasible attempts each, `deadlineHits = 0`, so not
   a budget problem).
2. Restack-required toy (12 squares, two full rows, 1% squeeze, third row free):
   current argmax-target GLS separator: **0/20 feasible**, dying at ~58 iterations
   because the argmax part is re-selected every iteration until `strikes > n` kills
   the attempt.
3. Umetani-style randomized-sweep GLS (each violating part visited once per sweep):
   **also 0/20**. Root cause is deeper than target selection: in packed layouts the
   legal pockets are contact-exact (near measure-zero) — e.g. the toy's only legal
   restack position is exactly `qy = 20.0`. Stochastic candidates (gaussian /
   uniform / exit nudges) essentially never land there, and greedy per-part descent
   rejects the cost-increasing intermediate states needed to reach them.
4. Hybrid — sweep order + cheap nudges + **exact feasible-region relocation** for
   parts the nudges cannot fix: **20/20 feasible**, widths ≤ the virtual boundary
   by construction. NFP region math surfaces contact-exact pockets analytically;
   no luck required.

**Specification (all in `main/background.js`; `SeparationUtil` keeps its current
API and tests — the GLS `separate` remains available, but the refinement engine
stops relying on it as the sole mechanism):**

1. New `separateBySweep(providers, opts)` in `main/background.js`, used by
   `refineByShrinkSeparate` in place of (or wrapping) the pure-GLS call:
   - Compute the violating set: part i violates iff any pairwise
     `SeparationUtil.penetration(q_i, nfp(i,j)).depth > eps` or
     `containmentViolation(q_i, clippedIfp(i))` is outside by > eps.
   - Sweep the violating parts in seeded-random order (mulberry32; same seeding
     rule as the engine). Per part:
     a. **Cheap nudges first:** exit-point candidates from each violating pair
        (+2ε nudge, as today) plus short axis slides (±0.5/±1.0 × max pair depth);
        accept the first candidate with zero residual violation (not merely lower
        cost).
     b. **Exact relocation if unresolved:** `buildFeasibleRegion` (the WP-R3 §4
        helper, pulled forward to this WP; parameterize its IFP input so the
        CLIPPED IFP flows through) against all other parts at their CURRENT
        positions. Move the part to the **nearest** region point (all region ring
        vertices, plus the projection of q onto each region edge) — nearest, not
        best-scoring: least disruption. Count in new stat `exactRelocations`.
     c. **Empty region ⇒ attempt infeasible. Fail fast** — return immediately
        (no multi-attempt grind; alpha will halve).
   - Convergence property (why no GLS weights are needed here): relocation into
     the exact feasible region introduces zero new overlaps, so each sweep
     strictly shrinks the violating set; terminate feasible when empty, infeasible
     on the first empty region or deadline. Cap: 5 sweeps.
   - Budget: check the deadline before every region computation; expected cost is
     small — nudges resolve the many tiny squeeze overlaps, exact relocations are
     expected only for the few boundary-pinned parts (record the count and prove
     this with the instrumentation).
2. **Restore `alphaMin = 0.0005`.** Micro-alphas below that produce only hollow
   accepts and waste budget. (The 1e-6 floor is explicitly reverted.)
3. **Substantive gate (replaces the WP-R0.1 gate):** bounded probe (albano, blaz1,
   shapes0; 10 s construction, 1500 ms refinement budget):
   - cumulative relative metric improvement `(scoreBefore − scoreAfter) /
     scoreBefore ≥ 0.5%` on ≥ 2 of 3 instances, AND
   - accepted steps with relative improvement < 1e-6 do not count toward anything,
     AND `feasibleNotImproved = 0`, AND zero legality reverts.
   Then the full WP-2.2 corpus gate (refinement on vs off, frozen 240 s corpus,
   gates: accepted on ≥ 70% of instances, mean ≥ +1.5 pp) before claiming WP-R1.

**Implementation result (2026-06-11, Codex):** the R0.2 sweep + exact-relocation
machinery was implemented in `main/background.js` and `alphaMin` was restored to
`0.0005`. The bounded ESICUP gate still failed: no tested instance reached the
required ≥0.5% relative metric improvement, and alternate probes with deferred
empty-region handling and 20 sweeps also failed. Exact relocations occurred on
some runs, but the current feasible-region strategy did not reliably converge to
a legal improved layout. WP-R1 remains blocked; do not build smart operators on
this foundation until the separator passes a substantive gate.

## 1.7 WP-R0.3 (REQUIRED before WP-R1) — clamp warm start + min-overlap axis translations

**Why WP-R0.2 failed on real layouts (diagnosed 2026-06-11, after its honest gate
failure):** two compounding design errors in this plan, not in the implementation.
(1) The **global proportional squeeze** displaces every part and creates O(n)
simultaneous overlaps — the hardest possible separation problem; the literature
shrinks the container and only the parts now sticking out get pulled in, so
overlaps are localized at the boundary. (2) **Zero-overlap-or-fail relocation**
treats all other parts as fixed; on dense layouts no pocket exists until several
parts shuffle cooperatively, which requires intermediate states that retain
overlap. Empirical ledger on the restack toy (n=12, free third row, virtual
boundary): argmax GLS 0/20; sweep GLS 0/20; zero-overlap exact relocation 20/20 on
the toy but deadlocks on real layouts (empty regions — exactly what the WP-R0.2
gate run showed); **clamp + min-overlap axis translation + GLS weights: 20/20 in a
mean of 3.8 sweeps.** The winning mechanism is Umetani et al.'s published
separation move, proven on the same ESICUP instances used by our gate.

**Specification (modifies the WP-R0.2 `separateBySweep`; keep its stats):**

1. **Clamp warm start (replaces the squeeze).** After computing `virtualBoundary`
   and `qLimit_i` (§1.5), move ONLY parts with `q_i.x > qLimit_i`, setting
   `q_i.x = qLimit_i`. All other parts keep their positions. (Box-mode y-pass
   symmetric.) Overlaps are now localized near the shrunk boundary.
2. **Primary move: min-overlap axis translation (Umetani).** Per violating part
   `i`, per axis (x then y, order randomized per visit via the seeded rng):
   - Candidate scalar positions for `q_i.axis` = **NFP breakpoints**: for each
     neighbor j, intersect the axis-aligned line through `q_i` with every edge of
     the (shifted) `nfp(i,j)` outer ring and children rings; emit each crossing
     coordinate ± 2ε. Add the clipped-IFP axis extremes and the current position.
     Cap 64 candidates per part-axis (subsample evenly if above; always keep the
     current position and IFP extremes).
   - New pure helper `SeparationUtil.axisBreakpoints(q, axis, ring) -> [scalar]`
     (segment/line crossing math only; unit-test with a square ring: line through
     its interior yields both edge crossings).
   - Evaluate `cost(q') = Σ_j w[i][j]·penetration(q', nfp(i,j)).depth +
     2.0·containmentViolation(q', clippedIfp(i)).depth` at each candidate; move to
     the strict argmin if `< current − 1e-12`. **Residual overlap is allowed** —
     feasibility is only judged globally (all depths ≤ ε).
3. **GLS weights on stuck sweeps.** If a full sweep over the violating set applies
   no move: `w[i][j] += depth_ij / maxDepth` for all violating pairs, continue.
   Sweep cap 60 within the deadline.
4. **Exact-region relocation demoted to fallback.** Fire `buildFeasibleRegion`
   relocation only for a part still violating after 3 stuck-reweight cycles; an
   empty region is no longer fatal — skip and continue (keep `exactRelocations`
   and `emptyRegionHits` stats).
5. Everything else unchanged: alpha schedule (`alphaMin = 0.0005`), strict metric
   acceptance, real-sheet final legality gate, deadline checks before every part
   visit, and the **substantive gate of §1.6** (≥ 0.5% relative improvement on
   ≥ 2/3 bounded instances; eps-scale accepts don't count; then the full WP-2.2
   corpus gate before WP-R1).
6. Cost note for the implementer: candidate evaluation is O(n) point queries ×
   ≤ 64 candidates × 2 axes per part visit; the clamp keeps the violating set
   small (boundary-localized), so sweeps are cheap — instrument and confirm via
   `movesTested`/`deadlineHits`.

**Implementation result (2026-06-11, Codex):** R0.3 landed in
`main/background.js` with `SeparationUtil.axisBreakpoints`, clamp warm starts,
weighted min-overlap axis moves, GLS reweighting, exact-region fallback,
curve-tolerance clearance for breakpoint candidates, final-legality acceptance
checks, one-shot empty fallback caching, and axis-line/NFP-bound prefiltering.
The final bounded run
`ml/benchmark/results/20260611T204037Z-lr-r0.3-prefilter-10s.json` failed the
§1.6 substantive gate: `albano` timed out in the first attempt, `blaz1` found one
separator-feasible attempt but it was rejected by the final legality backstop, and
`shapes0` remained infeasible with empty fallback regions. Earlier diagnostic
runs showed `albano` can improve substantially in some random nests, but the gate
is not robust. Do not proceed to WP-R1 until R0.3 or its successor passes the
bounded gate without legality rejects or deadline masking.

## 1.8 WP-R0.4 — separation correctness + cost fixes, AND a strategic reorder

**R0.3 gate autopsy (2026-06-11, from the instrumented run
`20260611T204037Z-lr-r0.3-prefilter-10s.json`):** three distinct failure modes.

- **blaz1 — tolerance dimensional mismatch (spec error, fix required):** the
  separator accepts residual penetration depth ≤ ε = 1e-4·curveTolerance
  (≈ 7.2e-5), but the legality gate bounds Clipper intersection AREA by
  (1e-3·curveTolerance)² ≈ 5e-7. A sub-ε sliver of depth d along contact length L
  has area ≈ d·L — at d = 5e-5, L = 50 that is 2.5e-3, four orders of magnitude
  over the gate. Depth and area×length were never consistent. **Fix: contact
  polish pass** — after `separate`/sweep reports feasible and BEFORE metric
  acceptance, loop ≤ 3 times: for every pair with 0 < depth ≤ ε, translate the
  part with the smaller bboxDiag along the penetration exit vector by
  (depth + 2e-9); finish only when no pair has depth > 0. If polish cannot reach
  zero residual, treat the attempt as infeasible. Count `polishMoves`.
- **albano — per-visit cost cliff on curved parts (fix required):**
  `movesTested: 1`, `deadlineHits: 1` — ONE part-visit consumed the whole budget.
  Curved instances produce NFP rings with hundreds of vertices; 64 candidates ×
  n neighbors × O(ring) point tests explodes. **Fixes:** (a) for separation
  queries only, decimate each provider NFP/IFP ring with the existing
  simplification machinery to curveTolerance resolution, used for breakpoints and
  cost evaluation (the final legality gate keeps full-resolution rings — the
  polish pass above absorbs the decimation error, and decimated-NFP feasibility
  must be followed by the full legality gate as today); cache decimated rings
  alongside the provider memos. (b) bbox-prefilter the neighbor set per cost
  evaluation (skip j whose shifted-NFP bbox cannot contain any candidate).
- **shapes0 — genuinely hard local density:** empty fallback regions at a packed
  boundary are correct behavior; alpha-halving gives up as designed. No action.

**Strategic reorder (approved by user on 2026-06-11):** four diagnosis rounds
have gone into the shrink-separate backbone; its remaining gains at a 1500 ms
budget are uncertain even once correct, because the literature spends seconds-to-
minutes in this loop, not 2.5% of a GA run. Meanwhile `buildFeasibleRegion` — the
hardest shared primitive — is implemented and battle-tested. Therefore:

1. **Promote the legal-to-legal operators (old WP-R3: void relocation + swaps) to
   the next work package.** They need no separation convergence at all: relocate
   moves one part into an existing void of the CURRENT legal layout (greedy
   construction layouts have voids by nature), accepts on strict metric
   improvement, and is budget-friendly (one region computation per candidate
   part). Gate them with the §1.6 substantive criteria — they are the likeliest
   path to the first real green gate.
2. **Re-scope shrink-separate as an optional polish operator** inside 'smart',
   gated to larger budgets (`localRefinementBudgetMs ≥ 5000`, post-process on the
   best nest only, where a few seconds is acceptable UX) and as a core loop of
   the future `deepsearch` placement type (60 s budgets — its natural habitat).
3. WP-R1 (contact graph / critical chain) then serves the relocation/swap
   operators first (choosing WHICH part to relocate), which is also where its
   value is highest.

**Promoted WP-R3 implementation result (2026-06-11, Codex):** a minimal opt-in
`localRefinementEngine: 'smart'` path now runs legal-to-legal void relocation and
position swaps. It adds a standalone feasible-region builder, region candidate
sampling with small clearance offsets, relocate/swap operator stats, and final
legality checks before every acceptance. Default `slide` behavior remains guarded
by the equivalence harness. The bounded probe still failed the substantive gate:
`ml/benchmark/results/20260611T214700Z-lr-r3-smart-offset-candidates-10s.json`
had 0 accepted moves on `albano`, `blaz1`, and `shapes0`. The useful new signal is
that `blaz1`/`shapes0` produced many legality rejects from feasible-region boundary
candidates, suggesting the next fix should classify Clipper difference output
into true allowable regions/interior samples instead of sampling every returned
path boundary equally.

## 1.9 WP-S1 — the SETTLE PASS (approved by user 2026-06-11; the next work package)

User-approved direction, motivated by a real production nest: a dense interlocked
cluster plus several "floating" parts stranded at arbitrary rotations with large
whitespace. The settle pass gives physics semantics ("shake the loose parts into
the pack") implemented with exact NFP geometry: floaters are detected, rotation-
aligned, and teleported into the best legal pockets of the existing cluster —
including interdigitated pockets that physical sliding could never reach.

### 1.9.0 FIRST: fix the legality predicate (blocks every tier, including this one)

The Codex 'smart' relocation result (§1.8 note) showed many legality rejects from
feasible-region BOUNDARY candidates. Diagnosis: boundary candidates are exact-
contact positions; the Clipper round-trip quantizes coordinates (~1/clipperScale),
so two parts in legal edge contact of length L show intersection area ≈ L·δ — for
L = 50 that exceeds the current area gate ((1e-3·curveTolerance)² ≈ 5e-7) by an
order of magnitude. **Area alone cannot distinguish a long thin legal contact
sliver from a small real overlap.** Replace the area test everywhere (final
legality gate, settle acceptance, R0.4 polish acceptance) with a width-consistent
**erosion predicate**:

```
materialOverlap(A, B, config):
  I = ClipperLib intersection of A, B at clipperScale (outer rings;
      hole-bearing pair handling unchanged from today)
  if I empty -> false
  E = ClipperOffset(I, -0.5 * EPS_DEPTH * clipperScale)   // EPS_DEPTH = max(1e-9, 1e-4·curveTolerance)
  return E non-empty                                       // sliver thinner than EPS vanishes
```

Unit-test it in `ml/tests/separation/run.js`-style Node tests: (a) two squares in
exact edge contact, then offset into each other by 0.4·EPS — no material overlap;
(b) overlapped by 3·EPS — material. This single change is expected to convert
many of the existing "legality rejects" into accepts across BOTH the relocation
tier and the shrink-separate tier; re-run the R3 bounded probe immediately after
landing it, before building anything else.

### 1.9.1 Settle additions to the 'smart' engine (extends the landed relocate/swap path)

1. **Floater detection.** Part i is a floater iff it has zero part-to-part
   contacts: for all j, `distToRingBoundary(q_i, shifted nfp(i,j))` (outer and
   children rings) `> CONTACT_EPS = max(4·EPS_DEPTH, 0.05·curveTolerance)` and
   `penetration(q_i, nfp(i,j)).inside === false`. Sheet contact does not rescue a
   part from floater status. If every part is a floater (sparse layout), the part
   with min world x along the gravity axis seeds the cluster and the rest are
   floaters. Stats: `floatersDetected`.
2. **Settle order.** Floaters descending by distance of their world bbox center
   from the non-floater cluster's bbox center (ties by part index). Cap: at most
   8 floaters settled per pass (`settleMaxFloaters`, hidden config, default 8).
3. **Rotation alignment (grid rotations only — warm cache, respects job
   constraints).** Candidate rotations for a floater: its current rotation first,
   then the other `k·(360/config.rotations)` grid values ordered by ascending
   angular distance to the DOMINANT cluster rotation (mode of
   `placements[].rotation` over non-floaters). Cap 4 rotations tried per floater.
   Gated by `localRefinementRotations` (when false: current rotation only).
   No arbitrary angles in this WP.
4. **Settle move.** Per floater, per candidate rotation: rotated-copy pattern;
   `buildFeasibleRegion` against `placed \ {f}` with the REAL sheet IFP (no
   virtual clipping — settle never shrinks anything, and therefore also does NOT
   require the rectangle-sheet guard: any sheet with an IFP works). Candidates =
   region ring vertices (+ WP-1.2 edge samples when `candidateEdgeSampling` on),
   scored with the construction gravity/box rect-bounds metric over the full
   layout. Accept the best candidate iff the fitness-v2 sheetMetric strictly
   improves; legality via the NEW erosion predicate plus IFP containment. On
   accept, update `placed[f]` (rotated copy with `.rotation` bookkeeping per the
   §3 trap) and `placements[f]` together. Stats: `floatersRelocated`,
   `settleRegionComputations`, `settleEmptyRegions`, `rotationsTried`.
5. **Budget.** Deadline check before every region computation. Recommended
   default `localRefinementBudgetMs` for the 'smart' engine: 3000 (post-process
   on best nests only; document in the explain card). Region cost ≈ one
   construction placement of one part — 8 floaters × ≤4 rotations is bounded by
   ~32 placements' worth of work.
6. **Annealed relax (WP-S2, AFTER S1 gates green; flag `localRefinementAnneal`,
   default false).** The "shaking": a short Metropolis pass over all parts using
   the §1.7 axis-translation move set, temperature decaying linearly to zero over
   the remaining budget, accepting occasional worsening moves, always returning
   the best-ever snapshot. Spec details deferred until S1 is green.

### 1.9.2 Gate (substantive — REVISED 2026-06-11 after fixture findings)

The ESICUP gravity probe is the WRONG fixture for settle: gravity/box construction
candidates are NFP-boundary positions, always in contact with a part or the sheet
edge, so `floatersDetected = 0` there is CORRECT behavior, not a failure (verified:
all three instances + a synthetic comb fixture under box mode produced zero
floaters and a correctly-null settle result). The gate fixture is therefore:

1. **`ml/smoke/scenarios/svg-hull-settle-floaters.json`** (committed) — the
   synthetic comb fixture `ml/examples/comb-branches.svg` under `convexhull`
   construction, which reproducibly strands ~7/12 parts. Gate:
   `floatersDetected ≥ 4`, `floatersRelocated ≥ 3`, relative hull-metric
   improvement ≥ 5%, zero shipped-illegal layouts (erosion predicate + IFP).
2. **ESICUP bounded probe as non-regression only**: settle must no-op cleanly
   (`floatersDetected = 0`, no metric change, no crash, budget respected).
3. **User-visual acceptance on the real laurel-branch job — fixture COMMITTED
   2026-06-11**: `ml/examples/laurel-branches.svg` (8 copies of the user's two
   mirrored branch paths + 12in sheet, built from the user-provided original) and
   `ml/smoke/scenarios/svg-laurel-settle.json`. Probe verified end-to-end: the
   nest completes in the harness (~120 s budget) and convexhull construction
   strands ALL 8 branches (nearest-neighbor 150–487 units vs ~50 in the user's
   interlocked export). The smart engine currently no-ops there with
   `reason: 'unsupportedPlacementType'` — landing convexhull support flips this
   fixture into the live visual gate. Gate: `floatersDetected ≥ 4`,
   `floatersRelocated ≥ 3`, hull-metric improvement ≥ 5%, and the export must
   visibly show branches pulled into an interlocked cluster.
   Harness constraints baked into the scenario (do not "fix" them): the legacy
   x64 smoke runtime has no native NFP addon, so the serrated branch geometry is
   slow on the JS fallback — the scenario pins `rotations: 1` (matches the
   user's real export: every placement is rotate(0)) and `curveTolerance: 2`,
   8 parts, `timeBudgetSec: 120`. Identical coincident copies in a fixture SVG
   collapse into ONE part at import (polygon-tree containment) — copies must be
   spatially offset, which the committed fixture does via per-path translate
   transforms.

Implementation fixes required to pass efficiently (found reviewing the landed S1
code): (a) candidate offsets must be INWARD-only or boundary-exact — the current
±4-direction clearance offsets (≈ 20× ε) make ~2/5 of candidates systematically
illegal, each burning a full legality check (observed: 73 rejects in one probe);
(b) per-candidate legality must validate the MOVED PART ONLY (O(n): its
penetrations, containment, and materialOverlap against others) — the full
O(n²) layout gate runs once on final acceptance, not per candidate (observed:
2 deadlineHits from per-candidate full-layout checks).

**Implementation result (2026-06-11, Codex):** §1.9.0 and §1.9.1 are implemented
behind the opt-in `smart` engine. `SeparationUtil.materialOverlap` now uses the
erosion predicate and is covered by exact-contact / sub-eps / multi-eps square
tests. The smart engine now detects floaters, orders them by distance from the
cluster, tries current/grid rotations, and settles via the standalone feasible-
region builder with final erosion-predicate legality. Final bounded ESICUP run:
`ml/benchmark/results/20260611T232202Z-lr-s1-settle-rounded-3000ms-10s.json`.
Result: gate still failed with 0 accepted moves; all three ESICUP instances
reported `floatersDetected = 0`, so the settle operator did not fire there. The
visual laurel/floating-parts fixture was not present in the workspace or attached
files, so the user-visual acceptance lane could not be run yet. Next diagnosis
needs that real layout, or a committed synthetic floater fixture, to validate S1.

### 1.9.3 Optional validation lane — literal physics A/B

To settle the physics question with data: feed the SAME laurel layout to
`experiments/physics-nest` (glue script under `experiments/physics-nest/`, never
in the engine): export current placements as the experiment's SVG input, run its
gravity-jostle best-of, measure utilization delta vs the settle pass on the same
layout. Prediction recorded here: physics gets floaters touching the cluster
boundary; settle gets them interdigitated into it. Whatever the data says wins
the argument for future operator priorities. (Known: the experiment CLI has
parser limitations — no `transform` attributes, compact arc flags crash — keep
inputs plain. See the 2026-06-10 bug-hunt notes.)

### 1.9.4 S1 implementation status (Claude-Code, 2026-06-11)

Landed (all flag-gated; equivalence + boot + full battery green):
- convexhull support in the smart engine (guard + hull metric).
- Inward-only region candidates (boundary-exact + one centroid-ward nudge).
- O(n) moved-part legality per candidate (`localRefinementSinglePlacementLegal`);
  full-layout gate still runs once at engine exit.
- Composite acceptance metric (`localRefinementSmartMetric` = mode metric +
  5e-4 × normalized center-spread) so plateau states can be crossed; stats
  report the PURE metric.
- Hull-contribution + spread-outlier floater detection (contact alone is too
  strict: parts touching at a single tip still waste hull).
- **Group settle (ruin & recreate)**: single-part relocation was PROVEN
  insufficient on the laurel fixture (390 legal candidates, best delta exactly 0
  — the jammed-spread plateau), so floaters are now removed as a group and
  re-placed sequentially against the growing cluster, with full-rebuild
  escalation around a single seed when floater-only recreation cannot improve.
  Whole-group accept-or-restore.
- Diagnostics: `settleLegalCandidates`, `settleBestDelta`, `settleDebug` (first
  6 candidate evaluations), all additive.

Gate status: **machinery verified end-to-end; capture not yet demonstrated.**
Two measurement corrections matter for whoever continues:
1. Translate-delta "stranding" readings are INVALID on multi-copy fixtures (the
   import bakes per-copy grid transforms into local coords). Measure true world
   positions by adding each part group's translate to its path coordinates.
2. With valid measurement, construction often packs the fixtures well (two
   interlocked stacks on the 8-part laurel roll; tight comb pack) — the engine's
   zero-accept results there are CORRECT nulls. The 12-part laurel roll produced
   the real phenotype (6-stack + 4-stack + 1 stray + 1 unplaceable), and the
   stray was genuinely jammed at rotation 0: no reachable pocket beat the
   current hull.
3. The user's real strays exist because their 10-stack hit the sheet edge —
   capture there means CREATING A SECOND INTERLOCKED STACK from the strays. The
   group-settle recreate already interlocks sequentially settled floaters into
   each other; the missing piece is acceptance when the recreated formation
   competes with borderline-floater tips (next increment: per-floater
   accept-or-restore within the group, or restrict the recreate set to true
   outliers only).

## 2. New geometric primitives (WP-R1) — contact graph and critical chain

New file `main/util/refinement-util.js`, same module pattern as `geometryutil.js`
(IIFE attaching `root.RefinementUtil`; `<script>` tag added to
`main/background.html` after `util/separation.js`; requireable in Node tests; no
DOM/IPC/Clipper inside). All point/ring conventions per SOTA §1.5 — in particular
the test point `q_i = placements[i] + parts[i][0]`.

```
RefinementUtil.isBlocked(i, dir, ctx) -> bool
  // Direct probe, no normal math (deliberately): part i cannot move a nudge of
  // 4*eps in unit direction dir iff, at q_i + 4*eps*dir, ANY neighbor NFP reports
  // penetration.inside === true OR containmentViolation.outside === true.
  // ctx supplies nfp(i,j), ifp(i), eps — same provider shapes as SeparationUtil.separate.

RefinementUtil.contacts(i, ctx) -> [{ j, point:{x,y} }]
  // Neighbor j is "in contact" with part i iff distToRingBoundary(q_i, shifted
  // nfp(i,j) outer ring or any child ring) <= CONTACT_EPS, where
  // CONTACT_EPS = max(4*eps, 0.05 * config.curveTolerance).
  // point = the closest boundary point (the contact location in world coords).
  // Sheet contact is reported as j === -1 with the closest IFP boundary point.

RefinementUtil.criticalChain(axisDir, ctx) -> { members:[indices], heads:[indices] }
  // axisDir = {x:-1,y:0} for gravity/box x-compaction ({x:0,y:-1} for box's
  // y-alternation). heads = the part(s) whose world bound defines the layout
  // extent opposite to axisDir (for x: parts achieving max world X within
  // CHAIN_TOL = 0.1% of the extent; world X of part i = max over vertices of
  // (vertex.x + placements[i].x)).
  // members = BFS from heads over the contact graph, expanding from part a to
  // contact-neighbor b only when b "blocks" a along axisDir:
  //     blocked = isBlocked(a, axisDir, ctxRestrictedTo(b))
  //     (i.e., probe a's nudge along axisDir against b's NFP alone; expand to b
  //      iff that single-neighbor probe reports inside)
  // Stop expanding at sheet contact (j === -1). Return visited set.
```

Unit tests `ml/tests/refinement_util/run.js` (plain node; hand-built square NFPs
like the SeparationUtil tests):
1. Two touching squares in a row against the left wall: chain from the right
   square = both squares; `heads` = right square.
2. Same two squares plus a third floating square far right but NOT touching:
   heads = floating square; members = {floating} only (no contact to expand).
3. A square resting on top of another (y-contact only): x-chain from the top
   square does NOT include the bottom one (its NFP does not block −x).
4. `isBlocked` against a wall: square at IFP left boundary is blocked in −x,
   free in +x.
5. Determinism: same inputs ⇒ identical member ordering (sort members ascending
   before returning).

## 3. Rotation operator (WP-R2) — geometry-derived angles, pivot rocking

Extends `refinement-util.js`:

```
RefinementUtil.hullEdgeAngles(polygon) -> [degrees]
  // getHull-style convex hull (reuse d3.polygonHull pattern from background.js
  // getHull or pass a hull provider in ctx to keep this module dependency-free),
  // then atan2 per hull edge, normalized to [0,180) (edges are undirected).
  // Dedupe within 0.5 degrees. Cap: longest 6 edges by length.

RefinementUtil.rotationCandidates(i, ctx) -> [{ deltaDeg, pivot:{x,y}|null, source }]
  // For each contact (j, point) of part i:
  //   for each angle a_i of hullEdgeAngles(part_i at current rotation, world)
  //   and each angle a_j of hullEdgeAngles(part_j, world)   [sheet contact: a_j ∈ {0, 90}]:
  //     delta = wrapTo180(a_j - a_i); keep iff 0.25 <= |delta| <= 15 (degrees)
  //     emit { deltaDeg: delta, pivot: contact point, source: 'edge-align' }
  // Plus, when the part has no contacts (free part): emit cache-warm steps
  //   { deltaDeg: ±(360/config.rotations), pivot: null, source: 'grid' }.
  // Dedupe deltas within 0.5°, cap 8 per part, ORDER: cache-warm grid deltas
  // first (multiples of 360/config.rotations hit existing NFP cache entries),
  // then edge-align deltas ascending by |delta|.

RefinementUtil.poseAfterPivotRotation(t, refPoint, deltaDeg, pivot) -> {x, y}
  // World rotation by delta about world pivot c maps translation t to:
  //   t' = R_delta(t - c) + c
  //   t'.x = cos(d)*(t.x - c.x) - sin(d)*(t.y - c.y) + c.x
  //   t'.y = sin(d)*(t.x - c.x) + cos(d)*(t.y - c.y) + c.y   (d = deltaDeg in radians)
  // pivot === null means rotate in place about the part's reference: t' = t.
```

Applying a rotation in the engine (orchestrator side, `main/background.js`):
- New polygon = `rotatePolygon(placed[i], deltaDeg)` with `.source`/`.id` copied and
  `.rotation = (placed[i].rotation + deltaDeg) % 360` (the rotated-copy pattern,
  SOTA §1.5). Rotation composition about the local origin is additive, so the
  exported `translate(x y) rotate(rotation)` stays consistent with the engine
  polygon — this invariant is what keeps exports correct; never rotate the polygon
  without updating `.rotation`, or vice versa.
- New translation from `poseAfterPivotRotation` (q and refPoint change with the
  rotated copy — recompute `q_i = t' + rotatedPart[0]` AFTER swapping the polygon).
- Validation: penetration probes against all neighbors + containment (needs fresh
  NFPs for the new rotation against every contact-relevant neighbor — these are
  cold cache entries for non-grid angles; budget below).
- Accept iff the sheet `layoutMetric` (same formula as fitness-v2 `sheetMetric`,
  SOTA §4/§5) strictly improves by > 1e-12; else restore polygon + placement.

Slenderness gating (which parts get rotation budget): rank parts by
`slenderness = 1 - trueArea/bboxArea` (trueArea = |polygonArea(part)|); only
chain members with `slenderness >= 0.15` receive rotation candidates; at most the
top 3 such parts per pass; at most `localRefinementMaxColdAnglesPerPart` cold
(non-grid) angles per part per pass. These caps bound NFP-cache growth (LRU 2500)
and wall time.

Unit tests (`ml/tests/refinement_util/run.js`, same file): pivot formula round-trip
(rotating by +d then −d about the same pivot restores t within 1e-9); hull angle
extraction on an axis-aligned rectangle returns {0, 90}; rotationCandidates on a
rectangle contacting a 10°-tilted rectangle includes delta ≈ ±10°.

## 4. Relocate (void-fill) and swap operators (WP-R3)

New standalone helper in `main/background.js` (deliberately NOT a refactor of
`placeParts` — the hot path stays untouched; cross-reference the duplication in a
comment):

```
buildFeasibleRegion(part, placedExcl, placementsExcl, sheet, config) -> rings|null
  // Mirrors the placeParts pipeline for one part: getInnerNfp(sheet, part, config)
  // -> innerNfpToClipperCoordinates; union of getOuterNfp(placedExcl[j], part,
  // false, config) shifted by placementsExcl[j] via nfpToClipperCoordinates;
  // Clipper ctDifference (same fill types as placeParts:2350 area);
  // toNestCoordinates back. Returns the feasible rings for the part's CURRENT
  // rotation, or null on any NFP failure (operator then skips, never throws).
```

`relocate(i)` operator (orchestrator): build the feasible region for chain part
`i` against `placed \ {i}`; evaluate candidate positions (ring vertices, plus the
edge sampling rule of SOTA WP-1.2 when `candidateEdgeSampling` is on) with the
gravity/box candidate score used in construction (`rectbounds` math at
`main/background.js:2400` area, no mergeLines term); take the best candidate;
accept iff layoutMetric strictly improves. This finds "that part obviously belongs
in that hole" moves — the region IS the set of legal teleports.

`swapParts(i, j)` operator: `i` = chain member, `j` = a non-chain part with
`0.6 <= bboxArea_j / bboxArea_i <= 1.4` (try at most 3 such j per pass, nearest
bbox-ratio first). Procedure: snapshot placements; tentatively set
`placements[j] = clonePlacementPosition(placements[i])` (same rotation rule:
keep each part's own rotation; this is a position swap, not a pose swap);
validate j at i's old spot via penetration+containment probes against
`placed \ {i, j}`; then `relocate(i)` with j already moved; accept the pair iff
both legal AND layoutMetric improves; else restore the snapshot.

## 5. Ruin & recreate operator (WP-R4)

```
ruinRecreate(ctx):
  k = min(4, max(2, ceil(n/8)))
  victims = chain heads first, then remaining chain members ordered by
            slenderness descending, take k
  snapshot placements + placed order
  remove victims from placed/placements (preserve array correspondence!)
  for each victim in trueArea-descending order:
      region = buildFeasibleRegion(victim, currentPlaced, currentPlacements, sheet, config)
      if region: place at best-scoring candidate (same scoring as relocate)
      else: restore snapshot, return notImproved
  accept iff every victim re-placed AND layoutMetric improved by > 1e-12;
  else restore snapshot.
```

v1 keeps each victim's current rotation during re-placement (rotation exploration
stays the rotation operator's job — keeps this WP small and its failures
debuggable). Budget: at most 1 ruin–recreate attempt per pass.

## 6. Orchestrator (WP-R5) — `refineSmartPlacements`

New function in `main/background.js`, selected at the existing refinement call
site (`placeParts`, `main/background.js:2516` area) when
`config.localRefinementEngine === 'smart'`:

```
refineSmartPlacements(sheet, placed, placements, config, sheetboundsForScoring):
  guards: placed.length >= 2; placementType gravity|box (else delegate to
          shrinkSeparate engine); axis-aligned-rectangle sheet check and the
          providers/memoization EXACTLY as SOTA WP-2.2
  rng = mulberry32(nestindex * 104729 + 1)        // deterministic per payload
  deadline = now + localRefinementBudgetMs
  best = deep copy placements; bestMetric = layoutMetric(best)
  stats additions: { engine:'smart', operatorStats: { shrink:{tried,accepted},
                     rotate:{...}, relocate:{...}, swap:{...}, ruinRecreate:{...} } }
  while now < deadline:
     madeProgress = false
     // ~60% of remaining budget: translation compaction
     shrinkDeadline = now + 0.6 * remaining
     run shrinkSeparateOnce loop (shared WP-2.2 primitive) until shrinkDeadline
       or alpha floor; if metric improved -> madeProgress
     chain = RefinementUtil.criticalChain(axisDir(config, passIndex), ctx)
     // ~25%: rotations (only if config.localRefinementRotations)
     for each gated chain part (slenderness rule, §3), each rotationCandidate:
        check deadline; try; count in operatorStats.rotate; improved -> madeProgress
     // ~15%: relocate -> swap -> ruinRecreate, in that order, chain-targeted
     for top-2 chain heads: relocate; then swap (≤3 partners); then 1 ruinRecreate
     if metric improved vs best: best = copy; bestMetric = ...
     if !madeProgress: break
  placements := best
  FINAL LEGALITY GATE: identical to SOTA WP-2.2 step 6 (Clipper pairwise
  intersection area <= (1e-3*curveTolerance)^2 + IFP containment); on violation
  revert to pre-refinement placements, stats.reason='legalityRevert'.
  if anything moved && config.mergeLines: recomputeSheetMergedData (existing
  pattern at main/background.js:2520 area)
  fill stats; return { moved, scoreState, stats }
```

Notes the implementer must respect:
- Every operator validates against the CURRENT layout via providers; every
  accept/reject path restores state on reject (snapshot/restore, never in-place
  trial without a saved original).
- `placed[i]` and `placements[i]` must stay index-aligned through every operator
  (rotation swaps the polygon object in `placed[i]`; relocate/swap/RR touch only
  `placements` except RR's temporary removal).
- Deadline checks go INSIDE every candidate loop (SOTA trap 12).
- No console logging inside operator loops (SOTA trap 13); one summary log per
  refinement run max.
- The post-process response payload shape is unchanged; `localRefinement` stats
  gain only additive fields, so the badge and smoke reports keep working.

## 7. Work packages, order, claims

| Order | WP | Claim string | Touches | Gate |
|---|---|---|---|---|
| 0 | WP-R0…R0.3 | done (see §1…§1.7) | — | superseded by §1.9 sequencing |
| 0.5 | **WP-S1 settle pass** | `LRv3-S1 legality predicate + settle pass` | main/background.js, main/util/separation.js (erosion predicate tests), main/index.html | §1.9.2 substantive + visual gate |
| 0.6 | WP-S2 annealed relax | `LRv3-S2 annealed relax` | main/background.js | after S1 green |
| 1 | WP-R1 | `LRv3-R1 contact graph + critical chain` | main/util/refinement-util.js, main/background.html, ml/tests/refinement_util | unit tests pass; serves settle ordering first |
| 2 | WP-R2 | `LRv3-R2 rotation operator` | refinement-util.js, main/background.js | unit tests; flag-off equivalence |
| 3 | WP-R3 | `LRv3-R3 relocate + swap` | main/background.js | flag-off equivalence; ad-hoc smoke with engine 'smart' completes |
| 4 | WP-R4 | `LRv3-R4 ruin & recreate` | main/background.js | same |
| 5 | WP-R5 | `LRv3-R5 smart orchestrator + stats` | main/background.js, main/index.html (engine select option + explain) | full battery + equivalence |
| 6 | WP-R6 | `LRv3-R6 benchmark gate + default decision` | ml/benchmark results, AGENT_COLLABORATION.md | see below |

**WP-R6 acceptance gates** (benchmark corpus, frozen 240 s budget, refinement
budget 1500 ms/sheet, 3 runs/instance, vs the same engine with refinement OFF and
vs `'shrinkSeparate'`):
1. `'smart'` ≥ `'shrinkSeparate'` + 0.75 pp mean median utilization at equal budget.
2. `'smart'` ≥ no-refinement + 1.5 pp mean median utilization.
3. `operatorStats.rotate.accepted > 0` on ≥ 30% of instances whose parts include
   slenderness ≥ 0.15 shapes (proves rotations genuinely fire).
4. Zero final-legality reverts that ship (reverts may occur; shipped layouts must
   all be legal — assert via the harness digests + a pairwise-intersection sweep
   over every benchmark output).
5. ML checkpoint + bakeoff before flipping `localRefinementEngine` default to
   `'smart'`; until then it ships default-'slide'.

## 8. v3-specific traps (additive to SOTA §9)

1. **Rotation invalidates every cached NFP involving that part at that angle.**
   Grid-step angles (multiples of 360/config.rotations) are warm; arbitrary
   edge-align angles are cold and ALSO enter the persistent LRU — respect
   `localRefinementMaxColdAnglesPerPart`, and never emit candidate deltas below
   0.25° (they produce near-duplicate cache entries for invisible gains).
2. **Pivot formula sign**: `t' = R_delta(t − c) + c` with delta in radians,
   counterclockwise positive — match `rotatePolygon`'s convention
   (`main/background.js:1539` uses the standard CCW matrix). The unit test in §3
   is mandatory, write it first.
3. **`.rotation` bookkeeping**: exports render `rotate(p.rotation)` against the
   ORIGINAL source geometry. After any accepted rotation: polygon copy, placement
   x/y, and `.rotation` must all change together or exports silently diverge from
   the engine layout. The final legality gate cannot catch this (the engine layout
   is legal — the export would be wrong). Add one orchestrator-level assertion in
   dev runs: re-derive `rotatePolygon(original, placements[i].rotation)` for a
   sampled part and compare a vertex against `placed[i]` within 1e-6.
4. **RR index alignment**: removing victims must splice `placed` and `placements`
   with the same indices in the same order; restore must restore both arrays AND
   any memoized provider entries keyed by index (safest: providers key by
   `(source, rotation, x, y)`, never by array index).
5. **Swap is position-swap, not pose-swap**: parts keep their own rotations; do
   not copy `rotation`/`id`/`source` fields between placements
   (`clonePlacementPosition` then overwrite x/y only... no: set j's placement to
   i's x/y while KEEPING j's id/source/rotation — build it explicitly, do not
   clone i's record).
6. **Budget starvation**: the 60/25/15 split is of *remaining* budget per pass,
   not total; with a 1500 ms budget and an expensive first shrink, rotations must
   still get a slice — enforce a 100 ms minimum floor for the rotation+discrete
   block per pass or the operators never run on slow sheets.
7. **Determinism**: all randomness (swap partner order beyond the ratio sort, RR
   tie-breaks) through the seeded rng; two runs of the same payload must produce
   identical refined layouts (the engine-equivalence harness will be extended to
   pin one 'smart' golden once WP-R5 lands).

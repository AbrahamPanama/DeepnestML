# Raster Collision Tier — "make fine rotation affordable" — Implementation Plan

Status: RC-1 implemented and measured 2026-07-25. Soundness passed; the
divisor-64 laurel ambiguity gate failed, so RC-2 is blocked pending an explicit
resolution-policy amendment. See §3.1.

Author: Claude-Code, 2026-07-25 (against commit `7360de2`, product 0.8.0).

Audience: an implementing AI agent with no prior context. Read `AGENTS.md` and
`AGENT_COLLABORATION.md` first (claim protocol, ML-sensitive files, commit
tagging). `docs/local-refinement-v4-plan.md` documents the measurements this plan
responds to; its §2 ground rules (NFP cache safety, default-off flags, equivalence
harness, multi-seed evidence) apply verbatim here.

Goal: add a **second collision tier** — raster bitmasks — used as a fast filter
during search, with the existing exact geometry retained as the sole authority at
commit. This is what makes 1°-granularity rotation affordable, and it is the
standard architecture in production nesting systems that appear to rotate freely.

Non-goal: replacing NFP. NFP stays as the candidate *generator* (it produces
contact-exact positions, which is why Deepnest's per-placement quality is good)
and as the commit-time authority. This plan changes how candidates are *tested*,
not how they are *proposed* or *validated*.

---

## 1. Why (measured, 2026-07-25)

Two hard numbers define the problem.

**Rotation cost is quadratic.** Outer NFPs are keyed by
`(Asource, Arotation, Bsource, Brotation)`, so the distinct-NFP count grows as
(sources x rotations)². Priced against albano's 24 distinct sources:

| rotation grid | distinct outer NFPs | vs today | Minkowski @2 ms |
|---|---|---|---|
| 4 (today) | 9,120 | 1x | 18 s |
| 16 | 147,072 | 16x | 5 min |
| 45 | 1,165,320 | 128x | 40 min |
| **360 (1°)** | **74,640,960** | **8,184x** | **~41 h** |

A uniform 1° grid is therefore unreachable by construction, and it would also
flood the persistent cache with millions of single-use entries.

**Search is dominated by rejecting candidates.** On albano, ~98 % of candidates
are rejected by the legality predicate before the objective ever scores them
(942 evaluations, 19 scored, 923 illegal). Each rejection costs a `getOuterNfp`
cache lookup plus a `SeparationUtil.penetration` evaluation **per neighbour**.

Those two facts point at the same fix. A raster tier costs **O(R)** rather than
O(R²) — one bitmap per part per angle, no pairwise precomputation — and it
answers the reject case with bit-parallel AND instead of NFP lookups.

**Premise check (do not skip this paragraph).** The v4 plan's §4.5 assumed the
exact Clipper check dominated the hot path; it did not, because the neighbour loop
already returns on NFP penetration first, and the resulting 10x throughput gate
was unreachable. That mistake is not repeated here: the costs this plan removes
(`getOuterNfp` + `penetration`, per neighbour per candidate) are the ones that
were **measured** to run on every rejected candidate. Even so, WP-RC-2 is a
measurement WP precisely so the premise is verified before anything depends on it.

---

## 2. The two-sided filter (the core idea)

For each part at each angle, build **two** bitmasks on a shared global pixel grid:

- `outer` — every pixel the part touches, dilated by one pixel;
- `inner` — only pixels wholly inside the part, eroded by one pixel.

Then for a candidate pair (A, B):

| test | conclusion | cost |
|---|---|---|
| `outer(A) & outer(B) == 0` | **provably disjoint** -> legal | bit AND |
| `inner(A) & inner(B) != 0` | **provably overlapping** -> illegal | bit AND |
| otherwise | ambiguous -> fall through to exact geometry | Clipper/NFP |

Both fast paths are *sound*: neither can produce a wrong answer, because the
dilation/erosion margins bound every discretisation error. Only candidates whose
boundaries fall inside the one-pixel ambiguity band pay the exact cost.

This matters most in exactly the regime we are stuck in: a dense sheet rejects
most candidates because they overlap *deeply*, which the `inner` test catches
immediately. Deep intrusions are the cheapest case to resolve, not the most
expensive.

**Subpixel translation.** Placements are continuous, pixel grids are not. Absorb
the residual by rounding the translation to the nearest pixel and letting the
one-pixel dilation/erosion margins cover the ≤ p/2 error. The margin must be
*proved* to cover it (WP-RC-1 gate), not assumed.

**Spacing** is already baked into the part polygons before they reach the worker,
so rasterise the polygons as received and clearance comes along for free.

---

## 3. WP-RC-1 — the rasteriser (pure module, no engine changes)

New `main/util/raster-collision.js`, loaded alongside `separation.js`. Pure,
dependency-free, unit-testable, no engine wiring in this WP.

API sketch:

```
rasterise(polygon, pixelSize, mode) -> { w, h, ox, oy, bits: Uint32Array }
   mode: 'outer' (dilate 1px) | 'inner' (erode 1px)
intersects(maskA, offsetA, maskB, offsetB) -> boolean     // bit-parallel AND
contains(sheetMask, partOuter, offset) -> boolean          // containment test
```

- Pack rows into `Uint32Array`; test 32 pixels per operation. Only iterate the
  overlapping row/column window of the two masks, not the whole bitmap.
- Scanline fill for the interior; hole rings (`polygon.children`) subtract.
- `pixelSize` policy: derive from the smallest part bbox rather than a global
  constant, e.g. `p = clamp(minPartBboxDiag / rasterDivisor, curveTolerance/2,
  minPartBboxDiag/16)` with `rasterDivisor` default 64. Coarser p means less
  memory and more ambiguity — it is a tunable, so make it a config knob and
  measure rather than guess.

**Gate:**
1. Soundness, randomised: over ≥5,000 random polygon pairs (convex, concave, and
   hole-bearing) at random sub-pixel offsets, assert `outer` disjoint implies
   Clipper reports no intersection, and `inner` intersecting implies Clipper
   reports intersection. **Zero violations permitted** — a single false accept
   invalidates the whole design.
2. **Ambiguity rate on real parts** — the make-or-break measurement. Report the
   fraction of pairs landing in the ambiguous band for the ESICUP corpus *and*
   for `ml/examples/laurel-two-crossed.svg`. Slender high-perimeter parts have
   proportionally more boundary pixels, so the filter degrades exactly where we
   most want it. **If the laurel ambiguity rate exceeds ~40 % at the default
   resolution, stop and report before building anything downstream** — the rest
   of this plan is not worth doing at that rate.
3. Memory: report bytes per part per angle at the chosen resolution, and the
   projected total for 24 sources x 16 angles.

### 3.1 RC-1 measured outcome (2026-07-25)

Implementation: `main/util/raster-collision.js`, loaded by both renderer
contexts but not wired into engine decisions. The module uses conservative
cell-boundary coverage, even/odd scanline filling, one-cell dilation/erosion,
packed `Uint32Array` rows, and overlap-window word ANDs.

- Randomised soundness: 5,000 polygon pairs, covering convex, concave, and
  hole-bearing inputs at random subpixel offsets. `outer` made 1,623 disjoint
  decisions and `inner` made 1,669 overlap decisions with **0 unsafe decisions
  in either direction**. A separate 1,000-placement containment audit produced
  239 conservative accepts with **0 outside-part accepts**.
- ESICUP ambiguity at divisor 64: **18.84%** across 7,968 sampled candidate-like
  placements. Mean storage was 10,218 bytes per part-angle; the 24-source x
  16-angle mean projection was 3.92 MB.
- Laurel ambiguity at divisor 64: **55.80%**, above the 40% off-ramp. The
  actual crossed fixture pair was also ambiguous despite 538,655 square units
  of exact intersection. RC-2 must therefore not start under the written
  divisor-64 default.
- Resolution diagnosis (same deterministic 2,500 laurel poses): divisor 96
  52.72%, divisor 128 50.40%, divisor 192 **32.52%**, divisor 256 **11.44%**.
  The actual crossed pair becomes a proven overlap at 192. Laurel storage at
  192 averaged 3,935 bytes per part-angle (1.51 MB for 24 x 16); at 256 it
  averaged 7,025 bytes (2.70 MB for 24 x 16).

Decision: **stop after RC-1 as originally specified.** The result does not
invalidate raster filtering, but it invalidates divisor 64 for the target
shape. Before RC-2, amend the policy explicitly to a finer or shape-aware
resolution and measure its corpus-wide memory/rasterisation cost; do not
silently reinterpret the existing gate.

### 3.2 Policy amendment (Claude-Code, 2026-07-25)

RC-1 stopping was correct. Three corrections follow, one of them to the gate
itself.

**(a) The 40 % off-ramp conflated two objectives — author error.** §3 gate 2
says "the rest of this plan is not worth doing at that rate." That is wrong as
written. Ambiguity governs how much the filter *accelerates search*; it does not
govern the *fine-rotation unlock*, which is this plan's actual purpose. Testing a
1° pose through raster-plus-exact-fallback avoids computing an NFP at that angle
**at any ambiguity rate** — even at 55.8 %, the fallback is a Clipper intersection
rather than a Minkowski sum plus a persistent cache write. So the threshold should
gate **RC-3's speedup claim**, not RC-4's capability. Re-read it that way.

**(b) Ambiguity is a hard ceiling on speedup, and the ceiling is modest.** With
raster ~100x cheaper than exact, achievable speedup is `1 / (a + (1-a)/100)`:

| case | ambiguity | speedup ceiling |
|---|---|---|
| laurel, divisor 64 | 55.8 % | ~1.8x |
| laurel, divisor 192 | 32.5 % | ~3.0x |
| ESICUP, divisor 64 | 18.8 % | ~5.1x |

Nobody should expect 10x from this tier. RC-3 should state its achieved figure
against these ceilings rather than against an invented target — the v4 §4.6
mistake, restated so it is not made a third time.

**(c) Replace the global divisor with a derived per-part resolution.** A global
divisor forces slender and chunky parts to the same relative resolution, but the
ambiguity band is one pixel wide *around the perimeter*, so for a part of area `A`
and perimeter `P` the ambiguous fraction is approximately `P·p / A`. Solving for a
target ambiguity `α` gives a closed form:

```
p_part = alpha * (area / perimeter)         // clamp to [curveTolerance/2, bboxDiag/16]
```

This self-adapts in exactly the direction the measurements demand: high
perimeter-to-area parts (laurel branches) get fine pixels automatically, compact
parts stay coarse, and memory is spent only where it buys something. It is also
derived rather than tuned, so it should generalise to part libraries nobody has
benchmarked. **Validate it against the empirical datapoints already collected** —
at `alpha = 0.30` it should land near the divisor-192 behaviour on laurel and
remain coarser than divisor 64 on compact ESICUP parts. If it does not reproduce
those numbers, prefer the measured divisor and record why.

Interim fallback if (c) underperforms: adopt divisor 192 globally, accepting ~9x
the pixels of divisor 64 (3x linear) in both memory and rasterisation time.

### 3.3 Resolution policy — measured outcome (Claude-Code, 2026-07-25)

`chooseShapePixelSize` and `chooseAdaptivePixelSize` are implemented in
`main/util/raster-collision.js`. The shape rule alone did **not** dominate, so the
shipped policy is the combination.

Laurel (2,500 deterministic poses, same harness sampling as §3.1):

| policy | pixel | ambiguity | speedup ceiling | proj. 24x16 |
|---|---|---|---|---|
| divisor 64 | 199.6 | 55.80 % | ~1.8x | 0.11 MB |
| divisor 192 | 66.5 | 32.52 % | ~3.0x | 1.44 MB |
| divisor 256 | 49.9 | 11.44 % | ~7.5x | 2.57 MB |
| shape alpha=0.40 | 45.1 | 9.64 % | ~9x | 3.05 MB |
| **shape alpha=0.30** | 33.8 | **6.12 %** | **~14x** | 5.61 MB |
| shape alpha=0.20 | 22.5 | 3.04 % | ~23x | 12.30 MB |

The crossed-laurel fixture is correctly classified `overlap` at every shape-rule
setting, and stays `ambiguous` up to divisor 128.

ESICUP corpus (7,968 sampled placements):

| policy | corpus ambiguity | proj. 24x16 |
|---|---|---|
| divisor 64 | 18.84 % | 3.92 MB |
| shape alpha=0.30 alone | **25.89 %** (worse) | — |
| **min(divisor 64, alpha=0.30)** | **18.64 %** | 3.74 MB |

**The shape rule alone is not a win.** It is decisively better on slender parts
and *worse* on several compact ESICUP instances, because its calibration model
(band fraction of a part's own area) does not match the measured quantity
(fraction of sampled pair placements that are ambiguous). The two rules have
complementary blind spots, so the shipped policy takes the **finer of the two**:

```
p = min( minPartBboxDiag / rasterDivisor , alpha * area / perimeter )   clamped
```

That is never coarser than either input, costs one extra evaluation, and measured
best-or-equal on both corpora: laurel 6.12 %, ESICUP 18.64 %.

**Note that `alpha` is not a predicted ambiguity.** alpha=0.30 yields ~6 % measured
on laurel, not 30 %. It is a shape-relative resolution knob whose absolute scale
was calibrated empirically; do not read it as a target rate.

**Known limitation — the curveTolerance floor.** Pixel size is clamped below at
`curveTolerance / 2`, so instances whose parts are small relative to
`curveTolerance` cannot be resolved further and keep a high ambiguity rate:
shirts 55.5 %, blaz1 43.5 %, jakobs1 40.0 % (each clamp-limited, blaz1 pinned at
p = 0.15 = 0.3/2). The floor is defensible — the polygon itself is only accurate
to `curveTolerance` — but it caps what the filter can do on fine-featured jobs.
If RC-2 shows those instances dominating the fallthrough cost, revisit the floor
before adding resolution elsewhere.

**Caveat on the measurement itself:** `candidateOffsets` in the harness forces
25 % of samples into a shallow band 0.25–4 px deep, and every sample is
bbox-overlapping by construction. That is deliberately adversarial and matches the
population a spatial prefilter would hand the tier, but it over-weights near-contact
poses relative to a real run, where rejections are dominated by *deep* overlaps.
Treat the reported rates as **upper bounds**.

**Consequence for RC-2:** its gate must measure **net** time — mask construction
plus queries versus exact-only — not ambiguity alone. At 9x rasterisation cost, a
tier that resolves 67 % of queries can still lose overall if masks are rebuilt too
often. Report build time, query time, and the net, per instance.

---

## 4. WP-RC-2 — shadow measurement in the legality path (no behaviour change)

Wire the rasteriser into `localRefinementSinglePlacementLegal` behind
`rasterCollisionShadow` (default `false`). In shadow mode, compute both the
raster verdict and the existing exact verdict, change nothing, and record:

- `rasterAgree`, `rasterAmbiguous`, `rasterDisagreeUnsafe` (raster said legal,
  exact said illegal — must be **0**), `rasterDisagreeConservative`;
- time attributable to each tier.

Follow the v4 precedent and count **direction**, not just totals: an unsafe
disagreement is a design failure, a conservative one is merely lost speed. The v4
shadow audit's single undirected counter blocked a gate for a week because nobody
could tell those apart.

**Gate:** `rasterDisagreeUnsafe == 0` across the smoke battery and a 3-seed
benchmark; report measured ambiguity rate and the projected speedup.

---

## 5. WP-RC-3 — enable the filter in refinement search

Flag `rasterCollisionFilter` (default `false`). Insert the raster tier ahead of
the NFP work in the legality path: raster-legal short-circuits to accept,
raster-illegal short-circuits to reject, ambiguous falls through unchanged.
Rebuild masks on accepted moves only.

**Gate:**
1. Flag-off equivalence byte-identical (`placementsDigest` unchanged).
2. Flag-on: **identical accept/reject decisions** to flag-off on a frozen
   candidate stream — the filter is sound, so decisions must not change at all.
3. Throughput: `movesTested + legalityRejects` on albano at a fixed budget,
   reported as a multiple of the 594 baseline. State the achieved figure; do not
   pre-commit to a target the way §4.6 of the v4 plan wrongly did.

---

## 6. WP-RC-4 — fine-angle poses (the actual payoff)

With collision testing no longer paying an R² tax, generate rotation candidates
at **1° or finer** for the refinement operators (fine rotation, rotation reflow,
overlap-then-repair, continuous compaction).

Hard constraint, inherited unchanged: **off-grid angles must never reach
`getOuterNfp`/`getInnerNfp`.** The Phase 0 canonical guard stays green
(`nonCanonicalNfpLookups == 0`). Fine-angle poses are validated by raster plus
exact geometry only. This is precisely why the raster tier makes fine rotation
tractable — it removes the need for an NFP at the candidate angle at all.

**Gate:** on `laurel-two-crossed`, accepted rotations land on non-multiples of the
canonical grid; `nonCanonicalNfpLookups == 0`; exact legality holds; no wall-clock
regression beyond budget.

---

## 7. WP-RC-5 — placement-time integration (largest, do last)

Only after RC-1..RC-4 are green. Use the raster tier to score placement
candidates at per-part fine angle sets during construction, keeping NFP for
contact-position generation at canonical angles. This is where the user-visible
"parts sitting at sensible diagonals" outcome actually comes from — refinement
cannot recover space that placement never left.

**Gate:** the full efficacy gate — ≥1.5 pp mean median utilisation versus current
default at equal wall clock, ≥3 seeds, zero shipped illegal layouts verified by an
independent Clipper sweep of exported geometry, ML checkpoint + bakeoff before any
default flip.

---

## 8. Work packages, order, claims

| Order | WP | Claim string | Touches | Gate |
|---|---|---|---|---|
| 1 | **RC-1 rasteriser** | `RC-1 raster collision module` | `main/util/raster-collision.js` (new), `main/background.html`, `main/index.html`, `ml/tests/raster_collision/` (new) | §3 |
| 2 | **RC-2 shadow measurement** | `RC-2 raster shadow audit` | `main/background.js`, `ml/cli/run_benchmark.js` | §4 |
| 3 | RC-3 filter enable | `RC-3 raster filter in refinement` | `main/background.js`, `main/deepnest.js`, `main/index.html` | §5 |
| 4 | RC-4 fine angles | `RC-4 fine-angle poses` | `main/background.js` | §6 |
| 5 | RC-5 placement tier | `RC-5 raster at placement time` | `main/background.js`, `main/deepnest.js`, benchmark results | §7 |

RC-1 and RC-2 are the decision point. If RC-1's ambiguity rate is poor on slender
parts, or RC-2 shows no speedup, **stop and report** — that is a successful
outcome for a measurement WP, not a failure.

---

## 9. Verification battery

```bash
node --check main/background.js && node --check main/util/raster-collision.js
node ml/tests/raster_collision/run.js
node ml/tests/separation/run.js
node ml/tests/engine_bugfixes/run.js
node ml/tests/refinement_contact/run.js
node ml/tests/continuous_refinement/run.js
node ml/tests/engine_equivalence/run.js     # THE flag-off gate
bash ml/scripts/run_boot_check.sh
bash ml/scripts/run_smoke_battery.sh
git diff --check
```

---

## 10. Traps

1. **A single false accept invalidates the design.** The dilate/erode margins must
   be proven to cover sub-pixel translation error, including the diagonal case
   (error up to p·√2/2). Prove it with randomised tests, not reasoning.
2. **Slender parts are the adversarial case.** High perimeter-to-area means most
   pixels are boundary pixels, so the ambiguous band dominates and the filter
   stops paying. The laurel fixture is the honest benchmark here, not the ESICUP
   corpus — measure it first.
3. **Memory grows with angle count.** Rasterise lazily per angle actually used and
   evict with an LRU; do not precompute 360 angles per part eagerly.
4. **Never let a fine angle reach the NFP layer.** The canonical guard fails
   closed and counts `nonCanonicalNfpLookups`; any non-zero value stops the WP.
5. **Count disagreement direction, not just totals** (v4's lesson — an undirected
   counter cannot distinguish a safe conservative filter from an unsafe one).
6. **`main/background.js` is ML-sensitive.** Attempt `npm run ml:checkpoint` before
   engine edits and record the outcome; it currently fails for lack of a trained
   model run.
7. **Do not claim efficacy from a single stochastic run.** Recorded three times in
   the handoff notes now.
8. **Raster is a filter, not a nesting algorithm.** It changes what a search can
   afford to evaluate. It does not by itself improve any layout — RC-5 is the only
   WP that can move utilisation, and only if placement-time angles improve.

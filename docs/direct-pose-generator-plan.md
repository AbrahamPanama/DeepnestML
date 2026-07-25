# Direct-Clipper Pose Generator — 1° rotation without NFP — Implementation Plan

Status: PLAN — not started. Successor to `docs/raster-collision-plan.md`, which
was **stopped at RC-2** after measuring that exact collision is already cheap
(~19 µs/pair) and a raster filter is 1.9x slower on this workload. That
measurement is what makes this plan possible.

Author: Claude-Code, 2026-07-25 (against commit `7c05449`, product 0.8.0).

Audience: an implementing AI agent with no prior context. Read `AGENTS.md` and
`AGENT_COLLABORATION.md` first. `docs/local-refinement-v4-plan.md` §2 ground
rules (NFP cache safety, default-off flags, equivalence harness, multi-seed
evidence) apply verbatim and are not repeated.

Goal: **propose** off-grid candidate poses from part geometry, and validate them
with direct exact collision. This is the missing half — the codebase can already
*validate* arbitrary angles; it cannot *generate* good ones.

---

## 1. Why this is now the right shape of work

The wall was never collision testing. Measured on albano (RC-2):

| operation | cost |
|---|---|
| exact Clipper `materialOverlap`, one pair | **19.3 µs** |
| raster bit-AND, one pair | 37.5 µs (rejected — slower) |

Which prices fine rotation directly, assuming ~5 spatially-prefiltered neighbours:

| search | per part | 100 parts |
|---|---|---|
| 1° over ±45° (90 poses) | 8.7 ms | **0.9 s** |
| 1° full circle (360 poses) | 34.7 ms | 3.5 s |

So 1°-granularity rotation is affordable **today**. The reason it has never
happened is that candidate *positions* come from NFP boundaries, and an NFP at an
off-grid angle is both a cache-poisoning hazard (the Phase 0 guard fails it
closed, correctly) and an (sources x rotations)² cost explosion — 74.6 M NFPs for
a 1° grid on albano, ~41 h.

Break the dependency: generate poses from **part-vs-neighbour geometry directly**,
validate them with the exact predicates already in the tree, and never ask for an
NFP at a non-canonical angle.

**What already exists** (do not rebuild): `localRefinementExactSheetContains`,
`localRefinementMaterialOverlap`, `localRefinementSpatialQuery` (bbox prefilter),
`localRefinementWindowCandidateLegal`, the v4 contact-aware acceptance rule, and
the Phase 0 canonical-NFP guard. Fine rotation, rotation reflow, and
overlap-then-repair already validate off-grid poses exactly. **Only generation is
missing.**

---

## 2. WP-DP-1 — pose generator module (pure, no engine changes)

New `main/util/pose-generator.js`. Pure, dependency-free, unit-testable.

Three generators, cheapest first. All emit `{rotation, x, y, provenance}` and
none of them touch NFP.

### 2.1 Edge mating (the important one)

For a target part and one neighbour: take the `k` longest edges of each
(`poseMaxEdges`, default 8), and for each pair compute the rotation that makes
them **antiparallel**, then translate so the edges are flush and separated by
`spacing`. That is a contact pose derived entirely from geometry, at whatever
angle the geometry implies — which is exactly the "parts lie along each other"
behaviour the laurel job needs, and the reason a 45°-limited grid fans them out.

Emit both flush-slide extremes along the shared edge direction, plus the midpoint,
so a long edge yields 3 poses rather than 1.

Cost: `k² × 3` poses per neighbour = 192 at k=8. Cap per target with
`poseMaxCandidates` (default 200) after ranking (§2.4).

### 2.2 Rotate-about-contact then slide

Rotate the target by δ about its current contact point with a neighbour (reuse
the pivot maths from the v4 fine-rotation operator), then slide along the
placement gravity direction until first contact. Sweep δ at `poseFineStepDeg`
(default 1°) within `poseMaxDeltaDeg` (default 45).

Slide-to-contact is a bisection on the **exact** predicate — same 16-sample +
18-iteration structure as `localRefinementMaxLegalSlide`, but with
`localRefinementWindowCandidateLegal` in place of NFP point tests. ~34 exact
tests per slide at 19 µs = ~0.7 ms.

### 2.3 Sibling-alignment poses

For parts sharing a `source`, emit poses at the dominant sibling rotation and its
180° complement. This is alignment pressure, and it is what prevents the
generator from *recreating* the fan: for many identical slender parts, density
comes from agreement, not from every part independently choosing its own best
diagonal.

### 2.4 Ranking

Score each pose by contact length (`RefinementContact.contactScore`, already in
the tree) **before** any exact validation, and validate only the top
`poseMaxCandidates`. Contact scoring is sampled distance, far cheaper than a
Clipper test, so this keeps the exact budget on plausible poses.

**Gate:** unit tests for edge-mating angle correctness (antiparallel within 1e-9),
flush separation equal to `spacing`, pivot preservation, deterministic ordering
under a fixed seed, and hole-bearing inputs. No engine wiring in this WP.

---

## 3. WP-DP-2 — exact validation path

Wrap validation in one helper so every consumer shares it:

```
poseLegal(sheet, placed, placements, config, index, part, placement) -> boolean
```

- bbox prefilter via the spatial index;
- `localRefinementExactSheetContains` for containment;
- `localRefinementMaterialOverlap` per surviving neighbour.

**Correction to this section (Claude-Code, 2026-07-25).** The draft called the
`!skip` guard on `localRefinementSpatialQuery` a free throughput fix. It is not —
it is a **staleness guard**, and removing it would have been a correctness bug.

The cached index is patched only via `localRefinementRecordAcceptance` (10 call
sites), while placements are mutated in 16 — pose trials, the separator moving
window neighbours, group settle. Mid-operation the index can therefore be stale,
and a stale index returns a **subset** of true neighbours. For a validator, a
subset means answering "legal" for an overlapping pose: the one failure mode it
may never have. The guard was protecting exactly the paths that mutate without
patching.

`localRefinementPoseLegal` therefore does its own **fresh** O(n) bbox prefilter
and never consults the cached index. The cost of that safety is negligible against
the RC-2 measurement: a bbox test is ~50 ns versus ~19 µs for one exact Clipper
test, so scanning 100 parts costs under a third of a single exact test while still
removing ~95 % of them. The spatial index would save the remaining ~5 µs — not
worth a soundness risk.

If someone later wants the index on these paths, the prerequisite is a generation
counter or dirty flag that forces a refresh after any unpatched mutation. Do not
simply delete the `!skip` condition.

**Gate:** flag-off equivalence byte-identical; a randomised test proving the
prefiltered path and an exhaustive full-scan path never disagree
(`ml/tests/pose_validation`, 1,500 layouts biased toward near-contact, requiring
both many legal and many illegal samples so the test cannot pass vacuously).

---

## 4. WP-DP-3 — wire as a pose source (flagged)

Flag `localRefinementDirectPoses` (default `false`). Feed generated poses into the
existing operators rather than adding a new one:

- **fine rotation** — replace its centroid-only δ sweep with §2.2 poses;
- **overlap-then-repair** — replace `localRefinementOverlapRepairPoses`' canonical-
  rotation-only generation (currently a hard constraint precisely because the
  separation context needs NFPs) with §2.1 edge-mating poses. Note the separator
  still needs canonical NFPs for the *movable neighbours*, so the pinned target
  may be off-grid while the window parts stay on-grid — verify this holds or the
  Phase 0 guard will fail closed.
- **continuous compaction** — offer §2.1 poses alongside its existing sweep.

**Hard invariant, unchanged:** `nonCanonicalNfpLookups == 0` in every run. Off-grid
poses are validated by exact geometry only.

**Gate:** flag-off equivalence; with the flag on, accepted rotations land on
non-multiples of the canonical grid on the laurel fixture; exact legality holds;
no wall-clock regression beyond budget.

---

## 5. WP-DP-4 — efficacy

**Set expectations honestly before running this.** Everything measured in the v4
arc says dense sheets are legality-limited: ~98 % of candidates on albano are
rejected before scoring, and utilisation there was bit-identical at 0.798528
across every configuration tried. A better pose generator does not create space
that does not exist.

Where it *should* pay is the **sparse/frontier regime** — which is precisely the
user's actual complaint. The laurel job is 4 parts on a large sheet; fine rotation
already achieves 45° and 24.88 % compaction there. The fan artefact in the user's
original screenshot is a placement-time angle problem on a sparse sheet, and that
is the target.

Gate, in priority order:
1. **Laurel/branch fixtures** — visible improvement over the current best, with
   accepted off-grid angles and exact legality. This is the acceptance test that
   matters and it should be judged on the exported SVG, not only on a metric.
2. ESICUP corpus, ≥3 seeds — **no regression** beyond noise. Do not expect a gain;
   record whatever happens.
3. Zero shipped illegal layouts, verified by the independent Clipper sweep in
   `ml/tests/benchmark_legality`.
4. `nonCanonicalNfpLookups == 0` everywhere.

---

## 6. Work packages, order, claims

| Order | WP | Claim string | Touches | Gate |
|---|---|---|---|---|
| 1 | **DP-1 generator** | `DP-1 pose generator module` | `main/util/pose-generator.js` (new), `main/background.html`, `main/index.html`, `ml/tests/pose_generator/` (new) | §2 |
| 2 | DP-2 validation + prefilter fix | `DP-2 exact pose validation` | `main/background.js` | §3 |
| 3 | DP-3 wiring | `DP-3 direct poses in operators` | `main/background.js`, `main/deepnest.js`, `main/index.html`, `ml/cli/run_benchmark.js` | §4 |
| 4 | DP-4 efficacy | `DP-4 pose generator efficacy` | benchmark results, smoke fixtures | §5 |

---

## 7. Traps

1. **Never request an NFP at a non-canonical angle.** The Phase 0 guard fails
   closed and counts `nonCanonicalNfpLookups`; a non-zero value stops the WP. This
   is the constraint that shaped every prior wave — respect it.
2. **Angle diversity is not the goal; agreement often is.** For many identical
   slender parts the dense solution is parallel/antiparallel rows with a phase
   offset, not thirty independent diagonals. §2.3 exists for this reason; without
   it a good generator can *recreate* the fan artefact.
3. **Rank before validating.** Contact scoring is cheap, Clipper is not. Validating
   unranked poses will burn the budget on nonsense.
4. **Do not add a fourth speed premise without measuring it.** This arc has now
   had three: the v4 §4.5 material-check assumption, the raster speed assumption,
   and the "1/ambiguity ceiling" that ignored query cost. All three were wrong.
   The 19.3 µs figure in §1 is measured; anything derived from it is not.
5. **`main/background.js` is ML-sensitive.** Attempt `npm run ml:checkpoint` and
   record the outcome.
6. **Efficacy on the corpus is not the success criterion** — see §5. Judge on the
   sparse fixtures the user actually brought.

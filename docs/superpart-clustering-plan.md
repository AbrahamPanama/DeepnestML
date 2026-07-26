# Superpart Clustering — Goals, Success Measures, Implementation Plan

Status: PLAN — not started. This is the route recommended after six refinement
mechanisms were built, verified, and found not to improve a nest. Read §1 before
deciding to deviate from it.

Author: Claude-Code, 2026-07-25 (against commit `4a58885`, product 0.8.0).

Audience: an implementing AI agent expected to work until the feature is **working**,
not merely implemented. Read `AGENTS.md`, `AGENT_COLLABORATION.md`, then §9 of this
document — the operating protocol exists because the preceding six mechanisms all
passed their unit gates and none moved a nest.

---

## 0. Definition of done

The feature is **working** when all four hold simultaneously:

1. On the user's laurel job (`ml/examples/laurel-two-crossed.svg`, 4+ branches),
   the exported nest **visibly shows interlocked pairs** rather than a fan, and
   uses **measurably less sheet** than the current default engine.
2. The improvement is present **at the settings the user actually runs** — the
   installed app, default config, not a benchmark-only flag combination.
3. The ESICUP corpus shows **no regression** beyond noise at equal wall clock,
   ≥3 seeds.
4. Every safety gate is green: zero illegal exported layouts (independent Clipper
   sweep), `nonCanonicalNfpLookups == 0`, flag-off engine equivalence
   byte-identical.

"Implemented and all unit tests pass" is **not** done. Six mechanisms already meet
that bar and none satisfies criterion 1.

---

## 1. Why this route, and why not the others

Measured this session, all reproducible from the handoff notes:

| approach | outcome |
|---|---|
| contact-aware acceptance (v4) | laurel 45°/24.88 %; albano unchanged |
| overlap-then-repair | 16/16 repairs succeeded, **0 accepted** |
| raster collision tier | sound, but **1.9x slower** than exact geometry |
| edge mating | **0 legal** poses from 2,048 validated |
| contact walking | **0 legal** poses from 720 validated |
| slide-to-contact repair | **2 legal** from 44 repairs, **0 accepted** |

Three walls were identified, in order:

- **Legality** — on a dense sheet ~98 % of candidates are rejected before scoring,
  and albano utilisation was bit-identical (0.798528) across every configuration.
- **Acceptance** — the primary metric is a silhouette measure, so interior gains
  score zero.
- **Local vs global** — for concave parts, local contact conditions (a mated edge,
  opposing normals at a point) do not imply global non-overlap. That is exactly
  what NFP computes and what local pose derivation cannot replace.

Superparts route around all three. The interlock angle is obtained **by
construction, offline**, at continuous precision with no budget pressure and no
legality wall; then the existing NFP placer nests the pair as one rigid part at
canonical angles, keeping its global guarantee. Nothing in the hot path changes.

---

## 2. Measures of success

**Tier 0 — mating gain (the go/no-go, see §3).**
`matingGain = 1 - pairArea / (2 x singleArea)` where "area" is the bbox (or hull,
matching `placementType`) of the optimally mated pair versus two independent
copies. This is the entire theoretical headroom: if two laurel branches cannot
interlock to save area, no amount of engineering helps.

**Tier 1 — fixture efficacy.** On the laurel fixture: sheet utilisation improvement
≥ 60 % of `matingGain` (mating is never perfectly realised once packed), and the
exported SVG visibly shows paired interlock. Judge criterion 1 on the SVG, not a
number alone.

**Tier 2 — corpus safety.** ESICUP mean median utilisation ≥ current default − 0.25 pp
at equal wall clock, ≥3 seeds. Expect neutral; superparts should not fire on
part libraries with no repeated slender parts.

**Tier 3 — production parity.** Same improvement reproduced through the installed
app with default settings, verified by the user's own job, not only the harness.

Report every tier as a number, including when it fails.

---

## 3. WP-SP-0 — the go/no-go measurement (do this first, it is ~1 hour)

**Do not build anything until this passes.** This is the off-ramp the previous
three plans put at the end instead of the beginning.

Write a standalone script (`ml/tests/superpart_gain/run.js`) that:

1. loads the laurel branch polygon (reuse the loader in
   `ml/tests/raster_collision/run.js`);
2. searches the relative pose of two copies: relative angle over 0–360° at 1°, and
   for each angle a slide sweep of ~64 offsets along and across the contact
   direction;
3. validates each candidate with exact collision only
   (`SeparationUtil.materialOverlap`, ~19 µs/pair measured in RC-2 — a 360 x 64
   search is ~23,000 tests ≈ 0.5 s, so this is cheap);
4. keeps the legal pair minimising bbox/hull area;
5. reports `matingGain`, the winning relative angle, and writes the winning pair
   as an SVG for eyeballing.

**Gate:** `matingGain >= 0.05` (5 %). Below that, **stop and report** — superparts
cannot help this part and the correct answer is to tell the user the geometry does
not interlock profitably. Also run it on a simple test part (two L-shapes, which
interlock obviously) to prove the search itself works before trusting a negative.

---

## 4. WP-SP-1 — offline pair optimiser

Promote the WP-SP-0 script into `main/util/superpart.js`:

```
findBestPair(polygon, options) -> {angle, offset, unionPolygon, gain} | null
```

- coarse-to-fine: 5° sweep, then 1° around the best few, then 0.25°;
- exact collision only, no NFP, no raster;
- deterministic under a fixed seed; cache by `(source, curveTolerance)`;
- budget-capped (`superpartSearchMs`, default 2000) and it runs **once per source
  per job**, not per placement.

**Gate:** unit tests for determinism, for the L-shape case having a known gain, for
respecting the budget, and for the returned union polygon being a valid simple
polygon with the two members exactly reconstructible from the recorded transforms.

---

## 5. WP-SP-2 — superpart construction

For each source with quantity ≥ 2 and `matingGain ≥ superpartMinGain` (default
0.05): build a synthetic part whose outline is the Clipper **union** of the two
mated members, carrying `members: [{sourceIndex, rotation, offset}, ...]`.

- quantity: `floor(qty / 2)` superparts plus `qty % 2` singles;
- the union outline must be simplified to `curveTolerance` like any imported part;
- **holes matter**: the interlock may create an enclosed void between members. Keep
  it as a hole ring — it is legitimately nestable area.

**Gate:** union area equals summed member area minus overlap (which must be 0);
member transforms reconstruct the exact original geometry; a superpart round-trips
through the existing part pipeline unchanged.

---

## 6. WP-SP-3 — nesting integration

Superparts enter the normal parts list. **No hot-path changes**: the GA, NFP cache,
placement worker, and refinement all treat them as ordinary parts at canonical
rotations. This is the entire point of the approach — do not special-case them in
the placer.

Flag `superpartClustering`, default `false`.

**Gate:** flag-off equivalence byte-identical; flag-on, a job containing superparts
nests to completion with `nonCanonicalNfpLookups == 0`.

---

## 7. WP-SP-4 — export unpacking

Every export path (SVG, DXF, PDF, TIFF) must emit **individual parts**, never the
superpart outline. At export, expand each superpart placement into its member
placements by composing the superpart transform with each member's recorded
transform.

**This is the highest-risk WP for silent breakage** — a superpart that reaches a
cut file as a single merged outline is scrap material. Gate it hard:

- exported path count equals the true part count (not the superpart count);
- each exported member's geometry matches the corresponding single-part geometry
  to within `curveTolerance`;
- an independent Clipper sweep of the exported file shows zero overlap;
- test all four export formats, not just SVG.

---

## 8. WP-SP-5 — efficacy and defaults

Run Tier 1, 2, 3 from §2. Only after all three are green, propose a default flip
with an ML checkpoint and bakeoff per the ML-sensitive protocol. Until then it
ships default-off.

---

## 9. Operating protocol (read this before writing code)

The six preceding mechanisms all passed their unit gates. None moved a nest. These
rules exist to prevent a seventh.

1. **Measure before building.** Every WP here has a cheap measurement that can kill
   it. Run it first. WP-SP-0 is one hour and can kill the entire plan — that is a
   feature.
2. **One hypothesis at a time, and write down the prediction before running.** When
   a result contradicts the prediction, the premise was wrong; say so explicitly
   rather than adjusting the target. This session had **three** wrong speed
   premises, each of which cost a work package.
3. **A negative result is a completed WP,** provided it is measured, explained, and
   recorded in the plan. Do not keep tuning past a clear negative.
4. **Never claim efficacy from a single stochastic run.** ≥3 seeds, always.
5. **Do not add a new mechanism while an existing one's blocker is unexplained.**
   If poses are rejected, find out *why* before generating different poses.
6. **Report the number that would embarrass you.** If utilisation is unchanged,
   lead with that. The user's trust depends on it more than the feature does.
7. **Safety invariants are absolute**, never traded for a gain:
   `nonCanonicalNfpLookups == 0`, flag-off equivalence byte-identical, zero illegal
   exported layouts.
8. `main/background.js` and `main/index.html` are ML-sensitive: attempt
   `npm run ml:checkpoint` and record the outcome.

---

## 10. Stop conditions

Stop, write up, and ask the user before continuing if any of these occur:

- WP-SP-0 `matingGain < 0.05` on laurel (the geometry does not interlock);
- the L-shape control in WP-SP-0 also shows no gain (the search is broken — fix the
  search, not the plan);
- superpart nests are legal but *worse* than singles on the fixture (mating helps
  the pair but hurts the packing — a real possibility worth reporting, not
  tuning around);
- export unpacking cannot be made exact for any format;
- three consecutive WPs produce no movement on Tier 1.

---

## 11. What already exists — reuse, do not rebuild

- `SeparationUtil.materialOverlap` — exact pairwise collision, ~19 µs.
- `localRefinementPoseLegal` — exact pose validation with a sound bbox prefilter.
- `PoseGenerator` — boundary sampling, smoothed normals, pivot rotation, ranking.
- `localRefinementSlideToLegal` — bisection repair on the exact predicate.
- `ml/tests/benchmark_legality` — independent Clipper sweep of exported geometry.
- `ml/tests/raster_collision/run.js` — laurel polygon loader.
- The smoke battery, engine-equivalence harness, boot check, and benchmark CLI.

The pair search in WP-SP-0 is largely `PoseGenerator` + `SeparationUtil` composed
differently: unbounded time, two parts, no sheet. That is why this route is small.

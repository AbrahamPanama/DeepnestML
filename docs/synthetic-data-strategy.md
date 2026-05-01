# Synthetic Data And Geometry Coverage

## Position

Synthetic data should be the default foundation of training for Deepnest++.

This problem is unusually well-suited for synthetic generation because the repo already contains:

- a geometry pipeline
- a deterministic solver
- measurable objectives
- hard validity constraints

That means we can create large labeled datasets without manual annotation.

## Why Synthetic Data Matters Here

Synthetic data lets us:

- scale training cheaply
- generate rare edge cases on purpose
- use the current solver as a teacher
- test models across controlled geometry regimes
- build repeatable benchmark corpora

## But Synthetic Data Alone Is Not Enough

Purely synthetic training can drift away from real industrial workloads.

The right mixture is:

- early stage: mostly synthetic
- middle stage: synthetic plus replayed real jobs
- mature stage: synthetic distributions tuned to match real telemetry

## Geometry Coverage Is Critical

For nesting, the training distribution is the product.

If the model only sees narrow geometry patterns, it will learn brittle shortcuts instead of real decision-making.

Examples of failure modes from poor coverage:

- good performance on medium convex parts only
- poor handling of very skinny or tiny parts
- weak behavior on concave shapes
- weak behavior on shapes with holes
- poor choices on mixed-scale jobs
- unstable ranking when many shapes are near-symmetric

## Dimensions The Generator Must Cover

## Absolute scale

The generator should cover:

- very small parts
- medium parts
- large parts

This matters for:

- spacing sensitivity
- tolerance behavior
- numeric stability

## Relative scale

The generator should vary:

- part-to-sheet area ratio
- largest-to-smallest part ratio in a single job
- dominance of one large part versus many small fillers

## Aspect ratio

Include:

- square-ish parts
- long thin parts
- highly elongated strips

## Shape complexity

Include:

- convex
- mildly concave
- highly concave

## Topology

Include:

- no holes
- single holes
- multiple holes
- nested containment situations if supported by import behavior

## Rotation sensitivity

Include:

- clearly asymmetric shapes
- near-symmetric shapes
- shapes where rotation matters a lot
- shapes where many rotations are effectively equivalent

## Set diversity

Include:

- mostly duplicate parts
- mostly unique parts
- clustered families of similar parts
- highly mixed catalogs

## Container diversity

Start with:

- rectangles

Then expand to:

- arbitrary sheet boundaries
- irregular containers

## Density regime

Cover:

- sparse jobs
- medium-fill jobs
- tight near-capacity jobs

## Difficulty regime

Cover:

- easy jobs with obvious placements
- adversarial jobs with many local optima

## Recommended Generator Strategy

Use a curriculum rather than jumping straight to the hardest cases.

## Stage 1

- rectangles
- simple polygons
- low part counts

## Stage 2

- moderate concavity
- broader aspect ratios
- more rotations

## Stage 3

- holes
- mixed scales
- duplicate-heavy jobs

## Stage 4

- irregular sheets
- high-density jobs
- adversarial edge cases

## What To Store Per Training Example

- canonicalized input geometry
- part-level features
- sheet-level features
- job-level summary features
- solver settings
- candidate search trajectory
- final placements
- legality outcomes
- runtime
- material utilization
- merged-line savings

## Do Not Train Only On Final Best Nests

That loses valuable decision information.

Also store:

- near-best candidates
- rejected candidates
- failed placements
- search ordering
- intermediate generations

This supports:

- ranking models
- imitation learning
- surrogate fitness models

## Coverage Tracking

Every dataset build should report its geometry distribution.

Suggested slice dimensions:

- small / medium / large parts
- convex / concave / hole-containing
- low / medium / high part count
- low / medium / high density
- low / medium / high duplicate rate
- low / medium / high scale spread

If a slice is underrepresented, treat that as a dataset problem, not just a model problem.

## Evaluation Implication

Benchmarking should always report metrics by geometry slice, not only one global average.

Global averages can hide severe failures on rare but expensive real-world jobs.

## Practical Rule

We do not want only more data.
We want better coverage of geometry space.

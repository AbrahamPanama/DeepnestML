# Continuous Refinement Gate

The product constructor remains on its proven four-angle grid. Smart local
refinement then searches bounded continuous angles and translations without
writing non-cardinal geometry to the persistent NFP cache.

The deterministic crossed-laurel fixture freezes a deliberately poor cardinal
starting pose. The production smoke gate requires:

- at least 15% continuous post-score improvement
- at least 60% of the frozen slow-oracle gain
- at least one accepted non-cardinal rotation
- no more than 2250 ms in the continuous stage
- zero persistent non-cardinal NFP lookups

Run the production gate:

```bash
DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-continuous \
  bash ml/scripts/run_smoke_battery.sh svg-laurel-continuous
```

Re-capture the slow oracle when the score definition or geometry changes:

```bash
bash ml/scripts/run_app_smoke_test.sh \
  --scenario ml/smoke/scenarios/svg-laurel-continuous-oracle.json \
  --output /tmp/laurel-oracle.svg \
  --report /tmp/laurel-oracle.json
```

Update the frozen oracle values in `svg-laurel-continuous.json` only after
reviewing the exported arrangement and exact-legality telemetry.

The dense three-part scheduling/reflow gate is separate from the two-part
oracle. It must scout all three targets, exploit two, accept an off-grid
rotation, and move the blocking cluster inside the same 2250 ms ceiling:

```bash
DEEPNEST_SMOKE_ARTIFACT_ROOT=/tmp/deepnest-smoke-cluster \
  bash ml/scripts/run_smoke_battery.sh svg-laurel-continuous-cluster
```

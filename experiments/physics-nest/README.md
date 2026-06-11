# Physics Nest Prototype

This is an isolated CLI prototype for a physics-style nesting post-process. It reads SVG `<path>` and `<polygon>` parts, flattens curves into polygons, seeds a legal grid placement, then repeatedly proposes small translations/rotations. A move is accepted only after Clipper confirms:

- no part has positive-area overlap with another part
- no part escapes the rectangular sheet
- optional `--spacing` clearance is preserved conservatively

The current jostle loop is intentionally simple. The important property for this experiment is the legality gate: physics-like motion can propose a move, but exact polygon collision validation decides whether it is allowed.

## Run

```sh
npm run experiment:physics-nest -- --input testpart.svg --output experiments/physics-nest/out/testpart-physics.svg --json experiments/physics-nest/out/testpart-physics.json
```

Run several independent shakes and keep the best legal arrangement:

```sh
npm run experiment:physics-nest -- --input testpart.svg --output experiments/physics-nest/out/testpart-physics-best.svg --json experiments/physics-nest/out/testpart-physics-best.json --best-of 32 --iterations 220 --shake 18 --gravity 22 --rotation-step 3
```

Watch a run live:

```sh
python3 -m http.server 8765 --directory experiments/physics-nest
npm run experiment:physics-nest -- --input testpart.svg --output experiments/physics-nest/out/live-result.svg --json experiments/physics-nest/out/live-result.json --trace experiments/physics-nest/out/live-state.json --best-of 8 --iterations 160 --shake 30 --gravity 22 --rotation-step 3
```

Then open `http://127.0.0.1:8765/live-viewer.html`.

Useful options:

```sh
--sheet 5000x1800
--part-scale 1.25
--spacing 2
--iterations 300
--best-of 32
--gravity 22
--shake 18
--rotation-step 3
--curve-tolerance 0.35
--clipper-scale 10000
--trace experiments/physics-nest/out/live-state.json
--trace-every 2
--seed 42
```

## Test

```sh
npm run experiment:physics-nest:test
```

The tests parse `testpart.svg`, run layouts at several part scales, and directly verify collision behavior for overlapping, touching, tiny-overlap, tiny-gap, clearance, and outside-sheet cases.

## Accuracy Notes

Collision checks are exact for the flattened polygon geometry at the configured Clipper integer precision. Source SVG curves are approximated before collision checks, so use a lower `--curve-tolerance` and/or nonzero `--spacing` when the source has tight Bézier curves and overlap avoidance matters more than packing density.

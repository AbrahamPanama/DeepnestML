# Native vs JS NFP Equivalence

This additive harness compares the Electron-native Minkowski addon against the JavaScript Clipper Minkowski path used in `main/background.js` for outer no-fit polygons.

The native addon is built against Electron's Node ABI, so run it through Electron as Node:

```sh
bash ml/tests/nfp_equivalence/run.sh
```

The harness intentionally avoids the active app code path. It uses fixed polygon fixtures, normalizes harmless differences such as point order, duplicate closing points, and collinear vertices, then checks the resulting rings for coordinate equivalence.

Current coverage:

- rectangle against rectangle
- triangle against rectangle
- concave L shape against rectangle
- irregular polygon against irregular polygon

Out of scope for this first regression:

- inner NFPs
- holes / children
- placement scoring
- renderer IPC

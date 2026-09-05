# Sparrow Sidecar

Deepnest ML bundles the `sparrow` 2D strip-packing solver as an optional native
sidecar.

- Upstream: https://github.com/JeroenGar/sparrow
- Pinned commit: `57c45cd295f5d2ce2a11edf6e765318a51d2b41e`
- Jagua dependency: `jagua-rs` 0.8.0
- Build features: `only_final_svg`
- Bundled target: Apple-silicon macOS (`darwin-arm64`)
- License: MIT; see `LICENSE`

The sidecar is invoked only when the user explicitly selects **Sparrow** or
**Hybrid** in Nesting configuration. Deepnest remains the default solver and
the exact acceptance validator for returned layouts.

On another platform, set `DEEPNEST_SPARROW_BIN` to a compatible executable
from the pinned upstream revision. The settings screen reports the solver as
unavailable when no matching sidecar can be resolved.

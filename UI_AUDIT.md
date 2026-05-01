# Main-Screen UI Audit — Deepnest ML 0.6.1

Author: Claude-Cowork
Date: 2026-04-18
Status: first pass

## Scope

This audit covers the primary user-facing surface of the app:

- `main/index.html` — structural markup, visible pages, form controls, automation hook
- `main/style.css` — layout and component styling

The audit is read-only for `main/index.html` and `main/style.css` except for a small set of **zero-risk fixes** listed below, which are already applied. The audit does not touch renderer JS or geometry code.

Out of scope for this pass: the hidden background renderer, nesting algorithm, ML pipeline, native addon, packaging. Parked items at the bottom.

## Methodology

1. Read full DOM structure of `main/index.html` (~5,081 lines), not just the visible sidenav surface, to catch orphan pages and dead controls.
2. Grep the file for invalid HTML patterns (`default` attribute on options, duplicate IDs, orphan hooks).
3. Read `main/style.css` front-to-back for the sections that drive the main screen (top nav, sidenav, home page, workspace, parts list, config panel).
4. Cross-reference CSS selectors against `index.html` to flag dead rules and vice versa.
5. Audit accessibility: ARIA attributes, landmark roles, keyboard navigation patterns.
6. Sanity-check the smoke-test harness (`ml/app-smoke-main.js`) against actual UI flows to identify coverage gaps.

Versions in scope: baseline 0.6.1.

## Priority Framework

- **P0 — Defect:** user-visible incorrect behavior, dead code shipped in production, or something that will actively confuse users / agents / support.
- **P1 — UX:** flow works but is awkward, inconsistent, or unfocused.
- **P2 — Accessibility:** blocks keyboard / screen-reader / inclusive use.
- **P3 — Polish:** visual consistency, style-code cleanup, no behavior change.

## Findings

### P0 — Defects

#### P0.1 Title string shows wrong version  ✅ FIXED

`main/index.html:4` rendered `<title>Deepnest ML 0.5</title>` while the shipped product is 0.6.1 (per `package.json` and `AGENT_COLLABORATION.md` baseline). The window/task-bar title and any external tooling that scrapes the title would report a stale version.

Fix: changed to `<title>Deepnest ML 0.6.1</title>`. Single-line edit, zero risk.

#### P0.2 Invalid `default` attribute on `<option>` elements  ✅ FIXED

Three option tags used `default` (not a valid HTML attribute) instead of the correct `selected`:

- `main/index.html:3756` — `<option value="gravity" default>Gravity</option>` (placementType)
- `main/index.html:3837` — `<option value="1" default>Points</option>` (dxfImportScale)
- `main/index.html:3848` — `<option value="72" default>Points</option>` (dxfExportScale)

Because `default` is ignored by the parser, these selects were effectively relying on "first option is chosen by default" browser behavior. That happens to produce the right initial pick here, but it means the config system can't detect the intended default, and any future reordering would silently change the initial selection. This also bakes a bad pattern into the codebase.

Fix: replaced all three with `selected`. Browser behavior is unchanged for first-option cases; now the intent is explicit.

#### P0.3 Orphan "account" page ships with no route

`main/index.html:4968-4971` contains a complete page stub:

```html
<div id="account" class="page">
    <a href="#" id="purchaseSingle">One credit</a>
</div>
```

The corresponding sidenav entry at line 3442 is commented out:

```html
<!--<li id="account_tab" data-page="account"></li>-->
```

So this page exists in the DOM but is unreachable from the main UI. `#purchaseSingle` is a leftover of the original SvgNest hosted-service commercialization. It ships dead weight in every build and is a documentation trap for anyone reading `index.html` cold.

Recommendation: remove the orphan `<div id="account">` block entirely (P0 because it's dead UI shipping in the binary) rather than preserving it behind a comment. Deferred from this pass because removing a page-level block, even a dead one, deserves its own small PR.

#### P0.4 Dead "GCode file" menu stub + 30+ lines of commented Gcode export code

- `main/index.html:3461` — commented-out list item: `<!--<li id="exportgcode">GCode file</li>-->`
- `main/index.html:2318-2365` — commented-out `exportgcode.onclick` handler inside a script block. The handler references a hosted "conversion server", which is the SvgNest legacy commercial path.

Recommendation: delete both blocks. Deferred from this pass; pairs naturally with P0.3.

#### P0.5 Dual ML model input controls

Around `main/index.html:3897-3903`, the config panel exposes *both* a `<select>` for the ML model **and** a separate `<input type="text">` for an ML model path, both wired to the same config surface. Two controls for one setting confuses users and will produce inconsistent state when one is edited but not the other.

Recommendation: collapse to a single control. The cleanest path is a `<select>` populated from whatever ML models the app discovers on disk at load, with a "Custom path…" option that reveals an inline text input. Deferred from this pass; needs a small JS change in the renderer to wire up the "Custom" mode, and should go in the same PR that tests it end-to-end.

### P1 — UX

#### P1.1 Step & Repeat fields use inline `style="display:none"` on every field

Step & Repeat is gated behind `placementType === 'steprepeat'`, and the fields are hidden per-element via repeated inline `style="display:none"` attributes. This works but:

- Muddles the markup with presentational attributes
- Makes it hard to style the group as a whole
- Creates a visible "flash of fields" on some Electron versions if the renderer runs before the config binding toggles them

Recommendation: wrap the Step & Repeat fields in a single `<div class="steprepeat-group">` and toggle visibility via a single class. Defer to a focused PR.

#### P1.2 No visible "empty state" hierarchy between workspace and parts list

The workspace pane shows generic text when empty; the parts list shows its own empty text. There's no single visual cue that says "start here → drop an SVG / PNG / PDF". First-run users don't know where to click.

Recommendation: add a single dominant drop target in the empty workspace with "Drop SVG, PNG, or PDF here" copy and a smaller link-style secondary "or use Import". Needs a renderer touch to hide the drop target once parts are loaded. Defer.

#### P1.3 Nest zoom controls are gone after rollback, but the control region still reserves space

The README and `AGENT_COLLABORATION.md` confirm nest zoom controls were attempted and rolled back. Sanity-check the CSS and markup to make sure no empty container is still reserving vertical space in the workspace header. Deferred to a follow-up pass with runtime DOM inspection.

### P2 — Accessibility

#### P2.1 Zero `aria-*` attributes and zero `role=` attributes in the entire `main/index.html`

`grep -c "aria-\|role=" main/index.html` returns **0**.

This is the biggest single accessibility gap:

- The sidenav is a `<ul>` of `<li data-page="…">` without `role="navigation"` or `aria-current`
- The tab-like sidenav does not advertise itself as a tablist
- Interactive `<div>` drop zones are not keyboard-focusable and have no `role="button"`
- Modal dialogs (error, import progress) have no `role="dialog"` / `aria-modal`
- Progress bars render only visually
- Form fields have labels via `<dt>/<dd>` pairs but no `for`/`id` association, so assistive tech can't link them

Recommendation: this is a dedicated PR, not a mechanical fix — each control type needs a decision about correct semantics. Proposed ordering:

1. Landmarks (`role="navigation"`, `role="main"`, `role="complementary"`)
2. Form label association (`<label for>` or wrap inputs in `<label>`)
3. Sidenav as tablist (`role="tablist"`, `role="tab"`, `aria-selected`)
4. Dialogs (`role="dialog"`, focus trap)
5. Buttonization of interactive divs

Defer to a focused PR, but park it high in the Upcoming Work list. Accessibility is cheap if done early and expensive once a product ships to organizations.

#### P2.2 Keyboard navigation of sidenav is not wired

The sidenav entries are clickable via mouse but there is no visible focus ring and no arrow-key traversal. Tied to P2.1.

### P3 — Polish

#### P3.1 CSS uses `!important` 38 times

Most uses are defensive (overriding inline SVG attributes or Ractive-injected inline styles). A few look like they could be removed by tightening selector specificity. Not worth a cleanup pass today; logged for reference.

#### P3.2 Font loading: `font/latolatinfonts.css` loaded ahead of `style.css`

The ordering is fine, but the font CSS link uses `media="all"` and no `rel="preload"`, so there's a brief flash of fallback typography on first paint. Negligible perf cost; ignore for now.

## Zero-Risk Fixes Applied In This Pass

Only these edits were made to shipped files:

| File | Line | Change |
| --- | --- | --- |
| `main/index.html` | 4 | `Deepnest ML 0.5` → `Deepnest ML 0.6.1` |
| `main/index.html` | 3756 | `default` → `selected` on Gravity option |
| `main/index.html` | 3837 | `default` → `selected` on DXF import Points option |
| `main/index.html` | 3848 | `default` → `selected` on DXF export Points option |

All four changes are spec-conformance / correctness. They do not change visible default behavior in any common browser. They do not touch JS, CSS, or the ML / nesting path. No rebuild of native addons is required. No new files added.

## Smoke-Test Expansion Plan

The existing harness is `ml/app-smoke-main.js`, driven by `ml/scripts/run_app_smoke_test.sh` and the automation hook at `main/index.html:3088` (`window.DeepNestAutomation`). Today the harness tests exactly one scenario: `svg-gravity-export`.

### Proposed scenarios

Each scenario is a self-contained JSON manifest that exercises a distinct UI workflow. Scenarios live in `ml/smoke/scenarios/<name>.json` and reference fixture files under `ml/smoke/fixtures/`.

| Scenario | Purpose | Fixture |
| --- | --- | --- |
| `svg-gravity` | Regression of the current single test — baseline behavior unchanged | `ml/examples/app-smoke.svg` |
| `svg-steprepeat` | Confirm Step & Repeat returns a deterministic tight pack | small svg with one repeat unit |
| `svg-export-pdf` | Export path PDF | same as svg-gravity |
| `svg-export-dxf` | Export path DXF, verify unit scaling (ties back to P0.2) | same as svg-gravity |
| `png-contour-import` | PNG → contour extraction → nest | a flat-color PNG |
| `ui-invariants` | No nesting; open the app, read sidenav state, confirm no orphan `#account` page is reachable, confirm title string. Fast (<2s) | n/a |

### Harness changes

- Add `--scenario <name>` flag to `ml/app-smoke-main.js`; default stays the single gravity path for backward compatibility.
- Factor the current scenario body into `ml/smoke/scenarios/svg-gravity.js` (one file per scenario).
- Each scenario exports `async function run(page, manifest)` and returns a structured report.
- Add `ml/scripts/run_smoke_battery.sh` wrapper that loops over all scenarios and aggregates reports into a single JSON.
- Keep `ml/scripts/run_app_smoke_test.sh` as-is so CI and humans calling the old script continue to work.
- Continue to use the `arch -x86_64` Rosetta path until we ship an arm64-native Electron bundle.

### Invariants to assert in `ui-invariants`

- `document.title` matches `Deepnest ML 0.6.1` (will catch future version-string drift)
- `document.querySelectorAll('#account').length === 0` (will start failing once P0.3 is cleaned up — update expectation at that time; until then asserts presence)
- No `<option>` tags in the config surface use the `default` attribute (catches regression of P0.2)
- Every sidenav `<li>` has a corresponding `<div class="page">` mounted (catches orphan pages)
- `DeepNest` global is present after `DOMContentLoaded + 1s`

### Out of scope for the harness expansion

- Visual regression (screenshot diffing) — valuable but orthogonal, park for later.
- Accessibility automation (axe-core, etc) — should land with the P2 work.
- Long-running nest convergence tests — those belong in the ML teacher path, not the smoke harness.

## Parked Items (Follow-Up PRs)

Listed roughly in suggested order of value vs effort:

1. **Remove orphan account page + Gcode stub** — small PR, removes dead UI (P0.3, P0.4).
2. **Collapse dual ML model controls** — small PR, needs careful renderer wiring (P0.5).
3. **Step & Repeat field grouping** — small CSS/markup cleanup (P1.1).
4. **Accessibility pass** — dedicated PR, list in P2.1.
5. **Empty state hero** — small UX improvement, moderate renderer work (P1.2).
6. **Zoom control dead-space audit** — runtime DOM check (P1.3).

## Verification

- Re-read the four edited lines in `main/index.html`; confirmed `Deepnest ML 0.6.1` title and three `selected` options are in place.
- Did not run `npm start`. Did not run `npm run dist`. Did not run the smoke harness. All four edits are HTML-attribute-level and spec-conformant; I'd want a full smoke run after the smoke expansion lands rather than on this minimal change.
- Native addon and `ml/` untouched; no checkpoint needed.

## Open Questions For User

None at this time. Parked items above can be picked up in any order.

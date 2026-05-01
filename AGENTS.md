# Deepnest++ Agent Guide

## Mission

Keep Deepnest++ working as a desktop nesting application for laser/CNC workflows.

When making changes, prioritize:

1. Correct nesting geometry
2. Stable import -> nest -> export workflows
3. Minimal, targeted edits in the active code path
4. Preserving existing behavior unless the task explicitly asks for a change

Do not drift into broad modernization or cleanup unless that is the task.

## Multi-Agent Collaboration

If another coding agent may also be working in this repository, read and update `AGENT_COLLABORATION.md`.

Use that file to claim active work, avoid file ownership conflicts, and leave handoff notes after edits.

## Use System 2 Attention First

Before acting on a request, rewrite it into this compact form:

- Mission: what outcome matters most for the user
- Relevant context: only the files, flows, and constraints that truly matter
- Question/task: the concrete thing to change or explain
- Out of scope: tempting but irrelevant cleanup or refactors
- Risks: what could break if you misunderstand the request

Then work from the rewritten version, not the raw prompt.

If the user message contains guesses, opinions, or noise, separate those from facts before editing.

## Active Architecture

Treat this as the primary execution path:

- App boot / window orchestration: `main.js`
- Visible renderer UI: `main/index.html`, `main/style.css`
- Main app controller and state: `main/deepnest.js`
- SVG parsing and cleanup: `main/svgparser.js`
- Background nesting and placement: `main/background.js`
- Geometry primitives and NFP logic: `main/util/geometryutil.js`
- Native Minkowski addon bridge: `addon.cc`
- Native Minkowski implementation: `minkowski.cc`

High-level runtime flow:

`Electron main process -> visible renderer/UI -> hidden background renderer -> native Minkowski addon`

## Read This Order First

For most tasks, read files in this order:

1. `main.js`
2. `main/index.html`
3. `main/deepnest.js`
4. `main/background.js`
5. `main/util/geometryutil.js`
6. `main/svgparser.js`
7. `addon.cc`
8. `minkowski.cc`

## Legacy Or Reference Paths

These files appear to be legacy, alternate, or reference implementations. Do not treat them as the default execution path unless the task clearly requires them:

- `main/svgnest.js`
- `main/background single.js`
- `minkowski thread.cc`
- `renderer.js`

If you touch them, explain why.

## Repo-Specific Rules

- Favor the active DeepNest path over the older SvgNest path.
- Assume the app is old and brittle: Electron 1.x, NAN, node-gyp, and Boost assumptions are real constraints here.
- Avoid casual dependency churn.
- Avoid changing geometry code without tracing the full import -> nest -> export effect.
- Keep native addon changes small and justified.
- Do not remove apparently unused code unless you confirmed it is truly dead in the active path.

## What Must Not Regress

- Importing SVG content
- DXF conversion flow expectations
- Part extraction and sheet designation
- Hole/containment relationships in polygon trees
- Spacing and polygon offset behavior
- Nest scoring and placement generation
- Exported SVG structure
- Common-line merge behavior

## Working Style

- Start from the smallest user-visible path that explains the issue.
- Prefer precise fixes over architectural rewrites.
- If a task touches geometry or placement, verify assumptions in both `deepnest.js` and `background.js`.
- If a task touches NFP behavior, inspect both `geometryutil.js` and the native addon path before changing anything.
- Call out uncertainty explicitly when the codebase has duplicate or stale implementations.

## Verification Guidance

There are not meaningful automated tests in this repo, so verification should usually be:

- targeted code-path inspection
- a focused local run if feasible
- clear reasoning about affected workflows

When you cannot run a full verification, say exactly what was and was not checked.

## Preferred Change Checklist

Before editing:

1. Rewrite the request using the S2A structure above
2. Identify the active code path
3. Ignore unrelated cleanup ideas
4. Decide the smallest safe edit

After editing:

1. Re-check the relevant workflow
2. Note assumptions
3. Mention any stale or duplicate code paths that may still exist

## ML Strategy Docs

If a task touches ML modernization, synthetic data, training automation, or architecture direction, read these first:

- `docs/README.md`
- `docs/ml-modernization.md`
- `docs/autopilot-training.md`
- `docs/synthetic-data-strategy.md`

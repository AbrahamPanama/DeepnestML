# Deepnest ML Docs

This folder captures the current plan for bringing Deepnest ML into a modern ML-assisted era without throwing away the deterministic nesting engine that already exists.

Read these in order:

1. [ML modernization strategy](./ml-modernization.md)
2. [Autopilot training architecture](./autopilot-training.md)
3. [Synthetic data and geometry coverage](./synthetic-data-strategy.md)
4. [Training Recipe Studio mockup](./training-profile-studio-mockup.html)
5. [Simple inline training profile mockup](./training-profile-inline-mockup.html)
6. [Control tower training mockup](./training-control-tower-mockup.html)

Short version:

- keep the current solver as teacher, validator, and fallback
- modernize around it, not by deleting it
- add ML first where it helps choose better decisions
- use synthetic data heavily, but not blindly
- automate training and evaluation, but gate promotion
- do not accept runtime or solver changes that silently damage the teacher path or the comparability of ML training artifacts

# ESICUP / jagua-rs Benchmark Instances

This folder contains irregular strip-packing benchmark instances used by the SOTA nesting implementation plan.

## Source

The JSON files in `instances/` were copied from the `assets/` folder of:

- Repository: https://github.com/JeroenGar/jagua-rs
- Source commit inspected/copied: `43e81373ef5ff403df708dea60162eed236dd251`
- License file in source repository: Mozilla Public License 2.0

The `jagua-rs` README states that its `assets` folder contains problem instances from the academic literature converted to a common JSON structure, and that the files are also available in Oscar Oliveira's OR-Datasets repository.

The broader ESICUP dataset index is maintained at:

- Repository: https://github.com/ESICUP/datasets
- Source commit inspected: `154a8f006a8e72f65d734f2d1e36777f678f31f8`

The ESICUP `2d_irregular/README.md` describes the original publications for the classic instances and notes that the Gardeyn set comes from:

Gardeyn, J., Berghe, G. V., & Wauters, T. (2025). "An open-source heuristic to reboot 2D nesting research." arXiv preprint https://doi.org/10.48550/arXiv.2509.13329.

## Included Instances

Classic ESICUP/literature instances:

- `albano.json`
- `blaz1.json`
- `dagli.json`
- `fu.json`
- `jakobs1.json`
- `jakobs2.json`
- `mao.json`
- `marques.json`
- `shapes0.json`
- `shapes1.json`
- `shirts.json`
- `swim.json`
- `trousers.json`

Gardeyn 90-degree rotation instances:

- `gardeyn0.json`
- `gardeyn1.json`
- `gardeyn2.json`
- `gardeyn3.json`
- `gardeyn4.json`
- `gardeyn5.json`
- `gardeyn6.json`
- `gardeyn7.json`
- `gardeyn8.json`
- `gardeyn9.json`

The `_c` continuous-rotation variants are intentionally not copied for WP-0 because Deepnest++ benchmark plumbing maps allowed orientations to the existing discrete `rotations` setting.

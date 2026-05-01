#!/usr/bin/env python3

import argparse
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.control_tower import (
    PRESET_DEFAULTS,
    build_pipeline_spec,
    initialize_pipeline_run,
    launch_pipeline_run,
    run_pipeline_foreground,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch or execute a Deepnest++ training pipeline run.")
    parser.add_argument("--run-dir", type=Path, help="Existing pipeline run directory for worker execution")
    parser.add_argument("--preset", choices=sorted(PRESET_DEFAULTS.keys()), default="quick")
    parser.add_argument("--synthetic-count", type=int)
    parser.add_argument("--benchmark-count", type=int)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--name", default="")
    parser.add_argument("--electron-binary", default=None)
    parser.add_argument("--sweep-workers", type=int, help="Parallel teacher sweep workers for config labeling stages")
    parser.add_argument("--solver-threads", type=int, help="Solver thread count written into sweep candidate configs")
    parser.add_argument(
        "--profile",
        action="append",
        dest="selected_profiles",
        default=[],
        help="Training profile id to include. Repeat to select multiple profiles.",
    )
    parser.add_argument("--foreground", action="store_true", help="Run the pipeline in the current process")
    args = parser.parse_args()

    if args.run_dir:
        state = run_pipeline_foreground(args.run_dir)
        if state.get("status") != "completed":
            raise SystemExit(1)
        return

    spec = build_pipeline_spec(
        preset=args.preset,
        synthetic_count=args.synthetic_count,
        benchmark_count=args.benchmark_count,
        seed=args.seed,
        name_hint=args.name,
        electron_binary=args.electron_binary,
        selected_profile_ids=args.selected_profiles or None,
        sweep_worker_count=args.sweep_workers,
        solver_threads=args.solver_threads,
    )

    if args.foreground:
        initialized = initialize_pipeline_run(spec)
        state = run_pipeline_foreground(initialized["run_dir"])
        if state.get("status") != "completed":
            raise SystemExit(1)
        return

    launched = launch_pipeline_run(spec)
    print("launched", launched["run_id"], "pid", launched["worker_pid"])


if __name__ == "__main__":
    main()

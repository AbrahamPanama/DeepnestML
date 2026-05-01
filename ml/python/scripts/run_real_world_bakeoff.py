#!/usr/bin/env python3

import argparse
import json
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.bakeoff import run_real_world_bakeoff
from deepnest_ml.paths import CONFIG_CANDIDATES_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Run an offline real-world bakeoff for the config recommender.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, default=CONFIG_CANDIDATES_PATH)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--max-attempts", type=int, default=2)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--electron-binary", type=Path)
    args = parser.parse_args()

    report = run_real_world_bakeoff(
        manifest_path=args.manifest,
        model_path=args.model,
        output_dir=args.output_dir,
        candidates_path=args.candidates,
        timeout_seconds=args.timeout_seconds,
        max_attempts=args.max_attempts,
        worker_count=args.workers,
        electron_binary=args.electron_binary,
    )
    print(json.dumps(report["gate_results"], indent=2))
    print("bakeoff report:", args.output_dir / "bakeoff_report.json")


if __name__ == "__main__":
    main()

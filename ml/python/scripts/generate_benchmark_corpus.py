#!/usr/bin/env python3

import argparse
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.job_generator import generate_corpus, write_jobs


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a deterministic benchmark corpus of canonical jobs.")
    parser.add_argument("--count", type=int, default=120)
    parser.add_argument("--seed", type=int, default=20260401)
    parser.add_argument("--output-dir", type=Path, default=Path("ml/artifacts/benchmark"))
    parser.add_argument(
        "--profile",
        action="append",
        dest="selected_profiles",
        default=[],
        help="Training profile id to include in the benchmark corpus. Repeat to select multiple profiles.",
    )
    args = parser.parse_args()

    jobs = generate_corpus(
        args.count,
        args.seed,
        "benchmark",
        selected_profile_ids=args.selected_profiles or None,
    )
    write_jobs(args.output_dir, jobs)
    print(f"wrote {len(jobs)} benchmark jobs to {args.output_dir}")


if __name__ == "__main__":
    main()

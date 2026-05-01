#!/usr/bin/env python3

import argparse
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.dataset import collect_run_rows, coverage_summary, write_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a labeled dataset from teacher run artifacts.")
    parser.add_argument("--runs-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    rows = collect_run_rows(args.runs_root)
    dataset_path = write_dataset(rows, args.output_dir)
    print(f"dataset rows: {len(rows)}")
    print(f"dataset parquet: {dataset_path}")
    print(f"coverage summary: {coverage_summary(rows)}")


if __name__ == "__main__":
    main()

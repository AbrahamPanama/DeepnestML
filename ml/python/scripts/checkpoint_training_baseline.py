#!/usr/bin/env python3

import argparse
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.checkpoint import create_training_checkpoint


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Snapshot the current Deepnest++ ML baseline into a named checkpoint."
    )
    parser.add_argument("--name", default="baseline", help="Human-readable checkpoint name")
    parser.add_argument("--run-id", default=None, help="Completed training run id to snapshot")
    parser.add_argument(
        "--skip-bakeoff-reports",
        action="store_true",
        help="Do not copy existing bakeoff report JSON files into the checkpoint",
    )
    args = parser.parse_args()

    result = create_training_checkpoint(
        name=args.name,
        run_id=args.run_id,
        include_bakeoff_reports=not args.skip_bakeoff_reports,
    )

    print("checkpoint:", result["checkpoint_name"])
    print("run_id:", result["selected_run_id"])
    print("path:", result["checkpoint_dir"])
    print("manifest:", result["manifest_path"])


if __name__ == "__main__":
    main()

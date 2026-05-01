#!/usr/bin/env python3

import argparse
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.training import load_dataset, train_config_recommender


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the offline config recommender.")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    dataset = load_dataset(args.dataset)
    try:
        report = train_config_recommender(dataset, args.output_dir)
    except RuntimeError as error:
        print("training preflight failed: {message}".format(message=error), file=sys.stderr)
        raise SystemExit(1)
    print(report)


if __name__ == "__main__":
    main()

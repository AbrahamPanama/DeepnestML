#!/usr/bin/env python3

import argparse
import json
import pickle
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.training import evaluate_config_recommender, load_dataset


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate the offline config recommender.")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    dataset = load_dataset(args.dataset)
    with args.model.open("rb") as handle:
        bundle = pickle.load(handle)

    report = evaluate_config_recommender(dataset, bundle)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(report)


if __name__ == "__main__":
    main()

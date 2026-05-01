#!/usr/bin/env python3

import argparse
import json
import pickle
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.features import extract_job_features
from deepnest_ml.paths import CONFIG_CANDIDATES_PATH
from deepnest_ml.schema import load_json, validate_document
from deepnest_ml.training import FEATURE_COLUMNS, require_pandas


def load_candidates(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def find_candidate(candidates, candidate_id: str):
    for candidate in candidates:
        if candidate.get("candidate_id") == candidate_id:
            return candidate
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict the best config candidate for a canonical job.")
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--candidates", type=Path, default=CONFIG_CANDIDATES_PATH)
    args = parser.parse_args()

    job = load_json(args.job)
    validate_document(job, "job.schema.json")

    with args.model.open("rb") as handle:
        bundle = pickle.load(handle)

    model = bundle["model"]
    feature_columns = bundle.get("feature_columns", FEATURE_COLUMNS)
    features = extract_job_features(job)

    pd = require_pandas()
    frame = pd.DataFrame([{column: features[column] for column in feature_columns}])
    candidate_id = str(model.predict(frame)[0])

    confidence = None
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(frame)[0]
        if len(probabilities) > 0:
            confidence = float(max(probabilities))

    candidates = load_candidates(args.candidates)
    candidate = find_candidate(candidates, candidate_id)
    payload = {
        "job_id": job["job_id"],
        "candidate_id": candidate_id,
        "confidence": confidence,
        "candidate_description": candidate.get("description") if candidate else None,
        "candidate_config": candidate.get("config") if candidate else None,
        "feature_snapshot": {column: features[column] for column in feature_columns},
        "model_path": str(args.model),
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()

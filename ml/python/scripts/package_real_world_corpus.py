#!/usr/bin/env python3

import argparse
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.bakeoff import package_real_world_corpus
from deepnest_ml.paths import REAL_WORLD_ROOT


def iter_job_paths(jobs_root: Path):
    for job_path in sorted(jobs_root.glob("*.json")):
        if job_path.name == "manifest.json" or job_path.name == "real_world_manifest.json":
            continue
        yield job_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Package canonical jobs into a local-only real-world bakeoff corpus.")
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--jobs-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=REAL_WORLD_ROOT)
    parser.add_argument("--smoke-count", type=int, default=5)
    parser.add_argument("--acceptance-count", type=int, default=25)
    args = parser.parse_args()

    job_paths = list(iter_job_paths(args.jobs_root))
    packaged = package_real_world_corpus(
        job_paths=job_paths,
        campaign_id=args.campaign_id,
        output_dir=args.output_dir,
        smoke_count=args.smoke_count,
        acceptance_count=args.acceptance_count,
    )
    print("campaign dir:", packaged["campaign_dir"])
    print("manifest:", packaged["manifest_path"])
    print("job count:", packaged["job_count"])


if __name__ == "__main__":
    main()

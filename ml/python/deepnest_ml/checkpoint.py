import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from .paths import ML_ROOT


PIPELINE_RUNS_ROOT = ML_ROOT / "artifacts" / "pipeline_runs"
REAL_WORLD_BAKEOFF_ROOT = ML_ROOT / "artifacts" / "real_world_bakeoffs"
CHECKPOINT_ROOT = ML_ROOT / "artifacts" / "checkpoints"

SOURCE_SNAPSHOT_PATHS = [
    ML_ROOT / "config_candidates.json",
    ML_ROOT / "python" / "deepnest_ml" / "job_generator.py",
    ML_ROOT / "python" / "deepnest_ml" / "features.py",
    ML_ROOT / "python" / "deepnest_ml" / "training.py",
    ML_ROOT / "python" / "deepnest_ml" / "dataset.py",
    ML_ROOT / "python" / "deepnest_ml" / "bakeoff.py",
    ML_ROOT / "python" / "deepnest_ml" / "control_tower.py",
    ML_ROOT / "python" / "scripts" / "run_training_pipeline.py",
    ML_ROOT / "python" / "scripts" / "train_config_recommender.py",
    ML_ROOT / "python" / "scripts" / "generate_synthetic_jobs.py",
    ML_ROOT / "python" / "scripts" / "generate_benchmark_corpus.py",
]


def utc_now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    cleaned = cleaned.strip("-")
    return cleaned or "baseline"


def read_json(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def find_completed_training_runs() -> List[Dict]:
    runs: List[Dict] = []
    if not PIPELINE_RUNS_ROOT.exists():
        return runs

    for run_dir in sorted(PIPELINE_RUNS_ROOT.iterdir()):
        if not run_dir.is_dir():
            continue
        state_path = run_dir / "state.json"
        model_path = run_dir / "model" / "config_recommender.pkl"
        if not state_path.exists() or not model_path.exists():
            continue
        state = read_json(state_path)
        if state.get("status") != "completed":
            continue
        runs.append(
            {
                "run_id": run_dir.name,
                "run_dir": run_dir,
                "state": state,
                "model_path": model_path,
                "mtime": model_path.stat().st_mtime,
            }
        )

    runs.sort(key=lambda item: (item["mtime"], item["run_id"]))
    return runs


def resolve_training_run(run_id: Optional[str] = None) -> Dict:
    runs = find_completed_training_runs()
    if not runs:
        raise RuntimeError("No completed training runs with a trained model were found.")

    if run_id:
        for item in runs:
            if item["run_id"] == run_id:
                return item
        raise RuntimeError(f"Training run '{run_id}' was not found among completed runs.")

    return runs[-1]


def list_bakeoff_reports() -> List[Path]:
    reports: List[Path] = []
    if not REAL_WORLD_BAKEOFF_ROOT.exists():
        return reports
    for report in sorted(REAL_WORLD_BAKEOFF_ROOT.glob("*/bakeoff_report.json")):
        reports.append(report)
    return reports


def copy_path(source: Path, destination: Path) -> None:
    if source.is_dir():
        shutil.copytree(source, destination)
    else:
        ensure_dir(destination.parent)
        shutil.copy2(source, destination)


def create_training_checkpoint(
    name: str,
    run_id: Optional[str] = None,
    include_bakeoff_reports: bool = True,
) -> Dict:
    selected_run = resolve_training_run(run_id)
    checkpoint_name = f"{utc_now_stamp()}-{slugify(name)}"
    checkpoint_dir = CHECKPOINT_ROOT / checkpoint_name
    ensure_dir(checkpoint_dir)

    copied_paths: List[Dict] = []

    run_dest = checkpoint_dir / "pipeline_run" / selected_run["run_id"]
    copy_path(selected_run["run_dir"], run_dest)
    copied_paths.append(
        {
            "type": "pipeline_run",
            "source": str(selected_run["run_dir"]),
            "destination": str(run_dest),
        }
    )

    source_snapshot_root = checkpoint_dir / "source_snapshot"
    for source_path in SOURCE_SNAPSHOT_PATHS:
        if not source_path.exists():
            continue
        relative = source_path.relative_to(ML_ROOT)
        destination = source_snapshot_root / relative
        copy_path(source_path, destination)
        copied_paths.append(
            {
                "type": "source_snapshot",
                "source": str(source_path),
                "destination": str(destination),
            }
        )

    bakeoff_entries: List[Dict] = []
    if include_bakeoff_reports:
        bakeoff_root = checkpoint_dir / "bakeoff_reports"
        for report_path in list_bakeoff_reports():
            report_dir = report_path.parent
            relative_dir = report_dir.relative_to(REAL_WORLD_BAKEOFF_ROOT)
            destination_dir = bakeoff_root / relative_dir
            ensure_dir(destination_dir)
            destination = destination_dir / report_path.name
            shutil.copy2(report_path, destination)
            bakeoff_entries.append(
                {
                    "source": str(report_path),
                    "destination": str(destination),
                }
            )

    manifest = {
        "checkpoint_name": checkpoint_name,
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "selected_run_id": selected_run["run_id"],
        "selected_model_path": str(selected_run["model_path"]),
        "selected_run_state": selected_run["state"],
        "include_bakeoff_reports": include_bakeoff_reports,
        "bakeoff_reports": bakeoff_entries,
        "copied_paths": copied_paths,
    }
    manifest_path = checkpoint_dir / "manifest.json"
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)

    return {
        "checkpoint_dir": checkpoint_dir,
        "manifest_path": manifest_path,
        "checkpoint_name": checkpoint_name,
        "selected_run_id": selected_run["run_id"],
    }

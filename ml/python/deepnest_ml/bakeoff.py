import copy
import hashlib
import json
import os
import pickle
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Dict, Iterable, List, Optional, Tuple

from .dataset import collect_run_rows
from .features import extract_job_features
from .paths import CONFIG_CANDIDATES_PATH, ML_ROOT, REPO_ROOT
from .schema import load_json, validate_document
from .training import FEATURE_COLUMNS, require_pandas


REAL_WORLD_MANIFEST_VERSION = "1.0.0"
REAL_WORLD_BAKEOFF_REPORT_VERSION = "1.0.0"
REAL_WORLD_ALLOWED_SPLITS = {"smoke", "acceptance"}


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def candidate_set_version(path: Path) -> str:
    return "{name}:{digest}".format(name=path.name, digest=file_sha256(path)[:12])


def model_version(path: Path) -> str:
    return "{name}:{digest}".format(name=path.name, digest=file_sha256(path)[:12])


def resolve_manifest_path(path_text: str, manifest_dir: Path) -> Path:
    path = Path(path_text)
    if path.is_absolute():
        return path

    manifest_relative = (manifest_dir / path).resolve()
    if manifest_relative.exists():
        return manifest_relative

    repo_relative = (REPO_ROOT / path).resolve()
    return repo_relative


def load_real_world_manifest(manifest_path: Path) -> Dict:
    manifest = load_json(manifest_path)
    if manifest.get("schema_version") not in (None, REAL_WORLD_MANIFEST_VERSION):
        raise RuntimeError(
            "Unsupported real-world manifest schema_version at {path}: {version}".format(
                path=manifest_path,
                version=manifest.get("schema_version"),
            )
        )

    campaign_id = str(manifest.get("campaign_id", "")).strip()
    jobs = manifest.get("jobs")
    if not campaign_id:
        raise RuntimeError("Real-world manifest is missing campaign_id: {path}".format(path=manifest_path))
    if not isinstance(jobs, list) or not jobs:
        raise RuntimeError("Real-world manifest must contain a non-empty jobs list: {path}".format(path=manifest_path))

    seen_job_ids = set()
    normalized_jobs = []
    for index, entry in enumerate(jobs):
        if not isinstance(entry, dict):
            raise RuntimeError("Manifest job entry #{index} is not an object".format(index=index))
        job_id = str(entry.get("job_id", "")).strip()
        canonical_job_path = str(entry.get("canonical_job_path", "")).strip()
        source_label = str(entry.get("source_label", "")).strip()
        split = str(entry.get("split", "")).strip()
        if not job_id:
            raise RuntimeError("Manifest job entry #{index} is missing job_id".format(index=index))
        if job_id in seen_job_ids:
            raise RuntimeError("Duplicate job_id in manifest: {job_id}".format(job_id=job_id))
        if not canonical_job_path:
            raise RuntimeError("Manifest job {job_id} is missing canonical_job_path".format(job_id=job_id))
        if not source_label:
            raise RuntimeError("Manifest job {job_id} is missing source_label".format(job_id=job_id))
        if split not in REAL_WORLD_ALLOWED_SPLITS:
            raise RuntimeError(
                "Manifest job {job_id} has invalid split {split}; expected one of {allowed}".format(
                    job_id=job_id,
                    split=split,
                    allowed=sorted(REAL_WORLD_ALLOWED_SPLITS),
                )
            )

        resolved_job_path = resolve_manifest_path(canonical_job_path, manifest_path.parent)
        if not resolved_job_path.exists():
            raise RuntimeError(
                "Manifest job {job_id} points to a missing canonical job: {path}".format(
                    job_id=job_id,
                    path=resolved_job_path,
                )
            )

        tags = entry.get("tags", {})
        if tags is None:
            tags = {}
        if not isinstance(tags, dict):
            raise RuntimeError("Manifest job {job_id} has non-object tags".format(job_id=job_id))

        normalized_jobs.append(
            {
                "job_id": job_id,
                "canonical_job_path": str(resolved_job_path),
                "source_label": source_label,
                "split": split,
                "tags": tags,
            }
        )
        seen_job_ids.add(job_id)

    return {
        "schema_version": manifest.get("schema_version", REAL_WORLD_MANIFEST_VERSION),
        "campaign_id": campaign_id,
        "created_at": manifest.get("created_at"),
        "jobs": normalized_jobs,
    }


def prepare_packaged_job(job: Dict, manifest_job: Dict, campaign_id: str) -> Dict:
    packaged = copy.deepcopy(job)
    validate_document(packaged, "job.schema.json")
    packaged["job_id"] = manifest_job["job_id"]
    packaged["source"] = "real_world"

    metadata = {}
    source_metadata = packaged.get("metadata")
    if isinstance(source_metadata, dict):
        metadata["source_metadata"] = source_metadata
    metadata["campaign_id"] = campaign_id
    metadata["base_job_id"] = manifest_job["job_id"]
    metadata["source_label"] = manifest_job["source_label"]
    metadata["split"] = manifest_job["split"]
    metadata["real_world_tags"] = manifest_job.get("tags", {})
    packaged["metadata"] = metadata
    return packaged


def stage_real_world_jobs(manifest: Dict, jobs_root: Path) -> List[Dict]:
    ensure_dir(jobs_root)
    staged_jobs = []
    for manifest_job in manifest["jobs"]:
        source_job = load_json(Path(manifest_job["canonical_job_path"]))
        staged_job = prepare_packaged_job(source_job, manifest_job, manifest["campaign_id"])
        staged_path = jobs_root / "{job_id}.json".format(job_id=manifest_job["job_id"])
        with staged_path.open("w", encoding="utf-8") as handle:
            json.dump(staged_job, handle, indent=2)
        staged_jobs.append(
            {
                "entry": manifest_job,
                "job": staged_job,
                "path": staged_path,
            }
        )
    return staged_jobs


def write_jsonl(path: Path, rows: Iterable[Dict]) -> Path:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    return path


def run_teacher_sweep(
    jobs_root: Path,
    runs_root: Path,
    temp_root: Path,
    candidates_path: Path,
    timeout_seconds: int,
    max_attempts: int,
    worker_count: int = 0,
    electron_binary: Optional[Path] = None,
) -> None:
    command = [
        sys.executable,
        str(ML_ROOT / "python" / "scripts" / "run_config_sweep.py"),
        "--jobs-root",
        str(jobs_root),
        "--runs-root",
        str(runs_root),
        "--temp-root",
        str(temp_root),
        "--candidates",
        str(candidates_path),
        "--timeout-seconds",
        str(timeout_seconds),
        "--max-attempts",
        str(max_attempts),
        "--workers",
        str(worker_count),
    ]
    env = None
    if electron_binary:
        env = dict(os.environ)
        env["DEEPNEST_ELECTRON_BINARY"] = str(electron_binary)
    result = subprocess.run(command, cwd=str(REPO_ROOT), env=env, check=False)
    if result.returncode != 0:
        raise RuntimeError("Config sweep failed with exit code {code}".format(code=result.returncode))


def build_model_frame(job: Dict, feature_columns: List[str]):
    pd = require_pandas()
    features = extract_job_features(job)
    return pd.DataFrame([{column: features[column] for column in feature_columns}]), features


def predict_config_candidate(job: Dict, bundle: Dict) -> Tuple[str, Optional[float]]:
    model = bundle["model"]
    feature_columns = bundle.get("feature_columns", FEATURE_COLUMNS)
    frame, _ = build_model_frame(job, feature_columns)
    predicted = str(model.predict(frame)[0])
    confidence = None
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(frame)[0]
        confidence = float(max(probabilities)) if len(probabilities) else None
    return predicted, confidence


def metric_block_from_row(row: Optional[Dict]) -> Optional[Dict]:
    if not row:
        return None
    return {
        "status": row.get("status"),
        "legal": bool(row.get("legal")),
        "failure_reason": row.get("failure_reason"),
        "utilization_ratio": float(row.get("utilization_ratio") or 0.0),
        "wall_clock_ms": float(row.get("wall_clock_ms") or 0.0),
        "used_sheet_count": int(row.get("used_sheet_count") or 0),
        "fitness": float(row.get("fitness") or 0.0),
        "placed_part_count": int(row.get("placed_part_count") or 0),
        "merged_line_length": float(row.get("merged_line_length") or 0.0),
        "config_candidate_id": row.get("config_candidate_id"),
    }


def canonical_candidate_sort_key(row: Dict) -> Tuple[float, float, float]:
    return (
        float(row.get("wall_clock_ms") or 0.0),
        float(row.get("fitness") or 0.0),
        -float(row.get("utilization_ratio") or 0.0),
    )


def select_best_legal_row(rows: List[Dict]) -> Optional[Dict]:
    legal_rows = [row for row in rows if row.get("legal") is True]
    if not legal_rows:
        return None
    return sorted(legal_rows, key=canonical_candidate_sort_key)[0]


def lookup_candidate_row(rows: List[Dict], candidate_id: str) -> Optional[Dict]:
    matches = [row for row in rows if row.get("config_candidate_id") == candidate_id]
    if not matches:
        return None
    return sorted(matches, key=canonical_candidate_sort_key)[0]


def build_win_loss_class(baseline_row: Optional[Dict], predicted_row: Optional[Dict]) -> str:
    if not predicted_row or predicted_row.get("legal") is not True:
        return "illegal_prediction"
    if not baseline_row or baseline_row.get("legal") is not True:
        return "tie"
    predicted_utilization = float(predicted_row.get("utilization_ratio") or 0.0)
    baseline_utilization = float(baseline_row.get("utilization_ratio") or 0.0)
    if predicted_utilization > baseline_utilization + 1e-9:
        return "win"
    if predicted_utilization < baseline_utilization - 1e-9:
        return "loss"
    return "tie"


def median_or_none(values: List[Optional[float]]) -> Optional[float]:
    filtered = [value for value in values if value is not None]
    if not filtered:
        return None
    return float(median(filtered))


def fraction_or_none(numerator: int, denominator: int) -> Optional[float]:
    if denominator <= 0:
        return None
    return float(numerator) / float(denominator)


def summarize_pairwise(job_rows: List[Dict], left_key: str, right_key: str, split: str = "acceptance") -> Dict:
    scoped_rows = [row for row in job_rows if row["split"] == split]
    left_metrics_key = "{key}_metrics".format(key=left_key)
    right_metrics_key = "{key}_metrics".format(key=right_key)
    candidate_key = "{key}_candidate_id".format(key=left_key)
    right_candidate_key = "{key}_candidate_id".format(key=right_key)

    comparable_rows = [
        row for row in scoped_rows if row.get(left_metrics_key) is not None and row.get(right_metrics_key) is not None
    ]
    legal_pairs = [
        row
        for row in comparable_rows
        if row[left_metrics_key].get("legal") is True and row[right_metrics_key].get("legal") is True
    ]

    utilization_deltas = [
        row[left_metrics_key]["utilization_ratio"] - row[right_metrics_key]["utilization_ratio"] for row in legal_pairs
    ]
    runtime_ratio_deltas = []
    sheet_nonworse = 0
    for row in legal_pairs:
        right_wall_clock = row[right_metrics_key]["wall_clock_ms"]
        left_wall_clock = row[left_metrics_key]["wall_clock_ms"]
        if right_wall_clock:
            runtime_ratio_deltas.append((left_wall_clock - right_wall_clock) / right_wall_clock)
        if row[left_metrics_key]["used_sheet_count"] <= row[right_metrics_key]["used_sheet_count"]:
            sheet_nonworse += 1

    exact_matches = 0
    for row in comparable_rows:
        if row.get(candidate_key) and row.get(candidate_key) == row.get(right_candidate_key):
            exact_matches += 1

    return {
        "scope_split": split,
        "job_count": len(scoped_rows),
        "comparable_job_count": len(comparable_rows),
        "legal_pair_count": len(legal_pairs),
        "median_utilization_delta": median_or_none(utilization_deltas),
        "median_runtime_delta_ratio": median_or_none(runtime_ratio_deltas),
        "sheet_count_nonworse_rate": fraction_or_none(sheet_nonworse, len(scoped_rows)),
        "exact_candidate_match_rate": fraction_or_none(exact_matches, len(comparable_rows)),
    }


def build_gate_results(job_rows: List[Dict]) -> Dict:
    acceptance_rows = [row for row in job_rows if row["split"] == "acceptance"]
    job_count = len(acceptance_rows)
    legal_predictions = sum(1 for row in acceptance_rows if row.get("predicted_legal") is True)
    loss_count = 0
    sheet_nonworse_count = 0
    utilization_deltas = []
    runtime_ratio_deltas = []

    for row in acceptance_rows:
        baseline_metrics = row.get("baseline_metrics")
        predicted_metrics = row.get("predicted_metrics")
        if predicted_metrics and predicted_metrics.get("legal") is True and baseline_metrics and baseline_metrics.get("legal") is True:
            utilization_delta = predicted_metrics["utilization_ratio"] - baseline_metrics["utilization_ratio"]
            utilization_deltas.append(utilization_delta)
            if utilization_delta < -0.005:
                loss_count += 1
            if baseline_metrics["wall_clock_ms"]:
                runtime_ratio_deltas.append(
                    (predicted_metrics["wall_clock_ms"] - baseline_metrics["wall_clock_ms"])
                    / baseline_metrics["wall_clock_ms"]
                )
            if predicted_metrics["used_sheet_count"] <= baseline_metrics["used_sheet_count"]:
                sheet_nonworse_count += 1
        else:
            loss_count += 1

    predicted_legality_rate = fraction_or_none(legal_predictions, job_count)
    median_utilization_delta = median_or_none(utilization_deltas)
    loss_rate = fraction_or_none(loss_count, job_count)
    sheet_nonworse_rate = fraction_or_none(sheet_nonworse_count, job_count)
    median_runtime_delta_ratio = median_or_none(runtime_ratio_deltas)

    acceptance_ready = job_count >= 25
    pilot_only = job_count < 25
    pass_checks = {
        "predicted_legality_rate": predicted_legality_rate == 1.0 if predicted_legality_rate is not None else False,
        "median_utilization_delta": (median_utilization_delta is not None and median_utilization_delta >= 0.01),
        "loss_rate_over_half_percent": (loss_rate is not None and loss_rate <= 0.10),
        "sheet_count_nonworse_rate": (sheet_nonworse_rate is not None and sheet_nonworse_rate >= 0.90),
        "median_runtime_delta_ratio": (
            median_runtime_delta_ratio is not None and median_runtime_delta_ratio <= 0.10
        ),
    }

    return {
        "scope_split": "acceptance",
        "acceptance_job_count": job_count,
        "pilot_only": pilot_only,
        "acceptance_ready": acceptance_ready,
        "pass": acceptance_ready and all(pass_checks.values()),
        "checks": {
            "predicted_legality_rate": {
                "passed": pass_checks["predicted_legality_rate"],
                "value": predicted_legality_rate,
                "threshold": 1.0,
            },
            "median_utilization_delta": {
                "passed": pass_checks["median_utilization_delta"],
                "value": median_utilization_delta,
                "threshold": 0.01,
            },
            "loss_rate_over_half_percent": {
                "passed": pass_checks["loss_rate_over_half_percent"],
                "value": loss_rate,
                "threshold": 0.10,
            },
            "sheet_count_nonworse_rate": {
                "passed": pass_checks["sheet_count_nonworse_rate"],
                "value": sheet_nonworse_rate,
                "threshold": 0.90,
            },
            "median_runtime_delta_ratio": {
                "passed": pass_checks["median_runtime_delta_ratio"],
                "value": median_runtime_delta_ratio,
                "threshold": 0.10,
            },
        },
    }


def flatten_bakeoff_summary(report: Dict) -> Dict:
    predicted = report["baseline_vs_predicted"]
    gate_results = report["gate_results"]
    predicted_vs_oracle = report["predicted_vs_oracle"]
    baseline_vs_oracle = report["baseline_vs_oracle"]
    return {
        "schema_version": report["schema_version"],
        "campaign_id": report["campaign_id"],
        "created_at": report["created_at"],
        "model_version": report["model_version"],
        "candidate_set_version": report["candidate_set_version"],
        "job_count": report["job_count"],
        "legal_job_count": report["legal_job_count"],
        "pilot_only": gate_results["pilot_only"],
        "acceptance_ready": gate_results["acceptance_ready"],
        "gate_pass": gate_results["pass"],
        "predicted_legality_rate": gate_results["checks"]["predicted_legality_rate"]["value"],
        "median_utilization_delta_vs_baseline": gate_results["checks"]["median_utilization_delta"]["value"],
        "loss_rate_over_half_percent": gate_results["checks"]["loss_rate_over_half_percent"]["value"],
        "sheet_count_nonworse_rate": gate_results["checks"]["sheet_count_nonworse_rate"]["value"],
        "median_runtime_delta_ratio_vs_baseline": gate_results["checks"]["median_runtime_delta_ratio"]["value"],
        "model_oracle_exact_match_rate": predicted_vs_oracle["exact_candidate_match_rate"],
        "median_oracle_headroom_vs_baseline": baseline_vs_oracle["median_utilization_delta"],
        "predicted_vs_oracle_median_utilization_delta": predicted_vs_oracle["median_utilization_delta"],
        "baseline_vs_predicted_job_count": predicted["job_count"],
    }


def flatten_job_row(report: Dict, job_row: Dict) -> Dict:
    baseline_metrics = job_row.get("baseline_metrics") or {}
    predicted_metrics = job_row.get("predicted_metrics") or {}
    oracle_metrics = job_row.get("oracle_metrics") or {}
    tags = job_row.get("tags", {})
    return {
        "campaign_id": report["campaign_id"],
        "model_version": report["model_version"],
        "candidate_set_version": report["candidate_set_version"],
        "job_id": job_row["job_id"],
        "split": job_row["split"],
        "source_label": job_row["source_label"],
        "baseline_candidate_id": job_row.get("baseline_candidate_id"),
        "predicted_candidate_id": job_row.get("predicted_candidate_id"),
        "oracle_candidate_id": job_row.get("oracle_candidate_id"),
        "predicted_confidence": job_row.get("prediction_confidence"),
        "predicted_legal": job_row.get("predicted_legal"),
        "win_loss_class": job_row.get("win_loss_class"),
        "job_status": job_row.get("job_status"),
        "job_error": job_row.get("job_error"),
        "oracle_gap": job_row.get("oracle_gap"),
        "baseline_utilization_ratio": baseline_metrics.get("utilization_ratio"),
        "predicted_utilization_ratio": predicted_metrics.get("utilization_ratio"),
        "oracle_utilization_ratio": oracle_metrics.get("utilization_ratio"),
        "baseline_wall_clock_ms": baseline_metrics.get("wall_clock_ms"),
        "predicted_wall_clock_ms": predicted_metrics.get("wall_clock_ms"),
        "oracle_wall_clock_ms": oracle_metrics.get("wall_clock_ms"),
        "baseline_used_sheet_count": baseline_metrics.get("used_sheet_count"),
        "predicted_used_sheet_count": predicted_metrics.get("used_sheet_count"),
        "oracle_used_sheet_count": oracle_metrics.get("used_sheet_count"),
        "baseline_legal": baseline_metrics.get("legal"),
        "predicted_metrics_legal": predicted_metrics.get("legal"),
        "oracle_legal": oracle_metrics.get("legal"),
        "material": tags.get("material"),
        "part_count_band": tags.get("part_count_band"),
        "complexity_band": tags.get("complexity_band"),
        "operator_notes": tags.get("operator_notes"),
    }


def package_real_world_corpus(
    job_paths: List[Path],
    campaign_id: str,
    output_dir: Path,
    smoke_count: int = 5,
    acceptance_count: int = 25,
) -> Dict:
    if not job_paths:
        raise RuntimeError("No canonical jobs were provided for real-world corpus packaging.")

    campaign_dir = output_dir if output_dir.name == campaign_id else (output_dir / campaign_id)
    jobs_dir = campaign_dir / "jobs"
    ensure_dir(jobs_dir)

    manifest_jobs = []
    for index, job_path in enumerate(job_paths):
        source_job = load_json(job_path)
        validate_document(source_job, "job.schema.json")
        anonymized_job_id = "{campaign_id}-{index:04d}".format(campaign_id=campaign_id, index=index)
        split = "acceptance"
        if index < smoke_count:
            split = "smoke"
        elif index < smoke_count + acceptance_count:
            split = "acceptance"

        packaged_job = prepare_packaged_job(
            source_job,
            {
                "job_id": anonymized_job_id,
                "source_label": "source-{index:04d}".format(index=index),
                "split": split,
                "tags": {},
            },
            campaign_id,
        )
        packaged_path = jobs_dir / "{job_id}.json".format(job_id=anonymized_job_id)
        with packaged_path.open("w", encoding="utf-8") as handle:
            json.dump(packaged_job, handle, indent=2)
        manifest_jobs.append(
            {
                "job_id": anonymized_job_id,
                "canonical_job_path": str(packaged_path.relative_to(campaign_dir)),
                "source_label": "source-{index:04d}".format(index=index),
                "split": split,
                "tags": {},
            }
        )

    manifest = {
        "schema_version": REAL_WORLD_MANIFEST_VERSION,
        "campaign_id": campaign_id,
        "created_at": utc_now_iso(),
        "jobs": manifest_jobs,
    }
    manifest_path = campaign_dir / "real_world_manifest.json"
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    return {
        "campaign_dir": campaign_dir,
        "manifest_path": manifest_path,
        "job_count": len(manifest_jobs),
    }


def run_real_world_bakeoff(
    manifest_path: Path,
    model_path: Path,
    output_dir: Path,
    candidates_path: Path = CONFIG_CANDIDATES_PATH,
    timeout_seconds: int = 180,
    max_attempts: int = 2,
    worker_count: int = 0,
    electron_binary: Optional[Path] = None,
) -> Dict:
    manifest = load_real_world_manifest(manifest_path)
    if not model_path.exists():
        raise RuntimeError("Model artifact not found: {path}".format(path=model_path))
    if not candidates_path.exists():
        raise RuntimeError("Candidate set file not found: {path}".format(path=candidates_path))

    ensure_dir(output_dir)
    staged_jobs_root = output_dir / "jobs"
    runs_root = output_dir / "runs"
    temp_root = output_dir / "tmp_sweeps"

    staged_jobs = stage_real_world_jobs(manifest, staged_jobs_root)
    run_teacher_sweep(
        jobs_root=staged_jobs_root,
        runs_root=runs_root,
        temp_root=temp_root,
        candidates_path=candidates_path,
        timeout_seconds=timeout_seconds,
        max_attempts=max_attempts,
        worker_count=worker_count,
        electron_binary=electron_binary,
    )

    candidate_rows = collect_run_rows(runs_root)
    entry_by_job_id = {entry["entry"]["job_id"]: entry for entry in staged_jobs}
    manifest_by_job_id = {entry["job_id"]: entry for entry in manifest["jobs"]}
    for row in candidate_rows:
        manifest_job = manifest_by_job_id.get(row["base_job_id"])
        if manifest_job:
            row["campaign_id"] = manifest["campaign_id"]
            row["split"] = manifest_job["split"]
            row["source_label"] = manifest_job["source_label"]

    candidate_rows_path = write_jsonl(output_dir / "bakeoff_candidate_rows.jsonl", candidate_rows)

    with model_path.open("rb") as handle:
        bundle = pickle.load(handle)

    jobs = []
    for manifest_job in manifest["jobs"]:
        job_id = manifest_job["job_id"]
        staged = entry_by_job_id[job_id]["job"]
        job_rows = [row for row in candidate_rows if row["base_job_id"] == job_id]
        job_error = None

        baseline_row = lookup_candidate_row(job_rows, "default")
        oracle_row = select_best_legal_row(job_rows)
        predicted_candidate_id, prediction_confidence = predict_config_candidate(staged, bundle)
        predicted_row = lookup_candidate_row(job_rows, predicted_candidate_id)

        if not baseline_row:
            job_error = "missing baseline default candidate row"
        if not oracle_row and not job_error:
            job_error = "no legal candidate rows available"
        if not predicted_row and not job_error:
            job_error = "predicted candidate row missing from sweep"

        predicted_legal = bool(predicted_row and predicted_row.get("legal") is True)
        oracle_gap = None
        if oracle_row and predicted_row and oracle_row.get("legal") is True and predicted_row.get("legal") is True:
            oracle_gap = float(oracle_row["utilization_ratio"]) - float(predicted_row["utilization_ratio"])

        jobs.append(
            {
                "job_id": job_id,
                "split": manifest_job["split"],
                "source_label": manifest_job["source_label"],
                "tags": manifest_job.get("tags", {}),
                "job_status": "ok" if not job_error else "error",
                "job_error": job_error,
                "baseline_candidate_id": "default",
                "predicted_candidate_id": predicted_candidate_id,
                "oracle_candidate_id": oracle_row["config_candidate_id"] if oracle_row else None,
                "prediction_confidence": prediction_confidence,
                "baseline_metrics": metric_block_from_row(baseline_row),
                "predicted_metrics": metric_block_from_row(predicted_row),
                "oracle_metrics": metric_block_from_row(oracle_row),
                "predicted_legal": predicted_legal,
                "oracle_gap": oracle_gap,
                "win_loss_class": build_win_loss_class(baseline_row, predicted_row),
            }
        )

    report = {
        "schema_version": REAL_WORLD_BAKEOFF_REPORT_VERSION,
        "campaign_id": manifest["campaign_id"],
        "created_at": utc_now_iso(),
        "manifest_path": str(manifest_path),
        "model_path": str(model_path),
        "model_version": model_version(model_path),
        "candidate_set_path": str(candidates_path),
        "candidate_set_version": candidate_set_version(candidates_path),
        "job_count": len(jobs),
        "legal_job_count": sum(1 for job in jobs if job.get("predicted_legal") is True),
        "baseline_vs_predicted": summarize_pairwise(jobs, "predicted", "baseline"),
        "baseline_vs_oracle": summarize_pairwise(jobs, "oracle", "baseline"),
        "predicted_vs_oracle": summarize_pairwise(jobs, "predicted", "oracle"),
        "gate_results": build_gate_results(jobs),
        "jobs": jobs,
        "artifacts": {
            "runs_root": str(runs_root),
            "staged_jobs_root": str(staged_jobs_root),
            "candidate_rows_path": str(candidate_rows_path),
            "job_rows_path": str(output_dir / "bakeoff_job_rows.jsonl"),
            "summary_rows_path": str(output_dir / "bakeoff_summary.jsonl"),
        },
    }

    flat_job_rows = [flatten_job_row(report, job_row) for job_row in jobs]
    flat_summary_row = flatten_bakeoff_summary(report)
    job_rows_path = write_jsonl(output_dir / "bakeoff_job_rows.jsonl", flat_job_rows)
    summary_rows_path = write_jsonl(output_dir / "bakeoff_summary.jsonl", [flat_summary_row])

    report["artifacts"]["job_rows_path"] = str(job_rows_path)
    report["artifacts"]["summary_rows_path"] = str(summary_rows_path)

    report_path = output_dir / "bakeoff_report.json"
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    return report

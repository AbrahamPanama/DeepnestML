import json
from pathlib import Path
from typing import Dict, List

from .features import flatten_run
from .schema import load_json, validate_document


def collect_run_rows(runs_root: Path) -> List[Dict]:
    rows: List[Dict] = []
    for manifest_path in runs_root.rglob("manifest.json"):
        manifest = load_json(manifest_path)
        job = load_json(Path(manifest["job_path"]))
        result = load_json(Path(manifest["result_path"]))
        validate_document(job, "job.schema.json")
        validate_document(result, "result.schema.json")
        rows.append(flatten_run(job, result, manifest))
    return rows


def size_band(value: float) -> str:
    if value < 20_000:
        return "small"
    if value < 120_000:
        return "medium"
    return "large"


def density_band(value: float) -> str:
    if value < 0.25:
        return "low"
    if value < 0.55:
        return "medium"
    return "high"


def duplicate_band(value: float) -> str:
    if value < 0.15:
        return "low"
    if value < 0.45:
        return "medium"
    return "high"


def coverage_summary(rows: List[Dict]) -> Dict:
    summary = {
        "row_count": len(rows),
        "base_job_count": 0,
        "legal_row_count": 0,
        "failed_row_count": 0,
        "legal_base_job_count": 0,
        "legal_rate": 0.0,
        "status_counts": {},
        "size_band_counts": {},
        "density_band_counts": {},
        "duplicate_band_counts": {},
    }
    base_job_ids = set()
    legal_base_job_ids = set()
    for row in rows:
        base_job_id = row.get("base_job_id")
        if base_job_id:
            base_job_ids.add(base_job_id)
        summary["status_counts"][row["status"]] = summary["status_counts"].get(row["status"], 0) + 1
        if row.get("status") == "failed":
            summary["failed_row_count"] += 1
        if row.get("legal") is True:
            summary["legal_row_count"] += 1
            if base_job_id:
                legal_base_job_ids.add(base_job_id)

        size = size_band(row["max_part_area"])
        summary["size_band_counts"][size] = summary["size_band_counts"].get(size, 0) + 1

        density = density_band(row["target_density"])
        summary["density_band_counts"][density] = summary["density_band_counts"].get(density, 0) + 1

        duplicate = duplicate_band(row["duplicate_ratio"])
        summary["duplicate_band_counts"][duplicate] = summary["duplicate_band_counts"].get(duplicate, 0) + 1
    summary["base_job_count"] = len(base_job_ids)
    summary["legal_base_job_count"] = len(legal_base_job_ids)
    if summary["row_count"] > 0:
        summary["legal_rate"] = summary["legal_row_count"] / float(summary["row_count"])
    return summary


def write_dataset(rows: List[Dict], output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_path = output_dir / "dataset.parquet"
    summary_path = output_dir / "summary.json"
    rows_path = output_dir / "dataset.jsonl"

    with rows_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")

    summary = coverage_summary(rows)
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)

    try:
        import pandas as pd

        dataframe = pd.DataFrame(rows)
        dataframe.to_parquet(dataset_path, index=False)
        return dataset_path
    except Exception:  # pragma: no cover - dependency guard
        try:
            import duckdb

            connection = duckdb.connect()
            connection.execute(
                f"copy (select * from read_json_auto('{rows_path.as_posix()}')) to '{dataset_path.as_posix()}' (format parquet)"
            )
            connection.close()
        except Exception:
            return rows_path

    return dataset_path

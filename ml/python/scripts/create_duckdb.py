#!/usr/bin/env python3

import argparse
import json
from pathlib import Path
import sys
import tempfile

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))


EMPTY_DATASET_ROWS_SQL = """
create table dataset_rows as
select
    null::varchar as run_id,
    null::varchar as base_job_id,
    null::varchar as config_candidate_id,
    null::varchar as source,
    null::varchar as status,
    null::boolean as legal,
    null::double as utilization_ratio,
    null::double as wall_clock_ms,
    null::double as max_part_area,
    null::double as target_density
where false
"""

EMPTY_BAKEOFF_SUMMARY_SQL = """
create table bakeoff_summary as
select
    null::varchar as campaign_id,
    null::varchar as created_at,
    null::boolean as gate_pass,
    null::boolean as pilot_only,
    null::double as model_oracle_exact_match_rate,
    null::double as median_utilization_delta_vs_baseline,
    null::double as predicted_legality_rate,
    null::double as median_oracle_headroom_vs_baseline,
    null::double as sheet_count_nonworse_rate,
    null::bigint as job_count
where false
"""

EMPTY_BAKEOFF_JOBS_SQL = """
create table bakeoff_jobs as
select
    null::varchar as job_id,
    null::varchar as split,
    null::varchar as predicted_candidate_id,
    null::varchar as oracle_candidate_id,
    null::double as predicted_utilization_ratio,
    null::double as baseline_utilization_ratio,
    null::boolean as predicted_metrics_legal
where false
"""


def require_duckdb():
    import duckdb  # type: ignore

    return duckdb


def main() -> None:
    parser = argparse.ArgumentParser(description="Materialize a DuckDB warehouse from run artifacts and the dataset parquet.")
    parser.add_argument("--runs-root", type=Path)
    parser.add_argument("--dataset-parquet", type=Path)
    parser.add_argument("--bakeoff-summary-jsonl", type=Path)
    parser.add_argument("--bakeoff-jobs-jsonl", type=Path)
    parser.add_argument("--bakeoff-candidate-jsonl", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    duckdb = require_duckdb()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(str(args.output))

    manifests = []
    events = []
    if args.runs_root and args.runs_root.exists():
        for manifest_path in args.runs_root.rglob("manifest.json"):
            with manifest_path.open("r", encoding="utf-8") as handle:
                manifest = json.load(handle)
            manifests.append(manifest)
            events_path = Path(manifest["events_path"])
            if events_path.exists():
                with events_path.open("r", encoding="utf-8") as handle:
                    for line in handle:
                        line = line.strip()
                        if line:
                            events.append(json.loads(line))

    connection.execute("drop table if exists runs")
    connection.execute("drop table if exists run_events")
    connection.execute("drop table if exists dataset_rows")
    connection.execute("drop table if exists bakeoff_summary")
    connection.execute("drop table if exists bakeoff_jobs")
    connection.execute("drop table if exists bakeoff_candidate_rows")

    with tempfile.TemporaryDirectory() as temp_dir:
        runs_jsonl = Path(temp_dir) / "runs.jsonl"
        events_jsonl = Path(temp_dir) / "run_events.jsonl"
        with runs_jsonl.open("w", encoding="utf-8") as handle:
            for manifest in manifests:
                handle.write(json.dumps(manifest) + "\n")
        with events_jsonl.open("w", encoding="utf-8") as handle:
            for event in events:
                handle.write(json.dumps(event) + "\n")

        if manifests:
            connection.execute(f"create table runs as select * from read_json_auto('{runs_jsonl.as_posix()}')")
        else:
            connection.execute(
                "create table runs as select null::varchar as run_id, null::varchar as status, null::varchar as created_at where false"
            )
        if events:
            connection.execute(f"create table run_events as select * from read_json_auto('{events_jsonl.as_posix()}')")
        else:
            connection.execute("create table run_events as select null::varchar as run_id where false")

    if args.dataset_parquet and args.dataset_parquet.exists():
        connection.execute(f"create table dataset_rows as select * from read_parquet('{args.dataset_parquet.as_posix()}')")
    elif args.dataset_parquet:
        jsonl_fallback = args.dataset_parquet.with_suffix(".jsonl")
        if jsonl_fallback.exists():
            connection.execute(f"create table dataset_rows as select * from read_json_auto('{jsonl_fallback.as_posix()}')")
        else:
            connection.execute(EMPTY_DATASET_ROWS_SQL)
    else:
        connection.execute(EMPTY_DATASET_ROWS_SQL)

    if args.bakeoff_summary_jsonl and args.bakeoff_summary_jsonl.exists():
        connection.execute(
            f"create table bakeoff_summary as select * from read_json_auto('{args.bakeoff_summary_jsonl.as_posix()}')"
        )
    else:
        connection.execute(EMPTY_BAKEOFF_SUMMARY_SQL)

    if args.bakeoff_jobs_jsonl and args.bakeoff_jobs_jsonl.exists():
        connection.execute(
            f"create table bakeoff_jobs as select * from read_json_auto('{args.bakeoff_jobs_jsonl.as_posix()}')"
        )
    else:
        connection.execute(EMPTY_BAKEOFF_JOBS_SQL)

    if args.bakeoff_candidate_jsonl and args.bakeoff_candidate_jsonl.exists():
        connection.execute(
            f"create table bakeoff_candidate_rows as select * from read_json_auto('{args.bakeoff_candidate_jsonl.as_posix()}')"
        )
    else:
        connection.execute("create table bakeoff_candidate_rows as select null::varchar as run_id where false")
    connection.close()
    print(f"wrote warehouse to {args.output}")


if __name__ == "__main__":
    main()

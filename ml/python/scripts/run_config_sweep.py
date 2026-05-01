#!/usr/bin/env python3

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
import platform
import signal
import shutil
import subprocess
import time
from pathlib import Path
import sys

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from deepnest_ml.paths import CONFIG_CANDIDATES_PATH, REPO_ROOT


def load_candidates(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def iter_jobs(jobs_root: Path):
    for path in sorted(jobs_root.glob("*.json")):
        if path.name == "manifest.json":
            continue
        yield path


def append_jsonl(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload) + "\n")


def resolve_worker_count(requested_workers: int) -> int:
    if requested_workers < 0:
        raise RuntimeError("--workers must be >= 0")
    if requested_workers > 0:
        return requested_workers

    cpu_count = os.cpu_count() or 1
    if sys.platform == "darwin" and platform.machine().lower() == "arm64":
        return max(1, min(cpu_count, 4))
    return 1


def run_teacher_command(command, cwd: Path, timeout_seconds: int):
    started_at = time.time()
    process = subprocess.Popen(command, cwd=cwd, start_new_session=True)
    timed_out = False

    try:
        returncode = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        returncode = process.wait()

    return {
        "returncode": returncode,
        "timed_out": timed_out,
        "duration_seconds": round(time.time() - started_at, 3),
    }


def retry_backoff_seconds(attempt: int) -> float:
    if attempt <= 1:
        return 0.0
    # Keep retries gentle on Apple Silicon workers so crash dialogs/helper
    # shutdowns have time to clear before we relaunch the next Electron child.
    return min(8.0, float(attempt - 1) * 2.0)


def prepare_candidate_job(job: dict, candidate: dict) -> dict:
    candidate_job = json.loads(json.dumps(job))
    base_job_id = job["job_id"]
    candidate_job["job_id"] = f"{base_job_id}__{candidate['candidate_id']}"
    candidate_job.setdefault("metadata", {})
    candidate_job["metadata"]["base_job_id"] = base_job_id
    candidate_job["metadata"]["config_candidate_id"] = candidate["candidate_id"]
    candidate_job["config"].update(candidate["config"])
    return candidate_job


def run_sweep_task(task: dict) -> dict:
    candidate_job = task["candidate_job"]
    variant_path = task["variant_path"]
    output_dir = task["output_dir"]
    command = task["command"]
    max_attempts = task["max_attempts"]
    timeout_seconds = task["timeout_seconds"]

    variant_path.parent.mkdir(parents=True, exist_ok=True)
    with variant_path.open("w", encoding="utf-8") as handle:
        json.dump(candidate_job, handle, indent=2)

    attempt_failures = []
    completed_run = False
    recorded_failure = False
    timeout_failures = 0
    retries_used = 0

    for attempt in range(1, max_attempts + 1):
        backoff_seconds = retry_backoff_seconds(attempt)
        if backoff_seconds > 0:
            print(
                "waiting",
                backoff_seconds,
                "seconds before retrying",
                candidate_job["job_id"],
            )
            time.sleep(backoff_seconds)

        shutil.rmtree(output_dir, ignore_errors=True)
        print(
            "running",
            " ".join(command),
            f"(attempt {attempt}/{max_attempts})",
        )
        result = run_teacher_command(command, cwd=REPO_ROOT, timeout_seconds=timeout_seconds)
        manifest_path = output_dir / "manifest.json"
        result_path = output_dir / "result.json"

        if manifest_path.exists():
            if result["returncode"] != 0:
                recorded_failure = True
                print(
                    "recorded failed teacher run for",
                    candidate_job["job_id"],
                    "(exit",
                    result["returncode"],
                    ")",
                )
            completed_run = True
            break

        failure_record = {
            "job_id": candidate_job["job_id"],
            "attempt": attempt,
            "max_attempts": max_attempts,
            "returncode": result["returncode"],
            "timed_out": result["timed_out"],
            "duration_seconds": result["duration_seconds"],
            "output_dir": str(output_dir),
            "manifest_exists": manifest_path.exists(),
            "result_exists": result_path.exists(),
        }
        attempt_failures.append(failure_record)

        if result["timed_out"]:
            timeout_failures += 1
            print(
                "teacher run timed out for",
                candidate_job["job_id"],
                "after",
                timeout_seconds,
                "seconds",
            )
        else:
            print(
                "teacher run crashed before writing manifest for",
                candidate_job["job_id"],
                "(exit",
                result["returncode"],
                ")",
            )

        if attempt < max_attempts:
            retries_used += 1
            print("retrying", candidate_job["job_id"])

    hard_failure = None
    if not completed_run:
        hard_failure = {
            "job_id": candidate_job["job_id"],
            "attempts": attempt_failures,
            "output_dir": str(output_dir),
        }

    return {
        "completed_run": completed_run,
        "recorded_failure": recorded_failure,
        "timeout_failures": timeout_failures,
        "retries_used": retries_used,
        "attempt_failures": attempt_failures,
        "hard_failure": hard_failure,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a config sweep over canonical jobs using the headless teacher harness.")
    parser.add_argument("--jobs-root", type=Path, required=True)
    parser.add_argument("--runs-root", type=Path, required=True)
    parser.add_argument("--temp-root", type=Path, default=Path("ml/artifacts/tmp_sweeps"))
    parser.add_argument("--candidates", type=Path, default=CONFIG_CANDIDATES_PATH)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--max-attempts", type=int, default=2)
    parser.add_argument(
        "--workers",
        "--concurrency",
        dest="workers",
        type=int,
        default=0,
        help="Number of parallel teacher jobs to run. Use 0 for auto-detect.",
    )
    parser.add_argument(
        "--solver-threads",
        type=int,
        default=0,
        help="Override thread count written into every candidate config before labeling. Use 0 to keep candidate defaults.",
    )
    args = parser.parse_args()

    if args.max_attempts < 1:
        raise RuntimeError("--max-attempts must be >= 1")

    candidates = load_candidates(args.candidates)
    args.runs_root.mkdir(parents=True, exist_ok=True)
    args.temp_root.mkdir(parents=True, exist_ok=True)
    worker_count = resolve_worker_count(args.workers)
    completed_runs = 0
    recorded_failures = 0
    timeout_failures = 0
    retries_used = 0
    hard_failures = []
    failures_path = args.runs_root / "sweep_failures.jsonl"
    summary_path = args.runs_root / "sweep_summary.json"
    if failures_path.exists():
        failures_path.unlink()

    tasks = []
    for job_path in iter_jobs(args.jobs_root):
        with job_path.open("r", encoding="utf-8") as handle:
            job = json.load(handle)

        for candidate in candidates:
            candidate_job = prepare_candidate_job(job, candidate)
            if args.solver_threads and args.solver_threads > 0:
                candidate_job.setdefault("config", {})
                candidate_job["config"]["threads"] = int(args.solver_threads)
            variant_path = args.temp_root / f"{candidate_job['job_id']}.json"
            output_dir = args.runs_root / candidate_job["job_id"]
            tasks.append(
                {
                    "candidate_job": candidate_job,
                    "variant_path": variant_path,
                    "output_dir": output_dir,
                    "command": [
                        "node",
                        str(REPO_ROOT / "ml/cli/run_teacher.js"),
                        "--job",
                        str(variant_path),
                        "--output-dir",
                        str(output_dir),
                    ],
                    "timeout_seconds": args.timeout_seconds,
                    "max_attempts": args.max_attempts,
                }
            )

    print("config sweep workers:", worker_count)
    if worker_count == 1:
        task_results = map(run_sweep_task, tasks)
        for task_result in task_results:
            completed_runs += int(task_result["completed_run"])
            recorded_failures += int(task_result["recorded_failure"])
            timeout_failures += int(task_result["timeout_failures"])
            retries_used += int(task_result["retries_used"])
            for failure_record in task_result["attempt_failures"]:
                append_jsonl(failures_path, failure_record)
            if task_result["hard_failure"]:
                hard_failures.append(task_result["hard_failure"])
    else:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            for task_result in executor.map(run_sweep_task, tasks):
                completed_runs += int(task_result["completed_run"])
                recorded_failures += int(task_result["recorded_failure"])
                timeout_failures += int(task_result["timeout_failures"])
                retries_used += int(task_result["retries_used"])
                for failure_record in task_result["attempt_failures"]:
                    append_jsonl(failures_path, failure_record)
                if task_result["hard_failure"]:
                    hard_failures.append(task_result["hard_failure"])

    shutil.rmtree(args.temp_root, ignore_errors=True)
    summary = {
        "completed_runs": completed_runs,
        "recorded_failures": recorded_failures,
        "timeout_failures": timeout_failures,
        "hard_failures": len(hard_failures),
        "retries_used": retries_used,
        "workers": worker_count,
        "solver_threads_override": int(args.solver_threads) if args.solver_threads and args.solver_threads > 0 else None,
        "failure_log_path": str(failures_path),
    }
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)
    print("config sweep summary:", summary)
    if hard_failures:
        print(
            "warning:",
            len(hard_failures),
            "teacher runs failed without a manifest; continuing with the available dataset",
        )


if __name__ == "__main__":
    main()

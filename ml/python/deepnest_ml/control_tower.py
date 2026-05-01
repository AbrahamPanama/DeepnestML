import json
import os
import re
import shlex
import signal
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from .paths import CONFIG_CANDIDATES_PATH, ML_ROOT, REPO_ROOT
from .training_profiles import DEFAULT_SELECTED_PROFILE_IDS, resolve_training_profiles


PIPELINE_RUNS_ROOT = ML_ROOT / "artifacts" / "pipeline_runs"
ACTIVE_RUN_LOCK_PATH = PIPELINE_RUNS_ROOT / "active_run.json"
RUNNER_SCRIPT = ML_ROOT / "python" / "scripts" / "run_training_pipeline.py"
DEFAULT_NATIVE_ELECTRON_BINARY = REPO_ROOT / "node_modules" / "electron" / "dist" / "Electron.app" / "Contents" / "MacOS" / "Electron"
DEFAULT_LEGACY_ELECTRON_BINARY = REPO_ROOT / ".legacy" / "electron-v1.4.13-darwin-x64" / "Electron.app" / "Contents" / "MacOS" / "Electron"
DEFAULT_BAKEOFF_REPORT_ROOT = ML_ROOT / "artifacts" / "real_world_bakeoffs"

PRESET_DEFAULTS = {}


def resolve_default_electron_binary() -> Path:
    if DEFAULT_NATIVE_ELECTRON_BINARY.exists():
        return DEFAULT_NATIVE_ELECTRON_BINARY
    return DEFAULT_LEGACY_ELECTRON_BINARY


def is_apple_silicon_host() -> bool:
    if sys.platform != "darwin":
        return False
    try:
        return os.uname().machine.lower() == "arm64"
    except AttributeError:
        return False


def recommended_sweep_worker_count() -> int:
    cpu_count = os.cpu_count() or 1
    if is_apple_silicon_host():
        return max(1, min(cpu_count, 4, max(2, cpu_count // 2)))
    return 1


def recommended_solver_threads() -> int:
    return 1


DEFAULT_SWEEP_WORKER_COUNT = recommended_sweep_worker_count()
DEFAULT_SOLVER_THREADS = recommended_solver_threads()


PRESET_DEFAULTS.update(
    {
        "quick": {
            "synthetic_count": 12,
            "benchmark_count": 0,
            "seed": 20260402,
            "sweep_worker_count": min(3, DEFAULT_SWEEP_WORKER_COUNT),
            "solver_threads": DEFAULT_SOLVER_THREADS,
        },
        "standard": {
            "synthetic_count": 50,
            "benchmark_count": 10,
            "seed": 20260402,
            "sweep_worker_count": DEFAULT_SWEEP_WORKER_COUNT,
            "solver_threads": DEFAULT_SOLVER_THREADS,
        },
        "overnight": {
            "synthetic_count": 200,
            "benchmark_count": 25,
            "seed": 20260402,
            "sweep_worker_count": DEFAULT_SWEEP_WORKER_COUNT,
            "solver_threads": DEFAULT_SOLVER_THREADS,
        },
        "custom": {
            "synthetic_count": 24,
            "benchmark_count": 4,
            "seed": 20260402,
            "sweep_worker_count": DEFAULT_SWEEP_WORKER_COUNT,
            "solver_threads": DEFAULT_SOLVER_THREADS,
        },
    }
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "run"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Dict) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def append_log(path: Path, message: str) -> None:
    ensure_dir(path.parent)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(message)


def normalize_positive_int(value, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return number if number >= 1 else fallback


def process_alive(pid: Optional[int]) -> bool:
    if not pid:
        return False
    try:
        output = subprocess.check_output(["ps", "-p", str(pid), "-o", "stat="], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return False
    if not output:
        return False
    return "Z" not in output


def get_run_paths(run_dir: Path) -> Dict[str, Path]:
    return {
        "run_dir": run_dir,
        "spec_path": run_dir / "spec.json",
        "state_path": run_dir / "state.json",
        "log_path": run_dir / "pipeline.log",
        "jobs_root": run_dir / "jobs",
        "synthetic_jobs_root": run_dir / "jobs" / "synthetic",
        "benchmark_jobs_root": run_dir / "jobs" / "benchmark",
        "runs_root": run_dir / "runs",
        "dataset_dir": run_dir / "dataset",
        "model_dir": run_dir / "model",
        "warehouse_path": run_dir / "warehouse" / "deepnest.duckdb",
        "real_world_jobs_root": run_dir / "jobs" / "real_world",
        "real_world_runs_root": run_dir / "runs" / "real_world",
        "bakeoff_output_dir": run_dir / "bakeoff",
    }


def get_default_spec(preset: str) -> Dict:
    base = PRESET_DEFAULTS.get(preset, PRESET_DEFAULTS["quick"]).copy()
    base["preset"] = preset
    return base


def build_pipeline_spec(
    preset: str,
    synthetic_count: Optional[int] = None,
    benchmark_count: Optional[int] = None,
    seed: Optional[int] = None,
    name_hint: str = "",
    electron_binary: Optional[str] = None,
    selected_profile_ids: Optional[List[str]] = None,
    sweep_worker_count: Optional[int] = None,
    solver_threads: Optional[int] = None,
    enable_snapshots: bool = False,
) -> Dict:
    spec = get_default_spec(preset)
    spec["run_type"] = "training_pipeline"
    if synthetic_count is not None:
        spec["synthetic_count"] = int(synthetic_count)
    if benchmark_count is not None:
        spec["benchmark_count"] = int(benchmark_count)
    if seed is not None:
        spec["seed"] = int(seed)

    spec["name_hint"] = name_hint.strip()
    spec["electron_binary"] = electron_binary or str(resolve_default_electron_binary())
    spec["config_candidates"] = str(CONFIG_CANDIDATES_PATH)
    spec["selected_profile_ids"] = (
        DEFAULT_SELECTED_PROFILE_IDS[:] if selected_profile_ids is None else list(selected_profile_ids)
    )
    spec["sweep_worker_count"] = normalize_positive_int(sweep_worker_count, recommended_sweep_worker_count())
    spec["solver_threads"] = normalize_positive_int(solver_threads, recommended_solver_threads())
    spec["enable_snapshots"] = bool(enable_snapshots)
    return spec


def build_bakeoff_spec(
    manifest_path: str,
    model_path: str,
    name_hint: str = "",
    bakeoff_output_dir: str = "",
    electron_binary: Optional[str] = None,
    enable_snapshots: bool = False,
) -> Dict:
    spec = {
        "run_type": "real_world_bakeoff",
        "manifest_path": manifest_path.strip(),
        "model_path": model_path.strip(),
        "name_hint": name_hint.strip() or "bakeoff",
        "electron_binary": electron_binary or str(resolve_default_electron_binary()),
        "config_candidates": str(CONFIG_CANDIDATES_PATH),
        "enable_snapshots": bool(enable_snapshots),
    }
    if bakeoff_output_dir.strip():
        spec["bakeoff_output_dir"] = bakeoff_output_dir.strip()
    return spec


def build_run_id(spec: Dict) -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = spec.get("name_hint") or spec.get("preset") or "run"
    return "{timestamp}-{suffix}".format(timestamp=timestamp, suffix=slugify(str(suffix)))


def resolve_bakeoff_output_dir(spec: Dict, paths: Dict[str, Path]) -> Path:
    configured = str(spec.get("bakeoff_output_dir", "")).strip()
    if configured:
        path = Path(configured)
        if not path.is_absolute():
            path = (REPO_ROOT / path).resolve()
        return path
    return paths["bakeoff_output_dir"]


def resolve_repo_relative_path(path_text: str) -> Path:
    path = Path(path_text)
    if path.is_absolute():
        return path
    return (REPO_ROOT / path).resolve()


def read_active_run_lock() -> Optional[Dict]:
    payload = read_json(ACTIVE_RUN_LOCK_PATH)
    if not payload:
        return None
    pid = payload.get("pid")
    if not process_alive(pid):
        try:
            ACTIVE_RUN_LOCK_PATH.unlink()
        except OSError:
            pass
        return None
    return payload


def write_active_run_lock(run_id: str, pid: int) -> None:
    ensure_dir(ACTIVE_RUN_LOCK_PATH.parent)
    write_json(
        ACTIVE_RUN_LOCK_PATH,
        {
            "run_id": run_id,
            "pid": pid,
            "timestamp": utc_now_iso(),
        },
    )


def clear_active_run_lock(run_id: Optional[str] = None, pid: Optional[int] = None) -> None:
    payload = read_json(ACTIVE_RUN_LOCK_PATH)
    if not payload:
        return
    if run_id and payload.get("run_id") != run_id:
        return
    if pid and payload.get("pid") != pid:
        return
    try:
        ACTIVE_RUN_LOCK_PATH.unlink()
    except OSError:
        pass


def list_process_relationships() -> Dict[int, List[int]]:
    output = subprocess.check_output(["ps", "-axo", "pid=,ppid="], text=True)
    relationships: Dict[int, List[int]] = {}
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        pid_text, ppid_text = line.split(None, 1)
        pid = int(pid_text)
        ppid = int(ppid_text)
        relationships.setdefault(ppid, []).append(pid)
    return relationships


def collect_descendant_pids(root_pid: int) -> List[int]:
    relationships = list_process_relationships()
    stack = [root_pid]
    descendants: List[int] = []
    seen = set()

    while stack:
        current = stack.pop()
        for child_pid in relationships.get(current, []):
            if child_pid in seen:
                continue
            seen.add(child_pid)
            descendants.append(child_pid)
            stack.append(child_pid)

    return descendants


def kill_pid_list(pids: List[int], grace_seconds: float = 3.0) -> List[int]:
    unique_pids = []
    for pid in pids:
        if pid not in unique_pids:
            unique_pids.append(pid)

    for pid in reversed(unique_pids):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass

    deadline = time.time() + grace_seconds
    while time.time() < deadline:
        alive = [pid for pid in unique_pids if process_alive(pid)]
        if not alive:
            return []
        time.sleep(0.1)

    alive = [pid for pid in unique_pids if process_alive(pid)]
    for pid in reversed(alive):
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass

    time.sleep(0.2)
    return [pid for pid in unique_pids if process_alive(pid)]


def build_stage_definitions(spec: Dict, paths: Dict[str, Path]) -> List[Dict]:
    python_executable = sys.executable
    electron_binary = spec["electron_binary"]
    shared_env = {"DEEPNEST_ELECTRON_BINARY": electron_binary}
    if spec.get("enable_snapshots"):
        shared_env["DEEPNEST_TEACHER_SNAPSHOTS"] = "1"
        shared_env["DEEPNEST_TEACHER_SNAPSHOT_HISTORY"] = "1"
    stages: List[Dict] = []
    sweep_worker_count = normalize_positive_int(spec.get("sweep_worker_count"), recommended_sweep_worker_count())
    solver_threads = normalize_positive_int(spec.get("solver_threads"), recommended_solver_threads())
    sweep_candidates_path = spec.get("effective_config_candidates") or spec["config_candidates"]

    if spec.get("run_type") == "real_world_bakeoff":
        bakeoff_output_dir = resolve_bakeoff_output_dir(spec, paths)
        stages.extend(
            [
                {
                    "id": "run_real_world_bakeoff",
                    "label": "Run real-world bakeoff",
                    "command": [
                        python_executable,
                        str(ML_ROOT / "python" / "scripts" / "run_real_world_bakeoff.py"),
                        "--manifest",
                        spec["manifest_path"],
                        "--model",
                        spec["model_path"],
                        "--output-dir",
                        str(bakeoff_output_dir),
                        "--candidates",
                        spec["config_candidates"],
                    ],
                    "env": shared_env,
                },
                {
                    "id": "materialize_warehouse",
                    "label": "Build bakeoff warehouse",
                    "command": [
                        python_executable,
                        str(ML_ROOT / "python" / "scripts" / "create_duckdb.py"),
                        "--runs-root",
                        str(bakeoff_output_dir / "runs"),
                        "--output",
                        str(paths["warehouse_path"]),
                        "--bakeoff-summary-jsonl",
                        str(bakeoff_output_dir / "bakeoff_summary.jsonl"),
                        "--bakeoff-jobs-jsonl",
                        str(bakeoff_output_dir / "bakeoff_job_rows.jsonl"),
                        "--bakeoff-candidate-jsonl",
                        str(bakeoff_output_dir / "bakeoff_candidate_rows.jsonl"),
                    ],
                },
            ]
        )
        return stages

    if spec.get("synthetic_count", 0) > 0:
        command = [
            python_executable,
            str(ML_ROOT / "python" / "scripts" / "generate_synthetic_jobs.py"),
            "--count",
            str(spec["synthetic_count"]),
            "--seed",
            str(spec["seed"]),
            "--output-dir",
            str(paths["synthetic_jobs_root"]),
        ]
        for profile_id in spec.get("selected_profile_ids", []):
            command.extend(["--profile", profile_id])
        stages.append(
            {
                "id": "generate_synthetic",
                "label": "Generate synthetic jobs",
                "command": command,
            }
        )

    if spec.get("benchmark_count", 0) > 0:
        command = [
            python_executable,
            str(ML_ROOT / "python" / "scripts" / "generate_benchmark_corpus.py"),
            "--count",
            str(spec["benchmark_count"]),
            "--seed",
            str(spec["seed"]),
            "--output-dir",
            str(paths["benchmark_jobs_root"]),
        ]
        for profile_id in spec.get("selected_profile_ids", []):
            command.extend(["--profile", profile_id])
        stages.append(
            {
                "id": "generate_benchmark",
                "label": "Generate benchmark jobs",
                "command": command,
            }
        )

    if spec.get("synthetic_count", 0) > 0:
        stages.append(
            {
                "id": "sweep_synthetic",
                "label": "Label synthetic jobs with teacher",
                "command": [
                    python_executable,
                    str(ML_ROOT / "python" / "scripts" / "run_config_sweep.py"),
                    "--jobs-root",
                    str(paths["synthetic_jobs_root"]),
                    "--runs-root",
                    str(paths["runs_root"] / "synthetic"),
                    "--temp-root",
                    str(paths["run_dir"] / "tmp_sweeps" / "synthetic"),
                    "--candidates",
                    sweep_candidates_path,
                    "--workers",
                    str(sweep_worker_count),
                    "--solver-threads",
                    str(solver_threads),
                ],
                "env": shared_env,
                "runner": "config_sweep",
                "python_executable": python_executable,
                "script_path": str(ML_ROOT / "python" / "scripts" / "run_config_sweep.py"),
                "jobs_root": str(paths["synthetic_jobs_root"]),
                "runs_root": str(paths["runs_root"] / "synthetic"),
                "temp_root": str(paths["run_dir"] / "tmp_sweeps" / "synthetic"),
                "candidates_path": sweep_candidates_path,
                "timeout_seconds": 180,
                "max_attempts": 2,
                "sweep_worker_count": sweep_worker_count,
                "solver_threads": solver_threads,
            }
        )

    if spec.get("benchmark_count", 0) > 0:
        stages.append(
            {
                "id": "sweep_benchmark",
                "label": "Label benchmark jobs with teacher",
                "command": [
                    python_executable,
                    str(ML_ROOT / "python" / "scripts" / "run_config_sweep.py"),
                    "--jobs-root",
                    str(paths["benchmark_jobs_root"]),
                    "--runs-root",
                    str(paths["runs_root"] / "benchmark"),
                    "--temp-root",
                    str(paths["run_dir"] / "tmp_sweeps" / "benchmark"),
                    "--candidates",
                    sweep_candidates_path,
                    "--workers",
                    str(sweep_worker_count),
                    "--solver-threads",
                    str(solver_threads),
                ],
                "env": shared_env,
                "runner": "config_sweep",
                "python_executable": python_executable,
                "script_path": str(ML_ROOT / "python" / "scripts" / "run_config_sweep.py"),
                "jobs_root": str(paths["benchmark_jobs_root"]),
                "runs_root": str(paths["runs_root"] / "benchmark"),
                "temp_root": str(paths["run_dir"] / "tmp_sweeps" / "benchmark"),
                "candidates_path": sweep_candidates_path,
                "timeout_seconds": 180,
                "max_attempts": 2,
                "sweep_worker_count": sweep_worker_count,
                "solver_threads": solver_threads,
            }
        )

    if spec.get("enable_snapshots"):
        stages.append(
            {
                "id": "generate_snapshot_viewers",
                "label": "Generate snapshot viewers",
                "command": [
                    "node",
                    str(ML_ROOT / "scripts" / "generate-viewers.js"),
                    "--runs-root",
                    str(paths["runs_root"]),
                ],
            }
        )

    stages.extend(
        [
            {
                "id": "build_dataset",
                "label": "Build labeled dataset",
                "command": [
                    python_executable,
                    str(ML_ROOT / "python" / "scripts" / "build_dataset.py"),
                    "--runs-root",
                    str(paths["runs_root"]),
                    "--output-dir",
                    str(paths["dataset_dir"]),
                ],
            },
            {
                "id": "materialize_warehouse",
                "label": "Build dashboard warehouse",
                "command": [
                    python_executable,
                    str(ML_ROOT / "python" / "scripts" / "create_duckdb.py"),
                    "--runs-root",
                    str(paths["runs_root"]),
                    "--dataset-parquet",
                    str(paths["dataset_dir"] / "dataset.parquet"),
                    "--output",
                    str(paths["warehouse_path"]),
                ],
            },
            {
                "id": "train_model",
                "label": "Train config recommender",
                "command": [
                    python_executable,
                    str(ML_ROOT / "python" / "scripts" / "train_config_recommender.py"),
                    "--dataset",
                    str(paths["dataset_dir"] / "dataset.parquet"),
                    "--output-dir",
                    str(paths["model_dir"]),
                ],
            },
            {
                "id": "evaluate_model",
                "label": "Evaluate config recommender",
                "command": [
                    python_executable,
                    str(ML_ROOT / "python" / "scripts" / "evaluate_config_recommender.py"),
                    "--dataset",
                    str(paths["dataset_dir"] / "dataset.parquet"),
                    "--model",
                    str(paths["model_dir"] / "config_recommender.pkl"),
                    "--output",
                    str(paths["model_dir"] / "eval.json"),
                ],
            },
        ]
    )
    return stages


def create_initial_state(run_id: str, spec: Dict, paths: Dict[str, Path]) -> Dict:
    stage_total = len(build_stage_definitions(spec, paths))
    return {
        "run_id": run_id,
        "status": "queued",
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
        "started_at": None,
        "completed_at": None,
        "current_stage": None,
        "error": None,
        "worker_pid": None,
        "paths": {key: str(value) for key, value in paths.items()},
        "spec": spec,
        "progress": {
            "completed_stages": 0,
            "total_stages": stage_total,
        },
        "stages": [],
        "artifacts": {},
        "metrics": {},
    }


def read_pipeline_state(run_dir: Path) -> Optional[Dict]:
    state = read_json(get_run_paths(run_dir)["state_path"])
    if not state:
        return None
    return reconcile_pipeline_state(run_dir, state)


def write_pipeline_state(run_dir: Path, state: Dict) -> None:
    state["updated_at"] = utc_now_iso()
    write_json(get_run_paths(run_dir)["state_path"], state)


def reconcile_pipeline_state(run_dir: Path, state: Dict) -> Dict:
    status = state.get("status")
    worker_pid = state.get("worker_pid")
    if status in ("queued", "running") and worker_pid and not process_alive(worker_pid):
        state["status"] = "failed"
        state["completed_at"] = state.get("completed_at") or utc_now_iso()
        state["error"] = state.get("error") or {
            "message": "Pipeline worker exited unexpectedly.",
        }
        write_pipeline_state(run_dir, state)
    return state


def refresh_artifact_summary(run_dir: Path, state: Dict) -> Dict:
    paths = get_run_paths(run_dir)
    spec = state.get("spec", {})
    bakeoff_output_dir = resolve_bakeoff_output_dir(spec, paths)
    dataset_summary = read_json(paths["dataset_dir"] / "summary.json", {})
    training_report = read_json(paths["model_dir"] / "training_report.json", {})
    evaluation_report = read_json(paths["model_dir"] / "eval.json", {})
    bakeoff_report = read_json(bakeoff_output_dir / "bakeoff_report.json", {})
    bakeoff_gate_results = bakeoff_report.get("gate_results", {})
    bakeoff_checks = bakeoff_gate_results.get("checks", {})

    state["artifacts"] = {
        "dataset_summary_path": str(paths["dataset_dir"] / "summary.json"),
        "training_report_path": str(paths["model_dir"] / "training_report.json"),
        "evaluation_report_path": str(paths["model_dir"] / "eval.json"),
        "warehouse_path": str(paths["warehouse_path"]),
        "bakeoff_output_dir": str(bakeoff_output_dir),
        "bakeoff_report_path": str(bakeoff_output_dir / "bakeoff_report.json"),
    }
    if spec.get("effective_config_candidates"):
        state["artifacts"]["effective_config_candidates_path"] = str(spec["effective_config_candidates"])
    state["metrics"] = {
        "dataset_row_count": dataset_summary.get("row_count"),
        "legal_row_count": dataset_summary.get("legal_row_count"),
        "legal_base_job_count": dataset_summary.get("legal_base_job_count"),
        "test_accuracy": training_report.get("test_accuracy"),
        "evaluated_jobs": evaluation_report.get("evaluated_jobs"),
        "median_runtime_delta_ms_vs_default": evaluation_report.get("median_runtime_delta_ms_vs_default"),
        "median_utilization_delta_vs_default": evaluation_report.get("median_utilization_delta_vs_default"),
        "bakeoff_job_count": bakeoff_report.get("job_count"),
        "bakeoff_legal_job_count": bakeoff_report.get("legal_job_count"),
        "bakeoff_pilot_only": bakeoff_gate_results.get("pilot_only"),
        "bakeoff_gate_pass": bakeoff_gate_results.get("pass"),
        "bakeoff_predicted_legality_rate": bakeoff_checks.get("predicted_legality_rate", {}).get("value"),
        "bakeoff_median_utilization_delta_vs_default": bakeoff_checks.get("median_utilization_delta", {}).get("value"),
        "bakeoff_model_oracle_match_rate": bakeoff_report.get("predicted_vs_oracle", {}).get("exact_candidate_match_rate"),
    }
    return state


def run_logged_stage_command(command: List[str], cwd: Path, env: Dict[str, str], log_path: Path) -> subprocess.CompletedProcess:
    with log_path.open("a", encoding="utf-8") as handle:
        return subprocess.run(
            command,
            cwd=str(cwd),
            env=env,
            stdout=handle,
            stderr=subprocess.STDOUT,
            check=False,
        )


def iter_sweep_job_paths(jobs_root: Path) -> List[Path]:
    return [path for path in sorted(jobs_root.glob("*.json")) if path.name != "manifest.json"]


def partition_job_paths(job_paths: List[Path], shard_count: int) -> List[List[Path]]:
    shards = [[] for _ in range(shard_count)]
    for index, job_path in enumerate(job_paths):
        shards[index % shard_count].append(job_path)
    return [shard for shard in shards if shard]


def build_sweep_command(stage: Dict, jobs_root: Path, runs_root: Path, temp_root: Path) -> List[str]:
    command = [
        stage["python_executable"],
        stage["script_path"],
        "--jobs-root",
        str(jobs_root),
        "--runs-root",
        str(runs_root),
        "--temp-root",
        str(temp_root),
        "--candidates",
        stage["candidates_path"],
        "--timeout-seconds",
        str(stage.get("timeout_seconds", 180)),
        "--max-attempts",
        str(stage.get("max_attempts", 2)),
        "--workers",
        "1",
    ]
    solver_threads = normalize_positive_int(stage.get("solver_threads"), 0)
    if solver_threads > 0:
        command.extend(["--solver-threads", str(solver_threads)])
    return command


def run_config_sweep_stage(stage: Dict, cwd: Path, env: Dict[str, str], log_path: Path) -> int:
    jobs_root = Path(stage["jobs_root"])
    job_paths = iter_sweep_job_paths(jobs_root)
    if not job_paths:
        append_log(log_path, "no canonical jobs found under {root}\n".format(root=jobs_root))
        return 0

    requested_worker_count = normalize_positive_int(
        stage.get("sweep_worker_count"),
        recommended_sweep_worker_count(),
    )
    worker_count = min(requested_worker_count, len(job_paths))
    if worker_count <= 1:
        return run_logged_stage_command(stage["command"], cwd, env, log_path).returncode

    runs_root = Path(stage["runs_root"])
    temp_root = Path(stage["temp_root"])
    shard_root = temp_root.parent / "{stage_id}_job_shards".format(stage_id=stage["id"])
    log_root = temp_root.parent / "{stage_id}_logs".format(stage_id=stage["id"])
    shutil.rmtree(shard_root, ignore_errors=True)
    shutil.rmtree(log_root, ignore_errors=True)
    ensure_dir(shard_root)
    ensure_dir(log_root)

    shard_groups = partition_job_paths(job_paths, worker_count)
    append_log(
        log_path,
        "parallel sweep enabled: {count} workers, solver threads={threads}\n".format(
            count=len(shard_groups),
            threads=stage.get("solver_threads"),
        ),
    )

    processes = []
    for index, shard_jobs in enumerate(shard_groups):
        shard_id = "worker-{index:02d}".format(index=index + 1)
        shard_jobs_root = shard_root / shard_id / "jobs"
        shard_runs_root = runs_root / shard_id
        shard_temp_root = temp_root / shard_id
        shard_log_path = log_root / "{shard_id}.log".format(shard_id=shard_id)
        shutil.rmtree(shard_jobs_root.parent, ignore_errors=True)
        shutil.rmtree(shard_runs_root, ignore_errors=True)
        shutil.rmtree(shard_temp_root, ignore_errors=True)
        ensure_dir(shard_jobs_root)
        ensure_dir(shard_runs_root)

        for job_path in shard_jobs:
            shutil.copy2(job_path, shard_jobs_root / job_path.name)

        command = build_sweep_command(stage, shard_jobs_root, shard_runs_root, shard_temp_root)
        append_log(log_path, "$ {command} > {log_path}\n".format(command=shlex.join(command), log_path=shard_log_path))
        handle = shard_log_path.open("a", encoding="utf-8")
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=env,
            stdout=handle,
            stderr=subprocess.STDOUT,
        )
        processes.append(
            {
                "id": shard_id,
                "process": process,
                "handle": handle,
                "log_path": shard_log_path,
                "job_count": len(shard_jobs),
            }
        )

    failed_returncode = 0
    for record in processes:
        returncode = record["process"].wait()
        record["handle"].close()
        append_log(
            log_path,
            "[{shard_id}] exit={code} jobs={count} log={log_path}\n".format(
                shard_id=record["id"],
                code=returncode,
                count=record["job_count"],
                log_path=record["log_path"],
            ),
        )
        if returncode != 0 and failed_returncode == 0:
            failed_returncode = returncode

    return failed_returncode


def upsert_stage(state: Dict, stage_id: str, payload: Dict) -> None:
    stages = state.setdefault("stages", [])
    for stage in stages:
        if stage.get("id") == stage_id:
            stage.update(payload)
            return
    record = {"id": stage_id}
    record.update(payload)
    stages.append(record)


def initialize_pipeline_run(spec: Dict) -> Dict:
    ensure_dir(PIPELINE_RUNS_ROOT)
    active = read_active_run_lock()
    if active:
        raise RuntimeError("Another control-tower run is already active: {run_id}".format(run_id=active["run_id"]))

    run_type = spec.get("run_type", "training_pipeline")
    if run_type == "real_world_bakeoff":
        manifest_path = resolve_repo_relative_path(spec.get("manifest_path", ""))
        model_path = resolve_repo_relative_path(spec.get("model_path", ""))
        if not manifest_path.exists():
            raise RuntimeError("Missing real-world manifest at {path}".format(path=manifest_path))
        if not model_path.exists():
            raise RuntimeError("Missing model artifact at {path}".format(path=model_path))
        spec["manifest_path"] = str(manifest_path)
        spec["model_path"] = str(model_path)
    else:
        if int(spec.get("synthetic_count", 0)) <= 0 and int(spec.get("benchmark_count", 0)) <= 0:
            raise RuntimeError("A training run needs at least one synthetic or benchmark job.")
        spec["sweep_worker_count"] = normalize_positive_int(
            spec.get("sweep_worker_count"),
            recommended_sweep_worker_count(),
        )
        spec["solver_threads"] = normalize_positive_int(
            spec.get("solver_threads"),
            recommended_solver_threads(),
        )
        resolved_profiles = resolve_training_profiles(spec.get("selected_profile_ids"))
        if int(spec.get("synthetic_count", 0)) > 0 and not resolved_profiles:
            raise RuntimeError("Select at least one training profile before launching synthetic training.")
        spec["selected_profile_ids"] = [profile["profile_id"] for profile in resolved_profiles]
        spec["selected_profile_names"] = [profile["name"] for profile in resolved_profiles]

    if not Path(spec.get("config_candidates", "")).exists():
        raise RuntimeError("Missing config candidates file at {path}".format(path=spec.get("config_candidates")))

    run_id = build_run_id(spec)
    run_dir = PIPELINE_RUNS_ROOT / run_id
    ensure_dir(run_dir)
    paths = get_run_paths(run_dir)
    ensure_dir(paths["run_dir"])

    if run_type != "real_world_bakeoff":
        source_candidates_path = Path(spec["config_candidates"])
        with source_candidates_path.open("r", encoding="utf-8") as handle:
            effective_candidates = json.load(handle)
        for candidate in effective_candidates:
            candidate.setdefault("config", {})
            candidate["config"]["threads"] = spec["solver_threads"]
        effective_candidates_path = paths["run_dir"] / "config_candidates.effective.json"
        write_json(effective_candidates_path, effective_candidates)
        spec["effective_config_candidates"] = str(effective_candidates_path)

    payload = dict(spec)
    payload["run_id"] = run_id
    payload["created_at"] = utc_now_iso()
    payload["schema_version"] = "1.0.0"

    state = create_initial_state(run_id, payload, paths)
    write_json(paths["spec_path"], payload)
    write_pipeline_state(run_dir, state)
    append_log(paths["log_path"], "[{time}] queued run {run_id}\n".format(time=utc_now_iso(), run_id=run_id))

    return {
        "run_id": run_id,
        "run_dir": run_dir,
        "paths": paths,
        "state": state,
    }


def launch_pipeline_run(spec: Dict) -> Dict:
    initialized = initialize_pipeline_run(spec)
    run_id = initialized["run_id"]
    run_dir = initialized["run_dir"]
    paths = initialized["paths"]
    state = initialized["state"]

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    with paths["log_path"].open("a", encoding="utf-8") as handle:
        process = subprocess.Popen(
            [sys.executable, str(RUNNER_SCRIPT), "--run-dir", str(run_dir)],
            cwd=str(REPO_ROOT),
            stdout=handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=env,
        )

    state["worker_pid"] = process.pid
    write_pipeline_state(run_dir, state)
    write_active_run_lock(run_id, process.pid)
    append_log(paths["log_path"], "[{time}] launched worker pid={pid}\n".format(time=utc_now_iso(), pid=process.pid))

    return {
        "run_id": run_id,
        "run_dir": run_dir,
        "worker_pid": process.pid,
    }


def stop_pipeline_run(run_id: Optional[str] = None) -> Dict:
    target_run_id = run_id
    if not target_run_id:
        active = read_active_run_lock()
        if not active:
            raise RuntimeError("No active control-tower run to stop.")
        target_run_id = active["run_id"]

    run_dir = PIPELINE_RUNS_ROOT / target_run_id
    state = read_pipeline_state(run_dir)
    if not state:
        raise RuntimeError("Unknown pipeline run: {run_id}".format(run_id=target_run_id))

    worker_pid = state.get("worker_pid")
    pids_to_kill: List[int] = []
    if worker_pid and process_alive(worker_pid):
        pids_to_kill = collect_descendant_pids(worker_pid) + [worker_pid]
    remaining = kill_pid_list(pids_to_kill) if pids_to_kill else []

    if remaining:
        raise RuntimeError(
            "Unable to stop all training processes. Remaining pids: {pids}".format(
                pids=", ".join(str(pid) for pid in remaining)
            )
        )

    current_stage = state.get("current_stage")
    if current_stage:
        upsert_stage(
            state,
            current_stage,
            {
                "status": "stopped",
                "completed_at": utc_now_iso(),
                "exit_code": None,
            },
        )

    state["status"] = "stopped"
    state["completed_at"] = utc_now_iso()
    state["current_stage"] = None
    state["error"] = {
        "message": "Pipeline stopped by user.",
    }
    refresh_artifact_summary(run_dir, state)
    write_pipeline_state(run_dir, state)
    append_log(
        get_run_paths(run_dir)["log_path"],
        "\n[{time}] run stopped by user\n".format(time=utc_now_iso()),
    )
    clear_active_run_lock(run_id=target_run_id)
    return state


def run_pipeline_foreground(run_dir: Path) -> Dict:
    paths = get_run_paths(run_dir)
    spec = read_json(paths["spec_path"])
    if not spec:
        raise RuntimeError("Missing pipeline spec at {path}".format(path=paths["spec_path"]))

    state = read_pipeline_state(run_dir) or create_initial_state(spec["run_id"], spec, paths)
    stages = build_stage_definitions(spec, paths)

    electron_binary = Path(spec["electron_binary"])
    if not electron_binary.exists():
        raise RuntimeError(
            "Electron binary not found at {path}. If you need the legacy runtime, run `npm run legacy:setup` first.".format(path=electron_binary)
        )

    state["status"] = "running"
    state["started_at"] = state.get("started_at") or utc_now_iso()
    state["worker_pid"] = os.getpid()
    state["progress"]["total_stages"] = len(stages)
    write_pipeline_state(run_dir, state)

    log_path = paths["log_path"]
    append_log(log_path, "[{time}] starting run {run_id}\n".format(time=utc_now_iso(), run_id=spec["run_id"]))

    try:
        for index, stage in enumerate(stages):
            stage_id = stage["id"]
            stage_label = stage["label"]
            state["current_stage"] = stage_id
            upsert_stage(
                state,
                stage_id,
                {
                    "label": stage_label,
                    "status": "running",
                    "started_at": utc_now_iso(),
                    "completed_at": None,
                    "exit_code": None,
                    "command": stage["command"],
                },
            )
            write_pipeline_state(run_dir, state)

            append_log(log_path, "\n== {label} ==\n".format(label=stage_label))
            append_log(log_path, "$ {command}\n".format(command=shlex.join(stage["command"])))

            env = os.environ.copy()
            env.update(stage.get("env", {}))
            env["PYTHONUNBUFFERED"] = "1"
            if stage.get("runner") == "config_sweep":
                returncode = run_config_sweep_stage(stage, REPO_ROOT, env, log_path)
            else:
                returncode = run_logged_stage_command(stage["command"], REPO_ROOT, env, log_path).returncode

            stage_status = "completed" if returncode == 0 else "failed"
            upsert_stage(
                state,
                stage_id,
                {
                    "label": stage_label,
                    "status": stage_status,
                    "completed_at": utc_now_iso(),
                    "exit_code": returncode,
                },
            )
            state["progress"]["completed_stages"] = index + 1 if returncode == 0 else index
            refresh_artifact_summary(run_dir, state)
            write_pipeline_state(run_dir, state)

            if returncode != 0:
                raise RuntimeError("Stage failed: {label} (exit {code})".format(label=stage_label, code=returncode))

        state["status"] = "completed"
        state["current_stage"] = None
        state["completed_at"] = utc_now_iso()
        refresh_artifact_summary(run_dir, state)
        write_pipeline_state(run_dir, state)
        append_log(log_path, "\n[{time}] run completed successfully\n".format(time=utc_now_iso()))
        return state
    except Exception as error:
        state["status"] = "failed"
        state["completed_at"] = utc_now_iso()
        state["error"] = {
            "message": str(error),
            "traceback": traceback.format_exc(),
        }
        refresh_artifact_summary(run_dir, state)
        write_pipeline_state(run_dir, state)
        append_log(log_path, "\n[{time}] run failed: {message}\n".format(time=utc_now_iso(), message=error))
        append_log(log_path, traceback.format_exc() + "\n")
        return state
    finally:
        clear_active_run_lock(run_id=spec["run_id"])


def list_pipeline_runs(limit: int = 20) -> List[Dict]:
    ensure_dir(PIPELINE_RUNS_ROOT)
    records: List[Dict] = []
    for run_dir in PIPELINE_RUNS_ROOT.iterdir():
        if not run_dir.is_dir():
            continue
        state = read_pipeline_state(run_dir)
        if state:
            records.append(state)
    records.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return records[:limit]


def tail_pipeline_log(run_id: str, max_lines: int = 200) -> str:
    run_dir = PIPELINE_RUNS_ROOT / run_id
    log_path = get_run_paths(run_dir)["log_path"]
    if not log_path.exists():
        return ""
    with log_path.open("r", encoding="utf-8") as handle:
        lines = handle.readlines()
    return "".join(lines[-max_lines:])


def find_run_state(run_id: str) -> Optional[Dict]:
    run_dir = PIPELINE_RUNS_ROOT / run_id
    if not run_dir.exists():
        return None
    return read_pipeline_state(run_dir)

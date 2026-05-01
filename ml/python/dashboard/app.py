import argparse
from pathlib import Path
import sys
import time
from typing import Dict, List, Optional

import streamlit as st

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

import deepnest_ml.training_profiles as training_profiles_module
from deepnest_ml.control_tower import (
    DEFAULT_BAKEOFF_REPORT_ROOT,
    DEFAULT_LEGACY_ELECTRON_BINARY,
    DEFAULT_NATIVE_ELECTRON_BINARY,
    PIPELINE_RUNS_ROOT,
    PRESET_DEFAULTS,
    build_bakeoff_spec,
    build_pipeline_spec,
    find_run_state,
    is_apple_silicon_host,
    launch_pipeline_run,
    list_pipeline_runs,
    recommended_solver_threads,
    recommended_sweep_worker_count,
    read_active_run_lock,
    resolve_default_electron_binary,
    stop_pipeline_run,
    tail_pipeline_log,
)
from deepnest_ml.paths import REAL_WORLD_ROOT
from deepnest_ml.training_profiles import (
    ALLOWED_FAMILIES,
    DEFAULT_SELECTED_PROFILE_IDS,
    FAMILY_LABELS,
    delete_custom_training_profile,
    list_training_profiles,
    load_custom_training_profiles,
    slugify_training_profile_name,
    upsert_custom_training_profile,
)


PRESET_DEFAULTS_VERSION = "compactness-v1"
FIXED_ROTATION_CHOICES = getattr(training_profiles_module, "FIXED_ROTATION_CHOICES", [4])


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--warehouse", default="")
    args, _ = parser.parse_known_args()
    return args


def require_duckdb():
    import duckdb  # type: ignore

    return duckdb


def require_pandas():
    import pandas as pd  # type: ignore

    return pd


def format_run_label(run_id: str, runs_by_id: Dict[str, Dict]) -> str:
    run = runs_by_id[run_id]
    progress = run.get("progress", {})
    status = run.get("status", "unknown")
    completed = progress.get("completed_stages", 0)
    total = progress.get("total_stages", 0)
    run_type = run.get("spec", {}).get("run_type", "training_pipeline")
    return "{run_id} [{run_type}:{status}] ({completed}/{total})".format(
        run_id=run_id,
        run_type="bakeoff" if run_type == "real_world_bakeoff" else "train",
        status=status,
        completed=completed,
        total=total,
    )


def build_runs_table(runs: List[Dict]):
    pd = require_pandas()
    rows = []
    for run in runs:
        spec = run.get("spec", {})
        progress = run.get("progress", {})
        rows.append(
            {
                "run_id": run.get("run_id"),
                "run_type": run.get("spec", {}).get("run_type", "training_pipeline"),
                "status": run.get("status"),
                "preset": spec.get("preset"),
                "synthetic_jobs": spec.get("synthetic_count"),
                "benchmark_jobs": spec.get("benchmark_count"),
                "sweep_workers": spec.get("sweep_worker_count"),
                "solver_threads": spec.get("solver_threads"),
                "current_stage": run.get("current_stage"),
                "progress": "{completed}/{total}".format(
                    completed=progress.get("completed_stages", 0),
                    total=progress.get("total_stages", 0),
                ),
                "created_at": run.get("created_at"),
                "completed_at": run.get("completed_at"),
            }
        )
    return pd.DataFrame(rows)


def build_stage_table(run: Dict):
    pd = require_pandas()
    stages = []
    for stage in run.get("stages", []):
        stages.append(
            {
                "stage": stage.get("id"),
                "label": stage.get("label"),
                "status": stage.get("status"),
                "exit_code": stage.get("exit_code"),
                "started_at": stage.get("started_at"),
                "completed_at": stage.get("completed_at"),
            }
        )
    return pd.DataFrame(stages)


def render_custom_profile_builder() -> None:
    st.subheader("Custom Profile Maker")
    st.caption("Create synthetic training profiles from the current generator families. Saved profiles appear automatically in the training-run selector.")

    custom_profiles = load_custom_training_profiles()
    custom_by_id = {profile["profile_id"]: profile for profile in custom_profiles}
    editor_options = ["__new__"] + [profile["profile_id"] for profile in custom_profiles]

    pending_target = st.session_state.pop("profile_editor_target_pending", None)
    if pending_target is not None:
        st.session_state["profile_editor_target"] = pending_target if pending_target in editor_options else "__new__"

    pending_notice = st.session_state.pop("profile_editor_notice", None)
    if pending_notice:
        notice_level = pending_notice.get("level", "success")
        notice_message = pending_notice.get("message")
        if notice_message and hasattr(st, notice_level):
            getattr(st, notice_level)(notice_message)

    def format_profile_option(profile_id: str) -> str:
        if profile_id == "__new__":
            return "Create new profile"
        profile = custom_by_id.get(profile_id)
        return profile["name"] if profile else profile_id

    selected_editor_id = st.selectbox(
        "Profile to edit",
        options=editor_options,
        format_func=format_profile_option,
        key="profile_editor_target",
    )

    active_profile = custom_by_id.get(selected_editor_id) if selected_editor_id != "__new__" else None
    loaded_marker = active_profile["profile_id"] if active_profile else "__new__"
    if st.session_state.get("profile_editor_loaded") != loaded_marker:
        st.session_state["profile_editor_loaded"] = loaded_marker
        st.session_state["profile_editor_name"] = active_profile["name"] if active_profile else ""
        st.session_state["profile_editor_note"] = active_profile.get("note", "") if active_profile else ""
        st.session_state["profile_editor_families"] = active_profile.get("families", []) if active_profile else []
        st.session_state["profile_editor_rotations"] = (
            active_profile.get("rotation_choices", FIXED_ROTATION_CHOICES[:])
            if active_profile
            else FIXED_ROTATION_CHOICES[:]
        )
        st.session_state["profile_editor_quantity_floor"] = (
            active_profile.get("quantity_floor_choices", [1, 2]) if active_profile else [1, 2]
        )
        st.session_state["profile_editor_curve"] = (
            active_profile.get("curve_tolerance_choices", [0.25, 0.3]) if active_profile else [0.25, 0.3]
        )
        st.session_state["profile_editor_profile_id"] = active_profile["profile_id"] if active_profile else ""

    with st.form("custom_profile_form"):
        left, right = st.columns(2)
        with left:
            st.text_input("Profile name", key="profile_editor_name")
            st.text_input("Short note", key="profile_editor_note")
            st.multiselect(
                "Shape families",
                options=list(ALLOWED_FAMILIES),
                format_func=lambda family: FAMILY_LABELS.get(family, family),
                key="profile_editor_families",
            )
        with right:
            st.multiselect(
                "Rotation choices",
                options=FIXED_ROTATION_CHOICES,
                key="profile_editor_rotations",
                disabled=True,
                help="Compactness training now fixes all custom profiles to 4 rotations.",
            )
            st.multiselect(
                "Minimum copy floor",
                options=[1, 2, 3, 4],
                key="profile_editor_quantity_floor",
            )
            st.multiselect(
                "Curve tolerance choices",
                options=[0.25, 0.3, 0.4],
                key="profile_editor_curve",
            )

        save_col, delete_col = st.columns([1, 1])
        save_pressed = save_col.form_submit_button("Save custom profile", use_container_width=True)
        delete_pressed = delete_col.form_submit_button(
            "Delete selected profile",
            disabled=active_profile is None,
            use_container_width=True,
        )

    if save_pressed:
        profile_name = st.session_state.get("profile_editor_name", "").strip()
        families = list(st.session_state.get("profile_editor_families", []))
        if not profile_name:
            st.error("Profile name is required.")
        elif not families:
            st.error("Select at least one shape family.")
        else:
            profile_id = active_profile["profile_id"] if active_profile else slugify_training_profile_name(profile_name)
            saved = upsert_custom_training_profile(
                {
                    "profile_id": profile_id,
                    "name": profile_name,
                    "note": st.session_state.get("profile_editor_note", "").strip() or "custom profile",
                    "families": families,
                    "rotation_choices": FIXED_ROTATION_CHOICES[:],
                    "quantity_floor_choices": list(st.session_state.get("profile_editor_quantity_floor", [])) or [1, 2],
                    "curve_tolerance_choices": list(st.session_state.get("profile_editor_curve", [])) or [0.25, 0.3],
                }
            )
            st.session_state["profile_editor_target_pending"] = saved["profile_id"]
            st.session_state["profile_editor_loaded"] = None
            st.session_state["profile_editor_notice"] = {
                "level": "success",
                "message": "Saved custom profile: {name}".format(name=saved["name"]),
            }
            st.rerun()

    if delete_pressed and active_profile:
        delete_custom_training_profile(active_profile["profile_id"])
        selected_profile_ids = st.session_state.get("selected_profile_ids", [])
        st.session_state["selected_profile_ids"] = [
            profile_id for profile_id in selected_profile_ids if profile_id != active_profile["profile_id"]
        ]
        st.session_state["profile_editor_target_pending"] = "__new__"
        st.session_state["profile_editor_loaded"] = None
        st.session_state["profile_editor_notice"] = {
            "level": "success",
            "message": "Deleted custom profile: {name}".format(name=active_profile["name"]),
        }
        st.rerun()

    if custom_profiles:
        summary_rows = [
            {
                "name": profile["name"],
                "profile_id": profile["profile_id"],
                "families": ", ".join(FAMILY_LABELS.get(family, family) for family in profile.get("families", [])),
                "rotations": ", ".join(str(value) for value in profile.get("rotation_choices", [])),
                "copy_floor": ", ".join(str(value) for value in profile.get("quantity_floor_choices", [])),
            }
            for profile in custom_profiles
        ]
        st.dataframe(summary_rows, use_container_width=True)
    else:
        st.info("No custom profiles yet. Save one here and it will appear in the training selector above.")


def render_control_panel(active_run: Optional[Dict]) -> None:
    st.sidebar.header("Control Tower")
    mode = st.sidebar.radio(
        "Mode",
        options=["Training Pipeline", "Real-World Bakeoff"],
        key="control_mode",
    )

    default_electron_binary = resolve_default_electron_binary()
    electron_ready = default_electron_binary.exists()
    using_native_runtime = default_electron_binary == DEFAULT_NATIVE_ELECTRON_BINARY
    if electron_ready:
        runtime_label = "Native Apple Silicon runtime ready" if using_native_runtime else "Legacy Rosetta runtime ready"
        st.sidebar.success(runtime_label)
        st.sidebar.caption("Current runtime: `{path}`".format(path=default_electron_binary))
    else:
        if DEFAULT_NATIVE_ELECTRON_BINARY.exists():
            st.sidebar.warning("Default Electron runtime could not be resolved, even though the native app bundle exists.")
        else:
            st.sidebar.warning("No Electron runtime found. Run `npm install` for native, or `npm run legacy:setup` for the old Rosetta runtime.")

    if active_run:
        st.sidebar.info("Active run: {run_id}".format(run_id=active_run["run_id"]))

    launch_disabled = bool(active_run) or not electron_ready
    if mode == "Training Pipeline":
        preset = st.sidebar.selectbox("Preset", options=list(PRESET_DEFAULTS.keys()), key="preset")
        defaults = PRESET_DEFAULTS[preset]
        default_sweep_workers = defaults.get("sweep_worker_count", recommended_sweep_worker_count())
        default_solver_threads = defaults.get("solver_threads", recommended_solver_threads())
        preset_token = "{preset}:{version}".format(preset=preset, version=PRESET_DEFAULTS_VERSION)
        available_profiles = list_training_profiles()
        available_profile_ids = [profile["profile_id"] for profile in available_profiles]
        available_profile_labels = {
            profile["profile_id"]: "{name} ({kind})".format(
                name=profile["name"],
                kind="custom" if profile["kind"] == "custom" else "built-in",
            )
            for profile in available_profiles
        }

        if st.session_state.get("preset_applied") != preset_token:
            st.session_state["synthetic_count"] = defaults["synthetic_count"]
            st.session_state["benchmark_count"] = defaults["benchmark_count"]
            st.session_state["seed"] = defaults["seed"]
            st.session_state["sweep_worker_count"] = default_sweep_workers
            st.session_state["solver_threads"] = default_solver_threads
            st.session_state["preset_applied"] = preset_token

        if "selected_profile_ids" not in st.session_state:
            st.session_state["selected_profile_ids"] = [
                profile_id for profile_id in DEFAULT_SELECTED_PROFILE_IDS if profile_id in available_profile_ids
            ]
        else:
            st.session_state["selected_profile_ids"] = [
                profile_id
                for profile_id in st.session_state["selected_profile_ids"]
                if profile_id in available_profile_ids
            ]

        st.sidebar.text_input("Run name hint", key="name_hint")
        st.sidebar.number_input("Synthetic jobs", min_value=0, step=1, key="synthetic_count")
        st.sidebar.number_input("Benchmark jobs", min_value=0, step=1, key="benchmark_count")
        st.sidebar.number_input("Seed", min_value=0, step=1, key="seed")
        st.sidebar.number_input(
            "Sweep workers",
            min_value=1,
            step=1,
            key="sweep_worker_count",
            help="How many teacher sweep subprocesses to run in parallel during config labeling.",
        )
        st.sidebar.number_input(
            "Solver threads",
            min_value=1,
            step=1,
            key="solver_threads",
            help="Thread count written into sweep candidate configs before the teacher solves them. Compactness mode defaults to 1 so candidate labels are not driven by timing noise.",
        )
        st.sidebar.multiselect(
            "Profiles used in training",
            options=available_profile_ids,
            format_func=lambda profile_id: available_profile_labels.get(profile_id, profile_id),
            key="selected_profile_ids",
            help="These are the synthetic profiles used for the next training run. Custom profiles appear here automatically once they exist.",
        )
        st.sidebar.caption(
            "{count} profiles available: {built_in} built-in, {custom} custom".format(
                count=len(available_profiles),
                built_in=len([profile for profile in available_profiles if profile["kind"] == "built-in"]),
                custom=len([profile for profile in available_profiles if profile["kind"] == "custom"]),
            )
        )
        if is_apple_silicon_host():
            st.sidebar.caption(
                "Compactness defaults: {workers} sweep workers, {threads} solver thread.".format(
                    workers=default_sweep_workers,
                    threads=default_solver_threads,
                )
            )
        else:
            st.sidebar.caption(
                "Default training concurrency stays conservative off Apple Silicon; adjust if this host has spare headroom."
            )

        st.sidebar.checkbox(
            "📸 Enable snapshot visualization",
            value=False,
            key="enable_snapshots",
            help="Write SVG snapshots of each solver evaluation during sweeps, then generate animated viewers.",
        )

        if st.sidebar.button("Start Training Pipeline", disabled=launch_disabled, use_container_width=True):
            spec = build_pipeline_spec(
                preset=preset,
                synthetic_count=int(st.session_state["synthetic_count"]),
                benchmark_count=int(st.session_state["benchmark_count"]),
                seed=int(st.session_state["seed"]),
                name_hint=st.session_state.get("name_hint", ""),
                selected_profile_ids=list(st.session_state.get("selected_profile_ids", [])),
                sweep_worker_count=int(st.session_state["sweep_worker_count"]),
                solver_threads=int(st.session_state["solver_threads"]),
            )
            spec["enable_snapshots"] = bool(st.session_state.get("enable_snapshots", False))
            try:
                launched = launch_pipeline_run(spec)
                st.session_state["selected_run_id"] = launched["run_id"]
                st.sidebar.success("Started {run_id}".format(run_id=launched["run_id"]))
                st.rerun()
            except Exception as error:
                st.sidebar.error(str(error))
    else:
        st.sidebar.text_input("Run name hint", key="bakeoff_name_hint")
        st.sidebar.text_input(
            "Corpus manifest",
            value=st.session_state.get(
                "bakeoff_manifest_path",
                str(REAL_WORLD_ROOT / "example-campaign" / "real_world_manifest.json"),
            ),
            key="bakeoff_manifest_path",
        )
        st.sidebar.text_input("Model artifact", key="bakeoff_model_path")
        st.sidebar.text_input(
            "Report output dir",
            value=st.session_state.get("bakeoff_output_dir", ""),
            key="bakeoff_output_dir",
        )
        st.sidebar.caption(
            "Real-world manifests usually live under `{root}`".format(root=REAL_WORLD_ROOT)
        )

        if st.sidebar.button("Run Real-World Bakeoff", disabled=launch_disabled, use_container_width=True):
            spec = build_bakeoff_spec(
                manifest_path=st.session_state.get("bakeoff_manifest_path", ""),
                model_path=st.session_state.get("bakeoff_model_path", ""),
                name_hint=st.session_state.get("bakeoff_name_hint", ""),
                bakeoff_output_dir=st.session_state.get("bakeoff_output_dir", ""),
            )
            try:
                launched = launch_pipeline_run(spec)
                st.session_state["selected_run_id"] = launched["run_id"]
                st.sidebar.success("Started {run_id}".format(run_id=launched["run_id"]))
                st.rerun()
            except Exception as error:
                st.sidebar.error(str(error))

    stop_disabled = not bool(active_run)
    if st.sidebar.button("Stop Active Run", disabled=stop_disabled, use_container_width=True):
        try:
            stopped = stop_pipeline_run(active_run["run_id"] if active_run else None)
            st.session_state["selected_run_id"] = stopped["run_id"]
            st.sidebar.success("Stopped {run_id}".format(run_id=stopped["run_id"]))
            st.rerun()
        except Exception as error:
            st.sidebar.error(str(error))

    st.sidebar.caption("Runs are stored in `{root}`".format(root=PIPELINE_RUNS_ROOT))


def choose_selected_run(runs: List[Dict], active_run: Optional[Dict]) -> Optional[Dict]:
    if not runs:
        return None

    runs_by_id = {run["run_id"]: run for run in runs}
    options = [run["run_id"] for run in runs]

    default_run_id = st.session_state.get("selected_run_id")
    if default_run_id not in runs_by_id:
        if active_run:
            default_run_id = active_run["run_id"]
        else:
            default_run_id = options[0]

    selected_run_id = st.selectbox(
        "Selected pipeline run",
        options=options,
        index=options.index(default_run_id),
        format_func=lambda run_id: format_run_label(run_id, runs_by_id),
    )
    st.session_state["selected_run_id"] = selected_run_id
    return find_run_state(selected_run_id) or runs_by_id[selected_run_id]


def resolve_warehouse_path(cli_default: str, selected_run: Optional[Dict]) -> Optional[Path]:
    if selected_run:
        selected_path = selected_run.get("artifacts", {}).get("warehouse_path")
        if selected_path and Path(selected_path).exists():
            return Path(selected_path)
        state_path = selected_run.get("paths", {}).get("warehouse_path")
        if state_path and Path(state_path).exists():
            return Path(state_path)

    if cli_default:
        candidate = Path(cli_default)
        if candidate.exists():
            return candidate

    return None


def render_warehouse_metrics(warehouse_path: Optional[Path]) -> None:
    st.subheader("Metrics")

    if not warehouse_path or not warehouse_path.exists():
        st.warning("Warehouse not available yet. Complete a run through the training pipeline first.")
        return

    duckdb = require_duckdb()
    connection = duckdb.connect(str(warehouse_path), read_only=True)

    tables = {
        row[0]
        for row in connection.execute(
            "select table_name from information_schema.tables where table_schema = 'main'"
        ).fetchall()
    }

    runs = connection.execute(
        """
        select
            count(*) as run_count,
            sum(case when status = 'failed' then 1 else 0 end) as failed_runs,
            max(created_at) as latest_run
        from runs
        """
    ).fetchdf()
    latest_runs = connection.execute(
        "select run_id, job_id, status, created_at from runs order by created_at desc limit 20"
    ).fetchdf()
    dataset_summary = connection.execute(
        """
        select
            count(*) as row_count,
            avg(cast(legal as double)) as legal_rate,
            avg(utilization_ratio) as avg_utilization,
            avg(wall_clock_ms) as avg_wall_clock_ms
        from dataset_rows
        """
    ).fetchdf()
    status_breakdown = connection.execute(
        "select status, count(*) as count from dataset_rows group by status order by count desc"
    ).fetchdf()
    source_breakdown = connection.execute(
        "select source, count(*) as count from dataset_rows group by source order by count desc"
    ).fetchdf()
    geometry_breakdown = connection.execute(
        """
        select
            case
                when max_part_area < 20000 then 'small'
                when max_part_area < 120000 then 'medium'
                else 'large'
            end as size_band,
            count(*) as count,
            avg(utilization_ratio) as avg_utilization
        from dataset_rows
        group by size_band
        order by size_band
        """
    ).fetchdf()
    top_regressions = connection.execute(
        """
        select
            base_job_id,
            config_candidate_id,
            wall_clock_ms,
            utilization_ratio,
            legal
        from dataset_rows
        where legal = false or status = 'failed'
        order by wall_clock_ms desc
        limit 20
        """
    ).fetchdf()

    bakeoff_summary = None
    bakeoff_jobs = None
    bakeoff_wins = None
    bakeoff_losses = None
    if "bakeoff_summary" in tables:
        bakeoff_summary = connection.execute(
            "select * from bakeoff_summary order by created_at desc limit 1"
        ).fetchdf()
    if "bakeoff_jobs" in tables:
        bakeoff_jobs = connection.execute(
            "select * from bakeoff_jobs order by split, job_id"
        ).fetchdf()
        bakeoff_wins = connection.execute(
            """
            select job_id, split, predicted_candidate_id, oracle_candidate_id,
                   predicted_utilization_ratio - baseline_utilization_ratio as utilization_gain
            from bakeoff_jobs
            where predicted_metrics_legal = true
            order by utilization_gain desc nulls last
            limit 10
            """
        ).fetchdf()
        bakeoff_losses = connection.execute(
            """
            select job_id, split, predicted_candidate_id, oracle_candidate_id,
                   predicted_utilization_ratio - baseline_utilization_ratio as utilization_gain
            from bakeoff_jobs
            order by utilization_gain asc nulls last
            limit 10
            """
        ).fetchdf()
    connection.close()

    cols = st.columns(4)
    cols[0].metric("Teacher runs", int(runs["run_count"][0]))
    cols[1].metric("Failed runs", int(runs["failed_runs"][0]))
    cols[2].metric("Dataset rows", int(dataset_summary["row_count"][0]))
    cols[3].metric("Legal rate", f"{float(dataset_summary['legal_rate'][0] or 0) * 100:.1f}%")

    st.caption("Warehouse: {path}".format(path=warehouse_path))

    st.subheader("Latest teacher runs")
    st.dataframe(latest_runs, use_container_width=True)

    left, right = st.columns(2)
    with left:
        st.subheader("Dataset health")
        st.dataframe(status_breakdown, use_container_width=True)
        st.dataframe(source_breakdown, use_container_width=True)
    with right:
        st.subheader("Benchmark metrics")
        st.metric("Average utilization", f"{float(dataset_summary['avg_utilization'][0] or 0):.3f}")
        st.metric("Average wall clock (ms)", f"{float(dataset_summary['avg_wall_clock_ms'][0] or 0):.1f}")
        st.dataframe(geometry_breakdown, use_container_width=True)

    st.subheader("Top regressions / failures")
    st.dataframe(top_regressions, use_container_width=True)

    if bakeoff_summary is not None and not bakeoff_summary.empty:
        st.subheader("Real-World Bakeoff")
        summary_cols = st.columns(5)
        summary_cols[0].metric("Campaign", str(bakeoff_summary["campaign_id"][0]))
        summary_cols[1].metric("Bakeoff jobs", int(bakeoff_summary["job_count"][0]))
        summary_cols[2].metric("Gate pass", "YES" if bool(bakeoff_summary["gate_pass"][0]) else "NO")
        summary_cols[3].metric(
            "Pilot only",
            "YES" if bool(bakeoff_summary["pilot_only"][0]) else "NO",
        )
        summary_cols[4].metric(
            "Model vs oracle",
            "{value:.1f}%".format(value=float(bakeoff_summary["model_oracle_exact_match_rate"][0] or 0) * 100.0),
        )

        left, right = st.columns(2)
        with left:
            st.metric(
                "Utilization delta vs baseline",
                "{value:.3f}".format(value=float(bakeoff_summary["median_utilization_delta_vs_baseline"][0] or 0)),
            )
            st.metric(
                "Predicted legality rate",
                "{value:.1f}%".format(value=float(bakeoff_summary["predicted_legality_rate"][0] or 0) * 100.0),
            )
            if bakeoff_wins is not None:
                st.subheader("Top utilization wins")
                st.dataframe(bakeoff_wins, use_container_width=True)
        with right:
            st.metric(
                "Oracle headroom vs baseline",
                "{value:.3f}".format(value=float(bakeoff_summary["median_oracle_headroom_vs_baseline"][0] or 0)),
            )
            st.metric(
                "Sheet count non-worse",
                "{value:.1f}%".format(value=float(bakeoff_summary["sheet_count_nonworse_rate"][0] or 0) * 100.0),
            )
            if bakeoff_losses is not None:
                st.subheader("Worst regressions")
                st.dataframe(bakeoff_losses, use_container_width=True)

        if bakeoff_jobs is not None:
            st.subheader("Bakeoff jobs")
            st.dataframe(bakeoff_jobs, use_container_width=True)


def discover_snapshot_viewers(run: Dict) -> List[Path]:
    """Find all viewer.html files under the run's output directory."""
    run_id = run.get("run_id", "")
    if not run_id:
        return []
    run_dir = PIPELINE_RUNS_ROOT / run_id / "runs"
    if not run_dir.exists():
        return []
    candidate_order = {
        "default": 0,
        "quality_dense": 1,
        "merge_focused": 2,
        "fast_box": 3,
        "convex_fast": 4,
    }

    def viewer_sort_key(viewer_path: Path):
        rel = viewer_path.parent.relative_to(run_dir)
        name = viewer_path.parent.name
        job_prefix = name
        candidate_id = ""
        if "__" in name:
            job_prefix, candidate_id = name.rsplit("__", 1)
        return (str(rel.parent), job_prefix, candidate_order.get(candidate_id, 99), candidate_id)

    viewers = sorted(run_dir.rglob("viewer.html"), key=viewer_sort_key)
    return viewers


def render_snapshot_viewers(run: Optional[Dict]) -> None:
    """Render a snapshot viewer embed inside run detail, if viewers exist."""
    if not run:
        return

    viewers = discover_snapshot_viewers(run)
    if not viewers:
        return

    run_dir = PIPELINE_RUNS_ROOT / run["run_id"] / "runs"

    with st.expander("📸 Snapshot viewers ({count})".format(count=len(viewers)), expanded=True):
        labels = []
        for viewer_path in viewers:
            rel = viewer_path.parent.relative_to(run_dir)
            labels.append(str(rel))

        selected_label = st.selectbox(
            "Select job / candidate",
            labels,
            key="snapshot_viewer_select_{run_id}".format(run_id=run["run_id"]),
        )

        if selected_label:
            selected_index = labels.index(selected_label)
            viewer_path = viewers[selected_index]

            btn_col, path_col = st.columns([1, 3])
            with btn_col:
                if st.button("🌐 Open in Browser", key="open_viewer_{run_id}".format(run_id=run["run_id"])):
                    import subprocess
                    subprocess.Popen(["open", str(viewer_path)])
            with path_col:
                st.caption(str(viewer_path))

            try:
                viewer_html = viewer_path.read_text(encoding="utf-8")
                import streamlit.components.v1 as components
                components.html(viewer_html, height=650, scrolling=False)
            except Exception as viewer_error:
                st.error("Failed to load viewer: {error}".format(error=str(viewer_error)))


def render_run_detail(run: Optional[Dict]) -> None:
    st.subheader("Pipeline Run Detail")
    if not run:
        st.info("No pipeline runs yet. Start one from the sidebar.")
        return

    progress = run.get("progress", {})
    run_type = run.get("spec", {}).get("run_type", "training_pipeline")
    cols = st.columns(4)
    cols[0].metric("Status", str(run.get("status", "unknown")).upper())
    cols[1].metric("Run Type", "BAKEOFF" if run_type == "real_world_bakeoff" else str(run.get("spec", {}).get("preset", "unknown")).upper())
    cols[2].metric(
        "Stages",
        "{completed}/{total}".format(
            completed=progress.get("completed_stages", 0),
            total=progress.get("total_stages", 0),
        ),
    )
    cols[3].metric("Worker PID", str(run.get("worker_pid") or "-"))

    st.caption("Run ID: {run_id}".format(run_id=run["run_id"]))
    if run.get("current_stage"):
        st.caption("Current stage: {stage}".format(stage=run["current_stage"]))
    selected_profile_names = run.get("spec", {}).get("selected_profile_names") or []
    if selected_profile_names:
        st.caption("Profiles used in training: {profiles}".format(profiles=", ".join(selected_profile_names)))
    st.caption(
        "Sweep workers: {workers} | Solver threads: {threads}".format(
            workers=run.get("spec", {}).get("sweep_worker_count", "-"),
            threads=run.get("spec", {}).get("solver_threads", "-"),
        )
    )

    metrics = run.get("metrics", {})
    if any(value is not None for value in metrics.values()):
        if run_type == "real_world_bakeoff":
            metric_cols = st.columns(5)
            metric_cols[0].metric("Bakeoff jobs", str(metrics.get("bakeoff_job_count") or "-"))
            metric_cols[1].metric("Legal predictions", str(metrics.get("bakeoff_legal_job_count") or "-"))
            metric_cols[2].metric("Pilot only", str(metrics.get("bakeoff_pilot_only") or "-"))
            metric_cols[3].metric("Gate pass", str(metrics.get("bakeoff_gate_pass") or "-"))
            metric_cols[4].metric(
                "Model vs oracle",
                str(metrics.get("bakeoff_model_oracle_match_rate") or "-"),
            )
            st.caption(
                "Predicted legality rate: {legality} | Utilization delta vs baseline: {util_delta}".format(
                    legality=str(metrics.get("bakeoff_predicted_legality_rate") or "-"),
                    util_delta=str(metrics.get("bakeoff_median_utilization_delta_vs_default") or "-"),
                )
            )
        else:
            metric_cols = st.columns(5)
            metric_cols[0].metric("Dataset rows", str(metrics.get("dataset_row_count") or "-"))
            metric_cols[1].metric("Legal rows", str(metrics.get("legal_row_count") or "-"))
            metric_cols[2].metric("Legal jobs", str(metrics.get("legal_base_job_count") or "-"))
            metric_cols[3].metric("Model accuracy", str(metrics.get("test_accuracy") or "-"))
            metric_cols[4].metric("Runtime delta (ms)", str(metrics.get("median_runtime_delta_ms_vs_default") or "-"))
            st.caption("Utilization delta: {value}".format(value=str(metrics.get("median_utilization_delta_vs_default") or "-")))

    if run.get("error"):
        st.error(run["error"].get("message", "Pipeline failed"))

    stage_table = build_stage_table(run)
    if not stage_table.empty:
        st.dataframe(stage_table, use_container_width=True)

    with st.expander("Artifacts", expanded=False):
        st.json(run.get("artifacts", {}))

    render_snapshot_viewers(run)

    st.subheader("Pipeline log")
    st.code(tail_pipeline_log(run["run_id"], max_lines=200) or "No log output yet.", language="text")


def main() -> None:
    args = parse_args()
    st.set_page_config(page_title="Deepnest ML Control Tower", layout="wide")
    st.title("Deepnest ML Control Tower")
    st.caption("Launch training or real-world bakeoff runs, monitor stages, and inspect teacher metrics from one local dashboard.")

    active_lock = read_active_run_lock()
    active_run = find_run_state(active_lock["run_id"]) if active_lock else None
    runs = list_pipeline_runs(limit=25)

    render_control_panel(active_run)
    render_custom_profile_builder()

    if st.button("Refresh", use_container_width=False):
        st.rerun()

    if runs:
        st.subheader("Recent pipeline runs")
        st.dataframe(build_runs_table(runs), use_container_width=True)

    selected_run = choose_selected_run(runs, active_run)
    detail_col, metrics_col = st.columns([1, 1.2])
    with detail_col:
        render_run_detail(selected_run)
    with metrics_col:
        render_warehouse_metrics(resolve_warehouse_path(args.warehouse, selected_run))

    active_like_run = active_run or (selected_run if selected_run and selected_run.get("status") == "running" else None)
    auto_refresh = st.sidebar.checkbox("Auto refresh active run", value=bool(active_like_run))
    refresh_seconds = st.sidebar.slider("Refresh interval (seconds)", min_value=2, max_value=15, value=3)
    if auto_refresh and active_like_run:
        time.sleep(refresh_seconds)
        st.rerun()


if __name__ == "__main__":
    main()

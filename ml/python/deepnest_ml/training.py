import json
import os
import pickle
import platform
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple


FEATURE_COLUMNS = [
    "part_catalog_count",
    "sheet_catalog_count",
    "expected_part_count",
    "expected_sheet_count",
    "total_part_area",
    "total_sheet_area",
    "target_density",
    "total_holes",
    "hole_part_fraction",
    "avg_vertices",
    "max_vertices",
    "avg_bbox_aspect",
    "max_bbox_aspect",
    "min_part_area",
    "max_part_area",
    "area_spread_ratio",
    "duplicate_ratio",
]

DEFAULT_RF_ESTIMATORS = 200
WINNER_SELECTION_SORT = (
    ("used_sheet_count", True),
    ("fitness", True),
    ("utilization_ratio", False),
    ("wall_clock_ms", True),
)


def parse_positive_int(value: object) -> Optional[int]:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number < 1:
        return None
    return number


@lru_cache(maxsize=1)
def detect_apple_silicon_perf_cores() -> Optional[int]:
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return None

    for sysctl_name in ("hw.perflevel0.logicalcpu", "hw.perflevel0.physicalcpu"):
        try:
            result = subprocess.run(
                ["sysctl", "-n", sysctl_name],
                check=True,
                capture_output=True,
                text=True,
            )
        except Exception:
            continue

        value = parse_positive_int(result.stdout.strip())
        if value is not None:
            return value

    return None


def resolve_random_forest_fit_jobs() -> Tuple[int, str]:
    override = parse_positive_int(os.environ.get("DEEPNEST_ML_RF_JOBS"))
    if override is not None:
        return override, "env"

    perf_cores = detect_apple_silicon_perf_cores()
    if perf_cores is not None:
        return perf_cores, "apple_perf_cores"

    cpu_count = os.cpu_count() or 1
    if cpu_count <= 2:
        return cpu_count, "cpu_count"
    return min(cpu_count, 8), "cpu_count_capped"


def require_pandas():
    import pandas as pd  # type: ignore

    return pd


def require_sklearn():
    from sklearn.ensemble import RandomForestClassifier  # type: ignore
    from sklearn.metrics import accuracy_score  # type: ignore
    from sklearn.model_selection import train_test_split  # type: ignore

    return RandomForestClassifier, accuracy_score, train_test_split


def load_dataset(dataset_path: Path):
    pd = require_pandas()
    if dataset_path.suffix == ".parquet" and dataset_path.exists():
        return pd.read_parquet(dataset_path)
    if dataset_path.suffix == ".parquet":
        jsonl_fallback = dataset_path.with_suffix(".jsonl")
        if jsonl_fallback.exists():
            return pd.read_json(jsonl_fallback, lines=True)
    return pd.read_json(dataset_path, lines=True)


def summarize_training_dataset(dataframe) -> Dict:
    summary = {
        "row_count": int(len(dataframe)),
        "base_job_count": 0,
        "legal_row_count": 0,
        "legal_base_job_count": 0,
        "failed_row_count": 0,
        "jobs_with_multiple_candidates": 0,
    }
    if dataframe.empty:
        return summary

    base_job_series = dataframe["base_job_id"] if "base_job_id" in dataframe else None
    if base_job_series is not None:
        summary["base_job_count"] = int(base_job_series.nunique())
        candidate_counts = dataframe.groupby("base_job_id")["config_candidate_id"].nunique()
        summary["jobs_with_multiple_candidates"] = int((candidate_counts >= 2).sum())

    if "legal" in dataframe:
        legal = dataframe[dataframe["legal"] == True]  # noqa: E712
        summary["legal_row_count"] = int(len(legal))
        if not legal.empty and "base_job_id" in legal:
            summary["legal_base_job_count"] = int(legal["base_job_id"].nunique())

    if "status" in dataframe:
        summary["failed_row_count"] = int((dataframe["status"] == "failed").sum())

    return summary


def rank_candidate_rows(dataframe, include_base_job: bool = True):
    ranked = dataframe.copy()
    sort_columns: List[str] = []
    ascending: List[bool] = []
    if include_base_job and "base_job_id" in ranked:
        sort_columns.append("base_job_id")
        ascending.append(True)

    fill_defaults = {
        "used_sheet_count": float("inf"),
        "fitness": float("inf"),
        "utilization_ratio": 0.0,
        "wall_clock_ms": float("inf"),
    }
    for column, is_ascending in WINNER_SELECTION_SORT:
        if column not in ranked:
            ranked[column] = fill_defaults[column]
        ranked[column] = ranked[column].fillna(fill_defaults[column])
        sort_columns.append(column)
        ascending.append(is_ascending)

    return ranked.sort_values(by=sort_columns, ascending=ascending)


def select_best_config_rows(dataframe):
    summary = summarize_training_dataset(dataframe)
    if summary["jobs_with_multiple_candidates"] < 1:
        raise RuntimeError(
            "dataset needs at least one base job with at least two config candidates. "
            "summary={summary}".format(summary=json.dumps(summary, sort_keys=True))
        )

    legal = dataframe[dataframe["legal"] == True]  # noqa: E712
    if legal.empty:
        raise RuntimeError(
            "dataset contains no legal rows to learn from. "
            "All teacher rows in this dataset failed legality, so there is nothing safe to train on. "
            "summary={summary}. "
            "Try increasing the synthetic or benchmark job count, or fix the teacher legality path first."
            .format(summary=json.dumps(summary, sort_keys=True))
        )

    ranking = rank_candidate_rows(legal)
    best = ranking.groupby("base_job_id", as_index=False).first()
    return best


def train_config_recommender(dataframe, output_dir: Path) -> Dict:
    RandomForestClassifier, accuracy_score, train_test_split = require_sklearn()
    summary = summarize_training_dataset(dataframe)
    rf_fit_jobs, rf_fit_jobs_source = resolve_random_forest_fit_jobs()

    if summary["legal_base_job_count"] < 2:
        raise RuntimeError(
            "dataset needs at least two base jobs with legal candidate rows before training can start. "
            "summary={summary}. "
            "Increase the synthetic or benchmark job count so the trainer can make a real train/test split."
            .format(summary=json.dumps(summary, sort_keys=True))
        )

    best = select_best_config_rows(dataframe)
    training_frame = best[FEATURE_COLUMNS + ["config_candidate_id", "base_job_id"]].dropna()
    if len(training_frame) < 4:
        raise RuntimeError(
            "dataset is too small to train a config recommender. "
            "Need at least 4 legal base jobs after winner selection, got {count}. "
            "Try increasing synthetic/benchmark job counts before training."
            .format(count=len(training_frame))
        )

    X = training_frame[FEATURE_COLUMNS]
    y = training_frame["config_candidate_id"]
    if y.nunique() < 2:
        raise RuntimeError(
            "dataset does not contain enough winning-config variety to train a classifier. "
            "Need at least 2 distinct winning config candidates, got {count}."
            .format(count=y.nunique())
        )

    stratify_labels = None
    if y.nunique() > 1:
        class_counts = y.value_counts()
        if int(class_counts.min()) >= 2 and len(training_frame) >= 4:
            stratify_labels = y

    X_train, X_test, y_train, y_test, jobs_train, jobs_test = train_test_split(
        X,
        y,
        training_frame["base_job_id"],
        test_size=0.25,
        random_state=42,
        stratify=stratify_labels,
    )

    model = RandomForestClassifier(
        n_estimators=DEFAULT_RF_ESTIMATORS,
        random_state=42,
        class_weight="balanced",
        n_jobs=rf_fit_jobs,
    )
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    accuracy = float(accuracy_score(y_test, predictions))
    feature_importance = dict(zip(FEATURE_COLUMNS, model.feature_importances_.tolist()))

    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "config_recommender.pkl"
    with model_path.open("wb") as handle:
        pickle.dump({"model": model, "feature_columns": FEATURE_COLUMNS}, handle)

    report = {
        "model_path": str(model_path),
        "test_accuracy": accuracy,
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "winner_selection_sort": [
            {"column": column, "ascending": ascending}
            for column, ascending in WINNER_SELECTION_SORT
        ],
        "rf_n_estimators": DEFAULT_RF_ESTIMATORS,
        "rf_fit_jobs": rf_fit_jobs,
        "rf_fit_jobs_source": rf_fit_jobs_source,
        "rf_cpu_count": int(os.cpu_count() or 1),
        "rf_perf_core_count": detect_apple_silicon_perf_cores(),
        "feature_importance": feature_importance,
    }
    with (output_dir / "training_report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    try:  # pragma: no cover - optional dependency
        import mlflow

        mlflow.set_experiment("deepnest-config-recommender")
        with mlflow.start_run():
            mlflow.log_params(
                {
                    "model_type": "RandomForestClassifier",
                    "feature_count": len(FEATURE_COLUMNS),
                    "n_estimators": DEFAULT_RF_ESTIMATORS,
                    "n_jobs": rf_fit_jobs,
                    "n_jobs_source": rf_fit_jobs_source,
                }
            )
            mlflow.log_metric("test_accuracy", accuracy)
            mlflow.log_artifact(str(model_path))
            mlflow.log_artifact(str(output_dir / "training_report.json"))
    except Exception:
        pass

    return report


def evaluate_config_recommender(dataset, model_bundle: Dict) -> Dict:
    import pandas as pd

    model = model_bundle["model"]
    feature_columns = model_bundle["feature_columns"]
    best = select_best_config_rows(dataset)
    evaluation_frame = best[feature_columns + ["config_candidate_id", "base_job_id"]].dropna()
    predictions = model.predict(evaluation_frame[feature_columns])
    exact_match = float((predictions == evaluation_frame["config_candidate_id"]).mean())

    chosen_rows = []
    for base_job_id, prediction in zip(evaluation_frame["base_job_id"], predictions):
        subset = dataset[(dataset["base_job_id"] == base_job_id) & (dataset["config_candidate_id"] == prediction)]
        if not subset.empty:
            chosen_rows.append(rank_candidate_rows(subset, include_base_job=False).iloc[0])

    default_rows = rank_candidate_rows(
        dataset[dataset["config_candidate_id"] == "default"],
        include_base_job=True,
    ).groupby("base_job_id", as_index=False).first()
    chosen_df = pd.DataFrame(chosen_rows)
    merged = chosen_df.merge(
        default_rows[
            [
                "base_job_id",
                "wall_clock_ms",
                "utilization_ratio",
                "fitness",
                "used_sheet_count",
            ]
        ],
        on="base_job_id",
        suffixes=("_predicted", "_default"),
    )

    runtime_gain = 0.0
    utilization_delta = 0.0
    fitness_gain = 0.0
    sheet_savings = 0.0
    if not merged.empty:
        runtime_gain = float((merged["wall_clock_ms_default"] - merged["wall_clock_ms_predicted"]).median())
        utilization_delta = float((merged["utilization_ratio_predicted"] - merged["utilization_ratio_default"]).median())
        fitness_gain = float((merged["fitness_default"] - merged["fitness_predicted"]).median())
        sheet_savings = float((merged["used_sheet_count_default"] - merged["used_sheet_count_predicted"]).median())

    return {
        "exact_match_accuracy": exact_match,
        "evaluated_jobs": int(len(evaluation_frame)),
        "median_runtime_delta_ms_vs_default": runtime_gain,
        "median_utilization_delta_vs_default": utilization_delta,
        "median_fitness_gain_vs_default": fitness_gain,
        "median_sheet_savings_vs_default": sheet_savings,
    }

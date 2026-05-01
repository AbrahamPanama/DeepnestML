import json
import math
import os
import platform
import random
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from .schema import validate_document
from .training_profiles import resolve_training_profiles


DEFAULT_CONFIG = {
    "spacing": 0,
    "curveTolerance": 0.3,
    "rotations": 4,
    "populationSize": 10,
    "mutationRate": 10,
    "threads": 1,
    "placementType": "gravity",
    "mergeLines": True,
    "timeRatio": 0.5,
    "scale": 72,
    "simplify": False,
    "endpointTolerance": 0.36,
}


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


def resolve_default_solver_threads() -> int:
    override = parse_positive_int(os.environ.get("DEEPNEST_ML_SOLVER_THREADS"))
    if override is not None:
        return override

    # Compactness-focused training keeps the per-solve thread count fixed so
    # label quality is less sensitive to tiny timing differences.
    return 1


def resolve_profile_solver_threads(rng: random.Random, profile: Dict) -> int:
    profile_threads = parse_positive_int(profile.get("threads"))
    if profile_threads is not None:
        return profile_threads

    thread_choices = [
        value
        for value in (
            parse_positive_int(choice)
            for choice in profile.get("thread_choices", [])
        )
        if value is not None
    ]
    if thread_choices:
        return rng.choice(thread_choices)

    return resolve_default_solver_threads()


def rect(width: float, height: float) -> List[Dict[str, float]]:
    return [
        {"x": 0, "y": 0},
        {"x": width, "y": 0},
        {"x": width, "y": height},
        {"x": 0, "y": height},
    ]


def l_shape(width: float, height: float, thickness: float) -> List[Dict[str, float]]:
    return [
        {"x": 0, "y": 0},
        {"x": width, "y": 0},
        {"x": width, "y": thickness},
        {"x": thickness, "y": thickness},
        {"x": thickness, "y": height},
        {"x": 0, "y": height},
    ]


def t_shape(width: float, height: float, stem_width: float, stem_height: float) -> List[Dict[str, float]]:
    left = (width - stem_width) / 2.0
    return [
        {"x": 0, "y": 0},
        {"x": width, "y": 0},
        {"x": width, "y": height - stem_height},
        {"x": left + stem_width, "y": height - stem_height},
        {"x": left + stem_width, "y": height},
        {"x": left, "y": height},
        {"x": left, "y": height - stem_height},
        {"x": 0, "y": height - stem_height},
    ]


def c_shape(width: float, height: float, thickness: float) -> Dict[str, List]:
    outer = rect(width, height)
    hole = [
        {"x": thickness, "y": thickness},
        {"x": width - thickness, "y": thickness},
        {"x": width - thickness, "y": height - thickness},
        {"x": thickness, "y": height - thickness},
    ]
    return {"polygon": outer, "holes": [hole]}


def concave_star(radius: float, inner_radius: float, points: int) -> List[Dict[str, float]]:
    polygon = []
    for index in range(points * 2):
        r = radius if index % 2 == 0 else inner_radius
        angle = math.pi * index / points
        polygon.append({
            "x": math.cos(angle) * r + radius,
            "y": math.sin(angle) * r + radius,
        })
    return polygon


def random_rectangle_sheet(rng: random.Random) -> Dict:
    width = rng.randint(900, 1800)
    height = rng.randint(700, 1400)
    if rng.random() < 0.2:
        notch = min(width, height) * 0.2
        return {
            "item_id": "sheet-main",
            "kind": "sheet",
            "quantity": rng.choice([1, 1, 1, 2]),
            "polygon": [
                {"x": 0, "y": 0},
                {"x": width, "y": 0},
                {"x": width, "y": height},
                {"x": notch, "y": height},
                {"x": notch, "y": height * 0.65},
                {"x": 0, "y": height * 0.65},
            ],
            "holes": [],
        }
    return {
        "item_id": "sheet-main",
        "kind": "sheet",
        "quantity": rng.choice([1, 1, 1, 2]),
        "polygon": rect(width, height),
        "holes": [],
    }


def random_part(rng: random.Random, family: str, index: int, quantity_choices: Optional[List[int]] = None) -> Dict:
    quantity = rng.choice(quantity_choices or [1, 1, 2, 3])
    if family == "rect":
        width = rng.randint(40, 260)
        height = rng.randint(30, 180)
        polygon = rect(width, height)
        holes = []
    elif family == "l":
        width = rng.randint(80, 260)
        height = rng.randint(80, 260)
        thickness = rng.randint(20, int(min(width, height) * 0.45))
        polygon = l_shape(width, height, thickness)
        holes = []
    elif family == "t":
        width = rng.randint(90, 240)
        height = rng.randint(90, 260)
        stem_width = rng.randint(24, int(width * 0.5))
        stem_height = rng.randint(24, int(height * 0.45))
        polygon = t_shape(width, height, stem_width, stem_height)
        holes = []
    elif family == "holey":
        width = rng.randint(90, 260)
        height = rng.randint(90, 240)
        thickness = rng.randint(18, int(min(width, height) * 0.25))
        shape = c_shape(width, height, thickness)
        polygon = shape["polygon"]
        holes = shape["holes"]
    else:
        radius = rng.randint(40, 140)
        inner = max(10, int(radius * rng.uniform(0.35, 0.65)))
        polygon = concave_star(radius, inner, rng.choice([4, 5, 6]))
        holes = []

    return {
        "item_id": f"part-{family}-{index}",
        "kind": "part",
        "quantity": quantity,
        "polygon": polygon,
        "holes": holes,
        "metadata": {"family": family},
    }


def generate_job(job_id: str, source: str, rng: random.Random, profile: Dict) -> Dict:
    families = profile["families"]
    items = [random_rectangle_sheet(rng)]
    quantity_choices = profile.get("quantity_choices")

    for index, family in enumerate(families):
        items.append(random_part(rng, family, index, quantity_choices=quantity_choices))

    quantity_floor_choices = profile.get("quantity_floor_choices")
    if quantity_floor_choices:
        for item in items[1:]:
            item["quantity"] = max(item["quantity"], rng.choice(quantity_floor_choices))

    budget = {"max_evaluations": rng.choice(profile.get("budget_choices", [20, 24, 30, 36]))}
    config = dict(DEFAULT_CONFIG)
    config["populationSize"] = rng.choice(profile.get("population_choices", [8, 10, 12]))
    config["mutationRate"] = rng.choice(profile.get("mutation_choices", [8, 10, 12]))
    config["rotations"] = rng.choice(profile.get("rotation_choices", [4]))
    config["curveTolerance"] = rng.choice(profile.get("curve_tolerance_choices", [0.25, 0.3, 0.4]))
    config["threads"] = resolve_profile_solver_threads(rng, profile)
    if "placement_type" in profile:
        config["placementType"] = profile["placement_type"]
    if "merge_lines" in profile:
        config["mergeLines"] = bool(profile["merge_lines"])

    job = {
        "schema_version": "1.0.0",
        "job_id": job_id,
        "source": source,
        "metadata": {
            "profile": profile["profile_id"],
            "profile_name": profile["name"],
            "profile_kind": profile["kind"],
            "base_job_id": job_id,
        },
        "random_seed": rng.randint(0, 10_000_000),
        "budget": budget,
        "config": config,
        "items": items,
    }
    validate_document(job, "job.schema.json")
    return job


def write_jobs(output_dir: Path, jobs: Iterable[Dict]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for job in jobs:
        job_path = output_dir / f"{job['job_id']}.json"
        with job_path.open("w", encoding="utf-8") as handle:
            json.dump(job, handle, indent=2)
        manifest.append({"job_id": job["job_id"], "path": str(job_path)})
    with (output_dir / "manifest.json").open("w", encoding="utf-8") as handle:
        json.dump({"jobs": manifest}, handle, indent=2)


def generate_corpus(count: int, seed: int, source: str, selected_profile_ids: Optional[List[str]] = None) -> List[Dict]:
    rng = random.Random(seed)
    profiles = resolve_training_profiles(selected_profile_ids)
    if not profiles:
        raise ValueError("No training profiles available for synthetic corpus generation.")
    jobs = []
    for index in range(count):
        profile = profiles[index % len(profiles)]
        job_id = f"{source}-{index:04d}"
        jobs.append(generate_job(job_id, source, rng, profile))
    return jobs

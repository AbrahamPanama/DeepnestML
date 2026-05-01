import math
from typing import Dict, Iterable, List


def polygon_area(polygon: List[Dict[str, float]]) -> float:
    area = 0.0
    for index, current in enumerate(polygon):
        nxt = polygon[(index + 1) % len(polygon)]
        area += (current["x"] * nxt["y"]) - (nxt["x"] * current["y"])
    return area / 2.0


def polygon_bounds(polygon: List[Dict[str, float]]) -> Dict[str, float]:
    xs = [point["x"] for point in polygon]
    ys = [point["y"] for point in polygon]
    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


def material_area(item: Dict) -> float:
    area = abs(polygon_area(item["polygon"]))
    for hole in item.get("holes", []):
        area -= abs(polygon_area(hole))
    return area


def aspect_ratio(bounds: Dict[str, float]) -> float:
    width = max(bounds["width"], 1e-6)
    height = max(bounds["height"], 1e-6)
    ratio = width / height
    return ratio if ratio >= 1.0 else (1.0 / ratio)


def mean(values: Iterable[float]) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def extract_job_features(job: Dict) -> Dict[str, float]:
    part_items = [item for item in job["items"] if item["kind"] == "part"]
    sheet_items = [item for item in job["items"] if item["kind"] == "sheet"]

    part_areas = [material_area(item) for item in part_items]
    sheet_areas = [material_area(item) for item in sheet_items]
    part_bounds = [polygon_bounds(item["polygon"]) for item in part_items]

    expected_part_count = sum(item["quantity"] for item in part_items)
    expected_sheet_count = sum(item["quantity"] for item in sheet_items)
    total_part_area = sum(area * item["quantity"] for area, item in zip(part_areas, part_items))
    total_sheet_area = sum(area * item["quantity"] for area, item in zip(sheet_areas, sheet_items))
    total_holes = sum(len(item.get("holes", [])) for item in part_items)
    duplicate_ratio = 0.0
    if expected_part_count > 0:
        duplicate_ratio = 1.0 - (len(part_items) / float(expected_part_count))

    min_part_area = min(part_areas) if part_areas else 0.0
    max_part_area = max(part_areas) if part_areas else 0.0

    return {
        "job_id": job["job_id"],
        "source": job["source"],
        "item_catalog_count": len(job["items"]),
        "part_catalog_count": len(part_items),
        "sheet_catalog_count": len(sheet_items),
        "expected_part_count": expected_part_count,
        "expected_sheet_count": expected_sheet_count,
        "total_part_area": total_part_area,
        "total_sheet_area": total_sheet_area,
        "target_density": (total_part_area / total_sheet_area) if total_sheet_area else 0.0,
        "total_holes": total_holes,
        "hole_part_fraction": (sum(1 for item in part_items if item.get("holes")) / len(part_items)) if part_items else 0.0,
        "avg_vertices": mean(len(item["polygon"]) for item in part_items),
        "max_vertices": max((len(item["polygon"]) for item in part_items), default=0),
        "avg_bbox_aspect": mean(aspect_ratio(bounds) for bounds in part_bounds),
        "max_bbox_aspect": max((aspect_ratio(bounds) for bounds in part_bounds), default=0.0),
        "min_part_area": min_part_area,
        "max_part_area": max_part_area,
        "area_spread_ratio": (max_part_area / min_part_area) if min_part_area else 0.0,
        "duplicate_ratio": duplicate_ratio,
        "population_size": job["config"]["populationSize"],
        "mutation_rate": job["config"]["mutationRate"],
        "rotations": job["config"]["rotations"],
        "curve_tolerance": job["config"]["curveTolerance"],
        "spacing": job["config"]["spacing"],
    }


def flatten_run(job: Dict, result: Dict, manifest: Dict) -> Dict:
    features = extract_job_features(job)
    return {
        **features,
        "run_id": manifest["run_id"],
        "base_job_id": job.get("metadata", {}).get("base_job_id", job["job_id"]),
        "config_candidate_id": job.get("metadata", {}).get("config_candidate_id", "default"),
        "status": result["status"],
        "failure_reason": result.get("failure_reason"),
        "legal": result["legality"]["legal"],
        "all_parts_placed": result["legality"]["all_parts_placed"],
        "overlap_free": result["legality"]["overlap_free"],
        "within_sheet_bounds": result["legality"]["within_sheet_bounds"],
        "wall_clock_ms": result["timings_ms"]["wall_clock"],
        "evaluation_count": result.get("evaluation_count", 0),
        "fitness": result["metrics"]["fitness"],
        "used_sheet_count": result["metrics"]["used_sheet_count"],
        "placed_part_count": result["metrics"]["placed_part_count"],
        "utilization_ratio": result["metrics"]["utilization_ratio"],
        "merged_line_length": result["metrics"]["merged_line_length"],
        "manifest_status": manifest["status"],
    }

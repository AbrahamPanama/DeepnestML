import json
import re
from pathlib import Path
from typing import Dict, List, Optional

from .paths import CUSTOM_TRAINING_PROFILES_PATH


ALLOWED_FAMILIES = ("rect", "l", "t", "holey", "star")
FIXED_ROTATION_CHOICES = [4]
FAMILY_LABELS = {
    "rect": "Rectangles",
    "l": "L shapes",
    "t": "T shapes",
    "holey": "Holey parts",
    "star": "Stars",
}

BUILT_IN_TRAINING_PROFILES: List[Dict] = [
    {
        "profile_id": "rect_sparse",
        "name": "Rect Sparse",
        "kind": "built-in",
        "note": "simple rectangles with one concave part",
        "families": ["rect", "rect", "rect", "l"],
    },
    {
        "profile_id": "duplicate_heavy",
        "name": "Duplicate Heavy",
        "kind": "built-in",
        "note": "repeated rectangles with denser copy counts",
        "families": ["rect", "rect", "rect", "rect", "holey"],
        "quantity_floor_choices": [2, 3, 4],
    },
    {
        "profile_id": "concave_mix",
        "name": "Concave Mix",
        "kind": "built-in",
        "note": "L, T, and star-heavy concave jobs",
        "families": ["l", "t", "star", "rect", "star"],
    },
    {
        "profile_id": "hole_mix",
        "name": "Hole Mix",
        "kind": "built-in",
        "note": "mixed parts with internal holes",
        "families": ["holey", "rect", "l", "holey"],
    },
    {
        "profile_id": "mixed_scale",
        "name": "Mixed Scale",
        "kind": "built-in",
        "note": "mixed geometry and scale ranges",
        "families": ["rect", "rect", "l", "t", "star", "holey"],
    },
]

DEFAULT_SELECTED_PROFILE_IDS = [profile["profile_id"] for profile in BUILT_IN_TRAINING_PROFILES]


def _dedupe(values: List[str]) -> List[str]:
    ordered: List[str] = []
    for value in values:
        if value not in ordered:
            ordered.append(value)
    return ordered


def slugify_training_profile_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "custom-profile"


def _normalize_rotation_choices(raw_value) -> List[int]:
    if not isinstance(raw_value, list):
        return FIXED_ROTATION_CHOICES[:]

    normalized: List[int] = []
    for value in raw_value:
        try:
            rotation = int(value)
        except (TypeError, ValueError):
            continue
        if rotation == 4 and rotation not in normalized:
            normalized.append(rotation)

    return normalized or FIXED_ROTATION_CHOICES[:]


def _normalize_custom_profile(raw: Dict) -> Optional[Dict]:
    profile_id = str(raw.get("profile_id") or raw.get("id") or "").strip()
    if not profile_id:
        return None

    families = [
        str(family).strip()
        for family in raw.get("families", [])
        if str(family).strip() in ALLOWED_FAMILIES
    ]
    if not families:
        return None

    profile = {
        "profile_id": profile_id,
        "name": str(raw.get("name") or profile_id.replace("-", " ").title()).strip(),
        "kind": "custom",
        "note": str(raw.get("note") or raw.get("description") or "custom profile").strip(),
        "families": families,
        "rotation_choices": _normalize_rotation_choices(raw.get("rotation_choices")),
    }

    for key in (
        "quantity_choices",
        "quantity_floor_choices",
        "budget_choices",
        "population_choices",
        "mutation_choices",
        "curve_tolerance_choices",
    ):
        values = raw.get(key)
        if isinstance(values, list) and values:
            profile[key] = values

    for key in ("placement_type", "merge_lines"):
        if key in raw:
            profile[key] = raw[key]

    return profile


def load_custom_training_profiles(custom_path: Optional[Path] = None) -> List[Dict]:
    path = Path(custom_path) if custom_path else CUSTOM_TRAINING_PROFILES_PATH
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    records = payload.get("profiles", payload) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        return []

    profiles: List[Dict] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_custom_profile(item)
        if normalized:
            profiles.append(normalized)
    return profiles


def save_custom_training_profiles(profiles: List[Dict], custom_path: Optional[Path] = None) -> Path:
    path = Path(custom_path) if custom_path else CUSTOM_TRAINING_PROFILES_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump({"profiles": profiles}, handle, indent=2)
    return path


def upsert_custom_training_profile(raw: Dict, custom_path: Optional[Path] = None) -> Dict:
    normalized = _normalize_custom_profile(raw)
    if not normalized:
        raise ValueError("Custom profile is missing a valid id, name, or shape family mix.")

    profiles = load_custom_training_profiles(custom_path=custom_path)
    updated: List[Dict] = []
    replaced = False
    for profile in profiles:
        if profile["profile_id"] == normalized["profile_id"]:
            updated.append(normalized)
            replaced = True
        else:
            updated.append(profile)
    if not replaced:
        updated.append(normalized)
    save_custom_training_profiles(updated, custom_path=custom_path)
    return normalized


def delete_custom_training_profile(profile_id: str, custom_path: Optional[Path] = None) -> None:
    profile_id = str(profile_id).strip()
    if not profile_id:
        return
    profiles = load_custom_training_profiles(custom_path=custom_path)
    filtered = [profile for profile in profiles if profile["profile_id"] != profile_id]
    save_custom_training_profiles(filtered, custom_path=custom_path)


def list_training_profiles(custom_path: Optional[Path] = None) -> List[Dict]:
    return BUILT_IN_TRAINING_PROFILES + load_custom_training_profiles(custom_path=custom_path)


def resolve_training_profiles(selected_profile_ids: Optional[List[str]] = None, custom_path: Optional[Path] = None) -> List[Dict]:
    available_profiles = list_training_profiles(custom_path=custom_path)
    by_id = {profile["profile_id"]: profile for profile in available_profiles}

    if not selected_profile_ids:
        return BUILT_IN_TRAINING_PROFILES[:]

    resolved: List[Dict] = []
    missing: List[str] = []
    for profile_id in _dedupe([str(value).strip() for value in selected_profile_ids if str(value).strip()]):
        profile = by_id.get(profile_id)
        if profile:
            resolved.append(profile)
        else:
            missing.append(profile_id)

    if missing:
        raise ValueError("Unknown training profiles: {values}".format(values=", ".join(missing)))

    return resolved

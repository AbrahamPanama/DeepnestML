from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
ML_ROOT = REPO_ROOT / "ml"
SCHEMA_ROOT = ML_ROOT / "schemas"
CONFIG_CANDIDATES_PATH = ML_ROOT / "config_candidates.json"
EXAMPLES_ROOT = ML_ROOT / "examples"
REAL_WORLD_ROOT = ML_ROOT / "artifacts" / "real_world"
TRAINING_PROFILES_ROOT = ML_ROOT / "artifacts" / "training_profiles"
CUSTOM_TRAINING_PROFILES_PATH = TRAINING_PROFILES_ROOT / "custom_profiles.json"

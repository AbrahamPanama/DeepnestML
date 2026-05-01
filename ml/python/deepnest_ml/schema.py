import json
from pathlib import Path
from typing import Any, Dict

from .paths import SCHEMA_ROOT


class SchemaValidationError(RuntimeError):
    pass


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_schema(schema_name: str) -> Dict[str, Any]:
    return load_json(SCHEMA_ROOT / schema_name)


def validate_document(document: Dict[str, Any], schema_name: str) -> None:
    try:
        import jsonschema
    except Exception as exc:  # pragma: no cover - dependency guard
        if document.get("schema_version") != "1.0.0":
            raise SchemaValidationError(
                f"{schema_name} requires jsonschema for full validation; schema_version is invalid"
            ) from exc
        return

    schema = load_schema(schema_name)
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(document), key=lambda error: list(error.path))
    if errors:
        joined = "; ".join(error.message for error in errors)
        raise SchemaValidationError(f"{schema_name} validation failed: {joined}")

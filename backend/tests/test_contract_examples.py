"""Every file in contract/examples validates against its schema in contract/schemas.

Naming: examples/<group>/<name>.json (or <name>--<variant>.json) is checked
against schemas/<group>/<name>.schema.json.
"""

import importlib.util
import json
from pathlib import Path

import pytest

from app.config import REPO_ROOT
from app.schemas import CONTRACT_MODELS

from .jsonschema_lite import validate

EXAMPLES = REPO_ROOT / "contract" / "examples"
SCHEMAS = REPO_ROOT / "contract" / "schemas"
EXAMPLE_FILES = sorted(EXAMPLES.rglob("*.json"))


def _schema_name(example: Path) -> str:
    rel = example.relative_to(EXAMPLES).with_suffix("")
    return (rel.parent / rel.name.split("--")[0]).as_posix()


@pytest.mark.parametrize("example", EXAMPLE_FILES, ids=lambda p: p.relative_to(EXAMPLES).as_posix())
def test_example_matches_schema(example):
    name = _schema_name(example)
    schema_file = SCHEMAS / f"{name}.schema.json"
    assert schema_file.exists(), f"no schema for {example.name}"
    schema = json.loads(schema_file.read_text(encoding="utf-8"))
    instance = json.loads(example.read_text(encoding="utf-8"))
    assert validate(instance, schema) == []
    CONTRACT_MODELS[name].model_validate(instance)  # and the server's own model agrees


def test_every_schema_has_an_example():
    covered = {_schema_name(p) for p in EXAMPLE_FILES}
    assert covered == set(CONTRACT_MODELS)


def test_schema_files_match_models():
    spec = importlib.util.spec_from_file_location("export_schemas", REPO_ROOT / "scripts" / "export_schemas.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in CONTRACT_MODELS:
        on_disk = (SCHEMAS / f"{name}.schema.json").read_text(encoding="utf-8")
        assert on_disk == mod.render(name), f"{name} drifted: run python scripts/export_schemas.py"


def test_validator_rejects_bad_examples():
    schema = json.loads((SCHEMAS / "events" / "round.tick.schema.json").read_text(encoding="utf-8"))
    assert validate({"type": "round.tick", "seq": 1, "roundId": "r_1", "data": {"multiplier": 0.5, "elapsedMs": 1}}, schema)
    assert validate({"type": "round.tick", "seq": 1, "roundId": "r_1", "data": {"multiplier": 1.5, "elapsedMs": 1},
                     "crash": 2.0}, schema)

"""Regenerate contract/schemas/*.schema.json from backend/app/schemas.py.

Run after changing a wire model:  python scripts/export_schemas.py
A test (backend/tests/test_contract_examples.py) fails if the files drift.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.schemas import CONTRACT_MODELS  # noqa: E402

SCHEMA_DIR = ROOT / "contract" / "schemas"


def render(name: str) -> str:
    schema = CONTRACT_MODELS[name].model_json_schema()
    schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": f"{name}.schema.json", **schema}
    return json.dumps(schema, indent=2, sort_keys=False) + "\n"


def main() -> None:
    for name in CONTRACT_MODELS:
        path = SCHEMA_DIR / f"{name}.schema.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render(name), encoding="utf-8", newline="\n")
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

"""A small JSON Schema validator covering the keywords our generated schemas use.

Kept in tests so the runtime needs no extra dependency. Supports: type, enum,
const, pattern, minimum/maximum (and exclusive forms), minLength/maxLength,
properties, required, additionalProperties (bool or schema), items,
minItems/maxItems, anyOf, oneOf, allOf, $ref to "#/$defs/...". Annotation
keywords (title, description, default, examples) are ignored.
"""

from __future__ import annotations

import re

_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}
_KNOWN = {
    "type", "enum", "const", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "minLength", "maxLength", "properties", "required", "additionalProperties", "items", "minItems",
    "maxItems", "anyOf", "oneOf", "allOf", "$ref", "$defs", "$schema", "$id", "title", "description",
    "default", "examples", "format",
}


def validate(instance, schema: dict, root: dict | None = None, path: str = "$") -> list[str]:
    """Return a list of error strings (empty when valid)."""
    root = root or schema
    unknown = set(schema) - _KNOWN
    if unknown:
        return [f"{path}: validator does not support keywords {sorted(unknown)}"]
    if "$ref" in schema:
        name = schema["$ref"].removeprefix("#/$defs/")
        return validate(instance, root["$defs"][name], root, path)
    errors: list[str] = []
    for sub in schema.get("allOf", []):
        errors += validate(instance, sub, root, path)
    if "anyOf" in schema and not any(not validate(instance, s, root, path) for s in schema["anyOf"]):
        errors.append(f"{path}: matches none of anyOf")
    if "oneOf" in schema and sum(not validate(instance, s, root, path) for s in schema["oneOf"]) != 1:
        errors.append(f"{path}: must match exactly one of oneOf")
    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        if not any(_TYPES[x](instance) for x in types):
            return errors + [f"{path}: expected {t}, got {type(instance).__name__}"]
    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} not in {schema['enum']}")
    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: must equal {schema['const']!r}")
    if isinstance(instance, str):
        if "pattern" in schema and not re.search(schema["pattern"], instance):
            errors.append(f"{path}: {instance!r} does not match {schema['pattern']}")
        if len(instance) < schema.get("minLength", 0):
            errors.append(f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            errors.append(f"{path}: longer than {schema['maxLength']}")
    if _TYPES["number"](instance):
        if "minimum" in schema and instance < schema["minimum"]:
            errors.append(f"{path}: {instance} < minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errors.append(f"{path}: {instance} > maximum {schema['maximum']}")
        if "exclusiveMinimum" in schema and instance <= schema["exclusiveMinimum"]:
            errors.append(f"{path}: {instance} <= exclusiveMinimum {schema['exclusiveMinimum']}")
        if "exclusiveMaximum" in schema and instance >= schema["exclusiveMaximum"]:
            errors.append(f"{path}: {instance} >= exclusiveMaximum {schema['exclusiveMaximum']}")
    if isinstance(instance, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in instance:
                errors.append(f"{path}: missing required '{key}'")
        extra = schema.get("additionalProperties", True)
        for key, value in instance.items():
            if key in props:
                errors += validate(value, props[key], root, f"{path}.{key}")
            elif extra is False:
                errors.append(f"{path}: unexpected property '{key}'")
            elif isinstance(extra, dict):
                errors += validate(value, extra, root, f"{path}.{key}")
    if isinstance(instance, list):
        if len(instance) < schema.get("minItems", 0):
            errors.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            errors.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for i, item in enumerate(instance):
                errors += validate(item, schema["items"], root, f"{path}[{i}]")
    return errors

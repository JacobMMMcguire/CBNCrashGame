"""Check that Python and every dependency import cleanly.

Run with the project's virtual environment:
    .venv\\Scripts\\python scripts\\check_env.py      (Windows)
    .venv/bin/python scripts/check_env.py           (macOS / Linux)

On managed Windows machines, Windows Defender Application Control (or AppLocker)
can block compiled extension files such as pydantic_core's .pyd. This script
reports that in plain words instead of a raw traceback. It does not try to work
around a block: ask the machine's administrator to allow the file instead.
"""

from __future__ import annotations

import importlib
import sys

MIN_PYTHON = (3, 11)
MODULES = [
    ("fastapi", "fastapi"),
    ("pydantic", "pydantic"),
    ("pydantic_core", "pydantic-core (compiled, installed with pydantic)"),
    ("starlette", "starlette (installed with fastapi)"),
    ("uvicorn", "uvicorn"),
    ("websockets", "websockets"),
    ("httpx", "httpx"),
    ("pytest", "pytest"),
]
BLOCK_HINTS = (
    "application control",
    "applocker",
    "blocked by your organization",
    "has blocked this file",
    "winerror 4551",
    "winerror 1260",
)


def looks_blocked(err: BaseException) -> bool:
    text = f"{type(err).__name__}: {err}".lower()
    return any(h in text for h in BLOCK_HINTS) or getattr(err, "winerror", None) in (4551, 1260)


def main() -> int:
    ok = True
    version = ".".join(map(str, sys.version_info[:3]))
    if sys.version_info < MIN_PYTHON:
        print(f"[FAIL] Python {version}: version 3.11 or newer is required.")
        ok = False
    else:
        print(f"[ OK ] Python {version} ({sys.executable})")

    for module, label in MODULES:
        try:
            mod = importlib.import_module(module)
            print(f"[ OK ] {label} {getattr(mod, '__version__', '')}".rstrip())
        except ModuleNotFoundError:
            ok = False
            print(f"[FAIL] {label}: not installed. Run: python -m pip install -r requirements.txt")
        except (ImportError, OSError) as err:
            ok = False
            if looks_blocked(err):
                print(
                    f"[BLOCKED] {label}: Windows Application Control blocked a file in this package.\n"
                    f"          This is a machine policy, not a bug in the project. Ask your administrator to\n"
                    f"          allow the package files under {sys.prefix}, or use a machine without the policy."
                )
            else:
                print(f"[FAIL] {label}: could not be imported ({type(err).__name__}: {err})")

    print("Environment OK." if ok else "Environment has problems (see above).")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

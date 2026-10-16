"""Start the server: ``python -m app`` (with backend/ on PYTHONPATH).

Validates config/game.json first and prints a plain message if it is invalid,
instead of a traceback.
"""

from __future__ import annotations

import argparse
import os
import sys

from .config import ConfigError, load_config


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app", description="Run the Ascent skeleton server.")
    parser.add_argument("--host", default=os.environ.get("ASCENT_HOST") or "127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ASCENT_PORT") or 8001))
    parser.add_argument("--reload", action="store_true", help="restart when backend code changes")
    args = parser.parse_args()

    try:
        load_config()
    except ConfigError as err:
        print(f"Cannot start: {err}", file=sys.stderr)
        return 2

    import uvicorn

    print(f"Ascent skeleton: game at http://{args.host}:{args.port}/app/  (mock mode: /app/?mock=1)")
    uvicorn.run("app.main:create_app_from_env", factory=True, host=args.host, port=args.port, reload=args.reload)
    return 0


if __name__ == "__main__":
    sys.exit(main())

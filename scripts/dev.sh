#!/usr/bin/env sh
# Create the virtual environment, install dependencies, check them, and start
# the server. The game is served at http://127.0.0.1:8001/app/
#
# Usage (from anywhere):  sh scripts/dev.sh [--port 8001] [--reload]
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
elif [ -x .venv/Scripts/python.exe ]; then
  PY=.venv/Scripts/python.exe   # Git Bash on Windows
else
  BASE=""
  for candidate in python3.13 python3.12 python3.11 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
      BASE=$candidate
      break
    fi
  done
  if [ -z "$BASE" ]; then
    echo "Python 3.11 or newer was not found. Install it from https://www.python.org/downloads/ and try again."
    exit 1
  fi
  echo "Creating virtual environment in .venv ..."
  "$BASE" -m venv .venv
  if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=.venv/Scripts/python.exe; fi
fi

echo "Installing dependencies ..."
"$PY" -m pip install --disable-pip-version-check -q -r requirements.txt
"$PY" scripts/check_env.py

PYTHONPATH="$ROOT/backend" exec "$PY" -m app "$@"

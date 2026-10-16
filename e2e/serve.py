"""Start the Ascent server for the Playwright tests.

Playwright's webServer starts this script and stops it when the run ends.
As a second safety net, it also exits on its own as soon as the process
named in E2E_PARENT_PID (the Playwright runner) is gone, so a crashed or
force-closed test run never leaves a Python server behind.

Storage is forced to memory and the game config to e2e/game.e2e.json by the
environment that playwright.config.ts passes in; the real SQLite file is never
opened.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def _alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        SYNCHRONIZE, WAIT_TIMEOUT = 0x00100000, 0x102
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)  # POSIX: signal 0 only checks that the process exists
    except OSError:
        return False
    return True


def _watch_parent(pid: int) -> None:
    while _alive(pid):
        time.sleep(1)
    os._exit(0)


def main() -> int:
    if os.environ.get("STORAGE_BACKEND") != "memory":
        print("e2e server refuses to start without STORAGE_BACKEND=memory", file=sys.stderr)
        return 2
    parent = int(os.environ.get("E2E_PARENT_PID") or 0)
    if parent:
        threading.Thread(target=_watch_parent, args=(parent,), daemon=True).start()
    sys.path.insert(0, str(REPO / "backend"))
    from app.__main__ import main as run_server

    sys.argv = ["python -m app", "--host", "127.0.0.1", "--port", os.environ["E2E_PORT"]]
    return run_server()


if __name__ == "__main__":
    sys.exit(main())

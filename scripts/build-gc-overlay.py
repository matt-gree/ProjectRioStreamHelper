#!/usr/bin/env python3
"""Freeze the bundled gc-overlay submodule into a standalone one-folder app.

PRSH ships gc-overlay (the GameCube controller input overlay) as a nested,
independently-runnable PyInstaller build. This script produces that build so
PRSH.spec can vendor the resulting ``gc-overlay/dist/gc-overlay/`` folder.

It is invoked automatically from the top of ``PRSH.spec`` (before Analysis),
mirroring how ``freeze-version.py`` runs there. It can also be run by hand:

    python scripts/build-gc-overlay.py

The gc-overlay submodule has its own dependency set (aiohttp, pyusb) that is
deliberately kept out of PRSH's interpreter. So we build it in an isolated
venv inside the submodule (``gc-overlay/venv``, already gitignored there)
rather than PRSH's environment.

Set ``SKIP_GC_OVERLAY_BUILD=1`` to skip — useful when iterating on PRSH and
an existing ``gc-overlay/dist`` is good enough.
"""
from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GC_DIR = REPO_ROOT / "gc-overlay"
SPEC = GC_DIR / "gc-overlay.spec"
REQUIREMENTS = GC_DIR / "requirements.txt"

IS_WINDOWS = platform.system() == "Windows"
VENV_DIR = GC_DIR / "venv"
VENV_PYTHON = VENV_DIR / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
OUTPUT_EXE = GC_DIR / "dist" / "gc-overlay" / ("gc-overlay.exe" if IS_WINDOWS else "gc-overlay")


def _run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"[build-gc-overlay] $ {' '.join(str(c) for c in cmd)}", flush=True)
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def _ensure_submodule() -> None:
    if not (GC_DIR / "main.py").is_file() or not SPEC.is_file():
        raise SystemExit(
            "[build-gc-overlay] gc-overlay submodule not checked out.\n"
            "  Run: git submodule update --init --recursive"
        )


def _ensure_venv() -> None:
    if not VENV_PYTHON.exists():
        print("[build-gc-overlay] creating build venv", flush=True)
        _run([sys.executable, "-m", "venv", str(VENV_DIR)])
    # Idempotent: keep build deps current. pyusb is optional at runtime but
    # listed in requirements; installing it here lets PyInstaller bundle it.
    _run([str(VENV_PYTHON), "-m", "pip", "install", "-q", "-U", "pip"])
    _run([str(VENV_PYTHON), "-m", "pip", "install", "-q", "-r", str(REQUIREMENTS)])
    _run([str(VENV_PYTHON), "-m", "pip", "install", "-q", "pyinstaller"])


def main() -> int:
    if os.environ.get("SKIP_GC_OVERLAY_BUILD") == "1":
        print("[build-gc-overlay] SKIP_GC_OVERLAY_BUILD=1 — skipping", flush=True)
        return 0

    _ensure_submodule()
    _ensure_venv()

    _run(
        [
            str(VENV_PYTHON), "-m", "PyInstaller",
            "gc-overlay.spec",
            "--noconfirm",
            "--distpath", "dist",
            "--workpath", "build",
        ],
        cwd=GC_DIR,
    )

    if not OUTPUT_EXE.exists():
        raise SystemExit(
            f"[build-gc-overlay] expected output missing: {OUTPUT_EXE}"
        )
    print(f"[build-gc-overlay] built {OUTPUT_EXE}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

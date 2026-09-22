#!/usr/bin/env python3
"""Resolve and freeze the application version.

The version is the single source of truth for what users see in the
About panel and on the GitHub Release. Resolution order:

  1. `git describe --tags --always --dirty` — works in any clone with
     git history. On an exact tag (e.g. `v1.1.0`) returns "1.1.0".
     On commits past a tag, returns "1.1.0-3-gabcdef[-dirty]". With
     no tags, returns the short SHA (which the CI guard catches).
  2. Read `server/_version.py` — written by this script during build,
     used by frozen artifacts (PyInstaller bundles, Vite-built dist)
     where `git` is not available at runtime.
  3. Fallback "0.0.0-dev" — running from a tarball with no git and
     no frozen `_version.py`. Visible in the UI as a hint that the
     build is unidentified.

Usage:
  As a library (by PATH — the filename's hyphen is not a legal module
  name, so a plain `import freeze_version` has never worked; both real
  callers, server/settings.py and PRSH.spec, load it like this):
      import importlib.util
      spec = importlib.util.spec_from_file_location(
          "_freeze_version", "scripts/freeze-version.py")
      mod = importlib.util.module_from_spec(spec)
      spec.loader.exec_module(mod)
      print(mod.resolve_version())

  As a CLI (writes `server/_version.py` and prints the version):
      python scripts/freeze-version.py            # writes default path
      python scripts/freeze-version.py --write path/to/_version.py
      python scripts/freeze-version.py --print    # print only, no write
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FROZEN_PATH = REPO_ROOT / "server" / "_version.py"
FALLBACK_VERSION = "0.0.0-dev"


def _git_describe(repo: Path = REPO_ROOT) -> str | None:
    """Run `git describe`. Returns None if git is unavailable or repo has no
    history. Strips the leading "v" so "v1.1.0" -> "1.1.0".
    """
    try:
        out = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=repo,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    desc = out.stdout.strip()
    if not desc:
        return None
    # Strip a leading "v" only when the tag prefix actually matches a
    # version-looking string ("v1.2.3" or "v1.2.3-…"); leave plain SHAs alone.
    if desc.startswith("v") and len(desc) > 1 and desc[1].isdigit():
        desc = desc[1:]
    return desc


def _read_frozen(path: Path = DEFAULT_FROZEN_PATH) -> str | None:
    """Import-free read of VERSION from a generated _version.py.

    We do a flat parse rather than `import` so this works before the server
    package is set up (e.g. during PyInstaller bootstrap) and so a malformed
    file can't execute arbitrary code.
    """
    if not path.is_file():
        return None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("VERSION") and "=" in line:
                _, _, rhs = line.partition("=")
                return rhs.strip().strip('"').strip("'") or None
    except OSError:
        return None
    return None


def resolve_version(repo: Path = REPO_ROOT) -> str:
    """Resolve the canonical version string. See module docstring."""
    return (
        _git_describe(repo)
        or _read_frozen(DEFAULT_FROZEN_PATH)
        or FALLBACK_VERSION
    )


# ── Non-version metadata ────────────────────────────────────────────────────
#
# Name, description and authors follow the version through the same freeze,
# for the same reason: `pyproject.toml` is a BUILD file and is not bundled, so
# a frozen app could not read it and fell back to hardcoded defaults in
# server/settings.py — which is how GET /api/v1/config served `"authors": []`
# from every release while the dev server served the real list. Three copies of
# one fact, two of them wrong.

_METADATA_KEYS = ("name", "description", "authors")


def _read_pyproject_metadata(repo: Path = REPO_ROOT) -> dict | None:
    """The [tool.poetry] fields we publish, straight from pyproject.toml."""
    path = repo / "pyproject.toml"
    if not path.is_file():
        return None
    try:
        import tomllib
        poetry = tomllib.loads(path.read_text(encoding="utf-8"))["tool"]["poetry"]
    except Exception:
        return None
    out = {k: poetry[k] for k in _METADATA_KEYS if k in poetry}
    return out or None


def _read_frozen_metadata(path: Path = DEFAULT_FROZEN_PATH) -> dict | None:
    """Import-free read of METADATA from a generated _version.py.

    Same flat parse as `_read_frozen`, and for the same two reasons: it has to
    work before the `server` package is importable, and a malformed generated
    file must not be able to execute anything. `write_frozen` emits METADATA on
    ONE line specifically so this stays a line scan; `ast.literal_eval` then
    handles the list and the non-ASCII names without a TOML parser.
    """
    if not path.is_file():
        return None
    try:
        import ast
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("METADATA") and "=" in line:
                _, _, rhs = line.partition("=")
                value = ast.literal_eval(rhs.strip())
                return value if isinstance(value, dict) and value else None
    except (OSError, ValueError, SyntaxError):
        return None
    return None


def resolve_metadata(repo: Path = REPO_ROOT) -> dict:
    """Name/description/authors, by the same chain the version uses.

    pyproject (a source checkout) → frozen _version.py (a packaged build) →
    empty, which leaves the caller's own defaults in place.
    """
    return _read_pyproject_metadata(repo) or _read_frozen_metadata(DEFAULT_FROZEN_PATH) or {}


def write_frozen(
    version: str,
    path: Path = DEFAULT_FROZEN_PATH,
    metadata: dict | None = None,
) -> None:
    """Write VERSION and METADATA to a Python module frozen builds can read.

    Generated; gitignored. Idempotent — overwrites on each run.

    METADATA is emitted as a single-line repr so `_read_frozen_metadata` can
    stay a line scan rather than needing to import this file.
    """
    if metadata is None:
        metadata = resolve_metadata(path.parent.parent if path.parent else REPO_ROOT)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        '"""Generated by scripts/freeze-version.py — do not edit by hand."""\n'
        f'VERSION = "{version}"\n'
        f'METADATA = {metadata!r}\n',
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resolve and freeze app version.")
    parser.add_argument(
        "--write",
        type=Path,
        default=DEFAULT_FROZEN_PATH,
        help=f"Path to write _version.py (default: {DEFAULT_FROZEN_PATH.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--print",
        dest="print_only",
        action="store_true",
        help="Print the resolved version and exit without writing.",
    )
    args = parser.parse_args(argv)

    version = resolve_version()
    if not args.print_only:
        write_frozen(version, args.write)
    print(version)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""The app's version and metadata, resolved by one chain for every reader.

pyproject.toml (via scripts/freeze-version.py) in a source checkout, the
generated `server/_version.py` in a packaged build. `Config.Load` reads both
answers; PRSH.spec reaches the same script by path for the bundle's
VERSIONINFO and Info.plist.
"""
import ast
import importlib.util
import sys
from pathlib import Path

from loguru import logger

# Matches FALLBACK_VERSION in scripts/freeze-version.py: an unidentified build
# says so rather than naming a release.
FALLBACK_VERSION = "0.0.0-dev"


def _load_freeze_version_module():
    """Load scripts/freeze-version.py by PATH, or None.

    The module lives outside the `server` package because it has to be
    runnable as a standalone build script too (Vite prebuild, PyInstaller
    hook, CI checks), and its filename's hyphen means it can never be a
    plain import. Loaded by file path so it resolves in dev *and* in
    PyInstaller bundles, where the layout is flattened.
    """
    candidates = [
        Path(__file__).resolve().parent.parent / "scripts" / "freeze-version.py",
        Path(getattr(sys, "_MEIPASS", "")) / "scripts" / "freeze-version.py"
            if getattr(sys, "_MEIPASS", None) else None,
    ]
    for path in filter(None, candidates):
        if not path.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("_freeze_version", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
            return mod
        except Exception as e:
            logger.warning("[Config] freeze-version load failed at {}: {}", path, e)
    return None


def _frozen_version_file() -> Path:
    """The generated `server/_version.py` — the frozen build's ONLY source.

    Its own function because both resolvers below read it directly and had
    the same path literal twice, and because it is the seam a test points at
    a fixture. The file is GITIGNORED (written by `scripts/freeze-version.py`
    at prebuild), so a test that asserted against whatever happened to be on
    disk passed on any machine that had run a build and failed in CI, where
    nothing generates it — which is exactly how it failed.
    """
    return Path(__file__).resolve().parent / "_version.py"


def _frozen_assignment(name: str):
    """The literal assigned to `name` in the frozen `_version.py`, or None.

    Flat line scan + literal_eval rather than an import, matching
    `_read_frozen_metadata` in freeze-version.py: a generated file must not
    be able to execute anything, and this has to work whatever state the
    package is in.
    """
    frozen = _frozen_version_file()
    if not frozen.is_file():
        return None
    try:
        for line in frozen.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(name) and "=" in line:
                _, _, rhs = line.partition("=")
                return ast.literal_eval(rhs.strip())
    except (OSError, ValueError, SyntaxError) as e:
        logger.warning("[Config] frozen {} read failed: {}", name, e)
    return None


def resolve_metadata() -> dict:
    """Name/description/authors, resolved by the same chain as the version.

    Returns {} when neither source is readable, which leaves `Config.config`'s
    own defaults in place.

    This exists because `pyproject.toml` is a BUILD file and is not bundled,
    so a frozen app had no source for it and silently served the defaults —
    `"authors": []` from every release, while a dev server served the real
    list off the same endpoint.
    """
    mod = _load_freeze_version_module()
    if mod is not None:
        try:
            meta = mod.resolve_metadata()
            if meta:
                return meta
        except Exception as e:
            logger.warning("[Config] metadata resolve failed: {}", e)

    # THE FROZEN PATH, and the one that actually runs in a release.
    #
    # `scripts/` is not in the bundle — nothing lists it in PRSH.spec's datas —
    # so `_load_freeze_version_module` returns None in every packaged build and
    # the branch above never fires there. Metadata without this direct read
    # went on serving `"authors": []` from the bundle after the resolver was
    # supposedly fixed.
    value = _frozen_assignment("METADATA")
    return value if isinstance(value, dict) and value else {}


def resolve_version() -> str:
    """The app version: the freeze script's answer, else the frozen file's."""
    mod = _load_freeze_version_module()
    if mod is not None:
        try:
            return mod.resolve_version()
        except Exception as e:
            logger.warning("[Config] version resolve failed: {}", e)
    # The resolver couldn't be loaded at all (every packaged build — see
    # resolve_metadata). Read the frozen _version.py directly.
    value = _frozen_assignment("VERSION")
    return value if isinstance(value, str) and value else FALLBACK_VERSION

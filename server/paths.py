"""Writable path resolution for frozen builds.

Frozen builds install into read-only locations (macOS .app bundles on
read-only volumes, Windows Program Files under UAC), so all writable
paths (user_data, logs) are redirected to per-user app data:

    macOS:   ~/Library/Application Support/PRSH/
    Windows: %LOCALAPPDATA%\\PRSH\\  (falls back to ~/AppData/Local/PRSH)

Read-only assets (dist/, public/) remain in the bundle and are reached
via sys._MEIPASS; in dev mode they are anchored to the repo root (see
app_root), so the server works regardless of CWD.

Isolation overrides for agent/CI runs (see .claude/skills/run-and-verify):

    PRSH_USER_DATA_DIR  — writable user_data dir (state.json, settings.json, …)
    PRSH_PORT           — server port, wins over settings.json
    PRSH_NO_BROWSER     — suppress the autostart browser tab
    PRSH_HUD_FILE       — authoritative decoded.hud.json path (no existence
                          check; honored in server/rio/provider.py) for
                          scripts/replay-hud.py driven sessions
"""
import os
import sys
import shutil
import subprocess
from pathlib import Path

from loguru import logger


def _is_frozen() -> bool:
    return getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS')


def _frozen_writable_root() -> Path | None:
    """Per-user writable root for frozen builds, or None in dev mode."""
    if not _is_frozen():
        return None
    if sys.platform == 'darwin':
        return Path.home() / "Library" / "Application Support" / "PRSH"
    if sys.platform == 'win32':
        base = os.environ.get('LOCALAPPDATA') or str(Path.home() / "AppData" / "Local")
        return Path(base) / "PRSH"
    # Linux/other: fall back to XDG_DATA_HOME
    xdg = os.environ.get('XDG_DATA_HOME') or str(Path.home() / ".local" / "share")
    return Path(xdg) / "PRSH"


def user_data_dir() -> Path:
    """Return the writable user_data directory.

    Resolution order: PRSH_USER_DATA_DIR env override (isolated agent/CI
    runs) → per-user app data (frozen builds) → ./user_data (dev).
    """
    override = os.environ.get("PRSH_USER_DATA_DIR")
    if override:
        p = Path(override).expanduser()
    else:
        root = _frozen_writable_root()
        p = (root / "user_data") if root is not None else Path("./user_data")
    p.mkdir(parents=True, exist_ok=True)
    return p


def app_root() -> Path:
    """Root of the read-only app assets (dist/, public/, pyproject.toml).

    The repo root in dev — anchored to this file, not the CWD, so the server
    resolves its static mounts from any working directory. The PyInstaller
    bundle root (sys._MEIPASS) in frozen builds.
    """
    if _is_frozen():
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def env_port() -> int | None:
    """The PRSH_PORT env override as an int, or None (unset/invalid)."""
    raw = os.environ.get("PRSH_PORT")
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        logger.warning("[paths] ignoring non-numeric PRSH_PORT={!r}", raw)
        return None


def suppress_browser() -> bool:
    """Whether PRSH_NO_BROWSER asks us to skip the autostart browser tab."""
    return bool(os.environ.get("PRSH_NO_BROWSER"))


def reveal_path(path: Path | str) -> None:
    """Open ``path`` in the OS file manager (Finder / Explorer / xdg-open).

    Every "reveal this folder" button lands here. There were four copies of
    this before, and they had drifted apart rather than merely repeated: three
    branched on ``platform.system()`` and one on ``sys.platform``; three ran
    ``explorer`` and one ``os.startfile``; two swallowed the failure and two
    let it escape. Which button you pressed decided whether a reveal that could
    not run told you so — so the differences were behaviour, not style.

    Failure is logged, never raised: a reveal is a convenience, and a producer
    who cannot open a folder mid-broadcast is not helped by a 500.
    """
    path = str(path)
    try:
        if sys.platform == "win32":
            # Preferred over `explorer`: it honours the user's default handler
            # and does not return a non-zero exit code on success the way
            # explorer.exe does.
            os.startfile(path)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", path])
    except Exception:
        logger.exception("[paths] failed to reveal {}", path)


def logs_dir() -> Path:
    """The rotated-log directory main.py writes to. Created on access.

    Shared by the log viewer and the tray's "Open logs folder" so the two
    cannot point at different directories. (main.py resolves this itself, in
    `os.path` terms, because it runs before the server package is importable.)
    """
    p = (_frozen_writable_root() or Path(".").resolve()) / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def default_msb_assets_dir() -> Path:
    """Default location for user-supplied MSB image assets.

    Lives under user_data/ so it survives app updates and is writable in
    both dev and frozen builds. Created on access so the "Open Folder"
    button in Settings always reveals a real directory.
    """
    p = user_data_dir() / "game_assets" / "msb"
    p.mkdir(parents=True, exist_ok=True)
    return p


def rio_visualizer_dir() -> Path:
    """Return the directory that contains the importable ``rio_visualizer`` package.

    RioVisualizer is a git submodule at ``./rio-visualizer/`` whose top-level
    Python package is ``rio_visualizer``. Unlike pyrio (a sub-package under
    ``server/rio/``), it lives outside the ``server`` package, so its parent
    directory must be on ``sys.path`` for ``import rio_visualizer`` to resolve.

    In dev mode this resolves relative to this file (repo root), so it works
    regardless of CWD. In frozen builds the submodule is bundled at the root of
    ``sys._MEIPASS``.
    """
    if _is_frozen():
        return Path(sys._MEIPASS) / "rio-visualizer"
    # server/paths.py -> server/ -> repo root -> rio-visualizer/
    return Path(__file__).resolve().parent.parent / "rio-visualizer"


def ensure_rio_visualizer_on_path() -> None:
    """Add the RioVisualizer submodule dir to ``sys.path`` (idempotent).

    Enables ``from rio_visualizer.api import simulate`` from anywhere in PRSH.
    """
    d = str(rio_visualizer_dir())
    if d not in sys.path:
        sys.path.insert(0, d)


def ensure_pyrio_importable() -> None:
    """Alias PRSH's vendored pyrio under the top-level name ``pyrio`` (idempotent).

    pyrio lives at ``server/rio/pyrio`` and PRSH imports it as
    ``server.rio.pyrio``. RioVisualizer (a standalone submodule) imports the hit
    simulation engine as top-level ``pyrio`` (``from pyrio.hit_simulator...``).
    Aliasing our single copy into ``sys.modules`` makes that import resolve to
    the *same* package object instead of RioVisualizer pulling in its own nested
    pyrio checkout — one canonical engine, no version drift. Must run before
    ``rio_visualizer.api`` is first imported.
    """
    if "pyrio" in sys.modules:
        return
    import importlib
    sys.modules["pyrio"] = importlib.import_module("server.rio.pyrio")


def ensure_game_data():
    """Copy bundled game config files to the writable user_data on first run.

    Only relevant for frozen builds where user_data is outside the bundle.
    """
    if not _is_frozen():
        return

    bundled = Path(sys._MEIPASS) / "user_data" / "games"
    target = user_data_dir() / "games"

    if not bundled.is_dir():
        return
    if target.is_dir():
        return  # already copied

    logger.info(f"[paths] Copying bundled game data to {target}")
    shutil.copytree(str(bundled), str(target))

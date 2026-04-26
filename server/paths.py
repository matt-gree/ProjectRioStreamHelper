"""Writable path resolution for frozen builds.

Frozen builds install into read-only locations (macOS .app bundles on
read-only volumes, Windows Program Files under UAC), so all writable
paths (user_data, logs) are redirected to per-user app data:

    macOS:   ~/Library/Application Support/PRSH/
    Windows: %LOCALAPPDATA%\\PRSH\\  (falls back to ~/AppData/Local/PRSH)

Read-only assets (dist/, public/) remain in the bundle and are reached
via sys._MEIPASS. In dev mode everything stays relative to CWD.
"""
import os
import sys
import shutil
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
    """Return the writable user_data directory."""
    root = _frozen_writable_root()
    p = (root / "user_data") if root is not None else Path("./user_data")
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

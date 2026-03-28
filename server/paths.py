"""Writable path resolution for frozen builds.

On macOS .app bundles, the bundle contents may be on a read-only volume.
All writable paths (user_data, logs) are redirected to
~/Library/Application Support/PRSH/ while read-only assets (dist/, public/)
remain in the bundle.

On Windows frozen builds and dev mode, everything stays relative to CWD.
"""
import os
import sys
import shutil
from pathlib import Path

from loguru import logger


def _is_frozen_mac() -> bool:
    return (
        getattr(sys, 'frozen', False)
        and hasattr(sys, '_MEIPASS')
        and sys.platform == 'darwin'
    )


def user_data_dir() -> Path:
    """Return the writable user_data directory.

    On macOS frozen: ~/Library/Application Support/PRSH/user_data
    Otherwise: ./user_data (relative to CWD, which is sys._MEIPASS for frozen)
    """
    if _is_frozen_mac():
        p = Path.home() / "Library" / "Application Support" / "PRSH" / "user_data"
    else:
        p = Path("./user_data")
    p.mkdir(parents=True, exist_ok=True)
    return p


def ensure_game_data():
    """Copy bundled game config files to the writable user_data on first run.

    Only relevant for macOS frozen builds where user_data is outside the bundle.
    """
    if not _is_frozen_mac():
        return

    bundled = Path(sys._MEIPASS) / "user_data" / "games"
    target = user_data_dir() / "games"

    if not bundled.is_dir():
        return
    if target.is_dir():
        return  # already copied

    logger.info(f"[paths] Copying bundled game data to {target}")
    shutil.copytree(str(bundled), str(target))

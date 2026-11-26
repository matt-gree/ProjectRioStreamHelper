import asyncio
import orjson
from pathlib import Path
from typing import Callable, Awaitable

from loguru import logger
from watchfiles import awatch, Change

import pyrio
from pyrio import HUDSnapshot, Version

from server.rio.frame import frame_from_hud

# The client a HUD file came from is read off the stat files it writes beside
# it (see client_version). With none to read — a fresh install — assume the
# release PRSH was last checked against.
DEFAULT_CLIENT_VERSION = Version(2, 3, 0)

_version_cache: dict = {"key": None, "version": DEFAULT_CLIENT_VERSION}


def client_version() -> Version:
    """The Project Rio client version writing the HUD file.

    A HUD file doesn't say, and pyrio needs to know (the same label means
    different things across versions; 2.3.0 even writes the game id in hex).
    The same client writes the stat files in the sibling StatFiles folder, and
    every stat file records its version, so the newest one that reads is the
    answer. Cached on the folder's mtime, which changes when a file is added.
    """
    from server.postgame import files as stat_files  # files imports provider, which imports us

    folder = stat_files.stat_dir()
    try:
        key = (str(folder), folder.stat().st_mtime_ns)
    except OSError:
        return _version_cache["version"]
    if key == _version_cache["key"]:
        return _version_cache["version"]
    version = None
    for path in sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:5]:
        try:
            version = pyrio.read_game(path).version
            break
        except (pyrio.RioError, OSError, ValueError):
            continue  # a crash dump or a half-written file: try the one before
    _version_cache.update(key=key, version=version or _version_cache["version"])
    return _version_cache["version"]


def read_frame(data: dict, version: Version | str | None = None) -> tuple[HUDSnapshot, dict]:
    """A HUD file's JSON as pyrio's snapshot and the board frame built from it.

    ``version`` defaults to the client writing the stat files (client_version).
    """
    hud = pyrio.read_hud(data, version=version or client_version())
    return hud, frame_from_hud(hud)


class HudWatcher:
    """Async file watcher for Project Rio's decoded.hud.json.

    Uses OS-level file events (kqueue on macOS, inotify on Linux,
    ReadDirectoryChanges on Windows) via the watchfiles library.
    This means zero CPU usage between HUD events — the OS kernel
    notifies us only when the file actually changes.
    """

    def __init__(self, hud_file: Path, on_update: Callable[[dict], Awaitable[None]]):
        self.hud_file = hud_file
        self.on_update = on_update
        self.latest_game_data: dict | None = None
        # The typed file behind latest_game_data, for code that wants pyrio's view.
        self.latest_snapshot: HUDSnapshot | None = None
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    def start(self):
        self._stop_event.clear()
        self._task = asyncio.create_task(self._watch_loop())
        logger.info(f"[HudWatcher] Watching {self.hud_file} (OS-level events via watchfiles)")

    async def stop(self):
        self._stop_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("[HudWatcher] Stopped")

    async def reload(self) -> dict | None:
        """One-shot read of the HUD file. Returns the game dict or None.

        Sets self.last_error if the read fails, for diagnostics.
        """
        self.last_error = None
        try:
            raw = await asyncio.to_thread(self._read_and_parse)
            if raw is not None:
                self.latest_game_data = raw
                return raw
        except Exception as e:
            self.last_error = str(e)
            logger.error(f"[HudWatcher] Error reading HUD file: {e}")
        return None

    async def _watch_loop(self):
        """Watch the HUD file's parent directory for changes to the target file."""
        watch_dir = self.hud_file.parent
        target_name = self.hud_file.name

        try:
            async for changes in awatch(
                watch_dir,
                watch_filter=lambda change, path: Path(path).name == target_name,
                stop_event=self._stop_event,
                debounce=300,
                step=200,
            ):
                # Any modification to the target file triggers a read
                has_modify = any(
                    change_type in (Change.modified, Change.added)
                    for change_type, _ in changes
                )
                if has_modify:
                    try:
                        game = await self.reload()
                        if game is not None and self.on_update:
                            await self.on_update(game)
                    except Exception as e:
                        logger.error(f"[HudWatcher] Error processing HUD update: {e}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[HudWatcher] Watch loop fatal error: {e}")

    def _read_and_parse(self) -> dict | None:
        """Read the HUD file and turn it into a frame (see ``server/rio/frame.py``). Runs in a thread.

        Read as BYTES, never text. Project Rio writes this file as UTF-8, but a
        text-mode open decodes with the locale codec — UTF-8 on macOS, the ANSI
        code page on Windows — so a player whose Rio name is not pure ASCII made
        every read raise UnicodeDecodeError there, and the board stayed frozen
        for the whole game. orjson takes bytes and assumes UTF-8 per the JSON
        spec, which is both correct and one decode cheaper.

        Rio writes ``{}`` between games (before the first pitch of the next);
        that frame carries no game and reads as None.
        """
        with open(self.hud_file, "rb") as f:
            data = orjson.loads(f.read())
        if not data:
            return None
        self.latest_snapshot, frame = read_frame(data)
        return frame

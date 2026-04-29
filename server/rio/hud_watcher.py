import asyncio
import orjson
from pathlib import Path
from typing import Callable, Awaitable

from loguru import logger
from watchfiles import awatch, Change
from server.rio.pyrio.stat_file_parser import HudObj
from server.utils import json


def _norm_hand(val) -> int:
    """Normalize a hand value to 0 (right) or 1 (left).

    The HUD file may encode handedness as an int (0/1) or a string ("right"/"left").
    """
    if isinstance(val, str):
        return 1 if val.lower() == "left" else 0
    return 1 if val else 0


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

    def update_hud_file(self, new_hud_file: Path):
        self.hud_file = new_hud_file
        logger.info(f"[HudWatcher] Updated path to {self.hud_file}")

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
        """Read the HUD file and convert to flat game dict. Runs in thread."""
        with open(self.hud_file, "r") as f:
            data = orjson.loads(f.read())

        hud = HudObj(data)
        return self._convert_hud_data_format(hud)

    @staticmethod
    def _convert_hud_data_format(hud_data: HudObj) -> dict:
        """Convert HudObj into a flat game dict matching the Project Rio API format.

        Ported from the old RioHUDWatcher.convert_hud_data_format().
        Uses pyrio's HudObj methods for all data access.
        """
        game = {
            "away_captain": hud_data.captain_index(1),
            "away_player": hud_data.player(0),
            "away_score": hud_data.score(0),
            "away_stars": hud_data.team_stars(0),
            "batter": hud_data.batter_roster_location(),
            "half_inning": hud_data.half_inning(),
            "home_captain": hud_data.captain_index(0),
            "home_player": hud_data.player(1),
            "home_score": hud_data.score(1),
            "home_stars": hud_data.team_stars(1),
            "inning": hud_data.inning(),
            "outs": hud_data.outs(),
            "pitcher": hud_data.pitcher_roster_location(),
            "runner_on_first": hud_data.runner_on_first(),
            "runner_on_second": hud_data.runner_on_second(),
            "runner_on_third": hud_data.runner_on_third(),
            "runner_1b_name": hud_data.runner_char_name(1),
            "runner_2b_name": hud_data.runner_char_name(2),
            "runner_3b_name": hud_data.runner_char_name(3),
            "stadium_id": -1,
            "start_time": -1,
            "tag_set": -1,
            "balls": hud_data.balls(),
            "strikes": hud_data.strikes(),
            "event_num": hud_data.event_number,
        }

        # Roster data using pyrio's RosterObj
        for team_idx in range(2):
            team_name = "away" if team_idx == 0 else "home"
            ro = hud_data.roster_obj(team_idx)
            for i in range(9):
                game[f"{team_name}_roster_{i}_char"] = ro.char_id(i)
                game[f"{team_name}_roster_{i}_batting_hand"] = _norm_hand(ro.batting_hand(i))
                game[f"{team_name}_roster_{i}_fielding_hand"] = _norm_hand(ro.fielding_hand(i))
                game[f"{team_name}_roster_{i}_is_starred"] = ro.is_starred(i)
                game[f"{team_name}_roster_{i}_offensive"] = ro.offensive_stats(i)
                game[f"{team_name}_roster_{i}_defensive"] = ro.defensive_stats(i)

        return game

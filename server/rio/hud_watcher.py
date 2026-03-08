import asyncio
import os
from pathlib import Path
from typing import Callable, Awaitable

from loguru import logger
from server.rio.pyrio.stat_file_parser import HudObj
from server.rio.pyrio.lookup import LookupDicts, Lookup

from server.utils import json

_lookup_instance = None

def get_lookup():
    global _lookup_instance
    if _lookup_instance is None:
        _lookup_instance = Lookup()
    return _lookup_instance


class HudWatcher:
    """Async file watcher for Project Rio's decoded.hud.json.

    Polls the file's mtime every 100ms. When a change is detected,
    reads and parses the file via pyrio's HudObj, converts to a flat
    game dict, and calls the on_update callback.
    """

    def __init__(self, hud_file: Path, on_update: Callable[[dict], Awaitable[None]]):
        self.hud_file = hud_file
        self.on_update = on_update
        self.latest_game_data: dict | None = None
        self._task: asyncio.Task | None = None

    def start(self):
        self._task = asyncio.create_task(self._watch_loop())
        logger.info(f"[HudWatcher] Watching {self.hud_file}")

    async def stop(self):
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
        """One-shot read of the HUD file. Returns the game dict or None."""
        try:
            raw = await asyncio.to_thread(self._read_and_parse)
            if raw is not None:
                self.latest_game_data = raw
                return raw
        except Exception as e:
            logger.error(f"[HudWatcher] Error reading HUD file: {e}")
        return None

    async def _watch_loop(self):
        last_mtime = 0.0
        while True:
            try:
                mtime = await asyncio.to_thread(self._get_mtime)
                if mtime is not None and mtime != last_mtime:
                    last_mtime = mtime
                    game = await self.reload()
                    if game is not None and self.on_update:
                        await self.on_update(game)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[HudWatcher] Watch loop error: {e}")
            await asyncio.sleep(0.1)

    def _get_mtime(self) -> float | None:
        try:
            return os.stat(self.hud_file).st_mtime
        except FileNotFoundError:
            return None

    def _read_and_parse(self) -> dict | None:
        """Read the HUD file and convert to flat game dict. Runs in thread."""
        with open(self.hud_file, "r") as f:
            import orjson
            data = orjson.loads(f.read())

        hud = HudObj(data)
        return self._convert_hud_data_format(hud)

    @staticmethod
    def _convert_hud_data_format(hud_data: HudObj) -> dict:
        """Convert HudObj into a flat game dict matching the Project Rio API format.

        Ported from the old RioHUDWatcher.convert_hud_data_format().
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
            "stadium_id": -1,
            "start_time": -1,
            "tag_set": -1,
            "balls": hud_data.balls(),
            "strikes": hud_data.strikes(),
        }

        def flatten_roster_dict(roster_dict: dict, team_name: str) -> dict:
            flat = {}
            for index, data in roster_dict.items():
                key = f"{team_name}_roster_{index}_char"
                flat[key] = get_lookup().lookup(LookupDicts.CHAR_NAME, data["char_id"])
            return flat

        game.update(flatten_roster_dict(hud_data.roster(0), "away"))
        game.update(flatten_roster_dict(hud_data.roster(1), "home"))

        return game

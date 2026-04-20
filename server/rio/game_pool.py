import asyncio
import math

import numpy as np
import pandas as pd
from loguru import logger
from server import socketio
from server.rio.provider import (
    RioGameDataProvider,
    apply_parsed_game_to_state,
    apply_completed_game_to_state,
)
from server.rio import stats_api
from server.rio.stats_api import get_last_completed_fetch_info
from server.rio.pyrio.lookup import LookupDicts
from server.settings import Settings


def _sanitize_row(d: dict) -> dict:
    """Convert pandas/numpy types to JSON-safe Python types."""
    out = {}
    for k, v in d.items():
        if isinstance(v, (pd.Timestamp,)):
            out[k] = v.isoformat() if pd.notna(v) else None
        elif isinstance(v, (np.integer,)):
            out[k] = int(v)
        elif isinstance(v, (np.floating,)):
            out[k] = None if math.isnan(v) else float(v)
        elif isinstance(v, (np.bool_,)):
            out[k] = bool(v)
        elif isinstance(v, float) and math.isnan(v):
            out[k] = None
        elif v is pd.NaT:
            out[k] = None
        else:
            out[k] = v
    return out


def _pinned_swap_needed(player0: str, player1: str) -> bool | None:
    """Check if the pinned player setting requires swapping sides.

    Returns True if swap needed, False if no swap needed, None if
    pinned player is not in this game.
    """
    pinned_player = Settings.settings.get("project_rio", {}).get("pinned_player", "").strip()
    if not pinned_player:
        return None
    pinned_side = Settings.settings.get("project_rio", {}).get("pinned_side", "Team 1")
    pinned_index = 0 if pinned_side == "Team 1" else 1

    if player0 == pinned_player:
        return pinned_index == 1
    elif player1 == pinned_player:
        return pinned_index == 0
    return None


class OngoingGamePool:
    """Shared pool of ongoing Project Rio games fetched from the API.

    One singleton polls the API periodically. Individual scoreboards
    select games from this pool by game_id rather than making their
    own API calls.
    """

    games: dict = {}  # game_id -> parsed game dict
    _poll_task: asyncio.Task | None = None
    _poll_interval: float = 10.0
    _auto_poll: bool = False

    @classmethod
    async def Start(cls):
        cls._auto_poll = False
        cls._poll_interval = await Settings.Get("ongoing_games.poll_interval", 10.0)
        # Always start with auto-poll off regardless of previous session state
        await Settings.Set("ongoing_games.auto_poll", False)
        logger.info("[OngoingGamePool] Initialized (auto_poll=False)")

    @classmethod
    async def Stop(cls):
        cls._stop_polling()
        cls.games = {}
        logger.info("[OngoingGamePool] Stopped")

    @classmethod
    def _start_polling(cls):
        if cls._poll_task and not cls._poll_task.done():
            return
        cls._poll_task = asyncio.create_task(cls._poll_loop())

    @classmethod
    def _stop_polling(cls):
        if cls._poll_task and not cls._poll_task.done():
            cls._poll_task.cancel()
        cls._poll_task = None

    @classmethod
    async def set_auto_poll(cls, enabled: bool, interval: float | None = None):
        """Enable or disable auto-polling."""
        cls._auto_poll = enabled
        await Settings.Set("ongoing_games.auto_poll", enabled)
        if interval is not None:
            cls._poll_interval = interval
            await Settings.Set("ongoing_games.poll_interval", interval)

        cls._stop_polling()
        if enabled:
            cls._start_polling()
            logger.info("[OngoingGamePool] Auto-poll enabled (interval={}s)", cls._poll_interval)
        else:
            logger.info("[OngoingGamePool] Auto-poll disabled")

    @classmethod
    async def _poll_loop(cls):
        while True:
            try:
                await cls._fetch_games()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[OngoingGamePool] Poll error")
            await asyncio.sleep(cls._poll_interval)

    @classmethod
    async def _fetch_games(cls):
        """Fetch ongoing games from Project Rio API."""
        # Ensure game mode names are cached for tag_set resolution
        if not stats_api._game_modes:
            try:
                await stats_api.fetch_game_modes()
            except Exception:
                pass  # best-effort; will show raw IDs if unavailable

        raw = await stats_api.fetch_ongoing_games()
        if not raw:
            return

        new_games = {}
        games_list = (
            raw.get("ongoing_games")
            or raw.get("games")
            or (raw if isinstance(raw, list) else [])
        )

        # Build reverse mapping: tag_set_id -> game_mode_name from cache
        tag_set_id_to_name = {v: k for k, v in stats_api._game_modes.items()} if stats_api._game_modes else {}

        for g in games_list:
            away_player = g.get("away_player", "")
            home_player = g.get("home_player", "")
            start_time = g.get("start_time", 0)

            # Generate a stable synthetic game_id (the API does not provide one)
            game_id = abs(hash((away_player, home_player, start_time))) % (2 ** 31)

            # Resolve integer captain indices to character names for display
            away_cap_idx = g.get("away_captain", 0)
            home_cap_idx = g.get("home_captain", 0)

            # Resolve tag_set integer to a human-readable game mode name
            tag_set_id = g.get("tag_set")
            game_mode_name = tag_set_id_to_name.get(
                tag_set_id, f"ID:{tag_set_id}" if tag_set_id is not None else ""
            )

            # Build enriched game dict — all raw fields are preserved so that
            # parse_game_data() can consume them unchanged when applying to a scoreboard.
            game = dict(g)
            game["game_id"] = game_id
            game["source_type"] = "live_game"
            game["game_completed"] = False
            # Display-friendly aliases used by the frontend table
            game["away_user"] = away_player
            game["home_user"] = home_player
            game["away_captain_name"] = LookupDicts.CHAR_NAME.get(away_cap_idx, str(away_cap_idx))
            game["home_captain_name"] = LookupDicts.CHAR_NAME.get(home_cap_idx, str(home_cap_idx))
            game["game_mode_name"] = game_mode_name

            new_games[game_id] = game

        cls.games = new_games
        await socketio.emit("v1.game_pool.ongoing_update", cls.list_games())

    @classmethod
    def get_game(cls, game_id) -> dict | None:
        return cls.games.get(game_id) or cls.games.get(str(game_id))

    @classmethod
    def list_games(cls) -> list:
        return list(cls.games.values())

    @classmethod
    async def apply_game_to_scoreboard(cls, game_id, scoreboard_number: int) -> bool:
        """Apply a specific ongoing API game's data to a scoreboard's state."""
        game = cls.get_game(game_id)
        if not game:
            return False

        # Parse raw game data (all original API fields are preserved in the stored dict)
        parsed = RioGameDataProvider.parse_game_data(game)
        parsed["game_id"] = game_id

        # Check if pinned player requires a side swap
        entrants = parsed.get("entrants", [[{}], [{}]])
        player0 = entrants[0][0].get("rioName", "") if entrants[0] else ""
        player1 = entrants[1][0].get("rioName", "") if entrants[1] else ""
        swap = _pinned_swap_needed(player0, player1)

        if swap:
            parsed["entrants"] = list(reversed(parsed["entrants"]))
            parsed["team1score"], parsed["team2score"] = parsed.get("team2score", 0), parsed.get("team1score", 0)
            home_team = 1
        else:
            home_team = 2

        await apply_parsed_game_to_state(parsed, scoreboard_number, home_team=home_team)

        await Settings.Set(f"scoreboards.sources.{scoreboard_number}",
                           {"type": "live_game", "api_game_id": game_id})

        # Load the game's mode into the stats tag selector (if resolved)
        game_mode_name = game.get("game_mode_name", "")
        if game_mode_name and not game_mode_name.startswith("ID:"):
            await Settings.Set("project_rio.stats_tag", game_mode_name)

        return True


class CompletedGamePool:
    """Pool of completed Project Rio games fetched from the /games endpoint.

    Stores processed game data from pyrio's DataFrame output. Auto-poll is
    optional (default off); games can be fetched on-demand via refresh.
    """

    games: dict = {}  # game_id -> game dict
    _poll_task: asyncio.Task | None = None
    _auto_poll: bool = False
    _poll_interval: float = 60.0
    _filters: dict = {}

    @classmethod
    async def Start(cls):
        cls._auto_poll = False
        cls._poll_interval = await Settings.Get("completed_games.poll_interval", 60.0)
        cls._filters = await Settings.Get("completed_games.filters", {})
        # Always start with auto-poll off regardless of previous session state
        await Settings.Set("completed_games.auto_poll", False)
        logger.info("[CompletedGamePool] Initialized (auto_poll=False)")

    @classmethod
    async def Stop(cls):
        cls._stop_polling()
        cls.games = {}
        logger.info("[CompletedGamePool] Stopped")

    @classmethod
    def _start_polling(cls):
        if cls._poll_task and not cls._poll_task.done():
            return
        cls._poll_task = asyncio.create_task(cls._poll_loop())

    @classmethod
    def _stop_polling(cls):
        if cls._poll_task and not cls._poll_task.done():
            cls._poll_task.cancel()
        cls._poll_task = None

    @classmethod
    async def _poll_loop(cls):
        while True:
            try:
                await cls.refresh()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[CompletedGamePool] Poll error")
            await asyncio.sleep(cls._poll_interval)

    @classmethod
    async def refresh(cls, filters: dict | None = None):
        """Fetch completed games from the API. Uses stored filters if none provided."""
        if filters is not None:
            cls._filters = filters
            await Settings.Set("completed_games.filters", filters)

        df = await stats_api.fetch_completed_games(**cls._filters)
        diag = get_last_completed_fetch_info()
        if df.empty:
            cls.games = {}
            await socketio.emit("v1.game_pool.completed_update", {
                "games": [],
                "diagnostics": diag,
            })
            return

        new_games = {}
        for _, row in df.iterrows():
            game = _sanitize_row(row.to_dict())
            game_id = game.get("game_id")
            if game_id is None:
                continue
            # Mark as completed
            game["source_type"] = "rotator"
            game["game_completed"] = True
            new_games[game_id] = game

        cls.games = new_games
        await socketio.emit("v1.game_pool.completed_update", {
            "games": cls.list_games(),
            "diagnostics": diag,
        })

    @classmethod
    async def set_auto_poll(cls, enabled: bool, interval: float | None = None):
        """Enable or disable auto-polling. Restarts the poll loop if interval changes."""
        cls._auto_poll = enabled
        await Settings.Set("completed_games.auto_poll", enabled)
        if interval is not None:
            cls._poll_interval = interval
            await Settings.Set("completed_games.poll_interval", interval)

        # Always stop existing task first so interval changes take effect
        cls._stop_polling()
        if enabled:
            cls._start_polling()
            logger.info("[CompletedGamePool] Auto-poll enabled (interval={}s, filters={})",
                        cls._poll_interval, cls._filters)
        else:
            logger.info("[CompletedGamePool] Auto-poll disabled")

    @classmethod
    def get_game(cls, game_id) -> dict | None:
        return cls.games.get(game_id) or cls.games.get(str(game_id))

    @classmethod
    def list_games(cls) -> list:
        return list(cls.games.values())

    @classmethod
    async def apply_game_to_scoreboard(cls, game_id, scoreboard_number: int) -> bool:
        """Apply a completed game's data to a scoreboard's state."""
        game = cls.get_game(game_id)
        if not game:
            return False

        # Check if pinned player requires a side swap
        # Completed games use away_user (Team 1) and home_user (Team 2)
        away_user = game.get("away_user", "")
        home_user = game.get("home_user", "")
        swap = _pinned_swap_needed(away_user, home_user)

        if swap:
            # Swap away/home fields so the pinned player lands on the correct side
            game = dict(game)
            game["away_user"], game["home_user"] = game["home_user"], game["away_user"]
            game["away_score"], game["home_score"] = game.get("home_score", 0), game.get("away_score", 0)
            game["away_captain"], game["home_captain"] = game.get("home_captain", ""), game.get("away_captain", "")

        await apply_completed_game_to_state(game, scoreboard_number)

        await Settings.Set(f"scoreboards.sources.{scoreboard_number}",
                           {"type": "rotator", "api_game_id": game_id})
        return True


# Backward-compatible alias for imports that reference the old name
RioGamePool = OngoingGamePool

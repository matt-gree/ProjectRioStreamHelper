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
from server.match import Match
from server.rio.game_end import GameEndWatcher
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
    pinned_player = Settings.Get("project_rio.pinned_player", "").strip()
    if not pinned_player:
        return None
    pinned_side = Settings.Get("project_rio.pinned_side", "Team 1")
    pinned_index = 0 if pinned_side == "Team 1" else 1

    if player0 == pinned_player:
        return pinned_index == 1
    elif player1 == pinned_player:
        return pinned_index == 0
    return None


def _orient_pin_match(left: str, right: str, sb: int) -> tuple[bool, str]:
    """Side orientation for an API game as (swap, reason).

    The API pools have no HUD manual-swap / back-to-back state machine, so the
    cascade is just pin > match (matching the global precedence). `reason` names
    the deciding layer (or "" for raw order) and is mirrored to side_reason.
    """
    pin = _pinned_swap_needed(left, right)
    if pin is not None:
        return pin, "pin"
    mo = Match.orientation_for_sides(sb, left, right)
    if mo is not None:
        return mo, "match"
    return False, ""


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
        cls._poll_interval = Settings.Get("ongoing_games.poll_interval", 10.0)
        # Always start with auto-poll off regardless of previous session state
        await Settings.Set("ongoing_games.auto_poll", False)
        GameEndWatcher.reset()
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

        prev_games = cls.games
        cls.games = new_games
        # Phase C: a followed match-game dropping out of ongoing is the signal to
        # resolve its winner and credit the series (see server/rio/game_end.py).
        try:
            GameEndWatcher.on_ongoing_poll(prev_games, new_games)
        except Exception:
            logger.exception("[OngoingGamePool] game-end hook error")
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

        # Side orientation: pin > match (see _orient_pin_match).
        entrants = parsed.get("entrants", [[{}], [{}]])
        player0 = entrants[0][0].get("rioName", "") if entrants[0] else ""
        player1 = entrants[1][0].get("rioName", "") if entrants[1] else ""
        swap, reason = _orient_pin_match(player0, player1, scoreboard_number)

        if swap:
            parsed["entrants"] = list(reversed(parsed["entrants"]))
            parsed["team1score"], parsed["team2score"] = parsed.get("team2score", 0), parsed.get("team1score", 0)
            home_team = 1
        else:
            home_team = 2

        await apply_parsed_game_to_state(
            parsed, scoreboard_number, home_team=home_team, side_reason=reason
        )

        # Record the game currently applied to this scoreboard (used for
        # is-new-game detection on the next apply). Leave `playback.mode`
        # alone — a rotating board ticking through its pool must not flip
        # back to single. Likewise, do NOT auto-set stats_tag from the game's
        # mode here: that would (a) override the user's selected game mode
        # and (b) trigger a stats refetch on every poll via the frontend's
        # tag-change effect.
        await Settings.Set(
            f"scoreboards.binding.{scoreboard_number}.playback.gameId", game_id
        )

        return True


async def apply_completed_game_dict(game: dict, scoreboard_number: int) -> bool:
    """Apply a completed-game dict to a scoreboard.

    Used by both the manual browser (CompletedGamePool.apply_game_to_scoreboard)
    and pool rotations (PoolState, which holds its own per-pool game cache).
    Performs the pinned-player side swap and persists the applied gameId.
    """
    if not game:
        return False

    away_user = game.get("away_user", "")
    home_user = game.get("home_user", "")
    swap, reason = _orient_pin_match(away_user, home_user, scoreboard_number)

    if swap:
        game = dict(game)
        game["away_user"], game["home_user"] = game["home_user"], game["away_user"]
        game["away_score"], game["home_score"] = game.get("home_score", 0), game.get("away_score", 0)
        game["away_captain"], game["home_captain"] = game.get("home_captain", ""), game.get("away_captain", "")

    await apply_completed_game_to_state(game, scoreboard_number, side_reason=reason)
    await Settings.Set(
        f"scoreboards.binding.{scoreboard_number}.playback.gameId", game.get("game_id")
    )
    return True


class CompletedGamePool:
    """One-shot completed-game search helper for the manual browser UI.

    Pool rotations no longer use this — each PoolState holds its own filters
    and game cache (server.rio.rotation.PoolState). What remains here is
    a thin convenience layer for the Game Pool Manager modal: a single
    `fetch(filters)` call that runs a query, caches the latest result so
    `assign_game` can resolve it by id, and emits a SocketIO update for the
    modal table.

    There is no auto-poll loop and no persisted filter set. The modal calls
    fetch on user action; the cache is purely a transient memo of the most
    recent search.
    """

    games: dict = {}  # game_id -> game dict (latest search result)

    @classmethod
    async def Start(cls):
        logger.info("[CompletedGamePool] Initialized")

    @classmethod
    async def Stop(cls):
        cls.games = {}
        logger.info("[CompletedGamePool] Stopped")

    @classmethod
    async def fetch(cls, filters: dict | None = None) -> dict:
        """Run a one-shot completed-games query.

        Updates `cls.games` with the result (so the manual browser's `assign`
        endpoint can resolve game_ids back to dicts) and emits an update
        event for the modal. Returns the {game_id: game} dict; callers that
        own their own cache (rotations) should use this return value rather
        than relying on the class-level cache.
        """
        filters = filters or {}
        df = await stats_api.fetch_completed_games(**filters)
        diag = get_last_completed_fetch_info()

        new_games: dict = {}
        if not df.empty:
            for _, row in df.iterrows():
                game = _sanitize_row(row.to_dict())
                game_id = game.get("game_id")
                if game_id is None:
                    continue
                game["source_type"] = "rotator"
                game["game_completed"] = True
                new_games[game_id] = game

        cls.games = new_games
        await socketio.emit("v1.game_pool.completed_update", {
            "games": cls.list_games(),
            "diagnostics": diag,
        })
        return new_games

    @classmethod
    def get_game(cls, game_id) -> dict | None:
        return cls.games.get(game_id) or cls.games.get(str(game_id))

    @classmethod
    def list_games(cls) -> list:
        return list(cls.games.values())

    @classmethod
    async def apply_game_to_scoreboard(cls, game_id, scoreboard_number: int) -> bool:
        """Apply a cached completed game (by id) to a scoreboard."""
        return await apply_completed_game_dict(cls.get_game(game_id), scoreboard_number)


# Backward-compatible alias for imports that reference the old name
RioGamePool = OngoingGamePool

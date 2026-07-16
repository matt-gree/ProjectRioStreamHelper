import asyncio
import hashlib
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

# Polls a followed live game may be absent from the ongoing feed before we treat
# it as ended (~2 poll intervals of grace against a flickering feed).
END_MISS_TOLERANCE = 2


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


def _stable_ongoing_game_id(away_player: str, home_player: str, start_time) -> int:
    """Deterministic synthetic id for an ongoing game (the API provides none).

    Must be stable across process restarts because `playback.gameId` is
    persisted in Settings and looked up later — built-in `hash()` is
    PYTHONHASHSEED-randomized per process and would break that lookup.
    """
    digest = hashlib.sha1(f"{away_player}|{home_player}|{start_time}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % (2 ** 31)


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
    # Per-board live-follow lifecycle. A single-mode board following a live game
    # is a "live consumer" (keeps the ongoing poll running) only until that game
    # leaves the feed. `_follow_misses` counts consecutive polls the followed
    # game has been absent; once it crosses END_MISS_TOLERANCE, `_ended_follow`
    # records {sb_id: game_id} so the poll loop stops fetching for a game that's
    # over. Both are cleared when the followed game reappears or a new one loads.
    _follow_misses: dict = {}
    _ended_follow: dict = {}

    @classmethod
    async def Start(cls):
        cls._poll_interval = Settings.Get("ongoing_games.poll_interval", 10.0)
        GameEndWatcher.reset()
        # Polling is demand-driven: the loop always runs but only hits the API
        # on ticks where a board actually needs live data (see
        # _live_consumers_exist). This replaces the old user-facing on/off
        # toggle, which was a process-wide setting disguised as a per-scoreboard
        # control and left loaded live games silently frozen when off.
        cls._start_polling()
        logger.info("[OngoingGamePool] Initialized (demand-driven polling, interval={}s)", cls._poll_interval)

    @classmethod
    async def Stop(cls):
        cls._stop_polling()
        cls.games = {}
        cls._follow_misses = {}
        cls._ended_follow = {}
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
        """Adjust the live-poll interval. Retained for the legacy
        /game-pool/ongoing/auto-poll endpoint; the `enabled` flag is now a
        no-op because polling is demand-driven (see _live_consumers_exist).
        Only the interval is honored."""
        if interval is not None:
            cls._poll_interval = interval
            await Settings.Set("ongoing_games.poll_interval", interval)
        cls._start_polling()

    @classmethod
    def _live_consumers_exist(cls) -> bool:
        """True if any board needs the ongoing feed kept fresh: a single-mode
        board currently following a live (not completed) game, or a running
        rotation whose scope includes live games. HUD board 1 is excluded — the
        local HUD writer owns it. Reads State/Settings directly (cheap) so the
        poll loop can gate each tick without an API call when nothing needs it.
        """
        from server.bindings import transport, get_binding
        from server.state import State
        from server.utils.deep_dict import deep_get

        for sb_id in Settings.Get("scoreboards.active", [1]):
            if transport(sb_id) == "hud":
                continue
            binding = get_binding(sb_id)
            playback = binding.get("playback", {})
            if playback.get("mode") == "rotate":
                if playback.get("running") and binding.get("pool", {}).get("scope", "both") in ("live", "both"):
                    return True
                continue
            # single mode — is a live game loaded on this board?
            game_id = playback.get("gameId")
            if game_id is None:
                continue
            # A followed game that already left the feed is done — stop polling.
            if cls._ended_follow.get(sb_id) == game_id:
                continue
            if deep_get(State.state, f"score.{sb_id}.game_completed", None) is False:
                return True
        return False

    @classmethod
    async def _poll_loop(cls):
        while True:
            try:
                if cls._live_consumers_exist():
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
            game_id = _stable_ongoing_game_id(away_player, home_player, start_time)

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
        # Keep single-mode boards that are following a live game fresh — without
        # this, a loaded live game is a one-shot snapshot that never updates.
        try:
            await cls._reapply_single_live()
        except Exception:
            logger.exception("[OngoingGamePool] single-live re-apply error")
        await socketio.emit("v1.game_pool.ongoing_update", cls.list_games())

    @classmethod
    async def _reapply_single_live(cls):
        """Re-push the current live game to every single-mode board following
        one, so its score/state tracks the ongoing feed. Rotating boards drive
        their own applies; HUD board 1 is owned by the HUD writer."""
        from server.bindings import get_binding, transport
        from server.rio.stats_tracker import StatsTracker

        for sb_id in Settings.Get("scoreboards.active", [1]):
            if transport(sb_id) == "hud":
                continue
            playback = get_binding(sb_id)["playback"]
            if playback.get("mode") != "single":
                continue
            game_id = playback.get("gameId")
            if game_id is None:
                continue
            game = cls.get_game(game_id)
            if not game:
                # The followed live game is no longer in the ongoing feed. Give
                # it a couple of polls of grace (a flickering feed shouldn't end
                # a live game), then mark the follow ended so
                # _live_consumers_exist stops counting it — the app stops
                # pinging for a game that's over. Cleared when a new game loads.
                misses = cls._follow_misses.get(sb_id, 0) + 1
                cls._follow_misses[sb_id] = misses
                if misses >= END_MISS_TOLERANCE:
                    cls._ended_follow[sb_id] = game_id
                    cls._follow_misses.pop(sb_id, None)
                    logger.info(
                        "[OngoingGamePool] sb {} live game {} left the feed; "
                        "stopping live polling for it", sb_id, game_id,
                    )
                continue
            cls._follow_misses.pop(sb_id, None)
            cls._ended_follow.pop(sb_id, None)

            await cls.apply_game_to_scoreboard(game_id, sb_id)

            # Refresh the live per-character stats slot the same way the assign
            # endpoint does on a same-game re-apply (no new-game re-init).
            parsed = RioGameDataProvider.parse_game_data(game)
            entrants = parsed.get("entrants", [[{}], [{}]])
            p0 = entrants[0][0].get("rioName", "") if entrants[0] else ""
            p1 = entrants[1][0].get("rioName", "") if entrants[1] else ""
            sides_swapped = _pinned_swap_needed(p0, p1) is True
            StatsTracker.on_live_game_update(game, sb_id)
            await StatsTracker.push_stats_to_state(sb_id, sides_swapped)

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

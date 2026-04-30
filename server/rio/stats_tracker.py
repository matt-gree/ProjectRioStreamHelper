"""Tracks and merges historical (API) + current game (HUD) character stats.

On new game: fetches historical per-character stats from the Project Rio API.
On each HUD update: reads current-game stats from the HUD game dict.
On push: merges historical + current, computes derived stats, writes to State.
"""
import asyncio

import pandas as pd
from loguru import logger
from server.rio.pyrio.lookup import LookupDicts
from server.rio.pyrio.stat_formatters import (
    derive_batting, derive_pitching,
    format_batting_line, format_pitching_line,
)
from server.rio import stats_api
from server.state import State
from server.settings import Settings


# Internal stat keys for batting (same keys used throughout HUD + merged logic).
_BATTING_KEYS = [
    "at_bats", "hits", "singles", "doubles", "triples", "homeruns",
    "sac_flys", "strikeouts", "walks_bb", "walks_hbp", "rbi", "stolen_bases",
]

# Internal stat keys for pitching.
_PITCHING_KEYS = [
    "batters_faced", "runs_allowed", "walks_bb", "walks_hbp",
    "hits_allowed", "total_pitches", "strikeouts_pitched", "outs_pitched",
    "hrs_allowed",
]

# Mapping from HUD file offensive stat keys to our internal keys
_HUD_BATTING_MAP = {
    "at_bats": "At Bats",
    "hits": "Hits",
    "singles": "Singles",
    "doubles": "Doubles",
    "triples": "Triples",
    "homeruns": "Homeruns",
    "sac_flys": "Sac Flys",
    "strikeouts": "Strikeouts",
    "walks_bb": "Walks (4 Balls)",
    "walks_hbp": "Walks (Hit)",
    "rbi": "RBI",
    "stolen_bases": "Bases Stolen",
}

# Mapping from HUD file defensive stat keys to our internal keys
_HUD_PITCHING_MAP = {
    "batters_faced": "Batters Faced",
    "runs_allowed": "Runs Allowed",
    "earned_runs": "Earned Runs",
    "walks_bb": "Batters Walked",
    "walks_hbp": "Batters Hit",
    "hits_allowed": "Hits Allowed",
    "total_pitches": "Pitches Thrown",
    "strikeouts_pitched": "Strikeouts",
    "outs_pitched": "Outs Pitched",
    "hrs_allowed": "HRs Allowed",
}


def _empty_batting() -> dict:
    return {k: 0 for k in _BATTING_KEYS}


def _empty_pitching() -> dict:
    return {k: 0 for k in _PITCHING_KEYS}


def _resolve_df_col(row: pd.Series, category: str, stat: str) -> int | float:
    """Look up a stat from a DataFrame row, handling both summary_ and plain key formats.

    The Project Rio API returns batting keys with a summary_ prefix when by_swing
    is not used (e.g. summary_at_bats). pyrio flattens these as Category_stat,
    so we check both Batting_summary_at_bats and Batting_at_bats.
    """
    # Try with summary_ prefix first (API convention for batting without by_swing)
    val = row.get(f"{category}_summary_{stat}")
    if val is not None and val == val:  # not NaN
        return val
    # Fall back to plain
    val = row.get(f"{category}_{stat}")
    if val is not None and val == val:
        return val
    return 0


def _extract_api_batting(row: pd.Series) -> dict:
    """Extract batting stats from a flat DataFrame row for a single character."""
    return {key: int(_resolve_df_col(row, "Batting", key)) for key in _BATTING_KEYS}


def _extract_api_pitching(row: pd.Series) -> dict:
    """Extract pitching stats from a flat DataFrame row for a single character."""
    return {key: int(_resolve_df_col(row, "Pitching", key)) for key in _PITCHING_KEYS}


def _extract_hud_batting(offensive_stats: dict) -> dict:
    """Extract batting stats from HUD file offensive stats dict."""
    result = {}
    for our_key, hud_key in _HUD_BATTING_MAP.items():
        result[our_key] = offensive_stats.get(hud_key, 0)
    return result


def _extract_hud_pitching(defensive_stats: dict) -> dict:
    """Extract pitching stats from HUD file defensive stats dict."""
    result = {}
    for our_key, hud_key in _HUD_PITCHING_MAP.items():
        result[our_key] = defensive_stats.get(hud_key, 0)
    return result


def _merge_batting(api: dict, hud: dict) -> dict:
    """Merge API historical + HUD current game batting stats and compute derived."""
    merged = {}
    for key in _BATTING_KEYS:
        merged[key] = api.get(key, 0) + hud.get(key, 0)
    merged.update(derive_batting(**merged))
    return merged


def _merge_pitching(api: dict, hud: dict) -> dict:
    """Merge API historical + HUD current game pitching stats and compute derived."""
    merged = {}
    for key in _PITCHING_KEYS:
        merged[key] = api.get(key, 0) + hud.get(key, 0)
    # ERA uses earned_runs from HUD (not in API response — API has runs_allowed)
    merged["earned_runs"] = hud.get("earned_runs", 0) + api.get("runs_allowed", 0)
    merged.update(derive_pitching(**merged))
    return merged


class StatsTracker:
    """Singleton that tracks per-character stats for the active game.

    Lifecycle:
      1. on_new_game(game_json) — reset, extract players, fire API fetch
      2. on_hud_update(game_json) — read current-game per-char stats from HUD
      3. push_stats_to_state(sb_num, sides_swapped) — merge & write to State
    """

    # Flat DataFrame from pyrio with columns: username, char_name, Batting_*, Pitching_*
    _api_stats: pd.DataFrame = pd.DataFrame()

    # Indexed lookup: (username, char_name) -> row dict for O(1) access
    _api_index: dict[tuple[str, str], pd.Series] = {}

    # Current game HUD stats: {team_idx: {roster_idx: {batting: {...}, pitching: {...}}}}
    _hud_stats: dict[int, dict] = {}

    # Player names for the current game
    _players: list[str] = ["", ""]

    # Character names per team: {team_idx: [char_name_0, ..., char_name_8]}
    _rosters: dict[int, list[str]] = {}

    # Whether API fetch is done
    _api_ready: bool = False

    # Background fetch task
    _fetch_task: asyncio.Task | None = None

    # Mirrored from RioGameDataProvider after each _preserve_player_sides call.
    # Allows the background _fetch_api_stats task to push with the correct swap
    # state without importing provider (which already imports us at the top).
    _sides_swapped: bool = False

    # Scoreboard to push stats to. None means use scoreboards.hud_target setting.
    # Set explicitly when a game is loaded from the API game pool.
    _push_sb: int | None = None

    @classmethod
    def reset(cls):
        """Reset all stats state."""
        cls._api_stats = pd.DataFrame()
        cls._api_index = {}
        cls._hud_stats = {}
        cls._players = ["", ""]
        cls._rosters = {}
        cls._api_ready = False
        cls._sides_swapped = False
        cls._push_sb = None
        if cls._fetch_task and not cls._fetch_task.done():
            cls._fetch_task.cancel()
        cls._fetch_task = None

    @classmethod
    def _build_index(cls):
        """Build a (username, char_name) -> row dict for O(1) lookups."""
        cls._api_index = {}
        if cls._api_stats.empty:
            return
        for _, row in cls._api_stats.iterrows():
            key = (row["username"], row["char_name"])
            cls._api_index[key] = row

    @classmethod
    def _get_api_row(cls, username: str, char_name: str) -> pd.Series | None:
        """Look up a single character row via indexed dict (O(1))."""
        return cls._api_index.get((username, char_name))

    @classmethod
    async def on_new_game(cls, game_json: dict, scoreboard_number: int | None = None):
        """Called when a new game is detected. Resets state and fetches API stats.

        Args:
            scoreboard_number: Scoreboard to push stats to after fetching.
                               If None, falls back to scoreboards.hud_target setting.
        """
        cls.reset()
        cls._push_sb = scoreboard_number

        cls._players = [
            game_json.get("away_player", ""),
            game_json.get("home_player", ""),
        ]

        # Extract rosters from game_json, resolving integer char IDs to names.
        # HUD files already have string names; API responses use integer IDs.
        for team_idx in range(2):
            team = "away" if team_idx == 0 else "home"
            raw = [game_json.get(f"{team}_roster_{i}_char", "") for i in range(9)]
            cls._rosters[team_idx] = [
                LookupDicts.CHAR_NAME.get(c, str(c)) if isinstance(c, int) else str(c or "")
                for c in raw
            ]

        logger.info(f"[StatsTracker] New game: {cls._players[0]} vs {cls._players[1]}")

        # Get game mode tag from settings for filtering stats
        tag = Settings.Get("project_rio.stats_tag", None)

        # Fire background API fetch
        usernames = [p for p in cls._players if p]
        if usernames:
            cls._fetch_task = asyncio.create_task(cls._fetch_api_stats(usernames, tag, push=True))

    @classmethod
    async def _fetch_api_stats(cls, usernames: list[str], tag: str | None, push: bool = False):
        """Background task to fetch historical stats from the API.

        Args:
            push: If True, immediately push stats to state after fetch.
                  Used when called as a background task so the frontend
                  doesn't have to wait for the next HUD event.
        """
        try:
            cls._api_stats = await stats_api.fetch_character_stats(usernames, tag)
            cls._build_index()
            cls._api_ready = True
            if not cls._api_stats.empty:
                users = cls._api_stats["username"].unique().tolist()
                logger.info(f"[StatsTracker] API stats loaded for {users} ({len(cls._api_stats)} rows)")
                logger.debug(f"[StatsTracker] DataFrame columns: {cls._api_stats.columns.tolist()}")
            else:
                logger.info("[StatsTracker] API stats returned empty DataFrame")
            if push:
                sb_num = cls._push_sb if cls._push_sb is not None else Settings.Get("scoreboards.hud_target", 1)
                await cls.push_stats_to_state(sb_num, cls._sides_swapped)
        except Exception as e:
            logger.error(f"[StatsTracker] Failed to fetch API stats: {e}")
            cls._api_ready = True  # Mark as done even on failure so we don't block

    @classmethod
    def on_hud_update(cls, game_json: dict):
        """Called on each HUD file change. Reads per-character stats from game dict."""
        for team_idx in range(2):
            team = "away" if team_idx == 0 else "home"
            cls._hud_stats[team_idx] = {}

            for i in range(9):
                offensive = game_json.get(f"{team}_roster_{i}_offensive", {})
                defensive = game_json.get(f"{team}_roster_{i}_defensive", {})

                cls._hud_stats[team_idx][i] = {
                    "batting": _extract_hud_batting(offensive),
                    "pitching": _extract_hud_pitching(defensive),
                }

    @classmethod
    async def push_stats_to_state(cls, scoreboard_number: int, sides_swapped: bool):
        """Merge historical + current stats and push to State via single batch."""
        sb = f"score.{scoreboard_number}"
        entries = []

        # Map display team index to data team index (accounting for swap)
        for display_team in range(2):
            data_team = (1 - display_team) if sides_swapped else display_team
            team_num = display_team + 1  # 1-indexed for State keys
            username = cls._players[data_team] if data_team < len(cls._players) else ""
            roster = cls._rosters.get(data_team, [])

            for char_idx in range(min(9, len(roster))):
                char_name = roster[char_idx]
                if not char_name:
                    continue

                prefix = f"{sb}.stats.{team_num}.character.{char_idx}"

                # Get API stats for this character via indexed lookup (O(1))
                api_row = cls._get_api_row(username, char_name)
                api_batting = _extract_api_batting(api_row) if api_row is not None else _empty_batting()
                api_pitching = _extract_api_pitching(api_row) if api_row is not None else _empty_pitching()

                # Get HUD stats for this character
                hud_char = cls._hud_stats.get(data_team, {}).get(char_idx, {})
                hud_batting = hud_char.get("batting", _empty_batting())
                hud_pitching = hud_char.get("pitching", _empty_pitching())

                # Merge and compute derived stats
                merged_batting = _merge_batting(api_batting, hud_batting)
                merged_pitching = _merge_pitching(api_pitching, hud_pitching)

                entries.extend([
                    (f"{prefix}.name", char_name),
                    (f"{prefix}.api.batting", api_batting),
                    (f"{prefix}.api.pitching", api_pitching),
                    (f"{prefix}.batting", merged_batting),
                    (f"{prefix}.pitching", merged_pitching),
                    (f"{prefix}.current_game", {
                        "batting": hud_batting,
                        "pitching": hud_pitching,
                        "batting_line": format_batting_line(**hud_batting),
                        "pitching_line": format_pitching_line(**hud_pitching),
                    }),
                ])

        await State.SetBatch(entries)
        await State.Save()

    @classmethod
    async def _read_players_from_state(cls, scoreboard_number: int | None = None) -> list[str]:
        """Read current player rioNames from State.

        Args:
            scoreboard_number: If given, read only from that scoreboard.
                               If None, read from all active scoreboards.

        Falls back to cls._players if State has no names (e.g. HUD-only flow).
        """
        names = set()
        if scoreboard_number is not None:
            scoreboards = [scoreboard_number]
        else:
            scoreboards = Settings.Get("scoreboards.active", [1])
        for sb in scoreboards:
            for t in (1, 2):
                name = await State.Get(f"score.{sb}.player.{t}.rioName")
                if name and str(name).strip():
                    names.add(str(name).strip())
        if names:
            return list(names)
        # Fallback to cached HUD players
        return [p for p in cls._players if p]

    @classmethod
    async def refresh_api_stats(cls, scoreboard_number: int | None = None):
        """Force re-fetch API stats for current players and push to state.

        Args:
            scoreboard_number: If given, only fetch stats for players on that
                               scoreboard. If None, uses all active scoreboards.
        """
        tag = Settings.Get("project_rio.stats_tag", None)
        usernames = await cls._read_players_from_state(scoreboard_number)
        if usernames:
            cls._api_ready = False
            await cls._fetch_api_stats(usernames, tag, push=True)
        else:
            stats_api.set_no_players_diagnostic(tag)

    @classmethod
    async def push_api_stats_for_scoreboard(cls, scoreboard_number: int):
        """Push API-only stats to state for a scoreboard (no HUD merge).

        Used by rotation/game pool when applying API games to scoreboards.
        Reads player names and rosters from State, looks up pre-fetched API
        stats, and writes them to state. No HUD stats are involved.
        """
        sb = f"score.{scoreboard_number}"
        entries = []

        for team_num in (1, 2):
            prefix = f"{sb}.player.{team_num}"
            username = await State.Get(f"{prefix}.rioName", "")
            if not username:
                continue

            for char_idx in range(9):
                char_name = await State.Get(f"{prefix}.character.{char_idx}.name")
                if not char_name:
                    continue

                stat_prefix = f"{sb}.stats.{team_num}.character.{char_idx}"

                api_row = cls._get_api_row(str(username), str(char_name))
                api_batting = _extract_api_batting(api_row) if api_row is not None else _empty_batting()
                api_pitching = _extract_api_pitching(api_row) if api_row is not None else _empty_pitching()

                # For API-only games, merged = API stats (no HUD component)
                empty_bat = _empty_batting()
                empty_pit = _empty_pitching()
                merged_batting = _merge_batting(api_batting, empty_bat)
                merged_pitching = _merge_pitching(api_pitching, empty_pit)

                entries.extend([
                    (f"{stat_prefix}.name", char_name),
                    (f"{stat_prefix}.api.batting", api_batting),
                    (f"{stat_prefix}.api.pitching", api_pitching),
                    (f"{stat_prefix}.batting", merged_batting),
                    (f"{stat_prefix}.pitching", merged_pitching),
                    (f"{stat_prefix}.current_game", {
                        "batting": empty_bat,
                        "pitching": empty_pit,
                        "batting_line": format_batting_line(**empty_bat),
                        "pitching_line": format_pitching_line(**empty_pit),
                    }),
                ])

        if entries:
            await State.SetBatch(entries)
            await State.Save()

    @classmethod
    async def prefetch_for_players(cls, usernames: list[str]):
        """Fetch and cache API stats for a list of players.

        Used by rotation manager to pre-cache stats for all players in a
        rotation so individual game switches don't need API calls.
        """
        unique = list({u for u in usernames if u})
        if not unique:
            return
        tag = Settings.Get("project_rio.stats_tag", None)
        await cls._fetch_api_stats(unique, tag, push=False)
        logger.info(f"[StatsTracker] Pre-fetched stats for {len(unique)} rotation players")

    @classmethod
    def get_all_stats(cls) -> dict:
        """Return current merged stats snapshot for API consumption."""
        result = {}
        for team_idx in range(2):
            team_key = f"team_{team_idx + 1}"
            username = cls._players[team_idx] if team_idx < len(cls._players) else ""
            result[team_key] = {
                "player": username,
                "characters": {},
            }
            roster = cls._rosters.get(team_idx, [])

            for i in range(min(9, len(roster))):
                char_name = roster[i]
                if not char_name:
                    continue

                api_row = cls._get_api_row(username, char_name)
                api_batting = _extract_api_batting(api_row) if api_row is not None else _empty_batting()
                api_pitching = _extract_api_pitching(api_row) if api_row is not None else _empty_pitching()

                hud_char = cls._hud_stats.get(team_idx, {}).get(i, {})
                hud_batting = hud_char.get("batting", _empty_batting())
                hud_pitching = hud_char.get("pitching", _empty_pitching())

                result[team_key]["characters"][char_name] = {
                    "roster_index": i,
                    "batting": _merge_batting(api_batting, hud_batting),
                    "pitching": _merge_pitching(api_pitching, hud_pitching),
                    "current_game": {
                        "batting": hud_batting,
                        "pitching": hud_pitching,
                    },
                }

        result["api_ready"] = cls._api_ready
        return result

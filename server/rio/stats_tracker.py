"""Tracks and merges historical (API) + current game (HUD) character stats.

State is keyed per scoreboard so flows on different scoreboards (HUD watcher,
rotation, direct API assigns) can't corrupt each other's stats cache.

On new game: fetches historical per-character stats from the Project Rio API.
On each HUD update: reads current-game stats from the HUD game dict.
On push: merges historical + current, computes derived stats, writes to State.
"""
import asyncio
from dataclasses import dataclass, field

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
    val = row.get(f"{category}_summary_{stat}")
    if val is not None and val == val:
        return val
    val = row.get(f"{category}_{stat}")
    if val is not None and val == val:
        return val
    return 0


def _extract_api_batting(row: pd.Series) -> dict:
    return {key: int(_resolve_df_col(row, "Batting", key)) for key in _BATTING_KEYS}


def _extract_api_pitching(row: pd.Series) -> dict:
    return {key: int(_resolve_df_col(row, "Pitching", key)) for key in _PITCHING_KEYS}


def _extract_hud_batting(offensive_stats: dict) -> dict:
    return {our_key: offensive_stats.get(hud_key, 0)
            for our_key, hud_key in _HUD_BATTING_MAP.items()}


def _extract_hud_pitching(defensive_stats: dict) -> dict:
    return {our_key: defensive_stats.get(hud_key, 0)
            for our_key, hud_key in _HUD_PITCHING_MAP.items()}


def _merge_batting(api: dict, hud: dict) -> dict:
    merged = {key: api.get(key, 0) + hud.get(key, 0) for key in _BATTING_KEYS}
    merged.update(derive_batting(**merged))
    return merged


def _merge_pitching(api: dict, hud: dict) -> dict:
    merged = {key: api.get(key, 0) + hud.get(key, 0) for key in _PITCHING_KEYS}
    # ERA uses earned_runs from HUD (not in API response — API has runs_allowed)
    merged["earned_runs"] = hud.get("earned_runs", 0) + api.get("runs_allowed", 0)
    merged.update(derive_pitching(**merged))
    return merged


def _resolve_stats_tag(scoreboard_number: int) -> str | None:
    """Per-scoreboard stats tag. No global fallback — if a scoreboard has no
    tag configured we skip the API fetch entirely (caller decides what to do).
    """
    return Settings.Get(f"scoreboards.sources.{scoreboard_number}.stats_tag", None)


@dataclass
class _SbSlot:
    """Per-scoreboard stats state."""
    api_index: dict[tuple[str, str], pd.Series] = field(default_factory=dict)
    api_stats: pd.DataFrame = field(default_factory=pd.DataFrame)
    rosters: dict[int, list[str]] = field(default_factory=dict)  # team_idx -> [9 chars]
    players: list[str] = field(default_factory=lambda: ["", ""])  # [away, home]
    hud_stats: dict[int, dict] = field(default_factory=dict)
    sides_swapped: bool = False
    api_ready: bool = False
    fetch_task: asyncio.Task | None = None


class StatsTracker:
    """Singleton with per-scoreboard stats slots.

    Lifecycle for any scoreboard sb:
      1. on_new_game(game_json, sb, await_fetch=...) — populate slot, fetch API stats
      2. on_hud_update(game_json, sb)                — read current-game HUD stats
      3. push_stats_to_state(sb, sides_swapped)      — merge & write to State
    """

    _slots: dict[int, _SbSlot] = {}

    @classmethod
    def _slot(cls, sb: int) -> _SbSlot:
        slot = cls._slots.get(sb)
        if slot is None:
            slot = _SbSlot()
            cls._slots[sb] = slot
        return slot

    @classmethod
    def reset_scoreboard(cls, sb: int):
        """Reset state for a single scoreboard."""
        slot = cls._slots.get(sb)
        if slot and slot.fetch_task and not slot.fetch_task.done():
            slot.fetch_task.cancel()
        cls._slots[sb] = _SbSlot()

    @classmethod
    def reset_all(cls):
        for slot in cls._slots.values():
            if slot.fetch_task and not slot.fetch_task.done():
                slot.fetch_task.cancel()
        cls._slots = {}

    @classmethod
    def set_sides_swapped(cls, sb: int, swapped: bool):
        cls._slot(sb).sides_swapped = swapped

    @classmethod
    def is_api_ready(cls, sb: int) -> bool:
        return cls._slot(sb).api_ready

    @classmethod
    def _build_index(cls, slot: _SbSlot):
        slot.api_index = {}
        if slot.api_stats.empty:
            return
        for _, row in slot.api_stats.iterrows():
            slot.api_index[(row["username"], row["char_name"])] = row

    @classmethod
    async def on_new_game(
        cls,
        game_json: dict,
        scoreboard_number: int,
        *,
        await_fetch: bool = False,
        sides_swapped: bool = False,
    ):
        """Called when a new game starts on a scoreboard.

        Args:
            scoreboard_number: target scoreboard.
            await_fetch: if True, fetch + push inline (use from request handlers
                where the caller can wait). If False, fetch in a background task
                (use from HUD callbacks that can't block).
            sides_swapped: initial swap state for this game.
        """
        cls.reset_scoreboard(scoreboard_number)
        slot = cls._slot(scoreboard_number)
        slot.sides_swapped = sides_swapped

        slot.players = [
            game_json.get("away_player", ""),
            game_json.get("home_player", ""),
        ]

        # Extract rosters; HUD uses string char names, API uses integer IDs.
        for team_idx in range(2):
            team = "away" if team_idx == 0 else "home"
            raw = [game_json.get(f"{team}_roster_{i}_char", "") for i in range(9)]
            slot.rosters[team_idx] = [
                LookupDicts.CHAR_NAME.get(c, str(c)) if isinstance(c, int) else str(c or "")
                for c in raw
            ]

        logger.info(
            f"[StatsTracker] sb{scoreboard_number} new game: "
            f"{slot.players[0]} vs {slot.players[1]}"
        )

        usernames = [p for p in slot.players if p]
        if not usernames:
            slot.api_ready = True
            return

        tag = _resolve_stats_tag(scoreboard_number)
        if not tag:
            logger.info(
                f"[StatsTracker] sb{scoreboard_number} no game mode configured; "
                "skipping API stats fetch"
            )
            slot.api_ready = True
            return

        if await_fetch:
            await cls._fetch_api_stats(scoreboard_number, usernames, tag, push=True)
        else:
            slot.fetch_task = asyncio.create_task(
                cls._fetch_api_stats(scoreboard_number, usernames, tag, push=True)
            )

    @classmethod
    async def _fetch_api_stats(
        cls,
        scoreboard_number: int,
        usernames: list[str],
        tag: str | None,
        *,
        push: bool = False,
    ):
        slot = cls._slot(scoreboard_number)
        try:
            slot.api_stats = await stats_api.fetch_character_stats(
                usernames, tag, scoreboard_number=scoreboard_number,
            )
            cls._build_index(slot)
            slot.api_ready = True
            if not slot.api_stats.empty:
                users = slot.api_stats["username"].unique().tolist()
                logger.info(
                    f"[StatsTracker] sb{scoreboard_number} API stats loaded for "
                    f"{users} ({len(slot.api_stats)} rows)"
                )
            else:
                logger.info(f"[StatsTracker] sb{scoreboard_number} API stats empty")
            if push:
                await cls.push_stats_to_state(scoreboard_number, slot.sides_swapped)
        except Exception as e:
            logger.error(
                f"[StatsTracker] sb{scoreboard_number} API fetch failed: {e}"
            )
            slot.api_ready = True

    @classmethod
    def on_hud_update(cls, game_json: dict, scoreboard_number: int):
        """Called on each HUD file change. Reads per-character stats."""
        slot = cls._slot(scoreboard_number)
        for team_idx in range(2):
            team = "away" if team_idx == 0 else "home"
            slot.hud_stats[team_idx] = {}
            for i in range(9):
                offensive = game_json.get(f"{team}_roster_{i}_offensive", {})
                defensive = game_json.get(f"{team}_roster_{i}_defensive", {})
                slot.hud_stats[team_idx][i] = {
                    "batting": _extract_hud_batting(offensive),
                    "pitching": _extract_hud_pitching(defensive),
                }

    @classmethod
    async def push_stats_to_state(cls, scoreboard_number: int, sides_swapped: bool):
        """Merge historical + current HUD stats and push to State via batch."""
        slot = cls._slot(scoreboard_number)
        slot.sides_swapped = sides_swapped
        sb = f"score.{scoreboard_number}"
        entries = []

        for display_team in range(2):
            data_team = (1 - display_team) if sides_swapped else display_team
            team_num = display_team + 1
            username = slot.players[data_team] if data_team < len(slot.players) else ""
            roster = slot.rosters.get(data_team, [])

            for char_idx in range(min(9, len(roster))):
                char_name = roster[char_idx]
                if not char_name:
                    continue

                prefix = f"{sb}.stats.{team_num}.character.{char_idx}"

                api_row = slot.api_index.get((username, char_name))
                api_batting = _extract_api_batting(api_row) if api_row is not None else _empty_batting()
                api_pitching = _extract_api_pitching(api_row) if api_row is not None else _empty_pitching()

                hud_char = slot.hud_stats.get(data_team, {}).get(char_idx, {})
                hud_batting = hud_char.get("batting", _empty_batting())
                hud_pitching = hud_char.get("pitching", _empty_pitching())

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
    async def _read_players_from_state(cls, scoreboard_number: int) -> list[str]:
        """Read current player rioNames from State for one scoreboard."""
        names = set()
        for t in (1, 2):
            name = await State.Get(f"score.{scoreboard_number}.player.{t}.rioName")
            if name and str(name).strip():
                names.add(str(name).strip())
        if names:
            return list(names)
        # Fallback to cached players from on_new_game
        slot = cls._slot(scoreboard_number)
        return [p for p in slot.players if p]

    @classmethod
    async def refresh_api_stats(cls, scoreboard_number: int | None = None):
        """Force re-fetch API stats for a scoreboard's current players.

        If scoreboard_number is None, refreshes every active scoreboard
        independently (one fetch per scoreboard, each with its own tag).
        """
        if scoreboard_number is None:
            sbs = Settings.Get("scoreboards.active", [1])
        else:
            sbs = [scoreboard_number]

        for sb in sbs:
            usernames = await cls._read_players_from_state(sb)
            tag = _resolve_stats_tag(sb)
            if not tag:
                logger.info(
                    f"[StatsTracker] sb{sb} refresh skipped — no game mode configured"
                )
                continue
            if usernames:
                slot = cls._slot(sb)
                slot.api_ready = False
                await cls._fetch_api_stats(sb, usernames, tag, push=True)
            else:
                await stats_api.set_no_players_diagnostic(sb, tag)

    @classmethod
    async def push_api_stats_for_scoreboard(cls, scoreboard_number: int):
        """Push API-only stats (no HUD merge) for a scoreboard.

        Used by rotation/game-pool when applying API games. Reads player names
        and rosters from State, looks up pre-fetched stats from the slot's
        index, and writes to State.
        """
        slot = cls._slot(scoreboard_number)
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

                api_row = slot.api_index.get((str(username), str(char_name)))
                api_batting = _extract_api_batting(api_row) if api_row is not None else _empty_batting()
                api_pitching = _extract_api_pitching(api_row) if api_row is not None else _empty_pitching()

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
    async def prefetch_for_players(cls, usernames: list[str], scoreboard_number: int):
        """Fetch API stats for a list of players into one scoreboard's slot.

        Used by the rotation manager to pre-cache stats for all rotation
        players so individual game switches don't need API calls.
        """
        unique = list({u for u in usernames if u})
        if not unique:
            return
        tag = _resolve_stats_tag(scoreboard_number)
        if not tag:
            logger.info(
                f"[StatsTracker] sb{scoreboard_number} prefetch skipped — "
                "no game mode configured"
            )
            return
        await cls._fetch_api_stats(scoreboard_number, unique, tag, push=False)
        logger.info(
            f"[StatsTracker] sb{scoreboard_number} pre-fetched stats for "
            f"{len(unique)} rotation players"
        )

    @classmethod
    def get_all_stats(cls, scoreboard_number: int | None = None) -> dict:
        """Return current merged stats snapshot for a scoreboard."""
        if scoreboard_number is None:
            # Default to first HUD-target if any, else first active scoreboard.
            sources = Settings.Get("scoreboards.sources", {})
            active = Settings.Get("scoreboards.active", [1])
            hud_targets = [sb for sb in active
                           if sources.get(str(sb), {}).get("type") == "hud"]
            scoreboard_number = hud_targets[0] if hud_targets else (active[0] if active else 1)
        slot = cls._slot(scoreboard_number)
        result = {"scoreboard": scoreboard_number, "api_ready": slot.api_ready}

        for team_idx in range(2):
            team_key = f"team_{team_idx + 1}"
            username = slot.players[team_idx] if team_idx < len(slot.players) else ""
            result[team_key] = {"player": username, "characters": {}}
            roster = slot.rosters.get(team_idx, [])

            for i in range(min(9, len(roster))):
                char_name = roster[i]
                if not char_name:
                    continue

                api_row = slot.api_index.get((username, char_name))
                api_batting = _extract_api_batting(api_row) if api_row is not None else _empty_batting()
                api_pitching = _extract_api_pitching(api_row) if api_row is not None else _empty_pitching()

                hud_char = slot.hud_stats.get(team_idx, {}).get(i, {})
                hud_batting = hud_char.get("batting", _empty_batting())
                hud_pitching = hud_char.get("pitching", _empty_pitching())

                result[team_key]["characters"][i] = {
                    "name": char_name,
                    "roster_index": i,
                    "batting": _merge_batting(api_batting, hud_batting),
                    "pitching": _merge_pitching(api_pitching, hud_pitching),
                    "current_game": {
                        "batting": hud_batting,
                        "pitching": hud_pitching,
                    },
                }

        return result

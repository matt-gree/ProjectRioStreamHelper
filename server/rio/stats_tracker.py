"""Tracks and merges historical (API) + current game (HUD) character stats.

State is keyed per scoreboard so flows on different scoreboards (HUD watcher,
rotation, direct API assigns) can't corrupt each other's stats cache.

On new game: fetches historical per-character stats from the Project Rio API.
On each HUD update: reads current-game stats from the frame.
On push: adds history and this game (pyrio stat lines add with +), and writes
them to State in the overlay's shape (server/rio/stat_lines.py).
"""
import asyncio
from dataclasses import dataclass, field, replace

from loguru import logger
from pyrio import BattingLine, Character, PitchingLine, RioError
from pyrio.web import StatRow

from server.rio import stats_api
from server.rio.stat_lines import (
    batting_counts, batting_state, format_batting_line, format_pitching_line,
    pitching_counts, pitching_state,
)
from server.state import State
from server.settings import Settings


def _character(name) -> Character | None:
    """A character by name or id; None for an empty slot or one pyrio doesn't know."""
    if name is None or name == "" or isinstance(name, bool):
        return None
    try:
        return Character(name)
    except RioError:
        return None


def _batting(d) -> BattingLine:
    """A frame's per-character batting dict (BattingLine fields) as a line."""
    return BattingLine(**d) if isinstance(d, dict) and d else BattingLine()


def _pitching(d) -> PitchingLine:
    return PitchingLine(**d) if isinstance(d, dict) and d else PitchingLine()


def _api_pitching(line: PitchingLine) -> PitchingLine:
    """Rio web's /stats/ doesn't report earned runs yet (pyrio reads 0), so
    history counts every run allowed as earned until it does."""
    if line.earned_runs == 0 and line.runs_allowed:
        return replace(line, earned_runs=line.runs_allowed)
    return line


def _resolve_stats_tag(scoreboard_number: int) -> str | None:
    """Per-scoreboard stats tag. No global fallback — if a scoreboard has no
    tag configured we skip the API fetch entirely (caller decides what to do).
    """
    return Settings.Get(f"scoreboards.binding.{scoreboard_number}.stats_tag", None)


@dataclass
class _SbSlot:
    """Per-scoreboard stats state."""
    # (casefolded username, character) -> that player's history with them
    api_index: dict[tuple[str, Character], StatRow] = field(default_factory=dict)
    api_stats: list[StatRow] = field(default_factory=list)
    rosters: dict[int, list[str]] = field(default_factory=dict)  # team_idx -> [9 chars]
    players: list[str] = field(default_factory=lambda: ["", ""])  # [away, home]
    # team_idx -> roster_idx -> {"batting": BattingLine, "pitching": PitchingLine}
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
        """Reset state for a single scoreboard: the stats slot AND its diagnostics.

        The two belong together. `stats_api._last_fetch_info[sb]` describes the
        fetch that filled the slot being dropped here, so a reset that kept it
        left the board's diagnostics popover reporting a fetch for stats the
        board no longer has — including a stale error, which is the one thing a
        producer checks that popover to rule out.

        Board ids are RE-USED (`_lowest_available_id`), so on the removal path
        that leftover is not dormant: the next board to take this id inherits
        another board's failure. Every caller wants both halves — a new game, a
        HUD-target change, a playback-mode change, board removal, and the reset
        hatch — so the drop lives HERE rather than beside each call, where the
        set is exactly large enough for one site to be missed (it was: nothing
        called `reset_fetch_info` at all).
        """
        slot = cls._slots.get(sb)
        if slot and slot.fetch_task and not slot.fetch_task.done():
            slot.fetch_task.cancel()
        cls._slots[sb] = _SbSlot()
        stats_api.reset_fetch_info(sb)

    @classmethod
    def set_sides_swapped(cls, sb: int, swapped: bool):
        cls._slot(sb).sides_swapped = swapped

    @classmethod
    def is_api_ready(cls, sb: int) -> bool:
        return cls._slot(sb).api_ready

    @classmethod
    def _build_index(cls, slot: _SbSlot):
        slot.api_index = {
            ((row.user or "").casefold(), row.character): row
            for row in slot.api_stats
            if row.character is not None
        }

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

        # Rosters by character name (frames carry names; ids still resolve).
        for team_idx in range(2):
            team = "away" if team_idx == 0 else "home"
            raw = [game_json.get(f"{team}_roster_{i}_char", "") for i in range(9)]
            slot.rosters[team_idx] = [
                (c.label if (c := _character(name)) is not None else str(name or ""))
                for name in raw
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
            if slot.api_stats:
                users = sorted({row.user for row in slot.api_stats if row.user})
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
                slot.hud_stats[team_idx][i] = {
                    "batting": _batting(game_json.get(f"{team}_roster_{i}_batting")),
                    "pitching": _pitching(game_json.get(f"{team}_roster_{i}_pitching")),
                }

    @classmethod
    def on_live_game_update(cls, game_json: dict, scoreboard_number: int):
        """Record the current batter's & pitcher's game stats from an ongoing
        API game.

        Unlike a HUD file (which carries full per-roster offensive/defensive
        stats every frame), the ongoing-games feed only exposes the two active
        characters via `batter_stats` / `pitcher_stats`. Those dicts use the
        same shape as a HUD frame's per-character lines (server/rio/frame.py).

        We accumulate snapshots into the slot across polls — preserving slots
        we've already recorded — so a live game's per-character current_game
        structure fills in ("builds out") as the lineup cycles, matching the
        shape produced by a HUD-sourced game. Index orientation is the data
        orientation (team_idx 0 = away, 1 = home); push_stats_to_state applies
        any side swap when writing to State.
        """
        slot = cls._slot(scoreboard_number)
        half = game_json.get("half_inning", 0)
        batting_idx = 0 if half == 0 else 1
        fielding_idx = 1 - batting_idx
        batter_loc = game_json.get("batter")
        pitcher_loc = game_json.get("pitcher")
        batter_stats = game_json.get("batter_stats") or {}
        pitcher_stats = game_json.get("pitcher_stats") or {}

        def _cell(team_idx: int, roster_idx: int) -> dict:
            team = slot.hud_stats.setdefault(team_idx, {})
            return team.setdefault(
                roster_idx,
                {"batting": BattingLine(), "pitching": PitchingLine()},
            )

        if isinstance(batter_loc, int) and 0 <= batter_loc <= 8 and batter_stats:
            _cell(batting_idx, batter_loc)["batting"] = _batting(batter_stats)
        if isinstance(pitcher_loc, int) and 0 <= pitcher_loc <= 8 and pitcher_stats:
            _cell(fielding_idx, pitcher_loc)["pitching"] = _pitching(pitcher_stats)

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
            # Prefer the name currently in State (display slot) so a producer's
            # manual name override drives the stats lookup too; fall back to the
            # slot's cached HUD username. Both describe the same displayed player.
            state_name = await State.Get(f"{sb}.player.{team_num}.rioName", "")
            username = (str(state_name).strip() if state_name
                        else (slot.players[data_team] if data_team < len(slot.players) else ""))
            roster = slot.rosters.get(data_team, [])

            for char_idx in range(min(9, len(roster))):
                char_name = roster[char_idx]
                if not char_name:
                    continue

                prefix = f"{sb}.stats.{team_num}.character.{char_idx}"

                character = _character(char_name)
                api_row = slot.api_index.get((username.casefold(), character)) if character else None
                api_batting = (api_row.batting if api_row else None) or BattingLine()
                api_pitching = _api_pitching((api_row.pitching if api_row else None) or PitchingLine())

                hud_char = slot.hud_stats.get(data_team, {}).get(char_idx, {})
                hud_batting = hud_char.get("batting") or BattingLine()
                hud_pitching = hud_char.get("pitching") or PitchingLine()

                entries.extend([
                    (f"{prefix}.name", char_name),
                    (f"{prefix}.api.batting", batting_counts(api_batting)),
                    (f"{prefix}.api.pitching", pitching_counts(api_pitching)),
                    (f"{prefix}.batting", batting_state(api_batting + hud_batting)),
                    (f"{prefix}.pitching", pitching_state(api_pitching + hud_pitching)),
                    (f"{prefix}.current_game", {
                        "batting": batting_counts(hud_batting),
                        "pitching": pitching_counts(hud_pitching),
                        "batting_line": format_batting_line(hud_batting),
                        "pitching_line": format_pitching_line(hud_pitching),
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

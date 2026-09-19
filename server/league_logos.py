"""League logos — put a player's league logo on the board they are playing on.

A league is an address book linked to Rio game modes (`book.modes`, see
server/participants.py). When a board's game is in one of those modes, each
side's player is looked up in THAT book, and the logo they carry there is
written beside the rest of the side:

    score.{N}.league                  the book's name ("" = not a league game)
    score.{N}.player.{T}.league_logo  their logo, server-relative ("" = none)

(A team NAME is not written: the league row's own sponsor `prefix` already
reaches the Player Name tag line through the ordinary resurface path, which
asks the league's book first in a league game.)

WHY A WRITE HOOK AND NOT THE RESURFACE MAP. The resurface map copies facts about
a PERSON; a league logo is a fact about a person IN A LEAGUE, so it depends on two
things that arrive from different writers — the side's `rioName` (the HUD, the
API pools, the Match projector, a manual override, a clear) and the board's
mode (the feed's `game_mode`, or a producer's pick on the board's binding).
Hooked onto the State write path it is answered for every one of those writers
at once, in the SAME batch as the write that moved it, rather than taught to
each of them. The two inputs that live elsewhere get their own settle:
an address-book edit (`Participants.reproject_dependents`) and a binding's
`stats_tag` (`on_settings`, called from Settings' write paths).

WHICH MODE. A producer's PICK on the board (`stats_tag` with `stats_tag_manual`)
first; else the game's own `score.{N}.game_mode`; else the board's `stats_tag` —
so a producer who sets a board to the league's mode before first pitch sees the
logos while the fixture is still a draft.

Deterministic, like every projector: it writes the full key set (value or "")
and only what differs from State, so a board leaving a league blanks exactly
what this put there, and a steady HUD frame costs a dict walk and no traffic.
"""
import re

from loguru import logger

from server.participants import Participants
from server.state import State
from server.utils.deep_dict import deep_get

_TRIGGER = re.compile(r"^score\.(\d+)\.(?:player\.[12]\.rioName|game_mode)$")
_BINDING = re.compile(
    r"^scoreboards\.binding\.(\d+)(?:\.stats_tag(?:_manual)?)?$|^scoreboards\.binding$"
)


def board_mode(sb: int, pending: dict | None = None) -> str:
    """The game mode a board's game is being played in.

    `pending` is a batch that has not landed yet (the resurface path runs
    before `SetBatch`), so a mode arriving in the same frame as the player is
    the one used."""
    from server.bindings import binding_stats_tag, stats_tag_is_manual

    try:
        tag = binding_stats_tag(sb)
        manual = stats_tag_is_manual(sb)
    except Exception:
        tag, manual = None, False
    tag = tag if isinstance(tag, str) else ""
    # A producer's PICK is their statement of what this board is playing, and
    # it outranks the feed here for the same reason it does for stats.
    if manual and tag.strip():
        return tag
    key = f"score.{sb}.game_mode"
    mode = pending.get(key) if pending and key in pending else deep_get(State.state, key, "")
    if isinstance(mode, str) and mode.strip():
        return mode
    return tag


def _active_boards() -> list[int]:
    boards = []
    for k in (deep_get(State.state, "score", {}) or {}).keys():
        try:
            boards.append(int(k))
        except (TypeError, ValueError):
            continue
    return sorted(boards)


class LeagueLogos:
    @staticmethod
    def entries_for_board(sb: int) -> list[tuple]:
        """The full owned key set for one board, as it should read now."""
        mode = board_mode(sb)
        book = Participants.book_for_mode(mode)
        out = [(f"score.{sb}.league", book["name"] if book else "")]
        for t in (1, 2):
            base = f"score.{sb}.player.{t}"
            rio = deep_get(State.state, f"{base}.rioName", "") or ""
            _book, url = Participants.league_logo(mode, rio) if book else (None, "")
            out.append((f"{base}.league_logo", url))
        return out

    @classmethod
    def _changed(cls, boards) -> list[tuple]:
        out = []
        for sb in boards:
            for k, v in cls.entries_for_board(sb):
                if deep_get(State.state, k, None) != v:
                    out.append((k, v))
        return out

    @classmethod
    async def on_write(cls, entries) -> list[tuple]:
        """State write hook: re-resolve every board whose player or mode moved."""
        boards = set()
        for key, _v in entries:
            m = _TRIGGER.match(key)
            if m:
                boards.add(int(m.group(1)))
        if not boards:
            return []
        # A board that was just UNSET has nothing to resolve into.
        return cls._changed(b for b in boards if deep_get(State.state, f"score.{b}") is not None)

    @classmethod
    async def project_all(cls) -> None:
        entries = cls._changed(_active_boards())
        if entries:
            await State.SetBatch(entries)
            await State.Save()

    @classmethod
    async def on_settings(cls, keys) -> None:
        """A binding's `stats_tag` moved — the mode a board with no game is in."""
        boards = set()
        for key in keys:
            m = _BINDING.match(key or "")
            if not m:
                continue
            if m.group(1):
                boards.add(int(m.group(1)))
            else:
                boards.update(_active_boards())
        boards = [b for b in boards if deep_get(State.state, f"score.{b}") is not None]
        if not boards:
            return
        try:
            entries = cls._changed(boards)
            if entries:
                await State.SetBatch(entries)
                await State.Save()
        except Exception:
            logger.exception("[LeagueLogos] settle after a binding change failed")

    @classmethod
    def Start(cls) -> None:
        """Register both observers. Before the provider starts, so the boot HUD
        read already resolves a league game's teams."""
        from server.settings import Settings

        if cls.on_write not in State.hooks:
            State.hooks.append(cls.on_write)
        if cls.on_settings not in Settings.watchers:
            Settings.watchers.append(cls.on_settings)

    @classmethod
    def Stop(cls) -> None:
        from server.settings import Settings

        if cls.on_write in State.hooks:
            State.hooks.remove(cls.on_write)
        if cls.on_settings in Settings.watchers:
            Settings.watchers.remove(cls.on_settings)

"""Match model — the fixture object above scoreboards (Phase 3).

A ``match.{M}`` object holds the *fixture* facts a producer authors before a game
(participants per side, captain pick, controller port, game mode, format). Unlike
the REST-only participant registry, a Match lives in central State — it is
broadcast to clients and persisted in ``state.json``.

A scoreboard *binds* to a match via ``score.{N}.match = M``. The projector copies
the match's fixture fields into the ``score.{N}.player.{T}.*`` keys overlays
already read, so every existing layout works untouched. "Draft IS pre-game" — the
match's authored fields are the pre-game data; there is no separate pre-game
container yet.

The projector is the single merge point where draft/fixture data meets the
``score.*`` keys the live feed also writes (the Phase-5 reconciliation seam). In
this slice the live feed remains last-writer-wins on HUD/Live boards by design;
binding is verified against Manual boards.
"""
from loguru import logger

from server.participants import Participants
from server.rio.resurface import RESURFACE_MAP
from server.settings import Settings
from server.state import State

# Every score.player.* key the projector owns for one side. A projection always
# writes the full set (resolved value or "") so re-projection is deterministic and
# unbinding can blank exactly what it set — no stale fixture data left behind.
# `character.0.name` + `rio_captainIndex` carry the captain the same way the
# Live-API "captain only, no roster" path does (see provider.py).
_PLAYER_KEYS = [
    "rioName", "port", "rio_captainIndex", "character.0.name", *RESURFACE_MAP.values(),
]

# Default shape of a freshly-created match. `captain` is a character name (the
# chosen captain), not a roster slot. provider.startgg.setId is reserved for a
# later set-load-through-match slice and stays unused here.
_DEFAULT_SIDE = {"participantId": None, "rioName": "", "captain": "", "port": None}


def default_match() -> dict:
    return {
        "label": "",
        "stage": "draft",          # draft | live | post — dormant this slice (badge only)
        "format": {"bestOf": 1},
        "gameMode": "",
        "provider": {"startgg": {"setId": None}},
        "player": {"1": dict(_DEFAULT_SIDE), "2": dict(_DEFAULT_SIDE)},
    }


class Match:
    """Reads/writes ``match.{M}.*`` through State and projects onto bound boards.

    Stateless singleton (mirrors State/Settings): all data lives in the State
    store; these classmethods are just the projection + lifecycle logic.
    """

    # ----- reads -----------------------------------------------------------

    @classmethod
    def _all(cls) -> dict:
        return State.state.get("match", {}) or {}

    @classmethod
    def get(cls, m) -> dict:
        return cls._all().get(str(m), {}) or {}

    @classmethod
    def exists(cls, m) -> bool:
        return str(m) in cls._all()

    @classmethod
    def next_id(cls) -> int:
        ids = [int(k) for k in cls._all().keys() if str(k).isdigit()]
        return (max(ids) + 1) if ids else 1

    @classmethod
    def bound_scoreboards(cls, m) -> list[int]:
        """Active scoreboards bound to match m (score.{N}.match == m)."""
        out = []
        for sb_key, sb_val in (State.state.get("score", {}) or {}).items():
            if isinstance(sb_val, dict) and str(sb_val.get("match")) == str(m):
                try:
                    out.append(int(sb_key))
                except (TypeError, ValueError):
                    continue
        return out

    # ----- projection ------------------------------------------------------

    @classmethod
    def _side_entries(cls, sb: int, t: int, player: dict | None) -> list[tuple]:
        """Resolve one side's projected score keys (value or "" for each)."""
        base = f"score.{sb}.player.{t}"
        vals = {k: "" for k in _PLAYER_KEYS}

        player = player or {}
        pid = player.get("participantId")
        rio_name = player.get("rioName") or ""

        row = Participants.Get(pid) if pid else None
        if not row and rio_name:
            row = Participants.MatchByRioName(rio_name)
        if not rio_name and row:
            rio_name = (row.get("identities") or {}).get("rioName") or ""

        vals["rioName"] = rio_name
        port = player.get("port")
        vals["port"] = port if port is not None else ""

        # Captain-only projection: mirror the Live-API "no roster" path — the
        # chosen captain character goes in roster slot 0 and is marked captain.
        # A live HUD/API game later overwrites this with the real roster.
        captain = player.get("captain") or ""
        vals["character.0.name"] = captain
        vals["rio_captainIndex"] = 0 if captain else ""

        if row:
            display = row.get("display") or {}
            for src, dst in RESURFACE_MAP.items():
                v = display.get(src)
                if v:
                    vals[dst] = v

        return [(f"{base}.{k}", v) for k, v in vals.items()]

    @classmethod
    async def project_scoreboard(cls, sb: int, m) -> None:
        """Project match ``m`` onto board ``sb`` (pass a falsy ``m`` to blank it).

        Writes only fixture/identity keys — never live-only data (inning, outs,
        runners, linescore) or the 9-character roster, which belong to the feed.
        """
        match = cls.get(m) if m else {}
        players = match.get("player", {}) or {}

        entries: list[tuple] = []
        for t in (1, 2):
            entries.extend(cls._side_entries(sb, t, players.get(str(t))))
        game_mode = match.get("gameMode") or ""
        entries.append((f"score.{sb}.tag_set", game_mode))

        await State.SetBatch(entries)
        await State.Save()

        # stats_tag is a Settings key; its change drives the per-scoreboard stats
        # fetch (mirrors the HUD/Live path). Only write when we have a mode so an
        # empty/unbound match never wipes a manually-chosen tag.
        if game_mode:
            await Settings.Set(f"scoreboards.sources.{sb}.stats_tag", game_mode)

    @classmethod
    async def project_match(cls, m) -> None:
        """Re-project a match onto every board bound to it."""
        for sb in cls.bound_scoreboards(m):
            await cls.project_scoreboard(sb, m)

    @classmethod
    async def clear_scoreboard(cls, sb: int) -> None:
        """Blank the fixture keys this projector owns on an unbound board."""
        await cls.project_scoreboard(sb, None)

    @classmethod
    async def project_all(cls) -> None:
        """Startup hook — re-project every persisted match. A bad match logs and
        is skipped; it never blocks boot."""
        for m in list(cls._all().keys()):
            try:
                await cls.project_match(m)
            except Exception:
                logger.exception("[Match] project_all failed for match {}", m)

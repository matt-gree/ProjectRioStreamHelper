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
# chosen captain), not a roster slot. provider.startgg.setId records which
# start.gg set was loaded into this match (see the /match/{m}/startgg-set route).
_DEFAULT_SIDE = {"participantId": None, "rioName": "", "captain": "", "port": None}


def default_match() -> dict:
    return {
        "label": "",
        "stage": "draft",          # draft | live | post (see note_live / postgame)
        "format": {"bestOf": 1},
        # The match owns the SERIES (games won per side within the Bo format);
        # each board owns only its live game. Post-game capture credits the
        # winner here (award_game); the projector mirrors it onto every bound
        # board as score.{N}.player.{T}.series_wins for overlays to render.
        "series": {"1": 0, "2": 0},
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

        # Series mirror: the match's game wins + format, so scoreboard overlays
        # can render Bo-series pips. Written value-or-"" like the player keys —
        # deterministic re-projection, and unbinding blanks them.
        series = match.get("series") or {}
        for t in (1, 2):
            wins = series.get(str(t), series.get(t))
            entries.append((f"score.{sb}.player.{t}.series_wins",
                            int(wins) if isinstance(wins, (int, float)) else ""))
        best_of = (match.get("format") or {}).get("bestOf")
        entries.append((f"score.{sb}.best_of", int(best_of) if best_of else ""))

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

    # ----- Draft→Live reconciliation (Phase 5) -----------------------------
    #
    # The projector (above) seats fixture/identity onto a board *before* a game.
    # Once a live feed (HUD / ongoing API) starts writing score.{N}.*, these
    # helpers keep the producer's draft authoritative for the two things the feed
    # gets wrong: which side each player sits on (Project Rio randomizes
    # away/home) and the curated display identity. The feed stays authoritative
    # for all live data (count, runners, roster, score, …). See provider.py /
    # game_pool.py for the call sites.

    @classmethod
    def scoreboard_match(cls, sb) -> str | None:
        """The match id bound to board ``sb`` (score.{sb}.match), or None."""
        score = State.state.get("score", {}) or {}
        sc = score.get(str(sb))
        if not isinstance(sc, dict):
            sc = score.get(sb) if isinstance(score.get(sb), dict) else {}
        m = sc.get("match")
        return m if m else None

    @classmethod
    def _participant_rioname(cls, player: dict | None) -> str:
        """Resolve a match side's Rio name — the registry identity (the join
        key) takes precedence over any rioName cached on the match itself."""
        player = player or {}
        pid = player.get("participantId")
        if pid:
            row = Participants.Get(pid)
            if row:
                rn = (row.get("identities") or {}).get("rioName") or ""
                if rn:
                    return rn
        return player.get("rioName") or ""

    @classmethod
    def _bound_sides(cls, sb):
        """(match_id, p1, p2) for a bound board, or None when unbound."""
        m = cls.scoreboard_match(sb)
        if not m:
            return None
        players = cls.get(m).get("player") or {}
        p1 = players.get("1") or players.get(1) or {}
        p2 = players.get("2") or players.get(2) or {}
        return m, p1, p2

    @classmethod
    def orientation_for_sides(cls, sb, left_rio: str, right_rio: str) -> bool | None:
        """Whether board ``sb``'s current sides need a swap to seat each match
        participant on their authored side.

        Returns True (swap), False (already correct), or None (not bound, or the
        feed's players don't match the draft — leave the orientation alone).
        Decided from whichever side resolves unambiguously by rioName.
        """
        bound = cls._bound_sides(sb)
        if not bound:
            return None
        _m, p1, p2 = bound
        s1 = cls._participant_rioname(p1).strip().casefold()
        s2 = cls._participant_rioname(p2).strip().casefold()
        if not s1 and not s2:
            return None
        left = (left_rio or "").strip().casefold()
        right = (right_rio or "").strip().casefold()
        if s1 and left == s1:
            return False
        if s2 and left == s2:
            return True
        if s1 and right == s1:
            return True
        if s2 and right == s2:
            return False
        return None

    @classmethod
    def orientation_for_parsed(cls, parsed: dict, sb) -> bool | None:
        """``orientation_for_sides`` from a parsed game's entrant rioNames."""
        entrants = parsed.get("entrants") or [[{}], [{}]]
        left = entrants[0][0].get("rioName", "") if entrants[0] else ""
        right = entrants[1][0].get("rioName", "") if entrants[1] else ""
        return cls.orientation_for_sides(sb, left, right)

    @classmethod
    def identity_entries(cls, sb, left_rio: str, right_rio: str) -> list[tuple]:
        """Display-identity overlay for a bound board.

        Map each side's *live* rioName to the match's participant and write that
        participant's curated ``display.*`` so the producer's authored identity
        wins over a resurface-by-rioName guess (e.g. a name collision resolves to
        the participant the producer actually drafted). rioName-keyed, so it is
        correct regardless of which side the feed placed each player on. Only
        non-empty values are written — enrich, never blank. Returns [] when the
        board is unbound. Appended last in the SetBatch so it overrides the
        feed/resurface writes for the same keys.
        """
        bound = cls._bound_sides(sb)
        if not bound:
            return []
        _m, p1, p2 = bound
        by_rio: dict[str, str] = {}
        for p in (p1, p2):
            rn = cls._participant_rioname(p).strip().casefold()
            pid = p.get("participantId")
            if rn and pid:
                by_rio[rn] = pid
        out: list[tuple] = []
        for t, rio in ((1, left_rio), (2, right_rio)):
            pid = by_rio.get((rio or "").strip().casefold())
            row = Participants.Get(pid) if pid else None
            if not row:
                continue
            display = row.get("display") or {}
            base = f"score.{sb}.player.{t}"
            for src, dst in RESURFACE_MAP.items():
                v = display.get(src)
                if v:
                    out.append((f"{base}.{dst}", v))
        return out

    # ----- series (match→score flow, Phase 10) -----------------------------

    @classmethod
    def side_for_rio(cls, m, rio_name: str) -> int | None:
        """Which authored side (1|2) of match ``m`` a rioName sits on, or None.

        rioName-keyed like identity_entries — correct regardless of which board
        side the feed (or a manual swap) placed the player on.
        """
        needle = (rio_name or "").strip().casefold()
        if not needle:
            return None
        players = cls.get(m).get("player") or {}
        for t in (1, 2):
            p = players.get(str(t)) or players.get(t) or {}
            if cls._participant_rioname(p).strip().casefold() == needle:
                return t
        return None

    @classmethod
    async def award_game(cls, m, winner_rio: str) -> int | None:
        """Credit one series game to the side ``winner_rio`` sits on, then
        re-project so every bound board's series_wins update. Returns the
        credited side, or None when the winner isn't on this match (name
        mismatch — leave the series alone rather than guess)."""
        side = cls.side_for_rio(m, winner_rio)
        if side is None:
            logger.warning("[Match] {}: winner {!r} not on this match — series not advanced",
                           m, winner_rio)
            return None
        series = cls.get(m).get("series") or {}
        wins = series.get(str(side), series.get(side)) or 0
        await State.Set(f"match.{m}.series.{side}", int(wins) + 1)
        await State.Save()
        await cls.project_match(m)
        logger.info("[Match] {}: game to side {} ({}) — series now {}",
                    m, side, winner_rio, cls.get(m).get("series"))
        return side

    @classmethod
    async def note_live(cls, sb) -> None:
        """Advance a bound board's match from draft→live on first live feed.

        Guarded on the current stage so it writes once per game (the hot path
        calls this on every feed event). ``post`` is owned by the post-game
        slice; this only ever promotes draft→live.
        """
        m = cls.scoreboard_match(sb)
        if not m:
            return
        if cls.get(m).get("stage") == "draft":
            await State.Set(f"match.{m}.stage", "live")
            logger.info("[Match] {} → live (board {} feed started)", m, sb)

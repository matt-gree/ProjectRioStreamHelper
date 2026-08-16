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
from server.state import State
from server.utils.deep_dict import deep_get
from server.utils.projection import run_startup_projection
from server.utils.tasks import spawn

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
_DEFAULT_SIDE = {"participantId": None, "rioName": "", "captain": "", "port": None, "seed": None}


def default_match() -> dict:
    return {
        "label": "",               # round name (start.gg roundName, or typed "Winners R2")
        "phase": "",               # competition phase (start.gg phase name, e.g. "Top Cut")
        "stage": "draft",          # draft | live | post (see note_live / postgame)
        # Producer-facing display time ("6:30 PM", "After break") for schedule
        # surfaces (upcoming-schedule element, lower-third). Free text, never
        # parsed — a broadcast label, not a trigger.
        "scheduledAt": "",
        "format": {"bestOf": 1},
        # The match owns the SERIES (games won per side within the Bo format);
        # each board owns only its live game. Post-game capture credits the
        # winner here (award_game); the projector mirrors it onto every bound
        # board as score.{N}.player.{T}.series_wins for overlays to render.
        "series": {"1": 0, "2": 0},
        # Series-decided winner side (1|2) once a side reaches ceil(bestOf/2)
        # wins; None while the series is live. Set by award_game's arithmetic
        # (or the producer's force-decide); drives auto-retire + the UI.
        "decided": None,
        "gameMode": "",
        "provider": {"startgg": {"setId": None}},
        "player": {"1": dict(_DEFAULT_SIDE), "2": dict(_DEFAULT_SIDE)},
    }


def _norm_side(v):
    """Coerce a decided/side value to int 1|2, or None."""
    if v in (1, 2):
        return v
    if v in ("1", "2"):
        return int(v)
    return None


def _as_int(v):
    """Coerce a match id (int or digit-string) to int, or None."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class Match:
    """Reads/writes ``match.{M}.*`` through State and projects onto bound boards.

    Stateless singleton (mirrors State/Settings): all data lives in the State
    store; these classmethods are just the projection + lifecycle logic.
    """

    # The "primary" match — the head of the (still-informal) match queue. Setting
    # its players auto-preps the producer-facing intro surfaces (Matchup band +
    # Player Plates). One day this generalizes to a real queue; for now it's fixed.
    PRIMARY_MATCH_ID = 1

    # Last (rio1, rio2) ordered pair the primary auto-prep synced, so an edit that
    # doesn't change the players (a label tweak, a format change) doesn't re-hit
    # the Rio API. Session-only; None re-syncs on the next set.
    _primary_synced_pair: tuple[str, str] | None = None

    # match id (str) -> {game id (str): credited side}. Two watchers can report
    # the same finished game (HUD post-game capture + the API GameEndWatcher on
    # another board bound to the same match); ids make award_game idempotent so
    # the second report is a no-op instead of a double series credit. Session-
    # only: a restart re-crediting a game would need the same id re-reported,
    # which the stage guard / _done sets already prevent.
    _credited_games: dict[str, dict] = {}

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
    def _board_side_is_empty(cls, sb: int, t: int) -> bool:
        """True if the board's side has no existing name/roster data yet.

        Only an empty board may have its captain slot blanked by a
        captain-less match projection — a board already carrying real data
        (most commonly a live HUD game) must keep it, or binding a
        captain-less match clears the live roster out from under the feed.
        """
        side = deep_get(State.state, f"score.{sb}.player.{t}") or {}
        if not isinstance(side, dict):
            return True
        return not side.get("rioName") and not deep_get(side, "character.0.name")

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
        if captain:
            vals["character.0.name"] = captain
            vals["rio_captainIndex"] = 0
        elif cls._board_side_is_empty(sb, t):
            vals["character.0.name"] = ""
            vals["rio_captainIndex"] = ""
        else:
            # A blank match captain must never clear an already-populated
            # board (e.g. a live HUD game) — drop these two keys from this
            # projection so the existing data survives untouched.
            del vals["character.0.name"]
            del vals["rio_captainIndex"]

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

        # Bracket phase: the match's label (the start.gg round name, or a
        # producer-typed phase like "Winners R2") drives the scoreboard's phase
        # display. Projected value-or-"" like the other fixture keys, so
        # re-projection is deterministic and unbinding blanks it.
        entries.append((f"score.{sb}.phase", match.get("label") or ""))

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
        # Series-decided winner side, so overlays can render a "wins the series"
        # state. Blanked (value "") while live or unbound — deterministic like
        # the other projected keys.
        decided = _norm_side(match.get("decided"))
        entries.append((f"score.{sb}.series_decided", decided if decided else ""))

        await State.SetBatch(entries)
        await State.Save()

        # stats_tag is a Settings key; its change drives the per-scoreboard stats
        # fetch (mirrors the HUD/Live path). Only write when we have a mode, so an
        # empty/unbound match never wipes the board's tag — and route it through
        # the one auto-sync writer, which leaves a producer's PICK alone. A
        # fixture's mode is authored, but it is authored about the FIXTURE; the
        # board's own override is the more specific answer and wins.
        if game_mode:
            from server.bindings import sync_stats_tag
            await sync_stats_tag(sb, game_mode)

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
            await run_startup_projection(f"Match {m}", cls.project_match(m))

    # ----- primary-match auto-prep -----------------------------------------
    #
    # The primary match (id 1) is the head of the match queue a producer works
    # off of. When its two participants are set, the head-to-head band (Matchup)
    # and the Player Plates should be ready without hand-wiring — so setting the
    # primary match's players auto-fetches the head-to-head and points the plates
    # at it. Both stay overridable: a producer who fetches the Matchup for — or
    # points the plates at — a *different* match keeps that; the auto-prep only
    # touches a surface still following the primary.

    @classmethod
    def _plates_follow_primary(cls, PlayerPlates) -> bool:
        """True while the Player Plates are still following the primary match —
        source ``match`` and their picked match unset or the primary. A switch to
        Manual, or a pick of another match, is a producer override we leave alone."""
        cfg = PlayerPlates.config() or {}
        if cfg.get("source") == "manual":
            return False
        mid = cfg.get("matchId")
        return mid is None or _as_int(mid) == cls.PRIMARY_MATCH_ID

    @classmethod
    def _matchup_follows_primary(cls) -> bool:
        """True while the Matchup band is unfetched or was last fetched for the
        primary match. A fetch for another match is a producer override."""
        mid = (State.state.get("matchup", {}) or {}).get("matchId")
        return mid is None or _as_int(mid) == cls.PRIMARY_MATCH_ID

    @classmethod
    async def prepare_primary_surfaces(cls) -> None:
        """Auto-prep the producer-facing intro surfaces for the primary match.

        When the primary match has both participants resolvable to Rio names,
        refresh the head-to-head band (Matchup) and point the Player Plates at it
        so both are populated and ready before they go on air. Each surface is
        only auto-managed while it still follows the primary (see the
        ``_*_follow_primary`` guards); a producer override to another match — or
        plates switched to Manual — is left untouched. Deduped on the ordered
        ``(rio1, rio2)`` pair so edits that don't change the players don't re-hit
        the Rio API.
        """
        m = cls.PRIMARY_MATCH_ID
        if not cls.exists(m):
            cls._primary_synced_pair = None
            return
        players = cls.get(m).get("player") or {}
        rio1 = cls._participant_rioname(players.get("1") or players.get(1))
        rio2 = cls._participant_rioname(players.get("2") or players.get(2))
        if not rio1 or not rio2:
            # Not both sides set yet — clear the guard so re-populating re-syncs.
            cls._primary_synced_pair = None
            return
        pair = (rio1.strip().casefold(), rio2.strip().casefold())
        if pair == cls._primary_synced_pair:
            return

        # Lazy imports — matchup/playerplates both import Match (cycle at module load).
        from server.matchup import Matchup
        from server.playerplates import PlayerPlates

        if cls._plates_follow_primary(PlayerPlates):
            await PlayerPlates.point_at_match(m)

        ok = True
        if cls._matchup_follows_primary():
            result = await Matchup.Fetch(m)
            ok = not result.get("error")
            if not ok:
                logger.warning("[Match] primary matchup auto-fetch failed: {}",
                               result.get("error"))

        # Record the pair only once the (network) fetch has succeeded — or was
        # skipped as an override — so a transient API failure retries next edit.
        if ok:
            cls._primary_synced_pair = pair
            logger.info("[Match] primary match {}: auto-prepped surfaces ({} vs {})",
                        m, rio1, rio2)

    @classmethod
    def schedule_primary_sync(cls) -> None:
        """Fire-and-forget the primary-match surface prep. Non-blocking so a match
        edit never waits on — or fails because of — the Rio API."""
        spawn(cls._run_primary_sync(), name="match.primary_sync")

    @classmethod
    async def _run_primary_sync(cls) -> None:
        try:
            await cls.prepare_primary_surfaces()
        except Exception:
            logger.exception("[Match] primary-surface auto-sync failed")

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
    def _need(cls, m) -> int:
        """Wins required to take the series — a simple majority
        (``bestOf // 2 + 1``), which only decides a series for an odd
        ``bestOf``. Ingestion paths that set ``format.bestOf`` (e.g.
        ``apply_startgg_set``) are responsible for normalizing even/falsy
        values so a series is always decidable."""
        best_of = int((cls.get(m).get("format") or {}).get("bestOf") or 1)
        return best_of // 2 + 1

    @classmethod
    async def award_game(cls, m, winner_rio: str, game_id=None) -> int | None:
        """Credit one series game to the side ``winner_rio`` sits on, mark the
        series decided if that reaches ``ceil(bestOf/2)``, then re-project so
        every bound board updates. Returns the credited side, or None when the
        winner isn't on this match (name mismatch — leave the series alone
        rather than guess).

        Pass ``game_id`` when the caller knows which finished game it is
        crediting: the same game then advances the series at most once per
        match (returns the previously credited side on a repeat). ``None``
        skips the dedup for callers without an id."""
        if game_id is not None:
            prior = cls._credited_games.get(str(m), {}).get(str(game_id))
            if prior is not None:
                logger.info("[Match] {}: game {} already credited to side {} — skipping",
                            m, game_id, prior)
                return prior
        side = cls.side_for_rio(m, winner_rio)
        if side is None:
            logger.warning("[Match] {}: winner {!r} not on this match — series not advanced",
                           m, winner_rio)
            return None
        series = cls.get(m).get("series") or {}
        wins = int(series.get(str(side), series.get(side)) or 0) + 1
        entries = [(f"match.{m}.series.{side}", wins)]
        # First side to clinch owns `decided`; a later dead-rubber game never
        # flips it (arithmetic, not last-writer).
        if wins >= cls._need(m) and _norm_side(cls.get(m).get("decided")) is None:
            entries.append((f"match.{m}.decided", side))
            logger.info("[Match] {}: side {} clinches the series (Bo{})",
                        m, side, (cls.get(m).get("format") or {}).get("bestOf"))
        await State.SetBatch(entries)
        await State.Save()
        await cls.project_match(m)
        if game_id is not None:
            cls._credited_games.setdefault(str(m), {})[str(game_id)] = side
        logger.info("[Match] {}: game to side {} ({}) — series now {}",
                    m, side, winner_rio, cls.get(m).get("series"))
        return side

    @classmethod
    async def force_decide(cls, m, side) -> None:
        """Producer override: mark the series decided for ``side`` (or clear the
        decided flag when ``side`` is falsy). Does not touch the game counts."""
        s = _norm_side(side)
        await State.Set(f"match.{m}.decided", s if s else None)
        await State.Save()
        await cls.project_match(m)
        logger.info("[Match] {}: force-decide → {}", m, s)

    @classmethod
    async def flip_sides(cls, m) -> None:
        """Swap participant 1↔2 on the fixture (authoring), carrying each side's
        series wins with them so the record stays with the player. Distinct from
        the per-game orientation gate, which seats *live* players to the fixture.
        Re-projects onto every bound board."""
        match = cls.get(m)
        players = match.get("player") or {}
        p1 = players.get("1") or players.get(1) or {}
        p2 = players.get("2") or players.get(2) or {}
        series = match.get("series") or {}
        w1 = int(series.get("1", series.get(1, 0)) or 0)
        w2 = int(series.get("2", series.get(2, 0)) or 0)
        entries = [
            (f"match.{m}.player.1", dict(p2)),
            (f"match.{m}.player.2", dict(p1)),
            (f"match.{m}.series.1", w2),
            (f"match.{m}.series.2", w1),
        ]
        decided = _norm_side(match.get("decided"))
        if decided:
            entries.append((f"match.{m}.decided", 2 if decided == 1 else 1))
        await State.SetBatch(entries)
        await State.Save()
        await cls.project_match(m)
        logger.info("[Match] {}: sides flipped", m)

    # ----- per-game identity gate (Phase B) --------------------------------

    @classmethod
    def gate_state(cls, sb, left_rio: str, right_rio: str) -> dict:
        """Evaluate the per-game identity gate for bound board ``sb``.

        Fired on a new game (inning reset) to check the live players against the
        bound match's participants. Returns a dict with ``status``:

        - ``nogate``   — board unbound, or the fixture has no participants yet.
        - ``ok``       — a participant resolves; ``swap`` gives the orientation.
        - ``conflict`` — neither live player matches an *undecided* match. Do NOT
                          clear; the producer resolves. Carries ``expected`` +
                          ``feed`` for the notification.
        - ``retire``   — neither matches but the match is already *decided*: the
                          series is over and different players are on now, so the
                          match auto-retires and the board runs unbound.
        """
        m = cls.scoreboard_match(sb)
        if not m:
            return {"status": "nogate"}
        match = cls.get(m)
        players = match.get("player") or {}
        p1 = players.get("1") or players.get(1) or {}
        p2 = players.get("2") or players.get(2) or {}
        e1 = cls._participant_rioname(p1)
        e2 = cls._participant_rioname(p2)
        if not e1.strip() and not e2.strip():
            return {"status": "nogate", "matchId": m}

        orient = cls.orientation_for_sides(sb, left_rio, right_rio)
        if orient is not None:
            return {"status": "ok", "matchId": m, "swap": orient}

        payload = {
            "matchId": m,
            "expected": {"1": e1, "2": e2},
            "feed": {"left": left_rio or "", "right": right_rio or ""},
        }
        if _norm_side(match.get("decided")) is not None:
            return {"status": "retire", **payload}
        return {"status": "conflict", **payload}

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

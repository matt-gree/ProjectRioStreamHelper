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

from server.boards import board_lifecycle
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

# Which of those keys the LIVE FEED also writes (provider.apply_parsed_game_to_state
# and its `_apply_resurface` pass). `score.{N}.player.{T}.*` is the one place a
# projector and a feed meet, and for this projector the overlap is total — every
# key above is feed-shared.
#
# THE RULE: a feed-shared key is written with a VALUE, never blanked over live
# data. "Write the full key set, value or ''" is what makes re-projection
# deterministic, but a board carrying a game already has a truer answer for these
# than an empty fixture does, so an empty projected value defers instead of
# winning. Only an empty side (`_board_side_is_empty`) gets the blank, which is
# what keeps unbinding a fixture on an idle board from leaving stale names.
#
# This started as a two-key carve-out for the captain, and the two keys it left
# out were the ones that name the player: unbinding a match mid-game blanked both
# sides' `rioName` while the board kept its teams, rosters, batter and inning, so
# the Quick Rail reported "No game on this board yet" for a board at inning 9 and
# the scoreboard went nameless — until the next HUD frame healed it, which is
# never while the feed is idle.
_FEED_SHARED_KEYS = frozenset(_PLAYER_KEYS)

# Deferring on *every* empty value would trade that bug for its mirror image, so
# the rule turns on whether the blank is an ANSWER or the absence of one:
#
#   - Address-book fields (RESURFACE_MAP targets) are answers once a participant
#     resolves. A person with no twitter really has no twitter, and re-binding a
#     board from someone who has one to someone who doesn't must clear it.
#   - These three are never answers. A fixture that doesn't pick a port or a
#     captain is not claiming the player has none — the live game knows, and the
#     captain carve-out this generalises existed for exactly that reason.
_OPTIONAL_PICK_KEYS = frozenset({"port", "rio_captainIndex", "character.0.name"})

# THE OWNERSHIP TABLE — every fixture field, where it lands, and who wins.
#
# There are exactly TWO rules and neither is a special case of the other. Both
# exist because a projection and a live feed write the same keys, and "the
# projector writes its full key set" is only safe where the projector actually
# knows better than the feed.
#
#   RULE A — a blank DEFERS, unless a blank is an answer.
#       Applies to keys the projector resolved to "". An address-book field is
#       an answer once a participant resolves (re-binding to someone with no
#       twitter must clear it); an optional pick never is (_OPTIONAL_PICK_KEYS).
#
#   RULE B — a STAND-IN defers when it HAS a value.
#       Applies to picks that substitute for feed data before a game exists.
#       Written only over a board with no feed. Rule A cannot catch these:
#       it reconsiders keys left empty, and a stand-in is wrong exactly when
#       the projector has a value.
#
# | fixture field      | projected key                  | rule                |
# |--------------------|--------------------------------|---------------------|
# | participantId /    | player.{T}.rioName             | A                   |
# |   rioName          |                                |                     |
# | (registry display) | player.{T}.<RESURFACE_MAP>     | A (blank IS an      |
# |                    |                                |    answer)          |
# | captain            | player.{T}.character.0.name    | B                   |
# |                    | player.{T}.rio_captainIndex    | B                   |
# | port               | player.{T}.port                | B                   |
# | seed               | — not projected                | —                   |
# | label              | phase                          | projector owns      |
# | series / bestOf /  | player.{T}.series_wins,        | projector owns      |
# |   decided          | best_of, series_decided        |   (feed has none)   |
# | gameMode           | Settings stats_tag, via        | producer's pick     |
# |                    |   sync_stats_tag               |   wins (manual)     |
# | stage/scheduledAt/ | — not projected                | —                   |
# |   format/provider  |                                |                     |
#
# The discriminator for both rules is `_board_side_has_feed_data`, which asks
# whether the board has a game_id AND is not `restored` (server/boards.py) — NOT
# "is the side populated", because a projection's own output populates the side.
#
# Adding a fixture field? Decide which column it is in before writing it. Every
# bug this table records was a field that looked like it had no column at all.

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

    # WHICH FINISHED GAMES HAVE ALREADY ADVANCED A SERIES lives ON THE MATCH
    # (`match.{m}.credited` = {game id: side}), not in a class variable.
    #
    # Two watchers can report the same finished game (the HUD post-game capture
    # and the API GameEndWatcher on another board bound to the same match), and
    # ids are what make award_game idempotent so the second report is a no-op
    # rather than a double credit. That set used to be session-only, on the
    # argument that "a restart re-crediting a game would need the same id
    # re-reported, which the stage guard already prevents" — and the stage guard
    # standing in for it is exactly what stopped game 2 of a Bo3 from EVER being
    # credited (see postgame._promote_match). A record that outlives the process
    # is what lets that guard go: re-capturing a game after a restart is an
    # ordinary recovery press, and it must stay a no-op.
    #
    # It rides `match.{m}`, so it is unset with the fixture and needs no teardown
    # of its own.

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
        """True if the board's side has no existing name/roster data yet."""
        side = deep_get(State.state, f"score.{sb}.player.{t}") or {}
        if not isinstance(side, dict):
            return True
        return not side.get("rioName") and not deep_get(side, "character.0.name")

    @classmethod
    def _board_side_has_feed_data(cls, sb: int, t: int) -> bool:
        """True if a FEED — not this projector — put the data on the board's side.

        The distinction is what makes the feed-shared rule safe to apply. Asking
        only "is the side populated" cannot answer it, because a projection's own
        output populates the side: bind a match to an empty board and the very
        next unbind sees a populated side and defers, stranding the fixture it was
        supposed to clear (the stale-fixture-on-air bug the full-key-set rule
        exists to prevent).

        `game_id` answers it for every game a producer is DELIBERATELY SHOWING —
        live, stranded mid-frame, or a completed record on screen as content. All
        three have real ports, a real captain and real names, and all three must
        outrank a draft pick: that is what `test_a_fixture_port_stays_off_a_
        completed_game` and the captain carve-out below are defending, and it is
        why this is not simply "is the lifecycle live".

        What it cannot answer is a game that is on the board because it was on the
        board when PRSH last exited. `restored` (server/boards.py) is that state
        and only that state — residue, chosen by nobody this session — and the key
        it is missing from is `game_id`, which a finished game keeps forever. So a
        producer opening the app the next day and binding tonight's fixture got a
        board that deferred every blank to last night's players and dropped both
        picks, because an 18-hour-old frame still looked like a feed.

        The general turnover case (a game that ENDED this session, and the next
        fixture going up over it) is not fixed here and should not be: `bind_board`
        clears a stale board's game before it projects, so the projection that
        follows sees no game at all. Removing the game is a truer answer than
        reasoning about whose it was.
        """
        if board_lifecycle(sb) == "restored":
            return False
        if not deep_get(State.state, f"score.{sb}.game_id"):
            return False
        return not cls._board_side_is_empty(sb, t)

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
        has_feed = cls._board_side_has_feed_data(sb, t)

        # Controller port — a STAND-IN, on the same terms as the captain below.
        #
        # A fixture port is what the controller overlay follows before a game
        # exists: `score.{N}.player.{T}.port` is the key controller-mount.js
        # iframes gc-overlay at. Once a game is on the board the HUD reports the
        # real port every frame, and the player may simply have plugged into a
        # different one — so an authored pick over live data put the WRONG PAD
        # on air, reloading the iframe to do it.
        #
        # A completed game is the worst of it: apply_completed_game_to_state
        # clears port to None precisely because a finished game has no live
        # controller, and the projection wrote the pick straight back over that
        # — bringing the overlay back for a game already over.
        port = player.get("port")
        if port is not None and not has_feed:
            vals["port"] = port

        # Captain-only projection: mirror the Live-API "no roster" path — the
        # chosen captain character goes in roster slot 0 and is marked captain.
        #
        # ONLY over a board with no game. This is a STAND-IN for a roster, not a
        # correction to one: over a live game the feed already knows the real
        # nine and which of them is captain, and the fixture's draft pick is at
        # best a duplicate of that and at worst last week's plan. Written anyway
        # it did two things at once — put the picked character in slot 0, losing
        # whoever really batted first, and forced rio_captainIndex to 0, so every
        # overlay that resolves the captain by index (the scoreboard's team-logo
        # fallback, the Game Summary hero art) drew roster slot 0 and called it
        # the captain. A fixture picking Birdo against a game whose captain was
        # Yoshi put Birdo in the logo spot for the whole broadcast.
        #
        # The deferral below could not catch this: it only reconsiders keys the
        # projector left EMPTY, and these two are only wrong when it has a value.
        # That is what makes them different from the rest of _OPTIONAL_PICK_KEYS
        # — those defer when blank, these must defer when filled.
        captain = player.get("captain") or ""
        if captain and not has_feed:
            vals["character.0.name"] = captain
            vals["rio_captainIndex"] = 0

        if row:
            display = row.get("display") or {}
            for src, dst in RESURFACE_MAP.items():
                v = display.get(src)
                if v:
                    vals[dst] = v

        # Apply the feed-shared rule (see _FEED_SHARED_KEYS). A side with no feed
        # data behind it still takes the full deterministic blank; over live feed
        # data an empty value defers unless it is an answer.
        if has_feed:
            resolves_identity = row is not None
            for k in list(vals):
                if k not in _FEED_SHARED_KEYS or vals[k] != "":
                    continue
                if k in _OPTIONAL_PICK_KEYS or not resolves_identity:
                    del vals[k]

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
        # NOT written to `score.{sb}.tag_set`. That key is the game's tag-set
        # ID, an int, written by both feeds (`hud_data.tag_set_id()`) and
        # cleared to None by the completed path; the resolved NAME has its own
        # key beside it, `score.{sb}.game_mode`, and is what overlays draw. The
        # projector was putting a name string into the id slot — clobbering the
        # live game's id with the wrong type, and blanking it on unbind. A
        # fixture's mode belongs in `stats_tag` (below), which is where it goes.

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
    def best_of(cls, m) -> int:
        """The fixture's format, defaulted to a Bo1 — the app's only assumption."""
        return int((cls.get(m).get("format") or {}).get("bestOf") or 1)

    @classmethod
    def games_played(cls, m) -> int:
        """Games credited to the series so far, both sides."""
        series = cls.get(m).get("series") or {}
        return (int(series.get("1", series.get(1)) or 0)
                + int(series.get("2", series.get(2)) or 0))

    @classmethod
    def _need(cls, m) -> int:
        """Wins required to take the series — a simple majority
        (``bestOf // 2 + 1``), which only decides a series for an odd
        ``bestOf``. Ingestion paths that set ``format.bestOf`` (e.g.
        ``apply_startgg_set``) are responsible for normalizing even/falsy
        values so a series is always decidable."""
        return cls.best_of(m) // 2 + 1

    @classmethod
    def is_complete(cls, m) -> bool:
        """Has this fixture run out of games? A DIFFERENT QUESTION FROM WHO WON.

        ``decided`` records a WINNER, and for every odd format that is also the
        record of the end — somebody always clinches. **A doubleheader
        (``bestOf: 2``) is complete after two games however they fall**, and a
        1-1 split has no winner at all, so anywhere ``decided`` was standing in
        for "this fixture is finished" a split would read as still running.

        A Bo1 at 0-0 is NOT complete: its game may have ended without crediting
        (a quit game reports no winner) and the fixture still has its game to
        give. Mirrors ``matchComplete`` in
        ``public/layout/lib/match-format.js``, which answers this for the console
        and the overlays off the same two fields.
        """
        if _norm_side(cls.get(m).get("decided")) is not None:
            return True
        return cls.games_played(m) >= cls.best_of(m)

    @classmethod
    async def award_game(cls, m, winner_rio: str, game_id=None) -> int | None:
        """Credit one series game to the side ``winner_rio`` sits on, mark the
        series decided if that reaches ``ceil(bestOf/2)``, then re-project so
        every bound board updates. Returns the credited side, or None when the
        winner isn't on this match (name mismatch — leave the series alone
        rather than guess).

        Pass ``game_id`` when the caller knows which finished game it is
        crediting: the same game then advances the series at most once per
        match (returns the previously credited side on a repeat), durably — the
        record is ``match.{m}.credited``, so a re-capture after a restart is
        still a no-op. ``None`` skips the dedup for callers without an id."""
        if game_id is not None:
            prior = (cls.get(m).get("credited") or {}).get(str(game_id))
            if prior is not None:
                logger.info("[Match] {}: game {} already credited to side {} — skipping",
                            m, game_id, prior)
                return prior
        # A SERIES NEVER HOLDS MORE GAMES THAN ITS FORMAT ALLOWS. The dedup above
        # answers "have I already counted THIS game"; this answers "does the
        # fixture have a game left to count at all", which is a different
        # question and the one an extra game asks. A board keeps its binding
        # until the producer clears or hands it on, so the game after a finished
        # fixture arrives on a board still bound to it — crediting that would
        # push a doubleheader to 2-1 and a Bo1 to 2-0, inventing a game the
        # format says cannot exist and putting the count on air.
        if cls.is_complete(m):
            logger.info("[Match] {}: already complete ({} of Bo{}) — game not credited",
                        m, cls.games_played(m), cls.best_of(m))
            return None
        side = cls.side_for_rio(m, winner_rio)
        if side is None:
            logger.warning("[Match] {}: winner {!r} not on this match — series not advanced",
                           m, winner_rio)
            return None
        series = cls.get(m).get("series") or {}
        wins = int(series.get(str(side), series.get(side)) or 0) + 1
        entries = [(f"match.{m}.series.{side}", wins)]
        if game_id is not None:
            entries.append((f"match.{m}.credited.{game_id}", side))
        # First side to clinch owns `decided`; a later dead-rubber game never
        # flips it (arithmetic, not last-writer).
        if wins >= cls._need(m) and _norm_side(cls.get(m).get("decided")) is None:
            entries.append((f"match.{m}.decided", side))
            logger.info("[Match] {}: side {} clinches the series (Bo{})",
                        m, side, (cls.get(m).get("format") or {}).get("bestOf"))
        await State.SetBatch(entries)
        await State.Save()
        await cls.project_match(m)
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
        - ``retire``   — neither matches but the match is already *complete*: it
                          is out of games and different players are on now, so the
                          match auto-retires and the board runs unbound. COMPLETE,
                          not decided — a split doubleheader has no winner and is
                          just as finished (``is_complete``).
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
        if cls.is_complete(m):
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

"""Post-game projector (Phase 6) — captures a finished game's box score from
Project Rio's on-disk **stat file** and projects it onto a scoreboard.

Unlike live data (which the feed writes) or the API stats path (StatsTracker),
post-game numbers come from the authoritative stat file Project Rio writes to
disk when a game ends. File location/selection lives in
``server/postgame_files.py`` (GameID + Loaded-from-HUD gated, never "newest
file"), box-score shaping in ``server/postgame_stats.py``, and the per-AB
Character Spotlight walkthrough in ``server/postgame_contacts.py`` — this
module owns the caches, the capture/projection lifecycle, and the match hop.

State shape (own ``postgame.*`` namespace, scoreboard-keyed; the match's lifecycle
stage still flips to ``post`` when a match is bound)::

    postgame.{N}.present        bool
    postgame.{N}.gameId         normalized decimal-string game id
    postgame.{N}.capturedAt     ISO-8601 capture time
    postgame.{N}.sourceFile     stat-file basename
    postgame.{N}.meta           { startDate, endDate, stadium, tagSetId,
                                  inningsSelected, inningsPlayed, isMercy,
                                  wasQuit, quitter, version, winnerSide }
    postgame.{N}.player.{T}      { rioName, score, isWinner, captain, teamName,
                                   totals { runs, hits, homeruns, stars_won,
                                            strikeouts_pitched },
                                   characters: [ {rosterIndex, name, isStarred,
                                     isCaptain, battingHand, fieldingHand,
                                     wasPitcher, batting{…}, pitching{…}|None,
                                     defense{big_plays, wall_jumps,
                                             sliding_catches} } ] }

``totals`` is the side-level aggregate the Game Summary (player-vs-player)
callout reads. ``stars_won`` has no stat-file field — it is derived from
resolved Star Chance at-bats (``postgame_stats.stars_won``). ``teamName`` is
the roster-derived MSB team name (live state clears ``msb_team`` for completed
games, so the capture derives its own).

The per-event ``Events`` array (the hit-viz / by-character source) is **not**
broadcast into State — it is large and only the producer-triggered hit-viz reads
it. It is held in the in-memory ``_captured`` cache and served by REST
(``GET /postgame?scoreboard=N``).
"""
import asyncio
import os
from datetime import datetime, timezone

from loguru import logger

from server import postgame_contacts, postgame_files, postgame_stats
from server.match import Match
from server.postgame_files import norm_game_id
from server.rio.pyrio.stat_file_parser import StatObj
from server.state import State


class PostGame:
    """Scoreboard-keyed post-game capture. Stateless w.r.t. State (mirrors
    Match/Commentary); the only in-memory state is the full-payload cache used to
    serve the heavy Events array over REST."""

    # sb -> full structured payload (the projected fields PLUS "events")
    _captured: dict[int, dict] = {}
    # sb -> parsed StatObj for the captured file (per-AB hit sim source)
    _stat_objs: dict[int, "StatObj"] = {}
    # sb -> {event_num: ContactRecord} lazily built by character_abs
    _contacts: dict[int, dict] = {}

    # Serializes capture(): two concurrent captures for the same board (double-
    # click, watcher + manual) would otherwise both pass _promote_match's
    # stage-!="post" check across its awaits and double-credit the series.
    # Created lazily so it binds to the running event loop (tests reset it).
    _capture_lock: asyncio.Lock | None = None

    @classmethod
    def _lock(cls) -> asyncio.Lock:
        if cls._capture_lock is None:
            cls._capture_lock = asyncio.Lock()
        return cls._capture_lock

    # ----- parse / shape ---------------------------------------------------

    @classmethod
    def _orient(cls, sb: int, away_name: str, home_name: str) -> tuple[int, int]:
        """Map (away, home) → (side1_team_num, side2_team_num) for board ``sb``.

        Side 1 = left, 2 = right. We honor the board's *current* orientation (the
        producer may have swapped sides via the match/manual) by matching live
        ``score.{sb}.player.{T}.rioName`` to the stat file's player names. Falls
        back to away→side1, home→side2 when neither resolves.
        """
        score = State.state.get("score", {}) or {}
        sc = score.get(str(sb)) or score.get(sb) or {}
        players = (sc.get("player") or {}) if isinstance(sc, dict) else {}

        def live(t):
            p = players.get(str(t)) or players.get(t) or {}
            return (p.get("rioName") or "").strip().casefold()

        a = (away_name or "").strip().casefold()
        h = (home_name or "").strip().casefold()
        l1, l2 = live(1), live(2)
        if a and l1 == a:
            return 0, 1
        if h and l1 == h:
            return 1, 0
        if a and l2 == a:
            return 1, 0
        if h and l2 == h:
            return 0, 1
        return 0, 1  # default: away=left, home=right

    @classmethod
    def _build_payload(cls, sb: int, stat: StatObj, data: dict, src_name: str) -> dict:
        away_name, home_name = stat.player(0), stat.player(1)
        t1, t2 = cls._orient(sb, away_name, home_name)

        # Stars won / per-inning runs / event-derived character counters per raw
        # team, indexable by the corrected team_num (0=away, 1=home — same space
        # _orient's t1/t2 live in).
        events = data.get("Events") or []
        stars = dict(zip((0, 1), postgame_stats.stars_won(events)))
        lines = dict(zip((0, 1), postgame_stats.linescore(events, stat)))
        derived = postgame_stats.char_event_derived(events)

        winner_team = stat.winning_team()  # 0/1, or -1 tie
        winner_side = 1 if winner_team == t1 else 2 if winner_team == t2 else 0

        meta = {
            "startDate": data.get("Date - Start", ""),
            "endDate": data.get("Date - End", ""),
            "stadium": stat.stadium(),
            "tagSetId": data.get("TagSetID"),
            "inningsSelected": stat.inningsSelected(),
            "inningsPlayed": stat.inningsPlayed(),
            "isMercy": stat.isMercy(),
            "wasQuit": stat.wasQuit(),
            "quitter": stat.quitter(),
            "version": stat.version(),
            "winnerSide": winner_side,
        }
        return {
            "present": True,
            "gameId": norm_game_id(data.get("GameID")),
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "sourceFile": src_name,
            "meta": meta,
            # Side → raw team_num, for consumers that need to walk the raw
            # (away/home-keyed) events in side terms (character_abs).
            "teamNums": {"1": t1, "2": t2},
            "player": {
                "1": postgame_stats.side_block(stat, t1, stars[t1], derived[t1]),
                "2": postgame_stats.side_block(stat, t2, stars[t2], derived[t2]),
            },
            # Per-inning runs by side; None = half not played ("X" cell).
            "linescore": {"1": lines[t1], "2": lines[t2]},
            # Heavy; kept out of State, served via REST.
            "events": data.get("Events", []),
        }

    # ----- projection ------------------------------------------------------

    @classmethod
    def _project_entries(cls, sb: int, payload: dict | None) -> list[tuple]:
        """The full managed key set for board ``sb`` (blanked when payload None)."""
        base = f"postgame.{sb}"
        if not payload:
            return [
                (f"{base}.present", False),
                (f"{base}.gameId", ""),
                (f"{base}.capturedAt", ""),
                (f"{base}.sourceFile", ""),
                (f"{base}.meta", {}),
                (f"{base}.player.1", {}),
                (f"{base}.player.2", {}),
                (f"{base}.linescore", {}),
            ]
        return [
            (f"{base}.present", True),
            (f"{base}.gameId", payload["gameId"]),
            (f"{base}.capturedAt", payload["capturedAt"]),
            (f"{base}.sourceFile", payload["sourceFile"]),
            (f"{base}.meta", payload["meta"]),
            (f"{base}.player.1", payload["player"]["1"]),
            (f"{base}.player.2", payload["player"]["2"]),
            (f"{base}.linescore", payload.get("linescore", {})),
        ]

    # ----- public API ------------------------------------------------------

    @classmethod
    async def capture(cls, sb: int) -> dict:
        """Capture the finished game for board ``sb`` from its stat file.

        Matches by ``score.{sb}.game_id`` + the Loaded-from-HUD gate, projects the
        box score into State, caches the full payload (incl. events), and promotes
        a bound match draft/live → ``post``.

        Returns ``{"success": bool, ...}`` — never raises on a missing/invalid
        stat file (the producer sees ``reason``).
        """
        async with cls._lock():
            score = State.state.get("score", {}) or {}
            sc = score.get(str(sb)) or score.get(sb) or {}
            game_id = sc.get("game_id") if isinstance(sc, dict) else None

            path, reason = postgame_files.find_file(game_id)
            if path is None:
                logger.warning("[PostGame] sb{} capture failed: {}", sb, reason)
                return {"success": False, "scoreboard": sb, "reason": reason}

            data = postgame_files.load_json(path)
            if data is None:
                return {"success": False, "scoreboard": sb,
                        "reason": f"Could not read stat file {path.name}."}

            try:
                stat = StatObj(data)
                payload = cls._build_payload(sb, stat, data, path.name)
            except Exception as e:
                logger.exception("[PostGame] sb{} parse failed for {}", sb, path.name)
                return {"success": False, "scoreboard": sb,
                        "reason": f"Failed to parse stat file: {e}"}

            cls._captured[sb] = payload
            cls._stat_objs[sb] = stat
            cls._contacts.pop(sb, None)  # rebuilt lazily for the new capture
            await State.SetBatch(cls._project_entries(sb, payload))
            await State.Save()
            await cls._promote_match(sb)

            logger.info("[PostGame] sb{} captured game {} from {} ({} events)",
                        sb, payload["gameId"], path.name, len(payload["events"]))
            return {
                "success": True,
                "scoreboard": sb,
                "gameId": payload["gameId"],
                "sourceFile": path.name,
                "winnerSide": payload["meta"]["winnerSide"],
                "eventCount": len(payload["events"]),
            }

    @classmethod
    async def _promote_match(cls, sb: int) -> None:
        """Advance a bound board's match → ``post`` and credit the series game.

        Match owns the lifecycle; ``note_live`` only ever promotes draft→live,
        so post-game owns this hop. The winner from the captured box score is
        mapped to a match side by rioName (immune to board-side swaps) and
        ``Match.award_game`` bumps ``match.{m}.series.{side}`` + re-projects.
        The stage guard makes this once-per-game: re-capturing the same
        finished game while already ``post`` never double-credits the series.
        """
        m = Match.scoreboard_match(sb)
        if not m:
            return
        if Match.get(m).get("stage") != "post":
            await State.Set(f"match.{m}.stage", "post")
            logger.info("[PostGame] match {} → post (board {})", m, sb)

            payload = cls._captured.get(sb) or {}
            winner_side = (payload.get("meta") or {}).get("winnerSide")
            winner_rio = ""
            if winner_side in (1, 2):
                winner_rio = ((payload.get("player") or {}).get(str(winner_side)) or {}).get("rioName", "")
            if winner_rio:
                await Match.award_game(m, winner_rio,
                                       game_id=payload.get("gameId") or None)
            elif winner_side in (1, 2):
                logger.warning("[PostGame] sb{}: winner side {} has no rioName — series not advanced",
                               sb, winner_side)

    @classmethod
    async def clear(cls, sb: int) -> None:
        """Blank the post-game box score on a board and drop its cache."""
        cls._captured.pop(sb, None)
        cls._stat_objs.pop(sb, None)
        cls._contacts.pop(sb, None)
        await State.SetBatch(cls._project_entries(sb, None))
        await State.Save()

    @classmethod
    def get_payload(cls, sb: int) -> dict | None:
        """Full captured payload (incl. events) for a board, or None."""
        return cls._ensure_cache(sb)

    @classmethod
    def _ensure_cache(cls, sb: int) -> dict | None:
        """The board's captured payload, rebuilding the in-memory cache when a
        server restart wiped it. State durably records which stat file backs
        the projected box score (``postgame.{sb}.sourceFile``); re-parsing that
        file restores ``_captured``/``_stat_objs`` so the heavy REST consumers
        (events, the Spotlight walkthrough) survive restarts."""
        payload = cls._captured.get(sb)
        if payload:
            return payload
        pg = (State.state.get("postgame", {}) or {}).get(str(sb))
        if not isinstance(pg, dict) or not pg.get("present"):
            return None
        src = os.path.basename(str(pg.get("sourceFile") or ""))
        if not src:
            return None
        path = postgame_files.stat_dir() / src
        if not path.is_file():
            logger.warning("[PostGame] sb{} cache rebuild: stat file {} is gone", sb, src)
            return None
        data = postgame_files.load_json(path)
        if data is None:
            return None
        try:
            stat = StatObj(data)
            payload = cls._build_payload(sb, stat, data, path.name)
        except Exception:
            logger.exception("[PostGame] sb{} cache rebuild failed from {}", sb, src)
            return None
        cls._captured[sb] = payload
        cls._stat_objs[sb] = stat
        cls._contacts.pop(sb, None)
        logger.info("[PostGame] sb{} rebuilt capture cache from {}", sb, src)
        return payload

    # ----- per-AB walkthrough (Character Spotlight) -------------------------

    @classmethod
    def _contacts_for(cls, sb: int) -> dict:
        """``{event_num: ContactRecord}`` for the board's captured game.

        Built lazily on the first spotlight request (the hit sim re-derives
        every contact's exact flight from its recorded RNG — CPU work we don't
        want on the capture path) and cached until the next capture/clear.
        """
        if sb not in cls._contacts:
            cls._contacts[sb] = postgame_contacts.simulate_game_contacts(
                cls._stat_objs.get(sb), sb)
        return cls._contacts[sb]

    @classmethod
    def character_abs(cls, sb: int, side: int, char_index: int) -> dict:
        """Every resolved plate appearance for one roster character, enriched
        for the Character Spotlight walkthrough (``postgame_contacts``).

        Heavy (full trajectories) — REST only, never State.
        """
        payload = cls._ensure_cache(sb)
        if not payload:
            return {"success": False, "reason": "No captured game on this scoreboard."}
        if side not in (1, 2) or not (0 <= char_index < 9):
            return {"success": False, "reason": "Invalid side or roster index."}
        return postgame_contacts.character_abs(
            payload, cls._contacts_for(sb), sb, side, char_index)

"""Post-game projector (Phase 6) — captures a finished game's box score from
Project Rio's on-disk **stat file** and projects it onto a scoreboard.

Unlike live data (which the feed writes) or the API stats path (StatsTracker),
post-game numbers come from the authoritative stat file Project Rio writes to
disk when a game ends. File location/selection lives in
``server/postgame/files.py`` (GameID + Loaded-from-HUD gated, never "newest
file"), box-score shaping in ``server/postgame/stats.py``, and the per-AB
Character Spotlight walkthrough in ``server/postgame/contacts.py`` — this
module owns the caches, the capture/projection lifecycle, and the match hop.

State shape (own ``postgame.*`` namespace, scoreboard-keyed; the match's lifecycle
stage still flips to ``post`` when a match is bound)::

    postgame.{N}.present        bool
    postgame.{N}.gameId         normalized decimal-string game id
    postgame.{N}.capturedAt     ISO-8601 capture time
    postgame.{N}.sourceFile     stat-file basename
    postgame.{N}.meta           { startDate, endDate, stadium, tagSetId,
                                  gameMode, inningsSelected, inningsPlayed, isMercy,
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

from server.postgame import contacts as postgame_contacts, files as postgame_files, stats as postgame_stats
from server.match import Match
from server.postgame.files import norm_game_id
from server.rio import stats_api
from server.rio.pyrio.stat_file_parser import StatObj
from server.state import State
from server.utils.deep_dict import deep_get


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
    # click, watcher + manual) would otherwise interleave their projections and
    # cache writes. The series is safe either way — `award_game` dedups on the
    # game id, durably. Created lazily so it binds to the running event loop.
    _capture_lock: asyncio.Lock | None = None

    @classmethod
    def _lock(cls) -> asyncio.Lock:
        if cls._capture_lock is None:
            cls._capture_lock = asyncio.Lock()
        return cls._capture_lock

    # ----- parse / shape ---------------------------------------------------

    @staticmethod
    def _seated(players: dict | None) -> tuple[str, str]:
        """The (side 1, side 2) rioNames out of a ``player`` block."""
        players = players if isinstance(players, dict) else {}
        return tuple(
            ((players.get(str(t)) or {}).get("rioName") or "") for t in (1, 2)
        )

    @classmethod
    def _live_seated(cls, sb: int) -> tuple[str, str]:
        """Who board ``sb`` has on each side right now."""
        return cls._seated(deep_get(State.state, f"score.{sb}.player"))

    @classmethod
    def _orient(cls, seated: tuple[str, str], away_name: str, home_name: str) -> tuple[int, int]:
        """Map (away, home) → (side1_team_num, side2_team_num).

        ``seated`` is the (side 1, side 2) rioNames to honour: the board's live
        orientation at capture (the producer may have swapped sides via the
        match/manual), or the capture's own when rebuilding it. Falls back to
        away→side1, home→side2 when neither resolves.
        """
        a = (away_name or "").strip().casefold()
        h = (home_name or "").strip().casefold()
        l1, l2 = (n.strip().casefold() for n in seated)
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
    def _build_payload(cls, seated: tuple[str, str], stat: StatObj, data: dict,
                       src_name: str) -> dict:
        away_name, home_name = stat.player(0), stat.player(1)
        t1, t2 = cls._orient(seated, away_name, home_name)

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
            # The mode THIS game was played under, by name — frozen at capture
            # so a summary shown after the board has moved on still names it.
            # Cache-only (never a network round-trip inside the capture lock);
            # '' when unknown, and the Game Summary falls back to the board's.
            "gameMode": stats_api.game_mode_name(data.get("TagSetID")),
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
                (f"{base}.capturedBy", ""),
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
            (f"{base}.capturedBy", payload.get("capturedBy", "manual")),
            (f"{base}.sourceFile", payload["sourceFile"]),
            (f"{base}.meta", payload["meta"]),
            (f"{base}.player.1", payload["player"]["1"]),
            (f"{base}.player.2", payload["player"]["2"]),
            (f"{base}.linescore", payload.get("linescore", {})),
        ]

    # ----- public API ------------------------------------------------------

    @classmethod
    async def capture(cls, sb: int, by: str = "manual", file: str | None = None) -> dict:
        """Capture the finished game for board ``sb`` from its stat file.

        Matches by ``score.{sb}.game_id`` + the Loaded-from-HUD gate, projects the
        box score into State, caches the full payload (incl. events), and promotes
        a bound match draft/live → ``post``.

        ``file`` is the producer's override — a filename from
        ``GET /postgame/files``, resolved inside the stat directory and captured
        WITHOUT the game-id match. That check is what fails in exactly the cases
        the override exists for (a crash, a game whose id never reached the board,
        a file under an unexpected id), so re-applying it here would leave the
        escape hatch locked from the inside. The captured payload records the
        FILE's own GameID, so a board can then say plainly that what it is showing
        is not the game it thought it had.

        ``by`` is mirrored to ``postgame.{sb}.capturedBy`` (``auto`` when the stat
        watcher fired it, ``manual`` when the producer did) — the same "say which
        layer decided this" idiom as ``score.{N}.side_reason``, so the board panel
        can tell a box score that filled itself in from one somebody pressed for.

        Returns ``{"success": bool, ...}`` — never raises on a missing/invalid
        stat file (the producer sees ``reason``).
        """
        async with cls._lock():
            game_id = deep_get(State.state, f"score.{sb}.game_id")
            # Read the board BEFORE leaving the loop: the file work below runs on
            # a worker thread, and State is the event loop's.
            seated = cls._live_seated(sb)
            # Finding, reading and parsing a stat file is all blocking disk and
            # CPU work, and auto-capture fires the moment a game ends — on the
            # loop it held every HUD frame behind a full box-score parse.
            result = await asyncio.to_thread(cls._load, sb, seated, file, game_id)
            if "reason" in result:
                return {"success": False, "scoreboard": sb, "reason": result["reason"]}
            path, stat, payload = result["path"], result["stat"], result["payload"]

            payload["capturedBy"] = by if by in ("auto", "manual") else "manual"
            cls._attach_league_logos(sb, payload)
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

    # ----- league logos ----------------------------------------------------
    #
    # A capture is shown after the board has moved on, so it cannot borrow the
    # board's live `score.{N}.player.{T}.league_logo` (server/league_logos.py):
    # by then that names the NEXT game's players, or nobody. It resolves its own,
    # by the mode the CAPTURED game was played in, onto each side's block as
    # `leagueLogo` — the same (person, league) lookup the board uses.

    @classmethod
    def _league_mode(cls, sb: int, payload: dict) -> str:
        """The captured game's mode, else what the board says it is playing
        (a mode the capture could not resolve from the mode cache)."""
        mode = ((payload.get("meta") or {}).get("gameMode") or "")
        if mode:
            return mode
        from server.league_logos import board_mode

        return board_mode(sb)

    @classmethod
    def _league_logos(cls, sb: int, payload: dict) -> dict[str, str]:
        from server.participants import Participants

        mode = cls._league_mode(sb, payload)
        out = {}
        for t in ("1", "2"):
            rio = ((payload.get("player") or {}).get(t) or {}).get("rioName") or ""
            out[t] = Participants.league_logo(mode, rio)[1] if rio else ""
        return out

    @classmethod
    def _attach_league_logos(cls, sb: int, payload: dict) -> None:
        try:
            logos = cls._league_logos(sb, payload)
        except Exception:
            logger.exception("[PostGame] sb{} league logo lookup failed", sb)
            return
        for t, url in logos.items():
            block = (payload.get("player") or {}).get(t)
            if isinstance(block, dict):
                block["leagueLogo"] = url

    @classmethod
    async def refresh_league_logos(cls) -> None:
        """Re-resolve every capture's league logos after an Address Book edit
        (`Participants.reproject_dependents`) — a logo swapped or a person added
        to a league book changes nothing a capture would otherwise re-read."""
        entries = []
        for key, pg in list((State.state.get("postgame", {}) or {}).items()):
            if not isinstance(pg, dict) or not pg.get("present"):
                continue
            try:
                sb = int(key)
            except (TypeError, ValueError):
                continue
            for t, url in cls._league_logos(sb, pg).items():
                if ((pg.get("player") or {}).get(t) or {}).get("leagueLogo", "") != url:
                    entries.append((f"postgame.{sb}.player.{t}.leagueLogo", url))
                # Replaced, never mutated: the cached block is the same object
                # the projection put in State, and an in-place write would hide
                # the change from the Save() diff.
                players = (cls._captured.get(sb) or {}).get("player") or {}
                if isinstance(players.get(t), dict):
                    players[t] = {**players[t], "leagueLogo": url}
        if entries:
            await State.SetBatch(entries)
            await State.Save()

    @classmethod
    def _load(cls, sb: int, seated: tuple[str, str], file: str | None, game_id) -> dict:
        """Find, read and parse a board's stat file. Blocking — run in a thread.

        Returns ``{path, stat, payload}``, or ``{reason}`` saying why not.
        """
        if file:
            path, reason = postgame_files.resolve_pick(file)
        else:
            path, reason = postgame_files.find_file(game_id)
        if path is None:
            logger.warning("[PostGame] sb{} capture failed: {}", sb, reason)
            return {"reason": reason}

        data = postgame_files.load_json(path)
        if data is None:
            return {"reason": f"Could not read stat file {path.name}."}

        try:
            stat = StatObj(data)
            payload = cls._build_payload(seated, stat, data, path.name)
        except Exception as e:
            logger.exception("[PostGame] sb{} parse failed for {}", sb, path.name)
            return {"reason": f"Failed to parse stat file: {e}"}
        return {"path": path, "stat": stat, "payload": payload}

    @classmethod
    async def _promote_match(cls, sb: int) -> None:
        """Advance a bound board's match → ``post`` and credit the series game.

        Match owns the lifecycle; ``note_live`` only ever promotes draft→live,
        so post-game owns this hop. The winner from the captured box score is
        mapped to a match side by rioName (immune to board-side swaps) and
        ``Match.award_game`` bumps ``match.{m}.series.{side}`` + re-projects.

        THE STAGE HOP AND THE CREDIT ARE TWO THINGS, and nesting the second
        inside the first meant **only the first captured game of a match could
        ever advance the series**. The guard was hired as the once-per-game
        check, but it is a once-per-MATCH check: game 2 of a Bo3 arrives with the
        match already at ``post``, so it was skipped in silence — a Bo3 could
        never get past 1-0, never decide, and sat on "between games" forever. The
        same skip swallowed every re-capture after a first one that could not
        resolve a winner (a quit game reports no ``winnerSide``), which is how a
        **Bo1** ended a night at 0-0 with three captured games behind it.

        ``award_game``'s ``game_id`` dedup is the real once-per-game guard, and
        it is durable (``match.{m}.credited``), so re-capturing the same finished
        game is still a no-op — across a restart too, which the class-level set
        this replaced could not manage and which is why the stage guard was
        standing in for it.
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
        else:
            # A quit game reports no winner. Saying so once is what makes the
            # 0-0 series afterwards explicable instead of a mystery.
            logger.info("[PostGame] sb{}: capture has no winner — series not advanced", sb)

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
        (events, the Spotlight walkthrough) survive restarts.

        THE REBUILD IS ORIENTED BY THE CAPTURE, NOT BY THE BOARD. By the time a
        restart asks, the board may hold the next game, be swapped, or have been
        filled from a hand-picked file whose names it never carried — and
        orienting against it fell back to away = side 1 while the persisted
        projection said otherwise, so the Spotlight replayed the other team's
        at-bats under the character the producer picked."""
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
            payload = cls._build_payload(cls._seated(pg.get("player")), stat, data, path.name)
        except Exception:
            logger.exception("[PostGame] sb{} cache rebuild failed from {}", sb, src)
            return None
        # The capture's own receipt, not the rebuild's.
        for key in ("capturedAt", "capturedBy"):
            if pg.get(key):
                payload[key] = pg[key]
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

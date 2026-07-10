"""Post-game projector (Phase 6) — captures a finished game's box score from
Project Rio's on-disk **stat file** and projects it onto a scoreboard.

Unlike live data (which the feed writes) or the API stats path (StatsTracker),
post-game numbers come from the authoritative stat file Project Rio writes to
disk when a game ends, under ``StatFiles/MarioSuperstarBaseball/`` — a sibling of
the ``HudFiles/`` directory that holds ``decoded.hud.json``. We use the on-disk
file, not the Rio API, so there is no gameID submission lag.

Selection is **not** "newest file". A capture for board ``N`` matches the stat
file whose ``GameID`` equals the just-finished game's id (already in state at
``score.{N}.game_id``) AND whose ``Loaded from HUD`` flag is ``0``. A stat file
loaded from a HUD replay (``Loaded from HUD != 0``) is not real recorded data and
is rejected.

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
                                     wasPitcher, batting{…}, pitching{…}|None } ] }

``totals`` is the side-level aggregate the Game Summary (player-vs-player)
callout reads. ``stars_won`` has no stat-file field — it is derived from
resolved Star Chance at-bats (see ``_stars_won``). ``teamName`` is the
roster-derived MSB team name (live state clears ``msb_team`` for completed
games, so the capture derives its own).

The per-event ``Events`` array (the hit-viz / by-character source) is **not**
broadcast into State — it is large and only the producer-triggered hit-viz reads
it. It is held in the in-memory ``_captured`` cache and served by REST
(``GET /postgame?scoreboard=N``).
"""
import asyncio
import glob
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

from server.match import Match
from server.rio.provider import get_default_hud_file_path
from server.rio.pyrio.stat_file_parser import StatObj
from server.rio.pyrio.stat_formatters import (
    derive_batting,
    derive_pitching,
    format_batting_line,
    format_pitching_line,
)
# Single source of truth for the Title-Case stat-file keys → formatter kwargs.
# The stat file's per-character Offensive/Defensive dicts use the same Title-Case
# keys as the HUD file, so the HUD maps apply verbatim.
from server.rio.pyrio.lookup import LookupDicts
from server.rio.pyrio.team_name_algo import team_name
from server.rio.stats_tracker import _HUD_BATTING_MAP, _HUD_PITCHING_MAP
from server.settings import Settings
from server.state import State

_STAT_SUBDIR = ("StatFiles", "MarioSuperstarBaseball")
_DECODED_PREFIX = "decoded."
# Trailing _<digits>.json in a stat-file name is the GameID (decimal). Used only
# as a cheap pre-filter; the GameID inside the file is the authoritative match.
_FILENAME_GAMEID_RE = re.compile(r"_(\d+)\.json$")

# Every postgame.{N}.* key the projector owns. A capture writes the full set; a
# clear blanks exactly these, so no stale box score lingers on a board.
_MANAGED_SCALARS = ["present", "gameId", "capturedAt", "sourceFile"]


def _norm_game_id(g) -> str:
    """Canonical comparison form for a GameID from any source.

    The stat file's ``GameID`` is a decimal string matching its filename; the
    HUD feed writes ``score.{N}.game_id`` as a string while the Live-API path
    writes an int. Normalize all of them to a comma/space-stripped string.
    """
    if g is None:
        return ""
    return str(g).replace(",", "").strip()


class PostGame:
    """Scoreboard-keyed post-game capture. Stateless w.r.t. State (mirrors
    Match/Commentary); the only in-memory state is the full-payload cache used to
    serve the heavy Events array over REST."""

    # sb -> full structured payload (the projected fields PLUS "events")
    _captured: dict[int, dict] = {}

    # ----- stat-file location ---------------------------------------------

    @classmethod
    def _stat_dir(cls) -> Path:
        """``StatFiles/MarioSuperstarBaseball`` as a sibling of ``HudFiles``.

        Resolved from the configured HUD path when set, else the OS default. The
        HUD *file* may be absent (a game just ended) — we only need its parent
        layout, so this never gates on file existence.
        """
        user_path = Settings.Get("project_rio.hud_path", "")
        hud = Path(user_path) if user_path else get_default_hud_file_path()
        return hud.parent.parent.joinpath(*_STAT_SUBDIR)

    @classmethod
    def _candidate_files(cls, game_id: str) -> list[Path]:
        """Decoded stat files whose filename GameID matches, newest first.

        Filename match is a pre-filter only; ``find_file`` re-verifies the
        in-file GameID and the Loaded-from-HUD gate.
        """
        d = cls._stat_dir()
        if not d.is_dir():
            return []
        files = []
        for p in d.glob(f"{_DECODED_PREFIX}*.json"):
            m = _FILENAME_GAMEID_RE.search(p.name)
            if m and (not game_id or _norm_game_id(m.group(1)) == game_id):
                files.append(p)
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        return files

    @classmethod
    def _load_json(cls, path: Path) -> dict | None:
        try:
            import orjson
            return orjson.loads(path.read_bytes())
        except Exception:
            logger.exception("[PostGame] failed to read stat file {}", path)
            return None

    @classmethod
    def find_file(cls, game_id: str) -> tuple[Path | None, str | None]:
        """Locate the usable stat file for ``game_id``.

        Returns ``(path, None)`` on success, or ``(None, reason)`` when no file
        matches or the only match is a HUD replay (``Loaded from HUD != 0``).
        """
        gid = _norm_game_id(game_id)
        if not gid:
            return None, "No game id for this scoreboard yet — start/finish a game first."

        candidates = cls._candidate_files(gid)
        if not candidates:
            return None, f"No stat file found for game {gid} in {cls._stat_dir()}."

        loaded_from_hud_seen = False
        for path in candidates:
            data = cls._load_json(path)
            if data is None:
                continue
            if _norm_game_id(data.get("GameID")) != gid:
                continue
            if data.get("Loaded from HUD", 0) != 0:
                loaded_from_hud_seen = True
                continue
            return path, None

        if loaded_from_hud_seen:
            return None, (
                f"Stat file for game {gid} was loaded from a HUD replay "
                "(Loaded from HUD != 0) and has no usable stats."
            )
        return None, f"No usable stat file matched game {gid}."

    # ----- parse / shape ---------------------------------------------------

    @classmethod
    def _batting_block(cls, off: dict) -> dict:
        raw = {k: off.get(src, 0) for k, src in _HUD_BATTING_MAP.items()}
        block = dict(raw)
        block.update(derive_batting(**raw))
        block["line"] = format_batting_line(**raw)
        return block

    @classmethod
    def _pitching_block(cls, deff: dict) -> dict:
        raw = {k: deff.get(src, 0) for k, src in _HUD_PITCHING_MAP.items()}
        block = dict(raw)
        block.update(derive_pitching(**raw))
        block["line"] = format_pitching_line(**raw)
        return block

    # Decoded "Result of AB" label → numeric final-result code. Captures read
    # the decoded stat file, where the code has been replaced by its label.
    _FINAL_RESULT_CODES = {v: k for k, v in LookupDicts.FINAL_RESULT.items()}

    @classmethod
    def _stars_won(cls, events: list) -> tuple[int, int]:
        """Stars WON per raw team ``(away, home)``.

        A star is won by resolving a Star Chance at-bat: the at-bat's final
        ``Result of AB`` decides it — the BATTING team wins on anything that
        puts the batter on (hits, codes >= 7, and walks, codes 2-3); an out
        (codes 1, 4-6) gives the star to the FIELDING team. ``Half Inning``
        0 = top (away bats), 1 = bottom (home bats). Empty/malformed
        events → (0, 0).
        """
        away = home = 0
        for ev in events or []:
            if not isinstance(ev, dict) or not ev.get("Star Chance"):
                continue
            result = ev.get("Result of AB")
            code = result if isinstance(result, int) \
                else cls._FINAL_RESULT_CODES.get(result, 0)
            if not isinstance(code, int) or code <= 0:
                continue  # at-bat not resolved on this event
            home_batting = ev.get("Half Inning") == 1
            batter_won = code >= 7 or code in (2, 3)
            if batter_won == home_batting:
                home += 1
            else:
                away += 1
        return away, home

    @classmethod
    def _linescore(cls, events: list, stat: StatObj) -> tuple[list, list]:
        """Per-inning runs ``(away, home)`` reconstructed from each event's
        running ``Away Score`` / ``Home Score``.

        Lists span the innings actually played (5 on mercy, 10+ on extras).
        The home entry for the final inning is ``None`` when its bottom half
        was never played (the broadcast "X" cell). The last inning is
        reconciled against the final box score so runs that land after the
        final recorded event (e.g. a walk-off) aren't dropped.
        """
        ordered = sorted((e for e in events or [] if isinstance(e, dict)),
                         key=lambda e: e.get("Event Num", 0))
        cum_away: dict[int, int] = {}
        cum_home: dict[int, int] = {}
        halves_seen: set[tuple[int, int]] = set()
        run_a = run_h = 0
        for ev in ordered:
            inn = ev.get("Inning")
            if not isinstance(inn, int) or inn < 1:
                continue
            a, h = ev.get("Away Score"), ev.get("Home Score")
            if isinstance(a, int):
                run_a = max(run_a, a)
            if isinstance(h, int):
                run_h = max(run_h, h)
            cum_away[inn] = run_a
            cum_home[inn] = run_h
            halves_seen.add((inn, ev.get("Half Inning")))
        if not cum_away:
            return [], []

        n = max(cum_away)
        away: list = []
        home: list = []
        prev_a = prev_h = 0
        for i in range(1, n + 1):
            ca, ch = cum_away.get(i, prev_a), cum_home.get(i, prev_h)
            away.append(max(ca - prev_a, 0))
            home.append(max(ch - prev_h, 0))
            prev_a, prev_h = ca, ch

        try:
            fa, fh = stat.score(0), stat.score(1)
            if isinstance(fa, int) and fa > prev_a:
                away[-1] += fa - prev_a
            if isinstance(fh, int) and fh > prev_h:
                home[-1] += fh - prev_h
        except Exception:
            pass

        if (n, 1) not in halves_seen:
            home[-1] = None
        return away, home

    @classmethod
    def _side_totals(cls, stat: StatObj, team_num: int, stars_won: int) -> dict:
        """Side-level aggregate line for the Game Summary callout."""
        return {
            "runs": stat.score(team_num),  # baseball score IS runs scored
            "hits": stat.hits(team_num),
            "homeruns": stat.homeruns(team_num),
            "stars_won": stars_won,
            "strikeouts_pitched": stat.strikeoutsPitched(team_num),
        }

    @classmethod
    def _side_block(cls, stat: StatObj, team_num: int, stars_won: int = 0) -> dict:
        """One team's full box score. ``team_num`` 0=away, 1=home (pyrio's own
        version correction is applied inside StatObj)."""
        characters = []
        off_list = stat.offensiveStats(team_num)   # list of 9
        def_list = stat.defensiveStats(team_num)
        names = stat.characterName(team_num)        # list of 9
        for i in range(9):
            off = off_list[i] if i < len(off_list) else {}
            deff = def_list[i] if i < len(def_list) else {}
            was_pitcher = bool(deff.get("Was Pitcher", 0))
            characters.append({
                "rosterIndex": i,
                "name": names[i] if i < len(names) else "",
                "isStarred": stat.isStarred(team_num, i),
                "isCaptain": i == stat.roster_obj(team_num).captain_index(),
                "battingHand": stat.battingHand(team_num, i),
                "fieldingHand": stat.fieldingHand(team_num, i),
                "wasPitcher": was_pitcher,
                "batting": cls._batting_block(off),
                "pitching": cls._pitching_block(deff) if was_pitcher else None,
            })
        winner = stat.winning_team()
        captain = stat.captain(team_num)
        try:
            # Live state clears msb_team for completed games, so derive it here.
            msb_team = team_name(list(names), captain) or ""
        except Exception:
            msb_team = ""
        return {
            "rioName": stat.player(team_num),
            "score": stat.score(team_num),
            "isWinner": winner == team_num,
            "captain": captain,
            "teamName": msb_team,
            "totals": cls._side_totals(stat, team_num, stars_won),
            "characters": characters,
        }

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

        # Stars won / per-inning runs per raw team, indexable by the corrected
        # team_num (0=away, 1=home — same space _orient's t1/t2 live in).
        stars = dict(zip((0, 1), cls._stars_won(data.get("Events") or [])))
        lines = dict(zip((0, 1), cls._linescore(data.get("Events") or [], stat)))

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
            "gameId": _norm_game_id(data.get("GameID")),
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "sourceFile": src_name,
            "meta": meta,
            "player": {
                "1": cls._side_block(stat, t1, stars[t1]),
                "2": cls._side_block(stat, t2, stars[t2]),
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
        score = State.state.get("score", {}) or {}
        sc = score.get(str(sb)) or score.get(sb) or {}
        game_id = sc.get("game_id") if isinstance(sc, dict) else None

        path, reason = cls.find_file(game_id)
        if path is None:
            logger.warning("[PostGame] sb{} capture failed: {}", sb, reason)
            return {"success": False, "scoreboard": sb, "reason": reason}

        data = cls._load_json(path)
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
                await Match.award_game(m, winner_rio)
            elif winner_side in (1, 2):
                logger.warning("[PostGame] sb{}: winner side {} has no rioName — series not advanced",
                               sb, winner_side)

    @classmethod
    async def clear(cls, sb: int) -> None:
        """Blank the post-game box score on a board and drop its cache."""
        cls._captured.pop(sb, None)
        await State.SetBatch(cls._project_entries(sb, None))
        await State.Save()

    @classmethod
    def get_payload(cls, sb: int) -> dict | None:
        """Full captured payload (incl. events) for a board, or None."""
        return cls._captured.get(sb)

    @classmethod
    def list_files(cls, limit: int = 25) -> list[dict]:
        """Recent usable (``Loaded from HUD == 0``) stat files for a manual pick.

        Returns lightweight descriptors, newest first — no full parse.
        """
        d = cls._stat_dir()
        if not d.is_dir():
            return []
        files = sorted(d.glob(f"{_DECODED_PREFIX}*.json"),
                       key=lambda p: p.stat().st_mtime, reverse=True)
        out = []
        for p in files[: limit * 2]:
            data = cls._load_json(p)
            if data is None or data.get("Loaded from HUD", 0) != 0:
                continue
            out.append({
                "file": p.name,
                "gameId": _norm_game_id(data.get("GameID")),
                "awayPlayer": data.get("Away Player", ""),
                "homePlayer": data.get("Home Player", ""),
                "awayScore": data.get("Away Score"),
                "homeScore": data.get("Home Score"),
                "endDate": data.get("Date - End", ""),
            })
            if len(out) >= limit:
                break
        return out

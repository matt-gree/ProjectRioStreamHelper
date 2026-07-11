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
                                     wasPitcher, batting{…}, pitching{…}|None,
                                     defense{big_plays, wall_jumps,
                                             sliding_catches} } ] }

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
from server.rio.pyrio.lookup import LookupDicts, is_captain
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
    # sb -> parsed StatObj for the captured file (per-AB hit sim source)
    _stat_objs: dict[int, "StatObj"] = {}
    # sb -> {event_num: ContactRecord} lazily built by character_abs
    _contacts: dict[int, dict] = {}

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
    def _result_code(cls, ev: dict) -> int:
        """Numeric final-result code for an event, 0 when the AB is unresolved."""
        result = ev.get("Result of AB")
        code = result if isinstance(result, int) \
            else cls._FINAL_RESULT_CODES.get(result, 0)
        return code if isinstance(code, int) and code > 0 else 0

    # Final-result codes that put a hit in the box score (Single..HR).
    _HIT_CODES = frozenset((7, 8, 9, 10))

    @staticmethod
    def _star_cost(char_name: str, is_team_captain: bool) -> int:
        """Team stars one swing by this character consumes.

        Captain-eligible characters (Mario, Luigi, Wario, …) burn TWO stars per
        Star Swing when they are not the team captain — foul star swings and
        successful star hits included; the cost is per swing, not per outcome.
        The captain themselves and non-captain-eligible subs spend one.
        """
        if is_team_captain:
            return 1
        try:
            return 2 if is_captain(char_name) else 1
        except ValueError:
            return 1

    @classmethod
    def _char_event_derived(cls, events: list) -> dict:
        """Per-character counters only the event stream can provide.

        Returns ``{team: {roster_loc: {star_hits, star_swings, wall_jumps,
        sliding_catches, runs}}}`` (team 0=away, 1=home). ``star_hits`` counts
        star swings that resolved the AB as a hit — the successful half of the
        "star hits vs stars spent" pair. ``star_swings`` is the RAW count of
        Star-type swings the character took (fouls included) — the spent half
        is this count times ``_star_cost`` (applied in ``_side_block``), which
        keeps the card total consistent with the per-AB chips instead of
        trusting the stat file's own "Star Hits" usage counter.
        Wall jumps and sliding catches have no aggregated stat-file
        field at all, so they are counted off each contact's First Fielder
        block. ``runs`` counts each time the character crossed home as a runner
        (``Runner Result Base == 4``) — verified to sum exactly to the final
        score, so no play is double-counted across an AB's events.
        """
        out = {0: {}, 1: {}}

        def bump(team, loc, key):
            if not isinstance(loc, int) or not (0 <= loc < 9):
                return
            slot = out[team].setdefault(loc, {"star_hits": 0, "star_swings": 0,
                                              "wall_jumps": 0,
                                              "sliding_catches": 0, "runs": 0})
            slot[key] += 1

        for ev in events or []:
            if not isinstance(ev, dict):
                continue
            half = ev.get("Half Inning")
            if half not in (0, 1):
                continue
            pitch = ev.get("Pitch") or {}
            contact = pitch.get("Contact") or {}

            for rkey in ("Runner Batter", "Runner 1B", "Runner 2B", "Runner 3B"):
                r = ev.get(rkey)
                if isinstance(r, dict) and r.get("Runner Result Base") == 4:
                    bump(half, r.get("Runner Roster Loc"), "runs")

            if pitch.get("Type of Swing") == "Star":
                bump(half, ev.get("Batter Roster Loc"), "star_swings")
                if cls._result_code(ev) in cls._HIT_CODES:
                    bump(half, ev.get("Batter Roster Loc"), "star_hits")

            fielder = contact.get("First Fielder") or {}
            action = fielder.get("Fielder Action")
            if action in ("Walljump", "Sliding"):
                key = "wall_jumps" if action == "Walljump" else "sliding_catches"
                bump(1 - half, fielder.get("Fielder Roster Location"), key)
        return out

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
    def _side_block(cls, stat: StatObj, team_num: int, stars_won: int = 0,
                    derived: dict | None = None) -> dict:
        """One team's full box score. ``team_num`` 0=away, 1=home (pyrio's own
        version correction is applied inside StatObj). ``derived`` is this team's
        slice of ``_char_event_derived`` (roster_loc → event-derived counters)."""
        characters = []
        off_list = stat.offensiveStats(team_num)   # list of 9
        def_list = stat.defensiveStats(team_num)
        names = stat.characterName(team_num)        # list of 9
        derived = derived or {}
        for i in range(9):
            off = off_list[i] if i < len(off_list) else {}
            deff = def_list[i] if i < len(def_list) else {}
            dv = derived.get(i, {})
            was_pitcher = bool(deff.get("Was Pitcher", 0))
            is_team_captain = i == stat.roster_obj(team_num).captain_index()
            char_name = names[i] if i < len(names) else ""
            batting = cls._batting_block(off)
            # Star-swing pair: spent = event-derived raw swing count times the
            # character's per-swing cost (captain-eligible non-captains burn 2
            # — fouls and successful star hits alike); hits = event-derived
            # star swings that landed as hits. Both derive from the same event
            # walk the per-AB chips use, so every surface agrees.
            batting["star_swings"] = (dv.get("star_swings", 0)
                                      * cls._star_cost(char_name, is_team_captain))
            batting["star_hits"] = dv.get("star_hits", 0)
            # Times this character crossed home as a runner (event-derived; no
            # stat-file aggregate exists).
            batting["runs"] = dv.get("runs", 0)
            pitching = None
            if was_pitcher:
                pitching = cls._pitching_block(deff)
                pitching["star_pitches"] = deff.get("Star Pitches Thrown", 0)
            characters.append({
                "rosterIndex": i,
                "name": char_name,
                "isStarred": stat.isStarred(team_num, i),
                "isCaptain": is_team_captain,
                "battingHand": stat.battingHand(team_num, i),
                "fieldingHand": stat.fieldingHand(team_num, i),
                "wasPitcher": was_pitcher,
                "batting": batting,
                "pitching": pitching,
                "defense": {
                    "big_plays": deff.get("Big Plays", 0),
                    "wall_jumps": dv.get("wall_jumps", 0),
                    "sliding_catches": dv.get("sliding_catches", 0),
                    # Stat file's "Outs Per Position": list of {pos: count}
                    # dicts (e.g. [{"2B": 4, "SS": 3}]). Flatten + total.
                    "outs_per_position": {
                        pos: n
                        for entry in (deff.get("Outs Per Position") or [])
                        if isinstance(entry, dict)
                        for pos, n in entry.items()
                    },
                    "outs_at_position": sum(
                        n
                        for entry in (deff.get("Outs Per Position") or [])
                        if isinstance(entry, dict)
                        for n in entry.values()
                    ),
                },
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

        # Stars won / per-inning runs / event-derived character counters per raw
        # team, indexable by the corrected team_num (0=away, 1=home — same space
        # _orient's t1/t2 live in).
        stars = dict(zip((0, 1), cls._stars_won(data.get("Events") or [])))
        lines = dict(zip((0, 1), cls._linescore(data.get("Events") or [], stat)))
        derived = cls._char_event_derived(data.get("Events") or [])

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
            # Side → raw team_num, for consumers that need to walk the raw
            # (away/home-keyed) events in side terms (character_abs).
            "teamNums": {"1": t1, "2": t2},
            "player": {
                "1": cls._side_block(stat, t1, stars[t1], derived[t1]),
                "2": cls._side_block(stat, t2, stars[t2], derived[t2]),
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
                await Match.award_game(m, winner_rio)
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
        path = cls._stat_dir() / src
        if not path.is_file():
            logger.warning("[PostGame] sb{} cache rebuild: stat file {} is gone", sb, src)
            return None
        data = cls._load_json(path)
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
        if sb in cls._contacts:
            return cls._contacts[sb]
        stat = cls._stat_objs.get(sb)
        contacts: dict = {}
        if stat is not None:
            try:
                from server.rio.pyrio.hit_simulator.hit_analysis import simulate_contacts
                contacts = {c.event_num: c for c in simulate_contacts(stat)}
            except Exception:
                logger.exception("[PostGame] sb{} contact simulation failed", sb)
        cls._contacts[sb] = contacts
        return contacts

    @staticmethod
    def _runner_entries(ev: dict) -> list[dict]:
        """The play's runner movements: initial base → result base (4 = scored,
        255 = out), for the batter (base 0) and every occupied base."""
        out = []
        for key, base in (("Runner Batter", 0), ("Runner 1B", 1),
                          ("Runner 2B", 2), ("Runner 3B", 3)):
            r = ev.get(key)
            if not isinstance(r, dict):
                continue
            result = r.get("Runner Result Base")
            is_out = result == 255 or (r.get("Out Type") not in (None, "None"))
            out.append({
                "base": base,
                "char": r.get("Runner Char Id", ""),
                "resultBase": None if result == 255 else result,
                "scored": result == 4,
                "out": bool(is_out),
                "steal": r.get("Steal", "None"),
            })
        return out

    @staticmethod
    def _is_fielders_choice(ev: dict, code: int) -> bool:
        """True when a contact-out event ("Result of AB" code 4, the generic
        "Out" bucket — see ``LookupDicts.FINAL_RESULT``) is actually a
        fielder's choice: the batter reached base safely while the defense
        recorded an out on a *different* runner. Rio's own "Result of AB"
        label conflates this with a plain contact out (both say "Out"), so we
        derive the distinction from the runner blocks instead.

        Additive classification only — ``resultCode`` stays 4 either way
        (``_result_code`` is untouched); this is a bolt-on flag the mount
        reads to relabel the stamp/chip without renumbering anything.
        """
        if code != 4:
            return False
        if not (ev.get("Num Outs During Play") or 0) > 0:
            return False
        batter = ev.get("Runner Batter") or {}
        if not isinstance(batter, dict) or batter.get("Runner Result Base") == 255:
            return False  # batter also out → plain contact out, not FC
        for key in ("Runner 1B", "Runner 2B", "Runner 3B"):
            r = ev.get(key)
            if isinstance(r, dict) and r.get("Runner Result Base") == 255:
                return True  # a different runner was put out on the play
        return False

    @staticmethod
    def _fallback_flight(contact: dict) -> dict | None:
        """Approximate a ball-in-play's flight straight from the stat file's
        own recorded contact fields, for plays pyrio's swing-physics
        resimulator can't reproduce.

        ``_contacts_for`` re-derives every contact's exact trajectory by
        replaying its recorded RNG through pyrio's swing model
        (``hit_simulator.hit_simulation.simulate_hit_from_event``), which only
        supports Slap/Charge/Star swings — a small slice of real contacts
        (e.g. a recorded ``Type of Swing`` of "None", seen on weakly-fielded
        come-backers) fall outside that model and the resimulator silently
        skips them (``hit_analysis.simulate_contacts``) or raises
        ``ValueError``. But the stat file already recorded the game's own
        contact point, landing point, apex height and hang time for every
        contact regardless of swing type — this draws one smooth parabola
        through those recorded points instead of re-deriving physics. Not a
        resimulation (hence no ``power``/``quality`` swing breakdown beyond
        what the file itself logged), but a real flight beats a blank one.

        Returns ``None`` when the recorded fields needed to draw a path are
        missing (e.g. a swing/foul with no landing spot at all).
        """
        try:
            sx = float(contact["Ball Contact Pos - X"])
            sz = float(contact["Ball Contact Pos - Z"])
            lx = float(contact["Ball Landing Position - X"])
            ly = float(contact.get("Ball Landing Position - Y") or 0)
            lz = float(contact["Ball Landing Position - Z"])
            apex = float(contact.get("Ball Max Height") or 0)
            frames = int(float(contact.get("Ball Hang Time") or 0))
        except (KeyError, TypeError, ValueError):
            return None
        if frames <= 0:
            return None
        sy = 0.0  # contact height isn't separately recorded; bat-height start
        n = max(frames, 2)
        # Quadratic Bezier control point chosen so the curve passes through
        # the recorded apex height at the midpoint of flight.
        ctrl_y = 2 * apex - 0.5 * (sy + ly)
        path = []
        for i in range(n + 1):
            t = i / n
            x = sx + (lx - sx) * t
            z = sz + (lz - sz) * t
            y = (1 - t) ** 2 * sy + 2 * (1 - t) * t * ctrl_y + t ** 2 * ly
            path.append([round(x, 3), round(y, 3), round(z, 3)])
        try:
            power = int(float(contact.get("Ball Power") or 0))
        except (TypeError, ValueError):
            power = 0
        return {
            "path": path,
            "landing": path[-1] if path else None,
            "distance": round((lx ** 2 + lz ** 2) ** 0.5, 2),
            "maxHeight": round(apex, 2),
            "hangTime": frames,
            "power": power,
            "quality": contact.get("Contact Quality"),
            "typeName": contact.get("Type of Contact"),
            "fiveStar": bool(contact.get("Star Swing Five-Star")),
            "approx": True,  # drawn from recorded points, not resimulated
        }

    @staticmethod
    def _charge_pct(pitch: dict) -> int | None:
        """Charge meter percentage for a resolving Charge swing, else None.

        The stat file's ``Pitch.Contact`` records two 0..1 meters
        (pyrio ``hit_simulator/hit_simulation.py`` ~1256/386-388/813-815):

        - ``Charge Power Up`` — the fill fraction; the sim's
          ``AtBat_IsFullyCharged`` is exactly ``charge_up == 1.0``.
        - ``Charge Power Down`` — the over-hold meter that only accrues after
          the fill completes (empirically: across 42k+ real contacts,
          ``charge_down > 0`` never coexists with ``charge_up < 1.0``); it
          modulates hit power in ``calculate_hit_power``.

        Formula: undercharged (< full) → ``charge_up * 100``; full charge →
        ``100``; overcharged → ``100 + charge_down * 100`` (max 200).
        Missed swings (strikeouts on a charge attempt, whiffed star swings)
        carry no contact charge fields → None.
        """
        if pitch.get("Type of Swing") != "Charge":
            return None
        contact = pitch.get("Contact") or {}
        try:
            cu = float(contact["Charge Power Up"])
            cd = float(contact.get("Charge Power Down") or 0.0)
        except (KeyError, TypeError, ValueError):
            return None
        return round(cu * 100) if cu < 1.0 else 100 + round(cd * 100)

    @classmethod
    def character_abs(cls, sb: int, side: int, char_index: int) -> dict:
        """Every resolved plate appearance for one roster character, enriched
        for the Character Spotlight walkthrough: before/after game situation,
        runner movements, pitch/contact detail, and (for balls in play) the
        exact re-simulated flight in the hit-renderer's contract shape.

        Heavy (full trajectories) — REST only, never State.
        """
        payload = cls._ensure_cache(sb)
        if not payload:
            return {"success": False, "reason": "No captured game on this scoreboard."}
        if side not in (1, 2) or not (0 <= char_index < 9):
            return {"success": False, "reason": "Invalid side or roster index."}

        team_num = (payload.get("teamNums") or {}).get(str(side))
        if team_num is None:
            # Pre-teamNums capture (shouldn't happen — cache and capture ship
            # together) — fall back to away=side1.
            team_num = 0 if side == 1 else 1
        side_data = (payload.get("player") or {}).get(str(side)) or {}
        chars = side_data.get("characters") or []
        char = chars[char_index] if char_index < len(chars) else {}

        contacts = cls._contacts_for(sb)
        events = [e for e in payload.get("events") or [] if isinstance(e, dict)]
        events.sort(key=lambda e: e.get("Event Num", 0))

        def side_pair(ev, away_key, home_key):
            raw = {0: ev.get(away_key), 1: ev.get(home_key)}
            t2 = 1 - team_num
            keys = {str(side): raw[team_num], str(3 - side): raw[t2]}
            return {"1": keys["1"], "2": keys["2"]}

        abs_list = []
        # Plate-appearance star accumulator: a PA is the consecutive run of
        # events (Event Num order — one event per pitch) sharing the same
        # (Inning, Half Inning, Batter Roster Loc), ending at the pitch that
        # resolves the AB. A resolved event closes the PA; every Star-type
        # BATTER swing inside the span (foul star swings included) consumed
        # ``star_cost`` team stars (2 for a captain-eligible non-captain).
        star_cost = cls._star_cost(char.get("name", ""), bool(char.get("isCaptain")))
        pa_key = None
        pa_stars = 0
        for idx, ev in enumerate(events):
            key = (ev.get("Inning"), ev.get("Half Inning"),
                   ev.get("Batter Roster Loc"))
            if key != pa_key:
                pa_key, pa_stars = key, 0
            pitch = ev.get("Pitch") or {}
            if pitch.get("Type of Swing") == "Star":
                pa_stars += 1

            code = cls._result_code(ev)
            if not code:
                continue
            stars_used = pa_stars * star_cost
            pa_key = None  # a resolved AB ends the PA; the next pitch starts fresh
            if ev.get("Half Inning") != team_num or ev.get("Batter Roster Loc") != char_index:
                continue

            # Some stat files record ``Type of Swing: "None"`` on a contacted
            # bunt — contact with no recorded swing type reads as a bunt.
            swing = pitch.get("Type of Swing")
            if swing in (None, "None") and pitch.get("Contact"):
                swing = "Bunt"

            score_before = side_pair(ev, "Away Score", "Home Score")
            # Event scores are pre-play; the next event carries the settled
            # score. Fall back to crediting the RBI to the batting side.
            if idx + 1 < len(events):
                score_after = side_pair(events[idx + 1], "Away Score", "Home Score")
            else:
                score_after = dict(score_before)
                score_after[str(side)] = (score_after.get(str(side)) or 0) + (ev.get("RBI") or 0)

            rec = {
                "eventNum": ev.get("Event Num"),
                "inning": ev.get("Inning"),
                "halfInning": ev.get("Half Inning"),
                "result": ev.get("Result of AB"),
                "resultCode": code,
                "isHit": code in cls._HIT_CODES,
                # Additive — see _is_fielders_choice. resultCode/result stay
                # whatever Rio recorded ("Out"); this just tells the mount to
                # relabel the stamp/chip without renumbering codes.
                "fieldersChoice": cls._is_fielders_choice(ev, code),
                "rbi": ev.get("RBI") or 0,
                "outsAdded": ev.get("Num Outs During Play") or 0,
                "pitcher": pitch.get("Pitcher Char Id") or "",
                "swing": swing,
                # Batter stars consumed across the whole PA (see accumulator
                # above), not just on the resolving pitch — cost-weighted, so a
                # captain-eligible non-captain's swing shows ★★. Star pitches
                # by the opposing pitcher are NOT counted.
                "starsUsed": stars_used,
                "swingInfo": {
                    "type": swing,
                    "chargePct": cls._charge_pct(pitch),
                },
                # Featured batter's team won/lost the Star Chance star, same
                # resolution rule as _stars_won (the batter is always on the
                # batting team here, so batter-won == featured-side won).
                "starChanceOutcome": (
                    None if not ev.get("Star Chance")
                    else "won" if (code >= 7 or code in (2, 3)) else "lost"
                ),
                "pitch": {
                    "type": pitch.get("Pitch Type"),
                    "speed": pitch.get("Pitch Speed"),
                    "chargeType": pitch.get("Charge Type"),
                    "starPitch": bool(pitch.get("Star Pitch")),
                },
                "before": {
                    "outs": ev.get("Outs") or 0,
                    "balls": ev.get("Balls") or 0,
                    "strikes": ev.get("Strikes") or 0,
                    "runners": {str(b): bool(ev.get(f"Runner {b}B")) for b in (1, 2, 3)},
                    "score": score_before,
                    "stars": side_pair(ev, "Away Stars", "Home Stars"),
                    "starChance": bool(ev.get("Star Chance")),
                },
                "after": {
                    "score": score_after,
                    "outs": (ev.get("Outs") or 0) + (ev.get("Num Outs During Play") or 0),
                },
                "runners": cls._runner_entries(ev),
                "contact": None,
                "fielder": None,
            }

            c = contacts.get(ev.get("Event Num"))
            if c is not None:
                points = [[round(x, 3), round(y, 3), round(z, 3)]
                          for x, y, z in c.trajectory]
                rec["contact"] = {
                    "path": points,
                    "landing": points[-1] if points else None,
                    "distance": round(c.distance, 2),
                    "maxHeight": round(c.apex, 2),
                    "hangTime": c.hang_frames,
                    "power": c.power,
                    "quality": c.sim.contact_quality,
                    "typeName": c.sim.contact_type_name,
                    "fiveStar": bool((pitch.get("Contact") or {}).get("Star Swing Five-Star")),
                }
            elif pitch.get("Contact"):
                # pyrio's resimulator has nothing for this event (unsupported
                # swing type, or it raised) — draw an honest approximate
                # flight from the game's own recorded contact fields instead
                # of leaving the play with no animation. See _fallback_flight.
                rec["contact"] = cls._fallback_flight(pitch["Contact"])
            fielder = (pitch.get("Contact") or {}).get("First Fielder") or {}
            if fielder:
                rec["fielder"] = {
                    "character": fielder.get("Fielder Character"),
                    "position": fielder.get("Fielder Position"),
                    "action": fielder.get("Fielder Action"),
                    "bobble": fielder.get("Fielder Bobble"),
                }
            abs_list.append(rec)

        return {
            "success": True,
            "scoreboard": sb,
            "team": side,
            "charIndex": char_index,
            "character": {
                "name": char.get("name", ""),
                "isStarred": char.get("isStarred", False),
                "isCaptain": char.get("isCaptain", False),
                "wasPitcher": char.get("wasPitcher", False),
                "battingHand": char.get("battingHand", ""),
                # Fresh stat blocks so the Spotlight doesn't depend on the
                # (possibly schema-stale) State projection after a cache rebuild.
                "batting": char.get("batting") or {},
                "pitching": char.get("pitching"),
                "defense": char.get("defense") or {},
            },
            "stadium": (payload.get("meta") or {}).get("stadium", ""),
            "count": len(abs_list),
            "abs": abs_list,
        }

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

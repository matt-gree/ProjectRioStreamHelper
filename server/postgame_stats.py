"""Box-score shaping for the post-game capture (``server/postgame.py``).

Pure functions over a parsed stat file (``StatObj`` + its raw ``Events``
array): per-character batting/pitching blocks, event-derived counters the stat
file has no aggregate for (stars won, star swings, wall jumps, runs crossed),
the reconstructed per-inning linescore, and the full per-side block the
projector broadcasts. No State/Settings access here.
"""
from server.rio.pyrio.stat_file_parser import StatObj
from server.rio.pyrio.stat_formatters import (
    derive_batting,
    derive_pitching,
    format_batting_line,
    format_pitching_line,
)
from server.rio.pyrio.lookup import LookupDicts, is_captain
from server.rio.pyrio.team_name_algo import team_name
# Single source of truth for the Title-Case stat-file keys → formatter kwargs.
# The stat file's per-character Offensive/Defensive dicts use the same Title-Case
# keys as the HUD file, so the HUD maps apply verbatim.
from server.rio.stats_tracker import _HUD_BATTING_MAP, _HUD_PITCHING_MAP

# Decoded "Result of AB" label → numeric final-result code. Captures read
# the decoded stat file, where the code has been replaced by its label.
_FINAL_RESULT_CODES = {v: k for k, v in LookupDicts.FINAL_RESULT.items()}

# Final-result codes that put a hit in the box score (Single..HR).
HIT_CODES = frozenset((7, 8, 9, 10))


def batting_block(off: dict) -> dict:
    raw = {k: off.get(src, 0) for k, src in _HUD_BATTING_MAP.items()}
    block = dict(raw)
    block.update(derive_batting(**raw))
    block["line"] = format_batting_line(**raw)
    return block


def pitching_block(deff: dict) -> dict:
    raw = {k: deff.get(src, 0) for k, src in _HUD_PITCHING_MAP.items()}
    block = dict(raw)
    block.update(derive_pitching(**raw))
    block["line"] = format_pitching_line(**raw)
    return block


def stars_won(events: list) -> tuple[int, int]:
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
            else _FINAL_RESULT_CODES.get(result, 0)
        if not isinstance(code, int) or code <= 0:
            continue  # at-bat not resolved on this event
        home_batting = ev.get("Half Inning") == 1
        batter_won = code >= 7 or code in (2, 3)
        if batter_won == home_batting:
            home += 1
        else:
            away += 1
    return away, home


def result_code(ev: dict) -> int:
    """Numeric final-result code for an event, 0 when the AB is unresolved."""
    result = ev.get("Result of AB")
    code = result if isinstance(result, int) \
        else _FINAL_RESULT_CODES.get(result, 0)
    return code if isinstance(code, int) and code > 0 else 0


def star_cost(char_name: str, is_team_captain: bool) -> int:
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


def char_event_derived(events: list) -> dict:
    """Per-character counters only the event stream can provide.

    Returns ``{team: {roster_loc: {star_hits, star_swings, wall_jumps,
    sliding_catches, runs}}}`` (team 0=away, 1=home). ``star_hits`` counts
    star swings that resolved the AB as a hit — the successful half of the
    "star hits vs stars spent" pair. ``star_swings`` is the RAW count of
    Star-type swings the character took (fouls included) — the spent half
    is this count times ``star_cost`` (applied in ``side_block``), which
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
            if result_code(ev) in HIT_CODES:
                bump(half, ev.get("Batter Roster Loc"), "star_hits")

        fielder = contact.get("First Fielder") or {}
        action = fielder.get("Fielder Action")
        if action in ("Walljump", "Sliding"):
            key = "wall_jumps" if action == "Walljump" else "sliding_catches"
            bump(1 - half, fielder.get("Fielder Roster Location"), key)
    return out


def linescore(events: list, stat: StatObj) -> tuple[list, list]:
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


def side_totals(stat: StatObj, team_num: int, stars: int) -> dict:
    """Side-level aggregate line for the Game Summary callout."""
    return {
        "runs": stat.score(team_num),  # baseball score IS runs scored
        "hits": stat.hits(team_num),
        "homeruns": stat.homeruns(team_num),
        "stars_won": stars,
        "strikeouts_pitched": stat.strikeoutsPitched(team_num),
    }


def side_block(stat: StatObj, team_num: int, stars: int = 0,
               derived: dict | None = None) -> dict:
    """One team's full box score. ``team_num`` 0=away, 1=home (pyrio's own
    version correction is applied inside StatObj). ``derived`` is this team's
    slice of ``char_event_derived`` (roster_loc → event-derived counters)."""
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
        batting = batting_block(off)
        # Star-swing pair: spent = event-derived raw swing count times the
        # character's per-swing cost (captain-eligible non-captains burn 2
        # — fouls and successful star hits alike); hits = event-derived
        # star swings that landed as hits. Both derive from the same event
        # walk the per-AB chips use, so every surface agrees.
        batting["star_swings"] = (dv.get("star_swings", 0)
                                  * star_cost(char_name, is_team_captain))
        batting["star_hits"] = dv.get("star_hits", 0)
        # Times this character crossed home as a runner (event-derived; no
        # stat-file aggregate exists).
        batting["runs"] = dv.get("runs", 0)
        pitching = None
        if was_pitcher:
            pitching = pitching_block(deff)
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
        "totals": side_totals(stat, team_num, stars),
        "characters": characters,
    }

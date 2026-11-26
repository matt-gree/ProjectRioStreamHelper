"""Per-AB walkthrough for the Character Spotlight (``server/postgame/capture.py``).

Builds the heavy, REST-only payload behind ``PostGame.character_abs``: every
finished plate appearance for one roster character, with the situation before
and after, runner movements, pitch/contact detail, and (for balls in play) the
flight in the hit-renderer's contract shape. Pure functions over a pyrio
``Game`` and its simulated contacts; the scoreboard-keyed caches stay in
``PostGame``.
"""
from __future__ import annotations

from loguru import logger

from pyrio import AtBat, Bases, Contact, Event, Game, MoonshotStatus, Pitch, Side, SwingType
from pyrio.sim import ContactRecord, simulate_contacts


def simulate_game_contacts(game: Game | None, sb: int) -> dict[int, ContactRecord]:
    """``{event index: ContactRecord}`` for a captured game.

    The hit sim re-derives every slap, charge and star swing's flight from its
    recorded RNG — CPU work the caller keeps off the capture path (built
    lazily, cached in ``PostGame._contacts``). Keyed by the event's index in
    ``game.events``: Rio's own event number wraps past 255 on old clients.
    Returns ``{}`` when there is no game or the simulation fails.
    """
    if game is None:
        return {}
    try:
        index = {id(e): i for i, e in enumerate(game.events)}
        return {index[id(c.event)]: c for c in simulate_contacts(game)}
    except Exception:
        logger.exception("[PostGame] sb{} contact simulation failed", sb)
        return {}


def runner_entries(event: Event) -> list[dict]:
    """The play's runner movements: start base → end base (4 = scored, None = out)."""
    return [
        {
            "base": r.start_base,
            "char": r.spot.character.label,
            "resultBase": r.end_base,
            "scored": r.scored,
            "out": r.is_out,
            "steal": r.steal.label,
        }
        for r in event.runners
    ]


def recorded_flight(contact: Contact) -> dict | None:
    """Approximate a ball in play's flight from the contact Rio recorded.

    For contacts the hit sim doesn't fly (bunts): one smooth parabola from the
    contact point through the recorded apex to the recorded landing, over the
    recorded hang time. Not a resimulation, but a real flight beats a blank one.
    Returns None without a hang time to draw over.
    """
    frames = contact.hang_time_frames or 0
    if contact.location is None or frames <= 0:
        return None
    sx, sz = contact.location
    lx, ly, lz = contact.landing_location
    apex, sy = contact.max_height, 0.0
    n = max(frames, 2)
    # Quadratic Bezier control point so the curve passes the recorded apex at mid-flight.
    ctrl_y = 2 * apex - 0.5 * (sy + ly)
    path = []
    for i in range(n + 1):
        t = i / n
        y = (1 - t) ** 2 * sy + 2 * (1 - t) * t * ctrl_y + t ** 2 * ly
        path.append([round(sx + (lx - sx) * t, 3), round(y, 3), round(sz + (lz - sz) * t, 3)])
    return {
        "path": path,
        "landing": path[-1],
        "distance": round((lx ** 2 + lz ** 2) ** 0.5, 2),
        "maxHeight": round(apex, 2),
        "hangTime": frames,
        "power": contact.power or 0,
        "quality": contact.quality,
        "typeName": contact.type.label,
        "fiveStar": contact.moonshot is MoonshotStatus.MOONSHOT,
        "approx": True,  # drawn from recorded points, not resimulated
    }


def charge_pct(pitch: Pitch | None, contact: Contact | None) -> int | None:
    """Charge meter percentage for a charge swing that made contact, else None.

    Undercharged → fill × 100; full → 100; overcharged → 100 + the over-hold
    meter × 100 (max 200). The over-hold only accrues once the fill is full.
    """
    if pitch is None or pitch.swing is not SwingType.CHARGE or contact is None:
        return None
    up, down = contact.charge_power_up, contact.charge_power_down
    return round(up * 100) if up < 1.0 else 100 + round(down * 100)


def _flight(record: ContactRecord) -> dict:
    points = [[round(x, 3), round(y, 3), round(z, 3)] for x, y, z in record.trajectory]
    return {
        "path": points,
        "landing": points[-1] if points else None,
        "distance": round(record.distance, 2),
        "maxHeight": round(record.apex_height, 2),
        "hangTime": record.hang_frames,
        "power": record.power,
        "quality": record.hit.contact_quality,
        "typeName": record.hit.contact_type.label,
        "fiveStar": record.event.is_moonshot,
    }


def character_abs(game: Game, payload: dict, contacts: dict[int, ContactRecord], sb: int,
                  side: int, char_index: int) -> dict:
    """The walkthrough payload for one character (see module docstring).

    ``payload`` is the board's captured payload (``PostGame._ensure_cache``),
    whose ``teamNums`` maps a board side to the game's team (0 away, 1 home);
    ``contacts`` its simulated ``{event index: ContactRecord}`` map. The caller
    has already validated ``side``/``char_index``.
    """
    team_num = (payload.get("teamNums") or {}).get(str(side))
    if team_num is None:
        team_num = 0 if side == 1 else 1
    team_side = Side.AWAY if team_num == 0 else Side.HOME
    side_data = (payload.get("player") or {}).get(str(side)) or {}
    chars = side_data.get("characters") or []
    char = chars[char_index] if char_index < len(chars) else {}
    index = {id(e): i for i, e in enumerate(game.events)}

    def side_pair(away, home) -> dict:
        ours, theirs = (away, home) if team_side is Side.AWAY else (home, away)
        return {str(side): ours, str(3 - side): theirs}

    abs_list = []
    for at_bat in game.at_bats:
        spot = at_bat.batter_spot
        if not at_bat.is_complete or spot.side is not team_side or spot.index != char_index:
            continue
        abs_list.append(_at_bat_record(at_bat, index, contacts, side_pair))

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


def _at_bat_record(at_bat: AtBat, index: dict, contacts: dict, side_pair) -> dict:
    event = at_bat.final
    state, pitch, contact = event.state, event.pitch, event.contact
    batting = state.batting_side
    after = {Side.AWAY: state.away_score, Side.HOME: state.home_score}
    after[batting] += event.runs
    winner = at_bat.star_chance_winner
    swing = pitch.swing.label if pitch is not None else None
    file_index = index[id(event)]
    record = contacts.get(file_index)
    return {
        "eventNum": file_index,
        "inning": state.inning,
        "halfInning": 0 if batting is Side.AWAY else 1,
        "result": event.result.label,
        "resultCode": event.result.id,
        "isHit": event.is_hit,
        "fieldersChoice": event.is_fielders_choice,
        "rbi": event.rbi,
        "outsAdded": event.outs_during_play or 0,
        "pitcher": event.pitcher.label,
        "swing": swing,
        # Stars the batter spent across the whole plate appearance, foul star
        # swings included, at the character's cost per swing.
        "starsUsed": sum(e.is_star_swing for e in at_bat.events) * at_bat.batter_spot.star_swing_cost,
        "swingInfo": {"type": swing, "chargePct": charge_pct(pitch, contact)},
        # The featured batter is always on the batting side here.
        "starChanceOutcome": None if winner is None else ("won" if winner is batting else "lost"),
        "pitch": {
            "type": pitch.type.label if pitch else None,
            "speed": pitch.speed if pitch else None,
            "chargeType": pitch.charge_type.label if pitch else None,
            "starPitch": event.is_star_pitch,
        },
        "before": {
            "outs": state.outs,
            "balls": state.balls,
            "strikes": state.strikes,
            "runners": {
                str(n): base in state.bases
                for n, base in ((1, Bases.FIRST), (2, Bases.SECOND), (3, Bases.THIRD))
            },
            "score": side_pair(state.away_score, state.home_score),
            "stars": side_pair(state.away_stars, state.home_stars),
            "starChance": state.is_star_chance,
        },
        "after": {
            "score": side_pair(after[Side.AWAY], after[Side.HOME]),
            "outs": state.outs + (event.outs_during_play or 0),
        },
        "runners": runner_entries(event),
        "contact": (
            _flight(record) if record is not None
            else recorded_flight(contact) if contact is not None
            else None
        ),
        "fielder": None if event.fielding is None else {
            "character": event.fielding.spot.character.label,
            "position": event.fielding.position.label if event.fielding.position else None,
            "action": event.fielding.action.label if event.fielding.action else None,
            "bobble": event.fielding.bobble.label,
        },
    }

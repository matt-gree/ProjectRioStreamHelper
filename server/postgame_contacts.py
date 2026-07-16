"""Per-AB walkthrough for the Character Spotlight (``server/postgame.py``).

Builds the heavy, REST-only payload behind ``PostGame.character_abs``: every
resolved plate appearance for one roster character, enriched with
before/after game situation, runner movements, pitch/contact detail, and (for
balls in play) the exact re-simulated flight in the hit-renderer's contract
shape. Pure functions over a captured payload + simulated contacts; the
scoreboard-keyed caches stay in ``PostGame``.
"""
from loguru import logger

from server.postgame_stats import HIT_CODES, result_code, star_cost
from server.rio.pyrio.stat_file_parser import StatObj


def simulate_game_contacts(stat: StatObj | None, sb: int) -> dict:
    """``{event_num: ContactRecord}`` for a captured game's StatObj.

    The hit sim re-derives every contact's exact flight from its recorded RNG
    — CPU work the caller keeps off the capture path (built lazily, cached in
    ``PostGame._contacts``). Returns ``{}`` when there is no StatObj or the
    simulation fails.
    """
    if stat is None:
        return {}
    try:
        from server.rio.pyrio.hit_simulator.hit_analysis import simulate_contacts
        return {c.event_num: c for c in simulate_contacts(stat)}
    except Exception:
        logger.exception("[PostGame] sb{} contact simulation failed", sb)
        return {}


def runner_entries(ev: dict) -> list[dict]:
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


def is_fielders_choice(ev: dict, code: int) -> bool:
    """True when a contact-out event ("Result of AB" code 4, the generic
    "Out" bucket — see ``LookupDicts.FINAL_RESULT``) is actually a
    fielder's choice: the batter reached base safely while the defense
    recorded an out on a *different* runner. Rio's own "Result of AB"
    label conflates this with a plain contact out (both say "Out"), so we
    derive the distinction from the runner blocks instead.

    Additive classification only — ``resultCode`` stays 4 either way
    (``result_code`` is untouched); this is a bolt-on flag the mount
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


def fallback_flight(contact: dict) -> dict | None:
    """Approximate a ball-in-play's flight straight from the stat file's
    own recorded contact fields, for plays pyrio's swing-physics
    resimulator can't reproduce.

    ``simulate_game_contacts`` re-derives every contact's exact trajectory by
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


def charge_pct(pitch: dict) -> int | None:
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


def character_abs(payload: dict, contacts: dict, sb: int, side: int,
                  char_index: int) -> dict:
    """The walkthrough payload for one character (see module docstring).

    ``payload`` is the board's captured payload (``PostGame._ensure_cache``);
    ``contacts`` its simulated ``{event_num: ContactRecord}`` map. The caller
    has already validated ``side``/``char_index``.
    """
    team_num = (payload.get("teamNums") or {}).get(str(side))
    if team_num is None:
        # Pre-teamNums capture (shouldn't happen — cache and capture ship
        # together) — fall back to away=side1.
        team_num = 0 if side == 1 else 1
    side_data = (payload.get("player") or {}).get(str(side)) or {}
    chars = side_data.get("characters") or []
    char = chars[char_index] if char_index < len(chars) else {}

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
    cost = star_cost(char.get("name", ""), bool(char.get("isCaptain")))
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

        code = result_code(ev)
        if not code:
            continue
        stars_used = pa_stars * cost
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
            "isHit": code in HIT_CODES,
            # Additive — see is_fielders_choice. resultCode/result stay
            # whatever Rio recorded ("Out"); this just tells the mount to
            # relabel the stamp/chip without renumbering codes.
            "fieldersChoice": is_fielders_choice(ev, code),
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
                "chargePct": charge_pct(pitch),
            },
            # Featured batter's team won/lost the Star Chance star, same
            # resolution rule as stars_won (the batter is always on the
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
            "runners": runner_entries(ev),
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
            # of leaving the play with no animation. See fallback_flight.
            rec["contact"] = fallback_flight(pitch["Contact"])
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

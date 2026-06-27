"""Turn a HUD contact event into a RioVisualizer flight, for State.

The Project Rio HUD file records the last completed contact under
``Previous Event -> Pitch -> Contact`` (inputs AND the game's measured outputs).
``HudWatcher`` extracts that into the flat game dict as ``game["contact"]``;
this module maps it onto ``rio_visualizer.api.simulate`` kwargs, pins the real
flight with the HUD's recorded angles/power, self-validates the simulated arc
against the HUD's recorded landing/height/hangtime, and returns the
``score.{N}.hit.*`` payload the overlay renders.

Names follow pyrio (the canonical source); RioVisualizer was conformed to match,
so HUD char-id ints/names pass straight through with no translation map.
"""
import math

from loguru import logger

from server.rio.pyrio.lookup import LookupDicts
from rio_visualizer.api import simulate

# pyrio name -> id, for resolving HUD roster/pitcher names (HUD stores names).
_NAME_TO_ID = {
    v: k for k, v in LookupDicts.CHAR_NAME.items()
    if isinstance(k, int) and isinstance(v, str)
}

# Validation tolerances. Generous on purpose — these only flag a gross
# divergence between the simulated arc and what the game actually recorded.
# A correct pin lands within ~1m (measured on real contacts).
_TOL_LANDING_M = 3.0
_TOL_MAXHEIGHT_M = 3.0
_TOL_HANGTIME_FRAMES = 20


def _i(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _cid(v):
    """Resolve a char value (int id or pyrio name) to an int id, or None."""
    if isinstance(v, int):
        return v
    return _NAME_TO_ID.get(v)


def build_hit(game: dict) -> dict | None:
    """Build the ``hit`` payload from a flat HUD game dict, or None.

    Returns None when there is no batted-ball contact to render. The returned
    dict carries a private ``_sig`` the caller uses to dedupe repeat HUD frames
    of the same contact; the caller assigns the retrigger ``id``.
    """
    c = game.get("contact")
    if not c:
        return None

    power = _i(c.get("ball_power"))
    if power is None:
        return None  # no batted ball (swing-and-miss / take / walk)

    # Batting team = the team NOT pitching. Using the contact's own
    # Pitcher Team Id + Runner Batter roster loc avoids the half-inning-flip
    # problem (current game state may have advanced past this at-bat).
    pitcher_team = _i(c.get("pitcher_team_id"))
    if pitcher_team is None:
        return None
    team = "away" if (1 - pitcher_team) == 0 else "home"

    slot = _i(c.get("batter_roster_loc"))
    if slot is None or not (0 <= slot < 9):
        return None
    batter_id = _cid(game.get(f"{team}_roster_{slot}_char"))
    if batter_id is None:
        batter_id = _cid(c.get("batter_char"))
    handedness = _i(game.get(f"{team}_roster_{slot}_batting_hand")) or 0
    pitcher_id = _cid(c.get("pitcher_char")) or 0

    rng = c.get("rng") or [None, None, None]
    kwargs = {
        "batter_id": batter_id if batter_id is not None else 0,
        "pitcher_id": pitcher_id,
        "handedness": handedness,
        "ball_x": _f(c.get("ball_x")) or 0.0,
        "ball_z": _f(c.get("ball_z")) or 0.0,
        "charge_up": _f(c.get("charge_up")) or 0.0,
        "charge_down": _f(c.get("charge_down")) or 0.0,
        "frame": _i(c.get("frame")) or 0,
        "rand_1": _i(rng[0]) or 0,
        "rand_2": _i(rng[1]) or 0,
        "rand_3": _i(rng[2]) or 0,
        "hit_type": 1 if c.get("type_of_swing") == "Charge" else 0,
        # Pin the actual flight: the HUD's recorded angles/power are applied
        # after the calc's RNG step, so the arc reproduces what happened.
        # override_vertical_range forces simulate() to return exactly one path.
        "override_vertical_angle": _i(c.get("vert_angle")),
        "override_horizontal_angle": _i(c.get("horiz_angle")),
        "override_power": power,
        "override_vertical_range": 0,
    }
    kwargs = {k: v for k, v in kwargs.items() if v is not None}

    res = simulate(kwargs)
    paths = res.get("paths") or []
    if not paths:
        logger.warning(f"[hit_visualizer] sim produced no path: {res.get('errors')}")
        return None

    points = [[round(x, 3), round(y, 3), round(z, 3)] for x, y, z in paths[0]["points"]]
    final = points[-1]
    max_height = max((p[1] for p in points), default=0.0)
    distance = math.hypot(final[0], final[2])
    hang_frames = len(points)

    # Trust the sim (always push it), but flag a gross divergence from the HUD.
    valid, warnings = True, []
    hud_land = [_f(x) for x in (c.get("landing") or [None, None, None])]
    if hud_land[0] is not None and hud_land[2] is not None:
        d = math.hypot(final[0] - hud_land[0], final[2] - hud_land[2])
        if d > _TOL_LANDING_M:
            valid = False
            warnings.append(f"landing off by {d:.1f}m")
    hud_maxh = _f(c.get("max_height"))
    if hud_maxh is not None and abs(max_height - hud_maxh) > _TOL_MAXHEIGHT_M:
        valid = False
        warnings.append(f"max height off by {abs(max_height - hud_maxh):.1f}m")
    hud_hang = _i(c.get("hang_time"))
    if hud_hang is not None and abs(hang_frames - hud_hang) > _TOL_HANGTIME_FRAMES:
        valid = False
        warnings.append(f"hang time off by {abs(hang_frames - hud_hang)} frames")
    warning = "; ".join(warnings)
    if warning:
        logger.warning(f"[hit_visualizer] sim diverges from HUD: {warning}")

    return {
        "path": points,
        "landing": final,
        "distance": round(distance, 2),
        "maxHeight": round(max_height, 2),
        "hangTime": hang_frames,
        "stadium": game.get("stadium_id") or "",
        "batter": c.get("batter_char") or LookupDicts.CHAR_NAME.get(batter_id, ""),
        "result": c.get("result_secondary") or c.get("result_of_ab") or "",
        "resultPrimary": c.get("result_primary") or "",
        "valid": valid,
        "warning": warning,
        "_sig": (
            kwargs.get("rand_1"), kwargs.get("rand_2"), kwargs.get("rand_3"),
            power, kwargs.get("override_vertical_angle"),
            kwargs.get("override_horizontal_angle"),
        ),
    }

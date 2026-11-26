"""The flight of the play a HUD frame reports, for the hit-visualizer overlay.

A play-over HUD frame carries the whole event (``HUDSnapshot.play``), contact
included. pyrio rebuilds the swing from it (``HitInputs.from_event``) and flies
it with the recorded angles and power pinned (``HitOverrides.from_contact``),
so the arc is the one that happened. The result is the ``score.{N}.hit.*``
payload the overlay renders.
"""
from __future__ import annotations

from dataclasses import replace

from loguru import logger

from pyrio import Event, Stadium
from pyrio.sim import HitInputs, HitOverrides, simulate_hit

# Flagging tolerances. Rio's recorded landing is where the ball was first
# touched (a glove, the stands), not where it would have come down, so the
# flight is checked against the recorded hang time and height instead.
_TOL_MAXHEIGHT = 3.0
_TOL_HANGTIME_FRAMES = 20


def build_hit(play: Event, stadium: Stadium) -> dict | None:
    """The ``hit`` payload for a play, or None when no ball was put in play.

    The payload's ``sig`` is the contact's recorded RNG, angles and power, so a
    caller can tell the same contact read twice from a new one.
    """
    contact = play.contact
    if contact is None or contact.power is None:
        return None
    try:
        inputs = HitInputs.from_event(play, stadium=stadium)
        hit = simulate_hit(replace(inputs, overrides=HitOverrides.from_contact(contact)))
    except ValueError as err:  # a bunt, or inputs the sim can't reach
        logger.info(f"[hit_visualizer] not simulated: {err}")
        return None

    points = [[round(x, 3), round(y, 3), round(z, 3)] for x, y, z in hit.trajectory]
    warnings = []
    if abs(hit.apex_height - contact.max_height) > _TOL_MAXHEIGHT:
        warnings.append(f"max height off by {abs(hit.apex_height - contact.max_height):.1f}m")
    hang = contact.hang_time_frames
    if hang is not None and abs(hit.hang_frames - hang) > _TOL_HANGTIME_FRAMES:
        warnings.append(f"hang time off by {abs(hit.hang_frames - hang)} frames")
    warning = "; ".join(warnings)
    if warning:
        logger.warning(f"[hit_visualizer] sim diverges from HUD: {warning}")

    return {
        "path": points,
        "landing": points[-1],
        "distance": round(hit.distance, 2),
        "maxHeight": round(hit.apex_height, 2),
        "hangTime": hit.hang_frames,
        "stadium": stadium.label,
        "batter": play.batter.label,
        "result": contact.secondary_result.label,
        "resultPrimary": contact.primary_result.label,
        "valid": not warnings,
        "warning": warning,
        "sig": [*(contact.rng or ()), contact.power, contact.vertical_angle, contact.horizontal_angle],
    }

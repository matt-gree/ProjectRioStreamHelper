"""The live hit overlay: HUD contact → RioVisualizer flight
(``server/rio/hud_watcher.py`` + ``server/rio/hit_visualizer.py``).

``simulate()`` reports a failure in ``errors`` and returns no paths, so a broken
pyrio/RioVisualizer pairing only shows up as a hit with no flight.
"""
import json
from pathlib import Path

from server.rio.hit_visualizer import build_hit
from server.rio.hud_watcher import HudWatcher

HUD_DATA = Path(__file__).parents[1] / "data" / "hud"


def game_from_hud(hud: dict) -> dict:
    """The flat game dict build_hit reads, from a raw HUD file."""
    game = {"contact": HudWatcher._extract_contact(hud)}
    for team, label in (("away", "Away"), ("home", "Home")):
        for slot in range(9):
            roster = hud[f"{label} Roster {slot}"]
            game[f"{team}_roster_{slot}_char"] = roster["CharID"]
            game[f"{team}_roster_{slot}_batting_hand"] = int(roster["Batting Hand"] == "Left")
    return game


def test_a_recorded_hud_contact_draws_a_flight():
    hud = json.loads((HUD_DATA / "game1_mid.json").read_text(encoding="utf-8"))
    hit = build_hit(game_from_hud(hud))
    assert hit is not None and hit["path"]

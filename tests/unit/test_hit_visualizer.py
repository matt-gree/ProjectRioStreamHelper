"""The live hit overlay: HUD contact → RioVisualizer flight
(``server/rio/hud_watcher.py`` + ``server/rio/hit_visualizer.py``).

``simulate()`` reports a failure in ``errors`` and returns no paths, so a broken
pyrio/RioVisualizer pairing only shows up as a hit with no flight.
"""
import json
from pathlib import Path

import pytest

from server.rio import hit_visualizer
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


def resolved_frame(batter, swing, batter_x=0.0, hand="Right", contact=None):
    """A "…b" HUD frame's parts: ``Previous Event`` is the contact's own event,
    so ``Runner Batter`` is the batter who made it."""
    hud = {
        "Runner Batter": {"Runner Roster Loc": 0, "Runner Char Id": batter},
        "Previous Event": {"Result of AB": "Single", "Pitch": {
            "Pitcher Team Id": 1, "Pitcher Char Id": "Goomba", "Type of Swing": swing,
            "Bat Contact Pos - X": batter_x, "Contact": {"Ball Power": "100", **(contact or {})},
        }},
    }
    game = {"contact": HudWatcher._extract_contact(hud), "away_roster_0_char": batter,
            "away_roster_0_batting_hand": int(hand == "Left")}
    return game


# Real failed Moonshots from Project Rio 2.3.0. The HUD writes the same fields.
MONTY = dict(batter="Monty", swing="Star", batter_x=0.534028, hand="Left", contact={
    "Star Swing Five-Star": "Failed Moonshot", "Charge Power Up": 0, "Charge Power Down": 0,
    "Frame of Swing Upon Contact": "8", "Ball Power": "111", "Vert Angle": "513",
    "Horiz Angle": "711", "RNG1": "32,113", "RNG2": "11,571", "RNG3": "302",
    "Ball Contact Pos - X": 0.0861414, "Ball Contact Pos - Z": 1.4,
    "Ball Landing Position - X": 21.6392, "Ball Landing Position - Y": 1.12551,
    "Ball Landing Position - Z": 38.0282, "Ball Hang Time": "153", "Ball Max Height": 14.182,
})
YOSHI = dict(batter="Yoshi", swing="Star", batter_x=-0.0333333, hand="Left", contact={
    "Star Swing Five-Star": "Failed Moonshot", "Charge Power Up": 0, "Charge Power Down": 0,
    "Frame of Swing Upon Contact": "9", "Ball Power": "103", "Vert Angle": "368",
    "Horiz Angle": "506", "RNG1": "9,418", "RNG2": "11,437", "RNG3": "316",
    "Ball Contact Pos - X": -0.300253, "Ball Contact Pos - Z": 1.5,
    "Ball Landing Position - X": 17.4881, "Ball Landing Position - Y": 0.324979,
    "Ball Landing Position - Z": 16.1706, "Ball Hang Time": "61", "Ball Max Height": 4.84347,
})


@pytest.mark.parametrize("frame, hang", [(MONTY, 153), (YOSHI, 61)])
def test_a_failed_moonshot_flies_as_recorded(frame, hang):
    hit = build_hit(resolved_frame(**frame))
    assert hit["valid"], hit["warning"]
    assert abs(hit["hangTime"] - hang) <= 3


def test_a_contact_needs_the_real_batter_position():
    # A recorded slap, off the plate. With the batter at 0, the simulator reads
    # the swing as missing the ball and there's no flight.
    frame = dict(batter="Shy Guy(Bk)", swing="Slap", batter_x=0.65, hand="Left", contact={
        "Charge Power Up": 0, "Charge Power Down": 0, "Frame of Swing Upon Contact": "4",
        "Ball Power": "123", "Vert Angle": "170", "Horiz Angle": "1,461",
        "RNG1": "20,413", "RNG2": "17,904", "RNG3": "268",
        "Ball Contact Pos - X": 0.314764, "Ball Contact Pos - Z": 0.461111,
    })
    assert build_hit(resolved_frame(**frame))["hangTime"] == 87
    assert build_hit(resolved_frame(**{**frame, "batter_x": 0.0})) is None


@pytest.fixture
def sent_to_simulate(monkeypatch):
    sent = {}

    def fake_simulate(kwargs):
        sent.update(kwargs)
        return {"paths": [{"points": [(0.0, 0.0, 0.0), (1.0, 1.0, 1.0)]}]}

    monkeypatch.setattr(hit_visualizer, "simulate", fake_simulate)
    return sent


@pytest.mark.parametrize("swing, hit_type", [
    ("Slap", 0), ("Charge", 1), ("Star", 0),
    ("Bunt", hit_visualizer.BUNT), ("None", hit_visualizer.BUNT),
])
def test_swing_type_reaches_the_simulator(sent_to_simulate, swing, hit_type):
    build_hit(resolved_frame("Mario", swing))
    assert sent_to_simulate["hit_type"] == hit_type
    assert sent_to_simulate["is_star_hit"] is (swing == "Star")


@pytest.mark.parametrize("value, attempt", [
    (0, False), (1, True), (2, True),
    ("None", False), ("Moonshot", True), ("Failed Moonshot", True),
])
def test_moonshot_attempt_reads_numbers_and_labels(sent_to_simulate, value, attempt):
    build_hit(resolved_frame("Monty", "Star", contact={"Star Swing Five-Star": value}))
    assert sent_to_simulate["five_star_attempt"] is attempt


def test_hud_numbers_with_commas_keep_their_value(sent_to_simulate):
    build_hit(resolved_frame("Mario", "Slap", contact={
        "RNG1": "31,256", "Horiz Angle": "1,336", "Ball Power": "1,024"}))
    assert sent_to_simulate["rand_1"] == 31256
    assert sent_to_simulate["override_horizontal_angle"] == 1336
    assert sent_to_simulate["override_power"] == 1024


def test_superstar_status_reaches_the_simulator(sent_to_simulate):
    game = resolved_frame("Mario", "Slap")
    game["away_roster_0_is_starred"] = True
    build_hit(game)
    assert sent_to_simulate["is_starred"] is True

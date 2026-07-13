"""Replay-fixture validity: every capture in tests/data/hud/ must survive the
real HUD pipeline (HudObj → HudWatcher flat dict → provider.parse_game_data).

These fixtures are what scripts/replay-hud.py feeds an isolated server, so a
fixture that stops parsing would silently break the agent replay harness. The
sequence encodes: game1 start → game1 late frame → game2 start (sides swapped,
new GameID) — the inning drop between frames 2 and 3 is what new-game
detection keys on.
"""
import orjson
from pathlib import Path

import pytest

from server.rio.hud_watcher import HudWatcher
from server.rio.provider import RioGameDataProvider
from server.rio.pyrio.stat_file_parser import HudObj

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "data" / "hud"


def _parse(name: str) -> dict:
    raw = orjson.loads((FIXTURE_DIR / f"{name}.json").read_bytes())
    flat = HudWatcher._convert_hud_data_format(HudObj(raw))
    return RioGameDataProvider.parse_game_data(flat)


def test_fixture_dir_has_the_replay_sequence():
    names = {p.stem for p in FIXTURE_DIR.glob("*.json")}
    assert {"game1_start", "game1_mid", "game2_start"} <= names


@pytest.mark.parametrize("name", ["game1_start", "game1_mid", "game2_start"])
def test_fixture_parses_through_real_pipeline(name):
    parsed = _parse(name)
    entrants = parsed["entrants"]
    assert entrants[0][0]["rioName"] and entrants[1][0]["rioName"]
    assert len(entrants[0][0]["roster"]) == 9
    assert parsed["inning"] >= 1


def test_game1_frames_are_one_game():
    start, mid = _parse("game1_start"), _parse("game1_mid")
    assert start["game_id"] == mid["game_id"]
    assert start["inning"] == 1
    assert (start["team1score"], start["team2score"]) == (0, 0)
    assert mid["inning"] > start["inning"]
    assert start["entrants"][0][0]["rioName"] == mid["entrants"][0][0]["rioName"]


def test_game2_is_a_new_game_with_swapped_sides():
    mid, g2 = _parse("game1_mid"), _parse("game2_start")
    assert g2["game_id"] != mid["game_id"]
    # inning drops 9 → 1 across the replay boundary: new-game detection fires
    assert g2["inning"] < mid["inning"]
    # the same two players arrive on opposite HUD sides → exercises the
    # back-to-back layer of the side cascade
    assert g2["entrants"][0][0]["rioName"] == mid["entrants"][1][0]["rioName"]
    assert g2["entrants"][1][0]["rioName"] == mid["entrants"][0][0]["rioName"]

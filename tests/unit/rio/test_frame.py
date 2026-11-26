"""Frames: pyrio's HUDSnapshot / LiveGame laid out as the board pipeline reads them."""
import json
from pathlib import Path

import httpx
import pytest

import pyrio
from pyrio.web import AsyncRioClient

from server.postgame import files as postgame_files
from server.rio import hud_watcher
from server.rio.frame import frame_from_hud, frame_from_live
from server.rio.provider import RioGameDataProvider as P
from tests.stat_file import write_stat_file

PYRIO_FIXTURES = Path(__file__).resolve().parents[3] / "server" / "rio" / "pyrio" / "tests" / "fixtures"


def _hud():
    # The last frame Rio wrote for pyrio's fixture game: a double play that ends it.
    return pyrio.read_hud(PYRIO_FIXTURES / "hud.json", version="2.2.0")


def test_a_play_over_frame_reports_its_play_and_the_game_over():
    frame = frame_from_hud(_hud())
    assert frame["event_num"] == "210b"
    assert frame["play"] == {"event": "210b", "result": "Caught line-drive", "rbi": 0,
                             "runs": 0, "star": False}
    assert frame["game_over"] is True
    assert (frame["away_score"], frame["home_score"]) == (9, 12)


def test_the_frame_parses_into_a_board():
    parsed = P.parse_game_data(frame_from_hud(_hud()))
    away, home = parsed["entrants"][0][0], parsed["entrants"][1][0]
    assert away["rioName"] == "SpiceOrange" and home["rioName"] == "MattGree"
    assert parsed["field"]["P"] == parsed["pitcher"] != ""
    assert away["msb_team"] and home["msb_team"]
    assert parsed["half_inning"] == "Top"


def test_the_play_carries_its_flight():
    hit = frame_from_hud(_hud())["hit"]
    assert hit["path"] and hit["hangTime"] > 0
    assert hit["result"] and hit["sig"]
    assert hit["valid"], hit["warning"]


def test_a_pitch_frame_has_no_play_and_no_hit():
    data = json.loads((PYRIO_FIXTURES / "hud.json").read_text())
    data["Event Num"] = "211"
    frame = frame_from_hud(pyrio.read_hud(data, version="2.2.0"))
    assert frame["play"] is None and frame["hit"] is None and frame["game_over"] is False


async def test_a_live_game_becomes_the_same_frame_shape():
    body = json.loads((PYRIO_FIXTURES / "web" / "ongoing_games.json").read_text())
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))
    async with AsyncRioClient(http_client=httpx.AsyncClient(transport=transport)) as rio:
        (live,) = await rio.live_games()
    frame = frame_from_live(live)
    hud_keys = set(frame_from_hud(_hud()))
    # Every key the board reads off a HUD frame, bar the HUD-only per-character lines.
    missing = {k for k in hud_keys - set(frame) if not k.endswith(("_batting", "_pitching"))}
    assert missing == {"game_id", "event_num"}
    parsed = P.parse_game_data(frame)
    assert parsed["entrants"][1][0]["roster"][0] == "Mario"
    assert parsed["runner1Name"] and parsed["runner3Name"] and not parsed["runner2Name"]
    json.dumps(frame)   # the pool broadcasts it as-is


def test_client_version_comes_from_the_newest_stat_file(tmp_path, monkeypatch):
    folder = tmp_path / "StatFiles" / "MarioSuperstarBaseball"
    folder.mkdir(parents=True)
    write_stat_file(folder / "decoded.a_1.json", Version="2.1.1")
    monkeypatch.setattr(postgame_files, "stat_dir", lambda: folder)
    monkeypatch.setattr(hud_watcher, "_version_cache", {"key": None, "version": hud_watcher.DEFAULT_CLIENT_VERSION})
    assert hud_watcher.client_version() == pyrio.Version(2, 1, 1)


def test_client_version_defaults_without_stat_files(tmp_path, monkeypatch):
    monkeypatch.setattr(postgame_files, "stat_dir", lambda: tmp_path / "missing")
    monkeypatch.setattr(hud_watcher, "_version_cache", {"key": None, "version": hud_watcher.DEFAULT_CLIENT_VERSION})
    assert hud_watcher.client_version() == hud_watcher.DEFAULT_CLIENT_VERSION


@pytest.mark.parametrize(("token", "game_id", "matches"), [
    ("153176676", "153176676", True),              # decimal, before 2.3.0
    ("9f3c2a1b5d7e4f60", str(0x9F3C2A1B5D7E4F60), True),   # hex, from 2.3.0
    ("42", "66", True),                             # a hex-reading of digits: pre-filter only
    ("42", "43", False),
])
def test_stat_file_names_match_decimal_and_hex_ids(token, game_id, matches):
    assert postgame_files._filename_matches(token, game_id) is matches

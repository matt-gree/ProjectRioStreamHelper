"""A side's controller PORT belongs to the player on that side, whatever seated
them there.

The Controller element draws `score.{N}.player.{T}.port`, so a port that stayed
behind while the cascade moved its player would put one player's pad under the
other's name — reported from a stream where the producer had pinned themselves
to side 2 and then spectated two other players. These run the real pipeline
(HUD file → HudWatcher → provider → State) over the replay fixtures, where
`rjb` is Away on port 0 and `MattGree` Home on port 1 in game 1 and the two
change ends in game 2.
"""
import orjson
from pathlib import Path

import pytest

from server.rio.hud_watcher import HudWatcher
from server.rio.provider import RioGameDataProvider as P
from server.rio.pyrio.stat_file_parser import HudObj
from server.state import State
from server.utils.deep_dict import deep_get

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "tests" / "data" / "hud"


def _frame(name: str) -> dict:
    raw = orjson.loads((FIXTURE_DIR / f"{name}.json").read_bytes())
    return HudWatcher._convert_hud_data_format(HudObj(raw))


def _ports_by_player(raw_name: str) -> dict:
    raw = orjson.loads((FIXTURE_DIR / f"{raw_name}.json").read_bytes())
    return {raw["Away Player"]: raw["Away Port"], raw["Home Player"]: raw["Home Port"]}


def _board() -> dict:
    return {deep_get(State.state, f"score.1.player.{t}.rioName"):
            (t, deep_get(State.state, f"score.1.player.{t}.port")) for t in (1, 2)}


@pytest.fixture
def hud_board(monkeypatch):
    monkeypatch.setattr(P, "_hud_targets", [1])

    async def _noop(*a, **k):
        return None
    # Stats and the hit visualizer are not what is under test, and both reach
    # for the network or the stats tables.
    from server.rio.stats_tracker import StatsTracker
    monkeypatch.setattr(StatsTracker, "on_new_game", _noop)
    monkeypatch.setattr(StatsTracker, "push_stats_to_state", _noop)
    monkeypatch.setattr(P, "_apply_hud_game_mode", classmethod(lambda cls, *a, **k: _noop()))


@pytest.mark.parametrize("frame", ["game1_start", "game2_start"])
@pytest.mark.parametrize("side", [1, 2, None])
async def test_the_port_moves_with_its_player(mock_socket, hud_board, pin_player, frame, side):
    if side is not None:
        pin_player("MattGree", side=side)
    await P._on_hud_game_update_impl(_frame(frame))

    board = _board()
    want = _ports_by_player(frame)
    if side is not None:
        assert board["MattGree"][0] == side
    for player, port in want.items():
        assert board[player][1] == port, f"{player} drew port {board[player][1]}, plays on {port}"


async def test_a_hand_swap_moves_ports_with_names(mock_socket, hud_board, pin_player):
    pin_player("MattGree", side=2)
    await P._on_hud_game_update_impl(_frame("game1_start"))
    await P.toggle_sides_swapped()

    board = _board()
    assert board["MattGree"][0] == 1
    for player, port in _ports_by_player("game1_start").items():
        assert board[player][1] == port

"""The capture freezes the game's mode by name (postgame.{N}.meta.gameMode) —
the Game Summary's top pill reads it, so a summary shown after the board has
moved on still names the mode THIS game was played under.

Resolution is cache-only: a capture runs under the post-game lock, and an
unreachable Rio API must not hold it. Unknown → '', and the overlay falls back
to the board's own mode."""
import pyrio
import pytest

from server.postgame import PostGame
from server.rio import stats_api
from tests.stat_file import stat_file_json, write_stat_file


@pytest.fixture
def stub_stats():
    """The capture's own shaping is real here; only the mode cache is stubbed."""


def _payload(tag_set_id):
    game = pyrio.read_game(stat_file_json(GameID="42", TagSetID=tag_set_id))
    return PostGame._build_payload(("", ""), game, "decoded.Game_42.json")


def test_capture_names_the_mode_from_the_cached_tag_set(monkeypatch, stub_stats):
    monkeypatch.setattr(stats_api, "_game_modes", {"NNLSeason9": 198, "Ranked": 7})
    meta = _payload(198)["meta"]
    assert meta["tagSetId"] == 198
    assert meta["gameMode"] == "NNLSeason9"


@pytest.mark.parametrize("tag_set_id", [None, -1, 555])
def test_an_unresolvable_mode_is_blank_rather_than_a_placeholder(monkeypatch, stub_stats, tag_set_id):
    monkeypatch.setattr(stats_api, "_game_modes", {"Ranked": 7})
    assert _payload(tag_set_id)["meta"]["gameMode"] == ""


def test_a_cold_mode_cache_never_goes_to_the_network(monkeypatch, stub_stats):
    monkeypatch.setattr(stats_api, "_game_modes", {})
    monkeypatch.setattr(stats_api, "fetch_game_modes", lambda: (_ for _ in ()).throw(
        AssertionError("capture fetched the mode list")))
    assert _payload(198)["meta"]["gameMode"] == ""


@pytest.mark.asyncio
async def test_a_rebuilt_capture_is_oriented_by_the_capture_not_the_board(
    tmp_path, monkeypatch, stub_stats,
):
    """After a restart the cache is re-parsed from the stat file. The board may
    hold the next game by then; orienting against it fell back to away = side 1
    while the persisted projection had Bob (home) on side 1, so the Spotlight
    walked Alice's at-bats under a character picked from Bob's list."""
    from server.postgame import files as postgame_files
    from server.state import State

    write_stat_file(tmp_path / "decoded.Game_42.json", GameID="42",
                    **{"Away Player": "Alice", "Home Player": "Bob"})
    monkeypatch.setattr(postgame_files, "stat_dir", lambda: tmp_path)

    await State.SetBatch([
        ("postgame.1", {
            "present": True, "sourceFile": "decoded.Game_42.json",
            "capturedAt": "2026-09-18T22:00:00+00:00", "capturedBy": "auto",
            # Captured with Bob — the file's HOME player — on side 1.
            "player": {"1": {"rioName": "Bob"}, "2": {"rioName": "Alice"}},
        }),
        # The board has since moved on to other players entirely.
        ("score.1.player.1.rioName", "Cara"),
        ("score.1.player.2.rioName", "Dev"),
    ])
    PostGame._captured.pop(1, None)

    payload = PostGame.get_payload(1)

    assert payload["teamNums"] == {"1": 1, "2": 0}
    assert payload["capturedAt"] == "2026-09-18T22:00:00+00:00"
    assert payload["capturedBy"] == "auto"

"""The capture freezes the game's mode by name (postgame.{N}.meta.gameMode) —
the Game Summary's top pill reads it, so a summary shown after the board has
moved on still names the mode THIS game was played under.

Resolution is cache-only: a capture runs under the post-game lock, and an
unreachable Rio API must not hold it. Unknown → '', and the overlay falls back
to the board's own mode."""
import pytest

from server.postgame import stats as postgame_stats
from server.postgame import PostGame
from server.rio import stats_api


class _StubStat:
    def player(self, i): return ("Alice", "Bob")[i]
    def stadium(self): return "Mario Stadium"
    def inningsSelected(self): return 9
    def inningsPlayed(self): return 9
    def isMercy(self): return False
    def wasQuit(self): return False
    def quitter(self): return ""
    def version(self): return "2.2.0"
    def winning_team(self): return 0


@pytest.fixture
def stub_stats(monkeypatch):
    monkeypatch.setattr(postgame_stats, "stars_won", lambda events: (0, 0))
    monkeypatch.setattr(postgame_stats, "linescore", lambda events, stat: ([], []))
    monkeypatch.setattr(postgame_stats, "char_event_derived", lambda events: {0: {}, 1: {}})
    monkeypatch.setattr(postgame_stats, "side_block", lambda stat, t, stars, derived: {})


def _payload(tag_set_id):
    data = {"GameID": "42", "TagSetID": tag_set_id, "Events": []}
    return PostGame._build_payload(("", ""), _StubStat(), data, "decoded.Game_42.json")


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
    import server.postgame.capture as pg_mod
    from server.state import State

    (tmp_path / "decoded.Game_42.json").write_text("{}")
    monkeypatch.setattr(postgame_files, "stat_dir", lambda: tmp_path)
    monkeypatch.setattr(postgame_files, "load_json",
                        lambda path: {"GameID": "42", "Events": []})
    monkeypatch.setattr(pg_mod, "StatObj", lambda data: _StubStat())

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

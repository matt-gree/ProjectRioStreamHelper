"""/scoreboards API — board CRUD, binding mode switches, and the reset hatch.

In-process via TestClient (same harness as test_api.py). These pin the board
lifecycle contracts the Match tab and overlays rely on: lowest-id reuse, the
last-board guard, mode-change state clearing, and POST /scoreboards/reset
returning every board to a clean single binding with no authored matches left.
"""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from server.api import router_v1
from server.bindings import get_binding
from server.match import Match, default_match
from server.postgame import PostGame
from server.rio.provider import RioGameDataProvider
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get

# Minimal shape `PostGame._project_entries` requires — enough to make
# `postgame.{N}.present` true, which is all these teardown tests read.
_PG_PAYLOAD = {
    "gameId": "123",
    "capturedAt": "2026-08-16T00:00:00Z",
    "sourceFile": "game123.json",
    "meta": {},
    "player": {"1": {"rioName": "Alice"}, "2": {"rioName": "Bob"}},
    "linescore": {},
}


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_v1)
    return TestClient(app)


@pytest.fixture
def no_stats_fetch(monkeypatch):
    """Name-override spawns a background stats refresh — keep it off the network."""
    from server.rio.stats_tracker import StatsTracker
    mock = AsyncMock()
    monkeypatch.setattr(StatsTracker, "refresh_api_stats", mock)
    return mock


# --- list / add / remove ---

def test_list_returns_default_board_with_binding_metadata(client):
    boards = client.get("/api/v1/scoreboards").json()
    assert [b["id"] for b in boards] == [1]
    b = boards[0]
    assert set(b) >= {"id", "alias", "binding", "transport", "is_hud_target"}
    assert b["binding"]["playback"]["mode"] == "single"


def test_add_reuses_lowest_available_id(client, set_setting):
    set_setting("scoreboards.active", [1, 3])
    r = client.post("/api/v1/scoreboards").json()
    assert r == {"success": True, "id": 2}
    assert Settings.Get("scoreboards.active") == [1, 2, 3]
    # A fresh default binding is written for the new board.
    assert Settings.Get("scoreboards.binding.2")["playback"]["mode"] == "single"


def test_remove_last_board_rejected(client):
    assert client.delete("/api/v1/scoreboards/1").status_code == 400


def test_remove_unknown_board_404(client, set_setting):
    set_setting("scoreboards.active", [1, 2])
    assert client.delete("/api/v1/scoreboards/9").status_code == 404


async def test_remove_board_clears_state_binding_and_alias(client, set_setting):
    set_setting("scoreboards.active", [1, 2])
    set_setting("scoreboards.binding.2", {"playback": {"mode": "single", "gameId": 5}})
    set_setting("scoreboards.aliases", {"2": "Side stage"})
    await State.Set("score.2.inning", 4)

    r = client.delete("/api/v1/scoreboards/2").json()
    assert r["success"] is True and r["active"] == [1]
    assert "2" not in (State.state.get("score") or {})
    assert Settings.Get("scoreboards.binding.2") is None
    assert Settings.Get("scoreboards.aliases.2") is None


async def test_remove_board_clears_its_running_order_assignment(client, set_setting):
    """Every per-board settings key goes when the board does.

    Ids are re-used (`_lowest_available_id`), so a leftover assignment is not
    dormant: the next board 2 would silently take its fixtures from Losers, with
    nothing on its panel saying where that came from.
    """
    set_setting("scoreboards.active", [1, 2])
    set_setting("scoreboards.match_queue", {"2": "losers"})

    client.delete("/api/v1/scoreboards/2")

    assert Settings.Get("scoreboards.match_queue.2") is None
    assert client.post("/api/v1/scoreboards").json()["id"] == 2   # id reused
    assert Settings.Get("scoreboards.match_queue.2") is None


async def test_remove_board_clears_its_captured_post_game(client, set_setting):
    """Per-board DATA goes with the board — not just per-board settings.

    `postgame.{N}` is per-board state that does not live under `score.{N}`, so
    the teardown's `State.Unset(f"score.{sb}")` never reached it while all four
    settings keys were handled correctly. With ids re-used, the next board 2
    inherited a deleted board's box score — and `_ensure_cache` would rebuild
    the in-memory caches from its `sourceFile`, so it survived a restart too.
    """
    set_setting("scoreboards.active", [1, 2])
    await State.SetBatch(PostGame._project_entries(2, _PG_PAYLOAD))
    PostGame._captured[2] = dict(_PG_PAYLOAD)

    client.delete("/api/v1/scoreboards/2")

    assert not (State.state.get("postgame") or {}).get("2", {}).get("present")
    assert 2 not in PostGame._captured

    assert client.post("/api/v1/scoreboards").json()["id"] == 2   # id reused
    assert not (State.state.get("postgame") or {}).get("2", {}).get("present")


async def test_remove_board_clears_both_rotation_keys(client, set_setting):
    """`scoreboards.rotation.{N}` is TWO keys — a Settings config and a State
    status mirror — and the board's teardown owes both.

    Removal cleared the Settings config only, so the mirror survived saying
    `running: true`; with ids re-used the next board 2 came up wearing a
    rotating badge for a rotation that does not exist. (Reset had the opposite
    half, which is what made the split easy to miss.) `stop_rotation` does not
    cover this — it drops the task and the binding flag, not the projection.
    """
    set_setting("scoreboards.active", [1, 2])
    set_setting("scoreboards.rotation.2", {"interval": 30})
    await State.Set("scoreboards.rotation.2", {"running": True, "game_ids": [9]})

    client.delete("/api/v1/scoreboards/2")

    assert Settings.Get("scoreboards.rotation.2") is None
    assert "2" not in (State.state.get("scoreboards", {}).get("rotation") or {})

    assert client.post("/api/v1/scoreboards").json()["id"] == 2   # id reused
    mirror = (State.state.get("scoreboards", {}).get("rotation") or {}).get("2") or {}
    assert not mirror.get("running")


async def test_reset_clears_captured_post_games_and_both_rotation_keys(
    client, set_setting
):
    """The recovery hatch has to reach the same per-board data removal does.

    It blanked `score.{N}` and moved on, so a board reset to a clean baseline
    still reported a post-game; and it cleared only the State half of the
    rotation pair, leaving the flat Settings config behind.
    """
    set_setting("scoreboards.active", [1, 2])
    set_setting("scoreboards.rotation.2", {"interval": 30})
    await State.Set("scoreboards.rotation.2", {"running": True})
    await State.SetBatch(PostGame._project_entries(2, _PG_PAYLOAD))
    PostGame._captured[2] = dict(_PG_PAYLOAD)

    assert client.post("/api/v1/scoreboards/reset").json()["success"] is True

    assert not (State.state.get("postgame") or {}).get("2", {}).get("present")
    assert 2 not in PostGame._captured
    assert Settings.Get("scoreboards.rotation.2") is None
    assert "2" not in (State.state.get("scoreboards", {}).get("rotation") or {})


@pytest.mark.parametrize("teardown", ["remove", "reset"])
async def test_board_teardown_drops_its_stats_diagnostics(
    client, set_setting, teardown
):
    """A board's fetch diagnostics are per-board data and go with the board.

    `stats_api._last_fetch_info` is keyed by board and describes the fetch that
    filled the stats slot. `reset_fetch_info` existed for this and nothing ever
    called it, so the entry outlived both teardown paths — and with ids re-used
    the next board 2 came up with a deleted board's diagnostics in its popover,
    stale error and all, reporting a failure that never happened to it.

    Both paths are pinned together because they are the pair that has drifted
    before (the rotation keys, opposite halves each). The drop now lives inside
    `StatsTracker.reset_scoreboard`, which both call, so neither can lose it.
    """
    from server.rio import stats_api

    set_setting("scoreboards.active", [1, 2])
    stats_api._last_fetch_info[2] = {
        "url": "https://api.projectrio.app/stats/?username=alice",
        "tag": "some-tag",
        "players": {},
        "fetched_at": "2026-08-16T00:00:00Z",
        "error": "429 Too Many Requests",
    }
    try:
        if teardown == "remove":
            client.delete("/api/v1/scoreboards/2")
        else:
            assert client.post("/api/v1/scoreboards/reset").json()["success"] is True

        assert 2 not in stats_api._last_fetch_info
        # What the board's popover actually reads: an empty shape, no stale error.
        assert stats_api.get_last_fetch_info(2).get("error") is None

        if teardown == "remove":
            assert client.post("/api/v1/scoreboards").json()["id"] == 2  # id reused
            assert stats_api.get_last_fetch_info(2).get("error") is None
    finally:
        stats_api._last_fetch_info.pop(2, None)


async def test_board_removed_then_re_added_can_be_written_to(client, set_setting):
    """Remove a board and add one back — `_lowest_available_id` hands out the
    same id — then write live state into it. The Save after that write used to
    raise TypeError, because removing the board left a None at `score.2` in
    last_state and deep_set cannot descend through it."""
    set_setting("scoreboards.active", [1, 2])
    await State.Set("score.2.player.1.rioName", "A")
    await State.Save()

    client.delete("/api/v1/scoreboards/2")
    await State.Save()

    assert client.post("/api/v1/scoreboards").json()["id"] == 2   # id reused

    await State.SetBatch([("score.2.player.1.rioName", "B")])
    await State.Save()

    assert State.state["score"]["2"]["player"]["1"]["rioName"] == "B"


# --- alias ---

def test_alias_set_and_clear(client, set_setting):
    set_setting("scoreboards.active", [1])
    client.put("/api/v1/scoreboards/1/alias", params={"alias": "  Main  "})
    assert Settings.Get("scoreboards.aliases.1") == "Main"   # trimmed
    client.put("/api/v1/scoreboards/1/alias", params={"alias": ""})
    assert Settings.Get("scoreboards.aliases.1") is None


def test_alias_unknown_board_404(client):
    assert client.put("/api/v1/scoreboards/9/alias",
                      params={"alias": "x"}).status_code == 404


# --- set_binding (playback mode) ---

def test_set_binding_rejects_bad_kind(client):
    r = client.put("/api/v1/scoreboards/1/binding", params={"kind": "bogus"})
    assert r.status_code == 400


async def test_mode_change_clears_stale_game_and_state_on_api_board(
        client, set_setting):
    set_setting("project_rio.hud_enabled", False)
    set_setting("scoreboards.active", [1, 2])
    set_setting("scoreboards.binding.2",
                {"playback": {"mode": "single", "gameId": 77}})
    await State.Set("score.2.inning", 6)

    r = client.put("/api/v1/scoreboards/2/binding",
                   params={"kind": "rotate", "pool": "completed"}).json()
    assert r["binding"]["playback"]["mode"] == "rotate"
    assert r["binding"]["pool"]["scope"] == "completed"
    # why: the previous mode's game no longer applies — a stale frame left on
    # the board is exactly the bug this endpoint's clearing prevents.
    assert Settings.Get("scoreboards.binding.2.playback.gameId") is None
    assert (State.state.get("score") or {}).get("2") == {}


async def test_same_mode_write_does_not_clear_state(client, set_setting):
    set_setting("project_rio.hud_enabled", False)
    set_setting("scoreboards.active", [1, 2])
    set_setting("scoreboards.binding.2",
                {"playback": {"mode": "single", "gameId": 77}})
    await State.Set("score.2.inning", 6)

    client.put("/api/v1/scoreboards/2/binding", params={"kind": "single"})
    assert State.state["score"]["2"]["inning"] == 6
    assert Settings.Get("scoreboards.binding.2.playback.gameId") == 77


def test_set_binding_accepts_legacy_set_alias_for_rotate(client, set_setting):
    set_setting("project_rio.hud_enabled", False)
    set_setting("scoreboards.active", [1])
    r = client.put("/api/v1/scoreboards/1/binding", params={"kind": "set"}).json()
    assert r["binding"]["playback"]["mode"] == "rotate"


# --- reset (the escape hatch) ---

async def test_reset_deletes_matches_and_restores_default_bindings(
        client, set_setting):
    set_setting("project_rio.hud_enabled", False)
    set_setting("scoreboards.active", [1, 2])
    set_setting("scoreboards.binding.2",
                {"playback": {"mode": "rotate", "gameId": 5},
                 "pool": {"pinned": [5]}})
    # A bound match + conflict banner + live frame + rotation mirror to clear.
    m = Match.next_id()
    await State.Set(f"match.{m}", default_match())
    await State.Set("score.2.match", m)
    await State.Set("score.2.match_conflict", True)
    await State.Set("score.2.inning", 3)
    await State.Set("scoreboards.rotation.2", {"running": True})
    await State.Save()

    r = client.post("/api/v1/scoreboards/reset").json()
    assert r["success"] is True

    assert State.state.get("match") in (None, {})
    score2 = (State.state.get("score") or {}).get("2") or {}
    assert score2 == {}
    assert get_binding(2)["playback"]["mode"] == "single"
    assert get_binding(2)["pool"]["pinned"] == []
    assert "2" not in (State.state.get("scoreboards", {}).get("rotation") or {})
    # Board tabs survive the reset — only their contents are recycled.
    assert Settings.Get("scoreboards.active") == [1, 2]


async def test_reset_clears_the_running_orders_it_emptied(client):
    """The reset unsets `match.{M}` directly rather than going through
    `delete_match`, so nothing prunes the schedule on its way past.

    `Schedule.queues()` prunes dead ids on read, which hid this: `GET /schedule`
    answered correctly while the STORED projection — what state.json persists,
    what the socket broadcast carries, and what the console's subject row counts —
    still listed every deleted fixture. It survived restarts too.
    """
    for _ in range(3):
        assert client.post("/api/v1/match").status_code == 200
    assert State.state["schedule"]["queue"] == [1, 2, 3]

    client.post("/api/v1/scoreboards/reset")

    assert State.state.get("match") in (None, {})
    assert State.state["schedule"]["queue"] == []
    assert State.state["schedule"]["queues"][0]["matches"] == []
    assert client.get("/api/v1/schedule").json()["queue"] == []


# --- name override ---

async def test_name_override_writes_through_on_board_without_live_frame(
        client, no_stats_fetch):
    r = client.put("/api/v1/scoreboards/1/player/1/name-override",
                   params={"name": "  PinnedName "}).json()
    assert r == {"success": True, "override": "PinnedName"}
    assert State.state["score"]["1"]["player"]["1"]["rioName_override"] == "PinnedName"
    assert State.state["score"]["1"]["player"]["1"]["rioName"] == "PinnedName"


async def test_name_override_empty_clears_the_pin(client, no_stats_fetch):
    client.put("/api/v1/scoreboards/1/player/1/name-override",
               params={"name": "Pinned"})
    client.put("/api/v1/scoreboards/1/player/1/name-override",
               params={"name": ""})
    player = State.state["score"]["1"]["player"]["1"]
    assert "rioName_override" not in player


def test_name_override_rejects_bad_team(client, no_stats_fetch):
    r = client.put("/api/v1/scoreboards/1/player/3/name-override",
                   params={"name": "X"})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# POST /scoreboards/{sb}/clear-game — the between-games verb
# ---------------------------------------------------------------------------

def test_clear_game_blanks_the_board(client):
    """It clears a GAME, not a board."""
    State.state.setdefault("score", {})["1"] = {
        "game_id": "123", "score_left": 7, "inning": 6, "stadium": "Mario Stadium",
    }

    resp = client.post("/api/v1/scoreboards/1/clear-game")

    assert resp.status_code == 200, resp.text
    assert State.state["score"]["1"]["game_id"] is None
    assert State.state["score"]["1"]["score_left"] == 0
    assert State.state["score"]["1"]["inning"] == 1
    assert State.state["score"]["1"]["stadium"] == ""


def test_clear_game_keeps_the_pool_and_the_playback(client):
    """A board's pool and playback are not part of its game — they are which
    games can fill it, which a clear must not answer."""
    before = dict(get_binding(1))

    client.post("/api/v1/scoreboards/1/clear-game")

    after = get_binding(1)
    assert after["pool"] == before["pool"]
    assert after["playback"] == before["playback"]


def test_clear_game_takes_the_game_mode_with_it(client):
    """THE MODE GOES WITH THE GAME. `stats_tag` is the feed's answer unless a
    producer overrode it, so a board with no game has no mode — leaving the last
    game's season on an emptied board left the one control on the game rule
    still describing the game just taken off it.

    BOTH keys: `sync_stats_tag` stands down while `stats_tag_manual` is set, so
    clearing the value alone would blank the mode and then stop the next game
    from ever filling it back in.
    """
    asyncio.run(Settings.Set("scoreboards.binding.1.stats_tag", "NNL Season 10"))
    asyncio.run(Settings.Set("scoreboards.binding.1.stats_tag_manual", True))

    client.post("/api/v1/scoreboards/1/clear-game")

    assert get_binding(1)["stats_tag"] == ""
    assert get_binding(1)["stats_tag_manual"] is False


def test_clear_game_keeps_a_fixture_that_still_has_a_game_to_give(client):
    """The default, and the reason this endpoint re-projects at all.

    A Bo3 between games must keep its match on the board — blanking the numbers
    is not the same as taking the fixture off.
    """
    asyncio.run(State.Set("match.1", {"format": {"bestOf": 3}, "series": {"1": 1, "2": 0}}))
    asyncio.run(State.Set("score.1.match", 1))
    State.state["score"]["1"]["game_id"] = "123"

    client.post("/api/v1/scoreboards/1/clear-game")

    assert deep_get(State.state, "score.1.match") == 1


def test_clear_game_can_take_a_finished_fixture_off_the_board(client):
    """`release_match` IS the answer to "I cleared it and it came back".

    Over a DECIDED fixture the plain clear blanked the board and the Match
    projector immediately repainted the fixture's two names onto it, so the
    scoreboard went back to drawing a finished matchup at 0-0 — the producer
    pressed the button that empties a board and the board did not empty.
    """
    asyncio.run(State.Set("match.1", {
        "format": {"bestOf": 1}, "decided": 1,
        "player": {"1": {"rioName": "Alice"}, "2": {"rioName": "Bob"}},
    }))
    asyncio.run(State.Set("score.1.match", 1))
    State.state["score"]["1"]["game_id"] = "123"

    resp = client.post("/api/v1/scoreboards/1/clear-game",
                       params={"release_match": "true"})

    assert resp.status_code == 200
    assert resp.json()["released"] is True
    assert deep_get(State.state, "score.1.match") is None
    # ...and the names the projector would have put back are gone with it. That
    # is the whole point: the board is EMPTY, not repainted.
    assert not deep_get(State.state, "score.1.player.1.rioName")
    assert not deep_get(State.state, "score.1.player.2.rioName")


def test_a_release_on_an_unbound_board_is_a_plain_clear(client):
    """No binding to drop, and no error for asking — the board desk sets the flag
    from the fixture's own state, and a board can lose its match between the
    render and the press."""
    State.state.setdefault("score", {})["1"] = {"game_id": "123", "inning": 4}

    resp = client.post("/api/v1/scoreboards/1/clear-game",
                       params={"release_match": "true"})

    assert resp.status_code == 200
    assert deep_get(State.state, "score.1.game_id") is None


@pytest.mark.parametrize("release", ["false", "true"])
def test_clear_game_takes_the_capture_with_it(client, release):
    """A capture is the cleared game's receipt. Kept, it went on driving the Game
    Summary and Spotlight and read CAPTURED beside a board that no longer held
    the game it described (user call, 2026-09-18). Both modes."""
    asyncio.run(State.SetBatch(PostGame._project_entries(1, _PG_PAYLOAD)))
    PostGame._captured[1] = dict(_PG_PAYLOAD)
    asyncio.run(State.Set("match.1", {"format": {"bestOf": 1}, "decided": 1}))
    asyncio.run(State.Set("score.1.match", 1))
    State.state["score"]["1"]["game_id"] = "123"

    client.post("/api/v1/scoreboards/1/clear-game", params={"release_match": release})

    assert not deep_get(State.state, "postgame.1.present")
    assert 1 not in PostGame._captured


def test_a_cleared_hud_game_stays_cleared_through_a_restart(client, monkeypatch):
    """The boot read of decoded.hud.json re-applied the cleared game's last frame,
    because the release lived only in memory (user report, 2026-09-18).

    The frame's fingerprint is persisted with the clear, so reading the SAME
    frame back (a restart) holds the board empty; a DIFFERENT frame — Project
    Rio writing again — ends the hold.
    """
    from server.rio.provider import RELEASED_FRAME_KEY
    frame = {"game_id": 777, "event_num": 42}

    class Watcher:
        latest_game_data = frame

    monkeypatch.setattr(RioGameDataProvider, "hud_watcher", Watcher())
    State.state.setdefault("score", {})["1"] = {"game_id": "777", "inning": 9}

    client.post("/api/v1/scoreboards/1/clear-game")
    assert deep_get(State.state, RELEASED_FRAME_KEY) == "777:42"

    # A restart: memory is gone, the persisted key is not (Start reloads it).
    RioGameDataProvider._feed_released = False
    RioGameDataProvider._released_frame = deep_get(State.state, RELEASED_FRAME_KEY)
    asyncio.run(RioGameDataProvider._on_hud_game_update(dict(frame)))
    assert RioGameDataProvider._feed_released is True
    assert deep_get(State.state, "score.1.game_id") is None
    assert deep_get(State.state, "score.1.inning") == 1

    # The next EVENT is the feed speaking: the hold ends before the frame is
    # processed (stopped there — the rest is the ordinary per-frame path).
    class Stop(Exception):
        pass

    def stop(*_a, **_k):
        raise Stop

    monkeypatch.setattr(RioGameDataProvider, "_is_new_game", classmethod(stop))
    with pytest.raises(Stop):
        asyncio.run(RioGameDataProvider._on_hud_game_update({"game_id": 777, "event_num": 43}))
    assert RioGameDataProvider._released_frame is None
    assert not deep_get(State.state, RELEASED_FRAME_KEY)


def test_clear_game_404s_on_a_board_that_does_not_exist(client):
    assert client.post("/api/v1/scoreboards/99/clear-game").status_code == 404

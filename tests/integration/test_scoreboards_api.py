"""/scoreboards API — board CRUD, binding mode switches, and the reset hatch.

In-process via TestClient (same harness as test_api.py). These pin the board
lifecycle contracts the Match tab and overlays rely on: lowest-id reuse, the
last-board guard, mode-change state clearing, and POST /scoreboards/reset
returning every board to a clean single binding with no authored matches left.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from server.api import router_v1
from server.bindings import get_binding
from server.match import Match, default_match
from server.postgame import PostGame
from server.settings import Settings
from server.state import State

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

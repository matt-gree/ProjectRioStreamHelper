"""Cross-subsystem invariants, driven through real producer workflows.

The point of these is the SEAMS. Every unit test here already passes against a
model in isolation; what these do is put the app through a workflow a producer
actually performs — bind a fixture to a live board, flip it, unbind it, remove
the board — and then assert that no two subsystems ended up disagreeing.

Both bugs that prompted this file were found by driving the app by hand and
would have been caught by `board_with_a_game_has_names` and
`side_reason_names_a_live_layer` on the first workflow that exercised them.

The checks themselves live in `server/invariants.py`; add one there and it runs
here automatically.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import invariants
from server.api import router_v1
from server.match import Match, default_match
from server.rio.provider import RioGameDataProvider
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router_v1)
    return TestClient(app)


def assert_healthy():
    """Every check, with the offending rule named when one fails."""
    found = invariants.violations()
    assert found == [], "invariants violated:\n  " + "\n  ".join(found)


async def seed_live_board(sb: int = 1, left: str = "rjb", right: str = "MattGree"):
    """Put a live feed game on a board THROUGH THE PROVIDER.

    Writing the keys directly would look the same in state and test almost
    nothing: the cascade's re-settle path (`reorient_board`) no-ops unless the
    board is a real HUD target with a frame behind it, so a hand-seeded board
    silently skips the half of this file that covers orientation. Going through
    `_apply_game_to_state` is what makes the board genuinely feed-backed —
    `game_id`, `side_reason` and `_raw_game` all land the way they do live.
    """
    RioGameDataProvider._hud_targets = [sb]
    await next_frame(left, right)


async def next_frame(left: str = "rjb", right: str = "MattGree"):
    """The feed speaking again — one more frame of the same game.

    Several of these workflows only go wrong once a frame has landed AFTER the
    fixture change, because that is what writes `side_reason` from the cascade.
    Binding alone never sets it to 'match'; the frame that follows the bind does,
    and the unbind after that is where it goes stale.
    """
    await RioGameDataProvider._apply_game_to_state({
        "entrants": [
            [{"rioName": left, "msb_team": "Bowser Blue Shells", "roster": ["Bowser"],
              "captainIndex": 0, "logo": "Bowser Blue Shells", "port": 1}],
            [{"rioName": right, "msb_team": "Birdo Bows", "roster": ["Birdo"],
              "captainIndex": 0, "logo": "Birdo Bows", "port": 2}],
        ],
        "team1score": 6, "team2score": 14, "inning": 9, "game_id": "4077258482",
    })
    await State.Save()


async def make_match(left: str = "rjb", right: str = "MattGree") -> int:
    m = Match.next_id()
    body = default_match()
    body["player"]["1"]["rioName"] = left
    body["player"]["2"]["rioName"] = right
    await State.Set(f"match.{m}", body)
    await State.Save()
    return m


# ── the shipped defaults ────────────────────────────────────────────────────

async def test_a_fresh_instance_is_healthy():
    """Boot state — the seeded containers, their rules and the default rig — must
    satisfy every check, or the first thing a producer sees is already wrong."""
    assert_healthy()


# ── the workflows that broke ────────────────────────────────────────────────

async def test_unbinding_a_fixture_mid_game_leaves_the_board_coherent(client):
    """The bug this file was written for.

    Unbinding blanked both sides' `rioName` while the board kept its game, and
    left `side_reason` reading 'match' with no match bound. Two checks, one
    workflow.
    """
    await seed_live_board()
    m = await make_match()

    client.put("/api/v1/scoreboards/1/match", json={"match": m})
    await next_frame()
    assert deep_get(State.state, "score.1.side_reason") == "match"
    assert_healthy()

    client.put("/api/v1/scoreboards/1/match", json={"match": None})

    assert deep_get(State.state, "score.1.player.1.rioName") == "rjb"
    assert deep_get(State.state, "score.1.player.2.rioName") == "MattGree"
    # The cascade re-ran and fell through to whichever layer governs an unbound
    # board — what it must NOT still say is 'match'.
    assert deep_get(State.state, "score.1.side_reason") != "match"
    assert_healthy()


async def test_flipping_a_bound_fixture_leaves_the_board_coherent(client):
    """A flip moved the projected names but not the live team and roster under
    them, so the left side showed one player's name over the other's logo."""
    await seed_live_board()
    m = await make_match()
    client.put("/api/v1/scoreboards/1/match", json={"match": m})

    client.post(f"/api/v1/match/{m}/flip")

    assert_healthy()


async def test_moving_a_match_between_boards_leaves_both_coherent(client, rig):
    """Binding a match another board holds MOVES it. The vacated board is the one
    that goes wrong — it keeps its live game and loses the fixture."""
    rig(1, 2)
    await seed_live_board(1)
    m = await make_match()
    client.put("/api/v1/scoreboards/1/match", json={"match": m})

    client.put("/api/v1/scoreboards/2/match", json={"match": m})

    assert deep_get(State.state, "score.1.match") is None
    assert deep_get(State.state, "score.1.player.1.rioName") == "rjb"
    assert_healthy()


async def test_deleting_a_bound_match_leaves_the_board_coherent(client):
    await seed_live_board()
    m = await make_match()
    client.put("/api/v1/scoreboards/1/match", json={"match": m})

    client.delete(f"/api/v1/match/{m}")

    assert deep_get(State.state, "score.1.player.1.rioName") == "rjb"
    assert_healthy()


async def test_removing_a_board_leaves_nothing_behind(client, rig):
    """Board ids are re-used, so per-board leftovers are inherited rather than
    dormant — `per_board_state_belongs_to_a_live_board` is the general form of
    what test_scoreboards_api pins key by key."""
    rig(1, 2)
    await seed_live_board(2)
    m = await make_match()
    client.put("/api/v1/scoreboards/2/match", json={"match": m})

    client.delete("/api/v1/scoreboards/2")

    assert_healthy()


async def test_the_reset_hatch_lands_somewhere_healthy(client):
    await seed_live_board()
    m = await make_match()
    client.put("/api/v1/scoreboards/1/match", json={"match": m})

    client.post("/api/v1/scoreboards/reset")

    assert_healthy()


# ── the checks catch what they claim to ─────────────────────────────────────
#
# A check nobody has watched fail is a check that might be asserting nothing.

async def test_the_names_check_catches_a_blanked_live_board():
    await seed_live_board()
    await State.Set("score.1.player.1.rioName", "")
    found = invariants.violations()
    assert any("board_with_a_game_has_names" in v for v in found), found


async def test_the_side_reason_check_catches_a_stale_layer():
    await seed_live_board()
    await State.Set("score.1.side_reason", "match")
    found = invariants.violations()
    assert any("side_reason_names_a_live_layer" in v for v in found), found


async def test_the_one_board_per_match_check_catches_a_double_bind(rig):
    rig(1, 2)
    m = await make_match()
    await State.SetBatch([("score.1.match", m), ("score.2.match", m)])
    found = invariants.violations()
    assert any("a_match_fills_exactly_one_board" in v for v in found), found


async def test_the_container_check_catches_a_feed_off_the_roster():
    await State.Set("production.feed.container.roster-stats-1", {
        "element": "lowerthird", "scoreboard": 1, "team": 1,
    })
    found = invariants.violations()
    assert any("a_container_feeds_only_its_own_members" in v for v in found), found


async def test_the_automation_check_catches_a_rule_pointing_at_nothing():
    await Settings.Set("production.automations.ghost", {
        "enabled": True, "container": "no-such-container", "member": "statscard",
        "trigger": "score.{sb}.batter", "guard": "content", "dwell": 7,
    })
    found = invariants.violations()
    assert any("an_automation_points_at_things_that_exist" in v for v in found), found


async def test_the_queue_check_catches_a_drifted_projection():
    m = await make_match()
    await State.SetBatch([
        ("schedule.queues", [{"id": "main", "title": "Main", "matches": [m]}]),
        ("schedule.queue", []),
    ])
    found = invariants.violations()
    assert any("the_queue_projection_matches_its_orders" in v for v in found), found


# ── the route serves the same list ──────────────────────────────────────────

async def test_the_route_reports_the_same_verdict(client):
    r = client.get("/api/v1/invariants")
    assert r.status_code == 200
    assert r.json()["ok"] is True

    await seed_live_board()
    await State.Set("score.1.player.2.rioName", "")

    r = client.get("/api/v1/invariants")
    assert r.status_code == 200, "a violation is a finding, not a failed request"
    body = r.json()
    assert body["ok"] is False
    assert any("board_with_a_game_has_names" in v for v in body["violations"])

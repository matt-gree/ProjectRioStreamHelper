"""Board↔match binding: a match fills exactly ONE board.

The rule used to live in the console — a loop in the Match desk's `selectBoard`
that unbound the siblings before binding. Nothing else inherited it: this route
didn't, `/startgg/load-set` wrote `score.{N}.match` directly, and under confirm
mode the console's version wasn't atomic (each sibling unbind was a separately
discardable staged entry). `bind_board` owns it now, so these tests exercise the
server rather than the click handler.
"""
import pytest
from fastapi import HTTPException

from server.api.v1.match import (
    bind_board, bind_scoreboard, take_next_match, BindPayload,
)
from server.match import Match, default_match
from server.schedule import Schedule
from server.state import State
from server.utils.deep_dict import deep_get


async def make_match(name1: str = "Alice", name2: str = "Bob") -> int:
    """A match with both sides seated, so a projection is observable."""
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = name1
    match["player"]["2"]["rioName"] = name2
    match["label"] = "Winners R2"
    await State.Set(f"match.{m}", match)
    return m


async def enqueue(*ids: int) -> None:
    """Put ``ids`` on the running order, in order (none are enrolled yet)."""
    for m in ids:
        await Schedule.append(m)


@pytest.mark.asyncio
async def test_binding_a_second_board_moves_the_match():
    m = await make_match()
    await bind_board(1, m)
    assert Match.bound_scoreboards(m) == [1]

    await bind_board(2, m)

    assert Match.bound_scoreboards(m) == [2]
    assert deep_get(State.state, "score.1.match") is None
    assert deep_get(State.state, "score.2.match") == m


@pytest.mark.asyncio
async def test_the_vacated_board_is_blanked_not_left_stale():
    """The steal has to run the projector's own unbind, or the board keeps
    drawing a fixture it no longer holds — the case a producer sees on air."""
    m = await make_match()
    await bind_board(1, m)
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"

    await bind_board(2, m)

    assert deep_get(State.state, "score.1.player.1.rioName") == ""
    assert deep_get(State.state, "score.2.player.1.rioName") == "Alice"


@pytest.mark.asyncio
async def test_a_conflict_on_the_vacated_board_goes_with_the_binding():
    """`match_conflict` is a fact about a board's binding, so it cannot outlive
    it — a stale one raises the app-wide banner over a board with no match."""
    m = await make_match()
    await bind_board(1, m)
    await State.Set("score.1.match_conflict", {"reason": "players"})

    await bind_board(2, m)

    assert deep_get(State.state, "score.1.match_conflict") is None


@pytest.mark.asyncio
async def test_rebinding_the_same_board_is_a_no_op_not_a_self_steal():
    """The holder loop must skip the target: unbinding board 1 to bind board 1
    would blank the fixture and then re-project it, and any caller reading
    between the two writes would see an empty board."""
    m = await make_match()
    await bind_board(1, m)

    await bind_board(1, m)

    assert Match.bound_scoreboards(m) == [1]
    assert deep_get(State.state, "score.1.match") == m
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"


@pytest.mark.asyncio
async def test_two_matches_can_hold_two_different_boards():
    """Exclusivity is per MATCH, not a global one-match-at-a-time rule — a
    two-board rig runs two fixtures at once, which is why boards are plural."""
    a, b = await make_match("Alice", "Bob"), await make_match("Carol", "Dave")
    await bind_board(1, a)
    await bind_board(2, b)

    assert Match.bound_scoreboards(a) == [1]
    assert Match.bound_scoreboards(b) == [2]


@pytest.mark.asyncio
async def test_binding_a_board_that_holds_another_match_replaces_it():
    """The other direction: the BOARD is single-valued too, so binding a new
    match to an occupied board displaces the old one rather than erroring."""
    a, b = await make_match("Alice", "Bob"), await make_match("Carol", "Dave")
    await bind_board(1, a)

    await bind_board(1, b)

    assert Match.bound_scoreboards(a) == []
    assert Match.bound_scoreboards(b) == [1]
    assert deep_get(State.state, "score.1.player.1.rioName") == "Carol"


@pytest.mark.asyncio
async def test_route_moves_the_match_and_reports_it(rig):
    rig(1, 2)
    m = await make_match()
    await bind_scoreboard(1, BindPayload(match=m))

    result = await bind_scoreboard(2, BindPayload(match=m))

    assert result == {"success": True, "match": m}
    assert Match.bound_scoreboards(m) == [2]


@pytest.mark.asyncio
async def test_binding_a_board_outside_the_rig_is_a_404():
    """A board id arrives from a request and nothing downstream checks it.

    Binding a match to a board that is not in `scoreboards.active` wrote
    `score.{sb}.match` for a board no layout reads and no rack row lists — state
    for a phantom board, persisted, with no surface able to show or clear it.
    Found by driving `POST /scoreboards/2/next-match` against a one-board rig,
    which reported success. The default rig here is one board, so board 2 is the
    unknown one.
    """
    m = await make_match()
    with pytest.raises(HTTPException) as exc:
        await bind_scoreboard(2, BindPayload(match=m))
    assert exc.value.status_code == 404
    assert "rig" in exc.value.detail
    assert deep_get(State.state, "score.2.match") is None
    assert Match.bound_scoreboards(m) == []


@pytest.mark.asyncio
async def test_taking_the_next_fixture_onto_a_board_outside_the_rig_is_a_404():
    a = await make_match()
    await enqueue(a)
    with pytest.raises(HTTPException) as exc:
        await take_next_match(3)
    assert exc.value.status_code == 404
    # And it consumed nothing on the way out.
    assert Schedule.next_up() == a


@pytest.mark.asyncio
async def test_route_unbind_clears_the_board():
    m = await make_match()
    await bind_scoreboard(1, BindPayload(match=m))

    await bind_scoreboard(1, BindPayload(match=None))

    assert Match.bound_scoreboards(m) == []
    assert deep_get(State.state, "score.1.match") is None
    assert deep_get(State.state, "score.1.player.1.rioName") == ""


@pytest.mark.asyncio
async def test_route_rejects_a_match_that_does_not_exist():
    with pytest.raises(HTTPException) as exc:
        await bind_scoreboard(1, BindPayload(match=999))
    assert exc.value.status_code == 404
    assert deep_get(State.state, "score.1.match") is None


@pytest.mark.asyncio
async def test_binding_a_live_hud_board_seats_the_feed_under_the_fixture():
    """Binding runs the side cascade, not just the projector.

    The projector writes the fixture's names; the live roster, logo and port
    underneath them belong to the feed and only move when the cascade re-runs.
    Binding used to run the identity gate alone, so a fixture whose sides were
    the reverse of the feed's put one player's name over the other's team until
    the next frame — forever on a paused or finished game.
    """
    from server.rio.provider import RioGameDataProvider as P

    P._hud_targets = [1]
    # Feed order: Bob on the left, Alice on the right, each with their own team.
    frame = {
        "entrants": [[{"rioName": "Bob", "msb_team": "Bowser Monsters"}],
                     [{"rioName": "Alice", "msb_team": "Mario Fireballs"}]],
        "team1score": 3, "team2score": 1, "inning": 4, "game_id": 77,
    }
    await P._apply_game_to_state(frame)
    assert deep_get(State.state, "score.1.player.1.msb_team") == "Bowser Monsters"

    m = await make_match("Alice", "Bob")
    await bind_board(1, m)

    assert deep_get(State.state, "score.1.side_reason") == "match"
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"
    # The team under the name is Alice's, and the score travelled with it.
    assert deep_get(State.state, "score.1.player.1.msb_team") == "Mario Fireballs"
    assert deep_get(State.state, "score.1.score_left") == 1


@pytest.mark.asyncio
async def test_auto_retire_unbinds_a_finished_fixture():
    """Different players taking a board whose fixture is complete retire it: the
    board is unbound and follows the feed, and the fixture is stamped `post`."""
    from server.rio.provider import RioGameDataProvider as P

    P._hud_targets = [1]
    m = await make_match("Alice", "Bob")
    await State.Set(f"match.{m}.decided", 1)          # complete: nothing left to play
    await bind_board(1, m)
    await P._apply_game_to_state({
        "entrants": [[{"rioName": "Bob"}], [{"rioName": "Alice"}]],
        "team1score": 0, "team2score": 0, "inning": 1, "game_id": 1,
    })
    assert deep_get(State.state, "score.1.side_reason") == "match"

    # Different players start the next game on this board.
    frame = {
        "entrants": [[{"rioName": "Cara"}], [{"rioName": "Dev"}]],
        "team1score": 0, "team2score": 0, "inning": 1, "game_id": 2,
    }
    await P._apply_game_to_state(frame)
    await P._evaluate_match_gates(frame)

    assert deep_get(State.state, "score.1.match") is None
    assert deep_get(State.state, f"match.{m}.stage") == "post"
    assert deep_get(State.state, "score.1.side_reason") != "match"
    assert deep_get(State.state, "score.1.match_conflict") is None

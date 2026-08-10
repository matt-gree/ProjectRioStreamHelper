"""Taking the next queued fixture — eligibility (Schedule.next_up) and the
atomic take (POST /scoreboards/{sb}/next-match).

THE QUEUE IS AN ORDER, NOT A CURSOR. A PRSH stream can run several matches at
once, so "next" is resolved per board from what is bound and what is decided;
there is no stored position to advance and none to get out of step. These tests
are mostly about the four things that make a queued match ineligible, because
each one is a state where a cursor-based design would hand back something the
producer has already dealt with.
"""
import asyncio

import pytest
from fastapi import HTTPException

from server.api.v1.match import bind_board, take_next_match
from server.match import Match, default_match
from server.schedule import Schedule
from server.state import State
from server.utils.deep_dict import deep_get


async def make_match(name1: str = "Alice", name2: str = "Bob", **over) -> int:
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = name1
    match["player"]["2"]["rioName"] = name2
    match.update(over)
    await State.Set(f"match.{m}", match)
    return m


# --- eligibility ---

@pytest.mark.asyncio
async def test_next_up_is_the_first_queued_fixture():
    a, b = await make_match("Alice", "Bob"), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])
    assert Schedule.next_up() == a


@pytest.mark.asyncio
async def test_an_empty_queue_has_nothing_next():
    await make_match()
    assert Schedule.next_up() is None


@pytest.mark.asyncio
async def test_a_bound_fixture_is_not_waiting_for_a_board():
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])
    await bind_board(1, a)
    assert Schedule.next_up() == b


@pytest.mark.asyncio
async def test_a_decided_fixture_is_finished():
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])
    await State.Set(f"match.{a}.decided", 1)
    assert Schedule.next_up() == b


"""`stage` is NOT the finished test — a Bo3 sits at post between games and is
still the current fixture. It is the ANTI-BOUNCE test: a fixture that has been on
a board and been fed has started, so it is not offered as fresh."""


@pytest.mark.asyncio
async def test_a_started_fixture_is_not_offered_as_fresh():
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])
    await bind_board(1, a)
    await State.Set(f"match.{a}.stage", "live")
    # Moving the board off it must not make it "next" again — that is the
    # ping-pong the stage check exists to prevent.
    await bind_board(1, b)
    assert Schedule.next_up() is None


@pytest.mark.asyncio
async def test_a_bound_but_never_fed_fixture_comes_back():
    """Still `draft`, so nothing happened to it: unbinding puts it back in line."""
    a = await make_match()
    await Schedule.set_queue([a])
    await bind_board(1, a)
    assert Schedule.next_up() is None
    await State.UnsetBatch([f"score.1.match"])
    assert Schedule.next_up() == a


@pytest.mark.asyncio
async def test_a_queued_id_whose_match_was_deleted_is_skipped():
    """set_queue validates, but a match can be deleted afterwards — and delete
    prunes the queue, so this is belt-and-braces on the read path."""
    a = await make_match()
    await Schedule.set_queue([a])
    await State.Unset(f"match.{a}")
    assert Schedule.next_up() is None


# --- the take ---

@pytest.mark.asyncio
async def test_take_next_binds_the_first_waiting_fixture():
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])

    result = await take_next_match(1)

    assert result["success"] is True
    assert result["match"] == a
    assert Match.bound_scoreboards(a) == [1]
    # It projected, so the board is carrying the fixture and not just an id.
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"


@pytest.mark.asyncio
async def test_take_next_leaves_the_queue_alone():
    """The queue is the ORDER; taking a fixture does not consume its slot. What
    makes it stop being 'next' is that a board now holds it."""
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])
    await take_next_match(1)
    assert Schedule.queue() == [a, b]


@pytest.mark.asyncio
async def test_two_boards_take_two_different_fixtures(rig):
    """The whole point on a multi-board rig. Sequentially here; the concurrent
    case is below."""
    rig(1, 2)
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])

    first = await take_next_match(1)
    second = await take_next_match(2)

    assert (first["match"], second["match"]) == (a, b)
    assert Match.bound_scoreboards(a) == [1]
    assert Match.bound_scoreboards(b) == [2]


@pytest.mark.asyncio
async def test_concurrent_takes_do_not_land_on_one_fixture(monkeypatch, rig):
    """Without the lock both requests resolve the same match, the second bind
    STEALS it (exclusivity doing its job) and the first board ends up empty.

    The yield has to be INJECTED. Under the test socket nothing in the
    resolve→bind window actually suspends, so a plain `gather` runs each call to
    completion in turn and the race is unreproducible — the test would pass with
    the lock removed, which is a test that checks nothing. Sleeping inside the
    window is the real production shape: `bind_board` awaits before its first
    write.
    """
    rig(1, 2)
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.set_queue([a, b])

    import server.api.v1.match as match_api
    real_bind = match_api.bind_board

    async def slow_bind(sb, m, **kw):
        await asyncio.sleep(0)
        return await real_bind(sb, m, **kw)

    monkeypatch.setattr(match_api, "bind_board", slow_bind)

    got = await asyncio.gather(take_next_match(1), take_next_match(2))

    assert {r["match"] for r in got} == {a, b}
    assert deep_get(State.state, "score.1.match") is not None
    assert deep_get(State.state, "score.2.match") is not None


@pytest.mark.asyncio
async def test_take_next_says_why_when_nothing_is_waiting(rig):
    rig(1, 2)
    a = await make_match()
    await Schedule.set_queue([a])
    await take_next_match(1)

    with pytest.raises(HTTPException) as exc:
        await take_next_match(2)
    assert exc.value.status_code == 409
    assert "queue" in exc.value.detail


@pytest.mark.asyncio
async def test_take_next_refuses_a_rotating_board(monkeypatch, rig):
    """Same rule as an explicit bind: a rotation has no fixed sides to project a
    fixture onto. Mirrored here rather than left to bind_board so the queue verb
    fails before it consumes anything."""
    import server.bindings
    monkeypatch.setattr(server.bindings, "is_rotating", lambda sb: True)
    monkeypatch.setattr(server.bindings, "transport", lambda sb: "api")
    rig(1, 2)
    a = await make_match()
    await Schedule.set_queue([a])

    with pytest.raises(HTTPException) as exc:
        await take_next_match(2)
    assert exc.value.status_code == 409
    assert Match.bound_scoreboards(a) == []

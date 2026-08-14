"""Several running orders (`schedule.queues`).

A night can run a winners-bracket order and a losers-bracket order as two
independent lists, and a board draws from one of them. Three rules carry the
model, and each has a test here that fails if it is undone:

**Membership is exclusive across queues.** A fixture belongs to one running order,
so "which queue holds match 4" always has exactly one answer — which is what the
per-id `move` verb needs in order to not take a queue id from the client at all.

**`schedule.queue` is a PROJECTION**, the union in queue order, rewritten in the
same batch as the model. It is what the schedule overlay and the console subject
already read, and the union specifically so that creating a second queue can never
silently drop a fixture off air.

**A board with no assignment draws from the first queue**, so a single-queue rig
behaves exactly as it did before queues existed.
"""
import pytest
from fastapi import HTTPException

from server.api.v1.match import bind_board, create_match, delete_match, take_next_match
from server.api.v1.schedule import (
    create_queue,
    delete_queue,
    dequeue_match,
    enqueue_match,
    move_queue,
    move_queued_match,
    rename_queue,
    QueuePayload,
)
from server.match import Match, default_match
from server.schedule import Schedule, queue_id_for
from server.settings import Settings
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


async def two_queues() -> tuple[str, str]:
    """A winners order and a losers order, in that list position."""
    await Schedule.ensure_migrated()
    await rename_queue(Schedule.first_queue_id(), QueuePayload(title="Winners"))
    await create_queue(QueuePayload(title="Losers"))
    return Schedule.first_queue_id(), "losers"


# --- migration -------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_old_single_queue_becomes_the_first_running_order():
    a, b = await make_match(), await make_match("Carol", "Dave")
    await State.SetBatch([("schedule.queue", [a, b]), ("schedule.title", "Today")])

    await Schedule.ensure_migrated()

    assert Schedule.queues() == [{"id": "main", "title": "Main", "matches": [a, b]}]


@pytest.mark.asyncio
async def test_migration_leaves_the_overlay_heading_alone():
    """`schedule.title` is the schedule OVERLAY's heading, owned by the ticker's own
    panel — not any order's title.

    Projecting the first order's title into it headed a union of Winners + Losers
    with the word "WINNERS": true of the first order, a lie about what was on screen.
    Caught by looking at the rendered overlay, not by a test.
    """
    a = await make_match()
    await State.SetBatch([("schedule.queue", [a]), ("schedule.title", "Upcoming Matches")])

    await Schedule.ensure_migrated()
    await rename_queue("main", QueuePayload(title="Winners"))

    assert deep_get(State.state, "schedule.title") == "Upcoming Matches"
    assert Schedule.get_queue("main")["title"] == "Winners"


@pytest.mark.asyncio
async def test_migration_does_not_re_run_against_its_own_output():
    """The legacy keys become projections of the model. Re-running the migration
    must not read them back and rebuild — that is what makes them safe to write."""
    a = await make_match()
    await State.Set("schedule.queue", [a])
    await Schedule.ensure_migrated()
    await create_queue(QueuePayload(title="Losers"))
    b = await make_match("Carol", "Dave")
    await Schedule.append(b, "losers")

    await Schedule.ensure_migrated()

    assert [q["id"] for q in Schedule.queues()] == ["main", "losers"]
    assert Schedule.matches("losers") == [b]


# --- the projection --------------------------------------------------------


@pytest.mark.asyncio
async def test_the_flat_queue_is_the_union_in_queue_order():
    """What the schedule overlay draws. The union, so a fixture never vanishes
    from air just because someone created a second running order."""
    w, l = await two_queues()
    a, b, c = await make_match(), await make_match("C", "D"), await make_match("E", "F")
    await Schedule.append(a, w)
    await Schedule.append(b, l)
    await Schedule.append(c, w)

    assert Schedule.matches(w) == [a, c]
    assert Schedule.matches(l) == [b]
    # Queue order, not match order: everything in Winners, then everything in Losers.
    assert deep_get(State.state, "schedule.queue") == [a, c, b]


@pytest.mark.asyncio
async def test_a_pending_prune_is_flushed_into_the_projection():
    """`queues()` prunes a dead id on READ; the stored model and its projection
    keep it until something calls `_commit`.

    Any path that deletes a match without going through `remove` therefore leaves
    the two disagreeing — `POST /scoreboards/reset` unsets `match.{M}` directly —
    and the console's subject row, which counts the projection, reports fixtures
    that no longer exist. `reproject` is the flush, and it is what the reset hatch
    and boot both call.
    """
    a, b = await make_match(), await make_match("Carol", "Dave")
    await Schedule.append(a)
    await Schedule.append(b)
    await State.Unset(f"match.{a}")

    # The read already knows; the stored state does not.
    assert Schedule.queue() == [b]
    assert deep_get(State.state, "schedule.queue") == [a, b]

    await Schedule.reproject()

    assert deep_get(State.state, "schedule.queue") == [b]
    assert deep_get(State.state, "schedule.queues")[0]["matches"] == [b]


@pytest.mark.asyncio
async def test_boot_repairs_a_stale_projection():
    """An already-migrated rig re-projects at boot instead of returning flat.

    Nothing else at startup calls `_commit`, so without this a fixture deleted by
    a path that skipped `remove` would be drawn from state.json on every launch,
    forever — the stale projection would outlive the app.
    """
    a = await make_match()
    await Schedule.append(a)
    await State.Unset(f"match.{a}")

    await Schedule.ensure_migrated()

    assert deep_get(State.state, "schedule.queue") == []


@pytest.mark.asyncio
async def test_reordering_the_queues_reorders_the_projection():
    w, l = await two_queues()
    a, b = await make_match(), await make_match("C", "D")
    await Schedule.append(a, w)
    await Schedule.append(b, l)
    assert deep_get(State.state, "schedule.queue") == [a, b]

    await move_queue(l, -1)

    assert [q["id"] for q in Schedule.queues()] == [l, w]
    assert deep_get(State.state, "schedule.queue") == [b, a]


# --- exclusivity -----------------------------------------------------------


@pytest.mark.asyncio
async def test_enrolling_in_another_queue_moves_the_match():
    w, l = await two_queues()
    a = await make_match()
    await enqueue_match(a, queue=w)
    assert Schedule.matches(w) == [a]

    await enqueue_match(a, queue=l)

    assert Schedule.matches(w) == []
    assert Schedule.matches(l) == [a]
    assert Schedule.queue_of(a) == l
    # And it appears exactly once on air, not twice.
    assert deep_get(State.state, "schedule.queue") == [a]


@pytest.mark.asyncio
async def test_move_resolves_the_queue_from_the_match_not_the_client():
    """`move` takes no queue id on purpose: a client working from a stale read
    cannot reorder the wrong list."""
    w, l = await two_queues()
    a, b = await make_match(), await make_match("C", "D")
    x, y = await make_match("E", "F"), await make_match("G", "H")
    for m in (a, b):
        await Schedule.append(m, w)
    for m in (x, y):
        await Schedule.append(m, l)

    await move_queued_match(y, -1)

    assert Schedule.matches(l) == [y, x]
    # The other order is untouched.
    assert Schedule.matches(w) == [a, b]


@pytest.mark.asyncio
async def test_a_match_cannot_be_moved_across_a_queue_boundary_by_moving_it():
    """Position and membership are different verbs. Walking the last match of one
    order 'down' must not spill it into the next one."""
    w, l = await two_queues()
    a, b = await make_match(), await make_match("C", "D")
    await Schedule.append(a, w)
    await Schedule.append(b, l)

    await move_queued_match(a, 5)

    assert Schedule.matches(w) == [a]
    assert Schedule.matches(l) == [b]


@pytest.mark.asyncio
async def test_dequeue_and_delete_clear_a_match_from_every_order():
    w, l = await two_queues()
    a, b = await make_match(), await make_match("C", "D")
    await Schedule.append(a, w)
    await Schedule.append(b, l)

    await dequeue_match(b)
    assert Schedule.matches(l) == []

    await delete_match(a)
    assert Schedule.matches(w) == []
    assert deep_get(State.state, "schedule.queue") == []


# --- which queue a board draws from ---------------------------------------


@pytest.mark.asyncio
async def test_an_unassigned_board_draws_from_the_first_queue(rig):
    """A single-queue rig needs no configuration, which is what keeps one-click Up
    next working for everyone who never creates a second order."""
    rig(1)
    w, l = await two_queues()
    a, b = await make_match(), await make_match("C", "D")
    await Schedule.append(a, w)
    await Schedule.append(b, l)

    assert Schedule.queue_for_board(1) == w
    assert Schedule.next_up_for_board(1) == a


@pytest.mark.asyncio
async def test_a_board_assigned_to_a_queue_takes_from_it(rig):
    rig(1, 2)
    w, l = await two_queues()
    a, b = await make_match(), await make_match("C", "D")
    await Schedule.append(a, w)
    await Schedule.append(b, l)
    await Settings.Set("scoreboards.match_queue.2", l)

    assert Schedule.next_up_for_board(2) == b
    result = await take_next_match(2)
    assert result["match"] == b
    assert Match.bound_scoreboards(b) == [2]


@pytest.mark.asyncio
async def test_the_override_lets_one_board_pull_from_either_order(rig):
    """The Winners/Losers case on a single-board rig: the board defaults to one
    order but a producer can take from the other without reassigning it."""
    rig(1)
    w, l = await two_queues()
    a, b = await make_match(), await make_match("C", "D")
    await Schedule.append(a, w)
    await Schedule.append(b, l)

    result = await take_next_match(1, queue=l)

    assert result["match"] == b
    # The default is unchanged — the override was for this press only.
    assert Schedule.queue_for_board(1) == w


@pytest.mark.asyncio
async def test_taking_from_a_queue_that_does_not_exist_is_a_404(rig):
    rig(1)
    await two_queues()
    a = await make_match()
    await Schedule.append(a)
    with pytest.raises(HTTPException) as exc:
        await take_next_match(1, queue="nope")
    assert exc.value.status_code == 404
    assert Match.bound_scoreboards(a) == []


@pytest.mark.asyncio
async def test_a_board_pointed_at_a_deleted_queue_falls_back(rig):
    """Assignments are resolved at read time, never rewritten — a stale one degrades
    to the first order instead of leaving the board with no Up next at all."""
    rig(1, 2)
    w, l = await two_queues()
    a = await make_match()
    await Schedule.append(a, w)
    await Settings.Set("scoreboards.match_queue.2", l)
    await delete_queue(l)

    assert Schedule.queue_for_board(2) == w
    assert Schedule.next_up_for_board(2) == a


# --- the queues themselves -------------------------------------------------


@pytest.mark.asyncio
async def test_a_new_match_enrols_in_the_first_queue():
    w, l = await two_queues()
    out = await create_match()
    assert Schedule.matches(w) == [out["id"]]
    assert Schedule.matches(l) == []


@pytest.mark.asyncio
async def test_the_last_running_order_cannot_be_removed():
    """A rig with no queues has nowhere for a new fixture to enrol and no answer
    for what is next on a board — the same reason one scoreboard always remains."""
    await Schedule.ensure_migrated()
    with pytest.raises(HTTPException) as exc:
        await delete_queue(Schedule.first_queue_id())
    assert exc.value.status_code == 409
    assert len(Schedule.queues()) == 1


@pytest.mark.asyncio
async def test_deleting_a_queue_keeps_its_matches():
    w, l = await two_queues()
    b = await make_match("C", "D")
    await Schedule.append(b, l)

    await delete_queue(l)

    assert Match.exists(b)
    assert Schedule.queue_of(b) is None


@pytest.mark.asyncio
async def test_renaming_a_queue_keeps_its_id_so_assignments_survive():
    """The id is minted once from the title; renaming edits only the title, which
    is the only field any surface displays."""
    w, l = await two_queues()
    await Settings.Set("scoreboards.match_queue.1", l)

    await rename_queue(l, QueuePayload(title="Elimination Bracket"))

    assert Schedule.get_queue(l)["title"] == "Elimination Bracket"
    assert Schedule.queue_for_board(1) == l


def test_queue_ids_are_slugs_and_never_collide():
    assert queue_id_for("Winners", {}) == "winners"
    assert queue_id_for("Top Cut!", {}) == "top-cut"
    assert queue_id_for("Winners", {"winners"}) == "winners-2"
    assert queue_id_for("Winners", {"winners", "winners-2"}) == "winners-3"
    # An untitled queue still gets a usable id rather than an empty one.
    assert queue_id_for("", {}) == "queue"
    assert queue_id_for("!!!", {}) == "queue"

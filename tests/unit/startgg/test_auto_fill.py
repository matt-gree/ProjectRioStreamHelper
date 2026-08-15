"""The tournamentInfo auto-fill contract.

A field start.gg supplies is overwritten only while the producer hasn't taken it
over: still empty, or still equal to what we last filled it with (recorded per
field in ``tournamentInfo._auto``). Two paths write through it — the event load
(five fields, once per event) and ``apply_startgg_set`` (``phase``, once per
set) — and the second one used to write unconditionally, so a hand-typed
Competition Phase was destroyed by the next fixture loaded.
"""
import pytest

from server.api.v1.match import apply_startgg_set
from server.match import Match, default_match
from server.startgg.provider import auto_fill_entries
from server.state import State


def info():
    return State.state.get("tournamentInfo", {}) or {}


async def make_match() -> int:
    m = Match.next_id()
    await State.Set(f"match.{m}", default_match())
    return m


async def test_fills_an_empty_field_and_records_it():
    await State.SetBatch(auto_fill_entries({"phase": "Top Cut"}))
    assert info()["phase"] == "Top Cut"
    assert info()["_auto"]["phase"] == "Top Cut"


async def test_refill_updates_a_field_the_producer_never_touched():
    await State.SetBatch(auto_fill_entries({"phase": "Swiss"}))
    await State.SetBatch(auto_fill_entries({"phase": "Top Cut"}))
    assert info()["phase"] == "Top Cut"


async def test_a_hand_typed_value_survives_the_next_fill():
    """The regression. Producer types over an auto-filled field; the next set
    load must leave it alone — and must still record what start.gg said, so
    re-blanking the field hands it back to auto-fill."""
    await State.SetBatch(auto_fill_entries({"phase": "Swiss"}))
    await State.Set("tournamentInfo.phase", "Season 9 Week 2")
    await State.SetBatch(auto_fill_entries({"phase": "Top Cut"}))
    assert info()["phase"] == "Season 9 Week 2"
    assert info()["_auto"]["phase"] == "Top Cut"


async def test_reblanking_a_field_re_enables_auto_fill():
    await State.SetBatch(auto_fill_entries({"phase": "Swiss"}))
    await State.Set("tournamentInfo.phase", "Mine")
    await State.Set("tournamentInfo.phase", "")
    await State.SetBatch(auto_fill_entries({"phase": "Top Cut"}))
    assert info()["phase"] == "Top Cut"


async def test_skip_blank_leaves_the_field_alone():
    """A set that doesn't report a phase says nothing about it — as opposed to an
    event whose address is genuinely empty, which clears."""
    await State.Set("tournamentInfo.phase", "Season 9 Week 2")
    assert auto_fill_entries({"phase": ""}, skip_blank=True) == []
    # Without the flag, an auto-filled field the event no longer reports clears.
    await State.SetBatch(auto_fill_entries({"location": "Chicago, IL"}))
    await State.SetBatch(auto_fill_entries({"location": ""}))
    assert info()["location"] == ""


async def test_the_record_merges_rather_than_replacing():
    """An event reload must not forget what a set load filled: dropping `phase`
    from the record would make an auto-filled phase look producer-typed, and it
    would stop tracking start.gg from then on."""
    await State.SetBatch(auto_fill_entries({"phase": "Swiss"}, skip_blank=True))
    await State.SetBatch(auto_fill_entries({"name": "Slice 2026", "date": "Aug 15"}))
    assert info()["_auto"]["phase"] == "Swiss"
    await State.SetBatch(auto_fill_entries({"phase": "Top Cut"}, skip_blank=True))
    assert info()["phase"] == "Top Cut"


@pytest.mark.parametrize("typed,expected", [(None, "Bracket"), ("Season 9 Week 2", "Season 9 Week 2")])
async def test_loading_a_set_respects_the_producers_phase(typed, expected):
    """End to end through the real caller."""
    if typed:
        await State.Set("tournamentInfo.phase", typed)
    m = await make_match()
    await apply_startgg_set(m, {
        "id": 555, "round_name": "Winners Round 2", "totalGames": 3,
        "tournament_phase": "Bracket", "entrants": [[], []],
    }, 555)
    assert info()["phase"] == expected
    # The per-match copy is this set's own fact and is always written.
    assert State.state["match"][str(m)]["phase"] == "Bracket"

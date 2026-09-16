"""A SERIES MAY NOT HOLD MORE GAMES THAN THE FORMAT ALLOWS.

The Match desk's steppers are the only surface that writes `series` by hand and
they cap themselves, but `PUT /match/{m}` is a plain REST call — so the rule
belongs to the RECORD rather than to one panel, and the clamp in the console is
what stops a producer reaching a refusal they would otherwise have to read.

Stated as "may not INCREASE past the format", because the two readings come
apart on the one move that has to stay available: lowering `bestOf` under a
series already longer than it.
"""
import pytest
from fastapi import HTTPException

from server.api.v1.match import MatchPayload, update_match
from server.match import Match, default_match
from server.state import State
from server.utils.deep_dict import deep_get


async def make_match(best_of: int = 2, w1: int = 0, w2: int = 0) -> int:
    m = Match.next_id()
    match = default_match()
    match["format"]["bestOf"] = best_of
    match["series"] = {"1": w1, "2": w2}
    await State.Set(f"match.{m}", match)
    return m


def series(m) -> tuple[int, int]:
    s = deep_get(State.state, f"match.{m}.series") or {}
    return int(s.get("1") or 0), int(s.get("2") or 0)


@pytest.mark.asyncio
async def test_a_doubleheader_refuses_a_third_game():
    m = await make_match(best_of=2, w1=1, w2=1)
    with pytest.raises(HTTPException) as err:
        await update_match(m, MatchPayload(series={"1": 2}))
    assert err.value.status_code == 409
    assert series(m) == (1, 1)


@pytest.mark.asyncio
async def test_a_bo1_refuses_a_second():
    m = await make_match(best_of=1, w1=1, w2=0)
    with pytest.raises(HTTPException):
        await update_match(m, MatchPayload(series={"2": 1}))
    assert series(m) == (1, 0)


@pytest.mark.asyncio
async def test_the_last_game_the_format_holds_is_allowed():
    """The cap is the format, not one below it — a DH's second game is the
    ordinary case, not an overflow."""
    m = await make_match(best_of=2, w1=1, w2=0)
    await update_match(m, MatchPayload(series={"2": 1}))
    assert series(m) == (1, 1)


@pytest.mark.asyncio
async def test_a_format_arriving_in_the_same_write_is_the_one_that_counts():
    """A PUT carrying both is judged on the format it is setting, not the one it
    is replacing — otherwise widening a fixture and scoring it in one call would
    be refused against the old ceiling."""
    m = await make_match(best_of=1, w1=1, w2=0)
    await update_match(m, MatchPayload(format={"bestOf": 3}, series={"2": 1}))
    assert series(m) == (1, 1)


@pytest.mark.asyncio
async def test_an_over_full_series_can_still_be_corrected_down():
    """LOWERING `bestOf` under a longer series is not adding a game. Refusing
    the correction out of it would trap the producer in a format they cannot
    leave without first zeroing a score that is on air.
    """
    m = await make_match(best_of=1, w1=2, w2=1)
    await update_match(m, MatchPayload(series={"1": 1}))
    assert series(m) == (1, 1)
    # ...and still refuses to make it longer.
    with pytest.raises(HTTPException):
        await update_match(m, MatchPayload(series={"1": 2}))


@pytest.mark.asyncio
async def test_a_write_that_touches_no_series_is_never_judged():
    """Every other field on the fixture goes through this route too."""
    m = await make_match(best_of=1, w1=2, w2=1)
    await update_match(m, MatchPayload(label="Grand Final"))
    assert deep_get(State.state, f"match.{m}.label") == "Grand Final"

"""Match.project_scoreboard: a captain-less match must never blank an
already-populated board (e.g. a live HUD game's real roster)."""
import pytest

from server.match import Match, default_match
from server.state import State
from server.utils.deep_dict import deep_get


async def make_match(captain: str = "") -> int:
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = "Alice"
    match["player"]["1"]["captain"] = captain
    await State.Set(f"match.{m}", match)
    return m


@pytest.mark.asyncio
async def test_blank_captain_does_not_clear_live_hud_roster():
    await State.Set("score.1.player.1.rioName", "Alice")
    await State.Set("score.1.player.1.character.0.name", "Mario")
    await State.Set("score.1.player.1.rio_captainIndex", 3)

    m = await make_match(captain="")
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.character.0.name") == "Mario"
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == 3


@pytest.mark.asyncio
async def test_blank_captain_blanks_an_empty_board():
    m = await make_match(captain="")
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.character.0.name") == ""
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == ""


@pytest.mark.asyncio
async def test_real_captain_still_projects_onto_a_live_board():
    await State.Set("score.1.player.1.rioName", "Alice")
    await State.Set("score.1.player.1.character.0.name", "Mario")
    await State.Set("score.1.player.1.rio_captainIndex", 3)

    m = await make_match(captain="Luigi")
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.character.0.name") == "Luigi"
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == 0

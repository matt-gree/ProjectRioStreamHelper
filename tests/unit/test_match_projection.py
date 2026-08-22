"""Match.project_scoreboard and the feed-shared key rule.

`score.{N}.player.{T}.*` is the one place a projector and a live feed both write.
The projector writes its full key set (value or "") so re-projection is
deterministic and unbinding blanks exactly what it set — but over a board
carrying a real game, a key it has no value for must defer to the feed instead of
blanking it. See `_FEED_SHARED_KEYS` / `_OPTIONAL_PICK_KEYS` in server/match.py.
"""
import pytest

from server.match import Match, default_match
from server.participants import Participants
from server.state import State
from server.utils.deep_dict import deep_get


async def make_match(captain: str = "", rio_name: str = "Alice") -> int:
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = rio_name
    match["player"]["1"]["captain"] = captain
    await State.Set(f"match.{m}", match)
    return m


async def seed_live_game(sb: int = 1) -> None:
    """A board carrying a real feed game.

    `game_id` is what makes it a FEED game rather than a leftover projection —
    it is the discriminator `_board_side_has_feed_data` keys on, so a test that
    omits it is not simulating a live board at all.
    """
    await State.SetBatch([
        (f"score.{sb}.game_id", "4077258482"),
        (f"score.{sb}.player.1.rioName", "Alice"),
        (f"score.{sb}.player.1.msb_team", "Bowser Blue Shells"),
        (f"score.{sb}.player.1.character.0.name", "Mario"),
        (f"score.{sb}.player.1.rio_captainIndex", 3),
        (f"score.{sb}.player.1.port", 2),
    ])


# ----- the captain carve-out this rule generalises --------------------------

@pytest.mark.asyncio
async def test_blank_captain_does_not_clear_live_hud_roster():
    await seed_live_game()

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
    await seed_live_game()

    m = await make_match(captain="Luigi")
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.character.0.name") == "Luigi"
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == 0


# ----- the rule itself ------------------------------------------------------

@pytest.mark.asyncio
async def test_unbinding_never_blanks_the_names_of_a_live_game():
    """The bug this rule was written for.

    Unbinding a match mid-game blanked both sides' `rioName` while the board kept
    its team, roster, batter and inning — so the Quick Rail reported "No game on
    this board yet" for a board at inning 9, and the scoreboard went nameless
    until the next HUD frame, which never comes while the feed is idle.
    """
    await seed_live_game()

    await Match.project_scoreboard(1, None)

    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"
    assert deep_get(State.state, "score.1.player.1.port") == 2
    assert deep_get(State.state, "score.1.player.1.msb_team") == "Bowser Blue Shells"


@pytest.mark.asyncio
async def test_unbinding_still_blanks_a_board_with_no_game():
    """The mirror-image bug the full-key-set rule exists to prevent: a fixture
    projected onto a board with no game must not survive its own unbind."""
    m = await make_match()
    await Match.project_scoreboard(1, m)
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"

    await Match.project_scoreboard(1, None)

    assert deep_get(State.state, "score.1.player.1.rioName") == ""


@pytest.mark.asyncio
async def test_a_fixture_without_a_port_pick_does_not_clear_the_live_port():
    """An unpicked port is not a claim that the player has none — the live game
    knows. Same reasoning as the captain."""
    await seed_live_game()

    m = await make_match()
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.port") == 2


@pytest.mark.asyncio
async def test_a_resolved_participants_blank_display_field_still_wins():
    """The other half of the rule: a participant who has no twitter really has
    none, so re-binding from someone who does to someone who doesn't must clear
    it. Deferring on every empty value would trade one stale-data bug for its
    mirror image."""
    await seed_live_game()
    await State.Set("score.1.player.1.twitter", "@old")

    pid = (await Participants.Create({
        "identities": {"rioName": "Alice"},
        "display": {"tag": "Alice"},
    }))["id"]
    m = Match.next_id()
    match = default_match()
    match["player"]["1"] = {**match["player"]["1"], "participantId": pid, "rioName": "Alice"}
    await State.Set(f"match.{m}", match)

    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.twitter") == ""
    assert deep_get(State.state, "score.1.player.1.name") == "Alice"

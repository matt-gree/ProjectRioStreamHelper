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
async def test_a_captain_pick_projects_onto_a_board_with_no_game():
    """The case the captain-only projection exists for: a drafted fixture, no
    game yet. Slot 0 stands in for a roster nobody has played."""
    m = await make_match(captain="Luigi")
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.character.0.name") == "Luigi"
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == 0


@pytest.mark.asyncio
async def test_a_captain_pick_never_overwrites_a_live_games_roster():
    """A stand-in for a roster, not a correction to one.

    This test asserted the opposite until 2026-08-29, and the behaviour it
    pinned was the bug: over a live game the fixture's pick was written into
    roster slot 0 and rio_captainIndex forced to 0, so a board whose real
    captain was Mario-at-3 drew slot 0 and called it the captain. Every overlay
    that resolves the captain BY INDEX — the scoreboard's team-logo fallback,
    the Game Summary hero art — was then naming the wrong character for the
    length of the broadcast.

    The feed-shared deferral could not catch it: that rule only reconsiders keys
    the projector left EMPTY, and these two are only wrong when it has a value.
    """
    await seed_live_game()

    m = await make_match(captain="Luigi")
    await Match.project_scoreboard(1, m)

    # the feed's roster and captain index, untouched
    assert deep_get(State.state, "score.1.player.1.character.0.name") == "Mario"
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == 3
    # ...while the rest of the projection still lands
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"


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


# ----- rule B: a stand-in pick defers when it HAS a value -------------------
#
# `port` is the controller overlay's input (controller-mount.js iframes
# gc-overlay at score.{N}.player.{T}.port), so an authored pick winning over a
# live game is the wrong pad on air, not a cosmetic disagreement.


async def make_port_match(port, rio_name: str = "Alice") -> int:
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = rio_name
    match["player"]["1"]["port"] = port
    await State.Set(f"match.{m}", match)
    return m


@pytest.mark.asyncio
async def test_a_fixture_port_never_overrides_the_live_one():
    await seed_live_game()          # HUD has Alice on port 2

    m = await make_port_match(0)    # producer picked P1 pre-match
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.port") == 2


@pytest.mark.asyncio
async def test_a_fixture_port_seats_a_board_with_no_game():
    """Before a game exists the pick is the only answer there is — which is the
    whole reason the field is authored."""
    m = await make_port_match(0)
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.port") == 0


@pytest.mark.asyncio
async def test_a_fixture_port_stays_off_a_completed_game():
    """apply_completed_game_to_state clears port to None BECAUSE a finished game
    has no live controller. Writing the pick back over that brought the overlay
    back for a game already over."""
    await State.SetBatch([
        ("score.1.game_id", "4077258482"),
        ("score.1.player.1.rioName", "Alice"),
        ("score.1.player.1.port", None),
        ("score.1.game_completed", True),
    ])

    m = await make_port_match(3)
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.player.1.port") is None


@pytest.mark.asyncio
async def test_unbinding_clears_the_port_on_an_idle_board():
    """Rule B only defers over a FEED. With no game, the full-key-set blank
    still applies, so unbinding leaves nothing of the fixture behind."""
    m = await make_port_match(2)
    await Match.project_scoreboard(1, m)
    assert deep_get(State.state, "score.1.player.1.port") == 2

    await Match.clear_scoreboard(1)
    assert deep_get(State.state, "score.1.player.1.port") == ""


# ----- tag_set is the game's id, and the projector does not own it ----------


@pytest.mark.asyncio
async def test_the_projector_does_not_write_the_boards_tag_set():
    """`score.{N}.tag_set` is an int tag-set ID written by both feeds; the
    resolved NAME lives in `score.{N}.game_mode`. The projector was writing a
    name string into the id slot."""
    await State.SetBatch([
        ("score.1.game_id", "4077258482"),
        ("score.1.tag_set", 210),
        ("score.1.player.1.rioName", "Alice"),
    ])

    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = "Alice"
    match["gameMode"] = "Ranked Superstar"
    await State.Set(f"match.{m}", match)
    await Match.project_scoreboard(1, m)

    assert deep_get(State.state, "score.1.tag_set") == 210


@pytest.mark.asyncio
async def test_unbinding_does_not_blank_the_live_games_tag_set():
    await State.SetBatch([
        ("score.1.game_id", "4077258482"),
        ("score.1.tag_set", 210),
    ])
    await Match.clear_scoreboard(1)

    assert deep_get(State.state, "score.1.tag_set") == 210


# ---------------------------------------------------------------------------
# A board that booted holding last night's game is not a feed
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_restored_board_is_not_treated_as_a_live_feed():
    """The cold start: last night's game is still on the board and the producer
    binds tonight's fixture.

    `game_id` alone could not tell this from a game in progress, so the fixture
    deferred every blank to last night's players and dropped both of the picks
    that only exist BEFORE a game — the new name landed and everything behind it
    stayed, which is what "the new match attaches to the previous scoreboard"
    was.
    """
    await State.SetBatch([
        ("score.1.game_id", "yesterday"),
        ("score.1.game_over", True),
        ("score.1.restored", True),
        ("score.1.player.1.rioName", "LastNight"),
    ])
    assert Match._board_side_has_feed_data(1, 1) is False

    m = await make_port_match(3)
    await Match.project_scoreboard(1, m)

    # The picks land, because there is no feed to outrank them.
    assert deep_get(State.state, "score.1.player.1.port") == 3


@pytest.mark.asyncio
async def test_a_game_still_being_shown_outranks_the_picks():
    """The other half of the same rule, so neither can be widened alone.

    A completed record on screen is CONTENT — real ports, real captain, real
    names — and a draft pick must not overwrite it (see
    `test_a_fixture_port_stays_off_a_completed_game`). Only `restored` is residue.
    """
    await State.SetBatch([
        ("score.1.game_id", "tonight"),
        ("score.1.game_over", True),
        ("score.1.restored", False),
        ("score.1.player.1.rioName", "Alice"),
    ])
    assert Match._board_side_has_feed_data(1, 1) is True


# ---------------------------------------------------------------------------
# Clearing a board hands it back to its fixture
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_clearing_a_board_restores_the_bound_fixtures_names():
    """The bug the producer hit as "clear it and the names vanish".

    The projector jointly owns `player.{T}.*` and runs only on a bind or a fixture
    mutation, so a clear built from plain state writes blanked the fixture's names
    with nothing left to restore them: the fixture slot still read `M2 · Alice vs
    Bob` while the scoreboard drew nobody, until the next bind or edit healed it.
    The workaround was knowing to clear BEFORE binding and never after.

    `release_and_clear_game` blanks and THEN re-projects, so the order does the
    work: a board with no `game_id` is one the projector writes its full key set
    to, picks included.
    """
    from server.rio.provider import release_and_clear_game

    m = await make_match(captain="Birdo", rio_name="Alice")
    await seed_live_game(1)
    await Match.project_scoreboard(1, m)
    await State.Set("score.1.match", m)
    # Mid-game, the fixture defers to the feed: the real captain stands.
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == 3

    await release_and_clear_game(1)

    # The game is gone...
    assert deep_get(State.state, "score.1.game_id") is None
    assert deep_get(State.state, "score.1.inning") == 1
    # ...and the fixture is back, rather than the board going nameless.
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"
    # With its picks, which only a board with no feed may take.
    assert deep_get(State.state, "score.1.player.1.character.0.name") == "Birdo"
    assert deep_get(State.state, "score.1.player.1.rio_captainIndex") == 0


@pytest.mark.asyncio
async def test_clearing_an_unbound_board_leaves_it_empty():
    """No fixture, nothing to hand back to — the clear is just a clear.

    Worth pinning beside the above: the re-projection must be conditional on a
    binding, or a board with no match would have the projector called with a falsy
    `m`, which is the BLANK path and would work by accident rather than by rule.
    """
    from server.rio.provider import release_and_clear_game

    await seed_live_game(1)
    await release_and_clear_game(1)

    assert deep_get(State.state, "score.1.game_id") is None
    assert deep_get(State.state, "score.1.player.1.rioName") == ""


# ---------------------------------------------------------------------------
# BINDING IS AUTHORING; TAKING IS TURNOVER — only the second clears the board
# ---------------------------------------------------------------------------

async def _finished_hud_game_on_board_1():
    await State.SetBatch([
        ("score.1.game_id", "lastgame"),
        ("score.1.game_over", True),
        ("score.1.score_left", 8),
        ("score.1.inning", 6),
        ("score.1.stadium", "Mario Stadium"),
        ("score.1.player.1.rioName", "Yesterday"),
    ])


@pytest.mark.asyncio
async def test_attaching_a_match_never_blanks_a_hud_board():
    """ATTACHING A FIXTURE IS NOT A REQUEST TO DELETE A GAME.

    The clear ran inside `bind_board`, so every path that attaches a fixture
    inherited it — the Match desk's board chips, the board desk's bind,
    `/startgg/load-set`. On a HUD board the game on screen is whatever Project Rio
    is showing, and saying "this game is Match 5" is the ordinary working gesture,
    so the console answered it by blanking the producer's scoreboard. Nothing asked
    for a removal and nothing said one had happened.
    """
    from server.api.v1.match import bind_board

    await _finished_hud_game_on_board_1()
    m = await make_match(rio_name="Alice")

    await bind_board(1, m)

    assert deep_get(State.state, "score.1.game_id") == "lastgame"
    assert deep_get(State.state, "score.1.score_left") == 8
    assert deep_get(State.state, "score.1.stadium") == "Mario Stadium"
    # The fixture still lands — this is about what binding LEAVES ALONE, not about
    # binding doing less.
    assert deep_get(State.state, "score.1.match") == m


@pytest.mark.asyncio
async def test_the_take_is_the_verb_that_turns_a_board_over():
    """...and the clear lives there, where the producer's button says so.

    "Putting the next match up is how a board turns over" is still true; it was
    just wired to the wrong gesture.
    """
    from server.api.v1.match import bind_board

    await _finished_hud_game_on_board_1()
    m = await make_match(rio_name="Alice")

    await bind_board(1, m, supersede=True)

    assert deep_get(State.state, "score.1.game_id") is None
    assert deep_get(State.state, "score.1.score_left") == 0
    assert deep_get(State.state, "score.1.inning") == 1
    assert deep_get(State.state, "score.1.stadium") == ""
    # And the new fixture is on it, not the old game's player.
    assert deep_get(State.state, "score.1.player.1.rioName") == "Alice"


@pytest.mark.asyncio
async def test_binding_mid_game_leaves_the_game_alone():
    """Binding mid-game is a real move — it is why the identity gate exists.

    The gate on the clear is the game being OVER, never the bind itself.
    """
    from server.api.v1.match import bind_board

    await seed_live_game(1)
    await State.Set("score.1.score_left", 4)
    m = await make_match(rio_name="Alice")

    await bind_board(1, m, supersede=True)

    assert deep_get(State.state, "score.1.game_id") == "4077258482"
    assert deep_get(State.state, "score.1.score_left") == 4


@pytest.mark.asyncio
async def test_binding_over_a_completed_api_record_leaves_it_alone(monkeypatch):
    """An API board's POOL owns its slot, so a completed record there is CONTENT.

    Real ports, a real captain and real names — the same content the feed-shared
    rule protects from a draft pick — and a fixture bound to label it is
    legitimate. Clearing it would destroy exactly that, and for a live API game the
    pool would re-push it a second later anyway.
    """
    from server.api.v1 import match as match_api

    monkeypatch.setattr(match_api, "transport", lambda sb: "api")
    await State.SetBatch([
        ("score.2.game_id", "completed-record"),
        ("score.2.game_completed", True),
        ("score.2.score_left", 8),
    ])
    m = await make_match(rio_name="Alice")

    await match_api.bind_board(2, m, supersede=True)

    assert deep_get(State.state, "score.2.game_id") == "completed-record"
    assert deep_get(State.state, "score.2.score_left") == 8


@pytest.mark.asyncio
async def test_a_take_over_a_restored_api_board_does_clear_it(monkeypatch):
    """The exception to the exception: residue is residue on any transport.

    Nothing chose a restored game this session — not a producer, not a pool — so
    the pool-owns-the-slot argument above does not reach it.
    """
    from server.api.v1 import match as match_api

    monkeypatch.setattr(match_api, "transport", lambda sb: "api")
    await State.SetBatch([
        ("score.2.game_id", "yesterday"),
        ("score.2.game_completed", True),
        ("score.2.restored", True),
        ("score.2.score_left", 8),
    ])
    m = await make_match(rio_name="Alice")

    await match_api.bind_board(2, m, supersede=True)

    assert deep_get(State.state, "score.2.game_id") is None
    assert deep_get(State.state, "score.2.score_left") == 0

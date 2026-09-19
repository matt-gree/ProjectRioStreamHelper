"""The `restored` flag: set once at boot, cleared by any real frame.

The cold-start case has no test that can be written from inside one process
without saying what boot MEANS, so it is said here: State already holds a game
(that is what `State.Load` does), `mark_restored` runs, and the flag decays the
moment a feed writes.
"""
import pytest

from server import boards
from server.rio.provider import apply_parsed_game_to_state
from server.settings import Settings
from server.state import State
from server.utils.deep_dict import deep_get


@pytest.mark.asyncio
async def test_a_board_that_booted_holding_a_game_is_marked_not_current():
    await Settings.Set("scoreboards.active", [1, 2])
    # What `State.Load` leaves behind after a night: board 1 carries a game,
    # board 2 never had one.
    await State.Set("score.1.game_id", "yesterday")

    await boards.mark_restored()

    assert deep_get(State.state, "score.1.restored") is True
    assert boards.board_lifecycle(1) == "restored"
    assert boards.is_stale(boards.board_lifecycle(1)) is True
    # An empty board is not "restored empty" — the flag describes a GAME's
    # provenance, so a board with no game gets no key at all.
    assert deep_get(State.state, "score.2.restored") is None
    assert boards.board_lifecycle(2) == "empty"


@pytest.mark.asyncio
async def test_the_flag_decays_on_the_next_real_frame():
    """No producer action clears this, which is the whole reason it is a flag
    and not a session boundary."""
    await Settings.Set("scoreboards.active", [1])
    await State.Set("score.1.game_id", "yesterday")
    await boards.mark_restored()
    assert boards.board_lifecycle(1) == "restored"

    await apply_parsed_game_to_state(
        {"game_id": "tonight", "away_player": {}, "home_player": {}}, 1
    )

    assert deep_get(State.state, "score.1.restored") is False
    assert boards.board_lifecycle(1) == "live"


@pytest.mark.asyncio
async def test_a_finished_game_still_reads_restored_after_a_boot():
    """Last night's board is both restored and final, and `restored` wins:
    FINAL there reads as "a game just finished here", which is the one thing it
    is not."""
    await Settings.Set("scoreboards.active", [1])
    await State.SetBatch([
        ("score.1.game_id", "yesterday"),
        ("score.1.game_over", True),
    ])
    await boards.mark_restored()

    assert boards.board_lifecycle(1) == "restored"

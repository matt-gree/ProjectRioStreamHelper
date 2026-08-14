"""A board's game mode: the feed's answer, or the producer's pick.

`stats_tag` used to be one key doing two jobs. Four paths wrote it from whatever
game had just landed — the HUD frame handler, the game-pool assign, a rotation
advance and the Match projector — each with its own guard, and none of them could
tell a mode the producer had CHOSEN from one the feed had set. So "the live mode
never took over" and "my pick got clobbered" were the same bug seen from two ends.

`stats_tag_manual` is the distinction, and it works like
`player.{T}.rioName_override`: the pick wins, it sticks against the feed, and the
console calls it out. `sync_stats_tag` is the one auto-sync writer, so the rule is
stated once and every feed path inherits it.
"""
import pytest

from server.bindings import (
    binding_stats_tag,
    get_binding,
    stats_tag_is_manual,
    sync_stats_tag,
)
from server.settings import Settings


async def test_sync_writes_the_feeds_mode_on_an_untouched_board(mock_socket):
    assert await sync_stats_tag(1, "Ranked") is True
    assert binding_stats_tag(1) == "Ranked"


async def test_sync_overwrites_an_older_feed_mode(mock_socket, set_setting):
    """The bug from the "didn't overwrite" end: a board that has been left on a
    previous game's mode must follow the new game, not the memory."""
    set_setting("scoreboards.binding.1.stats_tag", "S14 Superstars Off")
    assert await sync_stats_tag(1, "SLAMB Spring Training") is True
    assert binding_stats_tag(1) == "SLAMB Spring Training"


async def test_sync_leaves_a_producers_pick_alone(mock_socket, set_setting):
    """The other end of the same bug: an override is allowed to disagree with the
    feed. It is the console's job to say so, not the feed's job to win."""
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    set_setting("scoreboards.binding.1.stats_tag_manual", True)
    assert await sync_stats_tag(1, "SLAMB Spring Training") is False
    assert binding_stats_tag(1) == "Ranked"


async def test_sync_clears_an_unknown_mode(mock_socket, set_setting):
    """Leaving the last game's mode on a board whose game we cannot name is how a
    stats fetch ends up running against the wrong tag."""
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    assert await sync_stats_tag(1, "") is True
    assert binding_stats_tag(1) == ""


async def test_sync_treats_an_unresolved_tag_set_id_as_unknown(mock_socket, set_setting):
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    assert await sync_stats_tag(1, "ID:198") is True
    assert binding_stats_tag(1) == ""


async def test_sync_skips_a_redundant_write(mock_socket, set_setting):
    """It runs on the HUD frame path and on every rotation advance, so an
    unchanged value must not emit."""
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    assert await sync_stats_tag(1, "Ranked") is False


def test_a_board_defaults_to_following_the_feed():
    assert stats_tag_is_manual(1) is False
    assert get_binding(1)["stats_tag_manual"] is False


@pytest.mark.parametrize("flag,expected", [(True, True), (False, False), (None, False)])
def test_manual_flag_reads_as_a_bool(set_setting, flag, expected):
    set_setting("scoreboards.binding.1.stats_tag_manual", flag)
    assert stats_tag_is_manual(1) is expected


async def _fixture_with_mode(mode: str) -> int:
    from server.match import Match, default_match
    from server.state import State

    m = Match.next_id()
    match = default_match()
    match["gameMode"] = mode
    await State.Set(f"match.{m}", match)
    return m


async def test_the_match_projector_follows_the_fixtures_mode(mock_socket):
    from server.match import Match

    m = await _fixture_with_mode("SLAMB Spring Training")
    await Match.project_scoreboard(1, m)
    assert binding_stats_tag(1) == "SLAMB Spring Training"


async def test_the_match_projector_respects_an_override(mock_socket, set_setting):
    """A fixture's mode is authored, but it is authored about the FIXTURE — the
    board's own override is the more specific answer and wins."""
    from server.match import Match

    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    set_setting("scoreboards.binding.1.stats_tag_manual", True)
    m = await _fixture_with_mode("SLAMB Spring Training")
    await Match.project_scoreboard(1, m)
    assert binding_stats_tag(1) == "Ranked"

"""Player-side orientation — the Phase-5 unified cascade + override state machine.

This is the highest-risk logic in the app (CLAUDE.md § Player-Side Cascade).
Since the Draft→Live reconciliation (Phase 5) the responsibilities are split:

* ``_decide(left, right, sb, allow_manual)`` — the per-board cascade,
  precedence **manual > match > pin > back_to_back > none**, returning
  ``(sides_swapped, reason)``. A bound match encodes *both* sides, so it
  supersedes the pin on that board; the pin stays authoritative for every
  unbound board. The actual entrant swap happens later in
  ``_apply_game_to_state`` per board; ``_preserve_player_sides`` no longer
  mutates ``parsed``.
* ``_preserve_player_sides(parsed)`` — the manual-override state machine only:
  a new game (inning reset) clears the override and reseeds the manual base
  from the non-manual cascade; mid-game it releases the override if the user
  swapped back to the pinned orientation.

_decide is synchronous; it reads Settings.Get and the class flags on
RioGameDataProvider. The reset_singletons fixture clears those flags before
every test, so each starts from (_prev_inning=None, both flags False).
"""
import pytest

from server.match import Match
from server.rio.provider import RioGameDataProvider as P


def make_parsed(p0="A", p1="B", inning=1):
    """Minimal parsed-game dict: player p0 on the left, p1 on the right."""
    return {
        "entrants": [[{"rioName": p0}], [{"rioName": p1}]],
        "team1score": 1,
        "team2score": 2,
        "inning": inning,
    }


def left(parsed):
    return parsed["entrants"][0][0]["rioName"]


def right(parsed):
    return parsed["entrants"][1][0]["rioName"]


# --- Nothing governs: first game, no pin/match/history ---

def test_first_game_no_swap_no_reason():
    assert P._decide("A", "B") == (False, "")
    P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is False
    assert P._user_overridden is False
    # _prev_inning / _prev_player_sides now update in _apply_game_to_state,
    # after the per-board orientation has been applied.


# --- Pinned player ---

def test_pin_team1_player_already_left_no_swap(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    assert P._decide("A", "B") == (False, "pin")


def test_pin_team2_player_on_left_swaps(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 2")
    assert P._decide("A", "B") == (True, "pin")


def test_pin_team1_player_on_right_swaps(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    assert P._decide("B", "A") == (True, "pin")


def test_pin_absent_player_does_not_govern(set_setting):
    set_setting("project_rio.pinned_player", "C")
    set_setting("project_rio.pinned_side", "Team 1")
    assert P._decide("A", "B") == (False, "")


# --- Back-to-back (no pin) ---

def test_back_to_back_keeps_returning_player_in_place():
    # A was on the right (side index 1) last game; Rio now put A on the left.
    P._prev_player_sides = {"A": 1, "B": 0}
    assert P._decide("A", "B") == (True, "back_to_back")


def test_back_to_back_same_order_no_swap():
    P._prev_player_sides = {"A": 0, "B": 1}
    assert P._decide("A", "B") == (False, "back_to_back")


def test_back_to_back_no_returning_player_does_not_govern():
    P._prev_player_sides = {"C": 0, "D": 1}
    assert P._decide("A", "B") == (False, "")


# --- Precedence ---

def test_pin_overrides_back_to_back(set_setting):
    # Back-to-back alone would swap (A was on the right), but the pin keeps A
    # on Team 1 (left) and the back-to-back layer is never consulted.
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    P._prev_player_sides = {"A": 1, "B": 0}
    assert P._decide("A", "B") == (False, "pin")


def test_manual_overrides_pin(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    P._user_overridden = True
    P._sides_swapped = True
    assert P._decide("A", "B") == (True, "manual")
    # allow_manual=False (the new-game reseed path) falls through to the pin.
    assert P._decide("A", "B", allow_manual=False) == (False, "pin")


def test_match_governs_between_pin_and_b2b(monkeypatch):
    # A bound match wants A on side 2 (swap); back-to-back would say no-swap.
    monkeypatch.setattr(Match, "orientation_for_sides", classmethod(lambda cls, sb, l, r: True))
    P._prev_player_sides = {"A": 0, "B": 1}
    assert P._decide("A", "B", sb=1) == (True, "match")
    # Without a board there is no match layer: back-to-back decides.
    assert P._decide("A", "B") == (False, "back_to_back")


def test_match_overrides_pin(monkeypatch, set_setting):
    # A bound match encodes BOTH sides, so it supersedes the pin on that board
    # (Phase B). The pin still governs when no board/match is in play.
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    monkeypatch.setattr(Match, "orientation_for_sides", classmethod(lambda cls, sb, l, r: True))
    assert P._decide("A", "B", sb=1) == (True, "match")
    # sb=None (global/back-to-back orientation) has no match layer: pin decides.
    assert P._decide("A", "B", sb=None) == (False, "pin")


# --- New game resets the override state machine ---

def test_new_game_resets_flags_from_previous_game():
    P._sides_swapped = True
    P._user_overridden = True
    P._prev_player_sides = {}
    P._prev_inning = 9
    out = P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is False
    assert P._user_overridden is False
    # The pre-step never mutates the parsed entrant order (per-board
    # orientation is applied later in _apply_game_to_state).
    assert left(out) == "A" and right(out) == "B"


def test_new_game_reseeds_manual_base_from_pin(set_setting):
    # The manual base (_sides_swapped) reseeds from the non-manual cascade so a
    # later swap-button click flips from the sensible default.
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 2")
    P._prev_inning = 9
    P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is True
    assert P._user_overridden is False


# --- Mid-game (inning did not decrease) ---

def test_mid_game_user_swapped_back_to_pin_clears_override(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 2")  # pin wants swap=True
    P._prev_inning = 3
    P._user_overridden = True
    P._sides_swapped = True  # equals pin_swap → override should clear
    P._preserve_player_sides(make_parsed("A", "B", inning=3))
    assert P._user_overridden is False
    assert P._sides_swapped is True


def test_mid_game_override_held_without_pin():
    P._prev_inning = 3
    P._user_overridden = True
    P._sides_swapped = True
    out = P._preserve_player_sides(make_parsed("A", "B", inning=3))
    assert P._user_overridden is True   # no pin → nothing clears it
    assert P._sides_swapped is True
    assert left(out) == "A"             # pre-step leaves parsed untouched
    assert P._decide("A", "B") == (True, "manual")


# --- Manual toggle ---

async def test_toggle_sets_swap_and_override_flags():
    P.hud_watcher = None  # no re-apply path
    assert P._sides_swapped is False
    await P.toggle_sides_swapped()
    assert P._sides_swapped is True
    assert P._user_overridden is True
    await P.toggle_sides_swapped()
    assert P._sides_swapped is False
    assert P._user_overridden is True   # override stays set on every manual swap


# --- Released feed (hand reset vs the cached frame) ---
#
# `hud_watcher.latest_game_data` outlives a hand reset on purpose — the re-read
# needs it, and several paths re-seat it. But a manual swap RE-APPLIED it, so
# clearing a board and then swapping sides brought the whole game back (user
# report, 2026-08-08). A swap is a request to flip what is on the board, not a
# request for the feed's data.

class _FakeWatcher:
    """Just enough watcher for the swap's re-apply branch to be reachable."""
    def __init__(self, game):
        self.latest_game_data = game
        self.last_error = None


def _hud_frame():
    return {"inning": 4, "away_score": 3, "home_score": 1, "game_id": "g1"}


async def test_swap_re_applies_the_cached_frame_normally(monkeypatch):
    """The control for the test below — this is the behaviour being suppressed."""
    applied = []
    P.hud_watcher = _FakeWatcher(_hud_frame())
    monkeypatch.setattr(P, "_apply_game_to_state", classmethod(
        lambda cls, parsed: _record(applied, parsed)))

    await P.toggle_sides_swapped()
    assert len(applied) == 1


async def test_swap_after_reset_does_not_re_apply_the_cached_frame(monkeypatch):
    applied = []
    P.hud_watcher = _FakeWatcher(_hud_frame())
    monkeypatch.setattr(P, "_apply_game_to_state", classmethod(
        lambda cls, parsed: _record(applied, parsed)))

    P.release_feed()
    assert P._feed_released is True
    await P.toggle_sides_swapped()

    # The flip still happened; it just didn't drag the game back with it.
    assert P._sides_swapped is True
    assert applied == []


async def test_a_real_frame_takes_the_board_back_from_a_reset():
    P.release_feed()
    await P._on_hud_game_update_impl(_hud_frame())
    assert P._feed_released is False


async def test_an_explicit_re_read_takes_the_board_back(monkeypatch):
    P.hud_watcher = _FakeWatcher(_hud_frame())
    monkeypatch.setattr(P, "ReloadHudPath", classmethod(lambda cls: _noop()))
    monkeypatch.setattr(P, "_apply_game_to_state", classmethod(lambda cls, parsed: _dict()))
    monkeypatch.setattr(P, "_maybe_apply_hit", classmethod(lambda cls, g: _noop()))

    P.release_feed()
    await P.FetchHUDGame()
    assert P._feed_released is False


async def _record(sink, parsed):
    sink.append(parsed)
    return {}


async def _noop():
    return None


async def _dict():
    return {}


# --- _is_new_game ---

@pytest.mark.parametrize("prev,current,expected", [
    (None, 5, True),    # first read
    (5, 1, True),       # inning decreased → new game
    (5, 5, False),
    (5, 6, False),      # advanced same game
    (1, 1, False),
])
def test_is_new_game(prev, current, expected):
    P._prev_inning = prev
    assert P._is_new_game(current) is expected


@pytest.mark.parametrize("prev_id,game_id,expected", [
    ("g-1", "g-2", True),    # id changed → new game even without inning reset
    ("g-1", "g-1", False),   # same game continuing
    ("g-1", None,  False),   # frame without an id → inning fallback only
    (None,  "g-1", False),   # no baseline id yet → inning fallback only
    (123,   "123", False),   # id compare is type-insensitive (str vs int)
])
def test_is_new_game_by_game_id(prev_id, game_id, expected):
    # Same-inning frames: without the GameID check none of these are "new"
    # (a rematch abandoned in the 1st inning never decreases the inning).
    P._prev_inning = 1
    P._prev_game_id = prev_id
    assert P._is_new_game(1, game_id) is expected


# --- _swap_entrants ---

def test_swap_entrants_reverses_sides_and_scores():
    parsed = make_parsed("A", "B")
    parsed["team1score"], parsed["team2score"] = 3, 5
    out = P._swap_entrants(parsed)
    assert left(out) == "B" and right(out) == "A"
    assert out["team1score"] == 5 and out["team2score"] == 3

"""Player-side preservation — the pin / back-to-back / manual-swap state machine.

This is the highest-risk logic in the app (CLAUDE.md § Player-Side Preservation).
Each test maps to a row of the truth table in TESTING.md §5. Keep them in sync.

_preserve_player_sides is synchronous; it reads Settings.Get and mutates class
flags on RioGameDataProvider. The reset_singletons fixture clears those flags
before every test, so each starts from (_prev_inning=None, both flags False).
"""
import pytest

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


# --- Row 1: first game ever ---

def test_first_game_no_swap_and_records_sides():
    out = P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is False
    assert left(out) == "A" and right(out) == "B"
    assert P._prev_player_sides == {"A": 0, "B": 1}
    assert P._prev_inning == 1


# --- Rows 2-4: pinned player ---

def test_pin_team1_player_already_left_no_swap(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    P._prev_inning = 9  # so inning=1 reads as a new game
    out = P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is False
    assert left(out) == "A"


def test_pin_team2_player_on_left_swaps(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 2")
    P._prev_inning = 9
    out = P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is True
    assert left(out) == "B"  # A pushed to the right (Team 2)


def test_pin_team1_player_on_right_swaps(set_setting):
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    P._prev_inning = 9
    out = P._preserve_player_sides(make_parsed("B", "A", inning=1))
    assert P._sides_swapped is True
    assert left(out) == "A"  # A pulled to the left (Team 1)


# --- Rows 5-6: back-to-back (no pin) ---

def test_back_to_back_keeps_returning_player_in_place():
    # A was on the right (side 1) last game; this game Rio put A on the left.
    P._prev_player_sides = {"A": 1, "B": 0}
    P._prev_inning = 9
    out = P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is True
    assert right(out) == "A"  # A restored to the right


def test_back_to_back_same_order_no_swap():
    P._prev_player_sides = {"A": 0, "B": 1}
    P._prev_inning = 9
    out = P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is False
    assert left(out) == "A"


# --- Row 7: pin beats back-to-back ---

def test_pin_overrides_back_to_back(set_setting):
    # Back-to-back alone would swap (A was on the right), but the pin keeps A
    # on Team 1 (left) and the back-to-back branch is never consulted.
    set_setting("project_rio.pinned_player", "A")
    set_setting("project_rio.pinned_side", "Team 1")
    P._prev_player_sides = {"A": 1, "B": 0}
    P._prev_inning = 9
    out = P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is False
    assert left(out) == "A"


# --- Row 8: new game resets stale flags ---

def test_new_game_resets_flags_from_previous_game():
    P._sides_swapped = True
    P._user_overridden = True
    P._prev_player_sides = {}
    P._prev_inning = 9
    P._preserve_player_sides(make_parsed("A", "B", inning=1))
    assert P._sides_swapped is False
    assert P._user_overridden is False


# --- Rows 9-10: mid-game (inning did not decrease) ---

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
    assert left(out) == "B"             # swap still applied


# --- Row 11: manual toggle ---

async def test_toggle_sets_swap_and_override_flags():
    P.hud_watcher = None  # no re-apply path
    assert P._sides_swapped is False
    await P.toggle_sides_swapped()
    assert P._sides_swapped is True
    assert P._user_overridden is True
    await P.toggle_sides_swapped()
    assert P._sides_swapped is False
    assert P._user_overridden is True   # override stays set on every manual swap


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


# --- _swap_entrants ---

def test_swap_entrants_reverses_sides_and_scores():
    parsed = make_parsed("A", "B")
    parsed["team1score"], parsed["team2score"] = 3, 5
    out = P._swap_entrants(parsed)
    assert left(out) == "B" and right(out) == "A"
    assert out["team1score"] == 5 and out["team2score"] == 3

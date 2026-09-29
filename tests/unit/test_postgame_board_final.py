"""A capture puts the box score's FINAL on the board that played the game.

A HUD frame's scores are PRE-play and Project Rio writes no frame after the
last one, so a game ending on a scoring play stood one run short on air for good
— a 10-run mercy read 0–9 on the lower third, never FINAL. The stat file is the
only source with the last run in it.
"""
from server.postgame.capture import PostGame


class _Stat:
    def __init__(self, away, home):
        self._s = (away, home)

    def score(self, team):
        return self._s[team]


def _payload(gid="42", t1=0, t2=1):
    return {
        "gameId": gid,
        "teamNums": {"1": t1, "2": t2},
        "linescore": {"1": [0, 0, 0, 0, 0], "2": [3, 2, 0, 4, 1]},
    }


def test_the_boards_own_game_is_set_to_its_final():
    entries = dict(PostGame._settle_board_entries(1, "42", _Stat(0, 10), _payload()))
    assert entries["score.1.score_left"] == 0
    assert entries["score.1.score_right"] == 10
    assert entries["score.1.home_linescore"] == [3, 2, 0, 4, 1]
    assert entries["score.1.half_inning"] == "Final"
    assert entries["score.1.game_over"] is True


def test_the_final_follows_the_boards_seating():
    """Side 1 is whoever the board seated there — here the home player."""
    entries = dict(PostGame._settle_board_entries(1, "42", _Stat(0, 10), _payload(t1=1, t2=0)))
    assert (entries["score.1.score_left"], entries["score.1.score_right"]) == (10, 0)


def test_the_hud_writes_its_game_id_comma_grouped():
    assert PostGame._settle_board_entries(1, "1,204,527", _Stat(0, 10), _payload("1204527"))


def test_another_games_file_leaves_the_board_alone():
    """A file picked by hand may be any game; its score is not this board's."""
    assert PostGame._settle_board_entries(1, "41", _Stat(0, 10), _payload()) == []
    assert PostGame._settle_board_entries(1, "", _Stat(0, 10), _payload()) == []

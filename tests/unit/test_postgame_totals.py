"""Post-game side totals: stars won from resolved Star Chance at-bats, the
per-inning linescore reconstruction, and the aggregate block the Game Summary
callout reads (no stat-file fields exist for the first two)."""
from server import postgame_stats


def ev(half, result, star_chance=1):
    return {"Half Inning": half, "Result of AB": result, "Star Chance": star_chance}


# --- _stars_won ---

def test_stars_won_out_goes_to_fielding_team():
    # Top of the inning (half 0): away bats, so an out gives home the star.
    assert postgame_stats.stars_won([ev(0, "Out")]) == (0, 1)
    # Bottom (half 1): home bats, out goes to away.
    assert postgame_stats.stars_won([ev(1, "Strikeout")]) == (1, 0)


def test_stars_won_hit_goes_to_batting_team():
    assert postgame_stats.stars_won([ev(0, "Single")]) == (1, 0)
    assert postgame_stats.stars_won([ev(1, "HR")]) == (0, 1)


def test_stars_won_walks_go_to_batting_team():
    # A walk puts the batter on — the batting team keeps the star.
    assert postgame_stats.stars_won([ev(0, "Walk (BB)"), ev(0, "Walk (HBP)")]) == (2, 0)
    assert postgame_stats.stars_won([ev(1, "Walk (BB)")]) == (0, 1)


def test_stars_won_ignores_non_star_chance_and_unresolved():
    events = [
        ev(0, "Single", star_chance=0),   # not a star chance
        ev(0, "None"),                    # star chance, at-bat not resolved yet
        ev(1, "Caught line-drive"),       # resolved: away (fielding) wins
    ]
    assert postgame_stats.stars_won(events) == (1, 0)


def test_stars_won_accepts_numeric_result_codes():
    # Raw (undecoded) files carry the numeric final-result code.
    assert postgame_stats.stars_won([ev(0, 7), ev(1, 1)]) == (2, 0)


def test_stars_won_tolerates_junk():
    assert postgame_stats.stars_won([]) == (0, 0)
    assert postgame_stats.stars_won(None) == (0, 0)
    events = ["bogus", {"Star Chance": 1}, ev(0, None), ev(0, 3.5), ev(1, "Double")]
    assert postgame_stats.stars_won(events) == (0, 1)


# --- _linescore ---

def lev(num, inning, half, away, home):
    return {"Event Num": num, "Inning": inning, "Half Inning": half,
            "Away Score": away, "Home Score": home}


class _FinalScore:
    def __init__(self, away, home):
        self._s = {0: away, 1: home}

    def score(self, t):
        return self._s[t]


def test_linescore_attributes_runs_to_innings():
    events = [
        lev(0, 1, 0, 0, 0), lev(1, 1, 1, 1, 0),   # away scores 1 in the 1st
        lev(2, 2, 0, 1, 0), lev(3, 2, 1, 1, 2),   # home scores 2 in the 2nd
        lev(4, 3, 0, 3, 2), lev(5, 3, 1, 3, 2),   # away scores 2 in the 3rd
    ]
    away, home = postgame_stats.linescore(events, _FinalScore(3, 2))
    assert away == [1, 0, 2]
    assert home == [0, 2, 0]


def test_linescore_marks_unplayed_bottom_half_as_x():
    # Home leads after the top of the last inning — bottom never played.
    events = [lev(0, 1, 0, 0, 0), lev(1, 1, 1, 0, 3), lev(2, 2, 0, 1, 3)]
    away, home = postgame_stats.linescore(events, _FinalScore(1, 3))
    assert away == [0, 1]
    assert home == [3, None]


def test_linescore_reconciles_walkoff_runs_after_last_event():
    # The winning run crosses after the final recorded event: box says 4,
    # events only ever saw 3 — the difference lands in the last inning.
    events = [lev(0, 1, 0, 2, 0), lev(1, 1, 1, 2, 3), lev(2, 2, 0, 2, 3),
              lev(3, 2, 1, 2, 3)]
    away, home = postgame_stats.linescore(events, _FinalScore(2, 4))
    assert away == [2, 0]
    assert home == [3, 1]


def test_linescore_tolerates_junk():
    assert postgame_stats.linescore([], _FinalScore(0, 0)) == ([], [])
    assert postgame_stats.linescore(None, _FinalScore(0, 0)) == ([], [])
    events = ["bogus", {"Inning": "x"}, lev(0, 1, 0, None, "n/a"), lev(1, 1, 1, 1, 0)]
    away, home = postgame_stats.linescore(events, _FinalScore(1, 0))
    assert away == [1]
    assert home == [0]


# --- _side_totals ---

class _StubStat:
    def score(self, t):
        return 7 if t == 0 else 3

    def hits(self, t):
        return 11 if t == 0 else 6

    def homeruns(self, t):
        return 2 if t == 0 else 1

    def strikeoutsPitched(self, t):
        return 5 if t == 0 else 8


def test_side_totals_shape():
    totals = postgame_stats.side_totals(_StubStat(), 0, stars=4)
    assert totals == {
        "runs": 7,
        "hits": 11,
        "homeruns": 2,
        "stars_won": 4,
        "strikeouts_pitched": 5,
    }
    totals = postgame_stats.side_totals(_StubStat(), 1, stars=0)
    assert totals["runs"] == 3 and totals["strikeouts_pitched"] == 8

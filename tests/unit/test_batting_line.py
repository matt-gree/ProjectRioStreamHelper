"""The single-game batting line — the Stat Card / Stat Bar's GAME line and the
post-game capture's `batting.line` (the spotlight picker prints it verbatim).

A line that named every hit and walk but not a strikeout left "1-for-4" unable to
say where two of the other three at-bats went.
"""
from server.rio.pyrio.stat_formatters import format_batting_line


def test_strikeouts_are_named():
    assert format_batting_line(at_bats=4, hits=1, homeruns=1, walks_hbp=1,
                               strikeouts=2) == "1-for-4, HR, HBP, 2 K"


def test_a_single_strikeout_carries_no_count():
    assert format_batting_line(at_bats=3, hits=0, strikeouts=1) == "0-for-3, K"


def test_no_strikeouts_adds_nothing():
    assert format_batting_line(at_bats=4, hits=2, homeruns=1, doubles=1) == "2-for-4, HR, 2B"


def test_strikeouts_sit_between_the_walks_and_the_run_production():
    assert format_batting_line(at_bats=4, hits=1, walks_bb=1, strikeouts=1, rbi=2,
                               stolen_bases=1) == "1-for-4, BB, K, 2 RBI, SB"

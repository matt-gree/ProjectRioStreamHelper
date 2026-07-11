"""Character Spotlight server layer: the event-derived per-character counters
(star hits, wall jumps, sliding catches — no aggregated stat-file fields exist
for these) and the per-AB walkthrough payload (``PostGame.character_abs``)."""
from server.postgame import PostGame


def contact_ev(half, batter_loc, result, *, swing="Slap", fielder=None,
               num=0, inning=1, **extra):
    """A resolving event with a contact block (ball in play)."""
    e = {
        "Event Num": num, "Inning": inning, "Half Inning": half,
        "Away Score": 0, "Home Score": 0, "Balls": 0, "Strikes": 0, "Outs": 0,
        "Star Chance": 0, "Away Stars": 3, "Home Stars": 3,
        "Batter Roster Loc": batter_loc, "RBI": 0, "Num Outs During Play": 0,
        "Result of AB": result,
        "Pitch": {"Type of Swing": swing, "Pitch Type": "Curve", "Pitch Speed": 120,
                  "Star Pitch": 0, "Charge Type": "N/A",
                  "Contact": {"First Fielder": fielder or {}}},
    }
    e.update(extra)
    return e


# --- _char_event_derived ---

def test_star_hit_counts_only_resolving_star_swing_hits():
    events = [
        contact_ev(0, 2, "Single", swing="Star"),   # star swing hit → counts
        contact_ev(0, 2, "Caught", swing="Star"),   # star swing out → no
        contact_ev(0, 2, "None", swing="Star"),     # unresolved (foul) → no
        contact_ev(0, 2, "Double", swing="Slap"),   # hit, not a star swing → no
    ]
    derived = PostGame._char_event_derived(events)
    assert derived[0][2]["star_hits"] == 1
    assert 2 not in derived[1]


def test_wall_jump_and_slide_credit_the_fielding_team():
    fielder = {"Fielder Roster Location": 4, "Fielder Action": "Walljump"}
    slider = {"Fielder Roster Location": 7, "Fielder Action": "Sliding"}
    events = [
        contact_ev(0, 1, "Caught", fielder=fielder),  # away bats → home fields
        contact_ev(0, 1, "Out", fielder=slider),
        contact_ev(1, 5, "Caught", fielder=fielder),  # home bats → away fields
    ]
    derived = PostGame._char_event_derived(events)
    assert derived[1][4]["wall_jumps"] == 1
    assert derived[1][7]["sliding_catches"] == 1
    assert derived[0][4]["wall_jumps"] == 1


def test_runs_scored_credits_the_runner_not_the_batter():
    ev = contact_ev(0, 2, "Single")
    ev["Runner 3B"] = {"Runner Roster Loc": 5, "Runner Char Id": "Boo",
                       "Runner Initial Base": 3, "Runner Result Base": 4,
                       "Out Type": "None", "Out Location": 0, "Steal": "None"}
    ev["Runner 1B"] = {"Runner Roster Loc": 7, "Runner Char Id": "Yoshi",
                       "Runner Initial Base": 1, "Runner Result Base": 2,
                       "Out Type": "None", "Out Location": 0, "Steal": "None"}
    derived = PostGame._char_event_derived([ev])
    assert derived[0][5]["runs"] == 1     # crossed home
    assert 7 not in derived[0]            # advanced but did not score
    assert derived[0].get(2, {}).get("runs", 0) == 0  # batter singled, no run


def test_char_event_derived_tolerates_junk():
    assert PostGame._char_event_derived(None) == {0: {}, 1: {}}
    assert PostGame._char_event_derived(["bogus", {}, {"Half Inning": 9}]) == {0: {}, 1: {}}


# --- _runner_entries ---

def test_runner_entries_out_scored_and_advance():
    ev = {
        "Runner Batter": {"Runner Char Id": "Mario", "Runner Initial Base": 0,
                          "Out Type": "None", "Out Location": 0, "Steal": "None",
                          "Runner Result Base": 1},
        "Runner 2B": {"Runner Char Id": "Yoshi", "Runner Initial Base": 2,
                      "Out Type": "None", "Out Location": 0, "Steal": "None",
                      "Runner Result Base": 4},
        "Runner 3B": {"Runner Char Id": "Boo", "Runner Initial Base": 3,
                      "Out Type": "Force", "Out Location": 4, "Steal": "None",
                      "Runner Result Base": 255},
    }
    entries = {r["base"]: r for r in PostGame._runner_entries(ev)}
    assert entries[0]["resultBase"] == 1 and not entries[0]["out"]
    assert entries[2]["scored"] and entries[2]["resultBase"] == 4
    assert entries[3]["out"] and entries[3]["resultBase"] is None


# --- character_abs ---

def _prime_capture(sb, events, team_nums=None):
    PostGame._captured[sb] = {
        "teamNums": team_nums or {"1": 0, "2": 1},
        "player": {
            "1": {"characters": [{"name": f"A{i}", "isStarred": False,
                                  "isCaptain": i == 0, "wasPitcher": False}
                                 for i in range(9)]},
            "2": {"characters": []},
        },
        "meta": {"stadium": "Mario Stadium"},
        "events": events,
    }
    PostGame._stat_objs.pop(sb, None)   # no sim available → contact stays None
    PostGame._contacts.pop(sb, None)


def test_character_abs_filters_to_the_character_and_orients_scores():
    events = [
        contact_ev(0, 3, "Single", num=1, RBI=1),
        {"Event Num": 2, "Inning": 1, "Half Inning": 0, "Away Score": 1,
         "Home Score": 0, "Balls": 0, "Strikes": 2, "Outs": 1, "Star Chance": 0,
         "Away Stars": 2, "Home Stars": 3, "Batter Roster Loc": 3, "RBI": 0,
         "Num Outs During Play": 1, "Result of AB": "Strikeout", "Pitch": {}},
        contact_ev(1, 3, "Double", num=3),          # other team's roster slot 3
        contact_ev(0, 5, "HR", num=4),              # different roster slot
        contact_ev(0, 3, "None", num=5),            # unresolved → skipped
    ]
    _prime_capture(9, events)
    res = PostGame.character_abs(9, 1, 3)
    assert res["success"] and res["count"] == 2
    first, second = res["abs"]
    # score-after comes from the NEXT event (side-oriented: away = side 1)
    assert first["result"] == "Single"
    assert first["before"]["score"] == {"1": 0, "2": 0}
    assert first["after"]["score"] == {"1": 1, "2": 0}
    # no stat obj primed → no flight, but the PA still records
    assert first["contact"] is None
    assert second["result"] == "Strikeout"
    assert second["before"]["strikes"] == 2
    assert second["after"]["outs"] == 2
    assert second["before"]["stars"] == {"1": 2, "2": 3}


def test_character_abs_last_event_falls_back_to_rbi():
    events = [contact_ev(1, 0, "HR", num=1, RBI=2,
                         **{"Away Score": 3, "Home Score": 3})]
    _prime_capture(9, events)
    res = PostGame.character_abs(9, 2, 0)   # side 2 = home here
    assert res["count"] == 1
    ab = res["abs"][0]
    assert ab["before"]["score"] == {"1": 3, "2": 3}
    assert ab["after"]["score"] == {"1": 3, "2": 5}


def test_character_abs_rejects_bad_args_and_missing_capture():
    _prime_capture(9, [])
    assert not PostGame.character_abs(9, 3, 0)["success"]
    assert not PostGame.character_abs(9, 1, 11)["success"]
    PostGame._captured.pop(9, None)
    assert not PostGame.character_abs(9, 1, 0)["success"]


# --- starsUsed (whole-PA star accounting) ---

def test_stars_used_counts_every_star_swing_in_the_pa():
    events = [
        # Another batter's PA with a star swing — must not bleed into ours.
        contact_ev(0, 1, "Caught", swing="Star", num=1),
        # Featured PA: foul star swing (unresolved) → star pitch (no batter
        # star) → resolving star swing. 2 batter stars consumed.
        contact_ev(0, 3, "None", swing="Star", num=2),
        contact_ev(0, 3, "None", swing="None", num=3),
        contact_ev(0, 3, "Single", swing="Star", num=4),
        # Featured char's next PA (later inning): no stars.
        contact_ev(0, 3, "Out", swing="Slap", num=5, inning=2),
    ]
    _prime_capture(9, events)
    res = PostGame.character_abs(9, 1, 3)
    assert res["count"] == 2
    assert res["abs"][0]["starsUsed"] == 2
    assert res["abs"][1]["starsUsed"] == 0


def test_stars_used_ignores_opposing_star_pitches():
    ev = contact_ev(0, 3, "Strikeout", swing="None", num=1)
    ev["Pitch"]["Star Pitch"] = 1
    del ev["Pitch"]["Contact"]   # a swinging strikeout has no contact block
    _prime_capture(9, [ev])
    res = PostGame.character_abs(9, 1, 3)
    assert res["abs"][0]["starsUsed"] == 0
    assert res["abs"][0]["swingInfo"] == {"type": "None", "chargePct": None}


def test_captain_eligible_non_captain_star_swings_cost_two():
    # Roster slot 3 is Mario (captain-eligible) but NOT the team captain:
    # every star swing in the PA — the foul included — burns 2 stars.
    events = [
        contact_ev(0, 3, "None", swing="Star", num=1),     # fouled star swing
        contact_ev(0, 3, "Single", swing="Star", num=2),   # successful star hit
    ]
    _prime_capture(9, events)
    PostGame._captured[9]["player"]["1"]["characters"][3]["name"] = "Mario"
    res = PostGame.character_abs(9, 1, 3)
    assert res["abs"][0]["starsUsed"] == 4


def test_star_cost_rules():
    assert PostGame._star_cost("Mario", False) == 2   # eligible, not captain
    assert PostGame._star_cost("Mario", True) == 1    # the captain themselves
    assert PostGame._star_cost("Toad", False) == 1    # never captain-eligible
    assert PostGame._star_cost("A3", False) == 1      # unknown name → safe 1


# --- bunt detection ---

def test_contact_with_swing_none_reads_as_bunt():
    # Some stat files record Type of Swing "None" on a contacted bunt.
    bunted = contact_ev(0, 3, "Out", swing="None", num=1)
    clean = contact_ev(0, 3, "Strikeout", swing="None", num=2, inning=2)
    del clean["Pitch"]["Contact"]   # no contact → stays None, not a bunt
    _prime_capture(9, [bunted, clean])
    res = PostGame.character_abs(9, 1, 3)
    assert res["abs"][0]["swing"] == "Bunt"
    assert res["abs"][0]["swingInfo"]["type"] == "Bunt"
    assert res["abs"][1]["swing"] == "None"


def test_stars_used_resets_across_half_inning_and_batter_boundaries():
    events = [
        # Same roster slot 3 but the OTHER team star-fouls first — different
        # Half Inning ⇒ different PA.
        contact_ev(1, 3, "None", swing="Star", num=1),
        contact_ev(1, 3, "Caught", swing="Slap", num=2),
        contact_ev(0, 3, "HR", swing="Star", num=3),
    ]
    _prime_capture(9, events)
    res = PostGame.character_abs(9, 1, 3)
    assert res["count"] == 1
    assert res["abs"][0]["starsUsed"] == 1


# --- swingInfo.chargePct ---

def _charge_ev(cu, cd, **kw):
    ev = contact_ev(0, 3, "Single", swing="Charge", **kw)
    ev["Pitch"]["Contact"]["Charge Power Up"] = cu
    ev["Pitch"]["Contact"]["Charge Power Down"] = cd
    return ev


def test_charge_pct_under_full_and_over():
    events = [
        _charge_ev(0.6, 0.0, num=1),    # undercharged → 60
        _charge_ev(1.0, 0.0, num=2, inning=2),   # full charge → 100
        _charge_ev(1.0, 0.25, num=3, inning=3),  # overcharged → 125
    ]
    _prime_capture(9, events)
    res = PostGame.character_abs(9, 1, 3)
    infos = [ab["swingInfo"] for ab in res["abs"]]
    assert [i["chargePct"] for i in infos] == [60, 100, 125]
    assert all(i["type"] == "Charge" for i in infos)


def test_charge_pct_null_without_contact_charge_fields():
    # Missed charge swing (strikeout): contact block has no charge fields.
    missed = contact_ev(0, 3, "Strikeout", swing="Charge", num=1)
    # Slap resolving swing: never a chargePct even with charge fields present.
    slap = contact_ev(0, 3, "Single", swing="Slap", num=2, inning=2)
    slap["Pitch"]["Contact"]["Charge Power Up"] = 1.0
    slap["Pitch"]["Contact"]["Charge Power Down"] = 0.0
    _prime_capture(9, [missed, slap])
    res = PostGame.character_abs(9, 1, 3)
    assert res["abs"][0]["swingInfo"] == {"type": "Charge", "chargePct": None}
    assert res["abs"][1]["swingInfo"] == {"type": "Slap", "chargePct": None}


# --- starChanceOutcome ---

def test_star_chance_outcome_won_lost_and_null():
    events = [
        contact_ev(0, 3, "Single", num=1, **{"Star Chance": 1}),        # hit → won
        contact_ev(0, 3, "Walk (BB)", num=2, inning=2,
                   **{"Star Chance": 1}),                               # walk → won
        contact_ev(0, 3, "Caught", num=3, inning=3, **{"Star Chance": 1}),  # out → lost
        contact_ev(0, 3, "HR", num=4, inning=4),                        # no star chance
    ]
    _prime_capture(9, events)
    res = PostGame.character_abs(9, 1, 3)
    outcomes = [ab["starChanceOutcome"] for ab in res["abs"]]
    assert outcomes == ["won", "won", "lost", None]


# --- character.battingHand passthrough ---

def test_character_block_carries_batting_hand():
    _prime_capture(9, [contact_ev(0, 3, "Single", num=1)])
    PostGame._captured[9]["player"]["1"]["characters"][3]["battingHand"] = "Left"
    res = PostGame.character_abs(9, 1, 3)
    assert res["character"]["battingHand"] == "Left"


def test_character_batting_hand_defaults_empty_when_absent():
    _prime_capture(9, [])  # fixture characters carry no battingHand key
    res = PostGame.character_abs(9, 1, 3)
    assert res["character"]["battingHand"] == ""

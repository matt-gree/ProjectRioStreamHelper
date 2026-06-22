"""StatsTracker: HUD/API extraction, merge math, and the sides-swapped mapping
that decides which data team's stats land on which display team."""
import pandas as pd

from server.rio import stats_tracker as st
from server.rio.stats_tracker import StatsTracker, _SbSlot
from server.state import State
from server.utils.deep_dict import deep_get


# --- HUD extraction (HUD label → internal key) ---

def test_extract_hud_batting_maps_labels():
    out = st._extract_hud_batting({"At Bats": 4, "Hits": 2, "Homeruns": 1})
    assert out["at_bats"] == 4
    assert out["hits"] == 2
    assert out["homeruns"] == 1
    assert out["walks_bb"] == 0  # missing label → 0


def test_extract_hud_pitching_maps_labels():
    out = st._extract_hud_pitching({"Batters Faced": 12, "Earned Runs": 3})
    assert out["batters_faced"] == 12
    assert out["earned_runs"] == 3


# --- API column resolution (summary preferred, NaN skipped) ---

def test_resolve_df_col_prefers_summary():
    row = pd.Series({"Batting_summary_hits": 5, "Batting_hits": 3})
    assert st._resolve_df_col(row, "Batting", "hits") == 5


def test_resolve_df_col_falls_back_to_plain():
    row = pd.Series({"Batting_hits": 3})
    assert st._resolve_df_col(row, "Batting", "hits") == 3


def test_resolve_df_col_skips_nan_summary():
    row = pd.Series({"Batting_summary_hits": float("nan"), "Batting_hits": 7})
    assert st._resolve_df_col(row, "Batting", "hits") == 7


def test_resolve_df_col_missing_returns_zero():
    assert st._resolve_df_col(pd.Series({"other": 1}), "Batting", "hits") == 0


def test_extract_api_batting_casts_to_int():
    row = pd.Series({"Batting_summary_hits": 5.0, "Batting_summary_at_bats": 10.0})
    out = st._extract_api_batting(row)
    assert out["hits"] == 5 and isinstance(out["hits"], int)
    assert out["at_bats"] == 10


# --- merge math ---

def _raw(keys, **vals):
    d = {k: 0 for k in keys}
    d.update(vals)
    return d


def test_merge_batting_sums_raw_and_adds_derived():
    api = _raw(st._BATTING_KEYS, at_bats=4, hits=2, singles=2)
    hud = _raw(st._BATTING_KEYS, at_bats=2, hits=1, singles=1)
    merged = st._merge_batting(api, hud)
    assert merged["at_bats"] == 6
    assert merged["hits"] == 3
    assert merged["singles"] == 3
    assert "avg" in merged  # derived stats appended


def test_merge_pitching_earned_runs_combines_hud_er_and_api_runs():
    # API has no earned_runs column — ERA uses HUD earned_runs + API runs_allowed.
    api = _raw(st._PITCHING_KEYS, runs_allowed=3, outs_pitched=9)
    hud = _raw(st._PITCHING_KEYS, outs_pitched=9)
    hud["earned_runs"] = 1
    merged = st._merge_pitching(api, hud)
    assert merged["earned_runs"] == 4   # 1 (hud) + 3 (api runs_allowed)
    assert merged["outs_pitched"] == 18
    assert "era" in merged


# --- push_stats_to_state sides mapping ---

def _slot_with_rosters():
    slot = _SbSlot()
    slot.players = ["Alice", "Bob"]
    slot.rosters = {0: ["Mario"] + [""] * 8, 1: ["Luigi"] + [""] * 8}
    return slot


def s(key):
    return deep_get(State.state, key)


async def test_push_stats_unswapped_maps_data_team_to_same_display_team(mock_socket):
    StatsTracker._slots[1] = _slot_with_rosters()
    await StatsTracker.push_stats_to_state(1, sides_swapped=False)
    assert s("score.1.stats.1.character.0.name") == "Mario"   # away → display 1
    assert s("score.1.stats.2.character.0.name") == "Luigi"   # home → display 2


async def test_push_stats_swapped_inverts_team_mapping(mock_socket):
    StatsTracker._slots[1] = _slot_with_rosters()
    await StatsTracker.push_stats_to_state(1, sides_swapped=True)
    assert s("score.1.stats.1.character.0.name") == "Luigi"   # home → display 1
    assert s("score.1.stats.2.character.0.name") == "Mario"   # away → display 2


async def test_push_stats_emits_single_batch(mock_socket):
    StatsTracker._slots[1] = _slot_with_rosters()
    await StatsTracker.push_stats_to_state(1, sides_swapped=False)
    assert mock_socket.await_count == 1
    assert mock_socket.await_args.args[0] == "v1.state.set_batch"

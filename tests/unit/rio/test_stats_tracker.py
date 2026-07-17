"""StatsTracker: HUD/API extraction, merge math, the sides-swapped mapping
that decides which data team's stats land on which display team, and the
slot lifecycle (new game → fetch gating → live accumulation → refresh)."""
from unittest.mock import AsyncMock

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


async def test_push_stats_prefers_state_rioname_for_api_lookup(mock_socket):
    # why: a producer name-override changes the displayed player; the stats
    # lookup must follow the display slot, not the stale cached HUD username.
    slot = _slot_with_rosters()
    slot.api_index[("Pinned", "Mario")] = pd.Series({"Batting_summary_hits": 7})
    StatsTracker._slots[1] = slot
    await State.Set("score.1.player.1.rioName", "Pinned")
    await StatsTracker.push_stats_to_state(1, sides_swapped=False)
    assert s("score.1.stats.1.character.0.api.batting")["hits"] == 7


# --- lifecycle: on_new_game fetch gating ---

def _game_json(away="Alice", home="Bob", away_chars=(0,), home_chars=("Luigi",)):
    g = {"away_player": away, "home_player": home}
    for i, c in enumerate(away_chars):
        g[f"away_roster_{i}_char"] = c
    for i, c in enumerate(home_chars):
        g[f"home_roster_{i}_char"] = c
    return g


def _stats_df(rows):
    """rows: list of (username, char_name, hits)."""
    return pd.DataFrame({
        "username": [r[0] for r in rows],
        "char_name": [r[1] for r in rows],
        "Batting_summary_hits": [r[2] for r in rows],
    })


async def test_on_new_game_populates_players_and_normalized_rosters(
        monkeypatch):
    fetch = AsyncMock(return_value=pd.DataFrame())
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", fetch)
    # HUD sends string char names; the API game path sends pyrio int ids —
    # both must land as canonical names.
    await StatsTracker.on_new_game(
        _game_json(away_chars=(0, ""), home_chars=("Luigi",)), 1)
    slot = StatsTracker._slots[1]
    assert slot.players == ["Alice", "Bob"]
    assert slot.rosters[0][:2] == ["Mario", ""]
    assert slot.rosters[1][0] == "Luigi"


async def test_on_new_game_no_players_skips_fetch_but_is_ready(monkeypatch):
    fetch = AsyncMock()
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", fetch)
    await StatsTracker.on_new_game({"away_player": "", "home_player": ""}, 1)
    assert StatsTracker.is_api_ready(1)
    fetch.assert_not_awaited()


async def test_on_new_game_no_stats_tag_skips_fetch_but_is_ready(monkeypatch):
    fetch = AsyncMock()
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", fetch)
    await StatsTracker.on_new_game(_game_json(), 1)   # no binding tag set
    assert StatsTracker.is_api_ready(1)
    fetch.assert_not_awaited()


async def test_on_new_game_await_fetch_loads_index_and_pushes(
        monkeypatch, set_setting, mock_socket):
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    df = _stats_df([("Alice", "Mario", 9)])
    monkeypatch.setattr(st.stats_api, "fetch_character_stats",
                        AsyncMock(return_value=df))
    await StatsTracker.on_new_game(_game_json(), 1, await_fetch=True)
    slot = StatsTracker._slots[1]
    assert slot.api_ready
    assert ("Alice", "Mario") in slot.api_index
    # push=True landed merged stats in State for the fetched player.
    assert s("score.1.stats.1.character.0.batting")["hits"] == 9


async def test_on_new_game_background_fetch_completes(
        monkeypatch, set_setting, mock_socket):
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    monkeypatch.setattr(st.stats_api, "fetch_character_stats",
                        AsyncMock(return_value=_stats_df([])))
    await StatsTracker.on_new_game(_game_json(), 1)   # await_fetch=False
    slot = StatsTracker._slots[1]
    assert slot.fetch_task is not None
    assert not slot.api_ready          # not ready until the task lands
    await slot.fetch_task
    assert slot.api_ready


async def test_on_new_game_resets_previous_slot(monkeypatch):
    monkeypatch.setattr(st.stats_api, "fetch_character_stats",
                        AsyncMock(return_value=pd.DataFrame()))
    StatsTracker._slots[1] = _slot_with_rosters()
    StatsTracker._slots[1].hud_stats = {0: {0: {"batting": {"hits": 3}}}}
    await StatsTracker.on_new_game(_game_json(away="New", home="Game"), 1)
    slot = StatsTracker._slots[1]
    assert slot.players == ["New", "Game"]
    assert slot.hud_stats == {}


async def test_fetch_failure_fails_open(monkeypatch, set_setting):
    # why: a dead Rio API must not wedge the board — api_ready gates HUD
    # pushes, so it flips True even on failure and stats degrade to HUD-only.
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    monkeypatch.setattr(st.stats_api, "fetch_character_stats",
                        AsyncMock(side_effect=RuntimeError("api down")))
    await StatsTracker.on_new_game(_game_json(), 1, await_fetch=True)
    assert StatsTracker.is_api_ready(1)
    assert StatsTracker._slots[1].api_index == {}


# --- on_hud_update / on_live_game_update (current-game accumulation) ---

def test_on_hud_update_reads_full_rosters():
    StatsTracker._slots[1] = _slot_with_rosters()
    game = {"away_roster_0_offensive": {"Hits": 2},
            "home_roster_0_defensive": {"Strikeouts": 4}}
    StatsTracker.on_hud_update(game, 1)
    slot = StatsTracker._slots[1]
    assert slot.hud_stats[0][0]["batting"]["hits"] == 2
    assert slot.hud_stats[1][0]["pitching"]["strikeouts_pitched"] == 4
    assert slot.hud_stats[0][8]["batting"] == st._empty_batting()


def test_live_update_top_half_batter_is_away_pitcher_is_home():
    StatsTracker.on_live_game_update({
        "half_inning": 0, "batter": 3, "pitcher": 5,
        "batter_stats": {"Hits": 1}, "pitcher_stats": {"Outs Pitched": 6},
    }, 1)
    slot = StatsTracker._slots[1]
    assert slot.hud_stats[0][3]["batting"]["hits"] == 1
    assert slot.hud_stats[1][5]["pitching"]["outs_pitched"] == 6


def test_live_update_bottom_half_inverts_orientation():
    StatsTracker.on_live_game_update({
        "half_inning": 1, "batter": 2, "pitcher": 4,
        "batter_stats": {"Hits": 1}, "pitcher_stats": {"Outs Pitched": 3},
    }, 1)
    slot = StatsTracker._slots[1]
    assert slot.hud_stats[1][2]["batting"]["hits"] == 1
    assert slot.hud_stats[0][4]["pitching"]["outs_pitched"] == 3


def test_live_update_builds_out_across_polls_preserving_earlier_cells():
    # why: the ongoing feed only exposes the two active characters per poll;
    # the per-character picture must accumulate as the lineup cycles, not
    # reset to the latest snapshot.
    StatsTracker.on_live_game_update({
        "half_inning": 0, "batter": 0, "batter_stats": {"Hits": 1}}, 1)
    StatsTracker.on_live_game_update({
        "half_inning": 0, "batter": 1, "batter_stats": {"Hits": 2}}, 1)
    slot = StatsTracker._slots[1]
    assert slot.hud_stats[0][0]["batting"]["hits"] == 1
    assert slot.hud_stats[0][1]["batting"]["hits"] == 2


def test_live_update_ignores_invalid_locations_and_empty_stats():
    StatsTracker.on_live_game_update({
        "half_inning": 0, "batter": 9, "batter_stats": {"Hits": 1},   # out of range
        "pitcher": 2, "pitcher_stats": {},                            # empty
    }, 1)
    assert StatsTracker._slots[1].hud_stats == {}


# --- refresh_api_stats ---

async def test_refresh_skips_without_tag(monkeypatch):
    fetch = AsyncMock()
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", fetch)
    await StatsTracker.refresh_api_stats(1)
    fetch.assert_not_awaited()


async def test_refresh_fetches_for_state_players(
        monkeypatch, set_setting, mock_socket):
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    fetch = AsyncMock(return_value=pd.DataFrame())
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", fetch)
    await State.Set("score.1.player.1.rioName", "Alice")
    await State.Set("score.1.player.2.rioName", "Bob")
    await StatsTracker.refresh_api_stats(1)
    fetch.assert_awaited_once()
    assert sorted(fetch.await_args.args[0]) == ["Alice", "Bob"]
    assert fetch.await_args.args[1] == "Ranked"


async def test_refresh_no_players_sets_diagnostic(monkeypatch, set_setting):
    set_setting("scoreboards.binding.1.stats_tag", "Ranked")
    diag = AsyncMock()
    monkeypatch.setattr(st.stats_api, "set_no_players_diagnostic", diag)
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", AsyncMock())
    await StatsTracker.refresh_api_stats(1)
    diag.assert_awaited_once_with(1, "Ranked")


# --- push_api_stats_for_scoreboard (rotation path, no HUD merge) ---

async def test_push_api_stats_reads_names_and_chars_from_state(mock_socket):
    slot = _SbSlot()
    slot.api_index[("Alice", "Mario")] = pd.Series({"Batting_summary_hits": 5})
    StatsTracker._slots[2] = slot
    await State.Set("score.2.player.1.rioName", "Alice")
    await State.Set("score.2.player.1.character.0.name", "Mario")

    await StatsTracker.push_api_stats_for_scoreboard(2)
    assert s("score.2.stats.1.character.0.api.batting")["hits"] == 5
    assert s("score.2.stats.1.character.0.batting")["hits"] == 5   # merge = api + 0
    cg = s("score.2.stats.1.character.0.current_game")
    assert cg["batting"] == st._empty_batting()


async def test_push_api_stats_noop_without_players(mock_socket):
    await StatsTracker.push_api_stats_for_scoreboard(2)
    assert s("score.2.stats") is None
    mock_socket.assert_not_awaited()


# --- prefetch_for_players (rotation pre-cache) ---

async def test_prefetch_dedupes_and_drops_empty_names(
        monkeypatch, set_setting):
    set_setting("scoreboards.binding.2.stats_tag", "Ranked")
    fetch = AsyncMock(return_value=pd.DataFrame())
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", fetch)
    await StatsTracker.prefetch_for_players(["A", "B", "A", ""], 2)
    assert sorted(fetch.await_args.args[0]) == ["A", "B"]


async def test_prefetch_skips_without_tag(monkeypatch):
    fetch = AsyncMock()
    monkeypatch.setattr(st.stats_api, "fetch_character_stats", fetch)
    await StatsTracker.prefetch_for_players(["A"], 2)
    fetch.assert_not_awaited()

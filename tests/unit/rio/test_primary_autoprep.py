"""Primary-match auto-prep: setting the primary match's (id 1) players auto-fetches
the head-to-head band (Matchup) and points the Player Plates at it, while leaving a
producer's override to a *different* match untouched."""
from unittest.mock import AsyncMock

import pytest

from server.match import Match, default_match
from server.playerplates import PlayerPlates
from server.state import State


@pytest.fixture(autouse=True)
def reset_primary_guard():
    """The dedup guard is a session-level class var; reset it around each test."""
    Match._primary_synced_pair = None
    yield
    Match._primary_synced_pair = None


@pytest.fixture
def fetch_spy(monkeypatch):
    """Stub Matchup.Fetch (its network call) with a success-returning spy."""
    spy = AsyncMock(return_value={"present": True})
    # Patched on the class the model imports lazily inside prepare_primary_surfaces.
    import server.matchup as matchup_mod
    monkeypatch.setattr(matchup_mod.Matchup, "Fetch", spy)
    return spy


async def make_primary(rio1: str, rio2: str, m: int = 1) -> int:
    match = default_match()
    match["player"]["1"]["rioName"] = rio1
    match["player"]["2"]["rioName"] = rio2
    await State.Set(f"match.{m}", match)
    return m


def _pp_config() -> dict:
    return (State.state.get("playerplates", {}) or {}).get("config", {})


async def test_setting_primary_fetches_matchup_and_points_plates(fetch_spy):
    await make_primary("RioAlice", "RioBob")
    await Match.prepare_primary_surfaces()

    fetch_spy.assert_awaited_once_with(1)
    cfg = _pp_config()
    assert cfg["source"] == "match"
    assert cfg["matchId"] == 1
    # Names resolve from the fixture (resolve-by-copy projector ran).
    assert State.state["playerplates"]["1"]["name"] == "RioAlice"
    assert State.state["playerplates"]["2"]["name"] == "RioBob"


async def test_dedup_skips_when_players_unchanged(fetch_spy):
    await make_primary("RioAlice", "RioBob")
    await Match.prepare_primary_surfaces()
    await Match.prepare_primary_surfaces()  # nothing changed
    fetch_spy.assert_awaited_once()  # not twice


async def test_player_change_resyncs(fetch_spy):
    await make_primary("RioAlice", "RioBob")
    await Match.prepare_primary_surfaces()
    await State.Set("match.1.player.2.rioName", "RioCarol")
    await Match.prepare_primary_surfaces()
    assert fetch_spy.await_count == 2


async def test_no_op_until_both_sides_resolve(fetch_spy):
    await make_primary("RioAlice", "")  # only one side
    await Match.prepare_primary_surfaces()
    fetch_spy.assert_not_awaited()
    assert Match._primary_synced_pair is None


async def test_matchup_override_to_other_match_not_clobbered(fetch_spy):
    await make_primary("RioAlice", "RioBob")
    # Producer fetched the band for a different match.
    await State.Set("matchup", {"present": True, "matchId": 2})
    await Match.prepare_primary_surfaces()
    fetch_spy.assert_not_awaited()  # matchup left on match 2
    # Plates still follow the primary, so they still get pointed at it.
    assert _pp_config()["matchId"] == 1


async def test_plates_override_to_other_match_not_clobbered(fetch_spy):
    await make_primary("RioAlice", "RioBob")
    await make_primary("RioX", "RioY", m=2)
    # Producer pointed the plates at match 2.
    await PlayerPlates.set_config({"source": "match", "matchId": 2, "sides": {"1": {}, "2": {}}})
    await Match.prepare_primary_surfaces()
    fetch_spy.assert_awaited_once_with(1)  # matchup still auto-refreshes for primary
    assert _pp_config()["matchId"] == 2    # plates override untouched


async def test_plates_manual_override_not_clobbered(fetch_spy):
    await make_primary("RioAlice", "RioBob")
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {"1": {"name": "Typed1"}, "2": {"name": "Typed2"}},
    })
    await Match.prepare_primary_surfaces()
    assert _pp_config()["source"] == "manual"
    assert _pp_config()["sides"]["1"]["name"] == "Typed1"


async def test_failed_fetch_retries_next_edit(monkeypatch):
    await make_primary("RioAlice", "RioBob")
    spy = AsyncMock(return_value={"error": "boom"})
    import server.matchup as matchup_mod
    monkeypatch.setattr(matchup_mod.Matchup, "Fetch", spy)

    await Match.prepare_primary_surfaces()
    assert Match._primary_synced_pair is None  # not recorded on failure
    await Match.prepare_primary_surfaces()
    assert spy.await_count == 2  # retried, not deduped

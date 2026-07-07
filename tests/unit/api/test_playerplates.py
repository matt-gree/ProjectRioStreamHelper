"""Player Plates: config normalization + the resolve-by-copy projector
(PlayerPlates) and the /playerplates route."""
import pytest

from server.api.v1.playerplates import get_playerplates, set_playerplates, ConfigPayload
from server.match import Match, default_match
from server.playerplates import PlayerPlates, normalize_config
from server.state import State


def _side(pp: dict, t: int) -> dict:
    return (pp.get(str(t)) or {})


async def make_match(rio1: str, rio2: str) -> int:
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = rio1
    match["player"]["2"]["rioName"] = rio2
    await State.Set(f"match.{m}", match)
    return m


def test_normalize_drops_bad_mode_source_and_subfield():
    cfg = normalize_config({
        "mode": "nope", "source": "bogus", "matchId": "7",
        "sides": {"1": {"subField": "not_a_field", "name": "  A  "}},
    })
    assert cfg["mode"] == "both"
    assert cfg["source"] == "match"
    assert cfg["matchId"] == 7           # digit string coerced to int
    assert cfg["sides"]["1"]["subField"] == ""   # unknown field dropped
    assert cfg["sides"]["1"]["name"] == "A"      # trimmed
    # Defaults filled for the untouched side.
    assert cfg["sides"]["2"]["location"] == "right"


@pytest.mark.asyncio
async def test_manual_both_projects_names_and_subs():
    await PlayerPlates.set_config({
        "mode": "both", "source": "manual",
        "sides": {
            "1": {"name": "Alice", "subLabel": "Team", "subValue": "Reds"},
            "2": {"name": "Bob", "subLabel": "Team", "subValue": "Blues"},
        },
    })
    pp = State.state["playerplates"]
    assert pp["mode"] == "both"
    assert _side(pp, 1)["name"] == "Alice"
    assert _side(pp, 1)["subValue"] == "Reds"
    assert _side(pp, 1)["location"] == "left"    # both-mode pins side 1 left
    assert _side(pp, 2)["location"] == "right"   # ...side 2 right
    assert _side(pp, 1)["active"] is True
    assert _side(pp, 2)["active"] is True


@pytest.mark.asyncio
async def test_single_mode_only_shows_its_side_at_its_location():
    await PlayerPlates.set_config({
        "mode": "p2", "source": "manual",
        "sides": {
            "1": {"name": "Alice"},
            "2": {"name": "Bob", "location": "center"},
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["active"] is False       # p2 mode hides side 1
    assert _side(pp, 2)["active"] is True
    assert _side(pp, 2)["location"] == "center"  # single mode honors the location


@pytest.mark.asyncio
async def test_inactive_when_hidden_or_no_name():
    await PlayerPlates.set_config({
        "mode": "both", "source": "manual",
        "sides": {
            "1": {"name": "Alice", "visible": False},   # toggled off
            "2": {"name": ""},                          # no name
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["active"] is False
    assert _side(pp, 2)["active"] is False


@pytest.mark.asyncio
async def test_match_source_resolves_names_from_fixture():
    m = await make_match("RioAlice", "RioBob")
    await PlayerPlates.set_config({
        "mode": "both", "source": "match", "matchId": m,
        "sides": {"1": {}, "2": {}},
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["name"] == "RioAlice"
    assert _side(pp, 2)["name"] == "RioBob"
    assert _side(pp, 1)["active"] is True


@pytest.mark.asyncio
async def test_reproject_reflects_match_rename():
    m = await make_match("RioAlice", "RioBob")
    await PlayerPlates.set_config({
        "mode": "both", "source": "match", "matchId": m, "sides": {"1": {}, "2": {}},
    })
    # A match edit + re-project flows the new name onto the band (resolve-by-copy).
    await State.Set(f"match.{m}.player.1.rioName", "RioCarol")
    await PlayerPlates.project()
    assert _side(State.state["playerplates"], 1)["name"] == "RioCarol"


@pytest.mark.asyncio
async def test_put_route_normalizes_and_returns_config():
    out = await set_playerplates(ConfigPayload(config={
        "mode": "p1", "source": "manual", "sides": {"1": {"name": "Zed"}},
    }))
    assert out["success"] is True
    assert out["config"]["mode"] == "p1"
    got = await get_playerplates()
    assert got["config"]["sides"]["1"]["name"] == "Zed"
    assert got["1"]["active"] is True

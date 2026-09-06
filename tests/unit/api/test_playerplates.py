"""Player Plates: config normalization + the resolve-by-copy projector
(PlayerPlates) and the /playerplates route."""
import pytest

from server.api.v1.playerplates import get_playerplates, set_playerplates, ConfigPayload
from server.match import Match, default_match
from server.participants import Participants
from server.playerplates import PlayerPlates, normalize_config
from server.state import State


def _side(pp: dict, t: int) -> dict:
    return (pp.get(str(t)) or {})


def seed_participant(pid, tag="", rio="", **display):
    Participants.participants[pid] = Participants._normalize({
        "id": pid,
        "identities": {"rioName": rio},
        "display": {"tag": tag, **display},
    }, pid)
    return pid


async def make_match(rio1: str, rio2: str) -> int:
    m = Match.next_id()
    match = default_match()
    match["player"]["1"]["rioName"] = rio1
    match["player"]["2"]["rioName"] = rio2
    await State.Set(f"match.{m}", match)
    return m


def test_normalize_drops_bad_source_and_subfield():
    cfg = normalize_config({
        "source": "bogus", "matchId": "7",
        "sides": {"1": {"subField": "not_a_field", "name": "  A  "}},
    })
    assert "mode" not in cfg              # the band-wide mode is gone
    assert cfg["source"] == "match"
    assert cfg["matchId"] == 7           # digit string coerced to int
    assert cfg["sides"]["1"]["subField"] == ""   # unknown field dropped
    assert cfg["sides"]["1"]["name"] == "A"      # trimmed
    # Defaults filled for the untouched side.
    assert cfg["sides"]["2"]["location"] == "right"
    assert cfg["sides"]["1"]["visible"] is True
    assert cfg["sides"]["2"]["visible"] is True


@pytest.mark.parametrize("mode,hidden", [("p1", "2"), ("p2", "1")])
def test_normalize_folds_a_legacy_mode_onto_the_visible_flags(mode, hidden):
    """A config stored before the collapse keeps its picture: the mode said which
    plates were included, which is exactly what each side's eye says now."""
    cfg = normalize_config({"mode": mode, "sides": {"1": {}, "2": {}}})
    shown = "1" if hidden == "2" else "2"
    assert cfg["sides"][hidden]["visible"] is False
    assert cfg["sides"][shown]["visible"] is True
    # Idempotent — re-normalizing the folded output keeps the same picture.
    assert normalize_config(cfg)["sides"][hidden]["visible"] is False


@pytest.mark.asyncio
async def test_manual_pair_projects_names_and_subs():
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"name": "Alice", "subLabel": "Team", "subValue": "Reds"},
            "2": {"name": "Bob", "subLabel": "Team", "subValue": "Blues"},
        },
    })
    pp = State.state["playerplates"]
    assert "mode" not in pp                      # no longer a projected key
    assert _side(pp, 1)["name"] == "Alice"
    assert _side(pp, 1)["subValue"] == "Reds"
    assert _side(pp, 1)["location"] == "left"    # a pair pins side 1 left
    assert _side(pp, 2)["location"] == "right"   # ...side 2 right
    assert _side(pp, 1)["active"] is True
    assert _side(pp, 2)["active"] is True


@pytest.mark.asyncio
async def test_side_1s_location_swaps_the_whole_pair():
    """How the plates get switched: side 1's own anchor is the ORDER, side 2
    mirrors it. One bit read off one side, so there is no swap flag to disagree
    with the stored locations."""
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"name": "Alice", "location": "right"},
            "2": {"name": "Bob", "location": "right"},   # stale/contradictory
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["location"] == "right"
    assert _side(pp, 2)["location"] == "left"    # mirrored, never a collision


@pytest.mark.asyncio
async def test_a_re_paired_centre_plate_cannot_park_on_its_partner():
    """`center` is reachable only for a lone plate, so a plate parked there and
    then re-paired must be coerced back onto an anchor rather than landing on
    top of its partner."""
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"name": "Alice", "location": "center"},
            "2": {"name": "Bob", "location": "left"},
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["location"] == "left"
    assert _side(pp, 2)["location"] == "right"


@pytest.mark.asyncio
async def test_a_lone_plate_still_reaches_the_middle_anchor():
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"name": "Alice", "location": "center"},
            "2": {"name": "Bob", "visible": False},
        },
    })
    assert _side(State.state["playerplates"], 1)["location"] == "center"

@pytest.mark.asyncio
async def test_a_lone_plate_sits_at_its_own_location():
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"name": "Alice", "visible": False},
            "2": {"name": "Bob", "location": "center"},
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["active"] is False        # its eye is off
    assert _side(pp, 2)["active"] is True
    assert _side(pp, 2)["location"] == "center"   # alone, so it is placed


@pytest.mark.asyncio
async def test_a_shown_but_nameless_partner_still_pins_its_pair():
    """Anchoring follows the EYES, not what resolved — otherwise the plate that
    did resolve would glide from its anchor to `center` the moment the other
    side's name went missing, mid-broadcast."""
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {"1": {"name": ""}, "2": {"name": "Bob", "location": "center"}},
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["active"] is False        # nothing to draw
    assert _side(pp, 2)["location"] == "right"    # ...but it is still one of a pair


@pytest.mark.asyncio
async def test_inactive_when_hidden_or_no_name():
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"name": "Alice", "visible": False},   # toggled off
            "2": {"name": ""},                          # no name
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["active"] is False
    assert _side(pp, 2)["active"] is False


@pytest.mark.asyncio
async def test_projecting_over_a_legacy_state_drops_the_stale_mode_key():
    await State.Set("playerplates.mode", "p2")
    await PlayerPlates.set_config({"source": "manual", "sides": {"1": {"name": "Alice"}}})
    assert "mode" not in State.state["playerplates"]


@pytest.mark.asyncio
async def test_manual_side_resolves_a_picked_participant():
    """Manual plates go through the address book too — the SOURCE says only where
    the person comes from, so a manual pick resolves its name and its sub-plate
    field exactly the way a match-fed one does."""
    seed_participant("p_ally", tag="Ally", rio="RioAlly", pronoun="she/her")
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"participantId": "p_ally", "subField": "pronoun"},
            "2": {},
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["name"] == "Ally"          # display tag beats rioName
    assert _side(pp, 1)["subLabel"] == "Pronouns"
    assert _side(pp, 1)["subValue"] == "she/her"
    assert _side(pp, 1)["active"] is True


@pytest.mark.asyncio
async def test_a_manual_pick_reflows_on_an_address_book_edit():
    """The reason the pick beats typed text: PlayerPlates is in
    `Participants.reproject_dependents()`, so a mid-broadcast fix reaches the
    band. Typed text could never re-resolve."""
    seed_participant("p_ally", tag="Ally", rio="RioAlly", pronoun="she/her")
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {"1": {"participantId": "p_ally", "subField": "pronoun"}, "2": {}},
    })
    await Participants.Update("p_ally", {"display": {"tag": "Ally B"}})
    assert _side(State.state["playerplates"], 1)["name"] == "Ally B"


@pytest.mark.asyncio
async def test_a_raw_typed_manual_name_keeps_its_typed_subplate():
    """The picker's "use without saving" escape hatch: no row behind the plate,
    so there is no field to resolve and the typed label/value is all it has."""
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {
            "1": {"name": "Guest", "subLabel": "Team", "subValue": "Reds"},
            "2": {},
        },
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["name"] == "Guest"
    assert _side(pp, 1)["subLabel"] == "Team"
    assert _side(pp, 1)["subValue"] == "Reds"


@pytest.mark.asyncio
async def test_a_pick_beats_a_leftover_typed_name():
    seed_participant("p_ally", tag="Ally", rio="RioAlly")
    await PlayerPlates.set_config({
        "source": "manual",
        "sides": {"1": {"participantId": "p_ally", "name": "Guest"}, "2": {}},
    })
    assert _side(State.state["playerplates"], 1)["name"] == "Ally"


@pytest.mark.asyncio
async def test_match_source_with_no_match_draws_nothing():
    """The panel says "No name from match", so the band must agree. This used to
    fall through to the typed manual fields, putting a leftover name on air under
    a source the producer had just pointed away from it."""
    await PlayerPlates.set_config({
        "source": "match", "matchId": None,
        "sides": {"1": {"name": "Guest", "subValue": "Reds"}, "2": {}},
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["name"] == ""
    assert _side(pp, 1)["subValue"] == ""
    assert _side(pp, 1)["active"] is False


@pytest.mark.asyncio
async def test_a_fixture_player_missing_from_the_book_blanks_its_subplate():
    """Keyed on the PICK, not on whether a row resolved: an unknown fixture player
    shows their rioName and NO sub-plate, rather than inheriting whatever was
    typed on the band before the producer switched to the match source."""
    m = await make_match("RioStranger", "RioBob")
    await PlayerPlates.set_config({
        "source": "match", "matchId": m,
        "sides": {"1": {"subField": "pronoun", "subLabel": "x", "subValue": "y"}, "2": {}},
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["name"] == "RioStranger"
    assert _side(pp, 1)["subValue"] == ""


@pytest.mark.asyncio
async def test_normalize_keeps_the_participant_pick():
    cfg = normalize_config({"source": "manual", "sides": {"1": {"participantId": "p_ally"}}})
    assert cfg["sides"]["1"]["participantId"] == "p_ally"
    assert cfg["sides"]["2"]["participantId"] is None


@pytest.mark.asyncio
async def test_match_source_resolves_names_from_fixture():
    m = await make_match("RioAlice", "RioBob")
    await PlayerPlates.set_config({
        "source": "match", "matchId": m, "sides": {"1": {}, "2": {}},
    })
    pp = State.state["playerplates"]
    assert _side(pp, 1)["name"] == "RioAlice"
    assert _side(pp, 2)["name"] == "RioBob"
    assert _side(pp, 1)["active"] is True


@pytest.mark.asyncio
async def test_reproject_reflects_match_rename():
    m = await make_match("RioAlice", "RioBob")
    await PlayerPlates.set_config({
        "source": "match", "matchId": m, "sides": {"1": {}, "2": {}},
    })
    # A match edit + re-project flows the new name onto the band (resolve-by-copy).
    await State.Set(f"match.{m}.player.1.rioName", "RioCarol")
    await PlayerPlates.project()
    assert _side(State.state["playerplates"], 1)["name"] == "RioCarol"


@pytest.mark.asyncio
async def test_put_route_normalizes_and_returns_config():
    out = await set_playerplates(ConfigPayload(config={
        "source": "manual", "sides": {"1": {"name": "Zed"}, "2": {"visible": False}},
    }))
    assert out["success"] is True
    assert out["config"]["sides"]["2"]["visible"] is False
    got = await get_playerplates()
    assert got["config"]["sides"]["1"]["name"] == "Zed"
    assert got["1"]["active"] is True

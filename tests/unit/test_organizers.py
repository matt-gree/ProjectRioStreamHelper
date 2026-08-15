"""Organizers — the address-book-bound staff projector.

Same resolve-by-copy contract as Commentary: the authored list is participant
ids, and every projection writes the FULL owned key set
(``tournamentInfo.organizer_{0..2}_{name,twitter,pronoun}``, value or blank) so a
removed organizer blanks exactly what it set.

The interesting rule is the one that isn't shared: an ABSENT authored list means
"never authored" — legacy hand-typed organizers from before this shipped — and is
left completely alone, because a projector that owns its keys would otherwise
erase them the first time it ran.
"""
from server.api.v1.organizers import (
    OrganizersPayload,
    get_organizers as get_organizers_route,
    set_organizers as set_organizers_route,
)
from server.organizers import MAX_ORGANIZERS, Organizers
from server.participants import Participants
from server.state import State


def _seed_participant(pid, tag="", rio="", **display):
    Participants.participants[pid] = Participants._normalize({
        "id": pid,
        "identities": {"rioName": rio},
        "display": {"tag": tag, **display},
    }, pid)


def _org(i, field):
    return (State.state.get("tournamentInfo") or {}).get(f"organizer_{i}_{field}")


async def test_projects_the_registry_row_into_the_display_keys():
    _seed_participant("p_1", tag="Grump", twitter="@grump", pronoun="he/him")
    await Organizers.set_organizers([{"participantId": "p_1"}])
    assert _org(0, "name") == "Grump"
    assert _org(0, "twitter") == "@grump"
    assert _org(0, "pronoun") == "he/him"


async def test_falls_back_to_the_rio_name_when_there_is_no_display_tag():
    """Same join rule as Commentary: display.tag preferred, rioName behind it."""
    _seed_participant("p_1", rio="JustAGrump")
    await Organizers.set_organizers([{"participantId": "p_1"}])
    assert _org(0, "name") == "JustAGrump"


async def test_writes_the_full_key_set_so_a_removal_blanks_what_it_set():
    _seed_participant("p_1", tag="Grump", twitter="@grump")
    await Organizers.set_organizers([{"participantId": "p_1"}])
    await Organizers.set_organizers([])
    for i in range(MAX_ORGANIZERS):
        for field in ("name", "twitter", "pronoun"):
            assert _org(i, field) == "", f"organizer_{i}_{field}"


async def test_caps_the_list():
    for n in range(5):
        _seed_participant(f"p_{n}", tag=f"Org{n}")
    slots = await Organizers.set_organizers([{"participantId": f"p_{n}"} for n in range(5)])
    assert len(slots) == MAX_ORGANIZERS
    assert _org(2, "name") == "Org2"


async def test_an_unknown_participant_id_projects_blank_rather_than_failing():
    await Organizers.set_organizers([{"participantId": "p_gone"}])
    assert _org(0, "name") == ""


async def test_legacy_hand_typed_organizers_are_left_alone():
    """The migration. Nothing has been authored, so the projector owns nothing —
    projecting anyway would erase text a producer typed on an older version."""
    await State.SetBatch([
        ("tournamentInfo.organizer_0_name", "Typed By Hand"),
        ("tournamentInfo.organizer_0_twitter", "@typed"),
    ])
    assert Organizers.authored() is None
    await Organizers.project()
    assert _org(0, "name") == "Typed By Hand"
    assert _org(0, "twitter") == "@typed"


async def test_the_first_pick_takes_ownership_of_all_three_trios():
    """An empty LIST is authored-empty, unlike an absent one — so once the
    producer picks anyone, the projector owns and blanks the rest."""
    await State.Set("tournamentInfo.organizer_1_name", "Typed By Hand")
    _seed_participant("p_1", tag="Grump")
    await Organizers.set_organizers([{"participantId": "p_1"}])
    assert Organizers.authored() == [{"participantId": "p_1"}]
    assert _org(0, "name") == "Grump"
    assert _org(1, "name") == ""


async def test_an_address_book_edit_reflows_on_the_next_projection():
    """Resolve-by-copy: the registry stays out of the broadcast, so a rename
    reaches the overlays when the desk re-projects (change or restart)."""
    _seed_participant("p_1", tag="Grump")
    await Organizers.set_organizers([{"participantId": "p_1"}])
    _seed_participant("p_1", tag="Renamed", twitter="@new")
    await Organizers.project_all()
    assert _org(0, "name") == "Renamed"
    assert _org(0, "twitter") == "@new"


# ── the route ──────────────────────────────────────────────────────────────
# Direct handler calls, like the playerplates/commentary route tests: the
# routers are plain @router (the authored list is already broadcast by the State
# write), so there is nothing HTTP-shaped worth booting a client for.

async def test_route_replaces_the_list_and_reprojects():
    _seed_participant("p_1", tag="Grump", pronoun="they/them")
    res = await set_organizers_route(OrganizersPayload(organizers=[{"participantId": "p_1"}]))
    assert res["success"] is True
    assert res["organizers"] == [{"participantId": "p_1"}]
    assert _org(0, "pronoun") == "they/them"


async def test_route_reports_an_unauthored_list_as_empty():
    """`authored() is None` is a real state the server acts on, but not a
    distinction the client needs — it flattens on the wire."""
    assert (await get_organizers_route())["organizers"] == []

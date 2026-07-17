"""Commentary desk — slot normalization + the resolve-by-copy projector.

Locks the projector contract shared by Match/PlayerPlates/PostGame: every
projection writes the FULL owned key set (``commentary.{0..3}.*``, value or
blank) so a removed/empty slot blanks exactly what it set — no stale caster
left on air. Also pins the registry join (display.tag preferred over
identities.rioName) and the subField whitelist.
"""
from server.commentary import (
    Commentary, MAX_SLOTS, SUBFIELD_LABELS, _normalize_slot,
)
from server.participants import Participants
from server.state import State


def _seed_participant(pid, tag="", rio="", **display):
    Participants.participants[pid] = Participants._normalize({
        "id": pid,
        "identities": {"rioName": rio},
        "display": {"tag": tag, **display},
    }, pid)


def _slot(i):
    return (State.state.get("commentary") or {}).get(str(i)) or {}


# --- _normalize_slot ---

def test_normalize_slot_drops_unknown_subfield():
    out = _normalize_slot({"participantId": "p_1", "subField": "shoeSize"})
    assert out["subField"] == ""


def test_normalize_slot_keeps_whitelisted_subfield():
    out = _normalize_slot({"participantId": "p_1", "subField": "pronoun"})
    assert out["subField"] == "pronoun"


def test_normalize_slot_defaults_visibility_true():
    out = _normalize_slot({"participantId": "p_1"})
    assert out["visible"] is True
    assert out["subVisible"] is True


def test_normalize_slot_non_dict_becomes_empty_slot():
    out = _normalize_slot("garbage")
    assert out == {"participantId": None, "subField": "",
                   "visible": True, "subVisible": True}


# --- set_slots ---

async def test_set_slots_caps_at_max_slots():
    stored = await Commentary.set_slots(
        [{"participantId": f"p_{i}"} for i in range(MAX_SLOTS + 2)]
    )
    assert len(stored) == MAX_SLOTS
    assert State.state["commentary"]["slots"] == stored


# --- projection ---

async def test_project_resolves_tag_and_subfield_from_registry():
    _seed_participant("p_1", tag="Cap", rio="capRio", pronoun="they/them")
    await Commentary.set_slots([{"participantId": "p_1", "subField": "pronoun"}])
    s = _slot(0)
    assert s["name"] == "Cap"
    assert s["subLabel"] == SUBFIELD_LABELS["pronoun"]
    assert s["subValue"] == "they/them"
    assert s["visible"] is True


async def test_project_name_falls_back_to_rioname_without_tag():
    _seed_participant("p_1", tag="", rio="capRio")
    await Commentary.set_slots([{"participantId": "p_1"}])
    assert _slot(0)["name"] == "capRio"


async def test_project_rioname_subfield_reads_identities_not_display():
    # why: rioName lives under identities.*, every other subField under display.*
    _seed_participant("p_1", tag="Cap", rio="capRio")
    await Commentary.set_slots([{"participantId": "p_1", "subField": "rioName"}])
    assert _slot(0)["subValue"] == "capRio"


async def test_project_unknown_participant_resolves_blank_name():
    await Commentary.set_slots([{"participantId": "p_gone"}])
    s = _slot(0)
    assert s["name"] == ""
    assert s["visible"] is True  # authored visibility survives a failed resolve


async def test_project_always_writes_all_slots_blank_when_empty():
    await Commentary.set_slots([])
    for i in range(MAX_SLOTS):
        s = _slot(i)
        assert s["name"] == ""
        assert s["visible"] is False
        assert s["subVisible"] is False


async def test_shrinking_the_desk_blanks_the_vacated_slot():
    _seed_participant("p_1", tag="One")
    _seed_participant("p_2", tag="Two")
    await Commentary.set_slots([{"participantId": "p_1"},
                                {"participantId": "p_2"}])
    assert _slot(1)["name"] == "Two"
    await Commentary.set_slots([{"participantId": "p_1"}])
    # why: the deterministic full-key-set write is what keeps a removed caster
    # from lingering on the overlay.
    assert _slot(1)["name"] == ""
    assert _slot(1)["visible"] is False


async def test_reproject_reflects_registry_edit():
    _seed_participant("p_1", tag="Old")
    await Commentary.set_slots([{"participantId": "p_1"}])
    Participants.participants["p_1"]["display"]["tag"] = "New"
    await Commentary.project()
    assert _slot(0)["name"] == "New"

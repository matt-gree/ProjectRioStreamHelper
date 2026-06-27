"""Commentary element — registry-bound caster slots (Phase 4).

The commentary desk is its OWN object (``commentary.*`` in State), emphatically
separate from ``match.{M}`` and ``score.{N}``. The producer assigns up to four
address-book participants to ordered slots and picks, per slot, which address-book
field shows on that caster's sub-plate.

Like ``server/match.py``, this is a **resolve-by-copy** projector: the authored
assignment lives at ``commentary.slots`` (an ordered list of participant ids +
choices), and a projector resolves each slot against the participant registry and
writes the display-only keys the overlay reads (``commentary.{i}.*``). The registry
itself stays OUT of the broadcast — only the resolved name + chosen field value go
on the wire. Re-projection runs whenever the assignment changes and at startup, so
an address-book edit re-flows on the next change/restart (same contract as Match).
"""
from loguru import logger

from server.participants import Participants
from server.state import State

MAX_SLOTS = 4

# Address-book fields offered for the sub-plate, key → human label. The key is an
# `identities.rioName` / `display.*` field on a participant row. Keep in sync with
# SUBFIELD_OPTIONS in src/context/commentary.js (the client offers the same list;
# this dict is the authoritative validator).
SUBFIELD_LABELS = {
    "fullName": "Full Name",
    "pronoun": "Pronouns",
    "prefix": "Prefix",
    "mainCharacter": "Main",
    "country": "Country",
    "state": "State",
    "twitter": "Twitter",
    "youtube": "YouTube",
    "rioName": "Rio Name",
}

# Every projected key the projector owns for one slot. A projection ALWAYS writes
# the full set (resolved value or blank) so re-projection is deterministic and a
# removed/empty slot blanks exactly what it set — no stale caster left on air.
_BLANK_SLOT = {
    "name": "",
    "subField": "",
    "subLabel": "",
    "subValue": "",
    "visible": False,
    "subVisible": False,
}


def _normalize_slot(raw) -> dict:
    """Coerce one authored slot into the stored shape (drops unknown subFields)."""
    raw = raw if isinstance(raw, dict) else {}
    sub = raw.get("subField") or ""
    if sub not in SUBFIELD_LABELS:
        sub = ""
    return {
        "participantId": raw.get("participantId") or None,
        "subField": sub,
        "visible": bool(raw.get("visible", True)),
        "subVisible": bool(raw.get("subVisible", True)),
    }


def _resolve_name(row: dict | None) -> str:
    if not row:
        return ""
    return (row.get("display") or {}).get("tag") \
        or (row.get("identities") or {}).get("rioName") or ""


def _resolve_sub(row: dict | None, field: str) -> str:
    if not row or not field:
        return ""
    if field == "rioName":
        return (row.get("identities") or {}).get("rioName") or ""
    return (row.get("display") or {}).get(field) or ""


class Commentary:
    """Reads/writes ``commentary.*`` through State and projects resolved casters.

    Stateless singleton (mirrors State/Settings/Match): all data lives in the
    State store; these classmethods are the projection + lifecycle logic.
    """

    @classmethod
    def slots(cls) -> list:
        c = State.state.get("commentary", {}) or {}
        s = c.get("slots")
        return s if isinstance(s, list) else []

    @classmethod
    def _project_entries(cls) -> list[tuple]:
        slots = cls.slots()
        entries: list[tuple] = []
        for i in range(MAX_SLOTS):
            base = f"commentary.{i}"
            raw = slots[i] if i < len(slots) else None
            vals = dict(_BLANK_SLOT)
            if isinstance(raw, dict):
                pid = raw.get("participantId")
                row = Participants.Get(pid) if pid else None
                sub_field = raw.get("subField") or ""
                vals["name"] = _resolve_name(row)
                vals["subField"] = sub_field
                vals["subLabel"] = SUBFIELD_LABELS.get(sub_field, "")
                vals["subValue"] = _resolve_sub(row, sub_field)
                vals["visible"] = bool(raw.get("visible", True))
                vals["subVisible"] = bool(raw.get("subVisible", True))
            entries.extend((f"{base}.{k}", v) for k, v in vals.items())
        return entries

    @classmethod
    async def set_slots(cls, raw_slots) -> list:
        """Replace the authored slot list (capped at MAX_SLOTS) and re-project."""
        slots = [_normalize_slot(s) for s in (raw_slots or [])][:MAX_SLOTS]
        await State.Set("commentary.slots", slots)
        await cls.project()
        return slots

    @classmethod
    async def project(cls) -> None:
        """Resolve every slot against the registry and write the overlay keys."""
        await State.SetBatch(cls._project_entries())
        await State.Save()

    @classmethod
    async def project_all(cls) -> None:
        """Startup hook — re-resolve the persisted desk against the current
        registry. Logs and no-ops on failure; never blocks boot."""
        try:
            await cls.project()
        except Exception:
            logger.exception("[Commentary] project_all failed")

"""Organizers — the competition's staff, bound to the address book.

A **resolve-by-copy projector**, the same shape as ``server/commentary.py``: the
authored assignment is an ordered list of participant ids at
``tournamentInfo.organizers``, and a projector resolves each against the registry
and writes the display-only keys that already existed —
``tournamentInfo.organizer_{i}_{name,twitter,pronoun}``.

WHY IT IS A REFERENCE AND NOT NINE TEXT FIELDS. The Competition tab carried three
trios of free text, so the same person's handle was typed here, and again on a
commentary slot, and again on a player row — three copies free to disagree, and
none of them the address book that exists to be the one answer. Picking the row
instead means an edit in the Address Book reflows everywhere on the next
change/restart, which is the contract Match, Commentary and PlayerPlates already
share.

THE PROJECTED KEYS ARE UNCHANGED ON PURPOSE. They are what the per-key
``stream_labels/`` .txt mirror writes, so a producer pointing an OBS text source
at ``tournamentInfo/organizer_0_name.txt`` keeps working, and any future overlay
reads the same keys it would have read before.

**Absent means never authored, and is left alone.** A projector owns its key set
and writes it whole (value or blank), which would wipe hand-typed organizers the
moment this shipped. So ``organizers`` missing = legacy text, untouched; an empty
LIST = authored empty, and blanks the trio. That distinction is the migration.
"""
from server.participants import Participants
from server.state import State
from server.utils.projection import run_startup_projection

MAX_ORGANIZERS = 3

# Every projected key one slot owns. Written in full on each projection (value or
# blank) so removing an organizer blanks exactly what it set.
_BLANK_SLOT = {
    "name": "",
    "twitter": "",
    "pronoun": "",
}


def _resolve(row: dict | None) -> dict:
    """One registry row → the trio the overlays/labels read."""
    if not row:
        return dict(_BLANK_SLOT)
    display = row.get("display") or {}
    return {
        "name": display.get("tag") or (row.get("identities") or {}).get("rioName") or "",
        "twitter": display.get("twitter") or "",
        "pronoun": display.get("pronoun") or "",
    }


class Organizers:
    """Reads/writes ``tournamentInfo.organizers`` and projects resolved staff.

    Stateless singleton (mirrors State/Settings/Commentary): the data lives in
    the State store; these classmethods are the projection + lifecycle logic.
    """

    @classmethod
    def authored(cls) -> list | None:
        """The authored id list, or None when the producer has never set one.

        None is not an empty list — see the module note. Callers that project
        must respect the difference or they will blank legacy text.
        """
        info = State.state.get("tournamentInfo", {}) or {}
        raw = info.get("organizers")
        return raw if isinstance(raw, list) else None

    @classmethod
    def _normalize(cls, raw) -> list[dict]:
        """Coerce the authored list into the stored shape (id or nothing)."""
        out = []
        for slot in (raw or [])[:MAX_ORGANIZERS]:
            pid = slot.get("participantId") if isinstance(slot, dict) else slot
            out.append({"participantId": pid or None})
        return out

    @classmethod
    def _project_entries(cls) -> list[tuple]:
        slots = cls.authored()
        if slots is None:
            return []
        entries: list[tuple] = []
        for i in range(MAX_ORGANIZERS):
            raw = slots[i] if i < len(slots) else None
            pid = raw.get("participantId") if isinstance(raw, dict) else None
            vals = _resolve(Participants.Get(pid) if pid else None)
            entries.extend((f"tournamentInfo.organizer_{i}_{k}", v) for k, v in vals.items())
        return entries

    @classmethod
    async def set_organizers(cls, raw_slots) -> list:
        """Replace the authored list (capped at MAX_ORGANIZERS) and re-project."""
        slots = cls._normalize(raw_slots)
        await State.Set("tournamentInfo.organizers", slots)
        await cls.project()
        return slots

    @classmethod
    async def project(cls) -> None:
        """Resolve every slot against the registry and write the display keys."""
        entries = cls._project_entries()
        if not entries:
            return
        await State.SetBatch(entries)
        await State.Save()

    @classmethod
    async def project_all(cls) -> None:
        """Startup hook — re-resolve the persisted list against the current
        registry. Logs and no-ops on failure; never blocks boot."""
        await run_startup_projection("Organizers", cls.project())

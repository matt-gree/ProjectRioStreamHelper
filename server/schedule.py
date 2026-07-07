"""Schedule — the producer's ordered queue of upcoming matches.

A thin object in central State (``schedule.*``) that references matches by id —
the queue never copies fixture data. Overlays (the upcoming-schedule element,
lower-third Match slots) resolve each queued id against ``match.{M}.*``, which is
already broadcast, so a fixture edit re-renders the schedule with no projector.

    schedule.queue   ordered list of match ids (ints)
    schedule.title   optional heading ("Today's Matches")

Deleting a match prunes it from the queue (see api/v1/match.delete_match).
"""
from server.state import State


class Schedule:
    """Stateless singleton over ``schedule.*`` (mirrors State/Match)."""

    @classmethod
    def queue(cls) -> list[int]:
        raw = (State.state.get("schedule", {}) or {}).get("queue") or []
        out = []
        for v in raw:
            try:
                out.append(int(v))
            except (TypeError, ValueError):
                continue
        return out

    @classmethod
    async def set_queue(cls, ids: list[int]) -> list[int]:
        """Replace the queue. Unknown match ids are dropped, duplicates keep
        their first position — the queue always references real matches."""
        matches = State.state.get("match", {}) or {}
        seen: set[int] = set()
        clean: list[int] = []
        for v in ids:
            try:
                m = int(v)
            except (TypeError, ValueError):
                continue
            if m in seen or str(m) not in matches:
                continue
            seen.add(m)
            clean.append(m)
        await State.Set("schedule.queue", clean)
        await State.Save()
        return clean

    @classmethod
    async def remove(cls, m) -> list[int]:
        """Drop one match id from the queue (no-op when absent)."""
        try:
            mid = int(m)
        except (TypeError, ValueError):
            return cls.queue()
        q = [x for x in cls.queue() if x != mid]
        await State.Set("schedule.queue", q)
        await State.Save()
        return q

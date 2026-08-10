"""Schedule — the producer's ordered queue of upcoming matches.

A thin object in central State (``schedule.*``) that references matches by id —
the queue never copies fixture data. Overlays (the upcoming-schedule element,
lower-third Match slots) resolve each queued id against ``match.{M}.*``, which is
already broadcast, so a fixture edit re-renders the schedule with no projector.

    schedule.queue   ordered list of match ids (ints)
    schedule.title   optional heading ("Today's Matches")

Deleting a match prunes it from the queue (see api/v1/match.delete_match).

THE QUEUE IS AN ORDER, NOT A CURSOR. There is deliberately no "current position"
here, and adding one would be a bug: a PRSH stream can have several matches live
at once (two games side by side on one canvas), and when one finishes early the
next queued fixture fills *that* slot while the other keeps running. A single
position can't express that. So "what's next" is resolved per board, from what is
bound and what is decided — see ``next_up``.
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
    async def append(cls, m) -> list[int]:
        """Put match ``m`` at the end of the running order (no-op if already in).

        Called when a match is CREATED, which is why it exists as its own verb
        rather than the UI sending a whole list back: a new fixture is almost
        always part of tonight, and a producer who authors eight matches should
        not have to enrol each one. Taking one out again is one click on the Match
        desk — the queue stays a curated order, it just starts out useful.
        """
        try:
            mid = int(m)
        except (TypeError, ValueError):
            return cls.queue()
        q = cls.queue()
        if mid in q:
            return q
        q.append(mid)
        await State.Set("schedule.queue", q)
        await State.Save()
        return q

    @classmethod
    async def move(cls, m, delta: int) -> list[int]:
        """Shift match ``m`` by ``delta`` places in the order, clamped to the ends.

        A per-id verb, not a whole-list write. The UI used to send the entire
        reordered queue back, which silently drops anything added between its read
        and its PUT — and now that creating a match enrols it, that window is real.
        """
        try:
            mid = int(m)
            step = int(delta)
        except (TypeError, ValueError):
            return cls.queue()
        q = cls.queue()
        if mid not in q or step == 0:
            return q
        i = q.index(mid)
        j = max(0, min(len(q) - 1, i + step))
        if i == j:
            return q
        q.insert(j, q.pop(i))
        await State.Set("schedule.queue", q)
        await State.Save()
        return q

    @classmethod
    def is_up_next_eligible(cls, m) -> bool:
        """Is match ``m`` a fixture still waiting to be put on a board?

        Four conditions, and each one rules out a state that would otherwise make
        "next" hand back something the producer has already dealt with:

        * **it exists** — a queued id whose match was deleted is not a fixture;
        * **nothing holds it** — a match fills exactly one board (``bind_board``),
          so one already on air is not waiting for one;
        * **its series is undecided** — ``decided`` is the record of a finished
          fixture. Note this is NOT ``stage``: a Bo3 sits at ``stage: post``
          between games and is very much still the current fixture, so stage is
          the wrong question to ask about a *fixture* being done;
        * **it has never started** (``stage == 'draft'``) — the anti-bounce rule.
          Without it, moving a board off an undecided fixture leaves that fixture
          queued, unbound and undecided, so it is immediately "next" again and the
          verb ping-pongs between two matches. A fixture that has been on a board
          and been fed (``note_live`` → ``live``) is mid-lifecycle; the producer
          binds it by hand from the Match desk rather than being offered it as
          fresh.
        """
        try:
            mid = int(m)
        except (TypeError, ValueError):
            return False
        match = (State.state.get("match", {}) or {}).get(str(mid))
        if not isinstance(match, dict):
            return False
        if match.get("decided") in (1, 2, "1", "2"):
            return False
        if (match.get("stage") or "draft") != "draft":
            return False
        # Import here: server.match imports nothing from this module, and keeping
        # it that way is what stops a cycle.
        from server.match import Match
        return not Match.bound_scoreboards(mid)

    @classmethod
    def next_up(cls) -> int | None:
        """The first queued fixture waiting for a board, or None.

        Board-agnostic on purpose. Two boards asking take two different matches
        because binding the first removes it from the eligible set, which is what
        lets a rig run several fixtures at once and fill whichever slot frees up —
        no per-board queue, no shared cursor.
        """
        for m in cls.queue():
            if cls.is_up_next_eligible(m):
                return m
        return None

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

"""Schedule — the producer's running orders over upcoming matches.

A thin object in central State (``schedule.*``) that references matches by id —
a queue never copies fixture data. Overlays resolve each id against ``match.{M}.*``,
which is already broadcast, so a fixture edit re-renders the schedule for free.

    schedule.queues   ordered list of {id, title, matches: [match ids]}
    schedule.queue    PROJECTION: the union of every queue, in queue order
    schedule.title    the schedule OVERLAY's heading — independent of any queue's
                      title, and owned by the ticker's own stage panel

SEVERAL QUEUES, ONE PER STREAM OF FIXTURES. A night can run winners-bracket
matches and losers-bracket matches as two independently ordered lists, and a board
draws from one of them (``scoreboards.match_queue.{N}`` in Settings, defaulting to
the first). Membership is EXCLUSIVE across queues — a match sits in at most one, so
"which queue holds this fixture" always has exactly one answer, which is what the
per-id move verb needs. Mirrors the container-roster rule.

``schedule.queue`` IS A PROJECTION, not a second source of truth: it is rewritten
from ``schedule.queues`` after every mutation, the same resolve-and-copy pattern the
Match projector uses. It exists so the schedule overlay and the console's subject
line keep reading one flat ordered list — the union, deliberately, so that creating
a second queue never silently drops a fixture off air. Never write it directly.

Deleting a match prunes it from every queue (see api/v1/match.delete_match).

THE QUEUE IS AN ORDER, NOT A CURSOR. There is deliberately no "current position"
here, and adding one would be a bug: a PRSH stream can have several matches live
at once (two games side by side on one canvas), and when one finishes early the
next queued fixture fills *that* slot while the other keeps running. A single
position can't express that. So "what's next" is resolved per board, from what is
bound and what is decided — see ``next_up``.
"""
import re

from server.state import State

# The id a lone queue gets on migration from the single-queue model. Stable: a
# board's Settings assignment and any future URL param reference it by id.
DEFAULT_QUEUE_ID = "main"


def queue_id_for(title: str, taken) -> str:
    """A stable slug id for a queue title, deduped against ``taken``.

    Mirrors ``containerIdFor`` (src/routes/production/containers.js): the id is
    minted once from the title and never changes, so renaming edits ``title`` —
    the only field any surface displays — and never breaks a board's assignment.
    """
    slug = re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", (title or "").lower()))
    base = slug or "queue"
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


class Schedule:
    """Stateless singleton over ``schedule.*`` (mirrors State/Match)."""

    # ----- reads -----------------------------------------------------------

    @classmethod
    def _raw_queues(cls) -> list:
        return (State.state.get("schedule", {}) or {}).get("queues") or []

    @classmethod
    def queues(cls) -> list[dict]:
        """Every queue, normalized: ``{id, title, matches: [int]}``.

        Drops ids whose match no longer exists and de-duplicates within *and*
        across queues (membership is exclusive), so callers never have to defend
        against a stale reference.
        """
        matches = State.state.get("match", {}) or {}
        seen: set[int] = set()
        out: list[dict] = []
        for i, raw in enumerate(cls._raw_queues()):
            if not isinstance(raw, dict):
                continue
            qid = str(raw.get("id") or "").strip() or f"queue-{i + 1}"
            clean: list[int] = []
            for v in raw.get("matches") or []:
                try:
                    m = int(v)
                except (TypeError, ValueError):
                    continue
                if m in seen or str(m) not in matches:
                    continue
                seen.add(m)
                clean.append(m)
            out.append({"id": qid, "title": str(raw.get("title") or ""), "matches": clean})
        return out

    @classmethod
    def queue_ids(cls) -> list[str]:
        return [q["id"] for q in cls.queues()]

    @classmethod
    def first_queue_id(cls) -> str | None:
        qs = cls.queues()
        return qs[0]["id"] if qs else None

    @classmethod
    def get_queue(cls, qid=None) -> dict | None:
        """One queue by id, or the first when ``qid`` is falsy."""
        qs = cls.queues()
        if not qs:
            return None
        if not qid:
            return qs[0]
        for q in qs:
            if q["id"] == str(qid):
                return q
        return None

    @classmethod
    def matches(cls, qid=None) -> list[int]:
        """One queue's ordered match ids (the first queue when ``qid`` is falsy)."""
        q = cls.get_queue(qid)
        return list(q["matches"]) if q else []

    @classmethod
    def queue(cls) -> list[int]:
        """THE UNION, in queue order — what the projection holds.

        Kept as ``queue()`` because it is what every existing caller means by "the
        running order" on a single-queue rig, where the union IS that queue.
        """
        return [m for q in cls.queues() for m in q["matches"]]

    @classmethod
    def queue_of(cls, m) -> str | None:
        """Which queue holds match ``m``, or None. Single-valued by construction."""
        try:
            mid = int(m)
        except (TypeError, ValueError):
            return None
        for q in cls.queues():
            if mid in q["matches"]:
                return q["id"]
        return None

    @classmethod
    def queue_for_board(cls, sb) -> str | None:
        """The queue board ``sb`` draws its next fixture from.

        Unassigned falls back to the FIRST queue, so a one-queue rig behaves
        exactly as it did before queues existed and a producer never has to
        configure anything to get Up next working.
        """
        from server.settings import Settings
        qid = Settings.Get(f"scoreboards.match_queue.{int(sb)}", None)
        if qid and cls.get_queue(qid):
            return str(qid)
        return cls.first_queue_id()

    # ----- writes ----------------------------------------------------------

    @classmethod
    async def _commit(cls, queues: list[dict]) -> list[dict]:
        """Store ``queues`` and re-project the flat union readers depend on.

        THE ONLY CHANGE DETECTION IS HERE, and every mutation calls it
        unconditionally — no verb decides for itself that it has nothing to do.
        That rule is load-bearing: ``queues()`` prunes ids whose match no longer
        exists, so after ``delete_match`` unsets the match there is nothing left
        for ``remove`` to filter. It used to early-out at that point and skip the
        write, leaving the *projection* holding a fixture that no longer existed —
        a deleted match still drawn on the schedule overlay. Correctness cannot
        depend on each verb's early-out being right about a normalization step it
        can't see.
        """
        clean = [
            {"id": q["id"], "title": q.get("title") or "", "matches": list(q.get("matches") or [])}
            for q in queues
        ]
        union = [m for q in clean for m in q["matches"]]
        sched = State.state.get("schedule", {}) or {}
        if sched.get("queues") == clean and sched.get("queue") == union:
            return cls.queues()
        await State.SetBatch([
            ("schedule.queues", clean),
            # The projection. Written in the same batch as the model so no client
            # can ever observe the two disagreeing.
            ("schedule.queue", union),
        ])
        await State.Save()
        return cls.queues()

    @classmethod
    async def ensure_migrated(cls) -> None:
        """Boot hook: fold the old flat ``schedule.queue`` into ``schedule.queues``.

        ``schedule.queue`` was the whole model before queues existed. It is read
        here exactly once and then becomes a projection of the union — the
        read-only-fallback pattern (cf. `scoreboards.sources`), so the migration is
        not re-run against its own output.

        ``schedule.title`` is NOT touched. It is the schedule OVERLAY's heading, a
        broadcast string the ticker's own panel owns, and an order's title is a
        producer's private label for a list of fixtures. Projecting the first order's
        title into it headed a union of Winners + Losers with the word "WINNERS" —
        true of the first order, a lie about what was on screen.
        """
        if cls._raw_queues():
            return
        legacy: list[int] = []
        for v in (State.state.get("schedule", {}) or {}).get("queue") or []:
            try:
                legacy.append(int(v))
            except (TypeError, ValueError):
                continue
        await cls._commit([{
            "id": DEFAULT_QUEUE_ID,
            "title": "Main",
            "matches": legacy,
        }])

    @classmethod
    async def create_queue(cls, title: str) -> dict:
        """Add a queue at the end of the list. Its id is minted from the title."""
        qs = cls.queues()
        qid = queue_id_for(title, {q["id"] for q in qs})
        qs.append({"id": qid, "title": str(title or ""), "matches": []})
        await cls._commit(qs)
        return cls.get_queue(qid)

    @classmethod
    async def rename_queue(cls, qid, title: str) -> list[dict]:
        qs = cls.queues()
        for q in qs:
            if q["id"] == str(qid):
                q["title"] = str(title or "")
        return await cls._commit(qs)

    @classmethod
    async def delete_queue(cls, qid) -> list[dict]:
        """Drop a queue. Its matches survive — they just stop being enrolled.

        The last queue is never removed: a rig with none has nowhere for a new
        fixture to enrol and no answer for `queue_for_board`, which is the same
        reason at least one scoreboard always remains.
        """
        qs = cls.queues()
        if len(qs) <= 1:
            return qs
        return await cls._commit([q for q in qs if q["id"] != str(qid)])

    @classmethod
    async def move_queue(cls, qid, delta: int) -> list[dict]:
        """Shift a whole queue's position in the list, clamped to the ends."""
        qs = cls.queues()
        ids = [q["id"] for q in qs]
        if str(qid) not in ids:
            return qs
        i = ids.index(str(qid))
        j = max(0, min(len(qs) - 1, i + int(delta or 0)))
        if i != j:
            qs.insert(j, qs.pop(i))
        return await cls._commit(qs)

    @classmethod
    async def set_queue(cls, ids: list[int], qid=None) -> list[int]:
        """Replace ONE queue's order wholesale (validated against real matches).

        The legacy whole-list write. Kept for callers that genuinely own an entire
        order; the UI must not use it for a one-match change — see ``move``.
        """
        target = str(qid) if qid else cls.first_queue_id()
        if target is None:
            await cls.ensure_migrated()
            target = cls.first_queue_id()
        matches = State.state.get("match", {}) or {}
        wanted: list[int] = []
        for v in ids:
            try:
                m = int(v)
            except (TypeError, ValueError):
                continue
            if m not in wanted and str(m) in matches:
                wanted.append(m)
        qs = cls.queues()
        for q in qs:
            if q["id"] == target:
                q["matches"] = wanted
            else:
                # Exclusivity: taking a match into this queue takes it out of
                # whichever one held it.
                q["matches"] = [m for m in q["matches"] if m not in wanted]
        await cls._commit(qs)
        return cls.matches(target)

    @classmethod
    async def append(cls, m, qid=None) -> list[int]:
        """Put match ``m`` at the end of a queue (no-op if it is already in that one).

        Called when a match is CREATED, which is why it exists as its own verb
        rather than the UI sending a whole list back: a new fixture is almost
        always part of tonight, and a producer who authors eight matches should
        not have to enrol each one. Taking one out again is one click on the Match
        desk — the queue stays a curated order, it just starts out useful.

        Appending to a different queue MOVES the match, because membership is
        exclusive: a fixture belongs to one running order.
        """
        try:
            mid = int(m)
        except (TypeError, ValueError):
            return cls.matches(qid)
        if not cls.queues():
            await cls.ensure_migrated()
        target = str(qid) if qid else cls.first_queue_id()
        if target is None:
            return []
        qs = cls.queues()
        for q in qs:
            if q["id"] == target:
                if mid not in q["matches"]:
                    q["matches"] = [*q["matches"], mid]
            else:
                q["matches"] = [x for x in q["matches"] if x != mid]
        await cls._commit(qs)
        return cls.matches(target)

    @classmethod
    async def move(cls, m, delta: int) -> list[int]:
        """Shift match ``m`` by ``delta`` places WITHIN its own queue, clamped.

        A per-id verb, not a whole-list write. The UI used to send the entire
        reordered queue back, which silently drops anything added between its read
        and its PUT — and now that creating a match enrols it, that window is real.

        The queue is looked up from the match rather than passed in, so a client
        cannot reorder against a stale idea of which queue holds it.
        """
        try:
            mid = int(m)
            step = int(delta)
        except (TypeError, ValueError):
            return []
        target = cls.queue_of(mid)
        if target is None:
            return []
        qs = cls.queues()
        for q in qs:
            if q["id"] != target:
                continue
            order = q["matches"]
            i = order.index(mid)
            # Clamped to THIS order's ends — position and membership are different
            # verbs, so walking the last fixture "down" must never spill it into
            # the next queue.
            j = max(0, min(len(order) - 1, i + step))
            if i != j:
                order.insert(j, order.pop(i))
        # Committed even when the move was a clamped no-op: _commit owns change
        # detection, and this call is also what flushes a pending prune.
        await cls._commit(qs)
        return cls.matches(target)

    @classmethod
    async def remove(cls, m) -> list[int]:
        """Drop one match id from EVERY queue (no-op when absent).

        Every queue, not just the one that holds it: this is also the prune path
        for a deleted match, and a stale id in a second queue would resurface as a
        phantom row the moment membership stopped being exclusive.
        """
        try:
            mid = int(m)
        except (TypeError, ValueError):
            return cls.queue()
        qs = cls.queues()
        for q in qs:
            q["matches"] = [x for x in q["matches"] if x != mid]
        await cls._commit(qs)
        return cls.queue()

    # ----- what's next -----------------------------------------------------

    @classmethod
    def not_waiting_reason(cls, m) -> str | None:
        """Why match ``m`` is NOT waiting to be put on a board — or None when it is.

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

        THE REASON IS RETURNED, not just the verdict, because the fourth condition
        is otherwise invisible and strands fixtures. ``stage`` has no producer-facing
        writer on the server — it is set by ``note_live`` and the post-game paths —
        so a match fed once and then unbound sat queued, unbound and undecided while
        Up next stayed silent about it forever, with a badge as the only clue. The
        console reads these strings and says which condition is holding a fixture
        back; the Match desk's stage control is what clears the last one.

        Membership is deliberately NOT one of the conditions: ``next_up`` walks a
        queue, so being in one is the caller's question, not this one's.
        """
        try:
            mid = int(m)
        except (TypeError, ValueError):
            return "the match no longer exists"
        match = (State.state.get("match", {}) or {}).get(str(mid))
        if not isinstance(match, dict):
            return "the match no longer exists"
        # Import here: server.match imports nothing from this module, and keeping
        # it that way is what stops a cycle.
        from server.match import Match
        held = Match.bound_scoreboards(mid)
        if held:
            return f"it is already on board {held[0]}"
        if match.get("decided") in (1, 2, "1", "2"):
            return "the series is decided"
        if (match.get("stage") or "draft") != "draft":
            return "it has already been played"
        return None

    @classmethod
    def is_up_next_eligible(cls, m) -> bool:
        """Is match ``m`` a fixture still waiting to be put on a board?

        One rule, stated once in ``not_waiting_reason`` — the verdict and the
        explanation must never be able to disagree.
        """
        return cls.not_waiting_reason(m) is None

    @classmethod
    def next_up(cls, qid=None) -> int | None:
        """The first fixture in queue ``qid`` waiting for a board, or None.

        Board-agnostic *within* a queue, on purpose. Two boards drawing from the
        same queue take two different matches because binding the first removes it
        from the eligible set, which is what lets a rig run several fixtures at once
        and fill whichever slot frees up — no per-board queue, no shared cursor.

        ``qid`` falsy means the first queue, so single-queue rigs need no argument.
        """
        for m in cls.matches(qid):
            if cls.is_up_next_eligible(m):
                return m
        return None

    @classmethod
    def next_up_for_board(cls, sb) -> int | None:
        """What board ``sb`` would take — ``next_up`` on the queue it draws from."""
        return cls.next_up(cls.queue_for_board(sb))

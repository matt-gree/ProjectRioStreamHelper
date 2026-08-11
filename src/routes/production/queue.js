import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../context/store';

/*
 * The queue — `schedule.queue`, an ORDER over matches, read from the board's side.
 *
 * A board takes the next fixture waiting for one. What makes that possible without
 * a stored cursor is that "waiting" is derivable: a match nothing holds, nothing
 * has decided, and nothing has started yet. The server owns the resolution
 * (`Schedule.next_up` + `POST /scoreboards/{sb}/next-match`, resolve and bind under
 * one lock); this is the client's PREVIEW of the same answer, so the button can
 * name the fixture it is about to put up.
 *
 * PREVIEW, not policy. A stale label is harmless — the take re-resolves on the
 * server and is the only thing that decides. The rule is mirrored here for one
 * reason only: a button that says "Up next" without saying what is not worth
 * pressing.
 *
 * NO CURSOR, and never add one. A PRSH stream can run several matches at once —
 * two games side by side, one finishing early and its slot taking the next
 * fixture while the other keeps running. A single position cannot express that,
 * and a queue that assumed one chain would make the common two-board case
 * unrepresentable. Everything here walks the order and asks per match.
 */

/*
 * WHY this match is not a fixture waiting for a board — or null when it is.
 * Mirrors `Schedule.not_waiting_reason` on the server, wording included; keep
 * the two in step.
 *
 * `decided` is the finished test, NOT `stage`: a Bo3 sits at `stage: post`
 * between games and is still the current fixture. `stage === 'draft'` is a
 * separate, anti-bounce test — a fixture that has already been on a board and
 * been fed would otherwise become "next" again the moment the board moves off it,
 * and the verb would ping-pong between two matches.
 *
 * The reason is what the Match desk shows. `stage` has no writer a producer can
 * see, so the anti-bounce test used to strand a fed-then-unbound fixture out of
 * Up next silently — the rule is fine, its invisibility was the bug.
 */
export function notWaitingReason(match, boundIds, boundBoard = null) {
    if (!match) return 'the match no longer exists';
    if (boundIds.has(String(match.__id))) {
        return boundBoard ? `it is already on board ${boundBoard}` : 'it is already on a board';
    }
    const d = match.decided;
    if (d === 1 || d === 2 || d === '1' || d === '2') return 'the series is decided';
    if ((match.stage || 'draft') !== 'draft') return 'it has already been played';
    return null;
}

function waiting(match, boundIds) {
    return notWaitingReason(match, boundIds) === null;
}

/*
 * The next queued fixture waiting for a board: `{ id, label }` or null.
 *
 * One selector, flat and all-primitive, so a board panel re-reading this on every
 * HUD frame doesn't re-render on unrelated writes (the same rule as
 * `useSideTeam`).
 */
export function useNextUp() {
    const flat = useStateStore(useShallow((s) => {
        const queue = s?.schedule?.queue;
        if (!Array.isArray(queue) || queue.length === 0) return ['', ''];
        const matches = s?.match ?? {};
        const bound = new Set(
            Object.values(s?.score ?? {})
                .map(b => (b?.match != null ? String(b.match) : null))
                .filter(Boolean),
        );
        for (const raw of queue) {
            const id = String(raw);
            const match = matches[id];
            if (!waiting(match ? { ...match, __id: id } : null, bound)) continue;
            const n1 = match?.player?.[1]?.rioName || match?.player?.['1']?.rioName || '';
            const n2 = match?.player?.[2]?.rioName || match?.player?.['2']?.rioName || '';
            const names = n1 && n2 ? `${n1} vs ${n2}` : (n1 || n2 || '');
            return [id, names || match?.label || `Match ${id}`];
        }
        return ['', ''];
    }));
    return flat[0] ? { id: Number(flat[0]), label: flat[1] } : null;
}

/*
 * THE ORDER ITSELF, for the surface that authors it (the Match desk).
 *
 * Returns the queue as a flat array of id strings, pruned to matches that still
 * exist — a queued id whose match was deleted is not a position, and the server
 * prunes it on delete anyway. The Match desk lists its accordions in exactly this
 * order, which is the whole point: the night's running order and the desk's stack
 * are one list, not two views that can disagree.
 *
 * `useShallow` over an array of strings, so this compares element-wise: reordering
 * re-renders, and the ~100 unrelated keys a live HUD frame writes do not.
 */
export function useQueueOrder() {
    return useStateStore(useShallow((s) => {
        const queue = s?.schedule?.queue;
        if (!Array.isArray(queue)) return [];
        const matches = s?.match ?? {};
        const seen = new Set();
        const out = [];
        for (const raw of queue) {
            const id = String(raw);
            if (seen.has(id) || !matches[id]) continue;
            seen.add(id);
            out.push(id);
        }
        return out;
    }));
}

/*
 * ONE MATCH'S readiness, for the record's own surface (the Match desk).
 *
 * Returns the reason it is not waiting for a board, or null when it is. A plain
 * selector, not `useShallow`: the return is a string, so default equality already
 * skips the re-render on the ~100 unrelated keys a live HUD frame writes.
 *
 * Membership is not folded in here — the desk knows whether the match is enrolled
 * from its position in the order, and "not in the running order" is a different
 * kind of answer (it is not offered because you took it out) from the four
 * conditions, which are all about the fixture's own state.
 */
export function useWaitingReason(m) {
    return useStateStore((s) => {
        const id = String(m);
        const match = s?.match?.[id];
        if (!match) return 'the match no longer exists';
        let boundBoard = null;
        for (const [sb, b] of Object.entries(s?.score ?? {})) {
            if (b?.match != null && String(b.match) === id) { boundBoard = sb; break; }
        }
        return notWaitingReason(
            { ...match, __id: id },
            new Set(boundBoard ? [id] : []),
            boundBoard,
        );
    });
}

/** How many queued fixtures are still waiting for a board. */
export function useWaitingCount() {
    return useStateStore(useShallow((s) => {
        const queue = s?.schedule?.queue;
        if (!Array.isArray(queue)) return 0;
        const matches = s?.match ?? {};
        const bound = new Set(
            Object.values(s?.score ?? {})
                .map(b => (b?.match != null ? String(b.match) : null))
                .filter(Boolean),
        );
        let n = 0;
        for (const raw of queue) {
            const id = String(raw);
            const match = matches[id];
            if (waiting(match ? { ...match, __id: id } : null, bound)) n += 1;
        }
        return n;
    }));
}

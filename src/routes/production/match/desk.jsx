import { Fragment, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Plus } from 'lucide-react';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { createMatch } from '../../../context/match';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { notifications } from '../../../lib/notify';
import { useActiveBoards, useMatchBindableBoards } from '../board/boards';
import { useQueueOrder, useQueues, useWaitingCount } from './queue';
import { useGameModes } from '../board/gamemodes';
import { MatchAccordion, decidedSide } from './accordion';
import { NewQueueButton, NightLead, QueueHeading } from './night';

/*
 * Match desk — the console's fixture-authoring surface, and the ONLY one. The
 * Match tab (its stack of fully-expanded MatchPanel cards) is deleted, so there
 * is no second place these controls live. A match projects onto the board it is
 * bound to — broadcast-visible — so every edit here routes through the staging
 * gateway (key `match:{m}:{path}`). Creating a match and lifecycle hops (Next
 * game) are authoring/momentary and run immediately.
 *
 * The accordion body is the contract's Custom block: dense fixture authoring
 * (captain grid, port swatches, series stepper) that the row kit deliberately
 * does not try to express.
 */

/*
 * Which boards draw from each running order — `{queueId: [sb]}`.
 *
 * An order's whole point is that a board takes fixtures from it, and that is the
 * one fact its heading cannot derive from itself. Resolved the same way the server
 * does (`Schedule.queue_for_board`): an unassigned board counts toward the FIRST
 * order, so a rig nobody has configured still shows where its fixtures go.
 */
function useBoardsByQueue(active) {
    const assigned = useSettingsStore(useShallow(s => s?.scoreboards?.match_queue ?? {}));
    const ids = useStateStore(useShallow((s) => {
        const qs = s?.schedule?.queues;
        return Array.isArray(qs) ? qs.map((q, i) => String(q?.id ?? `queue-${i + 1}`)) : [];
    }));
    return useMemo(() => {
        const out = {};
        for (const sb of active) {
            const want = assigned[sb] ?? assigned[String(sb)];
            const qid = (want && ids.includes(String(want))) ? String(want) : ids[0];
            if (!qid) continue;
            (out[qid] ||= []).push(sb);
        }
        return out;
    }, [active, assigned, ids]);
}

// The Match card — the Draft-phase authoring surface, rendered as its own
// half-width element window. Holds a stack of match accordions (one per match)
// and a New-match button; a match binds to at most one board (score.{N}.match
// is a single value — rebinding a board moves it), so a board bound elsewhere
// shows on other matches as a muted "on board N" chip you can steal.
export default function MatchDesk() {
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const active = useActiveBoards();
    const canBind = useMatchBindableBoards();
    const boundMap = useStateStore(useShallow(s => {
        const out = {};
        for (const sb of active) out[sb] = s?.score?.[sb]?.match ?? s?.score?.[String(sb)]?.match ?? null;
        return out;
    }));
    const { options: gameModes } = useGameModes();
    const [creating, setCreating] = useState(false);
    // Single-open accordion. `null` means "default to newest"; '' means the user
    // explicitly collapsed everything; else the open match id.
    const [openId, setOpenId] = useState(null);

    const ids = useMemo(
        () => Object.keys(matches).filter(k => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)),
        [matches],
    );
    /*
     * THE STACK IS THE RUNNING ORDER. Queued matches first, in `schedule.queue`
     * order, then anything not enrolled, by id.
     *
     * The order used to be authored inside the Upcoming Schedule element's stage
     * panel — a ticker's settings — so tonight's running order was edited in a
     * different place from the fixtures it orders, in a second list that could
     * disagree with this one. One list, and it is this one: what a producer sees
     * top-to-bottom here is what the schedule overlay draws and the sequence a
     * board's Up next walks.
     *
     * `newestId` deliberately stays the highest ID, not the last row: "default to
     * the newest match" means the one just created, wherever it sits in the order.
     */
    const queueOrder = useQueueOrder();
    const queues = useQueues();
    /*
     * SEVERAL ORDERS, one section each, then the unenrolled group.
     *
     * `queuePos` is a match's place WITHIN ITS OWN order, and `queueLen` the length
     * of that order — the arrows bound at its ends, because position and membership
     * are different verbs and walking the last fixture of Winners "down" must not
     * spill it into Losers. `groupAt` maps a row index to the section heading that
     * opens there, so the stack labels itself without a second pass.
     */
    const { groups, unenrolled } = useMemo(() => {
        /*
         * `queues` absent but `queue` populated is the one-frame window before the
         * boot migration lands (or a client that connected mid-migration). Treat the
         * projected union as a single untitled order rather than drawing an empty
         * desk over a night's worth of fixtures.
         */
        const gs = queues.length
            ? queues
            : (queueOrder.length ? [{ id: 'main', title: '', matches: queueOrder }] : []);
        const of = {};
        for (const q of gs) for (const id of q.matches) of[id] = q.id;
        /*
         * A PLAYED MATCH IS AN ORDINARY ROW. Its leading decided run used to be
         * counted here and collapsed behind a `2 played ›` disclosure, which made
         * the thing a producer most often wants to act on at the end of a night
         * the one thing they had to open a fold to reach — and gave the desk two
         * row shapes for one kind of record. The result badge already says a
         * fixture is finished; the row does not also need to be a different
         * object. Every match in an order renders the same way, in order.
         */
        return { groups: gs, unenrolled: ids.filter(id => of[id] == null) };
    }, [queues, queueOrder, ids]);
    // Which boards draw their next fixture from each order — the consequence of an
    // order that the desk would otherwise never mention.
    const boardsByQueue = useBoardsByQueue(active);

    /*
     * IS THERE ANYTHING TO RUN? The rack answers this in two words
     * (`useMatchDeskMeta`) and the desk it opens answered it nowhere — so a night
     * whose fixtures were all played showed a collapsed "1 played" fold, a
     * finished card, and a small outline New match at the very bottom, none of
     * which is a producer being told what to do. `idle` is the state where the
     * desk owes them a press: no fixture is waiting for a board AND none is
     * coming (every one decided, or none authored). `none waiting` is deliberately
     * NOT idle — those fixtures are on boards or held back per fixture, which the
     * stage control explains where the fixture is.
     */
    const waiting = useWaitingCount();
    const allDecided = ids.length > 0
        && ids.every(id => decidedSide(matches[id]) != null);
    const idle = waiting === 0 && (ids.length === 0 || allDecided);

    // Which boards a delete of `list` would unbind and blank — the consequence
    // ClearPlayed names before it runs. Read off the same `boundMap` the bind
    // chips use, so the warning and the chips cannot disagree about who holds
    // what.
    const boardsHolding = useCallback((list) => {
        const want = new Set(list.map(String));
        return active.filter(sb => want.has(String(boundMap[sb] ?? '')));
    }, [active, boundMap]);

    const newestId = ids[ids.length - 1] || null;
    const effectiveOpen = openId === null ? newestId : (openId || null);

    /*
     * One row, called from two places — the folded played run and the tail below
     * it — so the props cannot drift between them. `i` is the index in the FULL
     * order, never in the slice: `queuePos` is the fixture's real place, and the
     * move arrows bound at the order's ends.
     */
    const row = (id, i, q) => (
        <MatchAccordion
            key={id}
            m={id}
            open={effectiveOpen === id}
            onToggle={() => setOpenId(effectiveOpen === id ? '' : id)}
            active={active}
            boundMap={boundMap}
            gameModes={gameModes}
            canBind={canBind}
            queuePos={i + 1}
            queueLen={q.matches.length}
            queues={groups}
            queueOf={q.id}
        />
    );

    // `qid` is which running order the fixture is created INTO — the heading's
    // `+` names its own, the desk-level button names none and takes the first.
    const onNew = async (qid) => {
        setCreating(true);
        try {
            const { id } = await createMatch(qid);
            setOpenId(String(id));
        } catch (e) {
            notifications.show({ message: `New match: ${e?.message || e}`, color: 'red' });
        } finally { setCreating(false); }
    };

    /*
     * The panel frame (chip · title · meta) comes from PanelShell on the stage.
     *
     * ONE STACK, EMPTY OR NOT. "No matches yet" used to be an early branch that
     * returned a sentence and a button INSTEAD of the desk, so an empty rig lost
     * the running orders themselves: two orders a producer had built and titled
     * collapsed to a single New match, with no heading to create into, nothing to
     * rename or reorder, no way to add a second one — and nothing saying the
     * orders still existed. Emptiness belongs to the list of fixtures; the orders
     * are the desk's own structure and outlive every fixture in them. The empty
     * state is a LINE, not a branch.
     */
    return (
        <Stack gap="xs">
            {idle && (
                <NightLead
                    empty={ids.length === 0}
                    single={groups.length <= 1}
                    creating={creating}
                    onNew={onNew}
                    ids={ids}
                    boards={boardsHolding(ids)}
                />
            )}
            {/* Iterated per ORDER rather than over a flat list with
                index-keyed headings: an order that exists but is empty still
                gets its heading (an order you cannot see is one you cannot
                delete), and two empty ones in a row cannot collide. */}
            {groups.map((q, qi) => (
                <Fragment key={q.id}>
                    {/* Only once there is more than one. A single order is
                        the whole desk, and a title over every fixture there
                        is would be furniture. */}
                    {groups.length > 1 && (
                        <QueueHeading
                            queue={q}
                            boards={boardsByQueue[q.id]}
                            first={qi === 0}
                            last={qi === groups.length - 1}
                            onNew={onNew}
                            creating={creating}
                        />
                    )}
                    {q.matches.map((id, i) => row(id, i, q))}
                </Fragment>
            ))}
            {unenrolled.length > 0 && (
                <Text size="xs" className="pt-1.5 text-muted-foreground/70">
                    Not in a running order — no schedule slot, never offered as a board’s next fixture.
                </Text>
            )}
            {unenrolled.map(id => (
                <MatchAccordion
                    key={id}
                    m={id}
                    open={effectiveOpen === id}
                    onToggle={() => setOpenId(effectiveOpen === id ? '' : id)}
                    active={active}
                    boundMap={boundMap}
                    gameModes={gameModes}
                    canBind={canBind}
                    queuePos={null}
                    queueLen={0}
                    queues={groups}
                    queueOf={null}
                />
            ))}
            <Group gap="xs" className="pt-0.5">
                {/* One order is the whole desk, so a plain New match is
                    unambiguous and the headings aren't drawn at all. With
                    several, "New match" cannot say WHICH — each heading's
                    `+` is the answer, and a button that always meant the
                    first order would be the trap it replaced. */}
                {groups.length <= 1 && !idle && (
                    <Button size="xs" variant="outline" disabled={creating} onClick={() => onNew()}>
                        <Plus size={13} className="mr-1" /> New match
                    </Button>
                )}
                <NewQueueButton />
            </Group>
        </Stack>
    );
}

import { memo, useEffect, useRef, useState } from 'react';
import { ListPlus, Plus, Trash2 } from 'lucide-react';
import { deleteMatch } from '../../../context/match';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { MoveButtons } from '../controls';
import { createQueue, renameQueue, deleteQueue, moveQueue } from '../../../context/schedule';
import { QUIET_FIELD, failed } from './draft';

// The desk's night-level controls: the "what now" strip, each running order's
// heading, and the bulk clear.

/*
 * One running order's heading: its title, who draws from it, and the verbs that
 * act on the ORDER rather than on a fixture in it.
 *
 * The title is editable in place. A queue's id is minted once from its title and
 * never changes (`queue_id_for`), so renaming is safe — a board's assignment points
 * at the id and survives.
 */
/*
 * PLAYED FIXTURES FOLD. A night's card accumulates, and by the end of it — or on
 * the morning after one — tonight's work is buried under eight decided matches
 * that nothing is ever going to do anything with again.
 *
 * A DISPLAY ANSWER TO A DISPLAY PROBLEM. The alternative was a verb that unqueued
 * decided fixtures (the "End session" this replaced), which mutates stored state to
 * fix a list being long and throws away the order the night actually ran in. The
 * schedule overlay already hides decided matches by default, so the on-air half was
 * never a problem — only the desk's.
 *
 * IT FOLDS THE LEADING RUN, NOT EVERY DECIDED FIXTURE. A night runs top to bottom,
 * so played ones are a prefix in the ordinary case, and folding only the prefix can
 * never REORDER what is left — a decided match in the middle of an order stays
 * visible, which is right: out of sequence is exactly when it is worth seeing.
 */
/*
 * THE DESK'S "WHAT NOW" STRIP — the same shape as the board desk's turnover bar,
 * deliberately: one sentence naming the state, one FILLED press ending it. The
 * console should have exactly one thing that looks like this, and a producer who
 * has learnt it on a board should not have to learn it again here.
 *
 * It appears only where the desk genuinely owes a press — every fixture played,
 * or none authored. Both are the cold start: the app opens on a night that is
 * over, and the previous answer was a collapsed "1 played" fold above a finished
 * card, with a small outline New match at the bottom of the panel. Nothing on
 * screen was the next thing to do, so nothing looked like it.
 *
 * The sentence it replaced explained what a match IS ("participants, captains,
 * bracket phase, mode and format — then bind it to a board…"), which is a
 * paragraph of helper text where a button belongs. What a match is, is learnt by
 * making one.
 *
 * With SEVERAL running orders there is no unambiguous button — "New match" cannot
 * say which order — so the strip points at the `+` that can and carries no press
 * of its own. That is the same trap `QueueHeading` exists to avoid, not a
 * different rule.
 */
/*
 * CLEARING WHAT HAS BEEN PLAYED — the question the desk was not asking.
 *
 * A match is removed by exactly two things today: the trash on its own card, one
 * at a time, and Reset State, which also resets every board's binding and
 * playback mode and so is never used for tidying. Between them there was nothing,
 * so the end of a night was eight presses of a trash icon or a hatch nobody
 * reaches for — and the desk's own prominent verb, after a match ended, was ADD
 * ANOTHER. That is a forward press stepping straight over the obvious question,
 * and it is how the desk fills up with fixtures nobody will look at again.
 *
 * THE SCOPE IS ALWAYS WHAT THE TEXT BESIDE IT IS ABOUT. On the fold that is one
 * order's leading decided run, which is the exact set the fold is collapsing and
 * counting; on the night strip it is every match, because that strip only appears
 * when every match is decided. One verb, one name, and the popover states the
 * count and the real consequence each time, so the blast radius is never a guess.
 *
 * IT NAMES THE BOARD IT WILL BLANK. A decided fixture STAYS BOUND — that is the
 * whole reason the board desk's fixture slot has a `done` branch — so clearing a
 * played run can unbind and blank a board that is on air. Excluding bound matches
 * instead was the other option and is worse: the last match of a night is almost
 * always still on its board, so "clear played" would leave exactly the one the
 * producer most wanted gone, with nothing saying why. Name the consequence and
 * let them decide.
 *
 * Sequential deletes by EXPLICIT id, not a re-derived list: every delete
 * re-projects the running orders, so re-deriving between calls would be walking a
 * moving target. `delete_match` is the one removal path and already unbinds,
 * blanks and prunes from the order — this is N of it, never a second
 * implementation.
 */
const ClearPlayed = memo(function ClearPlayed({ ids, boards }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const run = async () => {
        setOpen(false);
        setBusy(true);
        try {
            for (const id of ids) await deleteMatch(Number(id));
        } catch (e) {
            failed('Clear played')(e);
        } finally {
            setBusy(false);
        }
    };
    if (!ids.length) return null;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="xs" className="h-7 shrink-0" disabled={busy}>
                    <Trash2 size={13} className="mr-1" /> Clear played
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
                <Stack gap="xs">
                    <Text size="sm" className="text-foreground">
                        Clear {ids.length} played {ids.length === 1 ? 'match' : 'matches'}?
                    </Text>
                    {/* The real consequence, or the absence of one — said either
                        way, because a control that goes quiet when it has nothing
                        to warn about is quietest in the cases you cannot tell
                        apart. */}
                    <Text size="xs" className="text-muted-foreground">
                        {boards.length
                            ? `${boards.map(b => `Board ${b}`).join(' and ')} still ${boards.length > 1 ? 'hold' : 'holds'} one — it will be unbound and blanked.`
                            : 'No board is holding any of them.'}
                    </Text>
                    <Group gap="xs" className="justify-end">
                        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button size="xs" variant="destructive" onClick={run}>Clear</Button>
                    </Group>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

export const NightLead = memo(function NightLead({ empty, single, creating, onNew, ids, boards }) {
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 bg-secondary/20 px-2 py-1.5">
            <Text size="xs" dimmed className="min-w-0 flex-1">
                {empty ? 'No matches yet.' : 'Every match has been played.'}
                {!single && !empty && ' Add tonight’s with the + on a running order.'}
                {!single && empty && ' Add one with the + on the running order it belongs to.'}
            </Text>
            {/* CLEARING COMES FIRST WHEN THERE IS SOMETHING TO CLEAR. A finished
                night's loud button was New match, which is a forward press over an
                unasked question — and the state it leads to is a desk with tonight's
                fixture buried under last night's. Clearing lands on the EMPTY
                state, where New match is the primary and the only thing on the
                strip, so the two steps chain and each has exactly one obvious
                press. */}
            {!empty && <ClearPlayed ids={ids} boards={boards} />}
            {single && (
                <Button
                    size="xs" className="h-7 shrink-0" variant={empty ? 'default' : 'ghost'}
                    disabled={creating} onClick={() => onNew()}
                >
                    <Plus size={13} className="mr-1" /> New match
                </Button>
            )}
        </div>
    );
});

export const QueueHeading = memo(function QueueHeading({ queue, boards, first, last, onNew, creating }) {
    const [title, setTitle] = useState(queue.title);
    const [confirmDel, setConfirmDel] = useState(false);
    // Follow the server when it changes underneath us, but never while the producer
    // is mid-edit in this field.
    const focused = useRef(false);
    useEffect(() => { if (!focused.current) setTitle(queue.title); }, [queue.title]);

    const commit = () => {
        if (title === queue.title) return;
        renameQueue(queue.id, title)
            .catch(failed('Rename order'));
    };
    const onDelete = () => {
        setConfirmDel(false);
        deleteQueue(queue.id)
            .catch(failed('Remove order'));
    };

    return (
        <div className="flex items-center gap-2 pt-2">
            <MoveButtons
                label={`the ${queue.title || queue.id} order`}
                canUp={!first} canDown={!last}
                onUp={() => moveQueue(queue.id, -1).catch(failed('Move order'))}
                onDown={() => moveQueue(queue.id, 1).catch(failed('Move order'))}
            />
            <input
                type="text"
                aria-label={`Title of the ${queue.id} running order`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onFocus={() => { focused.current = true; }}
                onBlur={() => { focused.current = false; commit(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                placeholder="Untitled order"
                className="label-display min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-foreground/80 hover:border-border focus:border-border focus:outline-none"
            />
            {/* The consequence of the order, which nothing else on the desk says. */}
            <Text size="xs" span className="shrink-0 text-muted-foreground/70">
                {boards?.length
                    ? `board ${boards.join(', ')}`
                    : 'no board takes from this'}
            </Text>
            {/* CREATING INTO THIS ORDER, the rack's section-header idiom (its `+`
                adds into the scene it heads). A desk-level New match can only mean
                the first order, so on a winners/losers rig every fixture arrived in
                Winners and had to be moved — a second verb, on the membership icon
                inside the fixture's own body, which is not where a producer looks
                for "put this one in Losers". The heading is the order, so its `+`
                is where a fixture enters it. */}
            <SimpleTooltip label={`New match in “${queue.title || queue.id}”`}>
                <button
                    type="button"
                    aria-label={`New match in the ${queue.title || queue.id} running order`}
                    disabled={creating}
                    onClick={() => onNew?.(queue.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                    <Plus size={13} />
                </button>
            </SimpleTooltip>
            <Popover open={confirmDel} onOpenChange={setConfirmDel}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={`Remove the ${queue.id} running order`}
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                        <Trash2 size={13} />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60">
                    <Stack gap="xs">
                        <Text size="sm" className="text-foreground">Remove this running order?</Text>
                        <Text size="xs" className="text-muted-foreground">
                            Its {queue.matches.length} match{queue.matches.length === 1 ? '' : 'es'} stay,
                            unenrolled. Boards taking from it fall back to the first order.
                        </Text>
                        <Group gap="xs" className="justify-end">
                            <Button size="xs" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
                            <Button size="xs" variant="destructive" onClick={onDelete}>Remove</Button>
                        </Group>
                    </Stack>
                </PopoverContent>
            </Popover>
        </div>
    );
});

// Add a running order. The title is asked for up front because it mints the id.
export const NewQueueButton = memo(function NewQueueButton() {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const add = () => {
        setOpen(false);
        const t = title.trim();
        setTitle('');
        createQueue(t)
            .catch(failed('New order'));
    };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="xs" variant="ghost" className="text-muted-foreground">
                    <ListPlus size={13} className="mr-1" /> New running order
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
                <Stack gap="xs">
                    <Text size="xs" className="label-display text-muted-foreground">New running order</Text>
                    <Text size="xs" className="text-muted-foreground">
                        A second ordered list of fixtures — a losers bracket alongside a winners
                        bracket, say. Assign a board to it on that board’s panel.
                    </Text>
                    <input
                        type="text"
                        autoFocus
                        aria-label="Title of the new running order"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) add(); }}
                        placeholder="e.g. Losers"
                        className={cn(QUIET_FIELD, 'w-full')}
                    />
                    <Group gap="xs" className="justify-end">
                        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button size="xs" disabled={!title.trim()} onClick={add}>Add</Button>
                    </Group>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

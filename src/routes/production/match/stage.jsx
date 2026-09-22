import { memo, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import { updateMatch } from '../../../context/match';
import { Stack, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { queueMatch, unqueueMatch } from '../../../context/schedule';
import { failed } from './draft';

// Where a fixture stands: its lifecycle stage (and why it is not up next), and
// which running order it belongs to.

const DRAFT_STAGE_BADGE = {
    draft: 'bg-[#a855f7]/15 text-[#c084fc]',
    live:  'bg-emerald-500/15 text-emerald-300',
    post:  'bg-[#64748b]/15 text-[#94a3b8]',
};

/*
 * What each stage MEANS, in the producer's terms rather than the key's.
 *
 * `stage` has no producer-facing writer on the server — `note_live` promotes
 * draft→live on the first feed event, the post-game paths set post, and
 * `note_unbound` gives `live` back when an UNPLAYED fixture comes off its board —
 * so this badge was a read-only word for a flag that silently decides whether the
 * fixture is ever offered as a board's next one. Naming the consequence is half
 * the fix; the control below is the other half. The roll-back covers the one case
 * that was pure trap (bound by mistake, unbound before a pitch, stranded out of
 * Up next all night); every other way back is still this button.
 */
/*
 * Each line describes what the STAGE does, never what this particular fixture is
 * about to do. "Offered to a board as its next fixture" read as a promise, and sat
 * directly above "Not up next — it is already on board 1" — two true sentences that
 * contradicted each other, because the stage is only one of the four conditions.
 * The verdict below is the only line that speaks for this fixture.
 */
const STAGE_MEANING = {
    draft: 'Not started — the only stage a match can be offered from.',
    live:  'A board has fed this match. Never offered while it sits here.',
    post:  'A game finished. Never offered while it sits here.',
};

/*
 * WHICH RUNNING ORDER this fixture is in — membership, which is a property of the
 * record rather than of its position.
 *
 * A toggle while there is one order (the common case: enrolled by default, so this
 * is normally the way OUT — a placeholder, or a fixture kept for reference, that
 * should not show on the schedule overlay or be offered to a board). A picker once
 * there are several, because membership is EXCLUSIVE: a fixture belongs to one
 * order, so choosing another MOVES it rather than listing it twice. Same shape as
 * a container's exclusive roster.
 */
export const MembershipControl = memo(function MembershipControl({ m, queues, queueOf }) {
    const [open, setOpen] = useState(false);
    const inOrder = queueOf != null;
    // `null` means take it out; `undefined` means put it in whichever order the
    // server considers first.
    const choose = (qid) => {
        setOpen(false);
        (qid === null ? unqueueMatch(m) : queueMatch(m, qid))
            .catch(failed('Running order'));
    };

    const single = queues.length <= 1;
    const face = (
        <button
            type="button"
            /*
             * A VERB while this is a toggle, a STATE once it opens a picker. An
             * action label is the better one for a button, but "Take match 3 out of
             * the running order" would be a lie on a control whose click just opens
             * a list of orders to choose from.
             */
            aria-label={single
                ? (inOrder
                    ? `Take match ${m} out of the running order`
                    : `Add match ${m} to the running order`)
                : (inOrder
                    ? `Match ${m} is in the ${queueOf} running order`
                    : `Match ${m} is not in a running order`)}
            aria-pressed={inOrder}
            /*
             * The toggle sends NO queue id — the server resolves "the first order",
             * which is the same answer without the client having to name it. It
             * matters because `queues` may be the pre-migration fallback, whose id
             * this client invented: naming it would 404 the moment the real first
             * order is titled anything else.
             */
            onClick={single ? () => choose(inOrder ? null : undefined) : undefined}
            className={cn(
                'shrink-0 rounded p-1 transition-colors hover:bg-secondary',
                inOrder ? 'text-rio-400 hover:text-rio-300' : 'text-muted-foreground/60 hover:text-foreground',
            )}
        >
            <ListOrdered size={14} />
        </button>
    );

    if (single) {
        return (
            <SimpleTooltip label={inOrder
                ? 'In the running order — click to take it out of the schedule and out of Up next'
                : 'Not in the running order — click to add it to the end'}>
                {face}
            </SimpleTooltip>
        );
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{face}</PopoverTrigger>
            <PopoverContent align="end" className="w-60">
                <Stack gap="xs">
                    <Text size="xs" className="label-display text-muted-foreground">Running order</Text>
                    {queues.map(q => (
                        <Button
                            key={q.id}
                            size="xs"
                            variant={q.id === queueOf ? 'default' : 'outline'}
                            onClick={() => choose(q.id)}
                            className="justify-start"
                        >
                            {q.title || q.id}
                        </Button>
                    ))}
                    <Button
                        size="xs"
                        variant={inOrder ? 'ghost' : 'secondary'}
                        onClick={() => choose(null)}
                        className="justify-start text-muted-foreground"
                    >
                        In none — off the schedule
                    </Button>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

/*
 * THE LIFECYCLE CONTROL — the badge, made pressable.
 *
 * Momentary, not staged, and deliberately: this file's rule is that authoring and
 * lifecycle hops run immediately (see the header comment and Next game), and a
 * stage change is a correction to what already happened rather than a composition
 * choice to preview. Its one broadcast effect is the LIVE pill on the schedule
 * ticker, which should track reality the moment the producer fixes it.
 *
 * `reason` is the console's mirror of `Schedule.not_waiting_reason` — the same
 * rule the server resolves Up next with, so the panel can name the condition
 * holding a fixture back instead of leaving a producer to watch Up next stay
 * silent. Setting a played fixture back to Draft is the way out, which is why the
 * two live in one popover.
 *
 * `first` is the separate question the reason cannot answer: `not_waiting_reason`
 * is per fixture, so on a night of eight fresh drafts all eight are waiting and
 * only one of them is next. See `useNextInOrder`.
 */
/*
 * THE STAGE BADGE IS A READOUT WITH ONE VERB, not a flag picker.
 *
 * It carried three buttons — draft | live | post — which made it the THIRD control
 * in this bar that moves a fixture backwards, and two of the three were the same
 * write: "Ready next game" is `stage → draft`, and so was this popover's `draft`.
 * A producer reading a bar with `Reopen`, `Ready next game` and a stage picker had
 * no way to tell which of them was the one they wanted, and the two that agreed did
 * not say so.
 *
 * What is genuinely valuable here is the DIAGNOSIS — "why is this not coming up?",
 * which nothing on the desk gave before it existed and which the four eligibility
 * conditions make invisible (server/schedule.py `not_waiting_reason`). That stays.
 * Where the blocker is the stage itself, the popover offers the SAME verb the bar
 * does rather than a second way to write the flag; `live` and `post` are never
 * offered at all, because no producer wants to claim a game has been fed or has
 * finished — those are the server's to say (`note_live`, the post-game paths).
 */
export const StageControl = memo(function StageControl({ m, stage, reason, queued, first }) {
    const [open, setOpen] = useState(false);
    const toDraft = () => {
        setOpen(false);
        if (stage === 'draft') return;
        updateMatch(Number(m), { stage: 'draft' })
            .catch(failed('Stage'));
    };
    // Membership first: it outranks the four fixture conditions, because a match
    // taken out of the order is not offered no matter what state it is in.
    const blocked = !queued ? 'it is not in the running order' : reason;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`Match ${m} lifecycle: ${stage}`}
                    className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-80',
                        DRAFT_STAGE_BADGE[stage] || DRAFT_STAGE_BADGE.draft,
                    )}
                >
                    {stage}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
                <Stack gap="xs">
                    <Text size="xs" className="label-display text-muted-foreground">Lifecycle</Text>
                    <Text size="xs" className="text-muted-foreground">{STAGE_MEANING[stage]}</Text>
                    {/* The answer to "why is this not coming up?", which nothing
                        on the desk used to give.

                        Three states, not two: waiting is not the same as next.
                        Every fresh draft passes the four conditions, so a night of
                        eight of them had eight popovers each calling itself "the
                        next fixture in line" — seven of them wrong, and wrong in
                        the one place a producer goes to find out what is next. */}
                    <div className="border-t border-border/60 pt-1.5">
                        {blocked ? (
                            <Stack gap="xs">
                                <Text size="xs" className="text-muted-foreground">
                                    <span className="text-foreground">Not up next</span> — {blocked}.
                                </Text>
                                {/* The one blocker a producer can clear from here,
                                    and the SAME verb the bar shows — never a second
                                    way to write the flag. The other three are
                                    cleared by acting on the thing they name (take
                                    it off its board, reopen the series, put it in an
                                    order), each of which has its own control. */}
                                {stage !== 'draft' && (
                                    <Button size="xs" variant="secondary" onClick={toDraft}>
                                        Ready next game
                                    </Button>
                                )}
                            </Stack>
                        ) : first ? (
                            <Text size="xs" className="text-emerald-300">
                                Waiting for a board — this is the next one in line.
                            </Text>
                        ) : (
                            <Text size="xs" className="text-muted-foreground">
                                <span className="text-foreground">Waiting for a board</span> — it
                                comes up once the matches ahead of it in the order have been taken.
                            </Text>
                        )}
                    </div>
                </Stack>
            </PopoverContent>
        </Popover>
    );
});

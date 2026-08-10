import { memo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { updateMatch } from '../../../context/match';
import { setScheduleTitle } from '../../../context/schedule';
import { Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { KIT_INPUT, ListRow } from '../kit';
import { matchDisplayLabel } from '../matches';
import { useQueueOrder } from '../queue';
import { DirectStage } from './generic';

/*
 * Upcoming Schedule stage — what this OVERLAY says about the running order, not
 * what the running order is.
 *
 * THE ORDER IS NOT AUTHORED HERE, and that is the point of this file's current
 * shape. It used to hold move-up/down, remove, and an "+ Add match to schedule"
 * picker, which meant tonight's running order was edited inside a ticker's
 * settings — a second list of the same matches, in a different place from the
 * fixtures it orders, free to disagree with the Match desk's stack. Membership and
 * position now live on the Match desk (`desks/match.jsx`), where the fixtures are
 * authored and where the position number sits on the row it belongs to.
 *
 * What stays is what is genuinely this overlay's: its HEADING, and each match's
 * DISPLAY TIME. The time is per-match (`match.{M}.scheduledAt`) rather than
 * per-queue-slot, so it belongs to the fixture and follows it when the order
 * changes — but this is the only surface that draws it, so it is edited here.
 *
 * Authoring is immediate: the queue is prep, and the overlay only shows once its
 * OBS source is revealed, which is the staged/live decision.
 */

// The overlay heading. Uncontrolled + commit on blur/Enter so live state echoes
// don't fight the keystroke.
const ScheduleHeading = memo(function ScheduleHeading() {
    const title = useStateStore(s => s?.schedule?.title ?? '');
    const ref = useRef(null);
    useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.value = title || ''; }, [title]);
    const commit = () => {
        const v = ref.current?.value ?? '';
        if (v === (title || '')) return;
        setScheduleTitle(v).catch(e => notifications.show({
            message: `Schedule: ${e?.message || e}`, color: 'red',
        }));
    };
    return (
        <div className="flex min-h-7 items-center gap-2">
            <Text size="xs" span truncate className="w-16 shrink-0 text-muted-foreground">Heading</Text>
            <input
                ref={ref} defaultValue={title || ''} placeholder="Upcoming Matches"
                className={cn(KIT_INPUT, 'min-w-0 flex-1')}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
        </div>
    );
});

// Per-match display time ("6:30 PM", "After break"). Uncontrolled + commit on
// blur/Enter, same reason as the heading.
const ScheduleTimeField = memo(function ScheduleTimeField({ m, initial }) {
    const ref = useRef(null);
    useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.value = initial || ''; }, [initial]);
    const commit = () => {
        const v = ref.current?.value ?? '';
        if (v !== (initial || '')) updateMatch(m, { scheduledAt: v });
    };
    return (
        <input
            ref={ref} defaultValue={initial || ''} placeholder="Time"
            aria-label={`Display time for match ${m}`}
            className={cn(KIT_INPUT, 'w-24 shrink-0')}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
    );
});

export default function ScheduleStage({ element }) {
    const queue = useQueueOrder();
    const matches = useStateStore(useShallow(s => s?.match ?? {}));

    return (
        <>
            <DirectStage element={element} />
            <ScheduleHeading />
            {queue.length === 0 ? (
                <Text size="xs" className="text-muted-foreground">
                    Nothing in the running order, so this overlay draws only its heading.
                    Matches join the order as you create them on the Match desk.
                </Text>
            ) : (
                /* A READOUT of the order with one control per row. The position
                   number is here for the same reason it is on the Match desk — it
                   is what the overlay will draw — but it is not editable here, so
                   there is exactly one place a running order can be changed. */
                <>
                    <Text size="xs" className="text-muted-foreground/70">
                        In the order set on the Match desk. Times are per match, so they follow a fixture when it moves.
                    </Text>
                    {queue.map((id, idx) => {
                        const m = matches[id] || {};
                        const decided = m?.decided === 1 || m?.decided === 2
                            || m?.decided === '1' || m?.decided === '2';
                        const live = !decided && m?.stage === 'live';
                        return (
                            <ListRow
                                key={id}
                                lead={(
                                    <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
                                        {idx + 1}
                                    </span>
                                )}
                                name={(
                                    <span className={cn(decided && 'text-muted-foreground line-through')}>
                                        {matchDisplayLabel(matches, id)}
                                    </span>
                                )}
                                controls={(
                                    <>
                                        {live && (
                                            <Badge variant="outline" className="shrink-0 border-emerald-500/50 text-emerald-500">
                                                LIVE
                                            </Badge>
                                        )}
                                        <ScheduleTimeField m={Number(id)} initial={m?.scheduledAt || ''} />
                                    </>
                                )}
                            />
                        );
                    })}
                </>
            )}
        </>
    );
}

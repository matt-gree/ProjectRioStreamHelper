import { memo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import { updateMatch } from '../../../context/match';
import { setScheduleTitle } from '../../../context/schedule';
import { Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { KIT_INPUT, ListRow, StatusLine } from '../kit';
import { matchDisplayLabel } from '../match/matches';
import { useQueueOrder } from '../match/queue';
import { LAYOUT_SETTINGS, settingOn } from '../../design/designConstants';
// THE OVERLAY'S OWN RULE, imported rather than restated — see `useDrawnIds`.
import { scheduleRows, DEFAULTS } from '../../../../public/layout/lib/schedule-mount';
import { resolveSetting, useOverlaySettings } from './overlay-settings';
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
 * position now live on the Match desk (`match/`), where the fixtures are
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

/*
 * WHAT THE BOARD ACTUALLY DRAWS.
 *
 * The overlay does not draw the running order; it draws a SELECTION of it —
 * decided matches are dropped unless the producer asks for them, and what is
 * left is capped, because `schedule.queue` is the union of every order and
 * nothing takes a fixture out of it. So a readout that just numbered the queue
 * would be a panel claiming the board shows seven matches while the board shows
 * five, and it would be wrong in exactly the state the settings exist for.
 *
 * `scheduleRows` is therefore IMPORTED from the mount, not mirrored here — the
 * same shape as `resolveSpotlight` in spotlight-intent.js, and for the same
 * reason. Every row is still listed, because a time has to be editable on a
 * match the board is not currently drawing; what the panel adds is which of
 * them are on air and why the rest are not.
 */
function useDrawnIds() {
    const os = useOverlaySettings('schedule', 'schedule', 'Upcoming Schedule');
    const state = useStateStore(useShallow(s => ({ schedule: s?.schedule, match: s?.match })));
    const defs = LAYOUT_SETTINGS.schedule;
    const def = (key) => defs.find(d => d.key === key);
    const result = scheduleRows(state, {
        maxRows: resolveSetting(os.bag, def('maxRows'), null),
        showDecided: settingOn(resolveSetting(os.bag, def('showDecided'), null), DEFAULTS.showDecided),
    });
    const drawn = new Map(result.rows.map((r, i) => [String(r.id), i + 1]));
    return {
        drawn,
        // Two different absences, and they are fixed by two different switches:
        // `hidden` is what the Rows Shown cap folded into the board's own
        // "+N more" line, `played` what Decided Matches dropped outright.
        hidden: result.hidden,
        played: result.known - drawn.size - result.hidden,
        total: result.known,
    };
}

export default function ScheduleStage({ element, placement }) {
    const queue = useQueueOrder();
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const { drawn, hidden, played, total } = useDrawnIds();

    return (
        <>
            <DirectStage element={element} placement={placement} />
            <ScheduleHeading />
            {queue.length === 0 ? (
                <StatusLine
                    label="EMPTY"
                    title="Nothing is in the running order, so this overlay draws nothing at all. Matches join the order as you create them on the Match desk."
                />
            ) : (
                <>
                    <StatusLine
                        label={`${drawn.size} OF ${total}`}
                        tone={drawn.size === 0 ? 'warn' : undefined}
                        title="How many of the running order this board is drawing. The rest are either decided (turn on Decided Matches to keep them) or past the Rows Shown cap, where they become the board's “+N more” line."
                    >
                        {[
                            played > 0 && `${played} decided`,
                            hidden > 0 && `${hidden} folded into the “more” line`,
                        ].filter(Boolean).join(' · ') || (drawn.size ? 'the whole order' : 'nothing on the board')}
                    </StatusLine>
                    {/* A READOUT of the order with one control per row. The
                        position number is the one the BOARD draws, which is why
                        it is not the queue index: a hidden match does not take a
                        number, and the row below it moves up. Editing the order
                        still happens in exactly one place, the Match desk. */}
                    {queue.map((id) => {
                        const m = matches[id] || {};
                        const decided = m?.decided === 1 || m?.decided === 2
                            || m?.decided === '1' || m?.decided === '2';
                        const live = !decided && m?.stage === 'live';
                        const pos = drawn.get(String(id));
                        return (
                            <ListRow
                                key={id}
                                className={cn(!pos && 'opacity-60')}
                                lead={(
                                    <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">
                                        {pos ?? '\u2014'}
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
                                        {!pos && (
                                            <Badge
                                                variant="outline"
                                                className="shrink-0 border-border text-muted-foreground"
                                                title={decided
                                                    ? 'Decided \u2014 turn on Decided Matches to keep it on the board'
                                                    : 'Past the Rows Shown cap \u2014 it counts towards the board\u2019s “+N more” line'}
                                            >
                                                {decided ? 'NOT DRAWN' : 'FOLDED'}
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

import { memo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { X } from 'lucide-react';
import { useStateStore } from '../../../context/store';
import { updateMatch } from '../../../context/match';
import { Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { notifications } from '../../../lib/notify';
import { cn } from '../../../lib/utils';
import { IconToggle, KIT_INPUT, ListRow, SelectRow } from '../kit';
import { MoveButtons } from '../controls';
import { matchDisplayLabel, matchIds } from '../matches';
import { DirectStage } from './generic';

/*
 * Upcoming Schedule stage — the producer's ordered match queue
 * (schedule.queue → match.{M}), rendered by the schedule overlay. Authoring is
 * immediate (like the Match tab): the queue is prep, and the overlay only
 * shows once its OBS source is revealed — which is the staged/live decision.
 * Reorders send the whole list back (PUT /schedule); per-match display time
 * writes match.{m}.scheduledAt.
 */

async function putSchedule(body) {
    try {
        const r = await fetch('/api/v1/schedule', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d?.detail || `HTTP ${r.status}`);
        }
    } catch (e) {
        notifications.show({ message: `Schedule: ${e?.message || e}`, color: 'red' });
    }
}

// Per-match display time ("6:30 PM", "After break"). Uncontrolled + commit on
// blur/Enter so live state echoes don't fight the keystroke.
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
            className={cn(KIT_INPUT, 'w-20 shrink-0')}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
    );
});

// The overlay heading. Uncontrolled + commit-on-blur like the time field.
const ScheduleHeading = memo(function ScheduleHeading() {
    const title = useStateStore(s => s?.schedule?.title ?? '');
    const ref = useRef(null);
    useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.value = title || ''; }, [title]);
    return (
        <div className="flex min-h-7 items-center gap-2">
            <Text size="xs" span truncate className="w-16 shrink-0 text-muted-foreground">Heading</Text>
            <input
                ref={ref} defaultValue={title || ''} placeholder="Upcoming Matches"
                className={cn(KIT_INPUT, 'min-w-0 flex-1')}
                onBlur={() => { const v = ref.current?.value ?? ''; if (v !== (title || '')) putSchedule({ title: v }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            />
        </div>
    );
});

export default function ScheduleStage({ element }) {
    const queueRaw = useStateStore(useShallow(s => s?.schedule?.queue ?? []));
    const matches = useStateStore(useShallow(s => s?.match ?? {}));
    const queue = (Array.isArray(queueRaw) ? queueRaw : []).filter(id => matches?.[String(id)]);

    const move = (idx, dir) => {
        const next = [...queue];
        const j = idx + dir;
        if (j < 0 || j >= next.length) return;
        [next[idx], next[j]] = [next[j], next[idx]];
        putSchedule({ queue: next });
    };
    const remove = (idx) => putSchedule({ queue: queue.filter((_, k) => k !== idx) });
    const add = (id) => { if (id) putSchedule({ queue: [...queue, parseInt(id)] }); };

    const available = matchIds(matches).filter(id => !queue.some(q => String(q) === id));

    return (
        <>
            <DirectStage element={element} />
            <ScheduleHeading />
            {queue.length === 0 && (
                <Text size="xs" className="text-muted-foreground">
                    No matches queued. Create matches on the Match desk or Match tab, then add them here.
                </Text>
            )}
            {queue.map((id, idx) => {
                const m = matches[String(id)] || {};
                const decided = m?.decided === 1 || m?.decided === 2 || m?.decided === '1' || m?.decided === '2';
                const live = !decided && m?.stage === 'live';
                return (
                    <ListRow
                        key={`${id}-${idx}`}
                        lead={(
                            <MoveButtons
                                label={`queued match ${idx + 1}`}
                                canUp={idx > 0} canDown={idx < queue.length - 1}
                                onUp={() => move(idx, -1)} onDown={() => move(idx, 1)}
                            />
                        )}
                        name={(
                            <span className={cn(decided && 'text-muted-foreground line-through')}>
                                {matchDisplayLabel(matches, String(id))}
                            </span>
                        )}
                        controls={(
                            <>
                                {live && <Badge variant="outline" className="shrink-0 border-emerald-500/50 text-emerald-500">LIVE</Badge>}
                                <ScheduleTimeField m={id} initial={m?.scheduledAt || ''} />
                                <IconToggle
                                    icon={X} tone="danger" label="Remove from queue"
                                    onClick={() => remove(idx)}
                                />
                            </>
                        )}
                    />
                );
            })}
            {available.length > 0 && (
                <SelectRow
                    value="" onChange={add} placeholder="+ Add match to schedule…"
                    options={available.map(id => ({ label: matchDisplayLabel(matches, id), value: id }))}
                />
            )}
        </>
    );
}

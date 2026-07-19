import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { useObsStore } from '../../context/obs';
import { useSettingsStore, useStateStore } from '../../context/store';
import { Panel } from '../../components/ui/panel';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Text } from '../../components/ui/primitives';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { cn } from '../../lib/utils';
import { usePersistentState } from '../../hooks/usePersistentState';
import { ELEMENTS, elementsForPhase, isPinnable } from './elements';
import { StateChip, chipState } from './kit';
import {
    useBindingScenes, elementBindings, setSourceVisibility, useDisplayedEnabled,
} from './bindings';

/*
 * The rack — the console's left surface (production-console-contract skill):
 * a state-sorted monitor + selector for every source. Sections:
 *
 *   Desk → On air → Studio → {phase} off-air → collapsed rest
 *
 * Rows are chip · name · inline quick action (the eye, staging-aware) ·
 * pin ◆/◇. Purely state-sorted — no pinned section; a railed row stays in its
 * truthful section marked ◆. Desks are permanent rows with live meta, dimmed
 * when idle, never in the state sections.
 *
 * Selection + rail membership are per-producer-browser workspace layout
 * (usePersistentState), not broadcast config. A null rail means "never
 * touched" — the quick rail seeds its first-run default from that (slice 6).
 */

export const SELECTION_KEY = 'prsh.ui.production.selection';
export const RAIL_KEY = 'prsh.ui.production.rail';

export function useRackSelection() {
    return usePersistentState(SELECTION_KEY, 'desk:match', v => typeof v === 'string');
}

export function useRailPins() {
    return usePersistentState(RAIL_KEY, null, v => v === null || Array.isArray(v));
}

// First-run seed: an empty rail undersells the surface, so a producer who has
// never pinned anything starts with the two cards nearly every stream uses.
// `null` (never touched) is deliberately distinct from `[]` (emptied on
// purpose) — only the former seeds.
export const RAIL_SEED = ['scoreboard', 'stats'];

export function seededRail(rail) {
    if (rail !== null && rail !== undefined) return rail;
    return RAIL_SEED.filter(id => ELEMENTS.some(e => e.id === id && isPinnable(e)));
}

// The row's inline quick action: the quick face's primary control as one
// compact button — for OBS-bound elements that's the visibility eye, staged
// through the confirm-to-live buffer like everywhere else.
const EyeAction = memo(function EyeAction({ binding }) {
    const { enabled, staged } = useDisplayedEnabled(binding?.scene, binding?.item);
    if (!binding) return null;
    const Icon = enabled ? Eye : EyeOff;
    return (
        <SimpleTooltip label={staged ? 'Staged — goes live on confirm' : enabled ? 'Hide source' : 'Show source'}>
            <button
                type="button"
                onClick={() => setSourceVisibility(binding.scene, binding.item, !enabled)}
                className={cn(
                    'shrink-0 transition-colors',
                    staged ? 'text-amber-400' : enabled ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
            >
                <Icon size={13} />
            </button>
        </SimpleTooltip>
    );
});

const PinToggle = memo(function PinToggle({ pinned, onToggle }) {
    return (
        <SimpleTooltip label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}>
            <button
                type="button" onClick={onToggle} aria-pressed={pinned}
                aria-label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}
                className={cn(
                    'shrink-0 text-xs leading-none transition-colors',
                    pinned ? 'text-rio-400' : 'text-muted-foreground/60 hover:text-foreground',
                )}
            >
                {pinned ? '◆' : '◇'}
            </button>
        </SimpleTooltip>
    );
});

// One rack row. Rows relocate between sections as OBS state changes; the
// entry animation is motion-safe so prefers-reduced-motion users get an
// instant move.
const RackRow = memo(function RackRow({
    state, bindings, name, meta, dimmed, selected, onSelect, quickAction,
    pinnable, pinned, onPinToggle,
}) {
    return (
        <div
            className={cn(
                'group flex h-8 items-center gap-2 rounded-md px-2 motion-safe:animate-in motion-safe:fade-in-0',
                selected ? 'bg-secondary/70' : 'hover:bg-secondary/40',
                dimmed && !selected && 'opacity-60',
            )}
        >
            <StateChip state={state} bindings={bindings} />
            <button type="button" onClick={onSelect} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left">
                <Text size="xs" span truncate className="min-w-0 text-foreground">{name}</Text>
                {meta != null && <Text size="xs" span truncate dimmed className="min-w-0">{meta}</Text>}
            </button>
            {quickAction}
            {pinnable && <PinToggle pinned={pinned} onToggle={onPinToggle} />}
        </div>
    );
});

function SectionHeader({ label, accent, count, onToggle, open }) {
    const Chevron = open ? ChevronDown : ChevronRight;
    const inner = (
        <>
            <Text size="xs" span className={cn('label-display tracking-wider', accent ?? 'text-muted-foreground')}>
                {label}
            </Text>
            {count != null && <Text size="xs" span dimmed>{count}</Text>}
            {onToggle && <Chevron size={12} className="text-muted-foreground" />}
        </>
    );
    if (onToggle) {
        return (
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-1.5 px-2 pt-2 pb-0.5">
                {inner}
            </button>
        );
    }
    return <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5">{inner}</div>;
}

// Match desk meta: the primary (lowest-id) match's label + series score.
function useMatchDeskMeta() {
    return useStateStore(useShallow(s => {
        const matches = s?.match ?? {};
        const ids = Object.keys(matches).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (!ids.length) return { meta: 'no match', idle: true };
        const m = matches[ids[0]] ?? {};
        return { meta: `M${ids[0]} · ${m?.series?.[1] ?? 0}–${m?.series?.[2] ?? 0}`, idle: false };
    }));
}

// Capture desk meta: whether any board has a captured post-game.
function useCaptureDeskMeta() {
    return useStateStore(useShallow(s => {
        const captured = Object.values(s?.postgame ?? {}).some(b => b?.present);
        return { meta: captured ? 'captured' : 'empty', idle: !captured };
    }));
}

// Bracket desk meta: which phase is published to the bracket overlays. Read
// straight from state — the rack must not fire the desk's phases fetch just to
// draw a row.
function useBracketDeskMeta() {
    return useStateStore(useShallow(s => {
        const name = s?.bracket?.phaseName || '';
        return { meta: name || 'nothing loaded', idle: !name };
    }));
}

/*
 * The desk tier — content workflows that feed the broadcast but aren't on it.
 * Permanent rows with live meta, dimmed when idle, selectable like any row.
 *
 * One entry per desk: the page maps the same ids to bodies (production.jsx)
 * and quick faces (quickface.jsx). `pinnable: false` means the desk has no
 * face that fits the two-row cap — Match's controls can't be compressed that
 * far, so it is deliberately not pinnable.
 */
export const DESKS = [
    { id: 'desk:match', name: 'Match', useMeta: useMatchDeskMeta, pinnable: false },
    { id: 'desk:capture', name: 'Capture', useMeta: useCaptureDeskMeta },
    { id: 'desk:bracket', name: 'Bracket', useMeta: useBracketDeskMeta },
];

const DeskRow = memo(function DeskRow({ desk, selection, onSelect, pins, onPinToggle }) {
    const { meta, idle } = desk.useMeta();
    return (
        <RackRow
            state="desk" name={desk.name} meta={meta} dimmed={idle}
            selected={selection === desk.id} onSelect={() => onSelect(desk.id)}
            pinnable={desk.pinnable !== false}
            pinned={pins.includes(desk.id)}
            onPinToggle={() => onPinToggle(desk.id)}
        />
    );
});

const DeskSection = memo(function DeskSection({ selection, onSelect, pins, onPinToggle }) {
    return (
        <div className="rounded-md bg-rio-500/5 pb-1">
            <SectionHeader label="DESK" accent="text-rio-400" />
            {DESKS.map(desk => (
                <DeskRow
                    key={desk.id} desk={desk} selection={selection}
                    onSelect={onSelect} pins={pins} onPinToggle={onPinToggle}
                />
            ))}
        </div>
    );
});

const PHASE_LABEL = { draft: 'Draft', live: 'Live', post: 'Post-game', break: 'Break' };

// Selection and rail pins are owned by the page when the console is assembled
// (one copy shared with the stage and the rail); the internal hooks are the
// standalone fallback so a Rack still works — and still persists — on its own.
export const Rack = memo(function Rack({
    phase, selection: selectionProp, onSelect, pins: pinsProp, onPinToggle,
}) {
    const status = useObsStore(s => s.status);
    const scenes = useBindingScenes();
    const overrides = useSettingsStore(useShallow(s => s?.production?.overrides ?? {}));
    const [ownSelection, setOwnSelection] = useRackSelection();
    const [ownRail, setOwnRail] = useRailPins();
    const [restOpen, setRestOpen] = useState(false);

    const selection = selectionProp ?? ownSelection;
    const setSelection = onSelect ?? setOwnSelection;
    const pins = pinsProp ?? seededRail(ownRail);
    const togglePin = onPinToggle ?? ((id) => setOwnRail((prev) => {
        const cur = seededRail(prev);
        return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    }));

    // One binding pass for every element — sections are pure sorts of it.
    const rows = useMemo(() => ELEMENTS.map((el) => {
        const bindings = elementBindings(el, scenes, overrides[el.id]);
        return { el, bindings, state: chipState(bindings) };
    }), [scenes, overrides]);

    const inPhase = useMemo(() => new Set(elementsForPhase(phase).map(e => e.id)), [phase]);
    const onAir = rows.filter(r => r.state === 'air');
    const studio = rows.filter(r => r.state === 'pvw');
    const offAir = rows.filter(r => r.state !== 'air' && r.state !== 'pvw' && inPhase.has(r.el.id));
    const rest = rows.filter(r => r.state !== 'air' && r.state !== 'pvw' && !inPhase.has(r.el.id));

    const renderRow = ({ el, bindings, state }) => (
        <RackRow
            key={el.id} state={state} bindings={bindings} name={el.name}
            selected={selection === el.id} onSelect={() => setSelection(el.id)}
            quickAction={<EyeAction binding={bindings.primary} />}
            pinnable={isPinnable(el)} pinned={pins.includes(el.id)}
            onPinToggle={() => togglePin(el.id)}
        />
    );

    return (
        <Panel title="Rack" className="h-full">
            <ScrollArea className="h-[calc(100vh-13rem)]">
                <div className="flex flex-col gap-1 p-2">
                    <DeskSection
                        selection={selection} onSelect={setSelection}
                        pins={pins} onPinToggle={togglePin}
                    />
                    <SectionHeader label="ON AIR" accent="text-emerald-400" />
                    {onAir.length
                        ? onAir.map(renderRow)
                        : <Text size="xs" dimmed className="px-2">Nothing on air.</Text>}
                    <SectionHeader label="STUDIO" accent="text-sky-400" />
                    {studio.length
                        ? studio.map(renderRow)
                        : <Text size="xs" dimmed className="px-2">Nothing staged.</Text>}
                    <SectionHeader label={`${PHASE_LABEL[phase] ?? phase} · OFF AIR`.toUpperCase()} />
                    {offAir.length
                        ? offAir.map(renderRow)
                        : <Text size="xs" dimmed className="px-2">Everything in this phase is up.</Text>}
                    {rest.length > 0 && (
                        <>
                            <SectionHeader
                                label="OTHER PHASES" count={rest.length}
                                open={restOpen} onToggle={() => setRestOpen(o => !o)}
                            />
                            {restOpen && rest.map(renderRow)}
                        </>
                    )}
                    {status !== 'connected' && (
                        <Text size="xs" dimmed className="px-2 pt-2">
                            {status === 'connecting'
                                ? 'Connecting to OBS…'
                                : 'OBS not connected — sources show "—". Enable the WebSocket server in OBS (Tools → WebSocket Server Settings) and configure it in Settings → OBS.'}
                        </Text>
                    )}
                </div>
            </ScrollArea>
        </Panel>
    );
});

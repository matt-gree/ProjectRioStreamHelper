import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Eye, EyeOff, ChevronDown, ChevronRight, Plus, Circle, CircleDot } from 'lucide-react';
import { useObsStore, useMirrorScene } from '../../context/obs';
import { useStateStore } from '../../context/store';
import { Panel } from '../../components/ui/panel';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Text } from '../../components/ui/primitives';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { cn } from '../../lib/utils';
import { usePersistentState } from '../../hooks/usePersistentState';
import { ELEMENTS, isPinnable } from './elements';
import {
    placementTarget, togglePin as togglePinIn, useConsolePlacements, useConsoleScenes,
    usePlacementLabel,
} from './placements';
import { StateChip, chipFor } from './kit';
import { setSourceVisibility, useDisplayedEnabled } from './bindings';
import { useContainerPush } from './feeds';

/*
 * The rack — the console's left surface (production-console-contract skill):
 * a monitor + selector for everything the producer can put on the broadcast.
 *
 *   Desk → Program scene → Preview scene → every other scene (lazy, collapsed)
 *
 * SCENES ARE THE GROUPING AXIS. The rack used to sort by a "phase" the producer
 * picked from a segmented control — Draft / Live / Post-game / Break — which was
 * PRSH guessing at the shape of a show. OBS's scene list is the producer
 * STATING it, it is already the thing they cut between, and it groups by the
 * only fact that decides whether a source is reaching air.
 *
 * Rows are PLACEMENTS (./placements): one row per source per scene, so the same
 * overlay in Game and in Break is two rows with their own air state and their
 * own eye — which is the point, since staging the Break scene before cutting to
 * it means toggling that copy and not this one.
 *
 * Only what is actually IN a scene is listed. There are no rows for things
 * nobody has added: those were six dead "—" lines pretending to be a catalog,
 * and the Add button in each section header is the honest version of them.
 *
 * Selection + rail membership are per-producer-browser workspace layout
 * (usePersistentState), not broadcast config. A null rail means "never
 * touched" — the quick rail seeds its first-run default from that.
 */

export const SELECTION_KEY = 'prsh.ui.production.selection';
export const RAIL_KEY = 'prsh.ui.production.rail';
export const OPEN_SCENES_KEY = 'prsh.ui.production.scenes';

export function useRackSelection() {
    return usePersistentState(SELECTION_KEY, 'desk:match', v => typeof v === 'string');
}

export function useRailPins() {
    return usePersistentState(RAIL_KEY, null, v => v === null || Array.isArray(v));
}

// Which off-air scene sections the producer has expanded. Persisted because
// expanding is also what MIRRORS the scene — a producer who set up their Break
// section should find it live on the next load, not collapsed again.
export function useOpenScenes() {
    return usePersistentState(OPEN_SCENES_KEY, [], v => Array.isArray(v));
}

// First-run seed: an empty rail undersells the surface, so a producer who has
// never pinned anything starts with the two cards nearly every stream uses.
// `null` (never touched) is deliberately distinct from `[]` (emptied on
// purpose) — only the former seeds. Stored in pre-scene form on purpose: they
// resolve to wherever those sources actually are (./placements).
export const RAIL_SEED = ['scoreboard', 'stats'];

export function seededRail(rail) {
    if (rail !== null && rail !== undefined) return rail;
    return RAIL_SEED.filter(id => ELEMENTS.some(e => e.id === id && isPinnable(e)));
}

// The row's inline quick action: the quick face's primary control as one
// compact button — for OBS-bound elements that's the visibility eye, staged
// through the confirm-to-live buffer like everywhere else.
const EyeAction = memo(function EyeAction({ placement }) {
    const { enabled, staged } = useDisplayedEnabled(placement?.scene, placement?.item);
    if (!placement) return null;
    const Icon = enabled ? Eye : EyeOff;
    return (
        <SimpleTooltip label={staged ? 'Staged — goes live on confirm' : enabled ? 'Hide source' : 'Show source'}>
            <button
                type="button"
                onClick={() => setSourceVisibility(placement.scene, placement.item, !enabled)}
                aria-pressed={enabled}
                aria-label={enabled ? 'Hide source' : 'Show source'}
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

/*
 * A fed row's quick action — a RADIO, not an eye.
 *
 * The eye belongs to the container above it, which owns the source. What a fed
 * row decides is whether ITS content is the one the container is carrying, and
 * because a container holds exactly one feed, its siblings are alternatives
 * rather than independent switches. A filled dot is that fact; two eyes were the
 * old lie.
 */
const FeedAction = memo(function FeedAction({ placement }) {
    const { mine, staged, canPush, toggle } = useContainerPush(placement.element);
    const Icon = mine ? CircleDot : Circle;
    const disabled = !mine && !canPush;
    return (
        <SimpleTooltip label={
            staged ? 'Staged — goes live on confirm'
                : mine ? 'On the container — click to clear it'
                    : canPush ? 'Put this on the container'
                        : 'Pick content in the panel first'
        }>
            <button
                type="button" onClick={toggle} disabled={disabled}
                aria-pressed={mine} aria-label={mine ? 'Clear from container' : 'Put on container'}
                className={cn(
                    'shrink-0 transition-colors disabled:opacity-30',
                    staged ? 'text-amber-400' : mine ? 'text-rio-300' : 'text-muted-foreground hover:text-foreground',
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

// One rack row. Rows relocate as OBS state changes; the entry animation is
// motion-safe so prefers-reduced-motion users get an instant move.
const RackRow = memo(function RackRow({
    state, name, meta, dimmed, selected, onSelect, quickAction,
    pinnable, pinned, onPinToggle, nested,
}) {
    return (
        <div
            // Rows are identified by name + board meta, and several board-scoped
            // elements carry the SAME meta ("Scoreboard 1") — so a text query
            // can't address a row on its own. Same affordance as
            // data-rack-section / data-chip-state.
            data-rack-row={name}
            data-rack-nested={nested ? '' : undefined}
            className={cn(
                'group flex h-8 items-center gap-2 rounded-md px-2 motion-safe:animate-in motion-safe:fade-in-0',
                selected ? 'bg-secondary/70' : 'hover:bg-secondary/40',
                dimmed && !selected && 'opacity-60',
                // A fed row is a choice WITHIN the source above it, not a source
                // of its own; the rule carries that without spending a word.
                nested && 'ml-3 rounded-l-none border-l border-border/60 pl-2',
            )}
        >
            <StateChip state={state} />
            <button type="button" onClick={onSelect} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left">
                <Text size="xs" span truncate className="min-w-0 text-foreground">{name}</Text>
                {meta != null && <Text size="xs" span truncate dimmed className="min-w-0">{meta}</Text>}
            </button>
            {quickAction}
            {pinnable && <PinToggle pinned={pinned} onToggle={onPinToggle} />}
        </div>
    );
});

function SectionHeader({ label, accent, count, onToggle, open, action }) {
    const Chevron = open ? ChevronDown : ChevronRight;
    const inner = (
        <>
            <Text size="xs" span truncate className={cn('label-display min-w-0 tracking-wider', accent ?? 'text-muted-foreground')}>
                {label}
            </Text>
            {count != null && <Text size="xs" span dimmed>{count}</Text>}
            {onToggle && <Chevron size={12} className="shrink-0 text-muted-foreground" />}
        </>
    );
    return (
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5">
            {onToggle
                ? (
                    <button
                        type="button" onClick={onToggle} aria-expanded={open}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                        {inner}
                    </button>
                )
                : <div className="flex min-w-0 flex-1 items-center gap-1.5">{inner}</div>}
            {action}
        </div>
    );
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
 *
 * ALL THREE ARE ALWAYS RACKED. Desks used to appear one at a time, keyed to the
 * phase they belonged to, and that rule always needed a special case (Live owns
 * no desk, so the section stood empty) — the tell that desks were never
 * phase-shaped. A producer fixes a fixture or re-captures a game whenever they
 * need to, not when a selector says they may.
 */
export const DESKS = [
    { id: 'desk:match', name: 'Match', useMeta: useMatchDeskMeta, pinnable: false },
    { id: 'desk:capture', name: 'Capture', useMeta: useCaptureDeskMeta },
    { id: 'desk:bracket', name: 'Bracket', useMeta: useBracketDeskMeta },
];

const DeskRow = memo(function DeskRow({ desk, selection, onSelect, pinned, onPinToggle }) {
    const { meta, idle } = desk.useMeta();
    return (
        <RackRow
            state="desk" name={desk.name} meta={meta} dimmed={idle}
            selected={selection === desk.id} onSelect={() => onSelect(desk.id)}
            pinnable={desk.pinnable !== false}
            pinned={pinned.has(desk.id)}
            onPinToggle={() => onPinToggle(desk.id)}
        />
    );
});

const DeskSection = memo(function DeskSection({ selection, onSelect, pinned, onPinToggle }) {
    return (
        <div data-rack-section="desk" className="rounded-md bg-rio-500/5 pb-1">
            <SectionHeader label="DESK" accent="text-rio-400" />
            {DESKS.map(desk => (
                <DeskRow
                    key={desk.id} desk={desk} selection={selection}
                    onSelect={onSelect} pinned={pinned} onPinToggle={onPinToggle}
                />
            ))}
        </div>
    );
});

const ROLE_META = {
    program: { tag: 'PROGRAM', accent: 'text-emerald-400' },
    preview: { tag: 'PREVIEW', accent: 'text-sky-400' },
    other: { tag: null, accent: 'text-muted-foreground' },
};

const AddButton = memo(function AddButton({ scene, onAdd }) {
    if (!onAdd) return null;
    return (
        <SimpleTooltip label={`Add an overlay to “${scene}”`}>
            <button
                type="button" onClick={() => onAdd(scene)}
                aria-label={`Add an overlay to ${scene}`}
                className="shrink-0 text-muted-foreground/70 transition-colors hover:text-foreground"
            >
                <Plus size={13} />
            </button>
        </SimpleTooltip>
    );
});

/*
 * One scene's rows.
 *
 * Program and preview are always open and eagerly mirrored. Every other scene
 * is collapsed until the producer expands it, and expanding is what asks the
 * store to mirror it (obs.jsx `mirrorScene`) — hence the hook taking the scene
 * only while open. Once mirrored it stays live for the connection, so a Break
 * section the producer has opened keeps updating while they work in Game.
 */
const SceneSection = memo(function SceneSection({
    scene, rows, open, onToggle, selection, onSelect, pinned, onPinToggle, onAdd, label,
}) {
    const { loading } = useMirrorScene(open ? scene.scene : null);
    const meta = ROLE_META[scene.where] ?? ROLE_META.other;
    const collapsible = scene.where === 'other';

    return (
        <div data-rack-section={scene.scene}>
            <SectionHeader
                label={meta.tag ? `${meta.tag} · ${scene.scene}` : scene.scene}
                accent={meta.accent}
                count={open && rows.length ? rows.length : null}
                open={open}
                onToggle={collapsible ? onToggle : undefined}
                action={open ? <AddButton scene={scene.scene} onAdd={onAdd} /> : null}
            />
            {open && (loading
                ? <Text size="xs" dimmed className="px-2">Reading scene…</Text>
                : rows.length
                    ? rows.map((p) => {
                        const { name, detail } = label(p);
                        return (
                            <RackRow
                                key={p.id} state={chipFor(p)} name={name} meta={detail}
                                nested={!!p.parent}
                                selected={selection === p.id} onSelect={() => onSelect(p.id)}
                                quickAction={p.parent
                                    ? <FeedAction placement={p} />
                                    : <EyeAction placement={p} />}
                                pinnable={isPinnable(p.element)} pinned={pinned.has(p.id)}
                                onPinToggle={() => onPinToggle(p.id)}
                            />
                        );
                    })
                    : <Text size="xs" dimmed className="px-2">No PRSH overlays here yet.</Text>
            )}
        </div>
    );
});

// Selection and rail pins are owned by the page when the console is assembled
// (one copy shared with the stage and the rail); the internal hooks are the
// standalone fallback so a Rack still works — and still persists — on its own.
export const Rack = memo(function Rack({
    selection: selectionProp, onSelect, pins: pinsProp, onPinToggle, onAdd,
}) {
    const status = useObsStore(s => s.status);
    const scenes = useConsoleScenes();
    const placements = useConsolePlacements(scenes);
    const label = usePlacementLabel(placements);
    const [ownSelection, setOwnSelection] = useRackSelection();
    const [ownRail, setOwnRail] = useRailPins();
    const [openScenes, setOpenScenes] = useOpenScenes();

    const selection = selectionProp ?? ownSelection;
    const setSelection = onSelect ?? setOwnSelection;
    const pins = pinsProp ?? seededRail(ownRail);
    const togglePin = onPinToggle ?? ((id) => setOwnRail(prev => togglePinIn(seededRail(prev), id, placements)));

    // Pins are compared by what they RESOLVE to, so a pin stored as the bare
    // `scoreboard` still lights the ◆ on the row it renders as.
    const pinned = useMemo(
        () => new Set(pins.map(p => placementTarget(p, placements))),
        [pins, placements],
    );

    const byScene = useMemo(() => {
        const m = new Map();
        for (const p of placements) {
            if (!m.has(p.scene)) m.set(p.scene, []);
            m.get(p.scene).push(p);
        }
        return m;
    }, [placements]);

    const toggleScene = (name) => setOpenScenes(prev => (
        (prev ?? []).includes(name)
            ? (prev ?? []).filter(s => s !== name)
            : [...(prev ?? []), name]
    ));

    return (
        <Panel title="Rack" className="h-full">
            <ScrollArea className="h-[calc(100vh-13rem)]">
                <div className="flex flex-col gap-1 p-2">
                    <DeskSection
                        selection={selection} onSelect={setSelection}
                        pinned={pinned} onPinToggle={togglePin}
                    />
                    {scenes.map(sc => (
                        <SceneSection
                            key={sc.scene} scene={sc} rows={byScene.get(sc.scene) ?? []}
                            open={sc.where !== 'other' || (openScenes ?? []).includes(sc.scene)}
                            onToggle={() => toggleScene(sc.scene)}
                            selection={selection} onSelect={setSelection}
                            pinned={pinned} onPinToggle={togglePin}
                            onAdd={onAdd} label={label}
                        />
                    ))}
                    {status !== 'connected' && (
                        <Text size="xs" dimmed className="px-2 pt-2">
                            {status === 'connecting'
                                ? 'Connecting to OBS…'
                                : 'OBS not connected — the rack lists your scenes and their sources. Enable the WebSocket server in OBS (Tools → WebSocket Server Settings) and configure it in Settings → OBS.'}
                        </Text>
                    )}
                </div>
            </ScrollArea>
        </Panel>
    );
});

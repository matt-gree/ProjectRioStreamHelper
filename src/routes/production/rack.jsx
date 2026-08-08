import { memo, useMemo, useState } from 'react';
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
    placementTarget, togglePin as togglePinIn, useConsoleOffline, useConsolePlacements,
    useConsoleScenes, usePlacementLabel,
} from './placements';
import { StateChip, chipFor } from './kit';
import { setSourceVisibility, useDisplayedEnabled } from './bindings';
import { useContainerPush } from './feeds';
import { boardDeskId, useActiveBoards, useBoardLabel } from './boards';
import { useBoardDeskMeta } from './desks/board';
import { notifications } from '../../lib/notify';

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
                    // Full-strength when unpinned, like PanelShell's copy of this
                    // control: the dimmed variant this used to carry put the
                    // console's most-repeated glyph (once per rack row) under the
                    // 3:1 floor for UI components, and "which rows are already
                    // pinned" is exactly the scan it exists to serve. The pinned
                    // state is distinguished by colour, not by the other being faint.
                    'shrink-0 text-xs leading-none transition-colors',
                    pinned ? 'text-rio-400' : 'text-muted-foreground hover:text-foreground',
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

/*
 * The desk rows, boards first.
 *
 * A board is a desk too — see ../boards for why — but unlike the three above it
 * is not a fixed workflow: the rig has one to three of them and the producer
 * adds and removes them. So the section is DERIVED from `scoreboards.active`,
 * which is finally the online reader that settings key never had. (`instances.js`
 * used to union the declared boards into source discovery for the same reason
 * and lost that reader when rows became source-derived; a board's row belongs on
 * the desk tier, not among the sources.)
 *
 * Boards come first because they are the rig: the fixture, the capture and the
 * bracket all act ON a board. Bounded, permanent, one row each — the treatment
 * matches are deliberately NOT given, since matches accumulate all night and
 * belong in a list inside one row.
 */
export function useDeskRows() {
    const boards = useActiveBoards();
    const label = useBoardLabel();
    return useMemo(() => [
        ...boards.map(sb => ({ id: boardDeskId(sb), board: sb, name: label(sb) })),
        ...DESKS,
    ], [boards, label]);
}

// A row that takes its meta from the desk's own hook. Boards use the sibling
// below instead of a `useMeta` closure per board: choosing which hook to call by
// looking at the row would be a conditional hook call, so the choice is made by
// COMPONENT (same rule as SUBJECTS and STAGE_BODIES).
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

const BoardDeskRow = memo(function BoardDeskRow({ desk, selection, onSelect, pinned, onPinToggle }) {
    const { meta, idle } = useBoardDeskMeta(desk.board);
    return (
        <RackRow
            state="desk" name={desk.name} meta={meta} dimmed={idle}
            selected={selection === desk.id} onSelect={() => onSelect(desk.id)}
            pinnable
            pinned={pinned.has(desk.id)}
            onPinToggle={() => onPinToggle(desk.id)}
        />
    );
});

/*
 * The + in the DESK header adds a board — the affordance that brings a row into
 * being lives in the header of the section the row appears in, exactly as a
 * scene's + does. It is the only way to add one: the Match tab's tab strip is
 * navigation now, and two ways to add a board is the duplication boards became
 * desks to end.
 */
async function addScoreboard() {
    try {
        const r = await fetch('/api/v1/scoreboards', { method: 'POST' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
        notifications.show({ message: `Add scoreboard: ${e?.message || e}`, color: 'red' });
    }
}

const DeskSection = memo(function DeskSection({ selection, onSelect, pinned, onPinToggle }) {
    const rows = useDeskRows();
    const [adding, setAdding] = useState(false);
    const add = async () => {
        setAdding(true);
        try { await addScoreboard(); } finally { setAdding(false); }
    };
    return (
        <div data-rack-section="desk" className="rounded-md bg-rio-500/5 pb-1">
            <SectionHeader
                label="DESK" accent="text-rio-400"
                action={<AddButton scene={null} onAdd={adding ? undefined : add} label="Add a scoreboard" />}
            />
            {rows.map(desk => (desk.board != null
                ? (
                    <BoardDeskRow
                        key={desk.id} desk={desk} selection={selection}
                        onSelect={onSelect} pinned={pinned} onPinToggle={onPinToggle}
                    />
                )
                : (
                    <DeskRow
                        key={desk.id} desk={desk} selection={selection}
                        onSelect={onSelect} pinned={pinned} onPinToggle={onPinToggle}
                    />
                )))}
        </div>
    );
});

const ROLE_META = {
    program: { tag: 'PROGRAM', accent: 'text-emerald-400' },
    preview: { tag: 'PREVIEW', accent: 'text-sky-400' },
    other: { tag: null, accent: 'text-muted-foreground' },
};

// `scene` is null in the catalog tier (no OBS, so no scene to add into) — the
// picker still opens there for its Copy URL and its container builder, both of
// which are OBS-independent.
const AddButton = memo(function AddButton({ scene, onAdd, label }) {
    if (!onAdd) return null;
    // The accessible name stays free of typographic quotes; the tooltip is where
    // the scene name gets dressed.
    return (
        <SimpleTooltip label={label ?? `Add an overlay to “${scene}”`}>
            <button
                type="button" onClick={() => onAdd(scene ?? null)}
                aria-label={label ?? `Add an overlay to ${scene}`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
                <Plus size={13} />
            </button>
        </SimpleTooltip>
    );
});

/*
 * The CATALOG tier — the rack with no OBS to mirror (./placements
 * `catalogPlacements`).
 *
 * One section, no scenes, because with OBS closed there are none to group by:
 * every element PRSH can configure, plus the producer's containers with their
 * members nested under them exactly as they nest on air. It is a selector rather
 * than a monitor, which is the honest half of the rack's job when there is
 * nothing to monitor.
 *
 * NO EYE ON THESE ROWS. There is no scene item to show or hide, and a dead
 * control is worse than an absent one. A fed row keeps its radio: choosing what
 * occupies a container is a STATE write and works with nothing connected — the
 * overlay renders it whether it is hosted by OBS or a browser window.
 */
const CatalogSection = memo(function CatalogSection({
    rows, selection, onSelect, pinned, onPinToggle, onAdd, label,
}) {
    return (
        <div data-rack-section="catalog">
            <SectionHeader
                label="ELEMENTS" count={rows.length}
                action={<AddButton onAdd={onAdd} label="Copy an overlay URL, or build a container" />}
            />
            {rows.map((p) => {
                const { name, detail } = label(p);
                return (
                    <RackRow
                        key={p.id} state={chipFor(p)} name={name} meta={detail}
                        nested={!!p.parent}
                        selected={selection === p.id} onSelect={() => onSelect(p.id)}
                        quickAction={p.parent ? <FeedAction placement={p} /> : null}
                        pinnable={isPinnable(p.element)} pinned={pinned.has(p.id)}
                        onPinToggle={() => onPinToggle(p.id)}
                    />
                );
            })}
        </div>
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
    const offline = useConsoleOffline();
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
                    {offline
                        ? (
                            <CatalogSection
                                rows={placements}
                                selection={selection} onSelect={setSelection}
                                pinned={pinned} onPinToggle={togglePin}
                                onAdd={onAdd} label={label}
                            />
                        )
                        : scenes.map(sc => (
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
                                : 'OBS not connected, so this is everything PRSH can configure rather than '
                                  + 'what’s in your scenes. Authoring, previews and container feeds all work; '
                                  + 'showing and hiding needs OBS. Use + to copy a source URL. To connect: '
                                  + 'enable the WebSocket server in OBS (Tools → WebSocket Server Settings), '
                                  + 'then set it up in Settings → OBS.'}
                        </Text>
                    )}
                </div>
            </ScrollArea>
        </Panel>
    );
});

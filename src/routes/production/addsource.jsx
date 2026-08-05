import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Copy, Check, X } from 'lucide-react';
import { useMirrorScene, useObsStore } from '../../context/obs';
import { urlsMatch } from '../../lib/obs-binding';
import { CopyButton } from '../../components/ui/copy-button';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../components/ui/dialog';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import ScaledIframe from '../../components/ScaledIframe';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { ELEMENTS } from './elements';
import { useActiveBoards, useBoardLabel } from './boards';
import {
    CONTAINER_MEMBERS, containerSizeClasses, containerUrl, fitsContainer,
    useContainerActions, useSharedContainers,
} from './containers';

/*
 * The Add picker — how a source comes into being now that the rack lists only
 * what is really in a scene.
 *
 *   layouts (+ boards) → preview → add them all to THIS scene
 *
 * The catalog stops being a place you browse and becomes a transaction. This
 * picker asks one question — "what goes in this scene?" — and the scene is
 * already answered, because the producer opened it from that scene's + button.
 * Copying a URL for a manual / dual-machine OBS is folded in here too, so the
 * old Setup layout-browser had no job left to do (v2 phase 8).
 *
 * Variants (size / team / direction) are separate catalog rows, exactly as the
 * layouts API returns them, so choosing "Scoreboard — Small" is choosing a row
 * rather than filling in a form. That is also why the picker consumes the API
 * instead of the ELEMENTS registry: the registry knows the ~14 things the
 * console can CONTROL, and the catalog knows the ~25 things OBS can SHOW.
 *
 * Added HIDDEN, like every other Bind path in the console: adding a source is
 * setup, and setup must never be the thing that puts something on the
 * broadcast. The rack row's eye is the one deliberate act that does.
 *
 * ── Building a scene is a batch, not a series of transactions ──
 *
 * A producer setting up a Game scene adds a scoreboard, a stats bar per side, a
 * ticker and an event header — five trips through a modal that names the same
 * scene every time. So selection is MULTI, and a pick is keyed on **url + board**
 * rather than url: Scoreboard on board 1 and on board 2 are two different
 * sources from one catalog row.
 *
 * ── Looking is not choosing ──
 *
 * Row click PREVIEWS. The checkbox SELECTS. Nothing else does either.
 *
 * They used to be the same gesture, which made browsing the catalog — the thing
 * a producer does most in here — silently build a batch they then had to undo.
 * Two questions ("what is this?" and "does it go in?") get two controls, and the
 * cheap, reversible one is the one the big target fires.
 *
 * WHICH BOARD is a third question, and it belongs to neither: it is a property
 * of a pick, not of the catalog. So it lives in the PREVIEW pane, beside the
 * thing it describes — tick board 2 there and that row is picked twice. The row
 * keeps one checkbox (picked on ≥1 board) and states the boards inline, so the
 * list still reads honestly without carrying the control. A single-board rig
 * never sees the question at all.
 */

/*
 * Which catalog rows take a `?scoreboard=N`, and therefore get a board step.
 *
 * Deliberately derived from the two places that already answer this rather than
 * a third hand-written list: the `scoreboard1` group (what Setup's board tabs
 * qualify — layouts.jsx sets the param for `mode === 'scoreboard'`) and the
 * `scope: 'board'` elements in the registry (what the console's own instance
 * identity is built on). Their union is scoreboard1/*, scorecard and
 * hitvisualizer. Everything else is added board-less, which is exactly what
 * Setup does today — so the picker makes no new claim about any layout.
 */
const BOARD_SCOPED_TYPES = new Set(
    ELEMENTS.filter(el => el.scope === 'board').map(el => el.id),
);

export function isBoardScoped(layout) {
    if (!layout) return false;
    return layout.group === 'scoreboard1' || BOARD_SCOPED_TYPES.has(layout.type);
}

// The overlay's URL, with the chosen board written in. Origin is left as the
// API returned it: the source may end up on a different machine than the one
// picking, and that URL is already host-qualified for exactly that reason. One
// builder feeds both paths out of the picker — Add-to-OBS and Copy — so a
// dual-machine or manual-OBS producer copies exactly what Add would have made.
export function overlayUrl(layout, board) {
    if (!layout) return '';
    if (!isBoardScoped(layout) || board == null) return layout.url;
    try {
        const u = new URL(layout.url);
        u.searchParams.set('scoreboard', String(board));
        return u.toString();
    } catch {
        const sep = layout.url.includes('?') ? '&' : '?';
        return `${layout.url}${sep}scoreboard=${board}`;
    }
}

/*
 * What the preview iframe loads: the URL Add would create, plus the two preview
 * flags.
 *
 * `preview=1` is chrome (instant reveals, blank-reason notes, no animation);
 * `sample=1` is the DATA — every Layout declares a sample bundle, and a picker
 * has to show a representative overlay on a machine with no game running. The
 * console's stage preview deliberately omits `sample` because there the point is
 * what is about to go on air; here nothing is on air yet.
 *
 * Resolved against this origin and returned path-only, so a dual-machine rig's
 * host-qualified catalog URL still loads in the producer's own browser.
 */
export function pickerPreviewUrl(layout, board) {
    const base = overlayUrl(layout, board);
    if (!base) return null;
    try {
        const u = new URL(base, window.location.origin);
        u.searchParams.set('preview', '1');
        u.searchParams.set('sample', '1');
        return `${u.pathname}${u.search}`;
    } catch {
        return null;
    }
}

// How a catalog row names itself: the layout, plus the variant that makes this
// row different from its siblings (size / team).
export const rowLabel = (l) => {
    const variant = l.sizeLabel || (l.team ? `Team ${l.team}` : '') || '';
    const name = l.parentName || l.name;
    return variant ? `${name} — ${variant}` : name;
};

/*
 * A selection's identity: the URL **and** the board.
 *
 * One catalog row can be picked twice — Scoreboard on board 1 and on board 2 are
 * two sources with their own air state, settings and instance id (see the
 * instances note in the console contract). Keying on url alone would silently
 * collapse them into one pick, which is the same bug the rack fixed one axis
 * over.
 */
export const pickKey = (layout, board) => `${layout?.url ?? ''}|${board ?? ''}`;

/*
 * The OBS input name — the SAME label the producer clicked.
 *
 * The catalog's raw `name` is the filename stem for variant rows ('scoreboard'),
 * so naming the input from it would hand back a source called "scoreboard 2"
 * for a row that read "Scoreboard — Large". A producer should be able to find
 * what they just added in OBS's source list by the name they picked.
 *
 * Board-suffixed only on a multi-board rig — otherwise the producer gets a "1"
 * that means nothing (same rule as the source strip's Bind).
 */
export function addName(layout, board, boards) {
    const base = layout ? rowLabel(layout) : 'PRSH Overlay';
    return isBoardScoped(layout) && board != null && boards.length > 1
        ? `${base} ${board}`
        : base;
}

// The layout catalog, fetched once per open. Rows are already one-per-variant.
function useLayoutCatalog(open) {
    const [layouts, setLayouts] = useState([]);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!open) return undefined;
        let alive = true;
        fetch('/api/v1/layouts')
            .then(r => r.json())
            .then(all => { if (alive) setLayouts(Array.isArray(all) ? all : []); })
            .catch(() => { if (alive) setError('Could not read the layout catalog.'); });
        return () => { alive = false; };
    }, [open]);
    return { layouts, error };
}

const GROUP_LABELS = {
    scoreboard1: 'Scoreboard',
    scorecard: 'Scorecard',
    shared: 'Shared containers',
    commentary: 'Talent',
    playerplates: 'Talent',
    matchup: 'Talent',
    lowerthird: 'Break',
    rotator: 'Rotators',
    bracket: 'Bracket',
    hitvisualizer: 'Hit Visualizer',
    schedule: 'Schedule',
    eventheader: 'Event Header',
    controller: 'Controller',
    ungrouped: 'Other',
};

/*
 * The order the shelves are read in — deliberate, because the alternative is
 * the order `rglob` happened to walk the folders, which put the bracket at the
 * top and the scoreboard two thirds of the way down. A producer opening this
 * from a game scene wants the scoreboard; the ones you add once a tournament
 * (bracket, controller) sit at the bottom. Anything unlisted follows, in
 * catalog order.
 */
const GROUP_ORDER = [
    'Scoreboard', 'Scorecard', 'Shared containers', 'Talent', 'Break',
    'Rotators', 'Event Header', 'Schedule', 'Hit Visualizer', 'Bracket',
    'Controller', 'Other',
];
const groupRank = (label) => {
    const at = GROUP_ORDER.indexOf(label);
    return at < 0 ? GROUP_ORDER.length : at;
};

/*
 * A layout with no `body { width/height }` (the bracket, the team-variant
 * plates) is fluid by design. `addBrowserSource` falls back to 1920×1080 for
 * those, so the preview does too — the preview's viewport must be the source's
 * viewport or it stops being a scale model. Never let ScaledIframe measure the
 * document here: a fluid body just reports the iframe's own width back.
 */
const nativeW = (l) => l?.width || 1920;
const nativeH = (l) => l?.height || 1080;

// Stable identity — a fresh Set per render would defeat CatalogRow's memo.
const EMPTY_SET = new Set();

// The commit chord, written the way the producer's own keyboard says it.
const MOD = typeof navigator !== 'undefined'
    && /Mac|iPhone|iPad/.test(navigator?.platform || navigator?.userAgent || '')
    ? '⌘' : 'Ctrl+';

/*
 * The boards a row is going in on, as the row states them: "1", "1, 2".
 *
 * Only ever a NOTE — the control is the preview pane's. A single-board rig
 * gets nothing, because "1" there is a fact with no alternative.
 */
export function boardsNote(layout, picked, boards) {
    if (!picked?.size || boards.length < 2 || !isBoardScoped(layout)) return '';
    return [...picked]
        .filter(b => b != null)
        .sort((a, b) => a - b)
        .join(', ');
}

/*
 * The list's height and the preview's height — one number, and both FIXED.
 *
 * The preview used to shape its own box from the layout's aspect, which read
 * beautifully and moved the dialog every time the producer stepped down the
 * list: a 1920×80 ticker, a 360×360 team logo and a 16:9 scene are three
 * different dialog heights, and the footer walked up and down the screen under
 * the cursor. A stage that resizes around its content is not a stage.
 *
 * So the frame is a fixed viewport and the overlay is letterboxed inside it.
 * The source's real bounds are still drawn — the checkerboard is sized to the
 * FITTED BOX rather than the frame (see PickerPreview), so it remains a scale
 * model of the OBS source, with the surround honestly reading as empty space.
 */
const PANE_HEIGHT = 416;

/*
 * The preview pane — the real overlay in an iframe, drawn against its own sample
 * bundle, at the size OBS will give it.
 *
 * ScaledIframe is handed a FIXED `height` here, which is its documented "the
 * caller owns the box" mode: it stops deriving a height and just fits the
 * largest box of the layout's aspect inside the frame, centred. One sizing
 * authority, as ever — but now it is a constant, so nothing about the dialog
 * moves as the producer walks the list.
 */
const PickerPreview = memo(function PickerPreview({
    layout, board, boardLabel, boards, pickedBoards, sceneBoards, onToggleBoard,
}) {
    const [fit, setFit] = useState(null);
    const onFit = useCallback((f) => {
        setFit(prev => (prev && prev.w === f.w && prev.scale === f.scale ? prev : f));
    }, []);

    const src = layout ? pickerPreviewUrl(layout, board) : null;
    const askBoards = !!layout && isBoardScoped(layout) && boards.length > 1;
    const detail = askBoards && board != null ? ` · ${boardLabel(board)}` : '';

    return (
        <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden">
            <div className="flex items-baseline gap-2">
                <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">
                    {layout ? `${rowLabel(layout)}${detail}` : 'Preview'}
                </Text>
                {layout && fit && (
                    <SimpleTooltip label="Source size in OBS, and how far down the preview is scaled">
                        <Text size="xs" span dimmed className="tabular-nums">
                            {fit.nativeW} × {fit.nativeH}
                            <span className="opacity-60"> · {Math.round(fit.scale * 100)}%</span>
                        </Text>
                    </SimpleTooltip>
                )}
            </div>

            {/* WHICH BOARD, asked beside the thing it describes.
                It is a property of the PICK, not of the catalog row: one row
                ticked on two boards is two sources, so these are checkboxes and
                not a chooser. The row keeps the single "does it go in" box and
                mirrors whatever is ticked here. A single-board rig is never
                asked — there is no choice to make.

                Toggles rather than native checkboxes, and NEVER WRAPPING: a
                13px box with a label beside it is the smallest hit target in the
                dialog for a decision that costs a source in OBS, and a rig with
                four boards wrapped them onto a second line, which moved the
                frame below. A row that can't fit scrolls sideways instead.

                On a multi-board rig the strip is ALWAYS here, even for rows
                that have no board to ask about — appearing and disappearing as
                the producer stepped between a scoreboard and a lower third
                moved the frame under the cursor by its own height. When there
                is nothing to ask it says so, which is worth a line anyway. */}
            {boards.length > 1 && (
                <div className="flex h-10 items-center gap-2 overflow-x-auto rounded-md border border-border/60 bg-secondary/30 px-2">
                    <Text size="xs" span dimmed className="shrink-0">Add on</Text>
                    {!askBoards && (
                        <Text size="xs" span dimmed className="truncate">
                            {layout
                                ? 'this overlay isn’t tied to a board — one source covers the rig.'
                                : 'pick an overlay first.'}
                        </Text>
                    )}
                    {askBoards && boards.map(b => {
                        const on = pickedBoards.has(b);
                        return (
                            <SimpleTooltip
                                key={b}
                                label={sceneBoards.has(b)
                                    ? `${boardLabel(b)} — already a source in this scene`
                                    : `Add a source for ${boardLabel(b)}`}
                            >
                                <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={on}
                                    aria-label={boardLabel(b)}
                                    onClick={() => onToggleBoard(layout, b)}
                                    className={cn(
                                        'flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 transition-colors',
                                        on
                                            ? 'border-primary bg-primary/15 text-foreground'
                                            : 'border-border text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'grid size-3.5 place-content-center rounded-[4px] border',
                                            on
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-input',
                                        )}
                                    >
                                        {on && <Check size={10} strokeWidth={3} />}
                                    </span>
                                    <Text size="xs" span className="whitespace-nowrap">
                                        {boardLabel(b)}
                                    </Text>
                                    {/* Already in the scene — a dot, not a
                                        sentence: the pills have to stay the
                                        width of a board name. */}
                                    {sceneBoards.has(b) && (
                                        <span
                                            aria-hidden="true"
                                            className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
                                        />
                                    )}
                                </button>
                            </SimpleTooltip>
                        );
                    })}
                </div>
            )}

            {/* The frame is FIXED (see PANE_HEIGHT) and the overlay letterboxes
                inside it. The checkerboard is drawn at the FITTED BOX rather
                than on the frame, so its edges are still the source's edges —
                overlays are authored on transparency, and a flat backdrop makes
                a fully-transparent overlay indistinguishable from one that
                failed to load. Everything outside it reads as what it is: room
                the source doesn't occupy. */}
            <div
                className="relative flex w-full items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background/40"
                style={{ height: PANE_HEIGHT }}
            >
                {src && fit && (
                    <div
                        aria-hidden="true"
                        className="absolute"
                        style={{
                            width: fit.w,
                            height: fit.h,
                            backgroundColor: '#15151c',
                            backgroundImage:
                                'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%),'
                                + 'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%)',
                            backgroundSize: '16px 16px',
                            backgroundPosition: '0 0, 8px 8px',
                        }}
                    />
                )}
                {src ? (
                    <ScaledIframe
                        key={src}
                        src={src}
                        nativeWidth={nativeW(layout)}
                        nativeHeight={nativeH(layout)}
                        height={PANE_HEIGHT}
                        onFit={onFit}
                        title={`${rowLabel(layout)} preview`}
                        className="absolute inset-0"
                    />
                ) : (
                    <Text size="xs" dimmed className="px-4 text-center">
                        Click an overlay to see it here.
                    </Text>
                )}
            </div>

            <Text size="xs" dimmed>
                {src
                    ? 'Sample data — this is how it draws with no game running.'
                    : 'Previews use each overlay’s sample data, so nothing has to be live.'}
            </Text>
        </div>
    );
});

/*
 * Building a container, in the picker that adds it.
 *
 * A container is producer-built config, not a file, so there has to be a place
 * to make one — and the honest place is the transaction that puts it in a
 * scene. The producer names it, picks a SIZE, and ticks the members that fit;
 * the new definition is written and immediately selected, so Add drops the
 * source into the scene they opened this from.
 *
 * SIZE FIRST, because it is the constraint everything else answers to. The
 * sizes are the census of what can go in a container (containerSizeClasses),
 * not invented presets, and the member list is filtered to what fits — a member
 * larger than its container is unrepresentable rather than handled, since there
 * is no scaling system. Smaller members center.
 */
const NewContainerForm = memo(function NewContainerForm({ onCreate, onCancel }) {
    const classes = useMemo(() => containerSizeClasses(), []);
    const [name, setName] = useState('');
    const [sizeId, setSizeId] = useState(classes[0]?.id ?? null);
    const [members, setMembers] = useState([]);

    const size = classes.find(c => c.id === sizeId) ?? classes[0];
    const candidates = size
        ? CONTAINER_MEMBERS.filter(el => fitsContainer(el, size.width, size.height))
        : [];

    // Members that no longer fit after a size change are dropped rather than
    // carried invisibly — the roster the producer confirms is the one they see.
    const pickSize = (id) => {
        const next = classes.find(c => c.id === id);
        setSizeId(id);
        if (next) {
            setMembers(prev => prev.filter(m => {
                const el = CONTAINER_MEMBERS.find(e => e.id === m);
                return fitsContainer(el, next.width, next.height);
            }));
        }
    };

    const toggle = (id) => setMembers(prev => (
        prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    ));

    return (
        <div className="flex flex-col gap-2 pr-2">
            <Text size="xs" span className="label-display px-1 tracking-wider text-muted-foreground">
                New container
            </Text>

            <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name it — “Lower Bar”, “Replay Stage”"
                className="h-8"
            />

            <div className="flex flex-col gap-0.5">
                <Text size="xs" dimmed className="px-1">
                    Size — members this size fill it; smaller ones center, never scale.
                </Text>
                {classes.map(c => (
                    <button
                        key={c.id} type="button" onClick={() => pickSize(c.id)}
                        className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-1 text-left',
                            c.id === sizeId ? 'bg-accent text-foreground' : 'hover:bg-accent/50',
                        )}
                    >
                        <span className={cn(
                            'size-2 shrink-0 rounded-full',
                            c.id === sizeId ? 'bg-rio-400' : 'bg-muted-foreground/30',
                        )} />
                        <Text size="xs" span className="tabular-nums">{c.width} × {c.height}</Text>
                        <Text size="xs" span truncate dimmed className="min-w-0 flex-1">
                            {c.members.map(m => m.name).join(', ')}
                        </Text>
                    </button>
                ))}
            </div>

            <div className="flex flex-col gap-0.5">
                <Text size="xs" dimmed className="px-1">
                    Members — one at a time on screen. Anything sharing a container
                    can never be up together, which is what sharing one means.
                </Text>
                {candidates.map(el => (
                    <label
                        key={el.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50"
                    >
                        <input
                            type="checkbox"
                            checked={members.includes(el.id)}
                            onChange={() => toggle(el.id)}
                            className="size-3 shrink-0 accent-current"
                        />
                        <Text size="xs" span truncate className="min-w-0 flex-1">{el.name}</Text>
                        <Text size="xs" span dimmed className="tabular-nums">
                            {el.width} × {el.height}
                        </Text>
                    </label>
                ))}
            </div>

            <Group gap="xs" className="px-1 pt-1">
                <Button
                    size="sm"
                    disabled={!name.trim() || !size}
                    onClick={() => onCreate(name.trim(), size, members)}
                >
                    Create
                </Button>
                <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
            </Group>
        </div>
    );
});

/*
 * One catalog row: a checkbox, and a body that previews.
 *
 * The body is the big target and it is the CHEAP, reversible act — browsing the
 * catalog is what a producer does most in here, and it must not quietly build a
 * batch. The checkbox is the whole of "this goes in", on every row, board-scoped
 * or not: a board-scoped row ticks on the primary board and the preview pane is
 * where a second board gets added (see PickerPreview). Untick clears every board
 * at once, which is the only reading of an unchecked box that isn't a lie.
 *
 * The picked boards are STATED on the row rather than controlled from it, so a
 * producer scanning the list can still see that the scoreboard is going in
 * twice without the row carrying a control per board.
 */
const CatalogRow = memo(function CatalogRow({
    layout, focused, picked, boardsNote, inScene, onFocus, onToggle,
}) {
    const label = rowLabel(layout);

    return (
        <div
            data-row={layout.url}
            className={cn(
                'flex h-8 items-center rounded-md pr-1 transition-colors',
                focused ? 'bg-secondary/70' : 'hover:bg-secondary/40',
            )}
        >
            <button
                type="button"
                role="checkbox"
                aria-checked={picked}
                aria-label={`Select ${label}`}
                onClick={() => onToggle(layout)}
                className="grid h-8 w-7 shrink-0 place-content-center rounded-md"
            >
                <span
                    aria-hidden="true"
                    className={cn(
                        'grid size-3.5 place-content-center rounded-[4px] border transition-colors',
                        picked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input',
                    )}
                >
                    {picked && <Check size={10} strokeWidth={3} />}
                </span>
            </button>

            <button
                type="button"
                onClick={() => onFocus(layout)}
                aria-label={`Preview ${label}`}
                className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-1 text-left"
            >
                <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">
                    {label}
                </Text>
                {/* Which boards this row is going in on — the preview pane's
                    answer, restated where the list can see it. */}
                {boardsNote && (
                    <Text size="xs" span className="shrink-0 tabular-nums text-primary">
                        {boardsNote}
                    </Text>
                )}
                {/* Already a source in this scene. Not a block — a producer may
                    genuinely want two — but adding a duplicate by accident and
                    finding it in OBS an hour later is the failure this prevents. */}
                {inScene && (
                    <Text size="xs" span dimmed className="shrink-0">in scene</Text>
                )}
                {/* shrink-0: the label is the flexible half. Without it the
                    dimensions are what the flexbox eats first, and "1920×1080"
                    clips to "192" — a number that reads as a real one. */}
                {layout.width && layout.height && (
                    <Text size="xs" span dimmed className="shrink-0 tabular-nums">
                        {layout.width}×{layout.height}
                    </Text>
                )}
            </button>
        </div>
    );
});

/*
 * `open` is separate from `scene` because the picker is worth opening with no
 * scene at all.
 *
 * With OBS closed there are no scenes and therefore no + in a scene header — but
 * two of this dialog's three jobs need nothing from OBS: copying the exact URL
 * Add would have created, and BUILDING A CONTAINER (a definition in Settings).
 * Gating the whole picker on a scene made the container builder unreachable for
 * anyone whose OBS wasn't up, which is also why it went unverified for a week.
 * Add is the only slot that stands down.
 */
export const AddSourceDialog = memo(function AddSourceDialog({ scene, open: openProp, onClose }) {
    const open = openProp ?? !!scene;
    const { layouts, error } = useLayoutCatalog(open);
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();
    const [query, setQuery] = useState('');
    // Ordered picks, so a batch is added in the order the producer built it.
    const [picks, setPicks] = useState([]);
    // The catalog row being previewed — a LAYOUT, not a pick. Looking at
    // something is not choosing it, so focus carries no board and no state
    // beyond "this is what's on the right".
    const [focus, setFocus] = useState(null);
    const [adding, setAdding] = useState(false);
    const listRef = useRef(null);
    // The left pane swaps to the container builder rather than opening a second
    // dialog: building one is part of this transaction, and the preview beside
    // it keeps showing whatever is focused.
    const [building, setBuilding] = useState(false);
    const defs = useSharedContainers();
    const { create } = useContainerActions();

    // Every open is a fresh transaction — a picker that remembers last time's
    // selection is one the producer has to check before clicking Add.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setPicks([]);
        setFocus(null);
        setBuilding(false);
    }, [open]);

    /*
     * A container the producer just built has to be pickable IMMEDIATELY, and
     * the definition is already in the settings store — so the shared group is
     * the catalog's rows UNION the definitions, rather than a catalog refetch
     * raced against the settings write. The union is self-healing: once the
     * server reports the new one, the merge is a no-op.
     *
     * Absolute URL, like every other catalog row: Add hands it straight to OBS.
     */
    const containerRows = useMemo(() => defs.map(d => ({
        group: 'shared',
        name: d.name,
        type: 'container',
        url: `${window.location.origin}${containerUrl(d.id)}`,
        width: d.width,
        height: d.height,
        container: d.id,
    })), [defs]);

    const createContainer = useCallback((name, size, members) => {
        const id = create(name, size.width, size.height, members);
        setBuilding(false);
        // Select and preview it, so Create → Add is one continuous act.
        const row = {
            group: 'shared', name, type: 'container', container: id,
            url: `${window.location.origin}${containerUrl(id)}`,
            width: size.width, height: size.height,
        };
        setPicks(prev => [...prev, { layout: row, board: null }]);
        setFocus(row);
    }, [create]);

    /*
     * The catalog, filtered. A query matches the ROW or its GROUP, so "talent"
     * and "break" find their whole shelf — the producer's own vocabulary for
     * these is the group heading at least as often as the layout's name.
     */
    const groups = useMemo(() => {
        const q = query.toLowerCase().trim();
        const out = new Map();
        // Containers come from the definitions; the catalog's own shared rows
        // are the same list one round-trip behind, so they are dropped rather
        // than shown twice.
        const rows = [...layouts.filter(l => l.group !== 'shared'), ...containerRows];
        for (const l of rows) {
            const key = GROUP_LABELS[l.group] ?? l.group;
            if (q
                && !rowLabel(l).toLowerCase().includes(q)
                && !key.toLowerCase().includes(q)) continue;
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(l);
        }
        return [...out.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b));
    }, [layouts, containerRows, query]);

    // The visible rows in list order — what the arrow keys walk.
    const flatRows = useMemo(() => groups.flatMap(([, rows]) => rows), [groups]);

    // url → the set of boards picked from that row, for the check and the note.
    const pickedByUrl = useMemo(() => {
        const m = new Map();
        for (const p of picks) {
            if (!m.has(p.layout.url)) m.set(p.layout.url, new Set());
            m.get(p.layout.url).add(p.board);
        }
        return m;
    }, [picks]);

    /*
     * What is ALREADY in the scene we're adding to — url → the set of boards
     * that already have a source.
     *
     * `urlsMatch` is the console's own answer to "is this overlay that source":
     * pathname plus the params that distinguish an instance, so a dual-machine
     * rig's host-qualified source still matches, and a board-less URL matches a
     * `?scoreboard=1` source (the documented default). Kept as a map rather than
     * asked per render: the rows and the preview both need it.
     */
    const { items: sceneItems } = useMirrorScene(scene);
    const inSceneByUrl = useMemo(() => {
        const m = new Map();
        if (!sceneItems.length) return m;
        for (const l of flatRows) {
            const set = new Set();
            for (const b of (isBoardScoped(l) ? boards : [null])) {
                const url = overlayUrl(l, b);
                if (sceneItems.some(it => urlsMatch(url, it.url))) set.add(b);
            }
            if (set.size) m.set(l.url, set);
        }
        return m;
    }, [flatRows, sceneItems, boards]);

    /*
     * Ticking the box: the row goes in, on the primary board if it is
     * board-scoped. Unticking clears EVERY board it was picked on — an unchecked
     * box that left a board 2 pick behind would be a lie, and the preview pane
     * is where a per-board answer is given.
     */
    const onToggle = useCallback((layout) => {
        setPicks(prev => (prev.some(p => p.layout.url === layout.url)
            ? prev.filter(p => p.layout.url !== layout.url)
            : [...prev, {
                layout,
                board: isBoardScoped(layout) ? (boards[0] ?? 1) : null,
            }]));
        // Selecting previews too — you should be able to see what you just
        // agreed to put on the broadcast.
        setFocus(layout);
    }, [boards]);

    // The preview pane's per-board checkbox: one exact pick, on or off.
    const onToggleBoard = useCallback((layout, board) => {
        const key = pickKey(layout, board);
        setPicks(prev => (prev.some(p => pickKey(p.layout, p.board) === key)
            ? prev.filter(p => pickKey(p.layout, p.board) !== key)
            : [...prev, { layout, board }]));
    }, []);

    const removePick = useCallback((key) => {
        setPicks(prev => prev.filter(p => pickKey(p.layout, p.board) !== key));
    }, []);

    const focusPicked = focus ? (pickedByUrl.get(focus.url) ?? EMPTY_SET) : EMPTY_SET;

    /*
     * Which board the PREVIEW draws. The lowest board this row is picked on, so
     * ticking board 2 shows board 2's data; falling back to the rig's primary
     * when nothing is picked yet, because a preview has to render as something.
     */
    const previewBoard = useMemo(() => {
        if (!focus || !isBoardScoped(focus)) return null;
        const picked = [...focusPicked].filter(b => b != null).sort((a, b) => a - b);
        return picked[0] ?? boards[0] ?? 1;
    }, [focus, focusPicked, boards]);

    /*
     * Copy follows the SELECTION — several picks copy as one URL per line, which
     * is what a dual-machine producer pastes into a column of browser sources.
     * With nothing checked it falls back to whatever is previewed, so "look at
     * this one, take its URL" doesn't require checking a box first.
     */
    const copyValue = useMemo(() => {
        if (picks.length) return picks.map(p => overlayUrl(p.layout, p.board)).join('\n');
        return focus ? overlayUrl(focus, previewBoard) : '';
    }, [picks, focus, previewBoard]);

    /*
     * Sequential, never parallel: the OBS mirror reconciles one event at a time
     * and a burst of CreateInput races it (and races its own uniqueness check —
     * two "Stats — Team 1" in flight both see the name free).
     *
     * No rollback on partial failure. Deleting sources the producer can see
     * appear is worse than telling them plainly which one didn't make it, so the
     * successes stay, drop out of the selection, and the dialog stays open on
     * what's left to retry.
     */
    const add = async () => {
        if (!picks.length) return;
        setAdding(true);
        const done = [];
        const failed = [];
        for (const p of picks) {
            try {
                const res = await useObsStore.getState().addBrowserSource({
                    inputName: addName(p.layout, p.board, boards),
                    url: overlayUrl(p.layout, p.board),
                    width: p.layout.width,
                    height: p.layout.height,
                    sceneName: scene,
                    enabled: false,
                });
                done.push({ pick: p, name: res.inputName });
            } catch (e) {
                failed.push({ pick: p, message: e?.message });
            }
        }
        setAdding(false);

        if (!failed.length) {
            notifications.show({
                message: done.length === 1
                    ? `Added “${done[0].name}” to ${scene} — hidden. Flip it on when you're ready.`
                    : `Added ${done.length} sources to ${scene} — all hidden. Flip them on when you're ready.`,
                color: 'green',
            });
            onClose();
            return;
        }

        const names = failed.map(f => rowLabel(f.pick.layout)).join(', ');
        notifications.show({
            message: done.length
                ? `Added ${done.length} of ${done.length + failed.length} to ${scene} — ${names} failed.`
                : (failed[0].message || 'Failed to add to OBS'),
            color: 'red',
        });
        // Keep only what didn't land, so Add retries the failures instead of
        // duplicating the sources already in the scene.
        const keep = new Set(failed.map(f => pickKey(f.pick.layout, f.pick.board)));
        setPicks(prev => prev.filter(p => keep.has(pickKey(p.layout, p.board))));
    };

    // Keep the previewed row visible when the arrows moved it rather than a
    // click. `scrollIntoView` is absent in jsdom, hence the optional call.
    useEffect(() => {
        if (!focus || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-row="${focus.url}"]`);
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [focus]);

    /*
     * Keyboard, on the model the panel now has: ↑↓ LOOK, Enter CHOOSE,
     * ⌘/Ctrl+Enter commit.
     *
     * Enter rather than Space is the select key on purpose — the search box has
     * autofocus and holds it while the producer filters, so a Space binding
     * would either eat spaces out of a query or never fire. Space still works
     * once the keyboard has left the field, where it is what a checkbox expects.
     * A real button target keeps its own Enter/Space: whatever is focused wins
     * over the panel's shortcut, so tabbing to Add and pressing Enter adds.
     */
    const onKeyDown = (e) => {
        if (building) return;
        const tag = e.target?.tagName;
        const typing = tag === 'INPUT' || tag === 'TEXTAREA';

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!flatRows.length) return;
            e.preventDefault();
            const at = flatRows.findIndex(l => l.url === focus?.url);
            const next = e.key === 'ArrowDown'
                ? Math.min(at + 1, flatRows.length - 1)
                : (at < 0 ? flatRows.length - 1 : Math.max(at - 1, 0));
            setFocus(flatRows[next]);
            return;
        }
        if (tag === 'BUTTON') return;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            if (scene && picks.length && !adding) { e.preventDefault(); add(); }
            return;
        }
        if ((e.key === 'Enter' || (e.key === ' ' && !typing)) && focus) {
            e.preventDefault();
            onToggle(focus);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            {/* Wide enough that a 1920×1080 overlay fills the fixed frame at a
                readable size — the preview is the point of this dialog, and at
                4xl a 16:9 sample was a postage stamp beside the list. */}
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[72rem]" onKeyDown={onKeyDown}>
                <DialogHeader>
                    <DialogTitle className="label-display">
                        {scene ? `Add to “${scene}”` : 'Overlays'}
                    </DialogTitle>
                    {/* The keyboard model lives here rather than in the footer:
                        it is the same sentence every time, and the footer is
                        where the batch goes — a line that alternates between
                        instructions and content is a line that moves. */}
                    <DialogDescription>
                        {scene
                            ? 'Click an overlay to preview it; tick its box to add it — or '
                              + `↑↓ to preview, ⏎ to select, ${MOD}⏎ to add. Everything goes in `
                              + 'hidden, and you turn it on from the rack.'
                            : 'OBS isn’t connected, so there’s no scene to add to. You can still '
                              + 'preview anything here, copy its source URL, and build a container.'}
                    </DialogDescription>
                </DialogHeader>

                {/* `min-w-0` on the body, because the footer's chip ribbon is a
                    row of NOWRAP chips: its min-content width is the whole
                    batch laid end to end, and a grid item's default
                    `min-width: auto` hands that straight to the dialog, which
                    then renders wider than the screen with its buttons off the
                    right edge. Same family as the preview-column note below —
                    content must never size the box that sizes the content. */}
                <Stack gap="sm" className="min-w-0">
                    {/* `minmax(0,1fr)` for the preview column, not `flex-1`.
                        ScaledIframe sizes the iframe in PIXELS, and a px-wide
                        descendant becomes its ancestors' min-content width — the
                        dialog's own grid then sizes to THAT, growing past its
                        max-width until the footer buttons render outside it and
                        get clipped. `min-w-0` cannot fix it (a minimum is a
                        floor, not a cap); a 1fr track with a zero minimum
                        refuses to size to its contents by construction. Same
                        shape as the stage preview's height loop: the content
                        must never size the box that sizes the content. */}
                    <div className="grid min-h-0 grid-cols-[21rem_minmax(0,1fr)] gap-4">
                        <div className="flex min-w-0 flex-col gap-2">
                            <div className="relative">
                                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search overlays…" className="pl-7"
                                />
                            </div>

                            {/* A plain scroll container, not the kit's
                                ScrollArea: Radix wraps its viewport's children
                                in a shrink-to-fit `display: table` so a list CAN
                                scroll sideways, and a row's `truncate` label is
                                `white-space: nowrap` — so the table sizes to the
                                longest full name, the rows run past the pane,
                                and the dimensions on the right get sliced
                                ("1920×1080" reading as "192"). A block box has
                                the pane's definite width, which is what the
                                label needs to truncate against. */}
                            <div
                                ref={listRef}
                                className="overflow-y-auto overflow-x-hidden"
                                style={{ height: PANE_HEIGHT }}
                            >
                                {building ? (
                                    <NewContainerForm
                                        onCreate={createContainer}
                                        onCancel={() => setBuilding(false)}
                                    />
                                ) : (
                                <div className="flex flex-col gap-2 pr-2">
                                    {error && <Text size="xs" className="text-destructive">{error}</Text>}
                                    {!error && !groups.length && (
                                        <Text size="xs" dimmed>
                                            {layouts.length ? 'Nothing matches that.' : 'Reading the layout catalog…'}
                                        </Text>
                                    )}
                                    {groups.map(([label, rows]) => (
                                        <div key={label} className="flex flex-col">
                                            <div className="flex items-baseline gap-2 px-1 pb-0.5">
                                                <Text size="xs" span className="label-display min-w-0 flex-1 tracking-wider text-muted-foreground">
                                                    {label}
                                                </Text>
                                                {/* Building a container belongs
                                                    with the containers, not in
                                                    a settings page: it is only
                                                    ever done in order to put
                                                    one in a scene. */}
                                                {label === GROUP_LABELS.shared && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setBuilding(true)}
                                                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                                                    >
                                                        + New
                                                    </button>
                                                )}
                                            </div>
                                            {rows.map(l => (
                                                <CatalogRow
                                                    key={l.url}
                                                    layout={l}
                                                    focused={focus?.url === l.url}
                                                    picked={(pickedByUrl.get(l.url) ?? EMPTY_SET).size > 0}
                                                    boardsNote={boardsNote(l, pickedByUrl.get(l.url), boards)}
                                                    inScene={inSceneByUrl.has(l.url)}
                                                    onFocus={setFocus}
                                                    onToggle={onToggle}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                                )}
                            </div>
                        </div>

                        <PickerPreview
                            layout={focus}
                            board={previewBoard}
                            boardLabel={boardLabel}
                            boards={boards}
                            pickedBoards={focusPicked}
                            sceneBoards={(focus && inSceneByUrl.get(focus.url)) || EMPTY_SET}
                            onToggleBoard={onToggleBoard}
                        />
                    </div>

                    {/* ONE row, fixed height. The batch, named — "3 selected" is
                        a number a producer has to scroll the list to verify,
                        where the tray is the thing itself: each pick removable
                        where it is read, and clickable to bring it back into the
                        preview. It shares the button row and scrolls sideways
                        rather than wrapping, because a footer that grows a
                        second line as you select walks the buttons down the
                        screen under the cursor. */}
                    <Group gap="sm" className="min-w-0 items-center justify-between border-t border-border/60 pt-2">
                        <div className="flex h-6 min-w-0 flex-1 items-center gap-2">
                            <Text size="xs" dimmed className="shrink-0">
                                {picks.length ? `${picks.length} selected` : 'Nothing selected yet.'}
                            </Text>
                            {/* The scrollbar is hidden, not absent: a 6px-tall
                                track inside a 24px strip lands on top of the
                                chips it is supposed to help with. The ribbon
                                still scrolls by wheel, trackpad and keyboard. */}
                            <div
                                className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
                                style={{ scrollbarWidth: 'none' }}
                            >
                                {picks.map((p) => {
                                    const key = pickKey(p.layout, p.board);
                                    const label = rowLabel(p.layout)
                                        + (p.board != null && boards.length > 1
                                            ? ` · ${p.board}` : '');
                                    return (
                                        <span
                                            key={key}
                                            // shrink-0: a flex child's default is
                                            // to shrink, which folded each chip's
                                            // label onto two lines and burst it
                                            // out of the strip.
                                            className="flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-border bg-secondary/50 pl-1.5 pr-0.5"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setFocus(p.layout)}
                                                className="whitespace-nowrap text-[10px] leading-none text-foreground"
                                            >
                                                {label}
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Remove ${label}`}
                                                onClick={() => removePick(key)}
                                                className="grid size-4 place-content-center rounded text-muted-foreground hover:text-foreground"
                                            >
                                                <X size={10} />
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <Group gap="xs" className="shrink-0">
                            {/* Copy the exact URLs Add would create — the escape
                                hatch for a producer whose OBS is on another
                                machine or who wires sources by hand. No OBS
                                needed, so it stays live even when Add can't. */}
                            <CopyButton value={copyValue}>
                                {({ copied, copy }) => (
                                    <Button
                                        size="sm" variant="outline" disabled={!copyValue}
                                        onClick={copy}
                                    >
                                        {copied
                                            ? <><Check size={13} className="mr-1" /> Copied</>
                                            : <><Copy size={13} className="mr-1" /> Copy URL{picks.length > 1 ? 's' : ''}</>}
                                    </Button>
                                )}
                            </CopyButton>
                            {/* Add is the one slot that needs OBS: it creates a
                                browser source in a scene. It holds its place and
                                goes honestly grey rather than vanishing — same
                                rule as the source strip's Push slot. */}
                            <SimpleTooltip label={scene
                                ? `Add to “${scene}”, hidden (${MOD}⏎)`
                                : 'OBS isn’t connected — copy the URL instead'}>
                                <span>
                                    <Button
                                        size="sm" disabled={!scene || !picks.length || adding}
                                        onClick={add}
                                    >
                                        <Plus size={13} className="mr-1" />
                                        {adding
                                            ? 'Adding…'
                                            : `Add ${picks.length > 1 ? `${picks.length} ` : ''}hidden`}
                                    </Button>
                                </span>
                            </SimpleTooltip>
                        </Group>
                    </Group>
                </Stack>
            </DialogContent>
        </Dialog>
    );
});

export default AddSourceDialog;

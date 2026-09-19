import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Copy, Check, Minus, X, Eye } from 'lucide-react';
import { useMirrorScene, useObsStore } from '../../../context/obs';
import { useStateStore } from '../../../context/store';
import { boardOfUrl, urlsMatch } from '../../../lib/obs-binding';
import { CopyButton } from '../../../components/ui/copy-button';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../../components/ui/dialog';
import { Stack, Group, Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import ScaledIframe from '../../../components/ScaledIframe';
import { cn } from '../../../lib/utils';
import { notifications } from '../../../lib/notify';
import { ELEMENTS, readsBoard } from '../elements';
import { withBoard } from './sourcename';
import { sideLabel, useSideLabels } from '../sides';
import { useActiveBoards, useBoardLabel, useBoardTag, useRotatingBoards } from '../board/boards';
import {
    CONTAINER_MEMBERS, containerSizeClasses, containerUrl, fitsContainer,
    useContainerActions, useSharedContainers,
} from '../containers/containers';

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
 * Added HIDDEN by default, like every other Bind path in the console: adding a
 * source is setup, and setup must never be the thing that puts something on the
 * broadcast. The rack row's eye is the one deliberate act that does — and ⌘⏎
 * stays bound to the hidden add, so the reflex commit is always the safe one.
 *
 * **Add visible** sits beside it for the other half of the job. Before a stream
 * there is nothing to protect: a producer laying out a scene has to SEE what
 * they placed, and the alternative was adding five sources and then hunting
 * five eyes in the rack to find out where they landed. It is a second button
 * rather than a default because the two cases are told apart by exactly one
 * thing — whether the broadcast is live — which the console cannot ask, so the
 * producer says which one they are in by pressing one or the other.
 *
 * ── Building a scene is a batch, not a series of transactions ──
 *
 * A producer setting up a Game scene adds a scoreboard, a stats bar per side, a
 * ticker and an event header — five trips through a modal that names the same
 * scene every time. So selection is MULTI, and a pick is keyed on **url + board**
 * rather than url: Scoreboard on board 1 and on board 2 are two different
 * sources from one catalog row.
 *
 * ── Looking is not choosing, but a second look is ──
 *
 * The first click on a row PREVIEWS it and selects nothing. A second click on
 * the row already being previewed SELECTS it — by then the producer has seen
 * the thing, so the click is a deliberate repeat rather than a browse. Same two
 * beats as the keyboard (↑↓ look, ⏎ choose), on the target the mouse is over.
 * The checkbox still selects in one click, from anywhere in the list.
 *
 * They used to be the same gesture, which made browsing the catalog — the thing
 * a producer does most in here — silently build a batch they then had to undo.
 * Two questions ("what is this?" and "does it go in?") get two controls, and the
 * cheap, reversible one is the one the big target fires.
 *
 * ── WHICH BOARD is asked FIRST, once, for the whole list ──
 *
 * A producer building a board's scene thinks "what does board 2 need", not
 * "which board does this Stat Bar belong to" eleven times over. So on a
 * multi-board rig the catalog opens with a tab per board (`BoardTabs`): the
 * tab's board is what every board-reading row is picked FOR, its rows say
 * what that board already has in this scene, and everything that reads no
 * board sits beneath on a Show-wide shelf that does not change with the tab.
 * One row on two boards is still two picks (`pickKey`) — tick it, switch tab,
 * tick it again — and the row notes the OTHER boards it is picked on, so a
 * pick made on a tab out of sight is still stated on the list. This replaced
 * a per-row "Add for" strip beside the preview, which answered the board one
 * row at a time and never showed a board's set as a set. A single-board rig
 * draws no tabs and never sees the question at all.
 */

/*
 * Which catalog rows take a `?scoreboard=N`, and therefore get a board step.
 *
 * Every layout whose overlay READS the param — `readsBoard` in the registry,
 * the same answer the stage's Board row gives, so a source the picker adds
 * board-less is never one the panel then offers to re-point (or the reverse).
 * The `scoreboard1` group stays in the union for a catalog row the registry
 * has not caught up with. Matched by layout type AND by url, because two of
 * them are named differently in the two places (the post-game callouts are
 * `spotlight`/`summary` in the catalog).
 */
const BOARD_READERS = ELEMENTS.filter(readsBoard);

export function isBoardScoped(layout) {
    if (!layout) return false;
    if (layout.group === 'scoreboard1') return true;
    return BOARD_READERS.some(el => el.id === layout.type || el.match(layout.url ?? ''));
}

/*
 * Whether the PICKER asks a board for this row — every board reader except one
 * that is chrome for the whole show (`showWide` in the registry), which sits on
 * the Show-wide shelf and goes in naming no board. `isBoardScoped` stays the
 * answer to "can this source name a board" (the URL builder, the stage's Board
 * row); this is only "does it belong under a board's tab".
 */
const SHOW_WIDE = ELEMENTS.filter(el => el.showWide);

export function picksBoard(layout) {
    if (!isBoardScoped(layout)) return false;
    return !SHOW_WIDE.some(el => el.id === layout.type || el.match(layout.url ?? ''));
}

/*
 * The catalog's rows as the LIST draws them: a side 1 / side 2 pair of one
 * layout folds into one row (`{ key, lead, members }`, members in side order),
 * everything else is a row of one. A pair folds only when BOTH sides are in
 * the catalog — a lone side is an ordinary row. The row sits where its first
 * side did, so catalog order holds.
 */
const pairKeyOf = (l) => (l.team
    ? `${l.group}|${l.type}|${l.parentName ?? l.name}|${l.sizeLabel ?? ''}`
    : null);

export function pairRows(layouts) {
    const bySide = new Map();
    for (const l of layouts) {
        const k = pairKeyOf(l);
        if (k == null) continue;
        if (!bySide.has(k)) bySide.set(k, []);
        bySide.get(k).push(l);
    }
    const out = [];
    const placed = new Set();
    for (const l of layouts) {
        const k = pairKeyOf(l);
        const sides = k != null ? bySide.get(k) : null;
        const isPair = sides?.length === 2
            && sides.some(x => Number(x.team) === 1) && sides.some(x => Number(x.team) === 2);
        if (!isPair) { out.push({ key: l.url, lead: l, members: [l] }); continue; }
        if (placed.has(k)) continue;
        placed.add(k);
        const members = [...sides].sort((a, b) => Number(a.team) - Number(b.team));
        out.push({ key: members[0].url, lead: members[0], members });
    }
    return out;
}

/*
 * Whether a row is offered under a given board at all. The Results Ticker draws
 * the board's rotation pool and nothing else (`rotatingOnly`), so under a board
 * that isn't rotating it would be an empty strip — it is left off that tab
 * rather than offered and then drawing nothing.
 */
const ROTATING_ONLY = ELEMENTS.filter(el => el.rotatingOnly);

export function offeredOn(layout, board, rotating) {
    if (!ROTATING_ONLY.some(el => el.id === layout.type || el.match(layout.url ?? ''))) return true;
    return rotating.includes(board);
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
export function pickerPreviewUrl(layout, board, { live = false } = {}) {
    const base = overlayUrl(layout, board);
    if (!base) return null;
    try {
        const u = new URL(base, window.location.origin);
        u.searchParams.set('preview', '1');
        // LIVE when the board has a game on it. The sample bundle replaces the
        // whole store, so it can only ever draw the bundle's own teams — never
        // the producer's league logos, their Address Book names, or their MSB
        // asset pack's art for tonight's teams. A producer adding a Stat Bar to a
        // board that holds a game is asking what THAT will look like, so the
        // sample is the fallback for an empty board, not the default.
        if (!live) u.searchParams.set('sample', '1');
        return `${u.pathname}${u.search}`;
    } catch {
        return null;
    }
}

/*
 * How a catalog row names itself: the layout, plus the variant that makes this
 * row different from its siblings (size / team).
 *
 * A `?team=` row is a SIDE, so it reads in the producer's side vocabulary
 * (../sides) — the same words the rack row and the stage panel for that source
 * will use. `mode` is optional and defaults to the default vocabulary, which is
 * what keeps this a pure function the tests can call without a store.
 */
export const rowLabel = (l, mode) => {
    const variant = l.sizeLabel || (l.team ? sideLabel(l.team, mode) : '') || '';
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
export function addName(layout, board, boards, mode) {
    const base = layout ? rowLabel(layout, mode) : 'PRSH Overlay';
    return isBoardScoped(layout) ? withBoard(base, board, boards) : base;
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
    // The Scorecard is the scoreboard's vertical form, not a shelf of its own —
    // a heading over one row is a second name for that row.
    scorecard: 'Scoreboard',
    shared: 'Shared containers',
    commentary: 'Talent',
    playerplates: 'Talent',
    matchup: 'Talent',
    lowerthird: 'Break',
    rotator: 'Rotators',
    bracket: 'Bracket',
    hitvisualizer: 'Hit Visualizer',
    // The two full-canvas end-of-game callouts. Unlabelled they fell through to
    // the raw folder name — a shelf reading "postgame", sorted last because an
    // unlisted group ranks after every named one, holding two of the elements a
    // producer reaches for every single game.
    postgame: 'Post-game',
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
    'Scoreboard', 'Shared containers', 'Talent', 'Break',
    'Rotators', 'Event Header', 'Schedule', 'Hit Visualizer', 'Post-game',
    'Bracket', 'Controller', 'Other',
];
/*
 * Within a shelf, the CARDS lead: the Scoreboard shelf holds the scoreboard,
 * the scorecard and everything per side from the same folder, and in catalog
 * (file) order it opened on Player Name with the scoreboard itself at the
 * bottom. Stable, so everything else keeps the catalog's order.
 */
const LEAD_TYPES = ['scoreboard', 'scorecard'];
const rowRank = (l) => {
    const at = LEAD_TYPES.indexOf(l.type);
    return at < 0 ? LEAD_TYPES.length : at;
};

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
 * The OTHER boards a row is going in on, as the row states them: "2", "2, 3".
 *
 * The tab already says the board the row's own box answers for, so this is
 * only what is out of sight — a pick made on another tab. A single-board rig
 * gets nothing, because there is no other board.
 */
export function boardsNote(layout, picked, boards, active) {
    if (!picked?.size || boards.length < 2 || !picksBoard(layout)) return '';
    return [...picked]
        .filter(b => b != null && b !== active)
        .sort((a, b) => a - b)
        .join(', ');
}

/*
 * Which board a scene is ABOUT — the one whose sources it already holds most
 * of, so the picker opens on the tab the producer was most likely going to
 * click. Only an explicit `?scoreboard=` counts: a board-less source (a lower
 * third) says nothing about a board, and reading it as board 1's through the
 * documented default would pull every scene toward board 1. No evidence, or a
 * board no longer on the rig, falls back to the rig's first board.
 */
export function sceneBoard(items, boards) {
    const counts = new Map();
    for (const it of items ?? []) {
        if (!it?.url || !/[?&]scoreboard=/.test(it.url)) continue;
        const b = boardOfUrl(it.url);
        if (b != null && boards.includes(b)) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    let best = boards[0] ?? 1;
    let most = 0;
    for (const b of boards) {
        if ((counts.get(b) ?? 0) > most) { best = b; most = counts.get(b); }
    }
    return best;
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
const PickerPreview = memo(function PickerPreview({ layout, board, boardLabel, boards }) {
    const { mode } = useSideLabels();
    const [fit, setFit] = useState(null);
    const onFit = useCallback((f) => {
        setFit(prev => (prev && prev.w === f.w && prev.scale === f.scale ? prev : f));
    }, []);

    const boardScoped = !!layout && isBoardScoped(layout);
    // Whether the board this previews has a game to show (see pickerPreviewUrl).
    const live = useStateStore(s => {
        if (!boardScoped) return false;
        const p = s?.score?.[board ?? 1]?.player;
        return !!(p?.[1]?.rioName || p?.[2]?.rioName);
    });
    const src = layout ? pickerPreviewUrl(layout, board, { live }) : null;
    const askBoards = !!layout && picksBoard(layout) && boards.length > 1;
    const detail = askBoards && board != null ? ` · ${boardLabel(board)}` : '';

    return (
        <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden">
            <div className="flex items-baseline gap-2">
                <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">
                    {layout ? `${rowLabel(layout, mode)}${detail}` : 'Preview'}
                </Text>
                {layout && (
                    <SimpleTooltip label={live
                        ? 'Drawing the game on this board right now — your logos and names included'
                        : 'No game on this board, so the preview draws sample data'}
                    >
                        <Text size="xs" span dimmed className="shrink-0">
                            {live ? 'live' : 'sample'}
                        </Text>
                    </SimpleTooltip>
                )}
                {layout && fit && (
                    <SimpleTooltip label="Source size in OBS, and how far down the preview is scaled">
                        <Text size="xs" span dimmed className="tabular-nums">
                            {fit.nativeW} × {fit.nativeH}
                            <span className="opacity-60"> · {Math.round(fit.scale * 100)}%</span>
                        </Text>
                    </SimpleTooltip>
                )}
            </div>

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
                        title={`${rowLabel(layout, mode)} preview`}
                        className="absolute inset-0"
                    />
                ) : (
                    <Text size="xs" dimmed className="px-4 text-center">
                        Click an overlay to see it here.
                    </Text>
                )}
            </div>

            <Text size="xs" dimmed>
                {!src
                    ? 'A board with a game previews that game; anything else draws sample data.'
                    : live
                        ? `Live — drawing the game on ${boardLabel(board ?? 1)} right now.`
                        : 'Sample data — this is how it draws with no game running.'}
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
 * batch. The checkbox is the whole of "this goes in", for the board the tab
 * names; picks on other boards are STATED on the row ("also 2"), not
 * controlled from it.
 *
 * A PER-SIDE PAIR IS ONE ROW (`pairRows`). Stat Bar, Roster, Player Name, Team
 * Logo, Stat Card and Controller each come as a side 1 and a side 2 source, and
 * a producer almost always wants both — two rows each was six rows of a board's
 * list spent on a question with one usual answer. So the row's box takes BOTH
 * sides (mixed while only one is in), and a toggle per side, at the end of the
 * row (shown on hover, on the previewed row, and while one side alone is
 * in), is how one side alone goes in. Picks stay per side underneath — each
 * side is its own source, name and URL — so adding, naming and the tray are
 * untouched. The toggle also previews its side, which is how the preview is
 * pointed at side 2.
 *
 * `picked` and `inScene` are per-member MASKS ("10" = side 1 only) rather than
 * arrays, so the row's memo holds across renders.
 */
const CatalogRow = memo(function CatalogRow({
    row, focusUrl, picked, boardsNote, inScene, onFocus, onToggleRow, onToggleSide,
}) {
    const { mode } = useSideLabels();
    const { lead, members } = row;
    const pair = members.length > 1;
    const label = pair ? (lead.parentName || lead.name) : rowLabel(lead, mode);
    const focused = focusUrl != null;
    const all = !picked.includes('0');
    const some = picked.includes('1');
    const allInScene = !inScene.includes('0');
    // A pair with ONE side already here says which, in words — a mark that
    // needs a legend is not one a producer reads mid-setup.
    const partInScene = pair && !allInScene && inScene.includes('1')
        ? `${sideLabel(members[inScene.indexOf('1')].team, mode)} in scene`
        : '';
    // The side toggles are there when they are the question: on hover, on the
    // row being previewed, and while only one side is in (so the row says
    // which). At rest a pair reads like any other row.
    const showSides = focused || (some && !all);

    return (
        <div
            data-row={row.key}
            className={cn(
                'group/row flex h-8 items-center rounded-md pr-1 transition-colors',
                focused ? 'bg-secondary/70' : 'hover:bg-secondary/40',
            )}
        >
            <button
                type="button"
                role="checkbox"
                aria-checked={all ? true : (some ? 'mixed' : false)}
                aria-label={`Select ${label}`}
                onClick={() => onToggleRow(row)}
                className="grid h-8 w-7 shrink-0 place-content-center rounded-md"
            >
                {/* MEASURED, not eyeballed: `border-input` is rgb(26,26,46) on
                    this dialog's rgb(7,7,11), which is 1.18:1 — a boundary WCAG
                    wants at 3:1, and the reason an unticked box read as ruling
                    rather than as a control. `muted-foreground/70` lands ~3.6:1
                    and still sits well under a ticked one. */}
                <span
                    aria-hidden="true"
                    className={cn(
                        'grid size-4 place-content-center rounded-[4px] border transition-colors',
                        some
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/70 group-hover/row:border-primary',
                    )}
                >
                    {all && <Check size={11} strokeWidth={3} />}
                    {some && !all && <Minus size={11} strokeWidth={3} />}
                </span>
            </button>

            {/* LOOK, THEN CHOOSE — on one target.

                The first click on a row previews it and selects nothing:
                browsing the catalog is what a producer does most in here and it
                must not quietly build a batch. The SECOND click on the row
                already being previewed selects it (both sides, on a pair),
                because by then the producer has seen the thing and the click is
                a deliberate repeat, not a browse. It is the same two beats the
                keyboard has (↑↓ look, ⏎ choose).

                Deselect is the same second click, and it keeps the preview —
                focus and check stay different questions. */}
            <button
                type="button"
                onClick={() => (focused ? onToggleRow(row) : onFocus(lead))}
                aria-label={focused
                    ? `${all ? 'Deselect' : 'Select'} ${label}`
                    : `Preview ${label}`}
                className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-1 text-left"
            >
                {/* Dimmed when the board already has it here: the list's job
                    on a board tab is to show what that board still NEEDS, and
                    the rows it has should recede, not vanish. */}
                <Text
                    size="xs" span truncate
                    className={cn('min-w-0 flex-1', allInScene && !some ? 'text-muted-foreground' : 'text-foreground')}
                >
                    {label}
                </Text>
                {/* The OTHER boards this row is going in on — picks made on a
                    tab that is out of sight, stated where the list can see
                    them. */}
                {boardsNote && (
                    <Text size="xs" span className="shrink-0 tabular-nums text-primary">
                        also {boardsNote}
                    </Text>
                )}
                {/* Already a source in this scene. Not a block — a producer may
                    genuinely want two — but adding a duplicate by accident and
                    finding it in OBS an hour later is the failure this
                    prevents. On a pair, a side that is in on its own is marked
                    on its chip instead. */}
                {(allInScene || partInScene) && (
                    <Text size="xs" span dimmed className="shrink-0">
                        {partInScene || 'in scene'}
                    </Text>
                )}
            </button>

            {/* One toggle per side: that side alone, in or out — and
                previewed, since a producer choosing one side wants to see it.
                Plain text, not chips: a column of bordered boxes on every pair
                read as a wall of badges. `invisible` rather than unmounted, so
                the space is held and nothing on the row moves on hover. Named
                in the producer's side words, never a bare digit, which on this
                dialog would read as a board. */}
            {pair && (
                <div
                    className={cn(
                        'flex shrink-0 items-center gap-0.5 pl-1',
                        showSides
                            ? 'visible'
                            : 'invisible group-hover/row:visible group-focus-within/row:visible',
                    )}
                >
                    {members.map((m, i) => {
                        const on = picked[i] === '1';
                        return (
                            <button
                                key={m.url}
                                type="button"
                                role="checkbox"
                                aria-checked={on}
                                aria-label={`Select ${rowLabel(m, mode)}`}
                                onClick={() => onToggleSide(m)}
                                className={cn(
                                    'flex h-6 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] leading-none transition-colors hover:bg-secondary',
                                    on ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
                                    focusUrl === m.url && !on && 'text-foreground',
                                )}
                            >
                                {on && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                                {sideLabel(m.team, mode)}
                            </button>
                        );
                    })}
                </div>
            )}
            {/* LAST on every row, so the sizes are one column whether or not
                the row holds side toggles. shrink-0: the label is the flexible
                half — without it the dimensions are what the flexbox eats
                first, and "1920×1080" clips to "192", a number that reads as a
                real one. */}
            {lead.width && lead.height && (
                <Text size="xs" span dimmed className="w-[4.75rem] shrink-0 text-right tabular-nums">
                    {lead.width}×{lead.height}
                </Text>
            )}
        </div>
    );
});

/*
 * One board's tab: its NAME, and what is on it — so a producer picks "the one
 * with Alice and Bob on it" rather than remembering which number that was.
 * Its own component for its own store selector: two strings per board, not a
 * subscription to every score key from the dialog.
 */
const BoardTab = memo(function BoardTab({ board, label, active, picked, onPick }) {
    const matchup = useStateStore(s => {
        const p = s?.score?.[board]?.player;
        const a = p?.[1]?.rioName;
        const b = p?.[2]?.rioName;
        return a || b ? `${a || '—'} v ${b || '—'}` : '';
    });
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            onClick={() => onPick(board)}
            className={cn(
                'relative flex h-11 w-52 shrink-0 flex-col items-start justify-center rounded-md border px-2 text-left transition-colors',
                active
                    ? 'border-primary bg-primary/15 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
            )}
        >
            <span className="flex w-full items-center gap-1.5">
                <Text size="xs" span truncate fw={active ? 600 : 500} className="min-w-0 flex-1">
                    {label}
                </Text>
                {/* How many picks this board is carrying — the batch on a tab
                    you are not looking at is otherwise out of sight. */}
                {picked > 0 && (
                    <span
                        title={`${picked} picked for this board`}
                        className="grid h-4 min-w-4 shrink-0 place-content-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
                        {picked}
                    </span>
                )}
            </span>
            <Text size="xs" span truncate dimmed className="w-full text-[10px] leading-tight">
                {matchup || 'no game'}
            </Text>
        </button>
    );
});

/*
 * The board the dialog is FOR — asked once, across the full width above the
 * list and the preview, instead of once per row. Tabs keep a fixed width
 * rather than stretching: two boards across 72rem would be two banners. Never
 * wraps; a rig with more boards than fit scrolls sideways.
 */
const BoardTabs = memo(function BoardTabs({ boards, active, pickCounts, boardLabel, onPick }) {
    return (
        <div
            role="tablist"
            aria-label="Board"
            className="flex shrink-0 gap-1 overflow-x-auto rounded-lg border border-border/60 bg-secondary/20 p-1 [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none' }}
        >
            {boards.map(b => (
                <BoardTab
                    key={b}
                    board={b}
                    label={boardLabel(b)}
                    active={b === active}
                    picked={pickCounts.get(b) ?? 0}
                    onPick={onPick}
                />
            ))}
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
    const { mode: sideMode } = useSideLabels();
    const open = openProp ?? !!scene;
    const { layouts, error } = useLayoutCatalog(open);
    const boards = useActiveBoards();
    const rotating = useRotatingBoards();
    const boardLabel = useBoardLabel();
    const boardTag = useBoardTag();
    const multiBoard = boards.length > 1;
    const [query, setQuery] = useState('');
    // The tab the producer picked; `null` = none yet (see `activeBoard`).
    const [chosenBoard, setChosenBoard] = useState(null);
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
        setChosenBoard(null);
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

    const { items: sceneItems } = useMirrorScene(scene);

    /*
     * The TAB'S board. Until the producer picks a tab it follows the scene
     * (`sceneBoard`) — the mirror is lazy, so the scene's items can land after
     * the dialog opens, and the tab should land with them.
     */
    const activeBoard = chosenBoard != null && boards.includes(chosenBoard)
        ? chosenBoard
        : sceneBoard(sceneItems, boards);

    /*
     * The catalog, filtered. A query matches the ROW or its GROUP, so "talent"
     * and "break" find their whole shelf — the producer's own vocabulary for
     * these is the group heading at least as often as the layout's name.
     */
    const { boardGroups, wideGroups } = useMemo(() => {
        const q = query.toLowerCase().trim();
        // A pair matches if EITHER side's label does, so "side 2" still finds
        // every pair and the chip for that side is right there on it.
        const shelve = (layoutsIn) => {
            const out = new Map();
            for (const row of pairRows(layoutsIn)) {
                const key = GROUP_LABELS[row.lead.group] ?? row.lead.group;
                if (q
                    && !row.members.some(l => rowLabel(l, sideMode).toLowerCase().includes(q))
                    && !key.toLowerCase().includes(q)) continue;
                if (!out.has(key)) out.set(key, []);
                out.get(key).push(row);
            }
            return [...out.entries()]
                .sort(([a], [b]) => groupRank(a) - groupRank(b))
                .map(([label, list]) => [label, [...list].sort((a, b) => rowRank(a.lead) - rowRank(b.lead))]);
        };
        // Containers come from the definitions; the catalog's own shared rows
        // are the same list one round-trip behind, so they are dropped rather
        // than shown twice.
        const rows = [...layouts.filter(l => l.group !== 'shared'), ...containerRows];
        const offered = rows.filter(l => offeredOn(l, activeBoard, rotating));
        // One list on a single-board rig — there is no board to split around.
        if (!multiBoard) return { boardGroups: shelve(offered), wideGroups: [] };
        // The tab's list, then the Show-wide shelf beneath it.
        return {
            boardGroups: shelve(offered.filter(picksBoard)),
            wideGroups: shelve(offered.filter(l => !picksBoard(l))),
        };
    }, [layouts, containerRows, query, sideMode, multiBoard, activeBoard, rotating]);

    // The visible rows in list order — what the arrow keys walk. A pair is ONE
    // stop; its chips are how one side alone is reached.
    const flatRows = useMemo(
        () => [...boardGroups, ...wideGroups].flatMap(([, rows]) => rows),
        [boardGroups, wideGroups],
    );

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
     * asked per render: the rows need it per board.
     */
    const inSceneByUrl = useMemo(() => {
        const m = new Map();
        if (!sceneItems.length) return m;
        for (const l of flatRows.flatMap(r => r.members)) {
            const set = new Set();
            for (const b of (picksBoard(l) ? boards : [null])) {
                const url = overlayUrl(l, b);
                if (sceneItems.some(it => urlsMatch(url, it.url))) set.add(b);
            }
            if (set.size) m.set(l.url, set);
        }
        return m;
    }, [flatRows, sceneItems, boards]);

    // The board a row's own box answers for: the tab's, or none.
    const boardFor = useCallback(
        (layout) => (picksBoard(layout) ? activeBoard : null),
        [activeBoard],
    );
    const pickCounts = useMemo(() => {
        const m = new Map();
        for (const p of picks) if (p.board != null) m.set(p.board, (m.get(p.board) ?? 0) + 1);
        return m;
    }, [picks]);

    /*
     * Ticking the box: the row goes in FOR THE TAB'S BOARD (or for none, if it
     * reads no board). Unticking takes back only that board's pick — each tab
     * is its own question, and a pick on another board is still stated on the
     * row ("also 2") and in the tray, so what stays behind is never hidden.
     */
    const onToggle = useCallback((layout) => {
        const board = boardFor(layout);
        const key = pickKey(layout, board);
        setPicks(prev => (prev.some(p => pickKey(p.layout, p.board) === key)
            ? prev.filter(p => pickKey(p.layout, p.board) !== key)
            : [...prev, { layout, board }]));
        // Selecting previews too — you should be able to see what you just
        // agreed to put on the broadcast.
        setFocus(layout);
    }, [boardFor]);

    /*
     * A ROW's box: every member in, for the tab's board — or, when all of
     * them already are, every member out. On a pair that is "both sides",
     * which is the usual answer; the chips take one side alone.
     */
    const onToggleRow = useCallback((row) => {
        const board = boardFor(row.lead);
        setPicks((prev) => {
            const has = (l) => prev.some(p => pickKey(p.layout, p.board) === pickKey(l, board));
            if (row.members.every(has)) {
                const drop = new Set(row.members.map(l => pickKey(l, board)));
                return prev.filter(p => !drop.has(pickKey(p.layout, p.board)));
            }
            return [...prev, ...row.members.filter(l => !has(l)).map(layout => ({ layout, board }))];
        });
        // Keep previewing the side already in view, if it is one of these.
        setFocus(f => (f && row.members.some(m => m.url === f.url) ? f : row.lead));
    }, [boardFor]);

    // The row that holds a layout — how the focused SIDE finds its row.
    const rowOfUrl = useMemo(() => {
        const m = new Map();
        for (const r of flatRows) for (const l of r.members) m.set(l.url, r);
        return m;
    }, [flatRows]);

    /*
     * The tray, folded the way the list is: both sides of a pair picked for
     * the same board are one chip ("Stat Bar · B2") whose × takes both; a
     * side picked alone keeps its side in the name. In pick order.
     */
    const trayChips = useMemo(() => {
        const chips = [];
        const byPair = new Map();
        for (const p of picks) {
            const k = pairKeyOf(p.layout);
            const slot = k != null ? `${k}#${p.board ?? ''}` : null;
            const chip = slot != null ? byPair.get(slot) : null;
            if (chip) { chip.keys.push(pickKey(p.layout, p.board)); continue; }
            const next = { key: pickKey(p.layout, p.board), lead: p, keys: [pickKey(p.layout, p.board)] };
            if (slot != null) byPair.set(slot, next);
            chips.push(next);
        }
        return chips.map(c => ({
            ...c,
            name: c.keys.length > 1
                ? (c.lead.layout.parentName || c.lead.layout.name)
                : rowLabel(c.lead.layout, sideMode),
        }));
    }, [picks, sideMode]);

    const removePick = useCallback((key) => {
        setPicks(prev => prev.filter(p => pickKey(p.layout, p.board) !== key));
    }, []);

    // A tray chip takes the list back to the tab it was picked on, so the pick
    // is seen in the context it was made in.
    const focusPick = useCallback((p) => {
        if (p.board != null) setChosenBoard(p.board);
        setFocus(p.layout);
    }, []);

    // The preview draws the tab's board — the board the producer is building.
    const previewBoard = focus ? boardFor(focus) : null;

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
     * WHY ADD IS GREY, in the one place a producer looks when a button is:
     * previewing a row is not selecting it, so a producer can arrive at a full
     * preview, a named scene and a dead Add with nothing on screen connecting
     * them. The footer states it and the tooltip phrases it as the act, off
     * the one condition.
     */
    const count = picks.length > 1 ? `${picks.length} ` : '';
    const addHint = !scene
        ? 'OBS isn’t connected — copy the URL instead'
        : !picks.length
            ? 'Nothing selected yet — tick a box in the list'
            : `Add to “${scene}”, hidden (${MOD}⏎)`;

    /*
     * Sequential, never parallel: the OBS mirror reconciles one event at a time
     * and a burst of CreateInput races it (and races its own uniqueness check —
     * two "Stat Bar — Team 1" in flight both see the name free).
     *
     * No rollback on partial failure. Deleting sources the producer can see
     * appear is worse than telling them plainly which one didn't make it, so the
     * successes stay, drop out of the selection, and the dialog stays open on
     * what's left to retry.
     */
    const add = async (visible = false) => {
        if (!picks.length) return;
        setAdding(visible ? 'visible' : 'hidden');
        const done = [];
        const failed = [];
        for (const p of picks) {
            try {
                const res = await useObsStore.getState().addBrowserSource({
                    inputName: addName(p.layout, p.board, boards, sideMode),
                    url: overlayUrl(p.layout, p.board),
                    width: p.layout.width,
                    height: p.layout.height,
                    sceneName: scene,
                    enabled: visible,
                });
                done.push({ pick: p, name: res.inputName });
            } catch (e) {
                failed.push({ pick: p, message: e?.message });
            }
        }
        setAdding(false);

        if (!failed.length) {
            const one = done.length === 1;
            notifications.show({
                message: visible
                    ? (one
                        ? `Added “${done[0].name}” to ${scene}, showing.`
                        : `Added ${done.length} sources to ${scene}, all showing.`)
                    : (one
                        ? `Added “${done[0].name}” to ${scene} — hidden. Flip it on when you're ready.`
                        : `Added ${done.length} sources to ${scene} — all hidden. Flip them on when you're ready.`),
                color: 'green',
            });
            onClose();
            return;
        }

        const names = failed.map(f => rowLabel(f.pick.layout, sideMode)).join(', ');
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
        const key = rowOfUrl.get(focus.url)?.key ?? focus.url;
        const el = listRef.current.querySelector(`[data-row="${key}"]`);
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [focus, rowOfUrl]);

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
            const at = focus ? flatRows.indexOf(rowOfUrl.get(focus.url)) : -1;
            const next = e.key === 'ArrowDown'
                ? Math.min(at + 1, flatRows.length - 1)
                : (at < 0 ? flatRows.length - 1 : Math.max(at - 1, 0));
            setFocus(flatRows[next].lead);
            return;
        }
        if (tag === 'BUTTON') return;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            if (scene && picks.length && !adding) { e.preventDefault(); add(false); }
            return;
        }
        if ((e.key === 'Enter' || (e.key === ' ' && !typing)) && focus) {
            const row = rowOfUrl.get(focus.url);
            if (!row) return;
            e.preventDefault();
            onToggleRow(row);
        }
    };

    const renderShelves = (shelves) => shelves.map(([label, rows]) => (
        <div key={label} className="flex flex-col">
            <div className="flex items-baseline gap-2 px-1 pb-0.5">
                <Text size="xs" span className="label-display min-w-0 flex-1 tracking-wider text-muted-foreground">
                    {label}
                </Text>
                {/* Building a container belongs with the containers, not in a
                    settings page: it is only ever done in order to put one in
                    a scene. */}
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
            {rows.map((row) => {
                const board = boardFor(row.lead);
                const pickedOf = (l) => pickedByUrl.get(l.url) ?? EMPTY_SET;
                // Other boards across every side of the row, as one note.
                const others = new Set(row.members.flatMap(l => [...pickedOf(l)]));
                return (
                    <CatalogRow
                        key={row.key}
                        row={row}
                        focusUrl={row.members.find(l => l.url === focus?.url)?.url ?? null}
                        picked={row.members.map(l => (pickedOf(l).has(board) ? '1' : '0')).join('')}
                        boardsNote={boardsNote(row.lead, others, boards, board)}
                        inScene={row.members
                            .map(l => (inSceneByUrl.get(l.url)?.has(board) ? '1' : '0')).join('')}
                        onFocus={setFocus}
                        onToggleRow={onToggleRow}
                        onToggleSide={onToggle}
                    />
                );
            })}
        </div>
    ));

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
                            ? 'Click an overlay to preview it, again to select it — or '
                              + `↑↓ to preview, ⏎ to select, ${MOD}⏎ to add hidden.`
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
                    {/* The board this dialog is FOR, across the whole width:
                        it scopes the list AND the preview, so it sits above
                        both rather than inside either one. */}
                    {multiBoard && (
                        <BoardTabs
                            boards={boards}
                            active={activeBoard}
                            pickCounts={pickCounts}
                            boardLabel={boardLabel}
                            onPick={setChosenBoard}
                        />
                    )}
                    <div className="grid min-h-0 grid-cols-[21rem_minmax(0,1fr)] gap-4">
                        <div className="flex min-w-0 flex-col gap-2">
                            <div className="relative">
                                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search overlays…" className="pl-7"
                                />
                            </div>

                            {/* A plain scroll container, kept for the explicit
                                height and the measuring ref below. It sidesteps
                                the trap the kit's ScrollArea used to carry:
                                Radix wraps its viewport's children in a
                                shrink-to-fit `display: table` so a list CAN
                                scroll sideways, and a row's `truncate` label is
                                `white-space: nowrap` — so the table sized to the
                                longest full name, the rows ran past the pane,
                                and the dimensions on the right got sliced
                                ("1920×1080" reading as "192"). The kit forces
                                that wrapper back to `block` now (see
                                components/ui/scroll-area.jsx); either way what a
                                truncating label needs is a box with the pane's
                                definite width. */}
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
                                    {!error && !flatRows.length && (
                                        <Text size="xs" dimmed>
                                            {layouts.length ? 'Nothing matches that.' : 'Reading the layout catalog…'}
                                        </Text>
                                    )}
                                    {renderShelves(boardGroups)}
                                    {/* Show-wide: what reads no board, the
                                        same under every tab. A rule rather
                                        than a heading, because the shelves
                                        below keep their own headings. */}
                                    {wideGroups.length > 0 && (
                                        <div className="flex items-center gap-2 px-1 pt-1">
                                            <span className="h-px flex-1 bg-border" />
                                            <Text size="xs" span dimmed className="shrink-0">
                                                show-wide · not tied to a board
                                            </Text>
                                            <span className="h-px flex-1 bg-border" />
                                        </div>
                                    )}
                                    {renderShelves(wideGroups)}
                                </div>
                                )}
                            </div>
                        </div>

                        <PickerPreview
                            layout={focus}
                            board={previewBoard}
                            boardLabel={boardLabel}
                            boards={boards}
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
                                {picks.length
                                    ? `${picks.length} selected`
                                    : 'Nothing selected yet — tick a box to add it.'}
                            </Text>
                            {/* The scrollbar is hidden, not absent: a 6px-tall
                                track inside a 24px strip lands on top of the
                                chips it is supposed to help with. The ribbon
                                still scrolls by wheel, trackpad and keyboard. */}
                            <div
                                className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
                                style={{ scrollbarWidth: 'none' }}
                            >
                                {trayChips.map(({ key, lead: p, keys, name }) => {
                                    const label = name
                                        + (p.board != null && multiBoard
                                            ? ` · ${boardTag(p.board)}` : '');
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
                                                onClick={() => focusPick(p)}
                                                className="whitespace-nowrap text-[10px] leading-none text-foreground"
                                            >
                                                {label}
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Remove ${label}`}
                                                onClick={() => keys.forEach(removePick)}
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
                            {/* The two Adds are the one slot that needs OBS:
                                they create a browser source in a scene. Both
                                hold their place and go honestly grey rather
                                than vanishing — same rule as the source strip's
                                Push slot — and both carry the same `addHint`,
                                because what stands in the way of one stands in
                                the way of the other.

                                Visible is the OUTLINE half and hidden keeps the
                                filled one: hidden is the answer that is never
                                wrong, so it stays the default weight and the
                                one ⌘⏎ commits. `() => add(...)` and not a bare
                                handler — a click handler is called with the
                                EVENT, and an event is truthy, so `onClick={add}`
                                on a defaulted flag adds visible every time. */}
                            <SimpleTooltip label={addHint}>
                                <span>
                                    <Button
                                        size="sm" variant="outline"
                                        disabled={!scene || !picks.length || !!adding}
                                        onClick={() => add(true)}
                                    >
                                        <Eye size={13} className="mr-1" />
                                        {adding === 'visible'
                                            ? 'Adding…'
                                            : `Add ${count}visible`}
                                    </Button>
                                </span>
                            </SimpleTooltip>
                            <SimpleTooltip label={addHint}>
                                <span>
                                    <Button
                                        size="sm"
                                        disabled={!scene || !picks.length || !!adding}
                                        onClick={() => add(false)}
                                    >
                                        <Plus size={13} className="mr-1" />
                                        {adding === 'hidden'
                                            ? 'Adding…'
                                            : `Add ${count}hidden`}
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

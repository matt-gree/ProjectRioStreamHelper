import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Copy, Check } from 'lucide-react';
import { useObsStore } from '../../context/obs';
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
 * sources from one catalog row, which is exactly why the board control is on the
 * row (as per-board chips) and not in the footer. A row click still checks and
 * previews in one go, so the one-element case costs no more than it used to.
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
// row different from its siblings (size / team / direction).
export const rowLabel = (l) => {
    const variant = l.sizeLabel || (l.team ? `Team ${l.team}` : '') || l.dirLabel || '';
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
    scenes: 'Full scenes',
    hitvisualizer: 'Hit Visualizer',
    schedule: 'Schedule',
    eventheader: 'Event Header',
    controller: 'Controller',
    ungrouped: 'Other',
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

/*
 * The catalog list's height, in px, and the preview's ceiling — the SAME
 * number on purpose.
 *
 * The preview shapes its own box from the layout's aspect (a 16:9 scene gets a
 * 16:9 frame; a tall split-screen gets a tall one), which is what makes the
 * checkerboard read as the source's actual bounds rather than a window it
 * floats in. Left to itself that would resize the dialog every time the
 * producer moved down the list. Capping it at the list's height means the list
 * is always the taller column, so the dialog's height never moves.
 */
const PANE_HEIGHT = 416;
const PREVIEW_MIN_HEIGHT = 140;

/*
 * The preview pane — the real overlay in an iframe, drawn against its own sample
 * bundle, at the size OBS will give it.
 *
 * ScaledIframe owns the box: it derives the height from the width and the
 * layout's own aspect (`minHeight`/`maxHeight`), so a 16:9 scene gets a 16:9
 * frame and an 800×460 band gets a letterbox. Nothing here is zoomed or
 * transformed, and nothing else is allowed to compute that height — two
 * authorities on one dimension is the oscillation the stage preview documents.
 */
const PickerPreview = memo(function PickerPreview({ layout, board, boardLabel, boards }) {
    const [fit, setFit] = useState(null);
    const onFit = useCallback((f) => {
        setFit(prev => (prev && prev.w === f.w && prev.scale === f.scale ? prev : f));
    }, []);

    const src = layout ? pickerPreviewUrl(layout, board) : null;
    const detail = layout && isBoardScoped(layout) && board != null && boards.length > 1
        ? ` · ${boardLabel(board)}`
        : '';

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

            {/* Checkerboard: overlays are authored on transparency, and a flat
                backdrop makes a fully-transparent overlay indistinguishable from
                one that failed to load. It wraps the render's own box, so its
                edges are the source's edges. */}
            <div
                className="w-full overflow-hidden rounded-md border border-border/60"
                style={{
                    height: src ? undefined : PREVIEW_MIN_HEIGHT,
                    backgroundColor: '#15151c',
                    backgroundImage:
                        'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%),'
                        + 'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 8px 8px',
                }}
            >
                {src ? (
                    <ScaledIframe
                        key={src}
                        src={src}
                        nativeWidth={nativeW(layout)}
                        nativeHeight={nativeH(layout)}
                        minHeight={PREVIEW_MIN_HEIGHT}
                        maxHeight={PANE_HEIGHT}
                        onFit={onFit}
                        title={`${rowLabel(layout)} preview`}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center px-4">
                        <Text size="xs" dimmed className="text-center">
                            Pick an overlay to see it here.
                        </Text>
                    </div>
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
 * One catalog row.
 *
 * Two shapes, decided by whether the row can be picked more than one way:
 *   • a plain row gets a checkbox — one pick, one state;
 *   • a board-scoped row on a MULTI-BOARD rig gets a board chip each, because
 *     the same row is genuinely several sources. The chips ARE its check state;
 *     a checkbox beside them would be a third reading of the same fact and
 *     would go ambiguous the moment only board 2 was picked.
 * A single-board rig never sees chips: there is no choice to make, so it isn't
 * asked (the pick still carries board 1, exactly as before).
 *
 * Clicking the row body checks/unchecks the primary board AND focuses the
 * preview, so the fast path stays one click per element. Clicking a checked row
 * unchecks it but leaves it previewed — focus and check are different questions.
 */
const CatalogRow = memo(function CatalogRow({
    layout, boards, boardLabel, focused, pickedBoards, onToggle,
}) {
    const scoped = isBoardScoped(layout);
    const chips = scoped && boards.length > 1;
    const primary = scoped ? (boards[0] ?? 1) : null;
    const picked = pickedBoards.size > 0;
    const label = rowLabel(layout);

    return (
        <div
            className={cn(
                'flex h-8 items-center gap-1 rounded-md pr-1 transition-colors',
                focused ? 'bg-secondary/70' : 'hover:bg-secondary/40',
            )}
        >
            <button
                type="button"
                onClick={() => onToggle(layout, primary)}
                aria-pressed={chips ? undefined : picked}
                className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left"
            >
                {!chips && (
                    <span
                        aria-hidden="true"
                        className={cn(
                            'grid size-3.5 shrink-0 place-content-center rounded-[4px] border',
                            picked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input',
                        )}
                    >
                        {picked && <Check size={10} strokeWidth={3} />}
                    </span>
                )}
                <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">
                    {label}
                </Text>
                {/* shrink-0: the label is the flexible half. Without it the
                    dimensions are what the flexbox eats first, and "1920×1080"
                    clips to "192" — a number that reads as a real one.
                    Dropped entirely on a chipped row: a five-board rig spends
                    that width on chips, and squeezing both leaves "Scoreboard
                    —…" three times over, which is the one thing the row has to
                    tell apart. The size is still stated — once, authoritatively
                    — in the preview header. */}
                {!chips && layout.width && layout.height && (
                    <Text size="xs" span dimmed className="shrink-0 tabular-nums">
                        {layout.width}×{layout.height}
                    </Text>
                )}
            </button>

            {chips && boards.map(b => (
                <button
                    key={b}
                    type="button"
                    onClick={() => onToggle(layout, b)}
                    aria-pressed={pickedBoards.has(b)}
                    aria-label={`${label} on ${boardLabel(b)}`}
                    className={cn(
                        'h-5 min-w-5 shrink-0 rounded border px-1 text-[10px] leading-none tabular-nums transition-colors',
                        pickedBoards.has(b)
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                >
                    {b}
                </button>
            ))}
        </div>
    );
});

export const AddSourceDialog = memo(function AddSourceDialog({ scene, onClose }) {
    const open = !!scene;
    const { layouts, error } = useLayoutCatalog(open);
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();
    const [query, setQuery] = useState('');
    // Ordered picks, so a batch is added in the order the producer built it.
    const [picks, setPicks] = useState([]);
    // What the preview is showing — independent of what's checked.
    const [focus, setFocus] = useState(null);
    const [adding, setAdding] = useState(false);

    // Every open is a fresh transaction — a picker that remembers last time's
    // selection is one the producer has to check before clicking Add.
    useEffect(() => {
        if (!open) return;
        setQuery('');
        setPicks([]);
        setFocus(null);
    }, [open]);

    const groups = useMemo(() => {
        const q = query.toLowerCase().trim();
        const out = new Map();
        for (const l of layouts) {
            if (q && !rowLabel(l).toLowerCase().includes(q)) continue;
            const key = GROUP_LABELS[l.group] ?? l.group;
            if (!out.has(key)) out.set(key, []);
            out.get(key).push(l);
        }
        return [...out.entries()];
    }, [layouts, query]);

    // url → the set of boards picked from that row, for the chips and the check.
    const pickedByUrl = useMemo(() => {
        const m = new Map();
        for (const p of picks) {
            if (!m.has(p.layout.url)) m.set(p.layout.url, new Set());
            m.get(p.layout.url).add(p.board);
        }
        return m;
    }, [picks]);

    const onToggle = useCallback((layout, board) => {
        const key = pickKey(layout, board);
        setPicks(prev => (prev.some(p => pickKey(p.layout, p.board) === key)
            ? prev.filter(p => pickKey(p.layout, p.board) !== key)
            : [...prev, { layout, board }]));
        // Focus follows the click either way: unchecking is not a reason to
        // stop showing what you were just looking at.
        setFocus({ layout, board });
    }, []);

    /*
     * Copy follows the SELECTION — several picks copy as one URL per line, which
     * is what a dual-machine producer pastes into a column of browser sources.
     * With nothing checked it falls back to whatever is previewed, so "look at
     * this one, take its URL" doesn't require checking a box first.
     */
    const copyValue = useMemo(() => {
        if (picks.length) return picks.map(p => overlayUrl(p.layout, p.board)).join('\n');
        return focus ? overlayUrl(focus.layout, focus.board) : '';
    }, [picks, focus]);

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

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle className="label-display">Add to “{scene}”</DialogTitle>
                    <DialogDescription>
                        Pick as many as you like — they all go in hidden, and you turn them on
                        from the rack.
                    </DialogDescription>
                </DialogHeader>

                <Stack gap="sm">
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
                                className="overflow-y-auto overflow-x-hidden"
                                style={{ height: PANE_HEIGHT }}
                            >
                                <div className="flex flex-col gap-2 pr-2">
                                    {error && <Text size="xs" className="text-destructive">{error}</Text>}
                                    {!error && !groups.length && (
                                        <Text size="xs" dimmed>
                                            {layouts.length ? 'Nothing matches that.' : 'Reading the layout catalog…'}
                                        </Text>
                                    )}
                                    {groups.map(([label, rows]) => (
                                        <div key={label} className="flex flex-col">
                                            <Text size="xs" span className="label-display px-1 pb-0.5 tracking-wider text-muted-foreground">
                                                {label}
                                            </Text>
                                            {rows.map(l => (
                                                <CatalogRow
                                                    key={l.url}
                                                    layout={l}
                                                    boards={boards}
                                                    boardLabel={boardLabel}
                                                    focused={focus?.layout?.url === l.url}
                                                    pickedBoards={pickedByUrl.get(l.url) ?? EMPTY_SET}
                                                    onToggle={onToggle}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <PickerPreview
                            layout={focus?.layout ?? null}
                            board={focus?.board ?? null}
                            boardLabel={boardLabel}
                            boards={boards}
                        />
                    </div>

                    <Group gap="sm" className="items-center justify-between border-t border-border/60 pt-2">
                        <Text size="xs" dimmed>
                            {picks.length
                                ? `${picks.length} selected`
                                : 'Nothing selected yet.'}
                        </Text>
                        <Group gap="xs">
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
                            <Button size="sm" disabled={!picks.length || adding} onClick={add}>
                                <Plus size={13} className="mr-1" />
                                {adding
                                    ? 'Adding…'
                                    : `Add ${picks.length > 1 ? `${picks.length} ` : ''}hidden`}
                            </Button>
                        </Group>
                    </Group>
                </Stack>
            </DialogContent>
        </Dialog>
    );
});

export default AddSourceDialog;

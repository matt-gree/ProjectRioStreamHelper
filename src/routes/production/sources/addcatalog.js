import { useEffect, useState } from 'react';
import { boardOfUrl } from '../../../lib/obs-binding';
import { ELEMENTS, readsBoard } from '../elements';
import { withBoard } from './sourcename';
import { sideLabel } from '../sides';

// The Add picker's catalog logic: which rows a scene is offered,
// how they are keyed, labelled, ranked and grouped, and which board they read
// (./addsource draws them), plus the one fetch that loads the catalog.

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
export const pairKeyOf = (l) => (l.team
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
export function useLayoutCatalog(open) {
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

export const GROUP_LABELS = {
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

export const rowRank = (l) => {
    const at = LEAD_TYPES.indexOf(l.type);
    return at < 0 ? LEAD_TYPES.length : at;
};

export const groupRank = (label) => {
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
export const nativeW = (l) => l?.width || 1920;

export const nativeH = (l) => l?.height || 1080;

// Stable identity — a fresh Set per render would defeat CatalogRow's memo.
export const EMPTY_SET = new Set();

// The commit chord, written the way the producer's own keyboard says it.
export const MOD = typeof navigator !== 'undefined'
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

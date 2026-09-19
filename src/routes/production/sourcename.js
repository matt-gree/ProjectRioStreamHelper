import { ELEMENTS, readsBoard } from './elements';
import { variantLabelFor, variantOf } from './instances';
import { boardOfUrl } from '../../lib/obs-binding';

/*
 * WHAT PRSH CALLS AN OBS SOURCE — one function, derived from the URL.
 *
 * Three places created sources and each named them its own way: the Add picker
 * ("Stat Bar — Side 1 1"), Bind ("Scoreboard Large 2") and nothing at all when
 * the board changed. The trailing bare number was the worst of it: beside a side
 * label it reads as part of the side ("Side 1 1"), and a rename that swapped "the
 * last number" could just as well rewrite the SIDE.
 *
 * So the board is written as a word — `Stat Bar — Side 1 (Board 2)` — and only on
 * a multi-board rig, where it is the thing that tells two sources apart. The name
 * is a function of the URL, which is what lets it FOLLOW the URL: when a board
 * switch or a producer's own edit in OBS changes what a source reads, a name PRSH
 * gave it is rewritten to match (`renameForUrl`), and a name the producer gave it
 * is never touched.
 */

const boardSuffix = (board) => ` (Board ${board})`;

// A base name with its board written in — on a multi-board rig only. The Add
// picker names from its catalog label; this is the half it shares.
export const withBoard = (base, board, boards) =>
    (board != null && boards.length > 1 ? `${base}${boardSuffix(board)}` : base);

const elementOfUrl = (url) => ELEMENTS.find(el => el.match(url || '')) ?? null;

// The name without its board: the element plus what makes this variant different
// (size, side), in the producer's side vocabulary.
function baseName(element, variant, mode) {
    const label = variantLabelFor(element, variant, mode);
    return label ? `${element.name} — ${label}` : element.name;
}

/*
 * The name for a source of `element` at `variant` on `board`. The board is
 * named only on a multi-board rig — on one board it would be a "1" that means
 * nothing — and only for an overlay that reads one.
 */
export function sourceNameFor({ element, variant = '', board = null, boards = [1], mode }) {
    if (!element) return 'PRSH Overlay';
    const base = baseName(element, variant, mode);
    return readsBoard(element) && board != null && boards.length > 1
        ? `${base}${boardSuffix(board)}`
        : base;
}

// The same, straight off a URL. Null for a URL no element answers to.
export function sourceNameForUrl(url, { boards = [1], mode } = {}) {
    const element = elementOfUrl(url);
    if (!element) return null;
    return sourceNameFor({
        element,
        variant: variantOf(url),
        board: readsBoard(element) ? (boardOfUrl(url) ?? 1) : null,
        boards,
        mode,
    });
}

/*
 * The RETIRED names PRSH gave the source at `url`, before the board was a word:
 * a bare trailing board number after the Add picker's label (`Stat Bar — Side
 * 1 1`), and Bind's `Scoreboard Small` / `Scoreboard Small 2`. Bind's plain
 * `Scoreboard` (default size, one board) is deliberately NOT here — it is also
 * the name a producer most plausibly typed themselves.
 */
function retiredNames(url, element, mode) {
    const variant = variantOf(url);
    const board = readsBoard(element) ? (boardOfUrl(url) ?? 1) : null;
    if (board == null) return [];
    const base = baseName(element, variant, mode);
    const out = [`${base} ${board}`];
    const size = element.sizes?.find(s => variant.split('.').includes(`z${s.value}`));
    const bindBase = size ? `${element.name} ${size.label}` : element.name;
    out.push(`${bindBase} ${board}`);
    if (size) out.push(bindBase);
    return out;
}

/*
 * Every name PRSH might have given the source at `url`: today's, with and
 * without the board (the rig may have grown or shrunk since), and the retired
 * forms — which is what lets a source added before this upgrade follow a
 * switch too.
 */
function namesPrshGives(url, mode) {
    const element = elementOfUrl(url);
    if (!element) return [];
    const variant = variantOf(url);
    const board = readsBoard(element) ? (boardOfUrl(url) ?? 1) : null;
    const base = baseName(element, variant, mode);
    const out = [base, ...retiredNames(url, element, mode)];
    if (board != null) out.push(`${base}${boardSuffix(board)}`);
    return out;
}

/*
 * THE ONE-TIME PASS: today's name for a source still wearing a RETIRED one, or
 * null. Only retired forms, never today's: reconciling today's form would
 * rename every source the moment a rig went from two boards to one (dropping
 * "(Board 1)") and back, which is churn nobody asked for. So it is safe to run
 * on every connect — once a source is renamed it no longer matches, and a name
 * the producer typed never did.
 */
export function upgradeRetiredName(name, url, { boards = [1], mode } = {}) {
    const element = elementOfUrl(url);
    if (!element || !name) return null;
    if (!retiredNames(url, element, mode).includes(name)) return null;
    const next = sourceNameForUrl(url, { boards, mode });
    return next && next !== name ? next : null;
}

/*
 * The name a source should carry after its URL changed from `from` to `to` —
 * or null to leave it alone. Only a name PRSH gave it for `from` is replaced;
 * anything else is the producer's.
 */
export function renameForUrl(name, from, to, { boards = [1], mode } = {}) {
    if (!name || !from || !to || from === to) return null;
    if (!namesPrshGives(from, mode).includes(name)) return null;
    const next = sourceNameForUrl(to, { boards, mode });
    return next && next !== name ? next : null;
}

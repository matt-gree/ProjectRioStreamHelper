import { describe, it, expect } from 'vitest';
import { applyCardRail, linescoreColumns, prettyStadium, layoutBox, lineTextBox, layoutStatCells, pinBesideText, applyTextPins } from '../../public/layout/lib/mount-utils.js';

/*
 * Two rules a scoreboard gets wrong SILENTLY — nothing throws, nothing logs, and
 * a preview with the wrong data looks entirely plausible. Both were found on air.
 */

describe('linescoreColumns', () => {
    /* The bug: the feeds hand over the innings that have HAPPENED, so counting
     * those made a live game grow its own table. Four innings into a nine-inning
     * game the board drew four columns — and because the columns divide their
     * band, those four stretched across the full width. */
    it('covers regulation while a game is still being played', () => {
        expect(linescoreColumns(4, 9)).toBe(9);
        expect(linescoreColumns(1, 5)).toBe(5);
    });

    /* The max, not the selected length: a game that runs long has to keep the
     * innings it actually played. */
    it('extends past regulation for extra innings', () => {
        expect(linescoreColumns(6, 5)).toBe(6);
        expect(linescoreColumns(11, 9)).toBe(11);
    });

    /* An older record, or a shape change upstream — fall back to what it played
     * rather than collapsing the table to nothing. */
    it('falls back to the innings played when regulation is unknown', () => {
        expect(linescoreColumns(6, 0)).toBe(6);
        expect(linescoreColumns(6, undefined)).toBe(6);
        expect(linescoreColumns(6, null)).toBe(6);
    });

    /* A board with no game must report NO columns, or `showBox` grows a nine
     * wide band of dashes onto a card that has nothing to say. */
    it('is zero before a single inning has been played', () => {
        expect(linescoreColumns(0, 9)).toBe(0);
        expect(linescoreColumns(0, 0)).toBe(0);
    });
});

describe('prettyStadium', () => {
    /* Title-casing the slug gets six of the seven right and this one wrong. It
     * read "Dk Jungle" on air. */
    it('spells DK Jungle', () => {
        expect(prettyStadium('dk_jungle')).toBe('DK Jungle');
    });

    it('resolves the rest of the closed set', () => {
        expect(prettyStadium('mario_stadium')).toBe('Mario Stadium');
        expect(prettyStadium('peach_garden')).toBe('Peach Garden');
        expect(prettyStadium('toy_field')).toBe('Toy Field');
    });

    /* Both feeds also send real display names straight through. */
    it('leaves a display name alone', () => {
        expect(prettyStadium('DK Jungle')).toBe('DK Jungle');
        expect(prettyStadium('')).toBe('');
    });

    /* An unknown slug must not reach air as a slug. */
    it('still title-cases something it has never seen', () => {
        expect(prettyStadium('future_stadium')).toBe('Future Stadium');
    });
});

/*
 * layoutBox — where the columns go once you know how many there are.
 *
 * Both policies fail SILENTLY and in opposite directions, which is why they are
 * worth pinning rather than eyeballing: SPREAD on an unruled table makes the
 * spacing a function of game length, and SLIDE on a ruled one leaves a hole
 * inside the frame.
 */

// A fake engine: `slots` is all layoutBox touches, and attributes are the
// entire contract, so a bare object per slot is the whole fixture.
function fakeEngine({ pitch = 40, firstX = 84, span = null, total = true, maxInn = 9 } = {}) {
    const mk = (attrs = {}) => ({
        attrs: { ...attrs },
        getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
    });
    const slots = {};
    slots['box-grid'] = mk(span ? { 'data-span-x': span.x, 'data-span-w': span.w } : {});
    if (total) slots['box-total'] = mk();
    for (let i = 1; i <= maxInn; i++) {
        const x = firstX + (i - 1) * pitch;
        slots[`box-h-${i}`] = mk({ x });
        slots[`box-col-${i}`] = mk();
        slots[`box-away-${i}`] = mk({ x });
        slots[`box-home-${i}`] = mk({ x });
    }
    return { slots };
}
const tx = (el) => {
    const m = /translate\((-?[\d.]+),0\)/.exec(el.getAttribute('transform') || '');
    return m ? parseFloat(m[1]) : 0;
};

describe('layoutBox — SLIDE (no band declared)', () => {
    /*
     * The property the Scorecard rests on: a five-inning card must draw the SAME
     * gaps as a nine-inning one. The old first→last span stretched them instead,
     * so a short game drew an 80 pitch beside a dot column still sized for 40.
     */
    it('never changes the pitch, whatever the game length', () => {
        for (const shown of [1, 3, 5, 7, 9]) {
            const e = fakeEngine();
            layoutBox(e, shown, 9);
            // Every column lives inside box-grid, so they share one translate:
            // the authored spacing is carried through untouched.
            const shift = tx(e.slots['box-grid']);
            const col1 = 84 + shift;
            const col2 = 124 + shift;
            expect(col2 - col1, `pitch at ${shown} innings`).toBe(40);
        }
    });

    /*
     * box-total is NESTED inside box-grid, so the two translates COMPOSE: the
     * innings move right by slack/2 and the total's net is slack/2 - slack =
     * -slack/2. Equal and opposite, so the block keeps the centre the theme
     * composed it on — which is the whole reason this is the unruled policy.
     */
    it('keeps the block on its composed centre', () => {
        for (const shown of [1, 5, 9]) {
            const e = fakeEngine();
            layoutBox(e, shown, 9);
            const grid = tx(e.slots['box-grid']);
            const totalNet = grid + tx(e.slots['box-total']);
            expect(grid, `grid at ${shown}`).toBeCloseTo(-totalNet, 6);
        }
    });

    it('is a no-op at full length', () => {
        const e = fakeEngine();
        layoutBox(e, 9, 9);
        expect(tx(e.slots['box-grid'])).toBe(0);
        expect(tx(e.slots['box-total'])).toBe(0);
    });

    it('closes the total onto the last real inning', () => {
        const e = fakeEngine();
        layoutBox(e, 5, 9);
        // 4 unused columns x 40 = 160 of slack, split either way.
        expect(tx(e.slots['box-grid'])).toBe(80);
        expect(tx(e.slots['box-grid']) + tx(e.slots['box-total'])).toBe(-80);
    });

    it('leaves a theme with no grid left-anchored, total still following in', () => {
        const e = fakeEngine();
        delete e.slots['box-grid'];
        layoutBox(e, 5, 9);
        expect(tx(e.slots['box-total'])).toBe(-160);
    });
});

describe('layoutBox — SPREAD (band declared)', () => {
    // The default Scoreboard-L: band 80..512 on an authored 48 pitch.
    const board = (shown) => {
        const e = fakeEngine({ pitch: 48, firstX: 104, span: { x: 80, w: 432 }, total: false });
        layoutBox(e, shown, 9);
        return [...Array(9)].map((_, i) => 104 + i * 48 + tx(e.slots[`box-col-${i + 1}`]));
    };

    it('fills the band at any length', () => {
        for (const shown of [1, 4, 5, 9]) {
            const xs = board(shown).slice(0, shown);
            const cell = 432 / shown;
            expect(xs[0], `first at ${shown}`).toBeCloseTo(80 + cell / 2, 6);
            expect(xs[shown - 1], `last at ${shown}`).toBeCloseTo(512 - cell / 2, 6);
        }
    });

    /*
     * CELLS, NOT ENDPOINTS — the mistake this policy exists to avoid. Pinning
     * the outer columns to the band's edges leaves them hugging the walls while
     * the inner gaps stretch, so five columns read as four gaps, and under a
     * ruled table it puts the outer cells half outside the box.
     */
    it('centres each column in its own share rather than pinning the ends', () => {
        const xs = board(5).slice(0, 5);
        expect(xs[0]).toBeGreaterThan(80);
        expect(xs[4]).toBeLessThan(512);
        const gaps = xs.slice(1).map((x, i) => x - xs[i]);
        for (const g of gaps) expect(g).toBeCloseTo(432 / 5, 6);
    });

    it('reproduces the authored 48 pitch at nine', () => {
        const xs = board(9);
        expect(xs[1] - xs[0]).toBeCloseTo(48, 6);
        expect(xs[0]).toBeCloseTo(104, 6);
    });

    it('leaves a hidden column on its authored x, ready for a longer game', () => {
        const e = fakeEngine({ pitch: 48, firstX: 104, span: { x: 80, w: 432 }, total: false });
        layoutBox(e, 5, 9);
        expect(tx(e.slots['box-col-9'])).toBe(0);
    });
});

describe('layoutBox — refusals', () => {
    it('does nothing without a pitch to read', () => {
        const e = fakeEngine();
        delete e.slots['box-h-2'];
        layoutBox(e, 5, 9);
        expect(tx(e.slots['box-grid'])).toBe(0);
    });

    it('does nothing when the theme declares neither group', () => {
        const e = fakeEngine();
        delete e.slots['box-grid'];
        delete e.slots['box-total'];
        expect(() => layoutBox(e, 5, 9)).not.toThrow();
    });
});

/*
 * lineTextBox — where the stat card's bottom line starts.
 *
 * The bug it ends: the line was CENTRED next to a label pinned at the card's
 * left edge, so it had to reserve the label's width on the far side too and
 * never use it. The Stat Card's own comment recorded the cost — 244 of a
 * possible 340 units — on the one row that carries the longest string on the
 * card, which is why the heaviest game lines rendered at half the size of the
 * numbers above them.
 */
const lineEl = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });
const BAR = { 'data-x-labelled': '56', 'data-x-bare': '12', 'data-maxr': '442' };

describe('lineTextBox', () => {
    it('starts after the label and runs to the right bound', () => {
        expect(lineTextBox(lineEl(BAR), true)).toEqual({ x: 56, maxw: 386 });
    });

    /* The label is bound only for a HUD game's line — an API board's caption
     * IS the line — so a bare line takes the row's full width rather than
     * indenting past a label that isn't there. */
    it('takes the whole row when there is no label', () => {
        expect(lineTextBox(lineEl(BAR), false)).toEqual({ x: 12, maxw: 430 });
    });

    /* The authored labelled edge assumes the theme's own face. In a wider
     * display font the label's measured end passes it, and the line has to
     * start after the label rather than under it — shrinking into what is
     * left, never past the right bound. */
    it('starts after a label wider than the authored edge allowed', () => {
        expect(lineTextBox(lineEl(BAR), true, 70, 7)).toEqual({ x: 77, maxw: 365 });
        // A label that fits leaves the authored edge alone.
        expect(lineTextBox(lineEl(BAR), true, 40, 7)).toEqual({ x: 56, maxw: 386 });
        // ...and a bare line ignores a stale measurement.
        expect(lineTextBox(lineEl(BAR), false, 70, 7)).toEqual({ x: 12, maxw: 430 });
    });

    /* A centred theme (classic's bar, slice26's card) declares none of the
     * three and must keep the geometry it authored. */
    it('declines a theme that declares none of the three', () => {
        expect(lineTextBox(lineEl({ 'data-maxw': '330' }), true)).toBeNull();
    });

    /* ALL OR NOTHING, and that is why both edges are required even though only
     * one of them is ever used. A design tool that drops `data-x-bare` leaves a
     * theme that still answers for the labelled case — so the line would sit
     * left-aligned while a HUD game was on and jump back to centred the moment
     * it ended. Falling back to centred in both states is coherent; switching
     * layout models on a game boundary is not. */
    it('declines a theme missing any one of the three', () => {
        for (const drop of ['data-x-labelled', 'data-x-bare', 'data-maxr']) {
            const attrs = { ...BAR };
            delete attrs[drop];
            expect(lineTextBox(lineEl(attrs), true)).toBeNull();
            expect(lineTextBox(lineEl(attrs), false)).toBeNull();
        }
    });

    it('declines a bound that is left of the start, and a missing slot', () => {
        expect(lineTextBox(lineEl({ ...BAR, 'data-maxr': '40' }), true)).toBeNull();
        expect(lineTextBox(null, true)).toBeNull();
    });
});

/*
 * layoutStatCells — four stats are not four of the same thing.
 *
 * Equal columns gave a two-digit AB the same cell as a ".429", so on the
 * batting set most of the row was air around the smallest number. The band is
 * divided by each category's `width` (RioData.getStatsLine) instead.
 */
function statEngine(row = { 'data-span-x': '64', 'data-span-w': '378' }) {
    const mk = (a) => { const at = { ...a }; return { at, getAttribute: (k) => at[k] ?? null, setAttribute: (k, v) => { at[k] = String(v); } }; };
    const slots = row ? { 'stat-row': mk(row) } : {};
    for (let i = 0; i < 4; i++) {
        slots[`stat-${i}-value`] = mk({ x: '0', 'data-maxw': '92' });
        slots[`stat-${i}-label`] = mk({ x: '0' });
    }
    const invalidated = [];
    return { slots, invalidated, invalidateFit: (el) => invalidated.push(el) };
}
const BATTING = [{ width: 3 }, { width: 5 }, { width: 5 }, { width: 4 }];
const PITCHING = [{ width: 5 }, { width: 4 }, { width: 4 }, { width: 5 }];
const xs = (e) => [0, 1, 2, 3].map((i) => +e.slots[`stat-${i}-value`].at.x);
const maxws = (e) => [0, 1, 2, 3].map((i) => +e.slots[`stat-${i}-value`].at['data-maxw']);

describe('layoutStatCells', () => {
    it('sizes each cell by its category, and they tile the band exactly', () => {
        const e = statEngine();
        layoutStatCells(e, BATTING);
        const cells = BATTING.map((s) => 378 * s.width / 17);
        const want = cells.map((c, i) => 64 + cells.slice(0, i).reduce((a, b) => a + b, 0) + c / 2);
        xs(e).forEach((x, i) => expect(x).toBeCloseTo(want[i], 1));
        // AB's cell is 3/5 of AVG's — the whole point
        expect(maxws(e)[0] / maxws(e)[1]).toBeCloseTo(3 / 5, 2);
        // the label rides its value's centre
        expect(+e.slots['stat-2-label'].at.x).toBe(xs(e)[2]);
    });

    /* The budgets are maxima, so the widest value each category can produce
     * fits at the theme's 30px without auto-fit. Chivo Mono is 0.600em for
     * every glyph, so N characters at 30px are 18N units. */
    it('fits every category\'s widest value at 30px, in both stat sets', () => {
        for (const set of [BATTING, PITCHING]) {
            const e = statEngine();
            layoutStatCells(e, set);
            set.forEach((s, i) => expect(s.width * 18).toBeLessThanOrEqual(maxws(e)[i]));
        }
    });

    /* A cell's bound moved under an unchanged value, so the engine's fit cache
     * — keyed on the TEXT — has to be told, or the old fit sticks. */
    it('invalidates the fit of a value whose bound moved, and only then', () => {
        const e = statEngine();
        layoutStatCells(e, BATTING);
        expect(e.invalidated).toHaveLength(4);
        layoutStatCells(e, BATTING);
        expect(e.invalidated).toHaveLength(4);      // same set, nothing moved
        layoutStatCells(e, PITCHING);
        expect(e.invalidated.length).toBeGreaterThan(4);
    });

    /* A ruled grid (the Stat Card's 2x2, the scoreboard's live block) cannot
     * move a cell without its divider, so it declares no band and keeps its
     * authored columns. */
    it('leaves a theme with no band alone', () => {
        for (const row of [null, { 'data-span-x': '64' }, { 'data-span-w': '378' }]) {
            const e = statEngine(row);
            layoutStatCells(e, BATTING);
            expect(xs(e)).toEqual([0, 0, 0, 0]);
            expect(maxws(e)).toEqual([92, 92, 92, 92]);
        }
    });
});


/*
 * pinBesideText — a portrait beside a name, where the name's width IS the data.
 *
 * The matchup band proved both fixed-x alternatives wrong on air: portrait
 * outside and "Joan" left her captain icon floating 170 units from her own
 * name, portrait inside and the 108-unit reserve stood open on every board with
 * no match bound. Neither throws, and a preview built around one name length
 * looks fine.
 */

// Text node whose measured box is the whole contract; an image node is an x and
// a width. Plain objects, like the layoutBox fixtures above.
const textNode = (x, width) => ({
    getBBox: () => ({ x, y: 0, width, height: 40 }),
    getAttribute: () => null,
});
const imageNode = (attrs) => ({
    attrs: { ...attrs },
    getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
});
const xOf = (node) => parseFloat(node.getAttribute('x'));

describe('pinBesideText', () => {
    it('holds one gap whatever the name measures', () => {
        // Side 1: end-anchored name, portrait before it. A long name and a
        // short one must leave the SAME gap — that is the whole point.
        for (const [left, width] of [[619, 153], [690, 82]]) {
            const sprite = imageNode({ x: 464, width: 72 });
            pinBesideText(sprite, textNode(left, width), { side: 'before', gap: 16 });
            expect(xOf(sprite) + 72).toBe(left - 16);
        }
    });

    it('pins after a start-anchored run on the other side', () => {
        const sprite = imageNode({ x: 1384, width: 72 });
        pinBesideText(sprite, textNode(1148, 83), { side: 'after', gap: 16 });
        expect(xOf(sprite)).toBe(1148 + 83 + 16);
    });

    it('leaves an empty run alone rather than stacking on its anchor', () => {
        // A name slot with no text measures 0 wide, and its bbox.x is wherever
        // the anchor happens to be. Pinning to that would park the portrait on
        // top of the score; the authored x is the better answer.
        const sprite = imageNode({ x: 464, width: 72 });
        pinBesideText(sprite, textNode(772, 0), { side: 'before', gap: 16 });
        expect(xOf(sprite)).toBe(464);
    });
});

describe('applyTextPins', () => {
    it('applies only what the theme declares, and leaves everything else put', () => {
        const slots = {
            'side1-name': textNode(619, 153),
            'side1-sprite': imageNode({ x: 464, width: 72, 'data-pin-before': 'side1-name', 'data-pin-gap': '16' }),
            'side2-name': textNode(1148, 83),
            'side2-sprite': imageNode({ x: 1384, width: 72, 'data-pin-after': 'side2-name' }),
            // Declares nothing: a theme that never opted in must not move, which
            // is what keeps this off every third-party package.
            'logo': imageNode({ x: 84, width: 110 }),
        };
        applyTextPins({ slots });
        expect(xOf(slots['side1-sprite'])).toBe(619 - 16 - 72);
        expect(xOf(slots['side2-sprite'])).toBe(1148 + 83 + 16);  // default gap 16
        expect(xOf(slots['logo'])).toBe(84);
    });

    it('survives a slot naming a target the theme does not have', () => {
        const slots = { orphan: imageNode({ x: 10, width: 20, 'data-pin-before': 'nope' }) };
        expect(() => applyTextPins({ slots })).not.toThrow();
        expect(xOf(slots.orphan)).toBe(10);
    });
});

/*
 * THE RAIL'S RECENTRE IS SOLVED, NOT APPROXIMATED, and the three shipped cards
 * are three different answers — which is the whole reason this is arithmetic
 * and not a constant. The obvious shift (half the rail's own footprint) is
 * right on two of them and silently wrong on the third, because it assumes the
 * theme was centred on the rail's OUTER edge. Scoreboard L is not: its card-bg
 * already sits on equal 16-unit gutters with the rail hanging outside them, so
 * it is off-centre WITH the rail and dead centre without one — and "correcting"
 * it moved a centred card 4 units right, in a source the producer had already
 * placed. Nothing about that is visible in a screenshot of one card.
 */
describe('applyCardRail', () => {
    const svgNs = 'http://www.w3.org/2000/svg';

    // The three cards as their themes actually author them.
    const CARDS = {
        // rail 8..14, bg 14..488 in a 496 frame — 8/8 gutters WITH the rail,
        // 14/8 without, so hiding it costs 3.
        scorecard: { vb: '0 0 496 766', rail: 8, bgX: 14, bgW: 474, off: '3 0 496 766' },
        // rail 8..14 OUTSIDE bg's own 16/16 gutters: already centred without it.
        'scoreboard-l': { vb: '0 0 800 460', rail: 8, bgX: 16, bgW: 768, off: '0 0 800 460' },
        // rail at x=0 (the attribute is absent), bg 8..388 flush to the right
        // edge of a 388 frame.
        'scoreboard-s': { vb: '0 0 388 156', rail: 0, bgX: 8, bgW: 380, off: '4 0 388 156' },
    };

    function card({ vb, rail, bgX, bgW }) {
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', vb);
        const mk = (attrs) => {
            const r = document.createElementNS(svgNs, 'rect');
            for (const [k, v] of Object.entries(attrs)) r.setAttribute(k, String(v));
            svg.appendChild(r);
            return r;
        };
        const slots = { 'card-rail': mk({ x: rail, width: 6 }), 'card-bg': mk({ x: bgX, width: bgW }) };
        return { engine: { slots }, svg };
    }

    it.each(Object.entries(CARDS))('centres %s\'s card when its rail goes', (_name, spec) => {
        const { engine, svg } = card(spec);
        applyCardRail(engine, false);
        expect(svg.getAttribute('viewBox')).toBe(spec.off);
        expect(engine.slots['card-rail'].style.display).toBe('none');
    });

    it.each(Object.entries(CARDS))('gives %s back its authored framing', (_name, spec) => {
        const { engine, svg } = card(spec);
        applyCardRail(engine, false);
        applyCardRail(engine, true);
        expect(svg.getAttribute('viewBox')).toBe(spec.vb);
        expect(engine.slots['card-rail'].style.display).toBe('');
    });

    /*
     * Scoreboard S MELDS its card-bg width, so a shift solved against the live
     * width would slide the whole card every time a segment came or went. The
     * stash is what makes the answer a property of the theme rather than of
     * whatever the card happened to be showing when the switch was thrown.
     */
    it('solves against the authored width, not a melded one', () => {
        const { engine, svg } = card(CARDS['scoreboard-s']);
        applyCardRail(engine, false);
        engine.slots['card-bg'].setAttribute('width', '232');   // melded compact
        applyCardRail(engine, false);
        expect(svg.getAttribute('viewBox')).toBe(CARDS['scoreboard-s'].off);
    });

    // Every package but `default` — the switch is inert there rather than
    // reframing a card on geometry it never declared.
    it('leaves a theme that draws no rail entirely alone', () => {
        const { engine, svg } = card(CARDS.scorecard);
        delete engine.slots['card-rail'];
        applyCardRail(engine, false);
        expect(svg.getAttribute('viewBox')).toBe(CARDS.scorecard.vb);
    });
});

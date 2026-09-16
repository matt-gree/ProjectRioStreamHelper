// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cardOutcome, metaLine, mountTicker } from '../../../public/layout/lib/ticker-mount.js';

/*
 * The Results Ticker's card. Three things, and only the first of them is
 * visible in a screenshot:
 *
 *  1. A CLONE IS BOUND IN THE DOCUMENT. Both halves of binding a card measure
 *     it, and a detached node measures 0 — so the auto-fit and the portrait
 *     pins were dead from the day they were written, in silence, on every
 *     card. This is the one bug in the file that no render of the shipped
 *     sample would have shown you: every tag in it happened to be short
 *     enough that 17px fitted anyway.
 *  2. Who won is DATA (`cardOutcome`), shared with the Matchup card's
 *     `rowOutcome` so one kind of card has one answer.
 *  3. The footer names the COMPETITION, not the park.
 */

function deepGet(obj, path, def) {
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur == null) return def;
        cur = cur[seg];
    }
    return cur === undefined ? def : cur;
}

const game = (over = {}) => ({
    game_id: 1, game_completed: true,
    away_user: 'Away', home_user: 'Home',
    away_score: 3, home_score: 1,
    away_captain: 'Mario', home_captain: 'Yoshi',
    game_mode: 'NNL Season 10', stadium: 'Mario Stadium',
    date_time_end: '2026-09-06T15:09:49',
    ...over,
});

describe('cardOutcome', () => {
    it('reads the winner off the two scores', () => {
        expect(cardOutcome(game({ away_score: 9, home_score: 7 })))
            .toEqual({ hasScores: true, winnerSide: 1 });
        expect(cardOutcome(game({ away_score: 7, home_score: 9 })))
            .toEqual({ hasScores: true, winnerSide: 2 });
    });

    // The marker says "this player won". A 5-5 has nobody to say it about, so
    // the card states both scores at full strength and marks neither side --
    // the same abstention `rowOutcome` makes on a match with no `decided`.
    it('abstains on a tie rather than favouring the first-listed side', () => {
        expect(cardOutcome(game({ away_score: 5, home_score: 5 })))
            .toEqual({ hasScores: true, winnerSide: null });
    });

    it('shows no score at all until the game is COMPLETED', () => {
        // An ongoing game can carry a running score, and a marquee of finished
        // results is the wrong place to put one: the card would read as a
        // final. It gets the vs mark instead.
        expect(cardOutcome(game({ game_completed: false })).hasScores).toBe(false);
        expect(cardOutcome(game({ away_score: null })).hasScores).toBe(false);
        expect(cardOutcome(undefined)).toEqual({ hasScores: false, winnerSide: null });
    });
});

describe('metaLine', () => {
    it('names the competition and the date, in that order', () => {
        expect(metaLine(game())).toBe('NNL Season 10 · SEP 6');
    });

    // Not the stadium. The Matchup summary's history cards settled this: the
    // mode is the competition and earns the line, the park is flavour. The
    // park is still BOUND (to its own `stadium` part) for a theme that wants
    // it, which is why this assertion is about the composed line only.
    it('leaves the park out of the composed line', () => {
        expect(metaLine(game())).not.toMatch(/Mario Stadium/);
    });

    it('drops a half it has not got rather than printing a bare separator', () => {
        expect(metaLine(game({ game_mode: '' }))).toBe('SEP 6');
        expect(metaLine(game({ date_time_end: null }))).toBe('NNL Season 10');
        expect(metaLine(game({ game_mode: '', date_time_end: 'not-a-date' }))).toBe('');
    });
});

/* ── The ordering rule ───────────────────────────────────────────────────── */

const THEME = readFileSync('public/design/default/ticker.svg', 'utf8');

// jsdom implements no SVG geometry at all, so the two measurements a bind
// makes are stubbed here -- and stubbed the way a BROWSER behaves, which is the
// whole point: both answer NOTHING for a node outside the document, quietly.
// getComputedTextLength gives 0 and getBBox a zero rect (measured in Chrome),
// and the mount's own guards turn both into "leave it alone". That silence is
// the bug, so a stub that measured a detached node would be a test that could
// not fail.
const CHAR_W = 0.52;
function installGeometryStubs() {
    const width = (el) => (el.isConnected ? el.textContent.length * CHAR_W
        * parseFloat(el.style.fontSize || el.getAttribute('font-size') || 16) : 0);
    Object.defineProperty(globalThis.SVGElement.prototype, 'getComputedTextLength', {
        configurable: true, writable: true, value() { return width(this); },
    });
    Object.defineProperty(globalThis.SVGElement.prototype, 'getBBox', {
        configurable: true, writable: true,
        value() {
            // Zero rect, not a throw: measured in Chrome, a detached <text>
            // answers {x: 0, width: 0}. It matters which, because
            // pinBesideText early-returns on a zero width -- so the real
            // failure is an icon silently left at its authored x, not an
            // exception anybody would have seen in a console.
            if (!this.isConnected) return { x: 0, y: 0, width: 0, height: 0 };
            const w = this.tagName === 'text' ? width(this)
                : parseFloat(this.getAttribute('width')) || 0;
            const anchor = this.getAttribute('text-anchor');
            const x = parseFloat(this.getAttribute('x')) || 0;
            return { x: anchor === 'end' ? x - w : x, y: 0, width: w, height: 10 };
        },
    });
}

async function mountWith(games) {
    installGeometryStubs();
    globalThis.OverlayBase = {
        BASE_URL: '', deepGet,
        settings: {},
        readSetting: (_t, _k, d) => d,
        settingOn: (v, d) => (v == null ? d : !!v),
        applyDesignSettings() {}, clearDesignSettings() {}, setBlank() {},
    };
    globalThis.RioData = { charIconUrl: (n) => (n ? `/icons/${n}.png` : '') };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.fetch = vi.fn(async () => ({ ok: true, text: async () => THEME }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const t = mountTicker({ host, sb: 1 });
    await t.update(
        { scoreboards: { rotation: { 1: { cached_games: games, game_ids: games.map(g => g.game_id) } } } },
        {},
    );
    return { host, dispose: () => t.dispose() };
}

describe('a card is bound in the document', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('auto-fits a name that overruns its budget', async () => {
        // The exact case the shipped sample does not contain and the bug
        // therefore survived: a long rio tag. Bound detached, this renders at
        // its authored size and runs under the score plate.
        const { host, dispose } = await mountWith([game({ away_user: 'VicklessFalcon' })]);
        const el = host.querySelector('[data-part="away-name"]');
        const maxw = parseFloat(el.getAttribute('data-maxw'));
        const base = parseFloat(el.getAttribute('data-basefs'));

        expect(base).toBe(18);
        expect(parseFloat(el.style.fontSize)).toBeLessThan(base);
        expect(el.getComputedTextLength()).toBeLessThanOrEqual(maxw + 0.001);
        dispose();
    });

    it('leaves a name that fits at the size the theme authored', async () => {
        const { host, dispose } = await mountWith([game({ away_user: 'Jo' })]);
        const el = host.querySelector('[data-part="away-name"]');
        expect(parseFloat(el.style.fontSize)).toBe(18);
        dispose();
    });

    it('pins each captain icon to the MEASURED outer edge of its name', async () => {
        // The pins are the other half of the same ordering rule: pinBesideText
        // calls getBBox, which throws on a detached node. A short name and a
        // long one must not put their icon in the same place -- that is the
        // authored x, and the authored x is what this replaced.
        const short = await mountWith([game({ away_user: 'Jo' })]);
        const shortX = +short.host.querySelector('[data-part="away-cap"]').getAttribute('x');
        short.dispose();
        document.body.innerHTML = '';

        const long = await mountWith([game({ away_user: 'VicklessFalcon' })]);
        const longX = +long.host.querySelector('[data-part="away-cap"]').getAttribute('x');
        long.dispose();

        expect(longX).toBeLessThan(shortX);
    });

    it('marks the winner and dims the loser, on the cloned card', async () => {
        const { host, dispose } = await mountWith([game({ away_score: 2, home_score: 8 })]);
        const op = (n) => host.querySelector(`[data-part="${n}"]`).getAttribute('opacity');

        expect(op('home-win')).toBe('1');
        expect(op('away-win')).toBe('0');
        expect(op('away-row')).toBe('0.45');
        expect(op('home-row')).toBe('1');
        // The row owns the dim, so the score inside it must not dim again --
        // 0.45 squared is 0.2, which reads as a rendering fault.
        expect(host.querySelector('[data-part="score-away"]').style.fillOpacity).toBe('1');
        dispose();
    });

    it('keeps the plate but empties it on a game that has not finished', async () => {
        const { host, dispose } = await mountWith([game({ game_completed: false })]);
        expect(host.querySelector('[data-part="vs"]').getAttribute('opacity')).toBe('1');
        expect(host.querySelector('[data-part="score-group"]').getAttribute('opacity')).toBe('0');
        expect(host.querySelector('[data-part="score-away"]').getAttribute('opacity')).toBe('0');
        // The plate itself is theme chrome and outside every part, so the eye
        // tracks the same object past the same point on every card.
        expect(host.querySelector('[data-part="score-group"]').parentElement
            .querySelector('rect[rx="8"]')).toBeTruthy();
        dispose();
    });
});

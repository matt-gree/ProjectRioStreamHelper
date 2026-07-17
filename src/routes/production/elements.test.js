import { describe, it, expect } from 'vitest';
import { packRows, elementsForPhase, ELEMENTS, PHASES } from './elements';

const el = (id, span) => ({ id, span });
const spans = (rows) => rows.map((r) => r.map((e) => e.span));
const rowSum = (r) => r.reduce((s, e) => s + e.span, 0);

describe('packRows', () => {
    it('stretches every row except the last to exactly 12 columns', () => {
        const rows = packRows([el('a', 3), el('b', 4), el('c', 4), el('d', 6), el('e', 2)]);
        // a+b+c = 11 → first row; d+e = 8 → last row, left short.
        expect(spans(rows)).toEqual([[4, 4, 4], [6, 2]]);
        expect(rowSum(rows[0])).toBe(12);
    });

    it('a row that already sums to 12 is untouched', () => {
        const rows = packRows([el('a', 3), el('b', 3), el('c', 4), el('d', 2), el('e', 5)]);
        expect(spans(rows)[0]).toEqual([3, 3, 4, 2]);
    });

    it('deals the deficit round-robin from the left', () => {
        const rows = packRows([el('a', 2), el('b', 2), el('c', 3), el('x', 12)]);
        // 2+2+3 = 7 → deficit 5 → +2, +2, +1.
        expect(spans(rows)[0]).toEqual([4, 4, 4]);
    });

    it('a single incomplete row keeps its natural spans', () => {
        expect(spans(packRows([el('a', 4)]))).toEqual([[4]]);
    });

    it('an oversized preferred span is clamped to the full width', () => {
        expect(spans(packRows([el('a', 20), el('b', 3)]))).toEqual([[12], [3]]);
    });

    it('preserves element order across rows', () => {
        const rows = packRows([el('a', 6), el('b', 6), el('c', 6)]);
        expect(rows.flat().map((e) => e.element.id)).toEqual(['a', 'b', 'c']);
    });
});

describe('element registry invariants', () => {
    it('every element belongs to at least one known phase', () => {
        const known = new Set(PHASES.map((p) => p.value));
        for (const e of ELEMENTS) {
            const phases = Array.isArray(e.phase) ? e.phase : [e.phase];
            expect(phases.length).toBeGreaterThan(0);
            for (const p of phases) expect(known.has(p)).toBe(true);
        }
    });

    it('elementsForPhase handles single and array phases', () => {
        const live = elementsForPhase('live').map((e) => e.id);
        expect(live).toContain('scoreboard');
        expect(live).toContain('commentary'); // array phase
        expect(elementsForPhase('break').map((e) => e.id)).toContain('lowerthird');
    });

    it('fed elements declare a canonical container url', () => {
        for (const e of ELEMENTS.filter((x) => x.flavor === 'fed')) {
            expect(e.url).toMatch(/\/layout\//);
        }
    });
});

describe('element URL binding (match)', () => {
    const byId = Object.fromEntries(ELEMENTS.map((e) => [e.id, e]));
    const HOST = 'http://localhost:5260';

    it('every element matches its own canonical url', () => {
        for (const e of ELEMENTS) {
            expect(e.match(HOST + e.url), e.id).toBe(true);
        }
    });

    it('matching survives query params (scoreboard/size/intro variants)', () => {
        expect(byId.scoreboard.match(
            `${HOST}/layout/scoreboard1/scoreboard.html?scoreboard=2&size=m&intro=0`,
        )).toBe(true);
        expect(byId.lowerthird.match(
            `${HOST}/layout/lowerthird/lowerthird.html?intro=0`)).toBe(true);
    });

    it('scoreboard binds the band, not siblings in the same folder', () => {
        expect(byId.scoreboard.match(
            `${HOST}/layout/scoreboard1/stats.html?team=1`)).toBe(false);
        expect(byId.scoreboard.match(
            `${HOST}/layout/scoreboard1/roster.html`)).toBe(false);
    });

    it('schedule is deliberately narrow: bracket player_schedule must not bind', () => {
        expect(byId.schedule.match(
            `${HOST}/layout/bracket/player_schedule.html`)).toBe(false);
        expect(byId.schedule.match(
            `${HOST}/layout/schedule/schedule.html`)).toBe(true);
    });

    it('both post-game feeds bind the shared callout stage', () => {
        const stage = `${HOST}/layout/shared/callout-stage.html`;
        expect(byId.postgamecallout.match(stage)).toBe(true);
        expect(byId.postgamevs.match(stage)).toBe(true);
    });

    it('no element binds a non-PRSH browser source', () => {
        for (const e of ELEMENTS) {
            expect(e.match('https://example.com/some/page.html'), e.id).toBe(false);
        }
    });
});

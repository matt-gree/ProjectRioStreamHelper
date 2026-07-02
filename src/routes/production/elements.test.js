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

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { rowOutcome, LOSER_DIM, cardRowShift } from '../../public/layout/lib/matchup-mount.js';

/*
 * WHO WON A MATCHUP CARD. The band's only cue was a dim on the losing score,
 * which at broadcast size is not a cue and which -- on a card that named no
 * player -- could at best tell you which NUMBER lost. `rowOutcome` is the rule
 * the themes draw from; these are the three things about it that are easy to
 * get wrong and silent when you do.
 */

describe('rowOutcome', () => {
    it('marks the winner and dims the loser', () => {
        expect(rowOutcome(1, 1).win).toBe('1');
        expect(rowOutcome(1, 2).win).toBe('0');
        expect(rowOutcome(1, 1).row).toBe('1');
        expect(rowOutcome(1, 2).row).toBe(LOSER_DIM);
    });

    it('never dims a row group AND its children — that lands the loser at 0.2', () => {
        // A theme with a row group dims once, on the group, so the team logo
        // inside it comes down with the name and the score.
        const grouped = rowOutcome(1, 2, { hasRow: true });
        expect(grouped.row).toBe(LOSER_DIM);
        expect(grouped.name).toBe('1');
        expect(grouped.score).toBe('1');

        // A theme without one dims the nodes it has. Both halves of the same
        // statement: the product must never be LOSER_DIM squared.
        const flat = rowOutcome(1, 2, { hasRow: false });
        expect(flat.name).toBe(LOSER_DIM);
        expect(flat.score).toBe(LOSER_DIM);
    });

    it('abstains on an undecided game rather than picking a side', () => {
        // A tie, a quit, a row the API never resolved: the card still states
        // both scores at full strength and marks nobody.
        for (const winner of [null, undefined, 0, '1']) {
            for (const side of [1, 2]) {
                const o = rowOutcome(winner, side);
                expect(o.win).toBe('0');
                expect(o.row).toBe('1');
                expect(o.name).toBe('1');
                expect(o.score).toBe('1');
            }
        }
    });
});

/*
 * A SHORT HISTORY SITS IN THE ROW, NOT HARD LEFT OF IT. The default theme's
 * five cards: 344 wide on a 358 pitch from x=72, so the row runs 72..1848 and
 * centres on 960.
 */
describe('cardRowShift', () => {
    const FIVE = [72, 430, 788, 1146, 1504].map(x => ({ x, w: 344 }));

    it('centres the cards that are shown on the row all five span', () => {
        // Two cards span 72..774, centred on 423: slide 537 to land on 960.
        expect(cardRowShift(FIVE, 2, 'center')).toBe(537);
        expect(cardRowShift(FIVE, 1, 'center')).toBe(716);
        expect(cardRowShift(FIVE, 4, 'center')).toBe(179);
    });

    it('right-aligns against the last card and leaves left where it was', () => {
        expect(cardRowShift(FIVE, 2, 'right')).toBe(1074);
        expect(cardRowShift(FIVE, 2, 'left')).toBe(0);
    });

    it('moves nothing when the row is full or empty', () => {
        for (const align of ['left', 'center', 'right']) {
            expect(cardRowShift(FIVE, 5, align)).toBe(0);
            expect(cardRowShift(FIVE, 0, align)).toBe(0);
        }
    });

    it('answers 0 for a theme that stacks its cards, and for one it could not measure', () => {
        const stacked = Array.from({ length: 5 }, () => ({ x: 100, w: 300 }));
        expect(cardRowShift(stacked, 2, 'center')).toBe(0);
        expect(cardRowShift([...FIVE.slice(0, 4), { x: NaN, w: 0 }], 2, 'center')).toBe(0);
    });
});

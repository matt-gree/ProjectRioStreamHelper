/*
 * A DOUBLEHEADER IS `bestOf: 2`, and the only thing it needed that the model
 * didn't already have is a name.
 *
 * The clinch majority every caller runs (`bestOf // 2 + 1`) gives 2 for a DH —
 * you take a doubleheader by winning BOTH games — so a sweep decides it and a
 * 1-1 split never does, which is correct: a split has no winner. That falls out
 * of the existing sum, so a DH needs no second field and no second code path.
 */
import { describe, it, expect } from 'vitest';
import {
    FORMATS, formatLabel, gamesToWin, isSplit, matchComplete, seriesContinues,
} from '../../public/layout/lib/match-format.js';

describe('match format', () => {
    it('never prints Bo2, because nobody calls a doubleheader that', () => {
        expect(formatLabel(2)).toBe('DH');
        expect(formatLabel(2, { long: true })).toBe('doubleheader');
        expect(formatLabel(3)).toBe('Bo3');
        expect(formatLabel(5, { long: true })).toBe('best of 5');
    });

    it('gives a Bo1 no label at all, because it is the absence of a series', () => {
        // Callers decide what stands in its place — the schedule plate says VS,
        // the console prints nothing.
        expect(formatLabel(1)).toBe('');
        expect(formatLabel(undefined)).toBe('');
        expect(formatLabel(null)).toBe('');
    });

    it('offers the DH second — it is the common repeat, a Bo3 is the rarity', () => {
        expect(FORMATS).toEqual([1, 2, 3, 5, 7]);
    });

    it('takes a doubleheader by winning both games', () => {
        expect(gamesToWin(2)).toBe(2);
        expect(gamesToWin(1)).toBe(1);
        expect(gamesToWin(3)).toBe(2);
        expect(gamesToWin(5)).toBe(3);
    });

    /*
     * The one place a DH differs from every other format. `bestOf > 1 &&
     * !decided` was right while every multi-game format was ODD (somebody always
     * clinches, so `decided` is the end) and wrong for a doubleheader, which can
     * be COMPLETE AND UNDECIDED — leaving the take stood down all night on a
     * fixture with no games left to play.
     */
    describe('can another game follow?', () => {
        it('says no for a Bo1, at nil-nil', () => {
            // The carve-out that matters most often: a Bo1's game ending IS the
            // fixture ending, and gating its take on a credit that may not have
            // landed is what hid the producer's next press.
            expect(seriesContinues(1, 0, 0, 0)).toBe(false);
        });

        it('says yes between the two games of a doubleheader', () => {
            expect(seriesContinues(2, 0, 0, 0)).toBe(true);
            expect(seriesContinues(2, 1, 0, 0)).toBe(true);
        });

        it('says no to a SPLIT doubleheader, which is complete and undecided', () => {
            expect(seriesContinues(2, 1, 1, 0)).toBe(false);
        });

        it('says no once a doubleheader is swept', () => {
            expect(seriesContinues(2, 2, 0, 1)).toBe(false);
        });

        it('still tracks a Bo3 through its middle game', () => {
            expect(seriesContinues(3, 1, 0, 0)).toBe(true);
            expect(seriesContinues(3, 1, 1, 0)).toBe(true);
            expect(seriesContinues(3, 2, 0, 2)).toBe(false);
        });
    });

    /*
     * A DOUBLEHEADER IS COMPLETE AFTER TWO GAMES HOWEVER THEY FALL. `decided`
     * records a WINNER and, for every odd format, also the end — they come apart
     * only here, and everything that asked `decided` to mean "finished" read a
     * split as still running: no handover offered, a clear that left the fixture
     * bound, and a finished match sitting on the Upcoming card all night.
     */
    describe('is the fixture out of games?', () => {
        it('counts a split doubleheader as finished, with nobody winning it', () => {
            expect(matchComplete(2, 1, 1, null)).toBe(true);
            expect(isSplit(2, 1, 1, null)).toBe(true);
        });

        it('counts a swept doubleheader as finished, with a winner', () => {
            expect(matchComplete(2, 2, 0, 1)).toBe(true);
            expect(isSplit(2, 2, 0, 1)).toBe(false);
        });

        it('leaves a doubleheader open between its two games', () => {
            expect(matchComplete(2, 1, 0, null)).toBe(false);
        });

        it('leaves a Bo1 whose game never credited its game to give', () => {
            // A quit game reports no winner, so nothing is credited — and a
            // re-capture can still decide it.
            expect(matchComplete(1, 0, 0, null)).toBe(false);
        });

        it('has no split to report for an odd format, which always clinches', () => {
            expect(isSplit(3, 2, 1, 1)).toBe(false);
            expect(matchComplete(3, 1, 1, null)).toBe(false);
        });
    });
});

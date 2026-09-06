import { describe, it, expect } from 'vitest';
import { linescoreColumns, prettyStadium } from '../../../public/layout/lib/mount-utils.js';

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

import { describe, it, expect } from 'vitest';
import {
    SIDE_LABEL_MODES, DEFAULT_SIDE_LABELS, sideLabel, sidePhrase,
} from './sides';

/*
 * The vocabulary itself. Everything else in the sweep routes through these two
 * functions, so what they guarantee is what every console surface inherits.
 */
describe('side vocabulary', () => {
    it('defaults to the numbers, which are the only words true in every layout', () => {
        expect(DEFAULT_SIDE_LABELS).toBe('numeric');
        expect(sideLabel(1)).toBe('Side 1');
        expect(sideLabel(2)).toBe('Side 2');
    });

    it('offers a paired mode for each arrangement, so no pair can be mixed', () => {
        expect(SIDE_LABEL_MODES.map(m => m.value)).toEqual(['numeric', 'lr', 'tb']);
        // The option's own text is built from the labels it selects, so the
        // Settings control can never offer a mode nothing can spell.
        expect(SIDE_LABEL_MODES.map(m => m.label)).toEqual([
            'Side 1 / Side 2', 'Left / Right', 'Top / Bottom',
        ]);
    });

    /*
     * Two forms because English needs both, and letting each of the seven call
     * sites improvise the second one is exactly how "Left" ended up hard-coded
     * in six places.
     */
    it('has a standalone form and a mid-sentence form for every mode', () => {
        expect(sideLabel(2, 'lr')).toBe('Right');
        expect(sidePhrase(2, 'lr')).toBe('the right side');
        expect(sideLabel(1, 'tb')).toBe('Top');
        expect(sidePhrase(1, 'tb')).toBe('the top side');
        // Both read after the prepositions the call sites actually use.
        expect(`Alice on ${sidePhrase(1, 'numeric')}`).toBe('Alice on side 1');
        expect(`Draws ${sidePhrase(2, 'tb')}`).toBe('Draws the bottom side');
    });

    /*
     * This reads a PERSISTED settings value and a hand-edited settings.json is a
     * real thing — as is a settings frame that hasn't landed yet on first paint.
     * Falling back beats rendering "undefined" into a producer's board desk.
     */
    it('falls back to the default rather than breaking on a mode it does not know', () => {
        expect(sideLabel(1, 'diagonal')).toBe('Side 1');
        expect(sideLabel(1, undefined)).toBe('Side 1');
        expect(sidePhrase(2, null)).toBe('side 2');
    });

    /*
     * A side arrives as a number, a numeric string, or a value that round-tripped
     * through the socket — the same coercion `_scope_of` does server-side and
     * `useMemberScope` does on the client. Anything that isn't side 2 is side 1,
     * so a missing scope lands on the same default as a missing `?scoreboard=`.
     */
    it('coerces the side the way every other reader of a side does', () => {
        expect(sideLabel('2', 'lr')).toBe('Right');
        expect(sideLabel(2.0, 'lr')).toBe('Right');
        expect(sideLabel(undefined, 'lr')).toBe('Left');
        expect(sideLabel('nonsense', 'lr')).toBe('Left');
    });
});

import { describe, it, expect } from 'vitest';
import { matchDisplayLabel } from './matches';

const pair = (label) => ({
    ...(label ? { label } : {}),
    player: { 1: { rioName: 'rjb' }, 2: { rioName: 'MattGree' } },
});

describe('matchDisplayLabel', () => {
    it('tells two fixtures between one pair apart — the doubleheader', () => {
        const matches = { 3: pair(), 4: pair() };
        expect(matchDisplayLabel(matches, '3')).toBe('M3 · rjb vs MattGree');
        expect(matchDisplayLabel(matches, '4')).toBe('M4 · rjb vs MattGree');
    });

    it('keeps the round label ahead of the names', () => {
        expect(matchDisplayLabel({ 2: pair('Winners Final') }, '2'))
            .toBe('M2 · Winners Final — rjb vs MattGree');
    });

    it('a fixture with nothing else to say is still "Match N"', () => {
        expect(matchDisplayLabel({ 5: {} }, '5')).toBe('Match 5');
        expect(matchDisplayLabel({}, '9')).toBe('Match 9');
    });
});

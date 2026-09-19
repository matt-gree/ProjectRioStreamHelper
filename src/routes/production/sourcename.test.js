import { describe, expect, it } from 'vitest';
import { renameForUrl, sourceNameFor, sourceNameForUrl, upgradeRetiredName } from './sourcename';
import { ELEMENTS } from './elements';

const H = 'http://127.0.0.1:5260/layout';
const BAR = (q) => `${H}/scoreboard1/statsbar.html?${q}`;
const SB = (q) => `${H}/scoreboard1/scoreboard.html?${q}`;
const two = { boards: [1, 2] };

describe('sourceNameFor', () => {
    it('writes the board as a word, after the side', () => {
        const el = ELEMENTS.find(e => e.id === 'statsbar');
        expect(sourceNameFor({ element: el, variant: 't1', board: 2, boards: [1, 2] }))
            .toBe('Stat Bar — Side 1 (Board 2)');
    });

    it('leaves the board out on a one-board rig', () => {
        expect(sourceNameForUrl(BAR('scoreboard=1&team=2'))).toBe('Stat Bar — Side 2');
    });

    it('names the default size, as the Add picker does', () => {
        expect(sourceNameForUrl(SB('scoreboard=2'), two)).toBe('Scoreboard — Large (Board 2)');
        expect(sourceNameForUrl(SB('scoreboard=2&size=s'), two)).toBe('Scoreboard — Small (Board 2)');
    });
});

describe('renameForUrl — a PRSH name follows its URL', () => {
    it('follows a board switch', () => {
        expect(renameForUrl('Stat Bar — Side 1 (Board 1)',
            BAR('scoreboard=1&team=1'), BAR('scoreboard=2&team=1'), two))
            .toBe('Stat Bar — Side 1 (Board 2)');
    });

    it('follows a side change made by hand in OBS', () => {
        expect(renameForUrl('Stat Bar — Side 1 (Board 1)',
            BAR('scoreboard=1&team=1'), BAR('scoreboard=1&team=2'), two))
            .toBe('Stat Bar — Side 2 (Board 1)');
    });

    // The old names: a bare number after the label, which beside a side read
    // "Side 1 1". Matched as a WHOLE name, never as "the last number", so the
    // side can't be rewritten in its place.
    it('upgrades an old bare-number name', () => {
        expect(renameForUrl('Stat Bar — Side 1 1',
            BAR('scoreboard=1&team=1'), BAR('scoreboard=2&team=1'), two))
            .toBe('Stat Bar — Side 1 (Board 2)');
        // Bind's old form: `Scoreboard Small 1` (and plain `Scoreboard 1` for
        // the default size, which it never named).
        expect(renameForUrl('Scoreboard Small 1',
            SB('scoreboard=1&size=s'), SB('scoreboard=2&size=s'), two))
            .toBe('Scoreboard — Small (Board 2)');
        expect(renameForUrl('Scoreboard 1', SB('scoreboard=1'), SB('scoreboard=2'), two))
            .toBe('Scoreboard — Large (Board 2)');
    });

    it('a one-board name gains its board, never loses its side', () => {
        expect(renameForUrl('Stat Bar — Side 1',
            BAR('scoreboard=1&team=1'), BAR('scoreboard=2&team=1'), two))
            .toBe('Stat Bar — Side 1 (Board 2)');
    });

    it("never touches the producer's own name", () => {
        expect(renameForUrl('Left stats',
            BAR('scoreboard=1&team=1'), BAR('scoreboard=2&team=1'), two)).toBeNull();
        expect(renameForUrl('Stat Bar — Side 1 (Board 1) 2',
            BAR('scoreboard=1&team=1'), BAR('scoreboard=2&team=1'), two)).toBeNull();
    });

    it('does nothing when the URL did not change what the name says', () => {
        expect(renameForUrl('Stat Bar — Side 1 (Board 1)',
            BAR('scoreboard=1&team=1'), BAR('scoreboard=1&team=1&intro=0'), two)).toBeNull();
    });
});

describe('upgradeRetiredName — the one-time pass', () => {
    it('upgrades the retired forms', () => {
        expect(upgradeRetiredName('Stat Bar — Side 1 1', BAR('scoreboard=1&team=1'), two))
            .toBe('Stat Bar — Side 1 (Board 1)');
        expect(upgradeRetiredName('Scoreboard Small 2', SB('scoreboard=2&size=s'), two))
            .toBe('Scoreboard — Small (Board 2)');
        expect(upgradeRetiredName('Scoreboard Small', SB('size=s')))
            .toBe('Scoreboard — Small');
    });

    // Today's form is never "fixed" — or dropping to one board would strip
    // "(Board 1)" off every source, and adding one back would put it back on.
    it("leaves today's form alone, whatever the board count", () => {
        expect(upgradeRetiredName('Stat Bar — Side 1 (Board 1)', BAR('scoreboard=1&team=1'))).toBeNull();
        expect(upgradeRetiredName('Stat Bar — Side 1', BAR('scoreboard=1&team=1'), two)).toBeNull();
    });

    it("never touches the producer's own names, or plain `Scoreboard`", () => {
        expect(upgradeRetiredName('Left stats', BAR('scoreboard=1&team=1'), two)).toBeNull();
        expect(upgradeRetiredName('Scoreboard', SB('scoreboard=1'), two)).toBeNull();
        // A retired name that no longer matches its URL is not ours to guess at.
        expect(upgradeRetiredName('Stat Bar — Side 1 1', BAR('scoreboard=2&team=1'), two)).toBeNull();
    });

    it('is idempotent', () => {
        const once = upgradeRetiredName('Stat Bar — Side 2 2', BAR('scoreboard=2&team=2'), two);
        expect(once).toBe('Stat Bar — Side 2 (Board 2)');
        expect(upgradeRetiredName(once, BAR('scoreboard=2&team=2'), two)).toBeNull();
    });
});

import { describe, it, expect } from 'vitest';
import { ELEMENTS } from './elements';
import {
    FEED_INTENT, resolveIntent, resolveSpotlight, spotlightSuggestion, totalBases, winningSide,
} from './suggest';

const el = (id) => ELEMENTS.find(e => e.id === id);

// A captured character: name + the batting fields total bases reads.
const ch = (name, b = {}) => ({ name, batting: { singles: 0, doubles: 0, triples: 0, homeruns: 0, rbi: 0, ...b } });

const capture = ({ winnerSide = 1, side1 = [], side2 = [], ...rest } = {}) => ({
    postgame: {
        1: {
            present: true,
            meta: { winnerSide },
            player: { 1: { characters: side1 }, 2: { characters: side2 } },
            ...rest,
        },
    },
});

describe('totalBases', () => {
    it('weights extra-base hits', () => {
        expect(totalBases({ singles: 1, doubles: 1, triples: 1, homeruns: 1 })).toBe(10);
    });

    it('falls back to hits when a capture predates the singles field', () => {
        // hits = 1B+2B+3B+HR, so hits + 2B + 2·3B + 3·HR is the same number.
        expect(totalBases({ hits: 4, doubles: 1, triples: 1, homeruns: 1 })).toBe(10);
    });

    it('is 0 for a missing block rather than NaN', () => {
        expect(totalBases(null)).toBe(0);
        expect(totalBases({})).toBe(0);
    });
});

describe('winningSide', () => {
    it('trusts the capture verdict first', () => {
        expect(winningSide({ meta: { winnerSide: 2 }, player: { 1: { isWinner: true } } })).toBe(2);
    });

    it('falls back to the per-side flag, then the score', () => {
        expect(winningSide({ player: { 2: { isWinner: true } } })).toBe(2);
        expect(winningSide({ player: { 1: { score: 5 }, 2: { score: 9 } } })).toBe(2);
    });

    it('has no answer for a tie', () => {
        expect(winningSide({ player: { 1: { score: 3 }, 2: { score: 3 } } })).toBeNull();
    });
});

/*
 * The opening suggestion. It has to be worth cutting to and identical every
 * time the same capture is read, or the producer can't trust it.
 */
describe('spotlightSuggestion', () => {
    it('picks the winning side\'s leader in total bases', () => {
        const s = capture({
            winnerSide: 1,
            // Peach: 3 singles = 3 TB. Daisy: 1 HR + 1 double = 6 TB.
            side1: [ch('Peach', { singles: 3 }), ch('Daisy', { homeruns: 1, doubles: 1 })],
            side2: [ch('Wario', { homeruns: 3 })],
        });
        expect(spotlightSuggestion(s, 1)).toMatchObject({
            element: 'postgamecallout', scoreboard: 1, team: 1, charIndex: 1, name: 'Daisy',
            suggested: true,
        });
    });

    it('never volunteers a loser, however big their day', () => {
        const s = capture({
            winnerSide: 2,
            side1: [ch('Mario', { homeruns: 4 })],
            side2: [ch('Wario', { singles: 1 })],
        });
        expect(spotlightSuggestion(s, 1)).toMatchObject({ team: 2, name: 'Wario' });
    });

    it('pools both sides when the capture cannot say who won', () => {
        const s = capture({
            winnerSide: null,
            side1: [ch('Mario', { singles: 1 })],
            side2: [ch('Wario', { homeruns: 2 })],
        });
        expect(spotlightSuggestion(s, 1)).toMatchObject({ team: 2, name: 'Wario' });
    });

    it('breaks ties on homeruns, then RBI, then roster order', () => {
        const four = { singles: 4 };
        const s = capture({
            // All 4 TB: Toad on singles, Yoshi on a homer, Birdo on a homer with RBI.
            side1: [ch('Toad', four), ch('Yoshi', { homeruns: 1 }), ch('Birdo', { homeruns: 1, rbi: 3 })],
        });
        expect(spotlightSuggestion(s, 1)).toMatchObject({ name: 'Birdo' });

        const flat = capture({ side1: [ch('Toad'), ch('Yoshi')] });
        expect(spotlightSuggestion(flat, 1)).toMatchObject({ charIndex: 0, name: 'Toad' });
    });

    it('skips empty roster slots and has no answer without a capture', () => {
        const s = capture({ side1: [ch(''), ch('Toad', { singles: 2 })] });
        expect(spotlightSuggestion(s, 1)).toMatchObject({ charIndex: 1, name: 'Toad' });
        expect(spotlightSuggestion({ postgame: { 1: { present: false } } }, 1)).toBeNull();
        expect(spotlightSuggestion({}, 1)).toBeNull();
    });
});

/*
 * The pick has to survive the container being handed to another element —
 * that is the whole reason the memory exists — but must NOT survive into a
 * different game, where the same charIndex names somebody else.
 */
describe('resolveIntent', () => {
    const spotlight = el('postgamecallout');
    const remembered = (p) => ({ production: { feed: { last: { postgamecallout: p } } } });
    const merge = (...o) => Object.assign({}, ...o);

    it('prefers a remembered pick over the suggestion', () => {
        const s = merge(
            capture({ side1: [ch('Peach', { singles: 1 }), ch('Daisy', { homeruns: 4 })] }),
            remembered({ element: 'postgamecallout', scoreboard: 1, team: 1, charIndex: 0, name: 'Peach' }),
        );
        expect(resolveIntent(s, spotlight, 1)).toMatchObject({ name: 'Peach', charIndex: 0 });
    });

    it('discards a pick whose index now names a different character', () => {
        const s = merge(
            capture({ side1: [ch('Toad', { singles: 1 }), ch('Yoshi', { homeruns: 2 })] }),
            // Same slot, but this capture has Toad there, not Peach.
            remembered({ element: 'postgamecallout', scoreboard: 1, team: 1, charIndex: 0, name: 'Peach' }),
        );
        expect(resolveIntent(s, spotlight, 1)).toMatchObject({ name: 'Yoshi', suggested: true });
    });

    it('discards a pre-memory payload that carries no name', () => {
        const s = merge(
            capture({ side1: [ch('Toad', { homeruns: 1 })] }),
            remembered({ element: 'postgamecallout', scoreboard: 1, team: 1, charIndex: 0 }),
        );
        expect(resolveIntent(s, spotlight, 1)).toMatchObject({ suggested: true });
    });

    it('replays a whole-game push as-is — nothing in it can go stale', () => {
        const vs = { element: 'postgamevs', scoreboard: 1 };
        const s = { production: { feed: { last: { postgamevs: vs } } } };
        expect(FEED_INTENT.postgamevs).toBeUndefined();
        expect(resolveIntent(s, el('postgamevs'), 1)).toEqual(vs);
    });

    it('has no intent for an element that has never fed', () => {
        expect(resolveIntent({}, spotlight, 1)).toBeNull();
        expect(resolveIntent({}, null, 1)).toBeNull();
    });

    /*
     * THE BUG THIS RESOLVER EXISTS FOR, stated as a rule rather than as a
     * console behaviour: a `charIndex` indexes ONE game's roster. The console
     * validated it and the element's own OBS source did not, so on every game
     * after the first the panel named one character and the broadcast drew
     * whoever now sat in that slot. `resolveSpotlight` is what both call.
     */
    it('discards a pick whose slot now holds someone else', () => {
        const s = {
            ...capture({ side1: [ch('Mario', { homeruns: 1 }), ch('Yoshi', { homeruns: 3 })] }),
            production: { feed: { last: { postgamecallout: {
                element: 'postgamecallout', scoreboard: 1, team: 1, charIndex: 0, name: 'Peach',
            } } } },
        };
        // Peach is not in this capture at all, let alone at slot 0.
        expect(resolveSpotlight(s, 1, s.production.feed.last.postgamecallout))
            .toMatchObject({ name: 'Yoshi', charIndex: 1, suggested: true });
    });

    // ...and keeps one that still names its character, which is what lets a
    // producer's choice survive a Bo3 where both sides keep their rosters.
    it('keeps a pick the new capture still agrees with', () => {
        const last = {
            element: 'postgamecallout', scoreboard: 1, team: 1, charIndex: 0, name: 'Mario',
        };
        const s = capture({ side1: [ch('Mario'), ch('Yoshi', { homeruns: 3 })] });
        expect(resolveSpotlight(s, 1, last)).toBe(last);
    });

    /*
     * A memory made on ANOTHER BOARD is not this board's answer. One spotlight
     * memory app-wide, a capture per board — so validating board 1's pick
     * against board 2's roster is the same slot confusion one axis over.
     */
    it('will not answer for one board with another board’s pick', () => {
        const last = {
            element: 'postgamecallout', scoreboard: 2, team: 1, charIndex: 0, name: 'Mario',
        };
        const s = capture({ side1: [ch('Mario'), ch('Yoshi', { homeruns: 3 })] });
        expect(resolveSpotlight(s, 1, last)).toMatchObject({ name: 'Yoshi', suggested: true });
    });
});

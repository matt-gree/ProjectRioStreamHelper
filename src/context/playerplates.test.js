import { describe, it, expect } from 'vitest';
import { normalizeConfig, blankSide, pairAnchor } from './playerplates';

/*
 * The band's config is normalized in TWO runtimes — here for the authoring panel
 * and in `normalize_config` (server/playerplates.py) for the projector — so the
 * two must agree on the same raw object. These pin the half that only this
 * runtime can get wrong: the legacy `mode` fold, and the participant pick that
 * makes a manual plate resolve through the address book.
 */
describe('playerplates normalizeConfig', () => {
    it('fills both sides and defaults them visible at their own anchor', () => {
        const cfg = normalizeConfig(null);
        expect(cfg.sides[1]).toEqual(blankSide('left'));
        expect(cfg.sides[2]).toEqual(blankSide('right'));
        expect(cfg.source).toBe('match');
    });

    it('has no band-wide mode of its own', () => {
        expect(normalizeConfig({ mode: 'both' }).mode).toBeUndefined();
    });

    // A `mode` of p1/p2 said which plates were included, which is exactly what
    // each side's eye says now — fold it so a config stored before the collapse
    // keeps its picture instead of silently putting the other plate back on air.
    it.each([
        ['p1', 2, 1],
        ['p2', 1, 2],
    ])('folds a legacy %s mode onto the visible flags', (mode, hidden, shown) => {
        const cfg = normalizeConfig({ mode, sides: { 1: {}, 2: {} } });
        expect(cfg.sides[hidden].visible).toBe(false);
        expect(cfg.sides[shown].visible).toBe(true);
        // Idempotent — the folded output normalizes to itself.
        expect(normalizeConfig(cfg).sides[hidden].visible).toBe(false);
    });

    it('leaves both plates up for a legacy both mode', () => {
        const cfg = normalizeConfig({ mode: 'both', sides: { 1: {}, 2: {} } });
        expect(cfg.sides[1].visible).toBe(true);
        expect(cfg.sides[2].visible).toBe(true);
    });

    it('keeps a manual plate’s address-book pick, and its raw-name hatch', () => {
        const cfg = normalizeConfig({
            source: 'manual',
            sides: { 1: { participantId: 'p_ally' }, 2: { name: 'Guest' } },
        });
        expect(cfg.sides[1].participantId).toBe('p_ally');
        expect(cfg.sides[2].participantId).toBeNull();
        expect(cfg.sides[2].name).toBe('Guest');
    });

    it('accepts sides keyed as strings or numbers', () => {
        const cfg = normalizeConfig({ sides: { '1': { name: 'A' }, 2: { name: 'B' } } });
        expect(cfg.sides[1].name).toBe('A');
        expect(cfg.sides[2].name).toBe('B');
    });
});

/*
 * `pairAnchor` is the client half of `pair_anchor` in server/playerplates.py:
 * side 1's location is the pair's ORDER and side 2 takes the other anchor. Two
 * runtimes, one rule — the panel has to show the arrangement the projector is
 * about to write, or the Order row reads back wrong the moment it is used.
 */
describe('playerplates pairAnchor', () => {
    it('puts side 1 left by default', () => {
        expect(pairAnchor('left')).toEqual({ 1: 'left', 2: 'right' });
    });

    it('mirrors the whole pair when side 1 takes the right anchor', () => {
        expect(pairAnchor('right')).toEqual({ 1: 'right', 2: 'left' });
    });

    // `center` is a LONE plate's anchor — a pair has no room for it, so a plate
    // parked there and re-paired falls back rather than landing on its partner.
    it.each([['center'], [undefined], [''], ['nonsense']])(
        'coerces %s back onto the default order', (loc) => {
            expect(pairAnchor(loc)).toEqual({ 1: 'left', 2: 'right' });
        });
});

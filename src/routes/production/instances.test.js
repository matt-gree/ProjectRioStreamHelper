import { describe, it, expect } from 'vitest';
import { instanceId, parseInstanceId, variantLabel, variantOf } from './instances';
import { boardDeskId, boardOfDeskId } from './boards';
import { ELEMENTS } from './elements';

const scoreboard = ELEMENTS.find(e => e.id === 'scoreboard');
const lowerthird = ELEMENTS.find(e => e.id === 'lowerthird');

/*
 * The identity half of a row id. Discovery moved to ./placements when scenes
 * became the grouping axis — a row exists because a SOURCE exists, so there is
 * nothing left to enumerate. What stays here is the id grammar every surface
 * keys on, and its job is keeping three namespaces apart.
 */
describe('instance ids', () => {
    it('qualifies a board-scoped element and leaves a global one alone', () => {
        expect(instanceId(scoreboard, 2)).toBe('scoreboard:2');
        expect(instanceId(lowerthird, 2)).toBe('lowerthird');
    });

    it('does not mistake a desk id for a board instance', () => {
        // A desk parsed as an instance would be selected as an element, and the
        // stage would offer to bind an OBS source for a content workflow.
        expect(parseInstanceId('desk:match')).toEqual({ elementId: 'desk:match', board: null, variant: null });
        expect(parseInstanceId('scoreboard:2')).toEqual({ elementId: 'scoreboard', board: 2, variant: null });
        expect(parseInstanceId('lowerthird')).toEqual({ elementId: 'lowerthird', board: null, variant: null });
    });

    /*
     * The rule used to be "a desk name must not be numeric", enforced by nothing
     * but the names in use: the pattern's head is greedy, so ANY id ending in
     * digits split. Boards are desks now and their ids carry a board number, so
     * `desk:board:2` would have parsed as element `desk:board` on board 2 — a
     * lookup for an element that does not exist, in place of the desk the
     * producer clicked.
     */
    it('leaves a desk id whole even when it ends in a board number', () => {
        expect(parseInstanceId('desk:board:2'))
            .toEqual({ elementId: 'desk:board:2', board: null, variant: null });
        expect(boardDeskId(2)).toBe('desk:board:2');
        expect(boardOfDeskId('desk:board:2')).toBe(2);
        expect(boardOfDeskId('desk:match')).toBeNull();
        // …and an element id that happens to start with the word is untouched.
        expect(parseInstanceId('board:2')).toEqual({ elementId: 'board', board: 2, variant: null });
    });
});

/*
 * The variant axis. Team-variant layouts are unregistered, so they row through
 * genericElement, which keys on the pathname — without this, team 1's and team
 * 2's sources are one id: duplicate rack keys, and a stage driving whichever
 * was found first.
 */
describe('variants', () => {
    it('takes a tag from every distinguishing param the URL names', () => {
        expect(variantOf('http://x/layout/scoreboard1/roster.html?team=2')).toBe('t2');
        expect(variantOf('http://x/layout/scoreboard1/scoreboard.html?scoreboard=2&size=s')).toBe('zs');
        expect(variantOf('http://x/layout/scoreboard1/stats.html?team=1&size=l')).toBe('t1.zl');
    });

    // An overlay with only one of itself must keep the id it has always had, or
    // every selection and pin stored before variants existed stops resolving.
    it('is empty when the URL names none, leaving legacy ids untouched', () => {
        expect(variantOf('http://x/layout/lowerthird/lowerthird.html')).toBe('');
        expect(variantOf('http://x/layout/scoreboard1/scoreboard.html?scoreboard=2')).toBe('');
        expect(instanceId(scoreboard, 2, 'http://x/layout/scoreboard1/scoreboard.html?scoreboard=2'))
            .toBe('scoreboard:2');
        // ?intro= and cache-busters distinguish nothing and must not shard an id.
        expect(variantOf('http://x/layout/lowerthird/lowerthird.html?intro=0&t=99')).toBe('');
    });

    it('carries the variant alongside the board, not instead of it', () => {
        const url = 'http://x/layout/scoreboard1/scoreboard.html?scoreboard=2&size=s';
        expect(instanceId(scoreboard, 2, url)).toBe('scoreboard:2~zs');
        expect(parseInstanceId('scoreboard:2~zs')).toEqual({ elementId: 'scoreboard', board: 2, variant: 'zs' });
    });

    it('reads back the way the producer picked it in the catalog', () => {
        expect(variantLabel('t2')).toBe('Team 2');
        expect(variantLabel('zs')).toBe('Small');
        expect(variantLabel('dleft')).toBe('Point Left');
        expect(variantLabel('t1.zl')).toBe('Team 1 · Large');
        expect(variantLabel('')).toBeNull();
    });
});

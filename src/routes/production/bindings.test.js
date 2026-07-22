import { describe, it, expect } from 'vitest';
import { instanceUrl } from './bindings';
import { ELEMENTS } from './elements';

/*
 * What is left of this module once the console derives its rows from the scenes
 * themselves: creating a source's URL.
 *
 * The instance-discrimination tests that lived here (boundIn / elementBindings /
 * the lone-candidate retry) went with the code they covered. They existed
 * because the rack held a list of elements and went LOOKING for each one's
 * source — the step scene grouping removed, since a row now exists because a
 * source exists and carries the scene item it was built from. The question they
 * protected ("does this panel command the board it was told to?") is still
 * pinned, in placements.test.js and sourcestrip.test.jsx.
 */

const el = (id) => ELEMENTS.find(e => e.id === id);

describe('instanceUrl', () => {
    it('qualifies a board-scoped element and leaves a global one bare', () => {
        expect(instanceUrl(el('scoreboard'), 2))
            .toBe('/layout/scoreboard1/scoreboard.html?scoreboard=2');
        // A Lower Third has no board, so writing ?scoreboard=2 onto it would
        // invent a distinction the overlay does not have.
        expect(instanceUrl(el('lowerthird'), 2)).toBe('/layout/lowerthird/lowerthird.html');
    });

    it('leaves the URL bare when no board is asked for', () => {
        expect(instanceUrl(el('scoreboard'), null)).toBe('/layout/scoreboard1/scoreboard.html');
    });

    it('marks exactly the elements whose source carries a board', () => {
        const scoped = ELEMENTS.filter(e => e.scope === 'board').map(e => e.id).sort();
        expect(scoped).toEqual(['hitvisualizer', 'scoreboard', 'scorecard']);
        // Fed elements must never be board-scoped — see the two mechanisms note
        // in elements.js.
        for (const e of ELEMENTS.filter(x => x.flavor === 'fed')) {
            expect(e.scope, e.id).not.toBe('board');
        }
    });
});

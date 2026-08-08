import { describe, it, expect } from 'vitest';
import { instanceUrl, placementDims } from './bindings';
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

    /*
     * Writing a variant back INTO a URL is what the catalog tier needs: with no
     * OBS there is no source to read a size off, so a row offering "Small" has
     * to be able to produce ?size=s or Copy URL hands over the Large board.
     */
    it('writes a variant into the URL alongside the board', () => {
        expect(instanceUrl(el('scoreboard'), 2, 'zs'))
            .toBe('/layout/scoreboard1/scoreboard.html?scoreboard=2&size=s');
        expect(instanceUrl(el('scoreboard'), null, 'zm'))
            .toBe('/layout/scoreboard1/scoreboard.html?size=m');
    });

    // The default size is the BARE url — the mount resolves a missing ?size= to
    // large, so spelling it would be a second way to say one thing.
    it('leaves the default size out of the URL', () => {
        expect(instanceUrl(el('scoreboard'), 1, '')).toBe('/layout/scoreboard1/scoreboard.html?scoreboard=1');
    });
});

describe('placementDims', () => {
    // The dimensions a producer sizes their browser source from. A variant row
    // quotes its OWN canvas: three sizes are three different sources, and a
    // strip offering Small at 800×460 would be worse than offering nothing.
    it('reports the variant’s canvas, not the element default', () => {
        expect(placementDims({ element: el('scoreboard'), variant: 'zs' }))
            .toEqual({ width: 388, height: 156 });
        expect(placementDims({ element: el('scoreboard'), variant: 'zm' }))
            .toEqual({ width: 600, height: 200 });
    });

    it('falls back to the element for a bare or unknown variant', () => {
        expect(placementDims({ element: el('scoreboard'), variant: '' }))
            .toEqual({ width: 800, height: 460 });
        expect(placementDims({ element: el('lowerthird'), variant: 't2' }))
            .toEqual({ width: el('lowerthird').width, height: el('lowerthird').height });
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

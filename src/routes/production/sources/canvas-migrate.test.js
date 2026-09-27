import { describe, it, expect } from 'vitest';
import { RETIRED_CANVASES, upgradeRetiredCanvas } from './canvas-migrate';
import { ELEMENTS } from '../elements';

const BAR = 'http://localhost:5260/layout/scoreboard1/statsbar.html?scoreboard=1&team=2';
const CARD = 'http://localhost:5260/layout/scoreboard1/statscard.html?scoreboard=1&team=1';

/*
 * A source built at a canvas that has since grown is resized on connect, and
 * nothing else is: the pass runs every time OBS connects, so a false match
 * would resize a producer's source over and over.
 */
describe('upgradeRetiredCanvas', () => {
    it('grows a Stat Bar or Stat Card built at the old size to the element\'s own', () => {
        expect(upgradeRetiredCanvas(BAR, 452, 118)).toMatchObject({ width: 452, height: 174 });
        expect(upgradeRetiredCanvas(CARD, 380, 240)).toMatchObject({ width: 380, height: 294 });
    });

    it('leaves a source already at the new size, or one sized by hand', () => {
        expect(upgradeRetiredCanvas(BAR, 452, 174)).toBeNull();
        expect(upgradeRetiredCanvas(BAR, 904, 236)).toBeNull();
    });

    it('matches the size to its own element, never another element\'s old size', () => {
        expect(upgradeRetiredCanvas(CARD, 452, 118)).toBeNull();
        expect(upgradeRetiredCanvas(BAR, 380, 240)).toBeNull();
        // A container is not one of its occupants.
        expect(upgradeRetiredCanvas('http://localhost:5260/layout/shared/container.html?container=statscard', 380, 240)).toBeNull();
    });

    it('never restates the new size — every retired entry names a live element that has outgrown it', () => {
        for (const r of RETIRED_CANVASES) {
            const el = ELEMENTS.find(e => e.id === r.element);
            expect(el).toBeTruthy();
            expect([el.width, el.height]).not.toEqual([r.width, r.height]);
        }
    });
});

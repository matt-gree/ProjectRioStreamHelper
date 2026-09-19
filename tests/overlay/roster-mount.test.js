// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderRoster, resolvePortraitStyle } from '../../public/layout/lib/roster-mount.js';
// The REAL rule, not a third copy of it: designConstants' settingOn is the
// app-side mirror of overlay-base's, and designConstants.test.js pins the two
// against each other by parsing the source. Stubbing a hand-written boolean
// check here would let this suite pass on a rule the overlay does not use.
import { settingOn } from '../../src/routes/design/designConstants';

/*
 * The roster's Pixel switch — off is smooth (what it always drew), on is what
 * every theme SVG does to its character art. Silent either way: a wrong
 * selector leaves the setting storing, broadcasting and changing nothing.
 */

function deepGet(obj, path, def) {
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur == null) return def;
        cur = cur[seg];
    }
    return cur === undefined ? def : cur;
}

const SLOTS = [
    { kind: 'captain', imgUrl: 'c.png', isStarred: false },
    { kind: 'char', imgUrl: '1.png', isStarred: true },
    { kind: 'role', imgUrl: 'bat.png', isStarred: false },
    { kind: 'teamLogo', imgUrl: 'logo.png', isStarred: false },
];

beforeEach(() => {
    globalThis.OverlayBase = { deepGet, settingOn, BASE_URL: '' };
    globalThis.RioData = { getRosterSlots: () => SLOTS };
    document.body.innerHTML = '';
});

function draw(pixelPortraits) {
    const grid = document.createElement('div');
    document.body.appendChild(grid);
    const settings = pixelPortraits === undefined ? {} : { overlays: { roster: { pixelPortraits } } };
    renderRoster(grid, { state: {}, settings, sb: 1, team: 1 });
    return grid;
}

const rendering = (img) => getComputedStyle(img).imageRendering;

describe('resolvePortraitStyle', () => {
    it('is smooth unless the switch is on', () => {
        expect(resolvePortraitStyle(true)).toBe('pixel');
        expect(resolvePortraitStyle(false)).toBe('smooth');
        expect(resolvePortraitStyle(undefined)).toBe('smooth');
        expect(resolvePortraitStyle('pixel')).toBe('smooth');
    });

    /*
     * A STORED SWITCH IS NOT ALWAYS A BOOLEAN. `PUT /api/v1/settings` takes its
     * value as a string and settings.json is hand-editable, so "true" / "false"
     * are shapes that really occur — and under the bare `v === true` this read
     * until 2026-09-12, a producer who set the switch over the API got smooth
     * portraits and a console switch that said Pixel.
     */
    it('reads a stringified switch the way the console does', () => {
        expect(resolvePortraitStyle('true')).toBe('pixel');
        expect(resolvePortraitStyle('false')).toBe('smooth');
    });
});

describe('renderRoster portraits', () => {
    it('draws smooth by default, so a roster already on air does not change', () => {
        const grid = draw(undefined);
        expect(grid.dataset.portraits).toBe('smooth');
        for (const img of grid.querySelectorAll('img')) expect(rendering(img)).not.toBe('pixelated');
    });

    it('pixelates the captain and the eight, and nothing else', () => {
        const grid = draw(true);
        expect(grid.dataset.portraits).toBe('pixel');
        expect(rendering(grid.querySelector('.captain-container img'))).toBe('pixelated');
        expect(rendering(grid.querySelector('.character-container img:not(.superstar-badge)'))).toBe('pixelated');
        // High-resolution art scaled DOWN — nearest-neighbour only adds jaggies.
        expect(rendering(grid.querySelector('.superstar-badge'))).not.toBe('pixelated');
        expect(rendering(grid.querySelector('.role-container img'))).not.toBe('pixelated');
        expect(rendering(grid.querySelector('.team-logo-container img'))).not.toBe('pixelated');
    });

    it('goes back to smooth when the setting is turned back', () => {
        const grid = draw(true);
        renderRoster(grid, { state: {}, settings: { overlays: { roster: { pixelPortraits: false } } }, sb: 1, team: 1 });
        expect(rendering(grid.querySelector('.captain-container img'))).not.toBe('pixelated');
    });
});

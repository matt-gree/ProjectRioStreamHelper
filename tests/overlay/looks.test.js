/*
 * LOOKS — a named variation of one element's settings, applied by overlay-base
 * to the settings object every mount reads. Tested against overlay-base.js
 * itself, the way type-roles.test.js is, plus the pure helpers in looks.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    defaultLookName, lookOfUrl, looksOf, newLookId, urlWithLook,
} from '../../public/layout/lib/looks.js';

const SRC = readFileSync('public/layout/lib/overlay-base.js', 'utf8');
const boot = () => { new Function(SRC)(); return window.OverlayBase; };

const overlays = () => ({
    global: { accentColor: '#f00' },
    statsbar: {
        showRoster: false,
        subLine: 'game',
        side1: { accentColor: '#0f0', showRoster: false },
        looks: { kbreak: { name: 'Break', values: { showRoster: true, accentColor: '#00f' } } },
    },
    scorecard: {
        showStadium: true,
        2: { showStadium: false },
        looks: { kslim: { name: 'Slim', values: { showStadium: false } } },
    },
    roster: { showSuperstars: true },
});

describe('projectLooks', () => {
    it('leaves Main alone when no look is named', () => {
        const OB = boot();
        const o = overlays();
        expect(OB.projectLooks(o, [])).toBe(o);
    });

    it('lays a look over the shared bag and leaves what it does not set', () => {
        const OB = boot();
        const p = OB.projectLooks(overlays(), ['kbreak']);
        expect(p.statsbar.showRoster).toBe(true);
        // Not in the look: follows Main.
        expect(p.statsbar.subLine).toBe('game');
    });

    // A look is one source's choice, the most specific thing there is, so it
    // wins over a per-side and a per-board copy as well.
    it('outranks every scope bag inside the element', () => {
        const OB = boot();
        const p = OB.projectLooks(overlays(), ['kbreak', 'kslim']);
        expect(p.statsbar.side1).toEqual({ accentColor: '#00f', showRoster: true });
        expect(p.scorecard[2].showStadium).toBe(false);
        expect(p.scorecard.showStadium).toBe(false);
    });

    it('touches only the element that owns the look, and never the stored copy', () => {
        const OB = boot();
        const o = overlays();
        const p = OB.projectLooks(o, ['kbreak']);
        expect(p.roster).toBe(o.roster);
        expect(o.statsbar.showRoster).toBe(false);
        expect(o.statsbar.side1.accentColor).toBe('#0f0');
    });

    it('lets a value cleared back to Main (stored null) follow Main', () => {
        const OB = boot();
        const o = overlays();
        o.statsbar.looks.kbreak.values.subLine = null;
        expect(OB.projectLooks(o, ['kbreak']).statsbar.subLine).toBe('game');
    });

    // A deleted look is simply Main: the source still draws.
    it('treats a look nothing owns as Main', () => {
        const OB = boot();
        const o = overlays();
        expect(OB.projectLooks(o, ['kgone'])).toBe(o);
    });
});

describe('looks.js', () => {
    it('reads and writes a source URL\'s look, keeping every other param', () => {
        const url = '/layout/scoreboard1/statsbar.html?team=2&scoreboard=1';
        const next = urlWithLook(url, 'kbreak');
        expect(lookOfUrl(next)).toBe('kbreak');
        expect(next).toContain('team=2');
        expect(lookOfUrl(urlWithLook(next, null))).toBeNull();
        expect(urlWithLook('http://h:5260/a.html?look=k1&team=1', null)).toBe('http://h:5260/a.html?team=1');
    });

    it('lists an element\'s looks and names the next one', () => {
        const looks = looksOf(overlays(), 'statsbar');
        expect(looks).toEqual([{ id: 'kbreak', name: 'Break', values: { showRoster: true, accentColor: '#00f' } }]);
        expect(defaultLookName([{ name: 'Look 1' }])).toBe('Look 2');
        expect(looksOf(overlays(), 'roster')).toEqual([]);
    });

    // The id rides in a placement id, where `.`, `~`, `@` and `+` separate parts.
    it('makes ids a placement id can carry', () => {
        expect(newLookId()).toMatch(/^k[a-z0-9]+$/);
    });
});

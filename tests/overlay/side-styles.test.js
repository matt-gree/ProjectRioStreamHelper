/*
 * SEPARATE SIDE STYLES — `overlays.global.splitSides`. The resolver every
 * per-side mount reads through (public/layout/lib/side-styles.js), the console
 * module that seeds and scopes it, and the override path through overlay-base.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { styleNs, styleSetting } from '../../public/layout/lib/side-styles.js';
import { seedSideStyles, sideStyleSegment } from '../../src/routes/design/sideStyles.js';

const PLAYERNAME = {
    nameSize: 48, align: 'auto', accentColor: '#111111',
    side2: { nameSize: 64, accentColor: '#222222' },
};
const settings = (splitSides) => ({
    overlays: { playername: PLAYERNAME, ...(splitSides === undefined ? {} : { global: { splitSides } }) },
});

describe('styleNs / styleSetting', () => {
    it('is the shared namespace while the switch is off — the default', () => {
        expect(styleNs(settings(), 'playername', 2)).toBe('playername');
        expect(styleNs(settings(false), 'playername', 2)).toBe('playername');
        expect(styleSetting(settings(), 'playername', 2, 'nameSize', 0)).toBe(48);
    });

    it('reads the side copy when on, falling back to the shared value', () => {
        const s = settings(true);
        expect(styleNs(s, 'playername', 2)).toBe('playername.side2');
        expect(styleSetting(s, 'playername', 2, 'nameSize', 0)).toBe(64);
        expect(styleSetting(s, 'playername', 2, 'align', null)).toBe('auto');
        // Side 1 has no copy: it keeps drawing the shared style.
        expect(styleSetting(s, 'playername', 1, 'nameSize', 0)).toBe(48);
        expect(styleSetting(s, 'playername', 1, 'prefixSize', 24)).toBe(24);
    });

    it('honours the string a PUT stores, like every other switch', () => {
        expect(styleNs(settings('true'), 'playername', 2)).toBe('playername.side2');
        expect(styleNs(settings('false'), 'playername', 2)).toBe('playername');
    });

    it('never splits a type that is not paired, or a missing side', () => {
        expect(styleNs(settings(true), 'scoreboard', 2)).toBe('scoreboard');
        expect(styleNs(settings(true), 'teamlogo', 2)).toBe('teamlogo');
        expect(styleNs(settings(true), 'playername', undefined)).toBe('playername');
    });
});

describe('overrides through overlay-base', () => {
    it('scopes a per-element pin to the side namespace a mount hands it', () => {
        document.documentElement.removeAttribute('style');
        new Function(readFileSync('public/layout/lib/overlay-base.js', 'utf8'))();
        const OB = window.OverlayBase;
        for (const k of Object.keys(OB.settings)) delete OB.settings[k];
        Object.assign(OB.settings, settings(true));
        OB.applyDesignSettings('playername', styleNs(OB.settings, 'playername', 2));
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#222222');
    });
});

describe('the console half', () => {
    it('scopes a panel only when split, paired and sided', () => {
        expect(sideStyleSegment('playername', 2, true)).toBe('side2');
        expect(sideStyleSegment('playername', 2, false)).toBeNull();
        expect(sideStyleSegment('scoreboard', 2, true)).toBeNull();
        expect(sideStyleSegment('roster', null, true)).toBeNull();
    });

    it('seeds both sides from the shared leaves, so turning on changes nothing on air', () => {
        const sets = seedSideStyles({ roster: { showSuperstars: false, textColor: '#abcdef' } });
        const keys = Object.fromEntries(sets.map(s => [s.key, s.value]));
        expect(keys['overlays.roster.side1.showSuperstars']).toBe(false);
        expect(keys['overlays.roster.side2.textColor']).toBe('#abcdef');
    });

    it('leaves a side it has already split alone, and never copies a side into a side', () => {
        const keys = seedSideStyles({ playername: PLAYERNAME }).map(s => s.key);
        expect(keys.some(k => k.startsWith('overlays.playername.side2.'))).toBe(false);
        expect(keys).toContain('overlays.playername.side1.nameSize');
        expect(keys.some(k => k.includes('side1.side2'))).toBe(false);
    });
});

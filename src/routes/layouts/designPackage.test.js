import { describe, it, expect } from 'vitest';
import { paintedByApp, packagePortColors, resolvePortColors } from './designPackage';
import { LAYOUT_SETTINGS, THEME_ELEMENT, DEFAULT_PORT_COLORS } from './designConstants';

// Shapes as the server reports them (server/design_packages.py _package_info).
const DEFAULT = { id: 'default', elements: ['statscard', 'stats', 'callout'], appVarElements: [] };
const CLASSIC = { id: 'classic', elements: ['stats', 'callout'], appVarElements: ['stats'] };
const PACKAGES = [DEFAULT, CLASSIC];

describe('paintedByApp', () => {
    it('answers from the active package when it themes the element', () => {
        expect(paintedByApp(PACKAGES, 'classic', 'stats')).toBe(true);
        expect(paintedByApp(PACKAGES, 'default', 'stats')).toBe(false);
    });

    /*
     * The tier is per element even inside one package — `classic` is the token
     * skin and its own callout is full-art. A per-package answer would offer
     * dead colour knobs there.
     */
    it('does not generalise a package’s tier across its own elements', () => {
        expect(paintedByApp(PACKAGES, 'classic', 'callout')).toBe(false);
    });

    /*
     * The engine falls back element-by-element to `default`, so an element the
     * active package omits is drawn by default's file and takes default's tier —
     * not the active package's.
     */
    it('follows the element-by-element fallback to default', () => {
        expect(paintedByApp(PACKAGES, 'classic', 'statscard')).toBe(false);
    });

    /*
     * Every unknown resolves to "keep showing it". A knob that turns out to be
     * inert is a confusion; a knob that silently disappears is a control the
     * producer cannot reach and has no way to ask about.
     */
    it('shows the setting whenever it cannot answer', () => {
        expect(paintedByApp(null, 'default', 'statscard')).toBe(true);         // still loading
        expect(paintedByApp(PACKAGES, 'deleted-on-disk', 'nothing')).toBe(true);
        expect(paintedByApp(PACKAGES, 'default', undefined)).toBe(true);       // type isn't themed
    });
});

/*
 * The port palette is the one thing a package declares package-WIDE, so it does
 * NOT take the element-by-element fallback to `default`: "this package says
 * nothing about ports" means the app's own palette, not another package's.
 * Falling back would make a token skin silently wear the default package's
 * ports, which is exactly the borrowed-identity bug the per-element fallback
 * exists to avoid for artwork.
 */
describe('packagePortColors', () => {
    const PORTS = [{ id: 'slice26', elements: [], appVarElements: [], portColors: ['#C5F707', null, null, null] }, DEFAULT];

    it('reads the active package’s declaration', () => {
        expect(packagePortColors(PORTS, 'slice26')).toEqual(['#C5F707', null, null, null]);
    });

    it('answers empty for a package that declares none — no fallback to default', () => {
        expect(packagePortColors(PORTS, 'default')).toEqual([]);
    });

    it('answers empty for anything it cannot resolve', () => {
        expect(packagePortColors(null, 'slice26')).toEqual([]);
        expect(packagePortColors(PORTS, 'deleted-on-disk')).toEqual([]);
    });
});

/*
 * Must resolve exactly as public/layout/lib/port-colors.js does, or the Design
 * tab and the Match desk show one palette while the broadcast draws another.
 */
describe('resolvePortColors', () => {
    it('takes the producer’s choice first, then the package, then the app', () => {
        const got = resolvePortColors(
            ['#ff0000', null, null, null],
            [null, '#57E0E7', null, null],
        );
        expect(got[0]).toEqual({ color: '#ff0000', source: 'user' });
        expect(got[1]).toEqual({ color: '#57E0E7', source: 'package' });
        expect(got[2]).toEqual({ color: DEFAULT_PORT_COLORS[2], source: 'default' });
    });

    /*
     * Per port, not per palette. Pinning port 1 must not drop the package's
     * ports 2-4 back to the stock colours — that would make one deliberate
     * override silently undo the whole theme.
     */
    it('mixes sources within one palette', () => {
        const declared = ['#111111', '#222222', '#333333', '#444444'];
        const got = resolvePortColors(['#ff0000', null, null, null], declared);
        expect(got.map(p => p.color)).toEqual(['#ff0000', '#222222', '#333333', '#444444']);
    });

    it('is the built-in palette when nothing is set anywhere', () => {
        const got = resolvePortColors([], []);
        expect(got.map(p => p.color)).toEqual(DEFAULT_PORT_COLORS);
        expect(got.every(p => p.source === 'default')).toBe(true);
    });
});

describe('THEME_ELEMENT', () => {
    /*
     * The map exists only to gate `appPalette` settings, so an entry with no
     * such setting gates nothing and a setting with no entry is never gated.
     * Either one is a silent no-op, which is why they're pinned together.
     */
    it('covers exactly the types carrying an app-palette setting', () => {
        const gated = Object.keys(LAYOUT_SETTINGS)
            .filter(type => LAYOUT_SETTINGS[type].some(d => d.appPalette));
        // No exceptions. `stats` used to be one, because the type was shared by
        // the fed HTML bar (always app-painted) and the themed SVG source and
        // there was no single answer. The fed bar is shelved, so there is.
        expect(gated).toEqual(Object.keys(THEME_ELEMENT));
    });
});

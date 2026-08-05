import { describe, it, expect } from 'vitest';
import { paintedByApp } from './designPackage';
import { LAYOUT_SETTINGS, THEME_ELEMENT } from './designConstants';

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

describe('THEME_ELEMENT', () => {
    /*
     * The map exists only to gate `appPalette` settings, so an entry with no
     * such setting gates nothing and a setting with no entry is never gated.
     * Either one is a silent no-op, which is why they're pinned together.
     */
    it('covers exactly the types carrying an app-palette setting', () => {
        const gated = Object.keys(LAYOUT_SETTINGS)
            .filter(type => LAYOUT_SETTINGS[type].some(d => d.appPalette));
        // `stats` is deliberately ungated: the type is shared by the fed HTML
        // bar (always app-painted) and the themed SVG source, so there is no
        // single answer for it. See the comment on THEME_ELEMENT.
        expect(gated.filter(t => t !== 'stats')).toEqual(Object.keys(THEME_ELEMENT));
    });
});

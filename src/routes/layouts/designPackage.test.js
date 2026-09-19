import { describe, it, expect } from 'vitest';
import {
    paintedByApp, appPaletteThemesAnything, packagePortColors, resolvePortColors, drawnTypeRoles, globalReach,
} from './designPackage';
import { LAYOUT_SETTINGS, THEME_ELEMENT, DEFAULT_PORT_COLORS } from './designConstants';

// Shapes as the server reports them (server/design_packages.py _package_info).
const DEFAULT = { id: 'default', elements: ['statscard', 'stats', 'callout'], appVarElements: [] };
const CLASSIC = { id: 'classic', elements: ['stats', 'callout'], appVarElements: ['stats'] };
const PACKAGES = [DEFAULT, CLASSIC];

describe('drawnTypeRoles', () => {
    const WITH_ROLES = [
        { ...DEFAULT, typeRoles: { statscard: ['display', 'body', 'mono'], stats: ['body', 'mono'], callout: [] } },
        { ...CLASSIC, typeRoles: { stats: ['body'], callout: [] } },
    ];

    it('answers per file, from the package that draws the element', () => {
        expect(drawnTypeRoles(WITH_ROLES, 'classic', 'stats')).toEqual(['body']);
        expect(drawnTypeRoles(WITH_ROLES, 'default', 'stats')).toEqual(['body', 'mono']);
        // classic omits the stat card, so default's file draws it.
        expect(drawnTypeRoles(WITH_ROLES, 'classic', 'statscard')).toEqual(['display', 'body', 'mono']);
    });

    // Empty is an ANSWER — this theme sets no text in any role — and is not
    // the same as unknown, which must not filter anything.
    it('tells "draws none" apart from "cannot say"', () => {
        expect(drawnTypeRoles(WITH_ROLES, 'default', 'callout')).toEqual([]);
        expect(drawnTypeRoles(null, 'default', 'stats')).toBeNull();           // still loading
        expect(drawnTypeRoles(PACKAGES, 'default', 'stats')).toBeNull();       // older payload
        expect(drawnTypeRoles(WITH_ROLES, 'default', undefined)).toBeNull();   // type isn't themed
    });
});

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
 * The Design tab's GLOBAL knobs are not one element's, so they ask a different
 * question: is there any themed element left for the app palette to paint. The
 * answer is assembled from the per-element one — never from a package-wide tier.
 */
describe('appPaletteThemesAnything', () => {
    it('is false under a package that paints every element it themes', () => {
        // `default` ships exactly this way, so it is the out-of-the-box answer.
        expect(appPaletteThemesAnything(PACKAGES, 'default')).toBe(false);
    });

    it('is true while ONE element is still app-painted', () => {
        // classic's own callout is full-art and its statscard falls back to
        // default's — `stats` alone is enough to keep the knobs, because that
        // element is what they still reach.
        expect(appPaletteThemesAnything(PACKAGES, 'classic')).toBe(true);
    });

    /*
     * The element-by-element fallback counts. A package that themes nothing at
     * all (a manifest-only package declaring just portColors) draws every
     * element from `default`, so it inherits default's answer rather than
     * answering "no elements, nothing to paint".
     */
    it('follows the fallback for elements the active package omits', () => {
        const PORTS_ONLY = { id: 'slice26', elements: [], appVarElements: [] };
        expect(appPaletteThemesAnything([DEFAULT, PORTS_ONLY], 'slice26')).toBe(false);
        expect(appPaletteThemesAnything([CLASSIC, PORTS_ONLY], 'slice26')).toBe(true);
    });

    it('shows the controls whenever it cannot answer', () => {
        expect(appPaletteThemesAnything(null, 'default')).toBe(true);        // still loading
        expect(appPaletteThemesAnything([], 'default')).toBe(true);          // no packages at all
        expect(appPaletteThemesAnything(PACKAGES, 'deleted-on-disk')).toBe(false); // falls back to default
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
     * A setting with no entry is never gated — a silent no-op — so every type
     * carrying an `appPalette` def must have a stem.
     *
     * This used to be an EQUALITY: the map's only job was gating those settings,
     * so an extra entry gated nothing and was just as much a mistake. It has a
     * second caller now — the per-element style overrides, which every themed
     * element has whether or not it carries an `appPalette` def of its own — so
     * the map is deliberately wider than the settings that started it, and the
     * rule that survives is the one that catches a real no-op. The other half
     * moved to designConstants.test.js, which pins the map against the mounts.
     */
    it('covers every type carrying an app-palette setting', () => {
        const gated = Object.keys(LAYOUT_SETTINGS)
            .filter(type => LAYOUT_SETTINGS[type].some(d => d.appPalette));
        // `stats` used to be absent, because the type was shared by the fed HTML
        // bar (always app-painted) and the themed SVG source and there was no
        // single answer. The fed bar is deleted, so there is.
        expect(gated).toEqual(['statsbar', 'statscard']);
        for (const type of gated) expect(THEME_ELEMENT).toHaveProperty(type);
    });
});

describe('globalReach', () => {
    const pkgs = [
        { id: 'default', elements: ['scoreboard-l', 'scoreboard-s', 'scorecard', 'ticker'], appVarElements: [] },
        { id: 'classic', elements: ['scoreboard-l', 'scoreboard-s', 'ticker'], appVarElements: ['scoreboard-l', 'scoreboard-s', 'ticker'] },
    ];

    it('under a full-art package the palette reaches only the two unthemed overlays', () => {
        const r = globalReach(pkgs, 'default');
        expect(r.palette).toEqual(['Event Header', 'Player Name']);
        expect(r.chrome).toEqual([]);
        expect(r.badge).toEqual([]);
    });

    it('under a token skin it reaches every app-painted element, falling back per file', () => {
        const r = globalReach(pkgs, 'classic');
        expect(r.chrome).toEqual(['Scoreboard', 'Ticker']);   // scorecard falls back to default: full-art
        expect(r.badge).toEqual(['Scoreboard']);
        expect(r.palette).toContain('Event Header');
    });

    it('says nothing before the package list has loaded', () => {
        expect(globalReach(null, 'classic')).toBeNull();
    });
});

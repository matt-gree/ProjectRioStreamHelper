import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
    LAYOUT_SETTINGS,
    OVERRIDABLE_GLOBAL_KEYS,
    GLOBAL_DESIGN_KEYS,
    GLOBAL_DESIGN_DEFAULTS,
    PORT_COLOR_KEYS,
    DEFAULT_PORT_COLORS,
    OVERRIDE_CAPABLE_TYPES,
    THEME_ELEMENT,
    themeElementFor,
    overrideReaches,
} from './designConstants';

describe('global design keys', () => {
    it('every key has a default', () => {
        // LayoutBrowser resolves `globalDesign[key] ?? GLOBAL_DESIGN_DEFAULTS[key]`,
        // so a key without a default would resolve to undefined in the UI.
        for (const key of GLOBAL_DESIGN_KEYS) {
            expect(GLOBAL_DESIGN_DEFAULTS).toHaveProperty(key);
        }
    });

    it('has no duplicate keys', () => {
        expect(new Set(GLOBAL_DESIGN_KEYS).size).toBe(GLOBAL_DESIGN_KEYS.length);
    });

    it('defaults map has no orphan keys not in the key list', () => {
        for (const key of Object.keys(GLOBAL_DESIGN_DEFAULTS)) {
            expect(GLOBAL_DESIGN_KEYS).toContain(key);
        }
    });
});

describe('overridable global keys', () => {
    it('every override targets a real global key', () => {
        for (const def of OVERRIDABLE_GLOBAL_KEYS) {
            expect(GLOBAL_DESIGN_KEYS).toContain(def.key);
        }
    });

    it('default values agree with GLOBAL_DESIGN_DEFAULTS', () => {
        // Two sources of truth for defaults must not drift.
        for (const def of OVERRIDABLE_GLOBAL_KEYS) {
            if ('defaultValue' in def) {
                expect(def.defaultValue).toEqual(GLOBAL_DESIGN_DEFAULTS[def.key]);
            }
        }
    });
});

/*
 * The port palette lives in three runtimes — the app (here), the overlays
 * (public/layout/lib/port-colors.js) and the built-in Default package's
 * manifest. They must agree: a producer who has set nothing should see one
 * palette in the Match desk's port grid, in the Design tab and on air, and a
 * mismatch shows up only as "the port dots don't match the scoreboard".
 */
describe('the controller-port palette', () => {
    const read = (p) => readFileSync(p, 'utf8');

    it('is a global — never a per-element setting again', () => {
        // The collision test below is what enforces this: a port key defined
        // under any LAYOUT_SETTINGS type now fails, because it is a global.
        for (const key of PORT_COLOR_KEYS) expect(GLOBAL_DESIGN_KEYS).toContain(key);
    });

    it('inherits by default, so a design package can supply it', () => {
        // A literal hex here would pin the app's palette over every package.
        for (const key of PORT_COLOR_KEYS) expect(GLOBAL_DESIGN_DEFAULTS[key]).toBeNull();
    });

    it('matches the overlay runtime’s copy', () => {
        const src = read('public/layout/lib/port-colors.js');
        const arr = src.match(/DEFAULT_PORT_COLORS\s*=\s*\[([^\]]*)\]/);
        expect(arr, 'port-colors.js exports DEFAULT_PORT_COLORS').toBeTruthy();
        const colors = arr[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        expect(colors).toEqual(DEFAULT_PORT_COLORS);
    });

    it('matches what the built-in Default package declares', () => {
        const manifest = JSON.parse(read('public/design/default/package.json'));
        expect(manifest.portColors).toEqual(DEFAULT_PORT_COLORS);
    });
});

describe('layout settings', () => {
    it('each layout type maps to an array of settings with keys', () => {
        for (const [type, defs] of Object.entries(LAYOUT_SETTINGS)) {
            expect(Array.isArray(defs), type).toBe(true);
            for (const def of defs) {
                expect(def, type).toHaveProperty('key');
                expect(def).toHaveProperty('type');
            }
        }
    });

    it('no setting key collides with a global design key', () => {
        // Element-only settings must not shadow a globally-themed knob.
        for (const [type, defs] of Object.entries(LAYOUT_SETTINGS)) {
            for (const def of defs) {
                expect(GLOBAL_DESIGN_KEYS, `${type}.${def.key}`).not.toContain(def.key);
            }
        }
    });
});

/*
 * ── Which mounts are painted by the app palette ──
 *
 * OVERRIDE_CAPABLE_TYPES decides whether an element is offered per-element style
 * overrides at all, and it is a claim about the OVERLAY CODE — so it is checked
 * against that code rather than trusted. Nothing else can catch the two ways it
 * drifts: a new mount that applies the palette and never gets listed has
 * unreachable overrides, and a listed type whose mount stops applying gets rows
 * that quietly change nothing.
 *
 * Deliberately NOT derived from the `<meta name="overlay-settings">` whitelist,
 * which answers a different question: postgame/spotlight.html and summary.html
 * both declare `accentColor, fontFamily` and honour them for real, reading
 * `overlays.global.*` directly — but neither calls applyDesignSettings, the only
 * code that consults a per-element `overlays.{type}.{key}` pin.
 */
describe('OVERRIDE_CAPABLE_TYPES', () => {
    const LIB = 'public/layout/lib';

    // stats-card-mount serves BOTH cards from one file — the caller passes the
    // namespace (`settingsType || 'statsbar'`), so the file names no single
    // type and the pair is declared here instead.
    const PARAMETERISED = { 'stats-card-mount.js': ['statsbar', 'statscard'] };

    // Applies the palette but is SHELVED (bracket group), so the console never
    // offers it and it is deliberately absent from the list.
    const SHELVED = new Set(['bracket']);

    const typesAppliedBy = (file, src) => {
        if (PARAMETERISED[file]) return PARAMETERISED[file];
        const out = new Set();
        for (const m of src.matchAll(/applyDesignSettings\(\s*([^,)]+)/g)) {
            const arg = m[1].trim();
            const literal = arg.match(/^['"]([a-z0-9-]+)['"]$/i);
            if (literal) { out.add(literal[1]); continue; }
            if (arg === 'SETTINGS_TYPE') {
                const c = src.match(/const SETTINGS_TYPE = ['"]([a-z0-9-]+)['"]/i);
                if (c) out.add(c[1]);
            }
        }
        return [...out];
    };

    it('lists exactly the mounts that can honour a per-element pin', () => {
        const found = new Set();
        for (const file of readdirSync(LIB).filter(f => f.endsWith('-mount.js'))) {
            const text = readFileSync(`${LIB}/${file}`, 'utf8');
            if (!text.includes('applyDesignSettings')) continue;
            for (const type of typesAppliedBy(file, text)) {
                if (!SHELVED.has(type)) found.add(type);
            }
        }
        expect([...found].sort()).toEqual([...OVERRIDE_CAPABLE_TYPES].sort());
    });

    /*
     * A themed type needs a stem or the full-art gate silently never fires; an
     * ABSENT type means "no theme SVG draws this", which is what makes the
     * Event Header and Player Name the two elements the palette always reaches.
     */
    it('gives every themed type a theme stem, and the two unthemed ones none', () => {
        const unthemed = OVERRIDE_CAPABLE_TYPES.filter(t => !THEME_ELEMENT[t]);
        expect(unthemed.sort()).toEqual(['eventheader', 'playername']);
    });

    it('resolves the scoreboard’s stem from the source’s size', () => {
        expect(themeElementFor('scoreboard', 's')).toBe('scoreboard-s');
        expect(themeElementFor('scoreboard', 'm')).toBe('scoreboard-l');
        // The mount resolves an unknown or absent size to `l`, so this must too
        // — a stem no package can have shipped would answer "not themed" and
        // wrongly leave the controls live.
        expect(themeElementFor('scoreboard', 'xl')).toBe('scoreboard-l');
        expect(themeElementFor('scoreboard')).toBe('scoreboard-l');
    });

    /*
     * The gate for an element's OWN appPalette settings (useLiveDefs) reads the
     * same map, so a type carrying one without a stem gates nothing at all.
     */
    it('covers every type carrying an app-palette setting', () => {
        for (const type of Object.keys(LAYOUT_SETTINGS)) {
            if (LAYOUT_SETTINGS[type].some(d => d.appPalette)) {
                expect(THEME_ELEMENT).toHaveProperty(type);
            }
        }
    });
});

/*
 * ── Where a per-element pin is actually read back ──
 *
 * The console offers `overlays.{type}.{key}` rows off this, and a row that
 * cannot be read back is the worst kind of control: it stores, it broadcasts,
 * it reads back on the panel, and the overlay ignores it. overlay-base.js is
 * the only authority on which reads exist, so it is what this checks.
 */
describe('overrideReaches', () => {
    const base = readFileSync('public/layout/lib/overlay-base.js', 'utf8');
    // The map body — `const LAYOUT_VAR_MAP = { … };` up to the closing brace at
    // column 2, which is how this file formats its top-level consts.
    const varMap = base.slice(base.indexOf('const LAYOUT_VAR_MAP = {')).split('\n  };')[0];

    it('agrees with the universal reads applyDesignSettings performs', () => {
        // Read off `overrideNs` for any caller, so they reach every type.
        for (const key of [
            'accentColor', 'fontFamily', 'finalBadgeColor', 'cardShadowBlur', 'textShadowBlur',
            'textStrokeWidth', 'textStrokeColor',
        ]) {
            expect(base).toContain(`overlays.${'${overrideNs}'}.${key}`);
            expect(overrideReaches(key, 'commentary')).toBe(true);
            expect(overrideReaches(key, 'scoreboard')).toBe(true);
        }
    });

    /*
     * The font border is a THIRD gate away from being offered: the reads above
     * are universal, so what decides which elements get the row is the layout's
     * own <meta> declaration. Player Name is the only mount whose CSS binds
     * --text-stroke-*, and it is the only layout that declares it — a second
     * layout claiming the key without painting it would be a row that stores,
     * broadcasts and changes nothing.
     */
    it('is declared only by the layout that actually paints a font border', () => {
        const declaring = readdirSync('public/layout', { recursive: true })
            .filter(f => String(f).endsWith('.html'))
            .filter(f => readFileSync(`public/layout/${f}`, 'utf8')
                .match(/<meta name="overlay-settings" content="([^"]*)"/)?.[1]
                ?.split(',').map(x => x.trim()).includes('textStroke'));
        expect(declaring).toEqual(['scoreboard1/playername.html']);
        // Matched on the two vars rather than a literal declaration: the mount
        // scales its own type, so the WIDTH is a calc() off --pn-scale (and
        // half of it again on the prefix). What has to hold is that both halves
        // of the setting reach a -webkit-text-stroke at all.
        const strokes = readFileSync('public/layout/lib/playername-mount.js', 'utf8')
            .match(/-webkit-text-stroke:[^;]*;/g) ?? [];
        expect(strokes.length).toBeGreaterThan(0);
        for (const decl of strokes) {
            expect(decl).toContain('var(--text-stroke-width, 0px)');
            expect(decl).toContain('var(--text-stroke-color, transparent)');
        }
    });

    /*
     * The card surface is per-type, and the console must not offer it where the
     * map is silent — a `cardBg` pin on the ticker changes nothing.
     */
    it('offers the card surface only where LAYOUT_VAR_MAP carries it', () => {
        expect(varMap).toContain('scoreboard: { ...CARD_OVERRIDE_VARS');
        for (const key of ['cardBg', 'borderColor', 'borderRadius', 'borderWidth']) {
            expect(overrideReaches(key, 'scoreboard')).toBe(true);
            expect(overrideReaches(key, 'ticker')).toBe(false);
            expect(overrideReaches(key, 'commentary')).toBe(false);
        }
    });

    /*
     * `statsbar` draws a card and still gets none of those rows, because
     * LAYOUT_VAR_MAP keys them under `stats` — the name the element had before
     * the 2026-08-23 rename. This test states the CURRENT truth so the console
     * and the runtime agree; if the map is ever renamed, this is what will fail
     * and send you here to widen the list in the same change.
     */
    it('records that the stats card’s surface pins do not reach it', () => {
        expect(varMap).toContain('stats: STATS_VARS');
        expect(varMap).not.toContain('statsbar:');
        expect(overrideReaches('cardBg', 'statsbar')).toBe(false);
    });

    it('offers textColor only where a var map binds it', () => {
        expect(varMap).toContain("playername: { textColor:");
        expect(overrideReaches('textColor', 'playername')).toBe(true);
        expect(overrideReaches('textColor', 'scoreboard')).toBe(true);
        expect(overrideReaches('textColor', 'eventheader')).toBe(false);
    });

    /*
     * showShadow is read as a bare global with no per-element read anywhere —
     * and scoreboard.html whitelists it, so without this the console would have
     * offered it a row.
     */
    it('never offers showShadow, which has no per-element read at all', () => {
        expect(base).toContain("g('overlays.global.showShadow'");
        expect(base).not.toContain('.showShadow`, null)');
        expect(overrideReaches('showShadow', 'scoreboard')).toBe(false);
    });

    // These two skip applyDesignSettings entirely — the mounts resolve them with
    // readSetting, which does its own per-layout-then-global lookup.
    it('follows the two switches their mounts resolve themselves', () => {
        expect(readFileSync('public/layout/lib/ticker-mount.js', 'utf8'))
            .toContain("readSetting(SETTINGS_TYPE, 'showCaptains'");
        expect(overrideReaches('showCaptains', 'ticker')).toBe(true);
        expect(overrideReaches('showCaptains', 'scoreboard')).toBe(false);

        expect(readFileSync('public/layout/lib/scoreboard-mount.js', 'utf8'))
            .toContain("readSetting(SETTINGS_TYPE, 'showLogo'");
        expect(overrideReaches('showLogo', 'scoreboard')).toBe(true);
        expect(overrideReaches('showLogo', 'ticker')).toBe(false);
    });
});

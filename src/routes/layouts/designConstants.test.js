import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    LAYOUT_SETTINGS,
    OVERRIDABLE_GLOBAL_KEYS,
    GLOBAL_DESIGN_KEYS,
    GLOBAL_DESIGN_DEFAULTS,
    PORT_COLOR_KEYS,
    DEFAULT_PORT_COLORS,
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

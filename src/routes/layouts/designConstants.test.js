import { describe, it, expect } from 'vitest';
import {
    LAYOUT_SETTINGS,
    OVERRIDABLE_GLOBAL_KEYS,
    GLOBAL_DESIGN_KEYS,
    GLOBAL_DESIGN_DEFAULTS,
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

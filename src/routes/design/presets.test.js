import { describe, it, expect } from 'vitest';
import {
    elementPins, snapshotPreset, planApply, wearsPreset, normalizePreset, presetIdFor, listPresets,
    parseImport, DEFAULT_PRESET, PRESET_ELEMENT_KEYS,
} from './presets';
import { GLOBAL_DESIGN_DEFAULTS } from './designConstants';

const overlaysA = () => ({
    global: { ...GLOBAL_DESIGN_DEFAULTS, designPackage: 'classic', accentColor: '#ff0000', displayFont: 'Oswald' },
    presets: { old: { version: 2 } },
    schema_version: 5,
    // A pin on an element with no LAYOUT_SETTINGS array — the legacy presets never saw these.
    lowerthird: { accentColor: '#00ff00' },
    // Per-board namespaces, plus content toggles that are NOT the preset.
    scorecard: { '2': { bodyFont: 'Inter Tight', showHeader: false }, mainMode: 'rosters' },
    statsbar: { statValueColor: '#abcdef', transitionType: 'none' },
    eventheader: { bands: { header: [{ id: 'title', on: true }] }, headerFontSize: 40 },
});

describe('elementPins', () => {
    it('finds pins at both depths, on every element, and nothing that is content', () => {
        expect(elementPins(overlaysA())).toEqual({
            'lowerthird.accentColor': '#00ff00',
            'scorecard.2.bodyFont': 'Inter Tight',
            'statsbar.statValueColor': '#abcdef',
        });
    });

    it('treats the three font roles, the stroke pair and the rail as preset keys', () => {
        for (const k of ['displayFont', 'bodyFont', 'monoFont', 'textStrokeWidth', 'textStrokeColor', 'showRail']) {
            expect(PRESET_ELEMENT_KEYS.has(k), k).toBe(true);
        }
        expect(PRESET_ELEMENT_KEYS.has('mainMode')).toBe(false);
        expect(PRESET_ELEMENT_KEYS.has('nameSize')).toBe(false);
    });
});

describe('planApply — a preset REPLACES what it covers', () => {
    it('unsets every pin the preset does not carry, and leaves content alone', () => {
        const b = snapshotPreset({ global: { ...GLOBAL_DESIGN_DEFAULTS }, scoreboard: { '1': { accentColor: '#111111' } } }, { id: 'b', name: 'B' });
        const { sets, unsets } = planApply(overlaysA(), b);
        expect(unsets.sort()).toEqual([
            'overlays.lowerthird.accentColor',
            'overlays.scorecard.2.bodyFont',
            'overlays.statsbar.statValueColor',
        ]);
        expect(sets).toContainEqual({ key: 'overlays.scoreboard.1.accentColor', value: '#111111' });
        expect(sets).toContainEqual({ key: 'overlays.global.designPackage', value: 'default' });
        expect(sets).toContainEqual({ key: 'overlays.global.displayFont', value: 'Rajdhani' });
        const touched = [...sets.map(s => s.key), ...unsets];
        expect(touched.some(k => /mainMode|showHeader|transitionType|bands|headerFontSize/.test(k))).toBe(false);
    });

    it('is empty once applied, which is what "modified" measures', () => {
        const a = overlaysA();
        const preset = snapshotPreset(a, { id: 'a', name: 'A' });
        expect(wearsPreset(a, preset)).toBe(true);
        a.lowerthird.accentColor = '#0000ff';
        expect(wearsPreset(a, preset)).toBe(false);
    });

    it('resolves a global the preset predates to its default rather than keeping today’s', () => {
        const preset = { global: { accentColor: '#123456' }, pins: {} };
        const { sets } = planApply(overlaysA(), preset);
        expect(sets).toContainEqual({ key: 'overlays.global.designPackage', value: 'default' });
    });

    it('does not rewrite a value stored as a string by the REST API', () => {
        const a = { global: { ...GLOBAL_DESIGN_DEFAULTS, textStrokeWidth: '2' } };
        const preset = { global: { ...GLOBAL_DESIGN_DEFAULTS, textStrokeWidth: 2 }, pins: {} };
        expect(planApply(a, preset).sets).toEqual([]);
    });

    it('the defaults preset clears every pin', () => {
        const { unsets } = planApply(overlaysA(), DEFAULT_PRESET);
        expect(unsets).toHaveLength(3);
    });
});

describe('normalizePreset', () => {
    it('reads a v2 preset’s pins out of its whole layout bags, and drops the content', () => {
        const preset = normalizePreset({
            version: 2,
            global: { accentColor: '#ff00ff' },
            layouts: { scorecard: { '1': { accentColor: '#010101', showPhase: false } }, ticker: { tickerSpeed: 90, showCaptains: false } },
        }, 'My Old Preset');
        expect(preset.name).toBe('My Old Preset');
        expect(preset.legacy).toBe(true);
        expect(preset.global).toEqual({ accentColor: '#ff00ff' });
        expect(preset.pins).toEqual({ 'scorecard.1.accentColor': '#010101', 'ticker.showCaptains': false });
    });

    it('reads a v1 preset, which was the globals flat on the object', () => {
        expect(normalizePreset({ accentColor: '#222222', junk: 1 }, 'v1').global).toEqual({ accentColor: '#222222' });
    });
});

describe('ids and listing', () => {
    it('makes a settings-key-safe id with no dots, unique among what exists', () => {
        expect(presetIdFor('SLICE 26 v1.2', [])).toBe('slice-26-v1-2');
        expect(presetIdFor('Slice 26', ['slice-26'])).toBe('slice-26-2');
        expect(presetIdFor('***', [])).toBe('preset');
    });

    it('lists oldest first and skips deleted entries', () => {
        const list = listPresets({
            b: { version: 3, name: 'B', savedAt: '2026-09-02', global: {}, pins: {} },
            a: { version: 3, name: 'A', savedAt: '2026-09-01', global: {}, pins: {} },
            gone: null,
        });
        expect(list.map(l => l.id)).toEqual(['a', 'b']);
    });
});

describe('parseImport', () => {
    it('rejects a file that is not a preset', () => {
        expect(parseImport({ hello: 'world' }, 'x')).toBeNull();
        expect(parseImport([], 'x')).toBeNull();
    });

    it('accepts an exported preset', () => {
        const preset = snapshotPreset(overlaysA(), { id: 'slice', name: 'Slice' });
        expect(parseImport(JSON.parse(JSON.stringify(preset)), 'file').pins).toEqual(preset.pins);
    });
});

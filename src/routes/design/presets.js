// Design PRESETS — a saved, swappable answer to "what does this show look like".
//
// A preset is what a producer switches between tournaments: SLICE 26's preset, then
// next month's league preset, without touching a single control in between. So a
// preset is exactly the settings that decide how the broadcast LOOKS, and nothing
// that decides what it SHOWS:
//
//   in    the design package · every global design key (palette, type, text
//         effects, card chrome, the three display toggles, the port palette) ·
//         every per-element STYLE pin, at every namespace depth
//         (`overlays.lowerthird.accentColor`, `overlays.scorecard.2.bodyFont`) ·
//         each element's own palette settings (Stat Value Color, …) · the logo
//   out   element CONTENT and layout — which bands a card draws, the Event
//         Header's fields, a name size, a ticker's speed. Those are flipped
//         during a show; loading a preset mid-broadcast must never undo them.
//
// APPLYING A PRESET REPLACES WHAT IT COVERS. That is the whole point, and it is
// what the legacy (pre-v3) presets got wrong: they wrote the values they held and left
// everything else alone, so loading tournament B over tournament A kept every
// one of A's element pins that B happened not to set — and the only way back to
// a clean slate was a reset that forgot the elements the preset had never
// captured (commentary, matchup, player plates and the lower third have no
// LAYOUT_SETTINGS array, so their pins were never saved and never cleared).
//
// Pure functions over the `overlays` settings subtree; the Design tab owns the
// store writes (one batched commit — see Settings.ApplyBatch) and the logo.

import {
    GLOBAL_DESIGN_KEYS, GLOBAL_DESIGN_DEFAULTS, OVERRIDABLE_GLOBAL_KEYS, LAYOUT_SETTINGS,
} from './designConstants';

export const PRESET_VERSION = 3;

// Settings keys that are pins of the PRESET wherever they sit under an element
// namespace. `showRail` is a global with a per-board pin but no override row.
export const PRESET_ELEMENT_KEYS = new Set([
    ...OVERRIDABLE_GLOBAL_KEYS.map(d => d.key),
    'showRail',
    // An element's own palette settings (Stat Value Color, the bracket's two).
    ...Object.values(LAYOUT_SETTINGS).flat()
        .filter(d => d.appPalette || d.type === 'color-override')
        .map(d => d.key),
]);

// `overlays.*` children that are not element namespaces.
const NOT_ELEMENTS = new Set(['global', 'presets', 'schema_version', 'active_preset']);

const isBag = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Every per-element preset pin currently set, flat: `{ 'scorecard.2.bodyFont': 'Oswald' }`.
 * Paths are relative to `overlays`. Two levels deep, which is every shape a
 * pin is stored in: the element's namespace, and a per-board one under it.
 */
export function elementPins(overlays) {
    const out = {};
    for (const [ns, bag] of Object.entries(overlays ?? {})) {
        if (NOT_ELEMENTS.has(ns) || !isBag(bag)) continue;
        for (const [key, value] of Object.entries(bag)) {
            if (PRESET_ELEMENT_KEYS.has(key)) {
                if (value != null) out[`${ns}.${key}`] = value;
            } else if (isBag(value)) {
                for (const [sub, v] of Object.entries(value)) {
                    if (PRESET_ELEMENT_KEYS.has(sub) && v != null) out[`${ns}.${key}.${sub}`] = v;
                }
            }
        }
    }
    return out;
}

/** The global half of a preset, every key present (null = unset/inherit). */
function globalsOf(overlays) {
    const g = overlays?.global ?? {};
    const out = {};
    for (const key of GLOBAL_DESIGN_KEYS) out[key] = g[key] ?? GLOBAL_DESIGN_DEFAULTS[key] ?? null;
    return out;
}

/** Capture the current preset. `logo` is filled in by the caller after the server answers. */
export function snapshotPreset(overlays, { id, name }) {
    const now = new Date().toISOString();
    return {
        version: PRESET_VERSION,
        id,
        name,
        createdAt: now,
        savedAt: now,
        global: globalsOf(overlays),
        pins: elementPins(overlays),
        logo: false,
    };
}

/**
 * Bring any stored preset up to the v3 shape.
 *
 *   v1   the global keys, flat on the object
 *   v2   `{ global, layouts: { type: <the WHOLE overlays.{type} bag> } }` — the
 *        preset pins are extracted and the rest (content toggles) is dropped, so
 *        loading an old preset no longer resets what a card is showing
 *   v3   `{ global, pins, logo }`
 *
 * `key` is the settings key the preset is stored under, which is its id when the
 * stored object predates ids (v1/v2 were keyed by NAME).
 */
export function normalizePreset(raw, key) {
    if (!isBag(raw)) return null;
    if (raw.version >= 3) {
        return { ...raw, id: raw.id ?? key, name: raw.name ?? key, pins: raw.pins ?? {}, global: raw.global ?? {} };
    }
    const global = {};
    const source = isBag(raw.global) ? raw.global : raw;
    for (const k of GLOBAL_DESIGN_KEYS) if (source[k] !== undefined) global[k] = source[k];
    return {
        version: PRESET_VERSION,
        id: key,
        name: raw.name ?? key,
        savedAt: raw.savedAt ?? null,
        global,
        pins: raw.layouts ? elementPins(raw.layouts) : {},
        logo: false,
        legacy: true,
    };
}

const same = (a, b) => a === b || (a != null && b != null && String(a) === String(b));

/**
 * The writes that turn `overlays` into `preset`: `{ sets: [{key, value}], unsets: [key] }`,
 * full settings keys. Empty when the show already wears the preset — which is
 * what "modified" is measured against.
 *
 * A global the preset does not name (a key added after it was saved) resolves to
 * its default, so an old preset still REPLACES rather than leaving today's value.
 */
export function planApply(overlays, preset) {
    const sets = [];
    const unsets = [];
    const current = globalsOf(overlays);
    for (const key of GLOBAL_DESIGN_KEYS) {
        const want = preset.global?.[key] !== undefined ? preset.global[key] : (GLOBAL_DESIGN_DEFAULTS[key] ?? null);
        if (!same(current[key], want)) sets.push({ key: `overlays.global.${key}`, value: want });
    }
    const have = elementPins(overlays);
    const want = preset.pins ?? {};
    for (const path of Object.keys(have)) {
        if (!(path in want)) unsets.push(`overlays.${path}`);
    }
    for (const [path, value] of Object.entries(want)) {
        if (!same(have[path], value)) sets.push({ key: `overlays.${path}`, value });
    }
    return { sets, unsets };
}

/** Does the show currently wear `preset` (logo aside)? */
export function wearsPreset(overlays, preset) {
    if (!preset) return false;
    const { sets, unsets } = planApply(overlays, preset);
    return sets.length === 0 && unsets.length === 0;
}

/** The built-in starting point: every global at its default, no pins. Keeps the logo. */
export const DEFAULT_PRESET = Object.freeze({
    version: PRESET_VERSION, id: null, name: 'Defaults', global: { ...GLOBAL_DESIGN_DEFAULTS }, pins: {},
});

/** A settings-key-safe id for a new preset, unique among `taken`. */
export function presetIdFor(name, taken) {
    const base = String(name ?? '').toLowerCase().normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'preset';
    const ids = new Set(taken);
    if (!ids.has(base)) return base;
    for (let n = 2; ; n += 1) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Stored presets, normalized, in the order they were first saved — by
 * `createdAt`, so updating a preset does not move its card.
 */
export function listPresets(presets) {
    const made = (l) => String(l.createdAt ?? l.savedAt ?? '');
    return Object.entries(presets ?? {})
        .map(([key, raw]) => normalizePreset(raw, key))
        .filter(Boolean)
        .sort((a, b) => made(a).localeCompare(made(b)) || a.name.localeCompare(b.name));
}

/** A preset as a shareable file body (the logo, if any, is attached by the caller). */
export function exportBody(preset) {
    const { legacy: _legacy, ...rest } = preset;
    return { ...rest, version: PRESET_VERSION };
}

/**
 * Parse an imported preset file. Accepts every version this app has written;
 * returns null for anything that is not a preset.
 */
export function parseImport(data, fallbackName) {
    if (!isBag(data)) return null;
    const preset = normalizePreset(data, data.id ?? fallbackName);
    if (!preset) return null;
    const hasGlobals = GLOBAL_DESIGN_KEYS.some(k => preset.global[k] !== undefined);
    if (!hasGlobals && !Object.keys(preset.pins).length) return null;
    return { ...preset, name: data.name ?? fallbackName, legacy: false };
}

/*
 * The rgba round-trip — the one statement of how a stored colour string splits
 * into the two things a producer edits.
 *
 * A native `<input type="color">` is RGB-only by specification: it renders no
 * alpha channel and its value is always `#rrggbb`. So every control that edits
 * an `rgba()` has to take the colour apart, drive the swatch with the hex half,
 * and put it back together with the alpha it was already carrying — otherwise
 * touching the swatch silently drops the alpha, which is what the style-override
 * rows used to do.
 *
 * Lives here rather than beside either control because there are now two of
 * them: the Design tab's ColorWithOpacity (routes/layouts/shared.jsx) authors
 * the global, and the console kit's ColorRow (routes/production/kit/rows.jsx)
 * authors the per-element pin of that same key. Two copies of this arithmetic
 * is two chances for the global and its override to disagree about what a
 * colour is.
 *
 * `<input type="color" alpha>` would make the split unnecessary, but it is not
 * available yet (measured absent in the shipped Electron/Chrome runtime, and it
 * degrades SILENTLY where unsupported — no slider, no error), so it can only
 * ever be an enhancement layered over this, never a replacement for it.
 */

// A complete hex colour: 3, 6 or 8 digits. Length is what says "finished
// typing" — a field that committed every keystroke would write `#7d2` as a
// colour on the way to `#7d2f2f`.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const expand3 = (h) => '#' + h.slice(1).split('').map(c => c + c).join('');

/**
 * Split a CSS colour into the swatch's hex and a 0..1 opacity.
 *
 * `explicit` says the input CARRIED an alpha of its own (an `rgba()` or an
 * 8-digit hex) rather than being assumed opaque. A caller merging typed text
 * into an existing colour needs that distinction: `#7d2f2f` typed into a swatch
 * pinned at 55% means "this colour, same opacity", while `#7d2f2f8c` and
 * `rgba(125, 47, 47, 0.2)` each name one of their own.
 *
 * Anything unparseable reads as opaque black, which is what the swatch shows.
 */
export function parseRgba(val) {
    const raw = String(val ?? '').trim();
    const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) {
        const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
        return { hex, opacity: m[4] != null ? parseFloat(m[4]) : 1, explicit: m[4] != null };
    }
    if (HEX.test(raw)) {
        const h = raw.length === 4 ? expand3(raw) : raw;
        if (h.length === 9) {
            return {
                hex: h.slice(0, 7).toLowerCase(),
                opacity: Math.round((parseInt(h.slice(7), 16) / 255) * 100) / 100,
                explicit: true,
            };
        }
        return { hex: h.toLowerCase(), opacity: 1, explicit: false };
    }
    return { hex: raw.startsWith('#') ? raw : '#000000', opacity: 1, explicit: false };
}

/** Is `text` a colour a field can commit, rather than one mid-keystroke? */
export function isCompleteColor(text) {
    const raw = String(text ?? '').trim();
    return HEX.test(raw) || /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)$/.test(raw);
}

/** Put the two halves back together. Inverse of parseRgba for any rgba input. */
export function toRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

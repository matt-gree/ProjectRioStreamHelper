/*
 * social-marks.js — the platform marks the Event Header draws beside a handle.
 *
 * A handle cannot say what it is. "@NNL_MSB" is a Twitter handle, a YouTube
 * channel or a Discord invite depending on knowledge the viewer does not have,
 * and the mark is the only part of the field that carries it — which is the
 * same reasoning `sub-glyph.js` records for the commentary drawer, one surface
 * over.
 *
 * NOT A SECOND COPY OF THE THEME'S ARTWORK, though the paths match today.
 * Commentary and Player Plates reach their marks as `<symbol>` ids a design
 * package declares, and a package is MEANT to draw its own: that is the whole
 * point of the tier. The Event Header has no theme SVG at all — it is a plain
 * DOM overlay, like the Player Name — so there is no package artwork for it to
 * miss, and no truth here for a package's to drift from. Do not "unify" these
 * with the theme symbols; that would make every package's mark the Event
 * Header's, which is backwards.
 *
 * Brand marks reproduced as published, at their own 24x24 viewBox.
 */

export const SOCIAL_MARKS = {
    twitter: {
        viewBox: '0 0 24 24',
        d: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
    },
    youtube: {
        viewBox: '0 0 24 24',
        d: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
    },
};

/**
 * An inline `<svg>` for one mark, or null for a field that wears none.
 *
 * `currentColor` so the mark is the same ink as the handle beside it, including
 * a per-element Text Colour override — a mark that stayed white on a repainted
 * band would be the one thing on it ignoring the palette.
 */
export function socialMark(id, className = 'eh-mark') {
    const spec = SOCIAL_MARKS[id];
    if (!spec) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', spec.viewBox);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', spec.d);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

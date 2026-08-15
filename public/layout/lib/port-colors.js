// port-colors.js — the controller-port palette, in ONE place.
//
// A controller port is a player's identity for the whole broadcast: the same
// red that says "port 1" on the scoreboard says it on the scorecard, the lower
// third and both post-game callouts. So the palette is resolved here and every
// mount reads it, rather than each mount carrying its own copy of four hexes
// and its own per-layout override key (which is what they all used to do — five
// duplicated arrays, and an override UI on exactly one of them).
//
//   import { ensurePortPalette, portColor } from './port-colors.js';
//   await ensurePortPalette(pkg);      // alongside engine.ensureTheme(pkg)
//   const c = portColor(0);            // 0-based port index → colour, or null
//
// RESOLUTION, most specific first:
//
//   1. the producer's own choice — overlays.global.port{idx}Color, set on the
//      Design tab. Global on purpose: it is one palette, not a per-element one.
//   2. the active DESIGN PACKAGE's declaration — "portColors" in its
//      package.json (ports 1-4 in order; see public/design/README.md). This is
//      package-wide rather than per element, because no single element owns it.
//   3. DEFAULT_PORT_COLORS — the Smash/MK convention, and what Project Rio and
//      gc-overlay show, so an unthemed install matches what the producer sees
//      in game.
//
// The package manifest is fetched once per package and cached for the page.
// `portColor` is SYNCHRONOUS by design (mounts call it deep inside a render);
// awaiting `ensurePortPalette` in the same place a mount already awaits its
// theme is what guarantees the manifest has landed by then.

export const DEFAULT_PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

const DEFAULT_PACKAGE = 'default';

// package id -> Promise<string[]> (resolved: 4 slots, '' where undeclared).
// A promise rather than the value, so concurrent mounts on one page share one
// in-flight fetch.
const manifestCache = {};
// package id -> resolved palette, for the synchronous read below.
const resolved = {};

function activePackage() {
    const g = window.OverlayBase?.deepGet;
    const s = window.OverlayBase?.settings;
    return (g ? g(s, 'overlays.global.designPackage', null) : null) || DEFAULT_PACKAGE;
}

async function fetchPortColors(pkg) {
    // The manifest is a plain package asset (/design/{pkg}/package.json), so
    // this needs no API round-trip and works from an OBS browser source the
    // same way the theme SVGs do. A package that declares nothing — or has no
    // manifest at all — simply falls through to DEFAULT_PORT_COLORS; there is
    // deliberately NO element-by-element fallback to `default` here, because a
    // manifest is not an element: "this package says nothing about ports"
    // means the app's own palette, not another package's.
    try {
        const base = window.OverlayBase?.BASE_URL ?? '';
        const r = await fetch(`${base}/design/${encodeURIComponent(pkg)}/package.json`);
        if (!r.ok) return [];
        const data = await r.json();
        const raw = Array.isArray(data?.portColors) ? data.portColors : [];
        return DEFAULT_PORT_COLORS.map((_, i) => (typeof raw[i] === 'string' ? raw[i].trim() : ''));
    } catch {
        return [];
    }
}

/**
 * Make sure `pkg`'s declared palette is loaded, so portColor() can answer
 * synchronously. Call it where the mount already awaits its theme.
 */
export function ensurePortPalette(pkg) {
    const id = pkg || activePackage();
    if (manifestCache[id] == null) {
        manifestCache[id] = fetchPortColors(id).then((colors) => {
            resolved[id] = colors;
            return colors;
        });
    }
    return manifestCache[id];
}

/**
 * The colour for a 0-based controller port index, or null when there is no
 * port (an unassigned side — the caller decides what a side with no port
 * looks like; some fall back to a side index, some to the global accent).
 */
export function portColor(port) {
    const idx = Number.isInteger(port) ? port : -1;
    if (idx < 0 || idx >= DEFAULT_PORT_COLORS.length) return null;
    const g = window.OverlayBase?.deepGet;
    const override = g ? g(window.OverlayBase.settings, `overlays.global.port${idx}Color`, null) : null;
    if (override) return override;
    const declared = resolved[activePackage()];
    if (declared && declared[idx]) return declared[idx];
    return DEFAULT_PORT_COLORS[idx];
}

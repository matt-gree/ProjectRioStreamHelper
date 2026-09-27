import { ELEMENTS } from '../elements';

/*
 * A CANVAS THAT GREW, AND THE SOURCES ALREADY BUILT AT THE OLD ONE.
 *
 * When an element's native size changes, every OBS source created before the
 * change still renders at the old resolution, so the page fits its new, taller
 * canvas into the old box and draws the whole card smaller. That is silent,
 * and it lands on exactly the producers with a finished scene.
 *
 * Each entry names the element and the size it USED to be. The new size is
 * never restated here: it is the element's own `width`/`height`, so this table
 * cannot disagree with what the Add picker creates today. A source is a
 * candidate only while its resolution is EXACTLY the retired size — that is
 * what makes the pass safe to run on every connect (after the first it matches
 * nothing) and what keeps a size a producer chose by hand out of it.
 *
 * Add a row in the same change that grows an element's canvas.
 */
export const RETIRED_CANVASES = [
    // 2.0.1: both stat cards grew the roster band.
    { element: 'statsbar', width: 452, height: 118 },
    { element: 'statscard', width: 380, height: 240 },
];

/**
 * The size this browser source should be resized to, or null when it is not a
 * source at a retired canvas. `width`/`height` are the INPUT's resolution
 * (its browser-source settings), not a scene item's.
 */
export function upgradeRetiredCanvas(url, width, height) {
    if (!url) return null;
    for (const r of RETIRED_CANVASES) {
        if (Number(width) !== r.width || Number(height) !== r.height) continue;
        const el = ELEMENTS.find(e => e.id === r.element);
        if (!el?.match?.(url)) continue;
        if (el.width === r.width && el.height === r.height) continue;
        return { element: el, width: el.width, height: el.height };
    }
    return null;
}

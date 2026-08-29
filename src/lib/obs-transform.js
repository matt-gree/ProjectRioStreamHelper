/*
 * OBS scene-item SIZING — the arithmetic behind "make this source exactly the
 * size of its other half".
 *
 * A per-side element comes in PAIRS (?team=1|2 — the Roster, the Stat Bar, the
 * Player Name, the Team Logo, the Controller). Both halves are the same layout
 * at the same native size, and a producer places them by hand in OBS: drag one
 * to the right of the canvas, size it by eye, then do the other and try to hit
 * the same number twice. This module is what lets the console do the second
 * half exactly.
 *
 * SIZE ONLY, NEVER POSITION. Two halves of a pair are a pair *because* they sit
 * in different places; copying position would put one on top of the other and
 * make the feature useless in the one arrangement it exists for.
 *
 * OBS EXPRESSES SIZE TWO WAYS and the console must not silently convert one to
 * the other:
 *
 *   scale          rendered = (source dims − crop) × scale, boundsType NONE.
 *                  What a source gets by default and what a corner-drag edits.
 *   bounding box   rendered = boundsWidth × boundsHeight, the source fitted
 *                  into it per boundsType. What "Edit Transform" and a
 *                  ctrl-drag produce.
 *
 * So the model's size is READ through whichever way it states it, and written
 * to the target through whichever way the TARGET states it. Rewriting the
 * target's method would silently undo a producer's own bounding box — an edit
 * they did not ask for, on the one surface whose whole promise is "these two
 * are now identical". It also keeps us clear of obs-websocket's bounds
 * validator, which rejects a zero-sized box.
 *
 * Crop is read, never written: a crop changes what the source SHOWS, and this
 * feature is about how big it is drawn. A target that is cropped and a model
 * that isn't still end up the same size on the canvas, because the scale is
 * solved against the target's own cropped dimensions.
 */

export const BOUNDS_NONE = 'OBS_BOUNDS_NONE';

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// A negative scale is a FLIP, not a size. Every size below is read as a
// magnitude and the target's own sign is put back on the way out, so matching
// sizes never un-mirrors a source the producer deliberately flipped.
const sign = (v) => (num(v, 1) < 0 ? -1 : 1);

const inBounds = (t) => !!t?.boundsType && t.boundsType !== BOUNDS_NONE;

// The source's own dimensions with the crop taken off — the rectangle `scale`
// actually multiplies.
export function croppedSize(t) {
    return {
        width: num(t?.sourceWidth) - num(t?.cropLeft) - num(t?.cropRight),
        height: num(t?.sourceHeight) - num(t?.cropTop) - num(t?.cropBottom),
    };
}

/*
 * How big this scene item is drawn on the canvas.
 *
 * For a bounded item that is the box itself. OBS_BOUNDS_MAX_ONLY is the one
 * bounds type where the drawn picture can be smaller than its box (the box is
 * a ceiling, not a fit) — copying the box is still the right answer there,
 * because the box is what the producer set and two identical layouts under one
 * ceiling land on the same size anyway.
 */
export function renderedSize(t) {
    if (!t) return null;
    if (inBounds(t)) {
        const width = num(t.boundsWidth);
        const height = num(t.boundsHeight);
        return width > 0 && height > 0 ? { width, height } : null;
    }
    const { width: cw, height: ch } = croppedSize(t);
    const width = cw * Math.abs(num(t.scaleX, 1));
    const height = ch * Math.abs(num(t.scaleY, 1));
    return width > 0 && height > 0 ? { width, height } : null;
}

/*
 * The partial `sceneItemTransform` that makes `target` the size of `model`, or
 * null when the pair reports something we can't solve (a zero dimension, a
 * source OBS hasn't measured yet because the browser page has not loaded).
 *
 * Returning null rather than a best guess is deliberate: this runs against a
 * live broadcast, and a source silently resized to 0 or to NaN is worse than a
 * button that says it couldn't.
 */
export function sizeMatchTransform(model, target) {
    const size = renderedSize(model);
    if (!size || !target) return null;

    // The target states its size as a box → restate the box. Its boundsType and
    // alignment are the producer's and stay theirs.
    if (inBounds(target)) {
        return { boundsWidth: size.width, boundsHeight: size.height };
    }

    // ...otherwise solve the scale against the target's OWN cropped source, so
    // a differently-cropped or differently-sized target still lands on the same
    // drawn size rather than merely the same multiplier.
    const { width: tw, height: th } = croppedSize(target);
    if (!(tw > 0 && th > 0)) return null;
    return {
        scaleX: sign(target.scaleX) * (size.width / tw),
        scaleY: sign(target.scaleY) * (size.height / th),
    };
}

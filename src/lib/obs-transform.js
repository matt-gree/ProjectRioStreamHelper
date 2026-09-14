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
 * The RESOLUTION a source renders at — its input's own width/height, which OBS
 * reports on every transform as the item's source size. The other of the two
 * sizes in the section below, and null when OBS has not measured the page yet.
 *
 * Read here rather than off the input settings because a transform is what both
 * callers already hold, and because the two must agree: an input resized behind
 * the console's back shows up here on the next transform read.
 */
export function inputSize(t) {
    const width = num(t?.sourceWidth);
    const height = num(t?.sourceHeight);
    return width > 0 && height > 0 ? { width, height } : null;
}

/*
 * ── WHY A PAIR CAN NEED BOTH SIZES COPIED ───────────────────────────────────
 *
 * For an element that fits its artwork to whatever viewport it is handed, the
 * drawn size IS the whole of "how big is it" and `sizeMatchTransform` is the
 * whole answer. For one that draws at an ABSOLUTE size — today the Player Name,
 * the same one `SCALE_SENSITIVE` names in ../routes/production/placements.js —
 * it is half of it. That element's type size is a number of pixels solved
 * against the page's own viewport, so what reaches the canvas is
 *
 *     nameSize (clamped by the INPUT's height) × (drawn size / INPUT size)
 *
 * and matching only the second factor leaves the first free. Measured, with a
 * side 2 that had been redrawn to 500×125 beside an untouched 800×200 side 1:
 * both names were drawing 48px, and "Match side 2" — a press whose entire
 * purpose is to make them the same — put side 1's box on side 2's and its name
 * at 30px against side 2's 48px. It also introduced a 0.625 stretch on the one
 * element the rack raises an amber badge for, so the console's next word about
 * the source it had just been asked to fix was a warning.
 *
 * So for those elements a pair is matched on BOTH sizes: the input as well as
 * the transform. Copying the model's stretch along with it is correct and not a
 * compromise — the button says "the same as the other one", not "better than
 * the other one", and a pair that is identically wrong is one press from
 * identically right on either half (`redrawPlan`). It is the pull-never-push
 * rule that settles it: normalising the two to 1:1 instead would be this
 * panel editing the sibling's source, which is the one thing it must not do.
 */
export function sameInputSize(a, b) {
    const x = inputSize(a);
    const y = inputSize(b);
    return !!x && !!y && x.width === y.width && x.height === y.height;
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

/*
 * ── RENDER RESOLUTION: "redraw this source at the size it occupies" ──────────
 *
 * A browser source has TWO sizes and OBS never says which one moved.
 *
 *   the INPUT's width/height   the resolution the page renders at — the
 *                              viewport the overlay lays itself out in.
 *   the ITEM's transform       what that finished texture is then scaled to on
 *                              the canvas.
 *
 * Dragging a scene item's handles — the obvious gesture for "make this bigger"
 * or "make this smaller" — moves only the SECOND. The page is still rendered at
 * the old resolution and the compositor scales the result, so what the producer
 * gets is a picture of an overlay rather than the overlay: soft when it is
 * enlarged, and, for anything drawn at an absolute size, simply the wrong size.
 *
 * BOTH DIRECTIONS COUNT, and that is the point of the whole section. Quality
 * alone would care only about enlargement (shrinking a texture is lossless),
 * and this is not only about quality: the Player Name draws its type at a
 * number of pixels the producer typed, so a source at half scale is drawing a
 * 48px name at 24px. The setting and the broadcast disagree, silently, and no
 * amount of looking at either program says why.
 *
 * The reconciliation is to re-render the page at the size the item occupies and
 * take the scaling back out. THE BOX DOES NOT MOVE OR CHANGE SIZE — it is the
 * same rectangle on the canvas, redrawn instead of resampled — so an element
 * that fits itself to its viewport looks identical and merely sharper, and an
 * element with fixed-size type comes back to its real size. That second half is
 * exactly what a producer means when they drag a Player Name box: the box got
 * bigger, the name did not.
 *
 * Two cautions, both of which this module refuses on rather than guesses at:
 *
 *   AN INPUT IS GLOBAL. Resizing it changes the picture in every scene that
 *   draws it, so every one of those items needs its scale corrected to keep the
 *   size it has (`rescaleForSource`) — the caller enumerates them.
 *
 *   A CROP IS IN SOURCE PIXELS. Change the source's dimensions and the same
 *   crop numbers describe a different region of a differently-sized page, so
 *   what the producer cropped away is not what stays cropped away. There is no
 *   honest arithmetic for that here, so a cropped item is declined.
 */

// How far from 1:1 is worth saying something about. Two percent is about where
// a stretched glyph edge starts to show on a 1080p canvas, and it is well
// inside the rounding a producer's drag lands on.
export const SCALE_TOLERANCE = 1.02;

export function isCropped(t) {
    return !!(num(t?.cropLeft) || num(t?.cropRight) || num(t?.cropTop) || num(t?.cropBottom));
}

/*
 * The ratio between what this item is DRAWN at and what it RENDERS at — 2 for a
 * source blown up to double, 0.5 for one shrunk to half, 1 for one at its own
 * resolution. Null when the pair can't be read.
 *
 * The axis FURTHEST FROM 1 rather than the larger one, because either direction
 * is a disagreement now and "biggest" would call a source squashed to 0.4 on
 * one axis and left alone on the other a 1. For the uniform scale a corner-drag
 * produces — which is all but every case — the two axes agree anyway.
 */
export function renderFactor(t) {
    const size = renderedSize(t);
    const sw = num(t?.sourceWidth);
    const sh = num(t?.sourceHeight);
    if (!size || !(sw > 0 && sh > 0)) return null;
    const fw = size.width / sw;
    const fh = size.height / sh;
    return Math.abs(Math.log(fw)) >= Math.abs(Math.log(fh)) ? fw : fh;
}

/*
 * The verdict a rack row carries: the factor this item is being scaled by, or
 * null when it is drawn at its own resolution.
 *
 * Separate from `redrawPlan` because the two answer different questions and one
 * is not the other's precondition. This one is "does what a viewer sees still
 * match what this source is" — as true of a cropped item as any other, so it
 * must not inherit that refusal. The plan is "can this be fixed in one press",
 * which a crop genuinely does rule out. A console that hid the warning wherever
 * it had no button would be quietest about the sources it can help with least.
 */
export function stretchOf(t) {
    const factor = renderFactor(t);
    if (factor == null) return null;
    const off = factor > SCALE_TOLERANCE || factor < 1 / SCALE_TOLERANCE;
    return off ? factor : null;
}

/*
 * The input dimensions that would make this item render 1:1, or null when there
 * is nothing to fix and nothing safe to do.
 *
 * Rounded, because an input takes whole pixels and a producer's drag lands on
 * fractions of one.
 */
export function redrawPlan(t) {
    if (stretchOf(t) == null || isCropped(t)) return null;
    const size = renderedSize(t);
    const width = Math.round(size.width);
    const height = Math.round(size.height);
    return width > 0 && height > 0 ? { width, height } : null;
}

/*
 * What this item's transform has to become so that it is drawn at the SAME size
 * it is now, out of a source that is about to be `source` pixels — or null when
 * nothing needs to change.
 *
 * A bounded item needs nothing: its box already states the drawn size and OBS
 * re-fits the new render into it. An unbounded one is drawn at `scale × source`
 * and both halves just moved, so the scale is re-solved against the new
 * dimensions — with the sign put back, since a negative scale is a flip.
 *
 * Declines a cropped item for the reason in the section header: its crop is
 * about to mean something else, and preserving a size computed from the old
 * meaning would be arithmetic dressed up as an answer.
 */
export function rescaleForSource(t, source) {
    if (!t || inBounds(t) || isCropped(t)) return null;
    const size = renderedSize(t);
    const w = num(source?.width);
    const h = num(source?.height);
    if (!size || !(w > 0 && h > 0)) return null;
    return {
        scaleX: sign(t.scaleX) * (size.width / w),
        scaleY: sign(t.scaleY) * (size.height / h),
    };
}

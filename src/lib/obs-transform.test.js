import { describe, it, expect } from 'vitest';
import {
    BOUNDS_NONE, renderedSize, sizeMatchTransform,
    renderFactor, redrawPlan, rescaleForSource, isCropped, stretchOf, SCALE_TOLERANCE,
    inputSize, sameInputSize, typeScaleOf,
} from './obs-transform';
import {
    requestedScale, fitToHeight, heightForNameSize,
} from '../../public/layout/lib/playername-mount.js';

// A default OBS scene item: a 452x140 browser source at 1:1, no crop, no box.
const item = (over = {}) => ({
    sourceWidth: 452, sourceHeight: 140,
    positionX: 100, positionY: 40, rotation: 0,
    scaleX: 1, scaleY: 1,
    cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
    alignment: 5,
    boundsType: BOUNDS_NONE, boundsAlignment: 0, boundsWidth: 0, boundsHeight: 0,
    ...over,
});

describe('renderedSize', () => {
    it('multiplies the cropped source by its scale', () => {
        expect(renderedSize(item({ scaleX: 0.5, scaleY: 0.5 }))).toEqual({ width: 226, height: 70 });
        expect(renderedSize(item({ cropLeft: 52, scaleX: 2, scaleY: 1 })))
            .toEqual({ width: 800, height: 140 });
    });

    // A flipped source is the same size as an unflipped one. Reading the sign as
    // part of the size would hand the target a negative width and OBS would
    // mirror it as a side effect of copying a number.
    it('reads a negative scale as a flip, not as a size', () => {
        expect(renderedSize(item({ scaleX: -0.5, scaleY: 0.5 }))).toEqual({ width: 226, height: 70 });
    });

    it('reads a bounded item as its box', () => {
        const t = item({
            boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 600, boundsHeight: 186,
            scaleX: 1.327, scaleY: 1.327,
        });
        expect(renderedSize(t)).toEqual({ width: 600, height: 186 });
    });

    it('answers null for a source OBS has not measured', () => {
        expect(renderedSize(item({ sourceWidth: 0, sourceHeight: 0 }))).toBeNull();
        expect(renderedSize(null)).toBeNull();
    });
});

describe('sizeMatchTransform', () => {
    it('solves the scale so the two are drawn the same size', () => {
        const patch = sizeMatchTransform(item({ scaleX: 0.75, scaleY: 0.75 }), item());
        expect(patch).toEqual({ scaleX: 0.75, scaleY: 0.75 });
    });

    /*
     * The point of solving against the TARGET's own cropped source rather than
     * copying the multiplier: a differently-cropped target with the model's
     * scale would be a different size on the canvas, which is the one thing
     * this feature promises not to be.
     */
    it('solves against the target’s own crop, not the model’s multiplier', () => {
        const model = item({ scaleX: 1, scaleY: 1 }); // drawn 452 x 140
        const target = item({ cropLeft: 26, cropRight: 26 }); // 400 wide before scale
        const patch = sizeMatchTransform(model, target);
        expect(patch.scaleX).toBeCloseTo(452 / 400, 10);
        expect(patch.scaleY).toBeCloseTo(1, 10);
    });

    it('keeps the target’s flip', () => {
        const patch = sizeMatchTransform(item({ scaleX: 2, scaleY: 2 }), item({ scaleX: -1 }));
        expect(patch).toEqual({ scaleX: -2, scaleY: 2 });
    });

    /*
     * NEVER CONVERT THE TARGET'S SIZING METHOD. A producer who set a bounding
     * box on this source gets the box resized; one who never did keeps a plain
     * scale. Rewriting either into the other is an edit nobody asked for — and
     * writing a boundsType with a zero-sized box is what obs-websocket rejects.
     */
    it('restates a bounded target as a box and leaves its bounds type alone', () => {
        const target = item({
            boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsAlignment: 4,
            boundsWidth: 300, boundsHeight: 93,
        });
        const patch = sizeMatchTransform(item({ scaleX: 0.5, scaleY: 0.5 }), target);
        expect(patch).toEqual({ boundsWidth: 226, boundsHeight: 70 });
    });

    it('copies a bounded model onto an unbounded target as a scale', () => {
        const model = item({
            boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 226, boundsHeight: 70,
        });
        expect(sizeMatchTransform(model, item())).toEqual({ scaleX: 0.5, scaleY: 0.5 });
    });

    // Null, not a guess: this runs against a live broadcast, and a source
    // silently resized to 0 is worse than a button that says it couldn't.
    it('refuses a pair it cannot solve', () => {
        expect(sizeMatchTransform(item({ sourceWidth: 0 }), item())).toBeNull();
        expect(sizeMatchTransform(item(), item({ sourceHeight: 0 }))).toBeNull();
        expect(sizeMatchTransform(item(), null)).toBeNull();
    });
});

/*
 * ── RENDER RESOLUTION ──
 *
 * The failure here is invisible in both programs: OBS says nothing about
 * scaling a browser source, and the source cannot tell it is being drawn at
 * anything other than its own size. It just goes out at the wrong fidelity —
 * and, for an element with absolute type, at the wrong SIZE, which is a setting
 * and a broadcast disagreeing with no way to see why.
 */

describe('renderFactor', () => {
    it('is the ratio of drawn size to rendered size, in either direction', () => {
        expect(renderFactor(item())).toBe(1);
        expect(renderFactor(item({ scaleX: 2, scaleY: 2 }))).toBe(2);
        expect(renderFactor(item({ scaleX: 0.5, scaleY: 0.5 }))).toBe(0.5);
    });

    /*
     * The axis FURTHEST FROM 1, not the biggest. Once both directions count,
     * "biggest" would call a source squashed to 0.4 on one axis and untouched on
     * the other a 1 — the disagreement is the distance from 1:1, whichever way.
     */
    it('takes the axis furthest from 1:1', () => {
        expect(renderFactor(item({ scaleX: 2, scaleY: 1 }))).toBe(2);
        expect(renderFactor(item({ scaleX: 0.4, scaleY: 1 }))).toBeCloseTo(0.4, 5);
    });

    it('reads a bounded item through its box', () => {
        const t = item({
            boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 904, boundsHeight: 280,
        });
        expect(renderFactor(t)).toBe(2);
    });

    it('answers null for a source OBS has not measured', () => {
        expect(renderFactor(item({ sourceWidth: 0 }))).toBeNull();
        expect(renderFactor(null)).toBeNull();
    });
});

describe('stretchOf — the verdict a rack row carries', () => {
    /*
     * BOTH DIRECTIONS, which is the whole difference between this and a quality
     * warning. Shrinking a texture is lossless, so a sharpness-only rule would
     * stay silent — while a half-scale item draws the Player Name's 48px type at
     * 24px, and neither OBS nor the overlay can tell you that.
     */
    it('fires when a source is enlarged AND when it is shrunk', () => {
        expect(stretchOf(item({ scaleX: 2, scaleY: 2 }))).toBe(2);
        expect(stretchOf(item({ scaleX: 0.5, scaleY: 0.5 }))).toBe(0.5);
    });

    it('stays quiet at 1:1 and within the tolerance either way', () => {
        expect(stretchOf(item())).toBeNull();
        expect(stretchOf(item({ scaleX: SCALE_TOLERANCE - 0.005, scaleY: 1 }))).toBeNull();
        expect(stretchOf(item({ scaleX: 1 / (SCALE_TOLERANCE - 0.005), scaleY: 1 }))).toBeNull();
        expect(stretchOf(null)).toBeNull();
    });

    it('fires just outside the tolerance, symmetrically', () => {
        expect(stretchOf(item({ scaleX: SCALE_TOLERANCE + 0.05, scaleY: 1 }))).not.toBeNull();
        expect(stretchOf(item({ scaleX: 1 / (SCALE_TOLERANCE + 0.05), scaleY: 1 }))).not.toBeNull();
    });

    /*
     * Not `redrawPlan() != null`, and this is the difference. The plan refuses a
     * cropped item because raising the resolution would move what the crop cuts;
     * the WARNING still applies, because a cropped source is as misdrawn as any
     * other. A console that hid the warning wherever it had no button would be
     * quietest about the cases it can help with least.
     */
    it('warns about a cropped item that has no one-press fix', () => {
        const cropped = item({ scaleX: 2, scaleY: 2, cropTop: 10 });
        expect(stretchOf(cropped)).not.toBeNull();
        expect(redrawPlan(cropped)).toBeNull();
    });
});

describe('typeScaleOf — how much bigger TYPE looks', () => {
    it('is the vertical factor', () => {
        expect(typeScaleOf(item({ scaleX: 1.5, scaleY: 1.5 }))).toBe(1.5);
        expect(typeScaleOf(item({ scaleX: 0.5, scaleY: 0.5 }))).toBe(0.5);
    });

    // Dragged only wider: the same letters with more room, not bigger ones.
    it('ignores a stretch that is only horizontal', () => {
        expect(typeScaleOf(item({ scaleX: 2, scaleY: 1 }))).toBe(1);
    });

    it('is null when the source size is unknown', () => {
        expect(typeScaleOf(item({ sourceHeight: 0 }))).toBeNull();
    });
});

describe('redrawPlan', () => {
    it('names the resolution that makes the item render 1:1', () => {
        expect(redrawPlan(item({ scaleX: 2, scaleY: 2 }))).toEqual({ width: 904, height: 280 });
    });

    /*
     * A SHRUNK source is redrawn too, at a SMALLER resolution — which is the
     * half a quality-only feature would have skipped. The box keeps the size it
     * has on the canvas; what changes is that its contents stop being resampled,
     * so 48px type is 48px again instead of 24.
     */
    it('redraws a shrunk source at the smaller size it occupies', () => {
        expect(redrawPlan(item({ scaleX: 0.5, scaleY: 0.5 }))).toEqual({ width: 226, height: 70 });
    });

    it('rounds, because an input takes whole pixels and a drag does not', () => {
        expect(redrawPlan(item({ scaleX: 1.5013, scaleY: 1.5013 })))
            .toEqual({ width: 679, height: 210 });
    });

    it('has nothing to say about a source already drawn at its own size', () => {
        expect(redrawPlan(item())).toBeNull();
    });

    it('DECLINES a cropped item rather than re-framing it', () => {
        // A crop is stated in source pixels. Change the source's dimensions and
        // the same numbers cut a different region of a differently-sized page,
        // so what the producer cropped away is not what stays cropped away.
        expect(redrawPlan(item({ scaleX: 2, scaleY: 2, cropTop: 10 }))).toBeNull();
        expect(isCropped(item({ cropRight: 4 }))).toBe(true);
        expect(isCropped(item())).toBe(false);
    });
});

describe('rescaleForSource — the OTHER scenes drawing the same input', () => {
    it('keeps an item the size it is when the source changes under it', () => {
        // An OBS input is global: the redraw resizes the page for every scene at
        // once. A scene the producer was not looking at must not double.
        const other = item({ scaleX: 0.5, scaleY: 0.5 });   // drawn 226x70
        expect(rescaleForSource(other, { width: 904, height: 280 }))
            .toEqual({ scaleX: 0.25, scaleY: 0.25 });
    });

    it('lands the item being redrawn on exactly 1:1, by arithmetic', () => {
        // The target is not a special case — its rendered size IS the new
        // resolution, so the general rule answers 1 for it. True of a shrunk
        // item as much as an enlarged one.
        const up = item({ scaleX: 2, scaleY: 2 });
        expect(rescaleForSource(up, redrawPlan(up))).toEqual({ scaleX: 1, scaleY: 1 });
        const down = item({ scaleX: 0.5, scaleY: 0.5 });
        expect(rescaleForSource(down, redrawPlan(down))).toEqual({ scaleX: 1, scaleY: 1 });
    });

    it('preserves a flip', () => {
        const flipped = item({ scaleX: -1, scaleY: 1 });
        expect(rescaleForSource(flipped, { width: 904, height: 280 }))
            .toEqual({ scaleX: -0.5, scaleY: 0.5 });
    });

    it('leaves a BOUNDED item alone — its box already states the size', () => {
        const bounded = item({
            boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 600, boundsHeight: 186,
        });
        expect(rescaleForSource(bounded, { width: 904, height: 280 })).toBeNull();
    });

    it('declines a cropped item and a source it cannot read', () => {
        expect(rescaleForSource(item({ cropLeft: 8 }), { width: 904, height: 280 })).toBeNull();
        expect(rescaleForSource(item(), { width: 0, height: 280 })).toBeNull();
        expect(rescaleForSource(null, { width: 904, height: 280 })).toBeNull();
    });
});

/*
 * ── THE SECOND SIZE ─────────────────────────────────────────────────────────
 *
 * A browser source has two, and for an element that draws at an ABSOLUTE size
 * both of them decide what a viewer sees. These pin the fault that made "Match
 * the other side" not work on the Player Name — with the mount's own fit, so
 * the number in the failure is the number that reaches the canvas rather than
 * this file's opinion of it.
 */
describe('input size — the resolution behind the drawn size', () => {
    it('reads the input off the transform, and refuses an unmeasured page', () => {
        expect(inputSize(item())).toEqual({ width: 452, height: 140 });
        expect(inputSize(item({ sourceWidth: 0, sourceHeight: 0 }))).toBeNull();
    });

    it('compares two sources on it', () => {
        expect(sameInputSize(item(), item({ scaleX: 0.5 }))).toBe(true);
        expect(sameInputSize(item(), item({ sourceHeight: 200 }))).toBe(false);
        // An unmeasured page is never "the same as" anything.
        expect(sameInputSize(item(), item({ sourceWidth: 0 }))).toBe(false);
    });
});

describe('matching a pair whose type is drawn at an absolute size', () => {
    // The Player Name's own fit, so the assertion is what the overlay draws.
    const NAME = 48, PREFIX = 'above', TAG = 24;
    const drawnNamePx = (t) => {
        const asked = requestedScale(NAME);
        const capped = fitToHeight(asked, t.sourceHeight, PREFIX, TAG / NAME);
        return (NAME * (capped / asked)) * renderFactor(t);
    };

    // Side 2 was dragged smaller and redrawn, so its input IS its box; side 1
    // is untouched. Both draw the typed 48px, because the size is a global
    // setting and neither source is being scaled.
    const model = item({ sourceWidth: 500, sourceHeight: 125 });
    const target = item({ sourceWidth: 800, sourceHeight: 200 });

    it('starts from a pair that already agrees about the name', () => {
        expect(heightForNameSize(NAME, PREFIX, TAG)).toBeLessThan(125);
        expect(drawnNamePx(model)).toBeCloseTo(48, 5);
        expect(drawnNamePx(target)).toBeCloseTo(48, 5);
    });

    /*
     * THE FAULT. Matching the scene item alone lands the boxes on each other
     * and leaves the two names 18px apart — on the one element where the number
     * the producer typed is supposed to be the number on air, in the press
     * whose entire purpose is to make the pair the same.
     */
    it('matching only the transform puts the boxes together and the names apart', () => {
        const matched = { ...target, ...sizeMatchTransform(model, target) };
        expect(renderedSize(matched)).toEqual(renderedSize(model));
        expect(drawnNamePx(matched)).toBeCloseTo(30, 5);
        expect(drawnNamePx(model)).toBeCloseTo(48, 5);
        // ...and it introduces the very stretch the rack badges this element for.
        expect(stretchOf(matched)).toBeCloseTo(0.625, 5);
    });

    /*
     * THE FIX: copy the resolution first, then solve the transform against the
     * dimensions the source is about to have. The two are then identical in
     * every respect that reaches the canvas, which is what the button promised.
     */
    it('copying the resolution first makes the names agree too', () => {
        const render = inputSize(model);
        const resized = { ...target, sourceWidth: render.width, sourceHeight: render.height };
        const matched = { ...resized, ...sizeMatchTransform(model, resized) };
        expect(renderedSize(matched)).toEqual(renderedSize(model));
        expect(drawnNamePx(matched)).toBeCloseTo(drawnNamePx(model), 5);
        expect(stretchOf(matched)).toBeNull();
    });

    /*
     * A STRETCHED MODEL IS COPIED AS IT IS, stretch included. "The same as the
     * other one" is the promise; normalising both to 1:1 would be this panel
     * editing the sibling, which is the one thing it must not do — and the pair
     * is then one Redraw press from identically right on either half.
     */
    it('reproduces a stretched model rather than improving on it', () => {
        const stretched = item({ sourceWidth: 500, sourceHeight: 125, scaleX: 2, scaleY: 2 });
        const render = inputSize(stretched);
        const resized = { ...target, sourceWidth: render.width, sourceHeight: render.height };
        const matched = { ...resized, ...sizeMatchTransform(stretched, resized) };
        expect(renderedSize(matched)).toEqual(renderedSize(stretched));
        expect(drawnNamePx(matched)).toBeCloseTo(drawnNamePx(stretched), 5);
        expect(stretchOf(matched)).toBeCloseTo(2, 5);
    });
});

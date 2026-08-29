import { describe, it, expect } from 'vitest';
import { BOUNDS_NONE, renderedSize, sizeMatchTransform } from './obs-transform';

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

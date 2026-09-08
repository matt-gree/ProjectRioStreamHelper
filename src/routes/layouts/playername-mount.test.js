import { describe, it, expect } from 'vitest';
import {
    resolveAlign,
    resolvePrefixPosition,
    stackHeight,
    framePadding,
    typeScale,
    fitToWidth,
} from '../../../public/layout/lib/playername-mount.js';

/*
 * The Player Name's sizing rule.
 *
 * This element is text, not a card, so it does not min-fit a fixed canvas into
 * its OBS source the way the roster and the stat card do. Everything below is a
 * consequence of that, and every one of these failures is silent — the name
 * renders, it is just the wrong size, in a frame nobody looks at until it is on
 * air beside the other side's.
 */

// The declared native height (playername.html), which is 200 because the
// starting size is biased to the top of the range — down-scaling a browser
// source is lossless, dragging one up is not. Every assertion below is a
// RATIO, so the number only has to match what ships, not carry the proof.
const NATIVE_H = 200;

describe('stackHeight — a function of the SETTING, never the content', () => {
    it('reserves the prefix row for above and below', () => {
        // 18 (tag) + 2 (gap) + 36 * 1.05 (name line box)
        expect(stackHeight('above')).toBeCloseTo(57.8, 5);
        expect(stackHeight('below')).toBeCloseTo(57.8, 5);
    });

    it('is one run tall for inline and off', () => {
        // Inline baseline-aligns a half-size prefix inside the name's line box.
        expect(stackHeight('inline')).toBeCloseTo(37.8, 5);
        expect(stackHeight('off')).toBeCloseTo(37.8, 5);
    });

    it('degrades an unrecognised value to the shipped default', () => {
        expect(stackHeight('sideways')).toBe(stackHeight('above'));
        expect(stackHeight(undefined)).toBe(stackHeight('above'));
    });
});

describe('typeScale — the frame HEIGHT sets the size', () => {
    it('fills the frame at native, where the old card fit left 42% empty', () => {
        // The whole complaint: a 400x100 source drew a 58px stack of type in a
        // 100px frame. The scale now puts the stack in every pixel the padding
        // does not claim.
        const scale = typeScale(NATIVE_H, 'above');
        const pad = framePadding(NATIVE_H);
        expect(stackHeight('above') * scale + pad * 2).toBeCloseTo(NATIVE_H, 5);
    });

    it('IGNORES width — an off-aspect source gains name, not dead space', () => {
        // 800x100 min-fit to a 400x100 card as scale 1 and put 636px of nothing
        // beside a 164px name. Height is the only input, so the extra width is
        // simply run for the name.
        expect(typeScale(100, 'above')).toBe(typeScale(100, 'above'));
        expect(typeScale(200, 'above')).toBeCloseTo(typeScale(100, 'above') * 2, 5);
    });

    it('is scale-invariant, so a half-size preview is half-size type', () => {
        // Padding is a FRACTION of the height. A flat pixel padding would make
        // the preview iframe (sized to the fit box) show relatively more type
        // than the OBS source it is previewing.
        expect(typeScale(50, 'above')).toBeCloseTo(typeScale(100, 'above') / 2, 5);
        expect(framePadding(50)).toBeCloseTo(framePadding(100) / 2, 5);
    });

    it('draws a prefixless card larger, because the setting says there is no row', () => {
        expect(typeScale(NATIVE_H, 'off')).toBeGreaterThan(typeScale(NATIVE_H, 'above'));
    });

    it('never divides by a frame that has not been laid out yet', () => {
        expect(typeScale(0, 'above')).toBe(1);
        expect(typeScale(undefined, 'above')).toBe(1);
        expect(typeScale(-40, 'above')).toBe(1);
    });
});

describe('fitToWidth — shrink on overflow, and only on overflow', () => {
    it("leaves a name that fits at the height's scale, so a PAIR stays matched", () => {
        // Two sources framing a scoreboard must draw at one type size. A fit
        // that always solved for width would put a short name and a long one
        // about 2x apart.
        expect(fitToWidth(1.5, 200, 388)).toBe(1.5);
        expect(fitToWidth(1.5, 388, 388)).toBe(1.5);
    });

    it('shrinks exactly enough, because run width is linear in font size', () => {
        // One correction lands — the mount does not iterate.
        expect(fitToWidth(1.5, 500, 250)).toBeCloseTo(0.75, 5);
    });

    it('holds its scale when there is nothing to measure against', () => {
        expect(fitToWidth(1.5, 0, 388)).toBe(1.5);
        expect(fitToWidth(1.5, 500, 0)).toBe(1.5);
    });
});

describe('the two settings this element has', () => {
    it('mirrors the sides on auto, and on anything it cannot read', () => {
        expect(resolveAlign('auto', 1)).toBe('left');
        expect(resolveAlign('auto', 2)).toBe('right');
        expect(resolveAlign('sideways', 2)).toBe('right');
        expect(resolveAlign('center', 2)).toBe('center');
    });

    it('defaults the prefix above the name', () => {
        expect(resolvePrefixPosition(undefined)).toBe('above');
        expect(resolvePrefixPosition('beside')).toBe('above');
        expect(resolvePrefixPosition('inline')).toBe('inline');
    });
});

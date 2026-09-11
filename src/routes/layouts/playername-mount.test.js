import { describe, it, expect } from 'vitest';
import {
    resolveAlign,
    resolvePrefixPosition,
    resolveNameSize,
    resolvePrefixSize,
    prefixRatio,
    requestedScale,
    stackHeight,
    framePadding,
    heightCeiling,
    fitToHeight,
    fitToWidth,
    previewScale,
    sizeNote,
    heightForNameSize,
    DEFAULT_NAME_SIZE,
    MIN_NAME_SIZE,
    MAX_NAME_SIZE,
    DEFAULT_PREFIX_SIZE,
    MIN_PREFIX_SIZE,
    MAX_PREFIX_SIZE,
} from '../../../public/layout/lib/playername-mount.js';

/*
 * The Player Name's sizing rule.
 *
 * The type size is a NUMBER THE PRODUCER TYPES and the frame is only a ceiling:
 * the settings namespace is global, so an absolute size is what makes every
 * Player Name in the show the same size without anything having to reconcile
 * two OBS sources. Everything below is a consequence of that, and every one of
 * these failures is silent — the name renders, it is just the wrong size, in a
 * frame nobody looks at until it is on air beside the other side's.
 */

// The declared native height (playername.html). Under the old height-driven
// rule this number WAS the type size; it is render headroom now, and it appears
// below only as the preview's idea of full scale.
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

describe('resolveNameSize — a typo must not black out a frame', () => {
    it('takes the number it is given', () => {
        expect(resolveNameSize(48)).toBe(48);
        expect(resolveNameSize('64')).toBe(64);
    });

    it('falls back to the default for anything it cannot read', () => {
        expect(resolveNameSize(undefined)).toBe(DEFAULT_NAME_SIZE);
        expect(resolveNameSize(null)).toBe(DEFAULT_NAME_SIZE);
        expect(resolveNameSize('huge')).toBe(DEFAULT_NAME_SIZE);
        expect(resolveNameSize(0)).toBe(DEFAULT_NAME_SIZE);
    });

    it('clamps rather than rejects, so a slip is visible and correctable', () => {
        // A blank source or one glyph filling the frame are both worse on air
        // than a name at the end of the range with an obvious fix.
        expect(resolveNameSize(4)).toBe(MIN_NAME_SIZE);
        expect(resolveNameSize(4000)).toBe(MAX_NAME_SIZE);
    });
});

describe('requestedScale — the size, with NO FRAME in it', () => {
    it('is the asked-for size over the authored one', () => {
        // NAME_SIZE is 36: the CSS draws `36px * var(--pn-scale)`.
        expect(requestedScale(36)).toBeCloseTo(1, 5);
        expect(requestedScale(72)).toBeCloseTo(2, 5);
    });

    it('is what two DIFFERENTLY SIZED sources agree on', () => {
        // The property the whole element rests on. Under the old rule a 200-tall
        // source and a 400-tall one drew the same name 2x apart, and the console
        // carried a row whose whole job was repairing that one pair at a time.
        const asked = requestedScale(48);
        expect(fitToHeight(asked, 200, 'above')).toBe(fitToHeight(asked, 400, 'above'));
    });

    it('does not vary with the prefix position', () => {
        // The old scale did, by 1.53x — so a setting about where a TAG SITS
        // silently resized every name in the show.
        expect(requestedScale(48)).toBeCloseTo(DEFAULT_NAME_SIZE / 36, 5);
    });
});

describe('the frame is a CEILING and nothing else', () => {
    it('holds the asked-for size in a frame that can take it', () => {
        const asked = requestedScale(48);
        expect(fitToHeight(asked, NATIVE_H, 'above')).toBe(asked);
    });

    it('brings a size the box cannot hold down to what it can', () => {
        // 48px with a prefix row wants ~84px of frame. In 60 it comes down,
        // rather than being clipped by .pn-root's overflow: hidden.
        const asked = requestedScale(48);
        const drawn = fitToHeight(asked, 60, 'above');
        expect(drawn).toBeLessThan(asked);
        expect(drawn).toBeCloseTo(heightCeiling(60, 'above'), 5);
    });

    it('lands EXACTLY on the frame at the ceiling, padding included', () => {
        // Solved in one step rather than iterated: the padding is a fraction of
        // the type and the type is what the ceiling bounds, which reads circular
        // and is not, because both are linear in the scale.
        const s = heightCeiling(140, 'above');
        expect(stackHeight('above') * s + framePadding(s) * 2).toBeCloseTo(140, 5);
    });

    it('NEVER grows a name — a tall frame is not a bigger size', () => {
        // The whole complaint about the old rule: an 800x200 source drew a
        // 110px name whether or not anyone asked for one.
        const asked = requestedScale(48);
        expect(fitToHeight(asked, 2000, 'above')).toBe(asked);
        expect(fitToHeight(asked, NATIVE_H, 'off')).toBe(asked);
    });

    it('IGNORES width — an off-aspect source gains name, not dead space', () => {
        // 800x100 min-fit to a 400x100 card put 636px of nothing beside a 164px
        // name. Width is run for the name; it reaches the size only on overflow,
        // so it is not an input here at all: 57.8 of stack + 2 * 0.1 * 36 of pad.
        expect(heightCeiling(100, 'above')).toBeCloseTo(100 / 65, 5);
    });

    it('never clamps against a frame that has not been laid out yet', () => {
        // No ceiling, rather than a ceiling of zero: a mount measured mid-load
        // must not clamp the type to nothing and then be asked to grow it back.
        const asked = requestedScale(48);
        expect(fitToHeight(asked, 0, 'above')).toBe(asked);
        expect(fitToHeight(asked, undefined, 'above')).toBe(asked);
        expect(fitToHeight(asked, -40, 'above')).toBe(asked);
    });
});

describe('framePadding — a fraction of the TYPE, not of the frame', () => {
    it('scales with the name', () => {
        // Both things it makes room for — the font border and the text shadow —
        // are multiples of --pn-scale.
        expect(framePadding(2)).toBeCloseTo(framePadding(1) * 2, 5);
    });

    it('does not read the frame at all', () => {
        // Frame-relative padding gave a small name in a tall box a huge margin
        // and the same name in a short box none, once the frame stopped setting
        // the type.
        expect(framePadding(requestedScale(48))).toBeCloseTo(4.8, 5);
    });

    it('is never negative for a scale that has not settled', () => {
        expect(framePadding(0)).toBe(0);
        expect(framePadding(-1)).toBe(0);
        expect(framePadding(undefined)).toBe(0);
    });
});

describe('fitToWidth — shrink on overflow, and only on overflow', () => {
    it("leaves a name that fits at the size it ASKED for, so a PAIR stays matched", () => {
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

describe('previewScale — a preview is a scale model and has to be told', () => {
    it('divides an absolute size back down to the box it is drawn in', () => {
        // ScaledIframe hands the overlay a genuinely smaller viewport rather
        // than zooming a native render, so 48px drawn in a half-size preview
        // reads as 96 — on the one screen a producer judges fit by.
        expect(previewScale(NATIVE_H / 2, NATIVE_H)).toBeCloseTo(0.5, 5);
        expect(previewScale(NATIVE_H, NATIVE_H)).toBe(1);
    });

    it('answers 1 for a page that declares no native height', () => {
        // Which is what makes a CONTAINER correct: fed-container.js already
        // scales the whole host with one transform and hands each member its
        // native box, so a member dividing here would pay the toll twice.
        expect(previewScale(120, 0)).toBe(1);
        expect(previewScale(120, undefined)).toBe(1);
        expect(previewScale(0, NATIVE_H)).toBe(1);
    });
});

describe('the settings this element has', () => {
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

/*
 * ── SAYING SO ───────────────────────────────────────────────────────────────
 *
 * Both clamps are correct and both are invisible. The producer types 48, a
 * frame too short draws 33, and OBS, the overlay and the broadcast all report
 * that everything is fine — so the mount has to say it itself (rendered only
 * where a broadcast is not; see OverlayBase.setNote).
 */
describe('sizeNote — why this source is not drawing the size it was told to', () => {
    const asked = requestedScale(48);

    it('says nothing when the frame holds the size that was asked for', () => {
        expect(sizeNote({
            nameSize: 48, asked, capped: asked, final: asked,
            frameHeight: 200, prefixPosition: 'above',
        })).toBeNull();
    });

    /*
     * NAMES THE AXIS, because the two clamps have opposite remedies and the
     * wrong guess costs a producer the session: widening a source does nothing
     * whatever for a height clamp, and widening is the instinct.
     */
    it('names the height, the threshold, and that width will not help', () => {
        const capped = fitToHeight(asked, 60, 'above');
        const note = sizeNote({
            nameSize: 48, asked, capped, final: capped,
            frameHeight: 60, prefixPosition: 'above',
        });
        expect(note).toMatch(/48px needs 87px of height/);
        expect(note).toMatch(/this source is 60px/);
        expect(note).toMatch(/drawing at 33px/);
        expect(note).toMatch(/A wider source will not help/);
    });

    it('names the long name when it is the width that binds', () => {
        const note = sizeNote({
            nameSize: 48, asked, capped: asked, final: asked * 0.5,
            frameHeight: 200, prefixPosition: 'above',
        });
        expect(note).toMatch(/too long for this source's width/);
        expect(note).toMatch(/drawing at 24px instead of 48px/);
    });

    /*
     * The numbers are the SOURCE's, never this page's. In a preview both scales
     * carry the same factor, so the ratio divides it out — otherwise the badge
     * in the console's iframe would quote a size no producer could act on.
     */
    it('reports source pixels even in a half-size preview', () => {
        const half = asked * 0.5;
        expect(sizeNote({
            nameSize: 48, asked: half, capped: half * 0.5, final: half * 0.5,
            frameHeight: 30, prefixPosition: 'above',
        })).toMatch(/drawing at 24px/);
    });

    it('follows the prefix position, because the height it needs does', () => {
        const capped = fitToHeight(asked, 50, 'off');
        expect(sizeNote({
            nameSize: 48, asked, capped, final: capped,
            frameHeight: 50, prefixPosition: 'off',
        })).toMatch(/48px needs 60px of height/);
        // The panel reads the same inverse, so the two cannot disagree.
        expect(Math.ceil(heightForNameSize(48, 'off') - 1e-6)).toBe(60);
    });

    it('holds its tongue on a frame that has not been laid out yet', () => {
        expect(sizeNote({
            nameSize: 48, asked: 0, capped: 0, final: 0,
            frameHeight: 0, prefixPosition: 'above',
        })).toBeNull();
    });
});

/*
 * ── THE PREFIX HAS ITS OWN SIZE ─────────────────────────────────────────────
 *
 * It was locked at half the name — a fair default that was never a decision. A
 * sponsor tag is different information from a player's name, and how loud it
 * should be belongs to the producer.
 *
 * Everything downstream is the RATIO between the two rather than a second
 * absolute, so `--pn-scale` stays the single knob: both runs shrink together
 * under a clamp, the font border keeps tracking the type it sits on, and a
 * preview's factor divides out of both at once.
 */
describe('the prefix size', () => {
    it('defaults to exactly half the name, so nothing that shipped moves', () => {
        expect(DEFAULT_PREFIX_SIZE).toBe(DEFAULT_NAME_SIZE / 2);
        expect(prefixRatio(undefined, undefined)).toBeCloseTo(0.5, 5);
        // The authored card: 18px of tag against 36px of name.
        expect(stackHeight('above')).toBeCloseTo(57.8, 5);
    });

    it('clamps a typo rather than rejecting it', () => {
        expect(resolvePrefixSize(30)).toBe(30);
        expect(resolvePrefixSize(0)).toBe(DEFAULT_PREFIX_SIZE);
        expect(resolvePrefixSize('nope')).toBe(DEFAULT_PREFIX_SIZE);
        expect(resolvePrefixSize(2)).toBe(MIN_PREFIX_SIZE);
        expect(resolvePrefixSize(9000)).toBe(MAX_PREFIX_SIZE);
    });

    it('is a proportion of the name, so one scale still drives the card', () => {
        expect(prefixRatio(48, 24)).toBeCloseTo(0.5, 5);
        expect(prefixRatio(48, 48)).toBeCloseTo(1, 5);
        expect(prefixRatio(60, 15)).toBeCloseTo(0.25, 5);
    });

    it('makes the stack taller, so the height a source needs follows it', () => {
        const half = heightForNameSize(48, 'above', 24);
        const big = heightForNameSize(48, 'above', 48);
        expect(big).toBeGreaterThan(half);
        expect(Math.ceil(half - 1e-6)).toBe(87);
    });

    /*
     * INLINE takes the TALLER run. The prefix is baseline-aligned inside the
     * name's line box, which is safe only while the prefix is the smaller of the
     * two — a guarantee that ended the moment it got a size of its own.
     */
    it('lets a large prefix set the inline height', () => {
        expect(stackHeight('inline', 0.5)).toBeCloseTo(37.8, 5);   // the name's line box
        expect(stackHeight('inline', 2)).toBeCloseTo(72, 5);       // 36 * 2, the tag's
    });
});

describe('NOTHING is reserved for a prefix that is off', () => {
    /*
     * `off` is the name's line box and only that. The reserve is a function of
     * the SETTING, so turning the prefix off hands the name every pixel of the
     * frame rather than leaving a gap where a tag would have been.
     */
    it('gives the name the whole frame', () => {
        expect(stackHeight('off')).toBeCloseTo(36 * 1.05, 5);
        expect(stackHeight('off')).toBeLessThan(stackHeight('above'));
    });

    it('drops the height a source needs from 87px to 60px', () => {
        expect(Math.ceil(heightForNameSize(48, 'above', 24) - 1e-6)).toBe(87);
        expect(Math.ceil(heightForNameSize(48, 'off', 24) - 1e-6)).toBe(60);
    });

    it('ignores the prefix SIZE entirely while it is off', () => {
        // A control that still moved the name with its own run switched off
        // would be the reserve this rule exists to deny.
        expect(heightForNameSize(48, 'off', 8)).toBe(heightForNameSize(48, 'off', 200));
    });

    /*
     * The one place space IS held without content, and it is deliberate: the
     * reserve follows the SETTING, not this participant's tag, because two
     * sources framing a scoreboard must draw at one size and only one of the two
     * players may have a sponsor.
     */
    it('still reserves the row for a participant with no tag, while the setting is on', () => {
        expect(stackHeight('above')).toBeGreaterThan(stackHeight('off'));
    });
});

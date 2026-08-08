import { describe, it, expect } from 'vitest';
import {
    CAPTAIN_ART, CAPTAIN_FRAMES, DEFAULT_FRAME, captainFrame,
    STAGE_W, BOARD, MARGIN, BASELINE, CEILING, HEAD_CLEAR,
} from '../../../public/layout/lib/captain-framing.js';

/*
 * The Game Summary's per-captain hero framing
 * (`public/layout/lib/captain-framing.js`).
 *
 * The table in that module is a set of hand-tuned numbers derived from the
 * captain artwork, and numbers like that rot silently — someone nudges a
 * height to make one captain look better and quietly puts another one's face
 * under the data well. So this pins the three promises the frames exist to
 * keep, stated as geometry rather than as pixels:
 *
 *   1. nothing clips at the frame edge,
 *   2. no captain's HEAD ends up behind the centre board,
 *   3. all twelve read as the same size.
 *
 * Everything here is computed from `CAPTAIN_ART` (the measurements) against
 * `CAPTAIN_FRAMES` (the choices), so a frame edit is checked against the art it
 * claims to be framing. Re-measuring the art after an asset-pack change is the
 * one case where these expectations legitimately move.
 */

const SIDES = [1, 2];
const NAMES = Object.keys(CAPTAIN_ART);

// An image fraction, mapped to a distance from THIS side's stage edge. Side 2
// reads the art mirrored about the frame's centre line, and a flip mirrors it
// again — so both together cancel.
function outward(fraction, side, flip) {
    const f = flip ? 1 - fraction : fraction;
    return side === 2 ? 1 - f : f;
}

// A span [lo, hi] of the art, as distances from the stage edge; `hi` is the
// end nearer the centre board.
function span([a, b], frame, side) {
    const p = [a, b].map(v => frame.out + outward(v, side, frame.flip) * frame.w);
    return [Math.min(...p), Math.max(...p)];
}

const every = NAMES.flatMap(name => SIDES.map(side => ({
    name, side, art: CAPTAIN_ART[name], frame: captainFrame(name, side),
})));

describe('captain framing — the table itself', () => {
    it('frames every captain the art table describes, on both sides', () => {
        for (const name of NAMES) {
            expect(CAPTAIN_FRAMES[name], name).toBeTruthy();
            for (const side of SIDES) expect(CAPTAIN_FRAMES[name][side], `${name} s${side}`).toBeTruthy();
        }
        expect(Object.keys(CAPTAIN_FRAMES).sort()).toEqual(NAMES.slice().sort());
    });

    it('derives width from the art, never from the box', () => {
        // The frame chooses a height; the width follows from the source
        // aspect. A width that drifts off this is art being stretched.
        for (const { name, side, art, frame } of every) {
            expect(frame.w, `${name} s${side}`).toBe(Math.round(frame.h * art.ar));
        }
    });

    it('only mirrors art that carries no direction-bearing mark', () => {
        // Mario's cap M and Wario's W are mirror-symmetric and flip fine;
        // Luigi's L, DK's tie, Diddy's cap brim and Waluigi's cap glyph are
        // not, and mirroring them ships a backwards logo on air.
        for (const { name, side, art, frame } of every) {
            if (art.letters) expect(frame.flip, `${name} s${side}`).toBe(false);
        }
    });
});

describe('captain framing — nothing clips', () => {
    it('keeps every captain inside the frame edge', () => {
        for (const { name, side, frame } of every) {
            expect(frame.out, `${name} s${side}`).toBeGreaterThanOrEqual(MARGIN);
            expect(frame.out + frame.w, `${name} s${side} width`).toBeLessThanOrEqual(STAGE_W - MARGIN);
        }
    });

    it('keeps every captain clear of the identity plate above them', () => {
        // All twelve stand on one ground line, so the only way to reach the
        // plate is to be too tall.
        for (const { name, side, frame } of every) {
            expect(BASELINE - frame.h, `${name} s${side}`).toBeGreaterThanOrEqual(CEILING);
        }
    });
});

describe('captain framing — the face is never under the board', () => {
    it('clears the whole head box, not just its centre', () => {
        // The head box is what you watch get eaten, which is why the frames
        // are solved against it rather than against a face point.
        for (const { name, side, art, frame } of every) {
            const [, inner] = span(art.head, frame, side);
            expect(inner, `${name} s${side} head`).toBeLessThanOrEqual(BOARD - HEAD_CLEAR);
        }
    });

    it('keeps the middle 70% of every captain out from behind the board', () => {
        // Sparse trailing geometry — a bat, a tail, DK's raised fist — may
        // tuck behind the well. The character's mass may not.
        for (const { name, side, art, frame } of every) {
            const [, inner] = span(art.ink, frame, side);
            expect(inner, `${name} s${side} core`).toBeLessThanOrEqual(BOARD);
        }
    });
});

describe('captain framing — they read as the same size', () => {
    it('holds every captain to one graphic footprint', () => {
        // Diagonal, not height: a diving pose and a standing pose with the
        // same diagonal read as the same character, while equal heights would
        // make the diver enormous. 1.35 is loose enough for Bowser to outsize
        // Diddy — which is true of the characters — and tight enough that no
        // captain can appear at double another's size.
        const diagonals = every.map(({ frame }) => Math.hypot(frame.w, frame.h));
        expect(Math.max(...diagonals) / Math.min(...diagonals)).toBeLessThanOrEqual(1.35);
    });

    it('does not resize a captain much between sides', () => {
        // Side-specific sizing exists to solve side-specific crowding (the
        // four unmirrorable captains all face left, so side 2 is the tight
        // one). It is not licence for a captain to be a different size
        // depending on which board they land on.
        for (const name of NAMES) {
            const [a, b] = SIDES.map(s => captainFrame(name, s).h);
            expect(Math.max(a, b) / Math.min(a, b), name).toBeLessThanOrEqual(1.2);
        }
    });
});

describe('captainFrame', () => {
    it('measures `out` from the captain\'s own side', () => {
        // Side 1 reads it as `left`, side 2 as `right` — the mount writes it
        // straight into whichever edge property that side uses.
        const l = captainFrame('Bowser', 1);
        const r = captainFrame('Bowser', 2);
        expect(l.out).toBe(r.out);
        expect(l.flip).not.toBe(r.flip);   // mirrored pair: same box, opposite facing
    });

    it('stands every captain on the same ground line', () => {
        const bottoms = new Set(every.map(({ frame }) => frame.bottom));
        expect(bottoms.size).toBe(1);
    });

    it('falls back to a neutral frame for a character it has never measured', () => {
        // A modded roster, or the characters/ pack standing in for a captain
        // the user's pack is missing. It must land somewhere sane rather than
        // throw or collapse to zero.
        for (const side of SIDES) {
            const f = captainFrame('Petey', side);
            expect(f.h).toBe(DEFAULT_FRAME.h);
            expect(f.out).toBeGreaterThanOrEqual(MARGIN);
            expect(f.flip).toBe(false);
            expect(f.w).toBeGreaterThan(0);
        }
        expect(captainFrame(undefined, 1).h).toBe(DEFAULT_FRAME.h);
    });
});

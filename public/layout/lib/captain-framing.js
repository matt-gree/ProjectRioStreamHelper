// captain-framing.js — where each captain's hero art sits on the Game Summary.
//
// The Game Summary (postgame-vs-mount.js) is a three-column composition: a
// captain down each outer edge and the data well between them. The captain art
// is the problem this module exists for. Every captain PNG is a tightly-cropped
// action pose with NO transparent padding, and the poses are wildly different
// shapes — Daisy is 0.46 wide-per-tall standing straight up, Luigi is 1.27
// mid-dive. Dropping all twelve into one fixed box under `object-fit: contain`
// (what this used to do) fails twice over:
//
//   • SIZE. `contain` fits whichever dimension binds first, so the box decides
//     the scale, not the character. In a 520×760 box Daisy rendered 760px tall
//     and Luigi 410px — the same two captains, one nearly twice the other.
//   • FRAMING. The box was centred on art whose subject is nowhere near its
//     own centre. Bowser's head sits at 74% across his image, Wario's at 26%.
//     Centre the box and half the cast puts its FACE under the data well.
//
// So the art is measured once, here, and each captain gets an explicit frame
// per side. Three things had to come out right, and all three are pinned by
// `src/routes/layouts/captain-framing.test.js` — change a number and the test
// tells you which promise you broke:
//
//   1. NOTHING CLIPS. The art's outer edge never crosses `MARGIN`, so no
//      captain gets a straight slice taken off them at the frame edge.
//   2. THE FACE IS NEVER UNDER THE BOARD. Not the face's centre — the whole
//      head box, which is what you actually see get eaten. It clears
//      `BOARD` by `HEAD_CLEAR`. Sparse trailing geometry (a bat, a tail, DK's
//      raised fist) may tuck behind; `HIDE_MAX` caps how much.
//   3. THEY LOOK THE SAME SIZE. Heights are normalised on the art's DIAGONAL,
//      not its height — a diving pose and a standing pose with the same
//      diagonal read as the same character size, while equal *heights* would
//      make the diver enormous and equal *areas* would make the slim ones
//      giants. `mult` then nudges for canonical size (DK and Bowser are big
//      characters; Diddy and Bowser Jr are small ones).
//
// FLIPPING is a mirror on the <img>, and it is the strongest lever available:
// it moves the head to the other end of the frame for free. It is only allowed
// on art with no direction-bearing mark — `letters: false`. Mario's cap M and
// Wario's cap/bat W are mirror-symmetric glyphs and flip fine; Luigi's L, DK's
// tie, Diddy's cap brim and Waluigi's cap glyph are not, and those four are
// framed by size and offset alone. Where both orientations clear the board
// equally, the flip that makes a captain face INWARD wins — a VS card wants
// the two of them looking at each other.
//
// RE-DERIVING after an art change: the numbers below come from the alpha
// channel of the pack in `user_data/game_assets/msb/captains/` (aspect, ink
// distribution) plus a hand-read head box. The art is user-supplied and PRSH
// ships none of it (Nintendo IP), so a different pack CAN have different
// proportions — which is why the mount keeps `object-fit: contain` on the
// image. A mismatched pack then letterboxes inside its frame instead of
// stretching or spilling: wrong-ish, never broken.

// ── stage geometry ──────────────────────────────────────────────────────────
// Measured off the built layout (getBoundingClientRect), not guessed. The data
// well is x 480–1440 · y 268–788, the linescore band x 473–1447 · y 830–1004,
// the identity plates end at y 187 (y 227 with a WINNER line). The outer
// columns are therefore clear top to bottom, which is why the captains can run
// far lower than the board does.
export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const BOARD = 480;        // distance from either stage edge to the data well
export const MARGIN = 40;        // stage edge → outermost pixel of the art
export const BASELINE = 1000;    // the ground line every captain stands on
export const CEILING = 240;      // below the identity plate; nothing may reach past it
export const HEAD_CLEAR = 25;    // the head box stops at least this far outside BOARD
export const HIDE_MAX = 0.15;    // ≤ this share of a captain's ink may hide behind the board

// ── the measured art ────────────────────────────────────────────────────────
// `ar`      pixel aspect (w/h) of the source PNG — the frame's width is h × ar.
// `head`    head+cap span as image fractions; the inner end is the thing that
//           must clear the board.
// `faces`   which way the character looks, un-flipped ('l' | 'r').
// `letters` art carries a mark that mirroring would ruin → never flip.
// `ink`     ink mass at the 15th/85th percentile across the image — the "core"
//           of the character, used to decide how much of them can tuck behind
//           the board.
export const CAPTAIN_ART = {
    'Mario':     { ar: 0.877551, head: [0.10, 0.75], faces: 'r', letters: false, ink: [0.36, 0.81] },
    'Luigi':     { ar: 1.267299, head: [0.22, 0.62], faces: 'l', letters: true,  ink: [0.18, 0.72] },
    'DK':        { ar: 0.964948, head: [0.12, 0.42], faces: 'l', letters: true,  ink: [0.16, 0.76] },
    'Diddy':     { ar: 1.129789, head: [0.12, 0.48], faces: 'l', letters: true,  ink: [0.18, 0.76] },
    'Peach':     { ar: 0.532431, head: [0.33, 0.62], faces: 'r', letters: false, ink: [0.20, 0.69] },
    'Daisy':     { ar: 0.460615, head: [0.38, 0.68], faces: 'l', letters: false, ink: [0.33, 0.69] },
    'Yoshi':     { ar: 0.945315, head: [0.28, 0.72], faces: 'r', letters: false, ink: [0.25, 0.77] },
    'Bowser':    { ar: 0.889272, head: [0.58, 0.92], faces: 'r', letters: false, ink: [0.31, 0.78] },
    'Wario':     { ar: 0.781034, head: [0.08, 0.52], faces: 'l', letters: false, ink: [0.18, 0.74] },
    'Waluigi':   { ar: 1.042118, head: [0.28, 0.60], faces: 'l', letters: true,  ink: [0.27, 0.79] },
    'Birdo':     { ar: 0.951509, head: [0.48, 0.88], faces: 'r', letters: false, ink: [0.43, 0.85] },
    'Bowser Jr': { ar: 0.834885, head: [0.48, 0.82], faces: 'l', letters: false, ink: [0.30, 0.76] },
};

// ── the frames ──────────────────────────────────────────────────────────────
// Per side: `h` rendered height in stage px, `out` the gap from that side's
// stage edge to the art's outer edge, `flip` a horizontal mirror. Width is
// derived (h × ar) so the art is never stretched.
//
// The seven flippable captains come out mirror-symmetric — same height, same
// offset, opposite flip — which is the composition working as intended. The
// four that can't be mirrored (Luigi, DK, Diddy, Waluigi) all face left, so on
// side 2 their heads start out on the board side and the only lever left is to
// pull them down a size: that's why their side-2 heights are the smaller ones.
export const CAPTAIN_FRAMES = {
    'Mario':     { 1: { h: 571, out:  40, flip: false }, 2: { h: 571, out:  40, flip: true  } },
    'Luigi':     { 1: { h: 471, out:  40, flip: false }, 2: { h: 417, out:  40, flip: false } },
    'DK':        { 1: { h: 574, out:  40, flip: false }, 2: { h: 485, out:  40, flip: false } },
    'Diddy':     { 1: { h: 453, out:  40, flip: false }, 2: { h: 410, out:  40, flip: false } },
    'Peach':     { 1: { h: 671, out: 102, flip: false }, 2: { h: 671, out: 102, flip: true  } },
    'Daisy':     { 1: { h: 690, out: 104, flip: true  }, 2: { h: 690, out: 104, flip: false } },
    'Yoshi':     { 1: { h: 552, out:  40, flip: false }, 2: { h: 552, out:  40, flip: true  } },
    'Bowser':    { 1: { h: 596, out:  40, flip: true  }, 2: { h: 596, out:  40, flip: false } },
    'Wario':     { 1: { h: 569, out:  55, flip: false }, 2: { h: 569, out:  55, flip: true  } },
    'Waluigi':   { 1: { h: 526, out:  40, flip: false }, 2: { h: 526, out:  40, flip: false } },
    'Birdo':     { 1: { h: 551, out:  40, flip: true  }, 2: { h: 551, out:  40, flip: false } },
    'Bowser Jr': { 1: { h: 537, out:  50, flip: true  }, 2: { h: 537, out:  50, flip: false } },
};

// Anything that isn't one of the twelve captains — a modded roster, or the
// characters/ pack standing in for a captain the pack is missing. Mid-sized,
// off the frame edge, never mirrored: `object-fit: contain` in the mount fits
// whatever shape actually arrives inside this box.
export const DEFAULT_FRAME = { h: 560, out: 60, flip: false, ar: 0.9 };

/**
 * Where a captain's hero art goes, in stage pixels.
 *
 * @param {string} name  MSB character name (`score.{N}.player.{T}.captain`)
 * @param {1|2} side     1 = left, 2 = right
 * @returns {{ w:number, h:number, out:number, bottom:number, flip:boolean }}
 *   `out` is measured from THAT side's stage edge (so it's `left` for side 1
 *   and `right` for side 2), `bottom` from the stage floor.
 */
export function captainFrame(name, side) {
    const art = CAPTAIN_ART[name];
    const f = CAPTAIN_FRAMES[name]?.[side === 2 ? 2 : 1];
    if (!art || !f) {
        const d = DEFAULT_FRAME;
        return { w: Math.round(d.h * d.ar), h: d.h, out: d.out, bottom: STAGE_H - BASELINE, flip: d.flip };
    }
    return {
        w: Math.round(f.h * art.ar),
        h: f.h,
        out: f.out,
        bottom: STAGE_H - BASELINE,
        flip: f.flip,
    };
}

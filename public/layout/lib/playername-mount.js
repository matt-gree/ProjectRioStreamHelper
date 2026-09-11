/*
 * playername-mount.js — one side's player name, as its own OBS source.
 *
 * Draws `score.{N}.player.{T}.rioName`, with the address-book prefix
 * (`…player.{T}.team` — the sponsor/tag) beside it. Three producer settings
 * shape it, all under `overlays.playername.*` and therefore SHARED by both
 * sides:
 *
 *   nameSize        px — the type size, full stop (see below)
 *   align           auto | left | center | right
 *   prefixPosition  above | below | inline | off
 *
 * `auto` is the default and has to exist. The setting is global (one namespace,
 * like the roster's), and the behaviour it replaces was side-dependent — side 1
 * hugged the left edge and side 2 the right, which is what a name sitting at
 * either end of a scoreboard wants. A global setting cannot express that with
 * three literal values, so `auto` is the value that means "mirror the sides",
 * and defaulting to it is what keeps every source already in a producer's scene
 * looking the way it does today.
 *
 * ── THE SIZE IS A NUMBER THE PRODUCER TYPES; THE FRAME IS ONLY A CEILING ──
 *
 * `nameSize` IS the type size, in px. The box the source happens to be does not
 * set it and neither does the length of the name: 48 means 48, on every Player
 * Name source in the show.
 *
 * That last clause is the whole point, and it comes from the NAMESPACE. These
 * settings are global — one `overlays.playername.*` for both sides and every
 * board — so an absolute size makes every name identical BY CONSTRUCTION. The
 * rule this replaced derived the size from the source's own height, which made
 * sameness something a producer had to maintain by hand: two names framing a
 * scoreboard matched only while their OBS dimensions matched, and the stage's
 * "make this the same size as the other one" row existed to repair one pair at
 * a time. There is nothing left to repair, because there is no longer any
 * per-source input to the size.
 *
 * THE FRAME ONLY EVER CLAMPS DOWN. `fitToHeight` and `fitToWidth` shrink a
 * requested size that will not fit the box, and neither one can grow it. So the
 * rule reads in full as "48, unless this frame physically cannot hold 48" — the
 * name can never be clipped by `.pn-root`'s `overflow: hidden`, and the
 * long-name fallback is the same mechanism on the other axis rather than a
 * special case bolted beside it.
 *
 * Two things that were bugs under the old rule simply stop existing: the prefix
 * POSITION no longer resizes anything (it moved the type by 1.53x, on every
 * source at once, from a setting about where a tag sits), and the declared
 * 800x200 goes back to being pure render headroom instead of a covert
 * instruction to draw a 110px name.
 *
 * ── PADDING IS A FRACTION OF THE TYPE, NOT OF THE FRAME ──
 *
 * It is there to hold the font border and the text shadow, and both of those
 * scale with `--pn-scale` — so a tall frame must not hand a small name a huge
 * margin, nor a short frame hand it none. Measuring it against the type is also
 * what keeps the height ceiling solvable in one step rather than circular; see
 * `heightCeiling`.
 *
 * ── A PREVIEW IS A SCALE MODEL, AND HAS TO BE TOLD ──
 *
 * ScaledIframe renders this page into a smaller iframe and lets the overlay lay
 * itself out against that viewport (it does not zoom a native render — see the
 * component's header). An absolute size would therefore draw a full 48px name
 * in a half-size box: proportionally double, on the one screen a producer
 * checks fit against. `previewScale` divides it back out, in PREVIEW_MODE only.
 *
 * Inside a CONTAINER the factor is 1, and must be: fed-container.js already
 * scales the whole host with a single transform there and hands every member
 * its native box (`fitHostForPreview`). Same branch, made once, in one place —
 * which is why this one reads the page's own declared native height and finds
 * none on the container shell.
 *
 * The font border (`overlays.global.textStrokeWidth` / `…Color`, pinnable per
 * element from this element's Production stage panel — the Style Overrides
 * section) is drawn on BOTH runs. `paint-order: stroke fill` puts the stroke
 * behind the glyph so an outline grows outward instead of eating into the
 * letterform; a browser source too old to honour it still draws the border,
 * centred on the outline, which is thinner but never wrong. The prefix takes
 * half the width — see the rule.
 *
 * Styles are injected and class-scoped (`.pn-*`) rather than left in the page,
 * because this mount also runs inside a container shell that has no stylesheet
 * of its own.
 *
 *   const pn = mountPlayerName({ host, sb, team });
 *   pn.update(OverlayBase.state, OverlayBase.settings);
 *
 * Requires overlay-base.js (OverlayBase).
 */

// The card as authored, at scale 1. Every length below is a multiple of these,
// and `--pn-scale` is the one number the whole card is drawn from — so the type
// size the producer asks for reaches the CSS as `nameSize / NAME_SIZE` and
// nothing else in this block has to know the setting exists.
const NAME_SIZE = 36;
const NAME_LINE = 1.05;
const STACK_GAP = 2;
const INLINE_GAP = 10;

/*
 * Room kept around the type for the font border and the text shadow to bleed
 * into, as a FRACTION of the DRAWN NAME SIZE — a tenth, so a 48px name keeps
 * 4.8px on every side.
 *
 * Measured against the type rather than the frame because that is what it is
 * for: both things it makes room for are multiples of `--pn-scale`, and once
 * the frame stopped setting the type, a frame-relative padding would have given
 * a small name in a tall box a huge margin and the same name in a short box
 * none at all. It also lands within a pixel of what the old 6%-of-height drew
 * at the shipped size, so nothing visibly moved on the way across.
 *
 * It is not a worst-case allowance and does not pretend to be:
 * `-webkit-text-stroke` at its 12px maximum bleeds 6px outward and
 * `textShadowBlur` goes to 40px, either of which `.pn-root`'s `overflow:
 * hidden` will clip at any padding. It covers the settings a producer runs.
 */
const PAD_RATIO = 0.1;

/*
 * The type size in px when nobody has said otherwise, and the range the setting
 * accepts. 48 is a name read at a glance on a 1080p canvas; the ceiling is well
 * past anything a lower third wants and exists so a typo cannot black out a
 * frame with one glyph.
 */
export const DEFAULT_NAME_SIZE = 48;
export const MIN_NAME_SIZE = 12;
export const MAX_NAME_SIZE = 200;

/*
 * The prefix's own size, in px, and independent of the name's.
 *
 * It was locked at half the name (TAG_SIZE 18 against NAME_SIZE 36) — a ratio
 * that is a reasonable default and was never a decision. A sponsor tag is a
 * different piece of information from a player's name and how loud it should be
 * is a producer's call, not a constant in a mount.
 *
 * 24 is exactly half of DEFAULT_NAME_SIZE, so an untouched pair draws precisely
 * what shipped. Everything downstream is expressed as the RATIO between the two
 * (`prefixRatio`) rather than as a second absolute: one `--pn-scale` still
 * drives the whole card, both runs shrink together under a clamp, and the font
 * border keeps tracking the type it sits on.
 */
export const DEFAULT_PREFIX_SIZE = 24;
export const MIN_PREFIX_SIZE = 8;
export const MAX_PREFIX_SIZE = 200;

// The shipped proportion, and the fallback the CSS carries so a stale document
// draws what it always did rather than an unstyled run.
const DEFAULT_TAG_RATIO = DEFAULT_PREFIX_SIZE / DEFAULT_NAME_SIZE;

const CSS = `
.pn-root { position: absolute; inset: 0; overflow: hidden; }
/* TWO ELEMENTS, TWO QUESTIONS (and no backticks in here: the whole block is a
   template literal). The box answers WHERE the type sits in the frame — one
   flex line holding one item, so vertical is align-items and horizontal is
   justify-content, and neither property has a second job. The lines element
   answers how the two runs sit against EACH OTHER.

   That split is what retired the wrap trick this replaced. The runs used to be
   direct children of the box, so inline mode had to turn the box on its side,
   which spent align-items on the baseline and left nothing to centre with —
   flex-wrap: wrap was there only so align-content would answer. It also let the
   pair really wrap, and the shrink-to-fit solves for an EXACT fit, so a name
   that just fitted broke onto a second line and stood 112 units tall in an
   88-unit frame. Inline is nowrap now and cannot. */
.pn-box {
  box-sizing: border-box; margin: 0;
  position: absolute; inset: 0;
  padding: var(--pn-pad, 6px);
  display: flex; align-items: center;
  /* A NAME TAKES THE DISPLAY ROLE. This element is the one whose entire job is
     a participant's name, and it was the only place in the show drawing one in
     the body face: the scoreboard, Commentary, Player Plates, the Matchup and
     the schedule all draw the same person's name from --font-display. The
     sizing arithmetic is unaffected - stackHeight is derived from the declared
     line-heights, not from font metrics - and the display face is the narrower
     of the two, so a long name reaches fitToWidth's clamp later, never sooner. */
  font-family: var(--font-display, 'Rajdhani', 'Arial Narrow', sans-serif);
}
.pn-lines { display: flex; flex-direction: column; gap: calc(${STACK_GAP}px * var(--pn-scale, 1)); }
.pn-a-left   { justify-content: flex-start; }
.pn-a-center { justify-content: center; }
.pn-a-right  { justify-content: flex-end; }
.pn-a-left   .pn-lines { align-items: flex-start; text-align: left; }
.pn-a-center .pn-lines { align-items: center;     text-align: center; }
.pn-a-right  .pn-lines { align-items: flex-end;   text-align: right; }
/* After the three above on purpose: equal specificity, so source order is what
   lets the baseline win over the edge alignment on this one axis. */
.pn-p-inline .pn-lines {
  flex-direction: row; flex-wrap: nowrap;
  align-items: baseline; gap: calc(${INLINE_GAP}px * var(--pn-scale, 1));
}
/* Below = the same stack, reordered. Nothing moves in the DOM, so the name
   keeps its place in the reading order for anything that cares. */
.pn-p-below .pn-tag { order: 1; }
.pn-p-off .pn-tag { display: none; }
.pn-tag {
  margin: 0;
  font-size: calc(${NAME_SIZE}px * var(--pn-scale, 1) * var(--pn-tag-ratio, ${DEFAULT_TAG_RATIO}));
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tag-color, var(--accent, #f59f00));
  /*
   * THE SHADOW IS A FILTER, not a text-shadow, and only because a FONT BORDER
   * is painted beside it.
   *
   * -webkit-text-stroke is non-standard and nothing defines whether it
   * participates in text-shadow. Chrome casts the shadow from the STROKED
   * glyph, so a border fattens the shape the halo is generated from and makes
   * it dramatically denser; OBS's CEF does not. One setting therefore drew two
   * different overlays — the console preview showed a huge soft cloud and the
   * broadcast showed almost nothing, which reads as "the shadow is broken in
   * OBS" and sent us looking at blur radii, backdrops and upscaling for it.
   *
   * filter: drop-shadow() is defined over the element's RENDERED alpha, and
   * the stroke is part of what was rendered. There is nothing left for a
   * renderer to interpret, so the preview and the broadcast agree.
   *
   * Taken from the PARTS rather than the composed --text-shadow: that var is
   * the literal none when the shadow is off, and drop-shadow(none) is
   * invalid. The parts are published as a transparent zero blur for exactly
   * this — they compose to nothing without a second switch to read.
   *
   * A theme SVG keeps plain text-shadow: var(--text-shadow). No stroke is
   * painted beside it there, so there is nothing to disagree about.
   */
  filter: drop-shadow(0px 0px calc(var(--text-shadow-blur, 0px) * var(--pn-scale, 1)) var(--text-shadow-color, transparent));
  /* THE BORDER TRACKS THE TYPE IT SITS ON, which is what the ratio is. One
     width across two sizes is not one border: 3px around the name is a rim, and
     the same 3px around a half-size prefix closed over the counters and
     swallowed the accent colour whole. The producer sets the border they can
     see — the name — and the prefix keeps the same optical weight at whatever
     size it has been given. (It was a literal 0.5 while the ratio was a
     constant; the moment the prefix got its own size that number was a second,
     silently disagreeing copy of it.) */
  -webkit-text-stroke: calc(var(--text-stroke-width, 0px) * var(--pn-scale, 1) * var(--pn-tag-ratio, ${DEFAULT_TAG_RATIO})) var(--text-stroke-color, transparent);
  paint-order: stroke fill;
  white-space: nowrap;
}
/* A participant with no prefix leaves no gap — the gap belongs to a row that
   has something in it. The SCALE is unaffected: it reads the prefix setting,
   never the content, so this side stays the same size as the one opposite. */
.pn-tag:empty { display: none; }
.pn-name {
  margin: 0;
  font-size: calc(${NAME_SIZE}px * var(--pn-scale, 1));
  font-weight: 700;
  line-height: ${NAME_LINE};
  color: var(--text-primary, #ffffff);
  filter: drop-shadow(0px 0px calc(var(--text-shadow-blur, 0px) * var(--pn-scale, 1)) var(--text-shadow-color, transparent));
  -webkit-text-stroke: calc(var(--text-stroke-width, 0px) * var(--pn-scale, 1)) var(--text-stroke-color, transparent);
  paint-order: stroke fill;
  white-space: nowrap;
}
`;

let cssInjected = false;
function injectCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.id = 'playername-mount-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    cssInjected = true;
}

const ALIGNMENTS = new Set(['left', 'center', 'right']);
const PREFIX_POSITIONS = new Set(['above', 'below', 'inline', 'off']);

/**
 * Which edge the name sits on, for one side.
 *
 * `auto` — and anything unrecognised, so a stale or hand-edited value degrades
 * to the shipped behaviour rather than to a blank corner — mirrors the sides:
 * side 1 left, side 2 right.
 */
export function resolveAlign(setting, team) {
    const want = String(setting ?? 'auto');
    if (ALIGNMENTS.has(want)) return want;
    return Number(team) === 2 ? 'right' : 'left';
}

export function resolvePrefixPosition(setting) {
    const want = String(setting ?? 'above');
    return PREFIX_POSITIONS.has(want) ? want : 'above';
}

/**
 * How tall the type stands at scale 1, for one prefix position and one
 * name-to-prefix proportion.
 *
 * A FUNCTION OF THE SETTINGS, never of the text: `above`/`below` stack two runs
 * and reserve room for both whether or not this participant has a prefix, while
 * `off` is the name alone. Both settings are global, so both sides of a pair
 * always answer the same — which is the whole reason the scale is not measured
 * off the ink.
 *
 * NOTHING IS RESERVED WHEN THE PREFIX IS OFF. `off` is the name's line box and
 * only that, so turning the prefix off gives the name every pixel of the frame
 * — at the shipped proportions a 48px name needs 87px of height with a prefix
 * row above it and 60px without one.
 *
 * INLINE TAKES THE TALLER RUN. The prefix is baseline-aligned inside the name's
 * line box, which is a safe simplification only while the prefix is the smaller
 * of the two — and it stopped being guaranteed the moment the prefix got a size
 * of its own. A `max` costs nothing at the shipped ratio (37.8 against 18) and
 * is the difference between a clamp and a clipped tag at any ratio above ~1.
 */
export function stackHeight(prefixPosition, ratio = DEFAULT_TAG_RATIO) {
    const nameLine = NAME_SIZE * NAME_LINE;
    // line-height: 1 on .pn-tag, so its line box IS its type size.
    const tagLine = NAME_SIZE * Math.max(0, Number(ratio) || 0);
    const p = resolvePrefixPosition(prefixPosition);
    if (p === 'above' || p === 'below') return tagLine + STACK_GAP + nameLine;
    if (p === 'inline') return Math.max(nameLine, tagLine);
    return nameLine;
}

/**
 * The type size the producer asked for, in px.
 *
 * Clamped rather than rejected: a value out of range is a typo, and a typo
 * should give you a name you can see and correct on air rather than a blank
 * source or a single glyph filling the frame.
 */
export function resolveNameSize(setting) {
    const n = Number(setting);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_NAME_SIZE;
    return Math.min(Math.max(n, MIN_NAME_SIZE), MAX_NAME_SIZE);
}

/**
 * The prefix's type size the producer asked for, in px. Clamped for the reason
 * the name's is: a typo should give you something you can see and correct.
 */
export function resolvePrefixSize(setting) {
    const n = Number(setting);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_PREFIX_SIZE;
    return Math.min(Math.max(n, MIN_PREFIX_SIZE), MAX_PREFIX_SIZE);
}

/**
 * The prefix as a PROPORTION of the name — the one number the card is drawn
 * from once the two sizes are known.
 *
 * A ratio rather than a second absolute size, so `--pn-scale` stays the single
 * knob: both runs shrink together under a clamp, the font border keeps tracking
 * the type it sits on, and a preview's scale factor divides out of both at
 * once. Two independent absolutes in the CSS would be two things to clamp and
 * two chances for them to disagree.
 */
export function prefixRatio(nameSize, prefixSize) {
    return resolvePrefixSize(prefixSize) / resolveNameSize(nameSize);
}

/**
 * That size as `--pn-scale` — the multiplier over the authored card.
 *
 * No frame in it anywhere, which is the property the whole element now rests
 * on: two sources of different dimensions reading one global setting compute
 * the same number here, so they draw the same size without anything having to
 * reconcile them.
 */
export function requestedScale(nameSize) {
    return resolveNameSize(nameSize) / NAME_SIZE;
}

/** Padding on all four sides, at a given scale. */
export function framePadding(scale) {
    return Math.max(0, Number(scale) || 0) * NAME_SIZE * PAD_RATIO;
}

/**
 * The largest scale a frame of this height can hold — the stack plus the
 * padding either side of it.
 *
 * SOLVED, NOT ITERATED. Padding is a fraction of the type and the type is what
 * the ceiling is trying to bound, which reads circular; it is not, because both
 * are linear in the scale:
 *
 *     h >= stack*s + 2*PAD_RATIO*NAME_SIZE*s   =>   s <= h / (stack + 2*pad1)
 *
 * A frame that has not been laid out yet has no ceiling rather than a ceiling
 * of zero — a mount measured mid-load must not clamp the type to nothing and
 * then be asked to grow it back.
 */
export function heightCeiling(frameHeight, prefixPosition, ratio = DEFAULT_TAG_RATIO) {
    const h = Number(frameHeight) || 0;
    if (h <= 0) return Infinity;
    return h / (stackHeight(prefixPosition, ratio) + 2 * NAME_SIZE * PAD_RATIO);
}

/**
 * The frame height `nameSize` needs in order to be drawn at all — the inverse of
 * `heightCeiling`, and the number a producer cannot possibly guess.
 *
 * It exists because the clamp is otherwise SILENT and its threshold is not
 * intuitive: 48px type with a prefix row above it wants 87px of frame, so a
 * source dragged into the natural "name bar" shape (wide and short) is clamped
 * from the first frame, and making it WIDER never helps because it is the
 * height that binds. The console says this out loud on the Player Name's stage
 * panel; it is exported so the panel and the overlay cannot disagree about the
 * threshold.
 */
export function heightForNameSize(nameSize, prefixPosition, prefixSize) {
    const scale = requestedScale(nameSize);
    const ratio = prefixRatio(nameSize, prefixSize);
    return scale * (stackHeight(prefixPosition, ratio) + 2 * NAME_SIZE * PAD_RATIO);
}

/**
 * Shrink-to-fit on the vertical, and only that.
 *
 * The twin of `fitToWidth`, and the reason the frame can be a pure ceiling: a
 * requested size the box cannot hold comes down to what it can, so `overflow:
 * hidden` never has a name to clip. It can only ever return something smaller —
 * a short frame is not permission to grow the type on a tall one.
 */
export function fitToHeight(scale, frameHeight, prefixPosition, ratio = DEFAULT_TAG_RATIO) {
    const s = Number(scale) || 0;
    return Math.min(s, heightCeiling(frameHeight, prefixPosition, ratio));
}

/**
 * Shrink-on-overflow, and only that: a name that fits keeps the size it asked
 * for, so a pair stays matched until one of them genuinely runs out of room.
 */
export function fitToWidth(scale, widestLine, available) {
    const w = Number(widestLine) || 0;
    const a = Number(available) || 0;
    if (w <= 0 || a <= 0 || w <= a) return scale;
    return scale * (a / w);
}

/**
 * Why this source is not drawing the size it was told to — or null when it is.
 *
 * THE CLAMPS ARE CORRECT AND INVISIBLE, which is the whole problem. A frame too
 * short for 48px draws 33 rather than clipping the name, and nothing in OBS,
 * in the overlay, or on the broadcast says a word: the producer typed 48, the
 * stream shows 33, and both programs report that everything is fine.
 *
 * It names the AXIS, because the two have opposite remedies and the wrong guess
 * costs a producer the whole session — a height clamp is not helped by a wider
 * source, which is the exact instinct it defeats.
 *
 * Everything is stated in the SOURCE's own pixels (`final / asked` is a pure
 * ratio, so the preview factor divides out) — the numbers a producer can act on
 * are the ones they typed and the ones OBS shows them, never this page's.
 *
 * Pure, and exported, so the console can pin the same sentence the overlay says.
 */
export function sizeNote({
    nameSize, prefixSize, asked, capped, final, frameHeight, prefixPosition,
}) {
    const size = resolveNameSize(nameSize);
    if (!(asked > 0) || !(final > 0) || final >= asked - 1e-9) return null;
    const drawn = Math.round(size * (final / asked));

    if (capped < asked - 1e-9) {
        const needed = Math.ceil(heightForNameSize(size, prefixPosition, prefixSize) - 1e-6);
        return `${size}px needs ${needed}px of height — this source is `
            + `${Math.round(frameHeight)}px, so the name is drawing at ${drawn}px. `
            + `A wider source will not help.`;
    }
    return `The name is too long for this source's width, so it is drawing at `
        + `${drawn}px instead of ${size}px.`;
}

/**
 * How much smaller than its real self this page is being drawn.
 *
 * 1 everywhere except a preview iframe. ScaledIframe hands the overlay a
 * genuinely smaller viewport rather than zooming a native render, so an
 * absolute type size drawn there is proportionally too big — a 48px name in a
 * half-size box reads as 96, on the one screen a producer judges fit by.
 *
 * Answering 1 for a page that declares no native height is deliberate and is
 * what makes a CONTAINER correct: fed-container.js scales the whole host there
 * with one transform and hands each member its native box, so a member that
 * divided by anything would be paying the preview toll twice.
 */
export function previewScale(frameHeight, nativeHeight) {
    const h = Number(frameHeight) || 0;
    const n = Number(nativeHeight) || 0;
    if (h <= 0 || n <= 0) return 1;
    return h / n;
}

export function mountPlayerName({ host, sb = 1, team = 1 }) {
    injectCss();
    const SCOREBOARD = Number(sb) || 1;
    const TEAM = Number(team) === 2 ? 2 : 1;

    const NAME_KEY = `score.${SCOREBOARD}.player.${TEAM}.rioName`;
    // Address-book prefix (sponsor/tag) projects to score.player.{T}.team.
    const TAG_KEY = `score.${SCOREBOARD}.player.${TEAM}.team`;

    const root = document.createElement('div');
    root.className = 'pn-root';
    const box = document.createElement('div');
    box.className = 'pn-box';
    const lines = document.createElement('div');
    lines.className = 'pn-lines';
    const tagEl = document.createElement('span');
    tagEl.className = 'pn-tag';
    const nameEl = document.createElement('span');
    nameEl.className = 'pn-name';
    lines.append(tagEl, nameEl);
    box.appendChild(lines);
    root.appendChild(box);
    host.appendChild(root);
    root.dataset.team = TEAM;

    // Both inputs to the scale are SETTINGS, so it is recomputed from update()
    // as well as on a resize — hence the last-seen values here.
    let prefixPosition = 'above';
    let nameSize = DEFAULT_NAME_SIZE;
    let prefixSize = DEFAULT_PREFIX_SIZE;

    function setScale(scale) {
        root.style.setProperty('--pn-scale', String(scale));
    }

    /*
     * How much smaller than its real self this page is drawn — see previewScale.
     *
     * The declared native height is the page's own (`body.dataset.refW/refH`,
     * the same convention ScaledIframe measures by), NOT this element's
     * registry entry, because the page might be the container shell. That shell
     * declares none, which is exactly the answer a member wants: its own host
     * is already at native size inside fed-container's fit transform.
     */
    function previewFactor(frameHeight) {
        if (!window.OverlayBase?.PREVIEW_MODE) return 1;
        return previewScale(frameHeight, Number(document.body.dataset.refH));
    }

    /*
     * Draw the type at the size the producer asked for, brought down by
     * whichever edge of this box it does not fit inside.
     *
     * Two passes, and they are exact rather than iterative: the run widths are
     * linear in font-size, so one correction lands. The first pass has to be
     * committed before the rects are read or the measurement describes the
     * previous scale.
     *
     * The padding comes off the HEIGHT-capped scale and is not revisited after
     * the width fit. A name that shrank because it was too long has not earned
     * more room around it — the padding is the frame's allowance for the border
     * and the shadow, and those came down with the type.
     */
    function applyScale() {
        const w = root.clientWidth;
        const h = root.clientHeight;
        if (!h) return;
        const ratio = prefixRatio(nameSize, prefixSize);
        root.style.setProperty('--pn-tag-ratio', String(ratio));
        const asked = requestedScale(nameSize) * previewFactor(h);
        const capped = fitToHeight(asked, h, prefixPosition, ratio);
        const pad = framePadding(capped);
        root.style.setProperty('--pn-pad', `${pad}px`);
        setScale(capped);
        if (!w) return;
        const final = fitToWidth(capped, widestLine(capped), w - pad * 2);
        setScale(final);
        /*
         * Say so — in the document and the console always, on screen only where
         * a broadcast is not (see OverlayBase.setNote). This is the one report
         * that reaches a producer looking at OBS rather than at the console.
         */
        window.OverlayBase?.setNote?.(
            sizeNote({ nameSize, prefixSize, asked, capped, final, frameHeight: h, prefixPosition }),
            `Player Name ${TEAM}`,
        );
    }

    // The widest run the box has to hold. Inline puts both on one line — the
    // un-wrapped width, so a pair that has already wrapped still shrinks to the
    // scale that un-wraps it.
    function widestLine(scale) {
        const tagW = tagEl.textContent ? tagEl.getBoundingClientRect().width : 0;
        const nameW = nameEl.getBoundingClientRect().width;
        if (prefixPosition !== 'inline') return Math.max(tagW, nameW);
        return tagW ? tagW + INLINE_GAP * scale + nameW : nameW;
    }

    // A container can resize a member's slot without the window moving, so the
    // box is observed as well as the window.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(applyScale) : null;
    if (observer) observer.observe(root);
    window.addEventListener('resize', applyScale);
    applyScale();

    // Slice26's palette (lime side 1 / teal side 2) isn't exposed as a
    // settings-driven color anywhere else, so it's hardcoded here to match
    // the package's other themed elements.
    const SLICE26_SIDE_COLOR = { 1: '#C5F707', 2: '#57E0E7' };

    function update(state, settings) {
        OverlayBase.applyDesignSettings('playername');
        const g = OverlayBase.deepGet;

        const designPackage = g(settings, 'overlays.global.designPackage', 'default');
        const tagColor = designPackage === 'slice26' ? SLICE26_SIDE_COLOR[TEAM] : null;
        if (tagColor) document.documentElement.style.setProperty('--tag-color', tagColor);
        else document.documentElement.style.removeProperty('--tag-color');

        nameSize = resolveNameSize(g(settings, 'overlays.playername.nameSize', DEFAULT_NAME_SIZE));
        prefixSize = resolvePrefixSize(g(settings, 'overlays.playername.prefixSize', DEFAULT_PREFIX_SIZE));
        const align = resolveAlign(g(settings, 'overlays.playername.align', 'auto'), TEAM);
        prefixPosition = resolvePrefixPosition(g(settings, 'overlays.playername.prefixPosition', 'above'));
        box.className = `pn-box pn-a-${align} pn-p-${prefixPosition}`;

        nameEl.textContent = g(state, NAME_KEY, '');
        tagEl.textContent = g(state, TAG_KEY, '');

        // Every input to the scale — the size, the prefix position, the run
        // widths — can have just changed, so this is the tail of every update.
        applyScale();
    }

    function dispose() {
        observer?.disconnect();
        window.removeEventListener('resize', applyScale);
        root.remove();
    }

    return {
        update,
        dispose,
        shouldRender: (key) => key === NAME_KEY || key === TAG_KEY,
        shouldRenderSettings: (key) => key.startsWith('overlays.'),
    };
}

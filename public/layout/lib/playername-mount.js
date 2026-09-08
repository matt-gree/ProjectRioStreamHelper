/*
 * playername-mount.js — one side's player name, as its own OBS source.
 *
 * Draws `score.{N}.player.{T}.rioName`, with the address-book prefix
 * (`…player.{T}.team` — the sponsor/tag) beside it. Two producer settings shape
 * it, both under `overlays.playername.*` and therefore SHARED by both sides:
 *
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
 * ── THE FRAME'S HEIGHT SETS THE TYPE SIZE; ITS WIDTH ONLY SETS THE RUN ──
 *
 * This element has no card — it is text — so it does NOT min-fit a fixed
 * 400x100 canvas into the source the way the roster or the stat card do. That
 * shape is right for a drawn card and wrong here twice over: it aspect-locks a
 * name to 4:1, so an 800x100 source drew the same 36px name and 636px of
 * nothing beside it; and it scales the empty margin along with the glyphs, so
 * growing the source to make the name bigger always brought its border with it.
 *
 * Height alone drives `--pn-scale` (`typeScale`), and every length on the card
 * is a `calc()` off it — type, gaps, padding, and the font border, which has to
 * track the type size for the same reason the prefix takes half of it. Width is
 * left to the name: it runs as far as it wants and only shrinks when it would
 * otherwise overflow (`fitToWidth`), the same shrink-on-overflow the Game
 * Summary's plate names use.
 *
 * The scale is deliberately CONTENT-AGNOSTIC — it reads the prefix POSITION
 * (a global setting) and never whether this particular participant has a
 * prefix. Two sources framing a scoreboard have to draw at one type size, and
 * measuring the ink would put `rjb` and `MattGree` about 2x apart.
 *
 * Because padding is a fraction of the height rather than a fixed number of
 * pixels, the whole card is scale-invariant: a preview iframe sized to 50% of
 * native draws exactly half-size type, and a 4K source draws the same
 * proportions as a 1080p one.
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

// The card as authored, at scale 1. Every length below is a multiple of these.
const NAME_SIZE = 36;
const NAME_LINE = 1.05;
const TAG_SIZE = 18;
const STACK_GAP = 2;
const INLINE_GAP = 10;

/*
 * Room kept around the type for the font border and the text shadow to bleed
 * into, as a FRACTION of the frame height — 6% is 6px on a 100px-tall source,
 * against the flat 16px this replaced.
 *
 * A fraction rather than a number of pixels is what makes the card
 * scale-invariant (see the header). 16px was never a worst-case allowance
 * anyway: `-webkit-text-stroke` at its 12px maximum bleeds 6px outward, and
 * `textShadowBlur` goes to 40px, which `.pn-root`'s `overflow: hidden` clips at
 * any padding. It covers the settings a producer actually runs and nothing
 * pretends to cover the rest.
 */
const PAD_RATIO = 0.06;

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
  font-family: var(--font-family, 'Inter'), 'Inter', sans-serif;
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
  font-size: calc(${TAG_SIZE}px * var(--pn-scale, 1));
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
  /* HALF the border, because this run is half the type size (18px against the
     name's 36px). One width across two sizes is not one border: 3px around the
     name is a rim, and the same 3px around the prefix closed over the counters
     and swallowed the accent colour whole. The producer sets the border they
     can see — the name — and the prefix keeps the same optical weight. */
  -webkit-text-stroke: calc(var(--text-stroke-width, 0px) * var(--pn-scale, 1) * 0.5) var(--text-stroke-color, transparent);
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
 * How tall the type stands at scale 1, for one prefix position.
 *
 * A FUNCTION OF THE SETTING, never of the text: `above`/`below` stack two runs
 * and reserve room for both whether or not this participant has a prefix, while
 * `inline` and `off` are one run tall. The setting is global, so both sides of
 * a pair always answer the same — which is the whole reason the scale is not
 * measured off the ink.
 *
 * Inline is the name's line box alone: the prefix is half the size and
 * baseline-aligned, so it sits inside the taller run.
 */
export function stackHeight(prefixPosition) {
    const nameLine = NAME_SIZE * NAME_LINE;
    const p = resolvePrefixPosition(prefixPosition);
    return p === 'above' || p === 'below' ? TAG_SIZE + STACK_GAP + nameLine : nameLine;
}

/** Padding on all four sides, for a frame of this height. */
export function framePadding(frameHeight) {
    const h = Number(frameHeight) || 0;
    return h > 0 ? h * PAD_RATIO : 0;
}

/**
 * The type scale for a frame of this height — the one knob the whole card is
 * drawn from. Width is not an input: see the header.
 */
export function typeScale(frameHeight, prefixPosition) {
    const h = Number(frameHeight) || 0;
    if (h <= 0) return 1;
    return (h - framePadding(h) * 2) / stackHeight(prefixPosition);
}

/**
 * Shrink-on-overflow, and only that: a name that fits keeps the height's scale,
 * so the pair stays matched until one of them genuinely runs out of room.
 */
export function fitToWidth(scale, widestLine, available) {
    const w = Number(widestLine) || 0;
    const a = Number(available) || 0;
    if (w <= 0 || a <= 0 || w <= a) return scale;
    return scale * (a / w);
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

    // The scale depends on a SETTING (the prefix position), so it is recomputed
    // from update() as well as on a resize — hence the last-seen value here.
    let prefixPosition = 'above';

    function setScale(scale) {
        root.style.setProperty('--pn-scale', String(scale));
    }

    /*
     * Fit the type to the box this mount was handed — its own host, not the
     * window, so a member centered in a container is measured against its slot.
     *
     * Two passes, and they are exact rather than iterative: the run widths are
     * linear in font-size, so one correction lands. The first pass has to be
     * committed before the rects are read or the measurement describes the
     * previous scale.
     */
    function applyScale() {
        const w = root.clientWidth;
        const h = root.clientHeight;
        if (!h) return;
        const pad = framePadding(h);
        root.style.setProperty('--pn-pad', `${pad}px`);
        const base = typeScale(h, prefixPosition);
        setScale(base);
        if (!w) return;
        setScale(fitToWidth(base, widestLine(base), w - pad * 2));
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

        const align = resolveAlign(g(settings, 'overlays.playername.align', 'auto'), TEAM);
        prefixPosition = resolvePrefixPosition(g(settings, 'overlays.playername.prefixPosition', 'above'));
        box.className = `pn-box pn-a-${align} pn-p-${prefixPosition}`;

        nameEl.textContent = g(state, NAME_KEY, '');
        tagEl.textContent = g(state, TAG_KEY, '');

        // Both inputs to the scale — the prefix position and the run widths —
        // can have just changed, so this is the tail of every update.
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

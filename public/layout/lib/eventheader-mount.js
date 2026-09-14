/*
 * eventheader-mount.js — Event Header: the two thin bands framing the canvas.
 *
 * Each band is an ORDERED LIST of field entries (`overlays.eventheader.bands
 * .{header,footer}` = `[{id, on, text}]`, see EVENTHEADER_FIELDS in
 * server/settings.py), drawn left→right. A field's `text` overrides its source
 * and a blank one falls back to it — which is why `message` is simply the entry
 * with no source of its own. Blank fields are dropped and the survivors
 * re-center.
 *
 * Full-canvas chrome: the stage is always laid out at 1920×1080 and scaled to
 * whatever host it is given, so the bands keep their proportions in a smaller
 * OBS source and inside a container alike.
 *
 * Styles are injected and class-scoped (`.eh-*`) rather than left in the page,
 * because this mount also runs inside a container shell that has no stylesheet
 * of its own — including the box-sizing reset, which as a bare `*` rule would
 * reach every other member sharing that shell.
 *
 *   const eh = mountEventHeader({ host, sb });
 *   eh.update(OverlayBase.state, OverlayBase.settings);
 *
 * Requires overlay-base.js (OverlayBase).
 */

import { socialMark } from './social-marks.js';

const REF_W = 1920, REF_H = 1080;

/*
 * The type size the band was composed at, and the multiple of it every other
 * length here is. `Font Size` is stated in px on the panel and divided by this
 * to get `--font-scale`, so the setting a producer reads is the number of
 * pixels the type actually is, and one knob still drives the band, the gap and
 * the corner. Mirrored by EVENTHEADER_BASE_FONT_PX in server/settings.py, which
 * is what the one-time migration off the old percentage converts against.
 */
const BASE_FONT_PX = 34;
const LINE_HEIGHT = 1.2;
/* The platform mark's own box, as a multiple of the type it sits in. Its SEAT
 * is derived from this and the measured cap height, so the two can only be
 * stated once — see .eh-mark below. */
const MARK_EM = 0.82;
const BAND_EM = 45 / BASE_FONT_PX;
// Half the air the band has around its line box. The optical correction is
// clamped to it so the plate always CONTAINS the type: centring the ink is
// worth a couple of pixels, never worth hanging a descender off the bar. No
// face we have measured comes close (Bebas Neue, the worst, wants 0.058 of the
// 0.062 available), so this binds only on something pathological.
const SLACK_EM = (BAND_EM - LINE_HEIGHT) / 2;

const CSS = `
.eh-root { position: absolute; inset: 0; overflow: hidden; }
.eh-stage {
  position: absolute; left: 0; top: 0;
  width: ${REF_W}px; height: ${REF_H}px;
  transform-origin: top left;
  /* The bands carry the event's own identity - its name, phase, date, handles -
     in short runs of caps, which is the display role, and the same role the
     lower third's band draws in. Producer-settable per role from the Design
     tab's Typography section (overlays.global.displayFont), and pinnable on
     this element alone from its stage panel. */
  font-family: var(--font-display, 'Rajdhani', 'Arial Narrow', sans-serif);
  color: var(--text-primary, #ffffff);
}
.eh-stage, .eh-stage * { box-sizing: border-box; margin: 0; padding: 0; }
/* Two thin single-row bands, 45px of vertical space at 100% font scale:
     header band hangs from y = 0 + Top Offset
     footer band hangs from y = 1080 - 2 - Bottom Offset
 *
 * THE BAND IS THE PLATE, so its height is a function of --font-scale and NOT a
 * constant. It was a flat 45px with the row seated on its bottom edge, which is
 * indistinguishable from correct at 100% and wrong at every other setting: the
 * type grew out of the top of its own background, so a Bar became a stripe
 * through the lower half of the words and an offset appeared to move the text
 * without moving the plate — the plate was moving, it just no longer contained
 * what it was drawn for. The row is CENTRED in the band for the same reason:
 * seating it on one edge means the padding the plate shows is on one side only,
 * and which side depends on which band you are looking at. */
.eh-band {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  height: calc(45px * var(--font-scale, 1));
  display: flex;
  align-items: center;
  justify-content: center;
}
.eh-header { top: 0px; }
.eh-footer { bottom: 2px; }
.eh-band[hidden] { display: none; }
/* Optional readability plate (off by default). The bar's corner is part of the
   plate, so it scales with it — a fixed 8px reads as a sharper corner the
   larger the band gets.
 *
 * BOTH STYLES TAKE THE PALETTE'S CARD COLOUR, and differ only in SHAPE: a bar
 * is the plate, a scrim is the same plate faded out at the edges. They were two
 * hard-coded blacks at two alphas (0.72 and 0.55), which made this the one
 * surface on the broadcast that ignored the Design tab — a producer who tuned
 * Card Background repainted every card except the two strips framing them. The
 * colour carries its own alpha, so opacity is part of the answer rather than a
 * second knob.
 *
 * The literal is the fallback for a cleared palette, not the default: a
 * full-art package's mount calls clearDesignSettings, and inside a CONTAINER
 * that mount may belong to a different member sharing this shell. */
.eh-band.eh-scrim { background: radial-gradient(ellipse at center, var(--card-bg, rgba(0,0,0,0.55)) 0%, transparent 72%); }
.eh-band.eh-bar   { background: var(--card-bg, rgba(0,0,0,0.72)); border-radius: calc(8px * var(--font-scale, 1)); }
.eh-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: calc(16px * var(--font-scale, 1));
  white-space: nowrap;
  /* Line box must fully contain ascenders + descenders so nothing is clipped at
     the band edge (34 * 1.2 ≈ 41px, inside the 45px band). Both numbers scale
     off --font-scale, so that 4px of air is 4px of air at every setting. */
  line-height: 1.2;
  /* Same size top and bottom. */
  font-size: calc(34px * var(--font-scale, 1));
  font-weight: 700;
  letter-spacing: 0.01em;
  /*
   * The text shadow and the font border, both pinnable per element from this
   * element's Style Overrides section. On the ROW so the separators between
   * fields are drawn like the fields they separate — a diamond left flat
   * between two outlined words is the one thing on a band that looks unfinished.
   *
   * ABSOLUTE, not scaled by --font-scale. The stroke width is a global whose
   * value is a number of pixels, so an element that quietly doubled it at 68px
   * type would mean something different by the same number than every other
   * overlay reading it. (Player Name scales its own because its whole geometry
   * is one derived scale — there the type size is a consequence, not a setting.)
   *
   * paint-order puts the stroke behind the glyph so an outline grows outward
   * instead of eating into the letterform; a browser source too old to honour
   * it still draws the border, centred, which is thinner but never wrong.
   *
   * NOTE no backticks in this block: it is inside a template literal.
   */
  /*
   * A FILTER, not a text-shadow, because a font border is painted beside it.
   * Whether -webkit-text-stroke feeds text-shadow is undefined: Chrome casts
   * the halo from the stroked glyph, OBS's CEF does not, so one setting drew a
   * huge cloud in the preview and almost nothing on air. drop-shadow is defined
   * over the RENDERED alpha, which includes the stroke, so both agree. From the
   * PARTS because the composed var is the literal none when the shadow is off,
   * and drop-shadow(none) is invalid. See playername-mount.js for the long
   * version. No backticks in this block: it is inside a template literal.
   */
  filter: drop-shadow(0 0 var(--text-shadow-blur, 0px) var(--text-shadow-color, transparent));
  -webkit-text-stroke: var(--text-stroke-width, 0px) var(--text-stroke-color, transparent);
  paint-order: stroke fill;
}
/* No overflow clip here — that was cropping glyph descenders. */
.eh-field { flex: 0 0 auto; }
/*
 * The platform mark, sized off the TYPE rather than the band: it is a character
 * of the handle it belongs to, so it has to grow with the handle and not with
 * the plate around it. ${MARK_EM}em is the mark's own box against a cap height
 * of roughly two thirds — the brand artwork is drawn to the edges of its 24x24
 * viewBox where a capital is not, so matching the em box makes it read SMALLER
 * than the letters beside it.
 *
 * Seated on the baseline by eye, not by vertical-align: baseline: an inline
 * SVG's baseline is its bottom edge, which would hang the whole mark above the
 * text. The row is align-items: baseline, so this is nudged instead.
 */
.eh-mark {
  width: ${MARK_EM}em;
  height: ${MARK_EM}em;
  display: inline-block;
  vertical-align: baseline;
  margin-right: 0.3em;
  /*
   * Seated on the CAP BAND, from the MEASURED face — not a baked constant. An
   * inline box with vertical-align: baseline sits with its BOTTOM on the
   * baseline, so the mark overhangs the cap band by (${MARK_EM} - cap), all of
   * it below the letters; half of that pushed back down centres it on them.
   *
   * CAP HEIGHT IS A FACT ABOUT THE FACE, AND THE FACE IS THE PRODUCER'S, which
   * is the whole reason the ROW's optical correction is measured (capMetrics
   * above) rather than baked. This seat was baked anyway, at Inter's nominal
   * 0.727 — and the display role has defaulted to Rajdhani since type became
   * three roles, whose measured cap is 0.643. The 0.084em the two differ by is
   * half a mark-height of error: 1.4px at the composed 34px and growing with
   * Font Size, which is a mark visibly riding above the handle it belongs to.
   * One measurement now answers both, so a producer's face cannot move one
   * without the other.
   *
   * The literal is the fallback for a face the canvas cannot measure, and is
   * the mean of the two above rather than either of them.
   */
  transform: translateY(calc((${MARK_EM}em - var(--eh-cap, 0.685em)) / 2));
}
.eh-sep {
  color: var(--accent, #f59f00);
  font-size: 0.5em;
  align-self: center;
  opacity: 0.9;
}
`;

/*
 * OPTICAL CENTRING — type centres on its CAP BAND, not on its line box.
 *
 * `align-items: center` centres the ROW, and a row's height is its line box:
 * the ascent and descent the font reserves, most of which is empty above the
 * caps and below the baseline of a string that has no descenders. Whether that
 * empty space is symmetric is a fact about the FACE, not about the layout —
 * ink sits centred only where (ascent − capHeight) happens to equal descent.
 *
 * Inter's are 0.2425em and 0.24em, which is why the plate looked right for as
 * long as nobody changed the font: the error was 0.3px. It is 2px on Bebas Neue
 * at 34px and grows with Font Size, and at that point the bar reads as sitting
 * low under type that floats above it.
 *
 * So the correction is MEASURED, per resolved font — a producer picks the face
 * on the Design tab (overlays.global.fontFamily) and it arrives from Google
 * Fonts whenever it arrives, so there is no constant to bake here the way
 * scoreboard-l.svg bakes Inter's 0.3523 into geometry authored against Inter.
 *
 * It is also CONTENT-AGNOSTIC — the cap band, never this string's ink — because
 * a plate that re-centred on whether the current fields happen to contain a `g`
 * would twitch every time the round name changed.
 */
const PROBE_PX = 200;
const capOffsets = new Map();
let probeCtx = null;

/**
 * The two things the cap band is worth measuring for, from ONE probe:
 *
 *   dy  — how far the type must move DOWN, as a fraction of the font size, for
 *         its cap band to sit on the line box's centre. Negative moves it up;
 *         0 when the font can't be measured, which leaves line-box centring.
 *   cap — the cap height itself, as a fraction of the font size, which is what
 *         seats the platform mark on that band (see .eh-mark). 0 when the font
 *         can't be measured, which leaves the CSS fallback.
 *
 * Together because they are one fact about the face read two ways, and a second
 * probe is a second thing that can disagree.
 *
 * @param fontSpec a resolved CSS font-family list, e.g. `"Bebas Neue", Inter, sans-serif`
 */
function capMetrics(fontSpec) {
    if (capOffsets.has(fontSpec)) return capOffsets.get(fontSpec);
    let out = { dy: 0, cap: 0 };
    try {
        if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d');
        // Reset first: an unparseable assignment is a NO-OP that silently keeps
        // the previous value, which would cache one font's metrics under
        // another's name. Falling back to sans-serif is merely wrong; falling
        // back to whichever font was measured last is wrong and unrepeatable.
        probeCtx.font = `700 ${PROBE_PX}px sans-serif`;
        probeCtx.font = `700 ${PROBE_PX}px ${fontSpec}`;
        const m = probeCtx.measureText('H');
        const asc = m.fontBoundingBoxAscent;
        const desc = m.fontBoundingBoxDescent;
        const cap = m.actualBoundingBoxAscent;   // 'H' has no descender: this IS cap height
        if (asc > 0 && cap > 0) {
            const line = PROBE_PX * LINE_HEIGHT;
            // Half-leading distributes the line box's slack above and below the
            // font's own content area — the same arithmetic the browser does.
            const baseline = (line - (asc + desc)) / 2 + asc;
            const dy = (line / 2 - (baseline - cap / 2)) / PROBE_PX;
            out = {
                dy: Math.max(-SLACK_EM, Math.min(SLACK_EM, dy)),
                cap: cap / PROBE_PX,
            };
        }
    } catch {
        out = { dy: 0, cap: 0 };
    }
    /*
     * ONLY CACHE A MEASUREMENT THE REAL FACE PRODUCED. A webfont arrives
     * whenever the network says so, and until it does the canvas answers with
     * the FALLBACK's metrics — cached under the real font's name, that is a
     * wrong offset with nothing left to invalidate it but a page reload, which
     * is exactly the shape of "it sits too high until I refresh the source".
     * Measuring again next time is cheap; being wrong until a producer notices
     * is not.
     */
    if (faceReady(fontSpec)) capOffsets.set(fontSpec, out);
    return out;
}

/*
 * Is the FIRST family in a resolved font stack actually available?
 *
 * The first is the only one worth asking about: the rest of the stack is
 * Inter and sans-serif, which are always there, so `check()` on the whole list
 * answers true the moment the fallback exists — which is precisely when the
 * measurement is wrong.
 */
function faceReady(fontSpec) {
    try {
        const first = String(fontSpec).split(',')[0].trim();
        if (!first) return true;
        return document.fonts ? document.fonts.check(`700 ${PROBE_PX}px ${first}`) : true;
    } catch {
        return true;   // no FontFaceSet to ask: take the measurement as final
    }
}

let cssInjected = false;
function injectCss() {
    if (cssInjected) return;
    const style = document.createElement('style');
    style.id = 'eventheader-mount-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    cssInjected = true;
}

const div = (cls) => {
    const el = document.createElement('div');
    el.className = cls;
    return el;
};

/*
 * What each field DRAWS when it has no override of its own.
 *
 * The bands are ordered lists of these ids, so position is the producer's and
 * the source is ours. `message` has no source on purpose: it is the entry whose
 * whole content is its own `text`, which is what the element's banner line
 * always was.
 */
export function fieldSource(id, state, sb) {
    const g = OverlayBase.deepGet;
    // Header leads with the parent competition ("Slice 2026"); the Event field
    // carries the specific start.gg event ("Stars Off"), falling back to the
    // competition name when no event_name is present (manually-entered
    // tournaments).
    const competitionName = g(state, 'tournamentInfo.name', '');
    switch (id) {
        case 'competition': return competitionName;
        case 'event': return g(state, 'tournamentInfo.event_name', '') || competitionName;
        case 'location': return g(state, 'tournamentInfo.location', '');
        case 'dates': return g(state, 'tournamentInfo.date', '');
        case 'phase': {
            const matchId = g(state, `score.${sb}.match`, '');
            const hasMatch = matchId !== '' && matchId != null;
            return (hasMatch ? g(state, `match.${matchId}.phase`, '') : '')
                || g(state, 'tournamentInfo.phase', '');
        }
        // Round = the match label (start.gg round name), projected onto the
        // board as score.{N}.phase so it tracks the live board.
        case 'round': return g(state, `score.${sb}.phase`, '');
        // Typed, not sourced — the account belongs to the stream rather than to
        // the loaded event, so like `message` the field's whole content is its
        // own text. What it adds over `message` is the platform mark.
        case 'message': case 'twitter': case 'youtube': return '';
        default: return '';
    }
}

// One band's drawable values, in the producer's order. A field is dropped when
// it is switched off OR when nothing is behind it — an override wins over the
// source, and a field with neither is not a gap, it is absent.
function bandValues(band, state, settings, sb) {
    const entries = OverlayBase.deepGet(settings, `overlays.eventheader.bands.${band}`, null);
    if (!Array.isArray(entries)) return [];
    return entries
        .filter((e) => e && e.on !== false)
        // The ID travels with the value: a field's mark is a fact about WHICH
        // field it is, and by the time this is a list of strings that is gone.
        .map((e) => ({
            id: e.id,
            value: String(e.text || '').trim() || fieldSource(e.id, state, sb),
        }))
        .filter((f) => f.value != null && String(f.value).trim() !== '');
}

// Render one row: drop blank fields, join the rest with accent separators so
// the surviving fields stay centered (spec: "skip blank fields, re-center").
function renderRow(el, fields, sep) {
    el.innerHTML = '';
    fields.forEach((f, i) => {
        if (i > 0 && sep) {
            const d = document.createElement('span');
            d.className = 'eh-sep';
            d.textContent = sep;
            el.appendChild(d);
        }
        const span = document.createElement('span');
        span.className = 'eh-field';
        // The mark rides INSIDE the field's own span, so it travels with the
        // handle when the producer reorders the band and is never separated
        // from it by a separator.
        const mark = socialMark(f.id);
        if (mark) span.appendChild(mark);
        span.appendChild(document.createTextNode(f.value));
        el.appendChild(span);
    });
    return fields.length;
}

export function mountEventHeader({ host, sb = 1 }) {
    injectCss();
    const SCOREBOARD = Number(sb) || 1;

    const root = div('eh-root');
    const stage = div('eh-stage');
    const header = div('eh-band eh-header');
    const hdrRow = div('eh-row');
    const footer = div('eh-band eh-footer');
    const ftrRow = div('eh-row');
    header.appendChild(hdrRow);
    footer.appendChild(ftrRow);
    stage.append(header, footer);
    root.appendChild(stage);
    host.appendChild(root);

    /*
     * Fit the 1920×1080 stage to the box this mount was handed.
     *
     * MEASURES ITS OWN HOST, not the window — the same rule the stats card
     * follows. On a dedicated source `.eh-root` is `inset: 0` so the two are
     * the same number; inside a container the host is the centered member box,
     * and scaling to the window there would size the bands to the whole canvas
     * rather than to the box they were given.
     *
     * That measurement is the answer in a PREVIEW too, and this used to stand
     * down there on the belief that the console scales the iframe for it. It
     * does not: ScaledIframe SIZES the iframe to the fit box and hands the
     * overlay that viewport, precisely so nothing is rasterised at the wrong
     * scale — so standing down drew the 1920-wide stage 1:1 into an ~880-wide
     * frame, i.e. at 217% of the size the readout beside it claimed. Inside a
     * container preview the host is fed-container's `.fc-fit` wrapper at the
     * container's native size, so this measures native and scales by 1 and
     * that one transform still does all the fitting. The preview frame never
     * exceeds the source (`frameMaxWidth`), so this can only scale down.
     */
    function autoScale() {
        const w = root.clientWidth || window.innerWidth;
        const h = root.clientHeight || window.innerHeight;
        const scale = Math.min(w / REF_W, h / REF_H) || 1;
        stage.style.transform = Math.abs(scale - 1) > 0.002 ? `scale(${scale})` : '';
    }
    /*
     * A ResizeObserver on the HOST, not just a window resize listener.
     *
     * `window.resize` never fires for a box that changed under a page whose
     * window did not — a container re-laying out its member, or a browser
     * source whose element is measured as 0 while it is hidden and has its real
     * size only once it is shown. Either leaves a stage scaled for a box that
     * is no longer there, and nothing recomputes it until the page reloads,
     * which is what makes a wrong layout look like it needs a manual refresh.
     * Both listeners are kept: the window one costs nothing and covers the
     * plain case.
     */
    let ro = null;
    if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => { autoScale(); alignRows(); });
        ro.observe(root);
    }
    window.addEventListener('resize', autoScale);
    autoScale();

    /*
     * Seat the type on the plate's centre (see capMetrics). Kept apart from
     * update() so a webfont that lands after the first render re-centres without
     * one: the metrics measured before the face arrived are the FALLBACK's, and
     * a `loadingdone` is the only notice we get that they are now wrong.
     */
    // Per BAND, because the two sizes are independent — the optical correction
    // is a fraction of the type size, so each row is shifted by its own.
    let typeSize = { header: BASE_FONT_PX, footer: BASE_FONT_PX };

    function alignRows() {
        const { dy: em, cap } = capMetrics(getComputedStyle(stage).fontFamily);
        // The mark's seat, published for the CSS to divide (see .eh-mark). An
        // unmeasurable face clears the property rather than writing 0, so the
        // declaration's own fallback is what answers — 0 would seat the mark
        // half a mark-height below the baseline, which is worse than the wrong
        // constant this replaced.
        if (cap > 0) stage.style.setProperty('--eh-cap', `${cap.toFixed(4)}em`);
        else stage.style.removeProperty('--eh-cap');
        for (const [band, row] of [['header', hdrRow], ['footer', ftrRow]]) {
            const dy = em * typeSize[band];
            row.style.transform = Math.abs(dy) > 0.05 ? `translateY(${dy.toFixed(2)}px)` : '';
        }
    }

    const onFontsDone = () => { capOffsets.clear(); alignRows(); };
    if (document.fonts) {
        document.fonts.addEventListener('loadingdone', onFontsDone);
        document.fonts.ready.then(onFontsDone).catch(() => {});
    }

    function update(state, settings) {
        OverlayBase.applyDesignSettings('eventheader');

        // overlays.eventheader.<key> element setting, with a hard default.
        const s = (key, def) => OverlayBase.deepGet(settings, `overlays.eventheader.${key}`, def);
        // settingOn, not `!== false` — see the note in scoreboard-mount's readToggles.
        const on = (key) => OverlayBase.settingOn(s(key, true), true); // switches default ON

        // ── layout knobs ────────────────────────────────────────────────
        const sep = s('separator', '◆');
        /*
         * ONE SIZE PER BAND. They were a single `fontSize` for both, which is
         * the wrong default for the thing this element is: the top strip names
         * the competition and the bottom one carries round and phase, and a
         * producer sizing the heading has no reason to be resizing the footnote
         * with it.
         *
         * `--font-scale` therefore lives on each BAND rather than on the stage.
         * Every length that derives from it — the band's own height, the bar's
         * corner, the gap between fields, the type — is inside one band or the
         * other, so each resolves against its own.
         */
        const sizeOf = (key) => Number(s(key, BASE_FONT_PX)) || BASE_FONT_PX;
        const size = { header: sizeOf('headerFontSize'), footer: sizeOf('footerFontSize') };
        const width = Number(s('bandWidth', 1263)) || 1263;
        const hOff = Number(s('headerOffsetY', 0));
        const fOff = Number(s('footerOffsetY', 2));
        const bg = s('bgStyle', 'none');

        header.style.setProperty('--font-scale', size.header / BASE_FONT_PX);
        footer.style.setProperty('--font-scale', size.footer / BASE_FONT_PX);
        typeSize = size;

        for (const band of [header, footer]) {
            band.style.width = width + 'px';
            band.classList.remove('eh-scrim', 'eh-bar');
            if (bg === 'scrim') band.classList.add('eh-scrim');
            else if (bg === 'bar') band.classList.add('eh-bar');
        }
        header.style.top = hOff + 'px';
        footer.style.bottom = fOff + 'px';

        // ── the two bands, each in the order its field list is in ───────
        const showHeader = on('showHeader');
        const headerCount = showHeader
            ? renderRow(hdrRow, bandValues('header', state, settings, SCOREBOARD), sep) : 0;
        header.hidden = !showHeader || headerCount === 0;

        const showFooter = on('showFooter');
        const footerCount = showFooter
            ? renderRow(ftrRow, bandValues('footer', state, settings, SCOREBOARD), sep) : 0;
        footer.hidden = !showFooter || footerCount === 0;

        alignRows();
    }

    function dispose() {
        window.removeEventListener('resize', autoScale);
        if (ro) ro.disconnect();
        if (document.fonts) document.fonts.removeEventListener('loadingdone', onFontsDone);
        root.remove();
    }

    return {
        update,
        dispose,
        shouldRender: (key) => key.startsWith('tournamentInfo.')
            || key === `score.${SCOREBOARD}.match`
            || key === `score.${SCOREBOARD}.phase`
            || key.startsWith('match.'),
        shouldRenderSettings: (key) => key.startsWith('overlays.'),
    };
}

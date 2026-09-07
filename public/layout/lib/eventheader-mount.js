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
  /* The Design-tab Font Family (overlays.global.fontFamily → --font-family)
     drives the face; Inter is the bundled fallback, then system sans-serif.
     --font-family already resolves to Inter by default. */
  font-family: var(--font-family, 'Inter'), 'Inter', sans-serif;
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
}
/* No overflow clip here — that was cropping glyph descenders. */
.eh-field { flex: 0 0 auto; }
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
 * How far the type must move DOWN, as a fraction of the font size, for its cap
 * band to sit on the line box's centre. Negative moves it up; 0 when the font
 * can't be measured, which leaves today's line-box centring.
 *
 * @param fontSpec a resolved CSS font-family list, e.g. `"Bebas Neue", Inter, sans-serif`
 */
function capCentreOffset(fontSpec) {
    if (capOffsets.has(fontSpec)) return capOffsets.get(fontSpec);
    let out = 0;
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
            out = Math.max(-SLACK_EM, Math.min(SLACK_EM, dy));
        }
    } catch {
        out = 0;
    }
    capOffsets.set(fontSpec, out);
    return out;
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
        case 'message': return '';
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
        .map((e) => String(e.text || '').trim() || fieldSource(e.id, state, sb))
        .filter((v) => v != null && String(v).trim() !== '');
}

// Render one row: drop blank fields, join the rest with accent separators so
// the surviving fields stay centered (spec: "skip blank fields, re-center").
function renderRow(el, values, sep) {
    el.innerHTML = '';
    values.forEach((v, i) => {
        if (i > 0 && sep) {
            const d = document.createElement('span');
            d.className = 'eh-sep';
            d.textContent = sep;
            el.appendChild(d);
        }
        const span = document.createElement('span');
        span.className = 'eh-field';
        span.textContent = v;
        el.appendChild(span);
    });
    return values.length;
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
    window.addEventListener('resize', autoScale);
    autoScale();

    /*
     * Seat the type on the plate's centre (see capCentreOffset). Kept apart from
     * update() so a webfont that lands after the first render re-centres without
     * one: the metrics measured before the face arrived are the FALLBACK's, and
     * a `loadingdone` is the only notice we get that they are now wrong.
     */
    let typeSize = BASE_FONT_PX;

    function alignRows() {
        const dy = capCentreOffset(getComputedStyle(stage).fontFamily) * typeSize;
        const t = Math.abs(dy) > 0.05 ? `translateY(${dy.toFixed(2)}px)` : '';
        hdrRow.style.transform = t;
        ftrRow.style.transform = t;
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
        const on = (key) => s(key, true) !== false; // switches default ON

        // ── layout knobs ────────────────────────────────────────────────
        const sep = s('separator', '◆');
        // Font Size is px on the panel; --font-scale is the multiple of the
        // composed 34px that every other length in the CSS is stated in.
        const size = Number(s('fontSize', BASE_FONT_PX)) || BASE_FONT_PX;
        const scale = size / BASE_FONT_PX;
        const width = Number(s('bandWidth', 1263)) || 1263;
        const hOff = Number(s('headerOffsetY', 0));
        const fOff = Number(s('footerOffsetY', 2));
        const bg = s('bgStyle', 'none');

        stage.style.setProperty('--font-scale', scale);
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

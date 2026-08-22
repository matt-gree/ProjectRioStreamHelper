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
/* Two thin single-row bands, each 45px of vertical space. Text is bottom-
   aligned so its baseline sits on the band's bottom edge:
     header band bottom → y = 45     (top 45px to work with)
     footer band bottom → y = 1078   (bottom 45px to work with) */
.eh-band {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  height: 45px;
  display: flex;
  align-items: flex-end;   /* seat the row on the band's bottom edge */
  justify-content: center;
}
.eh-header { top: 0px; }    /* band bottom at y = 45   */
.eh-footer { bottom: 2px; } /* band bottom at y = 1078 */
.eh-band[hidden] { display: none; }
/* Optional readability plate (off by default). */
.eh-band.eh-scrim { background: radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 72%); }
.eh-band.eh-bar   { background: rgba(0,0,0,0.72); border-radius: 8px; }
.eh-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: calc(16px * var(--font-scale, 1));
  white-space: nowrap;
  /* Line box must fully contain ascenders + descenders so nothing is
     clipped at the band edge (34 * 1.2 ≈ 41px, inside the 45px band). */
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
     */
    function autoScale() {
        // In a preview the iframe itself is scaled (ScaledIframe, and a
        // container's own fit box) — one authority, so this one stands down.
        if (OverlayBase.PREVIEW_MODE) { stage.style.transform = ''; return; }
        const w = root.clientWidth || window.innerWidth;
        const h = root.clientHeight || window.innerHeight;
        const scale = Math.min(w / REF_W, h / REF_H) || 1;
        stage.style.transform = Math.abs(scale - 1) > 0.002 ? `scale(${scale})` : '';
    }
    window.addEventListener('resize', autoScale);
    autoScale();

    function update(state, settings) {
        OverlayBase.applyDesignSettings('eventheader');

        // overlays.eventheader.<key> element setting, with a hard default.
        const s = (key, def) => OverlayBase.deepGet(settings, `overlays.eventheader.${key}`, def);
        const on = (key) => s(key, true) !== false; // switches default ON

        // ── layout knobs ────────────────────────────────────────────────
        const sep = s('separator', '◆');
        const scale = (Number(s('fontScale', 100)) || 100) / 100;
        const width = Number(s('bandWidth', 1263)) || 1263;
        const hOff = Number(s('headerOffsetY', 0));
        const fOff = Number(s('footerOffsetY', 2));
        const bg = s('bgStyle', 'none');

        stage.style.setProperty('--font-scale', scale);

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
    }

    function dispose() {
        window.removeEventListener('resize', autoScale);
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

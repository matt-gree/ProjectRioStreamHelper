/*
 * schedule-mount.js — the re-themable Upcoming Schedule element.
 *
 * Renders `schedule.queue` (an ordered list of match ids) with each match
 * resolved live from `match.{M}.*`, so a fixture edit re-renders with no
 * projector behind it. Queue MEMBERSHIP AND ORDER are authored on the Match
 * desk; this element owns only what it says about them — its heading
 * (`schedule.title`) and each match's display time (`match.{M}.scheduledAt`).
 *
 * The look lives in the active DESIGN PACKAGE's theme SVG
 * (/design/{package}/schedule.svg, element-by-element fallback to `default`).
 * It was a hand-rolled DOM card list until 2026-09-13, which is why its
 * `<meta name="overlay-settings">` whitelist advertised accentColor, cardBg
 * and textColor while the mount called neither applyDesignSettings nor
 * clearDesignSettings: every one of those three knobs, and the three type
 * roles beside them, wrote settings that no code read. The CSS it drew from
 * instead named `--band` / `--ink` / `--border`, which are the Rio TOKEN
 * layer's vars, so it looked plausibly on-theme under the default package and
 * could not be moved off it by any means the app offers.
 *
 *   const s = mountSchedule({ host });
 *   s.update(OverlayBase.state, OverlayBase.settings);
 *   s.dispose();
 *
 * Requires overlay-base.js (OverlayBase).
 *
 * == THE SLOT CONTRACT ======================================================
 *
 *   card       <g>    the whole board. The mount rewrites its translate Y each
 *                     render so the card stays centred on the 1080 canvas as
 *                     it grows; the theme's X is kept.
 *   card-bg    <rect> the board's plate. `data-compact-h` is its height with
 *                     ZERO rows; the mount sets `height` from the row count.
 *   title      <text> the heading (`schedule.title`).
 *   rows       <g>    where row clones are parked, at y = index * pitch.
 *   match-template <g>  the prototype row, hidden at opacity 0. `data-h` is the
 *                     row PITCH (drawn height plus the gap under it).
 *   overflow   <text> "+N MORE", inside `rows` so its y is row-space. `data-h`
 *                     is what it adds to the card when it shows.
 *
 * Row parts (`data-part`, inside match-template, all optional):
 *   row-bg  rail  label  status  side1-name  plate  plate-text  side2-name
 *
 * == STATE IS ONE COLOUR AT THREE STRENGTHS =================================
 *
 * A row is live, upcoming, or played, and the rail says which. It says it in
 * the accent's OPACITY rather than in three colours, because the mount has no
 * business choosing a colour: a package picks the accent, a producer can
 * repoint it, and a hex here would be a fourth palette that agrees with
 * nobody. It also keeps the cue honest — the live row is the only thing on the
 * card at full accent, so the eye has one place to go. The board shipped with
 * the accent rail on EVERY row and a hard-coded `#43a047` on the live one,
 * which is the same amount of ink spent saying that a schedule contains
 * matches.
 */

import { createThemeEngine } from './svg-theme-engine.js';
import { formatLabel, matchComplete } from './match-format.js';

const ELEMENT = 'schedule';
const SETTINGS_TYPE = 'schedule';
const DEFAULT_PACKAGE = 'default';

// The canvas every schedule theme is authored on. The card is centred on it.
const CANVAS_H = 1080;

export const DEFAULTS = { maxRows: 6, showDecided: false };

// The rail's three strengths (see the header note) and the dim a played row
// wears. The dim goes on the row GROUP, once — a group dim plus a per-node dim
// multiplies, and 0.45 squared reads as a rendering fault rather than a result
// (the same trap `rowOutcome` documents in matchup-mount.js).
export const RAIL_OPACITY = { live: '1', upcoming: '0.3', done: '0.15' };
export const DONE_DIM = '0.45';

const FALLBACK_SVG = `
<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <g data-slot="card" transform="translate(340,314)">
    <rect data-slot="card-bg" data-compact-h="124" x="0" y="0" width="1240" height="452" rx="20"
          style="fill:var(--band,#0b0b12);stroke:var(--border,#1f1f30);stroke-width:1.5"/>
    <text data-slot="title" data-maxw="1020" x="620" y="58" text-anchor="middle"
          style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif);text-transform:uppercase"
          font-size="44" font-weight="700" letter-spacing="4"></text>
    <rect x="580" y="74" width="80" height="5" rx="2.5" style="fill:var(--accent,#e60012)"/>
    <rect x="24" y="99" width="1192" height="1.5" fill="rgba(255,255,255,0.10)"/>
    <g data-slot="rows" transform="translate(16,108)">
      <text data-slot="overflow" data-h="48" x="604" y="0" text-anchor="middle"
            style="fill:var(--ink-dim,#8f8fa3);font-family:var(--font-display,sans-serif);fill-opacity:0.5"
            font-size="20" font-weight="600" opacity="0"></text>
    </g>
    <g data-slot="match-template" data-h="82" opacity="0">
      <rect data-part="row-bg" x="0" y="0" width="1208" height="72" rx="10" fill="rgba(255,255,255,0.035)"/>
      <rect data-part="rail" x="0" y="12" width="6" height="48" rx="3" style="fill:var(--accent,#e60012)"/>
      <text data-part="label" data-maxw="230" x="28" y="43"
            style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif);fill-opacity:0.62"
            font-size="21" font-weight="600"></text>
      <text data-part="side1-name" data-maxw="234" x="552" y="47" text-anchor="end"
            style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif)"
            font-size="32" font-weight="700"></text>
      <rect data-part="plate" x="566" y="19" width="76" height="34" rx="8" fill="rgba(0,0,0,0.38)"/>
      <text data-part="plate-text" data-maxw="66" x="604" y="44" text-anchor="middle"
            style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums"
            font-size="22" font-weight="700"></text>
      <text data-part="side2-name" data-maxw="234" x="656" y="47" text-anchor="start"
            style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif)"
            font-size="32" font-weight="700"></text>
      <text data-part="status" data-maxw="220" x="1180" y="44" text-anchor="end"
            style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif)"
            font-size="24" font-weight="700"></text>
    </g>
  </g>
</svg>`;

/*
 * `.sch-off *` rather than `.sch-off`: `display:none` takes the hidden subtree
 * out of layout and paint, and Chromium goes on ticking its CSS animations
 * anyway — the atmosphere field in the default theme's header would animate
 * for the rest of a broadcast behind a board nobody is showing. The theme's
 * own `.sh-mush` rule is injected LATER in document order, so this has to win
 * on specificity rather than on order (see design-package-authoring).
 */
const CSS = `
.sch-host { position: fixed; inset: 0; }
.sch-host svg { width: 100%; height: 100%; display: block; }
.sch-host.sch-off { display: none; }
.sch-host.sch-off * { animation: none; }
`;

let _cssInjected = false;
function injectCss() {
    if (_cssInjected) return;
    const s = document.createElement('style');
    s.id = 'schedule-css';
    s.textContent = CSS;
    document.head.appendChild(s);
    _cssInjected = true;
}

/*
 * A path walk of its own rather than `OverlayBase.deepGet`.
 *
 * `scheduleRows` is imported by the CONSOLE as well as run in the overlay
 * (src/routes/production/stage/schedule.jsx), and OverlayBase is a browser
 * global that exists only on an overlay page — so the one rule that decides
 * which matches reach the board has to be reachable without it. The alternative
 * is the panel restating the rule, which is how a stage ends up claiming a
 * board draws something it does not. Same shape as deepGet, five lines of it.
 */
function pick(obj, path, def) {
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur == null) return def;
        cur = cur[seg];
    }
    return cur === undefined ? def : cur;
}

const num = (v, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
};

/*
 * PLAYED, NOT WON. `decided` is the record of a winner and for every odd format
 * that is also the record of the end — but a DOUBLEHEADER is complete after two
 * games however they fall, and a 1-1 split has no winner. Asking `decided` here
 * kept a finished split on an "Upcoming" card for the rest of the night, which
 * is the exact failure the Decided Matches setting exists to prevent.
 */
const isDecided = (m) => matchComplete(
    (m?.format || {}).bestOf,
    (m?.series || {})['1'] ?? (m?.series || {})[1],
    (m?.series || {})['2'] ?? (m?.series || {})[2],
    m?.decided,
);

const sideName = (m, t) => (
    m?.player?.[String(t)]?.rioName || m?.player?.[t]?.rioName || 'TBD'
);

/**
 * The centre plate: the most informative thing this match can say about
 * itself, in one small cell.
 *
 * A series score once there is one (a Bo5 at 2-1 is the fact a viewer wants),
 * the format while there is not (Bo5 tells them what they are in for), and
 * `VS` for a one-off, where "Bo1" would be a word for "nothing to say".
 *
 * `Bo5`, NOT `BO5`. The plate is drawn in the numeral face, because the thing
 * it holds most of the time is a VALUE and a column of scores has to sit on one
 * grid — but a capital O beside a digit in a monospaced face is the exact
 * ambiguity that face exists to remove, and `BO5` reads as `B05`. Mixed case
 * settles it, and it is also what the Match desk's own format buttons say.
 */
export function plateFor(m) {
    const series = m?.series || {};
    const w1 = num(series['1'] ?? series[1], 0);
    const w2 = num(series['2'] ?? series[2], 0);
    if (w1 > 0 || w2 > 0) return `${w1}–${w2}`;
    // "Bo2" is the clinch arithmetic's name for a doubleheader and nobody's
    // word for one, so the label comes from ./match-format, which the console's
    // own format picker reads too.
    return formatLabel((m?.format || {}).bestOf) || 'VS';
}

/**
 * The rows this board draws, and how many it could not.
 *
 * THE QUEUE IS NOT THE BOARD. `schedule.queue` is the union of every running
 * order (see server/schedule.py) and nothing ever removes a fixture from it,
 * so an evening's board grows all night and a decided match sits on an
 * "Upcoming" graphic forever. Played matches are therefore dropped unless the
 * producer asks for them, and what is left is capped — a card that grows past
 * its canvas is not a schedule, and the cap is what makes the theme's maximum
 * height a number anyone can author against.
 *
 * `UP NEXT` on the first waiting row is the fallback for a blank display time,
 * not a second status: `scheduledAt` is free text a producer often never fills,
 * and a schedule whose right-hand column is empty on every row reads as
 * unfinished rather than as untimed. Only the first row gets it, because that
 * is the only one it is true of.
 */
export function scheduleRows(state, { maxRows = DEFAULTS.maxRows, showDecided = DEFAULTS.showDecided } = {}) {
    const queue = pick(state, 'schedule.queue', []) || [];
    const matches = pick(state, 'match', {}) || {};

    // A queued id whose match is gone renders as nothing rather than as a blank
    // row — `schedule.queue` is a projection and can name a fixture that has
    // just been deleted.
    const known = queue
        .map((id) => ({ id, m: matches[String(id)] }))
        .filter((r) => r.m);

    const kept = known.filter(({ m }) => showDecided || !isDecided(m));

    const cap = Math.max(1, num(maxRows, DEFAULTS.maxRows));
    const shown = kept.slice(0, cap);

    // The first WAITING row is the one that is up next, and only it: a time
    // already says it better, and a later untimed row is not the next one.
    let upNextTaken = false;
    const statusFor = (m, stage) => {
        if (stage === 'done') return 'FINAL';
        if (stage === 'live') return 'LIVE';
        const at = String(m?.scheduledAt || '').trim();
        if (upNextTaken) return at;
        upNextTaken = true;
        return at || 'UP NEXT';
    };

    const rows = shown.map(({ id, m }) => {
        const done = isDecided(m);
        const live = !done && m?.stage === 'live';
        const stage = done ? 'done' : (live ? 'live' : 'upcoming');

        return {
            id,
            stage,
            label: String(m?.label || m?.phase || '').trim(),
            side1: sideName(m, 1),
            side2: sideName(m, 2),
            plate: plateFor(m),
            status: statusFor(m, stage),
        };
    });

    return {
        rows,
        hidden: Math.max(0, kept.length - rows.length),
        queued: queue.length,
        known: known.length,
    };
}

/**
 * Why this board is drawing nothing. Three causes a producer fixes three
 * different ways, which is the whole reason `setBlank` takes a reason at all.
 */
export function blankReason({ queued, known, rows }) {
    if (!queued) return 'schedule-empty';
    if (!known) return 'schedule-no-matches';
    if (!rows.length) return 'schedule-all-played';
    return null;
}

const BLANK_LABEL = {
    'schedule-empty': 'Nothing is in the running order — matches join it as you create them on the Match desk',
    'schedule-no-matches': 'The running order names only fixtures that no longer exist',
    'schedule-all-played': 'Every match in the running order is decided — turn on Decided Matches to show them',
};

// Uniform auto-fit for cloned <text data-maxw> parts. The engine's refitText
// only tracks top-level data-slot texts, not per-clone parts (same reason
// ticker-mount carries this).
function fitText(el) {
    if (!el || el.tagName.toLowerCase() !== 'text') return;
    const maxw = parseFloat(el.getAttribute('data-maxw'));
    if (!maxw || !el.textContent) return;
    let base = parseFloat(el.getAttribute('data-basefs'));
    if (!base) {
        base = parseFloat(el.getAttribute('font-size')) || parseFloat(getComputedStyle(el).fontSize) || 0;
        if (base) el.setAttribute('data-basefs', String(base));
    }
    if (!base) return;
    el.style.fontSize = base + 'px';
    let len;
    try { len = el.getComputedTextLength(); } catch { len = 0; }
    if (len > maxw) el.style.fontSize = (base * maxw / len) + 'px';
}

export function mountSchedule({ host }) {
    injectCss();
    host.classList.add('sch-host');

    const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });
    let disposed = false;

    const part = (clone, name) => clone.querySelector(`[data-part="${name}"]`);

    function setPart(clone, name, value, { optional = true } = {}) {
        const el = part(clone, name);
        if (!el) return;
        const v = value == null ? '' : String(value);
        el.textContent = v;
        if (optional) el.setAttribute('opacity', v ? '1' : '0');
        fitText(el);
    }

    function bindRow(clone, row) {
        clone.setAttribute('opacity', row.stage === 'done' ? DONE_DIM : '1');

        const rail = part(clone, 'rail');
        if (rail) rail.style.fillOpacity = RAIL_OPACITY[row.stage];

        setPart(clone, 'label', row.label);
        setPart(clone, 'side1-name', row.side1, { optional: false });
        setPart(clone, 'side2-name', row.side2, { optional: false });
        setPart(clone, 'plate-text', row.plate, { optional: false });
        setPart(clone, 'status', row.status);

        // A plate with nothing in it is a floating black box, so it follows its
        // own text. It never is empty today (`plateFor` always answers), which
        // is exactly why this is worth one line rather than an assumption.
        const plate = part(clone, 'plate');
        if (plate) plate.setAttribute('opacity', row.plate ? '1' : '0');

        // LIVE is the one status that takes the accent. Cleared rather than
        // re-coloured for the others, so the theme's authored fill stands.
        const status = part(clone, 'status');
        if (status) {
            if (row.stage === 'live') status.style.fill = 'var(--accent)';
            else status.style.removeProperty('fill');
        }
    }

    /* The card is centred on the canvas rather than pinned to the theme's
       authored Y: the height is the row count, so a pinned top would put an
       eight-row board's floor 400 units below a three-row board's. The X stays
       the theme's — that one is a real composition decision. */
    function placeCard(card, height) {
        if (!card) return;
        const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(card.getAttribute('transform') || '');
        const x = t ? parseFloat(t[1]) : 0;
        card.setAttribute('transform', `translate(${x},${Math.round((CANVAS_H - height) / 2)})`);
    }

    async function update(state, settings) {
        if (disposed) return;

        const pkg = OverlayBase.deepGet(settings, 'overlays.global.designPackage', DEFAULT_PACKAGE);
        await engine.ensureTheme(pkg);
        if (disposed) return;
        if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE);
        else OverlayBase.clearDesignSettings(SETTINGS_TYPE);

        const read = (key, def) => OverlayBase.readSetting(SETTINGS_TYPE, key, def);
        const result = scheduleRows(state, {
            maxRows: read('maxRows', DEFAULTS.maxRows),
            // `settingOn`, not truthiness: PUT /api/v1/settings stores its value
            // as a STRING, so an off written over REST arrives as "false" and
            // would read as on.
            showDecided: OverlayBase.settingOn(read('showDecided', null), DEFAULTS.showDecided),
        });

        const reason = blankReason(result);
        host.classList.toggle('sch-off', !!reason);
        OverlayBase.setBlank(reason, reason ? BLANK_LABEL[reason] : null);
        if (reason) return;

        const slots = engine.slots;
        const rowsGroup = slots['rows'];
        const template = slots['match-template'];
        if (!rowsGroup || !template) {
            OverlayBase.setBlank('schedule-theme', 'The schedule theme declares no row template');
            host.classList.add('sch-off');
            return;
        }

        engine.setText('title', OverlayBase.deepGet(state, 'schedule.title', '') || 'Upcoming Matches');

        const pitch = parseFloat(template.getAttribute('data-h')) || 82;
        const overflow = slots['overflow'];

        for (const old of [...rowsGroup.querySelectorAll('[data-row]')]) old.remove();
        result.rows.forEach((row, i) => {
            const clone = template.cloneNode(true);
            clone.removeAttribute('data-slot');
            clone.setAttribute('data-row', String(row.id));
            clone.setAttribute('transform', `translate(0,${i * pitch})`);
            rowsGroup.appendChild(clone);
            bindRow(clone, row);
        });

        let extra = 0;
        if (overflow) {
            const show = result.hidden > 0;
            overflow.textContent = show
                ? `+${result.hidden} MORE ${result.hidden === 1 ? 'MATCH' : 'MATCHES'}`
                : '';
            overflow.setAttribute('opacity', show ? '1' : '0');
            if (show) {
                overflow.setAttribute('y', String(result.rows.length * pitch + 30));
                extra = parseFloat(overflow.getAttribute('data-h')) || 0;
            }
        }

        const bg = slots['card-bg'];
        const compact = bg ? (parseFloat(bg.getAttribute('data-compact-h')) || 124) : 124;
        const height = compact + result.rows.length * pitch + extra;
        if (bg) bg.setAttribute('height', String(height));
        placeCard(slots['card'], height);

        engine.refitText();
    }

    function dispose() { disposed = true; host.classList.remove('sch-host', 'sch-off'); }

    return {
        update,
        dispose,
        shouldRender: (key) => key.startsWith('schedule.') || key.startsWith('match.'),
    };
}

// lowerthird-mount.js — the re-themable SVG lower-third element (slot system).
//
// A DIRECT element (its own OBS source). The band is FIVE independently
// toggleable SLOTS (lowerthird.slots.1..5, left→right), each carrying one
// content type; the producer authors them on the Production page. Slot widths
// are UNEQUAL by design — each content type's width is owned by the theme.
//
// THEME CONTRACT (mirrors scorecard's stacked sections, horizontally):
//   <g data-band data-x data-w data-gap data-align="center|left|right">
//     the container the mount lays segments into. data-x/data-w bound the
//     usable row; templates are cloned in and translated to their x offset.
//   <rect data-slot="band-bg">   optional continuous bed; the mount sets its
//     x/width to the laid-out row (respecting data-pad), keeps y/height/rx.
//   <g data-tpl="{type}" data-w="{px}">   one content template per type,
//     authored at LOCAL x-origin 0 at band height, kept inside <defs> so the
//     original never renders. Missing template = type unavailable in theme.
//
// CONTENT TYPES + sub-slots (data-slot inside the template; missing = skipped;
// text slots may carry data-maxw to auto-fit):
//   logo     : logo, logo-default, title
//   match    : status, time, side1-name, side2-name, side1-sprite,
//              side2-sprite, side1-score, side2-score   (scores = series wins)
//   scorebox : status, side1-name, side2-name, side1-score, side2-score
//   merch    : image, title, subtitle
//   clock    : clock-label, clock
//   message  : title, subtitle
//   bracket  : label, title, subtitle
//
// SPACE is a structural slot, not a content type: it has no template and draws
// nothing. It splits the band wherever it's placed — the continuous bed breaks
// into one island per contiguous run of content slots, and the space expands to
// fill the leftover band width (flex), pushing those islands toward the corners.
// A fixed px width (lowerthird.slots.{i}.width) makes it a fixed gap instead.
//
// Per-slot data lives at lowerthird.slots.{i}.*:
//   enabled, type, title, subtitle, matchId, role ('upnext'|'current'),
//   status (override), scoreboard (N), image (merch file), clock {mode,...}
//
// The theme SVG comes from the active DESIGN PACKAGE
// (overlays.global.designPackage): /design/{package}/lowerthird.svg, falling
// back element-by-element to the built-in `default` package.
//
//   const lt = mountLowerThird({ host });
//   lt.update(OverlayBase.state, OverlayBase.settings);
//   lt.setShown(bool);  // OBS on-screen signal (wire OverlayBase.onObsShown)
//   lt.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData, for sprites).
// Theme fetch/injection reuses svg-theme-engine.js; slot binding is LOCAL to
// each cloned segment here (the engine's flat slot map only covers band-bg).

import { createThemeEngine } from './svg-theme-engine.js';
import { createRevealGate } from './reveal-gate.js';

const SETTINGS_TYPE = 'lowerthird';
const ELEMENT = 'lowerthird';
const DEFAULT_PACKAGE = 'default';
const SLOT_COUNT = 5;
const SLOT_TYPES = ['logo', 'match', 'scorebox', 'merch', 'clock', 'message', 'bracket', 'space'];

// Controller-port → colour (0-indexed), used to tint match/scorebox sides.
// Overridable per port via overlays.lowerthird.port{N}Color. Falls back to the
// token side colours when a side has no port.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

// Minimal inline fallback if a theme SVG can't be fetched (offline / typo, or a
// legacy package without slot templates). Bare band + compact templates.
const FALLBACK_SVG = `
<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <rect data-slot="band-bg" x="48" y="880" width="1824" height="150" rx="14" style="fill:var(--band,#101018)"/>
  <g data-band="1" data-x="72" data-w="1776" data-gap="48" data-align="center" transform="translate(0,880)"></g>
  <defs>
    <g data-tpl="logo" data-w="220">
      <g data-slot="logo-default"><circle cx="60" cy="75" r="40" style="fill:var(--accent,#e60012)"/></g>
      <image data-slot="logo" x="20" y="35" width="80" height="80" preserveAspectRatio="xMidYMid meet" opacity="0"/>
      <text data-slot="title" data-maxw="100" x="115" y="84" style="fill:var(--ink,#fff)" font-size="24" font-weight="700"></text>
    </g>
    <g data-tpl="match" data-w="520">
      <text data-slot="status" x="0" y="36" style="fill:var(--accent,#e60012)" font-size="20" font-weight="700">UP NEXT</text>
      <text data-slot="side1-name" data-maxw="420" x="0" y="80" style="fill:var(--ink,#fff)" font-size="32" font-weight="700">Player One</text>
      <text data-slot="side2-name" data-maxw="420" x="0" y="126" style="fill:var(--ink,#fff)" font-size="32" font-weight="700">Player Two</text>
      <text data-slot="side1-score" x="500" y="80" text-anchor="end" style="fill:var(--ink,#fff)" font-size="32" font-weight="700"></text>
      <text data-slot="side2-score" x="500" y="126" text-anchor="end" style="fill:var(--ink,#fff)" font-size="32" font-weight="700"></text>
    </g>
    <g data-tpl="scorebox" data-w="420">
      <text data-slot="status" x="0" y="36" style="fill:var(--accent,#e60012)" font-size="20" font-weight="700"></text>
      <text data-slot="side1-name" data-maxw="320" x="0" y="80" style="fill:var(--ink,#fff)" font-size="30" font-weight="700"></text>
      <text data-slot="side2-name" data-maxw="320" x="0" y="124" style="fill:var(--ink,#fff)" font-size="30" font-weight="700"></text>
      <text data-slot="side1-score" x="400" y="80" text-anchor="end" style="fill:var(--ink,#fff)" font-size="30" font-weight="700"></text>
      <text data-slot="side2-score" x="400" y="124" text-anchor="end" style="fill:var(--ink,#fff)" font-size="30" font-weight="700"></text>
    </g>
    <g data-tpl="merch" data-w="420">
      <image data-slot="image" x="0" y="25" width="100" height="100" preserveAspectRatio="xMidYMid meet" opacity="0"/>
      <text data-slot="title" data-maxw="290" x="120" y="70" style="fill:var(--ink,#fff)" font-size="28" font-weight="700"></text>
      <text data-slot="subtitle" data-maxw="290" x="120" y="104" style="fill:var(--ink-dim,#aaa)" font-size="20"></text>
    </g>
    <g data-tpl="clock" data-w="280">
      <text data-slot="clock-label" x="0" y="40" style="fill:var(--ink-dim,#aaa)" font-size="20" font-weight="700"></text>
      <text data-slot="clock" x="0" y="105" style="fill:var(--ink,#fff);font-family:var(--font-mono,monospace)" font-size="56" font-weight="700">5:00</text>
    </g>
    <g data-tpl="message" data-w="480">
      <text data-slot="title" data-maxw="460" x="0" y="72" style="fill:var(--ink,#fff)" font-size="36" font-weight="700"></text>
      <text data-slot="subtitle" data-maxw="460" x="0" y="112" style="fill:var(--ink-dim,#aaa)" font-size="22"></text>
    </g>
    <g data-tpl="bracket" data-w="420">
      <text data-slot="label" x="0" y="36" style="fill:var(--accent,#e60012)" font-size="20" font-weight="700">BRACKET</text>
      <text data-slot="title" data-maxw="400" x="0" y="84" style="fill:var(--ink,#fff)" font-size="32" font-weight="700"></text>
      <text data-slot="subtitle" data-maxw="400" x="0" y="120" style="fill:var(--ink-dim,#aaa)" font-size="20"></text>
    </g>
  </defs>
</svg>`;

const CSS = `
.lt-host { position: fixed; inset: 0; }
.lt-host svg { width: 100%; height: 100%; display: block; }
.lt-host.lt-reveal { animation: lt-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.lt-host.lt-off { opacity: 0 !important; }
@keyframes lt-rise { from { opacity: 0; transform: translateY(36px); } to { opacity: 1; transform: translateY(0); } }
.lt-host.lt-warn [data-slot="clock"] { animation: lt-pulse 1s ease-in-out infinite; }
@keyframes lt-pulse { 50% { opacity: 0.4; } }
.lt-seg-in { animation: lt-seg 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes lt-seg { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .lt-host.lt-reveal, .lt-seg-in { animation: none; }
  .lt-host.lt-warn [data-slot="clock"] { animation: none; }
}
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'lowerthird-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function fmtDur(ms) {
  let s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtTimeOfDay(d) {
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ap}`;
}

// Read the five authored slots off state; index-keyed 1..5.
export function readSlots(state) {
  const g = OverlayBase.deepGet;
  const out = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const raw = g(state, `lowerthird.slots.${i}`, {}) || {};
    out.push({ i, ...raw, type: SLOT_TYPES.includes(raw.type) ? raw.type : '' });
  }
  return out;
}

export function mountLowerThird({ host }) {
  injectCss();
  host.classList.add('lt-host');

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });
  let revealKey = '';            // identity of last reveal (avoid replay on ticks)
  let structureKey = '';         // identity of the laid-out segment row
  let segs = [];                 // [{ i, type, node, slots: {name: el}, refit: [el] }]
  let bedClones = [];            // per-group band-bg clones (space splits the bed)
  let clockTimer = null;
  let disposed = false;

  // ── colour seam ────────────────────────────────────────────────────────────
  function portColor(port, settings) {
    const idx = Number.isInteger(port) ? port : -1;
    if (idx >= 0) {
      const ov = OverlayBase.deepGet(settings, `overlays.${SETTINGS_TYPE}.port${idx}Color`, null);
      if (ov) return ov;
      if (idx < PORT_COLORS.length) return PORT_COLORS[idx];
    }
    return null;
  }

  function applyAccent(settings) {
    // Per-layout accent pin only (the "+ Add style override" UI writes here).
    // We deliberately do NOT fall back to overlays.global.accentColor so the
    // default stays the theme's own accent, not the global amber.
    const accent = OverlayBase.deepGet(settings, `overlays.${SETTINGS_TYPE}.accentColor`, null);
    if (accent) host.style.setProperty('--accent', accent);
    else host.style.removeProperty('--accent');
  }

  // Side tint vars scoped to ONE segment (two match slots can tint differently).
  function applySideColours(seg, port1, port2, settings) {
    const c1 = portColor(port1, settings);
    const c2 = portColor(port2, settings);
    if (c1) seg.node.style.setProperty('--side1', c1); else seg.node.style.removeProperty('--side1');
    if (c2) seg.node.style.setProperty('--side2', c2); else seg.node.style.removeProperty('--side2');
  }

  // ── local slot binding (per cloned segment) ───────────────────────────────
  function segText(seg, name, value, { optional = false } = {}) {
    const el = seg.slots[name];
    if (!el) return;
    const v = value == null ? '' : String(value);
    if (el.textContent !== v) el.textContent = v;
    if (optional) el.setAttribute('opacity', v ? '1' : '0');
    else el.removeAttribute('opacity');
  }

  function segImage(seg, name, url) {
    const el = seg.slots[name];
    if (!el) return;
    if (url) {
      if (el.getAttribute('href') !== url) {
        el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
        el.setAttribute('href', url);
      }
      el.setAttribute('opacity', '1');
    } else {
      el.removeAttribute('href');
      el.setAttribute('opacity', '0');
    }
  }

  // Uniform auto-fit for a segment's data-maxw text slots (same policy as
  // svg-theme-engine.refitText, but scoped to clones the engine can't see).
  function refitSegs() {
    for (const seg of segs) {
      for (const el of seg.refit) {
        let base = parseFloat(el.getAttribute('data-basefs'));
        if (!base) {
          base = parseFloat(el.getAttribute('font-size')) || parseFloat(getComputedStyle(el).fontSize) || 0;
          if (base) el.setAttribute('data-basefs', String(base));
        }
        if (!base) continue;
        el.style.fontSize = base + 'px';
        const maxw = parseFloat(el.getAttribute('data-maxw'));
        if (!maxw || !el.textContent) continue;
        let len = 0;
        try { len = el.getComputedTextLength(); } catch { len = 0; }
        if (len > maxw) el.style.fontSize = (base * maxw / len) + 'px';
      }
    }
  }

  // ── layout (the horizontal meld) ──────────────────────────────────────────
  // Clone each content slot's template into the band group, accumulate x
  // offsets, align the row, and lay out the bed(s). SPACE slots carry no
  // content: they either flex-fill the leftover band width (default — pushing
  // content toward the corners) or hold a fixed px width, and they break the
  // continuous bed into one island per contiguous run of content. If the fixed
  // content overflows the band, the whole row scales down uniformly (vertically
  // centred) — authored proportions survive any slot combination. Only reruns
  // when the active (slot, type/width) structure or theme changes — data binds
  // don't relayout.
  function rebuildStructure(active) {
    const svg = host.querySelector('svg');
    const band = svg ? svg.querySelector('[data-band]') : null;
    segs = [];
    bedClones.forEach((n) => n.remove());
    bedClones = [];
    if (!band) return;
    band.querySelectorAll('[data-row]').forEach((n) => n.remove());

    const bandX = parseFloat(band.getAttribute('data-x')) || 0;
    const bandW = parseFloat(band.getAttribute('data-w')) || 1920;
    const bandH = parseFloat(band.getAttribute('data-h')) || 232;
    const gap = parseFloat(band.getAttribute('data-gap')) || 32;
    const align = band.getAttribute('data-align') || 'center';

    // Classify: content items own a template + fixed width; space items are
    // spacers with either a fixed width (>0) or flex fill (0 / blank).
    const items = [];
    for (const slot of active) {
      if (slot.type === 'space') {
        items.push({ slot, isSpace: true, fixedW: Math.max(0, parseFloat(slot.width) || 0) });
        continue;
      }
      const tpl = svg.querySelector(`[data-tpl="${slot.type}"]`);
      if (!tpl) continue;
      const w = parseFloat(tpl.getAttribute('data-w')) || 300;
      items.push({ slot, tpl, w, isSpace: false });
    }
    const contentItems = items.filter((it) => !it.isSpace);
    if (!contentItems.length) return; // all-space / empty → nothing to draw

    // A gap applies only between two adjacent CONTENT items (a space is its own
    // separator). Fixed budget = content widths + fixed-space widths + gaps.
    let gapCount = 0;
    for (let k = 1; k < items.length; k++) {
      if (!items[k].isSpace && !items[k - 1].isSpace) gapCount++;
    }
    const flexSpaces = items.filter((it) => it.isSpace && it.fixedW <= 0);
    const fixedTotal = items.reduce((a, it) => a + (it.isSpace ? it.fixedW : it.w), 0)
      + gap * gapCount;

    const scale = fixedTotal > bandW ? bandW / fixedTotal : 1;
    const flex = (flexSpaces.length && fixedTotal < bandW)
      ? (bandW - fixedTotal) / flexSpaces.length : 0;
    for (const it of items) {
      it.lw = it.isSpace ? (it.fixedW > 0 ? it.fixedW : flex) : it.w;
    }

    const laidTotal = items.reduce((a, it) => a + it.lw, 0) + gap * gapCount;
    const scaledTotal = laidTotal * scale;

    let rowX = bandX;
    if (align === 'center') rowX = bandX + Math.max(0, (bandW - scaledTotal) / 2);
    else if (align === 'right') rowX = bandX + Math.max(0, bandW - scaledTotal);
    const rowY = (bandH * (1 - scale)) / 2; // keep a scaled row vertically centred

    const row = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    row.setAttribute('data-row', '1');
    row.setAttribute('transform', `translate(${rowX},${rowY}) scale(${scale})`);
    band.appendChild(row);

    // Lay items left→right; record each content-run span (a "group") so the bed
    // can be cloned per island. A space closes the current group.
    const groups = [];
    let group = null;
    let x = 0;
    let prev = null;
    for (const it of items) {
      if (!it.isSpace && prev && !prev.isSpace) x += gap; // gap: content↔content
      if (it.isSpace) { group = null; x += it.lw; prev = it; continue; }
      const startX = x;
      const node = it.tpl.cloneNode(true);
      node.removeAttribute('data-tpl');
      node.setAttribute('data-seg', String(it.slot.i));
      node.setAttribute('transform', `translate(${x},0)`);
      node.classList.add('lt-seg-in');
      row.appendChild(node);
      const slots = {};
      const refit = [];
      node.querySelectorAll('[data-slot]').forEach((el) => {
        slots[el.getAttribute('data-slot')] = el;
        if (el.tagName.toLowerCase() === 'text' && el.getAttribute('data-maxw')) refit.push(el);
      });
      segs.push({ i: it.slot.i, type: it.slot.type, node, slots, refit });
      x += it.w;
      if (!group) { group = { start: startX, end: x }; groups.push(group); }
      else group.end = x;
      prev = it;
    }

    // Bed(s): one band-bg per content group, positioned in absolute space under
    // the scaled row (bed rects live outside the row's scale transform). With no
    // space slot this is a single island == the old continuous bed.
    const bg = engine.slots['band-bg'];
    if (bg) {
      bg.setAttribute('opacity', '0'); // original is the clone template only
      const padAttr = bg.getAttribute('data-pad');
      const pad = padAttr != null ? (parseFloat(padAttr) || 0) : 0;
      for (const gr of groups) {
        const bed = bg.cloneNode(true);
        bed.removeAttribute('data-slot');
        bed.setAttribute('data-bed-clone', '1');
        bed.setAttribute('x', String(rowX + gr.start * scale - pad));
        bed.setAttribute('width', String((gr.end - gr.start) * scale + pad * 2));
        bed.setAttribute('opacity', '1');
        bg.parentNode.insertBefore(bed, bg.nextSibling);
        bedClones.push(bed);
      }
    }
  }

  // ── per-type binders ──────────────────────────────────────────────────────
  function spriteUrl(captain) {
    if (window.RioData && RioData.charIconUrl) return RioData.charIconUrl(captain);
    const id = OverlayBase.charId(captain);
    return id === undefined ? '' : `${OverlayBase.BASE_URL}/game_assets/msb/characterIcons/${id}.png`;
  }

  function bindLogo(seg, slot) {
    segText(seg, 'title', slot.title || '', { optional: true });
    const logoUrl = OverlayBase.brandingLogoUrl();
    const imgSlot = seg.slots['logo'];
    if (!imgSlot) return;
    const probe = new Image();
    probe.onload = () => {
      if (disposed) return;
      segImage(seg, 'logo', logoUrl);
      if (seg.slots['logo-default']) seg.slots['logo-default'].setAttribute('opacity', '0');
    };
    probe.onerror = () => {
      if (disposed) return;
      segImage(seg, 'logo', '');
      if (seg.slots['logo-default']) seg.slots['logo-default'].setAttribute('opacity', '1');
    };
    probe.src = logoUrl;
  }

  function bindMatch(seg, slot, state, settings) {
    const g = OverlayBase.deepGet;
    const matchId = slot.matchId != null && slot.matchId !== '' ? String(slot.matchId) : '';
    const match = matchId ? g(state, `match.${matchId}`, null) : null;
    const role = slot.role === 'current' ? 'current' : 'upnext';
    const p = (t) => (match ? g(match, `player.${t}`, {}) || {} : {});
    const p1 = p(1), p2 = p(2);

    segText(seg, 'status', slot.status || (role === 'current' ? 'CURRENT' : 'UP NEXT'));
    segText(seg, 'time', (match && match.scheduledAt) || '', { optional: true });
    segText(seg, 'side1-name', p1.rioName || 'Player One');
    segText(seg, 'side2-name', p2.rioName || 'Player Two');
    segImage(seg, 'side1-sprite', spriteUrl(p1.captain));
    segImage(seg, 'side2-sprite', spriteUrl(p2.captain));

    // Series wins as the per-side score, only meaningful past Bo1.
    const bestOf = match ? Number(g(match, 'format.bestOf', 1)) || 1 : 1;
    const series = match ? (match.series || {}) : {};
    const showSeries = bestOf > 1;
    segText(seg, 'side1-score', showSeries ? String(series['1'] ?? series[1] ?? 0) : '', { optional: true });
    segText(seg, 'side2-score', showSeries ? String(series['2'] ?? series[2] ?? 0) : '', { optional: true });

    applySideColours(seg,
      Number.isInteger(p1.port) ? p1.port : null,
      Number.isInteger(p2.port) ? p2.port : null,
      settings);
  }

  function bindScorebox(seg, slot, state, settings) {
    const g = OverlayBase.deepGet;
    const sb = parseInt(slot.scoreboard) || 1;
    const half = g(state, `score.${sb}.half_inning`, '') || '';
    const inning = g(state, `score.${sb}.inning`, '');
    const completed = g(state, `score.${sb}.game_completed`, false) === true;
    const isFinal = half === 'Final' || completed || g(state, `score.${sb}.source_type`, '') === 'completed_api';
    let status = '';
    if (isFinal) status = 'FINAL';
    else if (inning !== '' && inning != null) status = `${half === 'Top' ? 'TOP' : 'BOT'} ${inning}`;

    segText(seg, 'status', status, { optional: true });
    segText(seg, 'side1-name', g(state, `score.${sb}.player.1.rioName`, '') || 'Player One');
    segText(seg, 'side2-name', g(state, `score.${sb}.player.2.rioName`, '') || 'Player Two');
    segText(seg, 'side1-score', String(g(state, `score.${sb}.score_left`, 0) ?? 0));
    segText(seg, 'side2-score', String(g(state, `score.${sb}.score_right`, 0) ?? 0));

    const port = (t) => {
      const v = g(state, `score.${sb}.player.${t}.port`, null);
      return Number.isInteger(v) ? v : null;
    };
    applySideColours(seg, port(1), port(2), settings);
  }

  function bindMerch(seg, slot) {
    segText(seg, 'title', slot.title || '', { optional: true });
    segText(seg, 'subtitle', slot.subtitle || '', { optional: true });
    const url = slot.image ? `${OverlayBase.BASE_URL}/branding/merch/${encodeURIComponent(slot.image)}` : '';
    segImage(seg, 'image', url);
  }

  function bindMessage(seg, slot) {
    segText(seg, 'title', slot.title || '');
    segText(seg, 'subtitle', slot.subtitle || '', { optional: true });
  }

  function bindBracket(seg, slot, state) {
    const g = OverlayBase.deepGet;
    segText(seg, 'label', slot.status || 'BRACKET');
    segText(seg, 'title', slot.title || g(state, 'bracket.phaseName', '') || '');
    segText(seg, 'subtitle', slot.subtitle || '', { optional: true });
  }

  // ── clock ─────────────────────────────────────────────────────────────────
  // Each clock-type segment ticks off ITS OWN lowerthird.slots.{i}.clock.
  function renderClocks() {
    if (disposed) return;
    const g = OverlayBase.deepGet;
    let warn = false;
    for (const seg of segs) {
      if (seg.type !== 'clock') continue;
      const clockEl = seg.slots['clock'];
      if (!clockEl) continue;
      const c = g(OverlayBase.state, `lowerthird.slots.${seg.i}.clock`, {}) || {};
      const mode = c.mode || 'off';
      if (mode === 'off') {
        clockEl.setAttribute('opacity', '0');
        segText(seg, 'clock-label', '', { optional: true });
        continue;
      }
      clockEl.setAttribute('opacity', '1');
      let text = '';
      if (mode === 'clock') {
        text = fmtTimeOfDay(new Date());
      } else if (mode === 'countdown') {
        const ms = c.running
          ? (c.endsAt || 0) - Date.now()
          : (c.remainingMs != null ? c.remainingMs : (c.durationSec || 300) * 1000);
        text = fmtDur(ms);
        warn = warn || (c.running && ms > 0 && ms < 10000);
      } else if (mode === 'countup') {
        const ms = c.running ? Date.now() - (c.startedAt || Date.now()) : (c.elapsedMs || 0);
        text = fmtDur(ms);
      }
      if (clockEl.textContent !== text) clockEl.textContent = text;
      segText(seg, 'clock-label', c.label || '', { optional: true });
    }
    host.classList.toggle('lt-warn', warn);
  }

  // ── reveal ────────────────────────────────────────────────────────────────
  function playReveal() {
    host.classList.remove('lt-reveal');
    void host.offsetWidth; // reflow so the animation restarts
    host.classList.add('lt-reveal');
  }
  // The gate decides WHEN playReveal actually runs: it dedupes OBS's redundant
  // activate dispatches, snaps the band dark on hide, and holds it dark through
  // a visibility-toggle burst so one show = one clean rise (see reveal-gate.js).
  const gate = createRevealGate({ host, offClass: 'lt-off', play: playReveal });

  // ── main update ───────────────────────────────────────────────────────────
  async function update(state, settings) {
    const theme = OverlayBase.deepGet(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    if (themeChanged) { revealKey = ''; structureKey = ''; }
    if (disposed) return;

    // Palette policy (see svg-theme-engine.js): an app-vars theme (e.g. the
    // Classic package) is painted with the user's Design-tab variables; a
    // fixed-palette theme (the Rio default, Slice26) must never inherit them.
    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE);
    else OverlayBase.clearDesignSettings();

    const slots = readSlots(state);
    const active = slots.filter((s) => s.enabled && s.type);
    const hasContent = active.some((s) => s.type !== 'space');

    // Nothing authored (or only spacers) → keep the source blank on air.
    host.style.display = hasContent ? '' : 'none';
    if (!hasContent) { revealKey = ''; structureKey = ''; return; }

    applyAccent(settings);

    // Relayout only when the (slot, type + space width) structure changes.
    const sKey = `${theme}|` + active.map((s) =>
      s.type === 'space' ? `${s.i}:space:${s.width || 0}` : `${s.i}:${s.type}`).join(',');
    if (sKey !== structureKey) { rebuildStructure(active); structureKey = sKey; }

    for (const seg of segs) {
      const slot = active.find((s) => s.i === seg.i);
      if (!slot) continue;
      if (seg.type === 'logo') bindLogo(seg, slot);
      else if (seg.type === 'match') bindMatch(seg, slot, state, settings);
      else if (seg.type === 'scorebox') bindScorebox(seg, slot, state, settings);
      else if (seg.type === 'merch') bindMerch(seg, slot);
      else if (seg.type === 'message') bindMessage(seg, slot);
      else if (seg.type === 'bracket') bindBracket(seg, slot, state);
    }
    renderClocks();

    // Auto-fit now and again once webfonts settle.
    refitSegs();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) refitSegs(); });

    // Reveal only when the authored identity changes (not on clock ticks or
    // live score movement).
    const idKey = sKey + '|' + active.map((s) =>
      `${s.matchId ?? ''}·${s.title ?? ''}·${s.subtitle ?? ''}·${s.role ?? ''}·${s.image ?? ''}·${s.scoreboard ?? ''}`).join('|');
    if (idKey !== revealKey) { revealKey = idKey; gate.requestReveal(); }
  }

  function setShown(shown) { gate.setShown(shown); }

  function dispose() {
    disposed = true;
    if (clockTimer) clearInterval(clockTimer);
    gate.dispose();
    window.removeEventListener('resize', refitSegs);
    host.classList.remove('lt-host', 'lt-reveal', 'lt-warn');
    host.innerHTML = '';
  }

  // Clocks tick independently of state updates so countdowns are smooth.
  clockTimer = setInterval(renderClocks, 250);
  window.addEventListener('resize', refitSegs);

  return { update, setShown, dispose };
}

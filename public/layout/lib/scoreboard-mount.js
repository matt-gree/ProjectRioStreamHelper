// scoreboard-mount.js — the re-themable horizontal Scoreboard element.
//
// One mount drives every size variant: the look lives in the active DESIGN
// PACKAGE's per-size theme SVG (/design/{package}/scoreboard-{size}.svg,
// element-by-element fallback to `default`). Sizes: xs · s · m · l. Legacy
// ?size=xl OBS sources resolve to l.
//
// ROW-STACK CONTRACT (a lighter cousin of the Scorecard meld): a theme is a
// card whose content rows are groups marked data-slot="row-*", each authored
// at a LOCAL y origin of 0 and declaring its band height via data-h. The mount
// translates the active rows into a stack anchored at card-bg's authored y,
// sizes the shared card-bg (+ optional card-rail) to the stack, and hides the
// [data-part="div"] top rule on the first visible row. Rows:
//   row-top     always (names · logos · score · inning)
//   row-inning  the inning number segment (arrows / final-badge swap)
//   row-live    live game cluster (batter/pitcher · count · diamond)
//   row-final   completed cluster (ELO swing · stadium/innings/date meta)
//   row-roster  both 9-character rosters
//   row-box     per-inning linescore
// A theme implements whatever subset fits its size. row-inning/row-live are
// gated by producer toggles overlays.scoreboard.showInning/showLive (both
// default on); showLive is a master override the live game state ANDs with.
//
// LAYOUT MODES: by default the mount stack-lays the rows as above. A theme that
// declares data-layout="absolute" on its root <svg> opts out — the mount then
// honours the authored row transforms/card size and only toggles each row's
// visibility (row-live and row-final are authored overlapping and swap in
// place). Use absolute for hand-placed fixed-frame designs; use the stack for
// responsive/reflowing cards. (engine.absoluteLayout, set per theme swap.)
// In absolute mode a row tagged data-anim="expand-right" (grammar:
// `slot=row-live anim=expand-right`) wipes open left→right on show and collapses
// on hide (animated clip-path inset) instead of snapping — an MLB-style panel
// that unfolds beside a fixed core. Ignored in stack mode.
//
// HORIZONTAL MELD (absolute mode): if card-bg declares data-compact-w (its
// collapsed width), the mount grows card-bg's WIDTH to enclose whichever
// segments are visible — each segment declares data-cardw = the card width when
// it is the rightmost-visible. The card melds like the vertical Scorecard but
// sideways (Scoreboard S: a compact names+scores pill that extends to reveal the
// inning + live cluster during a game, collapsing back when it completes).
//
// DATA SLOTS (all optional; the engine skips what a theme omits):
//   sT-logo(image) sT-name(text,maxw) sT-score(text)          T ∈ {1,2}
//   inn-half(text TOP/BOT) inn-num(text) inn-arrow-up/down(g) final-badge(g)
//   bat-icon(image) bat-name(text) pit-icon(image) pit-name(text)
//   ball-0..3 strike-0..2 out-0..2      (mount sets fill on active)
//   base-1..3(polygon fill) runner-1..3(image)
//   elo1-group/elo2-group(g)  eloT-in eloT-out eloT-delta(text)
//   meta-main(text stadium · innings) meta-date(text)
//   sT-char-0..8(image) sT-cap-ring(shape; mount moves it to the captain slot)
//   box-col-1..9(g) box-h-1..9(text) box-away-1..9 box-home-1..9(text)
//   box-away-R box-home-R(text) box-away-name box-home-name(text)
//   logo(image branding) logo-default(g fallback mark)
//
// COLOUR SEAMS: the mount sets --side1/--side2 on the host from each player's
// controller port (P1/P2 fallback), plus --accent when the producer pinned
// overlays.scoreboard.accentColor. ELO deltas get var(--elo-gain)/var(--elo-loss).
//
//   const sb = mountScoreboard({ host, sb: 1, size: 'l' });
//   sb.update(OverlayBase.state, OverlayBase.settings);
//   sb.setShown(bool);  sb.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';
import { createRevealGate, clearAnimClassOnEnd } from './reveal-gate.js';
import { ensureGsap } from './gsap-loader.js';
import { DOT_OFF, dot, bindImageProbe } from './mount-utils.js';

const SETTINGS_TYPE = 'scoreboard';
const DEFAULT_PACKAGE = 'default';
const MAX_INN = 9;

export const SIZE_DIMS = {
  xs: { w: 400, h: 50 },
  s:  { w: 388, h: 128 },
  m:  { w: 600, h: 200 },
  l:  { w: 800, h: 460 },
};

// Controller-port → side colour (0-indexed), same convention as the Scorecard.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

const BALL_ON = '#22c55e', STRIKE_ON = '#eab308', OUT_ON = '#ef4444';

// Row order + visibility predicate over the resolved flags.
const STACK = [
  ['row-top',    v => true],
  ['row-inning', v => v.showInningSeg],
  ['row-live',   v => v.showLiveSeg],
  ['row-final',  v => v.showFinal],
  ['row-roster', v => v.showRoster],
  ['row-box',    v => v.showBox],
];

function fallbackSvg({ w, h }) {
  const nameFs = Math.max(12, Math.round(h * 0.24));
  const scoreFs = Math.max(16, Math.round(h * 0.4));
  const midY = Math.round(h * 0.62);
  return `
<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <rect data-slot="card-bg" x="4" y="4" width="${w - 8}" height="${h - 8}" rx="10" style="fill:var(--band,#0b0b12);stroke:var(--border,#1f1f30)"/>
  <g data-slot="row-top" data-h="${h - 8}">
    <text data-slot="s1-name" data-maxw="${Math.round(w * 0.3)}" x="16" y="${midY - 4}" style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif)" font-size="${nameFs}" font-weight="700">Player One</text>
    <text data-slot="s1-score" x="${Math.round(w * 0.44)}" y="${midY}" text-anchor="middle" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="${scoreFs}" font-weight="700">0</text>
    <text data-slot="s2-score" x="${Math.round(w * 0.56)}" y="${midY}" text-anchor="middle" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="${scoreFs}" font-weight="700">0</text>
    <text data-slot="s2-name" data-maxw="${Math.round(w * 0.3)}" x="${w - 16}" y="${midY - 4}" text-anchor="end" style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif)" font-size="${nameFs}" font-weight="700">Player Two</text>
  </g>
</svg>`;
}

// Horizontal-meld timing: the card-bg width tween and the segment wipe MUST
// share one duration + ease so the card's right edge and the reveal edge move
// in lockstep (an asymmetric hide previously drifted the wipe out of sync with
// the card). Symmetric on grow and collapse.
const MELD_DUR = 0.4;
const MELD_EASE = 'power3.out';

const CSS = `
.sb-host { position: fixed; inset: 0; }
.sb-host svg { width: 100%; height: 100%; display: block; }
.sb-host.sb-reveal { animation: sb-slide 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }
.sb-host.sb-off { opacity: 0 !important; }
@keyframes sb-slide { from { opacity: 0; transform: translateX(32px); } to { opacity: 1; transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) { .sb-host.sb-reveal { animation: none; } }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'scoreboard-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

export function mountScoreboard({ host, sb, size }) {
  injectCss();
  host.classList.add('sb-host');
  const SB = sb || 1;
  const SIZE = SIZE_DIMS[size] ? size : 'l';

  const engine = createThemeEngine({
    host,
    element: `scoreboard-${SIZE}`,
    fallbackSvg: fallbackSvg(SIZE_DIMS[SIZE]),
  });
  let gsap = null;
  ensureGsap().then(g => { gsap = g; });

  let revealKey = '';
  let laidOut = {};
  let animShown = {};   // absolute-mode row name -> last shown state (anim transitions)
  let clipProxy = {};   // absolute-mode row name -> { p } proxy tweened for expand-right
  let disposed = false;

  const g = OverlayBase.deepGet;

  function readToggles(settings) {
    return {
      showElo:      g(settings, `overlays.${SETTINGS_TYPE}.showElo`, true) !== false,
      showTeamLogos: g(settings, `overlays.${SETTINGS_TYPE}.showTeamLogos`, true) !== false,
      showLogo:     OverlayBase.readSetting(SETTINGS_TYPE, 'showLogo', true) !== false,
      // Producer switches for melded themes with independent segments (Scoreboard
      // S): showLive is a master override for the live cluster (off hides it even
      // during a live game); showInning toggles the inning number segment. Themes
      // without those segments ignore both.
      showLive:     g(settings, `overlays.${SETTINGS_TYPE}.showLive`, true) !== false,
      showInning:   g(settings, `overlays.${SETTINGS_TYPE}.showInning`, true) !== false,
    };
  }

  function portColor(port, settings, fallbackIdx) {
    const idx = Number.isInteger(port) ? port : (fallbackIdx == null ? -1 : fallbackIdx);
    if (idx < 0) return null;
    const ov = g(settings, `overlays.${SETTINGS_TYPE}.port${idx}Color`, null);
    if (ov) return ov;
    return idx < PORT_COLORS.length ? PORT_COLORS[idx] : null;
  }

  function applyColours(settings, p1Port, p2Port) {
    const accent = g(settings, `overlays.${SETTINGS_TYPE}.accentColor`, null);
    if (accent) host.style.setProperty('--accent', accent); else host.style.removeProperty('--accent');
    const c1 = portColor(p1Port, settings, 0);
    const c2 = portColor(p2Port, settings, 1);
    if (c1) host.style.setProperty('--side1', c1); else host.style.removeProperty('--side1');
    if (c2) host.style.setProperty('--side2', c2); else host.style.removeProperty('--side2');
  }

  // ── row-stack meld (see scorecard-mount for the full pattern) ───────────────
  function cardTop() {
    const bg = engine.slots['card-bg'];
    const y = bg ? parseFloat(bg.getAttribute('data-top') || bg.getAttribute('y')) : 0;
    return Number.isFinite(y) ? y : 0;
  }

  function moveRow(el, name, y, show, fresh) {
    if (!gsap || fresh || laidOut[name] === undefined) {
      el.setAttribute('transform', `translate(0,${y})`);
      el.setAttribute('opacity', show ? '1' : '0');
      if (gsap) gsap.set(el, { y, opacity: show ? 1 : 0 });
    } else {
      gsap.to(el, { y, opacity: show ? 1 : 0, duration: 0.4, ease: 'power3.out' });
    }
    laidOut[name] = show;
  }

  function sizeCard(top, total, fresh) {
    for (const slotName of ['card-bg', 'card-rail']) {
      const el = engine.slots[slotName];
      if (!el) continue;
      const h = Math.max(total, 1);
      if (!gsap || fresh || laidOut['__card'] === undefined) el.setAttribute('height', h);
      else gsap.to(el, { attr: { height: h }, duration: 0.4, ease: 'power3.out' });
    }
    laidOut['__card'] = true;
  }

  // Horizontal-meld reveal. The card-bg WIDTH animates to enclose the visible
  // segments, and a single clip whose right edge tracks the card's right edge
  // wipes the segment content — so a segment appears/disappears exactly as the
  // growing/shrinking card edge sweeps over it, NOT on an independent per-row
  // clock (segments and the card span different widths, so a fixed-duration
  // per-row wipe drifts out of step with the card edge). The clip lives in the
  // SVG's own user space (clipPathUnits=userSpaceOnUse) so it's immune to per-
  // segment bounding boxes and to host scaling; only its right edge ever cuts
  // (it's padded far past the top/bottom/left), and it is removed the instant
  // the meld settles so the steady state carries no composite layer (which would
  // otherwise trim round-glyph overshoot under GPU raster — see toggleRow).
  const MELD_CLIP_ID = `sb-meld-wipe-${SB}`;
  const CLIP_PAD = 400;

  // Ensure the shared user-space clip rect exists in the current SVG (a theme
  // swap re-injects the SVG, dropping it) and return the rect to size.
  function ensureMeldClip() {
    const svg = host.querySelector('svg');
    if (!svg) return null;
    let rect = svg.querySelector(`#${MELD_CLIP_ID} rect`);
    if (rect) return rect;
    const NS = 'http://www.w3.org/2000/svg';
    let defs = svg.querySelector('defs');
    if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
    const cp = document.createElementNS(NS, 'clipPath');
    cp.setAttribute('id', MELD_CLIP_ID);
    cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
    rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(-CLIP_PAD));
    rect.setAttribute('y', String(-CLIP_PAD));
    rect.setAttribute('height', String((SIZE_DIMS[SIZE]?.h || 128) + CLIP_PAD * 2));
    rect.setAttribute('width', '10000');   // sized per frame by meldTo
    cp.appendChild(rect);
    defs.appendChild(cp);
    return rect;
  }

  // Drive card-bg width + the shared clip's right edge from ONE tween. `rows` are
  // the expand-right segments with their target show state. cardX + width = the
  // card's right edge; the clip rect (x = -CLIP_PAD) right edge = cardX+width, so
  // clip width = cardX + width + CLIP_PAD.
  function meldTo(bg, targetW, rows, fresh) {
    const cardX = parseFloat(bg.getAttribute('x')) || 0;
    const clipW = (w) => cardX + w + CLIP_PAD;
    const prevW = laidOut['__cardw'];

    // First paint / theme swap / no gsap: snap, no clip layer.
    if (!gsap || fresh || prevW === undefined) {
      bg.setAttribute('width', String(Math.max(targetW, 1)));
      rows.forEach((r) => {
        r.el.setAttribute('opacity', r.show ? '1' : '0');
        r.el.style.clipPath = '';
        animShown[r.name] = r.show;
      });
      laidOut['__cardw'] = targetW;
      return;
    }

    const curW = parseFloat(bg.getAttribute('width')) || targetW;
    const visChanged = rows.some((r) => animShown[r.name] !== r.show);
    if (curW === targetW) {
      // The card edge doesn't move, so there's nothing for the card-edge clip to
      // wipe along. A visibility change here is a NON-rightmost segment toggling
      // (e.g. the inning hidden while the live cluster still holds the full-width
      // edge) — snap it in place; a card-edge wipe can't reach a mid-card row.
      if (visChanged) {
        rows.forEach((r) => {
          r.el.setAttribute('opacity', r.show ? '1' : '0');
          r.el.style.clipPath = '';
          animShown[r.name] = r.show;
        });
      }
      return;
    }
    // A row only participates in the sweep (opacity 1 + card-edge clip) if it is
    // being SHOWN, or was shown and is now hiding (needs wiping out). A row that
    // is hidden AND was already hidden must stay dark for the whole sweep —
    // otherwise the growing card edge passes over its position and momentarily
    // reveals it (e.g. Show Inning off while Show Live toggles on lit the inning
    // up mid-animation, then blanked it on complete).
    const rect = ensureMeldClip();
    rows.forEach((r) => {
      const wasShown = animShown[r.name] === true;
      animShown[r.name] = r.show;
      if (r.show || wasShown) {
        r.el.setAttribute('opacity', '1');
        if (rect) r.el.style.clipPath = `url(#${MELD_CLIP_ID})`;
      } else {
        r.el.setAttribute('opacity', '0');
        r.el.style.clipPath = '';
      }
    });

    const proxy = clipProxy['__card'] || (clipProxy['__card'] = { w: curW });
    proxy.w = curW;
    if (rect) rect.setAttribute('width', String(clipW(curW)));
    gsap.to(proxy, {
      w: targetW,
      duration: MELD_DUR,
      ease: MELD_EASE,
      overwrite: true,
      onUpdate: () => {
        bg.setAttribute('width', String(Math.max(proxy.w, 1)));
        if (rect) rect.setAttribute('width', String(clipW(proxy.w)));
      },
      onComplete: () => {
        bg.setAttribute('width', String(Math.max(targetW, 1)));
        rows.forEach((r) => {
          r.el.style.clipPath = '';                 // steady state: no clip layer
          r.el.setAttribute('opacity', r.show ? '1' : '0');
        });
      },
    });
    laidOut['__cardw'] = targetW;
  }

  // The expand-right wipe only clips the RIGHT edge; top/bottom/left get a
  // generous negative inset so mid-wipe frames never trim content. rightPct:
  // 0 = fully open, 100 = fully collapsed.
  //
  // CRITICAL: a clip-path — even a fully-open one — pins the group to its own
  // GPU composited layer, whose texture is sized to the element's paint bounds.
  // Round glyph overshoot (the 6/9/0 bottom/left curves) then gets trimmed by
  // the layer edge under GPU raster (OBS, real Chrome) even though CPU raster
  // doesn't show it. So the CLIP IS ONLY EVER APPLIED WHILE ANIMATING: a fully
  // shown row carries no clip-path at all (steady-state = zero composite layer).
  const clipInset = (rightPct) => `inset(-50% ${rightPct}% -50% -50%)`;

  // Absolute-mode row toggle. A plain row snaps opacity in place. A row tagged
  // data-anim="expand-right" (grammar: `slot=row-live anim=expand-right`) instead
  // wipes open left→right on show and collapses right→left on hide, via an
  // animated clip-path inset — the core beside it never moves. First paint and
  // theme swaps snap (no animation); only live show/hide transitions animate.
  function toggleRow(el, name, show, fresh) {
    const expand = el.getAttribute('data-anim') === 'expand-right';
    const prev = animShown[name];
    animShown[name] = show;
    if (!expand) { el.setAttribute('opacity', show ? '1' : '0'); return; }
    if (!gsap || fresh || prev === undefined) {          // snap to end state
      el.setAttribute('opacity', show ? '1' : '0');
      el.style.clipPath = show ? 'none' : clipInset(100);  // shown = no clip layer
      return;
    }
    if (prev === show) return;                            // no transition
    const proxy = clipProxy[name] || (clipProxy[name] = { p: show ? 100 : 0 });
    if (show) el.setAttribute('opacity', '1');
    gsap.to(proxy, {
      p: show ? 0 : 100,
      duration: MELD_DUR,     // lockstep with the card-bg width tween
      ease: MELD_EASE,
      overwrite: true,
      onUpdate: () => { el.style.clipPath = clipInset(proxy.p); },
      // Drop the clip once open so the steady state carries no composite layer
      // (see clipInset); on hide, leave it collapsed and blank the opacity.
      onComplete: () => {
        if (show) el.style.clipPath = 'none';
        else el.setAttribute('opacity', '0');
      },
    });
  }

  function relayout(vis, fresh) {
    // Absolute themes place their rows by hand in a fixed frame: honour the
    // authored transforms/card size and only toggle each row's visibility.
    // (No reflow — the swap between row-live and row-final, authored to overlap,
    // is a straight opacity crossover in place.)
    if (engine.absoluteLayout) {
      // Horizontal meld: any segment declaring data-cardw grows the shared
      // card-bg width to fit whichever segments are visible (card-bg carries
      // data-compact-w = the collapsed width). A theme without data-compact-w
      // just toggles its rows in place (the original absolute behaviour).
      const bg = engine.slots['card-bg'];
      const compactW = bg ? parseFloat(bg.getAttribute('data-compact-w')) : NaN;
      const meld = !!bg && Number.isFinite(compactW);
      let cardW = meld ? compactW : 0;
      const expandRows = [];
      for (const [name, want] of STACK) {
        const el = engine.slots[name];
        if (!el) continue;
        const show = !!want(vis);
        const isExpand = el.getAttribute('data-anim') === 'expand-right';
        // In a melding theme the expand-right segments are wiped by the shared
        // card-edge clip (meldTo); non-expand rows just snap. In a non-melding
        // absolute theme, each expand row does its own in-place clip wipe.
        if (meld && isExpand) {
          expandRows.push({ el, name, show });
          if (show) {
            const cw = parseFloat(el.getAttribute('data-cardw'));
            if (Number.isFinite(cw)) cardW = Math.max(cardW, cw);
          }
        } else {
          toggleRow(el, name, show, fresh);
        }
      }
      if (meld) meldTo(bg, cardW, expandRows, fresh);
      return;
    }
    const top = cardTop();
    let off = 0, activeCount = 0;
    for (const [name, want] of STACK) {
      const el = engine.slots[name];
      if (!el) continue;
      const show = !!want(vis);
      const div = el.querySelector('[data-part="div"]');
      if (show) {
        moveRow(el, name, top + off, true, fresh);
        if (div) div.setAttribute('opacity', activeCount === 0 ? '0' : '1');
        off += parseFloat(el.getAttribute('data-h')) || 0;
        activeCount++;
      } else {
        moveRow(el, name, top + off, false, fresh);
      }
    }
    sizeCard(top, off, fresh);
  }

  // ── binding helpers ─────────────────────────────────────────────────────────
  function setOpacity(name, on) {
    const el = engine.slots[name];
    if (el) el.setAttribute('opacity', on ? '1' : '0');
  }

  function teamLogoUrl(team) { return team && window.RioData ? RioData.teamLogoUrl(team) : ''; }
  function charIconUrl(name) { return name && window.RioData ? RioData.charIconUrl(name) : ''; }

  // The side's captain character icon — the logo-slot fallback when a team logo
  // isn't available (e.g. a completed game with no assigned MSB team).
  function captainIconUrl(state, t) {
    const capIdx = g(state, `score.${SB}.player.${t}.rio_captainIndex`, null);
    if (capIdx == null) return '';
    const name = g(state, `score.${SB}.player.${t}.character.${capIdx}.name`, '');
    return name ? charIconUrl(name) : '';
  }

  function bindTop(d, vis) {
    engine.setText('s1-name', d.p1 || 'Player One');
    engine.setText('s2-name', d.p2 || 'Player Two');
    engine.setText('s1-score', d.sL);
    engine.setText('s2-score', d.sR);
    engine.setImage('s1-logo', vis.showTeamLogos ? (teamLogoUrl(d.team1) || d.cap1) : '');
    engine.setImage('s2-logo', vis.showTeamLogos ? (teamLogoUrl(d.team2) || d.cap2) : '');

    const live = !d.isFinal;
    engine.setText('inn-half', live ? d.halfShort : '');
    setOpacity('inn-half', live);
    engine.setText('inn-num', live ? d.inn : '');
    setOpacity('inn-num', live);
    setOpacity('inn-arrow-up', live && d.isTop);
    setOpacity('inn-arrow-down', live && !d.isTop);
    setOpacity('final-badge', d.isFinal);
  }

  function bindLive(d) {
    engine.setImage('bat-icon', charIconUrl(d.batter));
    engine.setText('bat-name', d.batter || '');
    engine.setImage('pit-icon', charIconUrl(d.pitcher));
    engine.setText('pit-name', d.pitcher || '');

    for (let i = 0; i < 4; i++) dot(engine, `ball-${i}`, i < d.balls, BALL_ON);
    for (let i = 0; i < 3; i++) dot(engine, `strike-${i}`, i < d.strikes, STRIKE_ON);
    for (let i = 0; i < 3; i++) dot(engine, `out-${i}`, i < d.outs, OUT_ON);
    // Text-count themes (e.g. Scoreboard S) show the count as numbers rather than
    // dots; no-ops where those slots are absent.
    engine.setText('balls', d.balls);
    engine.setText('strikes', d.strikes);

    const on = [d.r1, d.r2, d.r3];
    const names = [d.r1Name, d.r2Name, d.r3Name];
    for (let b = 1; b <= 3; b++) {
      const occupied = !d.isFinal && !!on[b - 1];
      const baseEl = engine.slots[`base-${b}`];
      if (baseEl) {
        baseEl.style.fill = occupied ? 'var(--accent)' : DOT_OFF;
        baseEl.style.stroke = occupied ? 'none' : 'var(--border)';
      }
      engine.setImage(`runner-${b}`, occupied && names[b - 1] ? charIconUrl(names[b - 1]) : '');
    }
  }

  // Completed-game cluster: ELO swings + stadium/innings/date meta line.
  function bindFinal(state, d, vis) {
    const winnerUser = g(state, `score.${SB}.winner_user`, '');
    const wIn = g(state, `score.${SB}.winner_incoming_elo`, null);
    const wOut = g(state, `score.${SB}.winner_result_elo`, null);
    const lIn = g(state, `score.${SB}.loser_incoming_elo`, null);
    const lOut = g(state, `score.${SB}.loser_result_elo`, null);
    const p1Won = d.p1 === winnerUser;
    const elo = [
      { inn: p1Won ? wIn : lIn, out: p1Won ? wOut : lOut },
      { inn: p1Won ? lIn : wIn, out: p1Won ? lOut : wOut },
    ];
    const hasElo = vis.showElo && elo[0].inn != null && elo[0].out != null;

    for (let t = 1; t <= 2; t++) {
      setOpacity(`elo${t}-group`, hasElo);
      if (!hasElo) continue;
      const e = elo[t - 1];
      const delta = Math.round(e.out - e.inn);
      engine.setText(`elo${t}-in`, Math.round(e.inn));
      engine.setText(`elo${t}-out`, Math.round(e.out));
      engine.setText(`elo${t}-delta`, `${delta >= 0 ? '+' : ''}${delta}`);
      const dEl = engine.slots[`elo${t}-delta`];
      if (dEl) dEl.style.fill = delta >= 0 ? 'var(--elo-gain, #22c55e)' : 'var(--elo-loss, #ef4444)';
    }

    const metaParts = [];
    if (d.stadium) metaParts.push(d.stadium);
    if (d.inningsPlayed) metaParts.push(`${d.inningsPlayed} inn`);
    engine.setText('meta-main', metaParts.join(' · '), { optional: true });
    let dateStr = '';
    const end = g(state, `score.${SB}.date_time_end`, '');
    if (end) {
      const dt = new Date(end);
      if (!isNaN(dt.getTime())) dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    engine.setText('meta-date', dateStr, { optional: true });

    return hasElo || metaParts.length > 0 || !!dateStr;
  }

  function bindRoster(state) {
    let any = false;
    for (let t = 1; t <= 2; t++) {
      const capIdx = g(state, `score.${SB}.player.${t}.rio_captainIndex`, null);
      let capEl = null;
      for (let i = 0; i < 9; i++) {
        const name = g(state, `score.${SB}.player.${t}.character.${i}.name`, '');
        if (name) any = true;
        engine.setImage(`s${t}-char-${i}`, name ? charIconUrl(name) : '');
        if (capIdx != null && i === capIdx && name) capEl = engine.slots[`s${t}-char-${i}`];
      }
      // The captain ring is a theme shape the mount parks around the captain's
      // icon slot; a theme sizes it against its own icon dimensions.
      const ring = engine.slots[`s${t}-cap-ring`];
      if (ring) {
        if (capEl) {
          const pad = parseFloat(ring.getAttribute('data-pad')) || 3;
          ring.setAttribute('x', (parseFloat(capEl.getAttribute('x')) || 0) - pad);
          ring.setAttribute('y', (parseFloat(capEl.getAttribute('y')) || 0) - pad);
          ring.setAttribute('opacity', '1');
        } else {
          ring.setAttribute('opacity', '0');
        }
      }
    }
    return any;
  }

  // Linescore. More than MAX_INN innings binds a sliding window of the last 9
  // with renumbered column headers (box-h-i).
  function bindBox(d) {
    const nInn = Math.max(d.away.length, d.home.length);
    const start = Math.max(0, nInn - MAX_INN);
    for (let i = 1; i <= MAX_INN; i++) {
      const src = start + i - 1;
      const active = src < nInn;
      setOpacity(`box-col-${i}`, active);
      engine.setText(`box-h-${i}`, active ? String(src + 1) : '');
      const a = d.away[src];
      const h = d.home[src];
      engine.setText(`box-away-${i}`, active ? (a != null ? a : '-') : '');
      engine.setText(`box-home-${i}`, active ? (h != null ? h : '-') : '');
    }
    engine.setText('box-away-R', d.sL);
    engine.setText('box-home-R', d.sR);
    engine.setText('box-away-name', d.p1 || 'Away');
    engine.setText('box-home-name', d.p2 || 'Home');
    return nInn > 0;
  }

  // ── main update ─────────────────────────────────────────────────────────────
  async function update(state, settings) {
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    if (themeChanged) { revealKey = ''; laidOut = {}; animShown = {}; clipProxy = {}; }
    if (disposed) return;

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE);
    else OverlayBase.clearDesignSettings();

    const p1 = g(state, `score.${SB}.player.1.rioName`, '');
    const p2 = g(state, `score.${SB}.player.2.rioName`, '');
    const hasGame = !!(p1 || p2);
    host.style.display = hasGame ? '' : 'none';
    if (!hasGame) { revealKey = ''; return; }

    const vis = readToggles(settings);
    const half = g(state, `score.${SB}.half_inning`, '');
    const sourceType = g(state, `score.${SB}.source_type`, '');
    const isCompleted = sourceType === 'completed_api' || g(state, `score.${SB}.game_completed`, false) === true;
    const isFinal = half === 'Final' || isCompleted;

    const d = {
      p1, p2,
      team1: g(state, `score.${SB}.player.1.logo`, '') || g(state, `score.${SB}.player.1.msb_team`, ''),
      team2: g(state, `score.${SB}.player.2.logo`, '') || g(state, `score.${SB}.player.2.msb_team`, ''),
      cap1: captainIconUrl(state, 1),
      cap2: captainIconUrl(state, 2),
      sL: g(state, `score.${SB}.score_left`, 0),
      sR: g(state, `score.${SB}.score_right`, 0),
      inn: g(state, `score.${SB}.inning`, ''),
      halfShort: half === 'Bottom' ? 'BOT' : half === 'Top' ? 'TOP' : (half || '').toUpperCase(),
      isTop: half === 'Top',
      isFinal,
      outs: parseInt(g(state, `score.${SB}.outs`, 0)) || 0,
      balls: parseInt(g(state, `score.${SB}.balls`, 0)) || 0,
      strikes: parseInt(g(state, `score.${SB}.strikes`, 0)) || 0,
      batter: g(state, `score.${SB}.batter`, ''),
      pitcher: g(state, `score.${SB}.pitcher`, ''),
      r1: g(state, `score.${SB}.cbRioRunnerOn1`, false),
      r2: g(state, `score.${SB}.cbRioRunnerOn2`, false),
      r3: g(state, `score.${SB}.cbRioRunnerOn3`, false),
      r1Name: g(state, `score.${SB}.runner1Name`, ''),
      r2Name: g(state, `score.${SB}.runner2Name`, ''),
      r3Name: g(state, `score.${SB}.runner3Name`, ''),
      away: g(state, `score.${SB}.away_linescore`, []) || [],
      home: g(state, `score.${SB}.home_linescore`, []) || [],
      stadium: g(state, `score.${SB}.stadium`, ''),
      inningsPlayed: g(state, `score.${SB}.innings_played`, ''),
    };

    applyColours(settings, g(state, `score.${SB}.player.1.port`, null), g(state, `score.${SB}.player.2.port`, null));

    bindTop(d, vis);
    bindLive(d);
    const hasFinalContent = bindFinal(state, d, vis);
    const hasRoster = bindRoster(state);
    const hasBox = bindBox(d);
    bindImageProbe(engine, () => disposed, 'logo', vis.showLogo ? OverlayBase.brandingLogoUrl() : '', 'logo-default');

    // Live cluster: only during play, and only if the producer master is on.
    // A NEW key (not an overwrite of vis.showLive) — the row-stack predicate
    // needs this derived "show right now" value, but vis.showLive is still the
    // raw producer toggle other callers may read.
    vis.showLiveSeg = !isFinal && vis.showLive;
    // Inning segment: the inning number during play (producer toggle), swapping
    // to the final-badge on a completed game (bindTop drives which child shows).
    vis.showInningSeg = isFinal || vis.showInning;
    vis.showFinal = isFinal && isCompleted && hasFinalContent;
    vis.showRoster = hasRoster;
    vis.showBox = hasBox;

    engine.refitText();
    relayout(vis, themeChanged);

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (!disposed) engine.refitText();
    });

    const key = `${theme}|${g(state, `score.${SB}.game_id`, '')}|${p1}|${p2}`;
    if (key !== revealKey) { revealKey = key; gate.requestReveal(); }
  }

  function playReveal() {
    host.classList.remove('sb-reveal');
    void host.offsetWidth;
    host.classList.add('sb-reveal');
    // Drop the class once the slide finishes: the animation's retained end
    // transform (translateX(0), via fill-mode `both`) otherwise keeps sb-host on
    // a composited layer that's rastered once and then GPU-scaled — i.e. blurry
    // until a reload re-rasters it. Removing the class returns it to an
    // untransformed, un-layered (crisp) resting state. See reveal-gate.js.
    clearAnimClassOnEnd(host, 'sb-reveal');
  }

  // Gate playReveal behind the OBS on-screen signal: dedupe redundant activates,
  // snap dark on hide, one clean slide per show (see reveal-gate.js).
  const gate = createRevealGate({ host, offClass: 'sb-off', play: playReveal });

  function setShown(shown) { gate.setShown(shown); }

  function dispose() {
    disposed = true;
    gate.dispose();
    window.removeEventListener('resize', engine.refitText);
    host.classList.remove('sb-host', 'sb-reveal');
    host.innerHTML = '';
  }

  window.addEventListener('resize', engine.refitText);
  return { update, setShown, dispose };
}

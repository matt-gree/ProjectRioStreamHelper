// scoreboard-mount.js — the re-themable horizontal Scoreboard element.
//
// One mount drives every size variant: the look lives in the active DESIGN
// PACKAGE's per-size theme SVG (/design/{package}/scoreboard-{size}.svg,
// element-by-element fallback to `default`). Sizes: s · m · l. Legacy
// ?size=xs / ?size=xl OBS sources resolve to l.
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
//   row-final   completed cluster (stadium/innings/date meta)
//   row-roster  both 9-character rosters
//   row-box     per-inning linescore
// A theme implements whatever subset fits its size. row-inning/row-live are
// gated by producer toggles overlays.scoreboard.showInning/showLive (both
// default on); showLive is a master override the live game state ANDs with, and
// a shown live cluster forces the inning on regardless of its own toggle.
// row-roster needs TWO characters on a side, not one — a completed game with no
// roster in its record still has a captain, and one icon is not a roster band.
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
// VERTICAL MELD (absolute mode): the same grammar one axis over —
// data-compact-h on card-bg + data-cardh on a segment grows the card's HEIGHT
// for a band that is only sometimes there (Scoreboard S's game-mode strip).
// Height alone, no clip wipe: the horizontal sweep exists because the card's
// right EDGE travels across the segments it reveals, and a band appearing under
// the card has nothing to travel over — it grows and fades. card-rail tracks the
// height with card-bg, or the accent stripe stops short of the taller card.
//
// DATA SLOTS (all optional; the engine skips what a theme omits):
//   sT-logo(image) sT-name(text,maxw) sT-score(text)          T ∈ {1,2}
//   inn-half(text TOP/BOT) inn-num(text) inn-arrow-up/down(g) final-badge(g)
//   bat-icon(image) bat-name(text) pit-icon(image) pit-name(text) — the batter
//     and the pitcher at FIXED positions, whichever side they are on.
//   sT-live-icon(image) sT-role(text AB/P)                    T ∈ {1,2}
//   sT-stat-0..3-label / sT-stat-0..3-value(text) — the same thing per SIDE:
//     the character side T has on the field, the role they are in, and their
//     four headline stats from RioData.getStatsLine (as the Stat Bar and Stat
//     Card draw them). A theme takes one arrangement or the other.
//   ball-0..2 strike-0..1 out-0..1      (mount sets fill on active)
//   base-1..3(polygon fill) runner-1..3(image)
//   meta-main(text stadium · innings) meta-date(text)
//   meta-game-mode(text) — BOTH states, unlike the meta-* pair above, which are
//     completed-game only. Place it wherever the size has room for standing
//     context; it self-hides when the mode is unknown.
//   ANY slot may carry data-center="card" (grammar `center=card`): in a melding
//     theme the mount drives its x from the card's live centre instead of the
//     authored one. Pair it with text-anchor="middle".
//   sT-char-0..8(image) sT-cap-ring(shape; mount moves it to the captain slot)
//   box-col-1..9(g) box-h-1..9(text) box-away-1..9 box-home-1..9(text)
//   box-away-r box-home-r(text) box-away-name box-home-name(text)
//   logo(image branding) logo-default(g fallback mark)
//
// COLOUR SEAMS: the mount sets --side1/--side2 on the host from each player's
// controller port (P1/P2 fallback), plus --accent when the producer pinned
// overlays.scoreboard.accentColor, which also marks an extra inning's column
// number in the linescore.
//
//   const sb = mountScoreboard({ host, sb: 1, size: 'l' });
//   sb.update(OverlayBase.state, OverlayBase.settings);
//   sb.setShown(bool);  sb.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';
import { createRevealGate, clearAnimClassOnEnd } from './reveal-gate.js';
import { ensureGsap } from './gsap-loader.js';
import { DOT_OFF, dot, bindImageProbe, prettyStadium, linescoreColumns } from './mount-utils.js';
import { ensurePortPalette, inkOn, portColor as portPaletteColor } from './port-colors.js';

const SETTINGS_TYPE = 'scoreboard';
const DEFAULT_PACKAGE = 'default';
const MAX_INN = 9;

// Two sizes, and the gap between them is the point: S is a compact pill (names,
// score, count) and L is the full card (rosters + linescore in BOTH states).
// M (600x200) was retired 2026-08-29 — it sat between them and had to keep
// choosing, so every improvement to either end pulled it toward L until the two
// were the same card 200 units apart. A retired code resolves to `l` below, so
// a producer's leftover ?size=m source keeps rendering.
export const SIZE_DIMS = {
  s:  { w: 388, h: 156 },
  l:  { w: 800, h: 460 },
};

const BALL_ON = '#22c55e', STRIKE_ON = '#eab308', OUT_ON = '#ef4444';

// Row order + visibility predicate over the resolved flags.
const STACK = [
  ['row-top',    () => true],
  ['row-inning', v => v.showInningSeg],
  ['row-live',   v => v.showLiveSeg],
  ['row-final',  v => v.showFinal],
  ['row-roster', v => v.showRosterRow],
  ['row-box',    v => v.showBoxRow],
  ['row-mode',   v => v.showGameModeSeg],
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
  let logoShown = {};   // logo/name slot -> last "logo drawn" state (reflow + fade)
  let clipProxy = {};   // absolute-mode row name -> { p } proxy tweened for expand-right
  let disposed = false;

  const g = OverlayBase.deepGet;

  // Per-scoreboard settings namespace. Each scoreboard source keeps its own
  // config under overlays.scoreboard.{N}.*; a plain overlays.scoreboard.* leaf
  // is the legacy (pre-per-scoreboard) global, used as a non-destructive
  // fallback so boards that were never individually edited keep their old look.
  // Mirrors scorecard-mount's scGet — the two board-scoped mounts resolve the
  // same way, and the Setup panel writes to whichever branch the producer edits.
  const NS = `${SETTINGS_TYPE}.${SB}`;
  function sbGet(settings, k, def) {
    const perSb = g(settings, `overlays.${SETTINGS_TYPE}.${SB}.${k}`, undefined);
    if (perSb !== undefined) return perSb;
    return g(settings, `overlays.${SETTINGS_TYPE}.${k}`, def);
  }

  function readToggles(settings) {
    // showLogo is promoted-to-global (per-layout → overlays.global.showLogo);
    // a per-board pin still wins over both, so check it before the global chain.
    const perSbLogo = g(settings, `overlays.${SETTINGS_TYPE}.${SB}.showLogo`, undefined);
    const showLogo = perSbLogo !== undefined
      ? perSbLogo !== false
      : OverlayBase.readSetting(SETTINGS_TYPE, 'showLogo', true) !== false;
    return {
      showTeamLogos: sbGet(settings, 'showTeamLogos', true) !== false,
      showGameMode: sbGet(settings, 'showGameMode', true) !== false,
      showLogo,
      // Producer switches for melded themes with independent segments (Scoreboard
      // S): showLive is a master override for the live cluster (off hides it even
      // during a live game); showInning toggles the inning number segment. Themes
      // without those segments ignore both.
      showLive:     sbGet(settings, 'showLive', true) !== false,
      showInning:   sbGet(settings, 'showInning', true) !== false,
      // The batter's / pitcher's headline stats beside their portraits (Large
      // only — no other size declares the slots).
      showStats:    sbGet(settings, 'showStats', true) !== false,
      // The two BANDS the Large board can drop (no other size has either), each
      // a producer switch on top of its own content gate. They are choices about
      // the SCENE, not about the data: with both off the card is a header strip
      // a producer can leave up over live play, with both on it is the full
      // between-innings graphic, and that range is the whole reason there is no
      // middle size any more.
      showRoster:   sbGet(settings, 'showRoster', true) !== false,
      showBox:      sbGet(settings, 'showBox', true) !== false,
    };
  }

  // The port palette is the app's (Design tab → Controller Ports, under it the
  // active package's own `portColors`) — see lib/port-colors.js. A side with no
  // controller port falls back to its side index, so a board with no port data
  // is still two different colours.
  function portColor(port, fallbackIdx) {
    return portPaletteColor(Number.isInteger(port) ? port : fallbackIdx);
  }

  function applyColours(settings, p1Port, p2Port) {
    const accent = sbGet(settings, 'accentColor', null);
    if (accent) host.style.setProperty('--accent', accent); else host.style.removeProperty('--accent');
    const c1 = portColor(p1Port, 0);
    const c2 = portColor(p2Port, 1);
    if (c1) host.style.setProperty('--side1', c1); else host.style.removeProperty('--side1');
    if (c2) host.style.setProperty('--side2', c2); else host.style.removeProperty('--side2');
    // Readable ink ON each side's colour, for a shape the theme fills with it
    // and then puts text inside — the live row's AB / P tag. Port 3 is a bright
    // yellow, so this cannot be a fixed white (see inkOn).
    for (const [v, c] of [['--side1-ink', c1], ['--side2-ink', c2]]) {
      if (c) host.style.setProperty(v, inkOn(c)); else host.style.removeProperty(v);
    }
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
  /*
   * Vertical meld: card-bg (and card-rail with it) grows to `targetH`.
   *
   * Deliberately simpler than meldTo — a height change has no travelling edge to
   * clip against, so the band that caused it just fades through the normal row
   * toggle while the card grows underneath it. Shares MELD_DUR/MELD_EASE so a
   * card that happens to change both dimensions at once moves as one object.
   */
  function meldHeightTo(bg, targetH, fresh) {
    const h = Math.max(targetH, 1);
    const els = [bg, engine.slots['card-rail']].filter(Boolean);
    const prev = laidOut['__cardh'];
    laidOut['__cardh'] = targetH;
    if (!gsap || fresh || prev === undefined) {
      els.forEach(el => el.setAttribute('height', String(h)));
      return;
    }
    if (prev === targetH) return;
    els.forEach(el => gsap.to(el, {
      attr: { height: h }, duration: MELD_DUR, ease: MELD_EASE,
    }));
  }

  /*
   * Slots that ride the melding card's CENTRE instead of a fixed x — the
   * game-mode band on Scoreboard S, tagged `center=card` (data-center="card").
   *
   * A melding card has no one width to centre against at author time, so the
   * theme can't express this: the mount has to re-place the slot from the same
   * tween that moves the card edge, or the label would jump to its new centre
   * only after the meld finished. The slot must be text-anchor="middle" — this
   * moves the anchor, it does not measure the glyphs.
   *
   * Cached per theme (reset with the rest of the layout memo on a theme swap),
   * so a theme with no centred slot pays one empty query.
   */
  let centerEls = null;
  function centerToCard(cardX, w) {
    if (!centerEls) centerEls = Array.from(host.querySelectorAll('[data-center="card"]'));
    if (!centerEls.length) return;
    const cx = cardX + w / 2;
    for (const el of centerEls) el.setAttribute('x', String(cx));
  }

  function meldTo(bg, targetW, rows, fresh) {
    const cardX = parseFloat(bg.getAttribute('x')) || 0;
    const clipW = (w) => cardX + w + CLIP_PAD;
    const prevW = laidOut['__cardw'];

    // First paint / theme swap / no gsap: snap, no clip layer.
    if (!gsap || fresh || prevW === undefined) {
      bg.setAttribute('width', String(Math.max(targetW, 1)));
      centerToCard(cardX, Math.max(targetW, 1));
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
        centerToCard(cardX, Math.max(proxy.w, 1));
        if (rect) rect.setAttribute('width', String(clipW(proxy.w)));
      },
      onComplete: () => {
        bg.setAttribute('width', String(Math.max(targetW, 1)));
        centerToCard(cardX, Math.max(targetW, 1));
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
      const compactH = bg ? parseFloat(bg.getAttribute('data-compact-h')) : NaN;
      const meld = !!bg && Number.isFinite(compactW);
      const meldH = !!bg && Number.isFinite(compactH);
      let cardW = meld ? compactW : 0;
      let cardH = meldH ? compactH : 0;
      const expandRows = [];
      for (const [name, want] of STACK) {
        const el = engine.slots[name];
        if (!el) continue;
        const show = !!want(vis);
        if (meldH && show) {
          const ch = parseFloat(el.getAttribute('data-cardh'));
          if (Number.isFinite(ch)) cardH = Math.max(cardH, ch);
        }
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
      if (meldH) meldHeightTo(bg, cardH, fresh);
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

  /*
   * A side whose logo isn't drawn hands the box to its NAME instead of leaving a
   * hole. Team Logos off is the case a producer hits on purpose (a completed
   * game with no MSB team assigned still wants the toggle), and it was costing
   * ~46 units of the name's width to nothing.
   *
   * DERIVED, not authored — no new theme attribute, because the geometry already
   * says everything needed. Every shipped board puts the logo on the name's
   * OUTER side: side 1 is a start-anchored name with the logo to its left, side
   * 2 on the wide boards is an end-anchored name with the logo to its right. So
   * the rule is one sentence in both cases — the name's anchor moves to the far
   * edge of the logo box, and its fit bound grows by exactly the distance moved,
   * which leaves the name's other edge (the one facing the score) where the
   * designer put it. `gained > 0` is the guard: a theme that stacks the logo
   * above the name, or overlaps them, gains nothing and is left alone.
   *
   * The authored pair is captured once per theme in data-basegeom (the same
   * trick lowerthird-mount uses for its caption-less logo box), so the logo
   * coming back restores the design rather than an accumulated offset.
   */
  function reclaimLogoBox(nameSlot, logoSlot, hasLogo, fresh) {
    const text = engine.slots[nameSlot];
    const logo = engine.slots[logoSlot];
    if (!text || !logo) return;
    if (!text.hasAttribute('data-basegeom')) {
      // text-anchor can be an attribute or come off a theme's stylesheet, so it
      // is read computed — once, here, rather than per frame.
      const anchor = getComputedStyle(text).textAnchor || 'start';
      text.setAttribute('data-basegeom',
        `${parseFloat(text.getAttribute('x')) || 0} ${parseFloat(text.getAttribute('data-maxw')) || 0} ${anchor}`);
    }
    const [baseX, baseMaxw, anchor] = text.getAttribute('data-basegeom').split(/\s+/);
    let x = parseFloat(baseX);
    let maxw = parseFloat(baseMaxw);
    if (!hasLogo) {
      const lx = parseFloat(logo.getAttribute('x'));
      const lw = parseFloat(logo.getAttribute('width'));
      if (Number.isFinite(lx) && Number.isFinite(lw)) {
        const edge = anchor === 'end' ? lx + lw : lx;   // the logo's far side
        const gained = anchor === 'end' ? edge - x : x - edge;
        if (gained > 0) { x = edge; maxw += gained; }
      }
    }

    /*
     * The fit bound moves NOW, in both directions, while x glides. Tweening the
     * bound instead would mean a getComputedTextLength per frame per name — the
     * one measurement refitText is carefully built to batch — to animate
     * something only a name long enough to be shrunk would even show. Landing it
     * up front also keeps a returning logo from ever meeting a name still sized
     * for the wider box.
     *
     * refitText skips a slot whose TEXT hasn't changed, so a bound that moved
     * under unchanged content is invisible to it: without invalidateFit the name
     * keeps whatever size it was shrunk to for the old box.
     */
    if (parseFloat(text.getAttribute('data-maxw')) !== maxw) {
      text.setAttribute('data-maxw', String(maxw));
      engine.invalidateFit(text);
    }

    // Recorded BEFORE the no-op check: on first paint the name is already at its
    // authored x, so an early return here would leave `prev` undefined and the
    // first real toggle would snap instead of gliding.
    const prev = logoShown[nameSlot];
    logoShown[nameSlot] = hasLogo;
    if (parseFloat(text.getAttribute('x')) === x) return;
    // Snap on first paint and theme swaps — the same rule the row toggles and
    // the meld follow. Only a live change animates, so a source coming up on air
    // is never mid-slide.
    if (!gsap || fresh || prev === undefined || prev === hasLogo) {
      text.setAttribute('x', String(x));
      return;
    }
    // MELD_DUR/MELD_EASE, shared with the card's own width tween: on a melding
    // theme both can run off one producer click, and two eases would read as two
    // separate things moving.
    gsap.to(text, { attr: { x }, duration: MELD_DUR, ease: MELD_EASE, overwrite: true });
  }

  /*
   * The logo's own half of that swap. It cross-fades over the same beat rather
   * than snapping, or the box would empty a full 0.4s before the name arrives to
   * fill it — the vacancy reads as the glitch the reflow exists to remove.
   *
   * The hide defers `setImage('')` to the end of the fade: dropping the href up
   * front is what "hidden" means to the engine, and it would blank the image on
   * frame one with the tween then fading nothing.
   */
  function swapLogo(slot, url, fresh) {
    const el = engine.slots[slot];
    if (!el) return;
    const prev = logoShown[slot];
    const has = !!url;
    logoShown[slot] = has;
    if (!gsap || fresh || prev === undefined || prev === has) {
      engine.setImage(slot, url);          // steady state, and href swaps in place
      return;
    }
    if (has) {
      engine.setImage(slot, url);
      gsap.fromTo(el, { attr: { opacity: 0 } },
        { attr: { opacity: 1 }, duration: MELD_DUR, ease: MELD_EASE, overwrite: true });
      return;
    }
    gsap.to(el, {
      attr: { opacity: 0 }, duration: MELD_DUR, ease: MELD_EASE, overwrite: true,
      onComplete: () => { if (!disposed) engine.setImage(slot, ''); },
    });
  }

  function bindTop(d, vis, fresh) {
    engine.setText('s1-name', d.p1 || 'Player One');
    engine.setText('s2-name', d.p2 || 'Player Two');
    engine.setText('s1-score', d.sL);
    engine.setText('s2-score', d.sR);
    // An empty URL is the honest test for "is there a logo here": it covers the
    // producer toggle and a side with neither a team nor a resolvable captain.
    // (A URL that 404s still counts as drawn — a missing asset pack is its own
    // problem, surfaced in Settings, not something to reflow around.)
    const url1 = vis.showTeamLogos ? (teamLogoUrl(d.team1) || d.cap1) : '';
    const url2 = vis.showTeamLogos ? (teamLogoUrl(d.team2) || d.cap2) : '';
    swapLogo('s1-logo', url1, fresh);
    swapLogo('s2-logo', url2, fresh);
    reclaimLogoBox('s1-name', 's1-logo', !!url1, fresh);
    reclaimLogoBox('s2-name', 's2-logo', !!url2, fresh);

    const live = !d.isFinal;
    engine.setText('inn-half', live ? d.halfShort : '');
    setOpacity('inn-half', live);
    engine.setText('inn-num', live ? d.inn : '');
    setOpacity('inn-num', live);
    setOpacity('inn-arrow-up', live && d.isTop);
    setOpacity('inn-arrow-down', live && !d.isTop);
    setOpacity('final-badge', d.isFinal);
  }

  /*
   * EACH SIDE'S live cluster: the character that side has on the field right
   * now, the role they are in, and their four headline stats.
   *
   * Per SIDE, not per role — which is the whole point. The batter and the
   * pitcher were fixed to the left and right ends of the row, so the portrait
   * under a producer's name in the header belonged to the other player half the
   * time. Side 1's cluster now always describes side 1, and what changes every
   * half-inning is which role it is showing; the AB / P tag is the thing that
   * says which, so it is a slot the mount writes rather than a word in the SVG.
   *
   * Through RioData: `getTeamRole` answers which role a side is in, and
   * `getStatsLine` is the SAME resolver the Stat Bar and the Stat Card use — so
   * the four numbers beside a character here and the four on that character's
   * own card are the same four, formatted the same way, and a change to what
   * "headline stats" means lands in one place.
   *
   * Every slot is optional and blanked when there is nothing to say, so a theme
   * that doesn't draw this (classic's Large board, every Small board) is
   * unaffected, and a board whose record has no per-character stats shows a
   * portrait with nothing beside it rather than four zeroes. The producer's
   * Stats switch takes the same road: off is "no line", which blanks the eight
   * cells and moves nothing, since this row has no reflow.
   */
  function bindSideLive(state, d, vis) {
    for (const T of [1, 2]) {
      const role = window.RioData ? RioData.getTeamRole(state, SB, T) : null;
      const batting = role === 'batting';
      // The character, off the board's own batter/pitcher keys rather than the
      // stats line — a side with no per-character stats still has someone on
      // the field, and the portrait is the half of this that always works.
      const who = batting ? d.batter : d.pitcher;
      engine.setImage(`s${T}-live-icon`, who ? charIconUrl(who) : '');
      engine.setText(`s${T}-role`, who && role ? (batting ? 'AB' : 'P') : '', { optional: true });

      const line = (vis.showStats && window.RioData)
        ? RioData.getStatsLine(state, SB, T) : null;
      for (let i = 0; i < 4; i++) {
        const st = line && line.stats ? line.stats[i] : null;
        engine.setText(`s${T}-stat-${i}-label`, st ? st.label : '', { optional: true });
        engine.setText(`s${T}-stat-${i}-value`, st ? String(st.value) : '', { optional: true });
      }
    }
  }

  function bindLive(d, state, vis) {
    engine.setImage('bat-icon', charIconUrl(d.batter));
    engine.setText('bat-name', d.batter || '');
    engine.setImage('pit-icon', charIconUrl(d.pitcher));
    engine.setText('pit-name', d.pitcher || '');
    bindSideLive(state, d, vis);

    // Three balls, two strikes, two outs — the TERMINAL value of each count is
    // never a state the game sits in: the fourth ball is a walk, the third
    // strike a strikeout, the third out the side retired, and Rio has already
    // reset the count (or flipped the half) by the frame we read. A dot for a
    // number that can only ever be dark is a dot that reads as "not yet", so
    // the rows stop one short and a full row is what the event looks like.
    for (let i = 0; i < 3; i++) dot(engine, `ball-${i}`, i < d.balls, BALL_ON);
    for (let i = 0; i < 2; i++) dot(engine, `strike-${i}`, i < d.strikes, STRIKE_ON);
    for (let i = 0; i < 2; i++) dot(engine, `out-${i}`, i < d.outs, OUT_ON);
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

  /*
   * Completed-game meta: stadium / innings / date.
   *
   * The ELO swing used to lead this cluster and is GONE — a one-game rating
   * change reset every season, so it was spending the two widest thirds of the
   * band on a number most viewers could not place. The board still carries the
   * ratings in state (score.N.{winner,loser}_{incoming,result}_elo, written by
   * the provider off the Rio record); nothing draws them now.
   */
  function bindFinal(state, d) {
    let dateStr = '';
    const end = g(state, `score.${SB}.date_time_end`, '');
    if (end) {
      const dt = new Date(end);
      if (!isNaN(dt.getTime())) dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const metaParts = [];
    if (d.stadium) metaParts.push(prettyStadium(d.stadium));
    if (d.inningsPlayed) metaParts.push(`${d.inningsPlayed} inn`);
    engine.setText('meta-main', metaParts.join(' \u00b7 '), { optional: true });
    engine.setText('meta-date', dateStr, { optional: true });

    return metaParts.length > 0 || !!dateStr;
  }

  /*
   * Game mode, in BOTH states — the one piece of context that is as true during
   * a game as after it, which is why it isn't part of the completed cluster.
   * The name now reaches state on both feeds (score.N.game_mode; the live path
   * resolves the tag-set id against the cached mode list), so a theme can place
   * this slot once and have it mean something all broadcast long.
   *
   * `optional` so the slot disappears rather than leaving a hole when the mode
   * is unknown — which is the honest state for a cold cache or a game played
   * outside any tag set.
   */
  function bindGameMode(d, vis) {
    // The TEXT follows the band's switch, so a producer who collapses Scoreboard
    // S's mode band does not get the label back inside it. The Large board has
    // no band and no switch, so `showGameMode` sits at its default there and
    // this is just the mode.
    engine.setText('meta-game-mode', vis.showGameMode ? d.gameMode : '', { optional: true });
  }

  /*
   * Returns how many characters the fuller side actually has, not just whether
   * ANY name was found. A completed game with no roster in its record still has
   * its captain, so "any" was true for a single icon — and the Large board drew
   * a nine-wide band to hold it. The caller wants a roster, and one character
   * is not one.
   */
  function bindRoster(state) {
    let most = 0;
    for (let t = 1; t <= 2; t++) {
      const capIdx = g(state, `score.${SB}.player.${t}.rio_captainIndex`, null);
      let capEl = null;
      let count = 0;
      for (let i = 0; i < 9; i++) {
        const name = g(state, `score.${SB}.player.${t}.character.${i}.name`, '');
        if (name) count++;
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
      if (count > most) most = count;
    }
    return most;
  }

  // Linescore. More than MAX_INN innings binds a sliding window of the last 9
  // with renumbered column headers (box-h-i).
  /*
   * The linescore runs to REGULATION, not to whatever has been played.
   *
   * The two feeds only ever hand over the innings that have happened, so keying
   * the column count off the array length meant a live game grew its own table:
   * four innings into a nine-inning game the board drew four columns, and since
   * the columns divide their band (layoutBox) those four were stretched across
   * the full width — enormous cells, and no way to see that five more innings
   * were still to come. A scoreboard's linescore is a fixed frame you fill in.
   *
   * So the count is regulation (innings_selected) or the innings actually
   * played, whichever is greater — the max is what keeps EXTRA innings visible
   * once a game runs past its own length. An unplayed column draws its number
   * and a dash. A record with no innings_selected (an older one, or a shape
   * change upstream) falls back to what it played, which is the old behaviour.
   */
  function bindBox(d) {
    const played = Math.max(d.away.length, d.home.length);
    const total = linescoreColumns(played, d.inningsSelected);
    // Past MAX_INN the grid shows the LAST nine innings, not the first.
    const shown = Math.min(total, MAX_INN);
    const start = total - shown;
    for (let i = 1; i <= MAX_INN; i++) {
      const src = start + i - 1;
      const active = i <= shown;
      setOpacity(`box-col-${i}`, active);
      engine.setText(`box-h-${i}`, active ? String(src + 1) : '');
      const a = d.away[src];
      const h = d.home[src];
      engine.setText(`box-away-${i}`, active ? (a != null ? a : '-') : '');
      engine.setText(`box-home-${i}`, active ? (h != null ? h : '-') : '');
      // Extra innings: a column past the length the game was SET to. Rio
      // reports both (innings_selected / innings_played), and a 5-inning game
      // that went 6 otherwise reads as an ordinary 6-inning game — the one fact
      // about the linescore you cannot recover from the numbers in it. Accent
      // on the column number; '' hands the fill back to the theme's own class.
      const hEl = engine.slots[`box-h-${i}`];
      if (hEl) {
        const extra = active && d.inningsSelected > 0 && (src + 1) > d.inningsSelected;
        hEl.style.fill = extra ? 'var(--accent)' : '';
      }
    }
    engine.setText('box-away-r', d.sL);
    engine.setText('box-home-r', d.sR);
    engine.setText('box-away-name', d.p1 || 'Away');
    engine.setText('box-home-name', d.p2 || 'Home');
    layoutBox(shown);
    return total > 0;
  }

  /*
   * Close the gap the unused inning columns leave, and re-centre what is left.
   *
   * A theme composes the linescore for the full nine, but MSB games are mostly
   * five or six — so hiding the tail left the numbers huddled at one end with a
   * canyon between them and the R column, which is the widest, emptiest thing
   * on the card. Two transforms fix it, and they need no measurement:
   *
   *   box-total  (the R cluster) slides LEFT by the unused columns' width, so it
   *              sits one pitch past the last real inning, exactly the gap the
   *              theme authored after column nine.
   *   box-grid   (the whole table) slides back RIGHT by half of that, so the
   *              block keeps the centre the theme composed it on.
   *
   * box-total nests inside box-grid, so it nets half a slack leftward while the
   * columns net half a slack rightward — the table closes on its own middle.
   * The pitch is READ OFF the theme rather than declared: a theme that lays its
   * columns out on an even pitch has already stated it twice, and a third
   * statement in a data-* attribute is one that can disagree. A theme without
   * these two groups simply keeps its authored fixed positions.
   */
  function layoutBox(shown) {
    const grid = engine.slots['box-grid'];
    const total = engine.slots['box-total'];
    if (!grid && !total) return;
    const h1 = engine.slots['box-h-1'];
    const h2 = engine.slots['box-h-2'];
    const x1 = h1 ? parseFloat(h1.getAttribute('x')) : NaN;
    const pitch = h2 && Number.isFinite(x1)
      ? (parseFloat(h2.getAttribute('x')) || 0) - x1 : 0;
    if (!(pitch > 0)) return;

    /*
     * SPREAD. box-grid names a BAND (data-span-x + data-span-w) and however many
     * innings there are divide it into equal CELLS, each column centred in its
     * own — so the columns always fill their pane and everything downstream (an
     * R column, a pane rule, a caption) can be authored at a fixed x that no
     * game length can collide with — which is what a RULED table needs: under
     * the sliding layout below, the numbers drift inside a fixed frame and the
     * R column walks away from its own rule. This is the default package's
     * Large board.
     *
     * CELLS, not endpoints. Pinning the first and last column to the band's
     * edges is the obvious reading and it is wrong: at five innings the outer
     * numbers hug the walls while the inner gaps stretch to take up the slack,
     * so the run reads as four gaps rather than five columns — and under a ruled
     * table it would put the outer cells half outside the box. Dividing the band
     * and centring each column in its share is what a table does.
     *
     * The cost is honest and bounded: a five-inning game's cells are wider than
     * a nine's by exactly 9/5, and nothing else changes.
     */
    const spanX = grid ? parseFloat(grid.getAttribute('data-span-x')) : NaN;
    const spanW = grid ? parseFloat(grid.getAttribute('data-span-w')) : NaN;
    if (Number.isFinite(spanX) && Number.isFinite(spanW)) {
      const n = Math.max(shown, 1);
      const cell = spanW / n;
      for (let i = 1; i <= MAX_INN; i++) {
        // Only the active columns move; a hidden one keeps its authored x, which
        // is where it will be wanted again the moment a longer game arrives.
        const dx = i <= n ? (spanX + cell * (i - 0.5)) - (x1 + (i - 1) * pitch) : 0;
        // box-h-{i} rides inside box-col-{i}; translating both would move it twice.
        for (const nm of [`box-col-${i}`, `box-away-${i}`, `box-home-${i}`]) {
          const el = engine.slots[nm];
          if (el) el.setAttribute('transform', `translate(${dx},0)`);
        }
      }
      return;
    }

    /*
     * SLIDE (the Large board). box-total closes onto the last real inning, and
     * box-grid pushes back half of what was closed so the block keeps the centre
     * the theme composed it on. A theme with only box-total gets a left-anchored
     * table whose R column simply follows the innings in.
     */
    const slack = (MAX_INN - Math.max(shown, 1)) * pitch;
    if (total) total.setAttribute('transform', `translate(${-slack},0)`);
    if (grid) grid.setAttribute('transform', `translate(${slack / 2},0)`);
  }

  /*
   * The two ways a scoreboard ends up with no players, kept apart because the
   * producer does something different about each:
   *
   *   nothing under score.N   → this board isn't being fed a game at all. Check
   *                             the board's binding, or that a game is running.
   *   fed, but no names       → Project Rio is reporting a roster without
   *                             players. In practice a stale decoded.hud.json:
   *                             teams/innings/scores come off the roster, so the
   *                             board looks full while `*_player` is still null.
   */
  function blankReason(state) {
    const board = g(state, `score.${SB}`, null);
    if (!board || !Object.keys(board).length) {
      return `Scoreboard ${SB} has no game — check its binding, or that a game is running.`;
    }
    return `Scoreboard ${SB} has no player names yet — Project Rio hasn't reported who is playing (a stale HUD file looks like this).`;
  }

  // ── main update ─────────────────────────────────────────────────────────────
  async function update(state, settings) {
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    // The package's port palette rides along with its SVG: applyColours reads
    // it synchronously, so it has to have landed by the time this returns.
    const [themeChanged] = await Promise.all([engine.ensureTheme(theme), ensurePortPalette(theme)]);
    if (themeChanged) { revealKey = ''; laidOut = {}; animShown = {}; clipProxy = {}; centerEls = null; logoShown = {}; }
    if (disposed) return;

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE, NS);
    else OverlayBase.clearDesignSettings();

    const p1 = g(state, `score.${SB}.player.1.rioName`, '');
    const p2 = g(state, `score.${SB}.player.2.rioName`, '');
    const hasGame = !!(p1 || p2);
    host.style.display = hasGame ? '' : 'none';
    // Say WHY, or a blank source is indistinguishable from a broken one. The
    // player names are the gate rather than the score because Project Rio fills
    // teams, innings and scores from the roster before it knows who is playing
    // — so a board can look fully populated and still have nobody in it, which
    // is exactly the case that reads as "the overlay is broken".
    OverlayBase.setBlank(
      hasGame ? null : blankReason(state), `Scoreboard ${SB}`,
    );
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
      // What the game was SET to, as against what it played — the pair is what
      // makes an extra inning visible in the linescore (bindBox).
      inningsSelected: parseInt(g(state, `score.${SB}.innings_selected`, 0)) || 0,
      // Written by BOTH feeds now, so it is read outside the completed cluster —
      // through RioData, which is where a producer's mode OVERRIDE outranks the
      // game record (rio-data.js gameMode). Reading the state key directly is how
      // this ignored the override.
      gameMode: (window.RioData ? RioData.gameMode(state, SB) : g(state, `score.${SB}.game_mode`, '')) || '',
    };

    applyColours(settings, g(state, `score.${SB}.player.1.port`, null), g(state, `score.${SB}.player.2.port`, null));

    bindTop(d, vis, themeChanged);
    bindLive(d, state, vis);
    bindGameMode(d, vis);
    const hasFinalContent = bindFinal(state, d);
    const rosterCount = bindRoster(state);
    const hasBox = bindBox(d);
    bindImageProbe(engine, () => disposed, 'logo', vis.showLogo ? OverlayBase.brandingLogoUrl() : '', 'logo-default');

    // Live cluster: only during play, and only if the producer master is on.
    // A NEW key (not an overwrite of vis.showLive) — the row-stack predicate
    // needs this derived "show right now" value, but vis.showLive is still the
    // raw producer toggle other callers may read.
    vis.showLiveSeg = !isFinal && vis.showLive;
    // Inning segment: the inning number during play (producer toggle), swapping
    // to the final-badge on a completed game (bindTop drives which child shows).
    // Scoreboard S only — the Large board draws its inning inside row-top, which
    // is why the switch is gated to `s` in designConstants.js.
    //
    // The live cluster IMPLIES it. In a melding theme the live segment sits
    // outboard of the inning (row-live's data-cardw is the wider one), so live-on
    // with inning-off grew the card past the inning's position and left a hole in
    // the middle of it — an empty column no producer asked for. The inning is
    // also the thing the count is a count *within*: a board showing 2-1, two out
    // and no inning is less legible than either segment alone.
    vis.showInningSeg = isFinal || vis.showInning || vis.showLiveSeg;
    vis.showFinal = isFinal && isCompleted && hasFinalContent;
    // A band, not a captain portrait: two or more characters on a side is the
    // bar. Completed games now carry the real roster (away_roster/home_roster),
    // so the CONTENT half is only ever false for a record that genuinely has
    // none. ANDed with the producer switch, and under a NEW key — vis.showRoster
    // is the raw toggle other callers may read, the same split showLiveSeg makes
    // against showLive.
    vis.showRosterRow = vis.showRoster && rosterCount >= 2;
    // The game-mode BAND, which only Scoreboard S has (row-mode, a vertical meld
    // that grows the card) — hence the switch's `sizes: ['s']`. Gated on the
    // CONTENT as well as the toggle: an unknown mode is a cold cache or a game
    // outside any tag set, and a band that grew the card to say nothing is worse
    // than no band. The Large board places the slot INLINE, in the linescore's
    // meta pane, where it costs no height and so has nothing to toggle.
    vis.showGameModeSeg = vis.showGameMode && !!d.gameMode;
    // Same shape as showRosterRow: producer switch AND content, under a new key.
    vis.showBoxRow = vis.showBox && hasBox;

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

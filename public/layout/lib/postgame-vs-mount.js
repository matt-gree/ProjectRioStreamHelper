// postgame-vs-mount.js — full-screen post-game GAME SUMMARY element
// (player vs. player).
//
// A fed element, sibling of the single-character Stat Callout
// (postgame-callout-mount.js): the producer pushes a captured game onto the
// shared Callout Stage; this mount renders BOTH sides at once — captain hero
// art left/right with the team logo dimmed large behind, the match context
// (tournament · event · round · format) top-center, and the side-vs-side game
// totals (runs / hits / homeruns / stars won / strikeouts pitched) unfolding
// out of the center line.
//
//   const m = mountPostgameVs({ host });
//   m.update(OverlayBase.state, { scoreboard });
//   m.replay();   // re-run the reveal (e.g. OBS source made active)
//   m.dispose();
//
// Data: postgame.{N}.player.{T}.totals + .teamName (server capture),
// score.{N}.phase/best_of/player.{T}.series_wins (match projection) and
// tournamentInfo.* for the top strip.
//
// THEME CONTRACT (extends callout.svg): the backdrop SVG still comes from the
// active design package (/design/{pkg}/callout.svg) and recolors through
// --port-color / --port-2. A package may additionally DECLARE its fixed side
// palette on the SVG root (--side1 / --side2 / --well / --accent-neutral —
// slice26 does); this mount reads those via getComputedStyle and keys every
// rail, glass well and numeral to them. Without them it falls back to the
// live controller-port colours, so the element works on every package.

import { ensureGsap } from './gsap-loader.js';

const REF_W = 1920, REF_H = 1080;
// Port-colour knobs are shared with the Stat Callout — one set of overrides
// recolors both callout elements.
const SETTINGS_TYPE = 'postgamecallout';
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
const NEUTRAL_ACCENT = '#f59e0b';

let _cssInjected = false;

// Captain artwork (tall 2D poses) is the hero; the 3D character render is the
// onerror fallback for any id the captains/ pack is missing.
function captainArtUrl(name) {
  const id = OverlayBase.charId(name);
  return id === undefined ? '' : `${OverlayBase.BASE_URL}/game_assets/msb/captains/${id}.png`;
}
function charArtUrl(name) {
  const id = OverlayBase.charId(name);
  return id === undefined ? '' : `${OverlayBase.BASE_URL}/game_assets/msb/characters/${id}.png`;
}
// rio-data.js loads before this module (see callout-stage.html); the
// window.RioData guard just matches the other mounts' defensive style.
function teamLogoUrl(teamName) { return teamName && window.RioData ? RioData.teamLogoUrl(teamName) : ''; }

// ── styles (scoped under .pv-root) ──────────────────────────────────────────
// Slice26 "maximal" vocabulary rendered in HTML: one big translucent data well
// for the shared numbers, port-glass identity plates with solid outer rails,
// white-glass micro-wells, Inter display + mono tabular numerals.
const CSS = `
.pv-root { position: absolute; inset: 0; overflow: hidden; font-family: var(--pv-font, 'Inter', sans-serif); }
.pv-stage {
  position: absolute; top: 0; left: 0; width: ${REF_W}px; height: ${REF_H}px;
  transform-origin: top left; color: #fff;
  --s1: #c5f707; --s1-rgb: 197, 247, 7;
  --s2: #57e0e7; --s2-rgb: 87, 224, 231;
  --well: rgba(255, 255, 255, 0.08);
  --accent: #f93f91; --accent-rgb: 249, 63, 145;
  --mono: 'Chivo Mono', ui-monospace, 'SF Mono', monospace;
}
.pv-backdrop { position: absolute; inset: 0; clip-path: inset(0% 50% 0% 50%); }
.pv-theme-svg, .pv-theme-svg svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pv-vignette { position: absolute; inset: 0; box-shadow: inset 0 0 300px rgba(0,0,0,0.55); pointer-events: none; }

/* ── captain heroes + ghosted team logos ──
   Stacking: logo (1) < hero (2) < every data surface (3), so captains can
   never block the board and the logo always reads as backdrop texture. The
   hero box stays inside the theme's rim frame (44px+ inset all around). */
.pv-hero {
  position: absolute; bottom: 130px; width: 520px; height: 760px;
  display: flex; align-items: flex-end; justify-content: center;
  filter: drop-shadow(0 24px 44px rgba(0,0,0,0.65)); z-index: 2;
}
.pv-hero.s1 { left: 84px; }
.pv-hero.s2 { right: 84px; }
.pv-hero img { max-width: 100%; max-height: 100%; object-fit: contain; object-position: bottom; }
.pv-hero .bloom {
  position: absolute; bottom: 70px; width: 500px; height: 500px; border-radius: 50%;
  filter: blur(22px); z-index: -1;
}
.pv-hero.s1 .bloom { background: radial-gradient(circle, rgba(var(--s1-rgb), 0.5) 0%, transparent 62%); }
.pv-hero.s2 .bloom { background: radial-gradient(circle, rgba(var(--s2-rgb), 0.5) 0%, transparent 62%); }
/* Big dimmed team logo behind the captain — centered on the art so wide
   (short-rendering) captains don't leave it floating overhead. The clip
   container hugs the theme frame's inner edge so logos never paint over the
   rim: they clip against it instead. */
.pv-logo-clip {
  position: absolute; inset: 30px; overflow: hidden; border-radius: 26px;
  z-index: 1; pointer-events: none;
}
.pv-logo {
  position: absolute; top: 220px; width: 700px; height: 700px;
  display: flex; align-items: center; justify-content: center;
}
.pv-logo.s1 { left: -36px; }
.pv-logo.s2 { right: -36px; }
.pv-logo img {
  width: 100%; height: 100%; object-fit: contain; opacity: 0.16;
  filter: blur(1px) saturate(0.85);
}

/* ── identity plates (port glass + outer rail), top corners ── */
.pv-plate { position: absolute; top: 96px; max-width: 520px; z-index: 3; }
.pv-plate.s1 { left: 76px; }
.pv-plate.s2 { right: 76px; text-align: right; }
.pv-plate .card {
  position: relative; display: inline-block; padding: 18px 30px; border-radius: 13px;
  border: 1.5px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.pv-plate.s1 .card { background: rgba(var(--s1-rgb), 0.20); padding-left: 40px; }
.pv-plate.s2 .card { background: rgba(var(--s2-rgb), 0.25); padding-right: 40px; }
.pv-plate .rail { position: absolute; top: 8px; bottom: 8px; width: 6px; border-radius: 3px; }
.pv-plate.s1 .rail { left: 12px; background: var(--s1); transform-origin: center top; }
.pv-plate.s2 .rail { right: 12px; background: var(--s2); transform-origin: center top; }
.pv-plate .rio { font-size: 52px; font-weight: 900; line-height: 1; letter-spacing: -0.5px; text-shadow: 0 3px 18px rgba(0,0,0,0.55); white-space: nowrap; }
.pv-plate .team { margin-top: 7px; font-size: 19px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: rgba(255,255,255,0.72); white-space: nowrap; }
.pv-plate.s1 .team { color: rgba(var(--s1-rgb), 0.95); }
.pv-plate.s2 .team { color: rgba(var(--s2-rgb), 0.95); }
.pv-plate .winner {
  display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; padding: 7px 20px;
  border-radius: 999px; background: var(--accent); color: #fff;
  font-size: 21px; font-weight: 800; letter-spacing: 2.5px; text-transform: uppercase;
  box-shadow: 0 0 26px rgba(var(--accent-rgb), 0.55);
}

/* ── match context, top center ── */
.pv-match { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); width: 700px; text-align: center; z-index: 3; }
.pv-match .card {
  position: relative; padding: 20px 34px 22px; border-radius: 16px;
  background: var(--well); border: 1.5px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.pv-match .tourney { font-size: 19px; font-weight: 700; letter-spacing: 3.5px; text-transform: uppercase; color: rgba(255,255,255,0.66); }
.pv-match .round { margin-top: 6px; font-size: 40px; font-weight: 900; line-height: 1.05; letter-spacing: -0.3px; }
.pv-match .series { margin-top: 12px; display: flex; align-items: center; justify-content: center; }
.pv-match .bo {
  padding: 4px 14px; border-radius: 7px; background: rgba(255,255,255,0.12);
  font-size: 16px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
}

/* ── the center data well ── */
/* border-box so the -480px margin truly centers it, and hidden
   until the reveal grows it in (GSAP owns opacity/scaleX). */
.pv-board {
  position: absolute; left: 50%; top: 268px; width: 960px; margin-left: -480px;
  box-sizing: border-box; opacity: 0; z-index: 3;
  border-radius: 18px; background: var(--well);
  border: 1.5px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14), 0 18px 60px rgba(0,0,0,0.45),
              0 0 44px rgba(var(--accent-rgb), 0.22);
  transform-origin: center center; overflow: hidden;
  padding: 30px 42px 26px;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
/* Moving trail-gradient rim: the spine's gradient lives on as the card edge
   (shared by the data well, the linescore band and the match card). */
.pv-board::before, .pv-line::before, .pv-match .card::before {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 2.5px;
  background: linear-gradient(90deg, var(--s1), var(--accent), var(--s2), var(--accent), var(--s1));
  background-size: 300% 100%;
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: pv-rim 7s linear infinite;
  opacity: 0.85; pointer-events: none;
}
@keyframes pv-rim { to { background-position: -300% 0; } }
.pv-board .inner { display: flex; flex-direction: column; }

/* hero RUNS row */
.pv-runs { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 2px 0 16px; }
.pv-runs .v {
  font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 128px; font-weight: 800; line-height: 0.9; text-shadow: 0 4px 26px rgba(0,0,0,0.5);
}
.pv-runs .v.s1 { color: var(--s1); text-align: left; }
.pv-runs .v.s2 { color: var(--s2); text-align: right; }
.pv-runs .tag { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 0 30px; }
.pv-runs .final {
  padding: 6px 22px; border-radius: 999px; background: var(--accent); color: #fff;
  font-size: 22px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase;
  box-shadow: 0 0 24px rgba(var(--accent-rgb), 0.5);
}
.pv-runs .meta {
  font-size: 15px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
  color: rgba(255,255,255,0.55); white-space: nowrap;
}
.pv-runs .meta .dot { color: var(--accent); padding: 0 7px; }

/* stat rows: value · outward bar · center label pill · outward bar · value */
.pv-rows { display: flex; flex-direction: column; }
.pv-row { display: grid; grid-template-columns: 96px 1fr 254px 1fr 96px; align-items: center; column-gap: 16px; padding: 15px 0; position: relative; }
.pv-row + .pv-row::before {
  content: ''; position: absolute; top: 0; left: 6px; right: 6px; height: 1.5px;
  background: rgba(255,255,255,0.10);
}
.pv-row .v {
  font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 52px; font-weight: 700; line-height: 1;
}
.pv-row .v.s1 { text-align: left; }
.pv-row .v.s2 { text-align: right; }
.pv-row .v.lead.s1 { color: var(--s1); }
.pv-row .v.lead.s2 { color: var(--s2); }
.pv-row .label {
  padding: 9px 8px; border-radius: 9px; background: rgba(255,255,255,0.10);
  border: 1px solid rgba(255,255,255,0.14); text-align: center;
  font-size: 15.5px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase;
  color: rgba(255,255,255,0.92); white-space: nowrap;
}
.pv-row .track { position: relative; height: 11px; border-radius: 5.5px; background: rgba(255,255,255,0.10); overflow: hidden; }
.pv-row .fill { position: absolute; inset: 0; border-radius: 5.5px; transform: scaleX(0); }
.pv-row .track.s1 .fill { transform-origin: right center; background: linear-gradient(270deg, rgba(var(--s1-rgb),0.95), rgba(var(--s1-rgb),0.35)); }
.pv-row .track.s2 .fill { transform-origin: left center; background: linear-gradient(90deg, rgba(var(--s2-rgb),0.95), rgba(var(--s2-rgb),0.35)); }

/* ── per-inning linescore, bottom center ──
   Sized to the innings actually played (5 on mercy, 10+ on extras); the grid
   template is computed inline per game. Vertically it splits the gap between
   the data well's bottom edge (~y785) and the theme frame (~y1052) evenly. */
.pv-line {
  position: absolute; left: 0; right: 0; bottom: 76px; margin: 0 auto;
  width: fit-content; z-index: 3; box-sizing: border-box;
  border-radius: 18px; background: var(--well);
  border: 1.5px solid rgba(255,255,255,0.18);
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14), 0 12px 40px rgba(0,0,0,0.4),
              0 0 44px rgba(var(--accent-rgb), 0.22);
  padding: 22px 38px 24px;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.pv-line .lgrid { display: grid; align-items: center; row-gap: 9px; }
.pv-line .c { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: center; }
.pv-line .c.hd { font-size: 16px; font-weight: 700; letter-spacing: 1px; color: rgba(255,255,255,0.5); }
.pv-line .c.v { font-size: 33px; font-weight: 700; color: rgba(255,255,255,0.92); }
.pv-line .c.v.zero { color: rgba(255,255,255,0.38); }
.pv-line .c.v.x { font-size: 25px; color: rgba(255,255,255,0.35); }
.pv-line .c.tot { font-size: 36px; font-weight: 800; }
.pv-line .c.tot.r.s1 { color: var(--s1); }
.pv-line .c.tot.r.s2 { color: var(--s2); }
.pv-line .c.tot.h { color: rgba(255,255,255,0.8); font-weight: 700; font-size: 33px; }
.pv-line .name {
  text-align: left; padding-right: 30px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 290px;
  font-size: 21px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;
}
.pv-line .name.s1 { color: var(--s1); }
.pv-line .name.s2 { color: var(--s2); }
.pv-line .rule { width: 1.5px; height: 44px; margin: 0 auto; background: rgba(255,255,255,0.16); }
.pv-line .rule.hd { height: 17px; }
`;

function injectCss() {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'postgame-vs-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

// Same last-resort backdrop contract as the Stat Callout (see
// postgame-callout-mount.js / public/design/README.md).
function builtinThemeSvg() {
  return `
  <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="pvA" cx="12%" cy="20%" r="80%">
        <stop offset="0" style="stop-color:var(--port-color);stop-opacity:0.38"/>
        <stop offset="0.62" style="stop-color:var(--port-color);stop-opacity:0"/>
      </radialGradient>
      <radialGradient id="pvB" cx="88%" cy="80%" r="80%">
        <stop offset="0" style="stop-color:var(--port-2);stop-opacity:0.30"/>
        <stop offset="0.62" style="stop-color:var(--port-2);stop-opacity:0"/>
      </radialGradient>
    </defs>
    <rect width="1920" height="1080" fill="#0b0d14"/>
    <rect width="1920" height="1080" fill="url(#pvA)"/>
    <rect width="1920" height="1080" fill="url(#pvB)"/>
    <rect x="0" y="0" width="1920" height="10" style="fill:var(--port-color)" opacity="0.9"/>
    <rect x="0" y="1070" width="1920" height="10" style="fill:var(--port-2)" opacity="0.7"/>
  </svg>`;
}

// The five summary stats, in display order. Runs renders as the oversized
// hero row; the rest as compare rows.
const ROWS = [
  ['hits', 'Hits'],
  ['homeruns', 'Home Runs'],
  ['stars_won', 'Stars Won'],
  ['strikeouts_pitched', 'Strikeouts Pitched'],
];

// Aggregate fallback for captures made before totals existed server-side:
// sum the per-character box score (stars can't be reconstructed client-side).
function fallbackTotals(sideData) {
  const chars = Array.isArray(sideData?.characters) ? sideData.characters : [];
  const sum = (pick) => chars.reduce((a, c) => a + (Number(pick(c)) || 0), 0);
  return {
    runs: Number(sideData?.score) || 0,
    hits: sum(c => c?.batting?.hits),
    homeruns: sum(c => c?.batting?.homeruns),
    stars_won: 0,
    strikeouts_pitched: sum(c => c?.pitching?.strikeouts_pitched),
  };
}

export function mountPostgameVs({ host }) {
  injectCss();

  const root = document.createElement('div');
  root.className = 'pv-root';
  const stage = document.createElement('div');
  stage.className = 'pv-stage';
  root.appendChild(stage);
  host.appendChild(root);
  root.style.display = 'none';

  let tl = null;
  let prevKey = '';
  let themeCache = {}; // pkg -> svg string

  function autoScale() {
    if (OverlayBase.PREVIEW_MODE) { stage.style.transform = `scale(${Math.min(host.clientWidth / REF_W, host.clientHeight / REF_H) || 1})`; return; }
    const scale = Math.min(window.innerWidth / REF_W, window.innerHeight / REF_H) || 1;
    stage.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', autoScale);
  autoScale();

  function portColor(port) {
    const { deepGet: g, settings } = OverlayBase;
    const idx = Number.isInteger(port) ? port : -1;
    const override = idx >= 0 ? g(settings, `overlays.${SETTINGS_TYPE}.port${idx}Color`, null) : null;
    if (override) return override;
    if (idx >= 0 && idx < PORT_COLORS.length) return PORT_COLORS[idx];
    return g(settings, 'overlays.global.accentColor', NEUTRAL_ACCENT);
  }

  async function fetchThemeSvg(pkg) {
    const r = await fetch(`${OverlayBase.BASE_URL}/design/${encodeURIComponent(pkg)}/callout.svg`);
    return r.ok ? await r.text() : null;
  }
  async function loadTheme(pkg) {
    if (themeCache[pkg] != null) return themeCache[pkg];
    let svg;
    try {
      svg = await fetchThemeSvg(pkg);
      if (svg == null && pkg !== 'default') svg = await fetchThemeSvg('default');
    } catch { svg = null; }
    themeCache[pkg] = svg != null ? svg : builtinThemeSvg();
    return themeCache[pkg];
  }

  // Resolve the side palette: theme-declared fixed colours win (slice26 pins
  // lime/cyan/plum on its callout.svg root), else live port colours.
  function resolvePalette(ctx) {
    const svgEl = stage.querySelector('.pv-theme-svg svg');
    const read = (name) => {
      if (!svgEl) return '';
      return (getComputedStyle(svgEl).getPropertyValue(name) || '').trim();
    };
    const s1 = read('--side1') || portColor(ctx.port1);
    const s2 = read('--side2') || portColor(ctx.port2);
    const well = read('--well');
    const accent = read('--accent-neutral')
      || OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.accentColor', null)
      || '#f93f91';
    stage.style.setProperty('--s1', s1);
    stage.style.setProperty('--s1-rgb', hexToRgbStr(s1, '197, 247, 7'));
    stage.style.setProperty('--s2', s2);
    stage.style.setProperty('--s2-rgb', hexToRgbStr(s2, '87, 224, 231'));
    if (well) stage.style.setProperty('--well', well);
    stage.style.setProperty('--accent', accent);
    stage.style.setProperty('--accent-rgb', hexToRgbStr(accent, '249, 63, 145'));
    // The backdrop's own blooms follow the sides.
    stage.style.setProperty('--port-color', s1);
    stage.style.setProperty('--port-2', s2);
  }

  function sidePlate(side, p, winnerSide) {
    const cls = side === 1 ? 's1' : 's2';
    const isWin = winnerSide === side;
    return `
      <div class="pv-plate ${cls}">
        <div class="card">
          <div class="rail"></div>
          <div class="rio">${escapeHtml(p?.rioName || `Player ${side}`)}</div>
          ${p?.teamName ? `<div class="team">${escapeHtml(p.teamName)}</div>` : ''}
        </div>
        ${isWin ? '<div><span class="winner">Winner</span></div>' : ''}
      </div>`;
  }

  function sideLogo(side, p) {
    const cls = side === 1 ? 's1' : 's2';
    const logo = p?.teamName ? teamLogoUrl(p.teamName) : '';
    return `<div class="pv-logo ${cls}">${logo ? `<img src="${logo}" onerror="this.style.display='none'" alt="" />` : ''}</div>`;
  }

  function sideHero(side, p) {
    const cls = side === 1 ? 's1' : 's2';
    const art = captainArtUrl(p?.captain);
    const fallback = charArtUrl(p?.captain);
    return `
      <div class="pv-hero ${cls}">
        <div class="bloom"></div>
        ${art ? `<img src="${art}" data-fb="${fallback}"
          onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb='';}else{this.style.opacity=0;}" alt="" />` : ''}
      </div>`;
  }

  // Single-game card: no series record here — just tournament/round context
  // and the format pill.
  function matchStrip(ctx) {
    const bits = [ctx.tournament, ctx.eventName].filter(Boolean);
    return `
      <div class="pv-match">
        <div class="card">
          ${bits.length ? `<div class="tourney">${escapeHtml(bits.join(' · '))}</div>` : ''}
          <div class="round">${escapeHtml(ctx.round || 'Game Summary')}</div>
          ${ctx.bestOf ? `<div class="series"><span class="bo">Best of ${escapeHtml(String(ctx.bestOf))}</span></div>` : ''}
        </div>
      </div>`;
  }

  // Per-inning linescore band. Column count follows the innings actually
  // played — a 5-inning mercy renders 5 tight columns, extras add more
  // (narrowing slightly so long games still fit between the heroes).
  // null = half not played → the broadcast "X" cell.
  function linescoreBand(ctx) {
    const l1 = Array.isArray(ctx.linescore?.['1']) ? ctx.linescore['1'] : [];
    const l2 = Array.isArray(ctx.linescore?.['2']) ? ctx.linescore['2'] : [];
    const n = Math.max(l1.length, l2.length);
    if (!n) return '';
    const colW = n <= 9 ? 62 : n <= 11 ? 53 : 45;
    const cols = `minmax(140px, auto) repeat(${n}, ${colW}px) 30px 70px 70px`;
    const cell = (v, col, cls = '') => {
      if (v == null) return `<div class="c v x ${cls}" data-col="${col}">X</div>`;
      const z = Number(v) === 0 ? 'zero' : '';
      return `<div class="c v ${z} ${cls}" data-col="${col}">${Number(v) || 0}</div>`;
    };
    const row = (side, list, p, t) => {
      const s = `s${side}`;
      return `
        <div class="name ${s}" data-col="0">${escapeHtml(p?.rioName || `Player ${side}`)}</div>
        ${Array.from({ length: n }, (_, i) => cell(i < list.length ? list[i] : 0, i + 1)).join('')}
        <div class="rule" data-col="${n + 1}"></div>
        <div class="c tot r ${s}" data-col="${n + 2}">${Number(t.runs) || 0}</div>
        <div class="c tot h" data-col="${n + 3}">${Number(t.hits) || 0}</div>`;
    };
    return `
      <div class="pv-line"><div class="lgrid" style="grid-template-columns: ${cols};">
        <div class="c hd" data-col="0"></div>
        ${Array.from({ length: n }, (_, i) => `<div class="c hd" data-col="${i + 1}">${i + 1}</div>`).join('')}
        <div class="rule hd" data-col="${n + 1}"></div>
        <div class="c hd" data-col="${n + 2}">R</div>
        <div class="c hd" data-col="${n + 3}">H</div>
        ${row(1, l1, ctx.p1, ctx.t1)}
        ${row(2, l2, ctx.p2, ctx.t2)}
      </div></div>`;
  }

  // Stadium · innings, tucked under the FINAL pill.
  function gameMetaLine(meta) {
    const bits = [];
    if (meta?.stadium) bits.push(escapeHtml(prettyStadium(meta.stadium)));
    if (meta?.inningsPlayed) bits.push(`${Number(meta.inningsPlayed)} Inn`);
    if (meta?.isMercy) bits.push('Mercy');
    if (!bits.length) return '';
    return `<span class="meta">${bits.join('<span class="dot">●</span>')}</span>`;
  }

  function statRows(t1, t2) {
    return ROWS.map(([key, label]) => {
      const v1 = Number(t1[key]) || 0;
      const v2 = Number(t2[key]) || 0;
      const max = Math.max(v1, v2, 1);
      const p1 = v1 > 0 ? Math.max(v1 / max, 0.05) : 0;
      const p2 = v2 > 0 ? Math.max(v2 / max, 0.05) : 0;
      return `
        <div class="pv-row">
          <div class="v s1 ${v1 > v2 ? 'lead' : ''}" data-count="${v1}">0</div>
          <div class="track s1"><div class="fill" data-pct="${p1}"></div></div>
          <div class="label">${escapeHtml(label)}</div>
          <div class="track s2"><div class="fill" data-pct="${p2}"></div></div>
          <div class="v s2 ${v2 > v1 ? 'lead' : ''}" data-count="${v2}">0</div>
        </div>`;
    }).join('');
  }

  function buildDom(ctx) {
    stage.innerHTML = `
      <div class="pv-backdrop">
        <div class="pv-theme-svg">${ctx.themeSvg}</div>
        <div class="pv-vignette"></div>
      </div>
      <div class="pv-logo-clip">
        ${sideLogo(1, ctx.p1)}
        ${sideLogo(2, ctx.p2)}
      </div>
      ${sideHero(1, ctx.p1)}
      ${sideHero(2, ctx.p2)}
      ${sidePlate(1, ctx.p1, ctx.winnerSide)}
      ${sidePlate(2, ctx.p2, ctx.winnerSide)}
      ${matchStrip(ctx)}
      <div class="pv-board"><div class="inner">
        <div class="pv-runs">
          <div class="v s1" data-count="${Number(ctx.t1.runs) || 0}">0</div>
          <div class="tag"><span class="final">Final</span>${gameMetaLine(ctx.meta)}</div>
          <div class="v s2" data-count="${Number(ctx.t2.runs) || 0}">0</div>
        </div>
        <div class="pv-rows">${statRows(ctx.t1, ctx.t2)}</div>
      </div></div>
      ${linescoreBand(ctx)}`;
    resolvePalette(ctx);

    const font = OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.fontFamily', 'Inter');
    root.style.setProperty('--pv-font', `'${font}', sans-serif`);
  }

  function snapVisible() {
    stage.querySelectorAll('.pv-backdrop').forEach(e => e.style.clipPath = 'inset(0% 0% 0% 0%)');
    stage.querySelectorAll('.pv-row .fill').forEach(e => e.style.transform = `scaleX(${e.getAttribute('data-pct')})`);
    stage.querySelectorAll('[data-count]').forEach(e => e.textContent = String(Math.round(Number(e.getAttribute('data-count')) || 0)));
    const board = stage.querySelector('.pv-board');
    board.style.opacity = '1';
    board.style.transform = 'none';
  }

  function runTimeline(gsap) {
    if (tl) { tl.kill(); tl = null; }
    if (!gsap) { snapVisible(); return; }

    const q = (s) => stage.querySelector(s);
    const qa = (s) => stage.querySelectorAll(s);
    const t = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl = t;

    // 1 · the stage opens from the center line.
    t.fromTo(q('.pv-backdrop'),
      { clipPath: 'inset(0% 50% 0% 50%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'power4.inOut' });

    // 2 · captains stride in from their edges, logos ghost up behind them.
    t.fromTo(q('.pv-hero.s1'), { x: -240, autoAlpha: 0, scale: 1.05 },
      { x: 0, autoAlpha: 1, scale: 1, duration: 0.75, ease: 'power2.out' }, '-=0.35');
    t.fromTo(q('.pv-hero.s2'), { x: 240, autoAlpha: 0, scale: 1.05 },
      { x: 0, autoAlpha: 1, scale: 1, duration: 0.75, ease: 'power2.out' }, '<');
    qa('.pv-logo img').forEach((el, i) => {
      t.fromTo(el, { autoAlpha: 0, scale: 1.25, rotate: i === 0 ? -6 : 6 },
        { autoAlpha: 0.16, scale: 1, rotate: 0, duration: 1.1, ease: 'power2.out' }, '<');
    });

    // 3 · identity plates: rail wipes, name rises.
    qa('.pv-plate').forEach((plate, i) => {
      const dir = i === 0 ? -50 : 50;
      t.fromTo(plate.querySelector('.card'), { x: dir, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: 0.5 }, i === 0 ? '-=0.55' : '<+=0.08');
      t.fromTo(plate.querySelector('.rail'), { scaleY: 0 }, { scaleY: 1, duration: 0.4 }, '<+=0.1');
    });

    // 4 · match context drops in.
    t.fromTo(q('.pv-match'), { y: -46, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.55 }, '-=0.4');

    // 5 · the data well unfolds — flaring bright and settling into the
    // resting rim glow.
    const accentRgb = getComputedStyle(stage).getPropertyValue('--accent-rgb').trim() || '249, 63, 145';
    t.fromTo(q('.pv-board'), { scaleX: 0, autoAlpha: 0 },
      { scaleX: 1, autoAlpha: 1, duration: 0.55, ease: 'power4.out' }, '-=0.25');
    t.fromTo(q('.pv-board'),
      { boxShadow: `inset 0 2px 0 rgba(255,255,255,0.14), 0 18px 60px rgba(0,0,0,0.45), 0 0 130px rgba(${accentRgb}, 0.9)` },
      { boxShadow: `inset 0 2px 0 rgba(255,255,255,0.14), 0 18px 60px rgba(0,0,0,0.45), 0 0 44px rgba(${accentRgb}, 0.22)`,
        duration: 1.1, ease: 'power2.out' }, '<');
    t.fromTo(q('.pv-board .inner'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, '-=0.35');

    // 6 · hero runs count up; rows bloom outward from the center pills.
    qa('.pv-runs .v').forEach((el, i) => countUp(gsap, t, el, i === 0 ? '-=0.15' : '<'));
    qa('.pv-row').forEach((row, i) => {
      const pos = i === 0 ? '-=0.3' : '<+=0.11';
      t.fromTo(row.querySelector('.label'), { scale: 0.55, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.8)' }, pos);
      row.querySelectorAll('.fill').forEach(f => {
        t.fromTo(f, { scaleX: 0 }, { scaleX: Number(f.getAttribute('data-pct')) || 0, duration: 0.55 }, '<');
      });
      row.querySelectorAll('.v').forEach(v => countUp(gsap, t, v, '<'));
    });

    // 7 · the linescore fills in, column by column.
    const band = q('.pv-line');
    if (band) {
      t.fromTo(band, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.45 }, '-=0.1');
      const cells = Array.from(qa('.pv-line [data-col]'));
      cells.sort((a, b) => (+a.dataset.col) - (+b.dataset.col)); // stable: rows keep order per column
      t.fromTo(cells, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, stagger: 0.022 }, '<+=0.12');
    }

    // 8 · the winner beat.
    const winner = q('.pv-plate .winner');
    if (winner) {
      t.fromTo(winner, { scale: 0, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(2.2)' }, '-=0.1');
      t.fromTo(winner, { boxShadow: '0 0 60px rgba(var(--accent-rgb), 0.9)' },
        { boxShadow: '0 0 26px rgba(var(--accent-rgb), 0.55)', duration: 0.7, ease: 'power2.out' }, '<+=0.15');
    }
  }

  function countUp(gsap, t, el, pos) {
    if (!el) return;
    const target = Number(el.getAttribute('data-count')) || 0;
    const proxy = { v: 0 };
    t.to(proxy, {
      v: target, duration: 0.7, ease: 'power1.out',
      onUpdate: () => { el.textContent = String(Math.round(proxy.v)); },
    }, pos);
  }

  // sel = { scoreboard }
  async function update(state, sel) {
    const g = OverlayBase.deepGet;
    const sb = Number(sel?.scoreboard) || 1;

    const present = g(state, `postgame.${sb}.present`, false);
    const p1 = g(state, `postgame.${sb}.player.1`, null);
    const p2 = g(state, `postgame.${sb}.player.2`, null);

    if (!present || !p1 || !p2) {
      root.style.display = 'none';
      if (tl) { tl.kill(); tl = null; }
      prevKey = '';
      // Blank until a game is captured and both sides resolve — say which, or
      // the empty source reads as broken in the preview.
      OverlayBase.setBlank(
        !present ? 'No captured game on this board — capture a game, then push the game summary from Production.'
          : 'Captured game is missing a side — both players need to resolve.',
        'Game Summary',
      );
      return;
    }
    OverlayBase.setBlank(null, 'Game Summary');

    const gameId = g(state, `postgame.${sb}.gameId`, '');
    const capturedAt = g(state, `postgame.${sb}.capturedAt`, '');
    const key = `${sb}:${gameId}:${capturedAt}`;
    if (key === prevKey && root.style.display !== 'none') return; // no churn on unrelated ticks
    prevKey = key;

    const ctx = {
      p1, p2,
      t1: p1.totals || fallbackTotals(p1),
      t2: p2.totals || fallbackTotals(p2),
      meta: g(state, `postgame.${sb}.meta`, {}),
      linescore: g(state, `postgame.${sb}.linescore`, null),
      winnerSide: g(state, `postgame.${sb}.meta.winnerSide`, 0),
      round: g(state, `score.${sb}.phase`, ''),
      bestOf: g(state, `score.${sb}.best_of`, null),
      tournament: g(state, 'tournamentInfo.name', ''),
      eventName: g(state, 'tournamentInfo.event_name', ''),
      port1: Number.isInteger(g(state, `score.${sb}.player.1.port`, null)) ? g(state, `score.${sb}.player.1.port`, null) : null,
      port2: Number.isInteger(g(state, `score.${sb}.player.2.port`, null)) ? g(state, `score.${sb}.player.2.port`, null) : null,
      themeSvg: builtinThemeSvg(),
    };

    const themePkg = g(OverlayBase.settings, 'overlays.global.designPackage', null) || 'default';
    ctx.themeSvg = await loadTheme(themePkg);

    root.style.display = '';
    buildDom(ctx);
    autoScale();
    const gsap = await ensureGsap();
    runTimeline(gsap);
  }

  function replay() {
    if (root.style.display === 'none' || !prevKey) return;
    ensureGsap().then(runTimeline);
  }

  function dispose() {
    window.removeEventListener('resize', autoScale);
    if (tl) { tl.kill(); tl = null; }
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { update, dispose, replay };
}

// ── small helpers ───────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function prettyStadium(slug) {
  return String(slug || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function hexToRgbStr(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

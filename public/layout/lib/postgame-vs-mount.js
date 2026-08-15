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
import { captainFrame } from './captain-framing.js';
import { ensurePortPalette, portColor as portPaletteColor } from './port-colors.js';

const REF_W = 1920, REF_H = 1080;
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
  transform-origin: top left; color: var(--ink);
  --s1: #e53935; --s1-rgb: 229, 57, 53;
  --s2: #1e88e5; --s2-rgb: 30, 136, 229;
  /* Fallback well, for a package that declares no - -well. Opaque enough to
     stand on its own: nothing here blurs the backdrop behind it any more —
     see the backdrop-filter note in postgame-callout-css.js. */
  --well: rgba(13, 13, 21, 0.82);
  --accent: #ff3d4e; --accent-rgb: 255, 61, 78;
  --mono: 'Chivo Mono', ui-monospace, 'SF Mono', monospace;
  /* Neutral vocabulary — the Rio night/fog scale (lib/rio-theme/tokens.css),
     NOT white. Every card edge, chip, track and caption keys to these. A
     white neutral sitting between two saturated side colours is what made
     this scene read as a flag instead of as a broadcast; keep the chrome
     cool-grey and let the only saturated things on screen be the two
     players and the Rio-red accent. */
  --ink: #f5f5f8;                        /* fog-100 — headline numerals/names */
  --ink-2: #c9c9d6;                      /* fog-300 — secondary values */
  --ink-3: #8f8fa3;                      /* fog-500 — labels, captions */
  --ink-4: #5a5a70;                      /* dimmed — zeros, struck cells */
  --edge: rgba(143, 143, 163, 0.26);     /* card border */
  --edge-soft: rgba(143, 143, 163, 0.14);/* hairline dividers */
  --sheen: rgba(201, 201, 214, 0.10);    /* inner top highlight */
  --slab: rgba(31, 31, 48, 0.62);        /* inset chips + bar tracks */
}
.pv-backdrop { position: absolute; inset: 0; clip-path: inset(0% 50% 0% 50%); }
.pv-theme-svg, .pv-theme-svg svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pv-vignette { position: absolute; inset: 0; box-shadow: inset 0 0 300px rgba(0,0,0,0.55); pointer-events: none; }

/* ── captain heroes + ghosted team logos ──
   Stacking: logo (1) < hero (2) < every data surface (3), so captains can
   never block the board and the logo always reads as backdrop texture.

   THE HERO BOX IS SIZED AND PLACED PER CAPTAIN, PER SIDE — width, height,
   left/right and the mirror all arrive as inline style from
   captain-framing.js, which is where the reasoning lives. There is no shared
   box here on purpose: one box plus object-fit:contain is what put half the
   cast's face under the data well and rendered Daisy nearly twice Luigi's
   size. Don't put a width/height back on this rule.

   contain stays on the IMAGE as the mismatched-pack fallback: the captain art
   is user-supplied, so a pack with different proportions than the frames were
   measured against letterboxes inside its box rather than stretching. */
.pv-hero {
  position: absolute;
  display: flex; align-items: flex-end; justify-content: center;
  filter: drop-shadow(0 24px 44px rgba(0,0,0,0.65)); z-index: 2;
}
.pv-hero img { width: 100%; height: 100%; object-fit: contain; object-position: bottom center; }
/* The mirror rides the IMG, never the hero box — GSAP owns the box's transform
   for the stride-in (x / scale) and the two would fight. */
.pv-hero img.mirror { transform: scaleX(-1); }
/* Centred on the hero box explicitly — it used to fall wherever its static
   position landed in the flex line, which was harmless under one shared box
   and is not now that the box is cut to each captain. */
.pv-hero .bloom {
  position: absolute; bottom: 70px; left: 50%; transform: translateX(-50%);
  width: 500px; height: 500px; border-radius: 50%;
  filter: blur(22px); z-index: -1;
}
.pv-hero.s1 .bloom { background: radial-gradient(circle, rgba(var(--s1-rgb), 0.5) 0%, transparent 62%); }
.pv-hero.s2 .bloom { background: radial-gradient(circle, rgba(var(--s2-rgb), 0.5) 0%, transparent 62%); }
/* Big dimmed team logo behind the captain — centered on the art so wide
   (short-rendering) captains don't leave it floating overhead.

   THE LOGO IS BIG, WHOLE, AND HARD-EDGED. All three, and the way to get all
   three is geometry — not a mask, and not a smaller logo.

   It used to sit at left/right: -36px inside an overflow-hidden container,
   i.e. deliberately hung over the edge and chopped there, which is exactly
   what it looked like: a logo with a straight slice taken off its outer side.
   Two wrong fixes were tried on the way here, both worth naming so they don't
   come back: shrinking it (weak — this is one of the two things carrying team
   identity in the frame, it is supposed to read big), and feathering its edge
   with a radial mask (a soft-edged team logo is not the same graphic — the
   mark has its own silhouette and dissolving it is a worse crime than cropping
   it).

   The actual fix is that the 720px box sits FULLY INSIDE the clip container,
   so there is no geometry hanging over an edge for anything to cut. The logo
   renders whole, at full size, with its own edges. The clip container stays
   only as a backstop for a package that moves things. */
.pv-logo-clip {
  position: absolute; inset: 30px; overflow: hidden; border-radius: 26px;
  z-index: 1; pointer-events: none;
}
.pv-logo {
  position: absolute; top: 200px; width: 720px; height: 720px;
  display: flex; align-items: center; justify-content: center;
}
.pv-logo.s1 { left: 8px; }
.pv-logo.s2 { right: 8px; }
.pv-logo img {
  width: 100%; height: 100%; object-fit: contain; opacity: 0.17;
  filter: blur(1px) saturate(0.85);
}

/* ── identity plates (port glass + outer rail), top corners ──

   BOTH PLATES ARE THE SAME WIDTH, ALWAYS. They used to be inline-block under a
   max-width, i.e. shrink-to-fit: with a long name on one side and a short one
   on the other you got a 737px card facing a 182px card, and because the name
   never wraps the long one didn't even stop at the max-width — it overflowed
   its own card and ran into the match strip in the middle of the frame. A fixed box plus fitPlateName() (which steps the type down until it
   fits) means the composition is symmetric for every pair of names, and the
   only thing that varies is the size of the type. */
.pv-plate { position: absolute; top: 96px; width: 520px; z-index: 3; }
.pv-plate.s1 { left: 76px; }
.pv-plate.s2 { right: 76px; text-align: right; }
.pv-plate .card {
  position: relative; display: block; padding: 18px 30px; border-radius: 13px;
  border: 1.5px solid var(--edge);
  box-shadow: inset 0 2px 0 var(--sheen);
}
/* the plate tints toward its side, but over night glass rather than over
   nothing — a flat 20% side wash on a dark backdrop is what made these read
   as two solid colour blocks */
.pv-plate.s1 .card { background: linear-gradient(100deg, rgba(var(--s1-rgb), 0.26), var(--well) 78%); padding-left: 40px; }
.pv-plate.s2 .card { background: linear-gradient(260deg, rgba(var(--s2-rgb), 0.26), var(--well) 78%); padding-right: 40px; }
.pv-plate .rail { position: absolute; top: 8px; bottom: 8px; width: 6px; border-radius: 3px; }
.pv-plate.s1 .rail { left: 12px; background: var(--s1); transform-origin: center top; }
.pv-plate.s2 .rail { right: 12px; background: var(--s2); transform-origin: center top; }
/* font-size is set by fitPlateName() at build time; 52px is the ceiling it
   starts from. Still nowrap — a player name breaking across two lines looks
   like a bug, so we shrink instead of wrap. */
.pv-plate .rio { font-size: 52px; font-weight: 900; line-height: 1; letter-spacing: -0.5px; text-shadow: 0 3px 18px rgba(0,0,0,0.55); white-space: nowrap; }
/* WINNER is brand-red text and nothing else. It was a filled accent pill once
   (it fought the side colour for attention, and on a red port merged with it
   outright), then tracked text next to a short solid accent rule. The rule is
   gone too: the word is already the only accent-coloured thing on the plate,
   so a bar beside it was decoration marking something that was not ambiguous. */
.pv-plate .winner {
  display: inline-block; margin-top: 14px;
  font-size: 21px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase;
  color: var(--accent); text-shadow: 0 0 18px rgba(var(--accent-rgb), 0.55);
}

/* ── match context, top center ──
   THE CARD IS SIZED BY ITS CONTENT, not by a fixed width. It was 700px flat,
   which is right for "MUSHROOM KINGDOM CHAMPIONSHIP / Winners Semifinal / Best
   of 5" and absurd for the no-event case, where the card holds the two words
   "Game Summary" and the other 500px are empty glass. Shrink-to-fit with a
   floor and a ceiling: the floor keeps the short case from reading as a chip,
   the ceiling keeps a long tournament name from reaching the identity plates
   (which end at x=596 / start at x=1324, so ~700px is all the room there is). */
.pv-match { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); text-align: center; z-index: 3; }
.pv-match .card {
  position: relative; display: inline-block; box-sizing: border-box;
  min-width: 330px; max-width: 700px;
  padding: 20px 34px 22px; border-radius: 16px;
  background: var(--well); border: 1.5px solid var(--edge);
  box-shadow: inset 0 2px 0 var(--sheen);
}
.pv-match .tourney, .pv-match .round { overflow: hidden; text-overflow: ellipsis; }
.pv-match .tourney { font-size: 19px; font-weight: 700; letter-spacing: 3.5px; text-transform: uppercase; color: var(--ink-3); }
.pv-match .round { margin-top: 6px; font-size: 40px; font-weight: 900; line-height: 1.05; letter-spacing: -0.3px; color: var(--ink); }
.pv-match .series { margin-top: 12px; display: flex; align-items: center; justify-content: center; }
.pv-match .bo {
  padding: 4px 14px; border-radius: 7px; background: var(--slab);
  border: 1px solid var(--edge-soft); color: var(--ink-2);
  font-size: 16px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
}

/* ── the center data well ── */
/* border-box so the -480px margin truly centers it, and hidden
   until the reveal grows it in (GSAP owns opacity/scaleX). */
.pv-board {
  position: absolute; left: 50%; top: 268px; width: 960px; margin-left: -480px;
  box-sizing: border-box; opacity: 0; z-index: 3;
  border-radius: 18px; background: var(--well);
  border: 1.5px solid var(--edge);
  box-shadow: inset 0 2px 0 var(--sheen), 0 18px 60px rgba(0,0,0,0.55),
              0 0 44px rgba(var(--accent-rgb), 0.18);
  transform-origin: center center; overflow: hidden;
  padding: 30px 42px 26px;
}
/* The moving trail-gradient rim these three cards carried is GONE (same in
   postgame-callout-css.js). Three crawling s1-accent-s2 borders running for
   the whole hold is a lot of motion around a card whose own numbers are the
   event, and the gradient re-read as red-to-blue once the palette went back to
   port colours — i.e. it was drawing the flag around the board. A plain
   --edge border and the accent glow already in the box-shadow do the framing. */
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
/* FINAL is a dark slab with brand-red type + a red underscore, not a filled
   red pill — a filled accent lozenge dead-centre between a red side and a
   blue side was the third stripe of the flag. */
.pv-runs .final {
  position: relative; padding: 7px 24px 10px; border-radius: 9px;
  background: var(--slab); border: 1px solid var(--edge-soft); color: var(--accent);
  font-size: 22px; font-weight: 900; letter-spacing: 5px; text-transform: uppercase;
  text-shadow: 0 0 18px rgba(var(--accent-rgb), 0.55);
}
.pv-runs .final::after {
  content: ''; position: absolute; left: 24px; right: 24px; bottom: 5px; height: 3px;
  border-radius: 2px; background: var(--accent); box-shadow: 0 0 14px rgba(var(--accent-rgb), 0.8);
}
.pv-runs .meta {
  font-size: 15px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
  color: var(--ink-3); white-space: nowrap;
}
.pv-runs .meta .dot { color: var(--accent); padding: 0 7px; }

/* stat rows: value · outward bar · center label pill · outward bar · value */
.pv-rows { display: flex; flex-direction: column; }
.pv-row { display: grid; grid-template-columns: 96px 1fr 254px 1fr 96px; align-items: center; column-gap: 16px; padding: 15px 0; position: relative; }
.pv-row + .pv-row::before {
  content: ''; position: absolute; top: 0; left: 6px; right: 6px; height: 1.5px;
  background: var(--edge-soft);
}
.pv-row .v {
  font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 52px; font-weight: 700; line-height: 1; color: var(--ink-2);
}
.pv-row .v.s1 { text-align: left; }
.pv-row .v.s2 { text-align: right; }
.pv-row .v.lead.s1 { color: var(--s1); }
.pv-row .v.lead.s2 { color: var(--s2); }
/* the centre label column is the widest neutral on screen — as a white chip
   it was the flag's white stripe. Dark slab, fog type. */
.pv-row .label {
  padding: 9px 8px; border-radius: 9px; background: var(--slab);
  border: 1px solid var(--edge-soft); text-align: center;
  font-size: 15.5px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--ink-2); white-space: nowrap;
}
.pv-row .track { position: relative; height: 11px; border-radius: 5.5px; background: var(--slab); overflow: hidden; }
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
  border: 1.5px solid var(--edge);
  box-shadow: inset 0 2px 0 var(--sheen), 0 12px 40px rgba(0,0,0,0.5),
              0 0 44px rgba(var(--accent-rgb), 0.18);
  padding: 22px 38px 24px;
}
.pv-line .lgrid { display: grid; align-items: center; row-gap: 9px; }
.pv-line .c { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: center; }
.pv-line .c.hd { font-size: 16px; font-weight: 700; letter-spacing: 1px; color: var(--ink-3); }
.pv-line .c.v { font-size: 33px; font-weight: 700; color: var(--ink-2); }
.pv-line .c.v.zero { color: var(--ink-4); }
.pv-line .c.v.x { font-size: 25px; color: var(--ink-4); }
.pv-line .c.tot { font-size: 36px; font-weight: 800; }
.pv-line .c.tot.r.s1 { color: var(--s1); }
.pv-line .c.tot.r.s2 { color: var(--s2); }
.pv-line .c.tot.h { color: var(--ink); font-weight: 700; font-size: 33px; }
.pv-line .name {
  text-align: left; padding-right: 30px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 290px;
  font-size: 21px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;
}
.pv-line .name.s1 { color: var(--s1); }
.pv-line .name.s2 { color: var(--s2); }
.pv-line .rule { width: 1.5px; height: 44px; margin: 0 auto; background: var(--edge); }
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
      <radialGradient id="pvA" cx="4%" cy="6%" r="46%">
        <stop offset="0" style="stop-color:var(--port-color);stop-opacity:0.32"/>
        <stop offset="0.6" style="stop-color:var(--port-color);stop-opacity:0"/>
      </radialGradient>
      <radialGradient id="pvB" cx="96%" cy="6%" r="46%">
        <stop offset="0" style="stop-color:var(--port-2);stop-opacity:0.32"/>
        <stop offset="0.6" style="stop-color:var(--port-2);stop-opacity:0"/>
      </radialGradient>
      <linearGradient id="pvFootA" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--port-color);stop-opacity:0.6"/>
        <stop offset="0.26" style="stop-color:var(--port-color);stop-opacity:0.6"/>
        <stop offset="0.44" style="stop-color:var(--port-color);stop-opacity:0"/>
      </linearGradient>
      <linearGradient id="pvFootB" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0.56" style="stop-color:var(--port-2);stop-opacity:0"/>
        <stop offset="0.74" style="stop-color:var(--port-2);stop-opacity:0.6"/>
        <stop offset="1" style="stop-color:var(--port-2);stop-opacity:0.6"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="#08080e"/>
    <rect width="1920" height="1080" fill="url(#pvA)"/>
    <rect width="1920" height="1080" fill="url(#pvB)"/>
    <rect x="0" y="0" width="1920" height="10" fill="#e60012" opacity="0.9"/>
    <rect x="0" y="1070" width="1920" height="10" fill="url(#pvFootA)"/>
    <rect x="0" y="1070" width="1920" height="10" fill="url(#pvFootB)"/>
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

  // The port palette is the app's, not this scene's — see lib/port-colors.js.
  // A side with no controller port has no port colour to take, so it falls
  // back to the global accent.
  function portColor(port) {
    return portPaletteColor(port)
      || OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.accentColor', NEUTRAL_ACCENT);
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

  // The plate carries the player's NAME and nothing else. The team name line
  // that used to sit under it is gone: the team is already on screen as the
  // large ghosted logo behind that side's captain, and printing it again in
  // 19px caps was the second-widest thing in a box that has to hold a long rio
  // name. One fact, one place.
  function sidePlate(side, p, winnerSide) {
    const cls = side === 1 ? 's1' : 's2';
    const isWin = winnerSide === side;
    return `
      <div class="pv-plate ${cls}">
        <div class="card">
          <div class="rail"></div>
          <div class="rio">${escapeHtml(p?.rioName || `Player ${side}`)}</div>
        </div>
        ${isWin ? '<div><span class="winner">Winner</span></div>' : ''}
      </div>`;
  }

  function sideLogo(side, p) {
    const cls = side === 1 ? 's1' : 's2';
    const logo = p?.teamName ? teamLogoUrl(p.teamName) : '';
    return `<div class="pv-logo ${cls}">${logo ? `<img src="${logo}" onerror="this.style.display='none'" alt="" />` : ''}</div>`;
  }

  // Every captain is framed individually — see captain-framing.js for why, and
  // for the measurements behind the numbers. The frame decides the box's size
  // and its distance from THIS side's stage edge; all twelve then stand on one
  // ground line, so a tall pose and a diving one still share a floor.
  function sideHero(side, p) {
    const cls = side === 1 ? 's1' : 's2';
    const art = captainArtUrl(p?.captain);
    const fallback = charArtUrl(p?.captain);
    const f = captainFrame(p?.captain, side);
    const edge = side === 1 ? 'left' : 'right';
    const box = `width:${f.w}px;height:${f.h}px;${edge}:${f.out}px;bottom:${f.bottom}px;`;
    return `
      <div class="pv-hero ${cls}" style="${box}">
        <div class="bloom"></div>
        ${art ? `<img class="${f.flip ? 'mirror' : ''}" src="${art}" data-fb="${fallback}"
          onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb='';}else{this.style.opacity=0;}" alt="" />` : ''}
      </div>`;
  }

  // Single-game card: no series record here — just tournament/round context
  // and the format pill.
  //
  // THE CARD ALWAYS RENDERS, and "Game Summary" is the deliberate headline when
  // there is no round to name. A game played outside a start.gg event still
  // wants something holding the top centre of the frame between the two
  // identity plates — dropping the card there leaves a visible hole in the
  // composition, which is worse than a generic title. Producer's call; don't
  // "clean this up" by making it conditional again.
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
    fitPlateNames();
  }

  // Shrink a plate name until it fits its fixed-width card.
  //
  // The plates are equal-width boxes now (see the .pv-plate note), so the name
  // is the one thing that has to give. Measuring beats guessing a character
  // count: rio names are arbitrary, the font is a producer setting, and "how
  // wide is this string" is a question only layout can answer. Runs after the
  // DOM is in place and before GSAP touches anything, so the reveal animates
  // type that is already the right size.
  function fitPlateNames() {
    const MAX = 52, MIN = 24;
    stage.querySelectorAll('.pv-plate .rio').forEach((el) => {
      const room = el.parentElement.clientWidth
        - parseFloat(getComputedStyle(el.parentElement).paddingLeft || 0)
        - parseFloat(getComputedStyle(el.parentElement).paddingRight || 0);
      if (!room) return;
      let size = MAX;
      el.style.fontSize = `${size}px`;
      // scrollWidth is the un-wrapped text width (the name is nowrap), so this
      // converges in a handful of steps rather than one per pixel.
      while (size > MIN && el.scrollWidth > room) {
        size = Math.max(MIN, Math.floor(size * Math.min(0.94, room / el.scrollWidth)));
        el.style.fontSize = `${size}px`;
      }
    });
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
      // WINNER is text on a rule now, not a filled pill — the flare-out lands
      // on the glyphs' own glow rather than on a box shadow.
      t.fromTo(winner, { textShadow: '0 0 40px rgba(var(--accent-rgb), 0.95)' },
        { textShadow: '0 0 18px rgba(var(--accent-rgb), 0.55)', duration: 0.7, ease: 'power2.out' }, '<+=0.15');
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
    // Both halves of the package's look in one await: the backdrop it draws and
    // the port palette it declares (resolvePalette reads that synchronously).
    [ctx.themeSvg] = await Promise.all([loadTheme(themePkg), ensurePortPalette(themePkg)]);

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

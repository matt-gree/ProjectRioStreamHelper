// postgame-callout-mount.js — CHARACTER SPOTLIGHT: full-screen post-game
// per-character callout with a live hit-visualizer AB walkthrough.
//
// A fed element (Callout Stage occupant, sibling of the Game Summary): the
// producer picks one finished-game roster character on the Production page;
// this mount tells that character's whole game as a story —
//
//   · left column (flex-stacked, hero-first): identity plate (name, event /
//     bracket context, rio name · team, tags) → a merged BATTING card
//     (H-AB headline + runs/RBI/stolen/star-hit-spent + OBP/SLG) with
//     optional half-width PITCHING / DEFENSE cards beneath it → HERO ART,
//     which claims whatever vertical room the stat cards don't use (no
//     reserved gaps — pitchers get a taller hero shot than position players)
//   · the AB THEATER: an embedded RioVisualizer (three.js) viewport that
//     replays every resolved plate appearance — real recorded flight (the
//     hero crane for home runs / deep flies, the same crane at infield
//     scale for every other ball in play), result stamp (swing info,
//     distance in feet, Star Chance outcome), runner movement on a live
//     diamond, score odometers
//   · the game-state bar: a live scoreboard strip that MORPHS into a big
//     "9TH INNING · 2 OUTS" transition card that ESTABLISHES each new at-bat
//     (the theater resets under it), then morphs back — and retires into a
//     FINAL score card once the walkthrough ends
//   · an AB ticker along the bottom: chips build progressively (one per PA,
//     inning + result + swing tag + every star spent), each landing the
//     moment its result is known — when the ball lands / the play concludes
//     — so the ticker stays in lockstep with the replay
//   · finale: every flight redraws at once — the spray chart — and the stat
//     panels lock to their final totals. Plays once, holds on the spray.
//
//   const m = mountPostgameCallout({ host });
//   m.update(OverlayBase.state, { scoreboard, team, charIndex });
//   m.replay();   // re-run the whole show (e.g. OBS source made active)
//   m.dispose();
//
// Data: postgame.{N}.* (State) for the box score; GET /api/v1/postgame/abs for
// the heavy per-AB payload (trajectories never travel through State).
//
// THEME CONTRACT: same as the Game Summary (postgame-vs-mount.js) — the
// backdrop SVG comes from /design/{pkg}/callout.svg; a package may declare
// --side1/--side2/--well/--accent-neutral on the SVG root (slice26 does) and
// the mount keys every surface to them, falling back to controller-port
// colours — which are the APP's palette (Design tab → Controller Ports, with
// the package's own `portColors` under it; see lib/port-colors.js), not this
// scene's. Requires the host page's `three` importmap (callout-stage has it).

//
// This file is the orchestrator; the CSS, AB-ticker chips, and the AB
// walkthrough/spray-finale sequencer live in sibling modules — see
// postgame-callout-css.js, postgame-callout-chips.js,
// postgame-callout-theater.js. CHARACTER-SPOTLIGHT.md is the design doc.

import { injectCss, REF_W, REF_H } from './postgame-callout-css.js';
import { escapeHtml } from './postgame-callout-chips.js';
import { createTheater } from './postgame-callout-theater.js';
import { ensurePortPalette, portColor as portPaletteColor } from './port-colors.js';

const NEUTRAL_ACCENT = '#f59e0b';

function charArtUrl(name) {
  const id = OverlayBase.charId(name);
  return id === undefined ? '' : `${OverlayBase.BASE_URL}/game_assets/msb/characters/${id}.png`;
}
// rio-data.js loads before this module (see callout-stage.html); the
// window.RioData guard just matches the other mounts' defensive style.
function teamLogoUrl(teamName) { return teamName && window.RioData ? RioData.teamLogoUrl(teamName) : ''; }

// Same last-resort backdrop contract as before (public/design/README.md).
function builtinThemeSvg() {
  return `
  <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="csA" cx="4%" cy="6%" r="46%">
        <stop offset="0" style="stop-color:var(--port-color);stop-opacity:0.32"/>
        <stop offset="0.6" style="stop-color:var(--port-color);stop-opacity:0"/>
      </radialGradient>
      <radialGradient id="csB" cx="96%" cy="6%" r="46%">
        <stop offset="0" style="stop-color:var(--port-2);stop-opacity:0.32"/>
        <stop offset="0.6" style="stop-color:var(--port-2);stop-opacity:0"/>
      </radialGradient>
      <linearGradient id="csFootA" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style="stop-color:var(--port-color);stop-opacity:0.6"/>
        <stop offset="0.26" style="stop-color:var(--port-color);stop-opacity:0.6"/>
        <stop offset="0.44" style="stop-color:var(--port-color);stop-opacity:0"/>
      </linearGradient>
      <linearGradient id="csFootB" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0.56" style="stop-color:var(--port-2);stop-opacity:0"/>
        <stop offset="0.74" style="stop-color:var(--port-2);stop-opacity:0.6"/>
        <stop offset="1" style="stop-color:var(--port-2);stop-opacity:0.6"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="#08080e"/>
    <rect width="1920" height="1080" fill="url(#csA)" style="opacity:var(--side-a-weight,1)"/>
    <rect width="1920" height="1080" fill="url(#csB)" style="opacity:var(--side-b-weight,1)"/>
    <rect x="0" y="0" width="1920" height="10" fill="#e60012" opacity="0.9"/>
    <rect x="0" y="1070" width="1920" height="10" fill="url(#csFootA)" style="opacity:var(--side-a-weight,1)"/>
    <rect x="0" y="1070" width="1920" height="10" fill="url(#csFootB)" style="opacity:var(--side-b-weight,1)"/>
  </svg>`;
}

function fmt3(n) { return (Number(n) || 0).toFixed(3).replace(/^0\./, '.'); }

export function mountPostgameCallout({ host }) {
  injectCss();

  const root = document.createElement('div');
  root.className = 'cs-root';
  const stage = document.createElement('div');
  stage.className = 'cs-stage';
  root.appendChild(stage);
  host.appendChild(root);
  root.style.display = 'none';

  let prevKey = '';
  let themeCache = {};
  const theater = createTheater({ stage });
  let showCtx = null;        // cached data for replay()

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

  // Theme-declared side palette (slice26) with port-colour fallback; --side is
  // the spotlighted character's own side colour.
  function resolvePalette(ctx) {
    const svgEl = stage.querySelector('.cs-theme-svg svg');
    const read = (name) => svgEl ? (getComputedStyle(svgEl).getPropertyValue(name) || '').trim() : '';
    const s1 = read('--side1') || portColor(ctx.port1);
    const s2 = read('--side2') || portColor(ctx.port2);
    const well = read('--well');
    const accent = read('--accent-neutral')
      || OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.accentColor', null)
      || '#f93f91';
    const side = ctx.side === 1 ? s1 : s2;
    const set = (k, v, fb) => { stage.style.setProperty(k, v); stage.style.setProperty(`${k}-rgb`, hexToRgbStr(v, fb)); };
    set('--s1', s1, '197, 247, 7');
    set('--s2', s2, '87, 224, 231');
    set('--side', side, ctx.side === 1 ? '197, 247, 7' : '87, 224, 231');
    set('--accent', accent, '249, 63, 145');
    if (well) stage.style.setProperty('--well', well);
    // THE BACKDROP IS ONE COLOUR, ENTERING FROM ONE SIDE, and these three lines
    // are what do it. callout.svg is authored as an A side and a B side, and
    // the Game Summary feeds it the two players. This scene is about ONE
    // player, so it takes their colour AND SWITCHES THE OTHER SIDE OFF.
    //
    // Mirroring the colour into both sides was the obvious first move and it
    // was wrong: a symmetrically tinted frame reads as a vignette, as lighting,
    // as anything except a person. Colour entering from the side the player
    // occupies and falling away across the frame reads as their light. The
    // spotlight's player is always in the left column whichever side they
    // batted on, so A is always the lit side.
    //
    // The two-colour palette survives where two colours mean something - the
    // score strip and the final card still read - -s1 / - -s2.
    stage.style.setProperty('--port-color', side);
    stage.style.setProperty('--port-2', side);
    stage.style.setProperty('--side-b-weight', '0');
    // ...and the backdrop's brand bloom comes with them. It is Rio red by
    // default, which is right for the Game Summary - the centre of a two-player
    // frame belongs to neither side. Here it was the last thing in the frame
    // carrying a second hue, and behind a BLUE player a red glow in the middle
    // read as the other player's colour leaking into their own callout. One
    // player, one chroma. (The Rio-red ACCENT stays red: it marks moments -
    // WINNER, FINAL, star pips - and never stands for a player.)
    stage.style.setProperty('--brand-color', side);
    // ...and the halftone comes down a step: three of this frame's four corners
    // are covered by cards, so at the Game Summary's weight the dots only ever
    // showed as a rind around the content. See - -dot-weight in callout.svg.
    stage.style.setProperty('--dot-weight', '0.34');
  }

  // ── DOM builders ──────────────────────────────────────────────────────────

  // A stat that starts at 0 and counts up during the walkthrough (batting).
  function statHtml(id, label, value) {
    return `<div class="cs-stat"><span class="v" id="${id}" data-final="${value}">0</span><span class="l">${label}</span></div>`;
  }
  // A stat rendered at its final value from the first frame (pitching /
  // defense — their story isn't told play-by-play, so they don't count up).
  function statNowHtml(label, value) {
    return `<div class="cs-stat"><span class="v">${escapeHtml(String(value))}</span><span class="l">${escapeHtml(label)}</span></div>`;
  }
  // Half-width card whose share of the row is proportional to how many stats
  // it actually records — a lone single-stat card hugs its content instead of
  // stretching across the row.
  function halfBoxHtml(id, title, entries) {
    if (!entries.length) return '';
    const maxW = entries.length * 150 + 60;
    return `
      <div class="cs-box" id="${id}" style="flex:${entries.length} 1 0; max-width:${maxW}px">
        <div class="bt">${title}</div>
        <div class="grid">${entries.map(([label, v]) => statNowHtml(label, v)).join('')}</div>
      </div>`;
  }

  function buildDom(ctx) {
    const { char, sideData } = ctx;
    const b = char.batting || {};
    const p = char.pitching;
    const d = char.defense || {};
    const logo = sideData.teamName ? teamLogoUrl(sideData.teamName) : '';

    // header context: event name up top; bracket · phase · round beneath the
    // player identity (round emphasized). Empty pieces simply don't render.
    const metaLine = ctx.event ? `<div class="meta">${escapeHtml(ctx.event)}</div>` : '';
    const ctxBits = [];
    if (ctx.bracket) ctxBits.push(escapeHtml(ctx.bracket));
    if (ctx.phase) ctxBits.push(escapeHtml(ctx.phase));
    if (ctx.round) ctxBits.push(`<b>${escapeHtml(ctx.round)}</b>`);
    const ctxLine = ctxBits.length ? `<div class="ctx">${ctxBits.join(' · ')}</div>` : '';
    // status column — WINNER and CAPTAIN only. "★ Superstar" came out: every
    // starred character in a game carries it, so on a busy plate it was a
    // near-constant third line of text saying something the hero art already
    // shows. The star pips in the game-state bar are where stars mean
    // something here.
    const statusCol = (sideData.isWinner || char.isCaptain) ? `
      <div class="cs-status">
        ${sideData.isWinner ? '<span class="st win">Winner</span>' : ''}
        ${char.isCaptain ? '<span class="st">Captain</span>' : ''}
      </div>` : '';

    // pitching / defense populate at their final numbers from the first
    // frame — the walkthrough narrates the batting story, not these
    const pitchEntries = p ? [
      ['IP', p.ip ?? '0.0'],
      ['ER', p.earned_runs ?? 0],
      ['K', p.strikeouts_pitched ?? 0],
      ['H', p.hits_allowed ?? 0],
      ...(Number(p.star_pitches) > 0 ? [['★ Pitch', p.star_pitches]] : []),
    ] : [];

    // defense: only categories the player actually recorded — a bench of
    // zeros renders nothing and the hero takes the room instead. Outs are
    // broken out by the position they were recorded at (e.g. "Outs · SS").
    const opp = d.outs_per_position || {};
    const outsEntries = Object.entries(opp)
      .filter(([, n]) => Number(n) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([pos, n]) => [`Outs · ${pos}`, n]);
    if (!outsEntries.length && Number(d.outs_at_position) > 0) {
      outsEntries.push(['Outs Made', d.outs_at_position]);
    }
    const defEntries = [];
    if (Number(d.big_plays) > 0) defEntries.push(['Big Plays', d.big_plays]);
    defEntries.push(...outsEntries);
    if (Number(d.sliding_catches) > 0) defEntries.push(['Sliding Catch', d.sliding_catches]);
    if (Number(d.wall_jumps) > 0) defEntries.push(['Wall Jumps', d.wall_jumps]);

    const pitchBox = halfBoxHtml('cs-box-pitch', 'Pitching', pitchEntries);
    const defBox = halfBoxHtml('cs-box-def', 'Defense', defEntries);
    const statRow = (pitchBox || defBox) ? `<div class="cs-statrow">${[pitchBox, defBox].filter(Boolean).join('')}</div>` : '';
    const stolenMini = Number(b.stolen_bases) > 0 ? statHtml('cs-sb', 'Stolen', b.stolen_bases) : '';
    // OBP/SLG carry class "rate": collapsed until the AB walkthrough finishes,
    // then the finale animates them open (see revealRates).
    const rateStat = (label, v) =>
      `<div class="cs-stat rate"><span class="v">${fmt3(v)}</span><span class="l">${label}</span></div>`;
    const starsRow = Array.from({ length: 5 }, (_, i) => `<span class="st" data-i="${i}">★</span>`).join('');

    // AB chips land at their final width, splitting the full ticker between
    // this player's ACTUAL plate appearances (a four-PA game gets four wider
    // chips, not four chips plus a phantom fifth slot); sized once so the
    // ticker grows rightward without ever reflowing earlier chips
    const nAbs = Math.max((ctx.abs || []).length, 1);
    const chipW = Math.max(96, Math.min(300, Math.floor((1160 - 14 * (nAbs - 1)) / nAbs)));
    stage.style.setProperty('--chipw', `${chipW}px`);

    stage.innerHTML = `
      <div class="cs-backdrop">
        <div class="cs-theme-svg">${ctx.themeSvg}</div>
        ${logo ? `<div class="cs-bglogo"><img src="${logo}" onerror="this.parentNode.style.display='none'" alt="" /></div>` : ''}
        <div class="cs-vignette"></div>
      </div>
      <div class="cs-leftcol">
        <div class="cs-plate">
          <div class="rail"></div>
          <div class="cs-id">
            ${metaLine}
            <div class="char">${escapeHtml(char.name || '')}</div>
            <div class="rio">${escapeHtml(sideData.rioName || '')}</div>
            ${ctxLine}
          </div>
          ${statusCol}
        </div>
        <div class="cs-statzone">
          <div class="cs-box cs-batcard" id="cs-box-bat">
            <div class="bt">Batting</div>
            <div class="top">
              <div class="hab"><span class="v" id="cs-hab">0-0</span></div>
              <div class="minis">
                ${statHtml('cs-runs', 'Runs', b.runs ?? 0)}
                ${statHtml('cs-rbi', 'RBI', b.rbi ?? 0)}
                ${stolenMini}
                <div class="cs-stat"><span class="v"><span id="cs-sh">0</span><span class="dim">/</span><span id="cs-ss">0</span></span><span class="l">★ Hit / Spent</span></div>
                ${rateStat('OBP', b.obp)}
                ${rateStat('SLG', b.slg)}
              </div>
            </div>
          </div>
          ${statRow}
        </div>
        <div class="cs-hero">
          <div class="bloom"></div>
          <img src="${charArtUrl(char.name)}" onerror="this.style.opacity=0" alt="" />
        </div>
      </div>
      <div class="cs-well cs-rim cs-theater" id="cs-theater">
        <div class="cs-viewport" id="cs-viewport"></div>
        <div class="cs-labels" id="cs-labels"></div>
        <div class="cs-dim" id="cs-dim"></div>
        <div class="cs-flash" id="cs-flash"></div>
        <div class="cs-stamp" id="cs-stamp"></div>
        <div class="cs-finale" id="cs-finalebanner"><span>Spray Chart · ${escapeHtml(char.name || '')}</span></div>
      </div>
      <div class="cs-well cs-rim cs-situation" id="cs-situation">
        <div class="cs-bar-content" id="cs-barcontent">
          <div class="cs-diamond">
            <div class="inn" id="cs-diamond-inn"></div>
            <svg viewBox="0 0 132 132">
              <path d="M66 122 L122 66 L66 10 L10 66 Z" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
              <rect class="base" id="cs-base-1" x="108" y="56" width="20" height="20" transform="rotate(45 118 66)"/>
              <rect class="base" id="cs-base-2" x="56" y="4"  width="20" height="20" transform="rotate(45 66 14)"/>
              <rect class="base" id="cs-base-3" x="4"  y="56" width="20" height="20" transform="rotate(45 14 66)"/>
              <rect class="base" x="56" y="108" width="20" height="20" transform="rotate(45 66 118)" style="fill:rgba(255,255,255,0.06)"/>
              <g id="cs-runners"></g>
            </svg>
          </div>
          <div class="cs-cntouts">
            <span class="cnt" id="cs-count">0-0</span>
            <span class="sep">•</span>
            <div class="dots" id="cs-outdots"><span class="dot"></span><span class="dot"></span></div>
          </div>
          <div class="cs-score">
            <div class="side s1"><span class="n">${escapeHtml(ctx.p1?.rioName || '')}</span><span class="r" id="cs-r1">0</span></div>
            <span class="dash">—</span>
            <div class="side s2"><span class="n">${escapeHtml(ctx.p2?.rioName || '')}</span><span class="r" id="cs-r2">0</span></div>
          </div>
          <div class="cs-stars" id="cs-stars">
            <div class="row" id="cs-starrow">${starsRow}</div>
            <span class="l">Stars</span>
          </div>
          <div class="cs-pitcher">
            <div class="icon" id="cs-pitcher-icon"></div>
            <div class="info"><span class="n" id="cs-pitcher">—</span><span class="l">Pitching</span></div>
          </div>
        </div>
        <div class="cs-transcard" id="cs-transcard">
          <span class="inn" id="cs-trans-inn"></span>
          <span class="outs" id="cs-trans-outs"></span>
        </div>
        <div class="cs-finalcard" id="cs-finalcard">
          <div class="side s1" id="cs-final-s1">
            <div class="who"><span class="wtag"></span><span class="n"></span><span class="bx"></span></div>
            <span class="r"></span>
          </div>
          <div class="mid">
            <span class="tag">FINAL</span>
            <span class="ctx" id="cs-final-ctx"></span>
          </div>
          <div class="side s2" id="cs-final-s2">
            <div class="who"><span class="wtag"></span><span class="n"></span><span class="bx"></span></div>
            <span class="r"></span>
          </div>
        </div>
      </div>
      <div class="cs-ticker" id="cs-ticker"></div>`;
    resolvePalette(ctx);
    fitPlateText();
    alignHeroGlow();

    const font = OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.fontFamily', 'Inter');
    root.style.setProperty('--cs-font', `'${font}', sans-serif`);
  }

  // Shrink the two identity lines to fit the plate instead of overflowing it
  // (the character name had nowrap and no overflow rule at all, so a long one
  // simply ran out of the card) or ellipsing it (the rio name did, and a
  // player's name truncated to "SuperLongPlayerNa..." is worse than a smaller
  // one that still reads). Step down by the measured overflow ratio, floor at
  // a size that is still broadcast-legible, never grow past the design size.
  //
  // MEASURED WITH A RANGE, NOT scrollWidth, and that is not interchangeable
  // here. Both of these lines carry text-overflow: ellipsis as a backstop, and
  // an ellipsed line reports scrollWidth === clientWidth — the browser has
  // already thrown the overflow away by the time you ask. The fitter would
  // then see every name as fitting and never shrink anything. A Range over the
  // text nodes measures what the text actually WANTS, ellipsis or not. (The
  // Game Summary's fitPlateNames can use scrollWidth because its names don't
  // ellipse; don't copy that idiom back over here.) Range rects are in screen
  // pixels, so divide out the stage's scale before comparing to clientWidth.
  function fitPlateText() {
    const fit = (sel, max, min) => {
      const el = stage.querySelector(sel);
      if (!el) return;
      const room = el.clientWidth;
      if (!room) return;
      const scale = el.getBoundingClientRect().width / room;
      const wanted = () => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getBoundingClientRect().width / (scale || 1);
      };
      let size = max;
      el.style.fontSize = `${size}px`;
      for (let guard = 0; guard < 12 && size > min; guard += 1) {
        const w = wanted();
        if (w <= room) break;
        size = Math.max(min, Math.floor(size * Math.min(0.94, room / w)));
        el.style.fontSize = `${size}px`;
      }
    };
    fit('.cs-id .char', 56, 30);
    fit('.cs-id .rio', 21, 14);
  }

  // Put the hero's ground glow under the character's ACTUAL feet.
  //
  // The MSB renders are not centred in their own PNGs — each one carries a
  // different amount of transparent margin on the left than on the right, and a
  // different amount of air under the feet. A glow centred on the img BOX
  // therefore sits off to one side for most characters and floats above or
  // below the feet, and it lands somewhere different every time the producer
  // pushes a new spotlight. Nothing in CSS can see where the pixels are, so we
  // look: draw the art small, scan the alpha channel, and place the glow on the
  // opaque bounding box instead of on the element box.
  //
  // 96px wide is plenty — we need a centre and a baseline, not an outline — and
  // the result is cached per source so a replay costs nothing. Same-origin
  // images only (they are; game_assets is served by this server), and a taint
  // error just falls back to the CSS centring.
  const heroBoxCache = new Map();
  function heroOpaqueBox(img) {
    const src = img.currentSrc || img.src;
    if (heroBoxCache.has(src)) return heroBoxCache.get(src);
    let box = null;
    try {
      const w = 96;
      const h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const c2d = canvas.getContext('2d', { willReadFrequently: true });
      c2d.drawImage(img, 0, 0, w, h);
      const data = c2d.getImageData(0, 0, w, h).data;
      let minX = w, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          if (data[(y * w + x) * 4 + 3] > 24) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      // fractions of the natural image, so they survive any later resize
      if (maxX >= minX && maxY >= 0) {
        box = {
          cx: (minX + maxX + 1) / 2 / w,
          w: (maxX - minX + 1) / w,
          bottom: (maxY + 1) / h,
        };
      }
    } catch { box = null; }
    heroBoxCache.set(src, box);
    return box;
  }

  function alignHeroGlow() {
    const hero = stage.querySelector('.cs-hero');
    const img = hero && hero.querySelector('img');
    const bloom = hero && hero.querySelector('.bloom');
    if (!hero || !img || !bloom) return;
    if (!img.complete || !img.naturalWidth) {
      img.addEventListener('load', alignHeroGlow, { once: true });
      return;
    }
    const box = heroOpaqueBox(img);
    if (!box) return;

    // Work in hero-local UNSCALED px: rects come back through the stage's
    // transform, so divide it out. offsetWidth/Height are already unscaled,
    // which is what makes the result independent of the OBS source size.
    const hr = hero.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const k = (hr.width / hero.offsetWidth) || 1;
    const iw = ir.width / k, ih = ir.height / k;
    // where object-fit: contain actually put the pixels inside that box —
    // centred horizontally, flush to the bottom (object-position: bottom)
    const fit = Math.min(iw / img.naturalWidth, ih / img.naturalHeight);
    const dw = img.naturalWidth * fit, dh = img.naturalHeight * fit;
    const dx = (ir.left - hr.left) / k + (iw - dw) / 2;
    const dy = (ir.top - hr.top) / k + (ih - dh);

    const cx = dx + box.cx * dw;
    const feet = dy + box.bottom * dh;
    // WIDTH IS THE ONE THAT ACTUALLY BIT. Across the roster the renders are all
    // horizontally centred, but their silhouettes span anywhere from 29% to 88%
    // of the image width and their feet sit anywhere from 88% to 99% of the way
    // down it. A glow at a fixed 84% of the ELEMENT box therefore ran ~3x wider
    // than a small character and barely wider than a big one, and floated in
    // mid-air for the ones with room under their feet — so it landed somewhere
    // different on every push. Sized off the silhouette it hugs all of them.
    const gw = Math.min(hero.offsetWidth * 1.05, Math.max(140, box.w * dw * 1.3));
    // shallow, and capped: the pool is centred ON the feet line, so half its
    // height hangs below the hero box and a tall one runs off the bottom of the
    // 1080 canvas. The outer third of the gradient is near-zero alpha under a
    // 24px blur, so a small overrun is invisible — a 180px one is not.
    const gh = Math.min(140, Math.round(gw * 0.22));
    bloom.style.left = `${Math.round(cx)}px`;
    bloom.style.width = `${Math.round(gw)}px`;
    bloom.style.height = `${gh}px`;
    // centre the pool ON the feet line, not under it
    bloom.style.bottom = `${Math.round(hero.offsetHeight - feet - gh / 2)}px`;
  }

  // ── element contract ──────────────────────────────────────────────────────

  // sel = { scoreboard, team, charIndex }
  async function update(state, sel) {
    const g = OverlayBase.deepGet;
    const sb = Number(sel?.scoreboard) || 1;
    const team = Number(sel?.team) || 1;
    const ci = Number(sel?.charIndex);

    const present = g(state, `postgame.${sb}.present`, false);
    const sideData = g(state, `postgame.${sb}.player.${team}`, null);
    const char = sideData && Array.isArray(sideData.characters) ? sideData.characters[ci] : null;

    if (!present || !sideData || !char || sel?.charIndex == null) {
      root.style.display = 'none';
      theater.stopShow();
      prevKey = '';
      // A spotlight with nothing pushed is a blank source — say so, or it reads
      // as broken in the preview. `present` gates on a captured post-game; the
      // rest gate on a character actually being picked to push.
      OverlayBase.setBlank(
        !present ? 'No captured game on this board — capture a game, then pick a character in Production.'
          : 'No character picked — choose one on the spotlight panel in Production.',
        'Character Spotlight',
      );
      return;
    }
    OverlayBase.setBlank(null, 'Character Spotlight');

    const capturedAt = g(state, `postgame.${sb}.capturedAt`, '');
    const key = `${sb}:${team}:${ci}:${capturedAt}`;
    // No churn on unrelated ticks — including ones that land while the abs
    // fetch below is still in flight (the hide path resets prevKey, so a
    // re-show after hiding always rebuilds).
    if (key === prevKey) return;
    prevKey = key;

    // heavy per-AB payload (trajectories) comes over REST, not State
    let absPayload = null;
    try {
      const r = await fetch(`${OverlayBase.BASE_URL}/api/v1/postgame/abs?scoreboard=${sb}&team=${team}&char_index=${ci}`);
      if (r.ok) absPayload = await r.json();
    } catch { absPayload = null; }
    if (prevKey !== key) return; // superseded while fetching
    const abs = (absPayload && absPayload.success && Array.isArray(absPayload.abs)) ? absPayload.abs : [];

    // Prefer the REST payload's stat blocks — after a server restart the abs
    // endpoint rebuilds its cache from the stat file (fresh schema), while the
    // State projection can predate fields like batting.runs.
    const fresh = (absPayload && absPayload.success && absPayload.character) || null;
    const mergedChar = fresh && fresh.batting ? {
      ...char,
      batting: fresh.batting,
      pitching: fresh.pitching ?? char.pitching,
      defense: fresh.defense || char.defense,
    } : char;

    // Player-header context, most→least general: Event = the tournament name;
    // Bracket = the start.gg event within it (e.g. "Stars Off"); Phase = the
    // free-text Competition Phase field; Round = this scoreboard's bound-match
    // round label (e.g. "Winners Semifinal"). Empty pieces don't render.
    const event = g(state, 'tournamentInfo.name', '') || '';
    const bracket = g(state, 'tournamentInfo.event_name', '') || '';
    const phase = g(state, 'tournamentInfo.phase', '') || '';
    const round = g(state, `score.${sb}.phase`, '') || '';

    const ctx = {
      side: team,
      sb,
      char: mergedChar,
      sideData,
      event,
      bracket,
      phase,
      round,
      p1: g(state, `postgame.${sb}.player.1`, null),
      p2: g(state, `postgame.${sb}.player.2`, null),
      meta: g(state, `postgame.${sb}.meta`, {}),
      stadium: (absPayload && absPayload.stadium) || g(state, `postgame.${sb}.meta.stadium`, ''),
      abs,
      port1: Number.isInteger(g(state, `score.${sb}.player.1.port`, null)) ? g(state, `score.${sb}.player.1.port`, null) : null,
      port2: Number.isInteger(g(state, `score.${sb}.player.2.port`, null)) ? g(state, `score.${sb}.player.2.port`, null) : null,
      themeSvg: builtinThemeSvg(),
    };

    const themePkg = g(OverlayBase.settings, 'overlays.global.designPackage', null) || 'default';
    // Both halves of the package's look, in one await: the backdrop it draws
    // and the port palette it declares (resolvePalette reads the latter
    // synchronously, so it has to have landed before the DOM is built).
    [ctx.themeSvg] = await Promise.all([loadTheme(themePkg), ensurePortPalette(themePkg)]);
    if (prevKey !== key) return;

    root.style.display = '';
    buildDom(ctx);
    autoScale();
    theater.ensureRenderer();
    showCtx = ctx;
    theater.startShow(ctx);
  }

  function replay() {
    if (root.style.display === 'none' || !showCtx) return;
    // rebuild the DOM so odometers/chips reset, then run the whole show again
    buildDom(showCtx);
    theater.ensureRenderer();
    theater.startShow(showCtx);
  }

  function dispose() {
    window.removeEventListener('resize', autoScale);
    theater.dispose();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { update, dispose, replay };
}

// ── small helpers ───────────────────────────────────────────────────────────

function hexToRgbStr(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

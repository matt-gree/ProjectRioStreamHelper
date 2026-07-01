// postgame-callout-mount.js — full-screen post-game STAT CALLOUT element.
//
// A fed element (like stats / hit): the producer picks one finished-game roster
// character on the Production page; the pick is written to the container feed key
// and this mount renders a cinematic, full-screen reveal of that character's
// box-score line into the host of any shared container that hosts it.
//
//   const m = mountPostgameCallout({ host });
//   m.update(OverlayBase.state, { scoreboard, team, charIndex });
//   m.replay();   // re-run the reveal (e.g. OBS source made active)
//   m.dispose();
//
// Requires overlay-base.js (OverlayBase). GSAP is loaded lazily (vendored at
// /layout/lib/gsap/gsap.min.js); if it's unavailable the callout still renders,
// just without the timeline (everything snaps visible).
//
// Design criteria (locked with the user):
//   - PORT COLORS are integral: the player's controller port (0-3) drives the
//     accent — rim glow, the chevron rail, stat-bar fills, hero stat numbers.
//   - THEMED SVG: the backdrop comes from the active design package
//     (/design/{package}/callout.svg; overlays.global.designPackage picks the
//     package). Theme SVGs recolor to the live port via the CSS vars they
//     inherit (--port-color, --port-2, --accent). A minimal built-in backdrop
//     ships inline as the last-resort fallback.
//   - CHARACTER ART is the centerpiece: the full-body render from the new
//     game_assets/msb/characters/ pack is the hero; the team captain emblem from
//     captains/ rides alongside as the team identity.

import { ensureGsap } from './gsap-loader.js';

const REF_W = 1920, REF_H = 1080;
const SETTINGS_TYPE = 'postgamecallout';

// Smash/Mario-Kart player-colour convention, 0-indexed by controller port.
// Overridable per port via overlays.postgamecallout.port{N}Color.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
const NEUTRAL_ACCENT = '#f59e0b';

// The new full-body character pack is lower-cased, space-stripped; one name in
// MSB's roster ("Monty") files under its full species name.
const CHAR_ART_ALIAS = { Monty: 'montymole' };

let _cssInjected = false;

// ── art URLs ────────────────────────────────────────────────────────────────
function charArtUrl(name) {
  if (!name) return '';
  const slug = CHAR_ART_ALIAS[name] || name.toLowerCase().replace(/\s+/g, '');
  // encodeURIComponent leaves ( ) untouched, matching the on-disk filenames
  // (e.g. "Dry Bones(Gy)" -> drybones(gy).png).
  return `${OverlayBase.BASE_URL}/game_assets/msb/characters/${encodeURIComponent(slug)}.png`;
}
function captainArtUrl(name) {
  if (!name) return '';
  return `${OverlayBase.BASE_URL}/game_assets/msb/captains/file_${encodeURIComponent(name.replace(/\s+/g, ''))}.png`;
}

// ── styles (scoped under .pc-root so it can live in any container) ───────────
const CSS = `
.pc-root { position: absolute; inset: 0; overflow: hidden; font-family: var(--pc-font, 'Inter', sans-serif); }
.pc-stage {
  position: absolute; top: 0; left: 0; width: ${REF_W}px; height: ${REF_H}px;
  transform-origin: top left; color: #fff;
  --port-color: ${NEUTRAL_ACCENT};
  --port-rgb: 245, 158, 11;
  --port2-rgb: 245, 158, 11;
  --accent: ${NEUTRAL_ACCENT};
}
/* Backdrop: themed SVG layer + a port-tinted wash + vignette. */
.pc-backdrop { position: absolute; inset: 0; clip-path: inset(0 100% 0 0); }
.pc-backdrop.side2 { clip-path: inset(0 0 0 100%); }
.pc-theme-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.pc-theme-svg svg { width: 100%; height: 100%; }
.pc-wash {
  position: absolute; inset: 0;
  background:
    radial-gradient(120% 90% at 18% 30%, rgba(var(--port-rgb), 0.42) 0%, transparent 55%),
    radial-gradient(120% 120% at 85% 80%, rgba(var(--port2-rgb), 0.26) 0%, transparent 60%),
    linear-gradient(125deg, #0a0d16 0%, #11131f 48%, #0a0d16 100%);
}
.pc-stage.side2 .pc-wash {
  background:
    radial-gradient(120% 90% at 82% 30%, rgba(var(--port-rgb), 0.42) 0%, transparent 55%),
    radial-gradient(120% 120% at 15% 80%, rgba(var(--port2-rgb), 0.26) 0%, transparent 60%),
    linear-gradient(235deg, #0a0d16 0%, #11131f 48%, #0a0d16 100%);
}
.pc-vignette { position: absolute; inset: 0; box-shadow: inset 0 0 320px rgba(0,0,0,0.85); pointer-events: none; }

/* Chevron rail — a stack of port-colored slashes behind the figure. */
.pc-rail { position: absolute; top: 0; bottom: 0; width: 560px; overflow: hidden; }
.pc-rail.side1 { left: -60px; }
.pc-rail.side2 { right: -60px; transform: scaleX(-1); }
.pc-rail .slash {
  position: absolute; top: -10%; height: 120%; width: 70px; transform: skewX(-18deg);
  background: linear-gradient(180deg, rgba(var(--port-rgb), 0.9), rgba(var(--port-rgb), 0.45));
  opacity: 0.0;
}

/* Hero character art. */
.pc-hero {
  position: absolute; bottom: -20px; width: 940px; height: 1040px;
  display: flex; align-items: flex-end; justify-content: center;
  filter: drop-shadow(0 24px 40px rgba(0,0,0,0.6));
}
.pc-hero.side1 { left: 40px; }
.pc-hero.side2 { right: 40px; }
.pc-hero img { max-width: 100%; max-height: 100%; object-fit: contain; object-position: bottom; }
.pc-hero .glow {
  position: absolute; bottom: 60px; width: 620px; height: 620px; border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--port-rgb), 0.7) 0%, transparent 62%);
  filter: blur(18px); z-index: -1;
}

/* Content column. */
.pc-content { position: absolute; top: 150px; bottom: 120px; width: 880px; display: flex; flex-direction: column; gap: 26px; }
.pc-content.side1 { right: 90px; align-items: flex-end; text-align: right; }
.pc-content.side2 { left: 90px; align-items: flex-start; text-align: left; }

.pc-idrow { display: flex; align-items: center; gap: 22px; }
.pc-content.side1 .pc-idrow { flex-direction: row-reverse; }
.pc-cap-badge {
  width: 116px; height: 116px; border-radius: 22px; flex-shrink: 0;
  background: rgba(255,255,255,0.05);
  border: 2px solid rgba(var(--port-rgb), 0.8);
  box-shadow: 0 0 28px rgba(var(--port-rgb), 0.55);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.pc-cap-badge img { width: 88%; height: 88%; object-fit: contain; }
.pc-id { display: flex; flex-direction: column; }
.pc-content.side1 .pc-id { align-items: flex-end; }
.pc-rio { font-size: 78px; font-weight: 800; line-height: 0.98; letter-spacing: -1px; text-shadow: 0 4px 24px rgba(0,0,0,0.6); }
.pc-charname {
  font-size: 30px; font-weight: 600; letter-spacing: 4px; text-transform: uppercase;
  color: rgba(var(--port-rgb), 0.95); margin-top: 6px;
}
.pc-result { display: flex; align-items: center; gap: 16px; margin-top: 4px; }
.pc-content.side1 .pc-result { flex-direction: row-reverse; }
.pc-wl {
  font-size: 22px; font-weight: 800; letter-spacing: 2px; padding: 5px 16px; border-radius: 999px;
  text-transform: uppercase;
}
.pc-wl.win { background: var(--port-color); color: #06080d; }
.pc-wl.loss { background: rgba(255,255,255,0.1); color: #c9cfdb; border: 1px solid rgba(255,255,255,0.2); }
.pc-score { font-size: 30px; font-weight: 700; color: #e7ecf5; }
.pc-score .vs { opacity: 0.5; font-weight: 500; margin: 0 10px; }

/* Hero stat pair (AVG / OPS) — oversized. */
.pc-herostats { display: flex; gap: 40px; }
.pc-content.side1 .pc-herostats { flex-direction: row-reverse; }
.pc-herostat { display: flex; flex-direction: column; }
.pc-content.side1 .pc-herostat { align-items: flex-end; }
.pc-herostat .v { font-size: 92px; font-weight: 800; line-height: 0.9; color: #fff; font-variant-numeric: tabular-nums; }
.pc-herostat .l { font-size: 22px; font-weight: 700; letter-spacing: 3px; color: rgba(255,255,255,0.55); text-transform: uppercase; }

/* Stat bars — port-colored wipes with a counted value. */
.pc-bars { display: flex; flex-direction: column; gap: 12px; width: 560px; }
.pc-bar { position: relative; height: 50px; border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.06); }
.pc-bar .fill {
  position: absolute; inset: 0; transform-origin: left center; transform: scaleX(0);
  background: linear-gradient(90deg, rgba(var(--port-rgb), 0.95), rgba(var(--port-rgb), 0.4));
}
.pc-content.side1 .pc-bar .fill { transform-origin: right center; }
.pc-bar .row { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; }
.pc-content.side1 .pc-bar .row { flex-direction: row-reverse; }
.pc-bar .bl { font-size: 22px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.9); }
.pc-bar .bv { font-size: 30px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 1px 6px rgba(0,0,0,0.5); }

/* Batting line ribbon. */
.pc-line {
  font-size: 28px; font-weight: 700; letter-spacing: 0.5px; color: #f2f5fb;
  padding: 12px 22px; border-radius: 12px; background: rgba(0,0,0,0.35);
  border-left: 5px solid var(--port-color);
}
.pc-content.side1 .pc-line { border-left: none; border-right: 5px solid var(--port-color); }

/* Pitching panel (only if this character pitched). */
.pc-pitch {
  display: flex; gap: 30px; padding: 16px 24px; border-radius: 14px;
  background: rgba(10,14,22,0.5); border: 1px solid rgba(255,255,255,0.08);
}
.pc-content.side1 .pc-pitch { flex-direction: row-reverse; }
.pc-pitch .tag {
  align-self: center; font-size: 18px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase;
  color: var(--port-color); writing-mode: vertical-rl; transform: rotate(180deg);
}
.pc-content.side1 .pc-pitch .tag { transform: rotate(0deg); }
.pc-pitch .grid { display: flex; gap: 26px; }
.pc-pstat { display: flex; flex-direction: column; align-items: center; }
.pc-pstat .v { font-size: 40px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
.pc-pstat .l { font-size: 16px; font-weight: 700; letter-spacing: 2px; color: rgba(255,255,255,0.5); text-transform: uppercase; }

/* Footer meta strip. */
.pc-footer {
  position: absolute; left: 0; right: 0; bottom: 40px; display: flex; justify-content: center; gap: 28px;
  font-size: 22px; font-weight: 600; color: rgba(255,255,255,0.62); letter-spacing: 1px;
}
.pc-footer .dot { color: var(--port-color); }
`;

function injectCss() {
  if (_cssInjected) return;
  const style = document.createElement('style');
  style.id = 'postgame-callout-css';
  style.textContent = CSS;
  document.head.appendChild(style);
  _cssInjected = true;
}

// ── inline fallback backdrop: a layered SVG that recolors to the port via
// CSS vars. Used only when the active design package (and the default package)
// have no callout.svg — see public/design/README.md for the var contract. ──
function builtinThemeSvg() {
  // NOTE: var() only resolves in SVG via inline `style`, never in presentation
  // attributes (fill="var(...)" / stop-color="var(...)" do NOT recolor). All
  // port-coloured paint below is therefore set through style="".
  return `
  <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="pcBeam" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--port-color);stop-opacity:0.55"/>
        <stop offset="1" style="stop-color:var(--port-color);stop-opacity:0"/>
      </linearGradient>
      <pattern id="pcGrid" width="58" height="58" patternUnits="userSpaceOnUse">
        <path d="M58 0 L0 0 0 58" fill="none" style="stroke:var(--port-color);stroke-opacity:0.10" stroke-width="1.5"/>
      </pattern>
    </defs>
    <rect width="1920" height="1080" fill="url(#pcGrid)"/>
    <g opacity="0.8">
      <polygon points="0,1080 760,0 1060,0 300,1080" fill="url(#pcBeam)"/>
      <polygon points="380,1080 1140,0 1240,0 480,1080" fill="url(#pcBeam)" opacity="0.5"/>
    </g>
    <rect x="0" y="0" width="1920" height="10" style="fill:var(--port-color)" opacity="0.9"/>
    <rect x="0" y="1070" width="1920" height="10" style="fill:var(--port-2)" opacity="0.7"/>
  </svg>`;
}

// ── number formatting ───────────────────────────────────────────────────────
function fmt3(n) { return (Number(n) || 0).toFixed(3).replace(/^0\./, '.'); }
function fmt1(n) { return (Number(n) || 0).toFixed(1); }

export function mountPostgameCallout({ host }) {
  injectCss();

  const root = document.createElement('div');
  root.className = 'pc-root';
  const stage = document.createElement('div');
  stage.className = 'pc-stage';
  root.appendChild(stage);
  host.appendChild(root);
  root.style.display = 'none';

  let tl = null;
  let prevKey = '';
  let themeCache = {}; // name -> svg string

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

  // The backdrop comes from the active design package:
  // /design/{package}/callout.svg, falling back to the default package's file,
  // then to the inline builtin above.
  async function fetchThemeSvg(pkg) {
    const r = await fetch(`${OverlayBase.BASE_URL}/design/${encodeURIComponent(pkg)}/callout.svg`);
    return r.ok ? await r.text() : null;
  }

  async function loadTheme(pkg) {
    if (themeCache[pkg] != null) return themeCache[pkg];
    let svg = null;
    try {
      svg = await fetchThemeSvg(pkg);
      if (svg == null && pkg !== 'default') svg = await fetchThemeSvg('default');
    } catch { svg = null; }
    themeCache[pkg] = svg != null ? svg : builtinThemeSvg();
    return themeCache[pkg];
  }

  // Curated batting bars (label, value, formatter) — shown only when meaningful.
  function battingBars(b) {
    const rows = [
      ['H', b.hits], ['HR', b.homeruns], ['RBI', b.rbi],
      ['2B', b.doubles], ['3B', b.triples], ['BB', (b.walks_bb || 0) + (b.walks_hbp || 0)],
      ['SB', b.stolen_bases], ['SO', b.strikeouts],
    ].map(([l, v]) => ({ l, v: Number(v) || 0 }));
    // Keep the strong counting stats; always show H, HR, RBI; then any nonzero.
    const keep = rows.filter(r => ['H', 'HR', 'RBI'].includes(r.l) || r.v > 0);
    return keep.slice(0, 6);
  }

  function buildDom(ctx) {
    const { side, port, char, sideData, oppData, meta } = ctx;
    const sideCls = side === 1 ? 'side1' : 'side2';
    const pc = portColor(port);
    const pc2 = portColor(port === 0 ? 1 : 0);
    stage.className = `pc-stage ${sideCls}`;
    stage.style.setProperty('--port-color', pc);
    stage.style.setProperty('--port-rgb', hexToRgbStr(pc));
    stage.style.setProperty('--port-2', pc2);
    stage.style.setProperty('--port2-rgb', hexToRgbStr(pc2));
    stage.style.setProperty('--accent', OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.accentColor', NEUTRAL_ACCENT));
    const font = OverlayBase.deepGet(OverlayBase.settings, 'overlays.global.fontFamily', 'Inter');
    root.style.setProperty('--pc-font', `'${font}', sans-serif`);

    const b = char.batting || {};
    const bars = battingBars(b);
    const isWin = !!sideData.isWinner;
    const oppScore = oppData ? oppData.score : null;

    const slashes = Array.from({ length: 6 }, (_, i) =>
      `<div class="slash" style="left:${i * 88}px"></div>`).join('');

    const barsHtml = bars.map(r =>
      `<div class="pc-bar"><div class="fill"></div><div class="row"><span class="bl">${r.l}</span><span class="bv" data-count="${r.v}" data-fmt="int">0</span></div></div>`
    ).join('');

    const pitch = char.pitching;
    const pitchHtml = pitch ? `
      <div class="pc-pitch">
        <div class="tag">Pitching</div>
        <div class="grid">
          <div class="pc-pstat"><span class="v">${pitch.ip ?? '0.0'}</span><span class="l">IP</span></div>
          <div class="pc-pstat"><span class="v" data-count="${pitch.era ?? 0}" data-fmt="f1">0.0</span><span class="l">ERA</span></div>
          <div class="pc-pstat"><span class="v" data-count="${pitch.strikeouts_pitched ?? 0}" data-fmt="int">0</span><span class="l">K</span></div>
          <div class="pc-pstat"><span class="v" data-count="${pitch.hits_allowed ?? 0}" data-fmt="int">0</span><span class="l">H</span></div>
          <div class="pc-pstat"><span class="v" data-count="${pitch.earned_runs ?? 0}" data-fmt="int">0</span><span class="l">ER</span></div>
        </div>
      </div>` : '';

    stage.innerHTML = `
      <div class="pc-backdrop ${sideCls}">
        <div class="pc-wash"></div>
        <div class="pc-theme-svg">${ctx.themeSvg}</div>
        <div class="pc-vignette"></div>
      </div>
      <div class="pc-rail ${sideCls}">${slashes}</div>
      <div class="pc-hero ${sideCls}">
        <div class="glow"></div>
        <img src="${charArtUrl(char.name)}" onerror="this.style.opacity=0" alt="" />
      </div>
      <div class="pc-content ${sideCls}">
        <div class="pc-idrow">
          <div class="pc-cap-badge"><img src="${captainArtUrl(sideData.captain)}" onerror="this.parentNode.style.display='none'" alt="" /></div>
          <div class="pc-id">
            <div class="pc-rio">${escapeHtml(sideData.rioName || 'Player')}</div>
            <div class="pc-charname">${escapeHtml(char.name || '')}${char.isCaptain ? ' · Captain' : ''}</div>
            <div class="pc-result">
              <span class="pc-wl ${isWin ? 'win' : 'loss'}">${isWin ? 'Winner' : 'Loss'}</span>
              <span class="pc-score">${sideData.score ?? 0}<span class="vs">–</span>${oppScore ?? 0}</span>
            </div>
          </div>
        </div>
        <div class="pc-herostats">
          <div class="pc-herostat"><span class="v" data-count="${b.avg ?? 0}" data-fmt="f3">.000</span><span class="l">AVG</span></div>
          <div class="pc-herostat"><span class="v" data-count="${b.ops ?? 0}" data-fmt="f3">.000</span><span class="l">OPS</span></div>
        </div>
        <div class="pc-bars">${barsHtml}</div>
        ${b.line ? `<div class="pc-line">${escapeHtml(b.line)}</div>` : ''}
        ${pitchHtml}
      </div>
      <div class="pc-footer">
        ${meta && meta.stadium ? `<span>${escapeHtml(prettyStadium(meta.stadium))}</span><span class="dot">●</span>` : ''}
        <span>${escapeHtml(sideData.rioName || '')} vs ${escapeHtml((oppData && oppData.rioName) || '—')}</span>
        ${meta && meta.inningsPlayed ? `<span class="dot">●</span><span>${meta.inningsPlayed} inn${meta.isMercy ? ' · Mercy' : ''}</span>` : ''}
      </div>`;
  }

  function snapVisible() {
    // No GSAP: reveal everything immediately.
    stage.querySelectorAll('.pc-backdrop').forEach(e => e.style.clipPath = 'inset(0 0 0 0)');
    stage.querySelectorAll('.slash').forEach(e => e.style.opacity = 0.5);
    stage.querySelectorAll('.fill').forEach(e => e.style.transform = 'scaleX(1)');
    stage.querySelectorAll('[data-count]').forEach(e => e.textContent = formatCount(e));
  }

  function formatCount(el) {
    const target = Number(el.getAttribute('data-count')) || 0;
    const fmt = el.getAttribute('data-fmt');
    if (fmt === 'f3') return fmt3(target);
    if (fmt === 'f1') return fmt1(target);
    return String(Math.round(target));
  }

  function runTimeline(gsap) {
    if (tl) { tl.kill(); tl = null; }
    if (!gsap) { snapVisible(); return; }

    const side = stage.classList.contains('side2') ? 2 : 1;
    const fromX = side === 1 ? -120 : 120;
    const t = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl = t;

    t.fromTo(stage.querySelector('.pc-backdrop'),
      { clipPath: side === 2 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' },
      { clipPath: 'inset(0 0 0 0)', duration: 0.65, ease: 'power4.inOut' });

    t.fromTo(stage.querySelectorAll('.slash'),
      { opacity: 0, x: side === 1 ? -60 : 60 },
      { opacity: 0.45, x: 0, duration: 0.5, stagger: 0.04 }, '-=0.35');

    t.fromTo(stage.querySelector('.pc-hero'),
      { x: fromX, autoAlpha: 0, scale: 1.06 },
      { x: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power2.out' }, '-=0.5');

    t.fromTo(stage.querySelector('.pc-cap-badge'),
      { scale: 0, rotate: -25, autoAlpha: 0 },
      { scale: 1, rotate: 0, autoAlpha: 1, duration: 0.5, ease: 'back.out(1.7)' }, '-=0.45');

    t.fromTo([stage.querySelector('.pc-rio'), stage.querySelector('.pc-charname'), stage.querySelector('.pc-result')],
      { y: 30, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.08 }, '-=0.4');

    // Hero AVG / OPS count-up.
    stage.querySelectorAll('.pc-herostat .v').forEach((el, i) => {
      countUp(gsap, t, el, i === 0 ? '-=0.35' : '<+=0.1');
    });

    // Stat bars: wipe + count.
    const bars = stage.querySelectorAll('.pc-bar');
    bars.forEach((bar, i) => {
      const pos = i === 0 ? '-=0.2' : '<+=0.12';
      t.fromTo(bar.querySelector('.fill'), { scaleX: 0 }, { scaleX: 1, duration: 0.55, ease: 'power3.out' }, pos);
      countUp(gsap, t, bar.querySelector('.bv'), '<');
    });

    if (stage.querySelector('.pc-line')) {
      t.fromTo(stage.querySelector('.pc-line'), { x: fromX * 0.4, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.45 }, '-=0.3');
    }
    if (stage.querySelector('.pc-pitch')) {
      t.fromTo(stage.querySelector('.pc-pitch'), { y: 26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.45 }, '-=0.2');
      stage.querySelectorAll('.pc-pitch .v[data-count]').forEach(el => countUp(gsap, t, el, '<'));
    }
    t.fromTo(stage.querySelector('.pc-footer'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.4 }, '-=0.25');
  }

  function countUp(gsap, t, el, pos) {
    if (!el) return;
    const target = Number(el.getAttribute('data-count')) || 0;
    const proxy = { v: 0 };
    t.to(proxy, {
      v: target, duration: 0.6, ease: 'power1.out',
      onUpdate: () => { el.textContent = renderCount(el.getAttribute('data-fmt'), proxy.v); },
    }, pos);
  }
  function renderCount(fmt, v) {
    if (fmt === 'f3') return fmt3(v);
    if (fmt === 'f1') return fmt1(v);
    return String(Math.round(v));
  }

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
      if (tl) { tl.kill(); tl = null; }
      prevKey = '';
      return;
    }

    const key = `${sb}:${team}:${ci}`;
    if (key === prevKey && root.style.display !== 'none') return; // no churn on unrelated state ticks
    prevKey = key;

    const oppTeam = team === 1 ? 2 : 1;
    const ctx = {
      side: team,
      port: Number.isInteger(g(state, `score.${sb}.player.${team}.port`, null))
        ? g(state, `score.${sb}.player.${team}.port`, null) : null,
      char,
      sideData,
      oppData: g(state, `postgame.${sb}.player.${oppTeam}`, null),
      meta: g(state, `postgame.${sb}.meta`, {}),
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
// "#e53935" -> "229, 57, 53" for use inside rgba(var(--port-rgb), α). Falls back
// to the neutral accent's rgb when the input isn't a 6-digit hex.
function hexToRgbStr(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '245, 158, 11';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

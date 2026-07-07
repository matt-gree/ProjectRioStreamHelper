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
//   row-live    live game cluster (batter/pitcher · count · diamond)
//   row-final   completed cluster (ELO swing · stadium/innings/date meta)
//   row-roster  both 9-character rosters
//   row-box     per-inning linescore
// A theme implements whatever subset fits its size (xs/s are row-top only).
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
import { createRevealGate } from './reveal-gate.js';
import { ensureGsap } from './gsap-loader.js';

const SETTINGS_TYPE = 'scoreboard';
const DEFAULT_PACKAGE = 'default';
const MAX_INN = 9;

export const SIZE_DIMS = {
  xs: { w: 400, h: 50 },
  s:  { w: 500, h: 80 },
  m:  { w: 600, h: 200 },
  l:  { w: 800, h: 460 },
};

// Controller-port → side colour (0-indexed), same convention as the Scorecard.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

const BALL_ON = '#22c55e', STRIKE_ON = '#eab308', OUT_ON = '#ef4444';
const DOT_OFF = 'rgba(255,255,255,0.08)';

// Row order + visibility predicate over the resolved flags.
const STACK = [
  ['row-top',    v => true],
  ['row-live',   v => v.showLive],
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
  let disposed = false;

  const g = OverlayBase.deepGet;

  function readToggles(settings) {
    return {
      showElo:      g(settings, `overlays.${SETTINGS_TYPE}.showElo`, true) !== false,
      showTeamLogos: g(settings, `overlays.${SETTINGS_TYPE}.showTeamLogos`, true) !== false,
      showLogo:     OverlayBase.readSetting(SETTINGS_TYPE, 'showLogo', true) !== false,
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

  function relayout(vis, fresh) {
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
  function dot(name, on, color) {
    const el = engine.slots[name];
    if (el) el.style.fill = on ? color : DOT_OFF;
  }

  function setOpacity(name, on) {
    const el = engine.slots[name];
    if (el) el.setAttribute('opacity', on ? '1' : '0');
  }

  function teamLogoUrl(team) { return team && window.RioData ? RioData.teamLogoUrl(team) : ''; }
  function charIconUrl(name) { return name && window.RioData ? RioData.charIconUrl(name) : ''; }

  function bindImageProbe(slotName, url, fallbackSlot) {
    const el = engine.slots[slotName];
    if (!el) return;
    if (!url) {
      engine.setImage(slotName, '');
      if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '1');
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (disposed || el !== engine.slots[slotName]) return;
      engine.setImage(slotName, url);
      if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '0');
    };
    img.onerror = () => {
      if (disposed || el !== engine.slots[slotName]) return;
      engine.setImage(slotName, '');
      if (fallbackSlot && engine.slots[fallbackSlot]) engine.slots[fallbackSlot].setAttribute('opacity', '1');
    };
    img.src = url;
  }

  function bindTop(d, vis) {
    engine.setText('s1-name', d.p1 || 'Player One');
    engine.setText('s2-name', d.p2 || 'Player Two');
    engine.setText('s1-score', d.sL);
    engine.setText('s2-score', d.sR);
    engine.setImage('s1-logo', vis.showTeamLogos ? teamLogoUrl(d.team1) : '');
    engine.setImage('s2-logo', vis.showTeamLogos ? teamLogoUrl(d.team2) : '');

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

    for (let i = 0; i < 4; i++) dot(`ball-${i}`, i < d.balls, BALL_ON);
    for (let i = 0; i < 3; i++) dot(`strike-${i}`, i < d.strikes, STRIKE_ON);
    for (let i = 0; i < 3; i++) dot(`out-${i}`, i < d.outs, OUT_ON);

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
    if (themeChanged) { revealKey = ''; laidOut = {}; }
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
    bindImageProbe('logo', vis.showLogo ? OverlayBase.brandingLogoUrl() : '', 'logo-default');

    vis.showLive = !isFinal;
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

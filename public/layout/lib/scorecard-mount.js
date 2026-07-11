// scorecard-mount.js — the re-themable vertical Scorecard element.
//
// A scoreboard-bound element (its own OBS full-canvas source, ?scoreboard=N).
// The look lives in the active DESIGN PACKAGE's theme SVG
// (/design/{package}/scorecard.svg, element-by-element fallback to `default`).
//
// This mount is a STACK-LAYOUT ENGINE: the eight numbered design elements are
// authored in the theme at a local y-origin of 0 (each declaring data-h); the
// mount melds the active ones into one continuous card — translating each to
// its stacked Y, sizing the shared card-bg + accent rail, hiding the top
// section's divider — and reflows/animates the stack when the producer toggles
// elements via overlays.scorecard.* (broadcast live over the settings socket).
//
//   const sc = mountScorecard({ host, sb });
//   sc.update(OverlayBase.state, OverlayBase.settings);
//   sc.setShown(bool);  sc.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';
import { createRevealGate } from './reveal-gate.js';
import { ensureGsap } from './gsap-loader.js';

const ELEMENT = 'scorecard';
const SETTINGS_TYPE = 'scorecard';
const DEFAULT_PACKAGE = 'default';
const MAX_INN = 9;

const CARD_TOP = 40;        // top y of the melded card in the 1080 canvas
const CARD_CENTER_X = 304;  // horizontal centre of the card column

// Controller-port → side colour (0-indexed); tints each side's header chip.
const PORT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];

// Count-dot fill when active (matches the classic scoreboard convention).
const BALL_ON = '#22c55e', STRIKE_ON = '#eab308', OUT_ON = '#ef4444';
const DOT_OFF = 'rgba(255,255,255,0.08)';

// Stacked element order + its visibility predicate over the resolved toggles.
const STACK = [
  ['el-header',    v => v.showHeader],
  ['el-phase',     v => v.showPhase && v.hasPhase],
  ['el-mode',      v => v.showGameMode && v.hasMode],
  ['el-main',      v => v.mainMode === 'full'],
  ['el-condensed', v => v.mainMode === 'condensed'],
  ['el-atbat',     v => v.showAtBat && !v.isFinal],
  ['el-box',       v => v.showBoxScore && v.hasBox],
  ['el-stadium',   v => v.showStadium && v.hasStadium],
];

const FALLBACK_SVG = `
<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <rect data-slot="card-rail" x="64" y="40" width="6" height="180" rx="3" style="fill:var(--accent)"/>
  <rect data-slot="card-bg" x="70" y="40" width="474" height="180" rx="16" style="fill:var(--band);stroke:var(--border)"/>
  <g data-slot="el-main" data-h="180">
    <text data-slot="s1-name" data-maxw="300" x="90" y="100" style="fill:var(--ink);font-family:var(--font-display)" font-size="30" font-weight="700">Player One</text>
    <text data-slot="s1-score" x="516" y="100" text-anchor="end" style="fill:var(--ink);font-family:var(--font-mono)" font-size="40" font-weight="700">0</text>
    <text data-slot="s2-name" data-maxw="300" x="90" y="160" style="fill:var(--ink);font-family:var(--font-display)" font-size="30" font-weight="700">Player Two</text>
    <text data-slot="s2-score" x="516" y="160" text-anchor="end" style="fill:var(--ink);font-family:var(--font-mono)" font-size="40" font-weight="700">0</text>
  </g>
</svg>`;

const CSS = `
.sc-host { position: fixed; inset: 0; }
.sc-host svg { width: 100%; height: 100%; display: block; }
.sc-host.sc-reveal { animation: sc-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.sc-host.sc-off { opacity: 0 !important; }
@keyframes sc-rise { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .sc-host.sc-reveal { animation: none; } }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'scorecard-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

function prettyStadium(slug) {
  if (!slug) return '';
  if (/[a-z].*[A-Z ]/.test(slug) || slug.includes(' ')) return slug; // already a display name
  return String(slug).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function mountScorecard({ host, sb }) {
  injectCss();
  host.classList.add('sc-host');
  const SB = sb || 1;

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });
  let gsap = null;
  ensureGsap().then(g => { gsap = g; });

  let revealKey = '';
  let laidOut = {};           // el-* -> bool (has been positioned once; gates animate-vs-snap)
  let baseState = [false, false, false];
  let boxBaseX = null;        // theme-authored x of each box column (captured once per theme)
  let disposed = false;

  const g = OverlayBase.deepGet;

  // Per-scoreboard settings namespace. Each scorecard source keeps its own
  // config under overlays.scorecard.{N}.*; a plain overlays.scorecard.* leaf is
  // the legacy (pre-per-scoreboard) global, used as a non-destructive fallback
  // so scoreboards that were never individually edited keep their old look.
  const NS = `${SETTINGS_TYPE}.${SB}`;
  function scGet(settings, k, def) {
    const perSb = g(settings, `overlays.${SETTINGS_TYPE}.${SB}.${k}`, undefined);
    if (perSb !== undefined) return perSb;
    return g(settings, `overlays.${SETTINGS_TYPE}.${k}`, def);
  }

  // ── settings / toggles ──────────────────────────────────────────────────────
  function readToggles(settings) {
    const t = k => scGet(settings, k, null);
    const bool = (k, d) => { const v = t(k); return v == null ? d : v !== false; };
    return {
      showHeader:   bool('showHeader', true),
      showPhase:    bool('showPhase', true),
      showGameMode: bool('showGameMode', true),
      mainMode:     t('mainMode') || 'full',   // full | condensed | off
      showRosters:  bool('showRosters', true),
      showBases:    bool('showBases', true),
      showAtBat:    bool('showAtBat', true),
      showBoxScore: bool('showBoxScore', true),
      showStadium:  bool('showStadium', true),
      titleText:    t('titleText'),   // null when unset → default brand title
      phaseText:    t('phaseText') || '',
      showTeamLogos: true,
    };
  }

  // Resolve a side's colour from its controller port, falling back to
  // fallbackIdx when no port is assigned (side 1 → P1/index 0, side 2 →
  // P2/index 1). A producer override (overlays.scorecard.portNColor) wins.
  function portColor(port, settings, fallbackIdx) {
    const idx = Number.isInteger(port) ? port : (fallbackIdx == null ? -1 : fallbackIdx);
    if (idx < 0) return null;
    const ov = scGet(settings, `port${idx}Color`, null);
    if (ov) return ov;
    return idx < PORT_COLORS.length ? PORT_COLORS[idx] : null;
  }

  function applyColours(settings, p1Port, p2Port) {
    const accent = scGet(settings, 'accentColor', null);
    if (accent) host.style.setProperty('--accent', accent); else host.style.removeProperty('--accent');
    const c1 = portColor(p1Port, settings, 0);
    const c2 = portColor(p2Port, settings, 1);
    if (c1) host.style.setProperty('--side1', c1); else host.style.removeProperty('--side1');
    if (c2) host.style.setProperty('--side2', c2); else host.style.removeProperty('--side2');
  }

  // ── stack layout (the meld) ─────────────────────────────────────────────────
  function moveGroup(el, name, y, show, fresh) {
    if (!gsap) {
      el.setAttribute('transform', `translate(0,${y})`);
      el.setAttribute('opacity', show ? '1' : '0');
    } else if (fresh || laidOut[name] === undefined) {
      gsap.set(el, { y, opacity: show ? 1 : 0 });
    } else {
      gsap.to(el, { y, opacity: show ? 1 : 0, duration: 0.45, ease: 'power3.out' });
    }
    laidOut[name] = show;
  }

  function sizeCard(total, fresh) {
    const bg = engine.slots['card-bg'];
    const rail = engine.slots['card-rail'];
    const h = Math.max(total, 1);
    const vis = total > 0 ? '1' : '0';
    for (const el of [bg, rail]) {
      if (!el) continue;
      el.setAttribute('y', CARD_TOP);
      el.setAttribute('opacity', vis);
      if (!gsap || fresh || laidOut['__card'] === undefined) el.setAttribute('height', h);
      else gsap.to(el, { attr: { height: h }, duration: 0.45, ease: 'power3.out' });
    }
    laidOut['__card'] = true;
  }

  function relayout(vis, fresh) {
    let off = 0, activeCount = 0;
    for (const [name, want] of STACK) {
      const el = engine.slots[name];
      if (!el) continue;
      const show = !!want(vis);
      const div = el.querySelector('.sc-div');
      if (show) {
        moveGroup(el, name, CARD_TOP + off, true, fresh);
        if (div) div.setAttribute('opacity', activeCount === 0 ? '0' : '1');
        off += parseFloat(el.getAttribute('data-h')) || 0;
        activeCount++;
      } else {
        moveGroup(el, name, CARD_TOP + off, false, fresh);
      }
    }
    sizeCard(off, fresh);
  }

  // ── header: centre logo + title together ────────────────────────────────────
  function centerHeader(titleText) {
    const logoG = engine.slots['header-logo'];
    const titleEl = engine.slots['header-title'];
    if (!logoG || !titleEl) return;
    const hasTitle = !!titleText;
    let tW = 0;
    if (hasTitle) { try { tW = titleEl.getComputedTextLength(); } catch { tW = 0; } }
    const logoW = 40, gap = hasTitle ? 14 : 0;
    const totalW = logoW + gap + tW;
    const startX = CARD_CENTER_X - totalW / 2;
    logoG.setAttribute('transform', `translate(${startX},0)`);
    titleEl.setAttribute('x', startX + logoW + gap);
  }

  // ── slot helpers ────────────────────────────────────────────────────────────
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

  function dot(name, on, color) {
    const el = engine.slots[name];
    if (el) el.style.fill = on ? color : DOT_OFF;
  }

  function teamLogoUrl(team) { return team && window.RioData ? RioData.teamLogoUrl(team) : ''; }
  function charIconUrl(name) { return name && window.RioData ? RioData.charIconUrl(name) : ''; }

  // ── data binding ────────────────────────────────────────────────────────────
  // Standard roster order 0..8 (no captain reordering; the team logo already
  // tells the viewer who the captain is).
  function bindRoster(prefix, team, show) {
    for (let i = 0; i < 9; i++) {
      const name = show ? g(OverlayBase.state, `score.${SB}.player.${team}.character.${i}.name`, '') : '';
      engine.setImage(`${prefix}-char-${i}`, name ? charIconUrl(name) : '');
    }
  }

  function bindMain(state, d, vis) {
    engine.setText('s1-name', d.p1 || 'Player One');
    engine.setText('s2-name', d.p2 || 'Player Two');
    engine.setText('s1-score', d.sL);
    engine.setText('s2-score', d.sR);
    engine.setImage('s1-logo', vis.showTeamLogos ? teamLogoUrl(d.team1) : '');
    engine.setImage('s2-logo', vis.showTeamLogos ? teamLogoUrl(d.team2) : '');

    bindRoster('s1', 1, vis.showRosters);
    bindRoster('s2', 2, vis.showRosters);

    const innEl = engine.slots['inn-num'];
    engine.setText('inn-num', d.isFinal ? '' : d.inn);
    if (innEl) innEl.setAttribute('opacity', d.isFinal ? '0' : '1');
    if (engine.slots['inn-arrow-up'])   engine.slots['inn-arrow-up'].setAttribute('opacity', !d.isFinal && d.isTop ? '1' : '0');
    if (engine.slots['inn-arrow-down']) engine.slots['inn-arrow-down'].setAttribute('opacity', !d.isFinal && !d.isTop ? '1' : '0');
    if (engine.slots['final-badge'])    engine.slots['final-badge'].setAttribute('opacity', d.isFinal ? '1' : '0');

    for (let i = 0; i < 4; i++) dot(`ball-${i}`, i < d.balls, BALL_ON);
    for (let i = 0; i < 3; i++) dot(`strike-${i}`, i < d.strikes, STRIKE_ON);
    for (let i = 0; i < 3; i++) dot(`out-${i}`, i < d.outs, OUT_ON);

    bindBases(d, vis);
  }

  function bindBases(d, vis) {
    const on = [d.r1, d.r2, d.r3];
    const names = [d.r1Name, d.r2Name, d.r3Name];
    for (let b = 1; b <= 3; b++) {
      const occupied = vis.showBases && !d.isFinal && !!on[b - 1];
      const baseEl = engine.slots[`base-${b}`];
      const runnerEl = engine.slots[`runner-${b}`];
      if (baseEl) {
        baseEl.style.fill = occupied ? 'var(--accent)' : DOT_OFF;
        baseEl.style.stroke = occupied ? 'none' : 'var(--border)';
      }
      engine.setImage(`runner-${b}`, occupied && names[b - 1] ? charIconUrl(names[b - 1]) : '');
      const changed = occupied !== baseState[b - 1];
      if (changed && occupied && gsap && runnerEl) {
        gsap.fromTo(runnerEl, { transformOrigin: '50% 50%', scale: 0.4, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
      }
      baseState[b - 1] = occupied;
    }
  }

  function bindCondensed(d, vis) {
    engine.setText('c-s1-name', d.p1 || 'Player One');
    engine.setText('c-s2-name', d.p2 || 'Player Two');
    engine.setText('c-s1-score', d.sL);
    engine.setText('c-s2-score', d.sR);
    engine.setImage('c-s1-logo', vis.showTeamLogos ? teamLogoUrl(d.team1) : '');
    engine.setImage('c-s2-logo', vis.showTeamLogos ? teamLogoUrl(d.team2) : '');
    const innEl = engine.slots['c-inn-num'];
    engine.setText('c-inn-num', d.isFinal ? '' : d.inn);
    if (innEl) innEl.setAttribute('opacity', d.isFinal ? '0' : '1');
    if (engine.slots['c-inn-arrow-up'])   engine.slots['c-inn-arrow-up'].setAttribute('opacity', !d.isFinal && d.isTop ? '1' : '0');
    if (engine.slots['c-inn-arrow-down']) engine.slots['c-inn-arrow-down'].setAttribute('opacity', !d.isFinal && !d.isTop ? '1' : '0');
    if (engine.slots['c-final'])          engine.slots['c-final'].setAttribute('opacity', d.isFinal ? '1' : '0');
  }

  // Batter/pitcher game lines, read straight from state (not HUD-gated).
  function resolveLine(state, team, role) {
    const name = role === 'batting' ? g(state, `score.${SB}.batter`, '') : g(state, `score.${SB}.pitcher`, '');
    if (!name) return { icon: '', line: '' };
    let idx = role === 'batting' ? g(state, `score.${SB}.batter_roster_index`, null) : g(state, `score.${SB}.pitcher_roster_index`, null);
    if (idx == null || idx < 0) idx = window.RioData ? RioData.findCharIndex(state, SB, team, name) : -1;
    const lineKey = role === 'batting' ? 'batting_line' : 'pitching_line';
    const line = (idx != null && idx >= 0)
      ? g(state, `score.${SB}.stats.${team}.character.${idx}.current_game.${lineKey}`, '')
      : '';
    return { icon: charIconUrl(name), line: line || '' };
  }

  function bindAtBat(state, d) {
    const bat = resolveLine(state, d.batTeam, 'batting');
    const pit = resolveLine(state, d.pitTeam, 'pitching');
    engine.setImage('bat-icon', bat.icon);
    engine.setText('bat-line', bat.line || '—');
    engine.setImage('pit-icon', pit.icon);
    engine.setText('pit-line', pit.line || '—');
  }

  // The theme authors nine inning columns at fixed x's, sized for a full game.
  // Snapshot those pristine x's once per theme so we can redistribute the ones
  // we actually show — themes space their columns differently (default 112..432,
  // slice26 140..460), so the span endpoints must come from the SVG, not a const.
  function ensureBoxBaseX() {
    if (boxBaseX) return boxBaseX;
    boxBaseX = {};
    for (let i = 1; i <= MAX_INN; i++) {
      const el = engine.slots[`box-h-${i}`] || engine.slots[`box-away-${i}`];
      if (!el) continue;
      const v = parseFloat(el.getAttribute('x'));
      if (!isNaN(v)) boxBaseX[i] = v;
    }
    return boxBaseX;
  }

  function bindBox(d) {
    const base = ensureBoxBaseX();
    // How many inning columns this game warrants: its configured length (so a
    // live game holds a stable width) but never fewer than have been played
    // (extra innings), capped at nine.
    const played = Math.max(d.away.length, d.home.length, 0);
    const sel = parseInt(d.inningsSelected, 10) || 0;
    const shown = Math.min(Math.max(sel, played, 1), MAX_INN);

    // Span the shown columns evenly across the theme's authored first→last x so
    // a short game fills the width instead of leaving the unplayed innings blank.
    const firstX = base[1];
    let lastX = firstX;
    for (let i = MAX_INN; i >= 1; i--) { if (base[i] != null) { lastX = base[i]; break; } }
    const canReflow = firstX != null && lastX != null;
    const step = shown > 1 ? (lastX - firstX) / (shown - 1) : 0;

    for (let i = 1; i <= MAX_INN; i++) {
      const col = engine.slots[`box-col-${i}`];
      const active = i <= shown;
      if (col) col.setAttribute('opacity', active ? '1' : '0');
      if (active && canReflow) {
        const x = shown > 1 ? firstX + step * (i - 1) : (firstX + lastX) / 2;
        for (const s of [`box-h-${i}`, `box-away-${i}`, `box-home-${i}`]) {
          const el = engine.slots[s];
          if (el) el.setAttribute('x', x);
        }
      }
      const a = d.away[i - 1];
      const h = d.home[i - 1];
      engine.setText(`box-away-${i}`, active ? (a != null ? a : '-') : '');
      engine.setText(`box-home-${i}`, active ? (h != null ? h : '-') : '');
    }
    engine.setText('box-away-R', d.sL);
    engine.setText('box-home-R', d.sR);
  }

  function bindHeader(vis) {
    const title = vis.titleText == null ? 'Project Rio' : vis.titleText;
    engine.setText('header-title', title);
    bindImageProbe('logo', OverlayBase.brandingLogoUrl(), 'logo-default');
    return title;
  }

  // ── main update ─────────────────────────────────────────────────────────────
  async function update(state, settings) {
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    if (themeChanged) { revealKey = ''; laidOut = {}; baseState = [false, false, false]; boxBaseX = null; }
    if (disposed) return;

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE, NS);
    else OverlayBase.clearDesignSettings();

    const p1 = g(state, `score.${SB}.player.1.rioName`, '');
    const p2 = g(state, `score.${SB}.player.2.rioName`, '');
    const hasGame = !!(p1 || p2);
    host.style.display = hasGame ? '' : 'none';
    if (!hasGame) { revealKey = ''; return; }

    const vis = readToggles(settings);
    const half = g(state, `score.${SB}.half_inning`, 'Top');
    const gameCompleted = g(state, `score.${SB}.game_completed`, false) === true;
    const sourceType = g(state, `score.${SB}.source_type`, '');
    const isFinal = half === 'Final' || gameCompleted || sourceType === 'completed_api';

    const role1 = window.RioData ? RioData.getTeamRole(state, SB, 1) : 'batting';
    const batTeam = role1 === 'batting' ? 1 : 2;
    const pitTeam = batTeam === 1 ? 2 : 1;

    const modeName = g(settings, `scoreboards.binding.${SB}.stats_tag`, '') || '';
    const stadium = prettyStadium(g(state, `score.${SB}.stadium`, ''));

    const d = {
      p1, p2,
      team1: g(state, `score.${SB}.player.1.logo`, '') || g(state, `score.${SB}.player.1.msb_team`, ''),
      team2: g(state, `score.${SB}.player.2.logo`, '') || g(state, `score.${SB}.player.2.msb_team`, ''),
      sL: g(state, `score.${SB}.score_left`, 0),
      sR: g(state, `score.${SB}.score_right`, 0),
      inn: g(state, `score.${SB}.inning`, ''),
      isTop: half === 'Top',
      isFinal,
      outs: parseInt(g(state, `score.${SB}.outs`, 0)) || 0,
      balls: parseInt(g(state, `score.${SB}.balls`, 0)) || 0,
      strikes: parseInt(g(state, `score.${SB}.strikes`, 0)) || 0,
      r1: g(state, `score.${SB}.cbRioRunnerOn1`, false),
      r2: g(state, `score.${SB}.cbRioRunnerOn2`, false),
      r3: g(state, `score.${SB}.cbRioRunnerOn3`, false),
      r1Name: g(state, `score.${SB}.runner1Name`, ''),
      r2Name: g(state, `score.${SB}.runner2Name`, ''),
      r3Name: g(state, `score.${SB}.runner3Name`, ''),
      away: g(state, `score.${SB}.away_linescore`, []) || [],
      home: g(state, `score.${SB}.home_linescore`, []) || [],
      inningsSelected: g(state, `score.${SB}.innings_selected`, 0),
      batTeam, pitTeam,
    };

    // Phase resolves from the assigned match (score.{N}.phase, projected from
    // the match's round label). A producer-typed phaseText overrides it; when
    // neither is set the field stays blank and the stack closes the gap.
    const matchPhase = (g(state, `score.${SB}.phase`, '') || '').trim();
    const manualPhase = (vis.phaseText || '').trim();
    vis.phaseText = manualPhase || matchPhase;

    vis.isFinal = isFinal;
    vis.hasPhase = !!vis.phaseText;
    vis.hasMode = !!modeName;
    vis.hasStadium = !!stadium;
    vis.hasBox = Array.isArray(d.away) && d.away.length > 0;

    applyColours(settings, g(state, `score.${SB}.player.1.port`, null), g(state, `score.${SB}.player.2.port`, null));

    const title = bindHeader(vis);
    engine.setText('phase', vis.phaseText || '', { optional: true });
    engine.setText('mode', modeName ? modeName.toUpperCase() : '', { optional: true });
    bindMain(state, d, vis);
    bindCondensed(d, vis);
    bindAtBat(state, d);
    bindBox(d);
    engine.setText('stadium', stadium, { optional: true });

    engine.refitText();
    centerHeader(title);
    relayout(vis, themeChanged);

    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      if (!disposed) { engine.refitText(); centerHeader(title); }
    });

    const key = `${theme}|${g(state, `score.${SB}.game_id`, '')}|${p1}|${p2}`;
    if (key !== revealKey) { revealKey = key; gate.requestReveal(); }
  }

  function playReveal() {
    host.classList.remove('sc-reveal');
    void host.offsetWidth;
    host.classList.add('sc-reveal');
  }

  // Gate playReveal behind the OBS on-screen signal: dedupe redundant activates,
  // snap dark on hide, one clean rise per show (see reveal-gate.js).
  const gate = createRevealGate({ host, offClass: 'sc-off', play: playReveal });

  function setShown(shown) { gate.setShown(shown); }

  function dispose() {
    disposed = true;
    gate.dispose();
    window.removeEventListener('resize', engine.refitText);
    host.classList.remove('sc-host', 'sc-reveal');
    host.innerHTML = '';
  }

  window.addEventListener('resize', engine.refitText);
  return { update, setShown, dispose };
}

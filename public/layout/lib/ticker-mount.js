// ticker-mount.js — the re-themable Results Ticker element.
//
// The look lives in the active DESIGN PACKAGE's theme SVG
// (/design/{package}/ticker.svg, element-by-element fallback to `default`).
// A theme is the 1920×80 bar (background, RESULTS badge, edge fades) plus ONE
// prototype game card:
//
//   <g data-slot="track">                    the mount parks card clones here
//   <g data-slot="card-template" data-w="252" opacity="0">   the prototype
//
// Inside the template, parts are marked data-part (all optional):
//   card-bg(rect)  away-cap/home-cap(image)  away-name/home-name(text,data-maxw)
//   score-group(g) score-away/score-home(text)  vs(text|g)  meta(text,data-maxw)
//
// The mount clones the template once per game (repeating the set as many
// times as the visible track needs for a seamless wrap), binds each clone,
// lays clones out at data-w + tickerGap intervals, and scrolls the track with
// a rAF marquee at tickerSpeed px/s (both live-tunable overlay settings).
// Completed games show scores (loser dimmed); otherwise the vs mark. The
// track's visible width may be declared with data-vw on the track group
// (defaults to 1920) so copy-count math survives asymmetric badge layouts.
//
//   const t = mountTicker({ host, sb });
//   t.update(OverlayBase.state, OverlayBase.settings);
//   t.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';

const ELEMENT = 'ticker';
const SETTINGS_TYPE = 'ticker';
const DEFAULT_PACKAGE = 'default';

const FALLBACK_SVG = `
<svg viewBox="0 0 1920 80" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="4" width="1920" height="72" rx="10" style="fill:var(--band,#0b0b12);stroke:var(--border,#1f1f30)"/>
  <g data-slot="track" data-vw="1920"></g>
  <g data-slot="card-template" data-w="300" opacity="0">
    <text data-part="away-name" data-maxw="110" x="10" y="46" style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif)" font-size="18" font-weight="700">Away</text>
    <text data-part="score-away" x="140" y="46" text-anchor="end" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="18" font-weight="700">0</text>
    <text data-part="score-home" x="160" y="46" style="fill:var(--ink,#f5f5f8);font-family:var(--font-mono,monospace)" font-size="18" font-weight="700">0</text>
    <text data-part="home-name" data-maxw="110" x="290" y="46" text-anchor="end" style="fill:var(--ink,#f5f5f8);font-family:var(--font-display,sans-serif)" font-size="18" font-weight="700">Home</text>
  </g>
</svg>`;

const CSS = `
.tk-host { position: fixed; inset: 0; }
.tk-host svg { width: 100%; height: 100%; display: block; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'ticker-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// Uniform auto-fit for cloned <text data-maxw> parts (the engine's refitText
// only tracks top-level data-slot texts, not per-clone parts).
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

export function mountTicker({ host, sb }) {
  injectCss();
  host.classList.add('tk-host');
  const SB = sb || 1;

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });

  let disposed = false;
  let scrollX = 0;
  let lastTs = null;
  let rowWidth = 0;
  let rafId = null;
  let builtSig = '';

  const g = OverlayBase.deepGet;

  function speed(settings) {
    const v = parseFloat(g(settings, `overlays.${SETTINGS_TYPE}.tickerSpeed`, 60));
    return Number.isFinite(v) && v > 0 ? v : 60;
  }
  function gap(settings) {
    const v = parseInt(g(settings, `overlays.${SETTINGS_TYPE}.tickerGap`, 16));
    return Number.isFinite(v) && v >= 0 ? v : 16;
  }

  function part(clone, name) { return clone.querySelector(`[data-part="${name}"]`); }

  function setPartText(clone, name, value, { optional = false } = {}) {
    const el = part(clone, name);
    if (!el) return;
    const v = value == null ? '' : String(value);
    el.textContent = v;
    if (optional) el.setAttribute('opacity', v ? '1' : '0');
    fitText(el);
  }

  function setPartImage(clone, name, url) {
    const el = part(clone, name);
    if (!el) return;
    if (url) {
      el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
      el.setAttribute('href', url);
      el.setAttribute('opacity', '1');
    } else {
      el.removeAttribute('href');
      el.setAttribute('opacity', '0');
    }
  }

  function bindCard(clone, game, showCap) {
    const away = game.away_user || game.away_player || '?';
    const home = game.home_user || game.home_player || '?';
    const aScore = game.away_score;
    const hScore = game.home_score;
    const completed = game.game_completed === true;
    const hasScores = completed && aScore != null && hScore != null;

    setPartText(clone, 'away-name', away);
    setPartText(clone, 'home-name', home);
    setPartImage(clone, 'away-cap', showCap ? RioData.charIconUrl(game.away_captain || game.away_captain_name || '') : '');
    setPartImage(clone, 'home-cap', showCap ? RioData.charIconUrl(game.home_captain || game.home_captain_name || '') : '');

    const scoreG = part(clone, 'score-group');
    const vsEl = part(clone, 'vs');
    if (scoreG) scoreG.setAttribute('opacity', hasScores ? '1' : '0');
    if (vsEl) vsEl.setAttribute('opacity', hasScores ? '0' : '1');
    if (hasScores) {
      setPartText(clone, 'score-away', aScore);
      setPartText(clone, 'score-home', hScore);
      const aEl = part(clone, 'score-away');
      const hEl = part(clone, 'score-home');
      if (aEl) aEl.style.opacity = aScore >= hScore ? '' : '0.5';
      if (hEl) hEl.style.opacity = hScore >= aScore ? '' : '0.5';
    }

    let dateStr = '';
    if (game.date_time_end) {
      const dt = new Date(game.date_time_end);
      if (!isNaN(dt.getTime())) dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    const metaParts = [];
    if (game.stadium) metaParts.push(game.stadium);
    if (dateStr) metaParts.push(dateStr);
    setPartText(clone, 'meta', metaParts.join(' · '), { optional: true });
  }

  function rebuild(games, settings) {
    const track = engine.slots['track'];
    const template = engine.slots['card-template'];
    if (!track || !template) return;

    const cardW = parseFloat(template.getAttribute('data-w')) || 260;
    const gapPx = gap(settings);
    const pitch = cardW + gapPx;
    const viewW = parseFloat(track.getAttribute('data-vw')) || 1920;
    rowWidth = games.length * pitch;

    // Enough repeats of the set that the wrap point is always off-screen.
    const copies = Math.max(2, Math.ceil((viewW + rowWidth) / rowWidth));
    const showCap = OverlayBase.readSetting(SETTINGS_TYPE, 'showCaptains', true) !== false;

    track.innerHTML = '';
    for (let c = 0; c < copies; c++) {
      for (let i = 0; i < games.length; i++) {
        const clone = template.cloneNode(true);
        clone.removeAttribute('data-slot');
        clone.setAttribute('opacity', '1');
        clone.setAttribute('data-x', String((c * games.length + i) * pitch));
        bindCard(clone, games[i], showCap);
        track.appendChild(clone);
      }
    }
    positionClones();
    if (scrollX <= -rowWidth) scrollX = 0;
  }

  function positionClones() {
    const track = engine.slots['track'];
    if (!track) return;
    for (const clone of track.children) {
      const x0 = parseFloat(clone.getAttribute('data-x')) || 0;
      clone.setAttribute('transform', `translate(${x0 + scrollX},0)`);
    }
  }

  function step(ts) {
    if (disposed) return;
    if (lastTs == null) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    if (rowWidth > 0) {
      scrollX -= speed(OverlayBase.settings) * dt;
      if (scrollX <= -rowWidth) scrollX += rowWidth;
      positionClones();
    }
    rafId = requestAnimationFrame(step);
  }

  function ensureLoop() {
    if (rafId == null) rafId = requestAnimationFrame(step);
  }

  async function update(state, settings) {
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    if (themeChanged) builtSig = '';
    if (disposed) return;

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE);
    else OverlayBase.clearDesignSettings();

    const cached = g(state, `scoreboards.rotation.${SB}.cached_games`, []) || [];
    const gameIds = g(state, `scoreboards.rotation.${SB}.game_ids`, []) || [];

    // Index cached games by id and walk game_ids to preserve user order;
    // ongoing-pool ids without a snapshot in the cache are skipped.
    const byId = {};
    for (const gm of cached) {
      if (gm && gm.game_id != null) byId[gm.game_id] = gm;
    }
    const order = (gameIds && gameIds.length) ? gameIds : cached.map(gm => gm?.game_id);
    const games = [];
    for (const id of order) {
      if (byId[id]) games.push(byId[id]);
    }

    host.style.display = games.length ? '' : 'none';
    if (!games.length) { builtSig = ''; return; }

    const sig = [
      theme,
      gap(settings),
      OverlayBase.readSetting(SETTINGS_TYPE, 'showCaptains', true) !== false,
      games.map(gm => `${gm.game_id}:${gm.away_score}-${gm.home_score}:${gm.game_completed}`).join('|'),
    ].join('§');
    if (sig !== builtSig) {
      builtSig = sig;
      rebuild(games, settings);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
        if (!disposed && builtSig === sig) rebuild(games, settings);
      });
    }
    ensureLoop();
  }

  function dispose() {
    disposed = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    host.classList.remove('tk-host');
    host.innerHTML = '';
  }

  return { update, dispose };
}

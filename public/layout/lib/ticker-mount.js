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
//   away-row/home-row(g)   that side's whole cluster, dimmed for the loser
//   away-win/home-win(any) the winner's marker, shown on the winning side only
//   score-group(g) score-away/score-home(text)  vs(text|g)
//   meta(text,data-maxw)   the composed footer (mode + date)
//   stadium(text)          the park, for a theme that wants it drawn
//
// The mount clones the template once per game (repeating the set as many
// times as the visible track needs for a seamless wrap), binds each clone,
// lays clones out at data-w + tickerGap intervals, and scrolls the track with
// a rAF marquee at tickerSpeed px/s (both live-tunable overlay settings).
// Completed games show scores and mark the winner (shared `rowOutcome`);
// otherwise the vs mark. The track's visible width may be declared with
// data-vw on the track group (defaults to 1920) so copy-count math survives
// asymmetric badge layouts.
//
// A CLONE IS BOUND WHILE IT IS IN THE DOCUMENT, never before it is appended.
// A detached node measures as NOTHING rather than as an error -
// getComputedTextLength answers 0, getBBox a zero rect - and both of this
// file's measurements guard on exactly that, so binding first turned the
// auto-fit into `0 > maxw` (false, always) and the pins into an early return.
// Neither had ever run: `VicklessFalcon` drew at its authored 17px, 100.75
// units into a 98-unit budget, ending 1.2 units short of the score plate. It
// is silent, and it only bites on a long tag - which is why
// `ticker-mount.test.js` pins the ORDER rather than any one symptom of it.
//
// A PORTRAIT BESIDE A NAME HAS NO AUTHORABLE x — the name's width is the data
// (`pinBesideText`, the rule the Matchup summary's strip is built on). The
// names anchor INWARD against the fixed score plate so the gap a card's eye
// crosses is constant, and each captain icon is pinned to the measured OUTER
// edge of its name, so what varies with a name's length is the card's outer
// MARGIN rather than a hole in the middle of it. Pins run per clone, after the
// fit, because a fit changes the width being measured.
//
//   const t = mountTicker({ host, sb });
//   t.update(OverlayBase.state, OverlayBase.settings);
//   t.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData).

import { createThemeEngine } from './svg-theme-engine.js';
import { applyPinsIn, rowOutcome } from './mount-utils.js';

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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * What a card knows about a game, as data.
 *
 * `winnerSide` is 1 for AWAY and 2 for HOME — positional, so the shared
 * `rowOutcome` can serve this card and the Matchup summary's. It is the one
 * place in this element where a number stands for away/home, and it has to:
 * a pool game has no fixture, so away/home is the only orientation the API
 * gives us and there is no authored side to translate it into.
 *
 * A tie is UNDECIDED, not a win for the first-listed side: the marker says
 * "this player won", and a 5-5 has nobody to say it about.
 */
export function cardOutcome(game) {
  const a = game?.away_score;
  const h = game?.home_score;
  const hasScores = game?.game_completed === true && a != null && h != null;
  const winnerSide = hasScores && a !== h ? (a > h ? 1 : 2) : null;
  return { hasScores, winnerSide };
}

/**
 * The card's footer: the COMPETITION and the date.
 *
 * Mode, not stadium — the same call the Matchup summary's history cards make
 * ("the mode is the competition and earns its place; the park is flavour a
 * history card does not need"). The park is still bound, to its own `stadium`
 * part, so a theme that wants it only has to draw it.
 *
 * The month is spelled in caps here rather than left to a theme's
 * `text-transform`, because the separator and the mode beside it are content
 * and the date is not: a package that drops the transform should still get a
 * date that matches the one every other Rio element draws.
 */
export function metaLine(game) {
  const out = [];
  if (game?.game_mode) out.push(String(game.game_mode));
  const d = game?.date_time_end ? new Date(game.date_time_end) : null;
  if (d && !Number.isNaN(d.getTime())) out.push(`${MONTHS[d.getMonth()]} ${d.getDate()}`);
  return out.join(' \u00b7 ');
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

  function setPartOpacity(clone, name, value) {
    const el = part(clone, name);
    if (el) el.setAttribute('opacity', value);
  }

  function bindCard(clone, game, showCap) {
    const away = game.away_user || game.away_player || '?';
    const home = game.home_user || game.home_player || '?';
    const { hasScores, winnerSide } = cardOutcome(game);

    setPartText(clone, 'away-name', away);
    setPartText(clone, 'home-name', home);
    setPartImage(clone, 'away-cap', showCap ? RioData.charIconUrl(game.away_captain || game.away_captain_name || '') : '');
    setPartImage(clone, 'home-cap', showCap ? RioData.charIconUrl(game.home_captain || game.home_captain_name || '') : '');

    // The plate itself is the theme's own chrome, drawn whether or not there is
    // a score to put in it — a live card with a hole where every other card has
    // an object is the one thing a marquee cannot afford, because the eye is
    // tracking a repeating shape past a fixed point.
    setPartOpacity(clone, 'score-group', hasScores ? '1' : '0');
    setPartOpacity(clone, 'vs', hasScores ? '0' : '1');
    setPartText(clone, 'score-away', hasScores ? game.away_score : '', { optional: true });
    setPartText(clone, 'score-home', hasScores ? game.home_score : '', { optional: true });

    // WHO WON, drawn rather than inferred. `hasRow` is asked of the THEME, per
    // side, because `-row` and the per-node dim are exclusive and a package is
    // free to declare one, the other or neither — see `rowOutcome`.
    for (const [side, tag] of [[1, 'away'], [2, 'home']]) {
      const row = part(clone, `${tag}-row`);
      const o = rowOutcome(winnerSide, side, { hasRow: !!row });
      if (row) row.setAttribute('opacity', o.row);
      const nameEl = part(clone, `${tag}-name`);
      const scoreEl = part(clone, `score-${tag}`);
      if (nameEl) nameEl.style.fillOpacity = o.name;
      // Not `opacity`: the score is an OPTIONAL part, so setPartText owns its
      // opacity attribute (0 when a live card has no number to show) and a dim
      // written there would be overwritten on the next bind — or, worse, would
      // reveal a blank. fill-opacity multiplies with it correctly.
      if (scoreEl) scoreEl.style.fillOpacity = o.score;
      setPartOpacity(clone, `${tag}-win`, hasScores ? o.win : '0');
    }

    setPartText(clone, 'meta', metaLine(game), { optional: true });
    setPartText(clone, 'stadium', game.stadium || '', { optional: true });

    // After every fit, never before: the auto-fit changes the width a pin is
    // measured against, so the two travel together.
    applyPinsIn(clone, (name) => part(clone, name));
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
    const showCap = OverlayBase.settingOn(OverlayBase.readSetting(SETTINGS_TYPE, 'showCaptains', true), true);

    track.innerHTML = '';
    for (let c = 0; c < copies; c++) {
      for (let i = 0; i < games.length; i++) {
        const clone = template.cloneNode(true);
        clone.removeAttribute('data-slot');
        clone.setAttribute('opacity', '1');
        clone.setAttribute('data-x', String((c * games.length + i) * pitch));
        // APPEND, THEN BIND. Both halves of binding measure: the auto-fit calls
        // getComputedTextLength and the pins call getBBox, and a node outside
        // the document answers 0 to the first and throws/zeroes on the second.
        // Bound detached, `0 > maxw` was false for every name on every card and
        // the fit silently never ran. See the note at the top of this file.
        track.appendChild(clone);
        bindCard(clone, games[i], showCap);
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
    else OverlayBase.clearDesignSettings(SETTINGS_TYPE);

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
    // A results ticker with an empty pool draws nothing — which looks identical
    // to a broken source. Say the pool is empty rather than leaving a producer
    // guessing at the layout.
    OverlayBase.setBlank(
      games.length ? null
        : 'No results to scroll — the ticker’s pool has no games yet (bind or complete some).',
      'Results Ticker',
    );
    if (!games.length) { builtSig = ''; return; }

    const sig = [
      theme,
      gap(settings),
      OverlayBase.settingOn(OverlayBase.readSetting(SETTINGS_TYPE, 'showCaptains', true), true),
      games.map(gm => `${gm.game_id}:${gm.away_score}-${gm.home_score}:${gm.game_completed}:${gm.game_mode || ''}`).join('|'),
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

// matchup-mount.js — the re-themable Matchup History band.
//
// A DIRECT element (its own OBS source). The producer picks a match and hits
// Fetch on the Production page; the server projects the head-to-head into the
// singleton `matchup.*` namespace (server/matchup.py) and this mount binds it
// into the active design package's theme SVG (/design/{package}/matchup.svg,
// element-by-element fallback to `default`). All-time series summary on top,
// up to five most-recent game cards below.
//
//   const mu = mountMatchup({ host });
//   mu.update(OverlayBase.state, OverlayBase.settings);
//   mu.setShown(bool);  // OBS on-screen signal (wire OverlayBase.onObsShown)
//   mu.dispose();
//
// SLOT CONTRACT (elements carrying a data-slot attribute; missing = skipped):
//   logo, logo-default,
//   event-name (optional — start.gg event/tournament name), subtitle (round label),
//   side1-name, side2-name  (Address Book tag, else rioName),
//   side1-sprite, side2-sprite (chosen captain headshots),
//   side1-seed, side2-seed  (optional — bracket seed, e.g. "#1 SEED"),
//   side1-wins, side2-wins, total-games,
//   and per card i ∈ 1..5:
//     game{i}                (group — hidden when there's no i-th game)
//     game{i}-side1-logo / game{i}-side2-logo   (team logo, falls back to captain icon)
//     game{i}-side1-score / game{i}-side2-score (final score; dimmed for the
//                                                loser unless the theme has a -row)
//     game{i}-side1-name / game{i}-side2-name   (optional — the two player names,
//                                                restated per card so a card says
//                                                WHOSE score each number is)
//     game{i}-side1-row / game{i}-side2-row     (optional — the whole row, logo
//                                                included; dimmed for the loser)
//     game{i}-side1-win / game{i}-side2-win     (optional — the winner's marker;
//                                                shown on the winning side only)
//     game{i}-away-name / game{i}-home-name      (optional — away/home-oriented
//     game{i}-away-score / game{i}-home-score       per-game restatement of the two
//     game{i}-away-logo / game{i}-home-logo         sides; awaySide comes from
//     game{i}-away-row / game{i}-home-row           the server)
//     game{i}-away-win / game{i}-home-win
//     game{i}-mode, game{i}-stadium, game{i}-date
//     game{i}-date-full     (optional — date WITH year, e.g. "JUN 1, 2026")
// Text slots may carry data-maxw="<svg-units>" to auto-fit long values.
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData, for icons).
// Scores come pre-oriented to the match's authored sides — the server does all
// derivation at fetch time; this mount only binds values.

import { createThemeEngine } from './svg-theme-engine.js';
import { applyTextPins, rowOutcome, LOSER_DIM } from './mount-utils.js';
import { createRevealGate, clearAnimClassOnEnd } from './reveal-gate.js';

const SETTINGS_TYPE = 'matchup';
const ELEMENT = 'matchup';
const DEFAULT_PACKAGE = 'default';
const MAX_CARDS = 5;
/* `rowOutcome` / `LOSER_DIM` moved to mount-utils.js when the Results
 * Ticker's cards needed the same rule — see the note there. Re-exported so
 * a theme author reading this mount still finds the vocabulary its five
 * history cards are bound with. */
export { rowOutcome, LOSER_DIM };

// Minimal inline fallback if a theme SVG can't be fetched (offline / typo).
const FALLBACK_SVG = `
<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <rect x="48" y="760" width="1824" height="264" rx="16" style="fill:var(--band)"/>
  <rect x="48" y="760" width="10" height="264" style="fill:var(--accent)"/>
  <text data-slot="side1-name" data-maxw="520" x="96" y="836" style="fill:var(--ink);font-family:var(--font-display)" font-size="40" font-weight="700">Player One</text>
  <text data-slot="side1-wins" x="700" y="836" style="fill:var(--ink);font-family:var(--font-mono)" font-size="48" font-weight="700">0</text>
  <text x="960" y="836" text-anchor="middle" style="fill:var(--ink-dim);font-family:var(--font-display)" font-size="30">ALL TIME</text>
  <text data-slot="side2-wins" x="1180" y="836" style="fill:var(--ink);font-family:var(--font-mono)" font-size="48" font-weight="700">0</text>
  <text data-slot="side2-name" data-maxw="520" x="1824" y="836" text-anchor="end" style="fill:var(--ink);font-family:var(--font-display)" font-size="40" font-weight="700">Player Two</text>
  <text data-slot="total-games" x="960" y="980" text-anchor="middle" style="fill:var(--ink-dim);font-family:var(--font-body)" font-size="24">0 GAMES</text>
</svg>`;

const CSS = `
.mu-host { position: fixed; inset: 0; overflow: hidden; }
/* The theme's own box decides the height, and it is pinned to the BOTTOM of the
   source — the same arrangement as the Commentary strip, and for the same
   reason: vertical placement is a scene decision, so the source is the size of
   the thing in it, not the size of the stream. A band-native theme fills the
   source exactly; a theme authored on the full 1920x1080 canvas (Default,
   Classic, and the fallback above) hangs its empty upper canvas out of the top
   where overflow crops it, landing the band in the same place it always was.
   Height 100% would instead have made preserveAspectRatio "meet"-fit a
   1080-tall theme into a 480-tall source and shrink it to a fifth of its size. */
.mu-host svg { position: absolute; left: 0; bottom: 0; width: 100%; height: auto; display: block; }
.mu-host.mu-reveal { animation: mu-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.mu-host.mu-off { opacity: 0 !important; }
@keyframes mu-rise { from { opacity: 0; transform: translateY(36px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .mu-host.mu-reveal { animation: none; } }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'matchup-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

/**
 * How far to slide the cards that ARE shown so they sit in the row the theme
 * authored for all five.
 *
 * The cards are laid out for a full history, left to right, and the mount
 * hides the ones it has no game for — so two meetings drew two cards hard
 * against the left edge and three empty slots of band beside them, which reads
 * as a card row that failed to load rather than a short history. `boxes` is
 * every card's authored extent in order (`{x, w}`, from the theme, never the
 * live transform) and `shown` how many lead the row; the answer is one dx for
 * all of them, so the pitch between cards never changes. Measured rather than
 * assuming an even pitch, so a package that spaces its cards unevenly — or
 * stacks them, where every card shares one x and the answer is 0 — still
 * lands right.
 */
export function cardRowShift(boxes, shown, align = 'center') {
  const all = (boxes || []).filter(b => b && Number.isFinite(b.x) && Number.isFinite(b.w));
  if (!all.length || all.length !== (boxes || []).length) return 0;
  const n = Math.max(0, Math.min(shown | 0, all.length));
  if (!n || n === all.length || align === 'left') return 0;
  const span = (list) => [Math.min(...list.map(b => b.x)), Math.max(...list.map(b => b.x + b.w))];
  const [a0, a1] = span(all);
  const [s0, s1] = span(all.slice(0, n));
  if (align === 'right') return a1 - s1;
  return (a0 + a1) / 2 - (s0 + s1) / 2;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
// Same as fmtDate but with the year — for themes whose cards carry a
// `game{i}-date-full` slot (e.g. the tournament-intro Slice26 band).
function fmtDateFull(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function mountMatchup({ host }) {
  injectCss();
  host.classList.add('mu-host');

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });
  let revealKey = '';
  let disposed = false;

  // rio-data.js loads before this module on every page that mounts the
  // Matchup band (see matchup.html); the window.RioData guard just matches
  // the other mounts' defensive style rather than covering a real load-order
  // gap.
  function charIconUrl(name) { return name && window.RioData ? RioData.charIconUrl(name) : ''; }
  function teamLogoUrl(team) { return team && window.RioData ? RioData.teamLogoUrl(team) : ''; }
  // A card's league logo (server/matchup.py, per that game's mode) leads its
  // well, as a league logo does everywhere; "" on a game that was no league's.
  function leagueLogoUrl(path) { return path ? `${OverlayBase.BASE_URL}${path}` : ''; }

  // Try each candidate URL in order; bind the first that loads, else hide the
  // slot. Used for card logos (team logo → captain icon fallback: the user's
  // asset pack may lack team logos, and quits can leave a game captain-less).
  function setImageFallback(slotName, urls) {
    const el = engine.slots[slotName];
    if (!el) return;
    const candidates = urls.filter(Boolean);
    const tryNext = (i) => {
      if (disposed || el !== engine.slots[slotName]) return; // theme swapped under us
      if (i >= candidates.length) { engine.setImage(slotName, ''); return; }
      const img = new Image();
      img.onload = () => { if (!disposed && el === engine.slots[slotName]) engine.setImage(slotName, candidates[i]); };
      img.onerror = () => tryNext(i + 1);
      img.src = candidates[i];
    };
    tryNext(0);
  }

  function applyColours(settings) {
    // Per-layout accent pin only — the default stays the package's own palette.
    const accent = OverlayBase.deepGet(settings, `overlays.${SETTINGS_TYPE}.accentColor`, null);
    if (accent) host.style.setProperty('--accent', accent);
    else host.style.removeProperty('--accent');
  }

  function bindCard(i, game, name1, name2) {
    const p = `game${i}`;
    const groupEl = engine.slots[p];
    if (groupEl) groupEl.setAttribute('opacity', game ? '1' : '0');
    if (!game) return;

    // Per-card player names — constant across the head-to-head, but some themes
    // (the Slice26 intro band) restate them on every card. Optional slots: no-op
    // for themes whose cards don't carry them.
    engine.setText(`${p}-side1-name`, name1 || '', { optional: true });
    engine.setText(`${p}-side2-name`, name2 || '', { optional: true });

    engine.setText(`${p}-side1-score`, game.side1Score ?? '');
    engine.setText(`${p}-side2-score`, game.side2Score ?? '');

    setImageFallback(`${p}-side1-logo`, [leagueLogoUrl(game.side1LeagueLogo), teamLogoUrl(game.side1Team), charIconUrl(game.side1Captain)]);
    setImageFallback(`${p}-side2-logo`, [leagueLogoUrl(game.side2LeagueLogo), teamLogoUrl(game.side2Team), charIconUrl(game.side2Captain)]);

    // Away/home-oriented mirror of the two sides — for themes (the Slice26 intro
    // band) that stack the AWAY team on top and HOME on the bottom, per game.
    // Optional slots: no-op for side1/side2 themes. awaySide (1|2) comes from the
    // server; default to side 1 when absent.
    const sideName = (s) => (s === 1 ? name1 : name2) || '';
    const sideScore = (s) => (s === 1 ? game.side1Score : game.side2Score) ?? '';
    const sideTeam = (s) => (s === 1 ? game.side1Team : game.side2Team);
    const sideCaptain = (s) => (s === 1 ? game.side1Captain : game.side2Captain);
    const sideLeague = (s) => (s === 1 ? game.side1LeagueLogo : game.side2LeagueLogo);
    const awaySide = game.awaySide === 2 ? 2 : 1;
    const roles = [['away', awaySide], ['home', awaySide === 1 ? 2 : 1]];
    for (const [role, side] of roles) {
      engine.setText(`${p}-${role}-name`, sideName(side), { optional: true });
      engine.setText(`${p}-${role}-score`, sideScore(side), { optional: true });
      setImageFallback(`${p}-${role}-logo`, [leagueLogoUrl(sideLeague(side)), teamLogoUrl(sideTeam(side)), charIconUrl(sideCaptain(side))]);
    }

    // The outcome LAST, in both orientations: setText clears (or sets) opacity,
    // so a dim written before the value it dims is thrown away.
    for (const [role, side] of [['side1', 1], ['side2', 2], ...roles]) {
      const row = engine.slots[`${p}-${role}-row`];
      const o = rowOutcome(game.winnerSide, side, { hasRow: !!row });
      if (row) row.setAttribute('opacity', o.row);
      for (const part of ['name', 'score']) {
        const el = engine.slots[`${p}-${role}-${part}`];
        if (el) el.setAttribute('opacity', o[part]);
      }
      const win = engine.slots[`${p}-${role}-win`];
      if (win) win.setAttribute('opacity', o.win);
    }

    engine.setText(`${p}-mode`, game.gameMode || '', { optional: true });
    engine.setText(`${p}-stadium`, game.stadium || '', { optional: true });
    engine.setText(`${p}-date`, fmtDate(game.date), { optional: true });
    engine.setText(`${p}-date-full`, fmtDateFull(game.date), { optional: true });
  }

  // Slide the shown cards as one block (cardRowShift). Each card's authored
  // extent and transform are read once per theme node and kept on the node, so
  // the answer never depends on where the last render moved it; a theme's own
  // transform on a card is preserved underneath the slide.
  function alignCards(shown, align) {
    const cards = [];
    for (let i = 1; i <= MAX_CARDS; i++) {
      const el = engine.slots[`game${i}`];
      if (!el) return;
      if (!el.hasAttribute('data-cardbox')) {
        let box;
        try { box = el.getBBox(); } catch { box = null; }
        // A zero box is a node that could not be measured (detached, or a
        // renderer without layout) — never cache that, try again next render.
        if (!box || !box.width) return;
        el.setAttribute('data-cardbox', `${box.x},${box.width}`);
        el.setAttribute('data-cardtransform', el.getAttribute('transform') || '');
      }
      const [x, w] = el.getAttribute('data-cardbox').split(',').map(Number);
      cards.push({ el, x, w });
    }
    const dx = cardRowShift(cards, shown, align);
    for (const { el } of cards) {
      const base = el.getAttribute('data-cardtransform') || '';
      const t = dx ? `translate(${dx},0) ${base}`.trim() : base;
      if (t) el.setAttribute('transform', t);
      else el.removeAttribute('transform');
    }
  }

  function playReveal() {
    host.classList.remove('mu-reveal');
    void host.offsetWidth; // reflow so the animation restarts
    host.classList.add('mu-reveal');
    // Drop the class once the rise finishes so the retained end-state transform
    // (fill-mode `both`) doesn't pin the host to a blurry GPU-scaled composited
    // layer — see reveal-gate.js.
    clearAnimClassOnEnd(host, 'mu-reveal');
  }
  // Gate playReveal behind the OBS on-screen signal: dedupe redundant activates,
  // snap dark on hide, one clean rise per show (see reveal-gate.js).
  const gate = createRevealGate({ host, offClass: 'mu-off', play: playReveal });

  async function update(state, settings) {
    const g = OverlayBase.deepGet;
    const mu = g(state, 'matchup', {}) || {};
    const theme = g(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    if (themeChanged) revealKey = '';
    if (disposed) return;

    if (engine.usesAppVars) OverlayBase.applyDesignSettings(SETTINGS_TYPE);
    else OverlayBase.clearDesignSettings(SETTINGS_TYPE);

    // Prefer the Address Book display tag; fall back to the Rio name.
    const name1 = g(mu, 'side1.tag', '') || g(mu, 'side1.rioName', '');
    const name2 = g(mu, 'side2.tag', '') || g(mu, 'side2.rioName', '');
    const hasContent = mu.present && name1 && name2;
    host.style.display = hasContent ? '' : 'none';
    // Say WHY, or the blank source reads as broken. `matchup.present` is set by
    // the Matchup projector once a fixture resolves two participants; without it
    // there is nothing to draw, and with it but a name missing the Address Book
    // hasn't matched a side yet.
    OverlayBase.setBlank(
      hasContent ? null
        : !mu.present ? 'No matchup loaded — push a matchup from Production, or bind a match to a board.'
          : 'Matchup is missing a name on one side — both participants need to resolve in the Address Book.',
      'Matchup',
    );
    if (!hasContent) { revealKey = ''; return; }

    applyColours(settings);

    // The bound match supplies presentation extras the head-to-head data
    // doesn't carry: the label (subtitle) and each side's chosen captain.
    const matchId = mu.matchId != null ? String(mu.matchId) : '';
    const match = matchId ? g(state, `match.${matchId}`, null) : null;

    engine.setText('side1-name', name1);
    engine.setText('side2-name', name2);
    engine.setText('side1-wins', g(mu, 'side1.wins', 0));
    engine.setText('side2-wins', g(mu, 'side2.wins', 0));
    const total = mu.totalGames || 0;
    engine.setText('total-games',
      total === 0 ? 'FIRST MEETING' : `ALL TIME · ${total} GAME${total === 1 ? '' : 'S'}`);
    // Bracket phase text (two rows on the right): the start.gg event/tournament
    // name above, the round label ("Winners Final") below.
    engine.setText('event-name',
      g(state, 'tournamentInfo.event_name', '') || g(state, 'tournamentInfo.name', ''),
      { optional: true });
    engine.setText('subtitle', (match && match.label) || '', { optional: true });

    setImageFallback('side1-sprite', [charIconUrl(match && g(match, 'player.1.captain', ''))]);
    setImageFallback('side2-sprite', [charIconUrl(match && g(match, 'player.2.captain', ''))]);

    // Bracket seeds (from the bound start.gg set) — hidden when unseeded.
    const seedLabel = (n) => (n != null && n !== '') ? `#${n} SEED` : '';
    engine.setText('side1-seed', seedLabel(match && g(match, 'player.1.seed', null)), { optional: true });
    engine.setText('side2-seed', seedLabel(match && g(match, 'player.2.seed', null)), { optional: true });

    // Logo: tournament branding if present, else the theme's default mark.
    const logoUrl = OverlayBase.brandingLogoUrl();
    if (engine.slots['logo']) {
      const img = new Image();
      img.onload = () => { if (!disposed) { engine.setImage('logo', logoUrl); if (engine.slots['logo-default']) engine.slots['logo-default'].setAttribute('opacity', '0'); } };
      img.onerror = () => { if (!disposed) { engine.setImage('logo', ''); if (engine.slots['logo-default']) engine.slots['logo-default'].setAttribute('opacity', '1'); } };
      img.src = logoUrl;
    }

    const games = Array.isArray(mu.games) ? mu.games : [];
    for (let i = 1; i <= MAX_CARDS; i++) bindCard(i, games[i - 1] || null, name1, name2);

    // No shared history → collapse the entire lower region, leaving the top
    // summary only. Themes opt in by (a) wrapping the cards + their divider in a
    // `history` / `history-container` group and (b) providing a compact band
    // background (`band-compact`) swapped in for the full one (`band-full`). All
    // slots are optional: a theme without them keeps its full band with empty
    // cards, exactly as before.
    const hasHistory = games.length > 0;
    for (const name of ['history', 'history-container']) {
      const el = engine.slots[name];
      if (el) el.style.display = hasHistory ? '' : 'none';
    }
    const bandFull = engine.slots['band-full'];
    const bandCompact = engine.slots['band-compact'];
    if (bandFull) bandFull.setAttribute('opacity', hasHistory ? '1' : '0');
    if (bandCompact) bandCompact.setAttribute('opacity', hasHistory ? '0' : '1');
    // After the history group is back on screen — a card inside a display:none
    // group measures as nothing.
    if (hasHistory) alignCards(Math.min(games.length, MAX_CARDS), OverlayBase.readSetting(SETTINGS_TYPE, 'cardAlign', 'center'));

    // Fit, THEN pin: the auto-fit changes the very name width the portraits are
    // measured against, so pinning first pins to a size about to change.
    fitAndPin();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) fitAndPin(); });

    // Reveal only when the fetched identity changes, not on unrelated re-renders.
    const key = `${theme}|${matchId}|${name1}|${name2}|${mu.fetchedAt || ''}`;
    if (key !== revealKey) { revealKey = key; gate.requestReveal(); }
  }

  // The summary's captain portraits sit against the MEASURED edge of each name
  // (data-pin-before / data-pin-after in the theme) — see pinBesideText in
  // mount-utils.js for why no authored x is right in both states. Anything that
  // re-fits has to re-pin, which is why the two travel together.
  function fitAndPin() {
    engine.refitText();
    applyTextPins(engine);
  }

  function setShown(shown) { gate.setShown(shown); }

  function dispose() {
    disposed = true;
    gate.dispose();
    window.removeEventListener('resize', fitAndPin);
    host.classList.remove('mu-host', 'mu-reveal');
    host.innerHTML = '';
  }

  window.addEventListener('resize', fitAndPin);

  return { update, setShown, dispose };
}

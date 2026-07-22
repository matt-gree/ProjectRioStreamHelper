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
//     game{i}-side1-score / game{i}-side2-score (loser dimmed)
//     game{i}-side1-name / game{i}-side2-name   (optional — the two player names,
//                                                restated per card by intro themes)
//     game{i}-away-name / game{i}-home-name      (optional — away/home-oriented
//     game{i}-away-score / game{i}-home-score       per-game restatement of the two
//     game{i}-away-logo / game{i}-home-logo         sides; awaySide comes from server)
//     game{i}-mode, game{i}-stadium, game{i}-date
//     game{i}-date-full     (optional — date WITH year, e.g. "JUN 1, 2026")
// Text slots may carry data-maxw="<svg-units>" to auto-fit long values.
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData, for icons).
// Scores come pre-oriented to the match's authored sides — the server does all
// derivation at fetch time; this mount only binds values.

import { createThemeEngine } from './svg-theme-engine.js';
import { createRevealGate, clearAnimClassOnEnd } from './reveal-gate.js';

const SETTINGS_TYPE = 'matchup';
const ELEMENT = 'matchup';
const DEFAULT_PACKAGE = 'default';
const MAX_CARDS = 5;
const LOSER_DIM = '0.45';

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
.mu-host { position: fixed; inset: 0; }
.mu-host svg { width: 100%; height: 100%; display: block; }
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
    // Dim the loser's score (attribute set AFTER setText, which clears opacity).
    const winner = game.winnerSide;
    const s1 = engine.slots[`${p}-side1-score`];
    const s2 = engine.slots[`${p}-side2-score`];
    if (s1) s1.setAttribute('opacity', winner === 2 ? LOSER_DIM : '1');
    if (s2) s2.setAttribute('opacity', winner === 1 ? LOSER_DIM : '1');

    setImageFallback(`${p}-side1-logo`, [teamLogoUrl(game.side1Team), charIconUrl(game.side1Captain)]);
    setImageFallback(`${p}-side2-logo`, [teamLogoUrl(game.side2Team), charIconUrl(game.side2Captain)]);

    // Away/home-oriented mirror of the two sides — for themes (the Slice26 intro
    // band) that stack the AWAY team on top and HOME on the bottom, per game.
    // Optional slots: no-op for side1/side2 themes. awaySide (1|2) comes from the
    // server; default to side 1 when absent.
    const sideName = (s) => (s === 1 ? name1 : name2) || '';
    const sideScore = (s) => (s === 1 ? game.side1Score : game.side2Score) ?? '';
    const sideTeam = (s) => (s === 1 ? game.side1Team : game.side2Team);
    const sideCaptain = (s) => (s === 1 ? game.side1Captain : game.side2Captain);
    const awaySide = game.awaySide === 2 ? 2 : 1;
    for (const [role, side] of [['away', awaySide], ['home', awaySide === 1 ? 2 : 1]]) {
      engine.setText(`${p}-${role}-name`, sideName(side), { optional: true });
      engine.setText(`${p}-${role}-score`, sideScore(side), { optional: true });
      // Dim the loser's whole row identity (name + score) so the winner reads.
      const dim = winner && winner !== side ? LOSER_DIM : '1';
      const sc = engine.slots[`${p}-${role}-score`];
      if (sc) sc.setAttribute('opacity', dim);
      const nm = engine.slots[`${p}-${role}-name`];
      if (nm) nm.setAttribute('opacity', dim);
      setImageFallback(`${p}-${role}-logo`, [teamLogoUrl(sideTeam(side)), charIconUrl(sideCaptain(side))]);
    }

    engine.setText(`${p}-mode`, game.gameMode || '', { optional: true });
    engine.setText(`${p}-stadium`, game.stadium || '', { optional: true });
    engine.setText(`${p}-date`, fmtDate(game.date), { optional: true });
    engine.setText(`${p}-date-full`, fmtDateFull(game.date), { optional: true });
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
    else OverlayBase.clearDesignSettings();

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

    engine.refitText();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) engine.refitText(); });

    // Reveal only when the fetched identity changes, not on unrelated re-renders.
    const key = `${theme}|${matchId}|${name1}|${name2}|${mu.fetchedAt || ''}`;
    if (key !== revealKey) { revealKey = key; gate.requestReveal(); }
  }

  function setShown(shown) { gate.setShown(shown); }

  function dispose() {
    disposed = true;
    gate.dispose();
    window.removeEventListener('resize', engine.refitText);
    host.classList.remove('mu-host', 'mu-reveal');
    host.innerHTML = '';
  }

  window.addEventListener('resize', engine.refitText);

  return { update, setShown, dispose };
}

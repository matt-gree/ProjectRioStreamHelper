// rosterstats-mount.js — the combined Roster + Stats auto-cycling element.
//
// One per-team OBS source (?scoreboard=N&team=T) that shows the full roster in
// steady state and, on every NEW batter, cross-fades to a stat card for a few
// seconds before returning to the roster. Because getStatsLine(state, sb, team)
// yields the batter's card for the side at bat and the pitcher's card for the
// side on defense, the same batter-change trigger flashes the batter on one
// source and the pitcher on the other. Both views are re-themed by the standalone
// Roster (overlays.roster.*) and Stats (overlays.stats.* + active Design Package)
// settings, so this element matches them automatically.
//
// Transitions are a plain opacity cross-fade — this fires many times per game.
//
//   import { mountRosterStats } from '/layout/lib/rosterstats-mount.js';
//   const m = mountRosterStats({ host, sb, team });
//   m.update(OverlayBase.state, OverlayBase.settings);  // each state/settings tick
//   m.dispose();
//
// Requires overlay-base.js (OverlayBase) + rio-data.js (RioData) loaded first,
// plus roster-mount.js and stats-card-mount.js (imported below).
import { renderRoster } from '/layout/lib/roster-mount.js';
import { mountStatsCard } from '/layout/lib/stats-card-mount.js';

const STATS_W = 452, STATS_H = 118;
const DEFAULT_DWELL = 7;
const FADE_MS = 200; // cross-fade duration (keep in sync with the CSS transition)

const CSS = `
.rs-stage { position: relative; width: 452px; height: 140px; }
.rs-layer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transition: opacity ${FADE_MS}ms ease; }
.rs-roster { filter:
  drop-shadow(0 2px 2px rgba(0,0,0,0.12))
  drop-shadow(0 3px 1px rgba(0,0,0,0.14))
  drop-shadow(0 1px 5px rgba(0,0,0,0.12))
  drop-shadow(0 -1px 2px rgba(0,0,0,0.1));
}
.rs-stats-box { position: relative; width: ${STATS_W}px; height: ${STATS_H}px; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'rosterstats-mount-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

export function mountRosterStats({ host, sb, team }) {
  injectCss();
  const SB = sb || 1;
  const TEAM = team === 2 ? 2 : 1;
  const g = OverlayBase.deepGet;

  // ── DOM: two absolutely-positioned, cross-fading layers ──
  const stage = document.createElement('div');
  stage.className = 'rs-stage';

  const rosterLayer = document.createElement('div');
  rosterLayer.className = 'rs-layer rs-roster';
  const rosterGrid = document.createElement('div');
  rosterLayer.appendChild(rosterGrid);

  const statsLayer = document.createElement('div');
  statsLayer.className = 'rs-layer rs-stats';
  statsLayer.style.opacity = '0';
  const statsBox = document.createElement('div');
  statsBox.className = 'rs-stats-box';
  const cardHost = document.createElement('div');
  // Inline position beats stats-card-mount's `.st-host { position: fixed }` rule,
  // pinning the card inside our 325×120 box instead of the whole viewport.
  cardHost.style.cssText = 'position:absolute; inset:0;';
  statsBox.appendChild(cardHost);
  statsLayer.appendChild(statsBox);

  stage.appendChild(rosterLayer);
  stage.appendChild(statsLayer);
  host.appendChild(stage);

  // Independent card settings namespace (overlays.rosterstats.*), configured
  // separately from the standalone Stats source.
  const statsCard = mountStatsCard({ host: cardHost, sb: SB, team: TEAM, settingsType: 'rosterstats' });

  // ── Auto-cycle state ──
  let phase = 'roster';      // 'roster' | 'stats'
  let lastBatter;            // undefined until first observed (seed, no pop)
  let timer = null;
  let disposed = false;

  function enterStats(settings) {
    phase = 'stats';
    rosterLayer.style.opacity = '0';
    statsLayer.style.opacity = '1';
    const dwell = Number(g(settings, 'overlays.rosterstats.dwellSeconds', DEFAULT_DWELL)) || DEFAULT_DWELL;
    if (timer) clearTimeout(timer);
    timer = setTimeout(exitStats, dwell * 1000);
  }

  function exitStats() {
    timer = null;
    if (disposed) return;
    phase = 'roster';
    statsLayer.style.opacity = '0';
    rosterLayer.style.opacity = '1';
  }

  function update(state, settings) {
    if (disposed) return;
    // Keep both views current every tick; only layer opacity is cycled. This
    // element carries its own roster toggles under overlays.rosterstats.*.
    renderRoster(rosterGrid, { state, settings, sb: SB, team: TEAM, settingsPrefix: 'overlays.rosterstats' });
    statsCard.update(state, settings);

    const batter = g(state, `score.${SB}.batter`, '') || '';

    if (!batter) {
      // No active batter (e.g. between innings). Reset the baseline so the next
      // real batter reads as a change and pops.
      lastBatter = '';
      return;
    }
    if (batter === lastBatter) return;

    if (lastBatter === undefined) {
      // First observation on this page load / source show — seed without popping.
      lastBatter = batter;
      return;
    }

    // A genuinely new batter. Pop only when this side has a card to show.
    const info = window.RioData ? RioData.getStatsLine(state, SB, TEAM) : null;
    if (!info) return; // leave lastBatter so we retry when the card resolves
    lastBatter = batter;
    enterStats(settings);
  }

  function dispose() {
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    try { statsCard.dispose(); } catch (e) { console.warn('[rosterstats] dispose', e); }
    host.replaceChildren();
  }

  return { update, dispose, get phase() { return phase; } };
}

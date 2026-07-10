// fed-container.js — generic shared-container engine.
//
// A "named shared container" (Split-Screen, Stats, …) is a shared overlay whose
// id is its filename stem. The producer feeds an element into it from the
// Production page by writing production.feed.container.<id> = { element,
// scoreboard, …content }. This engine reads that key, mounts the matching
// element renderer into a host element, swaps it when the assignment changes,
// and renders transparent when the slot is empty — so ANY container can host ANY
// supported element.
//
//   import { initFedContainer } from '/layout/lib/fed-container.js';
//   initFedContainer({ host: document.getElementById('host') });
//
// Requires overlay-base.js (and rio-data.js for the stats element) loaded first,
// and the host page's `three` importmap for the hit element.
import { mountHit } from '/layout/lib/hit-mount.js';
import { mountStats } from '/layout/lib/stats-mount.js';
import { mountPostgameCallout } from '/layout/lib/postgame-callout-mount.js';
import { mountPostgameVs } from '/layout/lib/postgame-vs-mount.js';

export function initFedContainer({ host, perf = false, skipState = false }) {
  const CONTAINER_ID = window.location.pathname.replace(/^.*\/([^/]+)\.html?(?:\?.*)?$/, '$1');
  const FEED_KEY = `production.feed.container.${CONTAINER_ID}`;

  let mount = null;
  let mountedElement = null;
  let mountedScoreboard = null;

  function teardown() {
    // Dispose first (frees GL + clears the renderer's own viewport background),
    // then strip the host so nothing — canvas, labels, or the sky gradient that
    // lives as a CSS background on the mounted viewport — can linger.
    try { if (mount) mount.dispose(); } catch (e) { console.warn('[fed-container] dispose', e); }
    mount = null;
    mountedElement = null;
    mountedScoreboard = null;
    host.replaceChildren();
    host.style.background = '';
  }

  // (Re)mount the renderer for `element` if it isn't already the live one. The
  // hit re-mounts per scoreboard so playback/stadium state doesn't leak.
  function ensureMount(element, sb) {
    if (element === mountedElement && (element !== 'hitvisualizer' || sb === mountedScoreboard)) return true;
    teardown();
    if (element === 'hitvisualizer') {
      const viewport = document.createElement('div');
      viewport.style.cssText = 'position:absolute;inset:0;';
      const labels = document.createElement('div');
      labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
      viewport.appendChild(labels);
      host.appendChild(viewport);
      mount = mountHit({ viewport, labels, perf });
    } else if (element === 'stats') {
      mount = mountStats({ host });
    } else if (element === 'postgamecallout') {
      mount = mountPostgameCallout({ host });
    } else if (element === 'postgamevs') {
      mount = mountPostgameVs({ host });
    } else {
      return false; // element not wired for containers yet
    }
    mountedElement = element;
    mountedScoreboard = sb;
    return true;
  }

  function render() {
    const sel = OverlayBase.deepGet(OverlayBase.state, FEED_KEY, null);
    if (!sel || !sel.element) { teardown(); return; }
    const sb = parseInt(sel.scoreboard) || 1;
    if (!ensureMount(sel.element, sb)) { teardown(); return; }
    // Hit takes the scoreboard; stats takes the full selection (which character).
    mount.update(OverlayBase.state, sel.element === 'hitvisualizer' ? sb : sel);
  }

  OverlayBase.init({
    render,
    fetchSettings: true, // stats themes off overlays.* design settings; hit ignores them
    skipState, // preview primes its own state and doesn't want live state racing in
    // This container's assignment, plus any score change (stats read across a
    // scoreboard; hit-mount.update no-ops unless the contact actually changed).
    // tournamentInfo feeds the Game Summary's top match strip.
    shouldRender: (key) => key.startsWith(FEED_KEY) || /^score\.\d+\./.test(key)
      || /^postgame\.\d+\./.test(key) || key.startsWith('tournamentInfo.'),
    shouldRenderSettings: (key) => key.startsWith('overlays.') || key.startsWith('scoreboards.sources.'),
  });

  // Auto-play when this OBS source/scene comes ON screen (scene cut or the
  // source's eye icon). Only a real off→on transition replays: OBS also
  // dispatches the current state right after page load, and replaying on that
  // restarted an animation that had just played on data arrival (the on-load
  // appear/vanish/replay stutter).
  let wasShown;
  OverlayBase.onObsShown((shown) => {
    if (shown && wasShown === false && mount && mount.replay) mount.replay();
    wasShown = shown;
  });
}

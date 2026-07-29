// fed-container.js — generic shared-container engine.
//
// A shared container is one OBS browser source that hosts whichever of its
// MEMBERS the producer feeds it. The producer feeds an element into it from the
// Production page by writing production.feed.container.<id> = { element,
// scoreboard, …content }. This engine reads that key, mounts the matching
// element renderer into a host element, swaps it when the assignment changes,
// and renders transparent when the slot is empty — so ANY container can host ANY
// supported element.
//
//   import { initFedContainer } from '/layout/lib/fed-container.js';
//   initFedContainer({ host: document.getElementById('host') });
//
// Containers are PRODUCER-BUILT: each one is a definition under
// settings.production.container_defs.{id} (name · native size · member roster),
// and container.html renders whichever the URL names. `containerId` is
// therefore passed in from `?container=`; when it isn't, the id falls back to
// the page's own filename stem, which is what keeps the pre-2.0 named shells
// (callout-stage.html, stats-feed.html, split-screen.html) — and any browser
// source still pointing at one — rendering exactly as before.
//
// Requires overlay-base.js (and rio-data.js for the stats element) loaded first,
// and the host page's `three` importmap for the hit element.
import { mountHit } from '/layout/lib/hit-mount.js';
import { mountStats } from '/layout/lib/stats-mount.js';
import { mountPostgameCallout } from '/layout/lib/postgame-callout-mount.js';
import { mountPostgameVs } from '/layout/lib/postgame-vs-mount.js';

// The container id this page is: what `?container=` names, else the filename
// stem. Exported so the shell and the console agree on one derivation.
export function containerIdFromLocation(explicit) {
  if (explicit) return explicit;
  return window.location.pathname.replace(/^.*\/([^/]+)\.html?(?:\?.*)?$/, '$1');
}

/*
 * This container's definition, fetched once before init.
 *
 * It is read here rather than left to OverlayBase's own settings fetch because
 * both things it decides have to be true on the FIRST paint: the page's native
 * size, and which member the sample bundle stands up in demo mode (the bundle
 * is loaded before the settings fetch, by design — a preview must draw its
 * fixture rather than flash empty). A failure is not fatal: with no definition
 * the container still renders whatever is fed to it.
 */
/*
 * A representative occupant per member, for sample mode.
 *
 * A container draws whatever is FED to it, and neither the picker preview nor
 * app-wide demo mode has a live feed to follow — so a container's sample bundle
 * has to name an occupant as well as the captured game behind it. Which member
 * that is comes from the definition's roster (its first), so a producer's own
 * container samples as the thing they built it for.
 *
 * Keyed by the same element ids `ensureMount` switches on: one table, and a
 * member the engine can't mount has no sample either.
 */
const SAMPLE_OCCUPANTS = {
  hitvisualizer:   { file: 'scoreboard', content: { scoreboard: 1 } },
  stats:           { file: 'scoreboard', content: { scoreboard: 1, team: 1, charIndex: 0, role: 'batting' } },
  postgamecallout: { file: 'postgame',   content: { scoreboard: 1, team: 1, charIndex: 0 } },
  postgamevs:      { file: 'postgame',   content: { scoreboard: 1 } },
};

/**
 * This container's sample bundle: the occupant's own captured game, plus the
 * feed key standing that occupant up inside this container.
 *
 * `occupant` is whatever the caller resolved (`?feed=` in a gallery preview,
 * else the definition's first member). With no occupant at all there is
 * nothing to draw, so the bundle is just the game — the container renders
 * transparent, which is the honest sample for an empty container.
 */
export function containerSample(id, occupant) {
  const spec = SAMPLE_OCCUPANTS[occupant];
  if (!spec) return { file: 'scoreboard' };
  return {
    file: spec.file,
    state: { [`production.feed.container.${id}`]: { element: occupant, ...spec.content } },
  };
}

async function fetchDef(id) {
  try {
    const r = await fetch(`${OverlayBase.BASE_URL}/api/v1/settings`);
    if (!r.ok) return null;
    const s = await r.json();
    const d = s?.production?.container_defs?.[id];
    return (d && typeof d === 'object') ? d : null;
  } catch (e) {
    console.warn('[fed-container] container def unavailable:', e.message);
    return null;
  }
}

export async function initFedContainer({
  host, perf = false, sample = null, forceElement = null, previewSel = null,
  containerId = null,
}) {
  const CONTAINER_ID = containerIdFromLocation(containerId);
  const FEED_KEY = `production.feed.container.${CONTAINER_ID}`;
  const def = containerId ? await fetchDef(CONTAINER_ID) : null;

  // A definition-backed container has no size in its CSS — one shell serves
  // every one of them — so it takes the definition's, which is the size the
  // console gave the OBS browser source. Members smaller than the container
  // center inside it and are never scaled.
  if (def?.width && def?.height) {
    document.body.style.width = `${def.width}px`;
    document.body.style.height = `${def.height}px`;
  }

  // A definition-backed container resolves its own sample from its roster; the
  // legacy named shells still pass theirs in literally.
  const sampleSpec = typeof sample === 'function' ? sample(def) : sample;

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
    const live = OverlayBase.deepGet(OverlayBase.state, FEED_KEY, null);
    /*
     * `forceElement` (from ?feed=) — draw THIS occupant whatever the container
     * is actually carrying, against otherwise-live state.
     *
     * Several elements share one container URL, so a preview of one of them
     * resolves to the same page as a preview of its siblings; without naming the
     * occupant, every one of them previews as whatever is currently fed. It
     * overrides only the element, so the rest of the live selection (which
     * board, which character) still applies.
     *
     * `previewSel` (from ?feedsel=) — draw THIS content, whatever (if anything)
     * is fed. A pickable element like Character Spotlight has no live selection
     * until the producer picks one, and picking writes the live container key —
     * i.e. goes ON AIR. That made a no-air preview impossible. The console hands
     * the STANDING INTENT (the character Push would show) here instead, so the
     * preview draws it without touching live state. It layers OVER forceElement's
     * base, so element type still comes from ?feed= and only the content fields
     * (board, team, character, role) are supplied.
     *
     * Both are preview-only by construction: the shells gate them on
     * PREVIEW_MODE, so a browser source on air always follows the real feed.
     */
    const base = forceElement ? { ...(live || {}), element: forceElement } : live;
    const sel = previewSel ? { ...(base || {}), ...previewSel } : base;
    if (!sel || !sel.element) { teardown(); return; }
    const sb = parseInt(sel.scoreboard) || 1;
    if (!ensureMount(sel.element, sb)) { teardown(); return; }
    // Hit takes the scoreboard; stats takes the full selection (which character).
    mount.update(OverlayBase.state, sel.element === 'hitvisualizer' ? sb : sel);
  }

  OverlayBase.init({
    render,
    fetchSettings: true, // stats themes off overlays.* design settings; hit ignores them
    sample: sampleSpec, // a captured game plus the occupant standing in it
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

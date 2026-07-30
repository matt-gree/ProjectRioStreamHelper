// fed-container.js — generic shared-container engine.
//
// A shared container is one OBS browser source that hosts whichever of its
// MEMBERS the producer feeds it. The producer feeds an element into it from the
// Production page by writing production.feed.container.<id> = { element,
// scoreboard, …content }. This engine reads that key, stands up the matching
// member, cross-fades to it when the assignment changes, and renders transparent
// when the slot is empty — so ANY container can host ANY member below.
//
//   import { initFedContainer } from '/layout/lib/fed-container.js';
//   initFedContainer({ host: document.getElementById('host'), containerId: 'lower-bar' });
//
// Containers are PRODUCER-BUILT: each one is a definition under
// settings.production.container_defs.{id} (name · native size · member roster ·
// scope), and container.html renders whichever the URL names. `containerId` is
// therefore passed in from `?container=`; when it isn't, the id falls back to
// the page's own filename stem, which is what keeps the pre-2.0 named shells
// (callout-stage.html, stats-feed.html, split-screen.html) — and any browser
// source still pointing at one — rendering exactly as before.
//
// THIS FILE IS THE REGISTRY AND THE WIRING. The layer mechanics — one retained
// layer per member, native-size centering, the cross-fade, which member gets
// updated — live in container-layers.js, which imports nothing and is unit
// tested. They used to be an if-chain in here, where a test could not reach
// them and every new member meant editing control flow.
//
// Requires overlay-base.js (and rio-data.js for the stats member) loaded first,
// and the host page's `three` importmap for the hit member.
import { createLayers, resolveFeed } from '/layout/lib/container-layers.js';
import { mountHit } from '/layout/lib/hit-mount.js';
import { mountStats } from '/layout/lib/stats-mount.js';
import { mountPostgameCallout } from '/layout/lib/postgame-callout-mount.js';
import { mountPostgameVs } from '/layout/lib/postgame-vs-mount.js';

/*
 * ── The member registry ──────────────────────────────────────────────────
 *
 * Every element a container can stand up, in ONE table: how to mount it, what
 * its update takes, its native pixel size, and the sample occupant that lets a
 * container preview itself with no game running.
 *
 * This is the engine's half of a fact the console also holds
 * (`CONTAINER_MEMBERS` and the element registry in src/routes/production).
 * There is no shared module between `public/layout/lib` and `src/`, so
 * `containers.test.jsx` pins the two together — same ids, same sizes, no member
 * the console offers that this cannot mount.
 *
 * See container-layers.js for the full entry contract. `size` is the member's
 * NATIVE size: a member smaller than its container centers inside it and is
 * never scaled.
 */
const MEMBERS = {
  hitvisualizer: {
    size: [1280, 720],
    // A GL renderer wants a viewport plus a non-scaling label plane over it, so
    // it builds its own two divs inside the box rather than taking it directly.
    mount: (box, { perf }) => {
      const viewport = document.createElement('div');
      viewport.style.cssText = 'position:absolute;inset:0;';
      const labels = document.createElement('div');
      labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
      viewport.appendChild(labels);
      box.appendChild(viewport);
      return mountHit({ viewport, labels, perf });
    },
    // The hit reads a whole board's contact, not a content selection.
    payload: (sel) => Number(sel.scoreboard) || 1,
    // …and it caches stadium geometry and playback per board, so a board change
    // is a separate mount rather than an update.
    identity: (sel) => `hitvisualizer:${Number(sel.scoreboard) || 1}`,
    sample: { file: 'scoreboard', content: { scoreboard: 1 } },
  },
  stats: {
    size: [325, 120],
    mount: (box) => mountStats({ host: box }),
    sample: {
      file: 'scoreboard',
      content: { scoreboard: 1, team: 1, charIndex: 0, role: 'batting' },
    },
  },
  postgamecallout: {
    size: [1920, 1080],
    mount: (box) => mountPostgameCallout({ host: box }),
    sample: { file: 'postgame', content: { scoreboard: 1, team: 1, charIndex: 0 } },
  },
  postgamevs: {
    size: [1920, 1080],
    mount: (box) => mountPostgameVs({ host: box }),
    sample: { file: 'postgame', content: { scoreboard: 1 } },
  },
};

// The container id this page is: what `?container=` names, else the filename
// stem. Exported so the shell and the console agree on one derivation.
export function containerIdFromLocation(explicit) {
  if (explicit) return explicit;
  return window.location.pathname.replace(/^.*\/([^/]+)\.html?(?:\?.*)?$/, '$1');
}

/*
 * This source's SCOPE — the frame of reference it renders in, off its own URL.
 *
 * Every source of one definition shares one feed key, so the feed says WHAT to
 * show and the URL says WHOSE: two `?team=`-scoped sources of the same container
 * flash the same member for the same trigger, one resolving to the batter and
 * the other to the pitcher. Only the params actually present are returned, so an
 * unscoped container (the common case) leaves the pushed payload authoritative
 * exactly as before.
 */
export function scopeFromParams(params) {
  const scope = {};
  const sb = parseInt(params?.get?.('scoreboard'), 10);
  const team = parseInt(params?.get?.('team'), 10);
  if (Number.isFinite(sb)) scope.scoreboard = sb;
  if (Number.isFinite(team)) scope.team = team;
  return Object.keys(scope).length ? scope : null;
}

/**
 * This container's sample bundle: the occupant's own captured game, plus the
 * feed key standing that occupant up inside this container.
 *
 * A container draws whatever is FED to it, and neither the picker preview nor
 * app-wide demo mode has a live feed to follow — so the bundle has to name an
 * occupant as well as the game behind it. `occupant` is whatever the caller
 * resolved (`?feed=` in a gallery preview, else the definition's first member),
 * so a producer's own container samples as the thing they built it for.
 *
 * With no occupant at all there is nothing to draw, so the bundle is just the
 * game — the container renders transparent, which is the honest sample for an
 * empty container.
 */
export function containerSample(id, occupant) {
  const spec = MEMBERS[occupant];
  if (!spec?.sample) return { file: 'scoreboard' };
  return {
    file: spec.sample.file,
    state: {
      [`production.feed.container.${id}`]: { element: occupant, ...spec.sample.content },
    },
  };
}

/*
 * This container's definition, fetched once before init.
 *
 * It is read here rather than left to OverlayBase's own settings fetch because
 * everything it decides has to be true on the FIRST paint: the page's native
 * size, the box each member is centered in, and which member the sample bundle
 * stands up in demo mode (the bundle is loaded before the settings fetch, by
 * design — a preview must draw its fixture rather than flash empty). A failure
 * is not fatal: with no definition the container still renders whatever is fed
 * to it, sized from its own page.
 */
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
  containerId = null, scope = null,
}) {
  const CONTAINER_ID = containerIdFromLocation(containerId);
  const FEED_KEY = `production.feed.container.${CONTAINER_ID}`;
  const def = containerId ? await fetchDef(CONTAINER_ID) : null;

  // A definition-backed container has no size in its CSS — one shell serves
  // every one of them — so it takes the definition's, which is the size the
  // console gave the OBS browser source.
  if (def?.width && def?.height) {
    document.body.style.width = `${def.width}px`;
    document.body.style.height = `${def.height}px`;
  }

  /*
   * The box members center in. The DEFINITION governs where there is one: it is
   * the size the console created the OBS source at, and it stays right even if
   * the producer later resized that source's canvas by hand. A pre-2.0 named
   * shell has no definition, so it measures its own page — which is how
   * split-screen.html keeps filling its 960×1080 body with a 1280×720 hit
   * instead of centering an overflowing box in it.
   */
  const container = (def?.width && def?.height)
    ? { width: def.width, height: def.height }
    : {
      width: document.body.clientWidth || window.innerWidth,
      height: document.body.clientHeight || window.innerHeight,
    };

  const layers = createLayers({ host, registry: MEMBERS, container });

  // A definition-backed container resolves its own sample from its roster; the
  // legacy named shells still pass theirs in literally.
  const sampleSpec = typeof sample === 'function' ? sample(def) : sample;

  async function render() {
    const live = OverlayBase.deepGet(OverlayBase.state, FEED_KEY, null);
    const sel = resolveFeed({ live, forceElement, previewSel, scope });
    if (!sel) {
      layers.clear();
      OverlayBase.setBlank('nothing is fed to this container', CONTAINER_ID);
      return;
    }
    if (!await layers.show(sel.element, sel, { state: OverlayBase.state, perf })) {
      layers.clear();
      OverlayBase.setBlank(`"${sel.element}" is not a member this container can render`, CONTAINER_ID);
      return;
    }
    OverlayBase.setBlank(null, CONTAINER_ID);
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
  // appear/vanish/replay stutter). Only the member on screen replays — the idle
  // ones are retained, not shown.
  let wasShown;
  OverlayBase.onObsShown((shown) => {
    if (shown && wasShown === false) {
      const live = layers.active();
      if (live && typeof live.mount.replay === 'function') live.mount.replay();
    }
    wasShown = shown;
  });
}

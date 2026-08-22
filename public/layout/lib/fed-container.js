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
// THIS FILE IS THE WIRING, AND ONLY THAT. Two neighbours own the rest, and both
// import nothing so both are unit tested directly:
//
//   container-members.js  WHAT can be stood up — size, sample, mount. Each mount
//                         is a dynamic import(), which is what lets the console
//                         and its tests read this table instead of regex-parsing
//                         it out of a file that drags in three.js and GSAP.
//   container-layers.js   The layer MECHANICS — one retained layer per member,
//                         native-size centering, the cross-fade, which member
//                         gets updated.
//
// Both used to live in here: the mechanics as an if-chain no test could reach,
// the registry beside static mount imports no test could load.
//
// Requires overlay-base.js (and rio-data.js for the roster/stats members)
// loaded first, and the host page's `three` importmap for the hit member.
import { createLayers, resolveFeed } from '/layout/lib/container-layers.js';
import { MEMBERS } from '/layout/lib/container-members.js';

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

/*
 * Make a container shell obey the same contract every other PRSH Layout does:
 * lay out against your viewport.
 *
 * A container renders its members at their NATIVE size and centers them —
 * deliberately, because scaling members relative to one another is what a
 * roster must never do (see container-layers.js). On air that is exactly right:
 * the OBS source is the container's own size, so native IS the viewport.
 *
 * A PREVIEW is the one place those two numbers differ on purpose. The console's
 * preview panel renders the source into a much smaller iframe as a scale model
 * (ScaledIframe), and a shell that ignores its viewport drew a 1920×1080 frame
 * into a 480×270 box — the producer saw a crop of the middle, not the overlay.
 *
 * So in PREVIEW_MODE only, the whole host is scaled uniformly to fit, which is
 * precisely what OBS itself does with an under-sized source: one transform over
 * the entire container, every member keeping its authored geometry and its
 * position relative to every other member. It is not a member scaling system
 * and must not become one — the roster's "smaller members center, nothing ever
 * scales" rule is untouched, because this scales the frame they all sit in.
 *
 * Left alone outside preview so nothing about the on-air path changes.
 */
function fitHostForPreview(host, container) {
  if (!host || !OverlayBase.PREVIEW_MODE) return host;
  const { width: cw, height: ch } = container;
  if (!(cw > 0 && ch > 0)) return host;
  /*
   * The scale goes on an INSERTED wrapper, never on `#host` itself. Every shell
   * styles #host `position: fixed`, and a transform on a fixed element makes it
   * a containing block — in that state the whole subtree (these scenes are
   * heavy on backdrop-filter) can fail to paint and the preview renders solid
   * black. Verified: at native size the same page draws fine, scaled it went
   * black. A plain absolutely-positioned child transforms without that hazard.
   *
   * The wrapper is the container's true size, so it is what createLayers and
   * the member mounts' own PREVIEW_MODE autoScale measure — they see native and
   * scale(1), and this one transform does all the fitting. One authority.
   */
  const fitBox = document.createElement('div');
  fitBox.className = 'fc-fit';
  fitBox.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;transform-origin:top left;`;
  host.appendChild(fitBox);
  const fit = () => {
    const s = Math.min(window.innerWidth / cw, window.innerHeight / ch) || 1;
    const dx = Math.round((window.innerWidth - cw * s) / 2);
    const dy = Math.round((window.innerHeight - ch * s) / 2);
    fitBox.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
  };
  fit();
  window.addEventListener('resize', fit);
  return fitBox;
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

  const layerHost = fitHostForPreview(host, container);

  const layers = createLayers({ host: layerHost, registry: MEMBERS, container });

  // A definition-backed container resolves its own sample from its roster; the
  // legacy named shells still pass theirs in literally.
  const sampleSpec = typeof sample === 'function' ? sample(def) : sample;

  async function render() {
    const live = OverlayBase.deepGet(OverlayBase.state, FEED_KEY, null);
    const sel = resolveFeed({ live, forceElement, previewSel });
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
    shouldRenderSettings: (key) => key.startsWith('overlays.') || key === 'project_rio.hud_enabled',
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

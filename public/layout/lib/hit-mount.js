// hit-mount.js — shared mount for the RioVisualizer HitRenderer.
//
// Both the dedicated overlay (public/layout/hitvisualizer/hitvisualizer.html)
// and the fed split-screen shared source (public/layout/shared/split-screen.html)
// drive the renderer identically: load the stadium on demand, auto-play each new
// contact (score.{N}.hit.id), and re-fire on the producer's replay nonce. Keeping
// that logic here means both surfaces share one code path.
//
// Requires overlay-base.js to be loaded first (uses the global OverlayBase for
// BASE_URL + deepGet). The host HTML must declare the `three` importmap so
// renderer.js can resolve its bare 'three' import.
//
//   const mount = mountHit({ viewport, labels, perf });
//   mount.update(OverlayBase.state, scoreboardNumber);  // call on each state tick
//   mount.dispose();                                     // tear down (e.g. feed cleared)
import { HitRenderer } from '/rio-visualizer/renderer.js';

export function mountHit({ viewport, labels, perf = false }) {
  const renderer = new HitRenderer({
    viewport, labels, orbit: false, cinematic: true, viewMode: 'stream', perf,
  });

  let loadedStadium = null;
  let lastHitId = null;
  let lastReplayNonce = null;
  let stadiumSeq = 0;

  async function loadStadium(name) {
    loadedStadium = name;
    const seq = ++stadiumSeq;
    try {
      const resp = await fetch(`${OverlayBase.BASE_URL}/api/v1/visualizer/stadium/${encodeURIComponent(name)}`);
      if (!resp.ok) { console.warn('[hitvisualizer] stadium fetch failed', name, resp.status); return; }
      const json = await resp.json();
      if (seq !== stadiumSeq) return; // a newer stadium was requested
      renderer.setStadium(name, json);
    } catch (e) {
      console.warn('[hitvisualizer] stadium fetch error', e.message);
    }
  }

  // Drive the renderer from current State for the given scoreboard. Safe to call
  // on every state tick: it no-ops until a hit exists and only rebuilds when the
  // contact (hit.id) or the producer's replay nonce actually changes.
  function update(state, scoreboard) {
    const hit = OverlayBase.deepGet(state, `score.${scoreboard}.hit`, null);
    if (!hit || !Array.isArray(hit.path) || hit.path.length === 0) return;

    if (hit.stadium && hit.stadium !== loadedStadium) {
      loadStadium(hit.stadium);
    }

    // A new contact (hit.id changed) builds the scene and auto-plays once.
    if (hit.id !== lastHitId) {
      lastHitId = hit.id;
      lastReplayNonce = hit.replay_nonce ?? null; // adopt current nonce; don't double-fire
      renderer.setHit({
        paths: [{ points: hit.path, final: hit.landing || hit.path[hit.path.length - 1] }],
        random_points: [],
        fielders: [],
      });
    } else if ((hit.replay_nonce ?? null) !== lastReplayNonce) {
      // Producer hit Replay — re-fire the same contact.
      lastReplayNonce = hit.replay_nonce ?? null;
      renderer.replay();
    }
  }

  // Re-fire the currently loaded contact, if any. Used when the OBS source/scene
  // becomes active so the hit plays on cut-in (no-op before the first contact).
  function replay() {
    if (lastHitId !== null) renderer.replay();
  }

  function dispose() {
    renderer.dispose();
  }

  return { renderer, update, replay, dispose };
}

// reveal-gate.js — shared show/hide + reveal sequencing for CSS-reveal
// elements (Lower Third, Vertical Scorecard, Scoreboard, Matchup History).
//
// These mounts reveal by restarting a CSS animation on the host (remove class,
// reflow, add class). Left ungated, OBS stutters them. The forensics, from
// obs-browser's SetShowing() (no "Shutdown source when not visible"):
//
//   • Eye OFF dispatches `obsSourceVisibleChanged(false)` and then immediately
//     calls WasHidden(true) — CEF stops producing frames in the same beat our
//     snap-dark handler runs, so the dark frame usually never gets painted and
//     the source's retained GPU texture keeps the last FULL-ALPHA frame.
//   • Eye ON composites that stale texture instantly, then Invalidate() paints
//     our current (dark) DOM, then a wall-clock reveal timer fires — the
//     appear → vanish → reappear stutter.
//   • Worse, anything started on the wall clock while frames haven't resumed
//     runs the animation down invisibly — "final position, no animation".
//
// Two answers, split across layers:
//
//   1. HERE: reveals start on the PAINT clock. The play is scheduled through
//      requestAnimationFrame — rAF callbacks queue while a source is hidden
//      and only run once OBS is compositing frames again, so the animation's
//      t=0 always lands on a frame that is actually seen.
//   2. IN THE APP: before disabling a PRSH browser source, the Production page
//      cues `overlay.conceal` (see overlay-base.js onObsShown) so a transparent
//      frame is painted while the source is still live — the retained texture
//      can then never flash stale content on the next show. (The OBS-native
//      eye can't be intercepted; enabling "Shutdown source when not visible"
//      gives those sources a fresh — and therefore clean — load per show.)
//
// The gate owns one boolean: is the element allowed to be seen right now.
// While gated off, an `offClass` on the host forces opacity 0 (!important, so
// it beats the reveal animation's fill) — updates keep binding data underneath,
// but no frame OBS composites can ever show stale full-alpha content. A show
// holds the gate closed through OBS's on→off→on dispatch burst (settleMs),
// then opens it on the next painted frame and plays exactly one reveal.
// Mirrors commentary-mount's setActive machinery.
//
//   const gate = createRevealGate({ host, offClass: 'lt-off', play: playReveal });
//   gate.requestReveal();          // update(): content identity changed
//   gate.setShown(bool);           // shell wires OverlayBase.onObsShown here
//   gate.dispose();
//
// Callers add the offClass CSS themselves, next to their reveal keyframes:
//   .lt-host.lt-off { opacity: 0 !important; }

export function createRevealGate({ host, offClass, play, settleMs = 120 }) {
  // Per-source opt-out: `?intro=0` on the browser-source URL disables the reveal
  // animation entirely. With no animation there is nothing to stutter — a
  // retained full-alpha OBS texture on re-show is just the (correct) resting
  // content — so the gate becomes a pass-through: never gate dark, never play.
  // The app pairs this with `shutdown:false` on the OBS source (see obs.jsx) so
  // the source stays resident instead of reloading, which is what a persistent
  // overlay (e.g. an always-on scoreboard) wants. Content stays visible because
  // the host's resting CSS is its shown state; the reveal only animates INTO it.
  if (new URLSearchParams(window.location.search).get('intro') === '0') {
    host.classList.remove(offClass);
    return { requestReveal() {}, setShown() {}, dispose() { host.classList.remove(offClass); } };
  }

  let wantShown = true;    // desired on-screen state; OBS events drive it
  let presented = false;   // a reveal has played and the element is showing
  let owed = false;        // a reveal must play at the next painted opportunity
  let settleTimer = null;
  let raf = null;
  let disposed = false;

  function cancelSettle() {
    if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
  }
  function cancelRaf() {
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
  }

  // Queue the reveal on the paint clock. If the page is hidden (or OBS has
  // stopped this source's frames), the callback simply waits — no wall-clock
  // fallback, because a reveal that starts before frames flow is a reveal
  // nobody sees. This also self-defers the "loaded while hidden" case the old
  // visibilitychange listener existed for.
  function scheduleReveal() {
    owed = true;
    presented = false;
    if (raf !== null) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      if (disposed || !wantShown || !owed) return;
      host.classList.remove(offClass);
      play();
      presented = true;
      owed = false;
    });
  }

  // Content identity changed (new match/game/theme). Play at the next painted
  // frame if we're on screen and no settle window is open; otherwise remember,
  // and the next show transition plays it.
  function requestReveal() {
    if (disposed) return;
    if (wantShown && settleTimer === null) scheduleReveal();
    else { owed = true; presented = false; }
  }

  // OBS on-screen signal (or any host-page equivalent). Semantics:
  //   • hide      → snap dark NOW, cancel anything scheduled.
  //   • show while already presented → ignore (a redundant activate — e.g.
  //     OBS's initial dispatch after load — must not restart a live reveal).
  //   • show otherwise → hold dark through the dispatch burst, then reveal
  //     once, on the paint clock. The synchronous re-gate guarantees no stale
  //     full-alpha frame can composite during the settle window.
  function setShown(next) {
    if (disposed) return;
    wantShown = next;
    if (!next) {
      cancelSettle();
      cancelRaf();
      if (presented) owed = true;   // was live — replay on the next show
      presented = false;
      host.classList.add(offClass);
      return;
    }
    if (presented && settleTimer === null) return;
    host.classList.add(offClass);
    cancelSettle();
    cancelRaf();
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!disposed && wantShown) scheduleReveal();
    }, settleMs);
  }

  function dispose() {
    disposed = true;
    cancelSettle();
    cancelRaf();
    host.classList.remove(offClass);
  }

  return { requestReveal, setShown, dispose };
}

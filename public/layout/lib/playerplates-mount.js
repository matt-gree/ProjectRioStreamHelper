// playerplates-mount.js — the re-themable SVG Player Plates element.
//
// A DIRECT element (its own OBS source). A sibling of commentary-mount.js: the
// same plate + sub-plate convention, built on the shared svg-theme-engine.js,
// but a fixed TWO-player band instead of a variable-count caster row. The
// producer (Production page) picks a MODE and each plate's content; the server
// projector (server/playerplates.py) resolves everything and writes:
//
//   playerplates.mode                       "both" | "p1" | "p2"  (display only)
//   playerplates.{1,2}.name                 resolved player name (main plate)
//   playerplates.{1,2}.subLabel / .subValue sub-plate label + value
//   playerplates.{1,2}.subVisible           show the sub plate
//   playerplates.{1,2}.location             "left" | "center" | "right"
//   playerplates.{1,2}.active               whether this plate is on this mode
//
// The mode is fully resolved server-side: each side's `location` and `active`
// already fold it in (both → side1 LEFT / side2 RIGHT; single modes → the shown
// side at its own location). So this mount positions purely from `location` and
// shows purely from `active`; it never reads the mode.
//
// The theme comes from the active DESIGN PACKAGE (overlays.global.designPackage):
// /design/{package}/playerplates.svg, falling back to the built-in `default`.
//
// THEME CONTRACT — see public/design/README.md. Short version: two position
// groups data-slot="side1"/"side2", each with data-part="main-rect" (and
// optionally "rail"), data-slot="side{n}-name" / "side{n}-sub" (the GSAP wipe
// target) / "side{n}-sub-label" / "side{n}-sub-value". BOTH plates authored at
// the LEFT anchor; a `<script data-layouts>` block maps each anchor name
// (left/center/right) to an X OFFSET the mount tweens the plate's transform to.

import { createThemeEngine } from './svg-theme-engine.js';
import { ensureGsap } from './gsap-loader.js';

const ELEMENT = 'playerplates';
const DEFAULT_PACKAGE = 'default';
const SIDES = ['side1', 'side2'];       // physical slot ids, index 0/1 → state side 1/2
const DEFAULT_ANCHORS = { left: 0, center: 582, right: 1164 };

// Motion vocabulary (mirrors commentary): a plate ENTERS by rising up into place
// with a slight settle-overshoot; EXITS by dropping down and fading; a location
// change GLIDES horizontally. The sub plate SLIDES + fades (no clip-path) so it
// reads as tucking out from behind its main plate.
const MOVE_DURATION  = 0.42;
const ENTER_DURATION = 0.46;
const EXIT_DURATION  = 0.34;
const SUB_DURATION   = 0.34;
const ENTER_RISE = 48;   // svg units a newcomer rises from (below → into place)
const EXIT_DROP  = 140;  // svg units a leaver slides down by — off the bottom of frame
const SUB_RISE   = 16;   // svg units the sub rests hidden at / slides in from
const SUB_TUCK   = 44;   // svg units the sub travels UP on retract (tucks behind main)
const INTRO_STAGGER = 0.06; // s between the two plates on a whole-group reveal
const REVEAL_SETTLE_MS = 120; // ms to let an OBS visibility on→off→on burst settle
const INTRO = new URLSearchParams(location.search).get('intro') !== '0'; // `?intro=0` disables the reveal: plates snap in with no cascade. Paired with shutdown:false on the OBS source (obs.jsx) so it stays resident.
const SUB_DIVIDER_INSET = 22; // svg units the optional sub-divider is inset from each end
const DIVIDER_REF_WIDTH = 560; // sub-divider width whose draw speed is the reference
const MOVE_EASE    = 'power3.inOut';
const ENTER_EASE   = 'back.out(1.5)';
const EXIT_EASE    = 'power3.in';
const SUB_IN_EASE  = 'back.out(1.7)';
const SUB_OUT_EASE = 'power3.in';

// Minimal inline fallback if a theme SVG can't be fetched (offline / typo) — same
// slot/part names as a real theme, so binding never silently no-ops.
const FALLBACK_SVG = `
<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <g data-slot="side1" opacity="0">
    <rect data-part="main-rect" x="48" y="896" width="660" height="168" rx="12" style="fill:var(--card-bg,#1a1a1a);stroke:var(--border-color,#444)"/>
    <text data-slot="side1-name" data-maxw="572" x="84" y="972" style="fill:var(--text-primary,#fff)" font-size="36" font-weight="800"></text>
    <g data-slot="side1-sub" style="opacity:0">
      <text data-slot="side1-sub-label" x="84" y="1008" style="fill:var(--accent,#f59e0b)" font-size="14" font-weight="700"></text>
      <text data-slot="side1-sub-value" data-maxw="486" x="170" y="1008" style="fill:var(--text-primary,#fff)" font-size="18" font-weight="600"></text>
    </g>
  </g>
  <g data-slot="side2" opacity="0">
    <rect data-part="main-rect" x="48" y="896" width="660" height="168" rx="12" style="fill:var(--card-bg,#1a1a1a);stroke:var(--border-color,#444)"/>
    <text data-slot="side2-name" data-maxw="572" x="84" y="972" style="fill:var(--text-primary,#fff)" font-size="36" font-weight="800"></text>
    <g data-slot="side2-sub" style="opacity:0">
      <text data-slot="side2-sub-label" x="84" y="1008" style="fill:var(--accent,#f59e0b)" font-size="14" font-weight="700"></text>
      <text data-slot="side2-sub-value" data-maxw="486" x="170" y="1008" style="fill:var(--text-primary,#fff)" font-size="18" font-weight="600"></text>
    </g>
  </g>
  <script type="application/json" data-layouts="1">{ "anchors": { "left": 0, "center": 582, "right": 1164 } }</script>
</svg>`;

const CSS = `
.pp-host { position: fixed; inset: 0; }
.pp-host svg { width: 100%; height: 100%; display: block; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'playerplates-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

export function mountPlayerPlates({ host }) {
  injectCss();
  host.classList.add('pp-host');

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });
  let anchors = DEFAULT_ANCHORS;                 // anchor-name → x offset (from layout-data)
  let firstPaint = true;
  const prevActive = [false, false];             // per side: shown last update
  const prevLocation = ['left', 'right'];        // per side: anchor last laid out
  const prevName = ['', ''];                     // per side: name last bound
  const prevSub = [false, false];                // per side: sub-visibility last update
  const subTweens = [null, null];                // in-flight GSAP sub tween per side
  let presented = false;        // whether the band is currently revealed on screen
  let wantShown = true;         // desired shown-state; OBS visibility drives it
  let settleTimer = null;       // debounce: collapses OBS's on→off→on burst into one reveal
  let revealRaf = null;         // paint-clock handle: reveal starts on a composited frame
  let gsapInstance = null;
  let disposed = false;

  function parseAnchors() {
    const script = host.querySelector('script[data-layouts]');
    if (!script) return DEFAULT_ANCHORS;
    try {
      const data = JSON.parse(script.textContent);
      return (data && data.anchors) || DEFAULT_ANCHORS;
    } catch { return DEFAULT_ANCHORS; }
  }

  async function getGsap() {
    if (!gsapInstance) gsapInstance = await ensureGsap();
    return gsapInstance;
  }

  const offsetFor = (loc) => (anchors[loc] != null ? anchors[loc] : (anchors.left || 0));

  // ── plate position + show/hide ─────────────────────────────────────────────
  function snapPlate(i, visible, offset) {
    const g = engine.slots[SIDES[i]];
    if (!g) return;
    if (gsapInstance) gsapInstance.set(g, { opacity: visible ? 1 : 0, x: offset, y: 0 });
    else { g.setAttribute('opacity', visible ? '1' : '0'); g.setAttribute('transform', `translate(${offset},0)`); }
  }

  function enterPlate(i, offset, delay = 0) {
    const g = engine.slots[SIDES[i]];
    if (!g) return;
    if (!gsapInstance) { snapPlate(i, true, offset); return; }
    gsapInstance.killTweensOf(g);
    gsapInstance.set(g, { opacity: 0, x: offset, y: ENTER_RISE });
    gsapInstance.to(g, { opacity: 1, y: 0, duration: ENTER_DURATION, ease: ENTER_EASE, delay, overwrite: 'auto' });
  }

  function exitPlate(i) {
    const g = engine.slots[SIDES[i]];
    if (!g) return;
    if (!gsapInstance) { g.setAttribute('opacity', '0'); return; }
    gsapInstance.killTweensOf(g);
    gsapInstance.to(g, { y: EXIT_DROP, duration: EXIT_DURATION, ease: EXIT_EASE, overwrite: 'auto' });
    gsapInstance.to(g, { opacity: 0, duration: EXIT_DURATION * 0.5, delay: EXIT_DURATION * 0.5, ease: 'power2.in', overwrite: 'auto' });
  }

  function movePlate(i, offset) {
    const g = engine.slots[SIDES[i]];
    if (!g) return;
    if (gsapInstance) gsapInstance.to(g, { x: offset, duration: MOVE_DURATION, ease: MOVE_EASE, overwrite: 'auto' });
    else g.setAttribute('transform', `translate(${offset},0)`);
  }

  // ── sub plate: slide + fade + optional divider draw (ported from commentary) ─
  function drawDivider(i, visible, animate) {
    const subEl = engine.slots[`${SIDES[i]}-sub`];
    const div = subEl && subEl.querySelector('[data-part="sub-divider"]');
    if (!div) return;
    if (div._fw == null) {
      const w = parseFloat(div.getAttribute('width')) || 0;
      div._cx = (parseFloat(div.getAttribute('x')) || 0) + w / 2;
      div._fw = Math.max(0, w - 2 * SUB_DIVIDER_INSET);
    }
    const fw = div._fw;
    const w = visible ? fw : 0;
    const x = visible ? div._cx - fw / 2 : div._cx;
    if (animate && gsapInstance && fw > 0) {
      const dur = SUB_DURATION * Math.max(0.4, fw / DIVIDER_REF_WIDTH);
      gsapInstance.to(div, { attr: { x, width: w }, overwrite: 'auto', duration: dur, ease: visible ? 'power2.out' : 'power2.in', delay: visible ? dur * 0.15 : 0 });
    } else if (gsapInstance) {
      gsapInstance.set(div, { attr: { x, width: w }, overwrite: 'auto' });
    } else {
      div.setAttribute('x', String(x));
      div.setAttribute('width', String(w));
    }
  }

  function snapSub(i, visible) {
    const el = engine.slots[`${SIDES[i]}-sub`];
    if (!el) return;
    if (subTweens[i]) { subTweens[i].kill(); subTweens[i] = null; }
    if (gsapInstance) gsapInstance.set(el, { opacity: visible ? 1 : 0, y: visible ? 0 : -SUB_RISE });
    else el.style.opacity = visible ? '1' : '0';
    drawDivider(i, visible, false);
  }

  function animateSub(i, visible, onDone) {
    const el = engine.slots[`${SIDES[i]}-sub`];
    if (!el) return;
    if (!gsapInstance) { snapSub(i, visible); onDone?.(); return; }
    if (subTweens[i]) { subTweens[i].kill(); subTweens[i] = null; }
    drawDivider(i, visible, true);
    if (visible) {
      subTweens[i] = gsapInstance.to(el, {
        opacity: 1, y: 0, duration: SUB_DURATION, ease: SUB_IN_EASE,
        onComplete: () => { subTweens[i] = null; onDone?.(); },
      });
    } else {
      const tl = gsapInstance.timeline({
        onComplete: () => { gsapInstance.set(el, { y: -SUB_RISE }); subTweens[i] = null; onDone?.(); },
      });
      tl.to(el, { y: -SUB_TUCK, duration: SUB_DURATION, ease: SUB_OUT_EASE }, 0);
      tl.to(el, { opacity: 0, duration: SUB_DURATION * 0.55, ease: 'power2.in' }, SUB_DURATION * 0.45);
      subTweens[i] = tl;
    }
  }

  async function update(state, settings) {
    const theme = OverlayBase.deepGet(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    // Palette policy (see svg-theme-engine.js): only an app-vars theme is painted
    // with the user's Design-tab variables; a fixed-palette theme must never.
    if (engine.usesAppVars) OverlayBase.applyDesignSettings('playerplates');
    else OverlayBase.clearDesignSettings();
    if (themeChanged) {
      anchors = parseAnchors();
      firstPaint = true;
      prevActive[0] = prevActive[1] = false;
      prevSub[0] = prevSub[1] = false;
      presented = false;   // new SVG injected → next first paint re-reveals
    }
    if (disposed) return;

    // Read the two projected sides.
    const sides = [1, 2].map((t) => {
      const base = `playerplates.${t}`;
      return {
        active: !!OverlayBase.deepGet(state, `${base}.active`, false),
        name: OverlayBase.deepGet(state, `${base}.name`, ''),
        subLabel: OverlayBase.deepGet(state, `${base}.subLabel`, ''),
        subValue: OverlayBase.deepGet(state, `${base}.subValue`, ''),
        subVisible: !!OverlayBase.deepGet(state, `${base}.subVisible`, false),
        location: OverlayBase.deepGet(state, `${base}.location`, t === 1 ? 'left' : 'right'),
      };
    });

    const anyActive = sides.some((s) => s.active);
    // Neither plate is active → the band draws nothing. Unlike most overlays it
    // never sets display:none (the plates animate out individually), so an idle
    // source and a broken one look the same; say which in the preview.
    OverlayBase.setBlank(
      anyActive ? null
        : 'No player plate is active — activate a side from the Player Plates desk in Production.',
      'Player Plates',
    );
    if (anyActive || firstPaint) await getGsap();
    if (disposed) return;

    // Only paint visible plates while the source is actually revealed on screen
    // (same invariant as commentary: while hidden, bind text but keep opacity 0,
    // and let the pending reveal cascade the CURRENT lineup in — no stale
    // full-alpha frame for OBS to composite first on the next show).
    const live = presented && wantShown;

    for (let i = 0; i < SIDES.length; i++) {
      const d = sides[i];
      const offset = offsetFor(d.location);
      const wasActive = prevActive[i];

      if (!d.active) {
        if (wasActive && live) exitPlate(i);
        else snapPlate(i, false, offset);
        if (subTweens[i]) { subTweens[i].kill(); subTweens[i] = null; }
        prevActive[i] = false;
        prevSub[i] = false;
        prevLocation[i] = d.location;
        prevName[i] = '';
        continue;
      }

      engine.setText(`${SIDES[i]}-name`, d.name);

      const nameChanged = d.name !== prevName[i];
      if (firstPaint) {
        // Lay out at rest but HIDDEN; the staggered rise fires after the loop via
        // playGroupReveal — the same path an OBS activate uses.
        snapPlate(i, false, offset);
      } else if (!wasActive) {
        snapPlate(i, false, offset);              // stage at anchor, dark
        if (live) enterPlate(i, offset);          // then rise in
      } else {
        if (d.location !== prevLocation[i]) {
          if (live) movePlate(i, offset);         // glide to the new anchor
          else snapPlate(i, true, offset);
        }
      }

      // Sub plate. On a snap (first paint / new plate / name change) set text +
      // slide state together; on a live toggle animate; keep a live value current.
      const showSub = !!d.subVisible && !!d.subValue;
      if (firstPaint || !wasActive || nameChanged) {
        engine.setText(`${SIDES[i]}-sub-label`, d.subLabel);
        engine.setText(`${SIDES[i]}-sub-value`, d.subValue);
        snapSub(i, showSub);
      } else if (prevSub[i] !== showSub) {
        if (!live) {
          engine.setText(`${SIDES[i]}-sub-label`, showSub ? d.subLabel : '');
          engine.setText(`${SIDES[i]}-sub-value`, showSub ? d.subValue : '');
          snapSub(i, showSub);
        } else if (showSub) {
          engine.setText(`${SIDES[i]}-sub-label`, d.subLabel);
          engine.setText(`${SIDES[i]}-sub-value`, d.subValue);
          animateSub(i, true);
        } else {
          animateSub(i, false, () => {
            engine.setText(`${SIDES[i]}-sub-label`, '');
            engine.setText(`${SIDES[i]}-sub-value`, '');
          });
        }
      } else if (showSub) {
        engine.setText(`${SIDES[i]}-sub-label`, d.subLabel);
        engine.setText(`${SIDES[i]}-sub-value`, d.subValue);
      }

      prevActive[i] = true;
      prevSub[i] = showSub;
      prevLocation[i] = d.location;
      prevName[i] = d.name;
    }

    if (firstPaint) {
      firstPaint = false;
      if (wantShown) scheduleGroupReveal();
      else presented = false;
    }

    engine.refitText();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) engine.refitText(); });
  }

  // ── whole-group reveal, for OBS source visibility (ported from commentary) ──
  function scheduleGroupReveal() {
    if (revealRaf !== null) return;
    revealRaf = requestAnimationFrame(() => {
      revealRaf = null;
      if (!disposed && wantShown) playGroupReveal();
    });
  }

  function playGroupReveal() {
    if (disposed) return;
    if (!gsapInstance) { getGsap().then(() => { if (!disposed && wantShown) scheduleGroupReveal(); }); return; }
    let order = 0;
    for (let i = 0; i < SIDES.length; i++) {
      const g = engine.slots[SIDES[i]];
      if (g) gsapInstance.killTweensOf(g);
      if (prevActive[i]) {
        if (INTRO) enterPlate(i, offsetFor(prevLocation[i]), (order++) * INTRO_STAGGER);
        else snapPlate(i, true, offsetFor(prevLocation[i]));   // intro disabled: snap shown
      } else snapPlate(i, false, offsetFor(prevLocation[i]));
    }
    presented = true;
  }

  function hideGroupNow() {
    presented = false;
    for (let i = 0; i < SIDES.length; i++) {
      if (subTweens[i]) { subTweens[i].kill(); subTweens[i] = null; }
      const g = engine.slots[SIDES[i]];
      if (!g) continue;
      if (gsapInstance) { gsapInstance.killTweensOf(g); gsapInstance.set(g, { opacity: 0, y: 0 }); }
      else g.setAttribute('opacity', '0');
    }
  }

  // OBS source (or its scene) went active/inactive. See commentary-mount for the
  // full rationale — the invariant that kills the eye-toggle stutter is: whenever
  // we want to show but haven't revealed yet, the plates are already at opacity 0.
  function setActive(active) {
    wantShown = active;
    if (!active) {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (revealRaf !== null) { cancelAnimationFrame(revealRaf); revealRaf = null; }
      hideGroupNow();
      return;
    }
    if (presented && settleTimer === null) return;
    if (!INTRO) {
      // No intro animation: snap in on the next painted frame, no dark settle.
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (revealRaf !== null) { cancelAnimationFrame(revealRaf); revealRaf = null; }
      scheduleGroupReveal();
      return;
    }
    hideGroupNow();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!disposed && wantShown) scheduleGroupReveal();
    }, REVEAL_SETTLE_MS);
  }

  function onVisibility() {
    if (!document.hidden && wantShown && !presented && settleTimer === null) scheduleGroupReveal();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function dispose() {
    disposed = true;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (revealRaf !== null) { cancelAnimationFrame(revealRaf); revealRaf = null; }
    for (const t of subTweens) t?.kill();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', engine.refitText);
    host.classList.remove('pp-host');
    host.innerHTML = '';
  }

  window.addEventListener('resize', engine.refitText);

  return { update, setActive, dispose };
}

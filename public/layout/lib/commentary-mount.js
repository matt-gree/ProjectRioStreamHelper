// commentary-mount.js — the re-themable SVG Commentary element.
//
// A DIRECT element (its own OBS source). The producer assigns up to 4 casters
// from the registry on the Talent tab; this mount renders them as a row of
// "plates" that COMPACT to however many casters are currently active (1-4) —
// dropping a caster mid-show isn't a hole in the row, the remaining plates
// reflow to fill the space, and adding one wipes a new plate in. Built on the
// shared svg-theme-engine.js (the same pattern as lowerthird-mount.js).
//
// The theme comes from the active DESIGN PACKAGE
// (overlays.global.designPackage): /design/{package}/commentary.svg, falling
// back element-by-element to the built-in `default` package.
//
//   const cm = mountCommentary({ host });
//   cm.update(OverlayBase.state, OverlayBase.settings);
//   cm.dispose();
//
// THEME CONTRACT — see public/design/README.md. Short version:
// 4 position groups data-slot="slot{0-3}", each with data-part="main-rect" (and
// optionally "rail" / "sub-rect"), data-slot="slot{i}-name" / "slot{i}-sub"
// (wrapper — the GSAP wipe target) / "slot{i}-sub-label" / "slot{i}-sub-value".
// A `<script type="application/json" data-layouts>` block maps caster COUNT
// (1-4, as a string key) to an array of per-position geometry/gradient/text
// targets; the mount GSAP-tweens between them when the active count changes
// (never a hard cut). First paint — and any time the OBS source goes active
// (see setActive()) — plays a staggered group reveal instead of snapping; a
// theme swap re-snaps to the new theme and the next reveal cascades in.

import { createThemeEngine } from './svg-theme-engine.js';
import { ensureGsap } from './gsap-loader.js';

const ELEMENT = 'commentary';
const DEFAULT_PACKAGE = 'default';
const MAX_SLOTS = 4;

// Motion vocabulary. A plate ENTERS by rising up into place with a slight
// settle-overshoot; EXITS by dropping down and fading; the row REFLOWS (plates
// that stay active resize/reposition) with an ease-in-out glide. Enter/exit and
// reflow are sequenced so a fading plate and a moving plate never share space:
// growing → survivors reflow first, the newcomer rises in after; shrinking →
// the leaver drops out first, survivors reflow into the gap after. The sub
// plate SLIDES + fades (no clip-path) so it reads as tucking out from behind
// its main plate.
const REFLOW_DURATION = 0.4;
const ENTER_DURATION  = 0.46;
const EXIT_DURATION   = 0.34;
const SUB_DURATION    = 0.34;
const ENTER_RISE = 48;   // svg units a newcomer rises from (below → into place)
const EXIT_DROP  = 140;  // svg units a leaver slides down by — off the bottom of frame
const SUB_RISE   = 16;   // svg units the sub slides in from / rests hidden at
const SUB_TUCK   = 44;   // svg units the sub travels UP on retract (tucks behind main)
const INTRO_STAGGER = 0.06; // s between adjacent plates on a whole-group reveal (first paint / OBS source activate) so they cascade in rather than pop as one block
const REVEAL_SETTLE_MS = 120; // ms to let an OBS visibility toggle's on→off→on burst settle before revealing, so one toggle = one clean cascade (not a start/reset/start stutter)
const INTRO = new URLSearchParams(location.search).get('intro') !== '0'; // `?intro=0` disables the reveal animation entirely: plates snap in with no cascade. Paired with shutdown:false on the OBS source (obs.jsx) for persistent, non-reloading sources.
const SUB_DIVIDER_INSET = 22; // svg units the optional sub-divider is inset from each end of the sub width
const DIVIDER_REF_WIDTH = 181; // sub-divider width whose draw speed is the reference (count-4); wider bars scale their duration up to keep px/s (and the feel) constant across counts
const REFLOW_EASE  = 'power3.inOut';
const ENTER_EASE   = 'back.out(1.5)';
const EXIT_EASE    = 'power3.in';   // accelerate away, motion-led (not a dissolve)
const SUB_IN_EASE  = 'back.out(1.7)';
const SUB_OUT_EASE = 'power3.in';
// Overlap the sequenced phases slightly for snappiness — a survivor is already
// mostly settled / a leaver mostly gone before the paired phase starts.
const ENTER_DELAY  = REFLOW_DURATION * 0.55;  // newcomer waits for reflow (grow)
const RESHUFFLE_DELAY = EXIT_DURATION * 0.7;   // survivors wait for exit (shrink)

// Minimal inline fallback if a theme SVG can't be fetched (offline / typo) —
// same slot/part names as a real theme, with a trivial 1-count layout, so
// binding doesn't silently no-op and a missing theme never goes blank.
const FALLBACK_SVG = `
<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
  <g data-slot="slot0" opacity="0">
    <rect data-part="main-rect" x="16" y="896" width="1888" height="168" rx="16" style="fill:var(--card-bg, #1a1a1a);stroke:var(--border-color, #444)" />
    <text data-slot="slot0-name" data-maxw="1836" x="48" y="972" style="fill:var(--text-primary, #fff);font-family:var(--font-family, sans-serif)" font-size="30" font-weight="800"></text>
    <g data-slot="slot0-sub" style="opacity:0">
      <text data-slot="slot0-sub-label" x="48" y="1002" style="fill:var(--accent, #f59e0b)" font-size="13" font-weight="700"></text>
      <text data-slot="slot0-sub-value" data-maxw="1760" x="124" y="1002" style="fill:var(--text-primary, #fff)" font-size="18" font-weight="600"></text>
    </g>
  </g>
  <g data-slot="slot1" opacity="0"></g>
  <g data-slot="slot2" opacity="0"></g>
  <g data-slot="slot3" opacity="0"></g>
  <script type="application/json" data-layouts="1">
  { "counts": { "1": [ { "main": {"x":16,"width":1888}, "name": {"x":48,"maxw":1836}, "subLabel": {"x":48}, "subValue": {"x":124,"maxw":1760} } ] } }
  </script>
</svg>`;

const CSS = `
.cm-host { position: fixed; inset: 0; }
.cm-host svg { width: 100%; height: 100%; display: block; }
`;

let _cssInjected = false;
function injectCss() {
  if (_cssInjected) return;
  const s = document.createElement('style');
  s.id = 'commentary-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _cssInjected = true;
}

// Geometry/gradient targets that get tweened (or snapped) onto a plate when
// it's laid out for the current count. Each entry: [data-part selector, JSON
// key in the layout entry, attribute names to apply].
const GEOMETRY_PARTS = [
  ['main-rect', 'main', ['x', 'width']],
  ['rail', 'rail', ['x']],
  ['sub-rect', 'sub', ['x', 'width']],
];
// Text slots (relative to slot{i}): JSON key, slot-name suffix, whether maxw applies.
const TEXT_PARTS = [
  ['name', 'name', true],
  ['subLabel', 'sub-label', false],
  ['subValue', 'sub-value', true],
];

export function mountCommentary({ host }) {
  injectCss();
  host.classList.add('cm-host');

  const engine = createThemeEngine({ host, element: ELEMENT, fallbackSvg: FALLBACK_SVG });
  let layoutData = null;                                // parsed <script data-layouts> JSON for the current theme
  let prevN;                                             // active-caster count from the previous update (undefined = first paint)
  let prevSlotCaster = new Array(MAX_SLOTS).fill(undefined); // caster NAME occupying each PHYSICAL slot (stable per caster across reflows)
  let prevLayoutPos  = new Array(MAX_SLOTS).fill(-1);    // layout-position (rank) each slot was rendered at last update
  let prevSub = new Array(MAX_SLOTS).fill(undefined);    // diffed sub-visibility per slot
  const subTweens = new Array(MAX_SLOTS).fill(null);     // in-flight GSAP wipe tween per position
  let presented = false;        // whether the strip is currently revealed on screen (OBS active / first paint)
  let wantShown = true;         // desired shown-state; OBS visibility drives it, defaults shown for a plain browser
  let settleTimer = null;       // debounce handle: collapses OBS's on→off→on visibility burst into one reveal
  let revealRaf = null;         // paint-clock handle: the reveal starts on a composited frame, never the wall clock
  let gsapInstance = null;
  let disposed = false;

  function parseLayoutData() {
    const script = host.querySelector('script[data-layouts]');
    if (!script) return null;
    try { return JSON.parse(script.textContent); } catch { return null; }
  }

  // ensureGsap dedupes in-flight loads itself, so a concurrent caller awaits
  // the same script load instead of proceeding with null (which silently
  // dropped animation on whichever interleaved update lost the race).
  async function getGsap() {
    if (!gsapInstance) gsapInstance = await ensureGsap();
    return gsapInstance;
  }

  function tweenOrSet(el, attrs, animate, delay = 0) {
    if (!el) return;
    if (animate && gsapInstance) {
      gsapInstance.to(el, { attr: attrs, duration: REFLOW_DURATION, ease: REFLOW_EASE, delay });
    } else {
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    }
  }

  // Apply (or animate toward) the geometry/gradient/text targets for one
  // position, per the current theme's layout-data entry for this count.
  function applyLayout(pos, entry, animate, delay = 0, subShown = false) {
    const g = engine.slots[`slot${pos}`];
    if (!g || !entry) return;

    for (const [part, key, attrNames] of GEOMETRY_PARTS) {
      const data = entry[key];
      if (!data) continue;
      const el = g.querySelector(`[data-part="${part}"]`);
      if (!el) continue;
      const attrs = {};
      for (const a of attrNames) if (data[a] != null) attrs[a] = data[a];
      tweenOrSet(el, attrs, animate, delay);
    }

    // Optional sub-divider: a theme drops a <rect data-part="sub-divider"> in the
    // sub group; the mount stores its centre (_cx) + full width (_fw), derived
    // from the sub geometry inset from each end (never edge-to-edge). The mount
    // OWNS the bar's rendered extent. Here we only set it on a count reflow
    // (animate), gliding to the sub's current shown state; first-paint and
    // show/hide draws go through drawDivider so the two paths never fight over
    // x/width (that fight was the "wrong spot / not appearing" bug).
    if (entry.sub && entry.sub.x != null && entry.sub.width != null) {
      const divEl = g.querySelector('[data-part="sub-divider"]');
      if (divEl) {
        divEl._cx = entry.sub.x + entry.sub.width / 2;
        divEl._fw = Math.max(0, entry.sub.width - 2 * SUB_DIVIDER_INSET);
        if (animate) {
          const w = subShown ? divEl._fw : 0;
          tweenOrSet(divEl, { x: divEl._cx - w / 2, width: w }, true, delay);
        }
      }
    }

    for (const [key, slotSuffix, hasMaxw] of TEXT_PARTS) {
      const data = entry[key];
      const el = engine.slots[`slot${pos}-${slotSuffix}`];
      if (!data || !el) continue;
      if (hasMaxw && data.maxw != null) el.setAttribute('data-maxw', String(data.maxw));
      if (data.x != null) tweenOrSet(el, { x: data.x }, animate, delay);
    }

    if (entry.grad) {
      // ONE gradient per position, shared by main-rect + sub-rect (userSpaceOnUse,
      // x1/x2 = the MAIN rect's bounds) so the sub plate's color reads as a
      // continuation of the main plate's ramp, not its own independent gradient —
      // see the GRADIENT NOTE in slice26.svg. Never split this into separate
      // main/sub gradients with objectBoundingBox units.
      const grEl = host.querySelector(`#grad-${pos}`);
      if (grEl) {
        const stops = grEl.querySelectorAll('stop');
        if (stops[0]) tweenOrSet(stops[0], { 'stop-color': entry.grad.from }, animate, delay);
        if (stops[1]) tweenOrSet(stops[1], { 'stop-color': entry.grad.to }, animate, delay);
        if (entry.main) {
          tweenOrSet(grEl, { x1: entry.main.x, x2: entry.main.x + entry.main.width }, animate, delay);
        }
      }
    }
  }

  // ── sub plate: slide + fade (never clip-path — GSAP interpolates inset()
  // poorly, and a vertical slide can't shift a horizontal userSpaceOnUse
  // gradient, so the sub's colour stays seamless with its main plate). Hidden =
  // tucked up behind main + transparent; shown = settled in place + opaque.
  // The optional sub-divider draws/undraws from its middle out by animating its
  // WIDTH (and x, to stay centred) between 0 and its full extent — NOT a scaleX
  // transform, whose cached origin drifted when the bar's geometry changed under
  // it. Duration scales with the bar's width so every count draws at the same
  // visual speed (a wide count-1 bar takes proportionally longer than a narrow
  // count-4 bar). overwrite:'auto' lets a re-show cancel an in-flight retract.
  function drawDivider(pos, visible, animate) {
    const subEl = engine.slots[`slot${pos}-sub`];
    const div = subEl && subEl.querySelector('[data-part="sub-divider"]');
    if (!div) return;
    const cx = div._cx != null ? div._cx
      : (parseFloat(div.getAttribute('x')) || 0) + (parseFloat(div.getAttribute('width')) || 0) / 2;
    const fw = div._fw != null ? div._fw : (parseFloat(div.getAttribute('width')) || 0);
    const w = visible ? fw : 0;
    const x = visible ? cx - fw / 2 : cx;
    if (animate && gsapInstance && fw > 0) {
      const dur = SUB_DURATION * Math.max(0.4, fw / DIVIDER_REF_WIDTH);
      gsapInstance.to(div, {
        attr: { x, width: w }, overwrite: 'auto',
        duration: dur, ease: visible ? 'power2.out' : 'power2.in',
        delay: visible ? dur * 0.15 : 0,
      });
    } else if (gsapInstance) {
      // Snap, but via gsap.set+overwrite so it cancels any in-flight reflow
      // tween on the same attrs (count change + identity snap on one frame).
      gsapInstance.set(div, { attr: { x, width: w }, overwrite: 'auto' });
    } else {
      div.setAttribute('x', String(x));
      div.setAttribute('width', String(w));
    }
  }

  function snapSub(pos, visible) {
    const el = engine.slots[`slot${pos}-sub`];
    if (!el) return;
    if (subTweens[pos]) { subTweens[pos].kill(); subTweens[pos] = null; }
    if (gsapInstance) gsapInstance.set(el, { opacity: visible ? 1 : 0, y: visible ? 0 : -SUB_RISE });
    else { el.style.opacity = visible ? '1' : '0'; }
    drawDivider(pos, visible, false);
  }

  function animateSub(pos, visible, onDone) {
    const el = engine.slots[`slot${pos}-sub`];
    if (!el) return;
    if (!gsapInstance) { snapSub(pos, visible); onDone?.(); return; }
    if (subTweens[pos]) { subTweens[pos].kill(); subTweens[pos] = null; }
    drawDivider(pos, visible, true);
    if (visible) {
      subTweens[pos] = gsapInstance.to(el, {
        opacity: 1, y: 0, duration: SUB_DURATION, ease: SUB_IN_EASE,
        onComplete: () => { subTweens[pos] = null; onDone?.(); },
      });
    } else {
      // Retract: slide UP decisively (tucks behind its main plate on cascading
      // themes) with the fade weighted to the tail so it reads as a slide-away,
      // not a dissolve. Reset to the short hidden offset once gone so the next
      // reveal still slides in from its usual distance.
      const tl = gsapInstance.timeline({
        onComplete: () => { gsapInstance.set(el, { y: -SUB_RISE }); subTweens[pos] = null; onDone?.(); },
      });
      tl.to(el, { y: -SUB_TUCK, duration: SUB_DURATION, ease: SUB_OUT_EASE }, 0);
      tl.to(el, { opacity: 0, duration: SUB_DURATION * 0.55, ease: 'power2.in' }, SUB_DURATION * 0.45);
      subTweens[pos] = tl;
    }
  }

  // ── plate show/hide. snapPlate is the instant path (first paint / theme
  // swap); enterPlate rises a newcomer in; exitPlate drops a leaver out.
  function snapPlate(pos, visible) {
    const g = engine.slots[`slot${pos}`];
    if (!g) return;
    if (gsapInstance) gsapInstance.set(g, { opacity: visible ? 1 : 0, y: 0 });
    else g.setAttribute('opacity', visible ? '1' : '0');
  }

  function enterPlate(pos, delay = 0) {
    const g = engine.slots[`slot${pos}`];
    if (!g) return;
    if (!gsapInstance) { snapPlate(pos, true); return; }
    // Hard-kill anything already tweening this group before re-entering. exitPlate
    // leaves a DELAYED opacity-fade queued, and overwrite:'auto' won't cancel a
    // tween that hasn't started yet — so without this an off→on toggle would rise
    // the plate in and then the orphaned fade would fire and yank it to 0.
    gsapInstance.killTweensOf(g);
    gsapInstance.set(g, { opacity: 0, y: ENTER_RISE });
    gsapInstance.to(g, { opacity: 1, y: 0, duration: ENTER_DURATION, ease: ENTER_EASE, delay, overwrite: 'auto' });
  }

  function exitPlate(pos) {
    const g = engine.slots[`slot${pos}`];
    if (!g) return;
    if (!gsapInstance) { g.setAttribute('opacity', '0'); return; }
    // Clear any in-flight enter (and its own prior queued tweens) so a rapid
    // on→off can't leave a rise tween fighting the drop.
    gsapInstance.killTweensOf(g);
    // Motion-led: accelerate the plate down and off the bottom of the frame,
    // holding full opacity through the first half so the slide reads clearly,
    // then fading over the tail as it clears — not a stationary dissolve.
    gsapInstance.to(g, { y: EXIT_DROP, duration: EXIT_DURATION, ease: EXIT_EASE, overwrite: 'auto' });
    gsapInstance.to(g, { opacity: 0, duration: EXIT_DURATION * 0.5, delay: EXIT_DURATION * 0.5, ease: 'power2.in', overwrite: 'auto' });
  }

  async function update(state, settings) {
    const theme = OverlayBase.deepGet(settings, 'overlays.global.designPackage', null) || DEFAULT_PACKAGE;
    const themeChanged = await engine.ensureTheme(theme);
    // Palette policy (see svg-theme-engine.js): only an app-vars theme (e.g.
    // the Classic package) is painted with the user's Design-tab variables; a
    // fixed-palette theme (the Rio default, Slice26) must never inherit them.
    if (engine.usesAppVars) OverlayBase.applyDesignSettings('commentary');
    else OverlayBase.clearDesignSettings();
    if (themeChanged) {
      layoutData = parseLayoutData();
      prevN = undefined;
      prevSlotCaster = new Array(MAX_SLOTS).fill(undefined);
      prevLayoutPos  = new Array(MAX_SLOTS).fill(-1);
      prevSub = new Array(MAX_SLOTS).fill(undefined);
      presented = false;  // new SVG injected → next first paint re-reveals
    }
    if (disposed) return;

    // Gather active casters (named + visible) in authored order; this list
    // compacts to however many are active — no holes for inactive slots.
    const active = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const base = `commentary.${i}`;
      const name = OverlayBase.deepGet(state, `${base}.name`, '');
      const visible = OverlayBase.deepGet(state, `${base}.visible`, false);
      if (!name || !visible) continue;
      active.push({
        name,
        subLabel: OverlayBase.deepGet(state, `${base}.subLabel`, ''),
        subValue: OverlayBase.deepGet(state, `${base}.subValue`, ''),
        subVisible: OverlayBase.deepGet(state, `${base}.subVisible`, false),
      });
    }
    const N = active.length;
    // No named, visible caster → the strip is empty. Like the plates it animates
    // slots out rather than hiding the host, so idle and broken look alike; name
    // the gap for the preview.
    OverlayBase.setBlank(
      N > 0 ? null
        : 'No caster is on the strip — name and show a caster from the Commentary desk in Production.',
      'Commentary',
    );
    const firstPaint = prevN === undefined;
    const countChanged = !firstPaint && N !== prevN;
    // Growing: the row widens, so plates that stay active reflow into their
    // new spots FIRST and the newly-appearing plate's fade-in is delayed
    // until that move has cleared the area. Shrinking: the mount fades the
    // departing plate(s) out first and only then moves the remaining plates
    // into the space it vacated. Either way, a fade and a move covering the
    // same area never run at the same time.
    const shrinking = countChanged && N < prevN;

    // Load GSAP whenever there are plates to show (including first paint now that
    // the initial reveal animates) or the count is changing.
    if (N > 0 || countChanged) await getGsap();
    if (disposed) return;

    const countLayout = (layoutData && layoutData.counts && layoutData.counts[String(N)]) || [];

    // ── Stable caster→slot assignment. The physical slots (slot0..3) are just
    // containers; each caster keeps the SAME slot element across reflows. This is
    // what makes an OUT-OF-ORDER removal (e.g. dropping the 2nd of 4 casters) work:
    // that caster's own plate drops out in place while the survivors glide to
    // their new spots. The old model compacted the active list into slot0..N-1,
    // so a middle removal always exit-animated the LAST plate and hard-swapped
    // names under the survivors. `layoutPos` (rank in the active list, 0..N-1)
    // drives the geometry/gradient a slot animates TO, and is decoupled from the
    // slot's own index. Survivors claim their previous slot first; freed slots go
    // to newcomers — so a survivor's element is never stolen out from under it.
    const slotData = new Array(MAX_SLOTS).fill(null);
    const slotLayoutPos = new Array(MAX_SLOTS).fill(-1);
    const used = new Array(MAX_SLOTS).fill(false);
    const placed = new Array(N).fill(false);
    for (let r = 0; r < N; r++) {
      for (let s = 0; s < MAX_SLOTS; s++) {
        if (!used[s] && prevSlotCaster[s] === active[r].name) {
          slotData[s] = active[r]; slotLayoutPos[s] = r; used[s] = true; placed[r] = true; break;
        }
      }
    }
    for (let r = 0, free = 0; r < N; r++) {
      if (placed[r]) continue;
      while (free < MAX_SLOTS && used[free]) free++;
      if (free >= MAX_SLOTS) break;   // can't happen (N <= MAX_SLOTS), guarded anyway
      slotData[free] = active[r]; slotLayoutPos[free] = r; used[free] = true;
    }

    // The strip may only paint visible plates while it's actually revealed on
    // screen. While hidden (OBS eye off / settle window / loaded hidden),
    // updates still bind text + record the lineup, but every plate stays at
    // opacity 0 — the pending reveal cascades the CURRENT lineup in. Without
    // this, a caster change while the source was hidden lit plates to full
    // alpha, and that stale frame is what OBS composited first on the next
    // show (the eye-toggle "appears, vanishes, cascades" stutter).
    const live = presented && wantShown;

    for (let s = 0; s < MAX_SLOTS; s++) {
      const d = slotData[s];
      const isActive = !!d;
      const wasActive = !firstPaint && prevSlotCaster[s] !== undefined;

      if (!isActive) {
        if (wasActive && live) exitPlate(s);     // drop + fade THIS slot's own leaver away
        else snapPlate(s, false);
        if (subTweens[s]) { subTweens[s].kill(); subTweens[s] = null; }
        prevSlotCaster[s] = undefined;
        prevLayoutPos[s] = -1;
        prevSub[s] = undefined;
        continue;
      }

      const layoutPos = slotLayoutPos[s];
      const entry = countLayout[layoutPos];
      engine.setText(`slot${s}-name`, d.name);

      // A caster staying in this slot REFLOWS (glide); a slot changing who it
      // holds SNAPS its identity — either a brand-new plate (rise in) or a
      // same-frame replacement of who sits here (hard swap, as before).
      const casterChanged = !(wasActive && prevSlotCaster[s] === d.name);

      if (firstPaint) {
        // First paint lays every plate out at rest but HIDDEN; the staggered
        // rise-in fires once after the loop via playGroupReveal — the same path
        // an OBS activate uses — so load and go-live behave identically.
        applyLayout(s, entry, false);
        snapPlate(s, false);
      } else if (casterChanged) {
        applyLayout(s, entry, false);
        if (!live) snapPlate(s, false);          // hidden: stage dark, reveal cascades it in
        else if (wasActive) snapPlate(s, true);  // same-frame replacement: snap in place
        else enterPlate(s, ENTER_DELAY);         // brand-new plate: rise in after survivors clear
      } else {
        // Survivor: reflow if the row changed shape under it (count change) or it
        // moved rank (a same-count reorder). Wait out a departing plate on a
        // shrink so a drop and a slide never cover the same ground. Hidden:
        // snap geometry — no point queueing glides nobody sees.
        const moved = countChanged || prevLayoutPos[s] !== layoutPos;
        applyLayout(s, entry, live && moved, shrinking ? RESHUFFLE_DELAY : 0, prevSub[s]);
      }

      // Sub plate. On a snap (first paint / new plate / different caster) the
      // text and slide state are set together. On a live toggle we animate:
      // revealing sets the new text FIRST then slides in; retracting slides out
      // WITHOUT touching the text (so switching to an address-book field this
      // caster has no value for just retracts — it never flashes the empty new
      // label mid-animation) and clears the stale text only once hidden.
      const showSub = !!d.subVisible && !!d.subValue;
      if (firstPaint || casterChanged) {
        engine.setText(`slot${s}-sub-label`, d.subLabel);
        engine.setText(`slot${s}-sub-value`, d.subValue);
        snapSub(s, showSub);
      } else if (prevSub[s] !== showSub) {
        if (!live) {
          // Hidden: settle the sub's final state silently.
          engine.setText(`slot${s}-sub-label`, showSub ? d.subLabel : '');
          engine.setText(`slot${s}-sub-value`, showSub ? d.subValue : '');
          snapSub(s, showSub);
        } else if (showSub) {
          engine.setText(`slot${s}-sub-label`, d.subLabel);
          engine.setText(`slot${s}-sub-value`, d.subValue);
          animateSub(s, true);
        } else {
          animateSub(s, false, () => {
            engine.setText(`slot${s}-sub-label`, '');
            engine.setText(`slot${s}-sub-value`, '');
          });
        }
      } else if (showSub) {
        // Still shown, same caster: keep a live value current.
        engine.setText(`slot${s}-sub-label`, d.subLabel);
        engine.setText(`slot${s}-sub-value`, d.subValue);
      }
      prevSub[s] = showSub;
      prevLayoutPos[s] = layoutPos;
      prevSlotCaster[s] = d.name;
    }

    prevN = N;

    if (firstPaint) {
      // Reveal at the next painted frame. If the source loaded hidden, the
      // queued rAF simply waits until OBS composites us again — animating
      // while hidden would just leave a frozen tween to flash on the next show.
      if (wantShown) scheduleGroupReveal();
      else presented = false;
    }

    engine.refitText();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) engine.refitText(); });
  }

  // ── whole-group reveal, for OBS source visibility ──────────────────────────
  // The producer shows/hides this element by toggling its OBS source (or its
  // scene). OBS fires `obsSourceActiveChanged` on the page; the HTML shell wires
  // that to setActive().

  // Staggered rise-in of every active plate. Used for first paint and each time
  // the source goes active. Fully resets each plate first (killTweensOf) so a
  // rapid hide→show can't leave an orphaned tween fighting the rise — that (plus
  // the frozen exit tweens below) was the "stutters / plays twice / animation
  // gone after a few toggles" bug.
  // Queue the cascade on the PAINT clock. rAF callbacks only run while OBS is
  // actually producing frames for this source (they hold while it's eye-off /
  // WasHidden), so the cascade's t=0 always lands on a composited frame.
  // Starting from the settle timer alone let GSAP's clock eat the cascade
  // invisibly when frames hadn't resumed yet — "final position, no animation"
  // after an eye-off → eye-on cycle.
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
    for (let s = 0; s < MAX_SLOTS; s++) {
      const g = engine.slots[`slot${s}`];
      if (g) gsapInstance.killTweensOf(g);
      if (prevSlotCaster[s] !== undefined) {
        if (INTRO) enterPlate(s, Math.max(0, prevLayoutPos[s]) * INTRO_STAGGER);
        else snapPlate(s, true);   // intro disabled: snap shown, no cascade
      } else snapPlate(s, false);
    }
    presented = true;
  }

  // Instantly hide every plate (kill any in-flight tween, snap to hidden at rest).
  // We SNAP rather than animate out because toggling an OBS source's visibility
  // cuts its compositing immediately — an out-tween wouldn't render, and leaving
  // one running only corrupts the next reveal. A visible out still plays via the
  // per-caster exit when casters are dropped through app state.
  function hideGroupNow() {
    presented = false;
    for (let s = 0; s < MAX_SLOTS; s++) {
      if (subTweens[s]) { subTweens[s].kill(); subTweens[s] = null; }
      const g = engine.slots[`slot${s}`];
      if (!g) continue;
      if (gsapInstance) { gsapInstance.killTweensOf(g); gsapInstance.set(g, { opacity: 0, y: 0 }); }
      else g.setAttribute('opacity', '0');
    }
  }

  // OBS source (or its scene) went active/inactive. A SINGLE visibility toggle
  // in OBS commonly emits a BURST of signals — on→off→on — (you can see it as the
  // source's render light flickering), and the two events we listen to
  // (active + visible) can arrive interleaved. The overriding invariant that
  // kills the stutter: WHENEVER we want to show but haven't revealed yet, the
  // plates are already at opacity 0. Then no frame OBS composites during the
  // settle window can ever show stale full-alpha — which was the actual
  // "starts at full alpha, then reverts to transparent and dissolves in" bug:
  // the old reveal was debounced but the plates weren't hidden first, so for
  // ~120ms the live source composited the leftover opacity-1 plates before the
  // reveal snapped them to 0 and animated up.
  //
  //   • not-yet-shown  → snap-hide SYNCHRONOUSLY, then debounce the reveal. The
  //     synchronous hide holds opacity 0 through the whole burst/settle window;
  //     the debounce collapses on→off→on into a single cascade at the end.
  //   • deactivate     → snap-hide immediately, cancel any pending reveal.
  //   • already shown + active again → ignore (don't re-hide a live strip; a
  //     redundant activate must not flicker it).
  function setActive(active) {
    wantShown = active;
    if (!active) {
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (revealRaf !== null) { cancelAnimationFrame(revealRaf); revealRaf = null; }
      hideGroupNow();
      return;
    }
    if (presented && settleTimer === null) return;  // already fully shown — leave it
    if (!INTRO) {
      // No intro animation: snap the strip in on the next painted frame, with no
      // dark settle window (nothing to stutter, so no need to hold opacity 0).
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (revealRaf !== null) { cancelAnimationFrame(revealRaf); revealRaf = null; }
      scheduleGroupReveal();
      return;
    }
    // Want to show but not revealed yet: guarantee opacity 0 RIGHT NOW (kills any
    // leftover shown/animating state), then (re)arm the settle timer. A burst
    // keeps re-hiding + rescheduling, so the strip stays dark until the flicker
    // ends and then cascades in exactly once — on the paint clock, so the
    // cascade can't run down before OBS is compositing frames again.
    hideGroupNow();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!disposed && wantShown) scheduleGroupReveal();
    }, REVEAL_SETTLE_MS);
  }

  // Loaded while the page itself was hidden (OBS pauses hidden pages): the
  // first-paint reveal deferred. Fire it once we're actually visible.
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
    host.classList.remove('cm-host');
    host.innerHTML = '';
  }

  window.addEventListener('resize', engine.refitText);

  return { update, setActive, dispose };
}

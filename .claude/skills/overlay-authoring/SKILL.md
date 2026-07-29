---
name: overlay-authoring
description: How to build or modify PRSH OBS overlay Layouts — the thin-HTML-shell + lib/*-mount.js pattern, the OverlayBase.init contract, the svg-theme-engine data-slot theme contract, design packages, OBS reveal/conceal/intro behavior, and the layout catalog registration checklist. Read before touching anything under public/layout/ or public/design/.
---

# Overlay Authoring

## Architecture in one paragraph

A **Layout** is an HTML file under `public/layout/<group>/` served as an OBS
Browser Source. The HTML is a **thin shell**: native size in `body {}`, a style
whitelist in `<meta name="overlay-settings">`, a `#host` div, and a module
script that wires a **mount** (`public/layout/lib/<element>-mount.js`) into
`OverlayBase.init()`. All rendering/data-binding lives in the mount; the look
of re-themable elements lives in a **design package** theme SVG injected by
`svg-theme-engine.js`. There is **no build step** — but OBS and browsers cache
these files aggressively: **hard refresh (Cmd/Ctrl+Shift+R)** after every edit.

Copy an existing pair when starting: `public/layout/playerplates/playerplates.html`
+ `lib/playerplates-mount.js` is the canonical modern example (its sibling
`commentary` has the fullest rationale comments).

## The HTML shell contract

```html
<meta name="overlay-settings" content="accentColor, cardBg, textColor, ..." />
<style> body { width: 1920px; height: 1080px; } </style>  <!-- native OBS size -->
...
<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script src="/layout/lib/overlay-base.js"></script>
<script type="module">
  import { mountThing } from '/layout/lib/thing-mount.js';
  const m = mountThing({ host: document.getElementById('host') });
  OverlayBase.init({
    render: () => m.update(OverlayBase.state, OverlayBase.settings),
    fetchSettings: true,                                   // only if you read settings
    shouldRender: (key) => key.startsWith('thing.'),       // state-key prefix filter
    shouldRenderSettings: (key) => key.startsWith('overlays.'),
  });
  OverlayBase.onObsShown((shown) => m.setActive(shown));   // if it animates on show
</script>
```

- `server/api/v1/layouts.py` parses `body { width/height }` for the OBS size
  hint and the `<meta>` whitelist for `supportedSettings` — both are load-bearing.
- The `<meta>` whitelist is the source of truth for which style knobs the
  Production stage's Style section exposes for this file.
- Fixed-palette elements also link `/layout/lib/rio-theme/tokens.css`.

## What `OverlayBase.init()` guarantees (`lib/overlay-base.js`)

- Initial REST fetch of `/api/v1/state` (+ `/api/v1/settings` if
  `fetchSettings`), then SocketIO connect with a full `v1.state.get` re-sync.
- Dispatch of **all four** state events (`set`, `set_batch`, `unset`,
  `unset_batch`) into the shared `OverlayBase.state` object, plus
  `v1.settings.set/unset` when opted in. Never hand-roll socket handling.
- **Render serialization**: renders coalesce — one runs at a time, calls that
  arrive mid-render collapse into a single follow-up pass. Your `update()` can
  be async (theme fetch, GSAP load) without double-injecting.
- `v1.action` bus: `overlay.conceal` cues targeting this page's URL dispatch a
  `prshConceal` window event (part of the OBS hide/show stutter fix).
- `BASE_URL` resolves to the page origin, or `http://localhost:5260` when
  loaded from `file:`.
- Preview flags: `?preview=1` (Layouts-tab iframe), `?preview_globals_only=1`
  (suppress per-layout overrides), `?sample=1` (render this layout's sample
  bundle — see below).
- **Sample bundle**: `init({ sample })` — a file stem under
  `public/layout/preview/`, or `{ file, state, settings }`. That one line is a
  layout's whole sample story; there is no per-shell fetch block and no
  `skipState` (both are gone).

Other helpers: `deepGet/deepSet`, `charImg`/`logoImg` (character art keyed by
HUD char id 0–53, team logos by 0–47 enumeration — mirrors
`server/rio/pyrio/assets.py`), `readSetting(layoutType, key, def)` for the
per-layout→global→default fallback chain, `brandingLogoUrl()`, `hexToRgb`.

### An overlay that hides itself must say why — `OverlayBase.setBlank(reason, label)`

A blank browser source looks identical whether the layout 404'd, the theme
failed, or there is simply no game, and "my scoreboard shows nothing" is the
support question that costs the most to answer. Any mount with a precondition
(`hasGame`, a missing feed, an empty queue) calls `setBlank(reason)` when it
hides and `setBlank(null)` when it draws.

- **Never paint the reason on the broadcast.** A producer would rather have an
  empty corner than an error card composited into a live stream. The visible
  note renders in `PREVIEW_MODE` only; on air the reason goes to `console.info`
  and to `data-prsh-blank` on `<html>`.
- **Distinguish causes the producer acts on differently.** The Scoreboard's
  `blankReason()` splits "no game on this board" (check the binding) from "a
  game, but no player names" (a stale HUD file) — Project Rio fills teams,
  innings and scores off the roster *before* it knows who is playing, so a board
  can look fully populated and still be empty. That case reads as a broken
  overlay and is the one worth naming precisely.
- It logs only when the reason **changes** — mounts call it every render, and a
  HUD feed would bury the console otherwise.
- The Production stage mirrors the same predicate in `ReadinessNote`
  (`stage/generic.jsx`), because a producer is looking at the panel, not the
  browser source's dev tools. Two runtimes, no shared module: each side names
  the other in a comment and `stage/generic.test.jsx` pins the state keys.
  **Change what makes an overlay renderable, change both.**

## Theme engine + design packages (`lib/svg-theme-engine.js`)

(This is the mount/engine side. For authoring the theme SVGs themselves —
package tiers, converting designer exports, per-element contracts — load the
`design-package-authoring` skill.)

Re-themable elements render a theme SVG from the active design package:

```js
const engine = createThemeEngine({ host, element: 'thing', fallbackSvg });
const changed = await engine.ensureTheme(packageId); // true only on a real swap
engine.setText('side1-name', v, { optional: true }); // optional: hides when empty
engine.setImage('logo', url);
engine.refitText();                                  // after text binds + on fonts.ready
```

- Packages are served at `/design/{package}/{element}.svg` — built-ins in
  `public/design/{default,classic}/`, user packages in
  `user_data/design_packages/`. Resolution falls back **element-by-element** to
  `default`, then to the mount's inline `fallbackSvg` (always provide one with
  the same slot names, so binding never silently no-ops).
- The active package id comes from `overlays.global.designPackage` (Settings).
- A theme SVG declares hooks via `data-slot` attributes; text slots with
  `data-maxw` auto-fit (uniform shrink, base size captured in `data-basefs`).
  Sub-parts use `data-part`. Position anchors can ride in a
  `<script data-layouts>` JSON block the mount parses.
- **Palette policy**: a theme opts into the user's Design-tab CSS variables by
  putting `data-design-vars="app"` on its root `<svg>`. The mount must honor
  it: `engine.usesAppVars ? OverlayBase.applyDesignSettings(type) :
  OverlayBase.clearDesignSettings()`. Fixed-palette themes (e.g. the default
  Rio look) must never be repainted by app vars.
- `ensureTheme` is concurrency-safe (interleaved loads no-op) and returns
  `true` only when a different SVG was injected — reset your diff/animation
  state (`firstPaint`, prev-value caches) exactly then.

## OBS show/hide + animation contract

This is the most regression-prone area. The invariant: **whenever the source
wants to show but hasn't revealed yet, everything is already at opacity 0** —
OBS retains the last composited texture of a hidden source, and a stale
full-alpha frame flashes on the next show.

- `OverlayBase.onObsShown(cb)` combines three signals: scene cuts
  (`obsSourceActiveChanged`), the source eye icon
  (`obsSourceVisibleChanged`), and PRSH's `overlay.conceal` action (fired just
  before the app disables the source; failsafe re-emit after 2s). Mounts wire
  it to `setActive(shown)`.
- Mount pattern: while hidden, keep **binding data but rendering dark**; on
  show, play the group reveal on a composited frame (rAF), debounced ~120ms to
  collapse OBS's on→off→on burst.
- `?intro=0` disables the reveal animation (snap in) — paired with
  `shutdown: false` on the OBS source so it stays resident. PRSH sets the
  browser-source `shutdown` property from `src/context/obs.jsx`; don't regress
  that reconciliation (see its comments).
- Never trigger renders per-key: apply all changed keys to local state first,
  render once (OverlayBase's coalescing does this if you just re-read
  `OverlayBase.state` in `update()`).

## GPU-raster & compositing pitfalls (Scoreboard-S meld saga)

These fail **only under GPU raster** (OBS, the user's real Chrome) and look
fine in CPU/headless raster — so you cannot confirm them from a `--disable-gpu`
screenshot; get the user's eyes or reason from first principles.

- **A resident `clip-path` trims glyph overshoot.** Any element carrying a
  clip-path — even a fully-open one — is pinned to its own composite layer
  whose texture is sized to its paint bounds. Round-glyph overshoot (bottoms/
  sides of 6/9/0/O) then gets shaved. Apply clip-path **only while a wipe is
  animating and remove it at rest** (`el.style.clipPath = 'none'` on the tween's
  `onComplete`); never leave one on a settled text node. (This is what made the
  scoreboard digits "barely clip on the left and bottom.")
- **A retained animation transform makes the layer blurry.** A CSS
  `animation: … both` (or any lingering `transform`, even `translateX(0)`) keeps
  the host on a composited layer that's rastered once and GPU-scaled — sharp
  right after a reload, blurry thereafter. Drop the class on `animationend` so
  the resting state is untransformed/un-layered.
- **Two elements that must move together must share ONE tween.** When a wipe
  reveals content as another element grows (the card-bg width vs. the segment
  content), matching durations/eases is NOT enough — if they span different
  widths their edges travel at different speeds and drift. Drive both from a
  single tween in a shared coordinate space: the meld clips each segment with a
  `clipPathUnits="userSpaceOnUse"` rect whose right edge **is** the card's
  animating right edge, so content is revealed exactly as the edge passes it.
  Only participate rows that are shown or transitioning shown→hidden — a row
  that's hidden-and-staying-hidden must stay dark, or the sweeping edge lights
  it up mid-animation. (`scoreboard-mount.js` `meldTo` is the reference.)
- **Previews: scale with `zoom`, not `transform: scale()`.** The Layouts-tab
  `ScaledIframe` (`src/components/ScaledIframe.jsx`) fits an overlay into the
  preview pane. `transform: scale()` rasters the iframe once at its pre-scale
  size and reuses that texture (blurry until a re-mount forces a re-raster);
  `zoom` is layout-affecting so the content re-renders crisp at the target
  resolution. Applies to every preview at once.

## Catalog + registration (`server/api/v1/layouts.py`, `src/routes/layouts/designConstants.js`)

- **Layout type** is derived from filename stem + group folder (`scenes/*` →
  `scene`, `bracket/*` → `bracket`, else stem minus trailing digits).
- Variant expansion: `?size=s|m|l` (scoreboard type only; legacy xs/xl fall
  back to l), `?team=1|2` (stats, roster, rosterstats, teamlogo, controller,
  playername), `?dir=` (fourcam). `?scoreboard=N` binds board data —
  **missing param defaults to board 1**.
- `controller/` is **macOS-only** (omitted from the catalog off-Darwin) —
  platform-gate any test that asserts on it.
- Style settings are two-tier, defined in `src/routes/layouts/designConstants.js`:
  `GLOBAL_DESIGN_KEYS`/`GLOBAL_DESIGN_DEFAULTS` (live at `overlays.global.*`)
  and `LAYOUT_SETTINGS[layoutType]` (live at `overlays.{type}.{key}`;
  scorecard is per-board `overlays.scorecard.{N}.*`).

## Checklist: adding a new Layout

1. HTML shell in `public/layout/<group>/` per the contract above (native size,
   `<meta>` whitelist, thin script).
2. Mount in `public/layout/lib/<name>-mount.js` returning
   `{ update, setActive, dispose }`.
3. New element-only style knobs → `LAYOUT_SETTINGS[layoutType]`; new global
   knobs → `GLOBAL_DESIGN_KEYS` + defaults + overridables.
4. Re-themable? Author `public/design/default/<element>.svg` with the
   `data-slot` contract + an inline `fallbackSvg` in the mount.
5. Production element? Register in `src/routes/production/elements.js`
   (direct vs fed — fed elements render on the Callout Stage,
   `public/layout/shared/callout-stage.html`).
   **Authoring a new shared container?** Pass `forceElement` from **`?feed=`**
   AND `previewSel` from **`?feedsel=`** (both gated on `PREVIEW_MODE`) into
   `initFedContainer`, and name a representative occupant in the sample block.
   Several elements share one container URL, so a container that ignores `?feed=`
   makes every one of them preview as whatever is currently fed. `?feed=` names
   the element; `?feedsel=` (URL-encoded JSON) supplies its CONTENT — the
   character/board the console's Push would show (`suggest.js` intent). Without
   it a pickable element (Character Spotlight) previews blank until the producer
   picks, and picking writes the live container key, i.e. goes ON AIR — so there
   was no way to preview it off-air. Merge `previewSel` over the `forceElement`
   base; on air neither param exists and the real feed governs. See
   `callout-stage.html` + `fed-container.js`.

6. Declare a **sample bundle** (`init({ sample })`) — see below. The
   coverage guard fails without one.
7. Verify: `GET /api/v1/layouts` lists it with correct type/dims/settings;
   load the URL in a browser, hard-refresh, check the console; if animated,
   test the OBS eye-toggle + scene-cut paths.
8. Update the "Catalog + registration" section **of this skill** if you added a
   type or variant axis (CLAUDE.md keeps only a pointer — the detail lives here).

### `?preview=1` vs `?sample=1` — two different questions

- **`PREVIEW_MODE` (`?preview=1`)** — "you are in a preview iframe, not an OBS
  source." Preview CHROME only: `setBlank` notes render visibly, animations
  resolve instantly, stages scale to fit. Says nothing about data.
- **`?sample=1`** — "render this layout's sample bundle instead of live state."
  Says nothing about chrome.

They were one flag, which made the Production console's stage preview a mockup —
every element drew the fixture game and live state was never fetched, while the
panel claimed to show what was about to go on air. The gallery passes
`preview=1&sample=1` (it must render on a machine with no game); the console
passes `preview=1` alone and gets the truth.

### Sample bundles — `init({ sample })`

**Every Layout declares one. `src/routes/layouts/overlay-sample.test.js` fails
if it doesn't.** A layout with no bundle previews as an empty box in the Add
picker on a machine with no game running, which reads as a broken element rather
than an unconfigured one.

- **A bundle is a state fragment**: `{ "state": { "score.{sb}": {…} },
  "settings": { … } }` — a flat map of state key → value. `{sb}` and `{team}`
  resolve from the page's own URL, so one bundle serves every board and side
  variant. Nothing translates between "sample shape" and "state shape", which is
  what let the old per-shell blocks drift apart.
- **Settings in a bundle SEED, they don't override.** Only content-ish keys
  belong there (a stats tag, a card title), and only holes get filled — a
  producer laying out a scene in demo mode keeps their own title, and leaving
  demo mode clears exactly the keys the seed filled. Never seed a design key.
- **`{ file, state, settings }`** when the bundle depends on this page's own URL
  params. Shared containers use it to name their occupant (`?feed=` still wins).
- Reuse an existing bundle before authoring one — `scoreboard` alone covers
  eight layouts.

### Demo mode — state `production.sample`

The same bundles, switched app-wide at runtime, so a producer can build an OBS
scene with no game running. Rules that must not erode
(`src/routes/production/sample.jsx`, `sample.test.jsx`):

- **`OverlayBase.state` and `.settings` keep ONE object identity for the page's
  life.** A dozen layouts do `const { deepGet, state } = OverlayBase` once at
  module scope. A getter over two bundles, or swapping the object, strands every
  one of them on whichever bundle was current at script time — this is not
  hypothetical, it shipped for an hour and the bracket drew its empty state
  against a fully loaded sample. The sample takes the store OVER (live contents
  park in a buffer); it never replaces it.
- **Live state keeps flowing while the sample is up.** Leaving demo mode lands
  on the CURRENT game, not the one that was playing when it started.
- **Read the switch strictly** (`true`/`"true"`/`1`/`"1"`). `PUT /api/v1/state`
  is str-typed, so an off written over REST arrives as the string `"false"`; a
  truthiness check leaves every source stuck on a fixture.
- **Global, never per-element**; **never self-enables**; **survives a restart**
  — and that last one is only acceptable because the banner is unmissable and
  carries the off switch. Keep the pair.
- A layout with no bundle ignores both switches and stays live, and says so in
  preview rather than reading as broken.

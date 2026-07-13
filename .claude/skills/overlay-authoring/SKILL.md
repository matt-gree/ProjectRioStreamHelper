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
- The `<meta>` whitelist is the source of truth for which style knobs the Setup
  tab exposes for this file.
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
  (suppress per-layout overrides), `skipState: true` for sample-JSON previews
  (`public/layout/preview/`).

Other helpers: `deepGet/deepSet`, `charImg`/`logoImg` (character art keyed by
HUD char id 0–53, team logos by 0–47 enumeration — mirrors
`server/rio/pyrio/assets.py`), `readSetting(layoutType, key, def)` for the
per-layout→global→default fallback chain, `brandingLogoUrl()`, `hexToRgb`.

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

## Catalog + registration (`server/api/v1/layouts.py`, `src/routes/layouts/layouts.jsx`)

- **Layout type** is derived from filename stem + group folder (`scenes/*` →
  `scene`, `bracket/*` → `bracket`, else stem minus trailing digits).
- Variant expansion: `?size=s|m|l` (scoreboard type only; legacy xs/xl fall
  back to l), `?team=1|2` (stats, roster, rosterstats, teamlogo, controller,
  playername), `?dir=` (fourcam). `?scoreboard=N` binds board data —
  **missing param defaults to board 1**.
- `controller/` is **macOS-only** (omitted from the catalog off-Darwin) —
  platform-gate any test that asserts on it.
- Style settings are two-tier, defined in `src/routes/layouts/layouts.jsx`:
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
6. Verify: `GET /api/v1/layouts` lists it with correct type/dims/settings;
   load the URL in a browser, hard-refresh, check the console; if animated,
   test the OBS eye-toggle + scene-cut paths.
7. Update CLAUDE.md's layout sections if you added a type or variant axis.

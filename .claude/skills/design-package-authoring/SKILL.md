---
name: design-package-authoring
description: How to create, convert, and review PRSH design packages (theme SVG bundles) — the full-art vs token-skin tiers, package anatomy and install rules, and the middleman workflow for turning a raw designer export (Figma etc.) into a conforming theme. Read before authoring theme SVGs, converting designer artwork, or reviewing an installed package. Companion to overlay-authoring (the mount/engine side).
---

# Design Package Authoring

## The role this skill covers

Designers author element artwork in a design tool; PRSH binds live data into
it via `data-slot`/`data-part` markers and animates it with GSAP **in the
mounts** — the SVG owns geometry and paint, the code owns behavior. No design
tool can author those markers, so until an ingest tool exists **the agent is
the compiler**: you take a raw export, mark it up against the element
contract, and verify it renders. This skill is that workflow. The per-element
slot contracts live in `public/design/README.md` — always open it alongside
this file; never work from memory of a contract.

## Two package tiers

| Tier | Palette | How |
|---|---|---|
| **Full-art package** | Fixed — the SVG brings its own colors; the user's Design-tab knobs never repaint it (`default`, `slice26`, `chalk`) | Literal hexes (or Rio token vars with literal fallbacks) |
| **Token skin** | App-vars — painted by the user's Design-tab knobs (`classic`) | `data-design-vars="app"` on the root `<svg>`, paint with `--accent`, `--card-bg`, `--text-primary`, `--border-color`, `--border-width`, `--font-family`, `--card-shadow-filter`, `--text-shadow` |

Pick ONE per theme file and never mix: the mounts key off `engine.usesAppVars`
to either apply or clear the app vars. Both tiers may use the **runtime color
seams** the mounts set per element (`--side1`/`--side2` controller-port
colors, `--accent`, callouts' `--port-color`/`--well`/`--accent-neutral`) —
these are data, not theme choices.

**The tier is a per-file fact that the UI reads back.** `_package_info` reports
`appVarElements` by parsing each shipped SVG's root `data-design-vars` (the
file, never the manifest — `palette` there is only an input to the compiler,
and a hand-dropped folder never runs it). The app uses it to drop settings a
full-art element can't honour, and the Design tab names those elements under
the package selector. So a theme that forgets `data-design-vars="app"` doesn't
just render with the wrong palette — it takes its own colour controls off the
Production stage.

## Package anatomy + install rules (`server/design_packages.py`)

- A package = folder of per-element SVGs + optional `package.json`
  (`id`/`name`/`version`/`author`/`description`). Served at
  `/design/{pkg}/{element}.svg`.
- Built-ins in `public/design/{default,classic}/` (repo); user packages in
  `user_data/design_packages/<id>/` (never in the repo). Install = zip upload
  on the Design tab or drop the folder in by hand.
- Package ids: `^[a-z0-9][a-z0-9._-]{0,63}$`. Built-in ids can never be
  shadowed. Zip install keeps only `.svg .json .md .png .jpg .jpeg .webp
  .txt` (32 MB cap) — scripts are stripped by design; **behavior can never
  ship in a package**.
- **Partial packages are first-class**: any element the package omits falls
  back element-by-element to `default` (engine-side), then to the mount's
  inline `fallbackSvg`. Ship a package with one great element rather than
  twelve mediocre ones.
- The active package is global: `overlays.global.designPackage` (Settings).

## Element inventory (what a package may theme)

Slot-only (easiest): `stats`, `matchup`, `scoreboard-{xs,s,m,l}`,
`scorecard`. Template-cloning (author a prototype in `<defs>`/a group; the
mount clones it): `ticker`, `lowerthird`. Layout-JSON reflow (SVG + an
embedded `<script type="application/json" data-layouts="1">` block):
`commentary` (per-count arrangements — the hardest element),
`playerplates` (anchor offsets only — the gentle version).

**Palette + backdrop only** (layout is mount-owned JS, ~2,200 lines — NOT
re-layoutable via SVG): the Character Spotlight and Game Summary share
`callout.svg` (full-bleed backdrop, no data slots) plus optional declared
`--side1`/`--side2`/`--well`/`--accent-neutral` on its root. Say so when a
design brief asks for callout re-layout — that's a code change, not a theme.
**Not themable at all**: the bracket (generative geometry; follows the
package family via fixed CSS in its HTML).

## Middleman workflow: raw export → conforming theme

1. **Read the element's contract** in `public/design/README.md` and open the
   `default` package's SVG for that element as the working reference — its
   structure is the answer key.
2. **Check the canvas**: overlay elements author at `viewBox="0 0 1920
   1080"` (bottom-anchored ones use `preserveAspectRatio="xMidYMax meet"`,
   full-bleed backdrops `xMidYMid slice`); sized elements (scoreboards,
   ticker, stats) at their native canvas with `xMidYMid meet`. Fix the
   export's viewBox/pAR first — everything else positions relative to it.
3. **Mark up the slots**: find each bindable node in the export and add the
   contract's `data-slot`/`data-part`/`data-tpl` attributes. Text slots that
   can hold long values get `data-maxw="<svg-units>"` (the engine
   auto-shrinks uniformly). Keep the designer's ids — they're harmless.
4. **De-outline text**: designer exports often convert text to paths. A
   `<path>` can't be a text slot — get a re-export with real `<text>`
   (Figma: uncheck "outline text"), or rebuild the text nodes by hand
   matching font/size/anchor.
5. **Structural work per element class**: move `data-tpl` prototypes into
   `<defs>` (lowerthird) or mark the prototype group (ticker); author the
   layout JSON block (commentary counts / playerplates anchors) by measuring
   the designer's arrangement.
6. **Sweep the SVG gotchas** (each one fails silently):
   - `var()` resolves **only in inline `style="…"`** — `fill="var(...)"` as a
     presentation attribute does nothing.
   - `rx` cannot be a CSS variable.
   - XML comments must not contain `--` (em-dashes in designer notes break
     the parser).
   - **No angle bracket anywhere inside a `<style>` block**, comments included.
     The mounts inject theme SVGs with `innerHTML`, and inside SVG a `<style>`
     is *not* raw text — the parser tokenises tags in it, so one `<defs>` in a
     CSS comment silently drops every rule below it. Symptom: the first few
     rules work and the rest are absent from `style.sheet.cssRules`. Pinned by
     `tests/unit/test_design_package_svgs.py`.
   - Root `width`/`height` are stripped by the engine — size must come from
     the viewBox.
   - Gradients that must track geometry use `gradientUnits="userSpaceOnUse"`
     (commentary's per-position gradients: one gradient shared by main+sub,
     never split, never `objectBoundingBox`).
   - Elements the mount shows/hides start hidden (`style="opacity:0"`) where
     the contract says so. **Never leave a resident `clip-path` on a text or
     glyph node**: a clip-path pins the node to its own GPU composite layer
     whose texture is sized to its paint bounds, and round-glyph overshoot
     (the bottoms/sides of 6/9/0/O) gets trimmed under GPU raster (OBS, real
     Chrome) even though CPU/headless raster looks fine. The mount applies clip
     only *during* an animation and drops it at rest — an authored theme must
     not add its own (see overlay-authoring for the full pattern).
   - Fonts aren't embedded: use fonts the element shells load (Rio tokens'
     `--font-display` etc.) or web-safe stacks with fallbacks. The tokens'
     `--font-mono` is **Chivo Mono** — a display mono, sized to be read across
     a room. Don't reach for a code face (JetBrains, SF Mono) for numerals a
     viewer sees at 44–76px.
   - **`data-maxw` on any text slot whose content the producer or the clock
     controls**, not just the ones that look long in the mock. Authored sample
     text is the *short* case: a lower third's clock slot is drawn as "5:00"
     and renders "11:11 AM ET", a status chip is drawn "UP NEXT" and renders
     "GRAND FINAL RESET". Without a fit bound those run straight off the bed —
     nothing downstream clips them, and it's the last segment on the band that
     shows it worst.
   - **Pixel art has a grid, and the grid sets the sizes you may draw it at.**
     `#rio-mark` is a 16×16 field painted with `shape-rendering="crispEdges"`;
     at any size that isn't a whole multiple of 16 the renderer snaps rows to
     uneven widths and the baseball stitching reads as a corrupted asset. So a
     scattered field of marks can't vary size *continuously* — and shouldn't
     want to: a few px of spread reads as sloppiness, not as depth. Vary it on
     a ladder of whole grid steps (the lower third's field uses 32/48/64/80/96)
     and move opacity, travel and speed with it, so the depth lands on four
     cues at once. Pinned by `tests/unit/test_design_package_svgs.py`.

     The same rule bit three themes a *second* way: a mark pasted as
     `<g transform="scale(6.875)">` rather than `<use width= height=>`. A scale
     factor is a free number, so it lands off-grid silently and nothing checks
     it. Always `<symbol id="rio-mark">` in `<defs>` + `<use>` at a grid size —
     also pinned. And keep the *slot* box (an `<image>` for the user's uploaded
     logo) at whatever size the layout wants; only the mark is on a grid. Centre
     the on-grid mark in the box rather than resizing the box to suit it.
   - **A coloured drop-shadow only works where nothing is underneath it.** The
     lower third's Rio-red glow is beautiful over video and became a maroon
     stain the moment the card grew a second surface: Commentary's sub drawer is
     painted *before* the plate, so the plate's shadow lands on it, strongest at
     the seam, and one card read as two colours. If a card is two stacked
     surfaces, the lift has to be neutral — put the brand colour somewhere
     opaque (a rail, a label) instead.
7. **Manifest + folder**: `package.json` with at least `id` + `name`; put raw
   design exports in `sources/` (served-suffix files only; it's for humans).

## Designer-tool export pitfalls (learned converting the Scoreboard-S)

Translate an export **faithfully** — do not re-center, re-mirror, or "improve"
the designer's geometry. Their coordinates ARE the design; a 180°-rotated P2
color, an off-center count, a right-shifted score are all intentional. Every
"cleanup" I applied the first pass (re-centering count numbers, re-mirroring a
gradient) was a regression the designer had to catch. Keep exact x/y, exact
transforms, exact anchors.

Figma-specific quirks the compiler now mostly handles, but that you must
recognize when reviewing an export or authoring a reimport template:

- **tspan-positioned text.** Figma emits `<text><tspan x y>value</tspan></text>`
  — the position lives on the `<tspan>`, not the `<text>`. The engine's
  `setText` sets `textContent`, which deletes the tspan (and its x/y), so the
  glyph jumps to (0,0). The compiler flattens single-tspan text; if you hand-
  author, put x/y on the `<text>` itself and use no tspan.
- **Right-alignment is baked into x; no `text-anchor` is emitted.** A Figma
  text box set to right-align exports as left-anchored text with x pushed
  right (so "10" and "0" share a right edge only by coincidence of width).
  Add `text-anchor="end"` and set x to the shared right edge yourself — the
  auto-fit/reveal will otherwise misalign it. (This is why the P1 score looked
  offset until anchored.)
- **Empty `<image>` elements are dropped on export.** A logo/photo slot with no
  fill vanishes from the SVG, so image slots silently go missing. Add the
  `<image data-slot="…">` back by hand; in a reimport template give it a 1×1
  transparent `data:` href so Figma keeps it on the round-trip.
- **Template scaffolding must be strippable.** Dashed placeholder boxes (a
  team-logo guide, a safe-area frame) are editing aids, not shipped art. Tag
  them `scaffold=NAME` so the compiler removes them; never let a dashed guide
  reach the served file.
- `--` in a comment (designer notes with em-dashes) breaks the XML parser;
  `var()` only resolves in inline `style=`. (Both already in the gotchas
  sweep — the compiler defuses/relocates them, but exports reintroduce them.)

## Horizontal-meld absolute themes (the Scoreboard-S pattern)

A theme can declare a card that **physically resizes to fit its visible
segments** instead of stacking rows. The contract lives entirely in layer-name
grammar / `data-*` markers, so a designer authors it and the compiler wires it:

- Root: `layout=absolute` marker layer → `data-layout="absolute"` (mount places
  groups by hand, only toggling visibility; no reflow).
- `slot=card-bg compactw=224` → the card's collapsed width (names + scores
  only). The mount animates the card-bg **width** outward from here.
- Each toggleable segment group: `slot=row-live anim=expand-right cardw=380`
  → `data-cardw` = the card width when THIS segment is the rightmost visible.
  The mount grows card-bg to `max(cardw over visible segments)`.
- Segments reveal/hide by the **card's own right edge** sweeping over them (one
  shared clip, one tween), so content appears exactly as the edge passes — not
  on an independent per-row clock. Author segment content to the RIGHT of the
  compact edge, ordered left→right; a hidden *middle* segment can't be
  edge-wiped (it just snaps). Mount details: overlay-authoring.

## Atmosphere fields (the mushroom field, and porting it to a new card)

The `default` package gives its cards a drifting field of Rio marks. The system
is written out in `public/design/default/lowerthird.svg` — read it there, it is
the reference. What matters when carrying it onto a *different* card:

- **Scale the ladder to the card, and drop the near plane if the card can't
  afford it.** The near plane (marks passing in FRONT of the copy) is what gives
  a card an inside, and it costs legibility. A 232px band or a 392px panel can
  pay; a 96px name plate that is almost entirely one name cannot, so Commentary
  and Player Plates run one plane and a lower ceiling. Depth on those comes from
  the sub drawer instead.
- **Clip to the card, never to a rectangle**, so a mark can leave through a
  rounded corner. Who owns the clip follows who owns the geometry: fixed cards
  (Player Plates, Matchup) carry their own `clipPath`; Commentary's plates
  resize per count, so the mount builds the clip and drives it off the same
  layout entry as the plate.
- **A clip hides a mark and keeps paying for it.** Prune. `display: none` takes
  the sprite out of layout, paint and the compositor — but Chromium leaves the
  CSS animations on the hidden subtree *running*, ticking styles every frame for
  something with no box. You need `.host .off * { animation: none }` as well;
  host-qualify it or the theme's own rule, injected later in document order,
  ties on specificity and wins. Measured on Commentary: 56 authored sprite
  instances, 13 shown, and the running-animation count only fell 112 → 26 once
  the descendant rule was added.
- **Two cards side by side must not share a scatter.** Identical marks in
  identical places read as a copy-paste, which is the one thing atmosphere may
  never look like. Either author across the whole canvas and let each card clip
  its own slice (Commentary), or seed each card separately (Player Plates).
- **On a full-canvas backdrop, the band the marks travel in IS the cost.**
  `callout.svg` (Game Summary + Character Spotlight) has no card to clip to, so
  nothing bounds the field except where you place it. Its 12 marks are all held
  in the floor — a 248px band at the foot of a 1080px frame — and the ladder is
  pinned to the frame instead of scattered through it: small marks ride high and
  barely move, big ones sit low and swing out of shot. Depth reads *better* that
  way and the compositor repaints a strip rather than a canvas. Never mask or
  clip a field on a backdrop like this; a mask makes its whole region redraw,
  which is the cost you were avoiding.
- **Crop what sits UNDER a field, and count the rects in it.** The mark is 108
  crisp-edged rects, so mark count is a raster multiplier, not a taste knob —
  and a backdrop's other layers are habitually authored as full-canvas rects
  because it costs nothing when everything is static. Under something moving it
  costs on every frame. `callout.svg` shipped laggy at 20 marks × 2 animations
  over uncropped masked layers and is fine at 12 × 1 with every masked and
  patterned layer cropped to where its gradient already hits zero alpha. Note
  the trap when cropping: a gradient in default `objectBoundingBox` units is
  measured against the rect that fills it, so shrinking the rect silently
  squashes the gradient. Convert it to `userSpaceOnUse` first (a
  `gradientTransform` matrix reproduces the 16:9 ellipse), then crop.
- **Never put a CSS transform animation on an element that also carries
  `transform="translate(x,y)"`.** The animation *replaces* the presentation
  attribute rather than composing with it, so every sprite snaps to the origin
  and drifts in a pile in the corner. Position on an outer static group, animate
  the inner one — which is what the lower third's bob/sway nesting is doing
  before it is doing anything about phase.

## Keep a Figma-reimport template (a real workflow win)

For any theme complex enough that the designer will keep iterating, commit a
`design-templates/<element>.template.svg` beside the shipped file: **literal
seam colors + grammar layer-ids** (`slot=… maxw=…`, `anim=`, `cardw=`,
`compactw=`, `layout=absolute`, `scaffold=…`) + the re-added transparent image
slots. Import → edit in Figma → export → `compile-theme.py` reproduces the
shipped SVG. Verify parity by diffing the compiled slot inventory against the
shipped file (they must match). This gives the designer a 1:1 editable source
and makes the round-trip lossless — worth the upkeep for flagship themes.

## Verifying a theme

Boot an **isolated server** (run-and-verify skill: `PRSH_USER_DATA_DIR` +
`PRSH_PORT` + `PRSH_HUD_FILE`), drop the package folder into that instance's
`user_data/design_packages/`, set `overlays.global.designPackage` to its id,
then load the element's layout URL in a browser and **hard-refresh**
(Cmd/Ctrl+Shift+R — theme SVGs are cached per page load).

- Drive real data with `scripts/replay-hud.py` (scoreboard/stats), or the
  sample states in `public/layout/preview/*.json` for elements with previews.
- Exercise the states the contract calls out: empty/optional slots (must
  hide, not show stale text), long names (auto-fit), count changes
  (commentary 1→4), the OBS reveal (theme swap resets first-paint).
- Check the browser console — a missing slot is silent (the mount skips it),
  so diff your slot list against the contract table, not against "it looks
  right."
- A report must distinguish browser-verified from OBS-verified.

## The theme compiler (built — use it, don't hand-translate)

`server/theme_compiler.py` + `server/theme_contracts.py` now do most of step
3–6 above automatically. It runs on **every zip install**
(`design_packages.install_zip` → `compile_installed_svgs`, report returned in
the package info and shown in the Design tab) and from the CLI
`scripts/compile-theme.py` (dry-run by default; `--write` to fix in place).

- **Grammar → markers**: layer ids `slot=side1-name maxw=420`, `part=rail`,
  `tpl=match w=620`, `band x=210 w=1500 …` become `data-*` attributes.
  Separators `=`/`:`, space/underscore token splits, case-insensitive.
  Designer-facing spec: `public/design/DESIGNER-GUIDE.md`.
- **Normalizations** (each reported): strip root width/height, fill
  `preserveAspectRatio` from the contract, move `var()` out of presentation
  attributes into inline style, relocate `data-tpl` groups into `<defs>`,
  defuse `--` in comments, set `data-design-vars="app"` from manifest
  `"palette": "app"`, **flatten single-`<tspan>` text** (lifts the tspan's
  x/y onto the `<text>` and inlines its content — see the Figma pitfalls
  below), **strip `scaffold=`-tagged editing guides**, and translate the
  **meld modifiers** `cardw=`/`compactw=`/`anim=` into `data-cardw` /
  `data-compact-w` / `data-anim`.
- **Lint**: slot coverage (`bound/total`), missing-required, unknown-slot
  with a did-you-mean suggestion, wrong node kind (catches outlined text),
  canvas-size mismatch, unbound-text inventory.
- **Two invariants** (pinned by `tests/unit/test_theme_compiler.py`):
  conforming hand-authored files pass through byte-identical, and a parse
  error returns the input untouched (an install is never blocked).

**Contract fidelity is the maintenance burden**: `theme_contracts.py` is a
hand-transcribed subset. The authoritative slot list is the **mount's header
comment + its actual `setText`/`setImage`/`slots[...]` calls** — always
broader than the old README table (matchup has away/home + seed + band-swap
slots the README omitted). When a mount gains/drops a slot, update the
contract in the same change. Elements with `slots=None` get grammar
translation but no slot lint — transcribe them (commentary, playerplates,
lowerthird, scorecard, scoreboards) as demand arrives.

Still by hand: authoring Commentary's per-count layout JSON, and marking which
group is the `tpl=` template. Still not built: the **starter-kit** design file
mirroring `default`, and a **live-preview dev page** for edit→see iteration —
build those with the user (designer eyes), and update this section + the
README when they land.

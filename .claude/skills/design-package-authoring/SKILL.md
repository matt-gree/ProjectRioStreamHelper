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

## Package anatomy + install rules (`server/design_packages.py`)

- A package = folder of per-element SVGs + optional `package.json`
  (`id`/`name`/`version`/`author`/`description`). Served at
  `/design/{pkg}/{element}.svg`.
- Built-ins in `public/design/{default,classic}/` (repo); user packages in
  `user_data/design_packages/<id>/` (never in the repo). Install = zip upload
  on Setup → Design or drop the folder in by hand.
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
   - Root `width`/`height` are stripped by the engine — size must come from
     the viewBox.
   - Gradients that must track geometry use `gradientUnits="userSpaceOnUse"`
     (commentary's per-position gradients: one gradient shared by main+sub,
     never split, never `objectBoundingBox`).
   - Elements the mount shows/hides start hidden (`style="opacity:0"`) where
     the contract says so; no `clip-path` on tween targets.
   - Fonts aren't embedded: use fonts the element shells load (Rio tokens'
     `--font-display` etc.) or web-safe stacks with fallbacks.
7. **Manifest + folder**: `package.json` with at least `id` + `name`; put raw
   design exports in `sources/` (served-suffix files only; it's for humans).

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
  `"palette": "app"`.
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

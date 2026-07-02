# Design Packages

A **design package** is a folder of themed SVGs — one per re-themable element —
plus an optional `package.json` manifest. The active package is picked globally
(Setup → Design → **Design Package**, stored at `overlays.global.designPackage`)
and every SVG element renders its file from that package.

```
<package>/
├── package.json      # { id, name, version, author, description } — all optional but recommended
├── commentary.svg    # the caster strip (1–4 reflowing plates)
├── lowerthird.svg    # the Break-phase broadcast band
├── matchup.svg       # the head-to-head band (series summary + 5 game cards)
├── callout.svg       # the post-game Stat Callout backdrop
└── sources/          # (optional) raw design exports, ignored by the app
```

Assets are served at `/design/{package}/{element}.svg`.

## Built-in vs installed

Two packages ship **built-in** in this folder and are part of the codebase:

| Package | Look |
|---------|------|
| `default` | The Project Rio brand: night-arena palette, Rio red (`#e60012`), star gold, Rajdhani display type. Fixed palette. |
| `classic` | The original PRSH overlay look — painted with the user's Design-tab knobs (accent, card background, font, shadows). |

Every other package is **user-installed** under
`user_data/design_packages/<id>/` and stays out of the repository. Install by
uploading a `.zip` on the Setup → Design tab (or dropping the folder there by
hand); uninstall from the same place. A built-in id can never be shadowed or
replaced by an installed package.

**Partial packages are fine.** A package may theme any subset of elements;
anything it doesn't provide falls back element-by-element to `default`. If a
file fails to fetch entirely, each mount also carries a minimal inline
fallback, so a broken package never blanks an OBS source.

## Palette policy: fixed vs app-vars

A theme chooses one of two palettes:

* **Fixed** (the default): the SVG brings its own colors as literal hexes. The
  user's Design-tab knobs never repaint it, so it always looks the way its
  designer intended (`default`, `slice26`, `chalk`).
* **App-vars**: add `data-design-vars="app"` to the root `<svg>` and paint with
  the Design-tab CSS variables. The mount then applies the user's design
  settings before rendering (`classic`).

App-vars themes may use: `--accent`, `--card-bg`, `--text-primary`,
`--border-color`, `--border-width`, `--font-family`, `--card-shadow-filter`,
`--text-shadow`.

**SVG gotchas (either palette):**

* `var()` resolves **only via inline `style="…"`** — never presentation
  attributes (`fill="var(...)"` silently does nothing).
* Corner radius (`rx`) cannot be a CSS variable.
* **XML comments cannot contain `--`** (breaks the parser) — watch for this in
  authored notes and em-dashes.
* Author at `viewBox="0 0 1920 1080"`. Bottom-anchored elements (commentary,
  lower third) use `preserveAspectRatio="xMidYMax meet"`; full-bleed backdrops
  (callout) use `xMidYMid slice`.

The Rio token layer (`/layout/lib/rio-theme/tokens.css`) is linked by the
element shells, so fixed-palette themes may also reference the brand token vars
(`--font-display`, `--band`, `--ink`, …) with literal fallbacks.

---

## Element contracts

The mounts bind data into elements marked `data-slot="<name>"`. Any slot a
theme omits is skipped — a minimal theme can use just a few. `<text>` slots may
carry `data-maxw="<svg-units>"`: long values shrink uniformly to fit.

### `lowerthird.svg`

Rendered by `public/layout/lib/lowerthird-mount.js`.

| Slot | Element | Filled with |
|------|---------|-------------|
| `logo` | `<image>` | Tournament logo (`/branding/`). Hidden if none uploaded. |
| `logo-default` | `<g>`/any | Your fallback brand mark — shown only when no logo is set. |
| `status` | `<text>` | `CURRENT` / `UP NEXT` (or the producer's manual status). |
| `side1-name` / `side2-name` | `<text>` | The two player names. |
| `side1-sprite` / `side2-sprite` | `<image>` | Captain headshot. Hidden if none. |
| `side1-score` / `side2-score` | `<text>` | Optional score; hidden when empty. |
| `title` / `subtitle` | `<text>` | Free text. |
| `clock-label` | `<text>` | e.g. `BACK IN` (hidden when empty). |
| `clock` | `<text>` | Countdown / count-up / time-of-day (tabular numerals). |

Runtime colour seams (set on the host, resolve through inline `style`):
`--side1` / `--side2` (each player's controller-port colour, overridable via
`overlays.lowerthird.port{0..3}Color`) and `--accent` (per-layout pin
`overlays.lowerthird.accentColor`).

### `commentary.svg`

Rendered by `public/layout/lib/commentary-mount.js`. Commentary shows 1–4
caster "plates" and **reflows** (GSAP-animated) to the active count, so a theme
defines one complete arrangement **per count** — 4 always-present position
groups plus an embedded layout JSON.

Each position `i` (0–3) is a `<g data-slot="slot{i}">` (the mount toggles its
opacity). Inside it:

| Element | Marked with | Notes |
|---------|-------------|-------|
| Card background | `data-part="main-rect"` on a `<rect>` | Required. Geometry (`x`/`width`) tweened per count. |
| Accent rail (optional) | `data-part="rail"` on a `<rect>` | `x` tweened. |
| Second badge (optional) | `data-part="sub-rect"` on a `<rect>` inside `slot{i}-sub` | `x`/`width` tweened. |
| Divider bar (optional) | `data-part="sub-divider"` on a `<rect>` inside `slot{i}-sub` | Extent auto-derived from the `sub` geometry, drawn middle-out on reveal. Author `y`/`height`/`fill` freely. |
| Caster name | `data-slot="slot{i}-name"` on a `<text>` | |
| Sub-info wrapper | `data-slot="slot{i}-sub"` on a `<g>` | The show/hide target. Start hidden (`style="opacity:0"`); the mount slides+fades it. No `clip-path`. |
| Sub-info label / value | `data-slot="slot{i}-sub-label"` / `-sub-value"` on `<text>` | The producer-chosen address-book field + its value. |

The layout JSON is a `<script type="application/json" data-layouts="1">` block:

```json
{ "counts": {
    "1": [ { "main": {"x":16,"width":1888}, "rail": {"x":32}, "sub": {"x":52,"width":1816},
             "grad": {"from":"#101018","to":"#181826"},
             "name": {"x":52,"maxw":1832}, "subLabel": {"x":52}, "subValue": {"x":130,"maxw":1746} } ],
    "2": [ "...pos0", "...pos1" ], "3": [ "..." ], "4": [ "..." ]
} }
```

Every count key `"1"`–`"4"` needs exactly that many position entries; each
entry's fields are optional (the mount only touches parts the theme has).
`grad` recolors `<linearGradient id="grad-{i}">`'s two stops — one gradient per
position (`gradientUnits="userSpaceOnUse"`), referenced by **both** `main-rect`
and `sub-rect`, its `x1`/`x2` derived from `main` so the sub plate's colour
reads as a continuation of the main ramp. Never split main/sub into separate
gradients or use `objectBoundingBox` here.

On first paint — and whenever the OBS source goes on air — the strip plays a
staggered group reveal; the mount debounces OBS's on→off→on visibility bursts.
A Design-Package swap resets to first-paint state, so the new theme cascades in.

### `matchup.svg`

Rendered by `public/layout/lib/matchup-mount.js`. The head-to-head band: an
all-time series summary over up to five most-recent game cards, fetched from
the Project Rio API for a match's two participants (`matchup.*` state — the
Fetch control on the Production page's Matchup History element).

| Slot | Element | Filled with |
|------|---------|-------------|
| `logo` | `<image>` | Tournament logo (`/branding/`). Hidden if none uploaded. |
| `logo-default` | `<g>`/any | Your fallback brand mark — shown only when no logo is set. |
| `subtitle` | `<text>` | The match label (e.g. `Winners Final`); hidden when empty. |
| `side1-name` / `side2-name` | `<text>` | The two player names. |
| `side1-sprite` / `side2-sprite` | `<image>` | The match's chosen captain headshot. Hidden if none. |
| `side1-wins` / `side2-wins` | `<text>` | All-time series win counts. |
| `total-games` | `<text>` | `ALL TIME · N GAMES` (or `FIRST MEETING`). |
| `game{i}` (i=1..5) | `<g>` | One recent-game card, newest first. Hidden when there's no i-th game. |
| `game{i}-side1-logo` / `-side2-logo` | `<image>` | That game's team logo (captain's default team), falling back to the captain icon. |
| `game{i}-side1-score` / `-side2-score` | `<text>` | Final score; the loser's is dimmed by the mount. |
| `game{i}-mode` / `game{i}-stadium` / `game{i}-date` | `<text>` | Game mode · stadium · short date; each hidden when empty. |

Runtime colour seam: `--accent` (per-layout pin `overlays.matchup.accentColor`).

### `callout.svg`

The post-game Stat Callout's full-bleed **backdrop layer** (the box-score
content renders on top of it; `public/layout/lib/postgame-callout-mount.js`).
No data slots — instead it recolors to the featured player via inherited vars:

| Variable | Meaning |
|----------|---------|
| `--port-color` | The featured player's controller-port accent (1–4). |
| `--port-2` | A complementary port colour (secondary wash). |
| `--accent` | The global design accent. |

Keep important shapes away from the extreme edges (the reveal wipe clips it).

---

## Building a package

1. Create a folder named after your package id (lowercase, `a-z0-9._-`).
2. Add a `package.json` with at least `id` and `name`.
3. Author whichever element SVGs you want to theme, per the contracts above
   (copy the built-ins in this folder as working references).
4. Zip it and install via Setup → Design, or drop the folder into
   `user_data/design_packages/` directly.
5. Hard-refresh the OBS browser sources (Cmd/Ctrl+Shift+R) after edits — theme
   SVGs are cached per page load.

**On the "just drop in a Figma export" workflow:** a flat export alone isn't
enough — it has no `data-slot`/`data-part` markers, and Commentary additionally
needs the count-by-count layout JSON (a single static export can't describe a
reflowing row). Marking up slots is inherent to any data-bound SVG. The
multi-count layout merge is the genuinely tedious part — worth automating with
a small ingestion script (N raw per-count exports + a padding/font config →
merged theme + layout JSON) if more Commentary themes get built.

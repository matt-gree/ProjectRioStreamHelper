# Design Packages

> **Designing a theme in Figma/Illustrator/etc.?** Read
> [`DESIGNER-GUIDE.md`](DESIGNER-GUIDE.md) instead — it covers the
> layer-naming grammar, export settings, and the install report. This file is
> the engineering reference: the raw slot contracts each mount binds, and the
> SVG-authoring rules. The two describe the same system at different levels.

A **design package** is a folder of themed SVGs — one per re-themable element —
plus an optional `package.json` manifest. The active package is picked globally
(Setup → Design → **Design Package**, stored at `overlays.global.designPackage`)
and every SVG element renders its file from that package.

Installed SVGs pass through the **theme compiler** (`server/theme_compiler.py`,
contracts in `server/theme_contracts.py`): it translates the designer
layer-naming grammar (`slot=`/`part=`/`tpl=` layer ids) into the `data-*`
markers below, normalizes export quirks, and lints against the element
contract. Hand-authored files that already use `data-*` markers are unchanged
(the compiler is a no-op on conforming input) — so everything in this document
still applies verbatim when authoring by hand.

```
<package>/
├── package.json         # { id, name, version, author, description, portColors } — all optional but recommended
├── commentary.svg       # the caster strip, 1920×240 (1–4 reflowing plates)
├── playerplates.svg     # the per-side name plates band, 1920×240
├── lowerthird.svg       # the Break-phase broadcast band, 1920×320
├── matchup.svg          # the head-to-head band, 1920×480 (series + 5 game cards)
├── callout.svg          # the post-game Stat Callout backdrop, 1920×1080
├── scorecard.svg        # the vertical Scorecard, 496×766 (stacked sections)
├── scoreboard-s.svg     # horizontal scoreboard, 388×156
├── scoreboard-l.svg     # horizontal scoreboard, 800×460
├── ticker.svg           # the Results Ticker marquee bar, 1920×80
├── statsbar.svg         # the per-team batter/pitcher stat bar, 452×118
├── statscard.svg        # the container-scoped stat card, 380×240
└── sources/             # (optional) raw design exports, ignored by the app
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

## The controller-port palette (`portColors`)

The one thing a package declares in its **manifest** rather than on an SVG root:

```jsonc
"portColors": ["#e53935", "#1e88e5", "#fdd835", "#43a047"]   // ports 1-4, in order
```

A player's side is tinted by the controller port they're on — the same four
colours across the **scoreboard, scorecard, lower third, Game Summary and
Character Spotlight**. No single element owns that, so it is one line in
`package.json` instead of four copies on five SVG roots.

* **Hex only**, and index *i* is always port *i + 1*. Declare fewer than four
  and the rest are left alone (`null`); a non-hex entry is dropped rather than
  failing the install.
* **Resolution:** the producer's own choice (Setup → Design → **Controller
  Ports**) → this declaration → PRSH's built-in convention (P1 red, P2 blue,
  P3 yellow, P4 green — what Project Rio and gc-overlay show).
* **No fallback to `default`.** Unlike a theme SVG, a manifest is not an
  element: a package that says nothing about ports gets *the app's* palette,
  not another package's. A token skin should not silently wear `default`'s
  ports.
* Declare it when your package's identity has its own player colours (a
  tournament's lime/teal, say). Leave it out when ports should keep matching
  what the players see on their own controllers.

Note this is **package-wide and orthogonal to the palette tier below** — a
full-art package and a token skin both declare it the same way, and both mounts
apply it themselves rather than through the app's CSS vars, so a full-art
element still honours it.

## Palette policy: fixed vs app-vars

A theme chooses one of two palettes:

* **Fixed** (the default): the SVG brings its own colors as literal hexes. The
  user's Design-tab knobs never repaint it, so it always looks the way its
  designer intended (`default`, `slice26`).
* **App-vars**: add `data-design-vars="app"` to the root `<svg>` and paint with
  the Design-tab CSS variables. The mount then applies the user's design
  settings before rendering (`classic`).

App-vars themes may use: `--accent`, `--card-bg`, `--text-primary`,
`--border-color`, `--border-width`, `--card-shadow-filter`,
`--text-shadow`.

### A CARD'S BLEED IS HALF THE WIDEST BORDER ITS PRODUCER CAN SET

**`--border-width` is a producer control, `borderWidth` runs 0-16px, and an SVG
stroke straddles its path** — so at the top of that range 8 units of the border
are drawn OUTSIDE the rect's own box. A card authored flush to its canvas
therefore cuts its own border off, and the failure is worse than it sounds: the
straight runs survive (they are only thinned) while the ROUNDED CORNERS, whose
outer arc lies furthest out, are sliced square. The card stops looking like a
card with a thin border and starts looking like a rendering fault, and it does
it only for the producers who touched the control.

So **every card keeps at least 8 units of canvas clear on every edge it
controls**, and the margins it controls are EQUAL. Classic's Stat Bar had 1 on
three sides and 3 on the fourth, which meant the Border Thickness slider was
usable over about a fifth of its range; its own corners went square at 4.

Two edges are usually not the theme's to control, and that is not an exception
to the rule: a row-stack card's HEIGHT is the active rows (`scoreboard-l`) and a
melding card's WIDTH is the visible segments (`scoreboard-s`), so those edges
are data. Author the stack so its MAXIMUM still clears 8.

The card SHADOW is deliberately not part of this budget. `cardShadowBlur`
defaults to 16 and reaches 80, and reserving even the default would cost a
452x118 bar a fifth of its height — a soft edge that fades out under a crop
costs a little of the falloff, where a hard border loses its corners.

### A DIVIDER IS WHITE; ONLY A BORDER IS `--border-color`

**`--border-color` and `--border-width` are one control in two halves, and an
internal rule can only honour one of them.** A hairline between two table cells
has a width of its own — 1, or 1.5 — because it is structure, not a card's edge;
so painting it with `--border-color` gives the producer a line they can recolour
and cannot size. Worse, it inverts what the control appears to do: pick a strong
colour to find a card's OUTLINE and what lights up is a grid of lines through
the middle of it, while the outline itself stays a hairline at whatever width
was set.

So `--border-color` paints **card and sub-card outlines only** — anything that is
the edge of a surface, including the small cards inside a band. Every internal
rule takes a literal white alpha instead: `rgba(255,255,255,0.12)` for a
divider, `0.15` for a drawn shape's outline. The palette still reaches them, via
`--card-bg` underneath.

A rule that separates nothing should not exist at all, whatever its colour.
Classic's Small board carried three — two marking segment boundaries the meld
already draws by growing the card, and one between two rows that a stacked logo,
name and score had already made into two rows.

**SVG gotchas (either palette):**

* `var()` resolves **only via inline `style="…"`** — never presentation
  attributes (`fill="var(...)"` silently does nothing).
* Corner radius (`rx`) cannot be a CSS variable.
* **XML comments cannot contain `--`** (breaks the parser) — watch for this in
  authored notes and em-dashes.
* Author at `viewBox="0 0 1920 1080"`. Bottom-anchored elements (lower third)
  use `preserveAspectRatio="xMidYMax meet"`; full-bleed backdrops (callout) use
  `xMidYMid slice`. Exception: the sized elements (scoreboard variants, ticker,
  statsbar) are authored at their native OBS-source canvas (e.g.
  `viewBox="0 0 800 460"`) with `xMidYMid meet`.
* **The two band elements (`commentary`, `playerplates`) are `1920 × 240`** —
  full stream width, because their horizontal placement is measured against the
  frame, but only as tall as the card, because how high up the scene a name band
  sits is a decision for whoever is building the scene, not for the theme. Their
  mounts pin the theme's box to the **bottom** of the source and crop what
  overflows, so a theme authored on the old full `1920 × 1080` canvas with the
  row parked near the bottom still lands correctly (Classic and Slice26 do).
  Keep `xMidYMax meet` either way. `server/theme_contracts.py` records both
  canvases as valid (`alt_canvases`) so the compiler doesn't warn.

The Rio token layer (`/layout/lib/rio-theme/tokens.css`) is linked by the
element shells, so fixed-palette themes may also reference the brand token vars
(`--font-display`, `--band`, `--ink`, …) with literal fallbacks.

---

## Element contracts

The mounts bind data into elements marked `data-slot="<name>"`. Any slot a
theme omits is skipped — a minimal theme can use just a few. `<text>` slots may
carry `data-maxw="<svg-units>"`: long values shrink uniformly to fit.

#### Atmosphere (optional, three elements)

The built-in `default` package gives its cards a drifting field of Project Rio
marks — see the notes in `default/lowerthird.svg`, which are the reference for
the whole system (size ladder, depth cues, the rim as a horizon). Two rules
matter to anyone porting it:

* **Marks are clipped to the card**, never to a rectangle in mid-air, so one
  can leave through a rounded corner and come back.
* **A clip hides a mark but keeps its animation ticking.** PRSH runs alongside
  the game, so a field authored wider than the card it shows in has to be
  prunable — hence `data-l` / `data-r` below.

Who owns the clip depends on who owns the geometry:

| Element | Field lives | Clipped by |
|---------|-------------|------------|
| `lowerthird` | `<defs>`, `band-field` / `band-field-near`, authored across the strip | the mount, per bed island |
| `commentary` | `<defs>`, `data-slot="field"` (plate) and `"sub-field"` (drawer), authored across the canvas | the mount, per surface — the plate's width is the mount's (it changes per count) |
| `playerplates` / `matchup` | inline, in the group it belongs to, marked `data-part="field"` / `"sub-field"` | the theme, with its own `clipPath` — the geometry is fixed |

Marked-up inline fields (`playerplates`) still get one thing from the mount:
it stops them ticking while their surface is off air or their drawer is closed.
Opacity 0 doesn't stop a CSS animation, and a hidden plate would otherwise
animate its marks for the rest of the broadcast.

**A drawer's field is rebindable.** On `commentary` and `playerplates` the
sprites inside a `sub-field` are authored as the house mark and marked
`data-part="sub-glyph"`; the mount repoints them at whichever mark the slot's
address-book field resolves to, so an X drawer drifts X marks. See
`public/layout/lib/sub-glyph.js`.

### `lowerthird.svg`

Rendered by `public/layout/lib/lowerthird-mount.js`. The band is a **slot
system**: up to five producer-picked segments (`lowerthird.slots.1..5`), each
one content type. The theme supplies one **template per content type**; the
mount clones a template per enabled slot, lays the clones out left→right, and
stretches the shared bed to the row. Segment widths are unequal on purpose —
each type's width belongs to the theme.

Structure the theme provides:

| Marked with | Element | Notes |
|-------------|---------|-------|
| `data-band` + `data-x` / `data-w` / `data-h` / `data-gap` / `data-align` | `<g>` | The row container the clones go into. `data-align`: `center` (default) / `left` / `right`. If the picked segments overflow `data-w`, the whole row scales down uniformly (vertically centred within `data-h`). |
| `data-slot="band-bg"` + `data-pad` | `<rect>` | Optional bed. The mount clones it **once per content island** (a `space` slot splits the band into islands), sizing each clone's `x`/`width` to that island (inset by `data-pad`); `y`/`height`/`rx`/paints are yours. With no `space` slot there is one island == the whole row. |
| `data-tpl="{type}"` + `data-w` | `<g>` in `<defs>` | One template per content type, authored at a local `(0,0)` origin at band height. A missing template makes that type unavailable in this theme. The `space` slot is structural (no template needed). |
| `data-slot="band-field"` / `"band-field-near"` | `<g>` in `<defs>` | Optional **atmosphere** (see below). The mount clones each plane once per island and clips it to that island's bed, `band-field` under the segment content and `band-field-near` over it. |

Content types and their sub-slots (inside the template; any may be omitted):

| `data-tpl` | Sub-slots |
|------------|-----------|
| `logo` | `logo` (`<image>`, tournament logo from `/branding/`), `logo-default` (fallback mark shown when no logo), `title` (optional caption) |
| `match` | `status` (`CURRENT`/`UP NEXT`/override), `time` (the match's `scheduledAt`), `meta` (auto `Competition Phase · Round` from the bound match — each part shown only if present, hidden when the match has none), `meta-card` (optional `<rect>` backing plate the mount shows/hides with `meta`), `side1-name`/`side2-name` (slide into the sprite's slot when no captain is set), `side1-sprite`/`side2-sprite` (captain headshots), `side1-score`/`side2-score` (series wins, hidden at Bo1) |
| `scorebox` | `status` (`TOP 5` / `FINAL`), `side1-name`/`side2-name`, `side1-score`/`side2-score` (live runs, `score.{N}.score_left/right`) |
| `merch` | `image` (`/branding/merch/…`), `image-default` (theme-baked artwork — e.g. a product cluster — shown while no image is picked), `title`, `subtitle` |
| `clock` | `clock-label`, `clock` (countdown / count-up / time-of-day, tabular numerals) |
| `message` | `title`, `subtitle` |
| `bracket` | `label` (default `BRACKET`), `title` (loaded phase name), `subtitle` |
| `space` | *(no template)* — a spacer that splits the band. Flex-fills the leftover width (pushing content to the corners), or holds a fixed px width via `lowerthird.slots.{i}.width`. |

Runtime colour seams (resolve through inline `style`): `--accent` on the host
(per-layout pin `overlays.lowerthird.accentColor`), and `--side1` / `--side2`
set **per match/scorebox segment** from that segment's controller ports
(overridable via `overlays.lowerthird.port{0..3}Color`).

### `commentary.svg`

Rendered by `public/layout/lib/commentary-mount.js`. Commentary shows 1–4
caster "plates" and **reflows** (GSAP-animated) to the active count, so a theme
defines one complete arrangement **per count** — 4 always-present position
groups plus an embedded layout JSON.

Spacing across the counts is the theme's call, and the `default` package's
choice is documented in its own header: plates shrink as the row fills *and* the
gap between them collapses, so a full row closes ranks into one strip while a
pair reads as two separate people. The row is a centred cluster that never
reaches the frame edges.

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
| Sub-info label / value | `data-slot="slot{i}-sub-label"` / `-sub-value"` on `<text>` | The producer-chosen address-book field + its value. The **label is optional and both built-in packages omit it** — a field name is something the producer needs in the app, not on the stream. See the badge below, and `sub-glyph.js` for the reasoning. |
| Sub-info badge (optional) | `data-part="sub-icon"` on a `<use>` inside `slot{i}-sub` | The mark that says which platform a bare handle belongs to. `x` tweened from `subIcon` in the layout JSON; the mount sets its `href` and shows it only for fields that map to a mark it can draw. Declaring it means declaring all of `sub-glyph-x`, `sub-glyph-youtube` and `rio-mark` — a missing symbol is indistinguishable from a field that wears no mark. |
| Atmosphere (optional) | `data-slot="field"` / `"sub-field"` on a `<g>` in `<defs>` | One field per surface, authored across the whole canvas; the mount clones each into every plate and clips it to that plate's `main-rect` / `sub-rect`, so four plates show four slices of one scatter. Each direct child is one sprite and must declare `data-l` / `data-r` — the exact horizontal extremes of its own motion — or it stays animating in plates that can't show it. `sub-field` sprites also carry `data-part="sub-glyph"` (rebindable — see above). |

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

### `playerplates.svg`

Rendered by `public/layout/lib/playerplates-mount.js`. A sibling of Commentary —
the same plate + sub-plate convention — but a fixed **two-player** band. It shows
one or both single-player plates and moves each to a named anchor
(`left` | `center` | `right`); which plates are up and where each one sits is
fully resolved server-side, so a theme only defines the plate look and the anchor
offsets.

Two position groups, `<g data-slot="side1">` and `<g data-slot="side2">`, are
**both authored at the `left` anchor** (they overlap at rest; the mount moves and
reveals them). The `default` package puts `left` and `right` exactly where
Commentary's two-caster row puts its plates, so cutting between the desk and the
matchup doesn't shift the lower band sideways. Inside each `side{n}`:

| Element | Marked with | Notes |
|---------|-------------|-------|
| Card background | `data-part="main-rect"` on a `<rect>` | Required. |
| Accent rail (optional) | `data-part="rail"` on a `<rect>` | |
| Divider bar (optional) | `data-part="sub-divider"` on a `<rect>` inside `side{n}-sub` | Extent auto-derived from its authored width, drawn middle-out on reveal. |
| Player name | `data-slot="side{n}-name"` on a `<text>` | |
| Sub-info wrapper | `data-slot="side{n}-sub"` on a `<g>` | Show/hide target. Start hidden (`style="opacity:0"`); the mount slides+fades it. No `clip-path`. |
| Sub-info label / value | `data-slot="side{n}-sub-label"` / `-sub-value"` on `<text>` | As Commentary: the label is optional and both built-in packages omit it in favour of the badge. |
| Sub-info badge (optional) | `data-part="sub-icon"` on a `<use>` inside `side{n}-sub` | As Commentary, but at a fixed `x` — this band never reflows. Also reads a MANUAL side's typed label when there's no `subField` to resolve. |
| Atmosphere (optional) | a clipped `<g>` inside `side{n}`, marked `data-part="field"` / `"sub-field"` | The theme carries its own `clipPath` and the field travels with the card — the plate never resizes, only the whole group translates. The mount only stops the marks ticking while the surface is hidden, and rebinds `sub-field`'s sprites. Give the two sides **different** scatters — identical marks in identical places on adjacent plates read as a copy-paste. |

The layout JSON is a `<script type="application/json" data-layouts="1">` block
mapping each anchor to an **X offset** (svg units) from the authored `left`
position — the mount tweens the whole plate group's transform to it:

```json
{ "anchors": { "left": 0, "center": 582, "right": 1164 } }
```

With both plates up the mount puts side 1 at `left` and side 2 at `right`; a
plate on air alone goes to the producer-chosen anchor. Enter/exit (rise / drop)
and the on-air group reveal reuse the Commentary motion + OBS-visibility
debounce.

### `matchup.svg`

Rendered by `public/layout/lib/matchup-mount.js`. The head-to-head band: an
all-time series summary over up to five most-recent game cards, fetched from
the Project Rio API for a match's two participants (`matchup.*` state — the
Fetch control on the Production page's Matchup History element).

| Slot | Element | Filled with |
|------|---------|-------------|
| `logo` | `<image>` | Tournament logo (`/branding/`). Hidden if none uploaded. |
| `logo-default` | `<g>`/any | Your fallback brand mark — shown only when no logo is set. |
| `event-name` | `<text>` | The start.gg event/tournament name; hidden when empty. |
| `subtitle` | `<text>` | The match label (e.g. `Winners Final`); hidden when empty. |
| `side1-name` / `side2-name` | `<text>` | The two player names. |
| `side1-sprite` / `side2-sprite` | `<image>` | The match's chosen captain headshot. Hidden if none. |
| `side1-seed` / `side2-seed` | `<text>` | Bracket seed from the bound set (`#1 SEED`); hidden when unseeded. |
| `side1-wins` / `side2-wins` | `<text>` | All-time series win counts. |
| `total-games` | `<text>` | `ALL TIME · N GAMES` (or `FIRST MEETING`). |
| `history` / `history-container` | `<g>` | The card region; `display:none` when the two have no shared history. |
| `band-full` / `band-compact` | any | Two band backgrounds; the compact one swaps in with no shared history. |
| `game{i}` (i=1..5) | `<g>` | One recent-game card, newest first. Hidden when there's no i-th game. |
| `game{i}-side{T}-row` | `<g>` | That side's whole row — logo included — dimmed when it lost. |
| `game{i}-side{T}-win` | `<g>` | That side's **winner marker**; shown only on the side that won. |
| `game{i}-side{T}-logo` | `<image>` | That game's team logo (captain's default team), falling back to the captain icon. |
| `game{i}-side{T}-score` | `<text>` | Final score. |
| `game{i}-side{T}-name` | `<text>` | That side's player, restated on every card. |
| `game{i}-{away,home}-*` | — | The same four, oriented by the game's own away/home instead of by side. |
| `game{i}-date` / `game{i}-date-full` | `<text>` | The game's date, short (`SEP 8`) or with the year. **Prefer the full one on a card**: a head-to-head reaches back seasons, so a bare `SEP 8` on the fifth card dates it to no particular year. |
| `game{i}-mode` | `<text>` | The game mode — the competition the game belonged to. Hidden when empty. |
| `game{i}-stadium` | `<text>` | The park. Bound by the mount, **drawn by neither shipped theme** — see below. |

Runtime colour seam: `--accent` (per-layout pin `overlays.matchup.accentColor`).

**A CARD'S FOOTER IS ONE LINE.** The mode and the stadium were two dim 19px
lines stacked in the same face, colour and weight, so they read as one
indistinguishable grey block under the scoreline rather than as two facts —
nothing told the eye which mattered, and together they were the tallest thing
on the card after the rows. The mode is the competition and earns its place;
the park is flavour a history card does not need (Slice26 dropped it for the
same reason, and it is the producer's own call here). `game{i}-stadium` stays a
real slot the mount binds, so a theme that wants it only has to draw it. What
remains matches the **date** it brackets — 17px, not 19 — so the two captions
frame the rows instead of competing with them, and the line they gave up went
to the rows: 48 units tall and snug, 56 now.

**A PORTRAIT BESIDE A NAME HAS NO AUTHORABLE `x`**, because the name's width is
the data. Declare the relationship instead and the mount measures it:
`data-pin-before="<slot>"` / `data-pin-after="<slot>"` place this node's inner
edge `data-pin-gap` (default 16) from that text slot's measured edge —
`pinBesideText` / `applyTextPins` in `mount-utils.js`, applied after the
auto-fit, since the fit changes the very width being measured. Opt-in: a theme
that declares neither keeps its authored `x`. Both fixed alternatives were
tried on air and both fail, in opposite directions: portrait *outside* an
inward-anchored name left a short tag (`Joan`, 82 units) with its captain icon
floating 170 away while a long one (`MattGree`, 153) sat 95 from it; portrait
*inside*, next to the score, just moves the hole to the far side of the name
and holds 108 units of it open on every board with no match bound, because a
captain only exists once a match is bound.

**A card has to say WHO WON, and an opacity does not say it.** The band's only
outcome cue used to be a 0.45 dim on the losing *score*, which is not a cue at
broadcast size — and the card it sat on named neither player, so reading the
dim right still only told you which NUMBER lost. The team logos are no
substitute: they are the CAPTAINS' teams, and those change game to game, so
one player is Mario on card 1 and Yoshi on card 2. `rowOutcome` in
`matchup-mount.js` is the rule, and a theme may take any subset of the three
markers — but `-row` and the per-node dim are **exclusive**: a row group whose
children were also dimmed would multiply to 0.2, which reads as a rendering
fault rather than as a result.

### `callout.svg`

The full-bleed **backdrop layer** shared by both post-game callouts — the
single-character Stat Callout (`public/layout/lib/postgame-callout-mount.js`)
and the player-vs-player Game Summary
(`public/layout/lib/postgame-vs-mount.js`). The stat content renders on top of
it. No data slots — instead it recolors via inherited vars:

| Variable | Meaning |
|----------|---------|
| `--port-color` | Stat Callout: the featured player's controller-port accent. Game Summary: side 1's colour. |
| `--port-2` | Stat Callout: a complementary port colour. Game Summary: side 2's colour. |
| `--accent` | The global design accent. |

A package may also **declare** its palette on the SVG root (inline `style=`, or
a `<style>` block); both callout mounts read these off the injected `<svg>` via
`getComputedStyle` and key their rails, glass wells and numerals to them. Each
is independent — declare only what you want to pin, and anything you leave out
falls back to the live controller-port colours / the producer's global accent:

| Declared variable | Meaning |
|-------------------|---------|
| `--side1` / `--side2` | Fixed side colours (side 1 = left, side 2 = right), for **these two elements only**. slice26 pins these; **default deliberately does not**, so sides stay bound to each player's controller port. To recolour the ports themselves — across every element, not just the callouts — declare `portColors` in the manifest instead (above). |
| `--well` | Glass-well tint for every card surface (any CSS color). |
| `--accent-neutral` | Neutral accent (FINAL, winner mark, star pips). Overrides `overlays.global.accentColor` for these two elements. |

**Do not make `--well` white.** A white/near-white well is the neutral that sits
between the two side colours, and with the default port palette (port 1 red,
port 2 blue) a white neutral turns the whole scene into a flag. The default
package pins a smoked night glass and keys all remaining chrome — borders,
label chips, bar tracks, captions — to the fog/night scale in
`layout/lib/rio-theme/tokens.css`. Both mounts expose that chrome as a named
set (`--ink`/`--ink-2`/`--ink-3`/`--ink-4`, `--edge`, `--edge-soft`, `--sheen`,
`--slab`, `--scrim`) so a package restyling one restyles the other identically.

**Where the two side colours meet, don't let them touch.** A rule split at
x=960 with one port's colour on each half draws a hard red-against-blue seam
across the bottom of the frame, which is the same flag problem in miniature.
The default fades each half out well before centre and lets Rio red carry the
rule across the middle, so it reads as one continuous line changing hands.

**Everything in this backdrop is static except a floor-height mushroom field.**
It is full-canvas and it sits under a scene whose every card is a large
translucent surface animated by GSAP, on a machine that is also running the game
— so a continuously animating layer here is re-composited on every one of those
frames. Motion has to stay a **small, unmasked, transform-only group**: never a
full-canvas layer, never `patternTransform` or gradient offsets (they re-tile
the whole 1920×1080 every frame), and never anything inside a `<mask>`. The
default spends its whole budget in one place — 12 marks of the same drifting
field the lower third uses, one animation each, all of them held in the bottom
of the frame so the union of their travel is a 248px band rather than the
canvas — and it **crops every masked and patterned layer to where it actually
paints** so that nothing but two plain gradient rects sits underneath that band.
Both halves matter: the first cut of this field ran 20 marks on two animations
each over uncropped full-canvas masked layers, and it was laggy on air.
Everything else rasterises once. For the same reason
neither mount uses `backdrop-filter` any more: the wells are ~82% opaque, so
there was no visible backdrop to blur and every card was forcing a readback.

Keep important shapes away from the extreme edges (the reveal wipe clips it).

### `scorecard.svg`

The vertical Scorecard (`public/layout/lib/scorecard-mount.js`): eight
independently toggleable sections melded into one continuous card. The full
stack + slot contract is documented in the comment block at the top of
`default/scorecard.svg` — copy that file as the working reference.

The canvas is the CARD (496×766 — a 480-wide column inside an 8-unit gutter, by
the tallest the stack gets), not the stream frame, and the card top-anchors so
the slack below it as sections come and go is transparent. The mount reads the
card's box back off `card-bg`/`card-rail`, so a package still authored on the
old full 1920×1080 canvas is cropped to its own column rather than shrunk to a
quarter — but that is a rescue for old packages, not a way to author a new one.

### `scoreboard-{s,l}.svg`

The horizontal Scoreboard (`public/layout/lib/scoreboard-mount.js`), one file
per size variant at its native canvas (388×156, 800×460). A retired size (`m`,
`xs`, `xl`) has no file — the mount resolves it to `l`.
Each is a row-stack: groups `row-top` / `row-inning` / `row-live` /
`row-final` / `row-roster` / `row-box` / `row-mode`, authored at a local y
origin of 0 with `data-h`, melded by the mount into a card sized via
`card-bg` (+ optional `card-rail`).
A size implements whatever row subset fits — only `row-top` is always drawn;
`s` carries the compact set and omits the roster and box score. The
full slot list is in the header comment of `scoreboard-mount.js`; runtime
colour seams `--side1` / `--side2` carry each player's controller-port colour.

### `schedule.svg`

The Upcoming Schedule (`public/layout/lib/schedule-mount.js`): the running
order as a board, authored full-canvas at 1920×1080 because the card's HEIGHT
is the row count.

| Slot | Node | What it is |
|---|---|---|
| `card` | `<g>` | the whole board. The mount rewrites its translate **Y** each render so the card stays centred as it grows; the authored **X** is kept. |
| `card-bg` | `<rect>` | the plate. `data-compact-h` = its height with ZERO rows; the mount sets `height`. |
| `title` | `<text>` | the heading (`schedule.title`). |
| `rows` | `<g>` | where row clones are parked, at `y = index × pitch`. |
| `match-template` | `<g>` | the prototype row, hidden at `opacity:0`. `data-h` = the row **PITCH** (drawn height plus the gap under it), not its drawn height. |
| `overflow` | `<text>` | "+N MORE", authored INSIDE `rows` so its `y` is row-space. `data-h` = what it adds to the card when it shows. |

Row parts (`data-part` inside `match-template`, all optional): `row-bg`,
`rail`, `label`, `status`, `side1-name`, `plate`, `plate-text`, `side2-name`.
One more part lives OUTSIDE the template: `field`, the optional atmosphere
layer.

**Two numbers make the card resizable without a code change** — `data-compact-h`
and `data-h`. A theme that wants taller rows changes its pitch and nothing else;
a theme that forgets one falls back to the mount's defaults (124 and 82), which
will be wrong for its own artwork rather than broken.

**THE RAIL IS ONE COLOUR AT THREE STRENGTHS.** A row is live, upcoming or
played, and the mount says which in the rail's `fill-opacity` (1 / 0.3 / 0.15)
over whatever the theme painted it. So author the rail in the accent and leave
the state to the mount: three authored colours would be a fourth palette,
agreeing with neither the package nor the producer's accent. A played row is
dimmed ONCE, on the clone's own group — never dim a part as well, or the two
multiply (`rowOutcome` in `matchup-mount.js` is the same trap stated for the
matchup cards).

**The rows are a table, so keep atmosphere out of them.** `default/schedule.svg`
runs its mark field in the HEADER only, clipped by the theme's own `clipPath` —
the header is the one part of this card whose geometry is fixed, and a drifting
mark behind a column of names is the one place the field costs legibility
outright.

### `ticker.svg`

The Results Ticker (`public/layout/lib/ticker-mount.js`): the 1920×80 bar
plus ONE prototype game card, `<g data-slot="card-template" data-w="…">`,
whose inner parts are marked `data-part` (`card-bg`, `away-name`, `home-name`,
`away-cap`, `home-cap`, `away-row`, `home-row`, `away-win`, `home-win`,
`score-group`, `score-away`, `score-home`, `vs`, `meta`, `stadium`). The mount
clones the template per game into `<g data-slot="track">` (declare the visible
width with `data-vw`) and scrolls it; clip the track region with a `<clipPath>`
so cards don't escape the bar.

Three rules a theme has to compose with, none of them cosmetic:

- **Anchor the card on its CENTRE.** Pin the score plate there, anchor each
  name INWARD against it, and pin each captain icon to the measured outer edge
  of its name with `data-pin-before` / `data-pin-after` / `data-pin-gap` (the
  mount resolves them per clone, after the auto-fit). Names pinned to the
  card's outer edges instead put a *variable* hole between a name and the
  number it labels — 23% of the shipped card, breathing as the names changed.
  What should vary with a name's length is the card's outer margin.
- **State the outcome on both sides.** `away-win` / `home-win` is the winner's
  own marker, shown on the winning side only; `away-row` / `home-row` is that
  side's whole cluster, dimmed for the loser. Take any subset, but a row group
  and a per-node dim are mutually exclusive — see `rowOutcome` in
  `mount-utils.js`, shared with `matchup.svg`'s history cards. A dim on the
  losing number alone is not a cue at broadcast size, and a ticker's numbers
  are moving.
- **Draw the plate outside every part.** `score-group` is hidden on a game with
  no result, so anything inside it disappears on a live card. The plate is the
  fixed object the eye tracks as the cards go past; it belongs in the theme's
  own chrome, with `vs` swapping in where the numbers were.

`meta` is the composed footer and carries the game MODE and the date — the same
call `matchup.svg`'s cards make, for the same reason. `stadium` is bound
separately and drawn by no shipped theme; a package that wants the park only
has to draw it.

The default package runs its mushroom field on the RESULTS badge
(`data-part="field"`, clipped to the badge's own shape). That is the one static
region of a moving element: drifting marks behind the track would fight the
scroll, and a sprite inside `card-template` would be animated once per clone.
On the badge's saturated accent ground the mark's own red pixels vanish, so the
opacities run roughly double the dark-band elements' — tune them against a
render, not by copying a number.

### `statsbar.svg`

The per-team stat BAR (`public/layout/lib/stats-card-mount.js`), 452×118 — the
wide, four-across half of the pair `statscard.svg` completes:
`char-icon`, `stat-{0..5}-value` / `stat-{0..5}-label` (four filled today),
and a `line-group` bottom row (`line-label` + `line-text`) that hides when
empty — declare `data-h-full` / `data-h-compact` on `card-bg` so the card
shrinks with it. Wrap everything bindable in `<g data-slot="content">` (the
batter-change dissolve target).

### `statscard.svg`

**The same element at a different aspect** — same mount, same slots, same
`RioData.getStatsLine` resolution as `statsbar.svg`, authored 380×240 as a 2×2
grid instead of a four-across bar. It is what the **Stat Card** container member
renders (`fed-container.js`) — including what a container flashes over its
resting roster on a batter change; there is no standalone Stats Card source. A package that themes `statsbar` and not `statscard` gets the
`default` 2×2 card next to its own bar, so theme both or neither.

It adds two **optional caption bands** the wide bar has no room for: a header
(`head-group` + `head-text`) naming the stat set, and the footer `line-group`.
Each owns one edge of the card, so all four on/off combinations come from one
pair of authored positions rather than four layouts — declare them on `card-bg`:

| attribute | the card's… |
|---|---|
| `data-top-open` / `data-top-closed` | `y`, with and without the header |
| `data-bot-open` / `data-bot-closed` | bottom edge, with and without the line |

The mount animates between them at the scorecard's 0.45s `power3.out`, fading
each band clear of its travelling edge. A theme with a footer and no header may
declare `data-h-full` / `data-h-compact` (heights, fixed top edge) instead; a
theme declaring neither keeps its authored geometry. A theme still authored at
the older 380×220 renders at natural size, centred in the taller box — nothing
scales — which is how `slice26`'s card keeps working untouched.

One more difference from `statsbar.svg`: the mount stamps `data-team` on the root
`<svg>`, so a theme can paint per side with `svg[data-team="1"] …` (the built-in
doesn't; `slice26` does on its bar).

### Bracket (no SVG)

The bracket is generative — its geometry comes from the loaded bracket data —
so it can't be themed with a package SVG. Instead it follows the package
family: the `classic` package paints it with the Design-tab knobs; every
other package gets the fixed Rio night palette baked into
`public/layout/bracket/index.html` (`body.rio-package`).

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

**On the "just drop in a Figma export" workflow:** a flat export alone still
isn't a theme — but the gap is now bridged by the layer-naming grammar + theme
compiler (see [`DESIGNER-GUIDE.md`](DESIGNER-GUIDE.md)). A designer names
layers `slot=side1-name` etc.; the compiler emits the `data-*` markers and
lints coverage on install. Two element classes still need structure a flat
export can't express:

- **Commentary** needs the count-by-count layout JSON (a single static export
  can't describe a reflowing row). Worth a dedicated ingestion step (N raw
  per-count exports + a padding/font config → merged theme + layout JSON) if
  more Commentary themes get built; not yet automated.
- **lowerthird / ticker** need `tpl=`-marked template groups; the compiler
  relocates them into `<defs>` but the designer must still mark which group is
  the template.

Slot-only elements (matchup, statsbar, scoreboards, scorecard) are the fully
round-trippable ones today.

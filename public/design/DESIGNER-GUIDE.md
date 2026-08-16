# Designing a PRSH theme (for designers)

You can build a PRSH overlay theme in **any vector tool that exports SVG with
layer names** — Figma, Illustrator, Affinity Designer, Penpot, Sketch,
Inkscape. You never touch XML. You draw each overlay on a correctly-sized
frame, **name the layers** that hold live data with a short grammar, export to
SVG, and drop the files in. PRSH's theme compiler translates your layer names
into the data bindings, fixes common export quirks, and hands you a report
listing anything that won't work — so you fix it in your design tool, not in
code.

The rule that never changes: **you own the look (layout, color, type,
shapes); PRSH owns the motion and the data.** You lay out where the player's
name goes and how it looks; the app fills in the name and animates the card.

---

## 1. Name your data layers

Any layer whose content PRSH fills in gets a name starting with `slot=`:

| You want… | Name the layer |
|---|---|
| The left player's name | `slot=side1-name` |
| A tournament logo image | `slot=logo` |
| A team logo on game card 3 | `slot=game3-side1-logo` |

Add **modifiers** after a space to pass sizing hints:

| Modifier | Means | Example |
|---|---|---|
| `maxw=420` | Long text shrinks to fit this width (SVG units) | `slot=side1-name maxw=420` |
| `w=620` | A template card's width | `tpl=match w=620` |
| `anim=expand-right` | (scoreboard, absolute mode) this group wipes open to the right when it appears and collapses when it hides — draw it in its open position | `slot=row-live anim=expand-right` |

Two more markers you'll rarely need (advanced elements only):

- `part=away-name` — a piece **inside** a repeating card (ticker/lower-third).
- `tpl=match w=620` — a **template** card the app clones per game/segment.
- `layout=absolute` — an invisible marker layer that switches the overlay to
  **absolute layout**: the app honours the exact vertical positions you draw
  instead of auto-stacking its rows. Recommended for the scoreboard so you can
  place every row by hand in the fixed frame. (See the scoreboard template.)

Notes:
- Names are **case-insensitive** and use lowercase letters, digits, and
  dashes: `slot=side1-name`, not `slot=Side 1 Name`.
- Some tools replace spaces with underscores on export — that's fine,
  `slot=side1-name_maxw=420` is understood.
- Layers you **don't** name are treated as decoration (backgrounds, rails,
  labels like "HEAD TO HEAD") and left exactly as you drew them.

**Which slot names exist for each overlay** is listed in
[`README.md`](README.md) under "Element contracts," and — most usefully — in
the built-in `default/` package: open `default/matchup.svg` (etc.) in your
tool to see every slot already named on a working layout. Duplicate a
built-in and restyle it; that's the fastest start.

---

## 2. Draw at the right size

Each overlay has a fixed canvas. Match it exactly (the compiler warns if you
don't):

| Overlay | Canvas |
|---|---|
| Scoreboard (s / m / l) | 388×156 · 600×200 · 800×460 |
| Stat card | 452×118 |
| Container stat card | 380×240 |
| Results ticker | 1920×80 |
| Bands (commentary · player plates · lower third · matchup) | 1920×240 · 240 · 320 · 480 |
| Everything full-screen (scorecard, callout, …) | 1920×1080 |

The bands may also be drawn on the full 1920×1080 stream canvas — put the
artwork where it sits on the stream (they all hug the bottom) and the mount
pins it to the bottom of the source and crops the empty canvas above it. Either
way, copy the built-in's frame.

---

## 3. Export

- Export as **SVG**.
- Turn **on** "Include layer/object names as IDs" (Figma: it's on by default
  for named layers; Illustrator: Style → *Presentation Attributes*, and check
  *Include Unused Graphic Styles* off / *Responsive* off).
- Turn **off** "Outline text" / "Convert text to outlines." PRSH fills text
  slots with live values — if the text is outlined into shapes, it can't. The
  compiler warns when it finds an outlined text slot.
- Name the file after the element: `matchup.svg`, `stats.svg`,
  `scoreboard-l.svg`, etc.

---

## 4. Assemble and install the package

A **package** is a folder:

```
my-theme/
├── package.json      { "id": "my-theme", "name": "My Theme", "author": "You" }
├── matchup.svg       ← any subset — untouched elements fall back to Default
├── stats.svg
└── sources/          ← optional; your working files, ignored by the app
```

- `package.json` needs at least `id` (lowercase, dashes) and `name`. Add
  `"palette": "app"` **only** if you want the app's Design-tab color knobs to
  paint your theme instead of your own fixed colors.
- You may theme **as few elements as you like** — a one-element package is
  valid; anything you omit keeps the Default look.

Install: zip the folder and use **Setup → Design → Install…**, or drop the
folder straight into `user_data/design_packages/`. On install, PRSH shows an
**install report**.

---

## 5. Read the install report

The report lists each file with a slot-coverage count and any findings:

```
matchup.svg — 14/17 slots bound
  ⚠ missing required slot(s): side1-name — these stay empty on stream
  ⚠ unknown slot 'plyaer-name' — did you mean 'side1-name'?
  ⚠ slot 'side2-name' is on <path> but should be <text> — was the text outlined on export?
```

- **⚠ warnings** are things that won't work: a required slot missing, a
  misspelled name (with a suggestion), text that got outlined, or a wrong
  canvas size. Fix these in your design tool and re-install.
- **info** lines are FYI: quirks the compiler fixed for you, and a list of
  unbound text (fine when it's decoration).

Iterating a lot? The same check runs from the command line without installing:

```
python scripts/compile-theme.py my-theme/matchup.svg      # report only
python scripts/compile-theme.py --write my-theme/         # fix a whole folder in place
```

---

## What you can't re-layout (yet)

The **post-game callouts** (Character Spotlight, Game Summary) are laid out in
code. You can re-skin their **backdrop** (`callout.svg`) and their **colors**,
but not rearrange their cards. Everything else on this list is fully yours.

For the exact per-element slot lists and the engineering details, see
[`README.md`](README.md).

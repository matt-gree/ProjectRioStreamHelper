# Scoreboard design notes (for the Figma round trip)

Companion to `scoreboard-s.template.svg` and `scoreboard-l.template.svg`. The
scoreboard is the most data-dense element in PRSH, so read this before
restyling.

## The two sizes and what fits

| Size | Canvas | Layout | Rows it uses |
|---|---|---|---|
| s | 388×156 | **absolute** (melds) | `row-top`, `row-bottom`, `row-inning`, `row-live`, `row-mode` |
| l | 800×460 | **stack** | all rows (+ rosters, box score) |

Each size is its own file and its own frame — there is no responsive
relationship between them, and nothing is ever scaled. A size implements
whatever subset of the slot vocabulary fits it. **Don't resize the outer
frame**: place inside it freely, but keep it locked to the native size.

The two are far apart on purpose: `s` is a compact pill that says who is
playing and what the count is, `l` is the full card with rosters and a
linescore. A middle size existed (`m`, 600×200) and was retired on 2026-08-29 —
it had no content of its own, only `l`'s at a smaller scale, so every
improvement to either end pulled it back toward `l` until the two were the same
card 200 units apart. (Retired sizes — `m`, `xs`, `xl` — have no file; the app
resolves them to `l`, so a source that still names one keeps rendering.)

Both canvases are pinned across the app, the server and the mount by
`tests/unit/test_size_dims_parity.py`, so a size quoted anywhere else is a
guess. These are the real ones.

## Two layout contracts, and which one you're in

The root frame either declares `data-layout="absolute"` or it doesn't, and that
single fact changes what your positions mean.

### Absolute — you place everything (Scoreboard S)

WYSIWYG. What you see in the frame is exactly what ships. The app pours in
content and shows/hides rows; it never moves a piece you placed. (One
exception: the captain ring `sT-cap-ring` is snapped onto the captain's roster
slot.)

To declare absolute mode from a tool that can't edit the root `<svg>`, drop an
invisible layer named **`layout=absolute`** anywhere — the compiler lifts it to
the root and deletes the helper.

### Stack — the app assembles the card (Scoreboard L)

Each `row-*` group is a self-contained horizontal **band**, authored at a local
y origin of 0 and declaring its height with `h=N` in its layer name. At runtime
the app stacks whichever bands are showing, top down from the card's y, and
resizes `card-bg` to their total. A completed game has no live band, so
everything below it moves up — the card really does change height on air.

Because the file authors every band at y=0, a static SVG would draw all of them
on top of each other. **The template moves them to the offsets they land on**
so you open an assembled card, and records where it put each one as `at=N` in
the layer name. The compiler takes that back out. So:

- **Keep the `at=` token.** Without it your export ships with the preview
  offset baked in and the app stacks each row twice.
- **Moving a row vertically does nothing on air.** The app owns where bands sit.
  What you change is a band's `h=` (how tall it is) and its contents.
- **Nudging content *inside* a row is yours** and survives.

## Rows are toggle groups

`row-top` always shows. Everything else appears when the game state calls for
it. Two rows drawn at the **same `at=`** are alternates — `row-live` during a
game, `row-final` once it completes — so the template draws them overlapping on
purpose. Toggle one off in the layers panel to work on the other, and design
each to fill the band on its own.

In **absolute** mode a row named `slot=row-live anim=expand-right` wipes open to
the right when a game starts and collapses when it ends, instead of just
appearing. Draw it in its open position beside the core; the app animates the
reveal and the core never moves. You author nothing extra — the tag opts in.

## Scoreboard S melds, and the dashed cyan boxes show you how

S is a compact pill that **grows** to enclose whatever is showing, on both axes:

| Guide | Size | When |
|---|---|---|
| `stage-resting` | 224×128 | names + scores only |
| `stage-row-inning` | 292×128 | the inning segment opens |
| `stage-row-live` | 380×128 | the live cluster opens |
| `stage-row-mode` | 380×156 | the game-mode band drops in |

`card-bg` carries its collapsed size as `compactw=` / `compacth=`, and each
segment declares the card size it forces (`cardw=` / `cardh=`). **Content
sitting outside the resting box is not misplaced** — it belongs to a larger
stage, and the card will have grown by the time it shows. That is why the game
mode line appears to float below the card in a static view.

Design every stage to look finished on its own, and keep each stage's content
inside its own box. The guides are `scaffold=` layers: editing-only, stripped
on compile.

## Hidden layers are shown at full opacity

Anything the app toggles on — the FINAL badge, the down arrow, runner icons,
character slots — is authored invisible in the shipped file, because those are
game states rather than design choices. You can't style what the tool draws as
nothing, so the template **reveals them** and tags the layer name `hidden`.

**Keep the `hidden` token.** The compiler puts the layer back to invisible on
the way in. Drop it and that badge ships permanently on screen.

This is why several things overlap in a fresh template: the up arrow, the down
arrow and the FINAL badge all live in the same spot because the app shows one
at a time. Toggle them in the layers panel.

## What each named layer does

**Always visible (`row-top`):**
- `slot=card-bg` / `slot=card-rail` — the card and its accent rail
- `slot=s1-name` / `slot=s2-name` — player names (`maxw=` auto-shrinks long ones)
- `slot=s1-score` / `slot=s2-score` — runs
- `slot=s1-logo` / `slot=s2-logo` — team logos (image)
- `slot=inn-num` + `slot=inn-arrow-up` / `slot=inn-arrow-down` — inning + top/bottom
- `slot=final-badge` — the "FINAL" chip (app shows it on completed games)
- `slot=meta-game-mode` — the game mode. Bound in **both** states, unlike the
  `meta-*` pair below, so any size may place it.

**Live game (`row-live`):**
- `slot=bat-icon` / `slot=pit-icon` — batter/pitcher character (image)
- `slot=bat-name` / `slot=pit-name` — their names
- `slot=ball-0..2`, `slot=strike-0..1`, `slot=out-0..1` — count dots (app fills
  the active ones; style the empty state, the app sets the lit colour). One
  short of each terminal value on purpose: the fourth ball, third strike and
  third out all end the plate appearance or the half-inning, so the game has
  already reset the count by the time we could draw them — a full row IS the
  event. A fourth ball dot would never light.
- `slot=balls` / `slot=strikes` — the count as **numbers** instead of dots, for
  a theme that would rather print "2-1" than light pips
- `slot=base-1..3` — the diamond bases (app lights occupied ones)
- `slot=runner-1..3` — runner character icons on base (image)

**Completed game (`row-final`):**
- `slot=elo1-group` / `slot=elo2-group` — each wraps `elo{N}-in`, `elo{N}-out`,
  `elo{N}-delta` (rating before → after, and the swing)
- `slot=meta-main` / `slot=meta-date` — stadium · innings, and the date

**Rosters (`row-roster`, size l):**
- `slot=s1-char-0..8` / `slot=s2-char-0..8` — the nine character icons per side
- `slot=sT-cap-ring` — a ring the app moves onto the captain's slot

**Box score (`row-box`, size l):**
- `slot=box-col-1..9` — a per-inning column, wrapping `box-h-N` (the header),
  `box-away-N` and `box-home-N`
- `slot=box-away-r` / `slot=box-home-r` — the runs total
- `slot=box-away-name` / `slot=box-home-name` — the row labels

## Colours: yours vs the app's

Three hues are **live data** — leave them on the data layers and the app
repaints them per game:

- `#e53935` (side 1) / `#1e88e5` (side 2) = the two players' controller-port
  colours
- `#e60012` (accent) = the producer's accent setting

Everything else — card background, borders, dividers, text colour, fonts,
corner radii, decorative shapes — is yours. On the way back in, those three
hues become the app's colour variables again; you just keep using them where
you want a side or accent colour to appear.

Note that side 1's sentinel is deliberately **not** the same red as the accent:
they resolve to the same colour live, and the round trip has to tell them apart.

## Icons (team logos / characters)

PRSH doesn't ship Nintendo art, so the icon slots are empty in Figma — you'll
see a **grey dashed placeholder box** behind each one marking its footprint.
Design the box (size, corner radius, a faint fill) as the "no art" look:
because the app draws the real icon **on top** and hides it when there's none,
your box shows through automatically as the fallback. No extra wiring needed.

(Grey dashed = an image slot's footprint. Cyan dashed = a meld stage. Both are
`scaffold=` layers and neither ships.)

## Export from Figma

- SVG, layer names included as ids, **text NOT outlined**.
- Keep the frame at the exact canvas size for that file.
- Keep every token in a layer name: `slot=` / `part=` / `tpl=`, and the
  modifiers riding with them — `h=`, `maxw=`, `at=`, `cardw=`, `cardh=`,
  `compactw=`, `compacth=`, `full=`, `anim=`, and the bare `hidden`. A modifier
  that goes missing takes its behaviour with it, silently: the node still
  arrives, the thing it did doesn't.
- A value with commas (`full=32,28,176,176`) is a coordinate list — the commas
  are there because layer names split on spaces. Leave them.
- Keep `data-layout="absolute"` on the root frame of Scoreboard S (or a
  `layout=absolute` layer). Without it the app auto-stacks and ignores your
  vertical positions.
- Send back the `.svg` (or drop it in the Design tab and read the report).
  **Read the report** — it names every slot recovered, every modifier it could
  not parse, and whether your tool baked the row offsets into the contents.

## Regenerating these templates

They're generated, never hand-edited:

```bash
python scripts/figma-template.py --write
```

That reads the shipped themes in `public/design/default/` and rewrites every
`design-templates/*.template.svg`, round-tripping each one back through the
compiler to verify no binding was lost on the way.

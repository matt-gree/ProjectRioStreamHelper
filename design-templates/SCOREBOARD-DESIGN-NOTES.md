# Scoreboard design notes (for the Figma round trip)

Companion to `scoreboard-m.template.svg`. The scoreboard is the most
data-dense element in PRSH, so read this before restyling.

## The three sizes and what fits

| Size | Canvas | Rows it uses |
|---|---|---|
| xs | 400×50 | row-top only |
| s | 500×80 | row-top only |
| m | 600×200 | row-top + row-live / row-final |
| l | 800×460 | all rows (+ rosters, box score) |

Start with **m** (the template you have). Each size is its own file
(`scoreboard-m.svg`, etc.); a size just implements whatever slots fit.

## Absolute layout — you place everything

This template is **`data-layout="absolute"`**: WYSIWYG. What you see in the
600×200 frame is exactly what ships. You position every piece by hand, anywhere
in the frame. The **one rule: don't resize the outer 600×200 frame** — place
inside it freely, but keep the frame itself locked to the native size.

- **Everything's position, size, colour, font, spacing** — **yours.** The app
  only pours in content (text, images, lit/unlit dots) and shows/hides the rows;
  it never moves a piece you placed. (One exception: the captain ring
  `sT-cap-ring` gets snapped onto the captain's roster slot.)
- To declare absolute mode from a design tool that can't edit the root `<svg>`,
  drop an invisible layer named **`layout=absolute`** anywhere — the compiler
  lifts it to the root and deletes the helper. (This template already carries
  `data-layout="absolute"` on the root, so you don't need to.)

> Without the flag, the app uses the older **stack** layout: it auto-stacks the
> active rows and resizes the card. That mode still exists for elements built
> around live collapse-and-reflow toggles (the vertical Scorecard) — but for
> the scoreboard, absolute is the path.

## Rows are toggle groups the app shows in place

`row-top` always shows. `row-live` and `row-final` occupy the **same lower
band** — the app shows `row-live` during a game and crossfades to `row-final`
once it's completed (ELO swings + stadium/date). You author **both, overlapping
at that band position**; the app toggles which one is visible. In absolute mode
it never moves them, so put each exactly where it should land on screen.

**MLB-style expand:** to make the live panel *wipe open to the right* when a
game starts (and collapse when it ends) instead of just appearing, name that
group `slot=row-live anim=expand-right`. Draw it in its open position beside the
core; the app animates the reveal (the core never moves). You author nothing
extra — the motion is the app's, the tag just opts in.

## What each named layer does

**Always visible (row-top):**
- `slot=card-bg` / `slot=card-rail` — the card and its accent rail
- `slot=s1-name` / `slot=s2-name` — player names (`maxw` auto-shrinks long ones)
- `slot=s1-score` / `slot=s2-score` — runs
- `slot=s1-logo` / `slot=s2-logo` — team logos (image)
- `slot=inn-num` + `slot=inn-arrow-up` / `slot=inn-arrow-down` — inning + top/bottom
- `slot=final-badge` — the "FINAL" chip (app shows it on completed games)

**Live game (row-live):**
- `slot=bat-icon` / `slot=pit-icon` — batter/pitcher character (image)
- `slot=bat-name` / `slot=pit-name` — their names
- `slot=ball-0..3`, `slot=strike-0..2`, `slot=out-0..2` — count dots (app fills
  the active ones; style the empty state, the app sets the lit colour)
- `slot=base-1..3` — the diamond bases (app lights occupied ones)
- `slot=runner-1..3` — runner character icons on base (image)

**Completed game (row-final):**
- `slot=elo1-group` / `slot=elo2-group` — each wraps `elo{N}-in`, `elo{N}-out`,
  `elo{N}-delta` (rating before → after, and the swing)
- `slot=meta-main` / `slot=meta-date` — stadium · innings, and the date

## Colours: yours vs the app's

Three hues are **live data** — leave them on the data layers and the app
repaints them per game:
- `#e53935` (side 1) / `#1e88e5` (side 2) = the two players' controller-port
  colours
- `#e60012` (accent) = the producer's accent setting

Everything else — card background, borders, dividers, text colour, fonts,
corner radii, decorative shapes — is yours. When you send the file back, I
convert those three live hues back into the app's colour variables; you just
keep using them where you want a side/accent colour to appear.

## Icons (team logos / characters)

PRSH doesn't ship Nintendo art, so the icon slots are empty in Figma — you'll
see a **dashed placeholder box** behind each one marking its footprint. Design
the box (size, corner radius, a faint fill) as the "no art" look: because the
app draws the real icon **on top** and hides it when there's none, your box
shows through automatically as the fallback. No extra wiring needed.

If you want a real placeholder *image* to design against, ask and I'll hand you
a neutral silhouette set; the live app uses the tournament's own asset pack.

## Export from Figma

- SVG, layer names included as ids, **text NOT outlined**.
- Keep the frame at the exact canvas size (600×200 for m).
- Keep the `slot=` / `part=` / `data-h` layer names. Figma may rewrite `=` or
  add suffixes on export — that's fine, the compiler tolerates it, but glance
  at the install report to confirm the slot count matches.
- Keep the `data-layout="absolute"` on the root frame (or a `layout=absolute`
  layer). Without it the app reverts to auto-stacking and ignores your vertical
  positions.
- Send me the `.svg` (or drop it in Setup → Design and read the report). I
  reconcile the colour variables and hand back the installable theme.

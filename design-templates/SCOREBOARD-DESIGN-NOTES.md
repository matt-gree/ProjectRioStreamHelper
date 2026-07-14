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

## What you control vs what the app controls

- **Inside a row** — where the name/score/dots/diamond/icons sit, spacing,
  alignment, everything — is **yours**. The app only pours in content (text,
  images, lit/unlit dots); it never moves those pieces. (One exception: the
  captain ring `sT-cap-ring` gets moved onto the captain's roster slot.)
- **The rows as whole blocks** — the app owns. It stacks the active rows
  top-to-bottom using each row's `data-h`, and sizes the card to fit. So don't
  restack the rows or move them relative to each other; the app overrides that.

## Rows are toggle groups, not separate files

`row-top` always shows. `row-live` and `row-final` are the **same spot on
screen** — the app shows `row-live` during a game and swaps to `row-final`
once it's completed (ELO swings + stadium/date). You design **both**; the app
picks which one is up.

**In this template the rows are UNFOLDED vertically** so you can see and edit
each one (in the real card they sit on top of each other at the same origin —
that's how the app reads them). The grey dashed frames + "ROW-LIVE / ROW-FINAL"
labels and the `transform`/`data-edit-offset` on those two rows are **editing
aids** — I strip them on return and collapse each row back to its band origin.
Design each row as if its top-left is the start of its own band. The canvas is
600×500 here for the unfolded view; the real card is 600×200 (the install
report will warn about that size — expected, because this is the editing file,
not the finished theme).

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
- Send me the `.svg` (or drop it in Setup → Design and read the report). I
  reconcile the colour variables + row stacking and hand back the installable
  theme.

# Design templates — the reskin round trip

Everything in this folder is **generated from the shipped `default` package**.
Don't hand-edit it; regenerate it:

```bash
./venv/bin/python scripts/figma-template.py --write   # one *.template.svg per element
./venv/bin/python scripts/figma-master.py             # master.svg: all of them on one sheet
```

## What to open

| File | Use it for |
|---|---|
| `master.svg` | The whole package on one sheet at true scale. One **frame per element** (`element=NAME`), so a restyle can be judged against its neighbours. |
| `<element>.template.svg` | One element on its own. Same content as its frame on the sheet. |
| `captures/` | The post-game callouts, which are laid out in HTML, not a theme. They're reference only — see `captures/README.md`. |
| `SCOREBOARD-DESIGN-NOTES.md` | Read before restyling either scoreboard size. |

## Reading a frame

- **Magenta dashed box** — the element's real size: what ships. Keep the frame at the size in its label.
- **Grey dashed boxes beside or below it** — the canvas is sometimes bigger than the element, so nothing overlaps:
  - **Alternates** — blocks the app never shows together: the Scorecard's *full / rosters / condensed* score block, or a live row against a completed-game row. Each gets its own column, with the rest of the card drawn around it.
  - **Spare prototypes** — the lower third's segment templates (logo, match, scorebox, merch, clock, message, bracket). The app puts whichever the producer picks into the band. The ones that don't fit in the band inside the frame are laid out in rows underneath.
- **`scaffold=preview-*` layers** — *copies* that show spacing: ticker cards 2–4 (in the three states a card can be in: side 1 won, side 2 won, live), schedule rows 2–4, the card around an alternate. The first ticker card is the one to edit, and it shows every part at once, so its VS sits over the score and both win rails are lit. They don't follow your edits and never ship. **Edit the original** (the layer named `slot=`/`tpl=`), then check the spacing against the copies.
- **Pattern tiles** (callout) — the back-wall grid and the two halftone dot fields are *repeating tiles*, which a design tool can't import as fills. Each tile sits under the frame as a `pattern=ID w=W h=H` layer: edit the tile there, keeping it inside its box (that box is the repeat size). The layers it fills are named `fill=ID` and draw nothing themselves. The field you see in the frame is a `scaffold=preview-*` copy with its fade baked in, so it won't update until the template is regenerated.
- **Cyan dashed boxes** — sizes a card grows to at runtime.
- **Grey dashed squares** — image slots (character icons, team or league logos, captain art). PRSH ships no game art, so design the empty box. The app draws the real image on top.

## Rules that keep it round-trippable

1. **Layer names are the contract.** `slot=`, `part=`, `tpl=`, `pattern=`, `fill=`, `at=`, `frame=`, `layout=`, `hidden`, `defs` all have to survive. Rename anything else freely.
2. **Seam colours stay literal:** `#E53935` = side 1, `#1E88E5` = side 2, `#E60012` = the producer's accent. The app repaints them live.
3. **No motion.** Animation belongs to the app.
4. **Export as SVG with layer names as ids and text *not* outlined.** Export each element frame on its own (Figma: select the frames → Export → SVG).

## Handing it back

Send the exported frames back with a note on what you were going for. Turning
them into a design package is done in conversation rather than by a script, on
purpose. A reskin usually carries intent the files can't state — "this should
feel quieter", "the ticker's new plate is the score, not the names" — and the
compile step reports things that need a judgement call. Examples: a layer
nudged away from where the app places it, a missing slot, text that no longer
fits its `maxw`.

# Character Spotlight Touchups 4 (Final Refinement) — Checklist

Source: `CharacterSPotlightTouchups4.md` + three user feedback rounds (short-hit camera ×2, logo placement ×2, chip spacing, spray standoff, Nice/Sour data-format bug). Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[d]` deferred (discussed).

Files: **M** = `public/layout/lib/postgame-callout-mount.js` · **R** = `rio-visualizer/web/renderer.js` (submodule working tree).

All items implemented 2026-07-11. 19/19 unit tests pass; both files syntax-checked. Per user: no further screenshot validation — user is handling visual direction from here.

## Home Run Camera
- [x] (R) The camera settles at the point of impact: `buildHitScene` records each path's truncated stop (`_drawnStops`); `_sceneLanding` + the hero cam's chase anchor prefer it over the recorded landing, so `landingLook` holds on the impact point instead of panning down toward the phantom landing beyond the stands. Glide duration already tracked the truncated flight, so the crane comes to a natural stop with the ball.

## Short Hit Camera
- [x] (R) Gentle is hero's crane at infield scale — a rising bezier arc from the broadcast pose ONTO the field, ending pulled back/offset/raised from the landing (`GENTLE_FIT_M` 34 m framing vs hero's 56), ball-tracking look, 250 ms contact hold, paced over ≥`GENTLE_MOVE_MS` 2200 ms. Builds hero-shaped state and runs on `_updateHeroCam` outright (`st.holdMs` override). (Iterations 1–2 — toward-landing push, then follow-clone push — read as a rotate from behind; discarded.)
- [x] (M) ROOT CAUSE of "still no movement onto the field": hits landing 45–85 m were routed to the pan-only FOLLOW cam (only <45 m auto-swapped to gentle). `cameraFor` now returns `'gentle'` for every non-hero ball in play — the follow cam is never used by the spotlight, so every batted ball gets a crane onto the field.
- [x] (R) Crane approved; per follow-up, zoom eased off for location context on infield / shallow-outfield hits: `GENTLE_FIT_M` 34 → 46 (hero fits 56) and end-height floor 9 → 11 m — the crane ends a respectful distance from the landing spot.

## Batting Card Polish
- [x] (M) Minis switched to `space-evenly` with per-stat padding instead of flex gaps; collapsed OBP/SLG occupy literally zero width — balanced before the reveal, rebalances automatically after
- [x] (M) Reveal target `max-width: 130px` (+ animated padding) — a four-digit SLG (1.000) renders unclipped

## Camera Reset Animation
- [x] (R+M) `clearHit({ animate: true })`: the theater empties and the camera GLIDES back to the broadcast pose (`RETURN_MS` 1150 ms, cubic-eased position + look via the internal 'return' cam mode) instead of snapping. The mount uses it for every AB under the transition card; the old gentle-cam skip (`willBeGentle`) is deleted — one uniform reset for all ABs, verified smooth in the DK run before screenshots were retired.

## Spray Chart Camera
- [x] (R) Rethought as an idle PRESENTATION camera: framing takes in the whole field (wall-profile extent + home plate folded into the box — never a cluster zoom); motion = very slow pendulum yaw (±0.3 rad, 52 s period) layered with a radius/height breathe (±5.5 %, 34 s — incommensurate periods so it never reads as a repeating loop), eased 6 s ramp out of the establishing hold. Comfortable to leave on screen indefinitely.
- [x] (R) Per user screenshot feedback ("too close to home plate"): behind-plate standoff raised 0.3→0.55 × camera height, fit distance ×1.08→×1.12, look target pulled toward the plate (center ×0.72) — the trail convergence sits comfortably inside the bottom of frame.

## AB History
- [x] (M) The previous chip's rainbow `live` ring retires the moment the next AB's transition card shows (moved from chip-insertion time); only the current AB carries active emphasis. Finale still strips the last one.

## Team Logo
- [x] (M) Final direction (after two user pivots: background → plate spot → background): full-frame-height LEFT background element — `.cs-bglogo` inside the backdrop (over theme SVG, under the vignette and every card), img height 90 %, opacity 0.2. Clipping via `clip-path: inset(0 -400px 0 0 round 26px 0 0 26px)`: cut at the theme's 28 px rainbow border on the left/top/bottom only — the right side bleeds freely behind the frame content (per user: "don't clip on the right, it can live behind the frame"). Rides the backdrop's intro clip reveal.

## Hit Contact
- [x] (M) ROOT CAUSE of "not seeing Nice/Sour" found: the stat files label contact type in TWO formats — `"Nice - Right"` (some games) vs `"Right Nice"` (others) — and the old prefix match (`startsWith('Nice')`) only caught the first. New shared `contactQuality()` helper matches the keyword anywhere, case-insensitive; used by the chip, the stamp (hit frame), and the perfect-contact flash.
- [x] (M) Chip layout FINAL (per user direction): the play detail (TO LF / ON 0-2 / 168FT · 1 RBI) moved UP beside the big result abbreviation — right-anchored on the `.res` row at its usual 14.5 px size — and the contact quality tag owns the freed left slot of the detail line. Nothing wraps; Perfect in the side colour, Nice brighter than Sour. (Intermediate iteration had quality on the det line's right; superseded.)

## Final Review
- [x] Camera language now unified: gentle IS hero at infield scale, hero settles on what the viewer saw, resets are animated glides, spray is a loopable whole-field presentation with a generous plate standoff. Cards balanced pre/post reveal; chips carry result + detail + contact quality without wrapping. Remaining visual direction is with the user (per instruction, no further harness validation).

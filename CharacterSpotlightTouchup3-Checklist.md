# Character Spotlight Touchup 3 — Checklist

Source: `CharacterSpotlightTouchup3.md`. Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[d]` deferred (discussed).

Files: **M** = `public/layout/lib/postgame-callout-mount.js` · **R** = `rio-visualizer/web/renderer.js` (submodule working tree) · **S** = `server/postgame.py` · tests = `tests/unit/test_postgame_spotlight.py`.

All items implemented 2026-07-11; headless-Chrome screenshot-verified (DK/Mario/Toadsworth/Boo runs) except where noted. 19/19 unit tests pass.

## Animation Timing & Flow
- [x] (M) AB chips sync with replay — chip inserted (result-styled + live ring) the moment the flight lands / the no-flight beat concludes, in `playAb`'s stamp block; verified: ticker trails the replay by exactly the in-flight AB
- [x] (M) Each AB begins with the Inning • Outs transition card — chip insertion moved out of the AB open; `.cs-bar-content` starts hidden so the FIRST thing the bar ever shows is the card (verified at 2s: card only, no situation flash)
- [x] (M+R) Camera reset happens under the transition card — new `renderer.clearHit()` (clears trails/balls/markers + relocks broadcast pose) called while the card covers the theater; skipped when the next hit resolves gentle (< 45 m), which *eases* from the previous pose by design
- [x] (M) Non-batted-ball ABs (K/BB/HBP): same `clearHit()` under the card empties the theater immediately after the previous play; lingering K-dim also lifts under the card when a flight is coming

## Camera Polish
- [x] (R) Home runs stop at stadium geometry — `_truncateAtStadium()` raycasts the recorded path segment-by-segment against the stream stadium mesh (prefiltered past ~70% of the wall distance), truncating ball + trail at first intersection; marker/label sit at the stop point, labeled distance stays the recorded carry (verified: HR trail ends at the stands, no clip-through)
- [x] (R) Short hits: gentle cam rebuilt closer to the big-hit treatment — slow crane-up to a slightly wider-than-broadcast framing (rise 3 m, pull-back 1 m), cubic-eased 2 s move (smoothest acceleration of any mode), livelier look tracking (0.06); motion quality needs OBS eyes
- [x] (R) Spray camera: box includes home plate + 6 m padding, camera enforces a horizontal standoff behind the plate (0.3 × height — the aerial angle used to park it overhead, dropping the plate out of FOV), aims between chart center and plate, 0.88 aerial component, same slow rocking orbit (verified: plate + every marker/trail in frame)
- [x] (M) Upper-left situation chip (`#cs-sit`) removed entirely — DOM, CSS, all references

## Ball Trails
- [x] (R) HR gradient trails loop on the spray chart — `crawlEndMs = Infinity` in spray mode (walkthrough keeps hold-then-freeze)
- [x] (R) Star Hit gradient trails loop on the spray chart — same
- [x] (R) Star Hit ending in an out: golden shimmer blends per-vertex to red after landing (`redAtMs` now set for star kind; `redMix` lerp in `_updateTube`) — verified red on Mario's star-swing out

## Stat Cards
- [x] (M) Left column inset 30→40 px, width 660→650 — mirrors the right side's 40 px frame margin
- [x] (M) Pitching & defense cards render final values from the first frame (`statNowHtml`, no count-up/data-final) — verified populated during the intro
- [x] (M+S) Defense outs broken out by position ("Outs · 2B", "Outs · SS"…) from the server's `outs_per_position`; total-only fallback if the map is empty
- [x] (M) Half-row cards share width proportionally to stat count (inline flex weights + max-width) — verified: 4-stat pitching beside 1-stat defense, and a lone 1-stat defense card hugging its content
- [x] (M) "H-AB" label removed (big value stands alone)
- [x] (M) Game Line row removed from the batting card
- [x] (M) OBP + SLG collapsed (`.rate` max-width 0) until the walkthrough completes
- [x] (M) Finale `revealRates()` animates them open; flex redistributes so neighbors slide over rather than pop (no-GSAP fallback snaps them visible)
- [x] (S+M) Star accounting: `_star_cost()` — captain-eligible non-captains (pyrio `is_captain`) spend 2 per star swing, fouls and successful star hits included; `character_abs` weights the whole-PA accumulator, `_side_block` derives card "Spent" from the same event walk × cost (no longer trusts the stat file's counter); mount bumps ★ Spent by `ab.starsUsed` and spends that many meter stars — verified consistent chips↔card mid-walk and at lock (Mario: ★★+★★+★ = 5)
- [x] (M) Hero team logo: 100%×100% contain, vertically centered (translate removed), opacity 0.24→0.26

## Frame Layout
- [x] (M) Both player names sit above their scores in the game-state bar (side 2 markup order fixed)
- [x] (M) Inning badge dead-centered inside the diamond (was overlapping 2B at the top)

## Contact Labels
- [x] (M) Nice/Sour contact labeled as stamp chips alongside Perfect ("NICE CONTACT" / "SOUR CONTACT", recorded side suffix dropped). Design call: Perfect keeps its white marquee chip; Nice/Sour take the standard chip so Perfect stays the marquee tier — same presentation vocabulary, preserved hierarchy
- [d] Perfect-contact flash stays Perfect-only (Nice/Sour flashing would dilute it)

## Bunt Detection
- [x] (S) Contact + `Type of Swing == "None"` ⇒ `swing`/`swingInfo.type` = "Bunt" (chips/stamp tag "BUNT"); contactless None untouched — unit-tested both ways

## AB History Layout
- [x] (M) Chip width cap 224→300 px so the ticker splits the full row between the player's ACTUAL PAs (6-PA DK fills edge-to-edge; no phantom slot) — chips still land at final width, never reflow

## Final Review (Fable)
- [x] Holistic screenshot review across 4 characters (DK: HR/hero/6 PAs · Mario: captain/stars · Toadsworth: HBP/defense positions · Boo: pitcher): hierarchy, spacing, chips, cards, FINAL card, spray framing all cohesive; cross-UI star totals agree everywhere
- [~] Motion-domain polish (gentle-cam feel, trail loop cadence, transition rhythm) — needs the user's OBS/live verification; all constants are top-of-file knobs (`BEAT`, `GENTLE_*`, `SPRAY_*`)

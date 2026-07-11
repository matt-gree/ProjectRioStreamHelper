# Character Spotlight Rework — Master Checklist

Source: `CharacterSpotlightRework.md`. Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[d]` deferred (discussed).

Work groups: **A = Layout/UI + Animation** (postgame-callout-mount.js) · **B = Visualizer** (rio-visualizer/web/renderer.js) · **C = Server data** (server/postgame.py) · **D = Bug fix / integration** (PM).

## Layout
- [x] (A) Hero render larger; stat cards reorganized — `.cs-leftcol` flex column, hero `flex:1` claims space freed by absent cards
- [x] (A) Player header: add Event, Bracket, Phase (`tournamentInfo.name`; `score.{N}.phase` → `tournamentInfo.phase` fallback; hides empties)
- [x] (A) Player header: remove team logo badge (ghosted logo moved behind hero art)
- [x] (A) Batting: single full-width card (merge Batting + H-AB cards)
- [x] (A) Batting: remove Strikeouts stat
- [x] (A) Batting: Stolen Bases only when > 0
- [x] (A) Batting: keep Star Hit / Star Spent
- [x] (A) Batting: replace AVG with OBP + SLG (OPS dropped too)
- [x] (A) Pitching & Defense: optional half-width cards under batting; expands naturally (defense always shown — data block never null; deliberate)
- [x] (A) Pitching: replace ERA with ER (`earned_runs`)
- [x] (A) Defense: rename "Slide Catch" → "Sliding Catch"

## At-Bat History Chips
- [x] (A) Chips start empty; `chipMarkup()` inserted + faded in per AB (no-GSAP fallback renders all at once)
- [x] (A) Chips at normal prominence (not dimmed)
- [x] (A) Star-usage indicator: old badge was clipped invisible by `overflow:hidden` — now an in-flow `.info` row
- [x] (A+C) EVERY star consumed shown (`'★'.repeat(starsUsed)`, capped at 6; server accumulates whole PA incl. foul star swings)

## Game State Bar
- [x] (A) Between-AB transition card morphing from/to the bar (`.cs-transcard`, wired to previously-dead `BEAT.transIn/Hold/Out`)
- [x] (A) Outs + Count grouped, no labels (`.cs-cntouts` numerals + dots)
- [x] (A) Pitcher gets character icon (`OverlayBase.charImg`; `ab.pitcher` is a resolved name)
- [x] (A) Stars not off-center — Star Chance is now an `.active` glow on the Stars widget, no reserved label space
- [x] (A) Inning badge inside the diamond widget
- [x] (A) End of replay: bar morphs to `.cs-finalcard` (FINAL tag + winner glow)

## Rio Visualizer

> **Renderer API contract (agent B, 2026-07-10):** camera modes `broadcast|follow|hero|spray` via `setHit(sim, { camera })` (needs `fixedCam:true`, which the mount already passes; `hero:true` opt = alias). Per-path flags: `path.out=true` → red-fade trail + red-X marker; `path.hr=true` → celebratory gradient-crawl trail (independent of camera). `opts.spray=true` → no-replay staggered fade-in + idle spray camera. `opts.batterHand:'Left'|'Right'` (or `setBatterHand()`) → batter's-box highlight. Feet: `METERS_TO_FEET = 3.28084` (sim data is meters). Recommended cameras: normal → `follow`, deep fly + HR → `hero`, finale → `spray`.

- [x] (B) Camera systems: multiple built-in named modes, explored + recommended (not just orbit)
- [x] (B) Home runs: dramatic hero camera — renderer done; mount already passes `hero: resultCode===10`
- [x] (B) Progressive trail reveal (trail draws behind ball)
- [x] (B) Out-after-ground-contact: completed trail animates to red — renderer done; mount must set `path.out` (group A)
- [x] (B) Home run: celebratory trail treatment (gradient crawl along tube trail) — renderer done; mount must set `path.hr` (group A)
- [x] (B) Spray chart: staggered fade-in, idle 3-vantage spray camera — renderer done; mount must pass `spray:true` (group A)
- [x] (A+C) Hit info: Charge / Slap / Star on visualizer stamp + AB chips (shared `swingTag()` helper)
- [x] (A+C) Charge swings: under/overcharge % (`N%` under, `100%` full, `+N%` over)
- [x] (A+B) All displayed distances in feet (`* 3.28084` in chip detail + hit-summary stamp; renderer `fmt()` already feet in stream view)
- [x] (A) Upper-right pitch type/speed chip removed (DOM + CSS + JS)
- [x] (A+C) Hit summary includes "STAR CHANCE WON/LOST" when `starChanceOutcome` set
- [x] (B) Wario Palace: muted purple mound + sunburst palette (themes.js `infield` key — was never declared)
- [x] (B) Proper pentagonal home plate, oriented correctly
- [x] (B) Batter's boxes
- [x] (B) Handedness indicator via highlighted batter's box — renderer done; mount must pass `batterHand` (group A)

## Bug Investigation
- [x] (D) White flash between ABs: **FIXED** — root cause was the Perfect-contact effect (`#cs-flash`: full-viewport white, opacity .85→0). Replaced with a side/accent-colored radial-gradient flare, `mix-blend-mode: screen`, scale pulse 0.85→1.25 — reads as a contact light flare, not a dropped frame. Visual verify at integration.

## Final Review
- [x] (D) Whole-scene review at code level: mount contract preserved (`mountPostgameCallout({host})` via fed-container.js, `prevKey`/`runSeq` guards intact), no stale refs, CSS braces balanced, `node --check` green on all touched files
- [~] (D) Transitions smooth, hierarchy clear — logic-verified; NEEDS visual/OBS verification (esp. transition-card timing ≈1.5s per AB, deep-fly hero threshold 85 m carry / 30 m apex)
- [x] (D) Optional elements collapse/expand without gaps (hero absorbs freed space; defense card always shown by design)
- [ ] (D) Post-integration polish pass — pending user's visual review; tune BEAT timings + hero-camera threshold from live footage
- [x] (D) Every checklist item implemented or explicitly discussed (deferred: none)

## Incidental fixes (found during rework, 2026-07-10)
- `BEAT.situate` was referenced but undefined (NaN → beat fired instantly); now `0.35`.
- `BEAT.hrStampHold` was defined but unused; now wired (HRs hold longer on the stamp).
- Finale spray-chart `setHit()` (both GSAP + fallback paths) never passed `{ spray: true }`; added.
- Wario Palace `infield` theme key was never declared in themes.js, so the muted-purple mound/sunburst support in renderer.js was dead code; now opted in.

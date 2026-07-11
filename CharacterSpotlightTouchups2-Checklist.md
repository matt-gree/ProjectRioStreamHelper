# Character Spotlight Polish Pass 2 — Checklist

Source: `CharacterSPotlightTouchups2.md`. Legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[d]` deferred (discussed).
Ownership: **F = Fable (design: cards, typography, spacing, motion)** · **S = Sonnet agent (isolated engineering)**.

## Camera & Visualizer Polish (S — renderer-only agent) — done, live-render tuning pending
- [x] (S) Ball/trail sync: root cause = arc-length tube reveal driven by time fraction; now one `_flightFrame` clock + per-trail `arcFrac` table — tip sits on the ball by construction
- [x] (S) All flight trails now HR-girth tubes (`TRAIL_RADIUS 0.34`, unified `_makeFxTube` plain|hr|star); HR distinct by gradient only
- [x] (S) HR hero cam clamps at the wall: data-derived per-azimuth `_wallProfile` from collision tris; crane stops at wall+6m, keeps rotational tracking
- [x] (S) Spray camera: static hold until EVERY trail drawn (+1.4s settle), then ±0.14 rad back-and-forth orbit, 26s period, 4s ease-in envelope; vantage jumps deleted
- [x] (S) Short-hit `gentle` mode (auto < 45m, `SHORT_HIT_DISTANCE_M`): ~3m push, softer lerp, NO lockCamera snap — eases from previous shot; `recommendedHoldMs()`=2300 → mount wired to honor it
- [x] (S) Star Hit trails: golden shimmer tube (fast crawl + opacity pulse), per-path `star: true`, star>hr precedence, theme `starGradient` hook; mount passes the flag
- [x] (S) Wario Palace: `_makeSunburst` decal REMOVED; stadium's own grass-typed panels within 13m of mound centroid repainted #7c5a86 (base pads at 16–23m untouched — split verified from collision data)

## Card Design Review (F — Fable owns) — screenshot-verified 2026-07-10
- [x] (F) Design language: ALL pill chips removed (status = bare tracked text column on plate; stamp subs / theater chip / finale banner / swing tags = small-radius or bar-prefixed text, per matchup.svg vocabulary)
- [x] (F) Player header: Event line (tournamentInfo.name) + context line event_name · phase · **round** (`score.{N}.phase`, bold) + status column right; char 46→56px, meta 14→17px
- [x] (F) Batting card: OBP/SLG promoted to first-class stats, minis space-between, bottom rule + formatted box-score line (`b.line`)
- [x] (F) Pitching card: single row (flex space-around; IP · ER · K · H · ★Pitch)
- [x] (F) Defense: Outs at Position added (server `outs_at_position`+`outs_per_position` from stat file "Outs Per Position"); zero categories hidden; all-zero card omitted entirely (hero grows)
- [x] (F) Game state bar: space-between + hard caps — pitcher block was CLIPPING off the well edge in baseline; now fully inside with breathing room
- [x] (F) Final score card: WINNER text-mark, per-side box lines (H · HR · ★ from side totals), mirrored layout flanking FINAL + stadium name
- [x] (F) AB chips land at final width (`--chipw` sized from PA count up front); ticker grows rightward, no reflow (verified mid-animation)
- [x] (F) Hero team logo: 96%/88%, opacity 0.24, nudged up — crest clearly visible around the character now
- [x] (F) Renderer flag wiring: `star: ab.swing==='Star'` on paths; short-hit hold honors `renderer.recommendedHoldMs()` (2300ms after gentle shots, BEAT.shortHold fallback)

## Debugging (S)
- [x] (S) `bad_render.json.txt` FIXED — root cause was NOT classification: event has `Type of Swing: "None"` with a full Contact block, and pyrio's simulator only re-sims Slap/Charge/Star. Two separate fixes: (1) `PostGame._fallback_flight()` — Bezier arc from the game's own recorded contact/landing/apex/hang fields (`contact.approx: true`) so the play animates; (2) additive `fieldersChoice` flag (`_is_fielders_choice`: contact out + outs>0 + batter safe + different runner erased) → mount shows "FC"/"FIELDER'S CHOICE", red-X out marker kept (a force out WAS recorded). Live-verified: BOTH of Yoshi's 7th+8th-inning plays now read FC (the 7th was a second uncaught case). 16/16 spotlight tests, 257 unit suite (1 pre-existing unrelated failure).

## Screenshot review stages (F — cards only, not the visualizer)
- [x] Baseline screenshots before design pass (found: pitcher clipped off bar edge, invisible logo, dead header space)
- [x] After card redesign (DK + Waluigi-pitcher runs; pitching row / defense collapse / final card / chips all verified)
- [x] After integration (Yoshi run: FC chips live, thick tubes, Wario decal gone → real panels plum, spray orbit steady; batting line suppressed when redundant with H-AB)

## Final Polish (F)
- [x] Whole-scene review on integrated screenshots: hierarchy reads (event → player → cards → theater → bar → ticker), spacing even (18px column rhythm), all pill chips gone, no reserved-empty-space anywhere, statuses/typography consistent with Slice 26. Remaining judgment calls flagged for live/OBS eyes: Wario panel purple tone under game lighting, star-shimmer speed, spray orbit arc (26s ±0.14rad), gentle-cam feel, hero-cam wall margin (6m).

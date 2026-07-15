# Character Spotlight — Golden Record

The **Character Spotlight** is PRSH's flagship post-game broadcast package: a
full-screen 1920×1080 scene that tells one roster character's entire game as a
cinematic story — hero art, a live-scoreboard walkthrough of every plate
appearance, an embedded 3D hit-replay (the Rio Visualizer), and a spray-chart
finale.

This document is the **canonical reference for its style, animation, and design
intent**, written by reviewing the implementation together with the iterative
design conversation that shaped it. It records what the scene became and why —
the design rationale here is not re-derivable from the code alone. **Read this
before touching the spotlight**, then read the source.

> **Companion docs:** `.claude/skills/overlay-authoring/SKILL.md` (mount pattern,
> OBS reveal/conceal), `.claude/skills/design-package-authoring/SKILL.md` (theme
> SVG contract). The Glossary in [CLAUDE.md](../../../CLAUDE.md) defines *fed
> element*, *Callout Stage*, *design package*, *side*, and *projector*.

---

## 1. What it is, and where it lives

The Character Spotlight is a **fed element** — a Callout Stage occupant, sibling
of the Game Summary. The producer, on the Production page, picks one character
from a *finished* game's roster; the mount then renders and plays that
character's story once, holding on the spray chart.

| Concern | File |
|---------|------|
| **Scene mount** (DOM, CSS, walkthrough choreography, palette) | `public/layout/lib/postgame-callout-mount.js` (~1470 lines) |
| **3D hit replay** (Three.js scene, camera modes, ball trails, stadium) | `rio-visualizer/web/renderer.js` (~1615 lines, git submodule) |
| **Stadium themes** (per-arena palette / fog / lighting / mound repaint) | `rio-visualizer/web/themes.js` |
| **Host page** (the sized OBS shell + three.js importmap) | `public/layout/shared/callout-stage.html` |
| **Data contract** (box score → State; heavy per-AB payload → REST) | `server/postgame.py` (`character_abs`, `_side_block`, `_star_cost`) |
| **REST/State surface** | `server/api/v1/postgame.py` (`GET /api/v1/postgame/abs`) |
| **Element registration** | `src/routes/production/elements.js` |
| **Preview sample** | `public/layout/preview/postgame_sample.json` |
| **Tests** | `tests/unit/test_postgame_spotlight.py` |

Entry contract (fed-container drives this):

```js
const m = mountPostgameCallout({ host });
m.update(OverlayBase.state, { scoreboard, team, charIndex });
m.replay();   // re-run the whole show (e.g. OBS source re-shown)
m.dispose();
```

`charIndex` is the 0-based roster slot. A `null` charIndex, an absent game, or a
missing side hides the scene. The mount keys on
`{scoreboard}:{team}:{charIndex}:{capturedAt}` so unrelated state ticks never
restart the show mid-play.

---

## 2. Data flow & contract

Two channels, deliberately split for performance (**trajectories never travel
through State**):

- **Box score → State** (`postgame.{N}.*`): player identities, per-side totals,
  each character's `batting`/`pitching`/`defense` blocks. Cheap, broadcast to
  every overlay.
- **Heavy per-AB payload → REST**: `GET /api/v1/postgame/abs?scoreboard=&team=&char_index=`
  returns the full per-plate-appearance walkthrough data, including
  re-simulated 3D flight paths. Fetched once per show.

The mount prefers the REST payload's stat blocks over the State projection
(after a server restart the abs endpoint rebuilds from the stat file with a
fresh schema, while State can predate fields like `batting.runs`).

### 2.1 The AB record (one plate appearance)

`character_abs()` in `server/postgame.py` builds an ordered list of these. This
is the contract the mount's walkthrough consumes — treat the field names as
stable:

```jsonc
{
  "eventNum": 12,
  "inning": 9, "halfInning": 0,        // 0 = top (▲), 1 = bottom (▼)
  "result": "Home Run",                 // Rio's raw string
  "resultCode": 10,                     // see RESULT_META below
  "isHit": true,
  "fieldersChoice": false,              // ADDITIVE flag; resultCode stays "Out" (4)
  "rbi": 2,
  "pitcher": "Bowser",                  // resolved character name
  "swing": "Star",                      // Slap | Charge | Star | Bunt | None
  "starsUsed": 2,                       // WHOLE-PA cost-weighted total (see §2.2)
  "swingInfo": { "type": "Star", "chargePct": 118 },
  "starChanceOutcome": "won",           // won | lost | null
  "before": {                           // pre-play situation
    "outs": 1, "balls": 2, "strikes": 1,
    "runners": { "1": true, "2": false, "3": false },
    "score": { "1": 3, "2": 4 },        // keyed by SIDE (1/2), not away/home
    "stars": { "1": 2, "2": 0 },
    "starChance": true
  },
  "after": { "score": { "1": 3, "2": 6 }, "outs": 1 },
  "runners": [ /* base, resultBase, out, scored — drives the diamond anim */ ],
  "contact": {                          // null for K / BB / HBP
    "path": [[x,y,z], ...],             // 60fps flight samples, game coords, METERS
    "landing": [x,y,z],
    "distance": 42.7,                   // meters (mount converts: * 3.28084 → feet)
    "maxHeight": 31.2,                  // apex, meters
    "typeName": "Perfect",              // contact quality — format varies (see §2.3)
    "fiveStar": true,
    "approx": true                      // present only on fallback_flight (see below)
  },
  "fielder": { "character": "...", "position": "SS", "action": "Sliding", "bobble": "None" }
}
```

**Result codes** (`RESULT_META` in the mount) — abbreviation / stamp text /
flavor: `1 K`, `2 BB`, `3 HBP`, `4·5·6 OUT`, `7 1B`, `8 2B`, `9 3B`, `10 HR`,
`11·12 E`, `13 BNT`, `14 SF`, `15 DP`, `16 OUT`. Codes `2,3,14` are **non-AB**
(don't increment the AB counter). Rio's contact-out subtypes (caught / line out
/ foul catch) are unreliable, so **every contact out simply reads OUT**.

**Fallback flight** — when pyrio's resimulator can't produce a trajectory
(unsupported swing type, or it raised) but the game recorded a Contact block,
`_fallback_flight()` draws an honest Bezier arc from the game's own recorded
contact/landing/apex/hang fields and tags `contact.approx: true`. This is why a
"bad_render" fielder's-choice play still animates. Don't remove it.

### 2.2 Star accounting (the consistency contract)

Star totals **must agree everywhere** — the ★ meter in the bar, the ★ Hit/Spent
stat, the chip star pips, and the batting card. The rule, enforced server-side:

- A **plate appearance** is the consecutive run of events sharing
  `(Inning, HalfInning, Batter Roster Loc)`, ending at the resolving pitch.
- **Every** Star-type batter swing inside that span counts — **including fouled
  star swings**, not just the final state.
- `_star_cost()`: a **captain-eligible non-captain** (Mario, Luigi, Wario, etc.,
  per pyrio `is_captain`) spends **2 stars** per star swing; everyone else 1. A
  successful star hit and a fouled star swing both cost the full amount.
- `starsUsed` = (star swings in the PA) × cost. The card's "Spent" is derived
  from the same event walk × cost — it **no longer trusts the stat file's
  counter**. Star *pitches* by the opposing pitcher are not counted here.

### 2.3 Contact quality (format drift)

Stat files label contact type **inconsistently across games** — `"Nice - Left"`,
`"Right Nice"`, `"Perfect"`. The shared `contactQuality()` helper matches the
keyword **anywhere, case-insensitively** (never a fixed prefix — that bug once
hid Nice/Sour entirely). Three tiers, one vocabulary everywhere (chip, stamp,
flash): **Perfect** (marquee — white/side-colored), **Nice** (brighter), **Sour**
(dim). The recorded side suffix ("- Left") is dropped — it says nothing on
broadcast.

---

## 3. Layout & composition

The stage is a fixed 1920×1080 canvas (`.cs-stage`) scaled to the OBS source
size. Regions, in stage coordinates:

```
┌──────────────────────────────────────────────────────────────────────┐
│  LEFT COLUMN (x=40, w=650)          AB THEATER (x=720, w=1160, h=624)   │
│  ┌────────────────────────┐   ┌──────────────────────────────────────┐ │
│  │ identity plate         │   │  embedded RioVisualizer viewport      │ │
│  │  event / name·team     │   │  (3D hit replay) + result stamp +     │ │
│  │  bracket·phase·round   │   │  finale banner + dim/flash layers     │ │
│  ├────────────────────────┤   │                                       │ │
│  │ BATTING card (full-w)  │   └──────────────────────────────────────┘ │
│  │  ┌────────┬─────────┐  │   GAME-STATE BAR (x=720, y=700, h=148)     │
│  │  │pitching│ defense  │  │   ┌──────────────────────────────────────┐ │
│  │  └────────┴─────────┘  │   │ diamond · count·outs · SCORE · stars  │ │
│  ├────────────────────────┤   │ · pitcher   [morphs → trans → FINAL]  │ │
│  │      HERO ART          │   └──────────────────────────────────────┘ │
│  │ (claims freed space)   │   AB TICKER (x=720, y=878, h=118)          │
│  │                        │   [ chips build progressively, →→→ ]       │
│  └────────────────────────┘                                            │
│  (team logo ghosted full-height behind the left column)                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Governing principle — no reserved empty space.** Every optional element
collapses and its neighbors reflow to fill. Concretely:

- **Left column is a flex stack**: identity plate → stat cards → hero art. The
  hero has `flex: 1` and claims *whatever vertical room the stat cards don't
  need* — a pitcher's taller card stack means a smaller hero; a bench position
  player's short stack means a bigger hero. Never a fixed gap.
- **Pitching / Defense are optional half-width cards** under Batting. Their row
  share is **proportional to how many stats each records** (inline flex weights
  + a `max-width` cap from `halfBoxHtml`): a lone single-stat defense card hugs
  its content instead of stretching across a half-row. An all-zero defense card
  renders nothing at all.
- **Defense** shows only non-zero categories, and breaks outs out **by the
  position they were recorded at** ("Outs · SS", "Outs · 2B").
- **Batting card** merges the old H-AB + Batting cards. The big `H-AB` headline
  value stands alone (no label). OBP/SLG carry class `.rate` and stay
  **collapsed to zero width** through the walkthrough, then the finale animates
  them open (`revealRates`) while `space-evenly` slides the other minis over —
  balanced *before and after* the reveal, never reserving dead space. The reveal
  `max-width: 130px` leaves room for a four-digit SLG (`1.000`) without clipping.
- Stolen Bases mini appears **only when > 0**. Strikeouts removed (already in the
  AB history). AVG replaced by OBP + SLG.

**Identity plate** — the header. Event name (small tracked caps) → character
name (56px, 900) → rio name · team → `bracket · phase · **round**`. Empty pieces
simply don't render. The four context sources, most→least general:
`tournamentInfo.name` (Event) · `tournamentInfo.event_name` (Bracket) ·
`tournamentInfo.phase` (Phase) · `score.{N}.phase` (Round, bold). **No team
logo badge** here — team identity lives in the ghosted background logo.

**Team logo** — a full-frame-height *background* graphic anchoring the left side
(`.cs-bglogo`, over the theme SVG, under every card, `opacity: 0.2`). Clipped at
the theme's 28px rainbow border on the **left/top/bottom only**; the right side
bleeds freely behind the frame content, so it reads as a background element
rather than competing with the character.

---

## 4. Visual design language — "Slice 26"

The spotlight speaks the **Slice 26** vocabulary (the tournament's house style),
shared with the Game Summary and the matchup band. The non-negotiable rules:

- **No pill / chip labels.** Statuses (Winner, ★ Superstar, Captain) are a bare
  right-aligned **tracked-text column** on the plate, never rounded badges. Stamp
  subs, swing tags, and the finale banner use small-radius or bar-prefixed text,
  not badge boxes.
- **Tracked uppercase text**, heavy weights (700–900), tight letter-spacing on
  big numerals.
- **Glass wells**: `--well` background, `1.5px` translucent white border, inner
  top highlight, `backdrop-filter: blur(6px)`. The theater and game-state bar
  add `.cs-rim` — an animated trail-gradient border (`--s1 → --accent → --s2`,
  7s crawl).
- **Monospace numerals** (`Chivo Mono`, `--mono`) with `tabular-nums` for every
  score, count, distance, and rate — they must not jitter as they tick.

### 4.1 Palette & the theme contract

The stage defines CSS custom properties resolved by `resolvePalette()`:

| Var | Meaning | Slice 26 default |
|-----|---------|------------------|
| `--s1` / `--s1-rgb` | side 1 color | lime `#c5f707` |
| `--s2` / `--s2-rgb` | side 2 color | teal `#57e0e7` |
| `--side` | the **featured** character's own side color | (s1 or s2) |
| `--accent` | neutral accent | pink `#f93f91` |
| `--well` | glass surface fill | `rgba(255,255,255,0.08)` |

Resolution order (per `resolvePalette`): the **active design package's
`callout.svg`** may declare `--side1 / --side2 / --well / --accent-neutral` on
its SVG root (slice26 does) → else the per-port controller colors
(`PORT_COLORS`, overridable via `overlays.postgamecallout.port{N}Color`) → else
`overlays.global.accentColor`. The mount fetches `/design/{pkg}/callout.svg` as
the backdrop and falls back to `default`, then to a built-in radial-gradient SVG
(`builtinThemeSvg`) keyed on port colors. This is the **same theme contract as
the Game Summary** (`postgame-vs-mount.js`); see `public/design/README.md`.

> **Slice 26 palette** (theme SVGs are gitignored `user_data`, so this lives
> only here): lime `#C5F707` · teal `#57E0E7` · pink `#F93F91` accent · plum
> well `rgba(118,36,92,0.4)`.

---

## 5. Animation choreography — the walkthrough

The show is a GSAP timeline sequence. Pacing constants live in the **`BEAT`
object at the top of the mount** — the primary tuning surface:

```js
const BEAT = {
  transIn: 0.28,    // bar morphs INTO the between-AB transition card
  transHold: 0.95,  // the big "9TH INNING · 2 OUTS" card holds (theater resets under it)
  transOut: 0.28,   // card morphs back into the scoreboard bar
  situate: 0.25,    // breath between bar reveal and the pitch firing
  stampHold: 1.45,  // result stamp + runner movement dwell before the next PA
  shortHold: 0.5,   // extra landed dwell for short balls in play
  hrStampHold: 2.2, // home runs earn a longer dwell
  noFlight: 0.8,    // dim-theater beat for K / BB / HBP
  finaleHold: 0.9,  // pause before the spray chart fires
};
```

### 5.1 The sequence

1. **Intro** (`introTimeline`) — backdrop wipes in from the featured side
   (`clip-path` inset from the character's own side), then plate → stat cards →
   hero → theater (scaleX from the side) → bar cascade in. The stadium JSON is
   fetched *during* the intro so the field is ready.

2. **Per AB** (`playAb`), for each plate appearance:
   - The previous chip's `.live` rainbow ring retires. The bar **morphs into the
     inning transition card** ("▼ BOTTOM 9TH" / "2 OUTS"). This card
     **establishes the new at-bat first** — before any game-state numbers
     appear (the bar starts hidden; the very first thing it ever shows is this
     card, not a flash of the situation).
   - **Under the card**, the theater resets: `renderer.clearHit({ animate: true })`
     glides the camera back to the broadcast pose (never a snap — see §6). The
     situation panel updates while hidden.
   - The card morphs back. The pitch fires: `renderer.setHit()` plays the exact
     recorded flight **once**, camera mode chosen by `cameraFor(ab)` (§6). Stars
     the PA consumed visibly spend from the meter. Perfect contact triggers the
     `#cs-flash` glint (see §5.2).
   - **When the result lands** (ball lands / play concludes — *not* at AB open),
     the chip inserts into the ticker with its result styling and `.live` ring.
     This keeps the ticker in lockstep with the replay.
   - The **result stamp** shows (`stampFor` / `showStamp`): big result word +
     sub-chips (wall jump / sliding catch, bobble, contact quality, distance in
     feet, star swing, star-chance outcome, clutch/go-ahead runs). Runner dots
     walk the diamond base-to-base; score odometers tick; batting stats bump.
   - Dwell = `hrStampHold` for HR, else the renderer's `recommendedHoldMs()` for
     short hits (gentle cam is still settling), else `stampHold` + `shortHold`.

3. **No-flight ABs** (K / BB / HBP): the theater was cleared under the card;
   dim it, hold `noFlight`, then the chip + stamp.

4. **Finale** (`finale`) — the bar retires into the **FINAL card** (winner
   text-marked, per-side box-score lines `H · HR · ★`, mirrored around the FINAL
   tag + stadium name). **Every recorded flight fires at once** as the spray
   chart (`setHit({ spray: true })`), which holds indefinitely. `lockFinals`
   trues up every counter to the box score; `revealRates` opens OBP/SLG.

**No-GSAP fallback**: `startShow` detects a missing GSAP and snaps everything to
final state (all chips, FINAL card, spray chart) so the scene is never blank.

### 5.2 The white-flash fix (do not regress)

Perfect contact originally flashed a **full-viewport white fill**, which read as
a dropped frame / broadcast glitch between at-bats. It is now `#cs-flash`: a
**localized radial flare** in the theater's own side/accent colors,
`mix-blend-mode: screen`, scale-pulsing 0.85→1.25 — a light glint, not a white
frame. Nice/Sour deliberately **don't** flash (it would dilute Perfect as the
marquee tier).

---

## 6. The Rio Visualizer — camera, trails, stadium

`HitRenderer` (`renderer.js`) owns a Three.js scene driven entirely by method
calls. The spotlight constructs it with `{ orbit: false, cinematic: true,
fixedCam: true, viewMode: 'stream' }`. All flight data is **game coords in
meters**; the world group is X-flipped (`world.scale.x = -1`) so 1B renders on
the right from behind home plate.

### 6.1 Camera modes

Selected per shot via `setHit(sim, { camera })`. `cameraFor(ab)` in the mount
picks: **`hero`** for home runs / deep flies, **`gentle`** for *every other ball
in play*, **`spray`** for the finale. (The `follow` cam exists but the spotlight
never uses it — mid-range hits on it read as a mere rotate.)

| Mode | Use | Behavior |
|------|-----|----------|
| `broadcast` | fallback; anything that must stay rock-still | The locked pose: high behind home (`BROADCAST_POS [0,19,-32]` → `BROADCAST_LOOK [0,2,42]`). Never moves. |
| `follow` | (unused by spotlight) | Broadcast pos + gentle tracking pan, ~7m push-in, settles on landing. |
| `hero` | home runs, deep flies | Contact hold (~0.45s), then an **accelerating rising crane** (quadratic bezier) that tracks the ball, glides through the landing, settles wide. **Stops advancing at the outfield wall** (+`HERO_WALL_MARGIN_M` 6m) — a moonshot is tracked rotationally from the fence, never by clipping through geometry. |
| `gentle` | all other balls in play | **Hero's crane at infield scale** — the same rising arc *onto the field*, framed wider (`GENTLE_FIT_M` 100m vs hero's 56m box), paced over ≥`GENTLE_MOVE_MS` 2200ms so a sub-second flight doesn't compress the move. Shares `_updateHeroCam` outright. |
| `spray` | finale / multi-path | **Presentation** camera (see §6.3). |

**Deep-fly threshold** (`isDeepFly`): `distance ≥ 85m` (~279ft) **or**
`maxHeight ≥ 30m` (~98ft) earns the hero crane — long outs and wall-ball
doubles/triples qualify, not just homers.

**Camera language is unified** (the outcome of several rounds of iteration):
gentle *is* hero at infield scale; hero settles on **what the viewer saw** (the
truncated impact point, `_drawnStops` / `_sceneLanding`, not the phantom landing
beyond the stands); resets are **animated glides** (`clearHit({ animate: true })`,
`RETURN_MS` 1150ms, the internal `return` cam mode), never snaps. Earlier
short-hit variants that read as a rotate from behind home were discarded — don't
reintroduce them.

**Hero-crane wall clamp** relies on `_computeWallProfile` / `_wallDistanceAt`: a
per-azimuth outfield-wall distance table measured from wall-typed collision
triangles. `_truncateAtStadium` raycasts an HR's recorded path segment-by-segment
against the stadium mesh (prefiltered to past ~70% of the wall distance — a
one-time cost per HR shot) and cuts the drawn ball + trail at first intersection.
The **labeled distance stays the recorded carry**.

### 6.2 Ball trails

WebGL clamps line width to 1px, so **every trail is a tube** (`TRAIL_RADIUS`
0.34 — HRs are distinct by *gradient*, not girth). `_makeFxTube` builds three
kinds:

- **`plain`** — solid `theme.lineGlow`. If the ball is out, the completed trail
  **fades to red** after landing (`RED_FADE_MS` 500ms, matching the red-X marker).
- **`hr`** — a vertex-colored gradient that **crawls along the length** during
  flight and for `HR_CRAWL_HOLD_MS` (4s) after landing, then freezes (so held
  frames stop rendering). Default gradient `#ffd24d → #ffffff → #ff8fe1 →
  #57e0e7`; a theme may override via `theme.hrGradient`.
- **`star`** — golden shimmer: **faster crawl, tighter repeats, + a soft opacity
  pulse** — reads as "star swing" with no UI. **Star outranks HR** when both
  apply (a star-swing homer still reads star — the HR is already told by the
  camera + stamp + distance). A star hit that ends in an **out** blends its
  shimmer per-vertex toward red.

**Progressive reveal is load-bearing.** The trail draws *behind the ball as it
flies* — never a pre-drawn path. The ball and trail derive from **one clock**
(`_flightFrame`, 60fps) plus a per-trail `arcFrac` arc-length table, so the
revealed tip sits exactly on the ball by construction (this fixed a
long-standing ball/trail desync).

In **spray mode** the hr/star crawls loop forever (`crawlEndMs = Infinity`);
trails materialize staggered (`SPRAY_STAGGER_MS` 110ms) and draw on over
`SPRAY_REVEAL_MS` 450ms, no ball flight.

### 6.3 Spray-chart camera (the idle presentation)

A **presentation camera, not a replay camera** — designed to hold on screen
indefinitely. Framing takes in the **whole field** (the wall-profile extent +
home plate folded into the bounding box — never a tight zoom on the hit cluster).
It holds a static establishing view until **every** trail has drawn on (+ a
`SPRAY_SETTLE_MS` 1.4s beat; no frames rendered while static), then begins a
**very slow pendulum yaw** (`SPRAY_ORBIT_ARC` ±0.3 rad, `SPRAY_ORBIT_PERIOD_MS`
52s) layered with a softer radius/height breathe on an **incommensurate period**
(`SPRAY_BREATHE` ±5.5%, `SPRAY_BREATHE_PERIOD_MS` 34s) — so the large, gradual
motion never reads as a repeating loop. A 6s ease-in ramp releases the hold
imperceptibly. Home plate stays comfortably in frame (behind-plate standoff
0.55× camera height, look pulled toward the plate at center ×0.72).

### 6.4 Stadium polish

- **Proper pentagonal home plate**, oriented flat-edge-to-pitcher; scaled up to
  read on broadcast. Real bases at the game's throw-target coordinates.
- **Batter's boxes** flank the plate; the one the batter stands in is
  **highlighted** as a handedness indicator (`setBatterHand` / `_applyBatterHand`,
  fed the character's `battingHand`). RH batter → third-base side (screen-left
  after the X-flip).
- **Painted foul lines** run out to the wall along each side's *true* fair/foul
  boundary — measured from the collision mesh (`_computeFoulAz`: the border
  between foul-flagged `0x80` and unflagged ground, **not** the base corners,
  which sit slightly fair).
- **Per-stadium themes** (`themes.js`): each arena recolors collision-type
  triangles (grass/wall/dirt/pit/water/…) + sky/fog/lighting, sampled from
  gameplay screenshots — **colors only, no copyrighted assets**. A theme may also
  repaint specific mound geometry (`infield.mound`, `moundPanels`) to match an
  arena's palette; repaint the stadium's own geometry, never draw an overlay on
  top of it.

### 6.5 Performance (broadcast-grade)

- **Render-on-demand**: in cinematic mode, frames are **skipped** while held with
  nothing moving (`_animUntil` covers flights, trail effects, camera glides + a
  tail; `_sprayCamActive` covers the idle orbit; `_dirty` forces one frame after
  a discrete change). This keeps the spotlight from fighting the OBS encoder for
  GPU when idle.
- Backing resolution capped at `devicePixelRatio ≤ 2` (OBS/CEF can report high
  DPR and multiply every antialiased fragment).
- `?perf=1` logs frames over budget.

---

## 7. Design principles

These are the standing intentions the scene is measured against. When adding to
or refactoring the spotlight, satisfy *these*, not just a feature list:

1. **The featured player is a primary visual focus.** Big hero art, big name.
2. **The current at-bat is always easy to follow.** The inning transition card
   establishes each PA; the ticker stays in lockstep with the replay.
3. **Nothing reserves empty space.** Optional stats collapse; neighbors reflow.
   A card that *might* hold content must not leave a gap when it doesn't.
4. **Remove clutter.** Pitch type/speed chip removed; strikeouts stat removed;
   labels dropped where the value is self-evident.
5. **Transitions tell the story.** Camera resets glide; cards morph; the finale
   is a real closing frame, not a stale in-game scoreboard.
6. **Big moments feel cinematic.** Home runs get the hero crane + celebratory
   trail + longer dwell.
7. **Consistency across the UI.** Star totals, contact labels, and distances
   agree in the meter, the chips, the stamp, and the cards — always.
8. **Motion is motivated, unified, and never draws attention to itself.** One
   camera language across all batted balls; the spray cam is a presentation, not
   a performance.
9. **Stay in Slice 26.** No pill chips; tracked caps; glass wells; mono numerals.

---

## 8. Tuning surface (the knobs)

An agent asked to adjust *feel* rather than *behavior* should reach for these
top-of-file constants first — they were all left as knobs deliberately:

| Where | Constants | Controls |
|-------|-----------|----------|
| mount | `BEAT.*` | walkthrough pacing (transition card, stamp dwell, HR/short holds, finale) |
| mount | `DEEP_FLY_DISTANCE_M` (85), `DEEP_FLY_HEIGHT_M` (30) | when a ball earns the hero crane |
| mount | `PORT_COLORS`, `NEUTRAL_ACCENT` | fallback palette |
| renderer | `TRAIL_RADIUS` (0.34) | trail thickness (all kinds) |
| renderer | `HR_*`, `STAR_*` (crawl period, repeat, hold, pulse) | celebratory trail cadence |
| renderer | `SPRAY_ORBIT_ARC/PERIOD`, `SPRAY_BREATHE*`, `SPRAY_AERIAL` | spray idle drift feel |
| renderer | `HERO_*`, `GENTLE_*`, `FOLLOW_*` (fit, hold, glide, settle, wall margin) | camera crane framing/pacing |
| renderer | `SHORT_HIT_DISTANCE_M` (45) | hero/follow → gentle auto-swap |
| renderer | `BROADCAST_POS/LOOK`, `MOUND_Z` | the locked pose + mound center |
| themes | per-stadium `palette / hemi / sun / fog / moundPanels / infield / decals` | arena look |

---

## 9. Verification & open items

- **Tests**: `tests/unit/test_postgame_spotlight.py` covers the data contract —
  star cost, fielder's-choice detection, bunt inference, defense position
  breakout, fallback flight. Run `./venv/bin/python -m pytest`. Keep these green
  and extend them when the AB record changes.
- **Visual/OBS verification is a live-footage judgment call** — the camera *feel*
  (gentle-cam energy, spray orbit arc, wall margin), stadium color under game
  lighting, and trail-shimmer speed are best evaluated on air, not in headless
  screenshots. When you change a `BEAT` or camera constant, say so and defer the
  aesthetic sign-off to a live check.
- **Deferred by design** (not bugs): the defense card is always shown when data
  exists (block never null); Perfect-contact is the only quality that flashes;
  the `follow` camera is retained in the renderer but unused by the spotlight.

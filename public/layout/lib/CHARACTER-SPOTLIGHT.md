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
| **Scene mount** (orchestrator: DOM builders, palette, theme fetch, element contract) | `public/layout/lib/postgame-callout-mount.js` (~470 lines) |
| **Scene stylesheet** (scoped `.cs-root` CSS) | `public/layout/lib/postgame-callout-css.js` |
| **AB-ticker chips** (result-code metadata, swing-tag / contact-quality readers, chip markup) | `public/layout/lib/postgame-callout-chips.js` |
| **AB walkthrough sequencer** (renderer plumbing, per-AB choreography, intro/finale) | `public/layout/lib/postgame-callout-theater.js` |
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
│  (team logo ghosted behind the left column, high — see §3)              │
└──────────────────────────────────────────────────────────────────────┘
```

**Governing principle — no reserved empty space.** Every optional element
collapses and its neighbors reflow to fill. Concretely:

- **Left column is a flex stack**: identity plate → stat cards → hero art. The
  hero has `flex: 1` and claims *whatever vertical room the stat cards don't
  need* — a pitcher's taller card stack means a smaller hero; a bench position
  player's short stack means a bigger hero. Never a fixed gap. **The hero art
  actually uses that room**: it fits at `max-width/max-height: 100%` (it used to
  cap at 92%/96%, which meant it could never fill the slot the flex column gave
  it) and then scales `1.08` about its **bottom centre** — the MSB renders carry
  a lot of transparent margin, so a strictly fitted image leaves the character
  occupying about half the box. 1.08 is a **clearance** number, not a taste one:
  the 650px column centres at x=365 and the theater starts at x=720, so the
  scaled half-width must stay under 355. 1.08 lands at 350; 1.18 — what filling
  the slot vertically would need — lands at 383 and drives the art both off the
  left of the stage and under the theater.
- **The no-start.gg case is the same mechanism.** With no event, no bracket and
  no round the plate loses two lines (177px → 133px) and the hero simply gets
  44px taller. Nothing is reserved for tournament context.
- **The hero's ground glow is measured from the ARTWORK, not the element box**
  (`alignHeroGlow`). Across the roster the renders are all horizontally centred,
  but their silhouettes span **29%–88% of the image width** and their feet sit
  **88%–99%** of the way down it. A glow at a fixed 84% of the element box was
  therefore ~3× wider than a small character, barely wider than a big one, and
  floated in mid-air for the ones with room under their feet — so it landed in a
  visibly different place on every push. The mount draws the art into a 96px
  canvas, scans the alpha channel for the opaque bounding box, and sizes and
  places the pool on that: centred on the silhouette, 1.3× its width (capped at
  the column), vertically centred on the feet line. Cached per source, so a
  replay costs nothing; a same-origin failure falls back to the CSS centring.
  **Nothing in CSS can see where the pixels are** — don't try to solve this with
  percentages again.
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

**Identity plate** — the header, and **the one card in the frame that is the
player's colour rather than neutral**. Event name (small tracked caps) →
character name (56px, 900) → rio name → `bracket · phase · **round**`. Empty
pieces simply don't render. The four context sources, most→least general:
`tournamentInfo.name` (Event) · `tournamentInfo.event_name` (Bracket) ·
`tournamentInfo.phase` (Phase) · `score.{N}.phase` (Round, bold). **No team
logo badge and no team name** here — team identity lives in the ghosted
background logo, and a text repeat of it was a third line competing with the
player's own name.

Port colour on this plate is not a tint: the side gradient runs `0.5 → 0.2 →
well` across the card, the border is the side colour, and the rail is a
full-height spine welded to the card's left edge (`left: 0`, 10px, glowing) —
not the floating 6px pip it used to be. Everything else in the frame stays
neutral so this reads as *the player's card*.

**Long names are fitted, not truncated** (`fitPlateText`). Both the character
line and the rio line step down from their design size (56 / 21) until the text
fits the plate, flooring at 30 / 14. The width is measured with a **`Range`, not
`scrollWidth`** — both lines carry `text-overflow: ellipsis` as a backstop, and
an ellipsed element reports `scrollWidth === clientWidth`, so a `scrollWidth`
fitter would conclude every name fits and never shrink anything. (The Game
Summary's `fitPlateNames` *can* use `scrollWidth`, because its names don't
ellipse. Don't copy that idiom over.)

**Team logo** — a big ghosted *background* graphic behind the left column
(`.cs-bglogo`, over the theme SVG, under every card, 560×560 at `left: 40px`,
`top: 190px`, `opacity: 0.17`).

Three things about it are load-bearing:

- **Whole.** No `clip-path`. It used to be a full-height band clipped at a 28px
  frame border so a wide logo could "bleed right"; what that produced was a
  mark sliced flat down its left side, which reads as a rendering bug.
- **Hard-edged.** No `mask-image` feather either. A radial fade on a team mark
  looks like a smudge. If it is in the wrong place, move the box — don't
  dissolve the logo.
- **High, and brightened.** Centred on the column it landed exactly concentric
  with the hero art and became a halo around the character; anchored high, its
  lower half falls behind the shoulders and its upper half fills the one part of
  the column that is genuinely empty. And team marks are mostly *dark* artwork —
  ghosted over a dark backdrop without `brightness(1.4)` it reads as a stain on
  the frame rather than a watermark.

---

## 4. Visual design language — "Slice 26"

The spotlight speaks the **Slice 26** vocabulary (the tournament's house style),
shared with the Game Summary and the matchup band. The vocabulary is Slice 26's;
the *palette* is whatever the active design package resolves (§4.1) — on the
default package that is the Project Rio night arena. The non-negotiable rules:

- **No pill / chip labels.** Statuses (**Winner, Captain** — see below) are a
  bare right-aligned **tracked-text column** on the plate, never badges. Stamp
  subs, swing tags, and the finale banner use small-radius or bar-prefixed text,
  not badge boxes. **"★ Superstar" is not one of the statuses** — every starred
  character in a game carries the flag, so it was a near-permanent third line
  saying something the hero art already shows. Stars mean something in the
  game-state bar's pip meter and in the AB chips; they don't need a label here.
- **Tracked uppercase text**, heavy weights (700–900), tight letter-spacing on
  big numerals.
- **Glass wells**: `--well` background, `1.5px` translucent border, inner
  top highlight. **No `backdrop-filter`** — see §4.1. The theater and game-state bar
  carry `.cs-rim`, now just a brighter `--edge` — the animated trail-gradient
  border (`--s1 → --accent → --s2`, 7s crawl) that used to ring them is
  **removed**. It ran for the whole show around the one surface that is
  supposed to hold attention, and once the palette went back to controller
  ports its gradient re-read as red-to-blue. `.cs-rim` is kept as a hook so a
  package can give the framed surfaces their own edge; the same removal applies
  to the Game Summary's board / linescore / match card.
- **Monospace numerals** (`Chivo Mono`, `--mono`) with `tabular-nums` for every
  score, count, distance, and rate — they must not jitter as they tick.

### 4.1 Palette & the theme contract

The stage defines CSS custom properties resolved by `resolvePalette()`:

| Var | Meaning | Default package |
|-----|---------|-----------------|
| `--s1` / `--s1-rgb` | side 1 color | side 1's **controller port** colour |
| `--s2` / `--s2-rgb` | side 2 color | side 2's **controller port** colour |
| `--side` | the **featured** character's own side color | (s1 or s2) |
| `--accent` | neutral accent | Rio red `#ff3d4e` |
| `--well` | glass surface fill | night glass `rgba(14,14,22,0.74)` |
| `--port-color` / `--port-2` | what the backdrop SVG *paints* its A and B sides with | **both set to `--side`** |
| `--side-a-weight` / `--side-b-weight` | whether each backdrop side paints **at all** (0–1) | A `1`, **B `0`** |
| `--brand-color` | the backdrop's centre bloom | **`--side`** (defaults to Rio red `#e60012`) |
| `--dot-weight` | the backdrop halftone's opacity | `0.34` (Game Summary uses the `0.5` default) |

**The backdrop is ONE colour, ENTERING FROM ONE SIDE, and that is the whole
point.** `callout.svg` is authored as an A side and a B side; the Game Summary
feeds it the two players at full weight. The spotlight is about *one* player, so
`resolvePalette` gives both sides that player's colour **and switches the B side
off**.

Mirroring the colour into both sides was the obvious first move and it was
wrong. A symmetrically tinted frame reads as a vignette, as a lighting rig, as
anything except a person. Colour that enters from the side the player occupies
and falls away across the frame reads as *their* light. The spotlight's player
is always in the left column whichever side they batted on, so A is always the
lit side. `--s1` / `--s2` survive where two colours still mean something: the
score strip and the FINAL card.

**The centre bloom goes with them.** `callout.svg`'s brand bloom is Rio red by
default, which is right for the Game Summary — the centre of a two-player frame
belongs to neither side, so the brand is the natural thing to put there. On a
one-player frame it was the last layer carrying a second hue, and behind a
**blue** player a red glow in the middle read as the other player's colour
leaking into their own callout. The spotlight retints it via `--brand-color`, so
the backdrop carries exactly one chroma. The Rio-red **accent** does *not* move —
it marks moments (WINNER, FINAL, star pips) and never stands for a player.

Two consequences worth knowing before you tune anything:

- **Side-coloured glows stop reading**, because they no longer have a
  differently-coloured backdrop to be brighter than. The hero's ground glow
  needs a pale core (`rgba(232,236,255,0.3)`) to show at all; the colour tints
  the light, the light is what you see.
- **The halftone comes down** to `--dot-weight: 0.34`. Three of this frame's
  four corners are covered by cards, so at the Game Summary's weight the dots
  only ever appeared as a rind around the content.
- **The identity plate's own type had to be re-graded.** When the plate was a
  neutral well with a 0.26 tint, the event line could be side-coloured and the
  context line could sit at `--ink-3` and both still read. On a card that is now
  the player's colour at 0.55, side-coloured type is colour-on-colour and
  fog-500 is mid-grey on mid-saturation. Every line moved up one step of the fog
  scale, the event line stopped being side-coloured, WINNER took the Rio accent
  instead of the side colour, and the plate gradient was **concentrated at the
  rail end** (falling away by 34% instead of 42%) so the type sits on dark
  glass while the card still reads as the player's. Strengthen the plate again
  and you have to walk these with it.

Resolution order (per `resolvePalette`): the **active design package's
`callout.svg`** may declare `--side1 / --side2 / --well / --accent-neutral` on
its SVG root → else the per-port controller colors (`PORT_COLORS`, overridable
via `overlays.postgamecallout.port{N}Color`) → else
`overlays.global.accentColor`. The mount fetches `/design/{pkg}/callout.svg` as
the backdrop and falls back to `default`, then to a built-in radial-gradient SVG
(`builtinThemeSvg`) keyed on port colors. This is the **same theme contract as
the Game Summary** (`postgame-vs-mount.js`); see `public/design/README.md`.

**Default vs Slice 26 — what each pins.** slice26 declares a fixed side pair
(the sides are the tournament's colours). The **default** package deliberately
declares only `--well` and `--accent-neutral`: sides stay bound to whoever's on
which controller port, which is what the producer sees in gc-overlay and in
game. That leaves the *neutral* carrying the whole look, so:

> **Never give the default package a white neutral.** These scenes were ported
> out of Slice 26 with its white-glass wells intact; against the default port
> palette (port 1 red, port 2 blue) a white well, white border and white label
> chip put a white stripe between a red side and a blue side and the whole
> scene read as a flag rather than as Project Rio. The chrome is now the
> **night/fog scale** from `lib/rio-theme/tokens.css`, exposed as a named set at
> the top of `postgame-callout-css.js` and mirrored name-for-name in
> `postgame-vs-mount.js`: `--ink` / `--ink-2` / `--ink-3` / `--ink-4` (fog text,
> brightest to dimmest), `--edge` / `--edge-soft` (borders, dividers),
> `--sheen` (inner top highlight), `--slab` (inset chips + bar tracks),
> `--scrim` (stamp/badge backing over the 3D). Restyle these, not raw
> `rgba(255,255,255,…)`.

The **accent is Rio brand red**, and it is the only fixed chroma in the frame —
it marks moments (FINAL, the winner mark, star pips, the HR stamp, the backdrop's
brand bloom), never a player. Because a player on port 1 is also red, accent-red
is kept to *chrome* roles: rules, glows, outlines and type. The two places it used
to be a filled lozenge (the Game Summary's FINAL badge and WINNER pill) are now
tracked text over a rule — a solid red pill dead-centre between a red side and
a blue side was the third stripe.

> **Slice 26 palette** (theme SVGs are gitignored `user_data`, so this lives
> only here): lime `#C5F707` · teal `#57E0E7` · pink `#F93F91` accent · plum
> well `rgba(118,36,92,0.4)`.

**The backdrop.** `default/callout.svg` is a full-canvas layer under a scene
whose every card is a large translucent surface animated by GSAP, on a machine
that is also running the game. As of **August 2026 it animates nothing at all**,
which is the cheapest it has ever been.

Composition, bottom to top: night base → the wall (a bare square grid fading out
as it reaches the floor) → horizon air → floor haze → the floor pool → the
Rio-red brand bloom → the port edge columns → the port corner blooms → the port
halftone in the four corners. Gradients, one masked grid, one masked dot field.
The **centre column stays neutral by the gradients' own stops** — every
port-carrying layer reaches zero alpha before the middle of the frame, so the
two sides read as two players and not as two halves of a flag. That used to be
enforced by masking every port layer; the masks are gone.

**What was deleted, and why it should not come back.** The frame had accumulated
eight systems talking at once — the grid, crosshair register nodes punctuating
it, the halftone, a horizon hairline, two port washes, a Rio-red rule across the
top, a three-part foot rule across the bottom, and a drifting field of twelve
Rio marks — under a scene whose own cards are already dense with numbers.

- **The register nodes.** The grid alone is texture; the nodes made it a HUD,
  and this scene already carries a diamond, a count, an out meter and a star
  meter.
- **The horizon hairline.** A drawn line across the middle of the frame is the
  single most attention-grabbing thing you can put behind content. The horizon
  *air* gradient survives and says the same thing softly.
- **The top brand rule and the foot rule.** They framed the canvas like a card,
  and a full-screen broadcast scene is a *space*, not a card. The port edge
  columns replace what the foot rule was doing — a side owns its whole edge of
  the frame now — and the composition closes at the bottom without a rule.
- **The Rio mark field**, and this is the tempting one to re-add. Both scenes
  already ghost a big **team logo** into this exact plane at 0.14–0.2, and a
  second scatter of marks at a similar weight didn't read as brand — it read as
  dirt on the lens over the logo that was carrying meaning. Animated, it also
  had to be crammed into a 248px band at the foot to keep its damage rect small,
  which made it a row of stamps rather than atmosphere. **The brand's home in
  these scenes is the team logo and the Rio-red accent, not a wallpaper of
  marks.**

**The halftone was the one worth keeping**, and it came back stronger: four
corners instead of two, each side owning its top *and* bottom corner, so the
lower half of the frame has texture and the port colour holds an entire edge.
`r=0.34` is the number to be careful with — it reaches zero at x≈653 / y≈367
from its corner, well before the 650–1270 centre column. Widen it and the two
sides start to touch.

**The motion budget is real, and it is currently unspent.** A moving full-canvas
layer forces the whole 1920×1080 composite to re-rasterise on every GSAP frame.
The old drifting field cost 20 marks on two nested animations each (2160
crisp-edged rects, 40 running animations) over uncropped masked layers and was
visibly laggy on air. Trimmed to 12 marks in a band it was affordable but
compositionally wrong (above). Every layer in the file is now cropped to where
its own gradient already reaches zero, so the only things under the foot of the
frame are two plain gradient rects. If you add motion here you are spending from
zero — keep it **small, unmasked and transform-only**, and don't let a masked or
patterned layer grow back into the bottom of the frame.

The `backdrop-filter: blur(6px)` that every card above used to carry is also
gone for good — the wells carry their own alpha (~82%) instead, which at that
opacity was all the blur was ever worth.

See the header comment in `public/design/default/callout.svg` for the
composition order and the rules a replacement package has to keep.

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
   - The previous chip's `.live` marker retires (a solid accent edge + glow —
     it was a crawling rainbow ring). The bar **morphs into the
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
9. **Stay in the Slice 26 vocabulary.** No pill chips; tracked caps; glass
   wells; mono numerals. The *colours* come from the package — never hard-code
   a hex where a `--side` / `--accent` / `--ink*` / `--edge*` token exists, and
   never let the neutral go white (§4.1).

---

## 8. Tuning surface (the knobs)

An agent asked to adjust *feel* rather than *behavior* should reach for these
top-of-file constants first — they were all left as knobs deliberately:

| Where | Constants | Controls |
|-------|-----------|----------|
| theater | `BEAT.*` | walkthrough pacing (transition card, stamp dwell, HR/short holds, finale) |
| theater | `DEEP_FLY_DISTANCE_M` (85), `DEEP_FLY_HEIGHT_M` (30) | when a ball earns the hero crane |
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

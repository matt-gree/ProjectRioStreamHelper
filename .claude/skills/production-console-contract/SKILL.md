---
name: production-console-contract
description: The Production tab console architecture (rack / stage / quick rail), the element contract every broadcast element must satisfy to appear there (registration, quick face, stage body), the six-row kit that all three surfaces compose from, and the desk tier for non-element workflows (Match, post-game capture, bracket). Read before adding an element to the Production page, changing production UI, or touching src/routes/production/.
---

# Production Console Contract

> **STATUS: SHIPPED** (2026-07-18). The console is the Production tab: rack
> (`rack.jsx`) · stage (`stage/`) · rail (`rail.jsx`), with desks under
> `desks/` and the row kit in `kit/`. `production.jsx` is a ~280-line shell.
> If this file and the code disagree, one of them is a bug — fix both in the
> same change (same rule as CLAUDE.md).
>
> Design rationale + rendered mockups: https://claude.ai/code/artifact/94e855b2-439a-4563-9472-20fc576c8463 (revision 5).

## The three surfaces

The Production tab is a console: **rack, stage & rail**. Each surface has
exactly one job, and every element appears on all three through one declared
contract.

| Surface | Job | Shows |
|---------|-----|-------|
| **Rack** (left, ~278px) | Monitor + select | Every source's state chip, name, ONE inline quick action. Sections: **Desk → On air → Studio → {phase} off-air → collapsed rest**. Purely state-sorted; no pinned section. |
| **Stage** (center, flexible) | Work on one thing | The selected item's full controls (its *stage body*), under the *source strip* its header always carries. Content-sized. Replaces all gear popovers, MatchCard, and PostGameBar. |
| **Quick rail** (right, ~252px) | Fly the broadcast | Producer-pinned cards: header (chip · name · click-through) + the element's *quick face* (≤ 2 kit rows). Drag-ordered, never auto-reorders, persists across phases and restarts. |

Status vocabulary is ONE language everywhere: `AIR` (emerald, program scene) /
`PVW` (sky, studio preview) / `OFF` (bound, hidden) / `—` (dashed, unbound) /
`DESK` (rio red, content workflow — not an OBS source). Rack chips and rail
chips deliberately show the same state twice (monitor vs controls); both read
the same binding so they cannot disagree.

**Depth rule** (hard, no per-element judgment calls):
- **Rack row / rail card** = state + quick face.
- **Stage** = full live controls + basic settings.
- **Tab** = heavy authoring (commentary roster, brackets, participants, board
  bindings). The stage links out; it never embeds these.

## The element contract

Every broadcast element registers in `src/routes/production/elements.js` with:

```js
{
  id, name,
  phase,            // string | string[] — which phase's off-air rack section offers it
  flavor,           // 'direct' (owns a dedicated source) | 'fed' (pushes to a shared container)
  url, width, height, match(url),   // OBS source binding — unchanged from today
  quickFace,        // ≤ 2 kit rows, or explicit null (see rules below)
  stageBody,        // full controls — kit rows / labelled kit columns
}
```

### Quick face rules

- **Every element must declare a quick face — or explicitly `null`.** Defaults
  are derivable, so most elements write nothing:
  - `direct` → one toggle row (show/hide its source)
  - `fed` with pickable content → container toggle + the content pick itself
    (picking IS feeding, so no separate push row is needed)
  - `fed` with nothing to pick → container toggle + push/clear
- Row vocabulary: `visibility` · `content` · `push` · `setting` (one of the
  element's own live overlay settings). An element deviating from its flavor
  default declares `quickFace` in the registry *and* a component in
  `ELEMENT_QUICK_FACES` (`quickface.jsx`) — both, or the two surfaces disagree.
- **The two-row cap is hard.** No custom blocks on rail cards, ever — the rail
  is where "toggle and push" would creep back into mishmash. If an element's
  only useful quick controls need a custom block, declare `quickFace: null`:
  the element is then not pinnable, and that is an intentional, visible state
  (the pin affordance doesn't render).
- Rail membership is **always producer opt-in** (pin ◆). The contract forces
  the *capability*, never *presence* on the rail.
- The rack row's inline quick action is the quick face's primary control
  (first row's action), rendered as a single compact button.

### Stage body rules

- Compose from the row kit. At stage width, rows may flow into **labelled kit
  columns** (the Match desk uses two: "Who's playing" · "Fixture") — column
  grouping is a kit feature, not a per-element invention. `KitColumns` takes an
  optional `template` for an asymmetric split.
- **Lay out against the panel, not the viewport.** `PanelShell`'s body is a
  `@container`, so stage bodies use container variants (`@xl:`, `@2xl:`,
  `@5xl:`) and the same body collapses to one column in a narrow window without
  knowing the page's breakpoints. Never reach for `md:`/`lg:` in a stage body.
- **Don't hide content behind an expander when the panel has room to show it.**
  The stage is wide; a producer mid-broadcast should not have to remember which
  collapsed row holds the control they need. The Lower Third stage is the
  reference: its five band slots are five always-open columns in the order they
  render on air, so the editor is a scale model of the band. Expanders belong in
  the rack and rail, where space is genuinely scarce.
- **Custom blocks are the bounded escape hatch**: allowed only between standard
  rows, on kit spacing and tokens. Today's sanctioned set: the Match desk's
  captain grid, port select, and format field (Bo + series stepper). Adding a
  new custom block is a design decision, not a convenience — it should stand
  out in review.
- **A label that repeats its own placeholder is noise.** `CAPTAIN` over a
  control reading "Captain…" is the same word twice, and a column of them reads
  as a wall of micro-caps carrying nothing. Label a field when the label adds
  what the value can't (the Match desk's Round and Phase, whose placeholders are
  *examples*); drop it when the placeholder names the field and the filled value
  identifies itself — a person's name, a character portrait, a coloured port
  chip. Keep the accessible name either way. The same test applies to *region*
  eyebrows and to anything the layout already states: "Who's playing" over two
  40px names split by a `vs` spine was a third label line the left region did
  not need, against the Fixture column's one.
- **A disclosure header's job changes with its state, so its content should.**
  Collapsed, the Match accordion's bar is the record's identity — who is playing
  plus which fixture this is (`M2 · A vs B · Winners R2 · Top Cut · <mode>`),
  since that is what tells two matches between the same two players apart. Open,
  the body restates all of it inches below at three times the size, and a bar
  that repeats what it sits on top of reads as blending in no matter how you
  tone it; there it becomes a title bar carrying only what the body *doesn't*:
  the match id (the `M` in `score.{N}.match = M`, invisible everywhere else),
  the stage badge, and the record-level actions. Given a job of its own it can
  then afford a real surface.
- **Header width is worth only what a producer scans for.** Format and series
  score came out of the Match bar entirely: Bo and the running score are things
  you configure once in the body, not facts you scan a stack of records for, and
  `Bo1 · 0–0` on every row paid nothing for the width. Round, phase and mode
  stayed, because they disambiguate. A `decided` set still badges — a clinched
  series is worth interrupting for in a way a live `0–0` is not. When a summary
  line is assembled from optional parts, filter the empties and join, so a bare
  record collapses to its name rather than to a row of orphaned separators.
- **Group with type and space before reaching for a box.** A bordered card
  around one group and not its neighbour makes the same kind of thing look like
  two different things. The Match desk's sides are labelled field groups split
  by a hairline, matching the Fixture column beside them — three type tiers
  (region eyebrow → group heading → micro-cap field label) do the work a border
  was doing badly. Prominence should track how often a control is touched: the
  series score moved out of the panel's centre because a producer corrects it
  once a game at most.
- **A panel needs one loud thing.** Fifteen controls at one weight has no entry
  point, which is what "busy" usually means — not too many controls, but no
  ranking of them. Give the panel's *subject* the only raised surface and the
  largest type, and drop everything else a tier (the kit's field tokens keep
  the geometry and lose the fill). On the Match desk exactly two things are
  loud: the participant name on each side. Captain, port, round, phase, mode
  and format are all set-once metadata and read as one quiet tier below.
- **Colour is a closed vocabulary here, so hierarchy is built from contrast.**
  emerald=AIR · sky=PVW · rio red=DESK/brand · amber=staged · purple/slate=match
  stage. A new hue for a new distinction either collides with a status meaning
  or dilutes all of them — reach for weight, size, surface and space first, and
  when you do need a marker, spend an *existing* colour (the open match on the
  Match desk takes a rio-red left edge, the same red the rack uses to mark the
  desk tier). Watch for inverted prominence: the most saturated pixels on the
  Match desk used to be the controller-port dots, the least-touched field on it.
- **Symmetry needs a stated axis — but align the halves, don't mirror them.**
  Two peer groups side by side read as double the content until something says
  they're one thing: the Match desk's sides are split by a `vs` spine, and that
  hairline is the axis, which is why it's allowed where a divider between peer
  groups is not. The controls inside each side still run the same order in both,
  centred under the name they belong to. The producer's question is "are these
  two set up right", which is a vertical scan, and identical rows compare at a
  glance where mirrored ones have to be read twice.
- **A row of intrinsically-sized controls needs its width budgeted and a wrap
  fallback.** Icon boards are `w-fit` and cannot shrink, so a pair of them grows
  until it overruns its column — on the Match desk the two sides' ports collided
  over the spine. Fixes, in order: a narrower control (a 2×2 port board at ~52px
  in place of a ~90px dropdown), cells sized to the budget (24px against a
  ~224px side at standard window width), width shifted to the column that can't
  flex (`7fr/4fr`, since the Fixture column is all flexible fields), and
  `flex-wrap` as the rail so a narrow panel degrades to stacked, never
  overlapping. Match cell sizes across adjacent boards so they stand the same
  height and read as one row.
- **One-touch beats a dropdown for a small, fixed, frequently-set value.** The
  captain (12) and port (4) pickers are inline boards, not popovers: a dropdown
  there spent a click and a mode hiding a control that fits, and both are set
  every game. Clicking the selected cell clears it, so neither needs a "None"
  row. This is the same rule as "don't hide content behind an expander when the
  panel has room to show it" — applied to a control instead of a section.
- **Selection must be visible in a stack.** Any list of expandable records
  (match accordions today) differentiates open from collapsed on surface *and*
  border, not just the chevron — a producer with five matches has to see which
  one they are editing without reading it.
- **Overlay style settings can be stage rows.** Some layouts (Scorecard, Event
  Header) expose knobs the producer flips *during* a broadcast — bands that
  animate in and out mid-game. Those belong on the stage, not only in Setup.
  Render them with `stage/overlay-settings.jsx`: definitions stay single-sourced
  in `LAYOUT_SETTINGS[type]`, writes go through `stageSettingsSet`. Only
  `switch` and `select` defs are renderable — a text, colour or number setting
  having no kit row is exactly the signal that it's authoring and belongs on a
  tab. Per-board layouts (Scorecard) write `overlays.{type}.{N}.{key}`.
- **The stage body is two columns: controls, then a live preview** of the
  selected element (`stage/preview.jsx`). The preview is the real overlay in an
  iframe against real state — never a mockup — so anything true of the browser
  source is true there, including the blank note `OverlayBase.setBlank` renders
  in `PREVIEW_MODE`. A bound element previews **its own source's URL**, not the
  element's canonical one: the producer's source may carry a size/team variant
  or `?intro=0`, and showing a URL nobody is broadcasting is worse than showing
  nothing. Desks get no preview — they have no source.
- **A preview is the overlay rendered as a SMALLER BROWSER SOURCE.** Pass
  `nativeWidth`/`nativeHeight` (the registry's, i.e. what `addBrowserSource`
  gives OBS) to `ScaledIframe`; it sizes the iframe to the largest box of that
  aspect which fits, and the overlay lays itself out against it exactly as it
  does on air. **Never zoom, transform, or scale a native-size render** — both
  were tried and both failed: `transform: scale()` rasters once and stays
  blurry, and `zoom` gives the inner document a viewport that is neither the
  native size nor the box size (the matchup band drew at ~40% of its authored
  width; the bracket painted outside its box). There is one coordinate system,
  and it is the one overlays were built to adapt to.
- **The iframe must never be created at the wrong size.** Mounts lay out
  against `window.innerWidth/innerHeight` and several do it *once at init*, so
  an iframe corrected after `onLoad` has already handed them the wrong canvas —
  clipped, gigantic or blank previews of a perfectly healthy source. The
  container is measured in a layout effect *before* the iframe renders.
  Measuring the loaded document is only a fallback and can't be made reliable:
  a Layout whose body is `width: 100%` (the bracket) reports the iframe's own
  width back at you.
  *Corollary:* a wrong registry dimension now shows up in the preview, because
  the OBS source is wrong in exactly the same way. That is the correct
  behaviour; fix the registry, not the preview.
- **Exactly one thing computes the box height, and it computes it from the
  WIDTH.** `ScaledIframe` owns its own box (`minHeight`/`maxHeight` props) —
  never wrap it in a container that shapes itself with CSS `aspect-ratio` and
  then let the component measure that container. Two systems deriving the same
  height is a feedback loop with a `ResizeObserver` in the middle: they agree
  until a `max-height` clamp engages (a stage wider than ~995px for a 16:9
  element), and then they oscillate — the overlay clipped at the bottom *and*
  the right, and the renderer could hang outright. Height is derived from width
  alone and the observer ignores height-only changes, so the derivation is
  acyclic by construction. **If you find yourself measuring a box whose size
  depends on what you're about to put in it, that is the bug.**
- **A derived height closes a second loop through the document, via the
  scrollbar.** Taller box → taller page → scrollbar appears → viewport narrows
  ~15px → shorter box → scrollbar goes → repeat, several times a second: the
  whole window shakes. `index.css` cuts it at the source by reserving the
  gutter on `html` — and **`overflow-y: scroll` is load-bearing there**, because
  `scrollbar-gutter` does nothing while the root's overflow is `visible` (the
  default). Setting the gutter alone leaves the width still moving 15px; verify
  with `documentElement.clientWidth` before and after forcing overflow, not by
  eye. `ScaledIframe`'s `RESHAPE_THRESHOLD` is the backstop for any other scroll
  container, not the fix.
- **State the source size and the scale** (`1920 × 1080 · 45%`, from
  `ScaledIframe`'s `onFit`). Filling the panel on a wide display tells a
  producer nothing about how big the thing actually is, and the source
  dimensions are what they have to type into OBS.
- **The preview goes BELOW the controls, at the panel's full width** — not in a
  side column. An overlay is a wide, fixed-size picture, so width is the
  dimension a preview is worth; a 1920×1080 element in a 350px column is an
  unreadable thumbnail. Its height follows the element's own aspect ratio
  (capped, so the controls above it stay on screen), which is also why the
  stage panel is allowed to be tall: it is showing the thing, not just its
  knobs.
- All mutations route through the staging gateway (`stageOrRun`,
  `src/context/staging.js`) exactly as today: content changes stage when
  confirm-mode is on; momentary actions (Take, replay, capture, clock
  transport) always run immediately. The PendingBar is unchanged.

## The source strip — OBS transport in the panel header

Every stage panel wears the same three-slot strip in `PanelShell`'s
`primaryAction` slot (`src/routes/production/sourcestrip.jsx`). It is the ONE
place a producer adds a source, shows or hides it, and hands content to a
shared container — the three verbs that were previously spread across four
renderings (a `DirectStage` row, a `ContainerTarget` row, hitvisualizer's own
copy, and a freeform "Push game summary" button inside a picker body).

```
┌──────────────────────────────────────────────────┐
│ AIR  Scorecard    obs-source   👁  [Push]   ◆  ✕ │
└──────────────────────────────────────────────────┘
      └ state              └ BIND · AIR · PUSH
```

- **Fixed order, fixed place: Bind · Air · Push.** The strip's value is that its
  position always means the same thing; an element that rearranges or relocates
  it has broken the contract, not customised it.
- **Slots are progressive, never per-element.** What renders is decided by
  whether a source exists, not by which element it is: unbound → Bind alone
  (Air and Push would have nothing to act on); bound → Bind retires, Air
  appears. This is why the old dead-end prose ("add its browser source in OBS")
  is gone — the panel that told you what to do now does it.
- **Which source the strip commands follows flavor.** `direct` → the element's
  own dedicated source. `fed` → the **shared container** it feeds; "on air" for
  a fed element has never meant anything else, and Push is the slot that
  distinguishes its content from the container carrying it.
- **Bind adds hidden** (`addBrowserSource({ enabled: false })`), into the studio
  preview scene when Studio Mode is on, else program. Adding a source is setup,
  and setup must never be the thing that puts something on the broadcast — the
  Air slot beside it is the one deliberate act that does. This is the single
  place the console departs from the Layouts tab, which adds *visible* because
  it is a setup surface with nothing live to disturb.
- **Air is an eye, not a switch.** A switch is a chunky two-state track wanting
  a label to its left, and a 36px header has room for neither; it would be the
  loudest thing in a bar that already states its status in the chip. `IconToggle`
  with `Eye`/`EyeOff` is the kit's existing on/off idiom, and its engaged tone is
  rio — so the only emerald in the header stays the AIR chip.
- **The Push slot stays put and goes honestly grey.** It renders for every fed
  element, including the pickable ones where "picking IS feeding": there it
  reads `Clear` once something is fed, and a *disabled* `Push` before anything
  ever has been. A slot that appears and vanishes per element is the mishmash
  this contract exists to end; one that holds its place and disables is not.
- **Desks render nothing in the slot.** They have no OBS source (chip `DESK`),
  and letting a desk's own actions colonise the position would cost the strip
  the one property that makes it scannable.
- **The strip is a STAGE surface.** Rail cards keep their quick face (visibility
  as row one) — a `QuickCard` header is 8px shorter and already spoken for. Both
  route through the same hooks (`setSourceVisibility`, `useContainerPush`), so
  the two surfaces cannot disagree about what Push means.
- Staging is unchanged: Air goes through `setSourceVisibility`, Push through
  `useFeedControl`. Bind does not stage — it creates nothing visible.

`useContainerPush` (`feeds.js`) is the single definition of "is my content on
the container, and can I put it there". `PICKABLE_FEEDS` (`elements.js`) and
`FEED_OPTION_HOOKS` (`feed-pickers.jsx`) are the same question asked by two
surfaces and are pinned against each other in `elements.test.js`.

## Which source a panel commands — boards

Two board mechanisms, and conflating them is how multiplicity ends up feeling
bolted on:

| | The board is fixed by | Gets `scope: 'board'` |
|---|---|---|
| **URL-scoped** | the source itself (`?scoreboard=N`) | **yes** — scoreboard, scorecard, hitvisualizer |
| **Feed-scoped** | the pushed *content* (`{ element, scoreboard }` in the payload) | **no** — the shared container is board-agnostic on purpose |

- **Type detection and instance identity are different questions.**
  `element.match()` is a deliberately loose regex (tolerates another host,
  `?intro=0`, `/scoreboard2/`) and is right for "which overlay is this" and
  wrong for "which board's". `boundIn` filters by `match()`, then discriminates
  with `paramsMatch` from `src/lib/obs-binding.js` — the same comparison the
  Setup tab has always made. Don't collapse the two.
- **A lone candidate binds regardless.** With exactly one source of the type
  across the tracked scenes there is no ambiguity, so `elementBindings` retries
  loosely — a rig whose only scoreboard source carries `?scoreboard=2` keeps
  working. The count is taken **across all scenes**, never per scene, or a
  board-1 source in program wins over the board 2 asked for in preview.
- **The board comes from the selection, and is passed down.** `stage/index.jsx`
  resolves the selected instance and hands `board` to both the strip and the
  body; a rail card takes it from the pin. Which board a panel commands is the
  same fact as which rack row the producer clicked, so the source the header
  commands and the settings the rows write cannot disagree. Never re-derive a
  board inside a body or a quick face — take the prop. See Instances below.

> The rack is still one row per element, resolved at the default board — it
> becomes one row per *instance* when instances land, which is the real fix.

## The row kit

`src/routes/production/kit/` — the component library all three surfaces build
from. 28px control rhythm. Primitives:

| Row | Shape | Typical use |
|-----|-------|-------------|
| Toggle row | label + switch | source visibility, sub-plates, overlay band switches |
| Select row | label + dropdown | board pick, content pick, spotlight scene |
| Number row | label + number + suffix | spotlight hold, countdown minutes, gap width |
| Field row | label + any control; `stacked` puts the label above | pickers the kit doesn't own (participant, captain, port, a typed field). Stack it in a column of form fields, where a fixed label gutter would push every control off the panel's left edge |
| Action row | 1–3 buttons | push, replay/spotlight/split, capture, clock transport |
| Segmented row | segmented control | plates mode, scorecard score block |
| List row | lead · name · meta · controls; optionally expandable in place | casters, plates, lower-third slots, schedule queue |
| Icon toggle | one icon button with on/off state | eye, sub-plate, remove |
| Custom block | anything, kit tokens/spacing | Match captain grid, port select, format field |

`ListRow`'s `name` takes a node as well as a string. A row whose primary
content is itself editable (a person picker, a slot type select) passes the
control — wrapping an input in the expand button would make it inert, so the
chevron carries the expand affordance instead.

Plus: `PanelShell` (header: chip · display-face name · primary action · pin ·
close where applicable; body; optional footer), `StateChip`, `QuickCard`,
labelled column wrapper. The kit exists so the cheap path and the cohesive path
are the same path — a bespoke panel should be *harder* to write than a
conforming one.

## Which scenes the console can see — the mirror

`src/context/obs.jsx` mirrors OBS scene-by-scene, and **not every scene is
mirrored**. Program and the studio-preview scene are eager. Any other scene is
mirrored only once a surface asks, via `useMirrorScene(sceneName)` (hook) or the
`mirrorScene(name)` store action, and stays mirrored for the life of the
connection.

- **Read a scene's items through the hook, not `sceneItems[name]` directly.**
  The raw store entry is `undefined` both for "still loading" and for "nobody
  asked" — `useMirrorScene` returns `{ items, loading, mirrored }` so an empty
  section renders "no PRSH sources here" only when that is actually true.
- **A scene not in `mirroredScenes` gets no events.** `SceneItemCreated` /
  `Removed` / `ListReindexed` are gated on the tracked set, deliberately: an
  ungated handler pulls scenes nobody opened into the store. If a surface needs
  a scene live, it must mirror it.
- **Input settings are cached by source name**, so mirroring another scene
  costs one `GetSceneItemList` plus a call only for sources not seen before. The
  cache is invalidated by `InputSettingsChanged` (which also re-runs the
  shutdown reconciliation) and `InputRemoved`. Don't add a code path that reads
  a source's url by calling `GetInputSettings` directly — go through the cache
  or the mirror, or the fan-out this exists to prevent comes back.

## Desks — non-element workflows

Things that **feed the broadcast but aren't on it** (no OBS source, no air
state). Today: the **Match** desk (fixture authoring — sides, format, series,
board binding, start.gg load), the **Capture** desk (post-game), and the
**Bracket** desk (which start.gg phase the bracket overlays draw). Rules:

- One entry per desk in `DESKS` (`rack.jsx`), a body in `DESK_BODIES`
  (`production.jsx`), and — when pinnable — a face in `DESK_QUICK_FACES`
  (`quickface.jsx`). All three are checked against each other in
  `rack.test.jsx`; adding a desk means adding all three.
- They live in the rack's **Desk section** (first section, faint red wash,
  `DESK` chip) — a row with live meta (`M1 · 1–0`, `empty`/`captured`, the
  loaded phase), dimmed when idle, selectable like any row. Never in the state
  sections. Rack meta must read from state only: the rack draws every frame and
  must not fire a desk's own fetches.
- **The rack shows only the current phase's desk.** A desk is the work of one
  phase; the others are noise the rest of the time, the same reason off-phase
  elements collapse behind "Other phases". Live owns no desk, so the section is
  absent there rather than standing empty. A desk selected before the phase
  changed stays on the stage — the rack stops offering it, it doesn't yank it.
- **Each desk declares its home phase** (`phase` in `DESKS`) and the phase
  switch selects it: Draft → Match, Post-game → Capture, Break → Bracket. Live
  owns no desk and keeps the producer's selection — mid-game they are flying
  elements, not filling a desk in. One desk per phase; `deskForPhase()` is the
  single lookup, so a new desk gets its phase from the registry rather than
  from an `if` chain in `production.jsx`.
- Same panel contract as elements — desks may declare a quick face under the
  same rules (Capture's `select board + capture` fits; Match currently has no
  compliant face → `quickFace: null`, not pinnable).
- Deep authoring still defers to tabs: sets/bracket → Competition, board
  bindings → Match tab. Any future feeds-but-not-on-air workflow (bracket
  refresh, roster sync) is a desk, not a new UI invention.

## Adding a new element — checklist

1. Build the overlay Layout first (see `overlay-authoring` skill) — the console
   binds to its URL.
2. Register in `elements.js`: id, name, phase(s), flavor, url/dims/match, and
   quick face (or accept the flavor default, or explicit `null`).
3. Write the stage body as kit rows in its own file under
   `src/routes/production/stage/`. No freeform JSX layout. **Do not write a
   show/hide row or a push button into the body** — the source strip in the
   panel header owns both, for every element.
4. If it needs settings beyond kit rows' reach, that's a signal they belong on
   a tab, not the stage.
5. Verify: rack row appears in the right phase section with a working chip and
   quick action; pin → rail card renders the quick face within cap; selection →
   stage body; staging gateway honored (test with confirm-mode on).

## Persistence (all local UI prefs via `usePersistentState`, like the phase choice)

- `prsh.ui.production.phase` — existing.
- `prsh.ui.production.selection` — selected **instance** id.
- `prsh.ui.production.rail` — ordered array of pinned **instance** ids.

Nothing here belongs in server Settings — it's per-producer-browser workspace
layout, not broadcast config.

There is deliberately **no** `prsh.ui.production.board.{elementId}`. It existed,
and it was the bug — see Instances below.

## Instances — the board is part of the identity

`src/routes/production/instances.js`. An element is a TYPE ("Scoreboard"); an
instance is one of that type on the broadcast ("Scoreboard on board 2"). A
`scope: 'board'` element is URL-scoped (`?scoreboard=N`), so two of them in one
scene are two independent things with their own source, air state and settings.

- **Instance id is `{type}:{board}`**, or plain `{type}` for a global element.
  Rack rows, stage selection and rail pins all key on it. Desk ids
  (`desk:match`) share the colon and must not parse as instances — the board
  suffix is always DIGITS, which is what keeps the namespaces apart. Don't
  introduce a numeric desk name.
- **The instance set is discovered ∪ declared** — sources found in the tracked
  scenes, plus `scoreboards.active`. Both halves matter: discovery alone hides a
  board configured but not yet sourced (exactly when the producer needs the row,
  since the strip's Bind slot is how the source gets made); declaration alone
  drops a source whose board has left `active`, orphaning something on air.
- **Nothing derives a board on its own.** The board comes from the selection or
  the pin and is passed down. It used to be a hidden per-element preference each
  surface resolved separately, which meant a two-board rig had ONE rack row
  silently commanding whichever board a stored value named, and a panel whose
  rows and header strip could point at different boards. A board *picker inside
  a panel* is that bug coming back — switching board means selecting the other
  rack row.
- **Feed-scoped elements never get instances.** Their container is
  board-agnostic and the board rides in the pushed payload (see the two-board-
  mechanisms note in `elements.js`). Conflating the two is how multiplicity ends
  up feeling bolted on.
- **Name the board only when there's more than one instance** of that element,
  using its alias. A single-board rig reading "Scoreboard · Scoreboard 1" on
  every row is the board mechanism charging rent it isn't paying.

### Stored ids are RESOLVED, never rewritten

Selection and pins outlive the boards they were written against. `resolveInstance`
collapses three cases into one rule — fall back to the element's first instance:
a pre-instance id (`scoreboard`), a removed board (`scoreboard:9`), and a live
hit. Resolving at read time costs a lookup and cannot be wrong for longer than a
render; a one-shot storage migration would have to run before the OBS mirror and
settings load — precisely when the instance list is least trustworthy — and
would destroy the producer's pin if it guessed wrong.

Pins are **acted on as stored** (reorder and unpin address the producer's array,
so a legacy pin stays removable) but **rendered from what they resolve to**.
`togglePin` compares by resolved target, so a legacy `scoreboard` and a new
`scoreboard:1` can never sit on the rail as two cards for one source. New pins
are written canonical, so a rail converges as it is used.

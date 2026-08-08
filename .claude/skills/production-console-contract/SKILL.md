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
| **Rack** (left, ~278px) | Monitor + select | Every source's state chip, name, ONE inline quick action, plus an Add (+) per scene. Sections: **Desk (permanent) → program scene → preview scene → every other scene (lazy, collapsed)**. Grouped by scene; no pinned section. |
| **Stage** (center, flexible) | Work on one thing | The selected item's full controls (its *stage body*), under the *source strip* its header always carries. Content-sized. Replaces all gear popovers, MatchCard, and PostGameBar. |
| **Quick rail** (right, ~252px) | Fly the broadcast | Producer-pinned cards: header (chip · name · click-through) + the element's *quick face* (≤ 2 kit rows). Drag-ordered, never auto-reorders, persists across restarts. |

Above the three, one **band** (`production.jsx`): the OBS connection on the
left, scene transport and the demo switch on the right, hairline underneath.
The left anchor is deliberate — connectivity is the one fact true of the whole
console, and the band had everything pushed right, which read as a hole between
the tabs and the columns rather than as a bar. **The band is also where the
Match fixture is headed**, so weigh anything you add to it against that.

Status vocabulary is ONE language everywhere: `AIR` (emerald, program scene) /
`PVW` (sky, studio preview) / `OFF` (bound, hidden) / `—` (dashed, unbound) /
`DESK` (rio red, content workflow — not an OBS source). Rack chips and rail
chips deliberately show the same state twice (monitor vs controls); both read
the same binding so they cannot disagree.

**Depth rule** (hard, no per-element judgment calls):
- **Rack row / rail card** = state + quick face.
- **Stage** = full live controls + basic settings.
- **Tab** = heavy authoring (brackets, participants, board bindings). The stage
  links out; it never embeds these.

A tab has to earn its place: if a tab's controls are the same decisions the
element's stage already carries, the tab is duplication and the stage wins. The
Commentary tab was removed for exactly this — its six per-caster controls were
the stage's controls in a taller form, and the casters' identity fields were
always Address Book's job.

## The element contract

Every broadcast element registers in `src/routes/production/elements.js` with:

```js
{
  id, name,
  flavor,           // 'direct' (owns a dedicated source) | 'fed' (pushes to a shared container)
  url, width, height, match(url),   // OBS source binding — unchanged from today
  quickFace,        // ≤ 2 kit rows, or explicit null (see rules below)
  stageBody,        // full controls — kit rows / labelled kit columns
}
```

### The subject — what the element is DRAWING

`src/routes/production/subject.jsx`. Every other row in the console answers
*what can I do to this*; the subject is the one that answers *what is this
showing*. Before it, a panel could describe a source completely — its OBS name,
its scene, its air state, its transport verbs — and never once say what was on
it, and a panel titled "Roster · Team 2" could not tell a producer whether team
2 was the player they meant (Rio reassigns away/home every game, so a side is a
position, not an identity).

- **It renders in exactly two places.** The **stage**, above the body: subject
  before knobs. The **rail**, as row one of the direct flavor's default quick
  face. Not the rack — that is a dense scannable monitor and already carries the
  board/variant detail; a second line per row costs the density that makes it
  one.
- **It is a readout, never a control** — the only row in the kit with no
  interaction (`SubjectRow`). No dot and no colour: the console's hues are spoken
  for, so the tiering is type (subject in foreground, qualifier dimmed).
  `tone="warn"` is the single exception and means what amber means everywhere
  else — you would want to know before it is on air.
- **It reads LIVE STATE, never settings or a stored preference.** The one
  deliberate exception is a fed element, whose subject is explicitly the standing
  intent (`resolveIntent` — what Push would show) and says so. If you want to
  show a configured value, that is a stage row.
- **Dispatch is by COMPONENT, not a map of hooks** (`SUBJECTS`), same as
  `ELEMENT_QUICK_FACES` and `STAGE_BODIES` and for the same reason: choosing a
  resolver by id would be a conditional hook call.
- **Resolution runs most-specific, then by SHAPE**: a declared subject → container
  → fed *and* container-scoped → fed → board scope → team variant → nothing.
  The `containerScoped` branch is gated on `flavor === 'fed'` because **Roster is
  both** a container member and a direct element with its own `?team=` source;
  only a fed member ever rows under a container, so an ungated check handed the
  Roster's own source the container's frame of reference and drew the wrong side.
- **A scoped member takes its container from the PLACEMENT, not from
  `useContainerOf`.** A container-scoped member may sit on several rosters — that
  exception is what makes a mirrored pair buildable — so a lookup from the
  element answers with whichever it finds first, which on a mirrored pair is a
  coin flip between the two sides.
- **The board for a variant source comes off the SOURCE's url** (`boardOfUrl`),
  not the placement: `?team=` layouts are unregistered and take `scope: 'board'`
  from nobody, so the placement's board is null while the URL still carries the
  `?scoreboard=` the overlay itself reads.
- **There is deliberately no `hasSubject()`.** The rail looks like it wants one —
  budget a row before rendering it — and a first cut had one, which promptly
  disagreed with `Subject` over a Stat Card on no roster. One fact, two homes,
  and a predicate that cannot read the store can never be the second. It is also
  unnecessary: a component rendering null produces no flex item, so a card with
  no subject collapses to its single toggle. **The two-row cap is a budget, not a
  quota.**
- `battingSide` is a **third runtime** of `_team_role` (server/automations.py) /
  `RioData.getTeamRole` (public/layout/lib/rio-data.js) — the same split the
  scoreboard's blank-reason predicate lives with, pinned by `subject.test.jsx`.
  Change one, change all three.
- **It is five existing ideas named, not a new one.** The hit visualizer's
  latest-hit line, the matchup's fetched series, the bracket's drawing-phase
  note and the capture desk's score were each a hand-rolled subject in a stage
  body, in four shapes, reachable from nowhere else. When a body wants to state
  its content, that is this row — and if the statement is only true on the stage
  (the matchup's "on air for another match"), that is what stays in the body.

### Quick face rules

- **Every element must declare a quick face — or explicitly `null`.** Defaults
  are derivable, so most elements write nothing:
  - `direct` → **subject + toggle row** (what it's drawing, then show/hide). A
    card carrying only a visibility switch is a worse copy of the rack row it was
    pinned from — the same control, minus the scene — and eleven of the console's
    elements defaulted to exactly that, which made the rail look like a surface
    for the two elements with custom faces that everything else was tolerated on.
  - `fed` with pickable content → the content pick + push/clear (picking ARMS
    the element's intent; Push airs it — see "Pick vs air" below)
  - `fed` with nothing to pick → container toggle + push/clear
- Row vocabulary: `subject` · `visibility` · `content` · `push` · `setting` (one
  of the element's own live overlay settings). An element deviating from its flavor
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
- **Overlay style settings are stage rows.** A layout's element settings all
  render on the stage — `switch`, `select`, `text`, `number`, `colour` each have
  a kit row (`stage/overlay-settings.jsx`; definitions stay single-sourced in
  `LAYOUT_SETTINGS[type]`, writes go through `stageSettingsSet`). The old cap
  (switch/select only) was a proxy for a cramped one-column stage, not a real
  authoring/live split — it's gone. A stage body still *leads* with the settings
  a producer flips live (Scorecard bands, Event Header bands): it lists those
  keys in a static `surfacedKeys` on the body component, and `ElementStyleSettings`
  (added by `stage/index.jsx` for every element) renders the **rest** as a Style
  section, so nothing is stranded on a tab and nothing doubles up. Per-board
  layouts (Scorecard, Scoreboard) write `overlays.{type}.{N}.{key}`; the Style
  section takes the board from the element's `scope`.
- **A kit row is sized against its PANEL, not once for all three surfaces.**
  `KIT_LABEL` is `w-16 @lg:w-32`: 64px is right on a 252px rail card and a 278px
  rack row, and it was the only width, so on a ~950px stage the same column
  clipped "Bottom Offset" to "Bottom O…" with 800px empty beside the input.
  Container queries measure `PanelShell`'s body; the rail and rack are not
  containers, so they never match and keep 64. Same reason `SettingGroups` goes
  two-column at `@3xl` — a stage panel is wide, and one column of label-plus-
  control is most of what "sparsely populated" meant.
- **A settings panel is a scale model of the element it configures.** A def may
  carry a `group` in `LAYOUT_SETTINGS`, and a group is a **visible region of the
  overlay** — "Top band", never "Switches" or "Geometry". `OverlaySettingGroups`
  renders them in the order they first appear in the registry array, which is the
  order they appear on screen; `groupDefs` collects by name rather than by
  consecutive run, so a filtered-out def can't split one region into two. The
  Event Header is the reference (14 settings, three regions, no Style section
  left). Ranking is by ORDER — the set-once group sits last — and groups are
  **always open, never accordions**, same rule as the Lower Third's five columns.
  `OverlaySettingRows` stays flat on purpose: it also builds rail quick faces,
  where a group eyebrow would blow the two-row cap.
- **A detail follows its master, but only when it is INERT.** A def may carry
  `showWhen: { key, is }` and renders only while its master satisfies it (the
  Stat Card's custom bottom text, on a card whose bottom line is showing the game
  line instead). The gate reads the STAGED value too, so choosing the mode
  reveals the field before Go Live. The bar is *inert*, not *inactive*: a band's
  title while the band is switched off stays, because authoring it ahead of
  turning the band on is a real workflow.
- **A switch's label names the PART, not the verb.** "Team Logos", not "Show
  Team Logos" — a column of "Show …" repeats the switch's own affordance once per
  line and pushes the distinguishing word rightwards, which is most of what makes
  a settings panel read as a wall. Same for a prefix the group already says
  ("Field: Location" under a *Top band* heading). The description carries the
  sentence.
- **A setting the active design package can't honour is not shown.** A def marked
  `appPalette: true` in `LAYOUT_SETTINGS` reaches its overlay through the app's
  CSS palette, which a **full-art** theme's mount *clears* rather than honours
  (`clearDesignSettings`) — so it is dead, and dead controls come off the panel
  (`useLiveDefs` + `routes/layouts/designPackage.js`). Three rules hold it
  together: the tier is **per element, never per package** (`classic` is a token
  skin that still ships a full-art callout, and an element a package omits falls
  back to full-art `default`); the answer is read from the **shipped SVG's**
  `data-design-vars`, reported by the server as `appVarElements`, never from a
  manifest; and **anything unknown shows the row** — a knob that turns out inert
  is a confusion, a knob that silently vanished is a control with no way back.
  A type is gated only if `THEME_ELEMENT` names its theme file, which is why
  `stats` isn't: two renderers share that namespace and only one is themed.
- **The reveal-animation toggle is a stage row too** (`stage/intro.jsx`, "On
  show"). It renders only for animated overlays (`ANIMATED_ELEMENT_TYPES`) and
  is a source BEHAVIOUR, not a `LAYOUT_SETTINGS` knob: it writes
  `overlays.{type}.disableIntro` AND rewrites already-added OBS sources in place
  (`?intro=0` + shutdown, via `obs.jsx setLayoutIntroDisabled`). Deliberately
  **not staged** — the imperative OBS rewrite can't be deferred as a unit, so the
  preference write and the rewrite stay atomic and immediate, like an Add.
- **The stage body is two columns: controls, then a live preview** of the
  selected element (`stage/preview.jsx`). The preview is the real overlay in an
  iframe against real state — never a mockup — so anything true of the browser
  source is true there, including the blank note `OverlayBase.setBlank` renders
  in `PREVIEW_MODE`. **Every silent mount names its own blank reason** (Phase 6b):
  a source that hides itself when it has nothing to draw calls `setBlank(reason)`
  at that hide path, so the preview says *why* it's empty rather than reading as
  broken. `blank-reason.test.jsx` is a source-level guard that each such mount
  keeps the call. Scoreboard additionally mirrors its reason into the panel body
  (`generic.jsx` `ReadinessNote`) because its DirectStage shows no player state;
  the rest rely on the preview. A bound element previews **its own source's URL**, not the
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
  element, including the pickable ones: it reads `Clear` once this element holds
  the container, and a *disabled* `Push` before anything is armed. A slot that
  appears and vanishes per element is the mishmash this contract exists to end;
  one that holds its place and disables is not.
- **Desks render nothing in the slot.** They have no OBS source (chip `DESK`),
  and letting a desk's own actions colonise the position would cost the strip
  the one property that makes it scannable.
- **The strip is a STAGE surface.** Rail cards carry the same pick+push, so both
  route through the same hooks (`setSourceVisibility`, `useContainerPush`,
  `useFeedSelect`) and cannot disagree about what a pick or a Push means.
- Staging: Air goes through `setSourceVisibility`, Push/live-edit through the
  container write. Arming a pick (`production.feed.last.*`) is NOT staged — it
  drives the preview, not the broadcast. Bind does not stage.

`useContainerPush` (`feeds.js`) is the single definition of "is my content on
the container, and can I put it there". `PICKABLE_FEEDS` (`elements.js`) and
`FEED_OPTION_HOOKS` (`feed-pickers.jsx`) are the same question asked by two
surfaces and are pinned against each other in `elements.test.js`.

### Pick vs air — a pick is not a push (`useFeedSelect`)

"Picking IS feeding" was wrong for a full-screen callout: choosing a character
to preview must not slam it onto the broadcast. So picking is **decoupled** from
airing (`useFeedSelect` in `feeds.js`):

- **A pick ARMS.** It writes the element's standing intent
  (`production.feed.last.{element}`) — what the preview draws and what Push
  airs — and stops there. Immediate, never staged, not broadcast-visible.
- **…unless this element already holds the container**, where the pick is a
  live edit of what's on screen and updates the container too (through the
  staging gateway, because that IS broadcast-visible). Selecting off-air arms;
  Push airs; selecting on-air live-edits.
- **Push** (`useContainerPush.toggle`) takes the armed intent to the container.
  It is the only thing that puts a not-yet-live pickable element on air.
- The rail's pickable quick face is therefore **pick row + Push/Clear**, not the
  old container-toggle + pick. The card chip reports on-air state; the toggle
  steps aside so pick+push fits the two-row cap.

### Standing intent — what Push would show (`suggest.js`)

A container holds exactly ONE occupant, so pushing the Game Summary onto the
Callout Stage overwrites `production.feed.container.callout-stage` and takes the
Character Spotlight's pick with it. `resolveIntent(state, element, scoreboard)`
is the one answer to "what would Push put up", read by the stage picker, the
rail picker, the Push slot and the preview so they can never disagree.

- **Memory.** `useFeedSelect.select` / `useFeedControl.setFeed` write
  `production.feed.last.{element}`. Clear deliberately leaves it — Clear takes
  the element off air, it does not un-pick the character.
- **Validated, never trusted.** `charIndex` indexes ONE game's roster, so every
  pickable payload carries the character's `name` and `FEED_INTENT[feed].valid`
  re-reads it from live state (`postgame.*` for the spotlight, `score.*` for
  stats). A mismatch discards the memory. Feeds with no entry (a whole-game push
  like `postgamevs`) replay as-is — nothing in them can go stale.
- **Suggestion.** With no usable memory, `FEED_INTENT[feed].suggest` proposes.
  The spotlight's opener is the **winning side's leader in total bases** (ties:
  homeruns → RBI → roster order), never a loser's big day. It is the floor, not
  the ceiling — add rankers there so every surface keeps reading one answer.
- **Intent is not air.** Off the stage the picker shows intent and *says so*
  ("Suggested — …" / "Not on the stage — Push shows …"), and drops its "Nothing
  fed" option, because clearing a feed that isn't running would only snap the
  dropdown back. The chip remains the sole statement of what is live.
- Call `resolveIntent` inside a `useShallow` selector and return **flat
  primitives** — a nested object rebuilt each render re-renders on every tick.

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
  wrong for "which board's". A placement takes its type from `match()` and its
  board from `boardOfUrl` (`src/lib/obs-binding.js`), where a missing
  `?scoreboard=` means board 1 — the documented board default. Don't collapse
  the two.
- **Nothing searches for a source any more.** `boundIn`, `elementBindings` and
  the lone-candidate retry are gone, along with the ambiguity they managed: a row
  is built FROM a scene item, so it already has the one it commands. If you find
  yourself writing a lookup from element to source, you are re-introducing the
  bug — take the placement.
- **Board and scene come from the selection, and are passed down.**
  `stage/index.jsx` resolves the selected placement and hands it to both the
  strip and the body; a rail card takes it from the pin. Which source a panel
  commands is the same fact as which rack row the producer clicked, so the
  header and the rows cannot disagree. Never re-derive a board or a scene inside
  a body or a quick face — take the prop.

## Scenes are the grouping axis

`src/routes/production/placements.js`. A **placement** is the console's row
identity, and it is the third and last term in a chain the console converged on:

| | is | keyed |
|---|---|---|
| **element** | a type — "Scoreboard" | `scoreboard` |
| **instance** | + which board or variant | `scoreboard:2`, `roster~t1` |
| **placement** | + which scene's copy | `scoreboard:2@Break` |

- **The scene is part of the identity for the same reason the board is.** A
  source in two scenes is two scene items with their own enabled state, so a
  console that keys control on the instance alone drives whichever it resolved
  first — the exact bug board-aware binding fixed one axis over. It is also the
  payoff of scene grouping: staging a Break scene while Game is live means
  toggling *that* copy.
- **Derivation runs SOURCE → ROW.** The rack scans each scene's PRSH items and
  identifies them; it never holds a list of elements and goes looking. That is
  what killed the dead `—` rows, the lone-candidate retry, and the need to
  enumerate boards. A row exists because a source exists.
- **The rack lists only what is in a scene.** The Add picker (below) is the
  other half of that trade — with unbound rows gone, it is how a source comes
  into being.
- **Fed elements are NOT discovered from sources, and they NEST under their
  container.** Character Spotlight and Game Summary share one Callout Stage
  source; a source→row scan alone would collapse two separately-driven elements
  into one row. The container is what's really in the scene, so **it** takes the
  row — always, targeted or not — and every fed element aimed at it rows
  underneath (`parent` on the placement, a left rule + radio in the rack).
  They are **mutually exclusive**: `production.feed.container.{id}` holds one
  value, so exactly one can occupy the container. Flat top-level fed rows were
  wrong three ways — two rows shared one scene item so both chips read `AIR`
  when at most one could be on screen, either row's eye toggled the other's
  source, and the container appeared as a row only while *nothing* was aimed at
  it. A source in `/layout/shared/` is what makes something a container.
  Which elements nest under which container is a direct read of the container's
  **roster** (below), not an inverted scan over per-element settings.
- **A PRSH source the registry doesn't know still gets a row** (`genericElement`)
  — chip, name and the Air slot, but deliberately **no preview**: native
  dimensions come from the registry, and previewing at a guessed aspect is the
  failure the preview column was rebuilt to stop telling.
- **Ids are RESOLVED at read time, never rewritten** (same rule and same reasons
  as instances). `resolvePlacement` narrows instance → element, then prefers a
  **named scene** over "nearest air": `scoreboard@Break` means Break, and
  answering with the program copy would fly the wrong scene.
- **A selection or pin that resolves to nothing still opens a panel**
  (`sourcelessPlacement`): chip `—`, the strip offering Bind, every control that
  doesn't need a source working. The rack is a monitor and shows only what is
  real; the stage is a workbench, and several stage bodies write STATE, not OBS.
  Authoring a lower third the night before has nothing to do with whether a
  browser source exists yet.

**Phase is gone** — no `PHASES`, no `elementsForPhase`, no `phase` on an element
or a desk, no `prsh.ui.production.phase`. Draft / Live / Post-game / Break was
PRSH inventing a show structure and asking the producer to keep a selector in
sync with it. It decided which rack section an element appeared in, which desk
was reachable, and what hid behind "Other phases" — jobs the OBS scene list does
better, because the producer already built their scenes around the same
structure and already cuts between them.

### The chip, with a scene coordinate

`chipFor(placement)` — program → `AIR`/`OFF`, preview → `PVW`/`OFF`, **any other
scene → `OFF`, enabled or not**. A source enabled in a Break scene nobody has
cut to is not on the broadcast, so AIR would be a lie; the row's eye still shows
the item's own state, so the producer sees what *will* come up. Scene grouping
adds a coordinate to the vocabulary rather than a word to it. No source anywhere
→ `—`.

**A fed row takes both conditions**: its container must be up *and* be carrying
this element's content (`placement.mine`). AIR keeps meaning exactly what it
always meant — a fed element just has two ways not to be on. Reading the
container's enabled state alone is what had two rows claiming AIR for one slot.

**The stage preview shows LIVE state, and a fed element must name its occupant.**
Two rules, both learned the hard way:

- `previewUrl` passes `?preview=1` **without** `?sample=1`, so the preview is
  what is about to go on air rather than the fixture game. That split lives in
  `overlay-base.js` (see the overlay-authoring skill) — before it, every stage
  preview was a mockup. (Demo mode is the deliberate exception: when the
  producer flips the top bar's **Sample** switch, the preview shows the fixture
  because so does the browser source. The preview never disagrees with air.)
- A fed element has no source of its own — Character Spotlight and Game Summary
  are both registered at `/layout/shared/callout-stage.html` — so `previewUrl`
  returns the same URL for every element aimed at one container, and the
  container draws whichever occupant is fed. It therefore appends
  **`?feed={elementId}`** (a fed element asks for itself; a container row asks
  for `placement.carrying`), which the shell passes to `initFedContainer` as
  `forceElement`, overriding the element only — board and content still come
  from the live feed. Preview-only: on air there is no `?feed=`.

The container's own row previews too, sized from its **definition** —
`containerElement(id, def)` (`placements.js`) synthesises it rather than
`genericElement`, because every container is rendered by ONE generic shell and
keying identity on the pathname would give every container in a scene the same
id (duplicate React keys, and a panel driving whichever source `find()` reached
first — the bug the board and variant axes exist to prevent). Its element id is
`container:{id}`, and the definition supplies the name and native size a
generic element cannot.

### Containers are producer-built

`src/routes/production/containers.js`. A container is ONE OBS browser source
that hosts whichever of its **members** the producer feeds it. It is not a file:
`settings.production.container_defs.{id}` = `{ name, width, height, members }`,
and one generic shell (`/layout/shared/container.html?container={id}`) renders
any of them.

- **Membership lives on the CONTAINER, and it is exclusive.** The roster IS the
  relationship. It used to be stored per element
  (`production.containers.{elementId}`, defaulting to the element's own layout
  stem via `defaultContainerFor`) — one fact with two homes and a default no UI
  ever wrote, which is the shape these drift apart in. Both are gone. Adding a
  member to a second container MOVES it, because
  `production.feed.container.{id}` holds one occupant and two containers
  claiming one element could never both be honoured. Enforced in exactly one
  place: `useContainerActions`.
- **…except for a container-SCOPED member, which is added, not moved.**
  Exclusivity answers *where does a push land*, and a member declaring
  `containerScoped` (Roster, Stat Card) has no content of its own to land — it
  draws whoever the **container's** scope has on the field, so the container is
  the subject and two rosters holding it is not a contradiction. It is the
  mirrored pair the automation engine was designed around: two scoped
  containers, the same members, one canned rule, one showing the batter and the
  other the pitcher. Without the exception that pair was only buildable by
  hand-editing settings. `isSharedMember` in `containers.js`; a `containerScoped`
  element also takes its Push payload's board **and side** from the container
  definition rather than the board picker (`useContainerPush`).
- **Sharing a container IS the definition of mutually exclusive.** That is what
  the producer is choosing when they tick two members onto one roster.
- **No container is a real state.** `useContainerOf` returns `null` when no
  roster names an element, and every surface reports it — `canPush` is false,
  the stage says which container to add it to. The old implicit default is
  exactly what made membership look configured when nothing had been.
- **A member must FIT** (`fitsContainer`): the container's size or smaller.
  There is no scaling system — OBS does placement — so a larger member is
  unrepresentable rather than handled, and a smaller one **centers, never
  scales**. Centering is safe for the reason scaling was not: no aspect math,
  no resampling, no blur.
- **The sizes offered when building one are the CENSUS** of what can go in a
  container (`containerSizeClasses`, derived from `CONTAINER_MEMBERS`), not
  invented presets. Size is fixed at creation: the OBS source already exists at
  those dimensions, and changing it later would leave the source at the old size
  with nothing to say so. Two sizes means two containers.
- **`CONTAINER_MEMBERS` is not the same question as `flavor`.** Every `fed`
  element, plus anything declaring `containerHostable` — the hit visualizer owns
  a dedicated source AND can be fed into a container ("Split feed" on its
  stage). It is the console's half of a fact `fed-container.js` also holds (the
  mounts it can stand up); `containers.test.jsx` pins the two together until the
  mount registry makes them one list.
- **The container id comes off the URL the same way in both runtimes**:
  `?container=` first, filename stem as fallback (`containerId` in
  `elements.js`, `containerIdFromLocation` in `fed-container.js`). The fallback
  is what keeps a browser source still pointing at a pre-2.0 named shell
  (`callout-stage.html`) rowing and feeding. Those files stay on disk; the
  catalog offers only definitions, or the same container would list twice.
- **The id is never all digits** (`containerIdFor`). A container's row id is
  `container:{id}` and `parseInstanceId` reads a colon-plus-DIGITS as the board
  suffix — same rule that forbids a numeric desk name.
- **The catalog reports containers from the definitions** (`_container_layouts`
  in `server/api/v1/layouts.py`), which is also the only place a container's
  name and native size live. The `shared/` folder is skipped entirely.
- **The container's stage panel owns name + roster** (`stage/container.jsx`,
  dispatched on `element.container`, not by id). Deleting a definition clears
  its feed but **never deletes the OBS source** — the console does not remove a
  source the producer watched appear.
- **A member leaving a roster takes its dependents with it** (`detach` in
  `containers.js`): the feed if it is what the container carries, the `resting`
  state if that named it, and any automation rule that drove it. A member leaves
  three ways — removed, MOVED to another container, claimed by a new one — and
  every one of them must clean up the same amount. The engine treats the leftovers
  as inert, so this is not about what goes on air; it is about a definition that
  claims to rest on something it cannot render, and rules that revive the day the
  member returns.

### Container automations

`src/routes/production/automations.js` + `stage/automation.jsx`. A container can
feed **itself**: a rule watches a state key and shows one of its members for a
dwell, then returns to the container's resting occupant. The engine is
**server-side, inside the state-write path** (`server/automations.py` on
`State.hooks`), so a rule's feed write rides the same `SetBatch` as the HUD change
that triggered it — the console only edits and reports.

- **Two fields on the container definition**, both absent until set:
  `resting` (the member it returns to; absent = empty/transparent, and that is
  the right answer for a container that only ever holds pushed content) and
  `scope` = `{scoreboard, team}` (its frame of reference).
- **Scope is the mirror mechanism.** It resolves `{sb}` in a rule's trigger and
  picks the side of the content the engine feeds, so a mirrored pair is **two
  scoped containers running one canned rule** — the same batter change shows the
  batter on the side at bat and the pitcher on the side in the field. Do not add
  a per-rule side.
- **Rules come from the QUICK-ADD LIBRARY only** (`AUTOMATION_LIBRARY`). A
  free-text trigger key is a way to write an automation that silently never
  fires; the canned entries are known-good and carry the producer-facing words
  (`triggerLabel`, `guardLabel`). Editable per rule: the switch and the dwell.
  Custom authoring waits until these have been through a real broadcast.
- **A template is offered only when its member is on the roster** (`templatesFor`)
  — a rule feeding a non-member is inert in the engine, so offering it would be
  offering something that quietly does nothing.
- **A rule id is `{container}:{template}`** (`ruleIdFor`), because two containers
  legitimately run the same canned rule; adding one twice to one container is a
  no-op, since two identical rules would fire twice into a key that holds one
  occupant.
- **Precedence is manual > rule > resting**, mirrored by the engine to
  `production.feed.reason.{container}` and read by `useFeedReason` — same instinct
  as `side_reason`: say WHY something is up. A producer Push suspends the rules,
  and **clearing the container is what hands it back**; there is deliberately no
  Resume verb, because resting *is* what a container shows when nothing else is
  up.
- Rules are **config, so writes are immediate and never staged** — the
  broadcast-visible half is the feed the engine writes, not the rule.

### The Add picker

`src/routes/production/addsource.jsx`, opened by the **+** in a scene's section
header: *layouts (+ boards) → preview → add them all to THIS scene*. Two panes —
catalog left, live preview right.

- **The catalog stops being a place you browse and becomes a transaction.** The
  scene is already answered, because the producer opened the picker from it.
- **Selection is MULTI, and a pick is keyed on `url + board`** (`pickKey`), not
  url. Building a scene is a batch — scoreboard, both stats bars, ticker, event
  header — and one catalog row picked on two boards is two sources with their
  own air state, settings and instance id. Keying on url alone collapses them,
  which is the bug board-aware binding fixed one axis over.
- **The board control is therefore ON THE ROW, not in the footer** — a
  board-scoped row on a multi-board rig renders one chip per board, and the
  chips ARE its check state (no checkbox beside them: a third reading of the
  same fact goes ambiguous the moment only board 2 is picked). A single-board
  rig gets no chips at all; the pick still carries board 1. A chipped row drops
  its dimensions column — five chips and a size both squeezed leaves
  "Scoreboard —…" three times over, and the size is stated authoritatively in
  the preview header anyway.
- **A row click checks AND focuses the preview**, so the one-element case is
  still one click. Clicking a checked row unchecks it but keeps it previewed:
  focus and check are different questions.
- **The preview is `?preview=1&sample=1`** through `ScaledIframe` — the real
  overlay, drawn against its own sample bundle, because a producer building a
  scene has no game running. (The STAGE preview deliberately omits `sample`;
  there the point is what is about to go on air.) It shapes its box from the
  layout's aspect so the checkerboard's edges are the source's edges, capped at
  the catalog list's height so the taller column is always the list and the
  dialog never resizes as the producer moves down it. A layout with no declared
  size previews at 1920×1080 — the same fallback `addBrowserSource` gives OBS,
  because the preview's viewport must be the source's viewport.
- **Two CSS traps live here, both "content sized the box that sizes the
  content".** The preview column is a `minmax(0,1fr)` grid track, not a flex
  child: ScaledIframe sizes its iframe in PIXELS, that becomes the ancestors'
  min-content width, and the dialog's own grid grew past its max-width until the
  footer buttons rendered outside it and were clipped — `min-w-0` cannot fix
  that, a minimum is a floor, not a cap. And the list is a plain
  `overflow-y-auto` div rather than the kit's `ScrollArea`, whose Radix viewport
  wraps children in a shrink-to-fit `display: table` that sizes to a `truncate`
  row's full nowrap label, running the rows past the pane and slicing
  "1920×1080" down to "192".
- **Batch adds run SEQUENTIALLY**, never in parallel: the OBS mirror reconciles
  one event at a time, and `addBrowserSource`'s uniqueness check is
  read-then-write, so two in flight both see the same input name free.
- **Partial failure is reported, never rolled back** ("Added 4 of 5 — Scorecard
  failed"). Deleting sources the producer just watched appear is worse than
  naming the one that didn't make it. The successes leave the selection and the
  dialog stays open on the failures, so a second Add retries rather than
  duplicates.
- **Consumes `/api/v1/layouts`, not `ELEMENTS`** — the registry knows the ~14
  things the console can CONTROL, the catalog knows the ~25 things OBS can SHOW.
  The one exception is the **shared** group: container rows are built from the
  definitions in the settings store and the catalog's own shared rows are
  dropped, so a container the producer just created is pickable immediately
  instead of racing a refetch against the settings write. The union is
  self-healing — once the server reports the new one, the merge is a no-op.
- **Containers are BUILT here**, from a **+ New** in the shared group's header:
  name → size → members that fit, then the new definition is created, selected
  and previewed so Create → Add is one continuous act. Building one belongs in
  the transaction that puts it in a scene, because that is the only reason to
  build one. Size comes first: it is the constraint the member list answers to,
  and members that stop fitting after a size change are dropped visibly rather
  than carried.
  Variants (size / team / direction) are separate catalog rows, so picking
  "Scoreboard — Small" is choosing a row, not filling in a form.
- **Adds HIDDEN**, like every Bind path in the console. Adding a source is
  setup; the rack row's eye is the one deliberate act that puts it on air.
- **The OBS input is named what the producer clicked** (`rowLabel`, variant and
  all) — the catalog's raw `name` for a variant row is the filename stem, so
  naming from it would create "scoreboard 2" for a row reading "Scoreboard —
  Large".
- `isBoardScoped` is **derived from the two places that already answer it** (the
  `scoreboard1` layout group, and `scope: 'board'` in the registry) rather than
  a third hand-written list.
- **Copy URL is the OBS-independent path** (`overlayUrl`, the same builder Add
  uses). A producer running OBS on another machine, or wiring sources by hand,
  copies exactly what Add would create — no OBS round-trip, so it stays live
  when Add can't. This is what let the Setup layout browser be deleted (phase 8).
  It **follows the selection**: several picks copy as one URL per line, and with
  nothing checked it falls back to whatever is previewed.

## The row kit

`src/routes/production/kit/` — the component library all three surfaces build
from. 28px control rhythm. Primitives:

| Row | Shape | Typical use |
|-----|-------|-------------|
| Subject row | text + dimmed qualifier | what the element is drawing (readout only — see above) |
| Toggle row | label + switch | source visibility, sub-plates, overlay band switches |
| Select row | label + dropdown | board pick, content pick, spotlight scene |
| Number row | label + number + suffix | spotlight hold, countdown minutes, gap width, band geometry |
| Text row | label + text input | header title, field separator, a card's custom bottom line |
| Colour row | label + swatch + hex + reset | per-overlay colour overrides (bracket lines, port colours); empty = theme default |
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

## With no OBS: the catalog tier

`catalogPlacements` + `useConsoleOffline` (`placements.js`). **OBS is the control
surface, not the content pipeline.** Source → row is right when there is a source;
with OBS closed there is none, and the console used to collapse to three desk
rows and an apology — no row to select, so no stage, so no way to author a lower
third, build a container, set a scorecard's bands or preview any of it.
Everything the console does that *isn't* show/hide became unreachable because of
the one thing it can't do.

So the rack degrades along exactly that line: it stops mirroring and lists what
PRSH can **configure** — every element (one row per active board for a
`scope: 'board'` one), plus the producer's containers with their rostered members
nested under them exactly as they nest online, plus any fed element no roster
claims (top-level, because *being unreachable* is the problem its stage solves).

- **One section, `ELEMENTS`, no scenes** — there are none to group by. It is a
  selector rather than a monitor, which is the honest half of the rack's job when
  there is nothing to monitor.
- **Same placement shape as `sourcelessPlacement`** (`item: null`, `scene: null`,
  `where: 'none'`), because that is what these are: things we know the identity of
  and not the location. Everything downstream therefore works untouched —
  `chipFor` reads `—` with no new word in the vocabulary, the stage opens, and the
  fed radio still writes a feed (a state write needs no OBS).
- **No eye on a catalog row.** There is no scene item to show or hide, and a dead
  control is worse than an absent one.
- **Ids are the PRE-SCENE form** (`scoreboard:1`) — which is also exactly what a
  legacy pin looks like, so a selection or pin made offline resolves to the real
  scene copy the moment OBS opens. Read-time resolution again; nothing rewritten.
- **`connecting` is not offline.** Scenes are empty then too, and swapping to the
  catalog for a third of a second reads as a glitch. The rack says "Connecting…".
- This is the one legitimate reader left for the **declared** board list
  (`scoreboards.active`): with no OBS there is nothing to discover boards from,
  and Settings genuinely knows the rig.

**The three OBS-independent affordances, in the three places a producer looks:**

- The **source strip's Bind slot becomes Copy URL** (`absoluteOverlayUrl`, same
  builder Bind uses, host-qualified against the origin already serving the
  console). It used to read a flat "OBS offline" — a dead end in the one place the
  panel exists to act, and wrong about the situation: a producer whose OBS is on
  another machine, or who uses another app entirely, needs exactly that string.
- The **Add picker opens with no scene** (`open` is a prop separate from `scene`).
  Copy URL and **+ New** container are fully live; Add alone is disabled and says
  why, holding its place rather than vanishing (same rule as the Push slot).
  Gating the whole picker on a scene is what made the container builder
  unreachable for anyone whose OBS wasn't up.
- **Messages name the real reason.** "Isn't in any scene we can see" is true
  offline but useless, and both ways out it named (the header's Bind, a scene's +)
  exist only with a connection — so `BindingNote` and the rail's quick faces
  branch on `useConsoleOffline`.

Payoff beyond the producer: the console is now testable and browser-verifiable
without an OBS mirror, which is why phase 3's container surfaces went unverified.

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
- **All three are always racked**, in a permanent section above the scenes.
  Desks used to appear one at a time, keyed to the phase they belonged to, and
  that rule always needed a special case — Live owned no desk, so the section
  stood empty — which was the tell that desks were never phase-shaped. A
  producer fixes a fixture or re-captures a game when they need to, not when a
  selector says they may. Desks carry no `phase` field and there is no
  `deskForPhase()`.
- Same panel contract as elements — desks may declare a quick face under the
  same rules (Capture's `select board + capture` fits; Match currently has no
  compliant face → `quickFace: null`, not pinnable).
- Deep authoring still defers to tabs: sets/bracket → Competition, board
  bindings → Match tab. Any future feeds-but-not-on-air workflow (bracket
  refresh, roster sync) is a desk, not a new UI invention.

## Adding a new element — checklist

1. Build the overlay Layout first (see `overlay-authoring` skill) — the console
   binds to its URL.
2. Register in `elements.js`: id, name, flavor, url/dims/match, and
   quick face (or accept the flavor default, or explicit `null`).
3. Write the stage body as kit rows in its own file under
   `src/routes/production/stage/`. No freeform JSX layout. **Do not write a
   show/hide row or a push button into the body** — the source strip in the
   panel header owns both, for every element.
4. If it needs settings beyond kit rows' reach, that's a signal they belong on
   a tab, not the stage.
5. Verify: rack row appears under the scene its source is in, with a working chip and
   quick action; pin → rail card renders the quick face within cap; selection →
   stage body; staging gateway honored (test with confirm-mode on).

## Persistence (all local UI prefs via `usePersistentState`)

- `prsh.ui.production.selection` — selected **placement** id.
- `prsh.ui.production.rail` — ordered array of pinned **placement** ids.
- `prsh.ui.production.scenes` — which off-air scene sections are expanded.
  Persisted because expanding is also what *mirrors* a scene: a producer who set
  up their Break section should find it live next load, not collapsed again.

There is deliberately **no** `prsh.ui.production.phase`. It existed and is gone
— see "Scenes are the grouping axis" below.

Nothing here belongs in server Settings — it's per-producer-browser workspace
layout, not broadcast config.

There is deliberately **no** `prsh.ui.production.board.{elementId}`. It existed,
and it was the bug — see Instances below.

## Instances — the board is part of the identity

`src/routes/production/instances.js` is now just the id grammar; discovery lives
in `placements.js` (above). An element is a TYPE ("Scoreboard"); an instance is
one of that type on the broadcast ("Scoreboard on board 2"). A `scope: 'board'`
element is URL-scoped (`?scoreboard=N`), so two of them are two independent
things with their own source, air state and settings.

- **Instance id is `{type}:{board}`**, or plain `{type}` for a global element;
  a placement appends `@{scene}`. Desk ids (`desk:match`) share the colon and
  must not parse as instances — the board suffix is always DIGITS, which is what
  keeps the namespaces apart. Don't introduce a numeric desk name.
- **The board is not the only axis.** `?team=`, `?size=`, `?dir=` and `?port=`
  each make two sources of one overlay two different things, and they are read
  straight off the URL for ANY element — registered or generic — as a `~` variant
  tag (`roster~t1`, `scoreboard:2~zs`). They are the layout catalog's own variant
  rows (`layouts.py`), so the producer already chose one when they picked
  "Stats — Team 2" in the Add picker.
  The two axes are deliberately asymmetrical: **board** is declared (`scope:
  'board'`) and is the only one with a documented default (no param = board 1),
  so it keeps its bare-number suffix; everything else is discovered. A URL naming
  no variant yields exactly the id it always had, which is what keeps
  pre-variant selections and pins resolving.
  This is not bookkeeping: the team-variant layouts (roster, stats, teamlogo,
  playername) are **unregistered**, so both sides row through `genericElement`,
  which keys on the pathname. Without the variant, team 1 and team 2 are one id —
  duplicate React keys in the rack and `resolvePlacement`'s `find()` handing the
  left-side panel the right-side source. The same split holds for a REGISTERED
  element with a variant: **Controller** is a registered element (its stage owns
  the gc-overlay subprocess) whose `?team=` per-side-follow sources row as
  `controller~t1` / `controller~t2` off the variant axis.
- **Nothing derives a board on its own.** It used to be a hidden per-element
  preference each surface resolved separately, which meant a two-board rig had
  ONE rack row silently commanding whichever board a stored value named, and a
  panel whose rows and header strip could point at different boards. A board
  *picker inside a panel* is that bug coming back — switching board means
  selecting the other rack row.
- **Feed-scoped elements never get instances.** Their container is
  board-agnostic and the board rides in the pushed payload (see the two-board-
  mechanisms note in `elements.js`).
- **Name the detail only when there's more than one INSTANCE** of that element —
  counted distinctly, not per placement. The detail is the board alias, the
  variant ("Team 2", "Small"), or both. One board's scoreboard in three scenes is
  still one thing to tell apart from nothing, and the section header already says
  which scene the row is in. `usePlacementLabel` returns `{ name, detail }`; the
  rack, stage and rail all render that one answer.

### Stored ids are RESOLVED, never rewritten

Selection and pins outlive the boards and scenes they were written against, so
`resolvePlacement` (see "Scenes are the grouping axis") answers what a stored id
means *today* rather than rewriting storage. Resolving at read time costs a
lookup and cannot be wrong for longer than a render; a one-shot migration would
have to run before the OBS mirror and settings load — precisely when the list is
least trustworthy — and would destroy the producer's pin if it guessed wrong.

Pins are **acted on as stored** (reorder and unpin address the producer's array,
so a legacy pin stays removable) but **rendered from what they resolve to**.
`togglePin` compares by resolved target, so a legacy `scoreboard` and a new
`scoreboard:1@Game` can never sit on the rail as two cards for one source. New
pins are written canonical, so a rail converges as it is used.

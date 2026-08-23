# The element contract

> Reference for `production-console-contract`. Load when adding an element, changing how one registers, or touching flavor / container membership / quick faces.

## The element contract

Every broadcast element registers in `src/routes/production/elements.js` with:

```js
{
  id, name,
  flavor,           // 'direct' (owns a dedicated source) | 'fed' (no source of
                    // its own — a container is the only place it can go)
  url, width, height, match(url),   // OBS source binding — unchanged from today
  quickFace,        // ≤ 2 kit rows, or explicit null (see rules below)
  stageBody,        // full controls — kit rows / labelled kit columns
}
```

**FLAVOR IS THE FLOOR; THE PLACEMENT IS THE ANSWER** (`placementFlavor` in
`placements.js`). Being fed is a property of WHERE a source is, not of what an
element is: a member sitting on a container's roster rows under that container
and pushes into it, and that same element's own dedicated source rows on its own
and just shows and hides. Both are true at once for a member that owns a source
— true for every element that owns a source, since being hostable is read off
the mount registry (`container-members.js`) rather than declared here. So
`flavor` answers only "does it own a source
of its own", every surface branches on `isFedPlacement(placement)`, and an
element declared `fed` (Stats, Stat Card) has one possible answer, which is why
the floor still earns a name.

That split is the whole point: the Character Spotlight used to be fed-ONLY,
on the reasoning that it shares the Callout Stage with the Game Summary — so an
element no roster claimed had nowhere to go at all, and its panel offered a Push
into nothing plus a paragraph explaining why. Sharing is what a container is
FOR, not what an element is. A producer who wants the two callouts mutually
exclusive puts both on one container's roster, which is the sentence that
arrangement is supposed to mean.

### The subject — what the element is DRAWING

`src/routes/production/subject.jsx`. Every other row in the console answers
*what can I do to this*; the subject is the one that answers *what is this
showing*. Before it, a panel could describe a source completely — its OBS name,
its scene, its air state, its transport verbs — and never once say what was on
it, and a panel titled "Roster · Side 2" could not tell a producer whether side
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
  deliberate exception is an element with a PICK, whose subject is the standing
  intent and says so — and says it in the tense of the row: on a slot it is what
  Push *would* show, on the element's own source it is what the overlay is
  already drawing, because that source renders `production.feed.last.{id}`
  itself. **A suggestion is not a pick**, and only the direct row can tell them
  apart: `resolveIntent` proposes when there is no memory, which is exactly
  right for "what would Push show" and a lie beside a source drawing nothing —
  so a direct row reads `Nothing picked yet · Mario suggested`. If you want to
  show a configured value, that is a stage row.
- **Dispatch is by COMPONENT, not a map of hooks** (`SUBJECTS`), same as
  `ELEMENT_QUICK_FACES` and `STAGE_BODIES` and for the same reason: choosing a
  resolver by id would be a conditional hook call.
- **Resolution runs most-specific, then by SHAPE**: a declared subject → container
  → container-scoped member → an element with a pick → board scope → team
  variant → nothing. The `containerScoped` branch is gated on the row being a
  **slot** because **Roster is both** a container member and a direct element
  with its own `?team=` source: a slot draws off the container's frame of
  reference, the element's own source off its URL's, and an ungated check handed
  the Roster's own source the container's side and drew the wrong one. (The gate
  used to read `flavor === 'fed'`, which said the same thing back when only a
  fed element could row under a container.)
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
  note and the post-game box score were each a hand-rolled subject in a stage
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
  optional `template` for an asymmetric split, and `KitColumn` takes a `subject`
  that rides its header rule beside the label — for a region whose whole state is
  one line (the board's `Games`: transport badge + playback sentence), which
  otherwise spends a 28px row and a gap restating what the eyebrow introduces.
- **A nested column cannot use a container query to size itself.** The
  `@container` is `PanelShell`'s body, so `@4xl:grid-cols-3` inside a half-width
  column still fires on the *panel's* width and squeezes each cell to a third of
  half. Give the child an explicit prop and let the caller — which knows how wide
  it is — pass it (`GameFilters columns={3}`). Two bugs came from ignoring this:
  a three-across filter row at 179px per field, and before it a `@5xl` gate that
  never fired at all because a 1600px window only gives this body ~970px.
  **Measure the panel; never reason from the window.**
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
  captain grid, port select, and format field (Bo + series stepper), and the
  board desk's mirrored **Game State** grid (see "A board is a desk"). Adding a new
  custom block is a design decision, not a convenience — it should stand out in
  review.
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
  containers, so they never match and keep 64. Same reason `SettingGroups` adds
  columns as the panel widens (`@3xl` → 2, `@6xl` → 3) — a stage panel is wide,
  and one column of label-plus-control is most of what "sparsely populated"
  meant. **A column count is a budget too, and it has to be re-measured at the
  window a producer actually runs.** A settings row is a label plus one control
  — 238px for a number, 240px for a chip strip — so a column past ~340px is
  spending the rest on nothing: two columns were right for the ~950px panel they
  were written against and wrong at 1394px, where they were 675px each and the
  median row stranded 437px.
- **A run of one is not a set** (`chunkDefs`). A lone part toggle takes the label
  column so it lines up with the rows around it; two or more pack into a strip,
  which is what the strip is for. The rule this replaced promoted **every** chip
  in a region the moment **any** switch in it owned a text field: written for the
  Scorecard's Top bars (one unpaired toggle among two paired ones), its cost
  scaled with the loners, and the Event Header's Bottom band — one pair plus
  three field toggles — turned a single 34px strip into three 128px chips on
  three rows. The tell was that the Bottom band rendered four rows taller than
  the Top band while modelling the identical thing.
- **A control states how much it expects.** `TextRow`'s `short` (`short: true` in
  `LAYOUT_SETTINGS`) sizes the input to its content for a value that is a glyph
  or two — the Event Header's field separator, which otherwise drew a 675px box
  around `◆`. Same reason `NumberRow` has always been a fixed `w-20`. And a
  **segment label is one word**: a segmented control divides its row between its
  options, so it gets whatever the column leaves after the label gutter divided
  by three (~82px at two columns). "None (transparent)" and "Soft Scrim" both
  wrapped to a second line and broke the 28px rhythm — the adjectives were
  describing, and `description` is where describing goes. `SegmentedRow`'s
  `fill` is the same question one level up: it stretches for a segmented that is
  the **subject** of what follows it (the plates mode, a lower-third slot's
  type) and sizes to its options for **one value among a list of them**, which
  is every overlay style setting. Stretched, the Event Header's set-once Band
  Background was the widest and loudest control on a panel of quiet knobs, with
  its chosen segment an inch from the label naming it — inverted prominence, in
  the group the registry ranks last on purpose.
- **A settings panel is a scale model of the element it configures.** A def may
  carry a `group` in `LAYOUT_SETTINGS`, and a group is a **visible region of the
  overlay** — "Top band", never "Switches" or "Geometry". `OverlaySettingGroups`
  renders them in the order they first appear in the registry array, which is the
  order they appear on screen; `groupDefs` collects by name rather than by
  consecutive run, so a filtered-out def can't split one region into two. The
  Scorecard is the reference (three regions, no Style section left). Ranking is
  by ORDER — the set-once group sits last — and groups are **always open, never
  accordions**, same rule as the Lower Third's five columns.
  `OverlaySettingRows` stays flat on purpose: it also builds rail quick faces,
  where a group eyebrow would blow the two-row cap.
- **A "both regions" group is where a conflation hides.** One `showEvent` switch
  in the Event Header's *Both bands* group gated the competition name in the top
  strip AND the event name in the bottom one, so neither could run without the
  other — the group name read as a legitimate scope while it was really two parts
  sharing a key. Split, each sits in the strip it draws in, and the shared group
  is what it should always have been: look and geometry, no part toggles at all.
- **A LIST IS NOT A ROW OF SWITCHES.** When the producer's question is *what is
  in this thing, and in what order*, the model is an ordered list and the panel
  is a picture of it — not one boolean per part with the order hardcoded
  somewhere else. The Event Header was seven `show*` switches in registry order
  while the order they DREW in lived in the overlay's own render call, so a
  producer could hide the location and never put the dates first, and only one
  of the seven fields had any text of its own. Its bands are
  `overlays.eventheader.bands.{header,footer}` now — ordered arrays of
  `{id, on, text}` (`src/routes/production/eventheader.js`,
  `EVENTHEADER_FIELDS` in `server/settings.py`) — authored as two Lower-Third
  ribbons on the stage. Three rules came out of it:
  - **The override is the same field for every entry.** `text` beats the source,
    blank falls back to it, which is what makes `message` stop being a special
    key: it is simply the entry with no source. A per-field "…Text" setting
    beside a per-field switch is the shape to distrust.
  - **Both bands live under ONE settings key.** Moving a field across is one
    edit to two arrays, and two staged entries could be confirmed apart, leaving
    the field in both bands or in neither.
  - **A field in no band is unreachable**, so the census self-heals at both ends
    — the server appends a missing field to its default band on every Load, the
    client normalises the same way on every read, and unknown or duplicated ids
    are dropped. Pinned across the three runtimes by `eventheader.test.jsx`.
- **A field only THIS overlay reads is a setting, not a fact.** The Event Header's
  banner line was `tournamentInfo.message` — the one field in that namespace no
  other surface read — so the line a producer retypes mid-broadcast was authored
  two tabs from the panel that draws it, with no preview and no staging. It is
  the message field's own `text` now, on the panel that draws it. Ask which
  surfaces read a value before deciding where it is authored; several means the
  tab, one means the element.
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
  A type is gated only if `THEME_ELEMENT` names its theme file.
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


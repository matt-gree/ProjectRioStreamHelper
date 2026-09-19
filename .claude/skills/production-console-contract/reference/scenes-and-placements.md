# Scenes, placements & instances

> Reference for `production-console-contract`. Load when touching placements.js, rack sections, row identity, or the board/variant/slot axes.

## Scenes are the grouping axis

`src/routes/production/placements.js`. A **placement** is the console's row
identity, and it is the third and last term in a chain the console converged on:

| | is | keyed |
|---|---|---|
| **element** | a type — "Scoreboard" | `scoreboard` |
| **instance** | + which board, variant, or container SLOT | `scoreboard:2`, `roster~t1`, `statscard+roster-stats-2` |
| **placement** | + which scene's copy | `scoreboard:2@Break` |

The **slot** half (`+{container}`, `slotInstanceId` in `instances.js`) is what
keeps a member that owns a source from colliding with itself: its own source and
its place on a container are two rows of one element, and the bare id can only
spell one of them — duplicate React keys in the rack, and a panel driving
whichever `find()` reached first. Read out before the board and variant axes, so
`statscard+roster-stats-2` is still the `statscard` element.

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
- **A scene row's trash is the section `+`'s inverse** (`PlacementRemove` in
  `rack.jsx` → `removeSourceFromScene`). Same `RowRemove` the `BOARDS` tier uses,
  same treatment: **visible at rest**, last on the row, a confirm that states the
  consequence rather than asking whether you meant it. Three things it must keep
  doing:
  - **`RemoveSceneItem`, never `RemoveInput`.** A placement is one scene's copy;
    removing the Game copy must leave the Break copy alone. OBS reference-counts
    inputs, so the last scene item takes the input with it on its own.
  - **The note branches on the census** (`useOtherScenesWith`), because the only
    real cost is the hand-set OBS transform, and it is only paid on the last
    copy. **The mirror is lazy**, so "no other scene has it" is honestly "none we
    can see" until every scene is mirrored — the confirm hedges rather than
    promising a producer they are deleting a spare.
  - **NO TRASH ON A FED ROW.** A member's `item` is the *container's* scene item,
    so a remove there would delete the container out from under the whole roster
    while appearing to remove one member. The row keeps the empty column (pins
    stay in one line); roster membership is the container panel's.
  It stages under its **own key** with no `liveValue` — a removal is not a
  two-state control, and sharing visibility's key made a hidden source's removal
  `value === liveValue`, which the buffer discarded as a change that cancelled
  itself out.
- **Members are NOT discovered from sources, and they NEST under their
  container.** Character Spotlight and Game Summary can share one Callout Stage
  source; a source→row scan alone would collapse two separately-driven elements
  into one row. The container is what's really in the scene, so **it** takes the
  row — always, targeted or not — and every member on its roster rows underneath
  (`parent` + `slot` on the placement, a left rule + radio in the rack).
  **Every** member, including one that also owns a source: leaving those out
  meant the rack disagreed with the roster the container's own panel listed,
  with no row to push them from. And nesting is a read of THAT container's
  roster (`membersOf`), never the inverted element→container map — the inverted
  read answers with the first container claiming an element, which left a
  mirrored pair's second container rowing empty.
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
  browser source exists yet. **A CONTAINER takes the same fallback**, and it has
  to be spelled separately because a container is not in `ELEMENTS` — its element
  is synthesised from the definition, so `resolvePlacement` takes the defs and
  re-synthesises it (`CONTAINER_PREFIX`). Without that branch, deleting a
  container's browser source made the container unreachable: its own panel is the
  only place its roster, resting occupant, scope and rules can be edited, and none
  of that needs a source — while closing OBS *entirely* brought it back, because
  the catalog tier synthesises the same row.

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
- A member's SLOT has no source of its own: its row's source IS the container,
  so `previewUrl` returns the same URL for every member of one container and the
  container draws whichever occupant is fed. It therefore appends
  **`?feed={elementId}`** (a slot asks for itself; a container row asks for
  `placement.carrying`), which the shell passes to `initFedContainer` as
  `forceElement`, overriding the element only — board and content still come
  from the live feed. Preview-only: on air there is no `?feed=`. The element's
  OWN source names nobody: it is not a container, and `?feed=` there would be a
  param its layout never reads.

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
  hand-editing settings. `isSharedMember` in `containers.js`.
- **A MEMBER'S FRAME OF REFERENCE IS ITS CONTAINER'S, and there is one hook that
  says so**: `useMemberScope(element, placement.slot)` (`containers.js`) — the
  row's container when it has one, else the roster that claims the element, else
  board 1 / side 1 (the same default `_scope_of` takes server-side). *Every*
  surface that asks a member anything asks through it, because the two ways of
  guessing are both wrong on a mirrored pair: a lookup from the element
  answers with whichever roster comes first (which is how the rack's fed radio fed
  the left container from the right container's rows, while the row's chip — which
  reads the placement — disagreed with its own radio), and a hardcoded board 1
  made the pickers list board 1's roster for a container scoped to board 2 and arm
  a board-1 pick that Push then sent into it.
- **A container-scoped member has NO INTENT, and the memory must not be replayed
  as one.** Its Push payload is built from the container's scope
  (`useContainerPush`), but `useFeedControl` records every feed at
  `production.feed.last.{element}` and `resolveIntent` replays a remembered
  payload verbatim for any feed with no `FEED_INTENT` entry — which is every
  scoped member. So the FIRST Stat Card push anywhere used to fix its board and
  side forever: push it left, then push it right, and the right-hand container
  drew the left side; re-pointing a container's Board picker changed nothing.
  Scope wins, always (`hasIntent` is gated on `!element.containerScoped`).
  `feeds.test.jsx` pins all three.
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
  element, plus anything with a `container-members.js` entry — which is now
  every element that has a mount, the hit visualizer and
  both post-game callouts own a dedicated source AND can be stood up in a
  container. It is the console's half of a fact `fed-container.js` also holds
  (the mounts it can stand up); `containers.test.jsx` pins the two together
  until the mount registry makes them one list.
- **The container id comes off the URL the same way in both runtimes**:
  `?container=` and nothing else (`containerId` in `elements.js`, the shell's
  own param read in `container.html`). The pre-2.0 named shells and their
  filename-stem fallback are deleted; a URL naming no container is not one.
- **The id is never all digits** (`containerIdFor`). A container's row id is
  `container:{id}` and `parseInstanceId` reads a colon-plus-DIGITS as the board
  suffix. A container really is an element, so it has no way out of that rule —
  unlike a desk, whose ids are exempted by prefix.
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
- **The BOARD is asked FIRST, once, by a tab across the full width** (`BoardTabs`,
  above both the list and the preview, because it scopes both). A producer
  building a scene thinks "what does board 2 need", so the tab's board is what
  every board-reading row's box answers for, and what the preview draws. The
  list under a tab is that board's elements, then a **Show-wide** rule and every
  row that reads no board, the same under every tab. Each tab names the board
  (its alias) and what is on it, and counts its picks, so a batch spread across
  tabs is never out of sight; the row itself notes the OTHER boards it is picked
  on (`boardsNote`, "also 2") and the tray chip names its board and clicking it
  switches tab. Unticking takes back only the tab's pick. The picker **opens on
  the scene's board** (`sceneBoard` — the board with the most explicit
  `?scoreboard=` sources in the scene; board-less sources say nothing), and
  `in scene` answers per the tab's board. A single-board rig draws no tabs and
  one list. This replaced a per-row "Add for" strip beside the preview, which
  asked the board one row at a time and never showed a board's set as a set.
  Two registry flags refine which tab a row lands on, both picker-only:
  **`showWide`** (`picksBoard`) files a board reader that is chrome for the whole
  show — the Event Header, which reads a board for its Round alone — on the
  Show-wide shelf, added naming no board (board 1 by default; the stage's Board
  row still re-points it); **`rotatingOnly`** (`offeredOn`) lists the Results
  Ticker only under a board that is actually rotating (`useRotatingBoards`, the
  same rule as `useMatchBindableBoards`), because the pool is all it draws. The
  Controller stays under a board: it follows a side's port on that board.
- **Look, then choose: the FIRST click on a row previews it, the SECOND selects
  it.** Browsing the catalog is what a producer does most in here and it must
  not quietly build a batch, so one click is always the cheap, reversible act —
  but a second click on the row *already being previewed* is a deliberate repeat
  rather than a browse, and by then the producer has seen the thing. It is the
  same two beats the keyboard has (↑↓ look, ⏎ choose), which is what makes it
  learnable. The count is per ROW, not per click: leaving a row and coming back
  previews again, or a producer who browsed a list and returned would select
  whatever they happened to look at twice. Deselect is that same click again and
  it KEEPS the preview — focus and check stay different questions, so unchecking
  never also takes the frame away. The checkbox is unchanged and still selects
  in one click from anywhere in the list.
- **A disabled Add has to say what would enable it, IN VIEW.** Previewing a row
  is not selecting it, so a producer can reach a full preview, a named scene and
  a dead Add with nothing joining them up. The footer line states it ("tick a
  box") and the Add tooltip phrases the same condition as the act. The visible
  footer line is the primary channel: a tooltip on the greyed control is
  reachable only by hovering the thing already read as dead.
- **A per-side pair is ONE row** (`pairRows`): Stat Bar, Stat Card, Roster,
  Player Name, Team Logo and Controller fold their side 1 / side 2 catalog rows
  into one, because both sides is the usual answer. The row's box takes both
  (`aria-checked="mixed"` while one is in; from mixed it completes the pair). A
  plain-text toggle per side at the row's end takes one side alone and previews
  it — shown on hover, on the previewed row, and while one side alone is in,
  held with `invisible` at rest so nothing moves; bordered chips on every pair
  read as a wall of badges. A pair with one side already in the scene says so
  in words (`Side 1 in scene`), never a dot. The arrows stop on the pair once.
  **Picks stay per side** — each side is its own source, name and URL — so Add
  and naming are untouched; only the tray folds back (both sides for one board
  = one chip, whose × takes both). Side toggles use the producer's side words,
  never a bare digit, which in this dialog would read as a board.
- **Within a shelf the cards lead** (`rowRank`): the Scorecard shares the
  Scoreboard shelf rather than heading one of its own, and the scoreboard sizes
  and the scorecard sort ahead of the per-side rows from the same folder.
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
- **Adds HIDDEN by default**, like every Bind path in the console. Adding a
  source is setup; the rack row's eye is the one deliberate act that puts it on
  air, and ⌘⏎ stays bound to the hidden add so the reflex commit is the safe
  one. **Add visible** sits beside it as a second button for the other half of
  the job: before a stream there is no broadcast to protect, and a producer
  laying out a scene has to SEE what they placed rather than add five sources
  and then hunt five eyes in the rack to find where they landed. Two buttons and
  not a default, because the only thing that tells the two cases apart is
  whether the show is live — which the console cannot ask, so the producer
  answers by pressing one or the other. Hidden keeps the filled button; visible
  is the outline.
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


## Instances — the board is part of the identity

`src/routes/production/instances.js` is now just the id grammar; discovery lives
in `placements.js` (above). An element is a TYPE ("Scoreboard"); an instance is
one of that type on the broadcast ("Scoreboard on board 2"). A `scope: 'board'`
element is URL-scoped (`?scoreboard=N`), so two of them are two independent
things with their own source, air state and settings.

- **Instance id is `{type}:{board}`**, or plain `{type}` for a global element,
  or `{type}+{container}` for a member's slot on a container; a placement
  appends `@{scene}`. Desk ids (`desk:match`, `desk:board:2`) share
  the colon and must not parse as instances — `parseInstanceId` returns them
  whole, guarded on the `desk:` prefix. That guard is load-bearing: the pattern's
  head is greedy, so before it every id ending in digits split (see "A board is a
  desk").
- **The board is not the only axis.** `?team=`, `?size=`, `?dir=` and `?port=`
  each make two sources of one overlay two different things, and they are read
  straight off the URL for ANY element — registered or generic — as a `~` variant
  tag (`roster~t1`, `scoreboard:2~zs`). They are the layout catalog's own variant
  rows (`layouts.py`), so the producer already chose one when they picked
  "Stats — Side 2" in the Add picker.
  The two axes are deliberately asymmetrical: **board** is declared (`scope:
  'board'`) and is the only one with a documented default (no param = board 1),
  so it keeps its bare-number suffix; everything else is discovered. A URL naming
  no variant yields exactly the id it always had, which is what keeps
  pre-variant selections and pins resolving.
  This is not bookkeeping, and it is deliberately **not gated on registration**:
  an unregistered team-variant layout rows through `genericElement`, which keys
  on the pathname, so without the variant team 1 and team 2 are one id —
  duplicate React keys in the rack and `resolvePlacement`'s `find()` handing one
  side's panel the other side's source. Registering changes nothing: Stats,
  Roster, Controller, Player Name and Team Logo are all registered and all read
  their `?team=` straight off the URL, rowing as `roster~t1` / `roster~t2`.
- **`?team=` is the one variant whose LABEL is a preference.** It names a side,
  and what the console calls a side is `production.side_labels`
  (`../sides.js` — Side 1/2 by default, Left/Right or Top/Bottom by choice), so
  `variantLabel` and `rowLabel` both take the mode. The rack row and the stage
  panel name the same source; letting the row say "Team 2" beside a panel headed
  "Right" is two spellings of one fact. `?dir=` is the control case — it names
  which way the artwork points, so it keeps its literal words.
- **Nothing derives a board on its own.** It used to be a hidden per-element
  preference each surface resolved separately, which meant a two-board rig had
  ONE rack row silently commanding whichever board a stored value named, and a
  panel whose rows and header strip could point at different boards. A board
  *picker inside a panel* is that bug coming back — switching board means
  selecting the other rack row.
- **A container slot takes neither identity axis.** The container is
  board-agnostic and the board rides in the pushed payload (see the two-board-
  mechanisms note in `elements.js`) — a slot is keyed by its container and
  nothing else. That board comes from the container's own SCOPE
  (`def.scoreboard`) for every member, not just the scoped ones: a slot has no
  board of its own to read, so the container's frame of reference is the only
  thing that knows which board it is looking at.
- **Name the detail only when there's more than one INSTANCE** of that element —
  counted distinctly, not per placement. The detail is the board alias, the
  variant ("Side 2", "Small"), or both. One board's scoreboard in three scenes is
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

# Desks — non-element workflows

> Reference for `production-console-contract`. Load when touching the board desk, the Match desk, or adding a desk.

## Desks — non-element workflows

Things that **feed the broadcast but aren't on it** (no OBS source, no air
state). Today: a **board** desk per active scoreboard, and the **Match** desk
(fixture authoring — sides, format, series, board binding, start.gg load, and the
series lifecycle: flip · decide · reopen).

**WHAT EARNS A DESK — a GLOBAL workflow with no other home.** Stated as a test
because the tier grew two rows that failed it, and "feeds the broadcast but isn't
on it" alone will grow them back:

- **Board-scoped work is a REGION on the board panel, not a desk.** The Capture
  desk's own first control gave it away — a `Board` picker, on a console whose
  rack has already asked which board you mean. Everything it touched was
  `postgame.{N}.*` keyed to one board's `score.{N}.game_id`, which is exactly
  what makes Games and the running order regions. It is `../postgame` now,
  rendered as the board panel's last `KitColumn`.
- **A control both of whose consumers already carry it is not a workflow.** The
  Bracket desk was a third copy of a phase picker that the bracket source's stage
  and the lower-third's bracket slot both already rendered — from the same shared
  hook, which is what made the duplication invisible. It lives on the source that
  draws it (`stage/bracket.jsx`), with the hook shared from `./bracket.jsx`. The
  reachability objection ("with OBS connected the rack lists only what's in a
  scene") does not hold: the rack lists **every scene's** sources, and with OBS
  closed the catalog tier lists every element outright.

Rules:

- One entry per desk in `DESKS` (`rack.jsx`), a body in `DESK_BODIES`
  (`production.jsx`), and — when pinnable — a face in `DESK_QUICK_FACES`
  (`quickface.jsx`). All three are checked against each other in
  `rack.test.jsx`; adding a desk means adding all three.
- They live in the rack's **two permanent tiers above the scenes** — `BOARDS`
  (the rig) then `DESK` (the three workflows), both a faint red wash with the
  `DESK` chip — a row with live meta (`M1 · 1–0`, `empty`/`captured`, the loaded
  phase), dimmed when idle, selectable like any row. Never in the state sections.
  Rack meta must read from state only: the rack draws every frame and must not
  fire a desk's own fetches.
- **The two tiers collapse, and the stored key names the SHUT ones**
  (`useShutTiers`, `prsh.ui.production.tiers`) — the inverse of `useOpenScenes`.
  A scene defaults closed because there can be a dozen and opening one is what
  mirrors it; a tier defaults **open**, so the empty list a first-run producer has
  must mean both open. Store what was closed, not what was opened.
- **A rack row's meta is ONE fact, at the house length** (`no match`, `captured`,
  `M1 · 0–0`). 278px already carries a chip, a name and a pin, so a third or
  fourth clause truncates mid-sentence and pushes the pin off the edge — that is
  what `HUD · Alice 3–2 Bob · Bot 5` did. Ask what the stage panel already says
  and drop it: transport is on the badge, the inning is in `BoardGameSubject`.
  The row keeps only what is nowhere else at a glance.
- **A board row carries its TYPE, and a type is not a status.** `boardTypeTag`
  compresses the two axes to the three states they actually produce — `HUD` ·
  `API` · `ROTATING` — because HUD + rotate is not a real one. It is
  **colourless** on purpose: the rack's hues are spoken for (emerald AIR, sky
  PVW, rio DESK), and the stage panel's green/blue transport badge repeated in a
  dense row would read as a second air state. Right-aligned, so the tags stack
  into a column a producer scans without reading the names. **ROTATING, never
  "rotator"** — a Rotator is the standalone layout group (the results ticker);
  one shared word on the app's most-read surface is how the two get conflated.
- **The budget is 176px, measured, and a BOARD ROW SPENDS THE REST ON ITS NAME.**
  A row leaves name + meta 176px (278 − 16 padding − 36 chip − 24 gaps − 19 pin
  and trash) ≈ 27 characters at `text-xs`; an element row, with no trash, gets
  ~203. A board row's summary was the one that could not live inside that:
  `Scoreboard 4` + `JustAGrump 6–7 Dyla81` measured 218px, and the widest case
  was the most interesting one — a live game between two real usernames. So the
  board row is the board's NAME (its alias, or `Scoreboard {N}`) and nothing
  else; `useBoardDeskRow` keeps only the dim, which costs no width and is the
  monitoring half a truncated sentence served worst. Everything the summary said
  is on the board's panel at full length, one click away. Don't reintroduce a
  meta here: the next long username puts it straight back over the edge.
- **A placement's detail is a QUALIFIER, never a repeat of the name above it.**
  An unnamed board contributes its number (`useBoardTag` → `B1`), not the default
  `Scoreboard {N}` alias, which read as "Scoreboard · Scoreboard 1 · Medium". A
  producer-chosen alias is kept — they wrote it to mean something.
- **The DEFAULT variant names itself whenever its siblings are on screen**
  (`variantLabelFor`). It carries no variant tag — a source with no `?size=` *is*
  the default size, and its instance id must stay bare — but printing no label
  left a Small, a Medium and an unnamed row, so Large existed and nothing said so.
  The name comes off the element's `sizes` table; the id is untouched. The Add
  picker has always named it, so this is the row agreeing with what created it.
- **List order must not carry resolution meaning.** The catalog used to emit the
  default size FIRST so a bare pin (`'scoreboard'`) resolved to it, which listed
  the board as Large · Small · Medium. `resolvePlacement` prefers the canonical
  (variant-less) instance outright now, so sizes list in declared order. If you
  find yourself ordering a list to make a lookup work, fix the lookup.
- **An empty count prints no number.** `rotating · 0` and `0 in pool` read as a
  count that failed rather than as nothing yet; say `rotating` / `nothing in its
  pool yet` instead. Same rule in the rack meta and in `playbackLine`.
- **Desks are always racked**, in a permanent section above the scenes, and the
  `DESK` header carries **no `+`** — the fixed desks are fixed. The one it used
  to carry added a *board*, which is the tell that split the tiers.
  Desks used to appear one at a time, keyed to the phase they belonged to, and
  that rule always needed a special case — Live owned no desk, so the section
  stood empty — which was the tell that desks were never phase-shaped. A
  producer fixes a fixture or re-captures a game when they need to, not when a
  selector says they may. Desks carry no `phase` field and there is no
  `deskForPhase()`.
- Same panel contract as elements — desks may declare a quick face under the
  same rules. `DESK_QUICK_FACES` is **empty today**: Match's dense fixture
  authoring has no compliant face (`pinnable: false`), so every pinnable desk
  card is a board, resolved from the id by `deskQuickFace` rather than declared.
  The map stays as the registration point a future desk uses.
- Deep authoring still defers to tabs for **loading an event → Competition**
  only. The Match tab is **gone**: fixtures are the Match desk and a board's games
  are its own panel. A future feeds-but-not-on-air workflow is a desk only if it
  passes the test above — otherwise it is a region on the thing it is scoped to,
  or a control on the source it drives.

### The Match desk owns the whole fixture

`src/routes/production/desks/match.jsx`. Fixture authoring used to exist twice —
here as a single-open accordion and on the Match tab as a stack of fully-expanded
cards (`MatchPanel`), with different controls on each. `MatchPanel` is **deleted**;
so is `ScoreControls`, whose Game State panel the board desk's corrections
replaced, and `PoolBrowser`, whose pool/playback authoring is now the board's own
`GamesSection`. **The Match tab, its route and `src/routes/scoreboard_manager/`
are gone** — `/scoreboard` renders the console so an old bookmark still lands
somewhere, and the conflict banner's "Go to board" selects the board's desk.

- **The four verbs that were only on the tab.** Flip sides, Decide, Reopen —
  ported. **Retire is not**, and this is the interesting one: it looped every
  bound board unbinding each, and a match can only hold **one** board now, so
  retiring *is* clicking the lit bind chip. What was missing was a chip that said
  so, not a button (see `BindChip`'s bound tooltip). Delete a verb when the
  invariant that justified it changes.
  The board desk's fixture slot unbinds too, under the **same `bind:{sb}` staging
  key** — that is not the deleted verb coming back, it is the one verb reachable
  from the second place the fact is shown. A producer staring at the wrong fixture
  on a board should not have to go find the match holding it.
- **`decidedSide` vs `clinchedSide` are two different facts.** `decided` is the
  *record* — server award arithmetic, or a producer force. `clinched` is
  *arithmetic* on the live series against the Bo need. They agree until the
  producer corrects the series with the steppers, and only then does the disagree
  case matter: 2–0 of Bo3 with nothing recorded. These were one function, so the
  header badged "Side N wins" off either — claiming a series the server hadn't
  recorded, with no way to tell which state you were in and therefore no verb to
  fix it. Badge on the record; offer Decide on the arithmetic; offer Reopen on the
  record; offer neither when there is nothing to record or undo.
- **Flip is icon-only in the header, not on the sides it swaps.** The sides grid
  hides its `vs` spine behind `@lg`, so a control mounted there disappears on a
  narrow panel — and the feedback for a flip is the collapsed row's own "A vs B",
  which is in the header already. Series wins travel with the player (server
  `flip_match`), so a 2–0 never silently becomes an 0–2.
- All three stage (`match:{m}:flip` / `match:{m}:decide`) — they re-project onto
  the bound board. Decide passes `liveValue: decided`, so Reopen-then-Decide
  leaves nothing pending, the same toggle-twice rule as every other staged control.

#### The stack IS the running order

- **`schedule.queue` is authored here** (`useQueueOrder` → queued matches in order,
  then anything unenrolled). It used to be authored inside the **Upcoming Schedule
  element's stage panel** — a ticker's settings — so tonight's running order was
  edited in a different place from the fixtures it orders, as a second list of the
  same matches free to disagree with this one. That panel is now display-only:
  heading, and each match's display time (which is per *match*, `scheduledAt`, so
  it follows a fixture when the order changes).
- **Position and its two verbs sit at the HEAD of the row**, before the chevron,
  because the number is this row's place in the list it is sitting in. Moving a
  match here moves it on the schedule overlay and changes which fixture a board's
  Up next offers — one fact, not three surfaces to keep in agreement.
- **Visible at rest, never hover-revealed.** Reordering is a scan-the-whole-list
  task and arrows that appear one row at a time under the pointer cannot be
  scanned. (Same rule that brought a board's Remove out of hiding.)
- **The position rides a labelled `role="group"`** and the digit is `aria-hidden`:
  a bare "1" between two arrows has no accessible name, so the group carries
  `Match {m}: position {n} of {len} in the running order`.
- **Membership is an icon toggle with the record's other actions**, because whether
  a fixture is part of tonight is a property of the record, not of its position.
  Creating a match **enrols** it, so this is normally the way *out* — a placeholder
  or a kept-for-reference fixture that should not reach the schedule overlay or be
  offered to a board.
- **…but it is not how a fixture GETS into a chosen order.** `MembershipControl`
  lives inside a fixture's own body: reaching it means creating the match, finding
  the row, expanding it and knowing the icon — a correction, at correction depth,
  which is right for moving something authored into the wrong order and wrong for
  the ordinary case of "the next Losers match". **Each order's heading carries a
  `+`** that creates into it (`POST /match?queue={qid}`), the same idiom as the
  rack's scene header, and with several orders the desk-level *New match* is
  removed — a create button that cannot name its order silently means the first
  one, which is the trap the `+` exists to close. A single-order rig draws no
  headings, so it keeps the plain button.
- **The second group's one line appears only when something is out of the order.**
  Normally everything is enrolled, and a divider announcing an empty group is
  furniture.
- Reorder and membership are **per-id calls** (`src/context/schedule.js`) — never
  send the whole list back; see the `match-binding-lifecycle` skill for why.

### A board is a desk

`src/routes/production/desks/board.jsx` + `boards.js`. A board feeds the
broadcast, is never on it, has no source of its own and persists for the whole
event — the desk tier exactly. What it is **not** is an element: pool, playback,
stats tag and transport belong to the **board**, so hanging them off the
Scoreboard's panel would give two board-scoped elements on one board two copies
of one pool, and a board that feeds only a ticker no row at all (rows derive from
sources).

- **The section is DERIVED from `scoreboards.active`**, which is finally the
  online reader that settings key never had — `instances.js` used to union the
  declared boards into discovery for the same reason and lost that reader when
  rows became source-derived. Boards row **first**: they are the rig, and the
  fixture and the capture both act on one — which is why capture is a region on
  the board panel rather than a desk of its own (see the desk test above).
- **BOARDS is its own section, and MEMBERSHIP is why.** A board is a desk in every
  way the stage cares about, but it is not a fixed workflow: there is one Match
  desk forever, while the rig has one to three boards the producer adds and
  removes. Racked under one header, that header's `+` could only ever add one of
  the two kinds beneath it — a control that applies to half its rows. If you are
  tempted to merge them again, the `+` is the thing that will be wrong.
- **Boards get rows; matches get a list inside one row.** Boards are bounded
  (one to three, permanent, a rig property); matches are unbounded and accumulate
  all night. A rack row per match is the Match tab's stacked-cards problem
  relocated.
- **RIG MEMBERSHIP IS THE SECTION'S; the stage panel owns the board's
  PROPERTIES.** The `+` in the `BOARDS` header adds (same rule as a scene's `+`:
  the affordance that brings a row into being lives in that section's header), and
  a per-row trash removes (`RowRemove` — **visible at rest**, muted until hover, after the
  pin, a confirm that states the *consequence*). The panel keeps the name, the
  wiring and the game state. Remove lived on the panel first and the producer
  could not find it: the verb that ends a row's existence was inside the row, four
  scrolls down. Adding it to the rack **and** leaving it on the panel would have
  been two ways to do one thing — still only one place to manage boards, it is just
  the right one now.
- **The last board's remove is disabled with the reason in its `title`**, not
  absent and not an error discovered by clicking. The rig always keeps one board
  (`DELETE /scoreboards/{id}` enforces it server-side too).
- **The id is `desk:board:{N}`** (`boardDeskId`), and `parseInstanceId` is
  explicitly guarded on the `desk:` prefix. The old rule — "a desk name must not
  be numeric" — was enforced by nothing but the names in use: the pattern's head
  is greedy, so any id ending in digits split, and `desk:board:2` would have
  parsed as element `desk:board` on board 2.
- **Rows, bodies and faces are RESOLVED for boards, not declared**: `useRigRows`
  (rack), `deskBodiesFor` (page), `deskQuickFace` (rail). Row components are
  chosen by kind (`BoardDeskRow` vs `DeskRow`) rather than by picking a hook from
  the row, which would be a conditional hook call — same rule as `SUBJECTS`.
- **The body answers three questions**: what is this board carrying (the live
  game via the shared `BoardGameSubject`, plus the bound match from the *board's*
  side), why does it look like that (`side_reason`, whose only previous frontend
  reference was the reset that cleared it), and how do I fix it.
- **THE FIXTURE IS A SLOT, NOT A SENTENCE** (`FixtureSlot`). One shape in three
  states, and the shape carries the state: **bound** = a solid holder with the
  fixture in it (id · the two players with the series between them · round and
  phase trailing); **waiting** = the same holder, dashed, holding a *ghost* of the
  fixture the take would put in it; **empty** = dashed and quiet, naming where
  fixtures come from. It replaced a line of prose that read "No match on this
  board" — a statement ABOUT absence, in the spot a bound match printed
  `Match 2 · Winners R2 · 1–0`, which never said who was playing. Two rules did
  the work: **dashed means unbound** is the console's existing vocabulary (the `—`
  chip), not a new idiom; and a take **never changes what is on air without saying
  what to** — which is now satisfied by the slot naming the fixture an inch from
  the button, rather than by cramming it onto the button's face, where it
  truncated at 60% of the row. A conflict tints the slot amber, matching the
  sentence beneath it.
- **The slot has an END-OF-MATCH state, and `decided` is what defines it — never
  `stage`.** A Bo3 sits at stage `post` *between games* and is still the current
  fixture (the rule `Schedule.not_waiting_reason` states once, asked here too), so
  the slot says both: `FINAL` with the loser dropped a tier when the series is
  decided, "between games" when a game has ended but the fixture hasn't. Only ONE
  server path unbinds by itself (`_retire_match_from_board` — a decided match plus
  a new game between *different* players), so on the ordinary end of a night
  clearing the board is the producer's move, and **both moves live in the slot**:
  a `UP NEXT · <fixture>` footer with the take, and the unbind. Taking the next
  needs no unbind first — `bind_board` overwrites `score.{N}.match`, so Put on
  board IS the handover. Before this, a finished fixture and a mid-series one
  rendered identically and the take was hidden behind an unbind you had to know to
  press first.
- **The slot UNBINDS**, from the board's side, staged under the **same
  `bind:{sb}` key** the Match desk's chips use — one fact, one staging entry, so
  confirm mode can never hold two entries disagreeing about what a board carries.
  It was Match-desk-only on the reasoning that a match fills one board so
  retiring *is* clicking the lit chip, which is true and still asked a producer
  looking at the wrong fixture ON THIS BOARD to go find the match holding it. No
  confirm dialog: it unbinds, it doesn't delete — the fixture keeps its series and
  goes back to the running order.
- **A ROTATING BOARD CANNOT HOLD A FIXTURE, on every surface that offers one.** A
  match encodes two fixed sides; a rotation has none. The server 409s both bind
  routes (`bind_scoreboard`, `take_next_match`) and `useMatchBindableBoards` is
  the single client statement of it — read by the Match desk's chips, the board
  panel's slot (which says *why*, rather than going quiet) and the **rail's quick
  face**, which read the queue without asking and so offered a pinned rotator a
  button whose only outcome was a red toast. The gate sits **after** the bound
  branch: a board switched to rotate while already holding a match still shows it
  with its unbind, because that is how a producer gets out of the state.
- **Corrections are correction grade.** Score, inning, count, stadium, home side,
  the two `rioName_override` identities, swap, reset. Per-character stat editing
  and manual runner/fielder placement that used to sit beside them were read-only
  under every real feed and are **deleted, not moved**. The roster came back, but
  as a **readout** — see below. Broadcast-visible writes stage under
  `board:{sb}:{field}`; the HUD re-read and the stats refresh are momentary; the
  alias is config rather than content, so it is immediate.
- **THE GAME STATE BLOCK IS A MIRROR** (`BOARD_GRID`) — a sanctioned Custom block.
  Side 1 down the left, the shared frame (the runs as a pair, then the inning,
  then the count) in the middle, side 2 down the right with its contents reversed
  and right-aligned, so each column runs outward from the score. Each side column
  is: name (the `rioName_override` picker) · a **Home chip** · MSB team + logo ·
  the roster. The producer is comparing this panel against a screen, and if left
  isn't on the left the comparison is a translation step — which is the very bug
  they're hunting. Two earlier attempts are the reason this is written down: kit
  rows in a label gutter made an instrument read as a settings list, and the Match
  tab's own panel ported verbatim gave two boxes labelled **P1/P2** in a 420px
  column with the names in a separate group below it. **Never re-abstract the
  sides to P1/P2** — a side's runs belong next to the person who scored them.
- **The roster is a subject, not a control.** Nine cells, captain ringed amber,
  superstars starred, nothing clickable, and the whole grid **collapses when the
  feed has given no characters** (nine "Slot n" placeholders on an idle board is
  nine rows of nothing). The lineup is what the deleted editor was actually used
  for; seeing it is correction grade, editing it never was.
- **Home is a chip on the side that has it**, not a two-way position picker.
  Which side bats last is a fact about a player, and "MattGree bats last" is the
  sentence being checked against the game. It is a choice between two sides, so
  clicking the side that already has it does nothing — it cannot be off. Both
  chips read "Home", so each takes `ariaLabel` (`ToggleChip`) to be nameable.
- **The columns are mirrored; the WORDS are a setting.** Side 1 down one column,
  the shared frame in the middle, side 2 down the other — that geometry is what
  makes a producer's check a glance instead of a translation step. The eyebrows,
  score-box labels and `sideReasonLine` all name the side through `../sides.js`
  (`sideLabel` standalone, `sidePhrase` mid-sentence), defaulting to the numbers.
  Hard-coding "Left" here is the worst place to do it: a producer checking a
  mislabelled board is comparing the panel against a screen, so a word that is
  wrong for their arrangement breaks the exact check they opened it to make.
- **The mirror takes the whole panel width; the wiring reads below it.** A lineup
  does not compress — beside a wiring column, nine character names truncated to
  "Dry Bon…", which is the one thing a roster readout exists to avoid. Under the
  divider: the board's two properties (stats game mode · name) as a single
  two-column row, then **Games** full width (see below).
- **The two properties carry no region eyebrow.** The rows already read `Game
  mode` and `Name`; a `THIS BOARD` label over them was a third label line stating
  nothing they don't — and giving them a 5-of-12 column so they could have one
  cost Games the width it needed *and* left ~300px of empty panel beside a tall
  stack of full-width fields. That emptiness is what made the surface read as too
  tall before anyone measured it.
- **Transport stays a readout** (`HUD`/`API` badge, derived from board 1 + the
  global HUD toggle). There is no per-board source selector and adding one is a
  regression, not a feature.
- **Transport and playback are TWO AXES, stated as two things.** The badge is
  where games come from (derived); `playbackLine()` beside it is how this board
  shows them (chosen — single or rotate). Do **not** flatten them into one
  "HUD / single game / rotator" list: that is what the Match tab did, and it makes
  *HUD + rotate* expressible when it is not a real state — board 1 under the HUD
  toggle is single by construction whatever its stored mode says, a rule
  `useMatchBindableBoards` (client) and `bind_scoreboard` (server) both encode.
  The desk both reads and **sets** playback now (`GamesSection`, ../games).

### Games: pool + playback (`src/routes/production/games.jsx`)

A board's games are authored on the board, and the surface is an **instrument, not
a settings list** — the shape `PoolBrowser` had on the Match tab, kept.

- **GAMES IS ITS OWN REGION and takes the full panel width**
  (`KitColumn label="Games"`), and the **mode segmented is full-width and
  full-size** — it is the subject of the region. Everything below it belongs to
  whichever half is selected. Choosing between one game and a rotating pool is the
  biggest decision made about an API board, and each half brings a real surface
  with it.
- **The transport badge and the playback sentence ride the region's header rule**
  (`KitColumn subject`, drawn by the desk), not a row inside the region. On a HUD
  board that header *is* the whole region — `GamesSection` returns `null`.
- **The rotator is two columns, because it has two subjects**: what is IN the pool
  (scope · filter · limit/dates) and how the pool PLAYS (cadence · transport ·
  status). Stacked they were seven full-width rows; side by side the region is
  ~250px instead of ~470px and the dead width goes with it. The filter stays
  **stacked** inside its half column and goes three-across only in the full-width
  single-game search — via an explicit `columns` prop, not a container query (see
  the nested-column rule above).
- **Measured, not estimated.** Every cut above came from reading real heights off
  the panel (`getBoundingClientRect`) — the readout row was 28px + gap, three
  stacked chip fields were 118px, a micro-cap `LIMIT` label made a 32px input a
  51px row. Estimates were out by 50px+ each time an estimate was trusted; the
  three-across-at-179px regression was one of them.
- **The split is by JOB, not by tempo.** On the panel: the mode, its scope, its
  filter, its timing, its transport, its status line, **and the game list you pick
  from**. Behind **one** dialog: the rotating pool's `Pool games` member list, for
  excluding — exactly the dialog `PoolBrowser` opened, and for the same reason
  (a long table you visit to prune, not to watch).
- **Why this is written down.** An intermediate version split strictly by *tempo*
  — steady-state as kit rows, everything browsable behind one dialog — and it lost
  three things worth naming, all in the same way:
  - the **mode** became `SegmentedRow label="Playback"` in a label gutter inside a
    shared column, which is how a demoted control reads as a minor setting;
  - the **live game list** went behind `Find a game…`, making the most frequent
    act on an API board two clicks and a modal, for a list of 0–5 rows;
  - the **pool status line** moved inside the dialog, so the one thing that says
    *why* a pool is empty was invisible on the panel.

  The tempo instinct was right about exactly one thing — a date range is not a
  mid-game control — and the **Live/Completed tab already handles that**: the
  filter fields only exist on the tab a producer deliberately switched to.
- **The status line is the reason the rotating block is on the panel.**
  `playbackLine` says the pool is empty; only the dot line says why — no filter
  yet, filters edited since the last Find (amber, and the Find button rings to
  match), or an unreachable API. Never move it back behind the dialog.
- **Nothing here searches the Rio API on mount.** Selecting a board desk must not
  cost a search: `Find games` runs on the button, and on opening `Pool games`
  while stopped. The single-game **Live** tab is the one exception and it is a
  SINGLE fetch when the picker appears — opening the picker is the producer
  asking what is live, and charging them a click for an empty table is worse.
- **NO CLIENT TIMER EVER RE-FETCHES.** Both tabs used to re-query on the
  `ongoing_games.poll_interval` cadence while visible, with a "Refreshing in 4s"
  countdown beside the list. It is gone, twice over: it put a repeating API fetch
  under a producer who had merely selected a desk, and it mis-stated where a
  loaded game's freshness comes from — **a board following a live API game is
  re-applied server-side** (`OngoingGamePool._reapply_single_live`, gated by
  `_live_consumers_exist`), whether this panel is open or not. The list is a
  BROWSER of what else is on; a browser refreshes when you ask it to. The only
  automatic fetching in the console is the one a producer set up deliberately: a
  rotating pool's **Keep pool current** (`pool.refresh_interval`), server-side.
  `playbackLine` says which case a pinned game is in ("following it live"), and
  `games.test.jsx` pins that no timer comes back.
- **The live-refresh countdown belongs to the BOARD, and it is a readout of the
  SERVER's cadence.** It rides the Games region header beside the sentence that
  says the board is following a live game (`LiveRefreshCountdown`, desks/board.jsx)
  — never on the game list, which is the browser the countdown used to be
  mistaken for. It fetches nothing: every successful poll emits
  `v1.game_pool.ongoing_update` *after* `_reapply_single_live` has pushed the
  fresh game onto the board, so the event's arrival IS the refresh the producer
  just watched land, and counting from it cannot drift out of step with the server
  the way an independent client interval would.
  **It renders only under the condition the server actually polls in** — single
  mode, pinned game, `game_completed === false` AND `live_following !== false`.
  That last one is load-bearing and not inferable client-side: the poll event is
  emitted app-wide, so another board's rotation keeps firing it long after this
  board's own follow ended, and the countdown would promise a refresh forever.
- **Write out the timing labels.** `Seconds per game` and `Keep pool current`
  (with the tooltip explaining the off state), and the re-check interval stays
  **visible-but-disabled** rather than appearing under the switch — a control that
  vanishes moves everything below it. A label gutter is what forced these down to
  `Each game` / `Keep current` and dropped the tooltip.
- **What stages vs what fires now.** Putting a game on a board **stages**
  (`board:{sb}:game`) — it is the one act here that reaches air, and the one thing
  `PoolBrowser` got wrong (it fired immediately). The filter, the scope, the
  cadence and an exclusion write straight through: that is prep, the same call the
  schedule queue makes. The **transport is momentary**, like Take and post-game
  capture — Start/Stop/Next mean now, not on the next confirm.
- **A HUD board gets the readout and nothing else.** Its game is whatever Project
  Rio is playing, so a mode picker, a pool and a transport would all be controls
  with nothing to act on.
- `mode` is server-backed, so the segmented **echoes the click locally** and
  reconciles when the settings PUT comes back; without that it reads as locked
  while the server is off fetching games. Scope has no echo — it is not pressed
  mid-game.
- The filter is one element in a `filters` array by design: every field already
  takes a list.
- Tests: `src/routes/production/games.test.jsx` pins what is on the panel.


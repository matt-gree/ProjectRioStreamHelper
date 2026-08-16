# The source strip & which source a panel commands

> Reference for `production-console-contract`. Load when touching sourcestrip.jsx, panel headers, Bind/Air/Push, or how a panel picks its board.

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
- **Which source the strip commands follows the PLACEMENT.** The element's own
  row → its own dedicated source. A member's SLOT on a container → the
  **container**; "on air" for a member has never meant anything else, and Push
  is the slot that distinguishes its content from the container carrying it.
- **PUSH IS THE SLOT'S VERB, NOT THE ELEMENT'S.** It renders only on a row that
  is a member's place on a container. An element's own source has nothing to
  push into and gets the eye alone — asking `element.flavor` instead is how a
  dedicated source ended up wearing a Push aimed at a container that did not
  exist. Same rule kills the bespoke ones: the hit visualizer's "Split feed"
  button came off its stage, because its slot row carries the standard Push.
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


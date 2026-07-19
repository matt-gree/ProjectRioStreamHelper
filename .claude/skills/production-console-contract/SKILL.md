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
| **Stage** (center, flexible) | Work on one thing | The selected item's full controls (its *stage body*). Content-sized. Replaces all gear popovers, MatchCard, and PostGameBar. |
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
  columns** (the Match desk uses two) — column grouping is a kit feature, not a
  per-element invention.
- **Custom blocks are the bounded escape hatch**: allowed only between standard
  rows, on kit spacing and tokens. Today's sanctioned set: the Match desk's VS
  card, captain grid, and series stepper. Adding a new custom block is a design
  decision, not a convenience — it should stand out in review.
- **Overlay style settings can be stage rows.** Some layouts (Scorecard, Event
  Header) expose knobs the producer flips *during* a broadcast — bands that
  animate in and out mid-game. Those belong on the stage, not only in Setup.
  Render them with `stage/overlay-settings.jsx`: definitions stay single-sourced
  in `LAYOUT_SETTINGS[type]`, writes go through `stageSettingsSet`. Only
  `switch` and `select` defs are renderable — a text, colour or number setting
  having no kit row is exactly the signal that it's authoring and belongs on a
  tab. Per-board layouts (Scorecard) write `overlays.{type}.{N}.{key}`.
- All mutations route through the staging gateway (`stageOrRun`,
  `src/context/staging.js`) exactly as today: content changes stage when
  confirm-mode is on; momentary actions (Take, replay, capture, clock
  transport) always run immediately. The PendingBar is unchanged.

## The row kit

`src/routes/production/kit/` — the component library all three surfaces build
from. 28px control rhythm. Primitives:

| Row | Shape | Typical use |
|-----|-------|-------------|
| Toggle row | label + switch | source visibility, sub-plates, overlay band switches |
| Select row | label + dropdown | board pick, content pick, spotlight scene |
| Number row | label + number + suffix | spotlight hold, countdown minutes, gap width |
| Action row | 1–3 buttons | push, replay/spotlight/split, capture, clock transport |
| Segmented row | segmented control | plates mode, scorecard score block |
| List row | lead · name · meta · controls; optionally expandable in place | casters, plates, lower-third slots, schedule queue |
| Icon toggle | one icon button with on/off state | eye, sub-plate, remove |
| Custom block | anything, kit tokens/spacing | Match VS card, captain grid, series stepper |

`ListRow`'s `name` takes a node as well as a string. A row whose primary
content is itself editable (a person picker, a slot type select) passes the
control — wrapping an input in the expand button would make it inert, so the
chevron carries the expand affordance instead.

Plus: `PanelShell` (header: chip · display-face name · primary action · pin ·
close where applicable; body; optional footer), `StateChip`, `QuickCard`,
labelled column wrapper. The kit exists so the cheap path and the cohesive path
are the same path — a bespoke panel should be *harder* to write than a
conforming one.

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
  `DESK` chips) — permanent rows with live meta (`M1 · 1–0`, `empty`/`captured`,
  the loaded phase), dimmed when idle, selectable like any row. Never in the
  state sections. Rack meta must read from state only: the rack draws every
  frame and must not fire a desk's own fetches.
- Phase switch auto-selects the phase's desk: Draft → Match, Post-game →
  Capture. (Live/Break keep the last selection.)
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
   `src/routes/production/stage/`. No freeform JSX layout.
4. If it needs settings beyond kit rows' reach, that's a signal they belong on
   a tab, not the stage.
5. Verify: rack row appears in the right phase section with a working chip and
   quick action; pin → rail card renders the quick face within cap; selection →
   stage body; staging gateway honored (test with confirm-mode on).

## Persistence (all local UI prefs via `usePersistentState`, like the phase choice)

- `prsh.ui.production.phase` — existing.
- `prsh.ui.production.selection` — selected item id.
- `prsh.ui.production.rail` — ordered array of pinned element ids.

Nothing here belongs in server Settings — it's per-producer-browser workspace
layout, not broadcast config.

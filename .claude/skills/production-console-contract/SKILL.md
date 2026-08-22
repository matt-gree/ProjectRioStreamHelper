---
name: production-console-contract
description: The Production tab console architecture (rack / stage / quick rail), the element contract every broadcast element must satisfy to appear there (registration, quick face, stage body), the six-row kit that all three surfaces compose from, and the desk tier for non-element workflows (boards, Match). Read before adding an element to the Production page, changing production UI, or touching src/routes/production/. This file is a router — the depth lives in reference/, loaded per area.
---

# Production Console Contract

> **STATUS: SHIPPED** (2026-07-18). The console is the Production tab: rack
> (`rack.jsx`) · stage (`stage/`) · rail (`rail.jsx`), with desks under
> `desks/` and the row kit in `kit/`. `production.jsx` is a ~280-line shell.
> If this file and the code disagree, one of them is a bug — fix both in the
> same change (same rule as CLAUDE.md).
>
> Design rationale + rendered mockups: https://claude.ai/code/artifact/94e855b2-439a-4563-9472-20fc576c8463 (revision 5).

**This file is the map.** It carries the three surfaces, the invariants that
hold across all of them, and the add-an-element checklist. Everything else is
in `reference/` — load the one file for the area you're touching rather than
reading the whole contract.

| Load | When you're touching |
|---|---|
| `reference/element-contract.md` | Adding an element, or changing registration, `flavor`, container membership, quick faces, stage bodies |
| `reference/scenes-and-placements.md` | `placements.js`, rack sections, row identity, the board/variant/slot axes |
| `reference/desks.md` | The board desk, the Match desk, or adding a desk |
| `reference/source-strip.md` | `sourcestrip.jsx`, panel headers, Bind/Air/Push, which source a panel commands |
| `reference/obs-mirror-and-offline.md` | The scene mirror, or console behavior with OBS disconnected |
| `reference/row-kit.md` | Building UI from the shared rows, or storing a per-producer UI preference |

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

## Invariants that hold everywhere

These bind even when you haven't loaded the reference file that explains them.
Each one is a thing that was built the other way first and had to be undone —
if a change starts to look like the alternative, load the matching reference
before proceeding.

- **A rack row is a placement, not an element** — one row per source per scene,
  keyed `{element}:{board}@{scene}`. Derivation runs source → row, so the rack
  lists only what is really in a scene. → `scenes-and-placements.md`
- **There is no phase concept.** No `PHASES`, no `elementsForPhase`, no `phase`
  on an element; the producer's own OBS scene list replaced it.
- **Push belongs to the slot, not the panel.** Being fed is a property of the
  *placement* — every surface branches on `isFedPlacement(placement)`, never on
  the element. A bespoke push button on a direct panel is what the source strip
  exists to end. → `source-strip.md`
- **Membership lives on the container and is exclusive.** The roster *is* the
  relationship; don't reintroduce a per-element "feed into" target.
  `containerScoped` members are the one exception. → `element-contract.md`
- **PRSH has no scaling system.** A member must fit its container; smaller ones
  center. OBS does placement.
- **OBS is the control surface, not the content pipeline.** With no connection
  the rack swaps to the catalog tier and everything keeps working. Never build a
  surface that dies without OBS. → `obs-mirror-and-offline.md`
- **OBS control runs browser-side** (`src/context/obs.jsx`, localhost:4455) so it
  reaches the producer's OBS in dual-machine setups. Don't move it server-side.
- **Selection, rail pins and expanded scenes are browser-local**
  (`usePersistentState`, `prsh.ui.production.*`) — per-producer workspace layout,
  never server Settings. Stored ids are **resolved at read time, never
  rewritten**. → `row-kit.md`
- **Changes go through the staging gateway** (`src/context/staging.js`
  `stageOrRun`) — with confirm-mode on, they stage until F9/confirm.

## Adding a new element — checklist

1. Build the overlay Layout first (see `overlay-authoring` skill) — the console
   binds to its URL.
2. Register in `elements.js`: id, name, flavor, url/dims/match, and
   quick face (or accept the flavor default, or explicit `null`). `flavor: 'fed'`
   only when the element genuinely has NO source of its own; an element that can
   go in a container *and* stand alone is `direct` with a `container-members.js`
   entry — hostability is read off that registry, never declared on the element.
3. Write the stage body as kit rows in its own file under
   `src/routes/production/stage/`. No freeform JSX layout. **Do not write a
   show/hide row or a push button into the body** — the source strip in the
   panel header owns both, for every element.
4. If it needs settings beyond kit rows' reach, that's a signal they belong on
   a tab, not the stage.
5. Verify: rack row appears under the scene its source is in, with a working chip and
   quick action; pin → rail card renders the quick face within cap; selection →
   stage body; staging gateway honored (test with confirm-mode on).

Full detail for step 2 is in `reference/element-contract.md`; for step 5's row
placement, `reference/scenes-and-placements.md`.

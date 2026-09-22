# The row kit & persistence

> Reference for `production-console-contract`. Load when building UI from the shared rows, or storing a per-producer UI preference.

## The row kit

`src/routes/production/kit/` — the component library all three surfaces build
from. 28px control rhythm. Primitives:

| Row | Shape | Typical use |
|-----|-------|-------------|
| Subject row | text + dimmed qualifier | what the element is drawing (readout only, never a control — see the subject rules in `element-contract.md`) |
| Toggle row | label + switch | source visibility, sub-plates, overlay band switches |
| Select row | label + dropdown | board pick, content pick, spotlight scene |
| Number row | label + number + suffix | spotlight hold, countdown minutes, gap width, band geometry |
| Text row | label + text input | header title, field separator, a card's custom bottom line |
| Colour row | label + swatch + hex + reset | per-overlay colour overrides (bracket connector/active lines); empty = theme default. A colour shared by several elements is NOT one of these — the controller-port palette is a global on the Design tab, because a per-element copy means recolouring port 1 on one overlay and watching the rest keep the old red |
| Field row | label + any control; `stacked` puts the label above | pickers the kit doesn't own (participant, captain, port, a typed field). Stack it in a column of form fields, where a fixed label gutter would push every control off the panel's left edge |
| Action row | 1–3 buttons | push, replay/spotlight/split, capture, clock transport |
| Segmented row | segmented control | plates mode, scorecard score block |
| List row | lead · name · meta · controls; optionally expandable in place | lower-third slots, schedule queue |
| Icon toggle | one icon button with on/off state | eye, sub-plate, remove |
| Sub-plate picker | `SubFieldPicker` (`../subfield-picker.jsx`) — an address-book field chosen by the VALUE it will draw for that person, empty fields marked, an empty choice flagged amber on the closed control | the caster desk's and Player Plates' sub-plates — and its "No sub-plate" is the sub-plate's ONLY off switch on both (a stored `subVisible: false` reads as none; any pick writes it back on) |
| Custom block | anything, kit tokens/spacing | Match captain grid, port select, format field |

### A NUMBER FIELD YOU CAN EMPTY

`NumberRow` / `NumberField` (and `useNumberDraft` under both) — three rules, each
of which is invisible until a producer tries to **retype** a value rather than
nudge it.

- **Keystrokes are local; the store is written on a pause or on blur.** A
  controlled field bound straight to a setting refills itself from the store on
  the keystroke that empties it, so clearing `30` to type `120` gives you
  `30120`. Every value typed on the way is also a write that reaches the whole
  rig.
- **`clearable` says what an EMPTY BOX MEANS, and only the caller knows.** Blank
  is an ANSWER on a style override — "nothing pinned here", with the placeholder
  showing the inherited value through it — so it commits `null`. Blank is a STATE
  YOU PASS THROUGH on a bounded knob like a rotation interval: there is no board
  that cycles every `` seconds, so `clearable={false}` writes nothing and puts
  the old value back when focus leaves.
- **`min`/`max` clamp on BLUR and never on the timer.** Until the producer
  leaves, every number they type is a prefix of the one they mean, and clamping a
  prefix is how a range makes a field unusable: in a 5..600 field `120` pauses
  after `1`, the debounce commits, the clamp turns it into 5, and the store drops
  `5` into the box under the cursor. The settle pass runs even with nothing
  pending, because the debounce has usually already written what was typed — it
  writes nothing when the draft already agrees with the store.

`KIT_NUMBER` (`kit/tokens.js`) rides `KIT_INPUT` on both: native spinner arrows
off, `tabular-nums` on. The arrows are a click target inside a field whose value
goes to air — a triple-click to select the rotation interval took it from 30 to
28 before anything was typed — and 16px of chrome inside a 28px control.

`ListRow`'s `name` takes a node as well as a string. A row whose primary
content is itself editable (a person picker, a slot type select) passes the
control — wrapping an input in the expand button would make it inert, so the
chevron carries the expand affordance instead.

The caster desk (`stage/commentary.jsx`) is the one body that outgrew `ListRow`:
it is a ruled SHEET on a subgrid — one row per caster, header labels and rows
sharing one set of column rails, the sub-plate dropping to a second line below
`@2xl`. Reach for that shape when a list's rows carry several controls a
producer compares DOWN the list (who is on, what their sub-plate says); a
`ListRow` flexes its controls per row and cannot line them up.

Plus: `PanelShell` (header: chip · display-face name · subject · primary action ·
pin · close where applicable; body; optional footer — and `onRename`, which turns
the name into the field that SETS it, for the one kind of panel whose title is a
stored producer-authored string), `StateChip`, `QuickCard`, labelled column
wrapper. The kit exists so the cheap path and the cohesive path
are the same path — a bespoke panel should be *harder* to write than a
conforming one.


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


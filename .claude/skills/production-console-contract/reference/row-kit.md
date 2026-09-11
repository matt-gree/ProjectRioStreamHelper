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
| List row | lead · name · meta · controls; optionally expandable in place | plates, lower-third slots, schedule queue |
| Icon toggle | one icon button with on/off state | eye, sub-plate, remove |
| Sub-plate picker | `SubFieldPicker` (`../subfield-picker.jsx`) — an address-book field chosen by the VALUE it will draw for that person, empty fields marked, an empty choice flagged amber on the closed control | the caster desk's sub-plates — and its "No sub-plate" is the sub-plate's ONLY off switch there (a stored `subVisible: false` reads as none; any pick writes it back on); Player Plates still uses a bare select |
| Custom block | anything, kit tokens/spacing | Match captain grid, port select, format field |

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

Plus: `PanelShell` (header: chip · display-face name · primary action · pin ·
close where applicable; body; optional footer), `StateChip`, `QuickCard`,
labelled column wrapper. The kit exists so the cheap path and the cohesive path
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


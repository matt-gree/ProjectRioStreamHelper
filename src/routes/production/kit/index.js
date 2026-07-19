// Production console row kit — see the production-console-contract skill.
// All three console surfaces (rack, stage, quick rail) compose from these.

export { chipState, CHIP_META } from './chip';
export { StateChip } from './StateChip';
export { PanelShell } from './PanelShell';
export { QuickCard } from './QuickCard';
export {
    ToggleRow, SelectRow, NumberRow, ActionRow, SegmentedRow, ListRow, IconToggle,
    KitColumns, KitColumn,
} from './rows';
export { KIT_INPUT, KIT_INPUT_FLOW, KIT_FIELD } from './tokens';

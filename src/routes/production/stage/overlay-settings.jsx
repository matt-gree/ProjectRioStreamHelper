import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../../context/store';
import { usePending } from '../../../context/staging';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
import { SegmentedRow, ToggleRow } from '../kit';
import { stageSettingsSet } from '../controls';

/*
 * Overlay style settings as kit rows.
 *
 * Some layouts (Scorecard, Event Header) expose knobs the producer flips
 * DURING a broadcast — bands that animate in and out mid-game. Those are live
 * broadcast decisions, so they belong on the console, not only in Setup where
 * they lived before. The definitions stay single-sourced in
 * LAYOUT_SETTINGS[type] (routes/layouts/designConstants.js); this module just
 * renders a chosen subset of them as rows and routes writes through the
 * staging gateway.
 *
 * Only `switch` and `select` defs are renderable here. Text, colour and number
 * settings have no kit row, which is exactly the contract's signal that they
 * are authoring and belong on the Setup tab.
 */

export const RENDERABLE = new Set(['switch', 'select']);

export const settingKey = (ns, key) => `overlays.${ns}.${key}`;

// The defs a stage body surfaces, in the order it names them. Unknown or
// non-renderable keys drop out rather than throwing — a layout can retire a
// setting without breaking its stage.
export function defsFor(type, keys) {
    const all = LAYOUT_SETTINGS[type] ?? [];
    return keys
        .map(k => all.find(d => d.key === k))
        .filter(d => d && RENDERABLE.has(d.type));
}

/*
 * Effective value. `board` is set only for per-board layouts (the Scorecard
 * stores config at overlays.scorecard.{N}.* so two sources can be driven
 * independently); a bare overlays.{type}.{key} leaf is the legacy global and
 * merges underneath as a non-destructive fallback — the same resolution the
 * Setup panel uses.
 */
export function resolveSetting(bag, def, board) {
    const scoped = board == null ? {} : (bag?.[board] ?? bag?.[String(board)] ?? {});
    const v = scoped[def.key] ?? bag?.[def.key];
    return v ?? def.defaultValue;
}

/**
 * @param type  LAYOUT_SETTINGS key (also the settings namespace root)
 * @param ns    write namespace — `type`, or `${type}.${board}` per board
 * @param label prefix for the pending bar ("Scorecard 1", "Event header")
 * @param board board id for per-board resolution, or null
 */
export function useOverlaySettings(type, ns, label, board = null) {
    const bag = useSettingsStore(useShallow(s => s?.overlays?.[type] ?? {}));
    const set = useCallback(
        (def, value) => stageSettingsSet(settingKey(ns, def.key), value, `${label}: ${def.label}`),
        [ns, label],
    );
    return { bag, ns, board, set };
}

// One setting as a row, showing the staged value while it waits on confirm.
export const OverlaySettingRow = memo(function OverlaySettingRow({ os, def }) {
    const pending = usePending(`settings:${settingKey(os.ns, def.key)}`);
    const value = pending ? pending.value : resolveSetting(os.bag, def, os.board);

    if (def.type === 'select') {
        return (
            <SegmentedRow
                label={def.label} value={value} data={def.options}
                onChange={(v) => os.set(def, v)}
            />
        );
    }
    return (
        <ToggleRow
            label={def.label} checked={!!value} staged={!!pending}
            onChange={(v) => os.set(def, v)}
        />
    );
});

// Convenience: a run of rows from a key list.
export const OverlaySettingRows = memo(function OverlaySettingRows({ os, type, keys }) {
    return defsFor(type, keys).map(def => <OverlaySettingRow key={def.key} os={os} def={def} />);
});

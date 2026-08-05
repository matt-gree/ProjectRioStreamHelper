import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../../context/store';
import { usePending } from '../../../context/staging';
import { Text } from '../../../components/ui/primitives';
import { LAYOUT_SETTINGS, THEME_ELEMENT } from '../../layouts/designConstants';
import { usePaintedByApp } from '../../layouts/designPackage';
import { SegmentedRow, ToggleRow, TextRow, NumberRow, ColorRow } from '../kit';
import { stageSettingsSet } from '../controls';

/*
 * Overlay style settings as kit rows.
 *
 * Some layouts (Scorecard, Event Header) expose knobs the producer flips
 * DURING a broadcast — bands that animate in and out mid-game. Those are live
 * broadcast decisions, so they belong on the console, not only in Setup where
 * they lived before. The definitions stay single-sourced in
 * LAYOUT_SETTINGS[type] (routes/layouts/designConstants.js); this module
 * renders them as rows and routes writes through the staging gateway.
 *
 * Every element-settings type has a kit row now — switch, select, text,
 * number, colour. The old cap (switch/select only) was written for a cramped
 * one-column stage, where a missing row doubled as the signal that a setting
 * was authoring and belonged on a tab. With the two-column stage that
 * inference no longer holds: it was evidence about available space, not about
 * the setting. A stage body still chooses which of its settings to surface as
 * headline live controls; ElementStyleSettings renders the rest as a Style
 * section so nothing is stage-unreachable (production-console-v2 phase 7).
 */

export const RENDERABLE = new Set(['switch', 'select', 'text', 'number-override', 'color-override']);

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
 * A setting that reaches its overlay through the app's palette is DEAD under a
 * design package that paints that element itself — the mount clears those CSS
 * vars rather than honouring them (see ../../layouts/designPackage.js). It is
 * dropped rather than dimmed: switching packages is a deliberate act, and a
 * producer who does it should read the new look as the new look, not go hunting
 * for the customisations that no longer come with it.
 */
export function useLiveDefs(type, defs) {
    const painted = usePaintedByApp(THEME_ELEMENT[type]);
    return painted ? defs : defs.filter(d => !d.appPalette);
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
    if (def.type === 'text') {
        return (
            <TextRow
                label={def.label} value={value} placeholder={def.placeholder} staged={!!pending}
                onChange={(v) => os.set(def, v)}
            />
        );
    }
    if (def.type === 'number-override') {
        return (
            <NumberRow
                label={def.label} value={value} staged={!!pending}
                min={def.min} max={def.max} step={def.step} suffix={def.suffix}
                onChange={(v) => os.set(def, v ?? def.defaultValue)}
            />
        );
    }
    if (def.type === 'color-override') {
        return (
            <ColorRow
                label={def.label} value={value} staged={!!pending}
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
    const defs = useLiveDefs(type, defsFor(type, keys));
    return defs.map(def => <OverlaySettingRow key={def.key} os={os} def={def} />);
});

/*
 * Every renderable setting for an element, as a "Style" section — the stage's
 * catch-all so no element setting is unreachable from the console. A stage body
 * that already surfaces some settings as headline live controls names them in
 * its `surfacedKeys`, and those drop out here to avoid a doubled row; the rest
 * (a bracket's colours, a ticker's speed, an event header's geometry) render
 * below the body. Elements with no settings render nothing.
 *
 * `board` is set only for the URL-scoped (?scoreboard=N) elements, whose config
 * lives at overlays.{type}.{board}.* so two sources stay independent.
 */
export const ElementStyleSettings = memo(function ElementStyleSettings({ type, board, label, exclude }) {
    const ns = board != null ? `${type}.${board}` : type;
    const os = useOverlaySettings(type, ns, label ?? type, board ?? null);
    const defs = useLiveDefs(type, (LAYOUT_SETTINGS[type] ?? []).filter(
        def => RENDERABLE.has(def.type) && !exclude?.includes(def.key),
    ));
    if (defs.length === 0) return null;
    return (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
            <Text size="xs" className="label-display text-muted-foreground">Style</Text>
            {defs.map(def => <OverlaySettingRow key={def.key} os={os} def={def} />)}
        </div>
    );
});

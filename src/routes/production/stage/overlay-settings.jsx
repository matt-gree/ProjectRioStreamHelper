import { memo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../../context/store';
import { usePending } from '../../../context/staging';
import { Text } from '../../../components/ui/primitives';
import { LAYOUT_SETTINGS, THEME_ELEMENT } from '../../layouts/designConstants';
import { usePaintedByApp } from '../../layouts/designPackage';
import {
    SegmentedRow, ToggleRow, ToggleChip, ToggleChips, TextRow, NumberRow, ColorRow, KIT_LABEL,
} from '../kit';
import { cn } from '../../../lib/utils';
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
    return { bag, ns, board, type, set };
}

/*
 * A detail row whose master says it has no job — the Stat Card's "Custom Bottom
 * Text" while the bottom line is showing the game line. Nothing it holds reaches
 * the overlay, which is the bar for hiding a control rather than disabling one:
 * a disabled row still costs a line and still has to be read past.
 *
 * Only for INERT details. A field that is merely hidden right now (a band's
 * title while the band is switched off) stays, because authoring it ahead of
 * turning the band on is a real workflow.
 */
function useShowWhen(os, def) {
    const gate = def.showWhen;
    // Unconditional, and undefined is a safe key — a hook may not be skipped.
    const staged = usePending(gate ? `settings:${settingKey(os.ns, gate.key)}` : undefined);
    if (!gate) return true;
    const masterDef = (LAYOUT_SETTINGS[os.type] ?? []).find(d => d.key === gate.key) ?? gate;
    // Read the STAGED value too, so choosing the mode reveals the field now
    // rather than after Go Live.
    const v = staged ? staged.value : resolveSetting(os.bag, masterDef, os.board);
    return 'is' in gate ? v === gate.is : !!v;
}

// One setting as a row, showing the staged value while it waits on confirm.
export const OverlaySettingRow = memo(function OverlaySettingRow({ os, def }) {
    const pending = usePending(`settings:${settingKey(os.ns, def.key)}`);
    const shown = useShowWhen(os, def);
    const value = pending ? pending.value : resolveSetting(os.bag, def, os.board);

    if (!shown) return null;

    if (def.type === 'select') {
        return (
            <SegmentedRow
                label={def.label} value={value} data={def.options} fill={false}
                onChange={(v) => os.set(def, v)}
            />
        );
    }
    if (def.type === 'text') {
        return (
            <TextRow
                label={def.label} value={value} placeholder={def.placeholder} staged={!!pending}
                short={def.short} onChange={(v) => os.set(def, v)}
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

// The same setting as a chip, for a def that `chunkDefs` put in a part set.
// Same reads as the row (staged value wins, showWhen gates) — only the shape
// differs, so the two can never disagree about what a setting says.
export const OverlaySettingChip = memo(function OverlaySettingChip({ os, def, className }) {
    const pending = usePending(`settings:${settingKey(os.ns, def.key)}`);
    const shown = useShowWhen(os, def);
    const value = pending ? pending.value : resolveSetting(os.bag, def, os.board);

    if (!shown) return null;
    return (
        <ToggleChip
            label={def.label} checked={!!value} staged={!!pending}
            title={def.description} className={className}
            onChange={(v) => os.set(def, v)}
        />
    );
});

/*
 * EVERY registry `switch` is a chip. The only question is how it is laid out.
 *
 * The line this draws is between a PART OF THE OVERLAY and a BEHAVIOUR. A
 * registry switch always answers "is this piece drawn" — the header bar, the
 * box score, the dates — and that is a multi-select over the element's anatomy,
 * so it gets the one idiom. A switch survives only for things that are not
 * parts: the intro animation, a spotlight auto-cut, a source's on-air state.
 * Those are hand-written ToggleRows and stay switches, which now MEANS
 * something instead of being arbitrary.
 *
 * This replaced a rule that chipped only runs of two or more adjacent
 * switches. It read well on the event header but broke on the scorecard, whose
 * Top bars alternate switch/text because each bar owns a title field: Header
 * Bar, Bracket Phase and Game Mode are the same kind of thing as Rosters and
 * Box Score, but every one of them was a run of one, so the same panel drew one
 * concept two different ways.
 *
 * Layout, in registry order:
 *   pair  — a switch immediately followed by a `text` def: the chip IS that
 *           field's label, on one row. Keeps a bar's title beside the bar
 *           (LAYOUT_SETTINGS.scorecard fought to put it there) while making
 *           the toggle match every other band toggle in the panel.
 *   chips — adjacent switches with no field of their own, packed into a strip.
 *   row   — everything else.
 */
export function chunkDefs(defs) {
    const out = [];
    for (let i = 0; i < defs.length; i += 1) {
        const def = defs[i];
        if (def.type !== 'switch') {
            out.push({ kind: 'row', defs: [def] });
            continue;
        }
        const next = defs[i + 1];
        if (next?.type === 'text') {
            out.push({ kind: 'pair', defs: [def, next] });
            i += 1;
            continue;
        }
        const last = out[out.length - 1];
        if (last?.kind === 'chips') last.defs.push(def);
        else out.push({ kind: 'chips', defs: [def] });
    }
    /*
     * A RUN OF ONE IS NOT A SET, so it takes the label column instead of a
     * strip — the same reasoning ToggleChip's own note gives for why a lone
     * chip "reads as a fragment rather than a set". Aligned, it lines up with
     * the rows above and below it (the scorecard's Game Mode with the two
     * titled bars; each event-header band's master above its offset), and a
     * region's leading toggle reads as the master by width and position.
     *
     * This replaced a region-wide promotion — ANY pair in the group turned
     * EVERY chip in it into a lone aligned row. It was written for the
     * scorecard, where one unpaired toggle sits among two paired ones, and it
     * scaled with the number of loners: the event header's Bottom band has one
     * pair (Message) and four other toggles, so the strip that should have been
     * a single 34px row became four 128px chips on four rows, each stranding
     * ~590px of empty panel beside it (measured at a 1394px panel). Packing is
     * what the strip is for; alignment is for the chip that has nothing to pack
     * with.
     */
    return out.map(seg => (seg.kind === 'chips' && seg.defs.length === 1
        ? { kind: 'pair', defs: seg.defs }
        : seg));
}

/*
 * The text half of a paired row. Same reads as OverlaySettingRow — staged value
 * wins, showWhen gates — but it draws no label, because the chip beside it
 * already names the band. The label survives as the input's accessible name:
 * a placeholder vanishes the moment the field holds a value, so it cannot be
 * the only thing identifying what the field is.
 */
const PairedField = memo(function PairedField({ os, def }) {
    const pending = usePending(`settings:${settingKey(os.ns, def.key)}`);
    const shown = useShowWhen(os, def);
    const value = pending ? pending.value : resolveSetting(os.bag, def, os.board);

    if (!shown) return null;
    return (
        <TextRow
            label={null} ariaLabel={def.label} value={value} placeholder={def.placeholder}
            staged={!!pending} className="min-w-0 flex-1"
            onChange={(v) => os.set(def, v)}
        />
    );
});

// A def list as pairs, chip strips and rows, in registry order.
export const SettingSegments = memo(function SettingSegments({ os, defs }) {
    return chunkDefs(defs).map((seg) => {
        const key = seg.defs[0].key;
        if (seg.kind === 'pair') {
            const [sw, field] = seg.defs;
            return (
                <div key={key} className="flex min-h-7 items-center gap-2">
                    {/* The label column's width, so a paired field starts where
                        every other row's control does. */}
                    <OverlaySettingChip os={os} def={sw} className={cn(KIT_LABEL, 'justify-center')} />
                    {field && <PairedField os={os} def={field} />}
                </div>
            );
        }
        if (seg.kind === 'chips') {
            return (
                <ToggleChips key={key}>
                    {seg.defs.map(def => <OverlaySettingChip key={def.key} os={os} def={def} />)}
                </ToggleChips>
            );
        }
        return seg.defs.map(def => <OverlaySettingRow key={def.key} os={os} def={def} />);
    });
});

/*
 * Convenience: a run from a key list. Always flat — a body asking for named
 * keys has already decided their order, and the rail's quick face is built from
 * this too, where a group eyebrow would blow the two-row cap.
 *
 * Flat means UNGROUPED, not un-chipped: it goes through the same segments as
 * the stage so a band toggle is the same control on both surfaces. The rail
 * gains from it twice — the event header's two bands become one strip, which
 * gives a card back a row of its two-row budget.
 */
export const OverlaySettingRows = memo(function OverlaySettingRows({ os, type, keys }) {
    const defs = useLiveDefs(type, defsFor(type, keys));
    return <SettingSegments os={os} defs={defs} />;
});

/*
 * Defs split by the REGION of the overlay they change, in the order those
 * regions first appear in the registry — which is the order they appear on
 * screen, top to bottom.
 *
 * A group is a VISIBLE PART OF THE ELEMENT, never a kind of control: "Top band",
 * not "Switches" or "Geometry". Sorted by kind, an event header's band offset
 * ended up five rows from the switch that turns that band on, and a producer
 * whose top strip sits too high had to know which of three sections to look in.
 * Grouped by region there is one place to look, and the panel reads as a scale
 * model of the thing it configures — the same rule the Lower Third stage's five
 * always-open columns already follow.
 *
 * First appearance rather than a sort, so the registry array stays the single
 * statement of order; and a def with no `group` keeps its place in an ungrouped
 * run, so adding groups to one type never disturbs another.
 */
export function groupDefs(defs) {
    const order = [];
    const byGroup = new Map();
    for (const def of defs) {
        const group = def.group ?? null;
        if (!byGroup.has(group)) { byGroup.set(group, []); order.push(group); }
        byGroup.get(group).push(def);
    }
    return order.map(group => ({ group, defs: byGroup.get(group) }));
}

// Always open, never an accordion: the stage is wide, and a producer mid-
// broadcast should not have to remember which collapsed section holds the
// control they need. Ranking is done by ORDER — the set-once group sits last.
export const SettingGroups = memo(function SettingGroups({ os, defs }) {
    const groups = groupDefs(defs);
    if (groups.length === 1 && groups[0].group == null) {
        return <SettingSegments os={os} defs={groups[0].defs} />;
    }
    /*
     * More columns as the PANEL gets wider (PanelShell's body is the
     * `@container`). A settings row is a label plus one control — a number row
     * measures 238px, a chip strip 240px — so the column width that fits one is
     * ~340px, and everything past that is empty panel beside every row in it.
     * Two columns were right for the ~950px panel this was written against and
     * wrong for a maximised window: at 1394px they were 675px each, so the
     * median row spent 437px on nothing and the three regions of the event
     * header stacked two-then-one instead of standing side by side.
     *
     * CSS columns rather than a GRID, because regions differ wildly in height
     * and a grid gives every row the height of its tallest cell. The Scorecard
     * is the worst case: Top bars is five rows deep and Score block is a single
     * chip strip, so the grid left ~400px of dead panel under Score block and
     * pushed Lower bars onto a third row. Columns pack and balance instead, and
     * the reading order stays the registry's — which is the order the regions
     * appear on screen.
     */
    return (
        <div className="columns-1 gap-x-6 @3xl:columns-2 @6xl:columns-3">
            {groups.map(({ group, defs: rows }) => (
                <div
                    key={group ?? '_'}
                    data-setting-group={group ?? ''}
                    className="mb-3 flex break-inside-avoid flex-col gap-1.5 last:mb-0"
                >
                    {group && (
                        <Text size="xs" className="label-display text-muted-foreground">{group}</Text>
                    )}
                    <SettingSegments os={os} defs={rows} />
                </div>
            ))}
        </div>
    );
});

// Every renderable setting for a type, grouped by region. `keys` narrows the set
// (and its order is ignored — the registry's is what the groups follow).
export const OverlaySettingGroups = memo(function OverlaySettingGroups({ os, type, keys }) {
    const defs = useLiveDefs(type, (LAYOUT_SETTINGS[type] ?? []).filter(
        def => RENDERABLE.has(def.type) && (!keys || keys.includes(def.key)),
    ));
    return <SettingGroups os={os} defs={defs} />;
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
            <SettingGroups os={os} defs={defs} />
        </div>
    );
});

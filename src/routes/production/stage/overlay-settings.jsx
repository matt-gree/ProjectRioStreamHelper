import { memo, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../../context/store';
import { usePending, useStagingStore } from '../../../context/staging';
import { Text } from '../../../components/ui/primitives';
import {
    LAYOUT_SETTINGS, THEME_ELEMENT, OVERRIDABLE_GLOBAL_KEYS, GLOBAL_DESIGN_DEFAULTS,
    OVERRIDE_CAPABLE_TYPES, TYPE_ROLE_DEFAULTS, themeElementFor, overrideReaches, settingReachesSize,
} from '../../layouts/designConstants';
import { usePaintedByApp, useDrawnTypeRoles, useDesignPackages } from '../../layouts/designPackage';
import { useLayoutWhitelists, declaresAny } from '../../layouts/layoutWhitelist';
import { FontCombobox } from '../../../components/ui/font-combobox';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { Plus, X } from 'lucide-react';
import {
    SegmentedRow, ToggleRow, ToggleChip, ToggleChips, TextRow, NumberRow, NumberField, FractionRow, ColorRow,
    FieldRow, KIT_LABEL, KIT_SECTION,
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

export const RENDERABLE = new Set(['switch', 'select', 'text', 'number-override', 'fraction-override', 'color-override']);

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

/*
 * A switch another setting HOLDS ON — the scoreboard's Inning while the Live
 * Cluster is up, because the mount ORs the two (showInningSeg). The overlay
 * already ignores this switch in that state, so the only question is whether the
 * console admits it: a control that keeps offering a choice it does not have
 * reads as a broken setting, and the producer's next move is to file it.
 *
 * Held-on, not hidden. The producer has to be able to see what the element is
 * drawing and why, and a switch that vanished when its master came up would take
 * the explanation with it. Reads the master the same way `useShowWhen` does —
 * staged value first — so turning the Live Cluster on holds this now rather than
 * after Go Live.
 */
function useForcedOn(os, def) {
    const force = def.forcedBy;
    // Unconditional, and undefined is a safe key — a hook may not be skipped.
    const staged = usePending(force ? `settings:${settingKey(os.ns, force.key)}` : undefined);
    if (!force) return null;
    const masterDef = (LAYOUT_SETTINGS[os.type] ?? []).find(d => d.key === force.key) ?? force;
    const v = staged ? staged.value : resolveSetting(os.bag, masterDef, os.board);
    return v ? force : null;
}

/*
 * One setting as a row, showing the staged value while it waits on confirm.
 *
 * `compact` is the rail's shape: a card is ~234px, so the 128px label column
 * left a four-way segmented control about ninety pixels and clipped it. There
 * the select drops its label and takes the card's width — the card's title
 * already names the element, the options name the choice, and the setting's
 * own name moves to the row's tooltip. An option's `railLabel` stands in for
 * its label there, for the same width. Only selects change; the rail never
 * carries the other kinds.
 */
const railOptions = (options) => options.map(o => (o.railLabel ? { value: o.value, label: o.railLabel } : o));

export const OverlaySettingRow = memo(function OverlaySettingRow({ os, def, compact = false }) {
    const pending = usePending(`settings:${settingKey(os.ns, def.key)}`);
    const shown = useShowWhen(os, def);
    const forced = useForcedOn(os, def);
    const value = pending ? pending.value : resolveSetting(os.bag, def, os.board);

    if (!shown) return null;

    if (def.type === 'select') {
        return (
            <SegmentedRow
                label={compact ? null : def.label} value={value}
                data={compact ? railOptions(def.options) : def.options}
                fill={compact} title={compact ? def.label : undefined}
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
    if (def.type === 'fraction-override') {
        return (
            <FractionRow
                label={def.label} value={value} staged={!!pending} step={def.step}
                onChange={(v) => os.set(def, v)}
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
    // The title rides the ROW, not the Switch: a disabled control is not a
    // reliable hover target, and the answer is about the row as a whole.
    return (
        <ToggleRow
            label={def.label} checked={forced ? true : !!value}
            staged={!forced && !!pending} disabled={!!forced} title={forced?.note}
            onChange={(v) => os.set(def, v)}
        />
    );
});

// The same setting as a chip, for a def that `chunkDefs` put in a part set.
// Same reads as the row (staged value wins, showWhen gates) — only the shape
// differs, so the two can never disagree about what a setting says.
//
// `compact` takes the def's `railLabel` where it has one: the rail's strip is
// ~216px and the scoreboard's four Large parts need 281 at their full names.
// The full name stays the chip's accessible name.
export const OverlaySettingChip = memo(function OverlaySettingChip({ os, def, className, compact = false }) {
    const pending = usePending(`settings:${settingKey(os.ns, def.key)}`);
    const shown = useShowWhen(os, def);
    const forced = useForcedOn(os, def);
    const value = pending ? pending.value : resolveSetting(os.bag, def, os.board);

    if (!shown) return null;
    // `locked`, not `disabled` — see ToggleChip. A held-on chip stays at full
    // weight (it IS on) and takes a dashed edge, and its title stays hoverable.
    return (
        <ToggleChip
            label={(compact && def.railLabel) || def.label}
            ariaLabel={compact && def.railLabel ? def.label : undefined}
            checked={forced ? true : !!value}
            staged={!forced && !!pending} locked={!!forced}
            title={forced ? forced.note : def.description} className={className}
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

// A def list as pairs, chip strips and rows, in registry order. `compact` is
// the rail card's shape (see OverlaySettingRow).
export const SettingSegments = memo(function SettingSegments({ os, defs, compact = false }) {
    return chunkDefs(defs).map((seg) => {
        const key = seg.defs[0].key;
        // A LONE chip on the rail is still just a chip. The label-column
        // alignment below is for lining up with the rows of a stage panel; a
        // card has no column to line up with, and the 128px slot truncated the
        // schedule's "Decided Matches" to "Decid…".
        if (compact && seg.kind === 'pair' && seg.defs.length === 1) {
            return (
                <ToggleChips key={key}>
                    <OverlaySettingChip os={os} def={seg.defs[0]} compact />
                </ToggleChips>
            );
        }
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
                    {seg.defs.map(def => <OverlaySettingChip key={def.key} os={os} def={def} compact={compact} />)}
                </ToggleChips>
            );
        }
        return seg.defs.map(def => <OverlaySettingRow key={def.key} os={os} def={def} compact={compact} />);
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
 * not "Switches" or "Geometry". Sorted by kind, the switch that draws an event
 * header's top strip ended up in a section of switches, five rows from the
 * strip's own settings, and a producer had to know which of three sections to
 * look in. Grouped by region there is one place to look, and the panel reads as
 * a scale model of the thing it configures — the same rule the Lower Third
 * stage's five always-open columns already follow.
 *
 * A group is a region, NOT a partition: a control that places two regions
 * RELATIVE TO EACH OTHER belongs with the pair, which is why the Event Header's
 * two band offsets sit together under "Both bands" rather than one under each
 * band. Region-grouping asks where a producer will look for a control, and they
 * look where the answer is comparable — nothing is gained by splitting a top
 * inset from the bottom inset it is being balanced against.
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
 *
 * `size` is the source's ?size= code, and it FILTERS: the scoreboard's three
 * sizes are one layout file with one `<meta>`, so a setting whose part exists
 * only at some of them is dropped here rather than offered everywhere (ELO on
 * the Small board, which has no completed-game cluster to draw it in). See
 * settingReachesSize.
 */
export const ElementStyleSettings = memo(function ElementStyleSettings({ type, board, label, exclude, size }) {
    const ns = board != null ? `${type}.${board}` : type;
    const os = useOverlaySettings(type, ns, label ?? type, board ?? null);
    const defs = useLiveDefs(type, (LAYOUT_SETTINGS[type] ?? []).filter(
        def => RENDERABLE.has(def.type)
            && !exclude?.includes(def.key)
            && settingReachesSize(def, type, size),
    ));
    if (defs.length === 0) return null;
    return (
        <div className={KIT_SECTION}>
            <Text size="xs" className="label-display text-muted-foreground">Style</Text>
            <SettingGroups os={os} defs={defs} />
        </div>
    );
});

/*
 * ── PER-ELEMENT STYLE OVERRIDES ──────────────────────────────────────────────
 *
 * One global design key, pinned for ONE element: `overlays.{type}.accentColor`
 * read on top of `overlays.global.accentColor` by every mount that applies the
 * palette (`applyDesignSettings`, overlay-base.js — the `perAccent` / `perFont`
 * / `perBadge` / CARD_OVERRIDE_VARS reads).
 *
 * The mechanism never went away; its UI did. `OVERRIDABLE_GLOBAL_KEYS` and the
 * `<meta>` matching rule were written for a "+ Add style override" picker on
 * the old Setup tab, and when Setup became the Design tab the picker was
 * dropped and nothing on the console replaced it. What that left behind is the
 * argument for this section: a producer can have live per-element pins —
 * `overlays.eventheader.displayFont`, a transparent `overlays.statsbar.cardBg` —
 * driving the broadcast with no surface anywhere that shows them, and the only
 * control that touches them at all is Presets' "Reset all overrides", which
 * wipes the lot without naming one.
 *
 * THREE THINGS MUST AGREE before a key is offered:
 *   1. the global registry offers it (`OVERRIDABLE_GLOBAL_KEYS`),
 *   2. the layout DECLARES it (`<meta name="overlay-settings">`, read back
 *      through ../../layouts/layoutWhitelist),
 *   3. the mount can honour a PIN, not just the global
 *      (`OVERRIDE_CAPABLE_TYPES`), and the pin is read back on THIS type
 *      (`overrideReaches` — overlay-base reads the card surface and the text
 *      colour only for the types in its LAYOUT_VAR_MAP, and `showShadow`
 *      nowhere at all).
 * (3) is not implied by (2), and the difference is subtle enough to be worth
 * the extra list: both post-game callouts declare `accentColor, bodyFont, monoFont`
 * and genuinely honour them — but only the two FONT roles are per-element
 * pinnable: those mounts call `OverlayBase.applyTypeRoles(ns)` with their own
 * namespace, while the accent is still read straight off
 * `overlays.global.accentColor` and never through applyDesignSettings, which is
 * the only other code that consults `overlays.{type}.{key}`. Believing the meta
 * alone would put an accent row on each that stores, broadcasts, and is ignored.
 *
 * WHY THESE ROWS ARE DISABLED AND NOT DROPPED, unlike `useLiveDefs` above.
 * Both answer the same fact — the active package paints this element itself, so
 * the app palette can't reach it — and they answer it differently ON PURPOSE.
 * An element's own `appPalette` setting (the Stat Card's Stat Value Color) has
 * nowhere else to live, so a dead row is pure noise and goes. An override is a
 * pin on a GLOBAL key that still exists, still has a value, and may already be
 * SET on this element from a preset or an earlier package — so the producer
 * needs to see that it is there and that it is currently doing nothing. Hiding
 * it is how `overlays.statsbar.cardBg` went invisible in the first place.
 */

const NO_DEFS = [];

// The keys this element may pin. Registry ∩ the layout's own declaration, and
// only for a type whose mount applies the palette at all.
export function useOverrideDefs(type) {
    const whitelists = useLayoutWhitelists();
    return useMemo(() => {
        if (!OVERRIDE_CAPABLE_TYPES.includes(type)) return NO_DEFS;
        const defs = OVERRIDABLE_GLOBAL_KEYS.filter(
            // Declared by the layout AND actually read back on this type. The
            // second half is not redundant: scoreboard.html whitelists
            // `showShadow`, and no mount anywhere reads a per-element one.
            // A `partner` is the colour half of a colour-and-size row and is
            // reached THROUGH its primary, never offered beside it.
            def => !def.partner
                && declaresAny(whitelists, type, def.meta) && overrideReaches(def.key, type),
        );
        return defs.length ? defs : NO_DEFS;
    }, [type, whitelists]);
}

/*
 * The pinned values, read from EXACTLY the namespace the write goes to.
 *
 * Not `resolveSetting`: that merges the bare `overlays.{type}.{key}` leaf under
 * a board-scoped read as a legacy fallback, which is right for an element
 * setting and wrong here — `applyDesignSettings` reads the override from the
 * scoped namespace alone (`overrideNs`), so a value the panel merged in from
 * the bare leaf would show as pinned while the overlay ignored it.
 */
function useOverrideBag(ns) {
    return useSettingsStore(useShallow((s) => {
        let cur = s?.overlays;
        for (const seg of ns.split('.')) cur = cur?.[seg];
        const out = {};
        for (const def of OVERRIDABLE_GLOBAL_KEYS) {
            const v = cur?.[def.key];
            if (v != null) out[def.key] = v;
        }
        return out;
    }));
}

// What this key resolves to with nothing pinned here — shown as the row's
// placeholder so an unpinned row still says what the element is currently doing.
function useGlobalValues() {
    return useSettingsStore(useShallow((s) => {
        const g = s?.overlays?.global ?? {};
        const out = {};
        for (const def of OVERRIDABLE_GLOBAL_KEYS) {
            out[def.key] = g[def.key] ?? GLOBAL_DESIGN_DEFAULTS[def.key] ?? null;
        }
        return out;
    }));
}

const SWITCH_OPTIONS = [
    // "Global" rather than "Inherit" or "Default": the producer set it on the
    // Design tab and that is what the tab is called. Three states because an
    // override of a boolean has to be able to say OFF — a two-state switch
    // cannot distinguish "pinned off" from "not pinned".
    { value: 'global', label: 'Global' },
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
];

/*
 * What an override starts at when the producer adds it: the value the element
 * is ALREADY showing. Adding a row must not change the broadcast — it hands
 * over a knob, it does not turn one.
 *
 * Every def has to resolve to something non-null or the write would mean
 * "unpinned" and the row would not appear at all; `designConstants.test.js`
 * pins that for the whole table.
 */
/*
 * The colour half of a paired def, as a def in its own right — `os.set` needs a
 * `key` for the write and a `label` for the staged-change line, and the partner
 * carries both. Looked up rather than synthesised so the staging list says
 * "Font Border Color" and not something this file made up.
 */
export function partnerOf(def) {
    return OVERRIDABLE_GLOBAL_KEYS.find(d => d.key === def.colorKey) ?? null;
}

export function seedValue(def, globals) {
    return globals[def.key]
        ?? (def.seedFrom ? globals[def.seedFrom] : null)
        ?? def.defaultValue
        ?? null;
}

const OverrideRow = memo(function OverrideRow({
    os, def, pinned, pinnedColor, globalValue, disabled, note, onRemove,
}) {
    const pending = usePending(`settings:${settingKey(os.ns, def.key)}`);
    const value = pending ? pending.value : pinned;
    const staged = !!pending;
    const set = (v) => os.set(def, v);
    // The colour half of a paired row. Hooks are unconditional, so a def with
    // no partner watches a harmless undefined key.
    const colorPending = usePending(
        def.colorKey ? `settings:${settingKey(os.ns, def.colorKey)}` : undefined,
    );
    const colorValue = colorPending ? colorPending.value : pinnedColor;
    const colorStaged = !!colorPending;
    const setColor = (v) => os.set(partnerOf(def), v);
    // A placeholder can't render an object or a boolean, and a long rgba() eats
    // the field — so the hint is the value for the shapes that fit and the word
    // for the rest.
    const hint = globalValue == null || globalValue === ''
        ? 'Global'
        : `Global · ${globalValue}`;

    const control = (() => {
    if (def.type === 'switch') {
        const state = value == null ? 'global' : (value ? 'on' : 'off');
        return (
            <SegmentedRow
                label={def.label} value={state} data={SWITCH_OPTIONS} fill={false}
                disabled={disabled}
                onChange={(v) => set(v === 'global' ? null : v === 'on')}
            />
        );
    }
    if (def.type === 'number') {
        /*
         * A size with a COLOUR is one row: the swatch and hex read like every
         * other colour row on the panel, and the size sits where the opacity
         * box used to. Which control carries the row's LABEL follows what the
         * pair is called — "Font Border" is a border, and its width is the half
         * that decides whether there is one at all (0 is off), so the colour
         * takes the label position and the number rides beside it.
         */
        if (def.colorKey) {
            return (
                <ColorRow
                    label={def.label} value={colorValue ?? null}
                    staged={staged || colorStaged} disabled={disabled}
                    placeholder="Global" hideReset alpha
                    onChange={(v) => setColor(v)}
                    trailing={
                        <>
                            <NumberField
                                value={value ?? null} staged={staged} disabled={disabled}
                                min={def.min} max={def.max} step={def.step}
                                ariaLabel={`${def.label} size`}
                                placeholder={globalValue == null ? '' : String(globalValue)}
                                onChange={(v) => set(v)}
                            />
                            {def.suffix && (
                                <Text size="xs" span dimmed className="shrink-0">{def.suffix}</Text>
                            )}
                        </>
                    }
                />
            );
        }
        return (
            <NumberRow
                label={def.label} value={value ?? null} staged={staged} disabled={disabled}
                min={def.min} max={def.max} step={def.step} suffix={def.suffix}
                placeholder={globalValue == null ? '' : String(globalValue)}
                onChange={(v) => set(v)}
            />
        );
    }
    if (def.type === 'font') {
        return (
            <FieldRow label={def.label} staged={staged}>
                <FontCombobox
                    pinned={TYPE_ROLE_DEFAULTS}
                    role={def.role}
                    value={value ?? globalValue ?? ''}
                    disabled={disabled}
                    onChange={(v) => set(v || null)}
                />
            </FieldRow>
        );
    }
    // 'color' and 'color-opacity' alike, and the type is what decides whether
    // the row gets an opacity field. The swatch RENDERS an rgba() fine — the
    // browser parses it and shows the right colour — so the old note here that
    // it "falls back to black" was wrong; what it cannot do is give the alpha
    // BACK, because a native colour input returns `#rrggbb` and nothing else.
    // Reading the row was never the problem. Editing it was.
    return (
        <ColorRow
            label={def.label} value={value ?? null} staged={staged} disabled={disabled}
            placeholder={hint} hideReset alpha={def.type === 'color-opacity'}
            onChange={(v) => set(v)}
        />
    );
    })();

    // Every control here can already return to Global on its own (the switch's
    // third state, the colour's reset, a blank number). The explicit × is what
    // makes the SECTION legible: rows are a list the producer added to, so
    // there has to be one obvious way to take one back out that reads the same
    // on all four control shapes.
    //
    // AND IT IS NEVER DISABLED — `disabled` reaches the value control only. A
    // full-art package makes a pin inert, not permanent: the row is kept
    // visible under one precisely so the producer can still take it off ("a pin
    // you cannot see is a pin you cannot remove"), and greying the × out was
    // the one thing that defeated the reason it was kept. Removing is also the
    // only act here that still MEANS something under a full-art package — the
    // pin is stored, and it comes back the moment the package changes.
    //
    // The tooltip rides the WRAPPER, not the controls: a disabled input is not
    // a reliable hover target, and the answer is about the row as a whole.
    return (
        <div className="flex min-w-0 items-center gap-1" title={disabled ? note : undefined}>
            <div className="min-w-0 flex-1">{control}</div>
            <button
                type="button" onClick={onRemove}
                aria-label={`Remove ${def.label} override`}
                title={disabled
                    ? 'Remove override — it does nothing under this package, but it is still stored'
                    : "Remove override — back to the Design tab's value"}
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
                <X size={12} />
            </button>
        </div>
    );
});

/*
 * Which keys are ON this element right now.
 *
 * The stored pin is not the whole answer: under confirm mode an added override
 * is STAGED, so a section that listed only stored pins would drop the row the
 * instant the producer added it and hand back a blank panel. A key with a
 * pending write is as much a member of the list as one with a stored value.
 */
function useAddedKeys(ns, pinned) {
    const staged = useStagingStore(useShallow((s) => {
        const out = [];
        for (const def of OVERRIDABLE_GLOBAL_KEYS) {
            const entry = s.pending[`settings:${settingKey(ns, def.key)}`];
            // A staged UNPIN is a staged removal — the row stays until commit,
            // but it is on its way out, not on its way in.
            if (entry !== undefined && entry.value != null) out.push(def.key);
        }
        return out;
    }));
    return useMemo(() => {
        const keys = new Set(staged);
        for (const [key, value] of Object.entries(pinned)) if (value != null) keys.add(key);
        return keys;
    }, [staged, pinned]);
}

/*
 * The picker. Only keys this element does not already carry, and — because a
 * key that cannot reach the element is not a choice, it is a trap — only keys
 * `useOverrideDefs` already filtered down to the ones it does reach.
 */
const AddOverride = memo(function AddOverride({ defs, onAdd, disabled, title }) {
    const [open, setOpen] = useState(false);
    const trigger = (
        <Button size="xs" variant="secondary" className="h-7 self-start" disabled={disabled} title={title}>
            <Plus size={12} />
            <span>Add style override</span>
        </Button>
    );
    // A disabled Button is `pointer-events-none`, so a title on it can never be
    // hovered — the whole explanation would be unreachable exactly when it is
    // the only explanation there is. The wrapper is what the pointer can hit.
    if (disabled || defs.length === 0) {
        return <span title={title} className="self-start">{trigger}</span>;
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-1">
                <div className="flex flex-col">
                    {defs.map(def => (
                        <button
                            key={def.key} type="button"
                            onClick={() => { setOpen(false); onAdd(def); }}
                            className="rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
                        >
                            {def.label}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
});

/**
 * The "Style overrides" section — the global design keys pinned ON this element.
 *
 * Added one at a time from the picker, never listed in full. Every key here is
 * a knob that already has a home on the Design tab, and rendering all thirteen
 * on every element made a wall of controls whose overwhelming answer was
 * "Global" — the section read as configuration when it is an exception list.
 * So a row exists because the producer put it there, and removing it is what
 * hands the element back to the global.
 *
 * Adding PINS the key at the value the element is currently showing, which is
 * the one honest starting point: it changes nothing on air, and it is a real
 * value the producer can then move. There is deliberately no unset-but-present
 * row — that would be a second source of truth for "is this overridden".
 *
 * @param type  the element's SETTINGS type (`settingsTypeOf`, not the id)
 * @param board board id for the URL-scoped elements, else null
 * @param size  the source's ?size= code, for the scoreboard's three theme files
 */
/*
 * ADDING AND REMOVING ARE PAIR OPERATIONS. A row that draws two keys has to own
 * both, or the × takes the size off and leaves the colour pinned — invisible,
 * unremovable, and revived the next time the row is added.
 *
 * Both writes go through `os.set`, so under confirm mode they stage as two
 * entries of one gesture and land together.
 */
function addPair(os, def, globals) {
    os.set(def, seedValue(def, globals));
    const partner = partnerOf(def);
    if (partner) os.set(partner, seedValue(partner, globals));
}

function removePair(os, def) {
    os.set(def, null);
    const partner = partnerOf(def);
    if (partner) os.set(partner, null);
}

export const ElementStyleOverrides = memo(function ElementStyleOverrides({
    type, board, label, size, leading,
}) {
    const ns = board != null ? `${type}.${board}` : type;
    const os = useOverlaySettings(type, ns, label ?? type, board ?? null);
    const defs = useOverrideDefs(type);
    const pinned = useOverrideBag(ns);
    const globals = useGlobalValues();
    // The stem is a function of the SIZE for the scoreboard, whose three theme
    // files a package may tier differently.
    const stem = themeElementFor(type, size);
    const painted = usePaintedByApp(stem);
    const roles = useDrawnTypeRoles(stem);
    const packages = useDesignPackages();
    const activeId = useSettingsStore(s => s?.overlays?.global?.designPackage) ?? 'default';
    const added = useAddedKeys(ns, pinned);

    /*
     * IS THIS KEY LIVE ON THE ELEMENT UNDER THE ACTIVE PACKAGE — two questions,
     * because type is not palette.
     *
     * A palette key is dead under a package that paints the element itself. A
     * FONT ROLE is not: the roles survive `clearDesignSettings`, so a pin reaches
     * a full-art theme as well as a token skin — what kills it instead is the
     * theme setting nothing in that role (default's Commentary has no numerals).
     * Gating the fonts on the palette tier locked them on every themed element
     * under `default`, which paints all of them itself; gating them on nothing
     * offered a Numeral Font on elements with no numbers.
     *
     * `roles` is null for an element no theme draws (Player Name, Event Header)
     * or before the package list lands; there the layout's own whitelist, which
     * `useOverrideDefs` already applied, is the whole answer.
     */
    const live = useCallback(
        d => (d.role ? roles == null || roles.includes(d.role) : painted),
        [roles, painted],
    );

    // A paired row counts as ON if EITHER half is pinned. Settings written
    // before the two became one row can hold a colour with no size beside it,
    // and a row that only looked at its primary would leave that colour stored,
    // undrawn and with no × to reach it.
    const { on, off } = useMemo(() => {
        const isOn = d => added.has(d.key) || (d.colorKey && added.has(d.colorKey));
        return { on: defs.filter(isOn), off: defs.filter(d => !isOn(d)) };
    }, [defs, added]);
    // The picker offers only what would do something — a dead key is never
    // offered, while a dead key already PINNED keeps its row (below).
    const addable = useMemo(() => off.filter(live), [off, live]);

    // `leading` still renders with no overridable keys — it is a guest on this
    // section's footer row, not part of it, and an element whose theme offers
    // nothing to pin must not silently lose its intro control with the section.
    if (defs.length === 0) return leading ? <div className={KIT_SECTION}>{leading}</div> : null;
    const pkgName = packages?.find(p => p.id === activeId)?.name || activeId;
    // The whole explanation of a dead control, as a tooltip on the dead control
    // — it was a two-line paragraph standing above the section, which is a lot
    // of panel spent on a state most producers are never in. Naming the package
    // is the part that matters: "these don't work" without saying what owns the
    // look leaves the producer where the Design tab's silent knobs left them.
    const paintedNote = `${pkgName} paints this element itself`;
    const deadNote = d => (d.role
        ? `${pkgName} sets nothing on this element in the ${d.label}`
        : paintedNote);

    return (
        <div className={KIT_SECTION}>
            {/* THE HEADING IS THE LIST'S, NOT THE BUTTON'S. Nothing is on an
                element until the producer adds it, so the common state of this
                section is a caps heading standing over one ghost button that
                already says "Add style override" — a second name for the only
                thing under it, in the register this pass keeps deleting. With a
                list to head it comes back. The DIVIDER stays either way: it is
                what says the button below it starts a new group rather than
                belonging to the style settings above. */}
            {on.length > 0 && (
                <Text size="xs" className="label-display text-muted-foreground">Style overrides</Text>
            )}
            {/* Existing pins stay VISIBLE when the active package leaves them
                nothing to reach — a full-art palette, or a theme that sets no
                text in that font role — rather than dropping out: a pin the
                producer cannot see is a pin they cannot remove, and it starts
                working again the moment they swap packages. The picker is what
                closes, because adding one there would do nothing. */}
            {on.map(def => (
                <OverrideRow
                    key={def.key} os={os} def={def}
                    pinned={pinned[def.key] ?? null}
                    pinnedColor={def.colorKey ? (pinned[def.colorKey] ?? null) : null}
                    globalValue={globals[def.key]}
                    disabled={!live(def)} note={deadNote(def)}
                    onRemove={() => removePair(os, def)}
                />
            ))}
            {/* THE FOOTER ROW TAKES A GUEST. `leading` is the stage's intro
                control (./intro.jsx) — the panel's other panel-level, set-once
                control, which had a near-empty row of its own directly above
                this one. Two lonely rows with most of a panel's width dead
                beside each is a worse answer than one shared row, so the guest
                sits left and the Add button is pushed right to meet it. With no
                guest the button keeps its natural left edge: the spacer only
                exists when there is something for it to push away from. */}
            <div className="flex min-w-0 items-center gap-2">
                {leading}
                {leading && <div className="flex-1" />}
                <AddOverride
                    defs={addable}
                    disabled={addable.length === 0}
                    title={
                        addable.length > 0 ? undefined
                            : painted || off.length === 0 ? 'Every override this element reads is already on it'
                                : paintedNote
                    }
                    onAdd={(def) => addPair(os, def, globals)}
                />
            </div>
        </div>
    );
});

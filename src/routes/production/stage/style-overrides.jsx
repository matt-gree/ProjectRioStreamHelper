import { memo, useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../../context/store';
import { usePending, useStagingStore } from '../../../context/staging';
import { Text } from '../../../components/ui/primitives';
import {
    OVERRIDABLE_GLOBAL_KEYS, GLOBAL_DESIGN_DEFAULTS, OVERRIDE_CAPABLE_TYPES, TYPE_ROLE_DEFAULTS, themeElementFor, overrideReaches,
} from '../../design/designConstants';
import { usePaintedByApp, useDrawnTypeRoles, useDesignPackages } from '../../design/designPackage';
import { useLayoutWhitelists, declaresAny } from '../../design/layoutWhitelist';
import { FontCombobox } from '../../../components/ui/font-combobox';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { Plus, X } from 'lucide-react';
import { SegmentedRow, NumberRow, NumberField, ColorRow, FieldRow, KIT_SECTION } from '../kit';
import { settingKey, useOverlaySettings } from './overlay-settings';

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
 *      through ../../design/layoutWhitelist),
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
 * WHY THESE ROWS ARE DISABLED AND NOT DROPPED, unlike `useLiveDefs` in ./overlay-settings.
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

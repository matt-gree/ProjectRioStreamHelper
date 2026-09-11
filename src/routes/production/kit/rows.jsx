import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { Switch } from '../../../components/ui/switch';
import { Button } from '../../../components/ui/button';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { HexColorPicker, RgbaStringColorPicker } from 'react-colorful';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { parseRgba, toRgba, isCompleteColor } from '../../../lib/colors';
import { KIT_INPUT, KIT_LABEL } from './tokens';

/*
 * The row kit — the shapes every console surface (rack rows, rail cards,
 * stage bodies) composes from. 28px control rhythm: every row is min-h-7,
 * every control inside is h-7 or smaller. The cheap path and the cohesive
 * path are the same path — a bespoke panel should be harder to write than a
 * conforming one (production-console-contract skill).
 *
 * Rows are presentational: callers own state and the staging gateway
 * (stageOrRun) and pass plain values/handlers down. `staged` renders the
 * amber pending tint used app-wide.
 *
 * A row's label is drawn beside its control, not wired to it — the label is a
 * <Text> span, so nothing associates the two. `named()` closes that: the
 * control takes the label as its accessible name, which is what makes a field
 * findable by what it is (by a screen reader, and by a test) rather than only
 * by the placeholder it loses the moment it holds a value.
 */

const ROW = 'flex min-h-7 items-center gap-2';

// Only a string label can be an accessible name; a node label (an icon, a
// composed fragment) is left to the caller's own aria-label.
const named = (label) => (typeof label === 'string' && label ? label : undefined);

const normalize = (opts = []) =>
    opts.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));

// The inline label every control row draws to the left of its control, in one
// place: it carries the amber staged tint, and a row that spelled it out for
// itself was a row that could be missed when that tint changed. `null` for an
// absent label so a row can drop it in directly.
const RowLabel = ({ label, staged, tone }) => (label == null ? null : (
    <Text size="xs" span truncate className={cn(KIT_LABEL, tone || (staged ? 'text-amber-400' : 'text-muted-foreground'))}>
        {label}
    </Text>
));

/*
 * The SUBJECT row — what the element is currently drawing. A readout, not a
 * control, and the only row in the kit with no interaction at all.
 *
 * It exists because every other row in this file answers "what can I do to
 * this", and the console had nothing that answered "what is this showing".
 * Five stage bodies had each invented their own version of it (the hit
 * visualizer's latest-hit line, the matchup's fetched series, the bracket's
 * drawing-phase note, the capture desk's score, the controller's status); this
 * is that pattern named, so the rail can carry it too.
 *
 * No dot and no colour by default. The console's hues are spoken for (emerald
 * AIR · sky PVW · rio DESK · amber staged) and a sixth meaning would either
 * collide or dilute, so the tiering is type: the subject in foreground, its
 * qualifier dimmed beside it. `tone="warn"` is the one exception and means the
 * same thing amber means in the bodies — something is off and you'd want to
 * know before it's on air.
 */
export const SubjectRow = memo(function SubjectRow({ text, meta, tone, title, className }) {
    if (!text) return null;
    return (
        <div className={cn(ROW, 'gap-1.5', className)} title={title || undefined}>
            {/* tabular-nums: a subject is the one row that changes UNDER the
                producer — a score, a count, an inning — and proportional digits
                reflow the whole line every time one ticks over. */}
            <Text
                size="xs" span truncate
                className={cn('tabular-nums min-w-0', tone === 'warn' ? 'text-amber-500/90' : 'text-foreground')}
            >
                {text}
            </Text>
            {meta != null && meta !== '' && (
                <Text size="xs" span truncate dimmed className="min-w-0 shrink-0">{meta}</Text>
            )}
        </div>
    );
});

/*
 * label · switch — source visibility, sub-plate toggles.
 *
 * The switch sits in the SAME control column as every other row's control
 * (KIT_LABEL), not pinned to the far right. It was the one kit row using
 * `justify-between`, which on a stage panel threw the switch ~550px from its
 * own label and stranded it in a second column nothing else used: a Scorecard's
 * three band switches lined up on the right edge while every input beside them
 * started on the left. Aligned, a panel reads as one column of controls.
 *
 * `spread` restores the pinned-right layout for NARROW surfaces — the rail card
 * and rack row, which are not `@container`s, so KIT_LABEL stays at its 64px
 * floor there and would clip a label like "Container on air". Those rows carry
 * one toggle and no input to align with, so there is no column to join.
 */
export const ToggleRow = memo(function ToggleRow({
    label, checked, onChange, disabled, staged, spread, title, className,
}) {
    const tone = staged ? 'text-amber-400' : 'text-foreground';
    // `title` on the LABEL, not the Switch: a disabled control doesn't see the
    // pointer, so a tooltip on it is unreachable exactly when the row is
    // disabled and the tooltip is the only thing saying why.
    return (
        <label title={title || undefined} className={cn(ROW, spread && 'justify-between', className)}>
            <Text
                size="xs" span truncate
                className={cn('min-w-0', spread ? tone : cn(KIT_LABEL, tone))}
            >
                {label}
            </Text>
            <Switch size="sm" checked={!!checked} onCheckedChange={onChange} disabled={disabled} />
        </label>
    );
});

/*
 * A run of booleans as pressed chips — for a set of PARTS OF ONE ELEMENT,
 * where ToggleRow is for a setting that stands on its own.
 *
 * A switch spends a 28px full-width row on one bit, with the label pinned left
 * and the control pinned right. Eight of them (the event header's bands and
 * fields) cost ~224px, and reading "what is showing" means crossing that empty
 * gutter eight times. But the deeper problem is that those eight are not eight
 * settings: they are one multi-select over the overlay's anatomy. A chip strip
 * renders it as one — state IS the fill, so the answer is a single glance, and
 * the set reads as a set.
 *
 * NOT a replacement for ToggleRow. A lone consequential boolean (a band's own
 * on/off, the intro animation) keeps its row: the switch's size is an
 * affordance there, and one chip alone in a strip reads as a fragment rather
 * than a set. The rule that picks between them lives in
 * ../stage/overlay-settings (`chunkDefs`).
 *
 * Tiered by WEIGHT, not by a new hue — the same reasoning as SubjectRow above.
 * The console's colours are spoken for (emerald AIR · sky PVW · rio DESK ·
 * amber staged) and "this part is drawn" is not any of them, so on is
 * foreground + fill and off is muted + hairline. Amber still means staged.
 */
export const ToggleChip = memo(function ToggleChip({
    label, checked, onChange, disabled, locked, staged, title, ariaLabel, className,
}) {
    return (
        <button
            type="button"
            onClick={() => { if (!locked) onChange?.(!checked); }}
            disabled={disabled}
            /*
             * `locked` is NOT `disabled`, for two reasons that both matter here.
             *
             * Weight: `disabled:opacity-40` fades the whole chip, and a locked
             * chip is by definition an ON one — faded, it lands dimmer than the
             * OFF chips beside it and the strip reads backwards. Locked keeps
             * full contrast and marks itself with a dashed edge: on, but not by
             * your hand.
             *
             * Reach: a natively disabled button never sees the pointer, so its
             * own `title` is unreachable exactly when it is the only thing
             * saying why the chip won't move (the trap AddOverride wraps its
             * trigger to dodge). aria-disabled says the same to a screen reader
             * while leaving hover alive.
             */
            aria-disabled={locked || undefined}
            aria-pressed={!!checked} title={title || undefined}
            /* `ariaLabel` for a chip whose text names the SETTING but not the
               thing it applies to — two "Home" chips, one per side, are two
               buttons with the same accessible name until the side is in it.
               Same escape hatch TextRow's ariaLabel is. */
            aria-label={ariaLabel || undefined}
            className={cn(
                'flex h-6 shrink-0 items-center rounded-md border px-2 text-xs transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-40',
                locked && 'cursor-not-allowed border-dashed',
                staged ? 'border-amber-400/60 bg-amber-400/10 text-amber-400'
                    : checked ? 'border-foreground/25 bg-foreground/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                className,
            )}
        >
            <span className="min-w-0 truncate">{label}</span>
        </button>
    );
});

// The strip a run of ToggleChips sits in. `empty:hidden` so a run whose every
// chip is gated out by showWhen collapses instead of leaving the group's gap.
export const ToggleChips = memo(function ToggleChips({ children, className }) {
    return (
        <div className={cn('flex min-h-7 flex-wrap items-center gap-1 empty:hidden', className)}>
            {children}
        </div>
    );
});

// label · dropdown — board pick, content pick, spotlight scene.
// `options` accepts strings or { label, value, disabled }.
export const SelectRow = memo(function SelectRow({
    label, value, onChange, options, placeholder, disabled, staged, className,
}) {
    return (
        <div className={cn(ROW, className)}>
            <RowLabel label={label} staged={staged} />
            <select
                className={cn(KIT_INPUT, 'min-w-0 flex-1', staged && 'border-amber-400/60 text-amber-400')}
                value={value ?? ''}
                aria-label={named(label)}
                disabled={disabled}
                onChange={(e) => onChange?.(e.target.value)}
            >
                {placeholder != null && <option value="">{placeholder}</option>}
                {normalize(options).map((o) => (
                    <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
                ))}
            </select>
        </div>
    );
});

// label · number input — spotlight hold, and other bounded numeric knobs the
// producer sets while working. Commits on change like every other kit row;
// callers that need debouncing own it.
/*
 * The typing contract for a number, extracted because two rows now need it: the
 * plain NumberRow and the size half of a colour-and-size row. See NumberField
 * below for the input it drives; the rules live here.
 */
function useNumberDraft(value, onChange, debounceMs) {
    const shown = value == null ? '' : String(value);
    const [draft, setDraft] = useState(shown);
    const draftRef = useRef(shown);
    const editing = useRef(false);
    const timer = useRef(null);
    const cb = useRef(onChange);
    cb.current = onChange;

    // An outside change reaches the field only while it is NOT being edited, or
    // it would yank the cursor's value out from under whoever is typing.
    useEffect(() => {
        if (editing.current) return;
        draftRef.current = shown;
        setDraft(shown);
    }, [shown]);

    const commit = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        if (!editing.current) return;
        editing.current = false;
        const t = draftRef.current;
        if (t === '') return cb.current?.(null);
        const n = Number(t);
        // A number input reports '' for anything it cannot parse, so this is
        // belt and braces — but a NaN here would be stored and drawn.
        if (!Number.isNaN(n)) cb.current?.(n);
    }, []);

    // A stage that swaps out from under a typed number should keep it.
    useEffect(() => commit, [commit]);

    const type = useCallback((v) => {
        draftRef.current = v;
        setDraft(v);
        editing.current = true;
        if (timer.current) clearTimeout(timer.current);
        if (v !== '') timer.current = setTimeout(commit, debounceMs);
    }, [commit, debounceMs]);

    return { draft, type, commit };
}

/*
 * The bare number input — no row, no label. For a row that already has both and
 * needs a number in it (the colour-and-size override rows).
 */
export const NumberField = memo(function NumberField({
    value, onChange, min, max, step, disabled, staged, placeholder, ariaLabel,
    className, debounceMs = 300,
}) {
    const { draft, type, commit } = useNumberDraft(value, onChange, debounceMs);
    return (
        <input
            type="number" min={min} max={max} step={step} disabled={disabled}
            aria-label={ariaLabel}
            placeholder={placeholder}
            value={draft}
            onChange={(e) => type(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            className={cn(
                KIT_INPUT, 'w-14 shrink-0 text-center',
                staged && 'border-amber-400/60 text-amber-400',
                className,
            )}
        />
    );
});

export const NumberRow = memo(function NumberRow({
    label, value, onChange, min, max, step, suffix, disabled, staged, placeholder, className,
    debounceMs = 300,
}) {
    /*
     * KEYSTROKES ARE LOCAL, and an EMPTY FIELD IS NEVER COMMITTED ON A TIMER.
     *
     * Writing per keystroke put every value passed through on the way onto the
     * broadcast — typing 120 draws a 1-px band, then 12 — and each one is a
     * settings write that reaches the whole rig. That much this shares with
     * TextRow.
     *
     * The empty rule is the one a number needs on its own, and it is the
     * difference between a field a producer can retype and one they cannot.
     * Blank means "back to the default" here (`v ?? def.defaultValue` at the
     * style-override call site), so on a timer, clearing the field to type a
     * new number wrote the DEFAULT into it a third of a second later and
     * refilled the box under the cursor — the Event Header's Font Size snapped
     * back to 34 before a replacement could be typed. Clearing is only an
     * answer once the producer has left the field, so an empty draft commits on
     * BLUR alone; a typed number still settles by itself.
     */
    const { draft, type, commit } = useNumberDraft(value, onChange, debounceMs);

    return (
        <div className={cn(ROW, className)}>
            <RowLabel label={label} staged={staged} />
            <input
                type="number" min={min} max={max} step={step} disabled={disabled}
                aria-label={named(label)}
                // A blank number row means "nothing pinned here" for a style
                // override, and the placeholder is where the inherited value
                // shows through. Every other caller passes none and gets today's
                // empty field.
                placeholder={placeholder}
                value={draft}
                onChange={(e) => type(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
                className={cn(KIT_INPUT, 'w-20', staged && 'border-amber-400/60 text-amber-400')}
            />
            {suffix && <Text size="xs" span dimmed className="shrink-0">{suffix}</Text>}
        </div>
    );
});

/*
 * label · slider · % readout — a 0..1 fraction the producer judges BY EYE.
 *
 * A number field is the wrong control for one of these, and not merely a less
 * pleasant one. It accepts values the setting does not have: asked for an
 * opacity, a producer reads "Idle Fill Opacity" and types `10` meaning ten
 * percent, which is off the 0..1 scale by a factor of a hundred and lands as
 * fully solid. A slider cannot express that — the range IS the scale — and
 * showing the percentage removes the ambiguity that invited the number.
 *
 * Fraction in, fraction out. The percent exists only between `value` and the
 * DOM, so callers and storage never see a second unit.
 */
export const FractionRow = memo(function FractionRow({
    label, value, onChange, step = 0.05, disabled, staged, className,
}) {
    // Clamped for DISPLAY as well as storage. A settings file written before
    // this was a slider can hold anything, and a readout of "1000%" beside a
    // thumb pinned at the far end explains nothing about what is drawing.
    const shown = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
    const pct = Math.round(shown * 100);
    return (
        <div className={cn(ROW, className)}>
            <RowLabel label={label} staged={staged} />
            <input
                type="range" min={0} max={100} step={Math.round(step * 100)} disabled={disabled}
                aria-label={named(label)}
                value={pct}
                onChange={(e) => onChange?.(Number(e.target.value) / 100)}
                className={cn(
                    'h-1 min-w-0 flex-1 cursor-pointer accent-[#60a5fa]',
                    staged && 'accent-amber-400',
                )}
            />
            <Text
                size="xs" span dimmed
                className={cn('w-10 shrink-0 text-right tabular-nums', staged && 'text-amber-400')}
            >
                {pct}%
            </Text>
        </div>
    );
});

/*
 * Keystrokes are LOCAL; commits are not.
 *
 * A console text field writes to State or Settings, and both broadcast to every
 * overlay in the rig. Committing per keystroke meant typing "Winners Final"
 * sent thirteen writes — and on the receiving end each one changed the lower
 * third's content identity, so its intro animation replayed on every letter
 * (user report, 2026-08-01). It also spends the socket budget of an app whose
 * whole job is to stay out of the game's way.
 *
 * So the input echoes what you type immediately and the write lands once you
 * stop. Three rules keep that from eating an edit:
 *   • blur commits now — tabbing away is done typing;
 *   • unmount commits now — selecting another lower-third slot mid-word
 *     destroys this field, and the keystrokes still have to land;
 *   • an upstream change is only adopted while nothing is pending, so a
 *     reorder or another surface's edit still reaches the field, but never
 *     overwrites a half-typed word.
 */
function useDebouncedText(value, onChange, ms) {
    const [draft, setDraft] = useState(value ?? '');
    const draftRef = useRef(draft);
    const timer = useRef(null);
    const pending = useRef(false);
    const cb = useRef(onChange);
    cb.current = onChange;

    useEffect(() => {
        if (pending.current) return;
        draftRef.current = value ?? '';
        setDraft(value ?? '');
    }, [value]);

    const commit = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        if (!pending.current) return;
        pending.current = false;
        cb.current?.(draftRef.current);
    }, []);

    useEffect(() => commit, [commit]);

    const type = useCallback((v) => {
        draftRef.current = v;
        setDraft(v);
        pending.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            pending.current = false;
            cb.current?.(v);
        }, ms);
    }, [ms]);

    return [draft, type, commit];
}

// label · text input — a short authored string (header title, field separator,
// a card's custom bottom line). Debounced by default (see useDebouncedText);
// pass `debounceMs={0}` for a field that must land on the keystroke.
// `ariaLabel` names the input when the row draws no label of its own — the
// paired chip rows, where the chip beside the field is what names the band.
// Without it a labelless field would be reachable only by its placeholder,
// which disappears the moment it holds a value.
//
// `short` sizes the input to its content instead of filling the row — for a
// value that is a glyph or two (the event header's field separator, `◆`). A
// field states how much it expects: 300px of empty box around one character
// reads as a field that has lost its value, which is the same reason NumberRow
// has always been a fixed `w-20` rather than a flexed input.
//
// `inputClassName` restyles the INPUT, where `className` sits on the row — for a
// field that has to match the height of the pickers beside it (the Player
// Plates card's typed sub-plate, beside two 32px pickers).
export const TextRow = memo(function TextRow({
    label, value, onChange, placeholder, disabled, staged, debounceMs = 300, ariaLabel, short, className,
    inputClassName,
}) {
    const [draft, type, commit] = useDebouncedText(value, onChange, debounceMs);
    const deferred = debounceMs > 0;
    return (
        <div className={cn(ROW, className)}>
            <RowLabel label={label} staged={staged} />
            <input
                type="text" disabled={disabled} placeholder={placeholder}
                aria-label={ariaLabel || named(label)}
                value={deferred ? draft : (value ?? '')}
                onChange={(e) => (deferred ? type(e.target.value) : onChange?.(e.target.value))}
                onBlur={deferred ? commit : undefined}
                className={cn(
                    KIT_INPUT,
                    short ? 'w-14 shrink-0 text-center' : 'min-w-0 flex-1',
                    staged && 'border-amber-400/60 text-amber-400',
                    inputClassName,
                )}
            />
        </div>
    );
});

// label · swatch + hex — a per-overlay colour override. `value` null/'' means
// "use the theme default": the swatch falls back to black for the native
// picker but the field reads empty and shows a reset only once a colour is
// pinned, so onChange(null) is how the producer clears back to the default.
/*
 * `hideReset` is for a caller that owns removal ITSELF — the style-override
 * rows, where taking the value away means taking the whole row off the element,
 * and a second reset beside that one does the same thing under a different
 * word. Every other caller keeps the built-in reset.
 *
 * `alpha` is for a key whose value CARRIES ONE (the `color-opacity` defs —
 * cardBg, borderColor, textStrokeColor), and it picks which PICKER opens.
 *
 * THE SWATCH IS NOT A NATIVE COLOUR INPUT. `<input type="color">` is RGB-only
 * by specification: it renders no alpha channel — on macOS it hands you the
 * system colour panel with nothing to set one — and its value is always
 * `#rrggbb`, so on an alpha-carrying key it DESTROYED the alpha every time it
 * was touched. A card background pinned at rgba(…, 0.4) went fully opaque on
 * air the moment a producer nudged its hue. react-colorful's picker has the
 * alpha slider the platform control lacks, opens in the app instead of a system
 * panel, and is what the Design tab already uses for the very globals these
 * rows pin (routes/layouts/shared.jsx) — so the console and the Design tab now
 * ask for a colour the same way.
 *
 * THE FIELD SPEAKS HEX, whatever is stored. `rgba(125, 47, 47, 0.55)` is the
 * storage format, not a thing to read at a glance: it is twice the width of the
 * hex beside it on the next row, and the two rows of one panel then disagree
 * about what a colour even looks like. So an alpha-carrying key shows the same
 * `#7d2f2f` its opaque siblings do, and its opacity is read off the swatch —
 * which is checkered exactly so it can be — and set on the slider.
 *
 * TYPING still reaches the alpha, because otherwise dragging would be the only
 * way to set one: a typed `rgba()` or 8-digit `#rrggbbaa` names its own, while a
 * bare hex means "this colour, same opacity" and keeps the row's (`explicit`,
 * ../../../lib/colors). And it commits only COMPLETE colours — a field writing
 * every keystroke stores `#7d2` on the way to `#7d2f2f`, and `#7d2` is a valid
 * colour, so it would land on the broadcast as one.
 *
 * The field carries the row's label and the swatch is labelled as what it is, a
 * way to open a picker. That is the honest reading — and it keeps a colour row
 * drivable in a test without simulating a drag.
 */
const NO_ALPHA = { hex: '', opacity: 1 };

// Transparency has to be VISIBLE in a 32px chip or the swatch lies about every
// value the alpha slider exists to set: a card background at 0.1 and one at 1.0
// are the same flat rectangle over an opaque ground. It sits BEHIND the colour
// with nothing inset, so an opaque swatch is pure colour — a padding ring let
// the checks show around every chip on the panel, including the ones with no
// transparency to report.
const CHECKER = {
    backgroundImage: 'conic-gradient(#6b7280 0 25%, transparent 0 50%, #6b7280 0 75%, transparent 0)',
    backgroundSize: '8px 8px',
};

export const ColorRow = memo(function ColorRow({
    label, value, onChange, disabled, staged, placeholder = 'Default', className,
    hideReset, alpha, trailing,
}) {
    const has = value != null && value !== '';
    // Only split when the key actually carries an alpha — an opaque row would
    // pay a regex per render to answer a question it never asks.
    const { hex, opacity } = alpha ? parseRgba(has ? value : '#000000') : NO_ALPHA;

    /*
     * A drag across the picker fires continuously, and every one of these is a
     * settings write that broadcasts to the whole rig — so the picker's stream
     * is collapsed to its last value. Safe to hold the prop back: react-colorful
     * only re-seeds itself when `color` CHANGES, and it does not change while
     * the trailing edge is pending, so the picker never fights the drag.
     */
    const commit = useRef(null);
    useEffect(() => () => clearTimeout(commit.current), []);
    const pick = useCallback((next) => {
        clearTimeout(commit.current);
        commit.current = setTimeout(() => onChange?.(next), 120);
    }, [onChange]);
    // Normalised through our own formatter rather than stored as the library
    // spells it, so one shape reaches settings no matter who wrote it.
    const pickRgba = useCallback((s) => {
        const p = parseRgba(s);
        pick(toRgba(p.hex, p.opacity));
    }, [pick]);

    // What the field shows: hex on an alpha key, the stored value otherwise.
    const shown = has ? (alpha ? hex : value) : '';
    const commitText = useCallback((typed) => {
        const t = String(typed ?? '').trim();
        if (!t) return onChange?.(null);
        if (!isCompleteColor(t)) return;          // still being typed
        if (!alpha) return onChange?.(t);
        const p = parseRgba(t);
        onChange?.(toRgba(p.hex, p.explicit ? p.opacity : opacity));
    }, [alpha, onChange, opacity]);
    const [draft, type, commitDraft] = useDebouncedText(shown, commitText, 300);

    return (
        <div className={cn(ROW, className)}>
            <RowLabel label={label} staged={staged} />
            <Popover>
                <PopoverTrigger asChild disabled={disabled}>
                    <button
                        type="button" disabled={disabled} aria-label={`Pick ${label}`}
                        style={CHECKER}
                        className="h-7 w-8 shrink-0 overflow-hidden rounded-md border border-border disabled:opacity-50"
                    >
                        <span
                            className="block h-full w-full"
                            style={{ background: has ? value : 'transparent' }}
                        />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3">
                    {alpha ? (
                        <RgbaStringColorPicker
                            color={has ? value : 'rgba(0, 0, 0, 1)'}
                            onChange={pickRgba}
                        />
                    ) : (
                        <HexColorPicker color={has ? value : '#000000'} onChange={pick} />
                    )}
                </PopoverContent>
            </Popover>
            <input
                type="text" disabled={disabled} placeholder={placeholder} aria-label={label}
                value={draft}
                onChange={(e) => type(e.target.value)}
                onBlur={commitDraft}
                className={cn(KIT_INPUT, 'min-w-0 flex-1', staged && 'border-amber-400/60 text-amber-400')}
            />
            {/* A colour and the SIZE of the thing it paints are one control:
                a font border is a width and a colour, and asking for them on two
                rows made the panel claim they were two settings. */}
            {trailing}
            {has && !hideReset && (
                <button
                    type="button" onClick={() => onChange?.(null)} disabled={disabled}
                    aria-label={`Reset ${label}`}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                    <RotateCcw size={12} />
                </button>
            )}
        </div>
    );
});

/*
 * 1–3 equal-width buttons — push, replay/spotlight/split, capture.
 * Each action: { label, icon?, onClick, disabled?, variant?, title?, className? }.
 * `className` tints ONE action without promoting it to a different button size
 * or layout — the destructive-outline clear beside a plain sibling.
 *
 * `fit` sizes the buttons to their LABELS instead, left-aligned. Equal widths
 * are right on a rail card or a narrow stage panel, where three buttons filling
 * the row read as one segmented control. They stop being right the moment the
 * surface is wide: on the board desk a lone Clear stretched the full ~1200px of
 * the panel and the two post-game buttons took 600px each, so the region that
 * ends a game read as a stack of banners rather than a few controls. Reach for
 * `fit` on a full-width region, and leave it off in a column.
 */
export const ActionRow = memo(function ActionRow({ actions = [], fit, className }) {
    return (
        <div className={cn(ROW, fit && 'flex-wrap', className)}>
            {actions.slice(0, 3).map(({
                label, icon: Icon, onClick, disabled, variant = 'secondary', title,
                className: actionClassName,
            }) => (
                <Button
                    key={label} size="xs" variant={variant} disabled={disabled}
                    onClick={onClick} title={title}
                    className={cn('h-7 min-w-0', fit ? 'shrink-0' : 'flex-1', actionClassName)}
                >
                    {Icon && <Icon />}
                    <span className="truncate">{label}</span>
                </Button>
            ))}
        </div>
    );
});

/*
 * label · arbitrary control, on the same geometry as SelectRow/NumberRow —
 * for the pickers the kit doesn't own (participant, captain, port, a typed
 * field). It exists so a panel that needs a bespoke control still gets the
 * kit's label column and staged tint instead of inventing its own row.
 * Keep labels short: the label column is fixed so every row aligns.
 *
 * `stacked` puts the label above its control instead. Use it where a fixed
 * label gutter would cost more than it earns — a column of form fields, where
 * the gutter pushes every control off the panel's left edge and strands the
 * labels far from what they name. Rows in a control list stay unstacked.
 */
export const FieldRow = memo(function FieldRow({ label, staged, stacked, children, className }) {
    const labelTone = staged ? 'text-amber-400' : 'text-muted-foreground';
    if (stacked) {
        return (
            <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
                {/* A stacked label sits directly above its value, so it has to
                    read as a tier BELOW the region eyebrow and below the value
                    itself — micro-caps, not another 12px grey line competing
                    with the placeholder text under it. */}
                {label != null && (
                    <Text span truncate className={cn('label-display text-[10px]', labelTone)}>
                        {label}
                    </Text>
                )}
                <div className="flex min-h-7 min-w-0 items-center gap-1.5">{children}</div>
            </div>
        );
    }
    return (
        <div className={cn(ROW, className)}>
            <RowLabel label={label} tone={labelTone} />
            <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
        </div>
    );
});

/*
 * label · segmented control — plates mode and friends.
 *
 * `fill` (default) stretches the control across the row, for a segmented that is
 * the SUBJECT of what follows it: the plates source, a lower-third slot's type.
 * `fill={false}` sizes it to its options, for one value among a list of them —
 * an overlay style setting, where a stretched control is the widest and loudest
 * thing on a panel of set-once knobs, and the chosen segment ends up an inch
 * from the label that names it.
 */
export const SegmentedRow = memo(function SegmentedRow({
    label, value, onChange, data, disabled, fill = true, className,
}) {
    return (
        <div className={cn(ROW, className)}>
            <RowLabel label={label} />
            <SegmentedControl
                size="xs" fullWidth={fill} data={data} value={value}
                onChange={onChange} disabled={disabled}
                className={fill ? 'min-w-0 flex-1' : 'min-w-0 shrink'}
            />
        </div>
    );
});

/*
 * An icon button that reads as on or off — the eye, sub-plate and remove
 * affordances repeated across the caster desk, player plates and lower-third
 * slots. Tone: 'accent' for a state that's meaningfully ON, 'danger' for
 * destructive, 'plain' for a momentary action.
 */
export const IconToggle = memo(function IconToggle({
    icon: Icon, offIcon: OffIcon, on = true, label, onClick, disabled, tone = 'accent',
}) {
    const Rendered = (!on && OffIcon) ? OffIcon : Icon;
    return (
        <SimpleTooltip label={label}>
            <button
                type="button" onClick={onClick} disabled={disabled} aria-label={label}
                aria-pressed={OffIcon || tone === 'accent' ? on : undefined}
                className={cn(
                    'shrink-0 disabled:opacity-30',
                    tone === 'danger' && 'text-muted-foreground hover:text-destructive',
                    tone === 'plain' && 'text-muted-foreground hover:text-foreground',
                    tone === 'accent' && (on && !disabled
                        ? 'text-rio-300'
                        : 'text-muted-foreground hover:text-foreground'),
                )}
            >
                <Rendered size={14} />
            </button>
        </SimpleTooltip>
    );
});

/*
 * dot · name · meta · inline controls; optionally expandable in place —
 * casters, lower-third slots, schedule queue. Expandable iff it has children.
 * Controlled (`expanded` + `onExpandedChange`) or uncontrolled
 * (`defaultExpanded`); a string `dot` is a Tailwind background class.
 *
 * `name` takes a node as well as a string. A row whose primary content is
 * itself editable (a person picker, a typed label) passes the control; it
 * renders in the name slot untouched, since wrapping an input in the expand
 * button would make it inert. Such a row still expands via its chevron.
 */
export function ListRow({
    dot, name, meta, controls, children, lead,
    expanded, defaultExpanded = false, onExpandedChange,
    disabled, className,
}) {
    const nameIsNode = name != null && typeof name !== 'string' && typeof name !== 'number';
    const expandable = children != null;
    const [own, setOwn] = useState(defaultExpanded);
    const isControlled = expanded !== undefined;
    const open = expandable && (isControlled ? expanded : own);
    const toggle = () => {
        if (!expandable || disabled) return;
        if (!isControlled) setOwn(!open);
        onExpandedChange?.(!open);
    };
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <div className={cn('min-w-0', disabled && 'opacity-50', className)}>
            <div className={ROW}>
                {dot != null && (typeof dot === 'string'
                    ? <span className={cn('size-1.5 shrink-0 rounded-full', dot)} />
                    : dot)}
                {lead}
                {nameIsNode ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        {name}
                        {meta != null && <Text size="xs" span truncate dimmed className="min-w-0">{meta}</Text>}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={toggle}
                        disabled={!expandable || disabled}
                        aria-expanded={expandable ? open : undefined}
                        className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-left', expandable && 'hover:text-foreground')}
                    >
                        <Text size="xs" span truncate className="min-w-0 text-foreground">{name}</Text>
                        {meta != null && <Text size="xs" span truncate dimmed className="min-w-0">{meta}</Text>}
                    </button>
                )}
                {controls}
                {/* The name button is the expander for text rows; a node row
                    has no such button, so its chevron carries the affordance. */}
                {expandable && (nameIsNode ? (
                    <button
                        type="button" onClick={toggle} disabled={disabled}
                        aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <Chevron size={12} />
                    </button>
                ) : (
                    <Chevron size={12} className="shrink-0 text-muted-foreground" />
                ))}
            </div>
            {open && (
                <div className="ml-[3px] flex flex-col gap-1 border-l border-border/60 pb-1 pl-3">
                    {children}
                </div>
            )}
        </div>
    );
}

/*
 * Labelled column grouping at stage width — a kit feature, not a per-element
 * invention (the Match desk uses two). Columns are container-query driven:
 * one column until the PANEL is wide enough, so the same body works on the
 * stage and in a narrow window. `template` overrides the even split for
 * asymmetric groupings (the Match desk gives its sides more room than its
 * fixture fields).
 */
export function KitColumns({ children, template, className }) {
    return (
        <div
            className={cn(
                'grid grid-cols-1 gap-x-6 gap-y-3',
                template ? '@2xl:grid-cols-[var(--kit-cols)]' : '@2xl:grid-cols-2',
                className,
            )}
            style={template ? { '--kit-cols': template } : undefined}
        >
            {children}
        </div>
    );
}

/*
 * `action` rides on the column's header rule — for the one control that FILLS
 * a column rather than living in it (the Match desk's start.gg load), which
 * would otherwise sit in the field list pretending to be a field.
 *
 * `subject` rides the same rule, beside the label rather than pushed right: a
 * region whose state is one line (the board's Games — transport badge plus the
 * playback sentence) spends a whole 28px row plus a gap on it otherwise, and it
 * belongs to the eyebrow the way a `SubjectRow` belongs to a panel. Left-aligned
 * on purpose — the far edge of a 900px column is not "next to GAMES".
 */
export function KitColumn({ label, subject, action, children, className }) {
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
            {(label != null || subject || action) && (
                // WRAPS. A region's rule can carry a real control group now (the
                // board's feed — badge, mode picker, re-read — beside its sides),
                // and on a narrow panel a nowrap row truncated the subject to
                // "Sides from the bo…" rather than taking a second line. Wrapping
                // costs nothing on a rule with room.
                <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                    {label != null && (
                        <Text size="xs" className="label-display shrink-0 text-muted-foreground">{label}</Text>
                    )}
                    {subject && <div className="flex min-w-0 items-center gap-1.5">{subject}</div>}
                    {action && <div className="ml-auto flex min-w-0 items-center gap-1.5">{action}</div>}
                </div>
            )}
            {children}
        </div>
    );
}

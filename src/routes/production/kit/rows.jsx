import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { Switch } from '../../../components/ui/switch';
import { Button } from '../../../components/ui/button';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
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
    label, checked, onChange, disabled, staged, spread, className,
}) {
    const tone = staged ? 'text-amber-400' : 'text-foreground';
    return (
        <label className={cn(ROW, spread && 'justify-between', className)}>
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
    label, checked, onChange, disabled, staged, title, ariaLabel, className,
}) {
    return (
        <button
            type="button" onClick={() => onChange?.(!checked)} disabled={disabled}
            aria-pressed={!!checked} title={title || undefined}
            /* `ariaLabel` for a chip whose text names the SETTING but not the
               thing it applies to — two "Home" chips, one per side, are two
               buttons with the same accessible name until the side is in it.
               Same escape hatch TextRow's ariaLabel is. */
            aria-label={ariaLabel || undefined}
            className={cn(
                'flex h-6 shrink-0 items-center rounded-md border px-2 text-xs transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-40',
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
            {label != null && (
                <Text size="xs" span truncate className={cn(KIT_LABEL, staged ? 'text-amber-400' : 'text-muted-foreground')}>
                    {label}
                </Text>
            )}
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
export const NumberRow = memo(function NumberRow({
    label, value, onChange, min, max, step, suffix, disabled, staged, className,
}) {
    return (
        <div className={cn(ROW, className)}>
            {label != null && (
                <Text size="xs" span truncate className={cn(KIT_LABEL, staged ? 'text-amber-400' : 'text-muted-foreground')}>
                    {label}
                </Text>
            )}
            <input
                type="number" min={min} max={max} step={step} disabled={disabled}
                aria-label={named(label)}
                value={value ?? ''}
                onChange={(e) => onChange?.(e.target.value === '' ? null : Number(e.target.value))}
                className={cn(KIT_INPUT, 'w-20', staged && 'border-amber-400/60 text-amber-400')}
            />
            {suffix && <Text size="xs" span dimmed className="shrink-0">{suffix}</Text>}
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
export const TextRow = memo(function TextRow({
    label, value, onChange, placeholder, disabled, staged, debounceMs = 300, ariaLabel, short, className,
}) {
    const [draft, type, commit] = useDebouncedText(value, onChange, debounceMs);
    const deferred = debounceMs > 0;
    return (
        <div className={cn(ROW, className)}>
            {label != null && (
                <Text size="xs" span truncate className={cn(KIT_LABEL, staged ? 'text-amber-400' : 'text-muted-foreground')}>
                    {label}
                </Text>
            )}
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
                )}
            />
        </div>
    );
});

// label · swatch + hex — a per-overlay colour override. `value` null/'' means
// "use the theme default": the swatch falls back to black for the native
// picker but the field reads empty and shows a reset only once a colour is
// pinned, so onChange(null) is how the producer clears back to the default.
export const ColorRow = memo(function ColorRow({
    label, value, onChange, disabled, staged, className,
}) {
    const has = value != null && value !== '';
    return (
        <div className={cn(ROW, className)}>
            {label != null && (
                <Text size="xs" span truncate className={cn(KIT_LABEL, staged ? 'text-amber-400' : 'text-muted-foreground')}>
                    {label}
                </Text>
            )}
            <input
                type="color" disabled={disabled} aria-label={label}
                value={has ? value : '#000000'}
                onChange={(e) => onChange?.(e.target.value)}
                className="h-7 w-8 shrink-0 rounded-md border border-border bg-card p-0.5"
            />
            <input
                type="text" disabled={disabled} placeholder="Default"
                value={has ? value : ''}
                onChange={(e) => onChange?.(e.target.value || null)}
                className={cn(KIT_INPUT, 'min-w-0 flex-1', staged && 'border-amber-400/60 text-amber-400')}
            />
            {has && (
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

// 1–3 equal-width buttons — push, replay/spotlight/split, capture.
// Each action: { label, icon?, onClick, disabled?, variant?, title?, className? }.
// `className` tints ONE action without promoting it to a different button size
// or layout — the destructive-outline reset beside a plain sibling.
export const ActionRow = memo(function ActionRow({ actions = [], className }) {
    return (
        <div className={cn(ROW, className)}>
            {actions.slice(0, 3).map(({
                label, icon: Icon, onClick, disabled, variant = 'secondary', title,
                className: actionClassName,
            }) => (
                <Button
                    key={label} size="xs" variant={variant} disabled={disabled}
                    onClick={onClick} title={title}
                    className={cn('h-7 min-w-0 flex-1', actionClassName)}
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
            {label != null && (
                <Text size="xs" span truncate className={cn(KIT_LABEL, labelTone)}>{label}</Text>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
        </div>
    );
});

/*
 * label · segmented control — plates mode and friends.
 *
 * `fill` (default) stretches the control across the row, for a segmented that is
 * the SUBJECT of what follows it: the plates mode, a lower-third slot's type.
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
            {label != null && (
                <Text size="xs" span truncate className={cn(KIT_LABEL, 'text-muted-foreground')}>{label}</Text>
            )}
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
                <div className="flex min-h-6 items-center gap-2">
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

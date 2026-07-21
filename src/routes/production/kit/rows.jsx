import { memo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Switch } from '../../../components/ui/switch';
import { Button } from '../../../components/ui/button';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { KIT_INPUT } from './tokens';

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
 */

const ROW = 'flex min-h-7 items-center gap-2';

const normalize = (opts = []) =>
    opts.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));

// label · switch — source visibility, sub-plate toggles.
export const ToggleRow = memo(function ToggleRow({
    label, checked, onChange, disabled, staged, className,
}) {
    return (
        <label className={cn(ROW, 'justify-between', className)}>
            <Text size="xs" span truncate className={cn('min-w-0', staged ? 'text-amber-400' : 'text-foreground')}>
                {label}
            </Text>
            <Switch size="sm" checked={!!checked} onCheckedChange={onChange} disabled={disabled} />
        </label>
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
                <Text size="xs" span truncate className={cn('w-16 shrink-0', staged ? 'text-amber-400' : 'text-muted-foreground')}>
                    {label}
                </Text>
            )}
            <select
                className={cn(KIT_INPUT, 'min-w-0 flex-1', staged && 'border-amber-400/60 text-amber-400')}
                value={value ?? ''}
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
                <Text size="xs" span truncate className={cn('w-16 shrink-0', staged ? 'text-amber-400' : 'text-muted-foreground')}>
                    {label}
                </Text>
            )}
            <input
                type="number" min={min} max={max} step={step} disabled={disabled}
                value={value ?? ''}
                onChange={(e) => onChange?.(e.target.value === '' ? null : Number(e.target.value))}
                className={cn(KIT_INPUT, 'w-20', staged && 'border-amber-400/60 text-amber-400')}
            />
            {suffix && <Text size="xs" span dimmed className="shrink-0">{suffix}</Text>}
        </div>
    );
});

// 1–3 equal-width buttons — push, replay/spotlight/split, capture.
// Each action: { label, icon?, onClick, disabled?, variant?, title? }.
export const ActionRow = memo(function ActionRow({ actions = [], className }) {
    return (
        <div className={cn(ROW, className)}>
            {actions.slice(0, 3).map(({ label, icon: Icon, onClick, disabled, variant = 'secondary', title }) => (
                <Button
                    key={label} size="xs" variant={variant} disabled={disabled}
                    onClick={onClick} title={title} className="h-7 min-w-0 flex-1"
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
                <Text size="xs" span truncate className={cn('w-16 shrink-0', labelTone)}>{label}</Text>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
        </div>
    );
});

// label · segmented control — plates mode and friends.
export const SegmentedRow = memo(function SegmentedRow({
    label, value, onChange, data, disabled, className,
}) {
    return (
        <div className={cn(ROW, className)}>
            {label != null && (
                <Text size="xs" span truncate className="w-16 shrink-0 text-muted-foreground">{label}</Text>
            )}
            <SegmentedControl
                size="xs" fullWidth data={data} value={value}
                onChange={onChange} disabled={disabled} className="min-w-0 flex-1"
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

// `action` rides on the column's header rule — for the one control that FILLS
// a column rather than living in it (the Match desk's start.gg load), which
// would otherwise sit in the field list pretending to be a field.
export function KitColumn({ label, action, children, className }) {
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
            {(label != null || action) && (
                <div className="flex min-h-6 items-center gap-2">
                    {label != null && (
                        <Text size="xs" className="label-display text-muted-foreground">{label}</Text>
                    )}
                    {action && <div className="ml-auto flex items-center gap-1.5">{action}</div>}
                </div>
            )}
            {children}
        </div>
    );
}

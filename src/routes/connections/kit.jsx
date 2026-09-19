import { Panel } from '../../components/ui/panel';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Loader } from '../../components/ui/primitives';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { cn } from '../../lib/utils';

/*
 * The Connections tab's row kit — one shape per KIND of thing a card holds, so
 * five cards read as one page rather than five pages that happen to share it.
 *
 * THE STATUS LIVES IN THE HEADER, ONCE. Every card used to state its health
 * twice (a badge in the header, then a dot-and-sentence or a bold line in the
 * body saying the same word), and OBS three times on an error. The pill is the
 * answer; the body holds only what changes it.
 *
 * NO PROSE ON THE PAGE. The cards opened with a paragraph each, then a tagline
 * each — text a producer reads once per machine, and most of it restating a
 * label or a pill. What a field is for is its label; anything more rides a
 * `title`. Text in a card body is state — an error, a count — never a caption.
 */

// Four tones, not two: `idle` is honest while a fetch is in flight or a thing is
// deliberately off, and `warn` is "working, but you'd want to know". Same
// bordered-tint shape as the console's status chips (production/kit/chip.js).
const TONE = {
    ok: { pill: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
    warn: { pill: 'border-amber-400/40 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400' },
    bad: { pill: 'border-destructive/50 bg-destructive/10 text-red-300', dot: 'bg-destructive' },
    idle: { pill: 'border-border bg-transparent text-muted-foreground', dot: 'bg-muted-foreground/50' },
    busy: { pill: 'border-amber-400/40 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400 animate-pulse' },
};

export function StatusPill({ tone = 'idle', title, children }) {
    const t = TONE[tone] ?? TONE.idle;
    return (
        <span
            title={title}
            className={cn(
                'inline-flex h-5 items-center gap-1.5 rounded-[4px] border px-1.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap',
                t.pill,
            )}
        >
            <span className={cn('size-1.5 rounded-full', t.dot)} />
            {children}
        </span>
    );
}

/*
 * A card: title, the one status pill, optional header controls, then a body of
 * `Section`s split by hairlines — so the spacing and the rules between them are
 * the kit's, not each card's.
 */
export function ConnCard({ title, status, actions, className, children }) {
    return (
        <Panel
            title={title}
            className={cn('flex flex-col', className)}
            actions={(status || actions) && <>{actions}{status}</>}
        >
            <div className="flex flex-1 flex-col divide-y divide-border/60">{children}</div>
        </Panel>
    );
}

export function Section({ className, children }) {
    return <div className={cn('flex flex-col gap-2 px-4 py-3', className)}>{children}</div>;
}

export function FieldLabel({ htmlFor, title, className, children }) {
    return (
        <label
            htmlFor={htmlFor}
            title={title}
            className={cn('text-[11px] font-medium uppercase tracking-wide text-muted-foreground', className)}
        >
            {children}
        </label>
    );
}

export function ErrorLine({ children }) {
    if (!children) return null;
    return <p className="text-xs leading-snug text-red-300">{children}</p>;
}

/*
 * A path into somebody else's install. Read-only on purpose — both are picked
 * with the OS dialog (Browse…), never typed — so it is drawn as a VALUE, in
 * mono, rather than as an input that invites typing and ignores it. Long paths
 * truncate from the START: the file or folder name at the end is the part that
 * says whether it's the right one.
 *
 * Unset = the default location, shown dimmed with a DEFAULT tag; the ×
 * appears only over a custom path, because resetting to the default is the one
 * thing it does.
 */
export function PathField({ value, fallback, onReset, resetting, children }) {
    const custom = !!value;
    const shown = value || fallback || '';
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div
                title={shown}
                className="flex h-8 min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-input bg-input/30 px-2.5"
            >
                <span
                    dir="rtl"
                    className={cn(
                        'min-w-0 flex-1 truncate text-left font-mono text-xs',
                        custom ? 'text-foreground' : 'text-muted-foreground',
                    )}
                >
                    <bdi>{shown || '—'}</bdi>
                </span>
                {!custom && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                        Default
                    </span>
                )}
            </div>
            {custom && onReset && (
                <SimpleTooltip label="Reset to the default location">
                    <Button size="icon-sm" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={onReset} disabled={resetting} aria-label="Reset to default">
                        ×
                    </Button>
                </SimpleTooltip>
            )}
            {children}
        </div>
    );
}

// A button that shows its own spinner — every action on this tab is a round
// trip, and each card used to spell the `{busy && <Loader/>}` out by hand.
export function BusyButton({ busy, disabled, children, ...props }) {
    return (
        <Button size="sm" variant="outline" {...props} disabled={busy || disabled}>
            {busy && <Loader size={12} />}
            {children}
        </Button>
    );
}

/*
 * A switch with its label beside it and at most one line of hint under it.
 * `tone="warn"` tints the row for a switch whose ON state carries a risk.
 */
export function ToggleRow({ checked, onChange, label, hint, title, disabled, tone, id }) {
    return (
        <label
            htmlFor={id}
            title={title}
            className={cn(
                'flex cursor-pointer items-start gap-2.5',
                disabled && 'cursor-default opacity-60',
                tone === 'warn' && '-mx-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-2 py-1.5',
            )}
        >
            <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm leading-tight">{label}</span>
                {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
            </span>
        </label>
    );
}

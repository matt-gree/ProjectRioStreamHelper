import { Panel } from '../../components/ui/panel';
import { SegmentedControl } from '../../components/ui/segmented-control';
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
 * NO PROSE ON THE PAGE, WITH ONE EXCEPTION, AND THE EXCEPTION IS THE POINT.
 * The cards opened with a paragraph each, then a tagline each — text a
 * producer reads once per machine, and most of it restating a label or a
 * pill. For a LABELLED VALUE the rule still holds: a path field shows you the
 * path, a host field shows you the host, and a caption over either is a second
 * name for what is already on screen.
 *
 * A SWITCH IS THE EXCEPTION, because a switch shows you nothing but its own
 * position. `Allow LAN access` does not say that anyone on the WiFi can then
 * drive your broadcast, and `Follow on Scoreboard 1` does not say what board 1
 * does instead when it is off. That lived in a `title` — an explanation for
 * whoever already knows to hover, on a page visited once per machine. So every
 * switch carries one line saying what the other state does; nothing else does.
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

/*
 * ONE TYPE SCALE FOR THE TAB, AND A BUTTON IS NOT THE TOP OF IT. `Button`'s
 * `sm` sets a height and inherits the base 14px, which on these cards made
 * `Browse…` and `Refresh` the LARGEST text in the card — larger than the card's
 * own title, which every PRSH panel draws at 12px. Measured, the Project Rio
 * card ranked: two buttons and a switch label at 14, the title at 12, its
 * labels at 11, its tags at 10. The fix is down, not up: a panel title is 12px
 * app-wide and raising it here would put this tab out of step with the console.
 *
 * So `CONN_BTN` is the tab's button type, and every `sm` button on these cards
 * carries it — the height stays 8 (it lines up with a path field and an input),
 * only the type comes to 12. The scale is then: 12 title · 12 value · 12 button
 * · 12 hint · 11 label · 10 tag, with caps, weight and the header band doing
 * the ranking instead of size.
 */
export const CONN_BTN = 'text-xs';

// A button that shows its own spinner — every action on this tab is a round
// trip, and each card used to spell the `{busy && <Loader/>}` out by hand.
export function BusyButton({ busy, disabled, className, children, ...props }) {
    return (
        <Button size="sm" variant="outline" className={cn(CONN_BTN, className)} {...props} disabled={busy || disabled}>
            {busy && <Loader size={12} />}
            {children}
        </Button>
    );
}

/* One line under a label, saying what the control does. See the switch rule
 * above for when a row has earned one. */
export function Hint({ className, children }) {
    if (!children) return null;
    return <p className={cn('text-xs leading-snug text-muted-foreground', className)}>{children}</p>;
}

/*
 * A SETTING AND WHAT IT DOES: the label and its one line on the left, the
 * control on the right — the same row the Settings modal is built from, which
 * is the other place in the app that is nothing but preferences.
 *
 * THE CONTROL NAMES BOTH STATES, and is a segmented pair rather than a
 * `Switch` for the reason the stage's intro row already settled (see
 * production/stage/intro.jsx): a switch marks ON with `bg-primary`, so on a
 * page of four set-once knobs the loudest things were preferences, painted in
 * the colour the console keeps for on-air and destructive. A switch also says
 * its state ONLY by its fill, and fill-as-state needs the filled siblings of a
 * strip to read as state at all — every switch on this tab stands alone in its
 * own card, with nothing to compare against. A pair that spells `On` and `Off`
 * is legible with nothing beside it and spends no colour to do it.
 *
 * It sizes to its content, so a caller can drop it inline in a flex row (the
 * OBS footer, the controller's port line) and get a tight label·control pair,
 * or in a column Section and get the full-width row with the control at the
 * right margin. `tone="warn"` tints the row for a switch whose ON state
 * carries a risk.
 */
export function ToggleRow({ checked, onChange, label, hint, title, disabled, tone }) {
    return (
        <div
            title={title}
            className={cn(
                'flex items-center justify-between gap-4',
                disabled && 'opacity-60',
                tone === 'warn' && '-mx-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-2 py-1.5',
            )}
        >
            {/* The label is a FieldLabel because it is the same THING as
                `HUD FILE` and `PORT` — the name of one control inside a
                section. It was 14px sentence case (inherited from the Settings
                modal's row, where the whole page runs one size larger), which
                made `Follow on Scoreboard 1` a heading outranking the card it
                sits in. */}
            <span className="flex min-w-0 flex-col gap-1">
                <FieldLabel>{label}</FieldLabel>
                <Hint>{hint}</Hint>
            </span>
            <SegmentedControl
                size="xs"
                className="shrink-0"
                aria-label={label}
                disabled={disabled}
                value={checked ? 'on' : 'off'}
                onChange={(v) => onChange(v === 'on')}
                data={[{ label: 'On', value: 'on' }, { label: 'Off', value: 'off' }]}
            />
        </div>
    );
}

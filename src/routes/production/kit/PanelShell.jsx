import { memo } from 'react';
import { X } from 'lucide-react';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { StateChip } from './StateChip';

// Panel frame for stage panels (and desk bodies): header = chip · name ·
// primary action · pin · close (where applicable); body; optional footer.
// `pinnable={false}` is the quickFace: null case — the pin affordance does
// not render at all, an intentional and visible state per the contract.
export const PanelShell = memo(function PanelShell({
    state, title, meta, primaryAction,
    pinnable = true, pinned = false, onPinToggle,
    onClose, footer, children, className,
}) {
    return (
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card', className)}>
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2.5">
                <StateChip state={state} />
                {/* A third type step, for the one thing on the panel that says
                    WHAT the panel is. The whole stage ran on text-sm and
                    text-xs — two sizes for five levels — so the title carried
                    no more weight than the source name beside it or the rows
                    below it, and a panel with nothing louder than its own
                    contents has no entry point. One step (15px against the
                    body's 12px), not a headline: this is a dense work surface
                    and the controls are why anyone is here. */}
                <Text truncate className="label-display min-w-0 flex-1 text-[0.9375rem] font-semibold text-foreground">
                    {title}
                </Text>
                {meta != null && <Text size="xs" span truncate dimmed className="min-w-0">{meta}</Text>}
                {primaryAction}
                {pinnable && (
                    <SimpleTooltip label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}>
                        <button
                            type="button"
                            onClick={onPinToggle}
                            aria-pressed={pinned}
                            aria-label={pinned ? 'Unpin from quick rail' : 'Pin to quick rail'}
                            className={cn(
                                'shrink-0 text-sm leading-none transition-colors',
                                pinned ? 'text-rio-400' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {pinned ? '◆' : '◇'}
                        </button>
                    </SimpleTooltip>
                )}
                {onClose && (
                    <button
                        type="button" onClick={onClose} aria-label="Close"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <X size={14} />
                    </button>
                )}
            </header>
            {/* @container: stage bodies lay themselves out against the PANEL's
                width, not the viewport's. The same body is a single column on
                a rail-width card and a multi-column spread on a wide stage,
                without either surface knowing the page's breakpoints. */}
            <div className="@container flex min-h-0 flex-col gap-1.5 p-2.5">{children}</div>
            {footer && <footer className="border-t border-border/60 px-2.5 py-1.5">{footer}</footer>}
        </section>
    );
});

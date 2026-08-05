import { Children, memo } from 'react';
import { Text } from '../../../components/ui/primitives';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { StateChip } from './StateChip';

// Quick-rail card: header (chip · name · click-through to selection · reorder ·
// unpin) over the element's quick face. The two-row cap is HARD — enforced here
// by truncation so an over-declared face degrades visibly instead of creeping
// back into mishmash (production-console-contract skill).
//
// `move` is the reorder slot (the rail passes MoveButtons). It is a SLOT rather
// than a drag handle because pointer drag is not an input every producer has:
// see the note on MoveButtons in ../controls.
export const QuickCard = memo(function QuickCard({
    state, title, onOpen, onUnpin, move, children, className,
}) {
    const rows = Children.toArray(children).slice(0, 2);
    return (
        <section className={cn('flex min-w-0 flex-col rounded-lg border border-border bg-card', className)}>
            <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-2">
                <StateChip state={state} />
                <SimpleTooltip label="Open on stage">
                    <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
                        <Text size="xs" span truncate className="label-display font-semibold text-foreground">
                            {title}
                        </Text>
                    </button>
                </SimpleTooltip>
                {move}
                <SimpleTooltip label="Unpin from quick rail">
                    <button
                        type="button" onClick={onUnpin} aria-label="Unpin from quick rail"
                        className="shrink-0 text-sm leading-none text-rio-400 transition-colors hover:text-foreground"
                    >
                        {'◆'}
                    </button>
                </SimpleTooltip>
            </header>
            <div className="flex flex-col gap-1 px-2 py-1.5">{rows}</div>
        </section>
    );
});

import { memo } from 'react';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { CHIP_META } from './chip';

// The chip pill. `state` is 'air' | 'pvw' | 'off' | 'unbound' | 'desk' —
// derived by chipFor(placement) at the call site, so every surface states which
// placement it is describing rather than re-resolving one of its own.
export const StateChip = memo(function StateChip({ state, className }) {
    const s = state ?? 'unbound';
    const meta = CHIP_META[s] ?? CHIP_META.unbound;
    return (
        <SimpleTooltip label={meta.title}>
            <span
                data-chip-state={s}
                className={cn(
                    'label-display inline-flex h-4 w-9 shrink-0 items-center justify-center rounded border text-[9px] font-semibold tracking-wider',
                    meta.className, className,
                )}
            >
                {meta.label}
            </span>
        </SimpleTooltip>
    );
});

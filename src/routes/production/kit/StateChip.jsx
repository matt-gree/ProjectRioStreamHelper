import { memo } from 'react';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { cn } from '../../../lib/utils';
import { chipState, CHIP_META } from './chip';

// The chip pill. Pass a derived `state` ('air' | 'pvw' | 'off' | 'unbound' |
// 'desk') or raw `bindings` (useElementBindings output) to derive it here.
export const StateChip = memo(function StateChip({ state, bindings, className }) {
    const s = state ?? chipState(bindings);
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

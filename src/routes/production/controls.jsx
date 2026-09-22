import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore, useStateStore } from '../../context/store';
import { stageOrRun } from '../../context/staging';
import { Stack, Group } from '../../components/ui/primitives';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { notifications } from '../../lib/notify';
import { cn } from '../../lib/utils';

/*
 * Staging-aware controls shared by the Production page's surfaces (stage bodies
 * and desk panels).
 *
 * A `VisibilityRow` lived here too — a pre-kit label+switch from the card-grid
 * era, superseded twice over by the kit's ToggleRow (via `SourceToggleRow`) and
 * by the source strip's Air slot, and referenced by nothing. Show/hide is the
 * header strip's job for every element; if you need it in a body, you are
 * writing a row the contract says belongs in the header.
 */

// Run an OBS control action, surfacing failures as a toast (e.g. transition
// while one is mid-flight, or a scene removed under us).
export async function runObs(fn) {
    try {
        await fn();
    } catch (e) {
        notifications.show({ message: `OBS: ${e?.message || e}`, color: 'red' });
    }
}

// Stage (or run) a single live-state write.
export function stageStateSet(stateKey, value, label) {
    stageOrRun({
        key: `state:${stateKey}`,
        label: label || stateKey,
        value,
        run: () => useStateStore.getState().setItems([{ key: stateKey, value }]),
    });
}

// Stage (or run) a single settings write. Overlay style settings broadcast to
// every layout over the settings socket, so a switch flipped here is a live
// broadcast change and belongs behind the same gateway as state writes.
export function stageSettingsSet(settingKey, value, label) {
    stageOrRun({
        key: `settings:${settingKey}`,
        label: label || settingKey,
        value,
        run: () => useSettingsStore.getState().setItem(settingKey, value),
    });
}

// Stacked ▲/▼ — the reorder control shared by the list faces (commentary
// desk, lower-third slots, schedule queue). Deliberately buttons, not drag:
// native HTML5 drag needs a mouse pointer, and the Production page is also
// driven from phones/tablets at the venue.
//
// `axis="x"` lays the pair out as ◀ ▶ for a list the producer sees running
// left→right on air (the lower-third band). Same handlers, same labels — only
// the arrows and their stacking follow the direction of the thing being moved.
export const MoveButtons = memo(function MoveButtons({ canUp, canDown, onUp, onDown, label, axis = 'y' }) {
    const x = axis === 'x';
    const Wrap = x ? Group : Stack;
    return (
        <Wrap gap="none" className={cn('shrink-0 items-center', x && 'flex-nowrap')}>
            <button
                type="button" disabled={!canUp} onClick={onUp}
                aria-label={`Move ${label} ${x ? 'left' : 'up'}`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
                <ChevronRight size={12} className={x ? 'rotate-180' : '-rotate-90'} />
            </button>
            <button
                type="button" disabled={!canDown} onClick={onDown}
                aria-label={`Move ${label} ${x ? 'right' : 'down'}`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
                <ChevronRight size={12} className={x ? undefined : 'rotate-90'} />
            </button>
        </Wrap>
    );
});

// Amber "staged, not live yet" marker rendered next to pending controls.
export const StagedDot = memo(function StagedDot({ show, className }) {
    if (!show) return null;
    return (
        <SimpleTooltip label="Staged — goes live on confirm">
            <span className={cn('inline-block size-1.5 shrink-0 rounded-full bg-amber-400', className)} />
        </SimpleTooltip>
    );
});


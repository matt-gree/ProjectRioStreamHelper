import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useSettingsStore, useStateStore } from '../../context/store';
import { stageOrRun } from '../../context/staging';
import { Stack, Group, Text } from '../../components/ui/primitives';
import { Switch } from '../../components/ui/switch';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { notifications } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { setSourceVisibility, useDisplayedEnabled } from './bindings';

/*
 * Staging-aware controls shared by the Production page's surfaces (stage
 * bodies, desk panels, and the legacy grid faces). Moved verbatim out of
 * production.jsx (console slice 4).
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
export const MoveButtons = memo(function MoveButtons({ canUp, canDown, onUp, onDown, label }) {
    return (
        <Stack gap="none" className="shrink-0">
            <button
                type="button" disabled={!canUp} onClick={onUp} aria-label={`Move ${label} up`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
                <ChevronRight size={12} className="-rotate-90" />
            </button>
            <button
                type="button" disabled={!canDown} onClick={onDown} aria-label={`Move ${label} down`}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
                <ChevronRight size={12} className="rotate-90" />
            </button>
        </Stack>
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

// Show/hide an OBS source (staging-aware). The console's toggle-row shape:
// label (+ optional sub) · staged dot · switch.
export const VisibilityRow = memo(function VisibilityRow({ label, sub, item, sceneName }) {
    const { enabled, staged } = useDisplayedEnabled(sceneName, item);
    return (
        <label className="flex items-center justify-between gap-3">
            <Stack gap="none">
                <Group gap="xs" className="items-center">
                    <Text size="sm" className="text-foreground">{label}</Text>
                    <StagedDot show={staged} />
                </Group>
                {sub && <Text size="xs" className="text-muted-foreground">{sub}</Text>}
            </Stack>
            <Switch
                checked={enabled}
                onCheckedChange={(v) => setSourceVisibility(sceneName, item, v)}
            />
        </label>
    );
});

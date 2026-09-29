import { memo, useCallback, useMemo } from 'react';
import { usePersistentState } from '../../../hooks/usePersistentState';
import { liveName, useObsStore } from '../../../context/obs';
import { obsStageKey, stageOrRun, usePending } from '../../../context/staging';
import { notifications } from '../../../lib/notify';
import { SegmentedRow } from '../kit';
import { boardOfUrl } from '../../../lib/obs-binding';
import { instanceId, variantParams, variantTagFor } from '../sources/instances';
import { isFedPlacement, placementId } from '../sources/placements';
import {
    ROSTER_LAYOUTS, rosterLayoutOfUrl, urlForRosterLayout,
} from '../../../../public/layout/lib/roster-layouts.js';

/*
 * "What shape is this Roster?" — Grid, Row or Column, on the source itself.
 *
 * A layout is a different CANVAS (roster-layouts.js), so switching one is two
 * writes that must land as one: the source's `?layout=` and its resolution. The
 * page reads its canvas off the URL, so a URL change alone would draw a row on
 * a grid-sized source, scaled down to a sliver. `reshapeBrowserSource` does both
 * in a single SetInputSettings and keeps every scene's SCALE — a character is
 * drawn as big in a row as it was in the grid — so the switch changes the
 * arrangement and nothing else about how the source sits.
 *
 * On the SOURCE, not in Settings: two Roster sources can be two shapes (a row
 * across the bottom of one scene, a column down the side of another), and a
 * global setting could only be honoured by resizing sources the producer was not
 * looking at. Same reason `?size=` is the scoreboard's.
 *
 * A fed row is its container's source, and a container's member box is fixed,
 * so a Roster in a container stays a grid.
 *
 * WITH OBS CLOSED the row still works — the console must not lose a surface to
 * OBS being down. A catalog row has no source to reshape, so the choice is kept
 * in the browser against that row (`prsh.ui.production.rosterLayouts`, the same
 * per-producer store as the rack's selection and pins) and `useRosterPlacement`
 * writes it into the placement the stage hands on — so the preview draws that
 * layout at its canvas and Copy URL hands over its `?layout=`. The row keeps its
 * id, so the rack still shows it selected.
 *
 * AN OBS INPUT IS GLOBAL: the same source in three scenes is reshaped in all
 * three. The toast says so when it happens. Staged like visibility — reshaping a
 * source that is on air changes the broadcast.
 */

const pendingKey = (placement) => obsStageKey('layout', [placement.item.sourceName]);

const OPTIONS = Object.entries(ROSTER_LAYOUTS).map(([value, { label }]) => ({ value, label }));

const OFFLINE_KEY = 'prsh.ui.production.rosterLayouts';
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const useOfflineLayouts = () => usePersistentState(OFFLINE_KEY, {}, isMap);

// A variant tag with its layout axis set (grid = absent), every other axis kept.
export function withLayoutVariant(variant, layout) {
    const parts = variantParams(variant).filter(([p]) => p !== 'layout');
    if (layout && layout !== 'grid') parts.push(['layout', layout]);
    return parts.map(([p, v]) => variantTagFor(p, v)).filter(Boolean).join('.');
}

const isRoster = (placement) => placement?.element?.id === 'roster' && !isFedPlacement(placement);
const isCatalogRow = (placement) => !placement?.item;

/*
 * The placement the stage should draw: unchanged, except a SOURCELESS Roster
 * row wears the layout the producer picked for it with OBS closed.
 */
export function useRosterPlacement(placement) {
    const [layouts] = useOfflineLayouts();
    const layout = isRoster(placement) && isCatalogRow(placement) ? layouts[placement.id] : null;
    return useMemo(
        () => (layout ? { ...placement, variant: withLayoutVariant(placement.variant, layout) } : placement),
        [placement, layout],
    );
}

const RosterLayoutRow = memo(function RosterLayoutRow({ placement, onSelect }) {
    const pending = usePending(placement?.item ? pendingKey(placement) : '∅');
    const [layouts, setLayouts] = useOfflineLayouts();
    const offline = isCatalogRow(placement);
    const eligible = isRoster(placement) && (offline || !!placement?.item?.url);
    const current = !eligible ? null
        : offline ? (layouts[placement.id] ?? 'grid')
            : rosterLayoutOfUrl(placement.item.url);

    const switchTo = useCallback((to) => {
        if (to === current) return;
        if (offline) {
            // Nothing in OBS to reshape: remember it for this row, which the
            // preview and Copy URL read back through useRosterPlacement.
            setLayouts((m) => {
                const next = { ...m };
                if (to === 'grid') delete next[placement.id];
                else next[placement.id] = to;
                return next;
            });
            return;
        }
        const { sourceName, url } = placement.item;
        const nextUrl = urlForRosterLayout(url, to);
        const { width, height } = ROSTER_LAYOUTS[to];
        stageOrRun({
            key: pendingKey(placement),
            label: `Make ${sourceName} a ${ROSTER_LAYOUTS[to].label.toLowerCase()}`,
            value: to,
            liveValue: current,
            run: async () => {
                try {
                    const { scenes } = await useObsStore.getState()
                        .reshapeBrowserSource({ sourceName, url: nextUrl, width, height });
                    // The layout is part of the placement id, so keep the panel
                    // on the source just reshaped (boardswitch.jsx does the same).
                    onSelect?.(placementId(
                        instanceId(placement.element, placement.board ?? boardOfUrl(nextUrl), nextUrl),
                        liveName(placement.scene),
                    ));
                    notifications.show({
                        color: 'green',
                        message: `${sourceName} is now a ${ROSTER_LAYOUTS[to].label.toLowerCase()}, `
                            + `${width}×${height}`
                            + (scenes > 1 ? ` — in all ${scenes} scenes that use it.` : '.'),
                    });
                } catch (e) {
                    notifications.show({ color: 'red', message: e?.message || String(e) });
                }
            },
        });
    }, [placement, current, offline, setLayouts, onSelect]);

    if (!eligible) return null;
    return (
        <SegmentedRow
            label="Layout" fill={false}
            value={pending ? pending.value : current}
            onChange={switchTo}
            data={OPTIONS}
        />
    );
});

export default RosterLayoutRow;

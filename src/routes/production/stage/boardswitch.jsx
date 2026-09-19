import { memo, useCallback } from 'react';
import { useObsStore } from '../../../context/obs';
import { stageOrRun, usePending } from '../../../context/staging';
import { notifications } from '../../../lib/notify';
import { SelectRow } from '../kit';
import { useActiveBoards, useBoardLabel } from '../boards';
import { boardOfUrl } from '../../../lib/obs-binding';
import { readsBoard } from '../elements';
import { instanceId } from '../instances';
import { isFedPlacement, placementId } from '../placements';

/*
 * "Which board does this source read?" — on the source itself.
 *
 * The Add picker asks this once, at creation. After that the only way to move
 * a Scoreboard source from board 1 to board 2 was to open its Properties in OBS
 * and hand-edit `?scoreboard=` inside a URL — or delete it and add it again,
 * losing its position and crop. This row rewrites that one param on the source
 * that exists, so everything the producer did to it in OBS survives.
 *
 * EVERY SOURCE WHOSE OVERLAY READS THE PARAM (`readsBoard`): the board-scoped
 * elements, and the ones with global settings that still draw one board — the
 * Stat Bar and Stat Card, Roster, Player Name, Team Logo, Controller, the
 * post-game callouts, the Event Header and the Results Ticker. For those the
 * placement carries no board, so the current one is read off the source's own
 * URL (absent = 1), the same read ../subject makes. A fed member's board comes
 * from its container's scope, which has its own control, and a sourceless
 * (catalog) row has no URL to rewrite.
 *
 * AN OBS INPUT IS GLOBAL: the same source in three scenes is re-pointed in all
 * three. The toast says so when it happens.
 *
 * Staged like visibility — switching a source that is on air changes the
 * broadcast.
 */

// The same URL with `?scoreboard=` rewritten; everything else (host, size,
// `?intro=0`) is the producer's and stays as OBS holds it.
export function urlForBoard(url, board) {
    try {
        const u = new URL(url);
        u.searchParams.set('scoreboard', String(board));
        return u.toString();
    } catch {
        const sep = url.includes('?') ? '&' : '?';
        return /[?&]scoreboard=\d+/.test(url)
            ? url.replace(/([?&]scoreboard=)\d+/, `$1${board}`)
            : `${url}${sep}scoreboard=${board}`;
    }
}

const pendingKey = (placement) => `obs:board:${placement.item.sourceName}`;

const BoardSwitchRow = memo(function BoardSwitchRow({ placement, placements, onSelect }) {
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();
    const pending = usePending(placement?.item ? pendingKey(placement) : '∅');

    const eligible = !!placement?.item?.url && readsBoard(placement.element)
        && !isFedPlacement(placement);
    const current = eligible ? (placement.board ?? boardOfUrl(placement.item.url) ?? 1) : null;

    const switchTo = useCallback((raw) => {
        const to = Number(raw);
        const from = current;
        const { sourceName, url } = placement.item;
        const nextUrl = urlForBoard(url, to);
        stageOrRun({
            key: pendingKey(placement),
            label: `Point ${sourceName} at ${boardLabel(to)}`,
            value: to,
            liveValue: from,
            run: async () => {
                // The name follows on its own when PRSH gave it (obs.jsx
                // followUrlWithName), so this only moves the URL.
                await useObsStore.getState().repointBrowserSource({ sourceName, url: nextUrl });
                // Keep the panel on the source just switched: its placement id
                // carries the board, so the old selection would fall back to
                // some other copy of the element in this scene.
                onSelect?.(placementId(
                    instanceId(placement.element, to, nextUrl), placement.scene,
                ));
                const scenes = (useObsStore.getState().scenes || []).filter(sc =>
                    (useObsStore.getState().sceneItems?.[sc] || [])
                        .some(it => it.sourceName === sourceName)).length;
                notifications.show({
                    color: 'green',
                    message: `${sourceName} now reads ${boardLabel(to)}`
                        + (scenes > 1 ? ` — in all ${scenes} scenes that use it.` : '.'),
                });
            },
        });
    }, [placement, current, boardLabel, onSelect]);

    // One board is nothing to choose between.
    if (!eligible || boards.length < 2) return null;

    // A board this element (at this size / on this side) already has a source
    // for in this scene would give the scene two identical sources — the Add
    // picker refuses the same thing.
    const taken = new Set(placements
        .filter(p => p !== placement && p.scene === placement.scene
            && p.element?.id === placement.element.id
            && (p.variant ?? '') === (placement.variant ?? '')
            && p.item?.url)
        .map(p => p.board ?? boardOfUrl(p.item.url) ?? 1));

    const shown = pending ? pending.value : current;
    return (
        <SelectRow
            label="Board" staged={!!pending}
            value={shown != null ? String(shown) : ''}
            onChange={switchTo}
            options={boards.map(b => ({
                value: String(b),
                label: taken.has(b) && b !== current
                    ? `${boardLabel(b)} — already in this scene`
                    : boardLabel(b),
                disabled: taken.has(b) && b !== current,
            }))}
        />
    );
});

export default BoardSwitchRow;

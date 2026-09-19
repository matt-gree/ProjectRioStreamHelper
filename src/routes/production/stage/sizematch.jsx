import { memo, useCallback } from 'react';
import { Scaling } from 'lucide-react';
import { useObsStore } from '../../../context/obs';
import { stageOrRun, usePending } from '../../../context/staging';
import { notifications } from '../../../lib/notify';
import { Button } from '../../../components/ui/button';
import { FieldRow } from '../kit';
import { StagedDot } from '../controls';
import { sideSibling, isScaleSensitive } from '../placements';
import { sideOfVariant } from '../instances';
import { useSideLabels } from '../sides';
import { useBoardTag } from '../boards';

/*
 * "Make this one the same size as the other one."
 *
 * A per-side element is placed by hand, twice. The producer drags side 2 to the
 * right of the canvas, sizes it by eye until it reads well, and then has to hit
 * that same number again on side 1 — from OBS's Edit Transform dialog, in a
 * unit (scale, or a bounds box) that isn't the one they were dragging in. A
 * pair that is two pixels apart is invisible in the dialog and glaring on air.
 *
 * IT PULLS, IT NEVER PUSHES. The panel resizes ITS OWN source to match the
 * sibling's, and offers nothing that edits the sibling. That is the console's
 * standing rule — a panel commands the placement it is opened on, and buttons
 * that drive a source other than the one in the header are the exact confusion
 * the source strip's three fixed slots exist to prevent. Both halves get this
 * row, so "push" is one rack click away: open the other side and pull.
 *
 * SIZE, NOT POSITION — see lib/obs-transform.js. Two halves of a pair are a
 * pair because they sit in different places.
 *
 * WHICH SIZE, THOUGH — a browser source has two, and for the Player Name both
 * of them decide what a viewer sees. Matching the scene item alone left that
 * pair's boxes identical and its two names at 30px and 48px, which is the one
 * thing a producer can see about a Player Name and the only reason they pressed
 * this. `isScaleSensitive` is the gate and lib/obs-transform.js carries the
 * arithmetic and the measurement; the row itself says nothing about it, because
 * "make this one the same size as the other one" is what the button already
 * promised and the fault was that it did not.
 *
 * It renders only when BOTH sources are really in this scene, which is the
 * whole situation it serves. A disabled button explaining that the other side
 * isn't placed yet would sit on every single-sided Roster, Team Logo and Player
 * Name panel in the console, saying nothing a producer who has placed one
 * source doesn't already know.
 */

const pendingKey = (placement) => `obs:size:${placement.scene}:${placement.item.id}`;

export function matchSize(placement, sibling, label) {
    const mine = placement.item.sourceName;
    const theirs = sibling.item.sourceName;
    const matchRender = isScaleSensitive(placement);
    stageOrRun({
        key: pendingKey(placement),
        label: `Size ${mine} to ${theirs}`,
        value: sibling.item.id,
        /*
         * No `liveValue`. A resize is not a two-state control that can be staged
         * back to where it started — there is no click that means "un-match" —
         * so there is nothing for the toggled-twice collapse to catch, and
         * offering it one would only give it a chance to throw the change away.
         * Same shape as removeSourceFromScene, for the same reason.
         */
        run: async () => {
            const size = await useObsStore.getState().matchSceneItemSize({
                scene: placement.scene,
                itemId: placement.item.id,
                modelScene: sibling.scene,
                modelItemId: sibling.item.id,
                sourceName: mine,
                matchRender,
            });
            /*
             * The RESOLUTION is worth a clause when it moved, and only then. It
             * is a change to a global input — the same source in another scene
             * has just been re-solved to hold its size — so a producer who goes
             * looking should find it named. On the ordinary press it did not
             * move and there is nothing to report.
             */
            const redrawn = size?.render
                ? ` Both now render at ${size.render.width} × ${size.render.height}.`
                : '';
            notifications.show({
                color: 'green',
                message: (size?.width
                    ? `${mine} is now ${Math.round(size.width)} × ${Math.round(size.height)}`
                        + ` — the same as ${label}.`
                    : `${mine} now matches ${theirs}.`) + redrawn,
            });
        },
    });
}

const SizeMatchRow = memo(function SizeMatchRow({ placement, placements }) {
    const sibling = sideSibling(placement, placements);
    const { label } = useSideLabels();
    const boardTag = useBoardTag();
    // Hooks before the bail-out: a placement that gains or loses its sibling
    // mid-session (the producer adds the other side while this panel is open)
    // must not change how many hooks this component runs.
    const staged = !!usePending(placement?.item ? pendingKey(placement) : '∅');
    const run = useCallback(
        () => sibling && matchSize(placement, sibling, label(sideOfVariant(sibling.variant))),
        [placement, sibling, label],
    );
    if (!sibling) return null;

    // Across boards the side alone is ambiguous — say which board's half it is.
    const crossBoard = sibling.board != null && sibling.board !== placement.board;
    const other = label(sideOfVariant(sibling.variant))
        + (crossBoard ? ` · ${boardTag(sibling.board)}` : '');
    return (
        <FieldRow label="Size" staged={staged}>
            <Button
                size="xs" variant="secondary" onClick={run}
                className="h-7 min-w-0 flex-1"
                title={`Resize ${placement.item.sourceName} in OBS to exactly the size of `
                    + `${sibling.item.sourceName}. Where it sits is left alone.`}
            >
                <Scaling size={11} className="mr-1" />
                <span className="truncate">Match {other}</span>
            </Button>
            <StagedDot show={staged} />
        </FieldRow>
    );
});

export default SizeMatchRow;

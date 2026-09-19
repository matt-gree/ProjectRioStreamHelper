import { memo, useCallback } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useObsStore } from '../../../context/obs';
import { stageOrRun, usePending } from '../../../context/staging';
import { notifications } from '../../../lib/notify';
import { Button } from '../../../components/ui/button';
import { Text } from '../../../components/ui/primitives';
import { FieldRow } from '../kit';
import { StagedDot } from '../controls';
import { stretchOfPlacement } from '../sources/placements';

/*
 * "OBS is scaling this source."
 *
 * A browser source has a resolution (the input's own width/height — the
 * viewport the page lays itself out in) and a size on the canvas (the scene
 * item's transform). Dragging an item's handles moves only the second, so the
 * producer's natural gesture for resizing scales a FINISHED TEXTURE: the page
 * is still rendered at the old resolution and OBS resamples the result. Nothing
 * in either program says a word about it.
 *
 * EITHER DIRECTION IS WRONG HERE, which is what separates this from a quality
 * warning. Enlarging softens, and shrinking is lossless — but an element that
 * draws type at an absolute size is drawing a 48px name at 24px on a half-scale
 * item. The producer set 48, the broadcast shows 24, and both programs agree
 * that everything is fine.
 *
 * Redrawing reconciles them: the page re-renders at the size the item occupies
 * and the scaling comes out. THE BOX DOES NOT MOVE OR CHANGE SIZE — same
 * rectangle on the canvas, drawn instead of resampled — so an element that fits
 * its viewport looks identical and merely sharper, and fixed-size type comes
 * back to its real size. Which is precisely what a producer means when they
 * drag a Player Name box: the box got bigger, the name did not.
 *
 * That is not an exotic failure — it is what happens the first time anyone
 * drags a corner. The console can see it (the item's rendered size against its
 * source's), so it should say so.
 *
 * IT RENDERS ONLY WHEN THERE IS SOMETHING TO SAY. A permanent "resolution"
 * control on every panel would be a knob nobody needs on a source that is
 * already sharp, and OBS Properties already owns setting a size by hand. Same
 * rule as the size match beside it.
 *
 * WHY IT IS WORTH A BUTTON RATHER THAN A WARNING. The fix is arithmetic the
 * producer should not have to do — read the rendered size out of Edit
 * Transform, type it into Properties, then put the scale back to 1 — and the
 * step everyone forgets is the last one, which leaves the source twice the size
 * it was. Worse, an OBS input is GLOBAL: doing it by hand in one scene resizes
 * the same source in every other scene that draws it. The store's
 * redrawSourceAtSize corrects all of them (see ../../../lib/obs-transform.js);
 * a producer with a scoreboard in four scenes cannot.
 *
 * It is the Player Name that made this worth building — its type size is an
 * absolute number now, so "48px" is only the truth while the item is drawn 1:1
 * — but nothing here is about that element, and every stretched browser source
 * in the show is softer than it should be.
 */

const pendingKey = (placement) => `obs:redraw:${placement.scene}:${placement.item.id}`;

export function redrawSource(placement) {
    const name = placement.item.sourceName;
    stageOrRun({
        key: pendingKey(placement),
        // No numbers in the label. The size is whatever the item is drawn at
        // when this RUNS, which under confirm mode is not what it was drawn at
        // when it was staged — a staged line quoting a stale pair of numbers
        // would be a promise the run is right to break. The toast reports what
        // it landed on.
        label: `Redraw ${name} at the size it is drawn`,
        value: 'redraw',
        /*
         * No `liveValue`, for the same reason the size match has none: there is
         * no click that means "un-redraw", so there is nothing for the
         * toggled-twice collapse to catch and offering it one could only throw
         * the change away.
         *
         * The size is read at RUN time inside the store action, never here.
         * Under confirm mode the producer may keep dragging between staging this
         * and going live, and the size to commit is the one on screen then.
         */
        run: async () => {
            const done = await useObsStore.getState().redrawSourceAtSize({
                scene: placement.scene,
                itemId: placement.item.id,
                sourceName: name,
            });
            notifications.show({
                color: 'green',
                message: `${name} now renders at ${done.width} × ${done.height}`
                    + (done.scenes > 1 ? `, in all ${done.scenes} scenes that use it.` : '.'),
            });
        },
    });
}

const RedrawRow = memo(function RedrawRow({ placement }) {
    const staged = !!usePending(placement?.item ? pendingKey(placement) : '∅');
    const run = useCallback(() => redrawSource(placement), [placement]);

    /*
     * The verdict is mirrored on the item (obs.jsx `mapItem`), so this row costs
     * no round trip and stays true while the producer drags. The SIZE to redraw
     * at is not mirrored and is read at run time — see redrawSource.
     *
     * Which rows may say it — the Player Name's, and not a fed one — is
     * `stretchOfPlacement` in ../sources/placements, shared with the rack badge so the
     * two surfaces cannot disagree about whether a source has a problem.
     */
    const stretch = stretchOfPlacement(placement);
    if (!stretch) return null;

    const factor = `${stretch.toFixed(1)}×`;

    /*
     * A CROP is the one stretch with no one-press fix: the crop is stated in
     * source pixels, so raising the resolution would move what it cuts away
     * (../../../lib/obs-transform.js). The row still appears — a console that
     * went quiet exactly where it could not help would be quietest about the
     * hardest cases — and says what to do instead.
     */
    if (placement.item.cropped) {
        return (
            <FieldRow label="Render">
                <Text size="xs" className="min-w-0 text-amber-300/90">
                    OBS is scaling this {factor} — cropped, so set its size in OBS Properties.
                </Text>
            </FieldRow>
        );
    }

    return (
        <FieldRow label="Render" staged={staged}>
            <Button
                size="xs" variant="secondary" onClick={run}
                className="h-7 min-w-0 flex-1 border-amber-500/40 text-amber-200 hover:text-amber-100"
                title={`OBS is drawing this source at ${factor} the resolution it renders at, so `
                    + `what goes out is a resampled picture of it rather than it. Redrawing `
                    + `re-renders the page at the size this box occupies, in every scene that uses `
                    + `the source. The box does not move or change size; anything drawn at a fixed `
                    + `size — the Player Name's type — comes back to that size.`}
            >
                <TriangleAlert size={11} className="mr-1 shrink-0 text-amber-400" />
                <span className="truncate">Scaled {factor} — redraw at true size</span>
            </Button>
            <StagedDot show={staged} />
        </FieldRow>
    );
});

export default RedrawRow;

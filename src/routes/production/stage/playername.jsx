import { memo } from 'react';
import { useSettingsStore } from '../../../context/store';
import { usePending } from '../../../context/staging';
import { DirectStage } from './generic';
import { StatusLine } from '../kit';
import { OverlaySettingGroups, useOverlaySettings } from './overlay-settings';
import {
    heightForNameSize, resolveNameSize, resolvePrefixPosition, resolvePrefixSize,
} from '../../../../public/layout/lib/playername-mount.js';

/*
 * Player Name stage.
 *
 * The element exists to draw one name at a size the producer typed, and the
 * whole of its panel is that number plus the two questions about where the name
 * sits. What earns it a body of its own is the sentence under the number.
 *
 * ── WHY THE SIZE ROW NEEDS A READOUT ──
 *
 * `nameSize` is absolute, and the source's own box is a CEILING on it — the
 * name comes down when it will not fit, on either axis, rather than being
 * clipped. Both clamps are correct and both are invisible: the producer sets
 * 48, the broadcast draws 33, and every surface in both programs reports that
 * everything is fine.
 *
 * The HEIGHT one is the trap, because the threshold is not intuitive and the
 * instinct it defeats is the natural one. 48px type with a prefix row above it
 * needs 87px of frame. A producer shaping a name bar drags it wide and short —
 * 1600×60, say — and the name clamps to 33px from the first frame; widening it
 * to 2400 or 3200 changes nothing at all, because width was never what was
 * binding. Measured, not reasoned: those three boxes draw 33.23px each.
 *
 * So the panel says which axis is holding the name down and what the frame
 * would have to be. `heightForNameSize` is the mount's own inverse, imported
 * rather than restated, so the panel and the overlay cannot disagree about the
 * threshold.
 *
 * THE WIDTH CLAMP IS REPORTED WITHOUT A NUMBER, deliberately. Whether a name
 * overflows depends on the glyphs in it, and the honest way to know is to
 * measure the text — which the overlay does, in its own document, with the font
 * it actually loaded. Re-measuring here with a canvas would be a second
 * implementation of the fit, in a different renderer, free to disagree with the
 * first about the exact case it exists to explain. The panel says the rule and
 * the preview below it shows the result.
 */

/*
 * Size, then where the two runs sit, then the second size — which is last
 * because it is the only one that does nothing until the prefix is turned on.
 */
const FIT_KEYS = ['nameSize', 'align', 'prefixPosition', 'prefixSize'];

// The frame the OBS source really is, which is not the element's declared
// native size once a producer has resized it (../../../context/obs.jsx mapItem).
function sourceFrame(placement) {
    const w = placement?.item?.renderWidth;
    const h = placement?.item?.renderHeight;
    return (w > 0 && h > 0) ? { width: w, height: h } : null;
}

/*
 * Staged values count. Under confirm mode the producer changes the size and
 * reads this line before pressing Go Live — a line describing the value that is
 * about to be replaced would be worse than no line.
 */
function useLiveSetting(key, fallback) {
    const stored = useSettingsStore(s => s?.overlays?.playername?.[key]);
    const pending = usePending(`settings:overlays.playername.${key}`);
    return pending ? pending.value : (stored ?? fallback);
}

export const NameSizeNote = memo(function NameSizeNote({ placement }) {
    const size = resolveNameSize(useLiveSetting('nameSize', 48));
    const prefix = resolvePrefixPosition(useLiveSetting('prefixPosition', 'above'));
    const tag = resolvePrefixSize(useLiveSetting('prefixSize', 24));
    const frame = sourceFrame(placement);
    /*
     * Ceiled off a value nudged past its own float error. 48px with no prefix
     * row needs exactly 45 authored units, which arrives as 60.000000000000014
     * — and a bare ceil would tell a producer whose source is exactly 60px tall
     * that they need 61, in the one sentence on the panel whose entire job is to
     * be a number they can act on.
     */
    const needed = Math.ceil(heightForNameSize(size, prefix, tag) - 1e-6);

    // With no OBS connection there is no frame to measure against, and the rule
    // on its own is still worth saying — it is the thing nobody guesses.
    /*
     * THE NUMBER IS THE VALUE; THE RULE BEHIND IT IS THE EXPANSION.
     *
     * All three of these were paragraphs, and the one thing a producer can act
     * on in any of them is a height in pixels — which was the last clause of a
     * sentence in the same 11px grey as the rule it was buried in. HEIGHT IS
     * THE AXIS THAT BINDS and widening is the instinct that defeats it, so the
     * eyebrow says so in one word and the number sits where a number belongs.
     *
     * Nothing is lost, deliberately: this is the panel half of a note the mount
     * also reports (`sizeNote`, over the same `heightForNameSize`), and the two
     * must not be able to disagree about the threshold or about why widening
     * does not help.
     */
    if (!frame) {
        return (
            <StatusLine
                label="MIN HEIGHT"
                title={`${size}px type needs a source at least ${needed}px tall`
                    + `${prefix === 'off' ? '' : `, including the ${tag}px prefix row`}.`
                    + ' A wider source is more room for the name to run, never a bigger name.'}
            >
                {needed}px for {size}px type
            </StatusLine>
        );
    }

    if (frame.height < needed) {
        const drawn = Math.round(size * (frame.height / needed));
        return (
            <StatusLine
                tone="warn"
                label="CLAMPED"
                title={`This source is ${frame.width} × ${frame.height}, and ${size}px needs`
                    + ` ${needed}px of height. Widening it will not help — height is what binds.`}
            >
                Drawing {drawn}px, not {size}px
            </StatusLine>
        );
    }

    return (
        <StatusLine
            label="FITS"
            title={`A long name still shrinks to fit the width — that side alone, so the`
                + ` other keeps ${size}px.`}
        >
            {frame.width} × {frame.height} holds {size}px
        </StatusLine>
    );
});

export function PlayerNameStage({ element, board, placement }) {
    /*
     * NOT board-scoped, and it is the only per-side element that isn't: the
     * namespace is a flat `overlays.playername.*` shared by both sides and every
     * board, which is the whole reason one typed size is one size across the
     * show. A `playername.{N}` namespace here would quietly undo that.
     */
    const os = useOverlaySettings('playername', 'playername', 'Player Name', null);
    return (
        <>
            <DirectStage element={element} board={board} placement={placement} />
            <OverlaySettingGroups os={os} type="playername" keys={FIT_KEYS} />
            <NameSizeNote placement={placement} />
        </>
    );
}

PlayerNameStage.surfacedKeys = FIT_KEYS;

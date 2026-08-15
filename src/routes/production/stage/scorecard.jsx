import { memo } from 'react';
import { LAYOUT_SETTINGS } from '../../layouts/designConstants';
import { DirectStage } from './generic';
import { OverlaySettingGroups, OverlaySettingRow, defsFor, useOverlaySettings } from './overlay-settings';

/*
 * Vertical Scorecard stage.
 *
 * Every numbered band of the scorecard is an independent switch the producer
 * flips during the broadcast (the mount animates each group in/out), so these
 * live on the console next to the source's on-air toggle rather than only in
 * Setup. Config is per board (overlays.scorecard.{N}.*) so two scorecard
 * sources can be driven independently.
 *
 * Everything is grouped by where it sits on the card — top bars, score block,
 * lower bars — which puts the header title and the phase text beside the
 * switches that turn those bars on. They used to sit in the stage's catch-all
 * Style section, a scroll below the switch they belong to, with a sentence in
 * this panel explaining where they had gone. Colours come from the active
 * design package.
 *
 * The score-block mode is one of those rows now, in card order, rather than a
 * flat row pinned above the groups. It led the panel back when the score block
 * was a region with switches of its own and the mode was the headline decision
 * among them; with those switches gone the mode IS the region, and a control
 * hoisted out of the order it belongs to is just a control in the wrong place.
 * It is still the rail's quick face — see ScorecardModeRow.
 */

const MODE_KEY = 'mainMode';

/*
 * `board` is the INSTANCE's board, handed down by whichever surface is
 * rendering — the stage panel or a rail card. It used to be a per-element
 * persisted preference resolved separately by each, which meant the surfaces
 * agreed only because they happened to read the same localStorage key. Now the
 * board is part of the selection/pin itself (../instances), so there is nothing
 * left to disagree about, and there is no board dropdown here: switching board
 * means picking the other Scorecard row in the rack.
 */
export function useScorecard(board = 1) {
    const os = useOverlaySettings('scorecard', `scorecard.${board}`, `Scorecard ${board}`, board);
    return { board, os };
}

// The scorecard's headline live control, as the rail card's one quick-face row
// (the stage draws the same def inline, in card order, via the groups below).
export const ScorecardModeRow = memo(function ScorecardModeRow({ sc }) {
    const [def] = defsFor('scorecard', [MODE_KEY]);
    if (!def) return null;
    return <OverlaySettingRow os={sc.os} def={def} />;
});

export default function ScorecardStage({ element, board, placement }) {
    const sc = useScorecard(board);

    return (
        <>
            <DirectStage element={element} board={board} placement={placement} />

            <div className="mt-1 flex flex-col gap-3 border-t border-border/60 pt-2">
                <OverlaySettingGroups os={sc.os} type="scorecard" />
            </div>
        </>
    );
}

// Everything, so the Style section renders nothing: the groups above already
// cover the card end to end, and a "Style" heading under them would be a fourth
// region the card doesn't have. Config is per board (overlays.scorecard.{N}.*).
ScorecardStage.surfacedKeys = LAYOUT_SETTINGS.scorecard.map(d => d.key);

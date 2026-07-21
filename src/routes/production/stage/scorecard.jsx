import { memo } from 'react';
import { Text } from '../../../components/ui/primitives';
import { useBoardLabel } from '../boards';
import { DirectStage } from './generic';
import { OverlaySettingRow, OverlaySettingRows, defsFor, useOverlaySettings } from './overlay-settings';

/*
 * Vertical Scorecard stage.
 *
 * Every numbered band of the scorecard is an independent switch the producer
 * flips during the broadcast (the mount animates each group in/out), so these
 * live on the console next to the source's on-air toggle rather than only in
 * Setup. Config is per board (overlays.scorecard.{N}.*) so two scorecard
 * sources can be driven independently.
 *
 * The score block leads because it's the headline decision (full block /
 * condensed bar / off); the bands follow in the order they stack on screen.
 * Header title and phase text stay in Setup — authored per event, not flipped
 * live, and the kit has no text row.
 */

const MODE_KEY = 'mainMode';
const BAND_KEYS = [
    'showHeader', 'showPhase', 'showGameMode', 'showRosters',
    'showBases', 'showAtBat', 'showBoxScore', 'showStadium',
];

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
    const boardLabel = useBoardLabel();
    const os = useOverlaySettings('scorecard', `scorecard.${board}`, `Scorecard ${board}`, board);
    return { boardLabel, board, os };
}

// The scorecard's headline live control — also its rail quick-face row.
export const ScorecardModeRow = memo(function ScorecardModeRow({ sc }) {
    const [def] = defsFor('scorecard', [MODE_KEY]);
    if (!def) return null;
    return <OverlaySettingRow os={sc.os} def={def} />;
});

export default function ScorecardStage({ element, board }) {
    const sc = useScorecard(board);

    return (
        <>
            <DirectStage element={element} board={board} />

            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <ScorecardModeRow sc={sc} />
                <OverlaySettingRows os={sc.os} type="scorecard" keys={BAND_KEYS} />
            </div>

            <Text size="xs" className="border-t border-border/60 pt-2 text-muted-foreground">
                Bands animate in and out as you flip them, and apply to{' '}
                <b>{sc.boardLabel(sc.board)}</b> only. Header title, phase text and
                colours are authored in Setup → Layouts.
            </Text>
        </>
    );
}

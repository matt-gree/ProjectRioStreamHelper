import { memo, useMemo } from 'react';
import { usePersistentState } from '../../../hooks/usePersistentState';
import { Text } from '../../../components/ui/primitives';
import { SelectRow } from '../kit';
import { useActiveBoards, useBoardLabel } from '../boards';
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

export function useScorecard() {
    const boards = useActiveBoards();
    const boardLabel = useBoardLabel();
    const [stored, setBoard] = usePersistentState('prsh.ui.production.scorecard.board', null);
    // A board can be removed while it's still the stored pick.
    const board = boards.includes(stored) ? stored : boards[0];
    const os = useOverlaySettings('scorecard', `scorecard.${board}`, `Scorecard ${board}`, board);
    return { boards, boardLabel, board, setBoard, os };
}

// The scorecard's headline live control — also its rail quick-face row.
export const ScorecardModeRow = memo(function ScorecardModeRow({ sc }) {
    const [def] = defsFor('scorecard', [MODE_KEY]);
    if (!def) return null;
    return <OverlaySettingRow os={sc.os} def={def} />;
});

export default function ScorecardStage({ element }) {
    const sc = useScorecard();
    const boardOptions = useMemo(
        () => sc.boards.map(n => ({ label: sc.boardLabel(n), value: String(n) })),
        [sc.boards, sc.boardLabel],
    );

    return (
        <>
            <DirectStage element={element} />

            {sc.boards.length > 1 && (
                <SelectRow
                    label="Board" value={String(sc.board)}
                    onChange={(v) => sc.setBoard(Number(v))}
                    options={boardOptions}
                />
            )}

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

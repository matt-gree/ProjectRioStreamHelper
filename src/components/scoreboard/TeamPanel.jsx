import { useCallback } from 'react';
import { Panel } from '../ui/panel';
import { Stack } from '../ui/primitives';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { useStateStore } from '../../context/store';
import PlayerSlot from './PlayerSlot';

/**
 * One team column containing a single player slot.
 *
 * Props:
 *   scoreboardNumber: number (usually 1)
 *   teamNumber: 1 | 2
 *   playerCount: number of player slots (default 1)
 */
export default function TeamPanel({ scoreboardNumber = 1, teamNumber, playerCount = 1, sourceType = 'manual' }) {
    const setItem = useStateStore(s => s.setItem);
    const homeTeam = useStateStore(
        s => Number(s?.score?.[scoreboardNumber]?.home_team ?? 2)
    );
    const losers = useStateStore(
        s => s?.score?.[scoreboardNumber]?.player?.[teamNumber]?.losers ?? false
    );

    const isHome = homeTeam === teamNumber;
    const otherTeam = teamNumber === 1 ? 2 : 1;

    const toggleHome = useCallback(() => {
        setItem(`score.${scoreboardNumber}.home_team`, isHome ? otherTeam : teamNumber);
    }, [scoreboardNumber, teamNumber, otherTeam, isHome, setItem]);

    const toggleLosers = useCallback(() => {
        if (losers) {
            // Already on for this team — toggle off
            setItem(`score.${scoreboardNumber}.player.${teamNumber}.losers`, false);
        } else {
            // Turn on for this team, turn off for the other
            setItem(`score.${scoreboardNumber}.player.${teamNumber}.losers`, true);
            setItem(`score.${scoreboardNumber}.player.${otherTeam}.losers`, false);
        }
    }, [scoreboardNumber, teamNumber, otherTeam, losers, setItem]);

    const playerSlots = [];
    for (let p = 1; p <= playerCount; p++) {
        playerSlots.push(
            <PlayerSlot
                key={p}
                scoreboardNumber={scoreboardNumber}
                teamNumber={teamNumber}
                playerNumber={p}
                sourceType={sourceType}
            />
        );
    }

    // Side + bracket-side controls live in the panel header so the player
    // row below stays uncluttered.
    const headerActions = (
        <>
            <button type="button" onClick={toggleLosers} title="Losers bracket">
                <Badge
                    className={cn(
                        'px-1.5 text-[10px] font-semibold uppercase tracking-wider',
                        losers ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground'
                    )}
                >Losers</Badge>
            </button>
            <button type="button" onClick={toggleHome} title="Toggle home/away">
                <Badge
                    className={cn(
                        'min-w-[48px] justify-center px-1.5 text-[10px] font-semibold uppercase tracking-wider',
                        isHome ? 'bg-[#3b82f6]/15 text-[#60a5fa]' : 'bg-muted text-muted-foreground'
                    )}
                >{isHome ? 'Home' : 'Away'}</Badge>
            </button>
        </>
    );

    return (
        <Panel glow={false} title={`Team ${teamNumber}`} actions={headerActions} className="flex-1">
            <div className="p-3.5">
                <Stack gap="md">
                    {playerSlots}
                </Stack>
            </div>
        </Panel>
    );
}

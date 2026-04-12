import { useCallback } from 'react';
import { Stack, Paper, Text, Group, Badge, UnstyledButton } from '@mantine/core';
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

    return (
        <Paper withBorder p="sm" style={{ flex: 1 }}>
            <Stack gap="xs">
                <Group justify="space-between">
                    <Text size="sm" fw={700}>Team {teamNumber}</Text>
                    <Group gap={4}>
                        <UnstyledButton onClick={toggleLosers}>
                            <Badge size="sm" color={losers ? 'red' : 'gray'} variant={losers ? 'filled' : 'light'}>L</Badge>
                        </UnstyledButton>
                        <UnstyledButton onClick={toggleHome}>
                            {isHome ? (
                                <Badge size="sm" color="blue" variant="filled">Home</Badge>
                            ) : (
                                <Badge size="sm" color="gray" variant="light">Away</Badge>
                            )}
                        </UnstyledButton>
                    </Group>
                </Group>
                {playerSlots}
            </Stack>
        </Paper>
    );
}

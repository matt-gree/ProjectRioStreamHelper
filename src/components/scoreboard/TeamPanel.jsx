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

    const isHome = homeTeam === teamNumber;

    const otherTeam = teamNumber === 1 ? 2 : 1;

    const toggleHome = useCallback(() => {
        // If this team is home, make the other team home (i.e. make this one away)
        // If this team is away, make this team home
        setItem(`score.${scoreboardNumber}.home_team`, isHome ? otherTeam : teamNumber);
    }, [scoreboardNumber, teamNumber, otherTeam, isHome, setItem]);

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
                    <UnstyledButton onClick={toggleHome}>
                        {isHome ? (
                            <Badge size="sm" color="blue" variant="filled">Home</Badge>
                        ) : (
                            <Badge size="sm" color="gray" variant="light">Away</Badge>
                        )}
                    </UnstyledButton>
                </Group>
                {playerSlots}
            </Stack>
        </Paper>
    );
}

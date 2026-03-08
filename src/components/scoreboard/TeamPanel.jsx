import { useCallback } from 'react';
import { TextInput, Checkbox, Stack, Paper, Text, ScrollArea } from '@mantine/core';
import { useStateStore } from '../../context/store';
import PlayerSlot from './PlayerSlot';

/**
 * One team column containing team name + N player slots.
 *
 * Props:
 *   scoreboardNumber: number (usually 1)
 *   teamNumber: 1 | 2
 *   playerCount: number of player slots (default 1)
 *   label: display label ("Team 1" / "Team 2")
 */
export default function TeamPanel({ scoreboardNumber = 1, teamNumber, playerCount = 1, label }) {
    const basePath = `score.${scoreboardNumber}.team.${teamNumber}`;
    const setItem = useStateStore(s => s.setItem);

    const teamName = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.teamName ?? '');
    const losers   = useStateStore(s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.losers ?? false);

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    const playerSlots = [];
    for (let p = 1; p <= playerCount; p++) {
        playerSlots.push(
            <PlayerSlot
                key={p}
                scoreboardNumber={scoreboardNumber}
                teamNumber={teamNumber}
                playerNumber={p}
            />
        );
    }

    return (
        <Paper withBorder p="sm" style={{ flex: 1 }}>
            <Stack gap="xs">
                <Text size="sm" fw={700} ta="center">{label || `Team ${teamNumber}`}</Text>
                <TextInput
                    label="Team Name"
                    placeholder="Team name"
                    size="xs"
                    value={teamName}
                    onChange={e => set('teamName', e.currentTarget.value)}
                />
                <Checkbox
                    label="Losers"
                    size="xs"
                    checked={losers}
                    onChange={e => set('losers', e.currentTarget.checked)}
                />
                <ScrollArea.Autosize mah={500} type="auto">
                    <Stack gap={0}>
                        {playerSlots}
                    </Stack>
                </ScrollArea.Autosize>
            </Stack>
        </Paper>
    );
}

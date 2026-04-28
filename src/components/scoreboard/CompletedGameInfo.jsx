import {
    Paper, Stack, Group, Text, Grid, Badge, useMantineColorScheme,
} from '@mantine/core';
import { useStateStore } from '../../context/store';
import { STADIUM_OPTIONS } from '../../data/stadiums';

const STADIUM_LABELS = Object.fromEntries(STADIUM_OPTIONS.map(o => [o.value, o.label]));

export default function CompletedGameInfo({ scoreboardNumber = 1 }) {
    const gameCompleted     = useStateStore(s => s?.score?.[scoreboardNumber]?.game_completed ?? false);
    const gameId            = useStateStore(s => s?.score?.[scoreboardNumber]?.game_id);
    const stadium           = useStateStore(s => s?.score?.[scoreboardNumber]?.stadium ?? '');
    const gameMode          = useStateStore(s => s?.score?.[scoreboardNumber]?.game_mode ?? '');
    const inningsPlayed     = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_played);
    const inningsSelected   = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_selected);
    const dateTimeEnd       = useStateStore(s => s?.score?.[scoreboardNumber]?.date_time_end);
    const winnerIncomingElo = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_incoming_elo);
    const winnerResultElo   = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_result_elo);
    const loserIncomingElo  = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_incoming_elo);
    const loserResultElo    = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_result_elo);
    const winnerUser        = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_user ?? '');
    const loserUser         = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_user ?? '');

    const { colorScheme } = useMantineColorScheme();
    if (!gameCompleted) return null;

    const bg = colorScheme === 'dark'
        ? 'var(--mantine-color-violet-9)'
        : 'var(--mantine-color-violet-0)';

    return (
        <Paper p="xs" withBorder style={{ backgroundColor: bg }}>
            <Stack gap={4}>
                <Group justify="space-between">
                    <Text size="xs" fw={600} c="violet">Completed Game</Text>
                    {gameId && (
                        <Badge
                            size="xs"
                            variant={colorScheme === 'dark' ? 'white' : 'light'}
                            color="violet"
                        >
                            #{gameId}
                        </Badge>
                    )}
                </Group>
                {(winnerUser || loserUser) && (
                    <Group gap="xs">
                        <Text size="xs" fw={600} c="teal">{winnerUser}</Text>
                        <Text size="xs" c="dimmed">def.</Text>
                        <Text size="xs" fw={600} c="red">{loserUser}</Text>
                    </Group>
                )}
                <Grid gutter={4}>
                    {stadium && (
                        <Grid.Col span={6}>
                            <Text size="xs" c="dimmed">Stadium</Text>
                            <Text size="xs">{STADIUM_LABELS[stadium] || stadium}</Text>
                        </Grid.Col>
                    )}
                    {gameMode && (
                        <Grid.Col span={6}>
                            <Text size="xs" c="dimmed">Mode</Text>
                            <Text size="xs">{gameMode}</Text>
                        </Grid.Col>
                    )}
                    {inningsPlayed != null && (
                        <Grid.Col span={6}>
                            <Text size="xs" c="dimmed">Innings</Text>
                            <Text size="xs">{inningsPlayed}/{inningsSelected ?? '?'}</Text>
                        </Grid.Col>
                    )}
                    {dateTimeEnd && (
                        <Grid.Col span={6}>
                            <Text size="xs" c="dimmed">Played</Text>
                            <Text size="xs">
                                {(() => {
                                    try { return new Date(dateTimeEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
                                    catch { return ''; }
                                })()}
                            </Text>
                        </Grid.Col>
                    )}
                </Grid>
                {(winnerIncomingElo != null || loserIncomingElo != null) && (
                    <Group gap="md">
                        {winnerIncomingElo != null && (
                            <Text size="xs">
                                <Text span c="dimmed">W ELO: </Text>
                                {winnerIncomingElo} → {winnerResultElo}
                                {winnerResultElo > winnerIncomingElo && (
                                    <Text span c="teal" fw={600}> (+{winnerResultElo - winnerIncomingElo})</Text>
                                )}
                            </Text>
                        )}
                        {loserIncomingElo != null && (
                            <Text size="xs">
                                <Text span c="dimmed">L ELO: </Text>
                                {loserIncomingElo} → {loserResultElo}
                                {loserResultElo < loserIncomingElo && (
                                    <Text span c="red" fw={600}> ({loserResultElo - loserIncomingElo})</Text>
                                )}
                            </Text>
                        )}
                    </Group>
                )}
            </Stack>
        </Paper>
    );
}

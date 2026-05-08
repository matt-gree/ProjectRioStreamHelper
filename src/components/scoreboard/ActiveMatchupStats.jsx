import { useState, useCallback, useMemo } from 'react';
import {
    Paper, Stack, Text, Group, SegmentedControl, Button, Loader, Divider,
} from '@mantine/core';
import { useStateStore } from '../../context/store';
import {
    deriveBatting, derivePitching,
    DERIVED_BATTING_LABELS, DERIVED_PITCHING_LABELS,
} from '../../utils/statCalc';

/**
 * Find a character's stats by roster index (preferred) or name fallback.
 * Returns { teamNum, charIdx, stats } or null.
 */
function findCharStats(scoreState, charName, rosterIndex) {
    if (!charName || !scoreState?.stats) return null;

    if (rosterIndex != null && rosterIndex >= 0) {
        for (const teamNum of [1, 2]) {
            const charData = scoreState.stats?.[teamNum]?.character?.[rosterIndex];
            if (charData?.name === charName) {
                return { teamNum, charIdx: rosterIndex, stats: charData };
            }
        }
    }

    for (const teamNum of [1, 2]) {
        const chars = scoreState.stats[teamNum]?.character;
        if (!chars) continue;
        for (let i = 0; i < 9; i++) {
            if (chars[i]?.name === charName) {
                return { teamNum, charIdx: i, stats: chars[i] };
            }
        }
    }
    return null;
}

function StatLine({ label, stats, type, scope }) {
    const raw = scope === 'game'
        ? stats?.current_game?.[type] ?? {}
        : stats?.[type] ?? {};

    const derived = type === 'batting' ? deriveBatting(raw) : derivePitching(raw);
    const labels = type === 'batting' ? DERIVED_BATTING_LABELS : DERIVED_PITCHING_LABELS;

    // Pick the most useful subset to display compactly
    const keys = type === 'batting'
        ? ['avg', 'ops', 'so_pct']
        : ['era', 'k_pct', 'ip'];

    return (
        <Stack gap={2}>
            <Text size="xs" fw={600}>{label}</Text>
            <Group gap="sm">
                {keys.map(k => (
                    <Text key={k} size="xs">
                        <Text span c="dimmed">{labels[k]}</Text>{' '}
                        <Text span fw={600}>{derived[k]}</Text>
                    </Text>
                ))}
            </Group>
        </Stack>
    );
}

/**
 * Compact panel showing stats for the current batter and pitcher.
 *
 * Props:
 *   scoreboardNumber — which scoreboard to read from
 */
export default function ActiveMatchupStats({ scoreboardNumber = 1 }) {
    const [scope, setScope] = useState('season');
    const [refreshing, setRefreshing] = useState(false);

    const scoreState = useStateStore(s => s?.score?.[scoreboardNumber]);
    const batter = scoreState?.batter ?? '';
    const pitcher = scoreState?.pitcher ?? '';
    const batterRosterIndex = scoreState?.batter_roster_index ?? -1;
    const pitcherRosterIndex = scoreState?.pitcher_roster_index ?? -1;

    const batterInfo = useMemo(
        () => findCharStats(scoreState, batter, batterRosterIndex),
        [scoreState, batter, batterRosterIndex],
    );
    const pitcherInfo = useMemo(
        () => findCharStats(scoreState, pitcher, pitcherRosterIndex),
        [scoreState, pitcher, pitcherRosterIndex],
    );

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await fetch(`/api/v1/rio/stats/refresh?scoreboard=${scoreboardNumber}`, { method: 'POST' });
        } catch { /* ignore */ }
        setRefreshing(false);
    }, [scoreboardNumber]);

    const teamName = (num) =>
        scoreState?.player?.[num]?.teamName || `Team ${num}`;

    const hasBatter = batter && batterInfo?.stats;
    const hasPitcher = pitcher && pitcherInfo?.stats;

    if (!hasBatter && !hasPitcher) {
        return (
            <Paper withBorder p="sm">
                <Text size="xs" c="dimmed" ta="center">
                    No active batter/pitcher
                </Text>
            </Paper>
        );
    }

    return (
        <Paper withBorder p="sm">
            <Stack gap="xs">
                <Group justify="space-between">
                    <Text size="sm" fw={700}>Current Matchup</Text>
                    <SegmentedControl
                        size="xs"
                        value={scope}
                        onChange={setScope}
                        data={[
                            { value: 'season', label: 'Season' },
                            { value: 'game', label: 'This Game' },
                        ]}
                    />
                </Group>

                {hasBatter && (
                    <StatLine
                        label={`At Bat: ${batter} (${teamName(batterInfo.teamNum)})`}
                        stats={batterInfo.stats}
                        type="batting"
                        scope={scope}
                    />
                )}

                {hasBatter && hasPitcher && <Divider />}

                {hasPitcher && (
                    <StatLine
                        label={`Pitching: ${pitcher} (${teamName(pitcherInfo.teamNum)})`}
                        stats={pitcherInfo.stats}
                        type="pitching"
                        scope={scope}
                    />
                )}

                <Group justify="center">
                    <Button
                        size="xs"
                        variant="subtle"
                        onClick={handleRefresh}
                        disabled={refreshing}
                        leftSection={refreshing ? <Loader size={12} /> : null}
                    >
                        {refreshing ? 'Refreshing...' : 'Refresh Stats'}
                    </Button>
                </Group>
            </Stack>
        </Paper>
    );
}

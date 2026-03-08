import { useCallback } from 'react';
import {
    NumberInput, Select, Checkbox, Button, Group, Stack,
    Paper, Text, TextInput, Grid, Divider, ActionIcon
} from '@mantine/core';
import { useStateStore } from '../../context/store';
import { HALF_INNINGS } from '../../data/msb';

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

// Safely coerce a value to number (state may hold strings after socket round-trip)
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Central score column: scores, baseball state, match info.
 */
export default function ScoreControls({ scoreboardNumber = 1, onSwapTeams }) {
    const base = `score.${scoreboardNumber}`;
    const setItem = useStateStore(s => s.setItem);

    // Team scores
    const scoreLeft  = useStateStore(s => num(s?.score?.[scoreboardNumber]?.score_left, 0));
    const scoreRight = useStateStore(s => num(s?.score?.[scoreboardNumber]?.score_right, 0));

    // Baseball state
    const inning      = useStateStore(s => num(s?.score?.[scoreboardNumber]?.inning, 1));
    const halfInning  = useStateStore(s => s?.score?.[scoreboardNumber]?.half_inning ?? 'Top');
    const outs         = useStateStore(s => num(s?.score?.[scoreboardNumber]?.outs, 0));
    const strikes      = useStateStore(s => num(s?.score?.[scoreboardNumber]?.strikes, 0));
    const balls        = useStateStore(s => num(s?.score?.[scoreboardNumber]?.balls, 0));
    const runnerOn1    = useStateStore(s => !!s?.score?.[scoreboardNumber]?.cbRioRunnerOn1);
    const runnerOn2    = useStateStore(s => !!s?.score?.[scoreboardNumber]?.cbRioRunnerOn2);
    const runnerOn3    = useStateStore(s => !!s?.score?.[scoreboardNumber]?.cbRioRunnerOn3);

    // Batter / Pitcher
    const batter   = useStateStore(s => s?.score?.[scoreboardNumber]?.batter ?? '');
    const pitcher  = useStateStore(s => s?.score?.[scoreboardNumber]?.pitcher ?? '');

    // Match info
    const bestOf   = useStateStore(s => num(s?.score?.[scoreboardNumber]?.best_of, 3));
    const phase    = useStateStore(s => s?.score?.[scoreboardNumber]?.phase ?? '');
    const match    = useStateStore(s => s?.score?.[scoreboardNumber]?.match ?? '');

    const set = useCallback((field, value) => {
        setItem(`${base}.${field}`, value);
    }, [base, setItem]);

    const resetScores = useCallback(() => {
        setItem(`${base}.score_left`, 0);
        setItem(`${base}.score_right`, 0);
    }, [base, setItem]);

    const resetBaseballState = useCallback(() => {
        setItem(`${base}.inning`, 1);
        setItem(`${base}.half_inning`, 'Top');
        setItem(`${base}.outs`, 0);
        setItem(`${base}.strikes`, 0);
        setItem(`${base}.balls`, 0);
        setItem(`${base}.cbRioRunnerOn1`, false);
        setItem(`${base}.cbRioRunnerOn2`, false);
        setItem(`${base}.cbRioRunnerOn3`, false);
        setItem(`${base}.batter`, '');
        setItem(`${base}.pitcher`, '');
    }, [base, setItem]);

    // Guard NumberInput onChange — it can return '' (empty string)
    const setNum = useCallback((field, val, fallback = 0) => {
        set(field, val === '' ? fallback : Number(val));
    }, [set]);

    return (
        <Paper withBorder p="sm">
            <Stack gap="sm">
                {/* ---- Scores ---- */}
                <Text size="sm" fw={700} ta="center">Score</Text>
                <Group justify="center" gap="md">
                    <Stack align="center" gap={4}>
                        <ActionIcon
                            variant="filled" size="sm"
                            onClick={() => set('score_left', scoreLeft + 1)}
                        >
                            <Text size="xs">+</Text>
                        </ActionIcon>
                        <NumberInput
                            value={scoreLeft}
                            onChange={val => setNum('score_left', val)}
                            min={0}
                            size="xs"
                            w={60}
                            styles={{ input: { textAlign: 'center', fontWeight: 700, fontSize: 18 } }}
                        />
                        <ActionIcon
                            variant="filled" size="sm"
                            onClick={() => set('score_left', Math.max(0, scoreLeft - 1))}
                        >
                            <Text size="xs">-</Text>
                        </ActionIcon>
                    </Stack>

                    <Text fw={700} size="lg">vs</Text>

                    <Stack align="center" gap={4}>
                        <ActionIcon
                            variant="filled" size="sm"
                            onClick={() => set('score_right', scoreRight + 1)}
                        >
                            <Text size="xs">+</Text>
                        </ActionIcon>
                        <NumberInput
                            value={scoreRight}
                            onChange={val => setNum('score_right', val)}
                            min={0}
                            size="xs"
                            w={60}
                            styles={{ input: { textAlign: 'center', fontWeight: 700, fontSize: 18 } }}
                        />
                        <ActionIcon
                            variant="filled" size="sm"
                            onClick={() => set('score_right', Math.max(0, scoreRight - 1))}
                        >
                            <Text size="xs">-</Text>
                        </ActionIcon>
                    </Stack>
                </Group>

                <Group justify="center" gap="xs">
                    <Button size="xs" variant="outline" onClick={resetScores}>
                        Reset Scores
                    </Button>
                    <Button size="xs" variant="outline" onClick={onSwapTeams}>
                        Swap Teams
                    </Button>
                </Group>

                <Divider />

                {/* ---- Baseball State ---- */}
                <Text size="sm" fw={700} ta="center">Baseball</Text>
                <Grid gutter="xs">
                    <Grid.Col span={6}>
                        <NumberInput
                            label="Inning"
                            value={inning}
                            onChange={val => setNum('inning', val, 1)}
                            min={1} max={99}
                            size="xs"
                        />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <Select
                            label="Half"
                            data={halfInningOptions}
                            value={halfInning}
                            onChange={val => set('half_inning', val ?? 'Top')}
                            size="xs"
                        />
                    </Grid.Col>
                </Grid>

                <Grid gutter="xs">
                    <Grid.Col span={4}>
                        <NumberInput
                            label="Outs"
                            value={outs}
                            onChange={val => setNum('outs', val)}
                            min={0} max={3}
                            size="xs"
                        />
                    </Grid.Col>
                    <Grid.Col span={4}>
                        <NumberInput
                            label="Strikes"
                            value={strikes}
                            onChange={val => setNum('strikes', val)}
                            min={0} max={3}
                            size="xs"
                        />
                    </Grid.Col>
                    <Grid.Col span={4}>
                        <NumberInput
                            label="Balls"
                            value={balls}
                            onChange={val => setNum('balls', val)}
                            min={0} max={4}
                            size="xs"
                        />
                    </Grid.Col>
                </Grid>

                {/* Runners on base */}
                <Text size="xs" fw={600}>Runners</Text>
                <Group gap="md">
                    <Checkbox
                        label="1st"
                        size="xs"
                        checked={runnerOn1}
                        onChange={e => set('cbRioRunnerOn1', e.currentTarget.checked)}
                    />
                    <Checkbox
                        label="2nd"
                        size="xs"
                        checked={runnerOn2}
                        onChange={e => set('cbRioRunnerOn2', e.currentTarget.checked)}
                    />
                    <Checkbox
                        label="3rd"
                        size="xs"
                        checked={runnerOn3}
                        onChange={e => set('cbRioRunnerOn3', e.currentTarget.checked)}
                    />
                </Group>

                {/* Batter / Pitcher */}
                <Grid gutter="xs">
                    <Grid.Col span={6}>
                        <TextInput
                            label="Batter"
                            value={batter}
                            onChange={e => set('batter', e.currentTarget.value)}
                            size="xs"
                        />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <TextInput
                            label="Pitcher"
                            value={pitcher}
                            onChange={e => set('pitcher', e.currentTarget.value)}
                            size="xs"
                        />
                    </Grid.Col>
                </Grid>

                <Button size="xs" variant="light" color="red" onClick={resetBaseballState} fullWidth>
                    Reset Game State
                </Button>

                <Divider />

                {/* ---- Match Info ---- */}
                <Text size="sm" fw={700} ta="center">Match</Text>
                <Grid gutter="xs">
                    <Grid.Col span={4}>
                        <NumberInput
                            label="Best Of"
                            value={bestOf}
                            onChange={val => setNum('best_of', val, 3)}
                            min={1} max={99} step={2}
                            size="xs"
                        />
                    </Grid.Col>
                    <Grid.Col span={4}>
                        <TextInput
                            label="Phase"
                            value={phase}
                            onChange={e => set('phase', e.currentTarget.value)}
                            size="xs"
                        />
                    </Grid.Col>
                    <Grid.Col span={4}>
                        <TextInput
                            label="Match"
                            value={match}
                            onChange={e => set('match', e.currentTarget.value)}
                            size="xs"
                        />
                    </Grid.Col>
                </Grid>
            </Stack>
        </Paper>
    );
}

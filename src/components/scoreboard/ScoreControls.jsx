import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
    NumberInput, Select, Checkbox, Button, Group, Stack,
    Paper, Text, TextInput, Grid, Divider, ActionIcon,
    Popover, Badge, Loader,
} from '@mantine/core';
import { useStateStore, useSettingsStore } from '../../context/store';
import { HALF_INNINGS, ROSTER_SIZE } from '../../data/msb';

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

// Safely coerce a value to number (state may hold strings after socket round-trip)
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const sourceOptions = [
    { value: 'manual', label: 'Manual' },
    { value: 'hud', label: 'HUD File' },
    { value: 'api', label: 'API Game' },
];

/**
 * Build character name options from a team's roster in state.
 */
function useRosterOptions(scoreboardNumber, teamNumber) {
    const roster = useStateStore(
        s => s?.score?.[scoreboardNumber]?.team?.[teamNumber]?.player?.[1]?.character
    );
    return useMemo(() => {
        const seen = new Set();
        const opts = [];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            const name = roster?.[i]?.name;
            if (name && !seen.has(name)) {
                seen.add(name);
                opts.push({ value: name, label: name });
            }
        }
        return opts;
    }, [roster]);
}

/**
 * Central score column: scores, baseball state, match info.
 */
export default function ScoreControls({ scoreboardNumber = 1, onSwapTeams, sourceType = 'manual', onSetSource }) {
    const base = `score.${scoreboardNumber}`;
    const setItem = useStateStore(s => s.setItem);
    const settingsSetItem = useSettingsStore(s => s.setItem);

    // Team scores
    const scoreLeft  = useStateStore(s => num(s?.score?.[scoreboardNumber]?.score_left, 0));
    const scoreRight = useStateStore(s => num(s?.score?.[scoreboardNumber]?.score_right, 0));

    // Home team designation (1 or 2, default 2)
    const homeTeam = useStateStore(s => num(s?.score?.[scoreboardNumber]?.home_team, 2));

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

    // Game mode
    const statsTag = useSettingsStore(s => s?.project_rio?.stats_tag ?? '');
    const [gameModes, setGameModes] = useState([]);
    const [diagOpen, setDiagOpen] = useState(false);
    const [diagnostics, setDiagnostics] = useState(null);
    const [fetchingStats, setFetchingStats] = useState(false);
    const prevTagRef = useRef(statsTag);

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => {
                const opts = Object.entries(data).map(([name, id]) => ({
                    value: name,
                    label: name,
                }));
                setGameModes(opts);
            })
            .catch(() => {});
    }, []);

    // Poll diagnostics while a fetch is in progress
    const pollRef = useRef(null);
    const pollDiagnostics = useCallback(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
            fetch('/api/v1/rio/stats/diagnostics')
                .then(r => r.json())
                .then(d => {
                    setDiagnostics(d);
                    if (d.status !== 'loading') {
                        clearInterval(pollRef.current);
                        pollRef.current = null;
                        setFetchingStats(false);
                    }
                })
                .catch(() => {});
        }, 500);
    }, []);

    // Auto-fetch stats when game mode changes
    useEffect(() => {
        if (prevTagRef.current !== statsTag) {
            prevTagRef.current = statsTag;
            setFetchingStats(true);
            setDiagOpen(true);
            // Fire refresh (don't await — we poll diagnostics instead)
            fetch('/api/v1/rio/stats/refresh', { method: 'POST' })
                .catch(() => {});
            // Start polling diagnostics after a short delay for the loading state to be set
            setTimeout(pollDiagnostics, 200);
        }
    }, [statsTag, pollDiagnostics]);

    // Cleanup poll on unmount
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const handleGameModeChange = useCallback((val) => {
        settingsSetItem('project_rio.stats_tag', val ?? '');
    }, [settingsSetItem]);

    const handleInspect = useCallback(() => {
        setDiagOpen(true);
        fetch('/api/v1/rio/stats/diagnostics')
            .then(r => r.json())
            .then(d => setDiagnostics(d))
            .catch(() => {});
    }, []);

    // Determine batting/fielding teams based on half inning + home designation
    // Top = away bats, Bottom = home bats
    const awayTeam = homeTeam === 2 ? 1 : 2;
    const battingTeam = halfInning === 'Top' ? awayTeam : homeTeam;
    const fieldingTeam = halfInning === 'Top' ? homeTeam : awayTeam;

    const batterOptions = useRosterOptions(scoreboardNumber, battingTeam);
    const pitcherOptions = useRosterOptions(scoreboardNumber, fieldingTeam);

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
                {/* ---- Data Source ---- */}
                {onSetSource && (
                    <Select
                        label="Data Source"
                        data={sourceOptions}
                        value={sourceType}
                        onChange={val => onSetSource(val)}
                        size="xs"
                    />
                )}

                {/* ---- Game Mode ---- */}
                <Group gap={4} align="flex-end">
                    <Select
                        label="Game Mode"
                        placeholder="Select game mode"
                        data={gameModes}
                        value={statsTag || null}
                        onChange={handleGameModeChange}
                        size="xs"
                        searchable
                        clearable
                        style={{ flex: 1 }}
                    />
                    <Popover opened={diagOpen} onChange={setDiagOpen} position="bottom-end" withArrow width={320}>
                        <Popover.Target>
                            <ActionIcon
                                ref={undefined}
                                variant="subtle"
                                size="sm"
                                onClick={handleInspect}
                                title="Inspect stats fetch"
                            >
                                {fetchingStats ? <Loader size={12} /> : <Text size="xs" lh={1}>&#8505;</Text>}
                            </ActionIcon>
                        </Popover.Target>
                        <Popover.Dropdown>
                            <Stack gap="xs">
                                <Text size="xs" fw={600}>Stats Fetch Diagnostics</Text>
                                {diagnostics?.fetched_at ? (
                                    <>
                                        {diagnostics.error && (
                                            <Text size="xs" c="red">{diagnostics.error}</Text>
                                        )}
                                        {diagnostics.url && (
                                            <div>
                                                <Text size="xs" c="dimmed">URL Pattern</Text>
                                                <Text size="xs" style={{ wordBreak: 'break-all' }}>{diagnostics.url}</Text>
                                            </div>
                                        )}
                                        {diagnostics.tag && (
                                            <Group gap={4}>
                                                <Text size="xs" c="dimmed">Tag:</Text>
                                                <Badge size="xs" variant="light">{diagnostics.tag}</Badge>
                                            </Group>
                                        )}
                                        {Object.keys(diagnostics.players).length > 0 && (
                                            <>
                                                <Divider />
                                                {Object.entries(diagnostics.players).map(([name, info]) => (
                                                    <Group key={name} justify="space-between">
                                                        <Text size="xs">{name}</Text>
                                                        {info.status === 'loading' ? (
                                                            <Group gap={4}>
                                                                <Loader size={10} />
                                                                <Text size="xs" c="dimmed">Loading...</Text>
                                                            </Group>
                                                        ) : info.error ? (
                                                            <Badge size="xs" color="red" variant="filled">Error</Badge>
                                                        ) : (
                                                            <Badge
                                                                size="xs"
                                                                color={info.char_count > 0 ? 'green' : 'yellow'}
                                                                variant="filled"
                                                            >
                                                                {info.char_count} chars
                                                            </Badge>
                                                        )}
                                                    </Group>
                                                ))}
                                            </>
                                        )}
                                        <Text size="xs" c="dimmed" ta="right">
                                            {new Date(diagnostics.fetched_at).toLocaleTimeString()}
                                        </Text>
                                    </>
                                ) : (
                                    <Text size="xs" c="dimmed">No stats have been fetched yet.</Text>
                                )}
                            </Stack>
                        </Popover.Dropdown>
                    </Popover>
                </Group>

                <Divider />

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
                        <Select
                            label="Batter"
                            placeholder="Select batter"
                            data={batterOptions}
                            value={batter || null}
                            onChange={val => set('batter', val ?? '')}
                            size="xs"
                            searchable
                            clearable
                        />
                    </Grid.Col>
                    <Grid.Col span={6}>
                        <Select
                            label="Pitcher"
                            placeholder="Select pitcher"
                            data={pitcherOptions}
                            value={pitcher || null}
                            onChange={val => set('pitcher', val ?? '')}
                            size="xs"
                            searchable
                            clearable
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

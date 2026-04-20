import { useCallback, useEffect, useState, useRef } from 'react';
import {
    NumberInput, Select, Button, Group, Stack,
    Paper, Text, TextInput, Divider, ActionIcon,
    Popover, Badge, Loader, Tooltip, UnstyledButton, Collapse,
} from '@mantine/core';
import { useStateStore, useSettingsStore } from '../../context/store';
import { HALF_INNINGS } from '../../data/msb';
import { STADIUM_OPTIONS } from '../../data/stadiums';

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

// Safely coerce a value to number (state may hold strings after socket round-trip)
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const sourceOptions = [
    { value: 'manual',    label: 'Manual' },
    { value: 'hud',       label: 'HUD' },
    { value: 'live_game', label: 'Live API Game' },
    { value: 'rotator',   label: 'Rotator' },
];

function CountDots({ count, max, color, onChange }) {
    return (
        <Group gap={5} align="center">
            {Array.from({ length: max }, (_, i) => {
                const filled = i < count;
                return (
                    <UnstyledButton
                        key={i}
                        onClick={() => onChange(filled && i === count - 1 ? count - 1 : i + 1)}
                        style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            backgroundColor: filled ? `var(--mantine-color-${color}-5)` : 'transparent',
                            border: `2px solid var(--mantine-color-${color}-${filled ? '5' : '4'})`,
                            opacity: filled ? 1 : 0.3,
                            transition: 'all 100ms',
                            flexShrink: 0,
                        }}
                    />
                );
            })}
        </Group>
    );
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

    // Baseball state
    const inning      = useStateStore(s => num(s?.score?.[scoreboardNumber]?.inning, 1));
    const halfInning  = useStateStore(s => s?.score?.[scoreboardNumber]?.half_inning ?? 'Top');
    const outs        = useStateStore(s => num(s?.score?.[scoreboardNumber]?.outs, 0));
    const strikes     = useStateStore(s => num(s?.score?.[scoreboardNumber]?.strikes, 0));
    const balls       = useStateStore(s => num(s?.score?.[scoreboardNumber]?.balls, 0));

    // Match info
    const bestOf   = useStateStore(s => num(s?.score?.[scoreboardNumber]?.best_of, 3));
    const phase    = useStateStore(s => s?.score?.[scoreboardNumber]?.phase ?? '');
    const match    = useStateStore(s => s?.score?.[scoreboardNumber]?.match ?? '');
    const stadium  = useStateStore(s => s?.score?.[scoreboardNumber]?.stadium ?? '');

    // Game mode
    const statsTag = useSettingsStore(s => s?.project_rio?.stats_tag ?? '');
    const [gameModes, setGameModes] = useState([]);
    const [diagOpen, setDiagOpen] = useState(false);
    const [diagnostics, setDiagnostics] = useState(null);
    const [matchOpen, setMatchOpen] = useState(false);
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

    // Auto-fetch stats when game mode changes (skip if blank)
    useEffect(() => {
        if (prevTagRef.current !== statsTag) {
            prevTagRef.current = statsTag;
            if (!statsTag) {
                setDiagnostics(null);
                return;
            }
            setFetchingStats(true);
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

    const handleRefreshStats = useCallback(() => {
        setFetchingStats(true);
        fetch(`/api/v1/rio/stats/refresh?scoreboard=${scoreboardNumber}`, { method: 'POST' })
            .catch(() => {});
        setTimeout(pollDiagnostics, 200);
    }, [scoreboardNumber, pollDiagnostics]);

    const set = useCallback((field, value) => {
        setItem(`${base}.${field}`, value);
    }, [base, setItem]);

    const clearAtBatState = useCallback(() => {
        setItem(`${base}.cbRioRunnerOn1`, false);
        setItem(`${base}.cbRioRunnerOn2`, false);
        setItem(`${base}.cbRioRunnerOn3`, false);
        setItem(`${base}.runner1Name`, '');
        setItem(`${base}.runner2Name`, '');
        setItem(`${base}.runner3Name`, '');
        setItem(`${base}.batter`, '');
        setItem(`${base}.pitcher`, '');
        for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
            setItem(`${base}.field.${pos}`, '');
        }
    }, [base, setItem]);

    const clearTournamentData = useCallback(() => {
        const tagFields = ['name', 'team', 'full_name', 'country', 'state', 'pronoun'];
        for (const t of [1, 2]) {
            for (const f of tagFields) {
                setItem(`${base}.player.${t}.${f}`, '');
            }
        }
        setItem(`${base}.phase`, '');
        setItem(`${base}.match`, '');
    }, [base, setItem]);

    const resetBaseballState = useCallback(() => {
        setItem(`${base}.score_left`, 0);
        setItem(`${base}.score_right`, 0);
        setItem(`${base}.inning`, 1);
        setItem(`${base}.half_inning`, 'Top');
        setItem(`${base}.outs`, 0);
        setItem(`${base}.strikes`, 0);
        setItem(`${base}.balls`, 0);
        setItem(`${base}.cbRioRunnerOn1`, false);
        setItem(`${base}.cbRioRunnerOn2`, false);
        setItem(`${base}.cbRioRunnerOn3`, false);
        setItem(`${base}.runner1Name`, '');
        setItem(`${base}.runner2Name`, '');
        setItem(`${base}.runner3Name`, '');
        setItem(`${base}.batter`, '');
        setItem(`${base}.pitcher`, '');
        for (const t of [1, 2]) {
            setItem(`${base}.player.${t}.msb_team`, '');
            setItem(`${base}.player.${t}.rio_captainIndex`, -1);
            for (let i = 0; i < 9; i++) {
                setItem(`${base}.player.${t}.character.${i}.name`, '');
            }
        }
    }, [base, setItem]);

    // Guard NumberInput onChange — it can return '' (empty string)
    const setNum = useCallback((field, val, fallback = 0) => {
        set(field, val === '' ? fallback : Number(val));
    }, [set]);

    return (
        <Paper withBorder p="xs">
            <Stack gap={6}>
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
                    <Popover opened={diagOpen && diagnostics != null} onChange={setDiagOpen} position="bottom-end" withArrow width={320}>
                        <Popover.Target>
                            <ActionIcon
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
                                <Button
                                    size="compact-xs"
                                    variant="light"
                                    fullWidth
                                    onClick={handleRefreshStats}
                                    loading={fetchingStats}
                                >
                                    Refresh Stats
                                </Button>
                            </Stack>
                        </Popover.Dropdown>
                    </Popover>
                </Group>

                {/* ---- Stadium Selector ---- */}
                <Select
                    label="Stadium"
                    placeholder="Select stadium"
                    data={STADIUM_OPTIONS}
                    value={stadium || null}
                    onChange={val => set('stadium', val ?? '')}
                    size="xs"
                    clearable
                />

                {/* ---- Scores + Inning + Count Dots ---- */}
                <Group gap="xs" align="stretch" wrap="nowrap">
                    {/* Left: scores + inning stacked */}
                    <Stack gap={6} style={{ flex: 1 }}>
                        <Group justify="center" gap="xs" align="center" wrap="nowrap">
                            <NumberInput
                                value={scoreLeft}
                                onChange={val => setNum('score_left', val)}
                                min={0}
                                size="xs"
                                style={{ flex: 1 }}
                                leftSection={<Text size={9} fw={700} c="dimmed" lh={1}>P1</Text>}
                                leftSectionPointerEvents="none"
                                styles={{ input: { textAlign: 'center', fontWeight: 700, fontSize: 18 } }}
                            />
                            <NumberInput
                                value={scoreRight}
                                onChange={val => setNum('score_right', val)}
                                min={0}
                                size="xs"
                                style={{ flex: 1 }}
                                leftSection={<Text size={9} fw={700} c="dimmed" lh={1}>P2</Text>}
                                leftSectionPointerEvents="none"
                                styles={{ input: { textAlign: 'center', fontWeight: 700, fontSize: 18 } }}
                            />
                        </Group>
                        <Group gap="xs" align="center" wrap="nowrap">
                            <Select
                                data={halfInningOptions}
                                value={halfInning}
                                onChange={val => { set('half_inning', val ?? 'Top'); clearAtBatState(); }}
                                size="xs"
                                style={{ flex: 4 }}
                                styles={{ input: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
                                comboboxProps={{ width: 'max-content' }}
                            />
                            <NumberInput
                                value={inning}
                                onChange={val => setNum('inning', val, 1)}
                                min={1} max={99}
                                size="xs"
                                style={{ flex: 2 }}
                            />
                        </Group>
                    </Stack>

                    {/* Right: B/S/O labeled dots spanning both rows */}
                    <Stack gap={6} justify="center">
                        {[
                            { label: 'B', count: balls,   max: 4, color: 'green',  field: 'balls' },
                            { label: 'S', count: strikes, max: 3, color: 'yellow', field: 'strikes' },
                            { label: 'O', count: outs,    max: 3, color: 'red',    field: 'outs' },
                        ].map(({ label, count, max, color, field }) => (
                            <Group key={field} gap={4} align="center" wrap="nowrap">
                                <Text size={12} fw={700} c="dimmed" style={{ width: 12, textAlign: 'center', lineHeight: 1 }}>{label}</Text>
                                <CountDots
                                    count={count}
                                    max={max}
                                    color={color}
                                    onChange={val => setNum(field, val)}
                                />
                            </Group>
                        ))}
                    </Stack>
                </Group>



                <Group gap="xs" grow>
                    <Button size="xs" variant="outline" onClick={() => { onSwapTeams(); clearAtBatState(); }}>
                        Swap Teams
                    </Button>
                    <Button size="xs" variant="light" onClick={() => {
                        const t1 = useStateStore.getState()?.score?.[scoreboardNumber]?.player?.[1] ?? {};
                        const t2 = useStateStore.getState()?.score?.[scoreboardNumber]?.player?.[2] ?? {};
                        const fields = ['name', 'team', 'full_name', 'country', 'state', 'pronoun'];
                        for (const f of fields) {
                            setItem(`${base}.player.1.${f}`, t2[f] ?? '');
                            setItem(`${base}.player.2.${f}`, t1[f] ?? '');
                        }
                    }}>
                        Swap Tags
                    </Button>
                </Group>
                <Button size="xs" variant="light" color="red" onClick={resetBaseballState} fullWidth>
                    Reset Game State
                </Button>

                <Divider />

                {/* ---- Match Info ---- */}
                <UnstyledButton onClick={() => setMatchOpen(o => !o)}>
                    <Group justify="space-between" align="center">
                        <Text size="sm" fw={700}>Bracket Match Info</Text>
                        <Text size="xs" c="dimmed" lh={1}>{matchOpen ? '▲' : '▼'}</Text>
                    </Group>
                </UnstyledButton>
                <Collapse in={matchOpen}>
                    <Stack gap="xs">
                        <NumberInput
                            label="Best Of"
                            value={bestOf}
                            onChange={val => setNum('best_of', val, 3)}
                            min={1} max={99} step={2}
                            size="xs"
                        />
                        <TextInput
                            label="Phase"
                            value={phase}
                            onChange={e => set('phase', e.currentTarget.value)}
                            size="xs"
                        />
                        <TextInput
                            label="Match"
                            value={match}
                            onChange={e => set('match', e.currentTarget.value)}
                            size="xs"
                        />
                        <Button size="xs" variant="light" color="red" onClick={clearTournamentData} fullWidth>
                            Clear Tags
                        </Button>
                    </Stack>
                </Collapse>
            </Stack>
        </Paper>
    );
}

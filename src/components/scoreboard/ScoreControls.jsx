import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
    NumberInput, Select, Button, Group, Stack,
    Paper, Text, TextInput, Grid, Divider, ActionIcon,
    Popover, Badge, Loader, Tooltip, UnstyledButton,
} from '@mantine/core';
import { useStateStore, useSettingsStore } from '../../context/store';
import { HALF_INNINGS, ROSTER_SIZE } from '../../data/msb';

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

const charIconUrl = (name) => `/game_assets/rio_characterIcons/${encodeURIComponent(name)}.png`;

const renderCharOption = ({ option }) => (
    <Group gap="xs" wrap="nowrap">
        <img src={charIconUrl(option.value)} alt="" width={20} height={20} style={{ objectFit: 'contain' }} />
        <span>{option.label}</span>
    </Group>
);

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

/**
 * Build character name options from a team's roster in state.
 */
function useRosterOptions(scoreboardNumber, teamNumber) {
    const roster = useStateStore(
        s => s?.score?.[scoreboardNumber]?.player?.[teamNumber]?.character
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
 * A single base-runner tile: shows character icon when occupied, opens a
 * popover grid of roster icons to pick/clear the runner.
 */
function RunnerTile({ label, charName, rosterOptions, onSelect, onClear }) {
    const [opened, setOpened] = useState(false);
    const occupied = !!charName;

    return (
        <Popover opened={opened} onChange={setOpened} position="bottom" withArrow width={170} trapFocus>
            <Popover.Target>
                <UnstyledButton
                    onClick={() => setOpened(o => !o)}
                    style={{
                        display: 'inline-flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 1,
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: `1px solid ${occupied ? 'var(--mantine-color-yellow-5)' : 'var(--mantine-color-default-border)'}`,
                        backgroundColor: occupied ? 'var(--mantine-color-yellow-1)' : undefined,
                        transition: 'all 150ms',
                        lineHeight: 1,
                    }}
                >
                    {occupied ? (
                        <img src={charIconUrl(charName)} alt={charName} width={20} height={20} style={{ objectFit: 'contain', display: 'block' }} />
                    ) : (
                        <div style={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            backgroundColor: 'var(--mantine-color-dark-4)',
                            opacity: 0.3,
                        }} />
                    )}
                    <Text size={10} c="dimmed" fw={600} lh={1}>{label}</Text>
                </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown p={6}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: 3,
                    justifyItems: 'center',
                }}>
                    {rosterOptions.map(opt => (
                        <Tooltip key={opt.value} label={opt.label} withArrow position="top">
                            <UnstyledButton
                                onClick={() => { onSelect(opt.value); setOpened(false); }}
                                style={{
                                    padding: 2,
                                    borderRadius: 4,
                                    border: charName === opt.value
                                        ? '2px solid var(--mantine-color-yellow-5)'
                                        : '2px solid transparent',
                                }}
                            >
                                <img src={charIconUrl(opt.value)} alt={opt.label} width={22} height={22} style={{ objectFit: 'contain', display: 'block' }} />
                            </UnstyledButton>
                        </Tooltip>
                    ))}
                    {occupied && (
                        <UnstyledButton
                            onClick={() => { onClear(); setOpened(false); }}
                            style={{
                                padding: 2,
                                borderRadius: 4,
                                border: '2px solid transparent',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 26,
                                height: 26,
                                color: 'var(--mantine-color-red-6)',
                                fontSize: 14,
                                fontWeight: 700,
                            }}
                            title="Clear base"
                        >
                            ✕
                        </UnstyledButton>
                    )}
                </div>
            </Popover.Dropdown>
        </Popover>
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
    const runner1Name  = useStateStore(s => s?.score?.[scoreboardNumber]?.runner1Name ?? '');
    const runner2Name  = useStateStore(s => s?.score?.[scoreboardNumber]?.runner2Name ?? '');
    const runner3Name  = useStateStore(s => s?.score?.[scoreboardNumber]?.runner3Name ?? '');

    // Batter / Pitcher
    const batter   = useStateStore(s => s?.score?.[scoreboardNumber]?.batter ?? '');
    const pitcher  = useStateStore(s => s?.score?.[scoreboardNumber]?.pitcher ?? '');

    // Match info
    const bestOf   = useStateStore(s => num(s?.score?.[scoreboardNumber]?.best_of, 3));
    const phase    = useStateStore(s => s?.score?.[scoreboardNumber]?.phase ?? '');
    const match    = useStateStore(s => s?.score?.[scoreboardNumber]?.match ?? '');

    // Completed game metadata
    const gameCompleted     = useStateStore(s => s?.score?.[scoreboardNumber]?.game_completed ?? false);
    const gameId            = useStateStore(s => s?.score?.[scoreboardNumber]?.game_id);
    const stadium           = useStateStore(s => s?.score?.[scoreboardNumber]?.stadium ?? '');
    const gameMode          = useStateStore(s => s?.score?.[scoreboardNumber]?.game_mode ?? '');
    const inningsPlayed     = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_played);
    const inningsSelected   = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_selected);
    const dateTimeStart     = useStateStore(s => s?.score?.[scoreboardNumber]?.date_time_start);
    const dateTimeEnd       = useStateStore(s => s?.score?.[scoreboardNumber]?.date_time_end);
    const winnerIncomingElo = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_incoming_elo);
    const winnerResultElo   = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_result_elo);
    const loserIncomingElo  = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_incoming_elo);
    const loserResultElo    = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_result_elo);
    const winnerUser        = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_user ?? '');
    const loserUser         = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_user ?? '');

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

    const clearAtBatState = useCallback(() => {
        setItem(`${base}.cbRioRunnerOn1`, false);
        setItem(`${base}.cbRioRunnerOn2`, false);
        setItem(`${base}.cbRioRunnerOn3`, false);
        setItem(`${base}.runner1Name`, '');
        setItem(`${base}.runner2Name`, '');
        setItem(`${base}.runner3Name`, '');
        setItem(`${base}.batter`, '');
        setItem(`${base}.pitcher`, '');
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

                <Divider />

                {/* ---- Scores ---- */}
                <Group justify="center" gap="md">
                    <NumberInput
                        value={scoreLeft}
                        onChange={val => setNum('score_left', val)}
                        min={0}
                        size="xs"
                        w={60}
                        styles={{ input: { textAlign: 'center', fontWeight: 700, fontSize: 18 } }}
                    />

                    <Text fw={700} size="lg">vs</Text>

                    <NumberInput
                        value={scoreRight}
                        onChange={val => setNum('score_right', val)}
                        min={0}
                        size="xs"
                        w={60}
                        styles={{ input: { textAlign: 'center', fontWeight: 700, fontSize: 18 } }}
                    />
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

                {/* ---- Completed Game Info (Rotator only) ---- */}
                {sourceType === 'rotator' && gameCompleted && (
                    <>
                        <Divider />
                        <Paper p="xs" withBorder style={{ backgroundColor: 'var(--mantine-color-violet-0)' }}>
                            <Stack gap={4}>
                                <Group justify="space-between">
                                    <Text size="xs" fw={600} c="violet">Completed Game</Text>
                                    {gameId && <Badge size="xs" variant="light" color="violet">#{gameId}</Badge>}
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
                                            <Text size="xs">{stadium}</Text>
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
                    </>
                )}

                <Divider />

                {/* ---- Baseball State ---- */}
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
                            onChange={val => { set('half_inning', val ?? 'Top'); clearAtBatState(); }}
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
                <Group gap="xs" justify="center">
                    {[
                        { label: '1st', name: runner1Name, boolKey: 'cbRioRunnerOn1', nameKey: 'runner1Name' },
                        { label: '2nd', name: runner2Name, boolKey: 'cbRioRunnerOn2', nameKey: 'runner2Name' },
                        { label: '3rd', name: runner3Name, boolKey: 'cbRioRunnerOn3', nameKey: 'runner3Name' },
                    ].map(({ label, name, boolKey, nameKey }) => (
                        <RunnerTile
                            key={label}
                            label={label}
                            charName={name}
                            rosterOptions={batterOptions}
                            onSelect={val => { set(nameKey, val); set(boolKey, true); }}
                            onClear={() => { set(nameKey, ''); set(boolKey, false); }}
                        />
                    ))}
                </Group>

                {/* Batter / Pitcher */}
                <Select
                    label="Batter"
                    placeholder="Select batter"
                    data={batterOptions}
                    value={batter || null}
                    onChange={val => set('batter', val ?? '')}
                    size="xs"
                    searchable
                    clearable
                    renderOption={renderCharOption}
                    leftSection={batter ? <img src={charIconUrl(batter)} alt="" width={16} height={16} style={{ objectFit: 'contain' }} /> : undefined}
                    leftSectionPointerEvents="none"
                />
                <Select
                    label="Pitcher"
                    placeholder="Select pitcher"
                    data={pitcherOptions}
                    value={pitcher || null}
                    onChange={val => set('pitcher', val ?? '')}
                    size="xs"
                    searchable
                    clearable
                    renderOption={renderCharOption}
                    leftSection={pitcher ? <img src={charIconUrl(pitcher)} alt="" width={16} height={16} style={{ objectFit: 'contain' }} /> : undefined}
                    leftSectionPointerEvents="none"
                />

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

                <Button size="xs" variant="light" color="red" onClick={clearTournamentData} fullWidth>
                    Clear Tags
                </Button>
            </Stack>
        </Paper>
    );
}

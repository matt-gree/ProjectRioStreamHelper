import { useState, useCallback, useMemo, memo, useRef, useEffect } from 'react';
import {
    Paper, Stack, Group, Text, Button, Badge, Loader,
    Table, TextInput, Tooltip, Switch, NumberInput, Select,
} from '@mantine/core';
import { useStateStore, useSettingsStore } from '../../context/store';
import { useSocketSubscribe } from '../../context/socket';

/**
 * Inline live game search and selector for the "Live Game" source type.
 * Fetches ongoing games from the Project Rio API, filters client-side,
 * and loads a selected game onto the scoreboard.
 */
export default memo(function LiveGameSelector({ scoreboardNumber }) {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filterUsername, setFilterUsername] = useState('');
    const [filterVsUsername, setFilterVsUsername] = useState('');
    const [filterGameMode, setFilterGameMode] = useState('');

    // Auto-poll state — read initial values from settings
    const initAutoPoll = useSettingsStore(s => s?.ongoing_games?.auto_poll ?? false);
    const initInterval = useSettingsStore(s => s?.ongoing_games?.poll_interval ?? 10);
    const [autoPolling, setAutoPolling] = useState(initAutoPoll);
    const [pollInterval, setPollInterval] = useState(initInterval);

    // Active game modes for the filter dropdown
    const [gameModeOptions, setGameModeOptions] = useState([]);
    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => setGameModeOptions(Object.keys(data).map(name => ({ value: name, label: name }))))
            .catch(() => {});
    }, []);

    const currentGameId = useStateStore(s => s?.score?.[scoreboardNumber]?.game_id);
    // Keep a ref so the socket callback always sees the latest value
    const currentGameIdRef = useRef(currentGameId);
    useEffect(() => { currentGameIdRef.current = currentGameId; }, [currentGameId]);

    // Countdown to next auto-poll refresh
    const [secondsRemaining, setSecondsRemaining] = useState(null);
    const lastUpdateAtRef = useRef(null);

    // Reset countdown whenever we receive a fresh update from the server
    // (both manual refresh and auto-poll fire this)
    const resetCountdown = useCallback(() => {
        lastUpdateAtRef.current = Date.now();
    }, []);

    // Tick every 250 ms while auto-polling is active
    useEffect(() => {
        if (!autoPolling) { setSecondsRemaining(null); return; }
        const tick = () => {
            if (lastUpdateAtRef.current == null) { setSecondsRemaining(null); return; }
            const elapsed = (Date.now() - lastUpdateAtRef.current) / 1000;
            setSecondsRemaining(Math.max(0, Math.round(pollInterval - elapsed)));
        };
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [autoPolling, pollInterval]);

    const abortRef = useRef(null);

    const handleCancelFetch = useCallback(() => {
        abortRef.current?.abort();
        setLoading(false);
    }, []);

    const fetchGames = useCallback(async () => {
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setLoading(true);
        try {
            const data = await fetch('/api/v1/game-pool/ongoing/refresh', { method: 'POST', signal: ctrl.signal })
                .then(() => fetch('/api/v1/game-pool/ongoing', { signal: ctrl.signal }))
                .then(r => r.json());
            setGames(Array.isArray(data) ? data : []);
            resetCountdown();
        } catch (e) {
            if (e.name !== 'AbortError') setGames([]);
        } finally {
            setLoading(false);
        }
    }, [resetCountdown]);

    const handleLoad = useCallback(async (gameId) => {
        await fetch(
            `/api/v1/game-pool/assign?game_id=${gameId}&scoreboard_number=${scoreboardNumber}`,
            { method: 'POST' },
        );
    }, [scoreboardNumber]);

    // Keep the game list in sync with server-side auto-poll updates.
    // If a game is currently loaded on this scoreboard, re-apply it automatically
    // so live score/state stays current.
    const handleOngoingUpdate = useCallback((payload) => {
        const updated = Array.isArray(payload) ? payload : (payload?.games ?? []);
        setGames(updated);
        resetCountdown();

        const loadedId = currentGameIdRef.current;
        if (loadedId == null) return;
        const stillLive = updated.some(g => g.game_id === loadedId);
        if (stillLive) {
            fetch(
                `/api/v1/game-pool/assign?game_id=${loadedId}&scoreboard_number=${scoreboardNumber}`,
                { method: 'POST' },
            ).catch(() => {});
        }
    }, [scoreboardNumber, resetCountdown]);
    useSocketSubscribe('v1.game_pool.ongoing_update', handleOngoingUpdate);

    const handleToggleAutoPoll = useCallback(async (enabled) => {
        setAutoPolling(enabled);
        await fetch(
            `/api/v1/game-pool/ongoing/auto-poll?enabled=${enabled}&interval=${pollInterval}`,
            { method: 'POST' },
        ).catch(() => {});
    }, [pollInterval]);

    const handleIntervalChange = useCallback(async (val) => {
        const interval = val === '' ? 10 : Number(val);
        setPollInterval(interval);
        if (autoPolling) {
            await fetch(
                `/api/v1/game-pool/ongoing/auto-poll?enabled=true&interval=${interval}`,
                { method: 'POST' },
            ).catch(() => {});
        }
    }, [autoPolling]);

    const filteredGames = useMemo(() => {
        let result = games;
        if (filterUsername.trim()) {
            const q = filterUsername.trim().toLowerCase();
            result = result.filter(g =>
                (g.away_user ?? g.entrants?.[0]?.[0]?.rioName ?? '').toLowerCase().includes(q) ||
                (g.home_user ?? g.entrants?.[1]?.[0]?.rioName ?? '').toLowerCase().includes(q)
            );
        }
        if (filterVsUsername.trim()) {
            const q = filterVsUsername.trim().toLowerCase();
            result = result.filter(g =>
                (g.away_user ?? g.entrants?.[0]?.[0]?.rioName ?? '').toLowerCase().includes(q) ||
                (g.home_user ?? g.entrants?.[1]?.[0]?.rioName ?? '').toLowerCase().includes(q)
            );
        }
        if (filterGameMode.trim()) {
            const q = filterGameMode.trim().toLowerCase();
            result = result.filter(g =>
                (g.game_mode_name ?? g.game_mode ?? '').toString().toLowerCase().includes(q)
            );
        }
        return result;
    }, [games, filterUsername, filterVsUsername, filterGameMode]);

    const emptyMessage = loading
        ? 'Searching…'
        : games.length === 0
            ? 'No live games found. Click Refresh.'
            : 'No games match filter.';

    return (
        <Paper shadow="xs" p="sm" withBorder>
            <Stack gap="xs">
                <Group gap="xs" justify="space-between">
                    <Group gap="xs">
                        <Text fw={600} size="sm">Live API Game</Text>
                        {games.length > 0 && (
                            <Badge size="xs" variant="light">{filteredGames.length}</Badge>
                        )}
                    </Group>
                    <Group gap="xs">
                        <NumberInput
                            size="xs"
                            min={5}
                            max={300}
                            step={5}
                            value={pollInterval}
                            onChange={handleIntervalChange}
                            suffix="s"
                            w={70}
                            disabled={!autoPolling}
                        />
                        <Switch
                            size="xs"
                            label="Auto-poll"
                            checked={autoPolling}
                            onChange={e => handleToggleAutoPoll(e.currentTarget.checked)}
                        />
                        {autoPolling && secondsRemaining != null && (
                            <Text size="xs" c="dimmed" w={30} ta="right">{secondsRemaining}s</Text>
                        )}
                    </Group>
                </Group>

                <Group gap="xs">
                    <TextInput
                        size="xs"
                        placeholder="Username"
                        value={filterUsername}
                        onChange={(e) => setFilterUsername(e.currentTarget.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') fetchGames(); }}
                        style={{ flex: 1 }}
                    />
                    <TextInput
                        size="xs"
                        placeholder="Vs Username"
                        value={filterVsUsername}
                        onChange={(e) => setFilterVsUsername(e.currentTarget.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') fetchGames(); }}
                        style={{ flex: 1 }}
                    />
                    <Select
                        size="xs"
                        placeholder="Game Mode"
                        data={gameModeOptions}
                        value={filterGameMode || null}
                        onChange={val => setFilterGameMode(val ?? '')}
                        searchable
                        clearable
                        style={{ flex: 1 }}
                    />
                    {loading ? (
                        <Button size="xs" onClick={handleCancelFetch} color="red" variant="light"
                            leftSection={<Loader size={10} color="red" />}>
                            Cancel
                        </Button>
                    ) : (
                        <Button size="xs" onClick={fetchGames}>
                            Refresh
                        </Button>
                    )}
                </Group>

                {filteredGames.length > 0 ? (
                    <Table striped highlightOnHover withTableBorder withColumnBorders fontSize="xs">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Away</Table.Th>
                                <Table.Th w={54}>Score</Table.Th>
                                <Table.Th>Home</Table.Th>
                                <Table.Th>Mode</Table.Th>
                                <Table.Th w={70} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {filteredGames.map((game) => {
                                const gid = game.game_id;
                                const awayUser = game.away_user ?? game.entrants?.[0]?.[0]?.rioName ?? '';
                                const homeUser = game.home_user ?? game.entrants?.[1]?.[0]?.rioName ?? '';
                                const awayScore = game.away_score ?? game.team1score ?? 0;
                                const homeScore = game.home_score ?? game.team2score ?? 0;
                                const awayCaptain = game.away_captain_name ?? '';
                                const homeCaptain = game.home_captain_name ?? '';
                                const gameMode = game.game_mode_name ?? game.game_mode ?? '';
                                const isLoaded = gid === currentGameId;

                                return (
                                    <Table.Tr
                                        key={gid}
                                        bg={isLoaded ? 'var(--mantine-color-teal-light)' : undefined}
                                    >
                                        <Table.Td>
                                            <Text size="xs" fw={500}>{awayUser}</Text>
                                            {awayCaptain && <Text size="xs" c="dimmed">{awayCaptain}</Text>}
                                        </Table.Td>
                                        <Table.Td ta="center">
                                            <Text size="xs" fw={600}>{awayScore}–{homeScore}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="xs" fw={500}>{homeUser}</Text>
                                            {homeCaptain && <Text size="xs" c="dimmed">{homeCaptain}</Text>}
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="xs" c="dimmed">{gameMode}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label={isLoaded ? 'Currently loaded' : 'Load this game'}>
                                                <Button
                                                    size="compact-xs"
                                                    variant={isLoaded ? 'filled' : 'light'}
                                                    color={isLoaded ? 'teal' : undefined}
                                                    onClick={() => handleLoad(gid)}
                                                >
                                                    {isLoaded ? 'Loaded' : 'Load'}
                                                </Button>
                                            </Tooltip>
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                ) : (
                    <Text size="xs" c="dimmed">{emptyMessage}</Text>
                )}
            </Stack>
        </Paper>
    );
});

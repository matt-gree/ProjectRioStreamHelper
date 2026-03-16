import { useState, useCallback, useEffect, memo } from 'react';
import {
    Paper, Tabs, Stack, Group, Text, Button, ActionIcon, Badge,
    NumberInput, Switch, Table, Checkbox, TextInput, Select,
    MultiSelect, Tooltip, Collapse, Popover, Divider, Loader,
} from '@mantine/core';
import { useSocketSubscribe } from '../../context/socket';

/**
 * Game Pool Browser + Rotation Controls for a scoreboard.
 */
export default memo(function RotationControls({ scoreboardNumber }) {
    const [expanded, setExpanded] = useState(false);
    const [activePoolTab, setActivePoolTab] = useState('completed');

    // Game pools
    const [ongoingGames, setOngoingGames] = useState([]);
    const [completedGames, setCompletedGames] = useState([]);
    const [loadingOngoing, setLoadingOngoing] = useState(false);
    const [loadingCompleted, setLoadingCompleted] = useState(false);

    // Completed game filters
    const [filterUsername, setFilterUsername] = useState('');
    const [filterVsUsername, setFilterVsUsername] = useState('');
    const [filterTags, setFilterTags] = useState([]);
    const [filterLimit, setFilterLimit] = useState(20);

    // Game mode options (reused from /api/v1/rio/game-modes)
    const [gameModeOptions, setGameModeOptions] = useState([]);

    // Fetch diagnostics
    const [lastFetchInfo, setLastFetchInfo] = useState(null);
    const [diagOpen, setDiagOpen] = useState(false);

    // Rotation state
    const [rotationConfig, setRotationConfig] = useState({
        enabled: false,
        interval: 30,
        game_ids: [],
        poll_interval: 0,
        source_pool: 'both',
    });
    const [rotationStatus, setRotationStatus] = useState({ active: false });
    const [selectedGameIds, setSelectedGameIds] = useState(new Set());

    // Auto-poll settings for completed games
    const [autoPolling, setAutoPolling] = useState(false);
    const [autoPollInterval, setAutoPollInterval] = useState(60);

    // Fetch rotation config on mount
    useEffect(() => {
        fetch(`/api/v1/rotation/${scoreboardNumber}`)
            .then(r => r.json())
            .then(data => {
                setRotationConfig(prev => ({ ...prev, ...data }));
                setRotationStatus({ active: data.active ?? false, ...data });
            })
            .catch(() => {});
    }, [scoreboardNumber]);

    // Fetch game modes when expanded
    useEffect(() => {
        if (!expanded) return;
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => {
                const opts = Object.keys(data).map(name => ({ value: name, label: name }));
                setGameModeOptions(opts);
            })
            .catch(() => {});
    }, [expanded]);

    // Listen for server-side updates (auto-poll, etc.)
    const handleCompletedUpdate = useCallback((payload) => {
        const games = Array.isArray(payload) ? payload : (payload?.games ?? []);
        const diag = payload?.diagnostics;
        setCompletedGames(games);
        if (diag) {
            setLastFetchInfo(prev => ({
                ...prev,
                url: diag.url || prev?.url,
                count: games.length,
                fetchedAt: diag.fetched_at || new Date().toISOString(),
                error: diag.error || null,
            }));
        }
    }, []);
    useSocketSubscribe('v1.game_pool.completed_update', handleCompletedUpdate);

    const handleOngoingUpdate = useCallback((payload) => {
        const games = Array.isArray(payload) ? payload : (payload?.games ?? []);
        setOngoingGames(games);
    }, []);
    useSocketSubscribe('v1.game_pool.ongoing_update', handleOngoingUpdate);

    const fetchOngoing = useCallback(async () => {
        setLoadingOngoing(true);
        try {
            const resp = await fetch('/api/v1/game-pool/ongoing');
            const data = await resp.json();
            setOngoingGames(Array.isArray(data) ? data : []);
        } catch { setOngoingGames([]); }
        setLoadingOngoing(false);
    }, []);

    const fetchCompleted = useCallback(async () => {
        setLoadingCompleted(true);
        const params = new URLSearchParams();
        if (filterUsername.trim()) params.append('username', filterUsername.trim());
        if (filterVsUsername.trim()) params.append('vs_username', filterVsUsername.trim());
        for (const tag of filterTags) {
            params.append('tag', tag);
        }
        if (filterLimit) params.append('limit_games', String(filterLimit));

        const url = `/api/v1/game-pool/completed/refresh?${params}`;

        try {
            const resp = await fetch(url, { method: 'POST' });
            const refreshData = await resp.json();
            // Now fetch the list
            const listResp = await fetch('/api/v1/game-pool/completed');
            const data = await listResp.json();
            const games = Array.isArray(data) ? data : [];
            setCompletedGames(games);
            // Use the Rio API URL from backend diagnostics
            const diag = refreshData.diagnostics || {};
            setLastFetchInfo({
                url: diag.url || url,
                count: games.length,
                filters: {
                    username: filterUsername.trim() || null,
                    vs_username: filterVsUsername.trim() || null,
                    tags: filterTags.length > 0 ? filterTags : null,
                    limit: filterLimit,
                },
                fetchedAt: diag.fetched_at || new Date().toISOString(),
                error: diag.error || null,
            });
        } catch (e) {
            setCompletedGames([]);
            setLastFetchInfo({
                url,
                count: 0,
                filters: null,
                fetchedAt: new Date().toISOString(),
                error: String(e),
            });
        }
        setLoadingCompleted(false);
    }, [filterUsername, filterVsUsername, filterTags, filterLimit]);

    const handleAssignGame = useCallback(async (gameId) => {
        await fetch(`/api/v1/game-pool/assign?game_id=${gameId}&scoreboard_number=${scoreboardNumber}`, {
            method: 'POST',
        });
    }, [scoreboardNumber]);

    const toggleGameSelection = useCallback((gameId) => {
        setSelectedGameIds(prev => {
            const next = new Set(prev);
            if (next.has(gameId)) next.delete(gameId);
            else next.add(gameId);
            return next;
        });
    }, []);

    const handleSelectAll = useCallback((gameIds) => {
        setSelectedGameIds(prev => {
            const allSelected = gameIds.every(id => prev.has(id));
            const next = new Set(prev);
            if (allSelected) {
                gameIds.forEach(id => next.delete(id));
            } else {
                gameIds.forEach(id => next.add(id));
            }
            return next;
        });
    }, []);

    const handleStartRotation = useCallback(async () => {
        const gameIds = Array.from(selectedGameIds);
        if (gameIds.length === 0) return;

        // First set the config with game IDs
        await fetch(`/api/v1/rotation/${scoreboardNumber}?game_ids=${gameIds.join(',')}&interval=${rotationConfig.interval}&source_pool=${rotationConfig.source_pool}&poll_interval=${rotationConfig.poll_interval}`, {
            method: 'PUT',
        });
        // Then start
        const resp = await fetch(`/api/v1/rotation/${scoreboardNumber}/start`, { method: 'POST' });
        const data = await resp.json();
        setRotationStatus(data);
    }, [scoreboardNumber, selectedGameIds, rotationConfig]);

    const handleStopRotation = useCallback(async () => {
        await fetch(`/api/v1/rotation/${scoreboardNumber}/stop`, { method: 'POST' });
        setRotationStatus({ active: false });
    }, [scoreboardNumber]);

    const handleNextGame = useCallback(async () => {
        const resp = await fetch(`/api/v1/rotation/${scoreboardNumber}/next`, { method: 'POST' });
        const data = await resp.json();
        setRotationStatus(data);
    }, [scoreboardNumber]);

    const handlePrevGame = useCallback(async () => {
        const resp = await fetch(`/api/v1/rotation/${scoreboardNumber}/prev`, { method: 'POST' });
        const data = await resp.json();
        setRotationStatus(data);
    }, [scoreboardNumber]);

    const handleSetAutoPoll = useCallback(async (enabled, interval) => {
        const effectiveInterval = interval ?? autoPollInterval;
        setAutoPolling(enabled);
        if (interval != null) setAutoPollInterval(effectiveInterval);
        if (enabled) {
            // Save current filters before enabling auto-poll so it uses them
            const params = new URLSearchParams();
            if (filterUsername.trim()) params.append('username', filterUsername.trim());
            if (filterVsUsername.trim()) params.append('vs_username', filterVsUsername.trim());
            for (const tag of filterTags) params.append('tag', tag);
            if (filterLimit) params.append('limit_games', String(filterLimit));
            // Trigger a refresh with current filters so they're saved server-side
            await fetch(`/api/v1/game-pool/completed/refresh?${params}`, { method: 'POST' });
        }
        await fetch(`/api/v1/game-pool/completed/auto-poll?enabled=${enabled}&interval=${effectiveInterval}`, {
            method: 'POST',
        });
    }, [autoPollInterval, filterUsername, filterVsUsername, filterTags, filterLimit]);

    const formatTimestamp = (ts) => {
        if (!ts) return '';
        try {
            const d = new Date(ts);
            return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        } catch { return String(ts); }
    };

    return (
        <Paper shadow="xs" p="sm" withBorder>
            <Group justify="space-between" mb={expanded ? 'sm' : 0}>
                <Group gap="xs">
                    <Text fw={600} size="sm">Game Pool & Rotation</Text>
                    {rotationStatus.active && (
                        <Badge size="xs" color="teal" variant="filled">
                            Rotating ({rotationStatus.current_index + 1}/{rotationStatus.total_games})
                        </Badge>
                    )}
                </Group>
                <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => setExpanded(v => !v)}
                >
                    {expanded ? 'Collapse' : 'Expand'}
                </Button>
            </Group>

            <Collapse in={expanded}>
                <Stack gap="sm">
                    {/* Rotation Controls */}
                    <Paper p="xs" withBorder>
                        <Stack gap="xs">
                            <Text size="sm" fw={500}>Rotation Controls</Text>
                            <Group gap="sm">
                                <NumberInput
                                    label="Interval (sec)"
                                    size="xs"
                                    w={100}
                                    min={5}
                                    max={600}
                                    value={rotationConfig.interval}
                                    onChange={(val) => setRotationConfig(c => ({ ...c, interval: val || 30 }))}
                                />
                                <Select
                                    label="Source Pool"
                                    size="xs"
                                    w={120}
                                    data={[
                                        { value: 'both', label: 'Both' },
                                        { value: 'ongoing', label: 'Live Only' },
                                        { value: 'completed', label: 'Completed Only' },
                                    ]}
                                    value={rotationConfig.source_pool}
                                    onChange={(val) => setRotationConfig(c => ({ ...c, source_pool: val }))}
                                />
                            </Group>
                            <Group gap="xs">
                                {!rotationStatus.active ? (
                                    <Button size="xs" color="teal" onClick={handleStartRotation}
                                        disabled={selectedGameIds.size === 0}>
                                        Start Rotation ({selectedGameIds.size} games)
                                    </Button>
                                ) : (
                                    <Button size="xs" color="red" variant="light" onClick={handleStopRotation}>
                                        Stop Rotation
                                    </Button>
                                )}
                                {rotationStatus.active && (
                                    <>
                                        <ActionIcon size="sm" variant="light" onClick={handlePrevGame}>
                                            <Text size="xs" lh={1}>&lt;</Text>
                                        </ActionIcon>
                                        <Text size="xs">
                                            {rotationStatus.current_index + 1} / {rotationStatus.total_games}
                                        </Text>
                                        <ActionIcon size="sm" variant="light" onClick={handleNextGame}>
                                            <Text size="xs" lh={1}>&gt;</Text>
                                        </ActionIcon>
                                    </>
                                )}
                            </Group>
                        </Stack>
                    </Paper>

                    {/* Game Pool Browser */}
                    <Tabs value={activePoolTab} onChange={setActivePoolTab} variant="pills" size="xs">
                        <Tabs.List>
                            <Tabs.Tab value="ongoing">
                                Live Games ({ongoingGames.length})
                            </Tabs.Tab>
                            <Tabs.Tab value="completed">
                                Completed Games ({completedGames.length})
                            </Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value="ongoing" pt="xs">
                            <Stack gap="xs">
                                <Button size="xs" variant="light" onClick={fetchOngoing} loading={loadingOngoing}>
                                    Refresh Live Games
                                </Button>
                                {ongoingGames.length > 0 ? (
                                    <GameTable
                                        games={ongoingGames}
                                        completed={false}
                                        selectedIds={selectedGameIds}
                                        onToggle={toggleGameSelection}
                                        onSelectAll={handleSelectAll}
                                        onAssign={handleAssignGame}
                                        formatTimestamp={formatTimestamp}
                                    />
                                ) : (
                                    <Text size="xs" c="dimmed">No live games found. Click refresh to check.</Text>
                                )}
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel value="completed" pt="xs">
                            <Stack gap="xs">
                                {/* Filters */}
                                <Group gap="xs" align="flex-end">
                                    <TextInput
                                        size="xs"
                                        label="Username"
                                        placeholder="Filter by player"
                                        value={filterUsername}
                                        onChange={(e) => setFilterUsername(e.currentTarget.value)}
                                        w={140}
                                    />
                                    <TextInput
                                        size="xs"
                                        label="Vs Username"
                                        placeholder="Opponent"
                                        value={filterVsUsername}
                                        onChange={(e) => setFilterVsUsername(e.currentTarget.value)}
                                        w={140}
                                    />
                                    <MultiSelect
                                        size="xs"
                                        label="Tags"
                                        placeholder="Game modes"
                                        data={gameModeOptions}
                                        value={filterTags}
                                        onChange={setFilterTags}
                                        searchable
                                        clearable
                                        w={200}
                                        maxDropdownHeight={200}
                                    />
                                    <NumberInput
                                        size="xs"
                                        label="Limit"
                                        min={1}
                                        max={100}
                                        value={filterLimit}
                                        onChange={setFilterLimit}
                                        w={80}
                                    />
                                    <Button size="xs" onClick={fetchCompleted} loading={loadingCompleted}>
                                        Search
                                    </Button>
                                    <Popover opened={diagOpen} onChange={setDiagOpen} position="bottom-end" withArrow width={360}>
                                        <Popover.Target>
                                            <ActionIcon
                                                variant="subtle"
                                                size="sm"
                                                onClick={() => setDiagOpen(o => !o)}
                                                title="Fetch diagnostics"
                                            >
                                                {loadingCompleted ? <Loader size={12} /> : <Text size="xs" lh={1}>&#8505;</Text>}
                                            </ActionIcon>
                                        </Popover.Target>
                                        <Popover.Dropdown>
                                            <Stack gap="xs">
                                                <Text size="xs" fw={600}>Completed Games Fetch</Text>
                                                {lastFetchInfo ? (
                                                    <>
                                                        <Group gap={4}>
                                                            <Text size="xs" c="dimmed">Games found:</Text>
                                                            <Badge
                                                                size="xs"
                                                                color={lastFetchInfo.count > 0 ? 'green' : 'yellow'}
                                                                variant="filled"
                                                            >
                                                                {lastFetchInfo.count}
                                                            </Badge>
                                                        </Group>
                                                        {lastFetchInfo.url && (
                                                            <div>
                                                                <Text size="xs" c="dimmed">URL</Text>
                                                                <Text size="xs" style={{ wordBreak: 'break-all' }}>{lastFetchInfo.url}</Text>
                                                            </div>
                                                        )}
                                                        {lastFetchInfo.error && (
                                                            <Text size="xs" c="red">{lastFetchInfo.error}</Text>
                                                        )}
                                                        {lastFetchInfo.filters && (
                                                            <>
                                                                <Divider />
                                                                {lastFetchInfo.filters.username && (
                                                                    <Group gap={4}>
                                                                        <Text size="xs" c="dimmed">Username:</Text>
                                                                        <Text size="xs">{lastFetchInfo.filters.username}</Text>
                                                                    </Group>
                                                                )}
                                                                {lastFetchInfo.filters.vs_username && (
                                                                    <Group gap={4}>
                                                                        <Text size="xs" c="dimmed">Vs:</Text>
                                                                        <Text size="xs">{lastFetchInfo.filters.vs_username}</Text>
                                                                    </Group>
                                                                )}
                                                                {lastFetchInfo.filters.tags && (
                                                                    <Group gap={4}>
                                                                        <Text size="xs" c="dimmed">Tags:</Text>
                                                                        {lastFetchInfo.filters.tags.map(t => (
                                                                            <Badge key={t} size="xs" variant="light">{t}</Badge>
                                                                        ))}
                                                                    </Group>
                                                                )}
                                                                <Group gap={4}>
                                                                    <Text size="xs" c="dimmed">Limit:</Text>
                                                                    <Text size="xs">{lastFetchInfo.filters.limit}</Text>
                                                                </Group>
                                                            </>
                                                        )}
                                                        <Text size="xs" c="dimmed" ta="right">
                                                            {new Date(lastFetchInfo.fetchedAt).toLocaleTimeString()}
                                                        </Text>
                                                    </>
                                                ) : (
                                                    <Text size="xs" c="dimmed">No fetch performed yet. Click Search to query the API.</Text>
                                                )}
                                            </Stack>
                                        </Popover.Dropdown>
                                    </Popover>
                                </Group>

                                {/* Auto-poll toggle */}
                                <Group gap="xs">
                                    <Switch
                                        size="xs"
                                        label="Auto-poll"
                                        checked={autoPolling}
                                        onChange={(e) => handleSetAutoPoll(e.currentTarget.checked)}
                                    />
                                    {autoPolling && (
                                        <NumberInput
                                            size="xs"
                                            w={80}
                                            min={10}
                                            max={300}
                                            value={autoPollInterval}
                                            onChange={(val) => handleSetAutoPoll(true, val || 60)}
                                            suffix="s"
                                        />
                                    )}
                                </Group>

                                {completedGames.length > 0 ? (
                                    <GameTable
                                        games={completedGames}
                                        completed={true}
                                        selectedIds={selectedGameIds}
                                        onToggle={toggleGameSelection}
                                        onSelectAll={handleSelectAll}
                                        onAssign={handleAssignGame}
                                        formatTimestamp={formatTimestamp}
                                    />
                                ) : (
                                    <Text size="xs" c="dimmed">No completed games. Use the filters above and click Search.</Text>
                                )}
                            </Stack>
                        </Tabs.Panel>
                    </Tabs>
                </Stack>
            </Collapse>
        </Paper>
    );
});


/**
 * Shared game table for both ongoing and completed games.
 */
function GameTable({ games, completed, selectedIds, onToggle, onSelectAll, onAssign, formatTimestamp }) {
    const allSelected = games.length > 0 && games.every(g => selectedIds.has(g.game_id));
    const someSelected = games.some(g => selectedIds.has(g.game_id));
    return (
        <Table striped highlightOnHover withTableBorder withColumnBorders fontSize="xs">
            <Table.Thead>
                <Table.Tr>
                    <Table.Th w={30}>
                        <Checkbox
                            size="xs"
                            checked={allSelected}
                            indeterminate={someSelected && !allSelected}
                            onChange={() => onSelectAll(games.map(g => g.game_id))}
                        />
                    </Table.Th>
                    <Table.Th>Away</Table.Th>
                    <Table.Th w={40}>Score</Table.Th>
                    <Table.Th>Home</Table.Th>
                    {completed && <Table.Th>Time</Table.Th>}
                    {completed && <Table.Th>Stadium</Table.Th>}
                    <Table.Th w={60}></Table.Th>
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {games.map((game) => {
                    const gid = game.game_id;
                    const awayUser = game.away_user ?? game.entrants?.[0]?.[0]?.rioName ?? '';
                    const homeUser = game.home_user ?? game.entrants?.[1]?.[0]?.rioName ?? '';
                    const awayScore = game.away_score ?? game.team1score ?? 0;
                    const homeScore = game.home_score ?? game.team2score ?? 0;
                    const awayCaptain = game.away_captain ?? '';
                    const homeCaptain = game.home_captain ?? '';

                    return (
                        <Table.Tr key={gid}>
                            <Table.Td>
                                <Checkbox
                                    size="xs"
                                    checked={selectedIds.has(gid)}
                                    onChange={() => onToggle(gid)}
                                />
                            </Table.Td>
                            <Table.Td>
                                <Text size="xs" fw={500}>{awayUser}</Text>
                                {awayCaptain && <Text size="xs" c="dimmed">{awayCaptain}</Text>}
                            </Table.Td>
                            <Table.Td ta="center">
                                <Text size="xs" fw={600}>{awayScore}-{homeScore}</Text>
                            </Table.Td>
                            <Table.Td>
                                <Text size="xs" fw={500}>{homeUser}</Text>
                                {homeCaptain && <Text size="xs" c="dimmed">{homeCaptain}</Text>}
                            </Table.Td>
                            {completed && (
                                <Table.Td>
                                    <Text size="xs">{formatTimestamp(game.date_time_end)}</Text>
                                </Table.Td>
                            )}
                            {completed && (
                                <Table.Td>
                                    <Text size="xs">{game.stadium ?? ''}</Text>
                                </Table.Td>
                            )}
                            <Table.Td>
                                <Tooltip label="Load this game">
                                    <Button size="compact-xs" variant="light" onClick={() => onAssign(gid)}>
                                        Load
                                    </Button>
                                </Tooltip>
                            </Table.Td>
                        </Table.Tr>
                    );
                })}
            </Table.Tbody>
        </Table>
    );
}

import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import {
    Paper, Tabs, Stack, Group, Text, Button, ActionIcon, Badge, Loader,
    NumberInput, Switch, Table, TextInput, Select,
    MultiSelect, Tooltip, Modal, ScrollArea, CloseButton, Grid,
} from '@mantine/core';
import { useSocketSubscribe } from '../../context/socket';

let searchSetIdCounter = 0;

/** Extract game mode string from a game object. */
const gameMode = (game) =>
    Array.isArray(game.tags) ? game.tags.join(', ') : (game.tags ?? game.game_mode ?? '');

const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
        const d = new Date(ts);
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return String(ts); }
};

// ─── PoolPanel ────────────────────────────────────────────────────────────────
// One half of the dual-panel modal: either "Available" or "In Rotation".
// Has per-column filtering and sortable headers.

const PAGE_SIZE = 50;

const COLS = [
    { key: 'away',    label: 'Away',    sortable: true },
    { key: 'score',   label: 'Score',   sortable: true, w: 68 },
    { key: 'home',    label: 'Home',    sortable: true },
    { key: 'time',    label: 'Time',    sortable: true, w: 110 },
    { key: 'stadium', label: 'Stadium', sortable: true },
    { key: 'mode',    label: 'Mode',    sortable: true },
];

const PoolPanel = memo(function PoolPanel({ title, color, games, actionLabel, onAction, onActionAll, onAssign }) {
    const [username, setUsername] = useState('');
    const [stadiumFilter, setStadiumFilter] = useState(null);
    const [modeFilter, setModeFilter] = useState(null);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [sort, setSort] = useState({ col: null, dir: 'asc' });
    const [page, setPage] = useState(1);

    const toggleSort = useCallback((col) => {
        setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
        setPage(1);
    }, []);

    const stadiumOptions = useMemo(() => {
        const seen = new Set();
        const opts = [];
        for (const g of games) {
            const s = g.stadium ?? '';
            if (s && !seen.has(s)) { seen.add(s); opts.push({ value: s, label: s }); }
        }
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [games]);

    const modeOptions = useMemo(() => {
        const seen = new Set();
        const opts = [];
        for (const g of games) {
            const m = gameMode(g);
            if (m && !seen.has(m)) { seen.add(m); opts.push({ value: m, label: m }); }
        }
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [games]);

    const processed = useMemo(() => {
        let result = games;

        if (username.trim()) {
            const q = username.trim().toLowerCase();
            result = result.filter(g =>
                (g.away_user ?? '').toLowerCase().includes(q) ||
                (g.away_captain ?? '').toLowerCase().includes(q) ||
                (g.home_user ?? '').toLowerCase().includes(q) ||
                (g.home_captain ?? '').toLowerCase().includes(q)
            );
        }
        if (stadiumFilter) result = result.filter(g => (g.stadium ?? '') === stadiumFilter);
        if (modeFilter) result = result.filter(g => gameMode(g) === modeFilter);
        if (dateFrom) {
            const from = new Date(dateFrom);
            result = result.filter(g => g.date_time_end && new Date(g.date_time_end) >= from);
        }
        if (dateTo) {
            const to = new Date(dateTo);
            to.setDate(to.getDate() + 1); // include the full "to" day
            result = result.filter(g => g.date_time_end && new Date(g.date_time_end) < to);
        }

        if (sort.col) {
            const dir = sort.dir === 'asc' ? 1 : -1;
            result = [...result].sort((a, b) => {
                let av, bv;
                switch (sort.col) {
                    case 'away':    av = (a.away_user ?? '').toLowerCase();   bv = (b.away_user ?? '').toLowerCase();   break;
                    case 'home':    av = (a.home_user ?? '').toLowerCase();   bv = (b.home_user ?? '').toLowerCase();   break;
                    case 'score':   av = (a.away_score ?? 0);                 bv = (b.away_score ?? 0);                 break;
                    case 'time':    av = a.date_time_end ?? '';               bv = b.date_time_end ?? '';               break;
                    case 'stadium': av = (a.stadium ?? '').toLowerCase();     bv = (b.stadium ?? '').toLowerCase();     break;
                    case 'mode':    av = gameMode(a).toLowerCase();           bv = gameMode(b).toLowerCase();           break;
                    default: return 0;
                }
                if (av < bv) return -dir;
                if (av > bv) return dir;
                return 0;
            });
        }

        return result;
    }, [games, username, stadiumFilter, modeFilter, dateFrom, dateTo, sort]);

    const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageStart = (safePage - 1) * PAGE_SIZE;
    const pageRows = processed.slice(pageStart, pageStart + PAGE_SIZE);

    return (
        <Stack gap="xs" h="100%">
            <Group gap="xs" justify="space-between">
                <Group gap="xs">
                    <Text size="sm" fw={600}>{title}</Text>
                    <Badge size="xs" color={color} variant="filled">{processed.length}</Badge>
                </Group>
                <Button
                    size="compact-xs"
                    variant="light"
                    color={color}
                    disabled={processed.length === 0}
                    onClick={() => onActionAll(processed.map(g => g.game_id))}
                >
                    {actionLabel} All{processed.length !== games.length ? ' (filtered)' : ''}
                </Button>
            </Group>

            {/* Filter bar */}
            <Stack gap={4}>
                <Group gap="xs" grow>
                    <TextInput
                        size="xs"
                        placeholder="Username"
                        value={username}
                        onChange={e => { setUsername(e.currentTarget.value); setPage(1); }}
                    />
                    <Select
                        size="xs"
                        placeholder="Stadium"
                        data={stadiumOptions}
                        value={stadiumFilter}
                        onChange={val => { setStadiumFilter(val); setPage(1); }}
                        clearable
                        searchable
                    />
                    <Select
                        size="xs"
                        placeholder="Game Mode"
                        data={modeOptions}
                        value={modeFilter}
                        onChange={val => { setModeFilter(val); setPage(1); }}
                        clearable
                        searchable
                    />
                </Group>
                <Group gap="xs">
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap', alignSelf: 'center' }}>Date:</Text>
                    <TextInput
                        type="date"
                        size="xs"
                        style={{ flex: 1 }}
                        value={dateFrom}
                        onChange={e => { setDateFrom(e.currentTarget.value); setPage(1); }}
                    />
                    <Text size="xs" c="dimmed" style={{ alignSelf: 'center' }}>–</Text>
                    <TextInput
                        type="date"
                        size="xs"
                        style={{ flex: 1 }}
                        value={dateTo}
                        onChange={e => { setDateTo(e.currentTarget.value); setPage(1); }}
                    />
                </Group>
            </Stack>

            <ScrollArea h={560} style={{ flex: 1 }}>
                <Table striped highlightOnHover withTableBorder withColumnBorders fontSize="xs" style={{ minWidth: 520 }}>
                    <Table.Thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--mantine-color-body)' }}>
                        <Table.Tr>
                            {COLS.map(({ key, label, sortable, w }) => (
                                <Table.Th key={key} w={w}>
                                    <Group
                                        gap={4}
                                        style={{ cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}
                                        onClick={() => sortable && toggleSort(key)}
                                    >
                                        <Text size="xs" fw={600}>{label}</Text>
                                        {sort.col === key && (
                                            <Text size="xs" c="dimmed">{sort.dir === 'asc' ? '↑' : '↓'}</Text>
                                        )}
                                    </Group>
                                </Table.Th>
                            ))}
                            <Table.Th w={80} />
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {pageRows.length === 0 ? (
                            <Table.Tr>
                                <Table.Td colSpan={7}>
                                    <Text size="xs" c="dimmed" ta="center" py="sm">No games</Text>
                                </Table.Td>
                            </Table.Tr>
                        ) : pageRows.map((game) => {
                            const gid = game.game_id;
                            const awayUser = game.away_user ?? game.entrants?.[0]?.[0]?.rioName ?? '';
                            const homeUser = game.home_user ?? game.entrants?.[1]?.[0]?.rioName ?? '';
                            const awayScore = game.away_score ?? game.team1score ?? 0;
                            const homeScore = game.home_score ?? game.team2score ?? 0;
                            const awayCaptain = game.away_captain ?? '';
                            const homeCaptain = game.home_captain ?? '';
                            const mode = gameMode(game);

                            return (
                                <Table.Tr key={gid}>
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
                                        <Text size="xs">{formatTimestamp(game.date_time_end)}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="xs">{game.stadium ?? ''}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="xs">{mode}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group gap={4} wrap="nowrap">
                                            <Tooltip label="Load to scoreboard">
                                                <Button size="compact-xs" variant="subtle" onClick={() => onAssign(gid)}>
                                                    Load
                                                </Button>
                                            </Tooltip>
                                            <Tooltip label={actionLabel}>
                                                <ActionIcon
                                                    size="sm"
                                                    variant="light"
                                                    color={color}
                                                    onClick={() => onAction(gid)}
                                                >
                                                    <Text size="xs" lh={1}>{actionLabel === 'Add' ? '+' : '−'}</Text>
                                                </ActionIcon>
                                            </Tooltip>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            );
                        })}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
            {totalPages > 1 && (
                <Group gap="xs" justify="center">
                    <ActionIcon size="sm" variant="subtle" disabled={safePage === 1} onClick={() => setPage(p => p - 1)}>
                        <Text size="xs" lh={1}>‹</Text>
                    </ActionIcon>
                    <Text size="xs" c="dimmed">{safePage} / {totalPages}</Text>
                    <ActionIcon size="sm" variant="subtle" disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)}>
                        <Text size="xs" lh={1}>›</Text>
                    </ActionIcon>
                </Group>
            )}
        </Stack>
    );
});

// ─── RotationControls ─────────────────────────────────────────────────────────

export default memo(function RotationControls({ scoreboardNumber }) {
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
    const [secondsRemaining, setSecondsRemaining] = useState(null);

    // Multi-search manager state
    const [searchSets, setSearchSets] = useState([]);
    const [ongoingGames, setOngoingGames] = useState([]);
    const autoPollSetIdRef = useRef(null);
    const autoPollingRef = useRef(false);
    // Tracks live game IDs the user explicitly deselected, so autopoll doesn't re-add them
    const deselectedLiveIdsRef = useRef(new Set());
    // Ref-mirror of source_pool for use inside socket callbacks (avoids stale closure)
    const sourcePoolRef = useRef('both');

    // Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('completed');

    // Inline search filters
    const [draftUsername, setDraftUsername] = useState('');
    const [draftVsUsername, setDraftVsUsername] = useState('');
    const [draftTags, setDraftTags] = useState([]);
    const [draftLimit, setDraftLimit] = useState(null);
    const [draftTagSearch, setDraftTagSearch] = useState('');
    const [loadingSearch, setLoadingSearch] = useState(false);
    const [loadingOngoing, setLoadingOngoing] = useState(false);
    const searchAbortRef = useRef(null);
    const ongoingAbortRef = useRef(null);

    useEffect(() => { sourcePoolRef.current = rotationConfig.source_pool; }, [rotationConfig.source_pool]);

    const [gameModeOptions, setGameModeOptions] = useState([]);
    const [autoPolling, setAutoPolling] = useState(false);
    useEffect(() => { autoPollingRef.current = autoPolling; }, [autoPolling]);
    const [autoPollInterval, setAutoPollInterval] = useState(60);

    const tagOptions = useMemo(() => {
        const trimmed = draftTagSearch.trim();
        if (trimmed && !gameModeOptions.some(o => o.value === trimmed)) {
            return [...gameModeOptions, { value: trimmed, label: trimmed }];
        }
        return gameModeOptions;
    }, [gameModeOptions, draftTagSearch]);

    // Derived game lists for the dual panels
    const allPoolGames = useMemo(() => {
        const seen = new Set();
        const result = [];
        for (const set of searchSets) {
            for (const g of set.games) {
                if (!seen.has(g.game_id)) { seen.add(g.game_id); result.push(g); }
            }
        }
        return result;
    }, [searchSets]);

    const [completedAvailable, completedInRotation] = useMemo(() => [
        allPoolGames.filter(g => !selectedGameIds.has(g.game_id)),
        allPoolGames.filter(g =>  selectedGameIds.has(g.game_id)),
    ], [allPoolGames, selectedGameIds]);

    const [ongoingAvailable, ongoingInRotation] = useMemo(() => [
        ongoingGames.filter(g => !selectedGameIds.has(g.game_id)),
        ongoingGames.filter(g =>  selectedGameIds.has(g.game_id)),
    ], [ongoingGames, selectedGameIds]);

    const addToRotation = useCallback((gameId) => {
        setSelectedGameIds(prev => new Set([...prev, gameId]));
    }, []);

    const removeFromRotation = useCallback((gameId) => {
        setSelectedGameIds(prev => { const n = new Set(prev); n.delete(gameId); return n; });
    }, []);

    const addAllToRotation = useCallback((gameIds) => {
        setSelectedGameIds(prev => new Set([...prev, ...gameIds]));
    }, []);

    const removeAllFromRotation = useCallback((gameIds) => {
        setSelectedGameIds(prev => { const n = new Set(prev); gameIds.forEach(id => n.delete(id)); return n; });
    }, []);

    // Live-game-specific callbacks — also maintain deselectedLiveIdsRef
    const addLiveToRotation = useCallback((gameId) => {
        deselectedLiveIdsRef.current.delete(gameId);
        setSelectedGameIds(prev => new Set([...prev, gameId]));
    }, []);

    const removeLiveFromRotation = useCallback((gameId) => {
        deselectedLiveIdsRef.current.add(gameId);
        setSelectedGameIds(prev => { const n = new Set(prev); n.delete(gameId); return n; });
    }, []);

    const addAllLiveToRotation = useCallback((gameIds) => {
        gameIds.forEach(id => deselectedLiveIdsRef.current.delete(id));
        setSelectedGameIds(prev => new Set([...prev, ...gameIds]));
    }, []);

    const removeAllLiveFromRotation = useCallback((gameIds) => {
        gameIds.forEach(id => deselectedLiveIdsRef.current.add(id));
        setSelectedGameIds(prev => { const n = new Set(prev); gameIds.forEach(id => n.delete(id)); return n; });
    }, []);

    // Fetch on mount
    useEffect(() => {
        fetch(`/api/v1/rotation/${scoreboardNumber}`)
            .then(r => r.json())
            .then(data => {
                setRotationConfig(prev => ({ ...prev, ...data }));
                setRotationStatus({ active: data.active ?? false, ...data });
            })
            .catch(() => {});
    }, [scoreboardNumber]);

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => setGameModeOptions(Object.keys(data).map(n => ({ value: n, label: n }))))
            .catch(() => {});
    }, []);

    // Socket subscriptions
    const handleCompletedUpdate = useCallback((payload) => {
        if (!autoPollingRef.current) return;
        const games = Array.isArray(payload) ? payload : (payload?.games ?? []);
        setSearchSets(prev => {
            const existingIdx = autoPollSetIdRef.current != null
                ? prev.findIndex(s => s.id === autoPollSetIdRef.current) : -1;
            if (existingIdx >= 0) {
                const next = [...prev];
                next[existingIdx] = { ...prev[existingIdx], games };
                return next;
            }
            const newId = ++searchSetIdCounter;
            autoPollSetIdRef.current = newId;
            return [...prev, { id: newId, label: 'Auto-poll', filters: { username: '', vs_username: '', tags: [], limit: 0 }, games, isAutoPoll: true }];
        });
        setSelectedGameIds(prev => {
            const next = new Set(prev);
            games.forEach(g => next.add(g.game_id));
            return next;
        });
    }, []);
    useSocketSubscribe('v1.game_pool.completed_update', handleCompletedUpdate);

    const handleOngoingUpdate = useCallback((payload) => {
        const updated = Array.isArray(payload) ? payload : (payload?.games ?? []);
        setOngoingGames(updated);
        const pool = sourcePoolRef.current;
        if (pool === 'both' || pool === 'ongoing') {
            setSelectedGameIds(prev => {
                const n = new Set(prev);
                updated.forEach(g => {
                    if (!deselectedLiveIdsRef.current.has(g.game_id)) n.add(g.game_id);
                });
                return n;
            });
        }
    }, []);
    useSocketSubscribe('v1.game_pool.ongoing_update', handleOngoingUpdate);

    const handleRotationStatus = useCallback((payload) => {
        if (payload?.scoreboard === scoreboardNumber) setRotationStatus(payload);
    }, [scoreboardNumber]);
    useSocketSubscribe('v1.rotation.status', handleRotationStatus);

    // Countdown ticker
    useEffect(() => {
        const target = rotationStatus?.next_advance_at;
        if (!rotationStatus?.active || !target) { setSecondsRemaining(null); return; }
        const tick = () => setSecondsRemaining(Math.max(0, Math.round(target - Date.now() / 1000)));
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [rotationStatus?.active, rotationStatus?.next_advance_at]);

    // Fetch live games and auto-select all
    const handleCancelOngoing = useCallback(() => {
        ongoingAbortRef.current?.abort();
        setLoadingOngoing(false);
    }, []);

    const fetchOngoing = useCallback(async () => {
        ongoingAbortRef.current?.abort();
        const ctrl = new AbortController();
        ongoingAbortRef.current = ctrl;
        setLoadingOngoing(true);
        try {
            const data = await fetch('/api/v1/game-pool/ongoing', { signal: ctrl.signal }).then(r => r.json());
            const games = Array.isArray(data) ? data : [];
            setOngoingGames(games);
            const pool = sourcePoolRef.current;
            if (pool === 'both' || pool === 'ongoing') {
                setSelectedGameIds(prev => {
                    const n = new Set(prev);
                    games.forEach(g => {
                        if (!deselectedLiveIdsRef.current.has(g.game_id)) n.add(g.game_id);
                    });
                    return n;
                });
            }
        } catch (e) {
            if (e.name !== 'AbortError') setOngoingGames([]);
        } finally {
            setLoadingOngoing(false);
        }
    }, []);

    const handleCancelSearch = useCallback(() => {
        searchAbortRef.current?.abort();
        setLoadingSearch(false);
    }, []);

    // Search completed games and create a new search set
    const handleSearch = useCallback(async () => {
        searchAbortRef.current?.abort();
        const ctrl = new AbortController();
        searchAbortRef.current = ctrl;
        setLoadingSearch(true);
        const params = new URLSearchParams();
        if (draftUsername.trim()) params.append('username', draftUsername.trim());
        if (draftVsUsername.trim()) params.append('vs_username', draftVsUsername.trim());
        for (const tag of draftTags) params.append('tag', tag);
        params.append('limit_games', String(draftLimit ?? 500));

        try {
            await fetch(`/api/v1/game-pool/completed/refresh?${params}`, { method: 'POST', signal: ctrl.signal });
            const data = await fetch('/api/v1/game-pool/completed', { signal: ctrl.signal }).then(r => r.json());
            const games = Array.isArray(data) ? data : [];

            const parts = [];
            if (draftUsername.trim()) parts.push(draftUsername.trim());
            if (draftVsUsername.trim()) parts.push(`vs ${draftVsUsername.trim()}`);
            if (draftTags.length) parts.push(draftTags.join(', '));
            const label = parts.length ? parts.join(' · ') : 'All games';

            setSearchSets(prev => [...prev, {
                id: ++searchSetIdCounter,
                label,
                filters: { username: draftUsername.trim(), vs_username: draftVsUsername.trim(), tags: [...draftTags], limit: draftLimit },
                games,
                isAutoPoll: false,
            }]);
            setSelectedGameIds(prev => { const n = new Set(prev); games.forEach(g => n.add(g.game_id)); return n; });
        } catch (e) {
            if (e.name !== 'AbortError') { /* noop */ }
        } finally {
            setLoadingSearch(false);
        }
    }, [draftUsername, draftVsUsername, draftTags, draftLimit]);

    const handleRemoveSearchSet = useCallback((setId) => {
        setSearchSets(prev => {
            const toRemove = prev.find(s => s.id === setId);
            if (toRemove) {
                if (autoPollSetIdRef.current === setId) autoPollSetIdRef.current = null;
                const idsInOtherSets = new Set(
                    prev.filter(s => s.id !== setId).flatMap(s => s.games.map(g => g.game_id))
                );
                setSelectedGameIds(sel => {
                    const next = new Set(sel);
                    toRemove.games.forEach(g => { if (!idsInOtherSets.has(g.game_id)) next.delete(g.game_id); });
                    return next;
                });
            }
            return prev.filter(s => s.id !== setId);
        });
    }, []);

    const handleAssignGame = useCallback(async (gameId) => {
        await fetch(`/api/v1/game-pool/assign?game_id=${gameId}&scoreboard_number=${scoreboardNumber}`, { method: 'POST' });
    }, [scoreboardNumber]);

    const handleStartRotation = useCallback(async () => {
        const gameIds = Array.from(selectedGameIds);
        if (gameIds.length === 0) return;
        await fetch(`/api/v1/rotation/${scoreboardNumber}?game_ids=${gameIds.join(',')}&interval=${rotationConfig.interval}&source_pool=${rotationConfig.source_pool}&poll_interval=${rotationConfig.poll_interval}`, { method: 'PUT' });
        const data = await fetch(`/api/v1/rotation/${scoreboardNumber}/start`, { method: 'POST' }).then(r => r.json());
        setRotationStatus(data);
    }, [scoreboardNumber, selectedGameIds, rotationConfig]);

    const handleStopRotation = useCallback(async () => {
        await fetch(`/api/v1/rotation/${scoreboardNumber}/stop`, { method: 'POST' });
        setRotationStatus({ active: false });
    }, [scoreboardNumber]);

    const handleNextGame = useCallback(async () => {
        setRotationStatus(await fetch(`/api/v1/rotation/${scoreboardNumber}/next`, { method: 'POST' }).then(r => r.json()));
    }, [scoreboardNumber]);

    const handlePrevGame = useCallback(async () => {
        setRotationStatus(await fetch(`/api/v1/rotation/${scoreboardNumber}/prev`, { method: 'POST' }).then(r => r.json()));
    }, [scoreboardNumber]);

    const handleSetAutoPoll = useCallback(async (enabled, interval) => {
        const effectiveInterval = interval ?? autoPollInterval;
        setAutoPolling(enabled);
        if (interval != null) setAutoPollInterval(effectiveInterval);
        if (enabled) {
            const params = new URLSearchParams();
            if (draftUsername.trim()) params.append('username', draftUsername.trim());
            if (draftVsUsername.trim()) params.append('vs_username', draftVsUsername.trim());
            for (const tag of draftTags) params.append('tag', tag);
            params.append('limit_games', String(draftLimit ?? 500));
            await fetch(`/api/v1/game-pool/completed/refresh?${params}`, { method: 'POST' });
        }
        await fetch(`/api/v1/game-pool/completed/auto-poll?enabled=${enabled}&interval=${effectiveInterval}`, { method: 'POST' });
    }, [autoPollInterval, draftUsername, draftVsUsername, draftTags, draftLimit]);

    const searchCount = searchSets.length;

    return (
        <>
            {/* ── Inline panel ── */}
            <Paper shadow="xs" p="sm" withBorder>
                <Stack gap="xs">
                    <Group gap="xs">
                        <Text fw={600} size="sm">Game Pool & Rotation</Text>
                        {rotationStatus.active && (
                            <Badge size="xs" color="teal" variant="filled">
                                {rotationStatus.current_index + 1}/{rotationStatus.total_games}
                                {secondsRemaining != null && ` · ${secondsRemaining}s`}
                            </Badge>
                        )}
                    </Group>

                    {/* Search filters */}
                    <Stack gap={4}>
                        <Group gap="xs">
                            <TextInput
                                size="xs"
                                placeholder="Username"
                                value={draftUsername}
                                onChange={(e) => setDraftUsername(e.currentTarget.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                                style={{ flex: 1 }}
                            />
                            <TextInput
                                size="xs"
                                placeholder="Vs Username"
                                value={draftVsUsername}
                                onChange={(e) => setDraftVsUsername(e.currentTarget.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                                style={{ flex: 1 }}
                            />
                        </Group>
                        <Group gap="xs" align="flex-end">
                            <MultiSelect
                                size="xs"
                                placeholder="Tags / game modes"
                                data={tagOptions}
                                value={draftTags}
                                onChange={(val) => { setDraftTags(val); setDraftTagSearch(''); }}
                                searchValue={draftTagSearch}
                                onSearchChange={setDraftTagSearch}
                                searchable
                                clearable
                                style={{ flex: 1 }}
                                maxDropdownHeight={200}
                            />
                            <NumberInput
                                size="xs"
                                placeholder="Limit"
                                min={1}
                                max={500}
                                value={draftLimit}
                                onChange={setDraftLimit}
                                w={72}
                            />
                            {loadingSearch ? (
                                <Button size="xs" onClick={handleCancelSearch} color="red" variant="light"
                                    leftSection={<Loader size={10} color="red" />}>
                                    Cancel
                                </Button>
                            ) : (
                                <Button size="xs" onClick={handleSearch}>
                                    Search
                                </Button>
                            )}
                        </Group>
                    </Stack>

                    {/* Rotation settings + auto-poll */}
                    <Group gap="sm" align="flex-end">
                        <NumberInput
                            label="Interval (sec)"
                            size="xs"
                            w={95}
                            min={5}
                            max={600}
                            value={rotationConfig.interval}
                            onChange={(val) => setRotationConfig(c => ({ ...c, interval: val || 30 }))}
                        />
                        <Select
                            label="Pool"
                            size="xs"
                            w={110}
                            data={[
                                { value: 'both', label: 'Both' },
                                { value: 'ongoing', label: 'Live Only' },
                                { value: 'completed', label: 'Completed' },
                            ]}
                            value={rotationConfig.source_pool}
                            onChange={(val) => setRotationConfig(c => ({ ...c, source_pool: val }))}
                        />
                        <Group gap="xs" align="flex-end" style={{ alignSelf: 'flex-end' }}>
                            <Switch
                                size="xs"
                                label="Auto-poll"
                                checked={autoPolling}
                                onChange={(e) => handleSetAutoPoll(e.currentTarget.checked)}
                                style={{ paddingBottom: 4 }}
                            />
                            {autoPolling && (
                                <NumberInput
                                    size="xs"
                                    w={72}
                                    min={10}
                                    max={300}
                                    value={autoPollInterval}
                                    onChange={(val) => handleSetAutoPoll(true, val || 60)}
                                    suffix="s"
                                />
                            )}
                        </Group>
                    </Group>

                    <Group gap="xs">
                        {!rotationStatus.active ? (
                            <Button size="xs" color="teal" onClick={handleStartRotation}
                                disabled={selectedGameIds.size === 0}>
                                Start ({selectedGameIds.size})
                            </Button>
                        ) : (
                            <Button size="xs" color="red" variant="light" onClick={handleStopRotation}>
                                Stop
                            </Button>
                        )}
                        {rotationStatus.active && (
                            <>
                                <ActionIcon size="sm" variant="light" onClick={handlePrevGame}>
                                    <Text size="xs" lh={1}>&lt;</Text>
                                </ActionIcon>
                                <Text size="xs">
                                    {rotationStatus.current_index + 1}/{rotationStatus.total_games}
                                </Text>
                                <ActionIcon size="sm" variant="light" onClick={handleNextGame}>
                                    <Text size="xs" lh={1}>&gt;</Text>
                                </ActionIcon>
                                {secondsRemaining != null && (
                                    <Text size="xs" c="dimmed">{secondsRemaining}s</Text>
                                )}
                            </>
                        )}
                    </Group>

                    {searchCount > 0 && (
                        <Group gap="xs" justify="space-between" align="center">
                            <Text size="xs" c="dimmed">
                                {selectedGameIds.size} in rotation · {searchCount} search{searchCount !== 1 ? 'es' : ''}
                            </Text>
                            <Button size="xs" variant="subtle" onClick={() => setModalOpen(true)}>
                                Manage
                            </Button>
                        </Group>
                    )}
                </Stack>
            </Paper>

            {/* ── Game Pool Manager Modal ── */}
            <Modal
                opened={modalOpen}
                onClose={() => setModalOpen(false)}
                title={
                    <Group gap="xs">
                        <Text fw={600}>Game Pool Manager</Text>
                        <Badge size="sm" color="teal" variant="light">
                            {selectedGameIds.size} in rotation
                        </Badge>
                    </Group>
                }
                size="100%"
                scrollAreaComponent={ScrollArea.Autosize}
            >
                <Tabs value={activeTab} onChange={setActiveTab} variant="pills" size="xs">
                    <Tabs.List mb="md">
                        <Tabs.Tab value="completed">
                            Completed Games ({allPoolGames.length})
                        </Tabs.Tab>
                        <Tabs.Tab value="ongoing">
                            Live Games ({ongoingGames.length})
                        </Tabs.Tab>
                    </Tabs.List>

                    {/* ── Completed tab ── */}
                    <Tabs.Panel value="completed">
                        <Stack gap="sm">
                            {/* Search set summary */}
                            {searchSets.length > 0 && (
                                <Group gap="xs" wrap="wrap">
                                    <Text size="xs" c="dimmed" style={{ alignSelf: 'center' }}>Searches:</Text>
                                    {searchSets.map(set => {
                                        const inRotation = set.games.filter(g => selectedGameIds.has(g.game_id)).length;
                                        return (
                                            <Badge
                                                key={set.id}
                                                size="sm"
                                                variant="light"
                                                color={set.isAutoPoll ? 'blue' : 'gray'}
                                                rightSection={
                                                    <CloseButton
                                                        size="xs"
                                                        onClick={() => handleRemoveSearchSet(set.id)}
                                                        style={{ marginLeft: 2 }}
                                                    />
                                                }
                                            >
                                                {set.label} · {inRotation}/{set.games.length}
                                            </Badge>
                                        );
                                    })}
                                </Group>
                            )}

                            {allPoolGames.length === 0 ? (
                                <Text size="sm" c="dimmed" ta="center" py="xl">
                                    No searches yet. Use the search form to find games.
                                </Text>
                            ) : (
                                <Grid gutter="md">
                                    <Grid.Col span={6}>
                                        <PoolPanel
                                            title="Available"
                                            color="gray"
                                            games={completedAvailable}
                                            actionLabel="Add"
                                            onAction={addToRotation}
                                            onActionAll={addAllToRotation}
                                            onAssign={handleAssignGame}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <PoolPanel
                                            title="In Rotation"
                                            color="teal"
                                            games={completedInRotation}
                                            actionLabel="Remove"
                                            onAction={removeFromRotation}
                                            onActionAll={removeAllFromRotation}
                                            onAssign={handleAssignGame}
                                        />
                                    </Grid.Col>
                                </Grid>
                            )}
                        </Stack>
                    </Tabs.Panel>

                    {/* ── Live games tab ── */}
                    <Tabs.Panel value="ongoing">
                        <Stack gap="sm">
                            {loadingOngoing ? (
                                <Button size="xs" color="red" variant="light" onClick={handleCancelOngoing}
                                    w="fit-content" leftSection={<Loader size={10} color="red" />}>
                                    Cancel
                                </Button>
                            ) : (
                                <Button size="xs" variant="light" onClick={fetchOngoing} w="fit-content">
                                    Refresh Live Games
                                </Button>
                            )}
                            {ongoingGames.length === 0 ? (
                                <Text size="xs" c="dimmed">No live games found. Click refresh to check.</Text>
                            ) : (
                                <Grid gutter="md">
                                    <Grid.Col span={6}>
                                        <PoolPanel
                                            title="Available"
                                            color="gray"
                                            games={ongoingAvailable}
                                            actionLabel="Add"
                                            onAction={addLiveToRotation}
                                            onActionAll={addAllLiveToRotation}
                                            onAssign={handleAssignGame}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={6}>
                                        <PoolPanel
                                            title="In Rotation"
                                            color="teal"
                                            games={ongoingInRotation}
                                            actionLabel="Remove"
                                            onAction={removeLiveFromRotation}
                                            onActionAll={removeAllLiveFromRotation}
                                            onAssign={handleAssignGame}
                                        />
                                    </Grid.Col>
                                </Grid>
                            )}
                        </Stack>
                    </Tabs.Panel>
                </Tabs>
            </Modal>
        </>
    );
});

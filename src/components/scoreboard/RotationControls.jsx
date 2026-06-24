import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, Minus } from 'lucide-react';
import { Stack, Text, Loader } from '../ui/primitives';
import { Panel } from '../ui/panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { NumberInput } from '../ui/number-input';
import { SimpleSelect } from '../ui/simple-select';
import { Combobox } from '../ui/combobox';
import { MultiSelect } from '../ui/multi-select';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ScrollArea } from '../ui/scroll-area';
import { SimpleTooltip } from '../ui/simple-tooltip';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../ui/table';
import { cn } from '../../lib/utils';
import { useSocketSubscribe } from '../../context/socket';
import { useSettingsStore } from '../../context/store';

// Tailwind tint per pool-action color name (legacy Mantine color).
const ACTION_TINT = {
    gray: 'bg-secondary text-secondary-foreground',
    teal: 'bg-[#14b8a6] text-black',
};

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
        <Stack gap="xs" className="h-full">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Text size="sm" fw={600}>{title}</Text>
                    <Badge className={cn('text-[10px]', ACTION_TINT[color] || ACTION_TINT.gray)}>{processed.length}</Badge>
                </div>
                <Button
                    size="xs"
                    variant="secondary"
                    disabled={processed.length === 0}
                    onClick={() => onActionAll(processed.map(g => g.game_id))}
                >
                    {actionLabel} All{processed.length !== games.length ? ' (filtered)' : ''}
                </Button>
            </div>

            {/* Filter bar */}
            <Stack gap="xs">
                <div className="flex gap-2">
                    <Input
                        placeholder="Username"
                        value={username}
                        onChange={e => { setUsername(e.currentTarget.value); setPage(1); }}
                        className="flex-1"
                    />
                    <Combobox
                        placeholder="Stadium"
                        data={stadiumOptions}
                        value={stadiumFilter}
                        onChange={val => { setStadiumFilter(val); setPage(1); }}
                        clearable
                        className="flex-1"
                    />
                    <Combobox
                        placeholder="Game Mode"
                        data={modeOptions}
                        value={modeFilter}
                        onChange={val => { setModeFilter(val); setPage(1); }}
                        clearable
                        className="flex-1"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Text size="xs" dimmed className="whitespace-nowrap">Date:</Text>
                    <Input
                        type="date"
                        className="flex-1"
                        value={dateFrom}
                        onChange={e => { setDateFrom(e.currentTarget.value); setPage(1); }}
                    />
                    <Text size="xs" dimmed>–</Text>
                    <Input
                        type="date"
                        className="flex-1"
                        value={dateTo}
                        onChange={e => { setDateTo(e.currentTarget.value); setPage(1); }}
                    />
                </div>
            </Stack>

            <ScrollArea className="h-[560px] flex-1">
                <Table className="min-w-[520px] text-xs">
                    <TableHeader className="sticky top-0 z-[1] bg-night-900">
                        <TableRow>
                            {COLS.map(({ key, label, sortable, w }) => (
                                <TableHead key={key} style={{ width: w }}>
                                    <span
                                        className={cn('flex select-none items-center gap-1', sortable && 'cursor-pointer')}
                                        onClick={() => sortable && toggleSort(key)}
                                    >
                                        <Text size="xs" fw={600} span>{label}</Text>
                                        {sort.col === key && (
                                            <Text size="xs" dimmed span>{sort.dir === 'asc' ? '↑' : '↓'}</Text>
                                        )}
                                    </span>
                                </TableHead>
                            ))}
                            <TableHead className="w-20" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pageRows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7}>
                                    <Text size="xs" dimmed ta="center" className="py-3">No games</Text>
                                </TableCell>
                            </TableRow>
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
                                <TableRow key={gid}>
                                    <TableCell>
                                        <Text size="xs" fw={500}>{awayUser}</Text>
                                        {awayCaptain && <Text size="xs" dimmed>{awayCaptain}</Text>}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Text size="xs" fw={600} className="tabular-nums">{awayScore}–{homeScore}</Text>
                                    </TableCell>
                                    <TableCell>
                                        <Text size="xs" fw={500}>{homeUser}</Text>
                                        {homeCaptain && <Text size="xs" dimmed>{homeCaptain}</Text>}
                                    </TableCell>
                                    <TableCell>
                                        <Text size="xs">{formatTimestamp(game.date_time_end)}</Text>
                                    </TableCell>
                                    <TableCell>
                                        <Text size="xs">{game.stadium ?? ''}</Text>
                                    </TableCell>
                                    <TableCell>
                                        <Text size="xs">{mode}</Text>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-nowrap items-center gap-1">
                                            <SimpleTooltip label="Load to scoreboard">
                                                <Button size="xs" variant="ghost" onClick={() => onAssign(gid)}>
                                                    Load
                                                </Button>
                                            </SimpleTooltip>
                                            <SimpleTooltip label={actionLabel}>
                                                <Button
                                                    size="icon-sm"
                                                    variant="secondary"
                                                    onClick={() => onAction(gid)}
                                                >
                                                    {actionLabel === 'Add' ? <Plus size={14} /> : <Minus size={14} />}
                                                </Button>
                                            </SimpleTooltip>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </ScrollArea>
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button size="icon-sm" variant="ghost" disabled={safePage === 1} onClick={() => setPage(p => p - 1)}>
                        <ChevronLeft size={14} />
                    </Button>
                    <Text size="xs" dimmed className="tabular-nums">{safePage} / {totalPages}</Text>
                    <Button size="icon-sm" variant="ghost" disabled={safePage === totalPages} onClick={() => setPage(p => p + 1)}>
                        <ChevronRight size={14} />
                    </Button>
                </div>
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
        filters: {},
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

    // Live (ongoing) auto-poll — mirrors the global ongoing_games.* setting,
    // which is also toggled by the Live API Game source panel.
    const liveAutoPollSetting = useSettingsStore(s => s?.ongoing_games?.auto_poll ?? false);
    const liveAutoPollIntervalSetting = useSettingsStore(s => s?.ongoing_games?.poll_interval ?? 10);
    const [liveAutoPolling, setLiveAutoPolling] = useState(liveAutoPollSetting);
    const [liveAutoPollInterval, setLiveAutoPollInterval] = useState(liveAutoPollIntervalSetting);
    useEffect(() => { setLiveAutoPolling(liveAutoPollSetting); }, [liveAutoPollSetting]);
    useEffect(() => { setLiveAutoPollInterval(liveAutoPollIntervalSetting); }, [liveAutoPollIntervalSetting]);

    const handleSetLiveAutoPoll = useCallback(async (enabled, interval) => {
        const effective = interval ?? liveAutoPollInterval;
        setLiveAutoPolling(enabled);
        if (interval != null) setLiveAutoPollInterval(effective);
        await fetch(
            `/api/v1/game-pool/ongoing/auto-poll?enabled=${enabled}&interval=${effective}`,
            { method: 'POST' },
        ).catch(() => {});
    }, [liveAutoPollInterval]);

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

    // Fetch on mount — restore rotation config (including its persisted
    // filters) and re-run the search to repopulate the modal preview.
    useEffect(() => {
        (async () => {
            try {
                const data = await fetch(`/api/v1/rotation/${scoreboardNumber}`).then(r => r.json());
                setRotationConfig(prev => ({ ...prev, ...data, filters: data.filters ?? {} }));
                setRotationStatus({ active: data.active ?? false, ...data });

                const gameIds = data.game_ids ?? [];
                const filters = data.filters ?? {};
                const usernameArr = filters.username ?? [];
                const vsUsernameArr = filters.vs_username ?? [];
                const tags = filters.tag ?? [];
                const limit = filters.limit_games ?? null;
                const username = Array.isArray(usernameArr) ? (usernameArr[0] ?? '') : (usernameArr || '');
                const vsUsername = Array.isArray(vsUsernameArr) ? (vsUsernameArr[0] ?? '') : (vsUsernameArr || '');

                setDraftUsername(username);
                setDraftVsUsername(vsUsername);
                setDraftTags(tags);
                setDraftLimit(limit);

                if (gameIds.length === 0 && !username && !vsUsername && tags.length === 0) return;

                // Re-run the search to repopulate the modal's game pool preview
                const params = new URLSearchParams();
                if (username) params.append('username', username);
                if (vsUsername) params.append('vs_username', vsUsername);
                for (const tag of tags) params.append('tag', tag);
                params.append('limit_games', String(limit ?? 500));

                await fetch(`/api/v1/game-pool/completed/refresh?${params}`, { method: 'POST' });
                const poolData = await fetch('/api/v1/game-pool/completed').then(r => r.json());
                const games = Array.isArray(poolData) ? poolData : [];

                if (games.length > 0) {
                    const parts = [];
                    if (username) parts.push(username);
                    if (vsUsername) parts.push(`vs ${vsUsername}`);
                    if (tags.length) parts.push(tags.join(', '));
                    const label = parts.length ? parts.join(' · ') : 'All games';

                    setSearchSets([{
                        id: ++searchSetIdCounter,
                        label,
                        filters: { username, vs_username: vsUsername, tags: [...tags], limit },
                        games,
                        isAutoPoll: false,
                    }]);
                    if (gameIds.length > 0) setSelectedGameIds(new Set(gameIds));
                }
            } catch { /* noop */ }
        })();
    }, [scoreboardNumber]); // eslint-disable-line react-hooks/exhaustive-deps

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

        // Snapshot the full completed-game dicts the user selected — this
        // becomes the rotation's persisted pool. Sent as a JSON body since
        // the list can be large (78+ games) and won't fit in a query string.
        // Ongoing games aren't persisted here; they're resolved live from
        // OngoingGamePool by ID at apply time.
        const completedById = new Map(allPoolGames.map(g => [g.game_id, g]));
        const games = gameIds
            .map(id => completedById.get(id))
            .filter(Boolean);

        // Persist the rotation's filter set so the optional poll loop can
        // augment the pool with newly-matching games (it never replaces the
        // user's selection).
        const filters = {};
        if (draftUsername.trim()) filters.username = [draftUsername.trim()];
        if (draftVsUsername.trim()) filters.vs_username = [draftVsUsername.trim()];
        if (draftTags.length) filters.tag = [...draftTags];
        if (draftLimit != null) filters.limit_games = draftLimit;

        // 1. Set the pool snapshot (body) — source of truth
        await fetch(`/api/v1/rotation/${scoreboardNumber}/games`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ games, game_ids: gameIds }),
        });

        // 2. PUT the small fields (interval, filters, etc.)
        const params = new URLSearchParams({
            interval: String(rotationConfig.interval),
            source_pool: rotationConfig.source_pool,
            poll_interval: String(rotationConfig.poll_interval),
            filters: JSON.stringify(filters),
        });
        await fetch(`/api/v1/rotation/${scoreboardNumber}?${params}`, { method: 'PUT' });

        // 3. Start
        const data = await fetch(`/api/v1/rotation/${scoreboardNumber}/start`, { method: 'POST' }).then(r => r.json());
        setRotationStatus(data);
        setRotationConfig(c => ({ ...c, filters }));
    }, [scoreboardNumber, selectedGameIds, rotationConfig, draftUsername, draftVsUsername, draftTags, draftLimit, allPoolGames]);

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

    // Toggle this rotation's per-state poll loop (RotationState._poll_loop).
    // Setting poll_interval > 0 makes the rotation refetch its filtered
    // game list on the configured cadence; 0 disables the loop entirely.
    const handleSetAutoPoll = useCallback(async (enabled, interval) => {
        const effectiveInterval = interval ?? autoPollInterval;
        setAutoPolling(enabled);
        if (interval != null) setAutoPollInterval(effectiveInterval);
        const pollValue = enabled ? effectiveInterval : 0;
        setRotationConfig(c => ({ ...c, poll_interval: pollValue }));
        await fetch(
            `/api/v1/rotation/${scoreboardNumber}?poll_interval=${pollValue}`,
            { method: 'PUT' },
        );
    }, [autoPollInterval, scoreboardNumber]);

    const searchCount = searchSets.length;

    return (
        <>
            {/* ── Inline panel ── */}
            <Panel className="p-3">
                <Stack gap="xs">
                    <div className="flex items-center gap-2">
                        <Text fw={600} size="sm">Game Pool & Rotation</Text>
                        {rotationStatus.active && (
                            <Badge className="bg-[#14b8a6] text-[10px] text-black">
                                {rotationStatus.current_index + 1}/{rotationStatus.total_games}
                                {secondsRemaining != null && ` · ${secondsRemaining}s`}
                            </Badge>
                        )}
                    </div>

                    {/* Search filters */}
                    <Stack gap="xs">
                        <div className="flex gap-2">
                            <Input
                                placeholder="Username"
                                value={draftUsername}
                                onChange={(e) => setDraftUsername(e.currentTarget.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                                className="flex-1"
                            />
                            <Input
                                placeholder="Vs Username"
                                value={draftVsUsername}
                                onChange={(e) => setDraftVsUsername(e.currentTarget.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                                className="flex-1"
                            />
                        </div>
                        <div className="flex items-end gap-2">
                            <MultiSelect
                                placeholder="Tags / game modes"
                                data={tagOptions}
                                value={draftTags}
                                onChange={(val) => { setDraftTags(val); setDraftTagSearch(''); }}
                                className="flex-1"
                            />
                            <NumberInput
                                placeholder="Limit"
                                min={1}
                                max={500}
                                value={draftLimit}
                                onChange={setDraftLimit}
                                className="w-[72px]"
                            />
                            {loadingSearch ? (
                                <Button size="xs" variant="outline" className="border-destructive/40 text-destructive" onClick={handleCancelSearch}>
                                    <Loader size={10} />
                                    Cancel
                                </Button>
                            ) : (
                                <Button size="xs" onClick={handleSearch}>
                                    Search
                                </Button>
                            )}
                        </div>
                    </Stack>

                    {/* Rotation settings + auto-poll */}
                    <div className="flex items-end gap-3">
                        <div className="flex w-[95px] flex-col gap-1">
                            <Label className="text-xs">Interval (sec)</Label>
                            <NumberInput
                                min={5}
                                max={600}
                                value={rotationConfig.interval}
                                onChange={(val) => setRotationConfig(c => ({ ...c, interval: val || 30 }))}
                            />
                        </div>
                        <div className="flex w-[110px] flex-col gap-1">
                            <Label className="text-xs">Pool</Label>
                            <SimpleSelect
                                data={[
                                    { value: 'both', label: 'Both' },
                                    { value: 'ongoing', label: 'Live Only' },
                                    { value: 'completed', label: 'Completed' },
                                ]}
                                value={rotationConfig.source_pool}
                                onChange={(val) => setRotationConfig(c => ({ ...c, source_pool: val }))}
                            />
                        </div>
                        <div className="flex items-center gap-2 pb-1">
                            <Label className="flex items-center gap-1.5 text-xs">
                                <Switch checked={autoPolling} onCheckedChange={handleSetAutoPoll} />
                                Auto-poll
                            </Label>
                            {autoPolling && (
                                <div className="flex items-center">
                                    <NumberInput
                                        min={10}
                                        max={300}
                                        value={autoPollInterval}
                                        onChange={(val) => handleSetAutoPoll(true, val || 60)}
                                        className="w-[72px]"
                                    />
                                    <span className="ml-0.5 text-xs text-muted-foreground">s</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!rotationStatus.active ? (
                            <Button size="xs" className="bg-[#14b8a6] text-black hover:bg-[#14b8a6]/90" onClick={handleStartRotation}
                                disabled={selectedGameIds.size === 0}>
                                Start ({selectedGameIds.size})
                            </Button>
                        ) : (
                            <Button size="xs" variant="outline" className="border-destructive/40 text-destructive" onClick={handleStopRotation}>
                                Stop
                            </Button>
                        )}
                        {rotationStatus.active && (
                            <>
                                <Button size="icon-sm" variant="secondary" onClick={handlePrevGame}>
                                    <ChevronLeft size={14} />
                                </Button>
                                <Text size="xs" className="tabular-nums">
                                    {rotationStatus.current_index + 1}/{rotationStatus.total_games}
                                </Text>
                                <Button size="icon-sm" variant="secondary" onClick={handleNextGame}>
                                    <ChevronRight size={14} />
                                </Button>
                                {secondsRemaining != null && (
                                    <Text size="xs" dimmed>{secondsRemaining}s</Text>
                                )}
                            </>
                        )}
                    </div>

                    {searchCount > 0 && (
                        <div className="flex items-center justify-between">
                            <Text size="xs" dimmed>
                                {selectedGameIds.size} in rotation · {searchCount} search{searchCount !== 1 ? 'es' : ''}
                            </Text>
                            <Button size="xs" variant="ghost" onClick={() => setModalOpen(true)}>
                                Manage
                            </Button>
                        </div>
                    )}
                </Stack>
            </Panel>

            {/* ── Game Pool Manager Modal ── */}
            <Dialog open={modalOpen} onOpenChange={(o) => { if (!o) setModalOpen(false); }}>
                <DialogContent className="max-h-[90vh] max-w-[96vw] overflow-y-auto sm:max-w-[96vw]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <span className="label-display">Game Pool Manager</span>
                            <Badge className="bg-[#14b8a6]/20 text-[#5eead4]">
                                {selectedGameIds.size} in rotation
                            </Badge>
                        </DialogTitle>
                    </DialogHeader>
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="mb-4">
                            <TabsTrigger value="completed">
                                Completed Games ({allPoolGames.length})
                            </TabsTrigger>
                            <TabsTrigger value="ongoing">
                                Live Games ({ongoingGames.length})
                            </TabsTrigger>
                        </TabsList>

                        {/* ── Completed tab ── */}
                        <TabsContent value="completed">
                            <Stack gap="sm">
                                {/* Search set summary */}
                                {searchSets.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Text size="xs" dimmed>Searches:</Text>
                                        {searchSets.map(set => {
                                            const inRotation = set.games.filter(g => selectedGameIds.has(g.game_id)).length;
                                            return (
                                                <Badge
                                                    key={set.id}
                                                    className={cn('gap-1', set.isAutoPoll ? 'bg-[#339af0]/20 text-[#74c0fc]' : 'bg-secondary text-secondary-foreground')}
                                                >
                                                    {set.label} · {inRotation}/{set.games.length}
                                                    <X className="size-3 cursor-pointer" onClick={() => handleRemoveSearchSet(set.id)} />
                                                </Badge>
                                            );
                                        })}
                                    </div>
                                )}

                                {allPoolGames.length === 0 ? (
                                    <Text size="sm" dimmed ta="center" className="py-8">
                                        No searches yet. Use the search form to find games.
                                    </Text>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                        <PoolPanel
                                            title="Available"
                                            color="gray"
                                            games={completedAvailable}
                                            actionLabel="Add"
                                            onAction={addToRotation}
                                            onActionAll={addAllToRotation}
                                            onAssign={handleAssignGame}
                                        />
                                        <PoolPanel
                                            title="In Rotation"
                                            color="teal"
                                            games={completedInRotation}
                                            actionLabel="Remove"
                                            onAction={removeFromRotation}
                                            onActionAll={removeAllFromRotation}
                                            onAssign={handleAssignGame}
                                        />
                                    </div>
                                )}
                            </Stack>
                        </TabsContent>

                        {/* ── Live games tab ── */}
                        <TabsContent value="ongoing">
                            <Stack gap="sm">
                                <div className="flex items-center gap-3">
                                    {loadingOngoing ? (
                                        <Button size="xs" variant="outline" className="border-destructive/40 text-destructive" onClick={handleCancelOngoing}>
                                            <Loader size={10} />
                                            Cancel
                                        </Button>
                                    ) : (
                                        <Button size="xs" variant="secondary" onClick={fetchOngoing}>
                                            Refresh Live Games
                                        </Button>
                                    )}
                                    <Label className="flex items-center gap-1.5 text-xs">
                                        <Switch checked={liveAutoPolling} onCheckedChange={handleSetLiveAutoPoll} />
                                        Auto-poll
                                    </Label>
                                    {liveAutoPolling && (
                                        <div className="flex items-center">
                                            <NumberInput
                                                min={5}
                                                max={300}
                                                step={5}
                                                value={liveAutoPollInterval}
                                                onChange={(val) => handleSetLiveAutoPoll(true, Number(val) || 10)}
                                                className="w-[72px]"
                                            />
                                            <span className="ml-0.5 text-xs text-muted-foreground">s</span>
                                        </div>
                                    )}
                                </div>
                                {ongoingGames.length === 0 ? (
                                    <Text size="xs" dimmed>No live games found. Click refresh to check.</Text>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                        <PoolPanel
                                            title="Available"
                                            color="gray"
                                            games={ongoingAvailable}
                                            actionLabel="Add"
                                            onAction={addLiveToRotation}
                                            onActionAll={addAllLiveToRotation}
                                            onAssign={handleAssignGame}
                                        />
                                        <PoolPanel
                                            title="In Rotation"
                                            color="teal"
                                            games={ongoingInRotation}
                                            actionLabel="Remove"
                                            onAction={removeLiveFromRotation}
                                            onActionAll={removeAllLiveFromRotation}
                                            onAssign={handleAssignGame}
                                        />
                                    </div>
                                )}
                            </Stack>
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>
        </>
    );
});

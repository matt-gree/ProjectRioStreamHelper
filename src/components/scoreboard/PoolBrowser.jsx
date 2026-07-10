import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { ChevronLeft, ChevronRight, X, Ban, RotateCw, Undo2, Search } from 'lucide-react';
import { Stack, Text, Loader } from '../ui/primitives';
import { Panel } from '../ui/panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { NumberInput } from '../ui/number-input';
import { Combobox } from '../ui/combobox';
import { MultiSelect } from '../ui/multi-select';
import { SimpleSelect } from '../ui/simple-select';
import { SegmentedControl } from '../ui/segmented-control';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ScrollArea } from '../ui/scroll-area';
import { SimpleTooltip } from '../ui/simple-tooltip';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../ui/table';
import { cn } from '../../lib/utils';
import { useSocketSubscribe } from '../../context/socket';
import { useSettingsStore, useStateStore } from '../../context/store';
import ParticipantPicker from '../ParticipantPicker';

/**
 * PoolBrowser — the unified Pool + Playback control surface for a scoreboard.
 *
 * Two playback modes, switched by one segmented control:
 *   • Single Game — an inline live/completed search; pick a game to Load onto
 *     the board. Live games keep updating while auto-refresh is on.
 *   • Rotator — one continuously-evaluated filter (game modes + usernames +
 *     opponents) over a live/completed scope, cycled on an interval. Find the
 *     matching games, then exclude any you don't want in the Pool games dialog.
 *
 * See ~/.claude/plans/pool-playback-unification.md.
 */

const gameAway = (g) => g.away_user ?? g.away_player ?? g.entrants?.[0]?.[0]?.rioName ?? '';
const gameHome = (g) => g.home_user ?? g.home_player ?? g.entrants?.[1]?.[0]?.rioName ?? '';
const gameAwayScore = (g) => g.away_score ?? g.team1score ?? 0;
const gameHomeScore = (g) => g.home_score ?? g.team2score ?? 0;
const gameMode = (g) => Array.isArray(g.tags) ? g.tags.join(', ') : (g.tags ?? g.game_mode_name ?? g.game_mode ?? '');
const gameLabel = (g) => `${gameAway(g) || '?'} vs ${gameHome(g) || '?'}`;

const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return String(ts); }
};

async function putJSON(url, body) {
    return fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).catch(() => {});
}

async function postJSON(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).catch(() => {});
}

// ─── GameRows ───────────────────────────────────────────────────────────────
// A game table body shared by the single-mode search and the pool-games modal.

function GameRows({ games, loading, emptyLabel, action, activeId }) {
    if (games.length === 0) {
        return (
            <TableRow>
                <TableCell colSpan={5}>
                    <Text size="xs" dimmed ta="center" className="py-4">
                        {loading ? 'Searching…' : emptyLabel}
                    </Text>
                </TableCell>
            </TableRow>
        );
    }
    return games.map(game => {
        const isActive = activeId != null && game.game_id === activeId;
        return (
            <TableRow key={game.game_id} className={cn(isActive && 'bg-[#14b8a6]/15')}>
                <TableCell><Text size="xs" fw={500}>{gameAway(game)}</Text></TableCell>
                <TableCell className="text-center">
                    <Text size="xs" fw={600} className="tabular-nums">
                        {gameAwayScore(game)}–{gameHomeScore(game)}
                    </Text>
                </TableCell>
                <TableCell><Text size="xs" fw={500}>{gameHome(game)}</Text></TableCell>
                <TableCell><Text size="xs" dimmed>{gameMode(game)}</Text></TableCell>
                <TableCell className="w-[92px] text-right">
                    {action(game, isActive)}
                </TableCell>
            </TableRow>
        );
    });
}

// ─── NameChips ──────────────────────────────────────────────────────────────
// A chip list of names with an Address Book-suggesting picker, rendered so the
// chips sit *inside* the control — matching MultiSelect, so adding a name never
// shoves the surrounding fields around.

function NameChips({ values, onChange, placeholder }) {
    const add = useCallback((name) => {
        const n = (name || '').trim();
        if (!n || values.includes(n)) return;
        onChange([...values, n]);
    }, [values, onChange]);
    const remove = useCallback((name) => onChange(values.filter(v => v !== name)), [values, onChange]);

    return (
        <div className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1">
            {values.map(v => (
                <Badge key={v} variant="secondary" className="gap-1 text-[10px]">
                    {v}
                    {/* span wrapper: Badge disables pointer events on direct svgs */}
                    <span role="button" aria-label={`Remove ${v}`} className="inline-flex cursor-pointer" onClick={() => remove(v)}>
                        <X className="size-3" />
                    </span>
                </Badge>
            ))}
            <div className="min-w-[100px] flex-1">
                <ParticipantPicker
                    value=""
                    placeholder={values.length ? 'Add…' : placeholder}
                    onResolve={(row) => add(row.display?.tag || row.identities?.rioName)}
                    onRawValue={add}
                    className="h-6! border-transparent! bg-transparent! px-1! text-xs"
                />
            </div>
        </div>
    );
}

// A single-value Address Book search field (completed-game search inputs).
function NameField({ value, onChange, placeholder }) {
    return (
        <ParticipantPicker
            value={value}
            placeholder={placeholder}
            onResolve={(row) => onChange(row.display?.tag || row.identities?.rioName || '')}
            onRawValue={onChange}
        />
    );
}

// ─── InlineGameSearch ───────────────────────────────────────────────────────
// Single-mode game picker, rendered inline (no modal). Live tab lists ongoing
// games (with an auto-refresh toggle that keeps a loaded live game current);
// Completed tab searches the API by player/opponent/mode.

const searchTabs = [
    { value: 'live', label: 'Live' },
    { value: 'completed', label: 'Completed' },
];

function InlineGameSearch({ tagOptions, onLoad, loadedGameId }) {
    const autoPoll = useSettingsStore(s => s?.ongoing_games?.auto_poll ?? false);
    const storedPollInterval = useSettingsStore(s => s?.ongoing_games?.poll_interval ?? 10);

    const [tab, setTab] = useState('live');
    const [liveGames, setLiveGames] = useState([]);
    const [loadingLive, setLoadingLive] = useState(false);
    const [completedGames, setCompletedGames] = useState([]);
    const [loadingCompleted, setLoadingCompleted] = useState(false);
    const [searched, setSearched] = useState(false);
    const [pollInterval, setPollInterval] = useState(storedPollInterval);
    const [username, setUsername] = useState('');
    const [vsUsername, setVsUsername] = useState('');
    const [tagFilter, setTagFilter] = useState(null);
    const [limit, setLimit] = useState(null);

    useEffect(() => { setPollInterval(storedPollInterval); }, [storedPollInterval]);

    const fetchLive = useCallback(async () => {
        setLoadingLive(true);
        try {
            await fetch('/api/v1/game-pool/ongoing/refresh', { method: 'POST' });
            const data = await fetch('/api/v1/game-pool/ongoing').then(r => r.json());
            setLiveGames(Array.isArray(data) ? data : []);
        } catch { setLiveGames([]); } finally { setLoadingLive(false); }
    }, []);

    const fetchCompleted = useCallback(async () => {
        setLoadingCompleted(true);
        setSearched(true);
        const params = new URLSearchParams();
        if (username.trim()) params.append('username', username.trim());
        if (vsUsername.trim()) params.append('vs_username', vsUsername.trim());
        if (tagFilter) params.append('tag', tagFilter);
        params.append('limit_games', String(limit ?? 100));
        try {
            await fetch(`/api/v1/game-pool/completed/refresh?${params}`, { method: 'POST' });
            const data = await fetch('/api/v1/game-pool/completed').then(r => r.json());
            setCompletedGames(Array.isArray(data) ? data : []);
        } catch { setCompletedGames([]); } finally { setLoadingCompleted(false); }
    }, [username, vsUsername, tagFilter, limit]);

    const toggleAutoPoll = useCallback((enabled) => {
        const params = new URLSearchParams({ enabled: String(enabled), interval: String(pollInterval || 10) });
        fetch(`/api/v1/game-pool/ongoing/auto-poll?${params}`, { method: 'POST' }).catch(() => {});
    }, [pollInterval]);

    const commitInterval = useCallback((val) => {
        const next = Math.max(5, val || 10);
        setPollInterval(next);
        if (autoPoll) toggleAutoPoll(true);
    }, [autoPoll, toggleAutoPoll]);

    useEffect(() => { fetchLive(); }, [fetchLive]);

    const isLive = tab === 'live';
    const games = isLive ? liveGames : completedGames;
    const loading = isLive ? loadingLive : loadingCompleted;

    return (
        <Stack gap="sm">
            <SegmentedControl fullWidth data={searchTabs} value={tab} onChange={setTab} />

            {isLive ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Button size="xs" variant="secondary" onClick={fetchLive} disabled={loadingLive}>
                            {loadingLive ? <Loader size={12} /> : <RotateCw size={12} />}
                            Refresh
                        </Button>
                        <Text size="xs" dimmed>{liveGames.length} live game{liveGames.length !== 1 ? 's' : ''}</Text>
                    </div>
                    <SimpleTooltip label="Keep the loaded live game's score updating automatically.">
                        <div className="flex items-center gap-1.5">
                            <Switch size="sm" checked={autoPoll} onCheckedChange={toggleAutoPoll} />
                            <Text size="xs">Auto-refresh</Text>
                            <NumberInput
                                min={5} max={120}
                                value={pollInterval}
                                onChange={commitInterval}
                                disabled={!autoPoll}
                                className="w-[58px]"
                            />
                            <Text size="xs" dimmed>s</Text>
                        </div>
                    </SimpleTooltip>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    <NameField value={username} onChange={setUsername} placeholder="Player" />
                    <NameField value={vsUsername} onChange={setVsUsername} placeholder="Opponent" />
                    <Combobox
                        placeholder="Game mode"
                        data={tagOptions}
                        value={tagFilter}
                        onChange={setTagFilter}
                        clearable
                    />
                    <div className="flex gap-2">
                        <NumberInput
                            placeholder="Limit"
                            min={1} max={500}
                            value={limit}
                            onChange={setLimit}
                            className="w-[72px]"
                        />
                        <Button size="sm" className="flex-1" onClick={fetchCompleted} disabled={loadingCompleted}>
                            {loadingCompleted ? <Loader size={12} /> : <><Search size={13} /> Search</>}
                        </Button>
                    </div>
                </div>
            )}

            <ScrollArea className="h-[300px]">
                <Table className="text-xs">
                    <TableHeader className="sticky top-0 z-[1] bg-night-900">
                        <TableRow>
                            <TableHead>Player</TableHead>
                            <TableHead className="w-[60px] text-center">Score</TableHead>
                            <TableHead>Opponent</TableHead>
                            <TableHead>Mode</TableHead>
                            <TableHead className="w-[92px]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <GameRows
                            games={games}
                            loading={loading}
                            activeId={loadedGameId}
                            emptyLabel={isLive
                                ? 'No live games right now.'
                                : (searched ? 'No games found.' : 'Search for completed games above.')}
                            action={(game, isActive) => (
                                <Button
                                    size="xs"
                                    variant={isActive ? 'outline' : 'secondary'}
                                    disabled={isActive}
                                    onClick={() => onLoad(game)}
                                >
                                    {isActive ? 'Loaded' : 'Load'}
                                </Button>
                            )}
                        />
                    </TableBody>
                </Table>
            </ScrollArea>
        </Stack>
    );
}

// ─── PoolGamesModal ─────────────────────────────────────────────────────────
// Lists the games currently matched by the rotator and lets the user exclude
// any of them — the single reason a dialog opens in Rotator mode.

function PoolGamesModal({ open, onOpenChange, members, currentIndex, excludedList, loading, onRefresh, onExclude, onUnexclude }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[88vh] w-[calc(100vw-4rem)] flex-col overflow-hidden sm:max-w-[1100px]!">
                <DialogHeader>
                    <DialogTitle>Pool games</DialogTitle>
                </DialogHeader>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <Text size="xs" dimmed>
                        Games this rotator is matching. Exclude any you don&apos;t want on screen.
                    </Text>
                    <Button size="xs" variant="secondary" onClick={onRefresh} disabled={loading}>
                        {loading ? <Loader size={12} /> : <RotateCw size={12} />}
                        Find games
                    </Button>
                </div>

                <ScrollArea className="h-[440px]">
                    <Table className="text-xs">
                        <TableHeader className="sticky top-0 z-[1] bg-night-900">
                            <TableRow>
                                <TableHead>Player</TableHead>
                                <TableHead className="w-[60px] text-center">Score</TableHead>
                                <TableHead>Opponent</TableHead>
                                <TableHead>Mode</TableHead>
                                <TableHead>Time</TableHead>
                                <TableHead className="w-[110px] pr-4 text-right">Exclude</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {members.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6}>
                                        <Text size="xs" dimmed ta="center" className="py-4">
                                            {loading ? 'Finding games…' : 'No games match this filter yet. Add a game mode or player above, then Find games.'}
                                        </Text>
                                    </TableCell>
                                </TableRow>
                            ) : members.map((game, i) => (
                                <TableRow key={game.game_id} className={cn(i === currentIndex && 'bg-[#14b8a6]/15')}>
                                    <TableCell><Text size="xs" fw={500}>{gameAway(game)}</Text></TableCell>
                                    <TableCell className="text-center">
                                        <Text size="xs" fw={600} className="tabular-nums">
                                            {gameAwayScore(game)}–{gameHomeScore(game)}
                                        </Text>
                                    </TableCell>
                                    <TableCell><Text size="xs" fw={500}>{gameHome(game)}</Text></TableCell>
                                    <TableCell><Text size="xs" dimmed>{gameMode(game)}</Text></TableCell>
                                    <TableCell><Text size="xs" dimmed>{formatTimestamp(game.date_time_end)}</Text></TableCell>
                                    <TableCell className="pr-4 text-right">
                                        <Button size="xs" variant="ghost" className="text-destructive" onClick={() => onExclude(game)}>
                                            <Ban size={12} /> Exclude
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>

                {excludedList.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                        <Text size="xs" fw={600} className="mb-1.5">Excluded ({excludedList.length})</Text>
                        <div className="flex flex-wrap gap-1.5">
                            {excludedList.map(({ id, label }) => (
                                <Badge key={id} className="gap-1 bg-[#ef4444]/15 text-[10px] text-[#f87171]">
                                    {label}
                                    <SimpleTooltip label="Put back in the pool">
                                        <span role="button" aria-label={`Re-include ${label}`} className="inline-flex cursor-pointer" onClick={() => onUnexclude(id)}>
                                            <Undo2 className="size-3" />
                                        </span>
                                    </SimpleTooltip>
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─── PoolBrowser ────────────────────────────────────────────────────────────

const playbackOptions = [
    { value: 'single', label: 'Single Game' },
    { value: 'rotate', label: 'Rotator' },
];

const scopeOptions = [
    { value: 'both', label: 'Live + Completed' },
    { value: 'live', label: 'Live Only' },
    { value: 'completed', label: 'Completed Only' },
];

const EMPTY_FILTER = { tag: [], username: [], vs_username: [], limit_games: null };

export default memo(function PoolBrowser({ scoreboardNumber: sb }) {
    const playback = useSettingsStore(s =>
        s?.scoreboards?.binding?.[sb]?.playback
        ?? s?.scoreboards?.binding?.[String(sb)]?.playback
        ?? { mode: 'single', gameId: null, interval: 30 });
    const pool = useSettingsStore(s =>
        s?.scoreboards?.binding?.[sb]?.pool
        ?? s?.scoreboards?.binding?.[String(sb)]?.pool
        ?? { filters: [], scope: 'both', excluded: [], refresh_interval: 60 });

    const mode = playback.mode ?? 'single';
    const loadedGameId = useStateStore(s => s?.score?.[sb]?.game_id ?? null);

    const [status, setStatus] = useState({ active: false });
    const [secondsRemaining, setSecondsRemaining] = useState(null);
    const [gameModeOptions, setGameModeOptions] = useState([]);
    const [poolModalOpen, setPoolModalOpen] = useState(false);
    const [finding, setFinding] = useState(false);
    // Preserve the chosen refresh cadence while the toggle is off (0 = off).
    const [refreshSecs, setRefreshSecs] = useState(() => (pool.refresh_interval > 0 ? pool.refresh_interval : 60));
    // Client-side cache of excluded game dicts so the modal can label them —
    // the backend only stores excluded ids, not their display fields.
    const [excludedCache, setExcludedCache] = useState({});

    useEffect(() => {
        fetch(`/api/v1/rotation/${sb}`).then(r => r.json()).then(setStatus).catch(() => {});
    }, [sb]);

    const handleStatus = useCallback((payload) => {
        if (payload?.scoreboard === sb) setStatus(payload);
    }, [sb]);
    useSocketSubscribe('v1.rotation.status', handleStatus);

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => setGameModeOptions(Object.keys(data).map(n => ({ value: n, label: n }))))
            .catch(() => {});
    }, []);

    useEffect(() => {
        const target = status?.next_advance_at;
        if (!status?.active || !target) { setSecondsRemaining(null); return; }
        const tick = () => setSecondsRemaining(Math.max(0, Math.round(target - Date.now() / 1000)));
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [status?.active, status?.next_advance_at]);

    // Live pool membership — mirrored by the server into
    // scoreboards.rotation.{sb}.* on Start and on Find games (see
    // server/rio/rotation.py _mirror_to_state).
    const gameIds = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.game_ids ?? []);
    const cachedGames = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.cached_games ?? []);
    const members = useMemo(() => {
        const byId = new Map(cachedGames.map(g => [g.game_id, g]));
        return gameIds.map(gid => byId.get(gid)).filter(Boolean);
    }, [gameIds, cachedGames]);

    const setMode = useCallback((newMode) => {
        fetch(`/api/v1/scoreboards/${sb}/binding?kind=${newMode}`, { method: 'PUT' }).catch(() => {});
    }, [sb]);

    const updatePool = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/pool`, patch), [sb]);
    const updatePlayback = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/playback`, patch), [sb]);

    // A single filter — a rotator never needs more than one, since each field
    // already accepts a list. Persisted as a one-element `filters` array.
    const filter = pool.filters?.[0] ?? EMPTY_FILTER;
    const updateFilter = useCallback((patch) => {
        updatePool({ filters: [{ ...(pool.filters?.[0] ?? EMPTY_FILTER), ...patch }] });
    }, [pool.filters, updatePool]);

    const setScope = useCallback((scope) => updatePool({ scope }), [updatePool]);

    const excludedIds = pool.excluded ?? [];
    const excludedList = useMemo(() => excludedIds.map(id => {
        const g = excludedCache[id] ?? excludedCache[String(id)];
        return { id, label: g ? gameLabel(g) : `#${id}` };
    }), [excludedIds, excludedCache]);

    const findGames = useCallback(async () => {
        setFinding(true);
        try { await fetch(`/api/v1/rotation/${sb}/preview`, { method: 'POST' }); }
        finally { setFinding(false); }
    }, [sb]);

    const openPoolModal = useCallback(() => {
        setPoolModalOpen(true);
        if (!status.active) findGames();
    }, [status.active, findGames]);

    const handleExclude = useCallback((game) => {
        setExcludedCache(c => ({ ...c, [game.game_id]: game }));
        postJSON(`/api/v1/rotation/${sb}/exclude`, { game_id: game.game_id });
    }, [sb]);

    const handleUnexclude = useCallback((gameId) => {
        postJSON(`/api/v1/rotation/${sb}/unexclude`, { game_id: gameId });
    }, [sb]);

    const handleLoad = useCallback((game) => {
        fetch(`/api/v1/game-pool/assign?game_id=${game.game_id}&scoreboard_number=${sb}`, { method: 'POST' }).catch(() => {});
    }, [sb]);

    const handleStart = useCallback(async () => {
        const data = await fetch(`/api/v1/rotation/${sb}/start`, { method: 'POST' }).then(r => r.json()).catch(() => null);
        if (data) setStatus(data);
    }, [sb]);

    const handleStop = useCallback(async () => {
        await fetch(`/api/v1/rotation/${sb}/stop`, { method: 'POST' }).catch(() => {});
        setStatus({ active: false });
    }, [sb]);

    const handleNext = useCallback(async () => {
        const data = await fetch(`/api/v1/rotation/${sb}/next`, { method: 'POST' }).then(r => r.json()).catch(() => null);
        if (data) setStatus(data);
    }, [sb]);

    const handlePrev = useCallback(async () => {
        const data = await fetch(`/api/v1/rotation/${sb}/prev`, { method: 'POST' }).then(r => r.json()).catch(() => null);
        if (data) setStatus(data);
    }, [sb]);

    return (
        <>
            <Panel className="p-3">
                <Stack gap="sm">
                    <div className="flex items-center justify-between gap-2">
                        <Text fw={600} size="sm">Game Pool & Playback</Text>
                        {status.active && (
                            <Badge className="bg-[#14b8a6] text-[10px] text-black">
                                {status.current_index + 1}/{status.total_games}
                                {secondsRemaining != null && ` · ${secondsRemaining}s`}
                            </Badge>
                        )}
                    </div>

                    <SegmentedControl fullWidth data={playbackOptions} value={mode} onChange={setMode} />

                    {mode === 'single' ? (
                        <InlineGameSearch
                            tagOptions={gameModeOptions}
                            onLoad={handleLoad}
                            loadedGameId={loadedGameId}
                        />
                    ) : (
                        <Stack gap="sm">
                            {/* ---- Filter ---- */}
                            <MultiSelect
                                placeholder="Game modes"
                                data={gameModeOptions}
                                value={filter.tag ?? []}
                                onChange={(val) => updateFilter({ tag: val })}
                            />
                            <NameChips
                                values={filter.username ?? []}
                                onChange={(v) => updateFilter({ username: v })}
                                placeholder="Filter by player"
                            />
                            <NameChips
                                values={filter.vs_username ?? []}
                                onChange={(v) => updateFilter({ vs_username: v })}
                                placeholder="Filter by opponent"
                            />

                            {/* ---- Scope / timing ---- */}
                            <div className="flex items-end gap-3">
                                <div className="flex flex-1 flex-col gap-1">
                                    <Label className="text-xs">Show games from</Label>
                                    <SimpleSelect data={scopeOptions} value={pool.scope ?? 'both'} onChange={setScope} />
                                </div>
                                <div className="flex w-[130px] flex-col gap-1">
                                    <Label className="text-xs">Time on each game</Label>
                                    <NumberInput
                                        min={5} max={600}
                                        value={playback.interval ?? 30}
                                        onChange={(val) => updatePlayback({ interval: val || 30 })}
                                        suffix="s"
                                    />
                                </div>
                            </div>

                            <SimpleTooltip label="Automatically pick up newly-started and finished games while rotating. Off = the pool only changes when you press Find games.">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        size="sm"
                                        checked={(pool.refresh_interval ?? 0) > 0}
                                        onCheckedChange={(on) => updatePool({ refresh_interval: on ? refreshSecs : 0 })}
                                    />
                                    <Text size="xs">Keep pool up to date, every</Text>
                                    <NumberInput
                                        min={10} max={600}
                                        value={refreshSecs}
                                        disabled={(pool.refresh_interval ?? 0) === 0}
                                        onChange={(val) => {
                                            const next = val || 10;
                                            setRefreshSecs(next);
                                            if ((pool.refresh_interval ?? 0) > 0) updatePool({ refresh_interval: next });
                                        }}
                                        className="w-[64px]"
                                        suffix="s"
                                    />
                                </div>
                            </SimpleTooltip>

                            {/* ---- Transport ---- */}
                            <div className="flex flex-wrap items-center gap-2">
                                {!status.active ? (
                                    <Button size="sm" className="bg-[#14b8a6] text-black hover:bg-[#14b8a6]/90" onClick={handleStart}>
                                        Start
                                    </Button>
                                ) : (
                                    <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={handleStop}>
                                        Stop
                                    </Button>
                                )}
                                {status.active && (
                                    <>
                                        <Button size="icon-sm" variant="secondary" onClick={handlePrev}>
                                            <ChevronLeft size={14} />
                                        </Button>
                                        <Text size="xs" className="tabular-nums">
                                            {status.current_index + 1}/{status.total_games}
                                        </Text>
                                        <Button size="icon-sm" variant="secondary" onClick={handleNext}>
                                            <ChevronRight size={14} />
                                        </Button>
                                        {secondsRemaining != null && <Text size="xs" dimmed>{secondsRemaining}s</Text>}
                                    </>
                                )}
                                <Button size="sm" variant="secondary" className="ml-auto" onClick={findGames} disabled={finding}>
                                    {finding ? <Loader size={12} /> : <Search size={13} />}
                                    Find games
                                </Button>
                                <Button size="sm" variant="ghost" onClick={openPoolModal}>
                                    Pool games
                                    {(members.length > 0 || excludedIds.length > 0) && (
                                        <Badge variant="secondary" className="ml-1 text-[10px]">
                                            {members.length}{excludedIds.length > 0 && ` · ${excludedIds.length} off`}
                                        </Badge>
                                    )}
                                </Button>
                            </div>
                        </Stack>
                    )}
                </Stack>
            </Panel>

            <PoolGamesModal
                open={poolModalOpen}
                onOpenChange={setPoolModalOpen}
                members={members}
                currentIndex={status.current_index ?? -1}
                excludedList={excludedList}
                loading={finding}
                onRefresh={findGames}
                onExclude={handleExclude}
                onUnexclude={handleUnexclude}
            />
        </>
    );
});

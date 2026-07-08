import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { ChevronLeft, ChevronRight, X, Plus, PinOff, Ban } from 'lucide-react';
import { Stack, Text, Loader } from '../ui/primitives';
import { Panel } from '../ui/panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { NumberInput } from '../ui/number-input';
import { Combobox } from '../ui/combobox';
import { MultiSelect } from '../ui/multi-select';
import { SimpleSelect } from '../ui/simple-select';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import { SimpleTooltip } from '../ui/simple-tooltip';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../ui/table';
import { cn } from '../../lib/utils';
import { useSocketSubscribe } from '../../context/socket';
import { useSettingsStore, useStateStore } from '../../context/store';
import ParticipantPicker from '../ParticipantPicker';
import { STADIUM_OPTIONS } from '../../data/stadiums';

/**
 * PoolBrowser — the unified Pool + Playback control surface for a scoreboard.
 * Replaces RotationControls, LiveGameSelector, and CompletedGameInfo with one
 * component: a "single" playback mode is just one pinned game (a "Find a
 * game" search + Load); "rotate" mode is a continuously-evaluated pool
 * (filter chips + scope + pinned/excluded) with playback controls.
 * See ~/.claude/plans/pool-playback-unification.md.
 */

const STADIUM_LABELS = Object.fromEntries(STADIUM_OPTIONS.map(o => [o.value, o.label]));
let chipIdCounter = 0;

const gameAway = (g) => g.away_user ?? g.away_player ?? g.entrants?.[0]?.[0]?.rioName ?? '';
const gameHome = (g) => g.home_user ?? g.home_player ?? g.entrants?.[1]?.[0]?.rioName ?? '';
const gameAwayScore = (g) => g.away_score ?? g.team1score ?? 0;
const gameHomeScore = (g) => g.home_score ?? g.team2score ?? 0;
const gameMode = (g) => Array.isArray(g.tags) ? g.tags.join(', ') : (g.tags ?? g.game_mode_name ?? g.game_mode ?? '');

const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return String(ts); }
};

async function postJSON(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).catch(() => {});
}

async function putJSON(url, body) {
    return fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }).catch(() => {});
}

// ─── CompletedGameCard ──────────────────────────────────────────────────────
// Summary shown once a game on this board is complete, regardless of mode.

const CompletedGameCard = memo(function CompletedGameCard({ scoreboardNumber }) {
    const gameCompleted     = useStateStore(s => s?.score?.[scoreboardNumber]?.game_completed ?? false);
    const gameId            = useStateStore(s => s?.score?.[scoreboardNumber]?.game_id);
    const stadium           = useStateStore(s => s?.score?.[scoreboardNumber]?.stadium ?? '');
    const modeStr           = useStateStore(s => s?.score?.[scoreboardNumber]?.game_mode ?? '');
    const inningsPlayed     = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_played);
    const inningsSelected   = useStateStore(s => s?.score?.[scoreboardNumber]?.innings_selected);
    const dateTimeEnd       = useStateStore(s => s?.score?.[scoreboardNumber]?.date_time_end);
    const winnerIncomingElo = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_incoming_elo);
    const winnerResultElo   = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_result_elo);
    const loserIncomingElo  = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_incoming_elo);
    const loserResultElo    = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_result_elo);
    const winnerUser        = useStateStore(s => s?.score?.[scoreboardNumber]?.winner_user ?? '');
    const loserUser         = useStateStore(s => s?.score?.[scoreboardNumber]?.loser_user ?? '');

    if (!gameCompleted) return null;

    return (
        <Panel glow={false} className="p-2" style={{ backgroundColor: 'rgba(76, 29, 149, 0.35)' }}>
            <Stack gap="xs">
                <div className="flex items-center justify-between">
                    <Text size="xs" fw={600} c="#a78bfa">Completed Game</Text>
                    {gameId && (
                        <Badge className="bg-[#a78bfa] px-1.5 text-[10px] text-[#1a1033]">#{gameId}</Badge>
                    )}
                </div>
                {(winnerUser || loserUser) && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Text size="xs" fw={600} c="#2dd4bf">{winnerUser}</Text>
                        <Text size="xs" dimmed>def.</Text>
                        <Text size="xs" fw={600} c="#ff5a5f">{loserUser}</Text>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-1">
                    {stadium && (
                        <div>
                            <Text size="xs" dimmed>Stadium</Text>
                            <Text size="xs">{STADIUM_LABELS[stadium] || stadium}</Text>
                        </div>
                    )}
                    {modeStr && (
                        <div>
                            <Text size="xs" dimmed>Mode</Text>
                            <Text size="xs">{modeStr}</Text>
                        </div>
                    )}
                    {inningsPlayed != null && (
                        <div>
                            <Text size="xs" dimmed>Innings</Text>
                            <Text size="xs">{inningsPlayed}/{inningsSelected ?? '?'}</Text>
                        </div>
                    )}
                    {dateTimeEnd && (
                        <div>
                            <Text size="xs" dimmed>Played</Text>
                            <Text size="xs">
                                {(() => {
                                    try { return new Date(dateTimeEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
                                    catch { return ''; }
                                })()}
                            </Text>
                        </div>
                    )}
                </div>
                {(winnerIncomingElo != null || loserIncomingElo != null) && (
                    <div className="flex flex-wrap gap-4">
                        {winnerIncomingElo != null && (
                            <Text size="xs">
                                <Text span dimmed>W ELO: </Text>
                                {winnerIncomingElo} → {winnerResultElo}
                                {winnerResultElo > winnerIncomingElo && (
                                    <Text span c="#2dd4bf" fw={600}> (+{winnerResultElo - winnerIncomingElo})</Text>
                                )}
                            </Text>
                        )}
                        {loserIncomingElo != null && (
                            <Text size="xs">
                                <Text span dimmed>L ELO: </Text>
                                {loserIncomingElo} → {loserResultElo}
                                {loserResultElo < loserIncomingElo && (
                                    <Text span c="#ff5a5f" fw={600}> ({loserResultElo - loserIncomingElo})</Text>
                                )}
                            </Text>
                        )}
                    </div>
                )}
            </Stack>
        </Panel>
    );
});

// ─── NameMultiInput ─────────────────────────────────────────────────────────
// A chip list of names + a ParticipantPicker "add" affordance — Address
// Book-suggested, free-text always allowed.

function NameMultiInput({ values, onChange, placeholder }) {
    const add = useCallback((name) => {
        const n = (name || '').trim();
        if (!n || values.includes(n)) return;
        onChange([...values, n]);
    }, [values, onChange]);
    const remove = useCallback((name) => onChange(values.filter(v => v !== name)), [values, onChange]);

    return (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
            {values.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {values.map(v => (
                        <Badge key={v} variant="secondary" className="gap-1 text-[10px]">
                            {v}
                            <X className="size-3 cursor-pointer" onClick={() => remove(v)} />
                        </Badge>
                    ))}
                </div>
            )}
            <ParticipantPicker
                value=""
                placeholder={placeholder}
                onResolve={(row) => add(row.display?.tag || row.identities?.rioName)}
                onRawValue={add}
                className="h-7 text-xs"
            />
        </div>
    );
}

// ─── FilterChipRow ──────────────────────────────────────────────────────────

function FilterChipRow({ chip, tagOptions, onChange, onRemove }) {
    return (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
            <div className="flex items-start gap-2">
                <MultiSelect
                    placeholder="Tags / game modes"
                    data={tagOptions}
                    value={chip.tag ?? []}
                    onChange={(val) => onChange({ ...chip, tag: val })}
                    className="flex-1"
                />
                <NumberInput
                    placeholder="Limit"
                    min={1}
                    max={500}
                    value={chip.limit_games}
                    onChange={(val) => onChange({ ...chip, limit_games: val || null })}
                    className="w-[84px]"
                />
                <SimpleTooltip label="Remove filter">
                    <Button size="icon-sm" variant="ghost" onClick={onRemove}>
                        <X size={14} />
                    </Button>
                </SimpleTooltip>
            </div>
            <div className="flex gap-2">
                <NameMultiInput
                    values={chip.username ?? []}
                    onChange={(v) => onChange({ ...chip, username: v })}
                    placeholder="Username…"
                />
                <NameMultiInput
                    values={chip.vs_username ?? []}
                    onChange={(v) => onChange({ ...chip, vs_username: v })}
                    placeholder="Vs username…"
                />
            </div>
        </div>
    );
}

// ─── FindGameModal ──────────────────────────────────────────────────────────
// The "find a game" search+pick flow — ad-hoc, independent of the pool's own
// continuous filters/scope. Used both for single-mode Load and for pinning/
// excluding a specific game by search since game IDs aren't human-readable.

function FindGameModal({ open, onOpenChange, tagOptions, actions }) {
    const [tab, setTab] = useState('live');
    const [liveGames, setLiveGames] = useState([]);
    const [loadingLive, setLoadingLive] = useState(false);
    const [completedGames, setCompletedGames] = useState([]);
    const [loadingCompleted, setLoadingCompleted] = useState(false);
    const [username, setUsername] = useState('');
    const [vsUsername, setVsUsername] = useState('');
    const [tagFilter, setTagFilter] = useState(null);
    const [limit, setLimit] = useState(null);

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

    useEffect(() => { if (open) fetchLive(); }, [open, fetchLive]);

    const rows = tab === 'live' ? liveGames : completedGames;
    const loading = tab === 'live' ? loadingLive : loadingCompleted;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] max-w-[900px] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Find a Game</DialogTitle>
                </DialogHeader>
                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList className="mb-3">
                        <TabsTrigger value="live">Live</TabsTrigger>
                        <TabsTrigger value="completed">Completed</TabsTrigger>
                    </TabsList>

                    <TabsContent value="live">
                        <Stack gap="sm">
                            <div className="flex items-center gap-2">
                                {loadingLive ? <Loader size={14} /> : (
                                    <Button size="xs" variant="secondary" onClick={fetchLive}>Refresh</Button>
                                )}
                                <Text size="xs" dimmed>{liveGames.length} live game{liveGames.length !== 1 ? 's' : ''}</Text>
                            </div>
                        </Stack>
                    </TabsContent>

                    <TabsContent value="completed">
                        <Stack gap="sm">
                            <div className="flex items-end gap-2">
                                <Input
                                    placeholder="Username"
                                    value={username}
                                    onChange={e => setUsername(e.currentTarget.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') fetchCompleted(); }}
                                    className="flex-1"
                                />
                                <Input
                                    placeholder="Vs Username"
                                    value={vsUsername}
                                    onChange={e => setVsUsername(e.currentTarget.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') fetchCompleted(); }}
                                    className="flex-1"
                                />
                                <Combobox
                                    placeholder="Game Mode"
                                    data={tagOptions}
                                    value={tagFilter}
                                    onChange={setTagFilter}
                                    clearable
                                    className="flex-1"
                                />
                                <NumberInput
                                    placeholder="Limit"
                                    min={1} max={500}
                                    value={limit}
                                    onChange={setLimit}
                                    className="w-[80px]"
                                />
                                {loadingCompleted ? <Loader size={14} /> : (
                                    <Button size="xs" onClick={fetchCompleted}>Search</Button>
                                )}
                            </div>
                        </Stack>
                    </TabsContent>
                </Tabs>

                <ScrollArea className="h-[420px]">
                    <Table className="text-xs">
                        <TableHeader className="sticky top-0 z-[1] bg-night-900">
                            <TableRow>
                                <TableHead>Away</TableHead>
                                <TableHead className="w-[64px]">Score</TableHead>
                                <TableHead>Home</TableHead>
                                <TableHead>Mode</TableHead>
                                <TableHead>Time</TableHead>
                                <TableHead className="w-[160px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6}>
                                        <Text size="xs" dimmed ta="center" className="py-4">
                                            {loading ? 'Searching…' : 'No games found.'}
                                        </Text>
                                    </TableCell>
                                </TableRow>
                            ) : rows.map(game => (
                                <TableRow key={game.game_id}>
                                    <TableCell><Text size="xs" fw={500}>{gameAway(game)}</Text></TableCell>
                                    <TableCell className="text-center">
                                        <Text size="xs" fw={600} className="tabular-nums">
                                            {gameAwayScore(game)}–{gameHomeScore(game)}
                                        </Text>
                                    </TableCell>
                                    <TableCell><Text size="xs" fw={500}>{gameHome(game)}</Text></TableCell>
                                    <TableCell><Text size="xs" dimmed>{gameMode(game)}</Text></TableCell>
                                    <TableCell><Text size="xs" dimmed>{formatTimestamp(game.date_time_end)}</Text></TableCell>
                                    <TableCell>
                                        <div className="flex flex-nowrap justify-end gap-1">
                                            {actions.map(a => (
                                                <SimpleTooltip key={a.label} label={a.label}>
                                                    <Button size="xs" variant="secondary" onClick={() => a.onClick(game)}>
                                                        {a.label}
                                                    </Button>
                                                </SimpleTooltip>
                                            ))}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
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

export default memo(function PoolBrowser({ scoreboardNumber: sb }) {
    const playback = useSettingsStore(s =>
        s?.scoreboards?.binding?.[sb]?.playback
        ?? s?.scoreboards?.binding?.[String(sb)]?.playback
        ?? { mode: 'single', gameId: null, interval: 30 });
    const pool = useSettingsStore(s =>
        s?.scoreboards?.binding?.[sb]?.pool
        ?? s?.scoreboards?.binding?.[String(sb)]?.pool
        ?? { filters: [], scope: 'both', pinned: [], excluded: [], pinned_cache: {}, refresh_interval: 60 });

    const mode = playback.mode ?? 'single';
    const isRotating = mode === 'rotate';

    const [status, setStatus] = useState({ active: false });
    const [secondsRemaining, setSecondsRemaining] = useState(null);
    const [gameModeOptions, setGameModeOptions] = useState([]);
    const [findOpen, setFindOpen] = useState(false);
    const [findMode, setFindMode] = useState('load'); // 'load' | 'pin' | 'exclude'

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
    // scoreboards.rotation.{sb}.* while a rotation is running (see
    // server/rio/rotation.py _mirror_to_state). Empty until Start is pressed.
    const gameIds = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.game_ids ?? []);
    const cachedGames = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.cached_games ?? []);
    const membersById = useMemo(() => {
        const m = new Map();
        cachedGames.forEach(g => m.set(g.game_id, g));
        return m;
    }, [cachedGames]);

    const setMode = useCallback((newMode) => {
        fetch(`/api/v1/scoreboards/${sb}/binding?kind=${newMode}`, { method: 'PUT' }).catch(() => {});
    }, [sb]);

    const updatePool = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/pool`, patch), [sb]);
    const updatePlayback = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/playback`, patch), [sb]);

    const filters = pool.filters ?? [];

    const addChip = useCallback(() => {
        updatePool({ filters: [...filters, { id: ++chipIdCounter, tag: [], username: [], vs_username: [], limit_games: null }] });
    }, [filters, updatePool]);

    const changeChip = useCallback((idx, next) => {
        const next_filters = [...filters];
        next_filters[idx] = next;
        updatePool({ filters: next_filters });
    }, [filters, updatePool]);

    const removeChip = useCallback((idx) => {
        updatePool({ filters: filters.filter((_, i) => i !== idx) });
    }, [filters, updatePool]);

    const setScope = useCallback((scope) => updatePool({ scope }), [updatePool]);

    const handlePin = useCallback((game) => {
        postJSON(`/api/v1/rotation/${sb}/pin`, { game_id: game.game_id, game });
        setFindOpen(false);
    }, [sb]);

    const handleUnpin = useCallback((gameId) => {
        postJSON(`/api/v1/rotation/${sb}/unpin`, { game_id: gameId });
    }, [sb]);

    const handleExclude = useCallback((game) => {
        postJSON(`/api/v1/rotation/${sb}/exclude`, { game_id: game.game_id });
        setFindOpen(false);
    }, [sb]);

    const handleUnexclude = useCallback((gameId) => {
        postJSON(`/api/v1/rotation/${sb}/unexclude`, { game_id: gameId });
    }, [sb]);

    const handleLoad = useCallback((game) => {
        if (mode !== 'single') setMode('single');
        fetch(`/api/v1/game-pool/assign?game_id=${game.game_id}&scoreboard_number=${sb}`, { method: 'POST' }).catch(() => {});
        setFindOpen(false);
    }, [sb, mode, setMode]);

    const handleStart = useCallback(async () => {
        if (mode !== 'rotate') setMode('rotate');
        const data = await fetch(`/api/v1/rotation/${sb}/start`, { method: 'POST' }).then(r => r.json()).catch(() => null);
        if (data) setStatus(data);
    }, [sb, mode, setMode]);

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

    const openFind = useCallback((fmode) => { setFindMode(fmode); setFindOpen(true); }, []);

    const findActions = useMemo(() => {
        if (findMode === 'pin') return [{ label: 'Pin', onClick: handlePin }];
        if (findMode === 'exclude') return [{ label: 'Exclude', onClick: handleExclude }];
        return [{ label: 'Load', onClick: handleLoad }];
    }, [findMode, handlePin, handleExclude, handleLoad]);

    const pinnedCache = pool.pinned_cache ?? {};
    const pinnedLabel = (gid) => {
        const g = membersById.get(gid) ?? pinnedCache[gid] ?? pinnedCache[String(gid)];
        return g ? `${gameAway(g)} vs ${gameHome(g)}` : `#${gid}`;
    };

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

                    <SimpleSelect data={playbackOptions} value={mode} onChange={setMode} />

                    <CompletedGameCard scoreboardNumber={sb} />

                    {mode === 'single' ? (
                        <Button size="sm" variant="secondary" onClick={() => openFind('load')}>
                            Find a Game to Load
                        </Button>
                    ) : (
                        <Stack gap="sm">
                            <div className="flex items-end gap-3">
                                <div className="flex flex-col gap-1">
                                    <Label className="text-xs">Scope</Label>
                                    <SimpleSelect data={scopeOptions} value={pool.scope ?? 'both'} onChange={setScope} triggerClassName="w-[170px]" />
                                </div>
                                <div className="flex w-[95px] flex-col gap-1">
                                    <Label className="text-xs">Interval (sec)</Label>
                                    <NumberInput
                                        min={5} max={600}
                                        value={playback.interval ?? 30}
                                        onChange={(val) => updatePlayback({ interval: val || 30 })}
                                    />
                                </div>
                                <div className="flex w-[110px] flex-col gap-1">
                                    <Label className="text-xs">Poll (sec, 0=off)</Label>
                                    <NumberInput
                                        min={0} max={600}
                                        value={pool.refresh_interval ?? 0}
                                        onChange={(val) => updatePool({ refresh_interval: val ?? 0 })}
                                    />
                                </div>
                            </div>

                            <Stack gap="xs">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">Filters (OR'd together)</Label>
                                    <Button size="xs" variant="ghost" onClick={addChip}>
                                        <Plus size={12} /> Add Filter
                                    </Button>
                                </div>
                                {filters.length === 0 ? (
                                    <Text size="xs" dimmed>No filters — pin specific games below, or add a filter to auto-track a game mode.</Text>
                                ) : filters.map((chip, idx) => (
                                    <FilterChipRow
                                        key={chip.id ?? idx}
                                        chip={chip}
                                        tagOptions={gameModeOptions}
                                        onChange={(next) => changeChip(idx, next)}
                                        onRemove={() => removeChip(idx)}
                                    />
                                ))}
                            </Stack>

                            <Stack gap="xs">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">Pinned / Excluded</Label>
                                    <div className="flex gap-1">
                                        <Button size="xs" variant="ghost" onClick={() => openFind('pin')}>Find to Pin</Button>
                                        <Button size="xs" variant="ghost" onClick={() => openFind('exclude')}>Find to Exclude</Button>
                                    </div>
                                </div>
                                {(pool.pinned ?? []).length === 0 && (pool.excluded ?? []).length === 0 ? (
                                    <Text size="xs" dimmed>No pinned or excluded games.</Text>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {(pool.pinned ?? []).map(gid => (
                                            <Badge key={`p${gid}`} className="gap-1 bg-[#14b8a6]/20 text-[10px] text-[#5eead4]">
                                                {pinnedLabel(gid)}
                                                <PinOff className="size-3 cursor-pointer" onClick={() => handleUnpin(gid)} />
                                            </Badge>
                                        ))}
                                        {(pool.excluded ?? []).map(gid => (
                                            <Badge key={`x${gid}`} className="gap-1 bg-[#ef4444]/15 text-[10px] text-[#f87171]">
                                                #{gid}
                                                <Ban className="size-3 cursor-pointer" onClick={() => handleUnexclude(gid)} />
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </Stack>

                            <div className="flex items-center gap-2">
                                {!status.active ? (
                                    <Button size="xs" className="bg-[#14b8a6] text-black hover:bg-[#14b8a6]/90" onClick={handleStart}>
                                        Start
                                    </Button>
                                ) : (
                                    <Button size="xs" variant="outline" className="border-destructive/40 text-destructive" onClick={handleStop}>
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
                            </div>

                            {gameIds.length > 0 && (
                                <ScrollArea className="h-[220px]">
                                    <Table className="text-xs">
                                        <TableHeader className="sticky top-0 z-[1] bg-night-900">
                                            <TableRow>
                                                <TableHead>Away</TableHead>
                                                <TableHead className="w-[56px]">Score</TableHead>
                                                <TableHead>Home</TableHead>
                                                <TableHead className="w-[60px]" />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {gameIds.map((gid, i) => {
                                                const g = membersById.get(gid);
                                                if (!g) return null;
                                                const isCurrent = i === status.current_index;
                                                return (
                                                    <TableRow key={gid} className={cn(isCurrent && 'bg-[#14b8a6]/15')}>
                                                        <TableCell><Text size="xs" fw={500}>{gameAway(g)}</Text></TableCell>
                                                        <TableCell className="text-center">
                                                            <Text size="xs" className="tabular-nums">{gameAwayScore(g)}–{gameHomeScore(g)}</Text>
                                                        </TableCell>
                                                        <TableCell><Text size="xs" fw={500}>{gameHome(g)}</Text></TableCell>
                                                        <TableCell>
                                                            <SimpleTooltip label="Exclude">
                                                                <Button size="icon-sm" variant="ghost" onClick={() => handleExclude(g)}>
                                                                    <Ban size={12} />
                                                                </Button>
                                                            </SimpleTooltip>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                            )}
                        </Stack>
                    )}
                </Stack>
            </Panel>

            <FindGameModal
                open={findOpen}
                onOpenChange={setFindOpen}
                tagOptions={gameModeOptions}
                actions={findActions}
            />
        </>
    );
});

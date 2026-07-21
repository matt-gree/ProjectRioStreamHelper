import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { ChevronLeft, ChevronRight, X, Ban, RotateCw, Undo2, Search, CalendarDays } from 'lucide-react';
import { Stack, Text, Loader } from '../ui/primitives';
import { Panel } from '../ui/panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { NumberInput } from '../ui/number-input';
import { MultiSelect } from '../ui/multi-select';
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

// ─── useAutoRefresh ───────────────────────────────────────────────────────────
// Counts down to the next auto re-fetch and fires `onRefresh` at zero, returning
// the seconds remaining so the caller can render a live countdown. `active`
// gates the timer (e.g. only the visible tab); bumping `resetKey` restarts it
// (e.g. after a manual refresh). `onRefresh` is read through a ref so a changing
// callback identity doesn't restart the countdown.

function useAutoRefresh(active, intervalSecs, onRefresh, resetKey = 0) {
    const [remaining, setRemaining] = useState(intervalSecs);
    const onRefreshRef = useRef(onRefresh);
    onRefreshRef.current = onRefresh;
    useEffect(() => {
        if (!active || !intervalSecs) { setRemaining(intervalSecs); return; }
        let next = Date.now() + intervalSecs * 1000;
        setRemaining(intervalSecs);
        const id = setInterval(() => {
            const rem = Math.round((next - Date.now()) / 1000);
            if (rem <= 0) {
                onRefreshRef.current?.();
                next = Date.now() + intervalSecs * 1000;
                setRemaining(intervalSecs);
            } else {
                setRemaining(rem);
            }
        }, 250);
        return () => clearInterval(id);
    }, [active, intervalSecs, resetKey]);
    return remaining;
}

function RefreshCountdown({ seconds, intervalSecs }) {
    return (
        <SimpleTooltip label={`This list re-fetches from the Project Rio API every ${intervalSecs}s.`}>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                <RotateCw size={11} />
                Refreshing in {seconds}s
            </span>
        </SimpleTooltip>
    );
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

// ─── Date + refine fields ────────────────────────────────────────────────────
// The Rio API dates completed games in Unix *seconds* (RioWeb._process_games
// parses with unit="s"), so the chip stores seconds. A start date anchors to
// local midnight; an end date anchors to the last second of that day, so a
// single day picked as both bounds includes the whole day and round-trips back
// to the same calendar date in the picker.

const toDateInputValue = (unix) => {
    if (unix == null) return '';
    const d = new Date(unix * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function DateField({ value, onChange, kind = 'start' }) {
    const commit = (v) => {
        if (!v) { onChange(null); return; }
        const [y, m, d] = v.split('-').map(Number);
        const dt = kind === 'end'
            ? new Date(y, m - 1, d, 23, 59, 59)
            : new Date(y, m - 1, d, 0, 0, 0);
        onChange(Math.floor(dt.getTime() / 1000));
    };
    return (
        <input
            type="date"
            value={toDateInputValue(value)}
            onChange={(e) => commit(e.target.value)}
            className="h-8 w-[138px] rounded-md border border-input bg-transparent px-2 text-xs text-foreground [color-scheme:dark]"
        />
    );
}

// A labelled stack for the compact refine row (dates + limit).
function Field({ label, children }) {
    return (
        <div className="flex flex-col gap-1">
            <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</Label>
            {children}
        </div>
    );
}

// ─── CompletedFilters ─────────────────────────────────────────────────────────
// The completed-game filter surface, shared verbatim by the Single-mode
// Completed search and the Rotator so the two read identically. `value` is a
// filter dict ({tag, username, vs_username, start_time, end_time, limit_games});
// `onChange(patch)` merges a partial. Fields combine the way the Rio API does:
// values within one field OR together, different fields AND. `showRefine=false`
// hides the completed-only date/limit row (e.g. a live-only rotator scope).

function CompletedFilters({ value, onChange, tagOptions, showRefine = true, trailing = null }) {
    const v = value ?? {};
    // The date range is opt-in: an always-visible empty date picker reads like
    // an active filter. Collapsed by default; revealed on demand, or already
    // open when a persisted filter carries dates.
    const [dateOpen, setDateOpen] = useState(() => v.start_time != null || v.end_time != null);
    const closeDates = () => {
        setDateOpen(false);
        onChange({ start_time: null, end_time: null });
    };
    return (
        <Stack gap="sm">
            <MultiSelect
                placeholder="Game modes"
                data={tagOptions}
                value={v.tag ?? []}
                onChange={(val) => onChange({ tag: val })}
            />
            <NameChips
                values={v.username ?? []}
                onChange={(val) => onChange({ username: val })}
                placeholder="Filter by player"
            />
            <NameChips
                values={v.vs_username ?? []}
                onChange={(val) => onChange({ vs_username: val })}
                placeholder="Filter by opponent"
            />
            {showRefine && (
                <div className="flex flex-wrap items-end gap-3">
                    <Field label="Limit">
                        <NumberInput
                            placeholder="All"
                            min={1} max={500}
                            value={v.limit_games ?? null}
                            onChange={(val) => onChange({ limit_games: val || null })}
                            className="w-[76px]"
                        />
                    </Field>
                    {dateOpen ? (
                        <>
                            <Field label="From">
                                <DateField value={v.start_time} kind="start" onChange={(t) => onChange({ start_time: t })} />
                            </Field>
                            <Field label="To">
                                <DateField value={v.end_time} kind="end" onChange={(t) => onChange({ end_time: t })} />
                            </Field>
                            <button
                                type="button"
                                onClick={closeDates}
                                className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
                            >
                                <X className="size-3.5" /> Clear dates
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setDateOpen(true)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-xs text-muted-foreground hover:text-foreground hover:border-ring"
                        >
                            <CalendarDays className="size-3.5" /> Date range
                        </button>
                    )}
                    {trailing}
                </div>
            )}
        </Stack>
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
    const pollInterval = useSettingsStore(s => s?.ongoing_games?.poll_interval ?? 10);
    const [tab, setTab] = useState('live');
    const [liveGames, setLiveGames] = useState([]);
    const [loadingLive, setLoadingLive] = useState(false);
    const [completedGames, setCompletedGames] = useState([]);
    const [loadingCompleted, setLoadingCompleted] = useState(false);
    const [searched, setSearched] = useState(false);
    const [completedError, setCompletedError] = useState(null);
    // One filter dict, same shape the Rotator persists, so the search surface
    // below can be the shared CompletedFilters component.
    const [filters, setFilters] = useState({});
    const patchFilters = useCallback((patch) => setFilters(f => ({ ...f, ...patch })), []);
    // Bumped on a manual refresh to restart that tab's auto-refresh countdown.
    const [liveResetKey, setLiveResetKey] = useState(0);
    const [completedResetKey, setCompletedResetKey] = useState(0);

    const fetchLive = useCallback(async () => {
        setLoadingLive(true);
        try {
            await fetch('/api/v1/game-pool/ongoing/refresh', { method: 'POST' });
            const data = await fetch('/api/v1/game-pool/ongoing').then(r => r.json());
            setLiveGames(Array.isArray(data) ? data : []);
        } catch { setLiveGames([]); } finally { setLoadingLive(false); }
    }, []);

    // Run a completed search from an explicit query string. Split out from the
    // filter-reading path so the auto-refresh can replay the *last executed*
    // query (kept in lastQueryRef) rather than whatever's been typed since —
    // editing filters shouldn't silently re-query until Find games is pressed.
    const lastQueryRef = useRef(null);
    const runCompleted = useCallback(async (queryStr) => {
        setLoadingCompleted(true);
        setSearched(true);
        setCompletedError(null);
        try {
            const resp = await fetch(`/api/v1/game-pool/completed/refresh?${queryStr}`, { method: 'POST' }).then(r => r.json());
            if (resp && resp.success === false) {
                setCompletedError(resp?.diagnostics?.error || 'Search failed. Check your Rio API key and connection.');
                setCompletedGames([]);
                return;
            }
            const data = await fetch('/api/v1/game-pool/completed').then(r => r.json());
            setCompletedGames(Array.isArray(data) ? data : []);
        } catch {
            setCompletedError('Search failed. Check your connection and try again.');
            setCompletedGames([]);
        } finally { setLoadingCompleted(false); }
    }, []);

    const buildCompletedQuery = useCallback(() => {
        const params = new URLSearchParams();
        (filters.tag ?? []).forEach(t => params.append('tag', t));
        (filters.username ?? []).forEach(u => params.append('username', u));
        (filters.vs_username ?? []).forEach(u => params.append('vs_username', u));
        if (filters.start_time != null) params.append('start_time', String(filters.start_time));
        if (filters.end_time != null) params.append('end_time', String(filters.end_time));
        params.append('limit_games', String(filters.limit_games ?? 100));
        return params.toString();
    }, [filters]);

    const fetchCompleted = useCallback(() => {
        const q = buildCompletedQuery();
        lastQueryRef.current = q;
        return runCompleted(q);
    }, [buildCompletedQuery, runCompleted]);

    // Auto-refresh replays the last executed query (no-op until first search).
    const refetchCompleted = useCallback(() => {
        if (lastQueryRef.current != null) return runCompleted(lastQueryRef.current);
    }, [runCompleted]);

    // Manual refresh handlers restart the corresponding countdown.
    const manualFetchLive = useCallback(() => { setLiveResetKey(k => k + 1); fetchLive(); }, [fetchLive]);
    const manualFetchCompleted = useCallback(() => { setCompletedResetKey(k => k + 1); fetchCompleted(); }, [fetchCompleted]);

    useEffect(() => { fetchLive(); }, [fetchLive]);

    const isLive = tab === 'live';
    const games = isLive ? liveGames : completedGames;
    const loading = isLive ? loadingLive : loadingCompleted;

    // Each tab re-fetches its list from the API on the live poll cadence while
    // it's the visible tab; completed only once a search has been run.
    const liveCountdown = useAutoRefresh(isLive, pollInterval, fetchLive, liveResetKey);
    const completedCountdown = useAutoRefresh(!isLive && searched, pollInterval, refetchCompleted, completedResetKey);

    return (
        <Stack gap="sm">
            <SegmentedControl fullWidth size="xs" data={searchTabs} value={tab} onChange={setTab} />

            {isLive ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Button size="xs" variant="secondary" onClick={manualFetchLive} disabled={loadingLive}>
                            {loadingLive ? <Loader size={12} /> : <RotateCw size={12} />}
                            Refresh
                        </Button>
                        <Text size="xs" dimmed>{liveGames.length} live game{liveGames.length !== 1 ? 's' : ''}</Text>
                    </div>
                    <RefreshCountdown seconds={liveCountdown} intervalSecs={pollInterval} />
                </div>
            ) : (
                <Stack gap="sm">
                    <CompletedFilters
                        value={filters}
                        onChange={patchFilters}
                        tagOptions={tagOptions}
                        trailing={
                            <Button size="xs" variant="secondary" onClick={manualFetchCompleted} disabled={loadingCompleted}>
                                {loadingCompleted ? <Loader size={12} /> : <Search size={13} />}
                                Find games
                            </Button>
                        }
                    />
                    {searched && (
                        <div className="flex items-center justify-between gap-2">
                            <Text size="xs" dimmed>
                                {completedGames.length} result{completedGames.length !== 1 ? 's' : ''}
                            </Text>
                            <RefreshCountdown seconds={completedCountdown} intervalSecs={pollInterval} />
                        </div>
                    )}
                </Stack>
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
                                : (completedError || (searched ? 'No games found.' : 'Search for completed games above.'))}
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

const EMPTY_FILTER = { tag: [], username: [], vs_username: [], limit_games: null, start_time: null, end_time: null };

// Stable fallback references for the store selectors below. Zustand v5's
// `useStore` uses the RAW `useSyncExternalStore` (no built-in selector
// memoization), so a selector that mints a fresh object/array on each call —
// e.g. an inline `?? { ... }` — makes getSnapshot return a new reference every
// time React reads it. React then loops ("The result of getSnapshot should be
// cached to avoid an infinite loop" → "Maximum update depth exceeded", thrown
// from the deepest setState in the subtree, which happens to be Radix
// SelectItemText's ref callback). This bites right after a board is added or
// removed: `scoreboards.active` and `scoreboards.binding.{id}` broadcast as two
// separate settings updates, so there's a render window where the new board's
// tab is mounted but its binding hasn't arrived — the fallback branch fires.
// Hoisting the fallbacks to module scope keeps getSnapshot cacheable in that
// window (same reference every call) until the real binding lands.
const DEFAULT_PLAYBACK = { mode: 'single', gameId: null, interval: 30 };
const DEFAULT_POOL = { filters: [], scope: 'both', excluded: [], refresh_interval: 60 };
const EMPTY_LIST = [];

export default memo(function PoolBrowser({ scoreboardNumber: sb }) {
    const playback = useSettingsStore(s =>
        s?.scoreboards?.binding?.[sb]?.playback
        ?? s?.scoreboards?.binding?.[String(sb)]?.playback
        ?? DEFAULT_PLAYBACK);
    const pool = useSettingsStore(s =>
        s?.scoreboards?.binding?.[sb]?.pool
        ?? s?.scoreboards?.binding?.[String(sb)]?.pool
        ?? DEFAULT_POOL);

    // `mode` is server-backed (settings round-trip), so a click has to wait for
    // the PUT to echo back before the control moves — which reads as a "locked"
    // segmented while the server is busy fetching. Echo the click locally and
    // reconcile once the persisted value catches up.
    const serverMode = playback.mode ?? 'single';
    const [modeOverride, setModeOverride] = useState(null);
    const mode = modeOverride ?? serverMode;
    useEffect(() => {
        if (modeOverride && serverMode === modeOverride) setModeOverride(null);
    }, [serverMode, modeOverride]);
    const loadedGameId = useStateStore(s => s?.score?.[sb]?.game_id ?? null);

    const [status, setStatus] = useState({ active: false });
    const [secondsRemaining, setSecondsRemaining] = useState(null);
    const [gameModeOptions, setGameModeOptions] = useState([]);
    const [poolModalOpen, setPoolModalOpen] = useState(false);
    const [finding, setFinding] = useState(false);
    // Transient "couldn't reach the pool" error from the last Find — the only
    // status the live `members` count can't express on its own.
    const [searchError, setSearchError] = useState(null);
    // The filter/scope has been edited since the last Find, so the pool below is
    // stale. Only meaningful while stopped — a running rotation recomputes on
    // every pool edit, so we never mark it dirty then (and clear on Start).
    const [dirty, setDirty] = useState(false);
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
    const gameIds = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.game_ids ?? EMPTY_LIST);
    const cachedGames = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.cached_games ?? EMPTY_LIST);
    const members = useMemo(() => {
        const byId = new Map(cachedGames.map(g => [g.game_id, g]));
        return gameIds.map(gid => byId.get(gid)).filter(Boolean);
    }, [gameIds, cachedGames]);

    const setMode = useCallback((newMode) => {
        setModeOverride(newMode);
        fetch(`/api/v1/scoreboards/${sb}/binding?kind=${newMode}`, { method: 'PUT' }).catch(() => {});
    }, [sb]);

    const updatePool = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/pool`, patch), [sb]);
    const updatePlayback = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/playback`, patch), [sb]);

    // A single filter — a rotator never needs more than one, since each field
    // already accepts a list. Persisted as a one-element `filters` array.
    const filter = pool.filters?.[0] ?? EMPTY_FILTER;
    const updateFilter = useCallback((patch) => {
        if (!status.active) setDirty(true);
        updatePool({ filters: [{ ...(pool.filters?.[0] ?? EMPTY_FILTER), ...patch }] });
    }, [pool.filters, updatePool, status.active]);

    const setScope = useCallback((scope) => {
        if (!status.active) setDirty(true);
        updatePool({ scope });
    }, [updatePool, status.active]);

    const excludedIds = useMemo(() => pool.excluded ?? [], [pool.excluded]);
    const excludedList = useMemo(() => excludedIds.map(id => {
        const g = excludedCache[id] ?? excludedCache[String(id)];
        return { id, label: g ? gameLabel(g) : `#${id}` };
    }), [excludedIds, excludedCache]);

    const filterIsEmpty = !(filter.tag?.length || filter.username?.length || filter.vs_username?.length);

    const findGames = useCallback(async () => {
        setFinding(true);
        setSearchError(null);
        try {
            const data = await fetch(`/api/v1/rotation/${sb}/preview`, { method: 'POST' })
                .then(r => r.json())
                .catch(() => null);
            // The live pool count comes from `members` (mirrored into state by
            // preview), so the status strip reflects the result on its own. The
            // only thing we can't derive there is a failed request.
            if (data == null) {
                setSearchError('Could not reach the game pool. Check your Rio API key and connection.');
            } else {
                setDirty(false);
            }
        } finally { setFinding(false); }
    }, [sb]);

    // A running rotation recomputes its pool on every edit, so it's never stale.
    useEffect(() => { if (status.active) setDirty(false); }, [status.active]);

    // The filter changed since the last Find and we're stopped, so the pool
    // below no longer reflects the controls.
    const showDirty = dirty && !status.active;

    // Persistent, non-floating pool status shown in the transport inset.
    const poolStatus = useMemo(() => {
        if (finding) return { dot: 'bg-muted-foreground', text: 'Finding games…', cls: 'text-muted-foreground' };
        if (searchError) return { dot: 'bg-destructive', text: searchError, cls: 'text-destructive' };
        if (showDirty) return { dot: 'bg-amber-400', text: 'Filters changed — Find games to refresh the pool', cls: 'text-amber-400' };
        const n = members.length;
        if (n > 0) return { dot: 'bg-[#14b8a6]', text: `${n} game${n === 1 ? '' : 's'} in the pool`, cls: 'text-foreground' };
        if (filterIsEmpty) return { dot: 'bg-muted-foreground', text: 'Add a game mode, player, or opponent to match games', cls: 'text-muted-foreground' };
        return { dot: 'bg-muted-foreground', text: 'No games match yet — press Find games', cls: 'text-muted-foreground' };
    }, [finding, searchError, showDirty, members.length, filterIsEmpty]);

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
                            status.total_games > 0 ? (
                                <Badge className="bg-[#14b8a6] text-[10px] text-black">
                                    {status.current_index + 1}/{status.total_games}
                                    {secondsRemaining != null && ` · ${secondsRemaining}s`}
                                </Badge>
                            ) : (
                                <Badge variant="secondary" className="text-[10px]">No games in pool</Badge>
                            )
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
                            {/* Source scope — subordinate segmented, mirrors the
                                Single-mode Live/Completed selector for a consistent
                                mode → source rhythm across both playback modes. */}
                            <SegmentedControl
                                fullWidth size="xs"
                                data={scopeOptions}
                                value={pool.scope ?? 'both'}
                                onChange={setScope}
                            />

                            {/* Filters — the same surface as the Single-mode
                                Completed search. Date/limit are completed-only,
                                so they're hidden when the scope is live-only. */}
                            <CompletedFilters
                                value={filter}
                                onChange={updateFilter}
                                tagOptions={gameModeOptions}
                                showRefine={(pool.scope ?? 'both') !== 'live'}
                            />

                            {/* Timing */}
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                                <div className="flex items-center gap-2">
                                    <Label className="whitespace-nowrap text-xs">Seconds per game</Label>
                                    <NumberInput
                                        min={5} max={600}
                                        value={playback.interval ?? 30}
                                        onChange={(val) => updatePlayback({ interval: val || 30 })}
                                        className="w-[72px]"
                                        suffix="s"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        size="sm"
                                        checked={(pool.refresh_interval ?? 0) > 0}
                                        onCheckedChange={(on) => updatePool({ refresh_interval: on ? refreshSecs : 0 })}
                                    />
                                    <SimpleTooltip label="Automatically pick up newly-started and finished games while rotating. Off = the pool only changes when you press Find games.">
                                        <Label className="whitespace-nowrap text-xs">Keep pool current</Label>
                                    </SimpleTooltip>
                                    <NumberInput
                                        min={10} max={600}
                                        value={refreshSecs}
                                        disabled={(pool.refresh_interval ?? 0) === 0}
                                        onChange={(val) => {
                                            const next = val || 10;
                                            setRefreshSecs(next);
                                            if ((pool.refresh_interval ?? 0) > 0) updatePool({ refresh_interval: next });
                                        }}
                                        className="w-[72px]"
                                        suffix="s"
                                    />
                                </div>
                            </div>

                            {/* Pool status + transport — one contained inset so
                                the status never reads as floating text. The pool
                                actions sit left, the transport right on the same
                                row; the status reads beneath the two. */}
                            <div className="space-y-2.5 rounded-md border border-border bg-muted/30 p-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                    <div className="flex items-center gap-1.5">
                                        <Button
                                            size="xs" variant="secondary"
                                            className={cn(showDirty && 'ring-1 ring-amber-400')}
                                            onClick={findGames} disabled={finding}
                                        >
                                            {finding ? <Loader size={12} /> : <Search size={13} />}
                                            Find games
                                        </Button>
                                        <Button size="xs" variant="outline" onClick={openPoolModal}>
                                            Pool games
                                            {(members.length > 0 || excludedIds.length > 0) && (
                                                <Badge variant="secondary" className="ml-1 text-[10px]">
                                                    {members.length}{excludedIds.length > 0 && ` · ${excludedIds.length} off`}
                                                </Badge>
                                            )}
                                        </Button>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {!status.active ? (
                                            <Button size="sm" className="bg-[#14b8a6] text-black hover:bg-[#14b8a6]/90" onClick={handleStart}>
                                                Start rotating
                                            </Button>
                                        ) : (
                                            <>
                                                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={handleStop}>
                                                    Stop
                                                </Button>
                                                {status.total_games > 0 && (
                                                    <div className="flex items-center gap-1.5">
                                                        <Button size="icon-sm" variant="secondary" onClick={handlePrev}>
                                                            <ChevronLeft size={14} />
                                                        </Button>
                                                        <Text size="xs" className="tabular-nums">
                                                            {status.current_index + 1}/{status.total_games}
                                                        </Text>
                                                        <Button size="icon-sm" variant="secondary" onClick={handleNext}>
                                                            <ChevronRight size={14} />
                                                        </Button>
                                                        {secondsRemaining != null && (
                                                            <Text size="xs" dimmed className="tabular-nums">{secondsRemaining}s</Text>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex min-w-0 items-center gap-2">
                                    <span className={cn('size-1.5 shrink-0 rounded-full', poolStatus.dot)} />
                                    <Text size="xs" className={cn('truncate', poolStatus.cls)}>{poolStatus.text}</Text>
                                </div>
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

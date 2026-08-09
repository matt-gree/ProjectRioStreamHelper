import { useState, useCallback, useEffect, useMemo, useRef, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    ChevronLeft, ChevronRight, X, Ban, RotateCw, Undo2, Search, CalendarDays, Play, Square,
} from 'lucide-react';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { NumberInput } from '../../components/ui/number-input';
import { MultiSelect } from '../../components/ui/multi-select';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Label } from '../../components/ui/label';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../components/ui/dialog';
import { ScrollArea } from '../../components/ui/scroll-area';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import { useSocketSubscribe } from '../../context/socket';
import { useSettingsStore, useStateStore } from '../../context/store';
import { stageOrRun } from '../../context/staging';
import ParticipantPicker from '../../components/ParticipantPicker';
import {
    ActionRow, FieldRow, NumberRow, SegmentedRow, ToggleRow,
} from './kit';

/*
 * Games — where a board's games come from, and how it plays them.
 *
 * SPLIT BY TEMPO, which is the same split the rack takes from the Add picker.
 * What a producer watches and nudges during a show lives on the board's stage
 * panel (`GamesSection` below): the playback mode, the seconds per game, the
 * transport, and how many games are in the pool. What they sit down and BROWSE
 * — a table of live and completed games, a filter with three chip fields and a
 * date range — opens as a dialog, because it is a searching task with a result
 * you act on once.
 *
 * This replaces `PoolBrowser`, which was 933 lines holding both tempos in one
 * always-open panel on the Match tab: mode, scope, three filter fields, dates,
 * a limit, two timing controls, the transport, a 300px results table and a
 * second modal for the pool. Nothing about the model changed — the same
 * endpoints, the same one-element `filters` array, the same server-mirrored
 * pool. What changed is that a board's games are now authored on the board,
 * which is what let the tab go.
 *
 * THE TWO AXES STAY TWO THINGS (see ../boards): transport (HUD vs API) is
 * DERIVED and has no picker; playback (single vs rotating) is CHOSEN and is the
 * only thing this surface sets. A HUD board has no pool at all — its game is
 * whatever Project Rio is playing — so it gets the readout and nothing else.
 */

// ─── game shape helpers ─────────────────────────────────────────────────────
// Live (ongoing) and completed games come back from different Rio endpoints with
// different field names for the same four facts, and a start.gg-shaped entrant
// list turns up in a third. One accessor each, so no table row has to know.

const gameAway = (g) => g.away_user ?? g.away_player ?? g.entrants?.[0]?.[0]?.rioName ?? '';
const gameHome = (g) => g.home_user ?? g.home_player ?? g.entrants?.[1]?.[0]?.rioName ?? '';
const gameAwayScore = (g) => g.away_score ?? g.team1score ?? 0;
const gameHomeScore = (g) => g.home_score ?? g.team2score ?? 0;
const gameMode = (g) => (Array.isArray(g.tags) ? g.tags.join(', ') : (g.tags ?? g.game_mode_name ?? g.game_mode ?? ''));
const gameLabel = (g) => `${gameAway(g) || '?'} vs ${gameHome(g) || '?'}`;

const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
    } catch { return String(ts); }
};

/*
 * Stable fallback references for the store selectors below. Zustand v5's
 * `useStore` uses the RAW `useSyncExternalStore` (no selector memoization), so a
 * selector that mints a fresh object each call makes getSnapshot return a new
 * reference every read and React loops ("The result of getSnapshot should be
 * cached…" → "Maximum update depth exceeded"). This bites right after a board is
 * added: `scoreboards.active` and `scoreboards.binding.{id}` broadcast as two
 * separate settings updates, so there is a render window where the board exists
 * and its binding has not arrived.
 */
const DEFAULT_POOL = { filters: [], scope: 'both', excluded: [], refresh_interval: 60 };
const EMPTY_LIST = [];

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

/*
 * Counts down to the next auto re-fetch and fires `onRefresh` at zero, returning
 * the seconds remaining so the caller can render a live countdown. `active`
 * gates the timer (e.g. only the visible tab); bumping `resetKey` restarts it
 * (e.g. after a manual refresh). `onRefresh` is read through a ref so a changing
 * callback identity doesn't restart the countdown.
 */
function useAutoRefresh(active, intervalSecs, onRefresh, resetKey = 0) {
    const [remaining, setRemaining] = useState(intervalSecs);
    const onRefreshRef = useRef(onRefresh);
    onRefreshRef.current = onRefresh;
    useEffect(() => {
        if (!active || !intervalSecs) { setRemaining(intervalSecs); return undefined; }
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

// A game table body, shared by the single-game search and the pool list.
function GameRows({ games, loading, emptyLabel, action, activeId, columns = 5, extraCell }) {
    if (games.length === 0) {
        return (
            <TableRow>
                <TableCell colSpan={columns}>
                    <Text size="xs" dimmed ta="center" className="py-4">
                        {loading ? 'Searching…' : emptyLabel}
                    </Text>
                </TableCell>
            </TableRow>
        );
    }
    return games.map((game, i) => {
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
                {extraCell?.(game, i)}
                <TableCell className="w-[92px] text-right">{action(game, isActive, i)}</TableCell>
            </TableRow>
        );
    });
}

/*
 * A chip list of names with an Address Book-suggesting picker, rendered so the
 * chips sit *inside* the control — matching MultiSelect, so adding a name never
 * shoves the surrounding fields around.
 */
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

/*
 * The Rio API dates completed games in Unix *seconds* (RioWeb._process_games
 * parses with unit="s"), so the chip stores seconds. A start date anchors to
 * local midnight; an end date anchors to the last second of that day, so a
 * single day picked as both bounds includes the whole day and round-trips back
 * to the same calendar date in the picker.
 */
const toDateInputValue = (unix) => {
    if (unix == null) return '';
    const d = new Date(unix * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function DateField({ value, onChange, kind = 'start', label }) {
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
            aria-label={label}
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

/*
 * The completed-game filter surface, shared by the single-game Completed search
 * and the rotating pool so the two read identically. `value` is a filter dict
 * ({tag, username, vs_username, start_time, end_time, limit_games});
 * `onChange(patch)` merges a partial. Fields combine the way the Rio API does:
 * values within one field OR together, different fields AND. `showRefine=false`
 * hides the completed-only date/limit row (e.g. a live-only pool scope).
 */
function GameFilters({ value, onChange, tagOptions, showRefine = true, trailing = null }) {
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
                                <DateField label="From" value={v.start_time} kind="start" onChange={(t) => onChange({ start_time: t })} />
                            </Field>
                            <Field label="To">
                                <DateField label="To" value={v.end_time} kind="end" onChange={(t) => onChange({ end_time: t })} />
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

// ─── the dialog: single-game search ─────────────────────────────────────────

const searchTabs = [
    { value: 'live', label: 'Live' },
    { value: 'completed', label: 'Completed' },
];

/*
 * Find one game and put it on the board. Live lists ongoing games; Completed
 * searches the API by player / opponent / mode.
 *
 * Loading goes through the staging gateway — it is the one thing here that
 * changes what is on air, and a producer running confirm mode should get to
 * choose when the board changes under them. Searching, refreshing and switching
 * tabs are reads and fire immediately.
 */
const SingleGameFinder = memo(function SingleGameFinder({ sb, tagOptions, onLoaded }) {
    const pollInterval = useSettingsStore(s => s?.ongoing_games?.poll_interval ?? 10);
    const loadedGameId = useStateStore(s => s?.score?.[sb]?.game_id ?? null);
    const [tab, setTab] = useState('live');
    const [liveGames, setLiveGames] = useState([]);
    const [loadingLive, setLoadingLive] = useState(false);
    const [completedGames, setCompletedGames] = useState([]);
    const [loadingCompleted, setLoadingCompleted] = useState(false);
    const [searched, setSearched] = useState(false);
    const [completedError, setCompletedError] = useState(null);
    // One filter dict, the same shape the pool persists, so the search surface
    // is the shared GameFilters component.
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

    /*
     * Run a completed search from an explicit query string. Split out from the
     * filter-reading path so the auto-refresh can replay the *last executed*
     * query (kept in lastQueryRef) rather than whatever's been typed since —
     * editing filters shouldn't silently re-query until Find games is pressed.
     */
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
        return undefined;
    }, [runCompleted]);

    const manualFetchLive = useCallback(() => { setLiveResetKey(k => k + 1); fetchLive(); }, [fetchLive]);
    const manualFetchCompleted = useCallback(() => { setCompletedResetKey(k => k + 1); fetchCompleted(); }, [fetchCompleted]);

    useEffect(() => { fetchLive(); }, [fetchLive]);

    const isLive = tab === 'live';
    const games = isLive ? liveGames : completedGames;
    const loading = isLive ? loadingLive : loadingCompleted;

    // Each tab re-fetches on the live poll cadence while it is the visible tab;
    // completed only once a search has been run.
    const liveCountdown = useAutoRefresh(isLive, pollInterval, fetchLive, liveResetKey);
    const completedCountdown = useAutoRefresh(!isLive && searched, pollInterval, refetchCompleted, completedResetKey);

    const load = (game) => stageOrRun({
        key: `board:${sb}:game`,
        label: `Board ${sb}: load ${gameLabel(game)}`,
        value: game.game_id,
        liveValue: loadedGameId,
        run: () => fetch(
            `/api/v1/game-pool/assign?game_id=${game.game_id}&scoreboard_number=${sb}`,
            { method: 'POST' },
        ),
    });

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
                    <GameFilters
                        value={filters}
                        onChange={patchFilters}
                        tagOptions={tagOptions}
                        trailing={(
                            <Button size="xs" variant="secondary" onClick={manualFetchCompleted} disabled={loadingCompleted}>
                                {loadingCompleted ? <Loader size={12} /> : <Search size={13} />}
                                Find games
                            </Button>
                        )}
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

            <ScrollArea className="h-[320px]">
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
                                    onClick={() => { load(game); onLoaded?.(); }}
                                >
                                    {isActive ? 'On board' : 'Put on board'}
                                </Button>
                            )}
                        />
                    </TableBody>
                </Table>
            </ScrollArea>
        </Stack>
    );
});

// ─── the dialog: the rotating pool ──────────────────────────────────────────

const scopeOptions = [
    { value: 'both', label: 'Live + Completed' },
    { value: 'live', label: 'Live Only' },
    { value: 'completed', label: 'Completed Only' },
];

const EMPTY_FILTER = {
    tag: [], username: [], vs_username: [], limit_games: null, start_time: null, end_time: null,
};

/*
 * The pool: one continuously-evaluated filter over a live/completed scope, plus
 * the games it currently matches and the ones excluded by hand.
 *
 * The filter IS the pool definition and it persists, so edits write straight
 * through (no staging) — this is prep, the same call the schedule queue makes.
 * What reaches air is the rotation, and that is the transport on the panel.
 */
const PoolEditor = memo(function PoolEditor({ sb, pool, tagOptions, running, currentIndex }) {
    const [finding, setFinding] = useState(false);
    // Transient "couldn't reach the pool" error from the last Find — the only
    // status the live members count can't express on its own.
    const [searchError, setSearchError] = useState(null);
    // The filter/scope has been edited since the last Find, so the list below is
    // stale. Only meaningful while stopped — a running rotation recomputes on
    // every pool edit, so we never mark it dirty then.
    const [dirty, setDirty] = useState(false);
    // Client-side cache of excluded game dicts so the chips can be labelled —
    // the backend stores excluded ids, not their display fields.
    const [excludedCache, setExcludedCache] = useState({});

    const gameIds = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.game_ids ?? EMPTY_LIST);
    const cachedGames = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.cached_games ?? EMPTY_LIST);
    const members = useMemo(() => {
        const byId = new Map(cachedGames.map(g => [g.game_id, g]));
        return gameIds.map(gid => byId.get(gid)).filter(Boolean);
    }, [gameIds, cachedGames]);

    const updatePool = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/pool`, patch), [sb]);
    // A pool never needs more than one filter, since each field already accepts a
    // list. Persisted as a one-element `filters` array.
    const filter = pool.filters?.[0] ?? EMPTY_FILTER;
    const updateFilter = useCallback((patch) => {
        if (!running) setDirty(true);
        updatePool({ filters: [{ ...(pool.filters?.[0] ?? EMPTY_FILTER), ...patch }] });
    }, [pool.filters, updatePool, running]);
    const setScope = useCallback((scope) => {
        if (!running) setDirty(true);
        updatePool({ scope });
    }, [updatePool, running]);

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
            // The pool count comes from `members` (mirrored into state by preview),
            // so the status line reflects the result on its own. The only thing we
            // can't derive there is a failed request.
            if (data == null) {
                setSearchError('Could not reach the game pool. Check your Rio API key and connection.');
            } else {
                setDirty(false);
            }
        } finally { setFinding(false); }
    }, [sb]);

    // Opening the dialog on a stopped board refreshes what it is about to show.
    useEffect(() => { if (!running) findGames(); }, [running, findGames]);
    // A running rotation recomputes its pool on every edit, so it's never stale.
    useEffect(() => { if (running) setDirty(false); }, [running]);

    const showDirty = dirty && !running;
    const status = useMemo(() => {
        if (finding) return { dot: 'bg-muted-foreground', text: 'Finding games…', cls: 'text-muted-foreground' };
        if (searchError) return { dot: 'bg-destructive', text: searchError, cls: 'text-destructive' };
        if (showDirty) return { dot: 'bg-amber-400', text: 'Filters changed — Find games to refresh the pool', cls: 'text-amber-400' };
        const n = members.length;
        if (n > 0) return { dot: 'bg-[#14b8a6]', text: `${n} game${n === 1 ? '' : 's'} in the pool`, cls: 'text-foreground' };
        if (filterIsEmpty) return { dot: 'bg-muted-foreground', text: 'Add a game mode, player, or opponent to match games', cls: 'text-muted-foreground' };
        return { dot: 'bg-muted-foreground', text: 'No games match yet — press Find games', cls: 'text-muted-foreground' };
    }, [finding, searchError, showDirty, members.length, filterIsEmpty]);

    const exclude = useCallback((game) => {
        setExcludedCache(c => ({ ...c, [game.game_id]: game }));
        postJSON(`/api/v1/rotation/${sb}/exclude`, { game_id: game.game_id });
    }, [sb]);
    const unexclude = useCallback((gameId) => {
        postJSON(`/api/v1/rotation/${sb}/unexclude`, { game_id: gameId });
    }, [sb]);

    return (
        <Stack gap="sm">
            <SegmentedControl
                fullWidth size="xs"
                data={scopeOptions}
                value={pool.scope ?? 'both'}
                onChange={setScope}
            />
            {/* Date and limit are completed-only, so they are hidden on a
                live-only scope where they would filter nothing. */}
            <GameFilters
                value={filter}
                onChange={updateFilter}
                tagOptions={tagOptions}
                showRefine={(pool.scope ?? 'both') !== 'live'}
                trailing={(
                    <Button
                        size="xs" variant="secondary"
                        className={cn(showDirty && 'ring-1 ring-amber-400')}
                        onClick={findGames} disabled={finding}
                    >
                        {finding ? <Loader size={12} /> : <Search size={13} />}
                        Find games
                    </Button>
                )}
            />

            <div className="flex min-w-0 items-center gap-2">
                <span className={cn('size-1.5 shrink-0 rounded-full', status.dot)} />
                <Text size="xs" className={cn('truncate', status.cls)}>{status.text}</Text>
            </div>

            <ScrollArea className="h-[280px]">
                <Table className="text-xs">
                    <TableHeader className="sticky top-0 z-[1] bg-night-900">
                        <TableRow>
                            <TableHead>Player</TableHead>
                            <TableHead className="w-[60px] text-center">Score</TableHead>
                            <TableHead>Opponent</TableHead>
                            <TableHead>Mode</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead className="w-[92px] text-right">Exclude</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <GameRows
                            games={members}
                            loading={finding}
                            columns={6}
                            activeId={members[currentIndex]?.game_id ?? null}
                            emptyLabel="No games match this filter yet. Add a game mode or player above, then Find games."
                            extraCell={(game) => (
                                <TableCell><Text size="xs" dimmed>{formatTimestamp(game.date_time_end)}</Text></TableCell>
                            )}
                            action={(game) => (
                                <Button size="xs" variant="ghost" className="text-destructive" onClick={() => exclude(game)}>
                                    <Ban size={12} /> Exclude
                                </Button>
                            )}
                        />
                    </TableBody>
                </Table>
            </ScrollArea>

            {excludedList.length > 0 && (
                <div className="border-t border-border pt-2.5">
                    <Text size="xs" fw={600} className="mb-1.5">Excluded ({excludedList.length})</Text>
                    <div className="flex flex-wrap gap-1.5">
                        {excludedList.map(({ id, label }) => (
                            <Badge key={id} className="gap-1 bg-[#ef4444]/15 text-[10px] text-[#f87171]">
                                {label}
                                <SimpleTooltip label="Put back in the pool">
                                    <span
                                        role="button" aria-label={`Re-include ${label}`}
                                        className="inline-flex cursor-pointer" onClick={() => unexclude(id)}
                                    >
                                        <Undo2 className="size-3" />
                                    </span>
                                </SimpleTooltip>
                            </Badge>
                        ))}
                    </div>
                </div>
            )}
        </Stack>
    );
});

// ─── the panel rows ─────────────────────────────────────────────────────────

const playbackOptions = [
    { value: 'single', label: 'One game' },
    { value: 'rotate', label: 'Rotating' },
];

// The rotation's own status (index, next advance) — REST on mount, then pushed.
function useRotationStatus(sb) {
    const [status, setStatus] = useState({ active: false });
    useEffect(() => {
        let live = true;
        fetch(`/api/v1/rotation/${sb}`).then(r => r.json())
            .then(s => { if (live) setStatus(s); })
            .catch(() => {});
        return () => { live = false; };
    }, [sb]);
    const onStatus = useCallback((payload) => {
        if (payload?.scoreboard === sb) setStatus(payload);
    }, [sb]);
    useSocketSubscribe('v1.rotation.status', onStatus);
    return [status, setStatus];
}

// Seconds until the next advance, ticked locally off the server's target time.
function useAdvanceCountdown(active, nextAdvanceAt) {
    const [secs, setSecs] = useState(null);
    useEffect(() => {
        if (!active || !nextAdvanceAt) { setSecs(null); return undefined; }
        const tick = () => setSecs(Math.max(0, Math.round(nextAdvanceAt - Date.now() / 1000)));
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [active, nextAdvanceAt]);
    return secs;
}

/*
 * GamesSection — the board panel's "where do this board's games come from" region.
 *
 * Everything here is steady-state: the mode, the cadence, the transport, and a
 * count. The browsing lives one click away in the dialog, which is the tempo
 * split this module exists to make.
 *
 * `readout` is the sentence the panel already printed (playbackLine) — passed in
 * rather than recomputed so the board desk keeps one source for it.
 */
export const GamesSection = memo(function GamesSection({
    sb, transport, readout, badge, poolCount, gameModes,
}) {
    const pool = useSettingsStore(s => s?.scoreboards?.binding?.[sb]?.pool
        ?? s?.scoreboards?.binding?.[String(sb)]?.pool ?? DEFAULT_POOL);
    // useShallow, not a bare selector: this one BUILDS an object, and without the
    // element-wise compare getSnapshot returns a new reference every read — the
    // same loop DEFAULT_POOL above exists to avoid.
    const playback = useSettingsStore(useShallow((s) => {
        const p = s?.scoreboards?.binding?.[sb]?.playback
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback ?? {};
        return { mode: p.mode || 'single', interval: p.interval ?? 30, gameId: p.gameId ?? null };
    }));
    const [status, setStatus] = useRotationStatus(sb);
    const countdown = useAdvanceCountdown(status.active, status.next_advance_at);
    const [open, setOpen] = useState(false);

    /*
     * `mode` is server-backed (a settings round-trip), so a click has to wait for
     * the PUT to echo back before the control moves — which reads as a locked
     * segmented while the server is busy fetching. Echo the click locally and
     * reconcile once the persisted value catches up.
     */
    const [modeOverride, setModeOverride] = useState(null);
    const mode = modeOverride ?? playback.mode;
    useEffect(() => {
        if (modeOverride && playback.mode === modeOverride) setModeOverride(null);
    }, [playback.mode, modeOverride]);
    const setMode = useCallback((next) => {
        setModeOverride(next);
        fetch(`/api/v1/scoreboards/${sb}/binding?kind=${next}`, { method: 'PUT' }).catch(() => {});
    }, [sb]);

    // Preserve the chosen cadence while the toggle is off (0 = off).
    const [refreshSecs, setRefreshSecs] = useState(() => (pool.refresh_interval > 0 ? pool.refresh_interval : 60));
    const updatePool = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/pool`, patch), [sb]);
    const updatePlayback = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/playback`, patch), [sb]);

    // Transport is momentary — the same rule as Take and post-game capture. A
    // producer pressing Next means now, not on the next confirm.
    const transportCall = useCallback(async (verb) => {
        const data = await fetch(`/api/v1/rotation/${sb}/${verb}`, { method: 'POST' })
            .then(r => r.json()).catch(() => null);
        if (data) setStatus(verb === 'stop' ? { active: false } : data);
    }, [sb, setStatus]);

    const excludedCount = (pool.excluded ?? []).length;
    const rotating = mode === 'rotate';

    return (
        <>
            <FieldRow label="Games">
                {badge}
                <Text size="xs" dimmed className="min-w-0">{readout}</Text>
            </FieldRow>

            {/* A HUD board has no pool and no playback choice — its game is
                whatever Project Rio is playing locally, and the readout above
                already says so (server/bindings.py). Everything below would be a
                control with nothing to act on. */}
            {transport !== 'hud' && (
                <>
                    <SegmentedRow label="Playback" data={playbackOptions} value={mode} onChange={setMode} />

                    {rotating ? (
                        <>
                            <NumberRow
                                label="Each game" value={playback.interval} min={5} max={600} suffix="s"
                                onChange={(v) => updatePlayback({ interval: v || 30 })}
                            />
                            <ToggleRow
                                label="Keep current"
                                checked={(pool.refresh_interval ?? 0) > 0}
                                onChange={(on) => updatePool({ refresh_interval: on ? refreshSecs : 0 })}
                            />
                            {(pool.refresh_interval ?? 0) > 0 && (
                                <NumberRow
                                    label="Re-check" value={refreshSecs} min={10} max={600} suffix="s"
                                    onChange={(v) => {
                                        const next = v || 10;
                                        setRefreshSecs(next);
                                        updatePool({ refresh_interval: next });
                                    }}
                                />
                            )}
                            <FieldRow label="Pool">
                                <Text size="xs" span className="shrink-0 tabular-nums text-foreground">
                                    {poolCount || 'none'}
                                </Text>
                                {excludedCount > 0 && (
                                    <Text size="xs" span dimmed className="shrink-0">· {excludedCount} off</Text>
                                )}
                                {status.active && status.total_games > 0 && (
                                    <Badge className="shrink-0 bg-[#14b8a6] text-[10px] text-black tabular-nums">
                                        {status.current_index + 1}/{status.total_games}
                                        {countdown != null && ` · ${countdown}s`}
                                    </Badge>
                                )}
                                <div className="ml-auto flex shrink-0 items-center gap-1">
                                    {status.active && status.total_games > 0 && (
                                        <>
                                            <Button
                                                size="icon-sm" variant="ghost" aria-label="Previous game in the pool"
                                                onClick={() => transportCall('prev')}
                                            >
                                                <ChevronLeft size={14} />
                                            </Button>
                                            <Button
                                                size="icon-sm" variant="ghost" aria-label="Next game in the pool"
                                                onClick={() => transportCall('next')}
                                            >
                                                <ChevronRight size={14} />
                                            </Button>
                                        </>
                                    )}
                                    <Button
                                        size="xs"
                                        variant={status.active ? 'outline' : 'secondary'}
                                        className={cn('h-7', status.active && 'border-destructive/40 text-destructive')}
                                        onClick={() => transportCall(status.active ? 'stop' : 'start')}
                                    >
                                        {status.active
                                            ? <><Square size={11} className="mr-1" /> Stop</>
                                            : <><Play size={11} className="mr-1" /> Rotate</>}
                                    </Button>
                                </div>
                            </FieldRow>
                        </>
                    ) : null}

                    <ActionRow
                        actions={[{
                            label: rotating ? 'Edit the pool…' : 'Find a game…',
                            onClick: () => setOpen(true),
                            variant: 'outline',
                        }]}
                    />
                </>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="flex max-h-[88vh] w-[calc(100vw-4rem)] flex-col overflow-hidden sm:max-w-[900px]!">
                    <DialogHeader>
                        <DialogTitle>{rotating ? 'Pool' : 'Find a game'}</DialogTitle>
                        <DialogDescription>
                            {rotating
                                ? 'Games this board rotates through. Exclude any you don’t want on screen.'
                                : 'Pick the game this board shows.'}
                        </DialogDescription>
                    </DialogHeader>
                    {open && (rotating ? (
                        <PoolEditor
                            sb={sb} pool={pool} tagOptions={gameModes}
                            running={!!status.active} currentIndex={status.current_index ?? -1}
                        />
                    ) : (
                        <SingleGameFinder sb={sb} tagOptions={gameModes} onLoaded={() => setOpen(false)} />
                    ))}
                </DialogContent>
            </Dialog>
        </>
    );
});

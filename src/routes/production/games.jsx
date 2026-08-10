import { useState, useCallback, useEffect, useId, useMemo, useRef, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
    ChevronLeft, ChevronRight, X, Ban, RotateCw, Undo2, Search, CalendarDays,
} from 'lucide-react';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { NumberInput } from '../../components/ui/number-input';
import { MultiSelect } from '../../components/ui/multi-select';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { Switch } from '../../components/ui/switch';
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
import { KitColumns } from './kit';

/*
 * Games — where a board's games come from, and how it plays them.
 *
 * THE MODE CHOICE IS THE SUBJECT OF THIS SURFACE, and the surface is an
 * INSTRUMENT, not a settings list: one full-width segmented picks how the board
 * plays (one game, or rotating), and everything below belongs to the mode that
 * is selected — a live/completed game table in one, a filter plus a running
 * transport in the other. That is the shape `PoolBrowser` had on the Match tab,
 * and it is the shape it keeps here.
 *
 * It is written down because an intermediate version got it wrong in a way worth
 * not repeating. Splitting the surface strictly by TEMPO — steady-state controls
 * as kit rows on the panel, everything browsable behind one dialog — demoted the
 * mode to `SegmentedRow label="Playback"` in a label gutter, put the live game
 * list two clicks away behind "Find a game…", and left the pool's status line
 * (the thing that says *why* nothing matched) inside the dialog where a producer
 * glancing at the panel could not see it. The tempo instinct was right about one
 * thing only — a date range is not a mid-game control — and the Live/Completed
 * tab already handles that, because the date fields only exist on the tab a
 * producer explicitly switched to.
 *
 * So the split is by JOB, not by tempo:
 *   • On the panel — the mode, its source scope, its filter, its timing, its
 *     transport, its status, and the game list you pick from.
 *   • Behind ONE dialog — the rotating pool's MEMBER LIST, for excluding games.
 *     Exactly the dialog `PoolBrowser` opened (`PoolGamesModal`), for exactly
 *     the same reason: it is a long table you visit to prune, not to watch.
 *
 * What genuinely changed in the move off the tab: a board's games are authored
 * on the BOARD (which is what let the Match tab go), and putting a game on a
 * board now routes through the staging gateway, because it is the one act here
 * that reaches air.
 *
 * THE TWO AXES STAY TWO THINGS (see ../boards): transport (HUD vs API) is
 * DERIVED and has no picker; playback (single vs rotating) is CHOSEN and is the
 * only thing this surface sets. Neither is drawn here: the board desk states both
 * on the region's header rule (`KitColumn subject`), so a one-line statement of
 * state costs no row. A HUD board has no pool at all — its game is whatever
 * Project Rio is playing — so that header is its entire Games region and this
 * module renders nothing.
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

/*
 * The completed-game filter surface, shared by the single-game Completed search
 * and the rotating pool so the two read identically. `value` is a filter dict
 * ({tag, username, vs_username, start_time, end_time, limit_games});
 * `onChange(patch)` merges a partial. Fields combine the way the Rio API does:
 * values within one field OR together, different fields AND. `showRefine=false`
 * hides the completed-only date/limit row (e.g. a live-only pool scope).
 *
 * `columns` is EXPLICIT, not a container query, and that is the point. The three
 * chip fields are peers (one AND-ed term each) and read well across — but the
 * `@container` here is the PANEL, not the box this component was handed, so a
 * `@4xl:grid-cols-3` gate goes three-across inside a half-width column too and
 * squeezes each field to 155px. The caller knows how wide it is; ask it.
 * `columns={3}` for the full-width single-game search, stacked (the default) in
 * the rotating pool's half column.
 *
 * (Measured, not assumed: at three-across in a 554px column each field was 179px
 * and "Filter by opponent" already overflowed its own placeholder.)
 */
function GameFilters({ value, onChange, tagOptions, showRefine = true, trailing = null, columns = 1 }) {
    const v = value ?? {};
    const limitId = useId();
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
            {/* items-start, so a field that grows chips onto a second line does
                not stretch its two neighbours to match. */}
            <div className={cn(
                'grid grid-cols-1 items-start gap-2',
                columns === 3 && '@4xl:grid-cols-3',
            )}>
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
            </div>
            {/* Inline labels, not micro-caps stacked over each control: a
                stacked label made this a 51px row for two 32px inputs, and a
                date input states its own format anyway (the two carry
                aria-labels, and the dash between them says it is a range). */}
            {showRefine && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Label className="whitespace-nowrap text-xs" htmlFor={limitId}>Limit</Label>
                    <NumberInput
                        id={limitId}
                        placeholder="All"
                        min={1} max={500}
                        value={v.limit_games ?? null}
                        onChange={(val) => onChange({ limit_games: val || null })}
                        className="w-[76px]"
                    />
                    {dateOpen ? (
                        <>
                            <DateField label="From" value={v.start_time} kind="start" onChange={(t) => onChange({ start_time: t })} />
                            <Text size="xs" span dimmed>–</Text>
                            <DateField label="To" value={v.end_time} kind="end" onChange={(t) => onChange({ end_time: t })} />
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

// ─── one game: the inline finder ────────────────────────────────────────────

const searchTabs = [
    { value: 'live', label: 'Live' },
    { value: 'completed', label: 'Completed' },
];

/*
 * Find one game and put it on the board — INLINE, no dialog.
 *
 * Picking which game a single-playback board shows is the most frequent thing
 * done to an API board, and the Live tab is a handful of rows of what is being
 * played right now. Behind a button it was two clicks and a modal for the common
 * case; open, it is a list you look at and press.
 *
 * The completed FILTER only exists on the Completed tab, which is what keeps a
 * date range off a surface a producer glances at mid-game: nothing here is
 * visible until they switch to it deliberately.
 *
 * Loading goes through the staging gateway — it is the one thing on this surface
 * that changes what is on air, and a producer running confirm mode should get to
 * choose when the board changes under them. Searching, refreshing and switching
 * tabs are reads and fire immediately.
 */
const SingleGameFinder = memo(function SingleGameFinder({ sb, tagOptions }) {
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
                        columns={3}
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

            <ScrollArea className="h-[260px]">
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
                                    onClick={() => load(game)}
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

// ─── rotating: the pool's member list (the one dialog) ──────────────────────

/*
 * The games this board is rotating through, so any of them can be excluded.
 *
 * THE ONLY DIALOG on this surface, and the same one `PoolBrowser` opened: a long
 * table you visit to prune, not to watch. Everything that says what the pool IS
 * — the scope, the filter, the count, the status — is on the panel.
 */
function PoolGamesDialog({
    open, onOpenChange, members, currentIndex, excludedList, loading,
    onRefresh, onExclude, onUnexclude,
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[88vh] w-[calc(100vw-4rem)] flex-col overflow-hidden sm:max-w-[1000px]!">
                <DialogHeader>
                    <DialogTitle>Pool games</DialogTitle>
                    <DialogDescription>
                        Games this board rotates through. Exclude any you don’t want on screen.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center justify-end">
                    <Button size="xs" variant="secondary" onClick={onRefresh} disabled={loading}>
                        {loading ? <Loader size={12} /> : <RotateCw size={12} />}
                        Find games
                    </Button>
                </div>

                <ScrollArea className="h-[420px]">
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
                                loading={loading}
                                columns={6}
                                activeId={members[currentIndex]?.game_id ?? null}
                                emptyLabel="No games match this filter yet. Add a game mode or player on the panel, then Find games."
                                extraCell={(game) => (
                                    <TableCell><Text size="xs" dimmed>{formatTimestamp(game.date_time_end)}</Text></TableCell>
                                )}
                                action={(game) => (
                                    <Button size="xs" variant="ghost" className="text-destructive" onClick={() => onExclude(game)}>
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
                                            className="inline-flex cursor-pointer" onClick={() => onUnexclude(id)}
                                        >
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

// ─── rotating: the panel surface ────────────────────────────────────────────

const scopeOptions = [
    { value: 'both', label: 'Live + Completed' },
    { value: 'live', label: 'Live Only' },
    { value: 'completed', label: 'Completed Only' },
];

const EMPTY_FILTER = {
    tag: [], username: [], vs_username: [], limit_games: null, start_time: null, end_time: null,
};

/*
 * A rotating board: one continuously-evaluated filter over a live/completed
 * scope, cycled on an interval.
 *
 * The filter IS the pool definition and it persists, so edits write straight
 * through (no staging) — this is prep, the same call the schedule queue makes.
 * What reaches air is the rotation, and that is the TRANSPORT, which is
 * momentary: Start/Stop/Next mean now, the same rule as Take and capture.
 *
 * The status line under the transport is the reason this block is on the panel
 * rather than in a dialog. `Rotating — nothing in its pool yet` (the board's
 * readout) says the pool is empty; only this line says *why* — filters edited
 * since the last Find, an unreachable API, or no filter at all yet.
 */
const RotatingGames = memo(function RotatingGames({
    sb, pool, tagOptions, status, transportCall, countdown,
}) {
    const [poolOpen, setPoolOpen] = useState(false);
    const [finding, setFinding] = useState(false);
    // Transient "couldn't reach the pool" error from the last Find — the only
    // status the live members count can't express on its own.
    const [searchError, setSearchError] = useState(null);
    // The filter/scope has been edited since the last Find, so the pool is
    // stale. Only meaningful while stopped — a running rotation recomputes on
    // every pool edit, so we never mark it dirty then.
    const [dirty, setDirty] = useState(false);
    // Preserve the chosen cadence while the toggle is off (0 = off).
    const [refreshSecs, setRefreshSecs] = useState(() => (pool.refresh_interval > 0 ? pool.refresh_interval : 60));
    // Client-side cache of excluded game dicts so the chips can be labelled —
    // the backend stores excluded ids, not their display fields.
    const [excludedCache, setExcludedCache] = useState({});

    const playback = useSettingsStore(useShallow((s) => {
        const p = s?.scoreboards?.binding?.[sb]?.playback
            ?? s?.scoreboards?.binding?.[String(sb)]?.playback ?? {};
        return { interval: p.interval ?? 30 };
    }));

    // Live pool membership, mirrored into State by the server on Start and on
    // Find games (server/rio/rotation.py _mirror_to_state) — a read, not a fetch.
    const gameIds = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.game_ids ?? EMPTY_LIST);
    const cachedGames = useStateStore(s => s?.scoreboards?.rotation?.[sb]?.cached_games ?? EMPTY_LIST);
    const members = useMemo(() => {
        const byId = new Map(cachedGames.map(g => [g.game_id, g]));
        return gameIds.map(gid => byId.get(gid)).filter(Boolean);
    }, [gameIds, cachedGames]);

    const updatePool = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/pool`, patch), [sb]);
    const updatePlayback = useCallback((patch) => putJSON(`/api/v1/rotation/${sb}/playback`, patch), [sb]);

    const running = !!status.active;
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

    // A running rotation recomputes its pool on every edit, so it's never stale.
    useEffect(() => { if (running) setDirty(false); }, [running]);

    const showDirty = dirty && !running;
    const poolStatus = useMemo(() => {
        if (finding) return { dot: 'bg-muted-foreground', text: 'Finding games…', cls: 'text-muted-foreground' };
        if (searchError) return { dot: 'bg-destructive', text: searchError, cls: 'text-destructive' };
        if (showDirty) return { dot: 'bg-amber-400', text: 'Filters changed — Find games to refresh the pool', cls: 'text-amber-400' };
        const n = members.length;
        if (n > 0) return { dot: 'bg-[#14b8a6]', text: `${n} game${n === 1 ? '' : 's'} in the pool`, cls: 'text-foreground' };
        if (filterIsEmpty) return { dot: 'bg-muted-foreground', text: 'Add a game mode, player, or opponent to match games', cls: 'text-muted-foreground' };
        return { dot: 'bg-muted-foreground', text: 'No games match yet — press Find games', cls: 'text-muted-foreground' };
    }, [finding, searchError, showDirty, members.length, filterIsEmpty]);

    /*
     * Opening the member list refreshes what it is about to show — but only when
     * stopped, and only on the OPEN. This never runs on mount: selecting a board
     * desk must not fire a Rio API search, and a running rotation is already
     * re-evaluating its own pool.
     */
    const openPool = useCallback(() => {
        setPoolOpen(true);
        if (!running) findGames();
    }, [running, findGames]);

    const exclude = useCallback((game) => {
        setExcludedCache(c => ({ ...c, [game.game_id]: game }));
        postJSON(`/api/v1/rotation/${sb}/exclude`, { game_id: game.game_id });
    }, [sb]);
    const unexclude = useCallback((gameId) => {
        postJSON(`/api/v1/rotation/${sb}/unexclude`, { game_id: gameId });
    }, [sb]);

    return (
        <Stack gap="sm">
          {/* TWO COLUMNS, because the rotator has two subjects: what is IN the
              pool (scope · filter · limit) and how the pool PLAYS (cadence ·
              transport · status). Stacked, those were seven full-width rows in a
              554px column with ~300px of empty panel beside them — which is what
              made this read as too tall even before it was measured. Side by side
              the region loses ~90px and the dead width goes with it. */}
          <KitColumns>
            <Stack gap="sm">
                {/* Source scope — a subordinate segmented, mirroring the
                    single-game Live/Completed selector so both modes read
                    mode → source. */}
                <SegmentedControl
                    fullWidth size="xs"
                    data={scopeOptions}
                    value={pool.scope ?? 'both'}
                    onChange={setScope}
                />

                {/* Stacked, not across: this is a half-width column. Date and
                    limit are completed-only, so they are hidden on a live-only
                    scope where they would filter nothing. */}
                <GameFilters
                    value={filter}
                    onChange={updateFilter}
                    tagOptions={tagOptions}
                    showRefine={(pool.scope ?? 'both') !== 'live'}
                />
            </Stack>

            <Stack gap="sm">
            {/* Timing. Both labels are written out: "Keep pool current" says what
                it keeps current, where a label-gutter row forced it down to
                "Keep current" and dropped the tooltip that explains the off
                state. The interval stays visible-but-disabled rather than
                appearing and disappearing under the switch. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-xs" htmlFor={`rot-interval-${sb}`}>
                        Seconds per game
                    </Label>
                    <NumberInput
                        id={`rot-interval-${sb}`}
                        aria-label="Seconds per game"
                        min={5} max={600}
                        value={playback.interval}
                        onChange={(val) => updatePlayback({ interval: val || 30 })}
                        className="w-[72px]"
                        suffix="s"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        size="sm"
                        aria-label="Keep pool current"
                        checked={(pool.refresh_interval ?? 0) > 0}
                        onCheckedChange={(on) => updatePool({ refresh_interval: on ? refreshSecs : 0 })}
                    />
                    <SimpleTooltip label="Automatically pick up newly-started and finished games while rotating. Off = the pool only changes when you press Find games.">
                        <Label className="whitespace-nowrap text-xs">Keep pool current</Label>
                    </SimpleTooltip>
                    <NumberInput
                        aria-label="Re-check interval"
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

            {/* Pool actions + transport + status, in one contained inset so the
                status never reads as floating text. Actions left, transport
                right, the status line beneath the two. */}
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
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
                        <Button size="xs" variant="outline" onClick={openPool}>
                            Pool games
                            {(members.length > 0 || excludedIds.length > 0) && (
                                <Badge variant="secondary" className="ml-1 text-[10px]">
                                    {members.length}{excludedIds.length > 0 && ` · ${excludedIds.length} off`}
                                </Badge>
                            )}
                        </Button>
                    </div>

                    <div className="flex items-center gap-2">
                        {!running ? (
                            <Button
                                size="sm"
                                className="bg-[#14b8a6] text-black hover:bg-[#14b8a6]/90"
                                onClick={() => transportCall('start')}
                            >
                                Start rotating
                            </Button>
                        ) : (
                            <>
                                <Button
                                    size="sm" variant="outline"
                                    className="border-destructive/40 text-destructive"
                                    onClick={() => transportCall('stop')}
                                >
                                    Stop
                                </Button>
                                {status.total_games > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <Button
                                            size="icon-sm" variant="secondary"
                                            aria-label="Previous game in the pool"
                                            onClick={() => transportCall('prev')}
                                        >
                                            <ChevronLeft size={14} />
                                        </Button>
                                        <Text size="xs" className="tabular-nums">
                                            {status.current_index + 1}/{status.total_games}
                                        </Text>
                                        <Button
                                            size="icon-sm" variant="secondary"
                                            aria-label="Next game in the pool"
                                            onClick={() => transportCall('next')}
                                        >
                                            <ChevronRight size={14} />
                                        </Button>
                                        {countdown != null && (
                                            <Text size="xs" dimmed className="tabular-nums">{countdown}s</Text>
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
          </KitColumns>

            <PoolGamesDialog
                open={poolOpen}
                onOpenChange={setPoolOpen}
                members={members}
                currentIndex={status.current_index ?? -1}
                excludedList={excludedList}
                loading={finding}
                onRefresh={findGames}
                onExclude={exclude}
                onUnexclude={unexclude}
            />
        </Stack>
    );
});

// ─── the section ────────────────────────────────────────────────────────────

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
 * The mode, then the mode's own surface. The mode segmented is full-width and
 * full-size: it is the subject here, and everything under it belongs to whichever
 * half is chosen.
 *
 * The transport badge and the playback sentence are NOT here — the board desk
 * puts them on the region's own header rule (`KitColumn subject`), because a
 * one-line statement of state does not need a row of its own on a surface that
 * was already too tall.
 */
export const GamesSection = memo(function GamesSection({ sb, transport, gameModes }) {
    const pool = useSettingsStore(s => s?.scoreboards?.binding?.[sb]?.pool
        ?? s?.scoreboards?.binding?.[String(sb)]?.pool ?? DEFAULT_POOL);
    const serverMode = useSettingsStore(s => s?.scoreboards?.binding?.[sb]?.playback?.mode
        ?? s?.scoreboards?.binding?.[String(sb)]?.playback?.mode ?? 'single');
    const [status, setStatus] = useRotationStatus(sb);
    const countdown = useAdvanceCountdown(status.active, status.next_advance_at);

    /*
     * `mode` is server-backed (a settings round-trip), so a click has to wait for
     * the PUT to echo back before the control moves — which reads as a locked
     * segmented while the server is busy fetching. Echo the click locally and
     * reconcile once the persisted value catches up.
     */
    const [modeOverride, setModeOverride] = useState(null);
    const mode = modeOverride ?? serverMode;
    useEffect(() => {
        if (modeOverride && serverMode === modeOverride) setModeOverride(null);
    }, [serverMode, modeOverride]);
    const setMode = useCallback((next) => {
        setModeOverride(next);
        fetch(`/api/v1/scoreboards/${sb}/binding?kind=${next}`, { method: 'PUT' }).catch(() => {});
    }, [sb]);

    // Transport is momentary — the same rule as Take and post-game capture. A
    // producer pressing Next means now, not on the next confirm.
    const transportCall = useCallback(async (verb) => {
        const data = await fetch(`/api/v1/rotation/${sb}/${verb}`, { method: 'POST' })
            .then(r => r.json()).catch(() => null);
        if (data) setStatus(verb === 'stop' ? { active: false } : data);
    }, [sb, setStatus]);

    /*
     * A HUD board has no pool and no playback choice — its game is whatever
     * Project Rio is playing locally, and the region's header sentence already
     * says so (server/bindings.py). Everything here would be a control with
     * nothing to act on, so the region is its header and nothing else.
     */
    if (transport === 'hud') return null;

    return (
        <Stack gap="sm">
            <SegmentedControl fullWidth data={playbackOptions} value={mode} onChange={setMode} />

            {mode === 'rotate' ? (
                <RotatingGames
                    sb={sb} pool={pool} tagOptions={gameModes}
                    status={status} transportCall={transportCall} countdown={countdown}
                />
            ) : (
                <SingleGameFinder sb={sb} tagOptions={gameModes} />
            )}
        </Stack>
    );
});

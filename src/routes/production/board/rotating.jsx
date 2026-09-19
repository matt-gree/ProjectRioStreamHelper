import { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronLeft, ChevronRight, Ban, RotateCw, Undo2, Search } from 'lucide-react';
import { Stack, Text, Loader } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { Switch } from '../../../components/ui/switch';
import { Label } from '../../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { SimpleTooltip } from '../../../components/ui/simple-tooltip';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../../components/ui/table';
import { cn } from '../../../lib/utils';
import { useSettingsStore, useStateStore } from '../../../context/store';
import { KitColumns, NumberField } from '../kit';
import { DEFAULT_LIMIT, GameFilters, GameRows, formatTimestamp, gameLabel } from './gamelist';

// Rotating playback: the pool's filter, timing and transport on the panel, and
// its member list behind the one dialog.

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

// A stable empty array, for the reason DEFAULT_POOL gives in ./games.
const EMPTY_LIST = [];

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
    tag: [], username: [], vs_username: [], limit_games: DEFAULT_LIMIT,
    start_time: null, end_time: null,
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
 * rather than in a dialog, and it is now the ONLY place the pool is counted: the
 * region's rule used to quote the number too ("Rotating — 6 in pool"), which is
 * a second statement of the half of this line that is never the interesting
 * half. Only this one can say *why* a pool is empty — filters edited since the
 * last Find, an unreachable API, or no filter at all yet.
 */
export const RotatingGames = memo(function RotatingGames({
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
                appearing and disappearing under the switch.

                BOTH FIELDS EMPTY OUT, AND NEITHER IS `NumberInput` ANY MORE.
                They were controlled straight off the stored value with a
                `val || 30` at the call site, which is two bugs stacked: the
                coercion turned the keystroke that CLEARS the box into a write
                of the default, and the controlled value then refilled the box
                with it — so clearing to type a fresh `120` gave you `30120`,
                and there was no way to get an empty field at all. `NumberField`
                (../kit) holds the draft and commits on a pause or on blur, and
                `clearable={false}` says what an empty box means HERE: not an
                answer (there is no board that cycles every `` seconds) but a
                producer halfway to a new number, so it writes nothing and puts
                the old value back when focus leaves. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap text-xs" htmlFor={`rot-interval-${sb}`}>
                        Seconds per game
                    </Label>
                    <NumberField
                        id={`rot-interval-${sb}`}
                        ariaLabel="Seconds per game"
                        min={5} max={600}
                        value={playback.interval}
                        onChange={(val) => updatePlayback({ interval: val })}
                        clearable={false}
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
                    <NumberField
                        ariaLabel="Re-check interval"
                        min={10} max={600}
                        value={refreshSecs}
                        disabled={(pool.refresh_interval ?? 0) === 0}
                        onChange={(val) => {
                            setRefreshSecs(val);
                            if ((pool.refresh_interval ?? 0) > 0) updatePool({ refresh_interval: val });
                        }}
                        clearable={false}
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
                            className={cn('h-7', showDirty && 'ring-1 ring-amber-400')}
                            onClick={findGames} disabled={finding}
                        >
                            {finding ? <Loader size={12} /> : <Search size={13} />}
                            Find games
                        </Button>
                        <Button size="xs" variant="outline" className="h-7" onClick={openPool}>
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
                                size="xs"
                                className="h-7 bg-[#14b8a6] text-black hover:bg-[#14b8a6]/90"
                                onClick={() => transportCall('start')}
                            >
                                Start rotating
                            </Button>
                        ) : (
                            <>
                                <Button
                                    size="xs" variant="outline"
                                    className="h-7 border-destructive/40 text-destructive"
                                    onClick={() => transportCall('stop')}
                                >
                                    Stop
                                </Button>
                                {status.total_games > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <Button
                                            size="icon-sm" variant="secondary" className="size-7"
                                            aria-label="Previous game in the pool"
                                            onClick={() => transportCall('prev')}
                                        >
                                            <ChevronLeft size={14} />
                                        </Button>
                                        <Text size="xs" className="tabular-nums">
                                            {status.current_index + 1}/{status.total_games}
                                        </Text>
                                        <Button
                                            size="icon-sm" variant="secondary" className="size-7"
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

import { useState, useCallback, useEffect, memo } from 'react';
import { RotateCw, Search } from 'lucide-react';
import { Stack, Text, Loader } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { SegmentedControl } from '../../../components/ui/segmented-control';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Table, TableHeader, TableBody, TableHead, TableRow } from '../../../components/ui/table';
import { useStateStore } from '../../../context/store';
import { stageOrRun } from '../../../context/staging';
import { DEFAULT_LIMIT, GameFilters, GameRows, gameLabel } from './gamelist';

// Single playback: the inline finder that puts one live or completed game on
// the board.

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
export const SingleGameFinder = memo(function SingleGameFinder({ sb, tagOptions }) {
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

    const fetchLive = useCallback(async () => {
        setLoadingLive(true);
        try {
            await fetch('/api/v1/game-pool/ongoing/refresh', { method: 'POST' });
            const data = await fetch('/api/v1/game-pool/ongoing').then(r => r.json());
            setLiveGames(Array.isArray(data) ? data : []);
        } catch { setLiveGames([]); } finally { setLoadingLive(false); }
    }, []);

    // A completed search runs when Find games is pressed and at no other time —
    // editing a filter must not re-query, and nothing replays the last one on a
    // timer any more.
    const runCompleted = useCallback(async (queryStr) => {
        setLoadingCompleted(true);
        setSearched(true);
        setCompletedError(null);
        try {
            const resp = await fetch(`/api/v1/game-pool/completed/refresh?${queryStr}`, { method: 'POST' }).then(r => r.json());
            if (resp && resp.success === false) {
                // See the sibling string in rotating.jsx: no key, no field,
                // so the fallback names the connection and nothing else.
                setCompletedError(resp?.diagnostics?.error || 'Search failed — check your internet connection.');
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
        params.append('limit_games', String(filters.limit_games ?? DEFAULT_LIMIT));
        return params.toString();
    }, [filters]);

    const fetchCompleted = useCallback(
        () => runCompleted(buildCompletedQuery()),
        [buildCompletedQuery, runCompleted],
    );

    /*
     * ONE fetch, when the picker first appears, and then only on the button.
     * Opening the picker is the producer asking what is live — showing them an
     * empty table and a Refresh they have to press would be a click charged for
     * the most frequent act on an API board. A REPEAT of that fetch is a
     * different thing entirely, and it is the thing that is gone.
     */
    useEffect(() => { fetchLive(); }, [fetchLive]);

    const isLive = tab === 'live';
    const games = isLive ? liveGames : completedGames;
    const loading = isLive ? loadingLive : loadingCompleted;

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
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="xs" variant="secondary" onClick={fetchLive} disabled={loadingLive}>
                        {loadingLive ? <Loader size={12} /> : <RotateCw size={12} />}
                        Refresh
                    </Button>
                    <Text size="xs" dimmed>{liveGames.length} live game{liveGames.length !== 1 ? 's' : ''}</Text>
                </div>
            ) : (
                <Stack gap="sm">
                    <GameFilters
                        value={filters}
                        onChange={patchFilters}
                        tagOptions={tagOptions}
                        columns={3}
                        trailing={(
                            <Button size="xs" variant="secondary" onClick={fetchCompleted} disabled={loadingCompleted}>
                                {loadingCompleted ? <Loader size={12} /> : <Search size={13} />}
                                Find games
                            </Button>
                        )}
                    />
                    {searched && (
                        <Text size="xs" dimmed>
                            {completedGames.length} result{completedGames.length !== 1 ? 's' : ''}
                        </Text>
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

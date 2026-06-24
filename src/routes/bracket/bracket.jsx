import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stack, Text, Title, Loader } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { SimpleSelect } from '../../components/ui/simple-select';
import { Badge } from '../../components/ui/badge';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useStateStore, useSettingsStore, useBracketStore } from '../../context/store';
import useTournament, { detectSource } from '../../hooks/useTournament';

// Tinted-translucent chips per set state, matching the brand.
const STATE_BADGE = {
    active: 'bg-[#22c55e]/15 text-[#4ade80]',
    called: 'bg-[#f5bb00]/15 text-[#f5bb00]',
    created: 'bg-muted text-muted-foreground',
    completed: 'bg-[#3b82f6]/15 text-[#60a5fa]',
};

function formatRelative(ms) {
    if (!ms) return '';
    const diff = Math.max(0, Date.now() - ms);
    const s = Math.floor(diff / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ago`;
}

export default function Bracket() {
    const activeScoreboards = useSettingsStore(s => s?.scoreboards?.active ?? [1]);
    const bracketLink = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');

    const {
        loading, error,
        setSource, loadEvent, fetchPhases, fetchSets, fetchEntrants, loadSet, clearEvent,
    } = useTournament();

    const [prefetching, setPrefetching] = useState(false);
    const [statusText, setStatusText] = useState('');
    const prefetchInflightRef = useRef(false);

    // Pull all UI state from the persistent bracket store
    const bs = useBracketStore();
    const {
        tournament, phases, selectedPhase, selectedPool,
        includeFinished, loadedSets,
        update,
    } = bs;

    const url = bs.url ?? '';

    // ── Background prefetch: cache sets for every phase ───────
    // Fires after phases load. Keeps the Load button spinning (via
    // `prefetching`) so the user knows work is still happening, but does
    // NOT block the rest of the UI — phase selectors/tables remain
    // interactive and the existing on-demand fetch handles cache misses.
    const prefetchTournamentData = useCallback((phasesList, link) => {
        // Guard against concurrent invocations (Strict Mode double-effects, or
        // a manual Load that overlaps the auto-restore). Without this, two
        // runs share the same setStatusText and the counter visibly interleaves.
        if (prefetchInflightRef.current) return;

        const phasesToFetch = (phasesList || []).filter(p => p?.id != null);

        // Cache both completed-filter variants per phase so the "Include
        // completed" toggle is instant either way.
        const setJobs = phasesToFetch.flatMap(p => [
            { kind: 'sets', phase: p, finished: false },
            { kind: 'sets', phase: p, finished: true },
        ]);
        const entrantsAlreadyCached =
            link && useBracketStore.getState().entrantsLoadedFor === link;
        const jobs = entrantsAlreadyCached
            ? setJobs
            : [...setJobs, { kind: 'entrants' }];

        if (jobs.length === 0) return;

        prefetchInflightRef.current = true;
        setPrefetching(true);
        let done = 0;
        const total = jobs.length;
        setStatusText(`Caching tournament data (0/${total})…`);

        const fetchSetsJob = async ({ phase, finished }) => {
            const key = `${phase.id}|${null}|${finished}`;
            const existing = useBracketStore.getState().setsByKey?.[key];
            if (existing) return;
            const opts = { phaseId: Number(phase.id), includeFinished: finished };
            const first = await fetchSets(1, opts);
            if (!first) return;
            let collected = first.sets;
            const totalPages = first.pageInfo?.totalPages || 1;
            if (totalPages > 1) {
                const rest = await Promise.all(
                    Array.from({ length: totalPages - 1 }, (_, i) => fetchSets(i + 2, opts))
                );
                collected = collected.concat(...rest.filter(Boolean).map(r => r.sets));
            }
            update({
                setsByKey: { ...(useBracketStore.getState().setsByKey || {}), [key]: collected },
            });
        };

        const fetchEntrantsJob = async () => {
            const first = await fetchEntrants(1);
            if (!first) return;
            let collected = first.entrants;
            const totalPages = first.pageInfo?.totalPages || 1;
            if (totalPages > 1) {
                const rest = await Promise.all(
                    Array.from({ length: totalPages - 1 }, (_, i) => fetchEntrants(i + 2))
                );
                collected = collected.concat(...rest.filter(Boolean).map(r => r.entrants));
            }
            update({
                entrants: collected,
                entrantsPage: 1,
                entrantsTotalPages: 1,
                entrantsLoadedFor: link,
            });
        };

        Promise.all(jobs.map(j =>
            (j.kind === 'entrants' ? fetchEntrantsJob() : fetchSetsJob(j))
                .finally(() => {
                    done += 1;
                    setStatusText(`Caching tournament data (${done}/${total})…`);
                })
        )).finally(() => {
            prefetchInflightRef.current = false;
            setPrefetching(false);
            setStatusText('');
        });
    }, [fetchSets, fetchEntrants, update]);

    // Sync URL input from stored bracket_link on first render and auto-restore
    useEffect(() => {
        // After Clear, we suppress auto-load until the server's bracket_link
        // broadcast arrives (otherwise a stale bracketLink races a freshly
        // null tournament and reloads the event we just cleared).
        if (bs.suppressAutoLoad) {
            if (!bracketLink) update({ suppressAutoLoad: false });
            return;
        }
        // Skip if we already have tournament data in the store — switching tabs
        // shouldn't refetch. Only auto-restore on a true first load.
        if (tournament || !bracketLink) return;
        update({ url: bracketLink });
        setSource(bracketLink);
        (async () => {
            const result = await loadEvent(bracketLink);
            if (!result || result.error) return;
            const phaseUpdate = { tournament: result };
            const phasesResult = await fetchPhases();
            if (phasesResult) {
                phaseUpdate.phases = phasesResult;
                if (phasesResult.length === 1) {
                    phaseUpdate.selectedPhase = String(phasesResult[0].id);
                }
            }
            update(phaseUpdate);
            if (phasesResult) prefetchTournamentData(phasesResult, bracketLink);
        })();
    }, [bracketLink, tournament, bs.suppressAutoLoad, update, setSource, loadEvent, fetchPhases, prefetchTournamentData]);

    // ── Load event ────────────────────────────────────────────
    const handleLoadEvent = useCallback(async () => {
        if (!url.trim()) return;
        setStatusText('Loading tournament…');
        const result = await loadEvent(url.trim());
        if (!result || result.error) {
            setStatusText('');
            notifications.show({ message: result?.error || 'Failed to load tournament', color: 'red' });
            return;
        }

        notifications.show({ message: `Loaded: ${result.tournamentName}`, color: 'green' });

        update({
            tournament: result,
            sets: [],
            entrants: [],
            selectedPhase: null,
            selectedPool: null,
            loadedSets: {},
        });

        // Fetch phases immediately
        setStatusText('Fetching phases…');
        const phasesResult = await fetchPhases();
        if (phasesResult) {
            const phaseUpdate = { phases: phasesResult };
            // Auto-select first phase if only one
            if (phasesResult.length === 1) {
                phaseUpdate.selectedPhase = String(phasesResult[0].id);
            }
            update(phaseUpdate);
            prefetchTournamentData(phasesResult, url.trim());
        } else {
            setStatusText('');
        }
    }, [url, loadEvent, fetchPhases, update, prefetchTournamentData]);

    // ── Fetch sets ────────────────────────────────────────────
    // Single fetch path: page 1 sequentially (to learn totalPages), then
    // pages 2..N in parallel. Everything lands in `allSets` AND in
    // `setsByKey[allSetsKey]` so revisiting the same phase is instant.
    const allSetsKey = `${selectedPhase}|${selectedPool}|${includeFinished}`;
    const [setsFetching, setSetsFetching] = useState(false);
    const handleFetchSets = useCallback(async () => {
        if (!selectedPhase) return;
        const key = `${selectedPhase}|${selectedPool}|${includeFinished}`;
        setSetsFetching(true);
        try {
            const opts = { includeFinished };
            if (selectedPool) opts.phaseGroupId = Number(selectedPool);
            else opts.phaseId = Number(selectedPhase);

            const first = await fetchSets(1, opts);
            if (!first) return;
            let collected = first.sets;
            const total = first.pageInfo.totalPages || 1;
            if (total > 1) {
                const rest = await Promise.all(
                    Array.from({ length: total - 1 }, (_, i) => fetchSets(i + 2, opts))
                );
                collected = collected.concat(...rest.filter(Boolean).map(r => r.sets));
            }
            update({
                allSets: collected,
                allSetsLoadedFor: key,
                lastFetchedAt: Date.now(),
                setsByKey: { ...(useBracketStore.getState().setsByKey || {}), [key]: collected },
            });
        } finally {
            setSetsFetching(false);
        }
    }, [selectedPhase, selectedPool, includeFinished, fetchSets, update]);

    const handleClear = useCallback(async () => {
        update({ suppressAutoLoad: true });
        setStatusText('');
        await clearEvent();
        update({
            tournament: null,
            phases: [],
            selectedPhase: null,
            selectedPool: null,
            sets: [],
            setsPage: 1,
            setsTotalPages: 0,
            includeFinished: false,
            loadedSets: {},
            entrants: [],
            entrantsPage: 1,
            entrantsTotalPages: 0,
            entrantsLoadedFor: null,
            url: '',
            lastFetchedKey: null,
            lastFetchedAt: null,
            allSets: [],
            allSetsLoadedFor: null,
            setsByKey: {},
        });
        notifications.show({ message: 'Tournament cleared', color: 'gray' });
    }, [clearEvent, update]);

    const [playerSearch, setPlayerSearch] = useState('');
    const allSets = bs.allSets ?? [];
    const allSetsLoadedFor = bs.allSetsLoadedFor ?? null;

    const filteredSets = useMemo(() => {
        const q = playerSearch.trim().toLowerCase();
        if (!q) return allSets;
        return allSets.filter(s =>
            (s.p1_name || '').toLowerCase().includes(q) ||
            (s.p2_name || '').toLowerCase().includes(q)
        );
    }, [allSets, playerSearch]);

    const searching = playerSearch.trim().length > 0;

    // Re-render the "Updated Xs ago" label every 30s.
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!bs.lastFetchedAt) return;
        const id = setInterval(() => setTick(t => t + 1), 30_000);
        return () => clearInterval(id);
    }, [bs.lastFetchedAt]);

    // ── Load set into scoreboard ──────────────────────────────
    const handleLoadSet = useCallback(async (setId, sbNum) => {
        const result = await loadSet(setId, sbNum);
        if (result) {
            update({ loadedSets: { ...loadedSets, [sbNum]: setId } });
            notifications.show({ message: `Set loaded into Scoreboard ${sbNum}`, color: 'green' });
        } else {
            notifications.show({ message: 'Failed to load set', color: 'red' });
        }
    }, [loadSet, update, loadedSets]);

    // ── Auto-fetch sets when phase/pool/filter changes ────────
    useEffect(() => {
        if (!selectedPhase) return;
        // Skip refetch on tab remount when the cached sets already match the
        // current selection.
        if (allSetsLoadedFor === allSetsKey) return;
        handleFetchSets();
    }, [selectedPhase, selectedPool, includeFinished]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Phase/pool select data ────────────────────────────────
    const phaseOptions = (phases || []).map(p => ({ value: String(p.id), label: p.name }));

    const currentPhase = (phases || []).find(p => String(p.id) === selectedPhase);
    const poolOptions = currentPhase?.phaseGroups?.length > 1
        ? currentPhase.phaseGroups.map(g => ({
            value: String(g.id),
            label: `Pool ${g.displayIdentifier}`,
        }))
        : [];

    return (
        <Stack gap="md">
            <Title order={3}>Bracket</Title>

            {/* URL Input */}
            <Panel title="Load Tournament">
                <Stack gap="xs" className="p-4">
                    <div className="flex items-end gap-2">
                        <TextField
                            label="Tournament URL"
                            placeholder="https://start.gg/tournament/.../event/... or https://challonge.com/..."
                            description="Paste a start.gg event URL or Challonge tournament URL"
                            className="flex-1"
                            value={url}
                            onChange={e => update({ url: e.currentTarget.value })}
                            onKeyDown={e => e.key === 'Enter' && handleLoadEvent()}
                        />
                        <Button size="sm" onClick={handleLoadEvent} disabled={loading || prefetching}>
                            {(loading || prefetching) && <Loader size={12} />}
                            Load
                        </Button>
                        {tournament && (
                            <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" onClick={handleClear}>
                                Clear
                            </Button>
                        )}
                    </div>
                    {statusText && (
                        <div className="mt-1 flex items-center gap-2">
                            <Loader size={12} />
                            <Text size="xs" dimmed>{statusText}</Text>
                        </div>
                    )}
                </Stack>
            </Panel>

            {error && (
                <Alert variant="destructive">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Tournament Summary */}
            {tournament && (
                <Panel glow={false} className="p-3">
                    <div className="flex flex-wrap items-center gap-6">
                        <Text fw={600}>{tournament.tournamentName}</Text>
                        {tournament.eventName && (
                            <Badge variant="secondary">{tournament.eventName}</Badge>
                        )}
                        <Text size="sm" dimmed>
                            {tournament.numEntrants} entrants
                        </Text>
                        {tournament.address && (
                            <Text size="sm" dimmed>{tournament.address}</Text>
                        )}
                        {tournament.isOnline && (
                            <Badge className="bg-[#22b8cf] text-black">Online</Badge>
                        )}
                    </div>
                </Panel>
            )}

            {/* Phase / Pool Selectors + Fetch Sets */}
            {tournament && phases.length > 0 && (
                <Panel title="Phase & Pool">
                    <div className="flex flex-wrap items-end gap-3 p-4">
                        <div className="flex min-w-[200px] flex-col gap-1">
                            <Label className="field-label">Phase</Label>
                            <SimpleSelect
                                placeholder="Select phase"
                                data={phaseOptions}
                                value={selectedPhase}
                                onChange={(val) => {
                                    // Hydrate from per-phase cache when we have it.
                                    // Avoids the empty-table flash that triggers the
                                    // "loading sets" spinner on every phase switch.
                                    const key = `${val}|${null}|${includeFinished}`;
                                    const cached = bs.setsByKey?.[key];
                                    update({
                                        selectedPhase: val,
                                        selectedPool: null,
                                        allSets: cached ?? [],
                                        allSetsLoadedFor: cached ? key : null,
                                        setsPage: 1,
                                    });
                                }}
                            />
                        </div>
                        {poolOptions.length > 0 && (
                            <div className="flex min-w-[150px] flex-col gap-1">
                                <Label className="field-label">Pool</Label>
                                <SimpleSelect
                                    placeholder="All pools"
                                    data={poolOptions}
                                    value={selectedPool}
                                    onChange={(val) => {
                                        const key = `${selectedPhase}|${val}|${includeFinished}`;
                                        const cached = bs.setsByKey?.[key];
                                        update({
                                            selectedPool: val,
                                            allSets: cached ?? [],
                                            allSetsLoadedFor: cached ? key : null,
                                            setsPage: 1,
                                        });
                                    }}
                                />
                            </div>
                        )}
                        <Label className="flex h-9 items-center gap-2 text-sm">
                            <Checkbox
                                checked={includeFinished}
                                onCheckedChange={(checked) => {
                                    const newFinished = !!checked;
                                    const key = `${selectedPhase}|${selectedPool}|${newFinished}`;
                                    const cached = bs.setsByKey?.[key];
                                    update({
                                        includeFinished: newFinished,
                                        allSets: cached ?? [],
                                        allSetsLoadedFor: cached ? key : null,
                                        setsPage: 1,
                                    });
                                }}
                            />
                            Include completed
                        </Label>
                    </div>
                </Panel>
            )}

            {/* Loading state when fetching sets */}
            {setsFetching && allSets.length === 0 && (
                <Panel glow={false} className="p-8">
                    <div className="flex items-center justify-center gap-2">
                        <Loader size={18} />
                        <Text size="sm" dimmed>Loading sets…</Text>
                    </div>
                </Panel>
            )}

            {/* Sets Table */}
            {allSets.length > 0 && (
                <Panel
                    title={`Sets ${searching ? `(${filteredSets.length} of ${allSets.length})` : `(${allSets.length})`}`}
                    actions={
                        <>
                            {bs.lastFetchedAt && (
                                <Text size="xs" dimmed>Updated {formatRelative(bs.lastFetchedAt)}</Text>
                            )}
                            <Button size="xs" variant="secondary" onClick={() => handleFetchSets()} disabled={setsFetching}>
                                {setsFetching && <Loader size={10} />}
                                Refresh
                            </Button>
                        </>
                    }
                >
                    <Stack gap="sm" className="p-4">
                        <Input
                            placeholder="Search players"
                            value={playerSearch}
                            onChange={e => setPlayerSearch(e.currentTarget.value)}
                        />
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Round</TableHead>
                                    <TableHead>Player 1</TableHead>
                                    <TableHead className="text-center">Score</TableHead>
                                    <TableHead>Player 2</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Load</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSets.map(s => (
                                    <TableRow key={s.id}>
                                        <TableCell>
                                            <Text size="sm">{s.round_name}</Text>
                                            {s.tournament_phase && (
                                                <Text size="xs" dimmed>{s.tournament_phase}</Text>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Text size="sm" fw={500}>
                                                {s.p1_name || '—'}
                                                {s.p1_seed && <Text span size="xs" dimmed> ({s.p1_seed})</Text>}
                                            </Text>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <Text size="sm" fw={600} className="tabular-nums">
                                                {s.team1score ?? '—'} - {s.team2score ?? '—'}
                                            </Text>
                                        </TableCell>
                                        <TableCell>
                                            <Text size="sm" fw={500}>
                                                {s.p2_name || '—'}
                                                {s.p2_seed && <Text span size="xs" dimmed> ({s.p2_seed})</Text>}
                                            </Text>
                                        </TableCell>
                                        <TableCell>
                                            <Badge className={cn('text-[11px]', STATE_BADGE[s.state] || STATE_BADGE.created)}>
                                                {s.state}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                {activeScoreboards.map(sb => {
                                                    const isLoaded = loadedSets?.[sb] === s.id;
                                                    return (
                                                        <SimpleTooltip key={sb} label={`Load into Scoreboard ${sb}`}>
                                                            <Button
                                                                size="xs"
                                                                variant={isLoaded ? 'default' : 'secondary'}
                                                                className={cn(isLoaded && 'bg-[#22c55e] text-black hover:bg-[#22c55e]/90')}
                                                                onClick={() => handleLoadSet(s.id, sb)}
                                                                disabled={loading}
                                                            >
                                                                {activeScoreboards.length > 1 ? `SB${sb}` : 'Load'}
                                                            </Button>
                                                        </SimpleTooltip>
                                                    );
                                                })}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        {searching && filteredSets.length === 0 && (
                            <Text size="xs" dimmed ta="center">No sets match "{playerSearch}".</Text>
                        )}
                    </Stack>
                </Panel>
            )}

            {/* Empty state when no tournament loaded */}
            {!tournament && !loading && (
                <Panel glow={false} className="p-8">
                    <div className="flex flex-col items-center gap-2">
                        <Text size="sm" dimmed>
                            No tournament loaded. Paste a Start.gg or Challonge URL above to get started.
                        </Text>
                    </div>
                </Panel>
            )}

            {/* Empty state when tournament loaded but no sets for selected phase */}
            {tournament && selectedPhase && allSets.length === 0 && !loading && !setsFetching && (
                <Panel glow={false} className="p-8">
                    <div className="flex flex-col items-center gap-2">
                        <Text size="sm" dimmed>
                            No sets found for this phase. Try enabling "Include completed" or selecting a different phase.
                        </Text>
                    </div>
                </Panel>
            )}

        </Stack>
    );
}

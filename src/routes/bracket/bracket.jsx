import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Text, Paper, Stack, Group, TextInput, Button, Select, Table,
    Alert, Badge, Checkbox, Tooltip, Loader, Center,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useStateStore, useSettingsStore, useBracketStore } from '../../context/store';
import useTournament, { detectSource } from '../../hooks/useTournament';

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

const STATE_COLORS = {
    active: 'green',
    called: 'yellow',
    created: 'gray',
    completed: 'blue',
};

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
            <Text size="lg" fw={700}>Bracket</Text>

            {/* URL Input */}
            <Paper withBorder p="md">
                <Stack gap="xs">
                    <Group gap="sm" align="end">
                        <TextInput
                            label="Tournament URL"
                            placeholder="https://start.gg/tournament/.../event/... or https://challonge.com/..."
                            description="Paste a start.gg event URL or Challonge tournament URL"
                            style={{ flex: 1 }}
                            size="sm"
                            value={url}
                            onChange={e => update({ url: e.currentTarget.value })}
                            onKeyDown={e => e.key === 'Enter' && handleLoadEvent()}
                        />
                        <Button
                            size="sm"
                            onClick={handleLoadEvent}
                            loading={loading || prefetching}
                            mb={1}
                        >
                            Load
                        </Button>
                        {tournament && (
                            <Button
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={handleClear}
                                mb={1}
                            >
                                Clear
                            </Button>
                        )}
                    </Group>
                    {statusText && (
                        <Group gap="xs" mt={4}>
                            <Loader size="xs" />
                            <Text size="xs" c="dimmed">{statusText}</Text>
                        </Group>
                    )}
                </Stack>
            </Paper>

            {error && (
                <Alert variant="light" color="red" title="Error">
                    {error}
                </Alert>
            )}

            {/* Tournament Summary */}
            {tournament && (
                <Paper withBorder p="sm">
                    <Group gap="lg">
                        <Text fw={600}>{tournament.tournamentName}</Text>
                        {tournament.eventName && (
                            <Badge variant="light">{tournament.eventName}</Badge>
                        )}
                        <Text size="sm" c="dimmed">
                            {tournament.numEntrants} entrants
                        </Text>
                        {tournament.address && (
                            <Text size="sm" c="dimmed">{tournament.address}</Text>
                        )}
                        {tournament.isOnline && (
                            <Badge variant="light" color="cyan" size="sm">Online</Badge>
                        )}
                    </Group>
                </Paper>
            )}

            {/* Phase / Pool Selectors + Fetch Sets */}
            {tournament && phases.length > 0 && (
                <Paper withBorder p="md">
                    <Stack gap="sm">
                        <Group gap="sm" align="end">
                            <Select
                                label="Phase"
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
                                size="sm"
                                style={{ minWidth: 200 }}
                            />
                            {poolOptions.length > 0 && (
                                <Select
                                    label="Pool"
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
                                    clearable
                                    size="sm"
                                    style={{ minWidth: 150 }}
                                />
                            )}
                            <div style={{
                                alignSelf: 'flex-end',
                                display: 'flex',
                                alignItems: 'center',
                                height: 30, // matches Mantine Select size="sm" input height
                            }}>
                                <Checkbox
                                    label="Include completed"
                                    checked={includeFinished}
                                    onChange={e => {
                                        const newFinished = e.currentTarget.checked;
                                        const key = `${selectedPhase}|${selectedPool}|${newFinished}`;
                                        const cached = bs.setsByKey?.[key];
                                        update({
                                            includeFinished: newFinished,
                                            allSets: cached ?? [],
                                            allSetsLoadedFor: cached ? key : null,
                                            setsPage: 1,
                                        });
                                    }}
                                    size="sm"
                                />
                            </div>
                        </Group>
                    </Stack>
                </Paper>
            )}

            {/* Loading state when fetching sets */}
            {setsFetching && allSets.length === 0 && (
                <Paper withBorder p="xl">
                    <Center>
                        <Group gap="sm">
                            <Loader size="sm" />
                            <Text size="sm" c="dimmed">Loading sets…</Text>
                        </Group>
                    </Center>
                </Paper>
            )}

            {/* Sets Table */}
            {allSets.length > 0 && (
                <Paper withBorder p="md">
                    <Stack gap="sm">
                        <Group justify="space-between" align="center">
                            <Text fw={600} size="sm">
                                Sets {searching
                                    ? `(${filteredSets.length} of ${allSets.length})`
                                    : `(${allSets.length})`}
                            </Text>
                            <Group gap="xs">
                                {bs.lastFetchedAt && (
                                    <Text size="xs" c="dimmed">
                                        Updated {formatRelative(bs.lastFetchedAt)}
                                    </Text>
                                )}
                                <Button
                                    size="compact-xs"
                                    variant="light"
                                    onClick={() => handleFetchSets()}
                                    loading={setsFetching}
                                >
                                    Refresh
                                </Button>
                            </Group>
                        </Group>
                        <TextInput
                            placeholder="Search players"
                            value={playerSearch}
                            onChange={e => setPlayerSearch(e.currentTarget.value)}
                            size="xs"
                        />
                        <Table striped highlightOnHover withTableBorder>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Round</Table.Th>
                                    <Table.Th>Player 1</Table.Th>
                                    <Table.Th style={{ textAlign: 'center' }}>Score</Table.Th>
                                    <Table.Th>Player 2</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th>Load</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {filteredSets.map(s => (
                                    <Table.Tr key={s.id}>
                                        <Table.Td>
                                            <Text size="sm">{s.round_name}</Text>
                                            {s.tournament_phase && (
                                                <Text size="xs" c="dimmed">{s.tournament_phase}</Text>
                                            )}
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm" fw={500}>
                                                {s.p1_name || '—'}
                                                {s.p1_seed && <Text span size="xs" c="dimmed"> ({s.p1_seed})</Text>}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td style={{ textAlign: 'center' }}>
                                            <Text size="sm" fw={600}>
                                                {s.team1score ?? '—'} - {s.team2score ?? '—'}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm" fw={500}>
                                                {s.p2_name || '—'}
                                                {s.p2_seed && <Text span size="xs" c="dimmed"> ({s.p2_seed})</Text>}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                size="sm"
                                                variant="light"
                                                color={STATE_COLORS[s.state] || 'gray'}
                                            >
                                                {s.state}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap={4}>
                                                {activeScoreboards.map(sb => {
                                                    const isLoaded = loadedSets?.[sb] === s.id;
                                                    return (
                                                        <Tooltip key={sb} label={`Load into Scoreboard ${sb}`}>
                                                            <Button
                                                                size="compact-xs"
                                                                variant={isLoaded ? 'filled' : 'light'}
                                                                color={isLoaded ? 'green' : 'blue'}
                                                                onClick={() => handleLoadSet(s.id, sb)}
                                                                loading={loading}
                                                            >
                                                                {activeScoreboards.length > 1 ? `SB${sb}` : 'Load'}
                                                            </Button>
                                                        </Tooltip>
                                                    );
                                                })}
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                        {searching && filteredSets.length === 0 && (
                            <Text size="xs" c="dimmed" ta="center">No sets match "{playerSearch}".</Text>
                        )}
                    </Stack>
                </Paper>
            )}

            {/* Empty state when no tournament loaded */}
            {!tournament && !loading && (
                <Paper withBorder p="xl">
                    <Stack align="center" gap="xs">
                        <Text size="sm" c="dimmed">
                            No tournament loaded. Paste a Start.gg or Challonge URL above to get started.
                        </Text>
                    </Stack>
                </Paper>
            )}

            {/* Empty state when tournament loaded but no sets for selected phase */}
            {tournament && selectedPhase && allSets.length === 0 && !loading && !setsFetching && (
                <Paper withBorder p="xl">
                    <Stack align="center" gap="xs">
                        <Text size="sm" c="dimmed">
                            No sets found for this phase. Try enabling "Include completed" or selecting a different phase.
                        </Text>
                    </Stack>
                </Paper>
            )}

        </Stack>
    );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, Text, Title, Loader } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { SimpleSelect } from '../../components/ui/simple-select';
import { Badge } from '../../components/ui/badge';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useStateStore, useSettingsStore, useBracketStore } from '../../context/store';
import useTournament, { detectSource } from '../../hooks/useTournament';
import { loadStartGGSetToMatch } from '../../context/match';

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
        loading,
        setSource, fetchSets, loadSet,
    } = useTournament();

    // Pull all UI state from the persistent bracket store. Loading/clearing a
    // tournament now lives in the shared TournamentLoader (above the section
    // switch); this view only reads what the loader put in the store.
    const bs = useBracketStore();
    const {
        tournament, phases, selectedPhase, selectedPool,
        includeFinished, loadedSets,
        update,
    } = bs;

    // Restore this hook instance's source from the persisted link so fetchSets/
    // loadSet hit the right provider (start.gg is the default; Challonge needs
    // this). The loader owns the actual fetching.
    useEffect(() => {
        if (bracketLink) setSource(bracketLink);
    }, [bracketLink, setSource]);

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

    // start.gg is match-first: a set loads into a Match (created or reused), and
    // the producer binds that match to a board on the Match tab. Challonge
    // (deprecated, no Match model) keeps the legacy direct-to-scoreboard path.
    const isStartGG = detectSource(bracketLink) === 'startgg';

    // ── Load set into a match (start.gg) ──────────────────────
    const [loadedMatches, setLoadedMatches] = useState({}); // setId -> matchId
    const handleLoadToMatch = useCallback(async (s) => {
        try {
            const result = await loadStartGGSetToMatch(s.id);
            setLoadedMatches(prev => ({ ...prev, [s.id]: result.id }));
            notifications.show({
                message: `${result.created ? 'Created' : 'Updated'} Match ${result.id} — bind it to a board on the Match tab`,
                color: 'green',
            });
        } catch (e) {
            notifications.show({ message: e?.message || 'Failed to load set', color: 'red' });
        }
    }, []);

    // ── Load set into scoreboard (Challonge legacy) ───────────
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
                                    <TableHead>{isStartGG ? 'Match' : 'Load'}</TableHead>
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
                                            {isStartGG ? (
                                                <SimpleTooltip label="Load this set into a match — bind it to a board on the Match tab">
                                                    <Button
                                                        size="xs"
                                                        variant={loadedMatches[s.id] ? 'default' : 'secondary'}
                                                        className={cn(loadedMatches[s.id] && 'bg-[#22c55e] text-black hover:bg-[#22c55e]/90')}
                                                        onClick={() => handleLoadToMatch(s)}
                                                        disabled={loading || !s.p1_name || !s.p2_name}
                                                    >
                                                        {loadedMatches[s.id] ? `Match ${loadedMatches[s.id]}` : 'Load to Match'}
                                                    </Button>
                                                </SimpleTooltip>
                                            ) : (
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
                                            )}
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

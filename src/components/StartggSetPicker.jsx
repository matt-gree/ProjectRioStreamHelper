import { useCallback, useMemo, useState } from 'react';
import { useBracketStore } from '../context/store';
import useTournament from '../hooks/useTournament';
import { SimpleSelect } from './ui/simple-select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Stack, Group, Text, Loader } from './ui/primitives';

/*
 * StartggSetPicker — pick one set from the loaded start.gg event.
 *
 * Shared by the Match tab and the Production Draft bar ("Load from start.gg"):
 * phase select → set list (cached per phase in the bracket store, same key
 * scheme as the Bracket view) → onPick(set). The picker only CHOOSES a set;
 * what picking means (load into a match, staged or immediate) is the caller's.
 * Needs a tournament loaded on the Competition tab — points there otherwise.
 */
export default function StartggSetPicker({ onPick, pickLabel = 'Load' }) {
    const phases = useBracketStore(s => s.phases) || [];
    const setsByKey = useBracketStore(s => s.setsByKey) || {};
    const update = useBracketStore(s => s.update);
    const { fetchSets } = useTournament();

    const [phaseId, setPhaseId] = useState(phases[0] ? String(phases[0].id) : null);
    const [search, setSearch] = useState('');
    const [fetching, setFetching] = useState(false);

    // Same cache key the Bracket view uses (no pool filter here) so a phase the
    // producer already browsed is instant.
    const cacheKey = `${phaseId}|${null}|false`;
    const sets = setsByKey[cacheKey];

    const load = useCallback(async () => {
        if (!phaseId) return;
        setFetching(true);
        try {
            const opts = { phaseId: Number(phaseId) };
            const first = await fetchSets(1, opts);
            if (!first) return;
            let collected = first.sets;
            const total = first.pageInfo?.totalPages || 1;
            if (total > 1) {
                const rest = await Promise.all(
                    Array.from({ length: total - 1 }, (_, i) => fetchSets(i + 2, opts)));
                collected = collected.concat(...rest.filter(Boolean).map(r => r.sets));
            }
            update({
                setsByKey: { ...(useBracketStore.getState().setsByKey || {}), [cacheKey]: collected },
            });
        } finally {
            setFetching(false);
        }
    }, [phaseId, cacheKey, fetchSets, update]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return sets || [];
        return (sets || []).filter(s =>
            (s.p1_name || '').toLowerCase().includes(q) ||
            (s.p2_name || '').toLowerCase().includes(q));
    }, [sets, search]);

    if (phases.length === 0) {
        return (
            <Text size="sm" className="text-muted-foreground">
                No tournament loaded — load a start.gg event on the Competition tab first.
            </Text>
        );
    }

    return (
        <Stack gap="sm">
            <Group gap="xs" className="flex-nowrap items-center">
                <div className="min-w-0 flex-1">
                    <SimpleSelect
                        placeholder="Phase"
                        data={phases.map(p => ({ value: String(p.id), label: p.name }))}
                        value={phaseId || undefined}
                        onChange={setPhaseId}
                    />
                </div>
                <Button size="sm" variant="secondary" disabled={!phaseId || fetching} onClick={load}>
                    {fetching ? <Loader size={14} /> : (sets ? 'Refresh' : 'Fetch sets')}
                </Button>
            </Group>

            {sets && sets.length > 3 && (
                <Input
                    className="h-8"
                    placeholder="Filter by player…"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                />
            )}

            {sets && (
                filtered.length === 0 ? (
                    <Text size="sm" className="text-muted-foreground">No open sets in this phase.</Text>
                ) : (
                    <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                        {filtered.map(s => (
                            <div
                                key={s.id}
                                className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5 last:border-b-0"
                            >
                                <Stack gap="none" className="min-w-0 flex-1">
                                    <Text size="sm" className="truncate text-foreground">
                                        {s.p1_name || 'TBD'} <span className="text-muted-foreground">vs</span> {s.p2_name || 'TBD'}
                                    </Text>
                                    <Text size="xs" className="truncate text-muted-foreground">{s.round_name}</Text>
                                </Stack>
                                <Button
                                    size="xs"
                                    variant="secondary"
                                    disabled={!s.p1_name || !s.p2_name}
                                    onClick={() => onPick(s)}
                                >
                                    {pickLabel}
                                </Button>
                            </div>
                        ))}
                    </div>
                )
            )}
        </Stack>
    );
}

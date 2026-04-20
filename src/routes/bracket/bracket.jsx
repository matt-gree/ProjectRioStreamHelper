import { useCallback, useEffect } from 'react';
import {
    Text, Paper, Stack, Group, TextInput, Button, Select, Table,
    Alert, Badge, Checkbox, Pagination, Tooltip, Skeleton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useStateStore, useSettingsStore, useBracketStore } from '../../context/store';
import useTournament, { detectSource } from '../../hooks/useTournament';

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
        setSource, loadEvent, fetchPhases, fetchSets, loadSet,
    } = useTournament();

    // Pull all UI state from the persistent bracket store
    const bs = useBracketStore();
    const {
        tournament, phases, selectedPhase, selectedPool,
        sets, setsPage, setsTotalPages, includeFinished, loadedSets,
        update,
    } = bs;

    // Sync URL input from stored bracket_link on first render and auto-restore
    const url = bs.url ?? '';
    const initialized = bs.initialized ?? false;
    useEffect(() => {
        if (!initialized && bracketLink) {
            update({ url: bracketLink, initialized: true });
            setSource(bracketLink);
            // Auto-restore: load event + phases from the persisted bracket_link
            (async () => {
                const result = await loadEvent(bracketLink);
                if (!result) return;
                const phaseUpdate = { tournament: result };
                const phasesResult = await fetchPhases();
                if (phasesResult) {
                    phaseUpdate.phases = phasesResult;
                    if (phasesResult.length === 1) {
                        phaseUpdate.selectedPhase = String(phasesResult[0].id);
                    }
                }
                update(phaseUpdate);
            })();
        }
    }, [bracketLink, initialized, update, loadEvent, fetchPhases]);

    // ── Load event ────────────────────────────────────────────
    const handleLoadEvent = useCallback(async () => {
        if (!url.trim()) return;
        const result = await loadEvent(url.trim());
        if (!result) {
            notifications.show({ message: 'Failed to load tournament', color: 'red' });
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
        const phasesResult = await fetchPhases();
        if (phasesResult) {
            const phaseUpdate = { phases: phasesResult };
            // Auto-select first phase if only one
            if (phasesResult.length === 1) {
                phaseUpdate.selectedPhase = String(phasesResult[0].id);
            }
            update(phaseUpdate);
        }
    }, [url, loadEvent, fetchPhases, update]);

    // ── Fetch sets ────────────────────────────────────────────
    const handleFetchSets = useCallback(async (page = 1) => {
        const opts = { includeFinished };
        if (selectedPool) {
            opts.phaseGroupId = Number(selectedPool);
        } else if (selectedPhase) {
            opts.phaseId = Number(selectedPhase);
        }
        const result = await fetchSets(page, opts);
        if (result) {
            update({
                sets: result.sets,
                setsPage: result.pageInfo.page,
                setsTotalPages: result.pageInfo.totalPages,
            });
        }
    }, [selectedPhase, selectedPool, includeFinished, fetchSets, update]);

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
        if (selectedPhase) {
            handleFetchSets(1);
        }
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
                            loading={loading}
                            mb={1}
                        >
                            Load
                        </Button>
                    </Group>
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
                                    update({
                                        selectedPhase: val,
                                        selectedPool: null,
                                        sets: [],
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
                                        update({
                                            selectedPool: val,
                                            sets: [],
                                        });
                                    }}
                                    clearable
                                    size="sm"
                                    style={{ minWidth: 150 }}
                                />
                            )}
                            <Checkbox
                                label="Include completed"
                                checked={includeFinished}
                                onChange={e => {
                                    update({
                                        includeFinished: e.currentTarget.checked,
                                        sets: [],
                                    });
                                }}
                                size="sm"
                                mt="lg"
                            />
                        </Group>
                    </Stack>
                </Paper>
            )}

            {/* Sets Table */}
            {sets.length > 0 && (
                <Paper withBorder p="md">
                    <Stack gap="sm">
                        <Text fw={600} size="sm">
                            Sets {setsTotalPages > 1 && `(Page ${setsPage}/${setsTotalPages})`}
                        </Text>
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
                                {sets.map(s => (
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

                        {setsTotalPages > 1 && (
                            <Group justify="center">
                                <Pagination
                                    total={setsTotalPages}
                                    value={setsPage}
                                    onChange={(page) => handleFetchSets(page)}
                                    size="sm"
                                />
                            </Group>
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
            {tournament && selectedPhase && sets.length === 0 && !loading && (
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

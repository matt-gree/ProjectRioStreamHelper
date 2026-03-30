import { useCallback, useState, useEffect, useMemo } from 'react';
import {
    TextInput, NumberInput, Stack, Paper, Text, Grid, Group, Divider, Button,
    Popover, Alert, Table, Pagination, ScrollArea, UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { FormattedMessage } from 'react-intl';
import { useStateStore } from '../../context/store';
import useTournament from '../../hooks/useTournament';

export default function TournamentInfo() {
    const setItem = useStateStore(s => s.setItem);

    // Subscribe to individual fields to avoid referential equality issues
    const name         = useStateStore(s => s?.tournamentInfo?.name ?? '');
    const abbreviation = useStateStore(s => s?.tournamentInfo?.abbreviation ?? '');
    const location     = useStateStore(s => s?.tournamentInfo?.location ?? '');
    const date         = useStateStore(s => s?.tournamentInfo?.date ?? '');
    const entrants     = useStateStore(s => s?.tournamentInfo?.entrants ?? '');
    const prize_pool   = useStateStore(s => s?.tournamentInfo?.prize_pool ?? '');
    const bracket_link = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');

    // Organizer fields
    const org0name    = useStateStore(s => s?.tournamentInfo?.organizer_0_name ?? '');
    const org0twitter = useStateStore(s => s?.tournamentInfo?.organizer_0_twitter ?? '');
    const org0pronoun = useStateStore(s => s?.tournamentInfo?.organizer_0_pronoun ?? '');
    const org1name    = useStateStore(s => s?.tournamentInfo?.organizer_1_name ?? '');
    const org1twitter = useStateStore(s => s?.tournamentInfo?.organizer_1_twitter ?? '');
    const org1pronoun = useStateStore(s => s?.tournamentInfo?.organizer_1_pronoun ?? '');
    const org2name    = useStateStore(s => s?.tournamentInfo?.organizer_2_name ?? '');
    const org2twitter = useStateStore(s => s?.tournamentInfo?.organizer_2_twitter ?? '');
    const org2pronoun = useStateStore(s => s?.tournamentInfo?.organizer_2_pronoun ?? '');

    const orgFields = [
        { name: org0name, twitter: org0twitter, pronoun: org0pronoun },
        { name: org1name, twitter: org1twitter, pronoun: org1pronoun },
        { name: org2name, twitter: org2twitter, pronoun: org2pronoun },
    ];

    const { loading: sggLoading, error: sggError, setSource, loadEvent, fetchEntrants } = useTournament();
    const [sggUrl, setSggUrl] = useState(bracket_link);
    const [sggOpen, setSggOpen] = useState(false);

    // Entrants list
    const [entrantsList, setEntrantsList] = useState([]);
    const [entrantsPage, setEntrantsPage] = useState(1);
    const [entrantsTotalPages, setEntrantsTotalPages] = useState(0);
    const [entrantsLoaded, setEntrantsLoaded] = useState(false);
    const [entrantsLoading, setEntrantsLoading] = useState(false);

    const handleFetchEntrants = useCallback(async (page = 1) => {
        setEntrantsLoading(true);
        const result = await fetchEntrants(page);
        if (result) {
            setEntrantsList(result.entrants);
            setEntrantsPage(result.pageInfo.page);
            setEntrantsTotalPages(result.pageInfo.totalPages);
        }
        setEntrantsLoading(false);
    }, [fetchEntrants]);

    // Entrants sorting
    const [sortField, setSortField] = useState('seed');
    const [sortDir, setSortDir] = useState('asc');

    const ENTRANT_COLUMNS = [
        { field: 'seed', label: 'Seed' },
        { field: 'tag', label: 'Tag' },
        { field: 'prefix', label: 'Prefix' },
        { field: 'full_name', label: 'Name' },
        { field: 'pronoun', label: 'Pronouns' },
        { field: 'country', label: 'Country' },
        { field: 'state', label: 'State' },
    ];

    const handleSort = useCallback((field) => {
        setSortDir(prev => sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortField(field);
    }, [sortField]);

    const getPlayerField = useCallback((entrant, field) => {
        const p = entrant.players?.[0] || {};
        if (field === 'seed') return entrant.seed;
        if (field === 'tag') return p.gamerTag || entrant.name || '';
        if (field === 'prefix') return p.prefix || '';
        return p[field] || '';
    }, []);

    const sortedEntrants = useMemo(() => {
        if (!entrantsList.length) return entrantsList;
        const list = [...entrantsList];
        const dir = sortDir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
            const valA = getPlayerField(a, sortField);
            const valB = getPlayerField(b, sortField);
            if (sortField === 'seed') {
                return dir * ((valA ?? 9999) - (valB ?? 9999));
            }
            return dir * String(valA).toLowerCase().localeCompare(String(valB).toLowerCase());
        });
        return list;
    }, [entrantsList, sortField, sortDir, getPlayerField]);

    // Auto-fetch entrants when bracket_link is set and not yet loaded
    useEffect(() => {
        if (bracket_link && !entrantsLoaded) {
            setSource(bracket_link);
            setEntrantsLoaded(true);
            handleFetchEntrants(1);
        }
        if (!bracket_link) {
            setEntrantsLoaded(false);
            setEntrantsList([]);
        }
    }, [bracket_link]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep sggUrl in sync when bracket_link updates from elsewhere (e.g. bracket tab)
    useEffect(() => {
        if (bracket_link && !sggOpen) setSggUrl(bracket_link);
    }, [bracket_link, sggOpen]);

    const set = useCallback((field, value) => {
        setItem(`tournamentInfo.${field}`, value);
    }, [setItem]);

    const handleSetTournament = useCallback(async () => {
        if (!sggUrl.trim()) return;
        const result = await loadEvent(sggUrl.trim());
        if (result) {
            setSggOpen(false);
            notifications.show({ message: `Tournament loaded: ${result.tournamentName}`, color: 'green' });
        } else {
            notifications.show({ message: 'Failed to load tournament', color: 'red' });
        }
    }, [sggUrl, loadEvent]);

    return (
        <Grid gutter="md">
            {/* Left column — Tournament form */}
            <Grid.Col span={bracket_link ? 4 : 12}>
                <Stack gap="md">
                    <Group justify="space-between">
                        <Text size="lg" fw={700}>Tournament Info</Text>
                        <Popover opened={sggOpen} onChange={setSggOpen} width={400} position="bottom-end">
                            <Popover.Target>
                                <Button variant="outline" size="xs" onClick={() => setSggOpen(o => !o)}>
                                    <FormattedMessage
                                        id="tsh.set_tournament"
                                        defaultMessage="Set Tournament"
                                    />
                                </Button>
                            </Popover.Target>
                            <Popover.Dropdown>
                                <Stack gap="xs">
                                    <TextInput
                                        label="Tournament URL"
                                        placeholder="https://start.gg/... or https://challonge.com/..."
                                        size="sm"
                                        value={sggUrl}
                                        onChange={e => setSggUrl(e.currentTarget.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSetTournament()}
                                    />
                                    {sggError && (
                                        <Alert variant="light" color="red" p="xs">
                                            <Text size="xs">{sggError}</Text>
                                        </Alert>
                                    )}
                                    <Button
                                        size="xs"
                                        onClick={handleSetTournament}
                                        loading={sggLoading}
                                        fullWidth
                                    >
                                        Load Tournament
                                    </Button>
                                </Stack>
                            </Popover.Dropdown>
                        </Popover>
                    </Group>
                    <Paper withBorder p="md">
                        <Stack gap="sm">
                            <Grid gutter="sm">
                                <Grid.Col span={8}>
                                    <TextInput
                                        label="Tournament Name"
                                        placeholder="Enter tournament name"
                                        size="sm"
                                        value={name}
                                        onChange={e => set('name', e.currentTarget.value)}
                                    />
                                </Grid.Col>
                                <Grid.Col span={4}>
                                    <TextInput
                                        label="Abbreviation"
                                        placeholder="Short name"
                                        size="sm"
                                        value={abbreviation}
                                        onChange={e => set('abbreviation', e.currentTarget.value)}
                                    />
                                </Grid.Col>
                            </Grid>

                            <Grid gutter="sm">
                                <Grid.Col span={8}>
                                    <TextInput
                                        label="Location"
                                        placeholder="City, State"
                                        size="sm"
                                        value={location}
                                        onChange={e => set('location', e.currentTarget.value)}
                                    />
                                </Grid.Col>
                                <Grid.Col span={4}>
                                    <TextInput
                                        label="Date"
                                        placeholder="YYYY-MM-DD"
                                        size="sm"
                                        value={date}
                                        onChange={e => set('date', e.currentTarget.value)}
                                    />
                                </Grid.Col>
                            </Grid>

                            <Divider />

                            <Grid gutter="sm">
                                <Grid.Col span={4}>
                                    <TextInput
                                        label="Entrants"
                                        placeholder="0"
                                        size="sm"
                                        value={String(entrants)}
                                        onChange={e => set('entrants', e.currentTarget.value)}
                                    />
                                </Grid.Col>
                                <Grid.Col span={8}>
                                    <TextInput
                                        label="Prize Pool"
                                        placeholder="$0"
                                        size="sm"
                                        value={prize_pool}
                                        onChange={e => set('prize_pool', e.currentTarget.value)}
                                    />
                                </Grid.Col>
                            </Grid>

                            <TextInput
                                label="Bracket Link"
                                placeholder="https://start.gg/... or https://challonge.com/..."
                                size="sm"
                                value={bracket_link}
                                onChange={e => set('bracket_link', e.currentTarget.value)}
                            />

                            <Divider label="Organizers" labelPosition="center" />

                            {orgFields.map((org, i) => (
                                <Grid gutter="xs" key={i}>
                                    <Grid.Col span={4}>
                                        <TextInput
                                            label={i === 0 ? "Organizer" : undefined}
                                            placeholder={`Organizer ${i + 1}`}
                                            size="xs"
                                            value={org.name}
                                            onChange={e => set(`organizer_${i}_name`, e.currentTarget.value)}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <TextInput
                                            label={i === 0 ? "Twitter" : undefined}
                                            placeholder="@handle"
                                            size="xs"
                                            value={org.twitter}
                                            onChange={e => set(`organizer_${i}_twitter`, e.currentTarget.value)}
                                        />
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <TextInput
                                            label={i === 0 ? "Pronoun" : undefined}
                                            placeholder="Pronoun"
                                            size="xs"
                                            value={org.pronoun}
                                            onChange={e => set(`organizer_${i}_pronoun`, e.currentTarget.value)}
                                        />
                                    </Grid.Col>
                                </Grid>
                            ))}
                        </Stack>
                    </Paper>
                </Stack>
            </Grid.Col>

            {/* Right column — Entrants list */}
            {bracket_link && (
                <Grid.Col span={8}>
                    <Paper withBorder p="md">
                        <Stack gap="sm">
                            <Text fw={600} size="sm">Entrants</Text>
                            <ScrollArea h="calc(100vh - 200px)" offsetScrollbars>
                                {entrantsList.length > 0 ? (
                                    <Table striped highlightOnHover withTableBorder style={{ tableLayout: 'auto' }}>
                                        <Table.Thead>
                                            <Table.Tr>
                                                {ENTRANT_COLUMNS.map(col => (
                                                    <Table.Th key={col.field} style={{ whiteSpace: 'nowrap' }}>
                                                        <UnstyledButton onClick={() => handleSort(col.field)}>
                                                            <Group gap={4} wrap="nowrap">
                                                                <Text size="xs" fw={600}>{col.label}</Text>
                                                                <Text size="xs" c="dimmed">
                                                                    {sortField === col.field ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25BC'}
                                                                </Text>
                                                            </Group>
                                                        </UnstyledButton>
                                                    </Table.Th>
                                                ))}
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {sortedEntrants.map(e => (
                                                <Table.Tr key={e.id}>
                                                    {ENTRANT_COLUMNS.map(col => (
                                                        <Table.Td key={col.field}>
                                                            <Text size="xs" truncate>
                                                                {getPlayerField(e, col.field) || '—'}
                                                            </Text>
                                                        </Table.Td>
                                                    ))}
                                                </Table.Tr>
                                            ))}
                                        </Table.Tbody>
                                    </Table>
                                ) : (
                                    <Text size="sm" c="dimmed">
                                        {entrantsLoading ? 'Loading...' : 'No entrants found.'}
                                    </Text>
                                )}
                            </ScrollArea>
                            {entrantsTotalPages > 1 && (
                                <Group justify="center">
                                    <Pagination
                                        total={entrantsTotalPages}
                                        value={entrantsPage}
                                        onChange={(page) => handleFetchEntrants(page)}
                                        size="sm"
                                    />
                                </Group>
                            )}
                        </Stack>
                    </Paper>
                </Grid.Col>
            )}
        </Grid>
    );
}

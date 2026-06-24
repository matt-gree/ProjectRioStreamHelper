import { useCallback, useState, useEffect, useMemo } from 'react';
import { Stack, Text, Title, Divider } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Button } from '../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { ScrollArea } from '../../components/ui/scroll-area';
import { SimplePagination } from '../../components/ui/simple-pagination';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { Loader } from '../../components/ui/primitives';
import { notifications } from '../../lib/notify';
import { FormattedMessage } from 'react-intl';
import { useStateStore, useBracketStore } from '../../context/store';
import useTournament from '../../hooks/useTournament';

export default function TournamentInfo() {
    const setItem = useStateStore(s => s.setItem);

    // Subscribe to individual fields to avoid referential equality issues
    const name         = useStateStore(s => s?.tournamentInfo?.name ?? '');
    const phase        = useStateStore(s => s?.tournamentInfo?.phase ?? '');
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

    // Entrants list — persisted in the bracket store so switching tabs
    // doesn't trigger a refetch.
    const entrantsList = useBracketStore(s => s.entrants);
    const entrantsPage = useBracketStore(s => s.entrantsPage);
    const entrantsTotalPages = useBracketStore(s => s.entrantsTotalPages);
    const entrantsLoadedFor = useBracketStore(s => s.entrantsLoadedFor);
    const updateBracket = useBracketStore(s => s.update);
    const [entrantsLoading, setEntrantsLoading] = useState(false);

    const handleFetchEntrants = useCallback(async (page = 1) => {
        setEntrantsLoading(true);
        const result = await fetchEntrants(page);
        if (result) {
            updateBracket({
                entrants: result.entrants,
                entrantsPage: result.pageInfo.page,
                entrantsTotalPages: result.pageInfo.totalPages,
                entrantsLoadedFor: bracket_link,
            });
        }
        setEntrantsLoading(false);
    }, [fetchEntrants, updateBracket, bracket_link]);

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

    // Auto-fetch entrants when bracket_link is set and we haven't already
    // loaded entrants for that exact link.
    useEffect(() => {
        if (bracket_link && entrantsLoadedFor !== bracket_link) {
            setSource(bracket_link);
            handleFetchEntrants(1);
        }
        if (!bracket_link && entrantsLoadedFor) {
            updateBracket({ entrants: [], entrantsPage: 1, entrantsTotalPages: 0, entrantsLoadedFor: null });
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
        if (result && !result.error) {
            setSggOpen(false);
            notifications.show({ message: `Tournament loaded: ${result.tournamentName}`, color: 'green' });
        } else {
            notifications.show({ message: result?.error || 'Failed to load tournament', color: 'red' });
        }
    }, [sggUrl, loadEvent]);

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* Left column — Tournament form */}
            <div className={bracket_link ? 'md:col-span-4' : 'md:col-span-12'}>
                <Stack gap="md">
                    <div className="flex items-center justify-between">
                        <Title order={3}>Competition Info</Title>
                        <Popover open={sggOpen} onOpenChange={setSggOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm">
                                    <FormattedMessage id="tsh.set_tournament" defaultMessage="Set Tournament" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-[400px]">
                                <Stack gap="xs">
                                    <TextField
                                        label="Tournament URL"
                                        placeholder="https://start.gg/... or https://challonge.com/..."
                                        value={sggUrl}
                                        onChange={e => setSggUrl(e.currentTarget.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSetTournament()}
                                    />
                                    {sggError && (
                                        <Alert variant="destructive" className="p-2">
                                            <AlertDescription className="text-xs">{sggError}</AlertDescription>
                                        </Alert>
                                    )}
                                    <Button size="sm" className="w-full" onClick={handleSetTournament} disabled={sggLoading}>
                                        {sggLoading && <Loader size={12} />}
                                        Load Tournament
                                    </Button>
                                </Stack>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <Panel title="Details">
                        <Stack gap="sm" className="p-4">
                            <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-8">
                                    <TextField label="Competition Name" placeholder="Enter competition name" value={name} onChange={e => set('name', e.currentTarget.value)} />
                                </div>
                                <div className="col-span-4">
                                    <TextField label="Abbreviation" placeholder="Short name" value={abbreviation} onChange={e => set('abbreviation', e.currentTarget.value)} />
                                </div>
                            </div>

                            <TextField label="Competition Phase" placeholder="e.g. Season 9 Week 2, Top 8" value={phase} onChange={e => set('phase', e.currentTarget.value)} />

                            <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-8">
                                    <TextField label="Location" placeholder="City, State" value={location} onChange={e => set('location', e.currentTarget.value)} />
                                </div>
                                <div className="col-span-4">
                                    <TextField label="Date" placeholder="YYYY-MM-DD" value={date} onChange={e => set('date', e.currentTarget.value)} />
                                </div>
                            </div>

                            <Divider />

                            <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-4">
                                    <TextField label="Entrants" placeholder="0" value={String(entrants)} onChange={e => set('entrants', e.currentTarget.value)} />
                                </div>
                                <div className="col-span-8">
                                    <TextField label="Prize Pool" placeholder="$0" value={prize_pool} onChange={e => set('prize_pool', e.currentTarget.value)} />
                                </div>
                            </div>

                            <TextField label="Bracket Link" placeholder="https://start.gg/... or https://challonge.com/..." value={bracket_link} onChange={e => set('bracket_link', e.currentTarget.value)} />

                            <Divider label="Organizers" />

                            {orgFields.map((org, i) => (
                                <div className="grid grid-cols-12 gap-2" key={i}>
                                    <div className="col-span-4">
                                        <TextField label={i === 0 ? "Organizer" : undefined} placeholder={`Organizer ${i + 1}`} value={org.name} onChange={e => set(`organizer_${i}_name`, e.currentTarget.value)} />
                                    </div>
                                    <div className="col-span-4">
                                        <TextField label={i === 0 ? "Twitter" : undefined} placeholder="@handle" value={org.twitter} onChange={e => set(`organizer_${i}_twitter`, e.currentTarget.value)} />
                                    </div>
                                    <div className="col-span-4">
                                        <TextField label={i === 0 ? "Pronoun" : undefined} placeholder="Pronoun" value={org.pronoun} onChange={e => set(`organizer_${i}_pronoun`, e.currentTarget.value)} />
                                    </div>
                                </div>
                            ))}
                        </Stack>
                    </Panel>
                </Stack>
            </div>

            {/* Right column — Entrants list */}
            {bracket_link && (
                <div className="md:col-span-8">
                    <Panel title="Entrants">
                        <Stack gap="sm" className="p-4">
                            <ScrollArea style={{ height: 'calc(100vh - 200px)' }}>
                                {entrantsList.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                {ENTRANT_COLUMNS.map(col => (
                                                    <TableHead key={col.field} className="whitespace-nowrap">
                                                        <button type="button" onClick={() => handleSort(col.field)}>
                                                            <span className="flex flex-nowrap items-center gap-1">
                                                                <Text size="xs" fw={600} span>{col.label}</Text>
                                                                <Text size="xs" dimmed span>
                                                                    {sortField === col.field ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
                                                                </Text>
                                                            </span>
                                                        </button>
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sortedEntrants.map(e => (
                                                <TableRow key={e.id}>
                                                    {ENTRANT_COLUMNS.map(col => (
                                                        <TableCell key={col.field}>
                                                            <Text size="xs" truncate>
                                                                {getPlayerField(e, col.field) || '—'}
                                                            </Text>
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <Text size="sm" dimmed>
                                        {entrantsLoading ? 'Loading...' : 'No entrants found.'}
                                    </Text>
                                )}
                            </ScrollArea>
                            {entrantsTotalPages > 1 && (
                                <div className="flex justify-center">
                                    <SimplePagination
                                        total={entrantsTotalPages}
                                        value={entrantsPage}
                                        onChange={(page) => handleFetchEntrants(page)}
                                    />
                                </div>
                            )}
                        </Stack>
                    </Panel>
                </div>
            )}
        </div>
    );
}

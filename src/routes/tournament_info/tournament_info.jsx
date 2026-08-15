import { memo, useCallback, useState, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { X } from 'lucide-react';
import { Stack, Text, Title, Divider } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import { SimplePagination } from '../../components/ui/simple-pagination';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { Loader } from '../../components/ui/primitives';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useStateStore, useBracketStore } from '../../context/store';
import { useParticipantsStore } from '../../context/participants';
import { setOrganizers, MAX_ORGANIZERS } from '../../context/organizers';
import ParticipantPicker from '../../components/ParticipantPicker';
import useTournament from '../../hooks/useTournament';

// Flatten a start.gg entrant to its primary parsed player (the import unit).
const playerOf = (entrant) => entrant?.players?.[0] || {};

/*
 * One entrant row in the import/mapping surface (Phase 2). Shows the parsed
 * start.gg columns plus a registry link-state badge and an inline Rio-ID field.
 * Typing a Rio ID (or "+ Add") routes through the start.gg-aware upsert so the
 * row de-dupes by start.gg userId — never a stray manual duplicate.
 */
function EntrantRow({ entrant, columns, getPlayerField, matchedRow, onAssignRio, onImport }) {
    const row = matchedRow(entrant);
    const mappedRio = row?.identities?.rioName || '';
    const [draft, setDraft] = useState(mappedRio);
    const [busy, setBusy] = useState(false);

    // Re-seed when the backing row changes (import, external edit).
    useEffect(() => { setDraft(mappedRio); }, [mappedRio]);

    const state = !row ? 'unlinked' : (mappedRio ? 'mapped' : 'imported');
    const badge = {
        unlinked: { label: 'Not in book', cls: 'bg-muted text-muted-foreground' },
        imported: { label: 'Imported', cls: 'bg-[#3b82f6]/15 text-[#60a5fa]' },
        mapped: { label: `Rio: ${mappedRio}`, cls: 'bg-[#22c55e]/15 text-[#4ade80]' },
    }[state];

    const commitRio = useCallback(async () => {
        if (draft === mappedRio) return;
        setBusy(true);
        try { await onAssignRio(entrant, draft.trim()); }
        finally { setBusy(false); }
    }, [draft, mappedRio, entrant, onAssignRio]);

    const importRow = useCallback(async () => {
        setBusy(true);
        try { await onImport(entrant); }
        finally { setBusy(false); }
    }, [entrant, onImport]);

    return (
        <TableRow>
            {columns.map(col => (
                <TableCell key={col.field}>
                    <Text size="xs" truncate>{getPlayerField(entrant, col.field) || '—'}</Text>
                </TableCell>
            ))}
            <TableCell>
                <Badge className={cn('whitespace-nowrap', badge.cls)}>{badge.label}</Badge>
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-1">
                    <TextField
                        placeholder="Rio ID"
                        value={draft}
                        onChange={e => setDraft(e.currentTarget.value)}
                        onBlur={commitRio}
                        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                        inputClassName="w-[130px]"
                        disabled={busy}
                    />
                    {state === 'unlinked' && (
                        <Button variant="outline" size="xs" onClick={importRow} disabled={busy}>
                            + Add
                        </Button>
                    )}
                </div>
            </TableCell>
        </TableRow>
    );
}

/*
 * ORGANIZERS ARE ADDRESS-BOOK REFERENCES, not nine text fields.
 *
 * They used to be three trios of free text — name, twitter, pronoun — which made
 * this the third place the same person's handle was typed (a commentary slot and
 * a player row being the others), with nothing keeping the copies in agreement.
 * Picking the registry row instead means one edit in Address Book reflows
 * everywhere, the same resolve-by-copy contract Match, Commentary and
 * PlayerPlates already run on.
 *
 * The projected keys are unchanged (`organizer_{i}_{name,twitter,pronoun}`), so
 * a producer with an OBS text source pointed at the stream_labels .txt mirror
 * keeps working.
 *
 * LEGACY TEXT IS LEFT ALONE until the producer picks someone. A projector owns
 * its key set and writes it whole, so projecting over hand-typed organizers
 * would erase them — `tournamentInfo.organizers` being ABSENT is what says "this
 * has never been authored" (server/organizers.py). The first pick authors the
 * list, and from then on the registry is the source. The note below is the one
 * warning a producer gets, and it only shows while there is text to lose.
 */
export const OrganizerRows = memo(function OrganizerRows() {
    /*
     * FLAT PRIMITIVES ONLY. `useShallow` compares one level, so a selector that
     * builds the three slots as an array of objects hands back a new reference
     * every call, never compares equal, and re-renders forever — React error
     * #185, which is exactly how this first ran. `organizers` is returned as the
     * state's own array so its reference IS stable; everything else is a string.
     */
    const org = useStateStore(useShallow(s => {
        const info = s?.tournamentInfo ?? {};
        return {
            authored: Array.isArray(info.organizers) ? info.organizers : null,
            n0: info.organizer_0_name || '', t0: info.organizer_0_twitter || '', p0: info.organizer_0_pronoun || '',
            n1: info.organizer_1_name || '', t1: info.organizer_1_twitter || '', p1: info.organizer_1_pronoun || '',
            n2: info.organizer_2_name || '', t2: info.organizer_2_twitter || '', p2: info.organizer_2_pronoun || '',
        };
    }));

    const slots = useMemo(() => Array.from({ length: MAX_ORGANIZERS }, (_, i) => ({
        name: org[`n${i}`], twitter: org[`t${i}`], pronoun: org[`p${i}`],
    })), [org]);

    const legacy = org.authored === null && slots.some(s => s.name || s.twitter || s.pronoun);

    const assign = useCallback(async (index, participantId) => {
        const next = Array.from({ length: MAX_ORGANIZERS }, (_, i) => ({
            participantId: (org.authored?.[i]?.participantId) ?? null,
        }));
        next[index] = { participantId };
        try {
            await setOrganizers(next);
        } catch (e) {
            notifications.show({ message: `Organizers: ${e?.message || e}`, color: 'red' });
        }
    }, [org.authored]);

    return (
        <Stack gap="xs">
            {slots.map((slot, i) => (
                <div className="grid grid-cols-12 items-center gap-2" key={i}>
                    <div className="col-span-7">
                        <ParticipantPicker
                            value={slot.name}
                            selectedId={org.authored?.[i]?.participantId ?? null}
                            onResolve={(row) => assign(i, row?.id ?? null)}
                            placeholder={`Organizer ${i + 1}`}
                        />
                    </div>
                    {/* Read-only: these come from the picked row, so the edit
                        belongs in Address Book. Showing them anyway is what makes
                        it obvious WHICH record got picked. */}
                    <div className="col-span-4 min-w-0">
                        <Text size="xs" dimmed truncate>
                            {[slot.twitter, slot.pronoun].filter(Boolean).join(' · ') || '—'}
                        </Text>
                    </div>
                    <div className="col-span-1 flex justify-end">
                        {(slot.name || org.authored?.[i]?.participantId) && (
                            <Button
                                size="xs" variant="ghost" aria-label={`Clear organizer ${i + 1}`}
                                onClick={() => assign(i, null)}
                            >
                                <X size={13} />
                            </Button>
                        )}
                    </div>
                </div>
            ))}
            <Text size="xs" dimmed>
                {legacy
                    ? 'Typed by hand on an older version. Picking anyone here replaces all three with Address Book entries.'
                    : 'Socials and pronouns come from the Address Book, so an edit there updates them everywhere.'}
            </Text>
        </Stack>
    );
});

/*
 * WHICH FIELDS START.GG IS STILL DRIVING.
 *
 * Five of these are auto-filled by a tournament load and a sixth — the phase —
 * by every set load, but only while the producer hasn't typed over them: the
 * server records what it last filled in `tournamentInfo._auto` and stops
 * overwriting a field that differs from it (`auto_fill_entries`,
 * server/startgg/provider.py). That rule was invisible here, so a field could
 * silently change under a producer who thought they owned it, or stubbornly
 * refuse to update because of an edit they'd forgotten making.
 *
 * The badge states which case a field is in, and it rides the label rather than
 * the input — it describes where the value comes from, not what it is.
 */
const AutoLabel = memo(function AutoLabel({ children, field }) {
    const tracking = useStateStore(s => {
        const info = s?.tournamentInfo ?? {};
        const auto = info._auto ?? {};
        return field in auto && (info[field] ?? '') === (auto[field] ?? '');
    });
    return (
        <span className="flex items-center gap-1.5">
            {children}
            {tracking && (
                <Text size="xs" span dimmed className="font-normal normal-case">
                    from start.gg
                </Text>
            )}
        </span>
    );
});

export default function TournamentInfo() {
    const setItem = useStateStore(s => s.setItem);

    // Subscribe to individual fields to avoid referential equality issues
    const name         = useStateStore(s => s?.tournamentInfo?.name ?? '');
    const event_name   = useStateStore(s => s?.tournamentInfo?.event_name ?? '');
    const phase        = useStateStore(s => s?.tournamentInfo?.phase ?? '');
    // No `message` here on purpose: the banner line is the Event Header's own
    // copy and nothing else reads it, so it is authored on that element's
    // Production stage panel (overlays.eventheader.message). This form is for
    // facts about the competition — the things several overlays read and
    // start.gg fills in.
    const abbreviation = useStateStore(s => s?.tournamentInfo?.abbreviation ?? '');
    const location     = useStateStore(s => s?.tournamentInfo?.location ?? '');
    const date         = useStateStore(s => s?.tournamentInfo?.date ?? '');
    const entrants     = useStateStore(s => s?.tournamentInfo?.entrants ?? '');
    const prize_pool   = useStateStore(s => s?.tournamentInfo?.prize_pool ?? '');
    const bracket_link = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');

    // Loading a tournament now lives in the shared TournamentLoader (Competition
    // tab chrome). This view only needs the entrants fetch.
    const { fetchEntrants } = useTournament();

    // Entrants list — persisted in the bracket store so switching tabs
    // doesn't trigger a refetch.
    const entrantsList = useBracketStore(s => s.entrants);
    const entrantsPage = useBracketStore(s => s.entrantsPage);
    const entrantsTotalPages = useBracketStore(s => s.entrantsTotalPages);
    const entrantsLoadedFor = useBracketStore(s => s.entrantsLoadedFor);
    const updateBracket = useBracketStore(s => s.update);
    const [entrantsLoading, setEntrantsLoading] = useState(false);

    // Participant registry — the import/mapping target (Phase 2).
    const { participants, loadParticipants, updateParticipant, importStartGG } =
        useParticipantsStore(useShallow(s => ({
            participants: s.participants,
            loadParticipants: s.load,
            updateParticipant: s.update,
            importStartGG: s.importStartGG,
        })));
    useEffect(() => { loadParticipants(); }, [loadParticipants]);

    // Link an entrant to its registry row by start.gg userId (the de-dupe key).
    const matchedRow = useCallback((entrant) => {
        const uid = playerOf(entrant).userId;
        if (uid == null) return null;
        return participants.find(p => (p.identities?.startgg?.userId === uid)) || null;
    }, [participants]);

    // Set an entrant's Rio ID: import the row if needed (upsert de-dupes), then
    // write rioName so the Phase 1 HUD/Live/Rotator resurface fires for them.
    const assignRio = useCallback(async (entrant, rioName) => {
        let row = matchedRow(entrant);
        if (!row) {
            const res = await importStartGG([playerOf(entrant)]);
            row = res?.rows?.[0];
        }
        if (row) await updateParticipant(row.id, { identities: { rioName } });
    }, [matchedRow, importStartGG, updateParticipant]);

    const importEntrant = useCallback(async (entrant) => {
        await importStartGG([playerOf(entrant)]);
    }, [importStartGG]);

    const [importingAll, setImportingAll] = useState(false);
    const importAllEntrants = useCallback(async () => {
        const players = entrantsList.map(playerOf).filter(p => p.gamerTag || p.userId != null);
        if (!players.length) return;
        setImportingAll(true);
        try {
            const res = await importStartGG(players);
            notifications.show({ message: `Imported ${res?.imported ?? players.length} entrant(s) to Address Book`, color: 'green' });
        } finally {
            setImportingAll(false);
        }
    }, [entrantsList, importStartGG]);

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
            handleFetchEntrants(1);
        }
        if (!bracket_link && entrantsLoadedFor) {
            updateBracket({ entrants: [], entrantsPage: 1, entrantsTotalPages: 0, entrantsLoadedFor: null });
        }
    }, [bracket_link]); // eslint-disable-line react-hooks/exhaustive-deps

    const set = useCallback((field, value) => {
        setItem(`tournamentInfo.${field}`, value);
    }, [setItem]);

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* Left column — Tournament form */}
            <div className={bracket_link ? 'md:col-span-4' : 'md:col-span-12'}>
                <Stack gap="md">
                    <Title order={3}>Competition Info</Title>
                    <Panel title="Details">
                        <Stack gap="sm" className="p-4">
                            <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-8">
                                    <TextField label={<AutoLabel field="name">Competition Name</AutoLabel>} placeholder="Enter competition name" value={name} onChange={e => set('name', e.currentTarget.value)} />
                                </div>
                                <div className="col-span-4">
                                    <TextField label="Abbreviation" placeholder="Short name" value={abbreviation} onChange={e => set('abbreviation', e.currentTarget.value)} />
                                </div>
                            </div>

                            <TextField label={<AutoLabel field="event_name">Event Name</AutoLabel>} placeholder="e.g. Stars Off (start.gg event under the competition)" value={event_name} onChange={e => set('event_name', e.currentTarget.value)} />

                            {/* The phase is filled by every SET load, not by the
                                event load — the one field here a fixture can
                                change mid-broadcast. */}
                            <TextField label={<AutoLabel field="phase">Competition Phase</AutoLabel>} placeholder="e.g. Season 9 Week 2, Top 8" value={phase} onChange={e => set('phase', e.currentTarget.value)} />

                            <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-8">
                                    <TextField label={<AutoLabel field="location">Location</AutoLabel>} placeholder="City, State" value={location} onChange={e => set('location', e.currentTarget.value)} />
                                </div>
                                <div className="col-span-4">
                                    <TextField label={<AutoLabel field="date">Date</AutoLabel>} placeholder="YYYY-MM-DD" value={date} onChange={e => set('date', e.currentTarget.value)} />
                                </div>
                            </div>

                            <Divider />

                            <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-4">
                                    <TextField label={<AutoLabel field="entrants">Entrants</AutoLabel>} placeholder="0" value={String(entrants)} onChange={e => set('entrants', e.currentTarget.value)} />
                                </div>
                                <div className="col-span-8">
                                    <TextField label="Prize Pool" placeholder="$0" value={prize_pool} onChange={e => set('prize_pool', e.currentTarget.value)} />
                                </div>
                            </div>

                            <Divider label="Organizers" />

                            <OrganizerRows />
                        </Stack>
                    </Panel>
                </Stack>
            </div>

            {/* Right column — Entrants list */}
            {bracket_link && (
                <div className="md:col-span-8">
                    <Panel
                        title="Entrants"
                        actions={
                            entrantsList.length > 0 ? (
                                <Button size="xs" variant="outline" onClick={importAllEntrants} disabled={importingAll}>
                                    {importingAll && <Loader size={12} />}
                                    Import all to Address Book
                                </Button>
                            ) : null
                        }
                    >
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
                                                <TableHead className="whitespace-nowrap">
                                                    <Text size="xs" fw={600} span>Registry</Text>
                                                </TableHead>
                                                <TableHead className="whitespace-nowrap">
                                                    <Text size="xs" fw={600} span>Rio ID</Text>
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {sortedEntrants.map(e => (
                                                <EntrantRow
                                                    key={e.id}
                                                    entrant={e}
                                                    columns={ENTRANT_COLUMNS}
                                                    getPlayerField={getPlayerField}
                                                    matchedRow={matchedRow}
                                                    onAssignRio={assignRio}
                                                    onImport={importEntrant}
                                                />
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

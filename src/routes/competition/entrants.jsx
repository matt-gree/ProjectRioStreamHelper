import { useCallback, useState, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { TextField } from '../../components/ui/text-field';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import { SimplePagination } from '../../components/ui/simple-pagination';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useStateStore, useBracketStore } from '../../context/store';
import { useParticipantsStore } from '../../context/participants';
import useTournament from '../../hooks/useTournament';

/*
 * The loaded event's ENTRANTS, and the Address Book mapping over them.
 *
 * It lived inside tournament_info.jsx as that form's right-hand column, which
 * made the form's own width a function of whether a table was beside it. Both
 * lists about a loaded event — this and the bracket's sets — are peers now, in
 * the Competition page's one right column (../competition), so the form is just
 * a form.
 */

// Flatten a start.gg entrant to its primary parsed player (the import unit).
const playerOf = (entrant) => entrant?.players?.[0] || {};

/*
 * THIS TABLE ASKS ONE QUESTION: is this entrant set up to appear on the
 * broadcast? So it carries the four things that answer it — the seed that
 * orders the field, the name that identifies the person, whether they are in
 * the Address Book, and their Rio ID.
 *
 * It used to carry five more columns — sponsor prefix, full name, pronouns,
 * country and state — parsed off the start.gg user profile. Those are the
 * ADDRESS BOOK's fields: they are edited there, read from there by every
 * projector, and already copied into it by the import below (`sg_to_display`
 * in server/participants.py takes them whether or not this page ever draws
 * them). Printing them here made a seven-column table whose widest columns
 * were the ones nobody acts on, and pushed the two a producer is actually
 * here to change — the book state and the Rio ID — off the end of a narrow
 * panel.
 */
/*
 * THE FINISHED STATE IS THE QUIET ONE. A chip per row, coloured per row, is
 * only useful while the rows differ — on a field that is fully mapped it draws
 * thirty green blocks down the panel, which is the loudest thing on the page
 * saying the one thing that needs no attention. The states that are still work
 * keep a chip; "Mapped" drops to a dot and dimmed text, so a half-done field
 * shows its remaining rows at a glance instead of hiding them among the done.
 *
 * `rank` orders the column: ascending puts the work first, which is the only
 * reason to sort by state at all.
 */
const LINK_STATES = {
    unlinked: { rank: 0, label: 'Not in book', cls: 'border-border bg-transparent text-muted-foreground' },
    // Named for the work left, not the state reached — it is the same sentence
    // the census counts.
    imported: { rank: 1, label: 'Needs Rio ID', cls: 'bg-[#3b82f6]/15 text-[#60a5fa]' },
    mapped: { rank: 2, label: 'Mapped', quiet: true, cls: 'bg-[#22c55e]' },
};

const linkStateOf = (row) => (!row ? 'unlinked' : (row.identities?.rioName ? 'mapped' : 'imported'));

// The sortable columns. Rio ID is a header but not one of these — it is an
// input, and sorting a list by the field you are typing into moves the row out
// from under the cursor.
const ENTRANT_COLUMNS = [
    { field: 'seed', label: 'Seed', className: 'w-12 text-right' },
    { field: 'tag', label: 'Player' },
    { field: 'book', label: 'Address Book' },
];

/*
 * One entrant row. Shows the seed, the person, their registry link-state and an
 * inline Rio-ID field. Typing a Rio ID (or "+ Add") routes through the
 * start.gg-aware upsert so the row de-dupes by start.gg userId — never a stray
 * manual duplicate.
 */
function EntrantRow({ entrant, matchedRow, onAssignRio, onImport }) {
    const row = matchedRow(entrant);
    const mappedRio = row?.identities?.rioName || '';
    const [draft, setDraft] = useState(mappedRio);
    const [busy, setBusy] = useState(false);

    // Re-seed when the backing row changes (import, external edit).
    useEffect(() => { setDraft(mappedRio); }, [mappedRio]);

    const state = linkStateOf(row);
    const badge = LINK_STATES[state];
    const tag = playerOf(entrant).gamerTag || entrant.name || '—';

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
            {/* An index, not content: quiet, and figure-aligned so the column
                scans as a column rather than as ragged text. */}
            <TableCell className="w-12 text-right">
                <Text size="xs" dimmed className="tabular-nums">{entrant.seed ?? '—'}</Text>
            </TableCell>
            {/* THE TAG, AND NOT THE SPONSOR PREFIX. A prefix is a team's
                initials in front of a name a producer already knows — it
                identifies nobody here, and it was a whole column of its own
                before it was a chip. It still imports into the Address Book,
                where the record can carry it; this list is for finding a
                person, so it is the loud thing on the row and nothing else on
                the row competes with it. */}
            <TableCell>
                <Text size="sm" truncate className="font-medium">{tag}</Text>
            </TableCell>
            <TableCell>
                {badge.quiet ? (
                    <span className="flex items-center gap-1.5">
                        <span className={cn('size-1.5 shrink-0 rounded-full', badge.cls)} />
                        <Text size="xs" dimmed>{badge.label}</Text>
                    </span>
                ) : (
                    <Badge className={cn('whitespace-nowrap', badge.cls)}>{badge.label}</Badge>
                )}
            </TableCell>
            <TableCell>
                <div className="flex items-center gap-1">
                    <TextField
                        placeholder="Rio ID"
                        aria-label={`Rio ID for ${tag}`}
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

export default function EntrantsPanel() {
    const bracket_link = useStateStore(s => s?.tournamentInfo?.bracket_link ?? '');
    const { fetchEntrants } = useTournament();

    // Entrants list — persisted in the bracket store so switching views
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

    const handleSort = useCallback((field) => {
        setSortDir(prev => sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortField(field);
    }, [sortField]);

    /*
     * One accessor per COLUMN, not per start.gg field — the columns are the
     * sort keys now that there are four of them, and `book` sorts by the
     * link-state's rank so ascending puts the rows still needing work on top.
     */
    const sortValue = useCallback((entrant, field) => {
        const p = playerOf(entrant);
        if (field === 'seed') return entrant.seed ?? 9999;
        if (field === 'book') return LINK_STATES[linkStateOf(matchedRow(entrant))].rank;
        return String(p.gamerTag || entrant.name || '').toLowerCase();
    }, [matchedRow]);

    const sortedEntrants = useMemo(() => {
        if (!entrantsList.length) return entrantsList;
        const list = [...entrantsList];
        const dir = sortDir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
            const valA = sortValue(a, sortField);
            const valB = sortValue(b, sortField);
            if (typeof valA === 'number' && typeof valB === 'number') return dir * (valA - valB);
            return dir * String(valA).localeCompare(String(valB));
        });
        return list;
    }, [entrantsList, sortField, sortDir, sortValue]);

    /*
     * WHAT IS LEFT TO DO, said once at the top. Per-row colour answers "is this
     * one done"; nothing answered "am I done", which is the question a producer
     * opens this list with — and counting thirty badges by eye is not an answer.
     */
    const census = useMemo(() => {
        let mapped = 0;
        for (const e of entrantsList) {
            if (linkStateOf(matchedRow(e)) === 'mapped') mapped += 1;
        }
        return { total: entrantsList.length, mapped, remaining: entrantsList.length - mapped };
    }, [entrantsList, matchedRow]);

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

    return (
        <Stack gap="sm" className="min-h-0 flex-1">
            {/* Each view in the right column carries its own toolbar rather than
                pushing actions up into the shared header — the header holds the
                Entrants/Sets switch, and a panel that reaches into its parent's
                chrome couples the two for one button. */}
            {entrantsList.length > 0 && (
                <div className="flex items-center justify-between gap-3">
                    <Text size="xs" dimmed>
                        {census.total} entrants · {census.mapped} mapped
                        {census.remaining > 0 && ` · ${census.remaining} still need a Rio ID`}
                    </Text>
                    <Button size="xs" variant="outline" onClick={importAllEntrants} disabled={importingAll}>
                        {importingAll && <Loader size={12} />}
                        Import all to Address Book
                    </Button>
                </div>
            )}
            {/* The column above set the height; this just fills what is
                left of it (../competition). */}
            <ScrollArea className="min-h-0 flex-1">
                    {entrantsList.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {ENTRANT_COLUMNS.map(col => (
                                        <TableHead key={col.field} className={cn('whitespace-nowrap', col.className)}>
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
                                        <Text size="xs" fw={600} span>Rio ID</Text>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedEntrants.map(e => (
                                    <EntrantRow
                                        key={e.id}
                                        entrant={e}
                                        matchedRow={matchedRow}
                                        onAssignRio={assignRio}
                                        onImport={importEntrant}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <Text size="sm" dimmed>
                            {entrantsLoading ? 'Loading…' : 'No entrants found.'}
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
    );
}

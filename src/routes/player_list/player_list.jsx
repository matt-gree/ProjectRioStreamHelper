import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Upload, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { notifications } from '../../lib/notify';
import { Button } from '../../components/ui/button';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Badge } from '../../components/ui/badge';
import { Title, Text } from '../../components/ui/primitives';
import { cn } from '../../lib/utils';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { MAIN_BOOK, useParticipantsStore } from '../../context/participants';
import { useSideLabels } from '../production/sides';
import { usePersistentState } from '../../hooks/usePersistentState';
import { SOCIAL_MARKS } from '../../../public/layout/lib/social-marks.js';
import {
    AddFromBooks, BOOK_FILE_ACCEPT, BookStrip, LeaguePanel, NewBookDialog, PlayerLogo,
    downloadBlob, downloadJson, fileSlug,
} from './books';

/*
 * Address Book — a CRUD view over the participant registry (the streamer's
 * persistent local working set of people). Rows live in user_data/participants.json
 * via the REST singleton, NOT in broadcast State. Picking a person on a
 * scoreboard copies these fields into the live player keys (resolve-by-copy).
 *
 * THE ROW IS A PERSON, NOT ELEVEN FORM FIELDS. It was eleven bordered inputs of
 * identical weight, so the join key that makes the record work at all — the Rio
 * ID, without which nobody ever resurfaces — drew exactly like Country. Three
 * things carry the hierarchy now and none of them is a new colour:
 *
 *   · the fields are SEAMLESS (no frame at rest, outlined on row hover, the
 *     input treatment on focus) — the same idiom as a board's renameable panel
 *     title (production/kit/PanelShell.jsx). A table of values that reveals
 *     itself as editable reads as a book; a table of boxes reads as a form, and
 *     a form of eleven boxes says every box matters equally;
 *   · TYPE, not chrome, says which field is the name — the tag is display type
 *     at 15px, the Rio ID is mono because it is an id;
 *   · the columns are BANDED into groups (Person · Profile · Social ·
 *     Broadcast) with a hairline between, which is what turns eleven columns
 *     into four things to look at.
 *
 * WHAT IT DOES NOT DO is colour the rows. The console's palette already means
 * things (amber = you'd want to know before this is on air, blue = work left,
 * green = done, red = program), and a per-person tint would be a fifth axis
 * saying nothing. It also carries no monogram: a letter chip beside a name is
 * the name's own first letter drawn twice in 60px, and the tag in display type
 * at the head of a fixed column is already the rail the eye runs down.
 *
 * AN EMPTY OPTIONAL FIELD SHOWS A DASH, NOT AN EXAMPLE. A greyed `They/Them`
 * under Pronouns and a greyed `CA` under State are values a producer has to
 * look twice at to know are not there — a whole table of plausible fake data
 * standing in for the real kind. The column header already says what the field
 * is, so the placeholder's only remaining job is "empty, and you can type
 * here". The two exceptions earn it: `Tag`, because on a new row it is the
 * first thing you fill in and there is nothing else on the row to read; and
 * `Needs Rio ID`, which is not an empty optional but a FAULT (see below).
 */

/*
 * The display FACE without the display LABEL's caps. `.label-display` carries
 * `text-transform: uppercase` and is unlayered, so it out-cascades any
 * `normal-case` utility — and a tag is the person's own capitalisation, which
 * is what goes on air: `MattGree`, `rjb`, `Slice26`. Drawing them MATTGREE, RJB
 * and SLICE26 would make this table the one surface in the app that cannot show
 * a producer what their overlay will say.
 */
const NAME_FACE = '[font-family:var(--font-display)] font-semibold';

/* The brand mark beside a handle — a handle cannot say which platform it is on,
 * on the console any more than on air (see public/layout/lib/social-marks.js,
 * whose table this borrows rather than redrawing). */
function Mark({ id, className }) {
    const spec = SOCIAL_MARKS[id];
    if (!spec) return null;
    return (
        <svg viewBox={spec.viewBox} aria-hidden className={cn('shrink-0', className)}>
            <path d={spec.d} fill="currentColor" />
        </svg>
    );
}

/*
 * A cell that looks like its value until you reach for it.
 *
 * The frame comes up on ROW hover rather than field hover, so pointing at a
 * person reveals every field on them at once — one gesture answers "what can I
 * change here?", which is the only thing a frameless field costs.
 *
 * IT IS THE FILL THAT DOES IT, NOT THE BORDER, and that is measured rather than
 * taste: `--input` and `--border` are both #1a1a2e against a #0b0b12 card, a
 * ratio of about 1.17:1 — a 1px hairline nobody can see. The app's own inputs
 * are legible because the primitive pairs that border with a `bg-input/30`
 * well; a reveal built on the border alone reproduces the hairline and skips
 * the part that reads. So hover restores exactly what an ordinary input looks
 * like at rest, which is the whole intent: point at a row and it becomes the
 * form it always was.
 *
 * Focus then goes one step further AND keeps the primitive's ring, because a
 * ring reads as focus whatever the border underneath it is doing — group-hover
 * out-specifies a plain `:focus` on the same element, so the border colour is
 * not a contest worth entering.
 */
function BookField({ className, mono, tone, ...props }) {
    return (
        <input
            type="text"
            spellCheck={false}
            className={cn(
                'h-8 min-w-0 rounded-md border bg-transparent px-2 text-[13px] text-foreground',
                'outline-none transition-colors placeholder:text-muted-foreground/60',
                tone || 'border-transparent group-hover/row:border-input',
                'group-hover/row:bg-input/50',
                'focus:bg-input/70 focus:ring-[3px] focus:ring-ring/50',
                'focus:placeholder:text-muted-foreground',
                mono && 'font-mono tabular-nums',
                className,
            )}
            {...props}
        />
    );
}

// Provenance — how a row entered the book. Read-only, and QUIET for the common
// case: `manual` is the absence of provenance (you typed it), so drawing a chip
// for it would put a badge on nearly every row to say nothing. Same lesson the
// entrants list records about its "Mapped" state.
const SOURCE_CHIP = {
    startgg: { label: 'start.gg', cls: 'bg-[#3b82f6]/15 text-[#60a5fa]' },
    hud: { label: 'HUD', cls: 'bg-[#f5bb00]/15 text-[#f5bb00]' },
};

function SourceChip({ source, startggTag }) {
    const meta = SOURCE_CHIP[source];
    if (!meta) return null;
    return (
        <Badge
            className={cn('whitespace-nowrap', meta.cls)}
            title={startggTag ? `start.gg: ${startggTag}` : undefined}
        >
            {meta.label}
        </Badge>
    );
}

/*
 * The side this person is pinned to — the `pin` layer of the side cascade,
 * which used to be one app-wide "Player Lock" in the Settings modal.
 *
 * It lives HERE because it was always a fact about a person, not about the app:
 * "JustAGrump always sits on side 1" is the same kind of statement as their
 * pronouns. One global pin was an implementation ceiling, not a decision, and
 * moving it onto the row lifts it — every person in the book can carry one.
 *
 * Persists immediately (a select has no blur to wait for), and writes `null`
 * for "no preference" rather than 0: a magic zero beside a vocabulary where
 * sides are 1 and 2 is one typo from orienting a broadcast (see `_clean_side`,
 * server/participants.py).
 *
 * Named in the producer's own side vocabulary (../production/sides), so a book
 * row and the board panel that explains its effect cannot disagree. It keeps a
 * visible frame while the value fields lose theirs: it is the one CONTROL on
 * the row rather than a value, and a native select's own chevron is the
 * affordance that says so.
 */
function SidePin({ value, onChange }) {
    const sides = useSideLabels();
    return (
        <select
            value={value ?? ''}
            onChange={e => onChange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
            aria-label="Pinned side"
            className={cn(
                'h-8 w-[92px] rounded-md border bg-transparent px-2 text-xs outline-none',
                'group-hover/row:bg-input/50 focus:bg-input/70',
                'focus:ring-[3px] focus:ring-ring/50',
                value ? 'border-input text-foreground' : 'border-transparent text-muted-foreground/60',
                'group-hover/row:border-input',
            )}
        >
            <option value="">No side</option>
            <option value="1">{sides.label(1)}</option>
            <option value="2">{sides.label(2)}</option>
        </select>
    );
}

// The hairline that starts a column group. One class, so the band row and every
// body row cannot draw the rules in different places.
const GROUP = 'border-l border-border/60';

function AddressBookRow({ row, showLogo, onPersist, onDelete }) {
    // Local draft so we PUT on blur, not on every keystroke.
    const [draft, setDraft] = useState(() => ({
        rioName: row.identities?.rioName ?? '',
        tag: row.display?.tag ?? '',
        prefix: row.display?.prefix ?? '',
        fullName: row.display?.fullName ?? '',
        pronoun: row.display?.pronoun ?? '',
        country: row.display?.country ?? '',
        state: row.display?.state ?? '',
        twitter: row.display?.twitter ?? '',
        youtube: row.display?.youtube ?? '',
    }));

    const setField = (field, value) => setDraft(d => ({ ...d, [field]: value }));

    const persist = useCallback(() => {
        onPersist(row.id, {
            identities: { rioName: draft.rioName },
            display: {
                tag: draft.tag,
                prefix: draft.prefix,
                fullName: draft.fullName,
                pronoun: draft.pronoun,
                country: draft.country,
                state: draft.state,
                twitter: draft.twitter,
                youtube: draft.youtube,
            },
        });
    }, [row.id, draft, onPersist]);

    // Shared wiring for every value cell: draft on keystroke, PUT on blur,
    // Enter commits by blurring (the same contract as the panel-title rename).
    const field = (name, extra = {}) => ({
        value: draft[name],
        onChange: e => setField(name, e.currentTarget.value),
        onBlur: persist,
        onKeyDown: e => { if (e.key === 'Enter') e.currentTarget.blur(); },
        ...extra,
    });

    const who = draft.tag || draft.rioName || 'this person';

    return (
        <TableRow className="group/row">
            {/* PERSON — the record as it reads on air: in a league book their
                logo, then the sponsor prefix (a league's team name, in its own
                games), then the name. */}
            <TableCell>
                <div className="flex items-center gap-1">
                    {showLogo && <PlayerLogo row={row} who={who} />}
                    <BookField
                        {...field('prefix')}
                        placeholder={showLogo ? 'Team' : '—'}
                        aria-label={showLogo ? 'Team name (shown as the prefix in this league)' : 'Sponsor prefix'}
                        title={showLogo ? 'In this league’s games this is drawn as the tag above the name' : undefined}
                        className={cn(NAME_FACE, 'w-[54px] px-1.5 text-right text-[11px]',
                                      'tracking-[0.06em] text-muted-foreground')}
                    />
                    <BookField
                        {...field('tag')}
                        placeholder="Tag"
                        aria-label="Tag"
                        className={cn(NAME_FACE, 'w-[160px] text-[15px] tracking-[0.01em]')}
                    />
                </div>
            </TableCell>
            {/* THE JOIN KEY, and the one field whose absence is a fault. A row
                with no Rio ID never matches an incoming HUD name, so the person
                is saved into a book that will never open on them. Named for the
                work left and in the same blue as the entrants list, which says
                the identical thing one surface over — not amber, because on a
                fresh start.gg import this is the expected state of every row and
                a wall of amber is how a producer learns to ignore amber. */}
            <TableCell>
                <BookField
                    {...field('rioName')}
                    mono
                    placeholder="Needs Rio ID"
                    aria-label="Rio ID"
                    className="w-[150px]"
                    tone={draft.rioName
                        ? undefined
                        : 'border-[#3b82f6]/40 placeholder:text-[#60a5fa]/80'}
                />
            </TableCell>

            {/* PROFILE — the enrichment overlays draw beside the name. */}
            <TableCell className={GROUP}>
                <BookField {...field('fullName')} placeholder="—" aria-label="Full name" className="w-[150px]" />
            </TableCell>
            <TableCell>
                <BookField {...field('pronoun')} placeholder="—" aria-label="Pronouns" className="w-[92px]" />
            </TableCell>
            <TableCell>
                <BookField {...field('country')} placeholder="—" aria-label="Country" className="w-[58px] text-center uppercase" />
            </TableCell>
            <TableCell>
                <BookField {...field('state')} placeholder="—" aria-label="State" className="w-[58px] text-center uppercase" />
            </TableCell>

            {/* SOCIAL — the two handles the overlays can draw a mark beside. */}
            <TableCell className={GROUP}>
                <BookField {...field('twitter')} placeholder="—" aria-label={`Twitter for ${who}`} className="w-[128px]" />
            </TableCell>
            <TableCell>
                <BookField {...field('youtube')} placeholder="—" aria-label={`YouTube for ${who}`} className="w-[128px]" />
            </TableCell>

            {/* BROADCAST — how PRSH treats this person, not what it shows. */}
            <TableCell className={GROUP}>
                <SidePin
                    value={row.prefs?.side ?? null}
                    onChange={side => onPersist(row.id, { prefs: { side } })}
                />
            </TableCell>

            <TableCell className="w-16">
                <SourceChip source={row.meta?.source} startggTag={row.identities?.startgg?.gamerTag} />
            </TableCell>
            {/* Removing a person is a rare correction, not the shape of the
                work — a column of red glyphs down a forty-row book is a wall of
                alarm that teaches you to stop reading it. It appears on the row
                you are pointing at, and for the keyboard on focus. */}
            <TableCell className="w-10">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${who}`}
                    className="text-destructive opacity-0 transition-opacity
                               group-hover/row:opacity-100 focus-visible:opacity-100"
                    onClick={() => onDelete(row.id)}
                >
                    <X size={14} />
                </Button>
            </TableCell>
        </TableRow>
    );
}

// The group band and the column names, as one table. Kept beside GROUP so a
// column added to a group cannot forget to move the hairline.
function BookHead() {
    return (
        <TableHeader>
            <TableRow className="hover:bg-transparent">
                <TableHead colSpan={2} className="h-7 pb-0 align-bottom">
                    <span className="label-display text-[10px] text-muted-foreground">Person</span>
                </TableHead>
                <TableHead colSpan={4} className={cn('h-7 pb-0 align-bottom', GROUP)}>
                    <span className="label-display text-[10px] text-muted-foreground">Profile</span>
                </TableHead>
                <TableHead colSpan={2} className={cn('h-7 pb-0 align-bottom', GROUP)}>
                    <span className="label-display text-[10px] text-muted-foreground">Social</span>
                </TableHead>
                <TableHead colSpan={3} className={cn('h-7 pb-0 align-bottom', GROUP)}>
                    <span className="label-display text-[10px] text-muted-foreground">Broadcast</span>
                </TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">Name</TableHead>
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">Rio ID</TableHead>
                <TableHead className={cn('h-8 text-xs font-normal text-muted-foreground', GROUP)}>Full name</TableHead>
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">Pronouns</TableHead>
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">Country</TableHead>
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">State</TableHead>
                <TableHead className={cn('h-8 text-xs font-normal text-muted-foreground', GROUP)}>
                    <span className="flex items-center gap-1.5"><Mark id="twitter" className="size-3" /> Twitter</span>
                </TableHead>
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Mark id="youtube" className="size-3" /> YouTube</span>
                </TableHead>
                <TableHead className={cn('h-8 text-xs font-normal text-muted-foreground', GROUP)}>Side</TableHead>
                <TableHead className="h-8 text-xs font-normal text-muted-foreground">Added by</TableHead>
                <TableHead className="h-8 w-10" />
            </TableRow>
        </TableHeader>
    );
}

// What a search box looks at. Everything on the row that names a person — a
// producer looking someone up has whichever of these they happen to remember.
const searchBlob = (row) => [
    row.identities?.rioName, row.identities?.startgg?.gamerTag,
    row.display?.tag, row.display?.prefix, row.display?.fullName,
    row.display?.twitter, row.display?.youtube,
].filter(Boolean).join(' ').toLowerCase();

export default function PlayerList() {
    const {
        participants: everyone, books, load, create, update, remove,
        exportBook, exportShared, importBook, importShared,
    } = useParticipantsStore(useShallow(s => ({
        participants: s.participants,
        books: s.books,
        load: s.load,
        create: s.create,
        update: s.update,
        remove: s.remove,
        exportBook: s.exportBook,
        exportShared: s.exportShared,
        importBook: s.importBook,
        importShared: s.importShared,
    })));

    useEffect(() => { load(); }, [load]);

    /*
     * Which book is open. Browser-local, like every other "where was I" on the
     * console, and RESOLVED AT READ TIME rather than rewritten: a stored id for
     * a book since deleted (or one that lives on another machine's install)
     * simply falls back to main.
     */
    const [storedBook, setBookId] = usePersistentState('prsh.ui.addressbook.book', MAIN_BOOK);
    const book = books.find(b => b.id === storedBook) || books.find(b => b.id === MAIN_BOOK) || null;
    const bookId = book?.id ?? MAIN_BOOK;
    const isMain = bookId === MAIN_BOOK;
    const [newOpen, setNewOpen] = useState(false);

    const participants = useMemo(
        () => everyone.filter(p => (p.book || MAIN_BOOK) === bookId),
        [everyone, bookId],
    );

    const addPerson = useCallback(() => { create({ book: bookId }); }, [create, bookId]);

    const fileInputRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');

    /*
     * WHAT IS LEFT TO DO, said once at the top — the same shape the entrants
     * list uses, because it is the same question. Per-row state answers "is
     * this one finished"; nothing answered "am I finished", and counting forty
     * rows by eye is not an answer. In a league book the other unfinished
     * thing is a player with no logo — they play in the league and nothing of
     * theirs will go on air.
     */
    const census = useMemo(() => {
        const missing = participants.filter(p => !p.identities?.rioName).length;
        const logoless = isMain ? 0 : participants.filter(p => !p.logo).length;
        return { total: participants.length, missing, logoless };
    }, [participants, isMain]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return participants;
        return participants.filter(p => searchBlob(p).includes(q));
    }, [participants, query]);

    /* The main book is people only, so its backup stays one readable JSON
       file. Any other book can carry logos, and goes out as the shared zip. */
    const handleExport = useCallback(async () => {
        try {
            const stamp = new Date().toISOString().slice(0, 10);
            if (isMain) {
                downloadJson(await exportBook(bookId), `prsh-address-book-${stamp}.json`);
            } else {
                downloadBlob(await exportShared(bookId), `${fileSlug(book?.name)}.prsh-book.zip`);
            }
        } catch (e) {
            notifications.show({ message: `Export failed: ${e.message}`, color: 'red' });
        }
    }, [exportBook, exportShared, bookId, isMain, book?.name]);

    const handleImportFile = useCallback(async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow re-selecting the same file later
        if (!file) return;
        setBusy(true);
        try {
            // A JSON file can say how many people it holds before anything is
            // sent; a zip is only opened on the server.
            let count = null;
            if (!/\.zip$/i.test(file.name)) {
                const parsed = JSON.parse(await file.text());
                count = Array.isArray(parsed) ? parsed.length
                    : Array.isArray(parsed?.participants) ? parsed.participants.length : 0;
            }
            const what = count == null ? 'this file' : `${count} ${count === 1 ? 'person' : 'people'}`;
            const replace = participants.length > 0 && count !== 0 && window.confirm(
                `Import ${what} into “${book?.name ?? 'Address Book'}”.\n\n` +
                'OK  — Replace: wipe this book, then load the file exactly.\n' +
                'Cancel — Merge: keep everyone; add new people and refresh matches.',
            );
            const result = await importBook(file, replace, bookId);
            notifications.show({
                message: replace
                    ? `Replaced ${book?.name ?? 'the book'}: ${result.imported} imported.`
                    : `Merged: ${result.created} added, ${result.updated} updated.`,
                color: 'green',
            });
        } catch (err) {
            notifications.show({ message: `Import failed: ${err.message}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    }, [importBook, participants.length, bookId, book?.name]);

    /* A book someone shared: always a NEW book, so opening a league's file can
       never overwrite the people you already keep. */
    const handleOpenShared = useCallback(async (file) => {
        if (!file) return;
        setBusy(true);
        try {
            const result = await importShared(file);
            setBookId(result.book);
            const name = useParticipantsStore.getState().books.find(b => b.id === result.book)?.name;
            notifications.show({
                message: `Opened “${name || 'Imported book'}”: ${result.imported} ${result.imported === 1 ? 'person' : 'people'}.`,
                color: 'green',
            });
        } catch (err) {
            notifications.show({ message: `Could not open that book: ${err.message}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    }, [importShared, setBookId]);

    return (
        <div className="flex flex-col gap-4">
            {/* The count rides the title: a page whose whole subject is a list
                should say how long the list is where it names itself, and that
                is the whole of what the paragraph under it used to say. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-3">
                    <Title order={3}>Address Book</Title>
                    {census.total > 0 && (
                        <Text size="xs" dimmed span className="tabular-nums">
                            {census.total} {census.total === 1 ? 'person' : 'people'}
                            {census.missing > 0 && (
                                <span className="text-[#60a5fa]">
                                    {' · '}{census.missing} without a Rio ID
                                </span>
                            )}
                            {census.logoless > 0 && (
                                <span className="text-[#60a5fa]">
                                    {' · '}{census.logoless} without a logo
                                </span>
                            )}
                        </Text>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={BOOK_FILE_ACCEPT}
                        className="hidden"
                        onChange={handleImportFile}
                    />
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                        <Upload size={14} className="mr-1.5" /> Import
                    </Button>
                    <Button size="sm" variant="outline" disabled={participants.length === 0} onClick={handleExport}>
                        <Download size={14} className="mr-1.5" /> Export
                    </Button>
                    {!isMain && book && (
                        <AddFromBooks book={book} books={books} participants={everyone} />
                    )}
                    <Button size="sm" onClick={addPerson}>+ Add Person</Button>
                </div>
            </div>

            {books.length > 0 && (
                <BookStrip
                    books={books}
                    value={bookId}
                    onChange={setBookId}
                    onNew={() => setNewOpen(true)}
                    onImportShared={handleOpenShared}
                    busy={busy}
                />
            )}
            <NewBookDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={b => setBookId(b.id)} />

            {!isMain && book && (
                <LeaguePanel book={book} participants={participants} onDeleted={() => setBookId(MAIN_BOOK)} />
            )}

            <Panel
                title="People"
                actions={participants.length > 0 ? (
                    <TextField
                        placeholder="Search"
                        aria-label="Search the address book"
                        value={query}
                        onChange={e => setQuery(e.currentTarget.value)}
                        leftSection={<Search size={13} />}
                        inputClassName="h-7 w-[180px] text-xs"
                    />
                ) : null}
            >
                {participants.length === 0 ? (
                    /* Nobody in the book yet — the one place this page owes an
                       explanation, because there is nothing on screen to read
                       instead. It says what to do, not what the feature is. */
                    <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
                        <Text size="sm" dimmed>
                            {isMain
                                ? 'No one saved yet. People you add here resurface on any scoreboard the moment their Rio ID turns up in a game.'
                                : 'No one in this book yet. Bring in people you already know, or add someone new.'}
                        </Text>
                        <div className="flex items-center gap-2">
                            {!isMain && book && (
                                <AddFromBooks book={book} books={books} participants={everyone} />
                            )}
                            <Button size="sm" onClick={addPerson}>+ Add Person</Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <Table>
                            <BookHead />
                            <TableBody>
                                {shown.map(row => (
                                    <AddressBookRow
                                        key={row.id}
                                        row={row}
                                        showLogo={!isMain}
                                        onPersist={update}
                                        onDelete={remove}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                        {shown.length === 0 && (
                            <Text size="sm" dimmed className="px-3 py-8 text-center">
                                Nobody matches “{query.trim()}”.
                            </Text>
                        )}
                    </>
                )}
            </Panel>
        </div>
    );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Share2, ImagePlus, X, UserPlus, Upload, FolderUp } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { notifications } from '../../lib/notify';
import { Button } from '../../components/ui/button';
import { TextField } from '../../components/ui/text-field';
import { MultiSelect } from '../../components/ui/multi-select';
import { Combobox } from '../../components/ui/combobox';
import { FileButton } from '../../components/ui/file-button';
import { Text } from '../../components/ui/primitives';
import { Label } from '../../components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '../../components/ui/command';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../../components/ui/dialog';
import { cn } from '../../lib/utils';
import { MAIN_BOOK, logoUrl, useParticipantsStore } from '../../context/participants';
import { useGameModes, withHeldModes } from '../production/board/gamemodes';

/*
 * ADDRESS BOOKS — the parts of the page that are about a BOOK rather than a
 * person: which one you are looking at, the league it is linked to, logos.
 *
 * A book is a set of people a producer keeps together and can SHARE. `main` is
 * the one every install has. Any other book may name a league — the Rio game
 * modes its games are played in — and each person in it may carry a logo; that link
 * is the whole feature: on any board whose game is in one of those modes, each
 * player is looked up in the league's book and their logo (and prefix) go
 * on air (server/league_logos.py). Nothing is picked per board.
 */

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

/* What a book file may be: the shared zip, or a JSON backup. */
export const BOOK_FILE_ACCEPT = '.zip,.json,application/zip,application/json';

export function downloadJson(data, filename) {
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export const fileSlug = (name) =>
    (name || 'address-book').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'address-book';

/*
 * Which book the page is on. A strip of tabs, not a dropdown: a producer with
 * a main book and a league book or two is choosing between a handful of named
 * things they can see, and the count beside each says how big it is without
 * opening it. A league book carries its league as a small caption, because
 * "which one of these goes on air by itself" is the question the strip is for.
 */
export function BookStrip({ books, value, onChange, onNew, onImportShared, busy }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <div role="tablist" aria-label="Address books"
                 className="inline-flex flex-wrap items-stretch gap-0.5 rounded-[8px] border border-border bg-muted p-0.5">
                {books.map(b => {
                    const active = b.id === value;
                    return (
                        <button
                            key={b.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => onChange(b.id)}
                            className={cn(
                                'flex items-baseline gap-2 rounded-[6px] px-3 py-1 text-xs transition-colors',
                                active
                                    ? 'bg-card text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            <span className="label-display">{b.name}</span>
                            <span className="tabular-nums opacity-70">{b.count ?? 0}</span>
                            {b.modes?.length > 0 && (
                                <span className="text-[10px] text-[#f5bb00]/90" title={b.modes.join(', ')}>
                                    LEAGUE
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            <Button size="sm" variant="ghost" onClick={onNew}>
                <Plus size={14} className="mr-1" /> New book
            </Button>
            <FileButton accept={BOOK_FILE_ACCEPT} onChange={onImportShared}>
                {(p) => (
                    <Button size="sm" variant="ghost" disabled={busy} {...p}
                            title="Load a book someone shared with you — its league, people and logos come with it">
                        <Upload size={14} className="mr-1" /> Open shared book
                    </Button>
                )}
            </FileButton>
        </div>
    );
}

/* The league picker's vocabulary: the Rio catalogue, plus whatever the book
 * already names (a shared book can link a mode this machine's cache has not
 * caught up with), creatable for the same reason. */
function useModeOptions(held) {
    const { options } = useGameModes();
    return useMemo(() => withHeldModes(options, ...(held || [])), [options, held]);
}

/*
 * A Rio community, by name. The list is fetched the first time the picker
 * opens (one cached call per session) rather than when the page mounts — most
 * visits to the Address Book never ask for it.
 */
export function CommunityPicker({ value, onChange, placeholder = 'Pick a Rio community' }) {
    const { communities, loadCommunities } = useParticipantsStore(useShallow(s => ({
        communities: s.communities,
        loadCommunities: s.loadCommunities,
    })));
    const [error, setError] = useState('');
    const open = () => {
        loadCommunities().catch(e => setError(e.message));
    };
    const data = useMemo(() => {
        const names = communities || [];
        return value && !names.includes(value) ? [value, ...names] : names;
    }, [communities, value]);
    return (
        <Combobox
            data={data}
            value={value || null}
            onChange={v => onChange(v || '')}
            onOpen={open}
            clearable
            placeholder={placeholder}
            searchPlaceholder="Search communities…"
            nothingFound={error ? `Could not reach Project Rio: ${error}` : communities ? 'No such community' : 'Loading…'}
        />
    );
}

/*
 * Pull a community's players into a book, and SAY where they came from: a
 * private community (the NNL is one) only shows its member list to a Rio key
 * inside it, and then the server takes everyone who has played in the
 * community's game modes instead. Those are different answers and the
 * producer should know which one they got.
 */
export async function pullAndReport(pull, bookId, community) {
    try {
        const r = await pull(bookId, community);
        const how = r.source === 'games'
            ? ` Its member list is private, so these are the players who have played in its game modes.`
            : '';
        notifications.show({
            message: `${community}: ${r.added} added${r.kept ? `, ${r.kept} already here` : ''}.${how}`,
            color: 'green',
        });
        return r;
    } catch (err) {
        notifications.show({ message: `Could not pull ${community}: ${err.message}`, color: 'red' });
        return null;
    }
}

export function NewBookDialog({ open, onClose, onCreated }) {
    const { createBook, pullCommunity } = useParticipantsStore(useShallow(s => ({
        createBook: s.createBook,
        pullCommunity: s.pullCommunity,
    })));
    const [name, setName] = useState('');
    const [community, setCommunity] = useState('');
    const [modes, setModes] = useState([]);
    const [busy, setBusy] = useState(false);
    const options = useModeOptions(modes);

    useEffect(() => { if (open) { setName(''); setCommunity(''); setModes([]); } }, [open]);

    // Picking a community names the book after it until the producer types a
    // name of their own.
    const pickCommunity = (c) => {
        if (!name.trim() || name === community) setName(c);
        setCommunity(c);
    };

    const submit = async (e) => {
        e?.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        try {
            const book = await createBook({ name: name.trim(), modes });
            onCreated?.(book);
            // Its game modes come with it when none were picked (server side).
            if (community) await pullAndReport(pullCommunity, book.id, community);
            onClose();
        } catch (err) {
            notifications.show({ message: `Could not create the book: ${err.message}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={submit} className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle className="label-display">New address book</DialogTitle>
                        <DialogDescription>
                            Link it to a league and its players’ logos go on air whenever a game is played in that league.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                        <Label className="field-label">Players from a Rio community (optional)</Label>
                        <CommunityPicker value={community} onChange={pickCommunity} placeholder="Start empty" />
                    </div>
                    <TextField
                        label="Name"
                        placeholder="NNL"
                        value={name}
                        autoFocus
                        onChange={e => setName(e.currentTarget.value)}
                    />
                    <div className="flex flex-col gap-1.5">
                        <Label className="field-label">League game modes (optional)</Label>
                        <MultiSelect
                            placeholder={community ? 'The community’s own modes' : 'Not linked to a league'}
                            data={options}
                            value={modes}
                            onChange={setModes}
                            creatable
                            searchPlaceholder="Search or type a mode…"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={!name.trim() || busy}>
                            {busy && community ? 'Pulling players…' : 'Create book'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/*
 * A person's league logo as a control: the square IS the upload. Empty, it is
 * a dashed slot asking for one; filled, clicking it replaces the logo, and the
 * × beside it (on hover) takes it off. It sits in the people table's Logo
 * column, so a missing or wrong logo is fixed on the row where it shows.
 */
export function PlayerLogo({ row, who }) {
    const { uploadLogo, removeLogo } = useParticipantsStore(useShallow(s => ({
        uploadLogo: s.uploadLogo,
        removeLogo: s.removeLogo,
    })));
    const url = logoUrl(row);
    const upload = async (file) => {
        if (!file) return;
        try {
            await uploadLogo(row.id, file);
        } catch (err) {
            notifications.show({ message: err.message, color: 'red' });
        }
    };
    return (
        <div className="flex items-center gap-1">
            <FileButton accept={LOGO_ACCEPT} onChange={upload}>
                {(p) => (
                    <button
                        type="button"
                        {...p}
                        title={url ? `Replace ${who}’s logo` : `Add a logo for ${who}`}
                        className={cn(
                            'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded',
                            url ? '' : 'border border-dashed border-input text-muted-foreground/60',
                            'hover:ring-1 hover:ring-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none',
                        )}
                    >
                        {url
                            ? <img src={url} alt="" className="size-full object-contain" />
                            : <ImagePlus size={13} />}
                    </button>
                )}
            </FileButton>
            {url && (
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${who}’s logo`}
                    className="size-6 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                    onClick={() => removeLogo(row.id)}
                >
                    <X size={12} />
                </Button>
            )}
        </div>
    );
}


/*
 * The book's own settings in ONE ROW: name · Rio community · the league's
 * modes · logos · share/delete. It was a titled panel with a card per team,
 * which spent most of a screen above the table on setup a producer does once
 * a season. Only a book other than `main` draws it — main is the everyday
 * book and is never a league.
 */
export function LeaguePanel({ book, participants, onDeleted }) {
    const { updateBook, deleteBook, exportShared, pullCommunity } = useParticipantsStore(useShallow(s => ({
        updateBook: s.updateBook,
        deleteBook: s.deleteBook,
        exportShared: s.exportShared,
        pullCommunity: s.pullCommunity,
    })));
    const [name, setName] = useState(book.name);
    useEffect(() => { setName(book.name); }, [book.name]);
    const [community, setCommunity] = useState(book.community || '');
    useEffect(() => { setCommunity(book.community || ''); }, [book.community]);
    const [pulling, setPulling] = useState(false);
    const [logosOpen, setLogosOpen] = useState(false);
    const options = useModeOptions(book.modes);

    const pull = async () => {
        if (!community || pulling) return;
        setPulling(true);
        await pullAndReport(pullCommunity, book.id, community);
        setPulling(false);
    };

    const share = async () => {
        try {
            downloadBlob(await exportShared(book.id), `${fileSlug(book.name)}.prsh-book.zip`);
        } catch (err) {
            notifications.show({ message: `Export failed: ${err.message}`, color: 'red' });
        }
    };

    const remove = async () => {
        const n = participants.length;
        if (!window.confirm(
            `Delete the “${book.name}” book?\n\n` +
            `Its ${n} ${n === 1 ? 'person' : 'people'} and their logos are removed. ` +
            'Your main address book is not touched.',
        )) return;
        await deleteBook(book.id);
        onDeleted?.();
    };

    return (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-[12px] border border-border bg-card px-4 py-3">
            <div className="flex w-44 flex-col gap-1">
                <Label className="field-label">Book name</Label>
                <TextField
                    value={name}
                    inputClassName="h-8"
                    onChange={e => setName(e.currentTarget.value)}
                    onBlur={() => { if (name.trim() && name.trim() !== book.name) updateBook(book.id, { name: name.trim() }); }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
            </div>
            {/* The league's own member list. Re-pulling is how a new signing
                arrives; it never removes anyone. */}
            <div className="flex w-80 flex-col gap-1">
                <Label className="field-label">Rio community</Label>
                <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                        <CommunityPicker value={community} onChange={setCommunity} />
                    </div>
                    <Button size="sm" variant="outline" className="h-8" disabled={!community || pulling} onClick={pull}
                            title="Add everyone in this community who is not in the book yet">
                        {pulling ? 'Pulling…' : 'Pull'}
                    </Button>
                </div>
            </div>
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                <Label
                    className="field-label"
                    title="In a game played in one of these modes, each player’s logo — and their prefix, from this book — goes on air."
                >
                    Played in {!book.modes?.length && <span className="normal-case text-[#60a5fa]">— pick a mode or no logo reaches a board</span>}
                </Label>
                <MultiSelect
                    placeholder="Not linked to a league"
                    data={options}
                    value={book.modes || []}
                    onChange={modes => updateBook(book.id, { modes })}
                    creatable
                    searchPlaceholder="Search or type a mode…"
                />
            </div>
            <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-8" onClick={() => setLogosOpen(true)}
                        title="Pick a folder of logos and say whose each one is">
                    <FolderUp size={14} className="mr-1.5" /> Upload logos
                </Button>
                <LogoUploadDialog open={logosOpen} onClose={() => setLogosOpen(false)} book={book} participants={participants} />
                <Button size="icon-sm" variant="ghost" className="size-8" onClick={share} aria-label="Share book"
                        title="Download this book as one .zip — its people and their logo files — to send to another producer">
                    <Share2 size={15} />
                </Button>
                <Button size="icon-sm" variant="ghost" className="size-8 text-destructive" onClick={remove}
                        aria-label="Delete book" title="Delete this book">
                    <Trash2 size={15} />
                </Button>
            </div>
        </div>
    );
}

/*
 * Bring someone you already know into this book. Most of a league's players
 * are already in the main book, typed once with their Rio ID and socials;
 * making a producer type them a second time is the cost that would stop a
 * league book from being built at all. Copies the person, not a link: a book
 * travels on its own when it is shared.
 */
export function AddFromBooks({ book, books, participants }) {
    const create = useParticipantsStore(s => s.create);
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');

    const here = useMemo(() => new Set(
        participants.filter(p => p.book === book.id)
            .map(p => (p.identities?.rioName || '').trim().toLowerCase())
            .filter(Boolean),
    ), [participants, book.id]);

    const groups = useMemo(() => {
        const ql = q.trim().toLowerCase();
        return books.filter(b => b.id !== book.id).map(b => ({
            book: b,
            rows: participants.filter(p => (p.book || MAIN_BOOK) === b.id
                && !here.has((p.identities?.rioName || '').trim().toLowerCase())
                && (!ql || [p.display?.tag, p.identities?.rioName, p.display?.fullName]
                    .some(v => (v || '').toLowerCase().includes(ql)))),
        })).filter(g => g.rows.length);
    }, [books, book.id, participants, here, q]);

    const copy = async (p) => {
        await create({
            book: book.id,
            identities: { rioName: p.identities?.rioName || '' },
            display: { ...(p.display || {}) },
            prefs: { ...(p.prefs || {}) },
        });
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                    <UserPlus size={14} className="mr-1.5" /> Add from other books
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
                <Command shouldFilter={false}>
                    <CommandInput value={q} onValueChange={setQ} placeholder="Search people…" />
                    <CommandList>
                        <CommandEmpty>Everyone you know is already in this book.</CommandEmpty>
                        {groups.map(g => (
                            <CommandGroup key={g.book.id} heading={g.book.name}>
                                {g.rows.map(p => (
                                    <CommandItem key={p.id} value={p.id} onSelect={() => copy(p)}>
                                        <span className="flex min-w-0 flex-col">
                                            <span className="truncate">{p.display?.tag || p.identities?.rioName || '(unnamed)'}</span>
                                            {p.identities?.rioName && p.identities.rioName !== p.display?.tag && (
                                                <span className="truncate font-mono text-xs text-muted-foreground">{p.identities.rioName}</span>
                                            )}
                                        </span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

/*
 * A FOLDER OF LOGOS, EACH ATTACHED TO A PLAYER. A league hands out its logos
 * as a folder, one per manager, and the only question per image is WHOSE it
 * is — so that is the only field. The player is picked by hand from this
 * book (or typed, to add someone new); nothing is matched from file names,
 * because the producer knows whose logo is whose and a wrong guess that looks
 * right is worse than a blank.
 *
 * A logo already on that player is replaced. There is no team to name: the
 * one place a team name could show (Player Name's tag line) reads the league
 * row's own prefix.
 */
export function LogoUploadDialog({ open, onClose, book, participants }) {
    const attachLogos = useParticipantsStore(s => s.attachLogos);
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState(false);
    const folderRef = useRef(null);
    const filesRef = useRef(null);

    // Object URLs are memory held for the page's life unless handed back —
    // all of them, once, when the dialog closes (not per edit: a row still on
    // screen needs its preview).
    const urls = useRef([]);
    useEffect(() => {
        if (open) return;
        urls.current.forEach(u => URL.revokeObjectURL(u));
        urls.current = [];
        setItems([]);
    }, [open]);

    const people = useMemo(() => participants
        .map(p => ({
            value: p.id,
            label: p.display?.tag || p.identities?.rioName || 'Unnamed',
            // Says what picking them will do: replace a logo they already have.
            detail: p.logo ? 'has a logo' : undefined,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)), [participants]);

    const add = (fileList) => {
        const files = Array.from(fileList || []).filter(f => IMAGE_TYPES.has(f.type));
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        const made = files.map(f => URL.createObjectURL(f));
        urls.current.push(...made);
        setItems(cur => [
            ...cur,
            ...files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, url: made[i], player: '' })),
        ]);
    };

    const patch = (key, part) => setItems(cur => cur.map(it => (it.key === key ? { ...it, ...part } : it)));
    const drop = (key) => setItems(cur => cur.filter(it => it.key !== key));

    const ready = items.filter(it => it.player);

    // One logo per person: a player already picked for another image is not
    // offered again (clear that row to free them).
    const optionsFor = (it) => {
        const taken = new Set(items.filter(o => o.key !== it.key && o.player).map(o => o.player));
        const opts = people.filter(p => !taken.has(p.value));
        return it.player && !people.some(p => p.value === it.player)
            ? [...opts, { value: it.player, label: it.player, detail: 'new person' }]
            : opts;
    };

    const submit = async () => {
        if (!ready.length || busy) return;
        setBusy(true);
        const { done, failed } = await attachLogos(book.id, ready);
        setBusy(false);
        notifications.show({
            message: failed.length
                ? `${done} logos attached; ${failed.length} failed — ${failed[0]}`
                : `${done} ${done === 1 ? 'logo' : 'logos'} attached.`,
            color: failed.length ? 'red' : 'green',
        });
        if (!failed.length) onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="label-display">Upload logos</DialogTitle>
                    <DialogDescription>
                        Pick whose logo each one is. It goes on air beside that player in {book.name} games.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-2">
                    <Button size="sm" variant={items.length ? 'outline' : 'default'} onClick={() => folderRef.current?.click()}>
                        <FolderUp size={14} className="mr-1.5" /> Choose folder
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => filesRef.current?.click()}>
                        <ImagePlus size={14} className="mr-1.5" /> Choose files
                    </Button>
                    <input
                        ref={folderRef}
                        type="file"
                        className="hidden"
                        // Non-standard, and React only passes it through as a
                        // string attribute: this is what makes the picker a
                        // folder picker in Chromium, Safari and Firefox alike.
                        webkitdirectory=""
                        multiple
                        onChange={e => { add(e.currentTarget.files); e.currentTarget.value = ''; }}
                    />
                    <input
                        ref={filesRef}
                        type="file"
                        className="hidden"
                        accept={LOGO_ACCEPT}
                        multiple
                        onChange={e => { add(e.currentTarget.files); e.currentTarget.value = ''; }}
                    />
                    {items.length > 0 && (
                        <Text size="xs" dimmed span className="ml-auto tabular-nums">
                            {ready.length} of {items.length} assigned
                        </Text>
                    )}
                </div>

                {items.length === 0 ? (
                    <Text size="sm" dimmed className="py-10 text-center">
                        PNG, JPEG, WebP or SVG. Large logos are scaled down to 1024 px; anything else in the folder is ignored.
                    </Text>
                ) : (
                    <div className="-mx-1 flex max-h-[55vh] flex-col gap-1 overflow-y-auto px-1">
                        {items.map(it => (
                            <div key={it.key}
                                 className="grid grid-cols-[2.5rem_minmax(0,1fr)_2rem] items-center gap-3 rounded-md px-1 py-1 hover:bg-muted/40">
                                <img src={it.url} alt="" title={it.file.name}
                                     className="size-10 rounded-md bg-muted/40 object-contain" />
                                <Combobox
                                    detailOnTrigger={false}
                                    data={optionsFor(it)}
                                    value={it.player || null}
                                    onChange={v => patch(it.key, { player: v || '' })}
                                    clearable
                                    creatable
                                    placeholder="Whose logo?"
                                    searchPlaceholder="Find or type a Rio name…"
                                    nothingFound="Type their Rio name to add them"
                                />
                                <Button variant="ghost" size="icon-sm" aria-label={`Leave out ${it.file.name}`}
                                        className="text-muted-foreground" onClick={() => drop(it.key)}>
                                    <X size={14} />
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
                    <Button disabled={!ready.length || busy} onClick={submit}>
                        {busy ? 'Attaching…' : ready.length ? `Attach ${ready.length} ${ready.length === 1 ? 'logo' : 'logos'}` : 'Attach logos'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Download, Upload } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { notifications } from '../../lib/notify';
import { Button } from '../../components/ui/button';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Combobox } from '../../components/ui/combobox';
import { Badge } from '../../components/ui/badge';
import { Title, Text } from '../../components/ui/primitives';
import { cn } from '../../lib/utils';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { useParticipantsStore } from '../../context/participants';
import { MSB_CHARACTERS } from '../../data/msb';

const characterOptions = MSB_CHARACTERS.map(c => ({ value: c, label: c }));

// Provenance chip — how a row entered the book (Phase 2). Read-only.
const SOURCE_CHIP = {
    manual: { label: 'Manual', cls: 'bg-muted text-muted-foreground' },
    startgg: { label: 'start.gg', cls: 'bg-[#3b82f6]/15 text-[#60a5fa]' },
    hud: { label: 'HUD', cls: 'bg-[#f5bb00]/15 text-[#f5bb00]' },
};

function SourceChip({ source, startggTag }) {
    const meta = SOURCE_CHIP[source] || SOURCE_CHIP.manual;
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
 * Address Book — a CRUD view over the participant registry (the streamer's
 * persistent local working set of people). Rows live in user_data/participants.json
 * via the REST singleton, NOT in broadcast State. Picking a person on a
 * scoreboard copies these fields into the live player keys (resolve-by-copy).
 */

function AddressBookRow({ row, onPersist, onDelete }) {
    // Local draft so we PUT on blur, not on every keystroke. Seeded from the
    // row once; in Phase 1 rows only change from this view.
    const [draft, setDraft] = useState(() => ({
        rioName: row.identities?.rioName ?? '',
        tag: row.display?.tag ?? '',
        prefix: row.display?.prefix ?? '',
        fullName: row.display?.fullName ?? '',
        pronoun: row.display?.pronoun ?? '',
        country: row.display?.country ?? '',
        mainCharacter: row.display?.mainCharacter ?? '',
        twitter: row.display?.twitter ?? '',
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
                mainCharacter: draft.mainCharacter,
                twitter: draft.twitter,
            },
        });
    }, [row.id, draft, onPersist]);

    // Combobox has no blur event — persist immediately on its change.
    const setMain = (value) => {
        setDraft(d => ({ ...d, mainCharacter: value }));
        onPersist(row.id, { display: { ...rowDisplay(draft), mainCharacter: value } });
    };

    return (
        <TableRow>
            <TableCell>
                <TextField placeholder="Tag" value={draft.tag} onChange={e => setField('tag', e.currentTarget.value)} onBlur={persist} />
            </TableCell>
            <TableCell>
                <TextField placeholder="NP6" value={draft.prefix} onChange={e => setField('prefix', e.currentTarget.value)} onBlur={persist} inputClassName="w-[80px]" />
            </TableCell>
            <TableCell>
                <TextField placeholder="Online ID" value={draft.rioName} onChange={e => setField('rioName', e.currentTarget.value)} onBlur={persist} />
            </TableCell>
            <TableCell>
                <TextField placeholder="First Last" value={draft.fullName} onChange={e => setField('fullName', e.currentTarget.value)} onBlur={persist} />
            </TableCell>
            <TableCell>
                <TextField placeholder="He/Him" value={draft.pronoun} onChange={e => setField('pronoun', e.currentTarget.value)} onBlur={persist} inputClassName="w-[80px]" />
            </TableCell>
            <TableCell>
                <TextField placeholder="US" value={draft.country} onChange={e => setField('country', e.currentTarget.value)} onBlur={persist} inputClassName="w-[60px]" />
            </TableCell>
            <TableCell>
                <Combobox
                    placeholder="Main"
                    data={characterOptions}
                    clearable
                    value={draft.mainCharacter || null}
                    onChange={val => setMain(val ?? '')}
                    className="w-[150px]"
                />
            </TableCell>
            <TableCell>
                <TextField placeholder="@handle" value={draft.twitter} onChange={e => setField('twitter', e.currentTarget.value)} onBlur={persist} />
            </TableCell>
            <TableCell>
                <SourceChip source={row.meta?.source} startggTag={row.identities?.startgg?.gamerTag} />
            </TableCell>
            <TableCell>
                <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => onDelete(row.id)}>
                    <X size={14} />
                </Button>
            </TableCell>
        </TableRow>
    );
}

// Helper so the main-character combobox persists the rest of the draft alongside it.
function rowDisplay(draft) {
    return {
        tag: draft.tag,
        prefix: draft.prefix,
        fullName: draft.fullName,
        pronoun: draft.pronoun,
        country: draft.country,
        twitter: draft.twitter,
    };
}

export default function PlayerList() {
    const { participants, load, create, update, remove, exportBook, importBook } = useParticipantsStore(useShallow(s => ({
        participants: s.participants,
        load: s.load,
        create: s.create,
        update: s.update,
        remove: s.remove,
        exportBook: s.exportBook,
        importBook: s.importBook,
    })));

    useEffect(() => { load(); }, [load]);

    const addPerson = useCallback(() => { create({}); }, [create]);

    const fileInputRef = useRef(null);
    const [busy, setBusy] = useState(false);

    const handleExport = useCallback(async () => {
        try {
            const data = await exportBook();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `prsh-address-book-${stamp}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            notifications.show({ message: `Export failed: ${e.message}`, color: 'red' });
        }
    }, [exportBook]);

    const handleImportFile = useCallback(async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow re-selecting the same file later
        if (!file) return;
        setBusy(true);
        try {
            const parsed = JSON.parse(await file.text());
            const count = Array.isArray(parsed) ? parsed.length
                : Array.isArray(parsed?.participants) ? parsed.participants.length : 0;
            const replace = participants.length > 0 && count > 0 && window.confirm(
                `Import ${count} ${count === 1 ? 'person' : 'people'}.\n\n` +
                'OK  — Replace: wipe the current book, then load the file exactly.\n' +
                'Cancel — Merge: keep everyone; add new people and refresh matches.',
            );
            const result = await importBook(parsed, replace);
            notifications.show({
                message: replace
                    ? `Replaced address book: ${result.imported} imported.`
                    : `Merged: ${result.created} added, ${result.updated} updated.`,
                color: 'green',
            });
        } catch (err) {
            notifications.show({ message: `Import failed: ${err.message}`, color: 'red' });
        } finally {
            setBusy(false);
        }
    }, [importBook, participants.length]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <Title order={3}>Address Book</Title>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={handleImportFile}
                    />
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                        <Upload size={14} className="mr-1.5" /> Import
                    </Button>
                    <Button size="sm" variant="outline" disabled={participants.length === 0} onClick={handleExport}>
                        <Download size={14} className="mr-1.5" /> Export
                    </Button>
                    <Button size="sm" onClick={addPerson}>+ Add Person</Button>
                </div>
            </div>

            <Text size="sm" dimmed>
                People you broadcast often. Saved here, they resurface automatically when
                you play them again and can be picked on any scoreboard.
            </Text>

            <Panel title="People" className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Tag</TableHead>
                            <TableHead>Prefix</TableHead>
                            <TableHead>Rio Name</TableHead>
                            <TableHead>Full Name</TableHead>
                            <TableHead>Pronoun</TableHead>
                            <TableHead>Country</TableHead>
                            <TableHead>Main</TableHead>
                            <TableHead>Twitter</TableHead>
                            <TableHead>Source</TableHead>
                            <TableHead className="w-10"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {participants.map(row => (
                            <AddressBookRow
                                key={row.id}
                                row={row}
                                onPersist={update}
                                onDelete={remove}
                            />
                        ))}
                    </TableBody>
                </Table>
                {participants.length === 0 && (
                    <Text size="sm" dimmed className="px-3 py-6 text-center">
                        No one saved yet. Add a person, or pick someone on a scoreboard to start your book.
                    </Text>
                )}
            </Panel>
        </div>
    );
}

import { useCallback, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Panel } from '../../components/ui/panel';
import { TextField } from '../../components/ui/text-field';
import { Combobox } from '../../components/ui/combobox';
import { Title } from '../../components/ui/primitives';
import {
    Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '../../components/ui/table';
import { useStateStore } from '../../context/store';
import { MSB_CHARACTERS } from '../../data/msb';

const characterOptions = MSB_CHARACTERS.map(c => ({ value: c, label: c }));

function PlayerRow({ index, onDelete }) {
    const basePath = `player_list.slot.${index}.player.1`;
    const setItem = useStateStore(s => s.setItem);

    const name    = useStateStore(s => s?.player_list?.slot?.[index]?.player?.[1]?.name ?? '');
    const twitter = useStateStore(s => s?.player_list?.slot?.[index]?.player?.[1]?.twitter ?? '');
    const country = useStateStore(s => s?.player_list?.slot?.[index]?.player?.[1]?.country ?? '');
    const pronoun = useStateStore(s => s?.player_list?.slot?.[index]?.player?.[1]?.pronoun ?? '');
    const mainChar = useStateStore(s => s?.player_list?.slot?.[index]?.player?.[1]?.main_character ?? '');

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    return (
        <TableRow>
            <TableCell>
                <TextField placeholder="Tag" value={name} onChange={e => set('name', e.currentTarget.value)} />
            </TableCell>
            <TableCell>
                <TextField placeholder="@handle" value={twitter} onChange={e => set('twitter', e.currentTarget.value)} />
            </TableCell>
            <TableCell>
                <TextField placeholder="US" value={country} onChange={e => set('country', e.currentTarget.value)} inputClassName="w-[60px]" />
            </TableCell>
            <TableCell>
                <TextField placeholder="He/Him" value={pronoun} onChange={e => set('pronoun', e.currentTarget.value)} inputClassName="w-[80px]" />
            </TableCell>
            <TableCell>
                <Combobox
                    placeholder="Main"
                    data={characterOptions}
                    clearable
                    value={mainChar || null}
                    onChange={val => set('main_character', val ?? '')}
                    className="w-[150px]"
                />
            </TableCell>
            <TableCell>
                <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => onDelete(index)}>
                    <X size={14} />
                </Button>
            </TableCell>
        </TableRow>
    );
}

export default function PlayerList() {
    const [slotCount, setSlotCount] = useState(8);
    const deleteItem = useStateStore(s => s.deleteItem);

    const addSlot = useCallback(() => {
        setSlotCount(prev => prev + 1);
    }, []);

    const deleteSlot = useCallback((index) => {
        // Clear the slot data in state
        deleteItem(`player_list.slot.${index}`);
    }, [deleteItem]);

    const slots = [];
    for (let i = 0; i < slotCount; i++) {
        slots.push(
            <PlayerRow key={i} index={i} onDelete={deleteSlot} />
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <Title order={3}>Player List</Title>
                <Button size="sm" onClick={addSlot}>+ Add Player</Button>
            </div>

            <Panel title="Players" className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Twitter</TableHead>
                            <TableHead>Country</TableHead>
                            <TableHead>Pronoun</TableHead>
                            <TableHead>Main</TableHead>
                            <TableHead className="w-10"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {slots}
                    </TableBody>
                </Table>
            </Panel>
        </div>
    );
}

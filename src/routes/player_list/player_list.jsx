import { useCallback, useState } from 'react';
import {
    TextInput, Select, Button, Group, Stack, Paper, Text, Table,
    ActionIcon, ScrollArea
} from '@mantine/core';
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
        <Table.Tr>
            <Table.Td>
                <TextInput
                    size="xs"
                    placeholder="Tag"
                    value={name}
                    onChange={e => set('name', e.currentTarget.value)}
                />
            </Table.Td>
            <Table.Td>
                <TextInput
                    size="xs"
                    placeholder="@handle"
                    value={twitter}
                    onChange={e => set('twitter', e.currentTarget.value)}
                />
            </Table.Td>
            <Table.Td>
                <TextInput
                    size="xs"
                    placeholder="US"
                    value={country}
                    onChange={e => set('country', e.currentTarget.value)}
                    w={60}
                />
            </Table.Td>
            <Table.Td>
                <TextInput
                    size="xs"
                    placeholder="He/Him"
                    value={pronoun}
                    onChange={e => set('pronoun', e.currentTarget.value)}
                    w={80}
                />
            </Table.Td>
            <Table.Td>
                <Select
                    size="xs"
                    placeholder="Main"
                    data={characterOptions}
                    searchable
                    clearable
                    value={mainChar || null}
                    onChange={val => set('main_character', val ?? '')}
                    w={150}
                />
            </Table.Td>
            <Table.Td>
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(index)}>
                    <Text size="xs">X</Text>
                </ActionIcon>
            </Table.Td>
        </Table.Tr>
    );
}

export default function PlayerList() {
    const [slotCount, setSlotCount] = useState(8);
    const setItem = useStateStore(s => s.setItem);
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
        <Stack gap="md">
            <Group justify="space-between">
                <Text size="lg" fw={700}>Player List</Text>
                <Button size="xs" onClick={addSlot}>
                    + Add Player
                </Button>
            </Group>

            <Paper withBorder>
                <ScrollArea>
                    <Table striped highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>Twitter</Table.Th>
                                <Table.Th>Country</Table.Th>
                                <Table.Th>Pronoun</Table.Th>
                                <Table.Th>Main</Table.Th>
                                <Table.Th w={40}></Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {slots}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Paper>
        </Stack>
    );
}

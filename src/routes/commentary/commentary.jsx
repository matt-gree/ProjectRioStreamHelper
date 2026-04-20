import { useCallback } from 'react';
import {
    TextInput, Stack, Paper, Text, Group
} from '@mantine/core';
import { useStateStore } from '../../context/store';

/**
 * A single commentator slot.
 */
function CommentatorSlot({ index }) {
    const basePath = `commentary.${index}`;
    const setItem = useStateStore(s => s.setItem);

    const name    = useStateStore(s => s?.commentary?.[index]?.name ?? '');
    const twitter = useStateStore(s => s?.commentary?.[index]?.twitter ?? '');
    const pronoun = useStateStore(s => s?.commentary?.[index]?.pronoun ?? '');
    const realName = useStateStore(s => s?.commentary?.[index]?.real_name ?? '');

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    return (
        <Paper withBorder p="sm">
            <Text size="sm" fw={700} mb="xs">Commentator {index + 1}</Text>
            <Group grow gap="xs">
                <TextInput
                    label="Name"
                    placeholder="Tag"
                    size="xs"
                    value={name}
                    onChange={e => set('name', e.currentTarget.value)}
                />
                <TextInput
                    label="Real Name"
                    placeholder="Full name"
                    size="xs"
                    value={realName}
                    onChange={e => set('real_name', e.currentTarget.value)}
                />
                <TextInput
                    label="Twitter"
                    placeholder="@handle"
                    size="xs"
                    value={twitter}
                    onChange={e => set('twitter', e.currentTarget.value)}
                />
                <TextInput
                    label="Pronoun"
                    placeholder="He/Him"
                    size="xs"
                    value={pronoun}
                    onChange={e => set('pronoun', e.currentTarget.value)}
                />
            </Group>
        </Paper>
    );
}

export default function Commentary() {
    // Fixed 4 commentator slots (matching original PyQt version)
    const slots = [0, 1, 2, 3];

    return (
        <Stack gap="md">
            <Text size="lg" fw={700}>Commentary</Text>
            {slots.map(i => (
                <CommentatorSlot key={i} index={i} />
            ))}
        </Stack>
    );
}

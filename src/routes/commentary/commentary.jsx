import { useCallback } from 'react';
import {
    TextInput, Stack, Paper, Text, Grid, Group, Button,
    NumberInput, ActionIcon
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

    const clearSlot = useCallback(() => {
        setItem(`${basePath}.name`, '');
        setItem(`${basePath}.twitter`, '');
        setItem(`${basePath}.pronoun`, '');
        setItem(`${basePath}.real_name`, '');
    }, [basePath, setItem]);

    return (
        <Paper withBorder p="sm">
            <Group justify="space-between" mb="xs">
                <Text size="sm" fw={700}>Commentator {index + 1}</Text>
                <ActionIcon variant="subtle" color="red" size="sm" onClick={clearSlot} title="Clear">
                    <Text size="xs">X</Text>
                </ActionIcon>
            </Group>
            <Grid gutter="xs">
                <Grid.Col span={6}>
                    <TextInput
                        label="Name"
                        placeholder="Tag"
                        size="xs"
                        value={name}
                        onChange={e => set('name', e.currentTarget.value)}
                    />
                </Grid.Col>
                <Grid.Col span={6}>
                    <TextInput
                        label="Real Name"
                        placeholder="Full name"
                        size="xs"
                        value={realName}
                        onChange={e => set('real_name', e.currentTarget.value)}
                    />
                </Grid.Col>
                <Grid.Col span={6}>
                    <TextInput
                        label="Twitter"
                        placeholder="@handle"
                        size="xs"
                        value={twitter}
                        onChange={e => set('twitter', e.currentTarget.value)}
                    />
                </Grid.Col>
                <Grid.Col span={6}>
                    <TextInput
                        label="Pronoun"
                        placeholder="He/Him"
                        size="xs"
                        value={pronoun}
                        onChange={e => set('pronoun', e.currentTarget.value)}
                    />
                </Grid.Col>
            </Grid>
        </Paper>
    );
}

export default function Commentary() {
    // Fixed 4 commentator slots (matching original PyQt version)
    const slots = [0, 1, 2, 3];

    return (
        <Stack gap="md" maw={700}>
            <Text size="lg" fw={700}>Commentary</Text>
            {slots.map(i => (
                <CommentatorSlot key={i} index={i} />
            ))}
        </Stack>
    );
}

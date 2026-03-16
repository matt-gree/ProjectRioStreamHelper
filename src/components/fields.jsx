import { useState } from 'react';
import { Group, Title, Box, ActionIcon, Text } from '@mantine/core';
import { useConfigStore } from '../context/store';
import SettingsModal from './SettingsModal';

export default function TSHFields() {
    const app_name = useConfigStore(state => state.name);
    const app_version = useConfigStore(state => state.version);
    const [settingsOpen, setSettingsOpen] = useState(false);

    return (
        <Box px="md" pt="sm" pb="xs">
            <Group justify="space-between" mb="xs">
                <Group gap="xs" align="center">
                    <img src="/favicon.png" alt="" width={24} height={24} />
                    <Title order={4}>
                        {app_name || 'TSH'} {app_version ? `v${app_version}` : ''}
                    </Title>
                </Group>
                <ActionIcon
                    variant="subtle"
                    size="md"
                    onClick={() => setSettingsOpen(true)}
                    title="Settings"
                >
                    <Text size="md" lh={1}>&#9881;</Text>
                </ActionIcon>
            </Group>
            <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Box>
    );
}

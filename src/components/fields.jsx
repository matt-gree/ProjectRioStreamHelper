import { useState } from 'react';
import { Group, Button, Title, Box, ActionIcon, Text } from '@mantine/core';
import { FormattedMessage } from 'react-intl';
import { useConfigStore } from '../context/store';
import SettingsModal from './SettingsModal';

export default function TSHFields() {
    const app_name = useConfigStore(state => state.name);
    const app_version = useConfigStore(state => state.version);
    const [settingsOpen, setSettingsOpen] = useState(false);

    return (
        <Box px="md" pt="sm" pb="xs">
            <Group justify="space-between" mb="xs">
                <Title order={4}>
                    {app_name || 'TSH'} {app_version ? `v${app_version}` : ''}
                </Title>
                <ActionIcon
                    variant="subtle"
                    size="md"
                    onClick={() => setSettingsOpen(true)}
                    title="Settings"
                >
                    <Text size="md" lh={1}>&#9881;</Text>
                </ActionIcon>
            </Group>
            <Group gap="xs" grow>
                <Button variant="outline" size="xs">
                    <FormattedMessage
                        id="tsh.set_tournament"
                        defaultMessage="Set Tournament"
                    />
                </Button>
            </Group>
            <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Box>
    );
}

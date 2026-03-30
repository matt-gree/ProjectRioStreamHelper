import { useState, useEffect, useCallback } from 'react';
import { Group, Title, Box, ActionIcon, Text, Tooltip } from '@mantine/core';
import { useConfigStore } from '../context/store';
import { useSocket } from '../context/socket';
import SettingsModal from './SettingsModal';

export default function TSHFields() {
    const app_name = useConfigStore(state => state.name);
    const app_version = useConfigStore(state => state.version);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [connected, setConnected] = useState(false);

    const socket = useSocket();

    useEffect(() => {
        setConnected(socket.connected);

        const onConnect = () => setConnected(true);
        const onDisconnect = () => setConnected(false);

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
        };
    }, [socket]);

    return (
        <Box px="md" pt="sm" pb="xs">
            <Group justify="space-between" mb="xs">
                <Group gap="xs" align="center">
                    <img src="/favicon.png" alt="" width={24} height={24} />
                    <Title order={4}>
                        {app_name || 'TSH'} {app_version ? `v${app_version}` : ''}
                    </Title>
                </Group>
                <Group gap="xs" align="center">
                    <Tooltip label={connected ? 'Connected to server' : 'Disconnected from server'}>
                        <Box
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: connected ? '#22c55e' : '#ef4444',
                            }}
                        />
                    </Tooltip>
                    <ActionIcon
                        variant="subtle"
                        size="md"
                        onClick={() => setSettingsOpen(true)}
                        title="Settings"
                    >
                        <Text size="md" lh={1}>&#9881;</Text>
                    </ActionIcon>
                </Group>
            </Group>
            <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Box>
    );
}

import { useState, useEffect, useCallback } from 'react';
import {
    Modal, Stack, PasswordInput, Button, Group, Badge, Text, Divider, Loader,
} from '@mantine/core';

/**
 * Settings modal with Project Rio API key management.
 *
 * Props:
 *   opened — whether the modal is visible
 *   onClose — callback to close the modal
 */
export default function SettingsModal({ opened, onClose }) {
    const [keyValue, setKeyValue] = useState('');
    const [configured, setConfigured] = useState(false);
    const [saving, setSaving] = useState(false);
    const [refreshingModes, setRefreshingModes] = useState(false);
    const [modeCount, setModeCount] = useState(null);

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/rio/key/status');
            const data = await resp.json();
            setConfigured(!!data.configured);
        } catch { /* ignore */ }
    }, []);

    const fetchModeCount = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/rio/game-modes');
            const data = await resp.json();
            setModeCount(Object.keys(data).length);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (opened) {
            fetchStatus();
            fetchModeCount();
            setKeyValue('');
        }
    }, [opened, fetchStatus, fetchModeCount]);

    const handleRefreshModes = useCallback(async () => {
        setRefreshingModes(true);
        try {
            const resp = await fetch('/api/v1/rio/game-modes/refresh', { method: 'POST' });
            const data = await resp.json();
            if (data.success) setModeCount(data.count);
        } catch { /* ignore */ }
        setRefreshingModes(false);
    }, []);

    const handleSave = useCallback(async () => {
        if (!keyValue.trim()) return;
        setSaving(true);
        try {
            const resp = await fetch('/api/v1/rio/key', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: keyValue.trim() }),
            });
            const data = await resp.json();
            if (data.success) {
                setConfigured(true);
                setKeyValue('');
            }
        } catch { /* ignore */ }
        setSaving(false);
    }, [keyValue]);

    return (
        <Modal opened={opened} onClose={onClose} title="Settings" size="sm">
            <Stack gap="sm">
                <Divider label="Project Rio" labelPosition="center" />
                <Group justify="space-between">
                    <Text size="sm">API Key</Text>
                    <Badge
                        size="sm"
                        color={configured ? 'green' : 'red'}
                        variant="filled"
                    >
                        {configured ? 'Configured' : 'Not Set'}
                    </Badge>
                </Group>
                <PasswordInput
                    placeholder="Enter your Rio API key"
                    size="xs"
                    value={keyValue}
                    onChange={e => setKeyValue(e.currentTarget.value)}
                />
                <Button
                    size="xs"
                    onClick={handleSave}
                    disabled={!keyValue.trim() || saving}
                    loading={saving}
                >
                    Save Key
                </Button>

                <Divider />

                <Group justify="space-between">
                    <Text size="sm">Game Modes</Text>
                    {modeCount !== null && (
                        <Badge size="sm" variant="light">
                            {modeCount} loaded
                        </Badge>
                    )}
                </Group>
                <Button
                    size="xs"
                    variant="outline"
                    onClick={handleRefreshModes}
                    disabled={refreshingModes}
                    leftSection={refreshingModes ? <Loader size={12} /> : null}
                >
                    {refreshingModes ? 'Refreshing...' : 'Refresh Game Modes'}
                </Button>
            </Stack>
        </Modal>
    );
}

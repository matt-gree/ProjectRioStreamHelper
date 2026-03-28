import { useState, useEffect, useCallback } from 'react';
import {
    Modal, Stack, PasswordInput, Button, Group, Badge, Text, Divider, Loader,
    TextInput, ActionIcon, Tooltip,
} from '@mantine/core';


/**
 * Settings modal with Project Rio API key management and HUD path configuration.
 */
export default function SettingsModal({ opened, onClose }) {
    const [keyValue, setKeyValue] = useState('');
    const [configured, setConfigured] = useState(false);
    const [saving, setSaving] = useState(false);
    const [refreshingModes, setRefreshingModes] = useState(false);
    const [modeCount, setModeCount] = useState(null);

    // HUD path state
    const [hudPath, setHudPath] = useState('');
    const [resolvedPath, setResolvedPath] = useState(null);
    const [defaultPath, setDefaultPath] = useState('');
    const [browsingInProgress, setBrowsingInProgress] = useState(false);
    const [savingPath, setSavingPath] = useState(false);
    const [hudPathError, setHudPathError] = useState('');

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

    const fetchHudPath = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/rio/hud-path');
            const data = await resp.json();
            setHudPath(data.configured || '');
            setResolvedPath(data.resolved || null);
            setDefaultPath(data.default || '');
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (opened) {
            fetchStatus();
            fetchModeCount();
            fetchHudPath();
            setKeyValue('');
        }
    }, [opened, fetchStatus, fetchModeCount, fetchHudPath]);

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

    const handleSetHudPath = useCallback(async (path) => {
        setSavingPath(true);
        setHudPathError('');
        try {
            const resp = await fetch(`/api/v1/rio/hud-path?path=${encodeURIComponent(path)}`, { method: 'PUT' });
            const data = await resp.json();
            if (data.success) {
                setHudPath(path);
                setResolvedPath(data.resolved || null);
                if (data.warning) {
                    setHudPathError(data.warning);
                }
            } else {
                setHudPathError(data.error || 'Failed to set path');
            }
        } catch (e) {
            setHudPathError(String(e));
        }
        setSavingPath(false);
    }, []);

    const handleClearHudPath = useCallback(async () => {
        await handleSetHudPath('');
    }, [handleSetHudPath]);

    const handleBrowse = useCallback(async () => {
        setBrowsingInProgress(true);
        setHudPathError('');
        try {
            const resp = await fetch('/api/v1/rio/browse-hud', { method: 'POST' });
            const data = await resp.json();
            if (data.success && data.path) {
                await handleSetHudPath(data.path);
            } else if (data.error) {
                setHudPathError(data.error);
            }
        } catch (e) {
            setHudPathError(String(e));
        }
        setBrowsingInProgress(false);
    }, [handleSetHudPath]);

    return (
        <Modal opened={opened} onClose={onClose} title="Settings" size="md">
            <Stack gap="sm">
                <Divider label="Project Rio" labelPosition="center" />

                {/* HUD File Path */}
                <Text size="sm" fw={500}>HUD File Path</Text>
                <Text size="xs" c="dimmed">
                    Path to Project Rio's decoded.hud.json file. Leave empty to use the default location.
                </Text>

                {hudPath ? (
                    <Group gap="xs" wrap="nowrap">
                        <TextInput
                            size="xs"
                            value={hudPath}
                            readOnly
                            style={{ flex: 1 }}
                        />
                        <Tooltip label="Clear (use default)">
                            <ActionIcon size="sm" variant="subtle" color="red" onClick={handleClearHudPath} loading={savingPath}>
                                {'×'}
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                ) : (
                    <TextInput
                        size="xs"
                        value=""
                        placeholder={defaultPath}
                        readOnly
                    />
                )}

                <Group gap="xs">
                    <Badge
                        size="sm"
                        color={resolvedPath ? 'green' : 'red'}
                        variant="filled"
                    >
                        {resolvedPath ? 'Found' : 'Not Found'}
                    </Badge>
                    {resolvedPath && !hudPath && (
                        <Text size="xs" c="dimmed">(using default)</Text>
                    )}
                </Group>

                <Button
                    size="xs"
                    variant="outline"
                    onClick={handleBrowse}
                    loading={browsingInProgress}
                >
                    Browse...
                </Button>

                {hudPathError && (
                    <Text size="xs" c="red">{hudPathError}</Text>
                )}

                <Divider />

                {/* API Key */}
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

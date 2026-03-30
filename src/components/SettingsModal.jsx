import { useState, useEffect, useCallback } from 'react';
import {
    Modal, Stack, PasswordInput, Button, Group, Badge, Text, Divider,
    TextInput, ActionIcon, Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';


/**
 * Settings modal with HUD path configuration and Challonge API key.
 */
export default function SettingsModal({ opened, onClose }) {
    // Challonge API key state
    const [challongeKey, setChallongeKey] = useState('');
    const [challongeConfigured, setChallongeConfigured] = useState(false);
    const [challongeSaving, setChallongeSaving] = useState(false);

    // HUD path state
    const [hudPath, setHudPath] = useState('');
    const [resolvedPath, setResolvedPath] = useState(null);
    const [defaultPath, setDefaultPath] = useState('');
    const [browsingInProgress, setBrowsingInProgress] = useState(false);
    const [savingPath, setSavingPath] = useState(false);
    const [hudPathError, setHudPathError] = useState('');

    const fetchHudPath = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/rio/hud-path');
            const data = await resp.json();
            setHudPath(data.configured || '');
            setResolvedPath(data.resolved || null);
            setDefaultPath(data.default || '');
        } catch { /* ignore */ }
    }, []);

    const fetchChallongeStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/settings?key=challonge.api_key');
            const data = await resp.json();
            setChallongeConfigured(!!data);
        } catch { /* ignore */ }
    }, []);

    const handleSaveChallongeKey = useCallback(async () => {
        if (!challongeKey.trim()) return;
        setChallongeSaving(true);
        try {
            const resp = await fetch(`/api/v1/settings?key=challonge.api_key&value=${encodeURIComponent(challongeKey.trim())}`, {
                method: 'PUT',
            });
            const data = await resp.json();
            if (data.success) {
                setChallongeConfigured(true);
                setChallongeKey('');
                notifications.show({ message: 'Challonge API key saved', color: 'green' });
            }
        } catch {
            notifications.show({ message: 'Failed to save Challonge API key', color: 'red' });
        }
        setChallongeSaving(false);
    }, [challongeKey]);

    useEffect(() => {
        if (opened) {
            fetchHudPath();
            fetchChallongeStatus();
            setChallongeKey('');
        }
    }, [opened, fetchHudPath, fetchChallongeStatus]);

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
                } else {
                    notifications.show({ message: path ? 'HUD path updated' : 'HUD path reset to default', color: 'green' });
                }
            } else {
                setHudPathError(data.error || 'Failed to set path');
                notifications.show({ message: data.error || 'Failed to set HUD path', color: 'red' });
            }
        } catch (e) {
            setHudPathError(String(e));
            notifications.show({ message: 'Failed to set HUD path', color: 'red' });
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

                <Divider label="Challonge" labelPosition="center" />

                <Group justify="space-between">
                    <Text size="sm">API Key</Text>
                    <Badge
                        size="sm"
                        color={challongeConfigured ? 'green' : 'red'}
                        variant="filled"
                    >
                        {challongeConfigured ? 'Configured' : 'Not Set'}
                    </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                    Required to load Challonge tournaments. Get your key from your Challonge account settings.
                </Text>
                <PasswordInput
                    placeholder="Enter your Challonge API key"
                    size="xs"
                    value={challongeKey}
                    onChange={e => setChallongeKey(e.currentTarget.value)}
                />
                <Button
                    size="xs"
                    onClick={handleSaveChallongeKey}
                    disabled={!challongeKey.trim() || challongeSaving}
                    loading={challongeSaving}
                >
                    Save Key
                </Button>
            </Stack>
        </Modal>
    );
}

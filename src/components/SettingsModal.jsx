import { useState, useEffect, useCallback } from 'react';
import {
    Modal, Stack, PasswordInput, Button, Group, Badge, Text, Divider,
    TextInput, ActionIcon, Tooltip, SegmentedControl, Switch,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import LogsViewer from './LogsViewer';
import { useSettingsStore } from '../context/store';
import { useAssetsVersionStore } from '../lib/assets';
import { SupportLinks } from './SupportLinks';


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

    // MSB assets path state (mirrors HUD path UX)
    const [assetsPath, setAssetsPath] = useState('');
    const [assetsResolved, setAssetsResolved] = useState('');
    const [assetsDefault, setAssetsDefault] = useState('');
    const [assetsCategories, setAssetsCategories] = useState({});
    const [assetsTotalExpected, setAssetsTotalExpected] = useState(0);
    const [assetsTotalFound, setAssetsTotalFound] = useState(0);
    const [assetsComplete, setAssetsComplete] = useState(false);
    const [assetsBrowsing, setAssetsBrowsing] = useState(false);
    const [assetsSaving, setAssetsSaving] = useState(false);
    const [assetsRevealing, setAssetsRevealing] = useState(false);
    const [assetsError, setAssetsError] = useState('');

    // Pinned player state
    const [pinnedPlayer, setPinnedPlayer] = useState('');
    const [pinnedSide, setPinnedSide] = useState('Team 1');
    const [pinnedSaving, setPinnedSaving] = useState(false);

    // Controller overlay state
    const [controllerStatus, setControllerStatus] = useState(null);
    const [controllerPath, setControllerPath] = useState('');
    const [controllerPathSaving, setControllerPathSaving] = useState(false);

    // Stream labels (txt export) state
    const [streamLabelsEnabled, setStreamLabelsEnabled] = useState(false);
    const [streamLabelsSaving, setStreamLabelsSaving] = useState(false);

    // Announcements state
    const [announcementCount, setAnnouncementCount] = useState(0);
    const [announcementsClearing, setAnnouncementsClearing] = useState(false);

    // Logs viewer
    const [logsOpen, setLogsOpen] = useState(false);

    const bumpAssetsVersion = useAssetsVersionStore(s => s.bump);

    // Appearance — color scheme stored as a regular setting for portability.
    const colorScheme = useSettingsStore(state => state?.ui?.color_scheme) || 'auto';
    const setSetting = useSettingsStore(state => state.setItem);
    const handleColorScheme = useCallback((value) => {
        setSetting('ui.color_scheme', value);
    }, [setSetting]);

    const fetchHudPath = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/rio/hud-path');
            const data = await resp.json();
            setHudPath(data.configured || '');
            setResolvedPath(data.resolved || null);
            setDefaultPath(data.default || '');
        } catch { /* ignore */ }
    }, []);

    const fetchAssetsPath = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/assets/msb');
            const data = await resp.json();
            setAssetsPath(data.configured || '');
            setAssetsResolved(data.resolved || '');
            setAssetsDefault(data.default || '');
            setAssetsCategories(data.categories || {});
            setAssetsTotalExpected(data.total_expected || 0);
            setAssetsTotalFound(data.total_found || 0);
            setAssetsComplete(!!data.complete);
        } catch { /* ignore */ }
    }, []);

    const fetchChallongeStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/settings?key=challonge.api_key');
            const data = await resp.json();
            setChallongeConfigured(!!data);
        } catch { /* ignore */ }
    }, []);

    const fetchPinnedPlayer = useCallback(async () => {
        try {
            const [playerResp, sideResp] = await Promise.all([
                fetch('/api/v1/settings?key=project_rio.pinned_player'),
                fetch('/api/v1/settings?key=project_rio.pinned_side'),
            ]);
            const player = await playerResp.json();
            const side = await sideResp.json();
            setPinnedPlayer(player || '');
            setPinnedSide(side || 'Team 1');
        } catch { /* ignore */ }
    }, []);

    const handleSavePinnedPlayer = useCallback(async () => {
        setPinnedSaving(true);
        try {
            await Promise.all([
                fetch(`/api/v1/settings?key=project_rio.pinned_player&value=${encodeURIComponent(pinnedPlayer.trim())}`, { method: 'PUT' }),
                fetch(`/api/v1/settings?key=project_rio.pinned_side&value=${encodeURIComponent(pinnedSide)}`, { method: 'PUT' }),
            ]);
            notifications.show({
                message: pinnedPlayer.trim() ? `Locked "${pinnedPlayer.trim()}" to ${pinnedSide}` : 'Player lock cleared',
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to save player lock', color: 'red' });
        }
        setPinnedSaving(false);
    }, [pinnedPlayer, pinnedSide]);

    const fetchStreamLabels = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/settings?key=general.disable_export');
            const data = await resp.json();
            // Treat empty string, "0", "false", null, false as enabled (falsy export-disabled)
            const disabled = data === true
                || (typeof data === 'string' && !['', '0', 'false', 'no', 'off'].includes(data.toLowerCase()));
            setStreamLabelsEnabled(!disabled);
        } catch { /* ignore */ }
    }, []);

    const handleToggleStreamLabels = useCallback(async (enabled) => {
        setStreamLabelsEnabled(enabled);
        setStreamLabelsSaving(true);
        try {
            // disable_export is inverted: empty string = enabled (falsy), "1" = disabled (truthy).
            // Must always PUT — DELETE lets the default (True) re-apply on next load.
            const value = enabled ? '' : '1';
            await fetch(`/api/v1/settings?key=general.disable_export&value=${value}`, { method: 'PUT' });
            // On enable, do a one-shot full export so every key has a file.
            // Subsequent writes are diff-only (efficient).
            if (enabled) {
                await fetch('/api/v1/state/export-all', { method: 'POST' });
            }
            notifications.show({
                message: enabled ? 'Stream labels enabled — writing to user_data/stream_labels/' : 'Stream labels disabled',
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to update stream labels setting', color: 'red' });
            setStreamLabelsEnabled(!enabled);
        }
        setStreamLabelsSaving(false);
    }, []);

    const fetchAnnouncements = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/announcements');
            const data = await resp.json();
            setAnnouncementCount(data?.items?.length || 0);
        } catch { /* ignore */ }
    }, []);

    const handleClearAnnouncements = useCallback(async () => {
        setAnnouncementsClearing(true);
        try {
            const resp = await fetch('/api/v1/announcements/dismiss-all', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                const n = data.dismissed || 0;
                setAnnouncementCount(0);
                notifications.show({
                    message: n === 0 ? 'No announcements to clear' : `Cleared ${n} announcement${n === 1 ? '' : 's'}`,
                    color: 'green',
                });
            } else {
                notifications.show({ message: 'Failed to clear announcements', color: 'red' });
            }
        } catch {
            notifications.show({ message: 'Failed to clear announcements', color: 'red' });
        }
        setAnnouncementsClearing(false);
    }, []);

    const fetchControllerStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/controller/status');
            const data = await resp.json();
            setControllerStatus(data);
            setControllerPath(data.path || '');
        } catch { /* ignore */ }
    }, []);

    const handleSaveControllerPath = useCallback(async () => {
        setControllerPathSaving(true);
        try {
            const resp = await fetch(`/api/v1/controller/path?path=${encodeURIComponent(controllerPath.trim())}`, {
                method: 'PUT',
            });
            const data = await resp.json();
            if (data.success) {
                notifications.show({
                    message: data.available ? `gc-overlay found at ${data.path}` : 'Path saved but gc-overlay not found there',
                    color: data.available ? 'green' : 'yellow',
                });
                await fetchControllerStatus();
            } else {
                notifications.show({ message: data.error || 'Failed to set path', color: 'red' });
            }
        } catch {
            notifications.show({ message: 'Failed to save controller path', color: 'red' });
        }
        setControllerPathSaving(false);
    }, [controllerPath, fetchControllerStatus]);

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
            fetchAssetsPath();
            fetchPinnedPlayer();
            fetchChallongeStatus();
            fetchControllerStatus();
            fetchStreamLabels();
            fetchAnnouncements();
            setChallongeKey('');
        }
    }, [opened, fetchHudPath, fetchAssetsPath, fetchPinnedPlayer, fetchChallongeStatus, fetchControllerStatus, fetchStreamLabels, fetchAnnouncements]);

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

    const handleSetAssetsPath = useCallback(async (path) => {
        setAssetsSaving(true);
        setAssetsError('');
        try {
            const resp = await fetch(`/api/v1/assets/msb?path=${encodeURIComponent(path)}`, { method: 'PUT' });
            const data = await resp.json();
            if (data.success) {
                setAssetsPath(path);
                setAssetsResolved(data.resolved || '');
                setAssetsCategories(data.categories || {});
                setAssetsTotalExpected(data.total_expected || 0);
                setAssetsTotalFound(data.total_found || 0);
                setAssetsComplete(!!data.complete);
                bumpAssetsVersion();
                notifications.show({ message: path ? 'MSB assets path updated' : 'MSB assets path reset to default', color: 'green' });
            } else {
                setAssetsError(data.error || 'Failed to set path');
                notifications.show({ message: data.error || 'Failed to set MSB assets path', color: 'red' });
            }
        } catch (e) {
            setAssetsError(String(e));
            notifications.show({ message: 'Failed to set MSB assets path', color: 'red' });
        }
        setAssetsSaving(false);
    }, []);

    const handleClearAssetsPath = useCallback(async () => {
        await handleSetAssetsPath('');
    }, [handleSetAssetsPath]);

    const handleBrowseAssets = useCallback(async () => {
        setAssetsBrowsing(true);
        setAssetsError('');
        try {
            const resp = await fetch('/api/v1/assets/msb/browse', { method: 'POST' });
            const data = await resp.json();
            if (data.success && data.path) {
                await handleSetAssetsPath(data.path);
            } else if (data.error) {
                setAssetsError(data.error);
            }
        } catch (e) {
            setAssetsError(String(e));
        }
        setAssetsBrowsing(false);
    }, [handleSetAssetsPath]);

    const handleRevealAssets = useCallback(async () => {
        setAssetsRevealing(true);
        try {
            await fetch('/api/v1/assets/msb/reveal', { method: 'POST' });
            // Re-check after a moment in case the user dropped files in, then
            // bump the asset version so any cached <img> URLs refetch.
            setTimeout(async () => {
                await fetchAssetsPath();
                bumpAssetsVersion();
            }, 1500);
        } catch { /* ignore */ }
        setAssetsRevealing(false);
    }, [fetchAssetsPath, bumpAssetsVersion]);

    return (
        <>
        <Modal opened={opened} onClose={() => { bumpAssetsVersion(); onClose(); }} title="Settings" size="lg">
            <Stack gap="sm">
                <Divider label="Appearance" labelPosition="center" />

                <Group justify="space-between" align="center">
                    <Text size="sm">Theme</Text>
                    <SegmentedControl
                        size="xs"
                        value={colorScheme}
                        onChange={handleColorScheme}
                        data={[
                            { label: 'Light', value: 'light' },
                            { label: 'Dark', value: 'dark' },
                            { label: 'Auto', value: 'auto' },
                        ]}
                    />
                </Group>

                <Group justify="space-between" align="center">
                    <Text size="sm">Welcome screen</Text>
                    <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                            setSetting('ui.welcome_dismissed', false);
                            onClose();
                        }}
                    >
                        Show again
                    </Button>
                </Group>

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

                {/* MSB Image Assets */}
                <Text size="sm" fw={500} mt="xs">MSB Image Assets</Text>
                <Text size="xs" c="dimmed">
                    Folder containing character icons, team logos, and other MSB images. Required — overlays and the UI will show broken images without it. The default location lives under user data so it survives app updates.
                </Text>

                {assetsPath ? (
                    <Group gap="xs" wrap="nowrap">
                        <TextInput
                            size="xs"
                            value={assetsPath}
                            readOnly
                            style={{ flex: 1 }}
                        />
                        <Tooltip label="Clear (use default)">
                            <ActionIcon size="sm" variant="subtle" color="red" onClick={handleClearAssetsPath} loading={assetsSaving}>
                                {'×'}
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                ) : (
                    <TextInput
                        size="xs"
                        value=""
                        placeholder={assetsDefault}
                        readOnly
                    />
                )}

                <Group gap="xs" align="center">
                    <Badge
                        size="sm"
                        color={assetsComplete ? 'green' : (assetsTotalFound > 0 ? 'yellow' : 'red')}
                        variant="filled"
                    >
                        {assetsComplete
                            ? 'Complete'
                            : assetsTotalFound > 0
                                ? `Incomplete (${assetsTotalFound}/${assetsTotalExpected})`
                                : 'No images found'}
                    </Badge>
                    {assetsTotalFound > 0 && !assetsPath && (
                        <Text size="xs" c="dimmed">(using default)</Text>
                    )}
                </Group>

                {Object.keys(assetsCategories).length > 0 && (
                    <Stack gap={4} pl="xs">
                        {Object.entries(assetsCategories).map(([name, info]) => {
                            const ok = info.missing_count === 0;
                            return (
                                <Group key={name} gap="xs" align="center" wrap="nowrap">
                                    <Text size="xs" c={ok ? 'teal' : 'red'} style={{ minWidth: 18, fontWeight: 700 }}>
                                        {ok ? '✓' : '✗'}
                                    </Text>
                                    <Text size="xs" style={{ minWidth: 110 }}>{name}/</Text>
                                    <Text size="xs" c="dimmed">
                                        {info.found}/{info.expected}
                                    </Text>
                                    {!ok && info.missing_sample.length > 0 && (
                                        <Text size="xs" c="dimmed" style={{ flex: 1 }} truncate>
                                            missing: {info.missing_sample.join(', ')}
                                            {info.missing_count > info.missing_sample.length
                                                ? ` (+${info.missing_count - info.missing_sample.length} more)`
                                                : ''}
                                        </Text>
                                    )}
                                </Group>
                            );
                        })}
                    </Stack>
                )}

                <Group gap="xs">
                    <Button
                        size="xs"
                        variant="filled"
                        onClick={handleRevealAssets}
                        loading={assetsRevealing}
                    >
                        Open Folder
                    </Button>
                    <Button
                        size="xs"
                        variant="outline"
                        onClick={handleBrowseAssets}
                        loading={assetsBrowsing}
                    >
                        Browse...
                    </Button>
                </Group>

                {assetsError && (
                    <Text size="xs" c="red">{assetsError}</Text>
                )}

                {/* Pinned Player */}
                <Text size="sm" fw={500} mt="xs">Player Lock</Text>
                <Text size="xs" c="dimmed">
                    Lock a Rio username to always appear on a specific side when a game is loaded.
                </Text>
                <TextInput
                    size="xs"
                    placeholder="Rio username"
                    value={pinnedPlayer}
                    onChange={e => setPinnedPlayer(e.currentTarget.value)}
                />
                <SegmentedControl
                    size="xs"
                    value={pinnedSide}
                    onChange={setPinnedSide}
                    data={['Team 1', 'Team 2']}
                />
                <Button
                    size="xs"
                    variant="outline"
                    onClick={handleSavePinnedPlayer}
                    loading={pinnedSaving}
                >
                    {pinnedPlayer.trim() ? 'Save Lock' : 'Clear Lock'}
                </Button>

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
                    Required to load Challonge tournaments. Get your key from your Challonge account settings. You must be an admin in the Mario Superstar Baseball Netplay Events Challonge Community. Note: Challonge support will be deprecated in the future as its API support is limited.
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

                {/* Controller Overlay section hidden until Project Rio adds needed support. Code preserved below.
                <Divider label="Controller Overlay" labelPosition="center" />

                <Group justify="space-between">
                    <Text size="sm">gc-overlay</Text>
                    <Badge
                        size="sm"
                        color={controllerStatus?.available ? 'green' : 'red'}
                        variant="filled"
                    >
                        {controllerStatus?.available ? 'Found' : 'Not Found'}
                    </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                    Path to the gc-overlay directory. Leave empty to auto-detect (looks for a sibling gc-overlay folder).
                </Text>
                <TextInput
                    size="xs"
                    placeholder={controllerStatus?.available ? controllerStatus.path : 'Not detected — enter path manually'}
                    value={controllerPath}
                    onChange={e => setControllerPath(e.currentTarget.value)}
                />
                <Button
                    size="xs"
                    variant="outline"
                    onClick={handleSaveControllerPath}
                    loading={controllerPathSaving}
                >
                    Save Path
                </Button>
                */}

                <Divider label="Stream Labels" labelPosition="center" />

                <Text size="xs" c="dimmed">
                    Export every state key as an individual .txt file to user_data/stream_labels/. Use these as Text (GDI+) sources in OBS without needing the HTML overlays. Off by default.
                </Text>
                <Group justify="center">
                    <Switch
                        size="sm"
                        label="Enable txt export"
                        checked={streamLabelsEnabled}
                        onChange={e => handleToggleStreamLabels(e.currentTarget.checked)}
                        disabled={streamLabelsSaving}
                    />
                </Group>

                <Divider label="Announcements" labelPosition="center" />

                <Text size="xs" c="dimmed">
                    Announcements reappear each time the app launches until you clear them here or they expire. Closing a toast just hides it for the current session.
                </Text>
                <Group wrap="nowrap" align="center" gap="xs">
                    <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                        {announcementCount === 0
                            ? 'No active announcements'
                            : `${announcementCount} active announcement${announcementCount === 1 ? '' : 's'}`}
                    </Text>
                    <Button
                        size="xs"
                        variant="outline"
                        color="red"
                        onClick={handleClearAnnouncements}
                        loading={announcementsClearing}
                        disabled={announcementCount === 0}
                        style={{ flex: 1 }}
                    >
                        Clear
                    </Button>
                </Group>

                <Divider label="Logs" labelPosition="center" />

                <Text size="xs" c="dimmed">
                    View recent application logs. Useful when reporting a bug — you can copy the tail, or open the folder to grab the full rotated file.
                </Text>
                <Button size="xs" variant="outline" onClick={() => setLogsOpen(true)} fullWidth>
                    View logs
                </Button>

                <Text size="xs" c="dimmed" ta="center">
                    Enjoy PRSH? Consider supporting those who make it all possible.
                </Text>
                <SupportLinks size="sm" gap="md" justify="center" />

            </Stack>
        </Modal>
        <LogsViewer opened={logsOpen} onClose={() => setLogsOpen(false)} />
        </>
    );
}

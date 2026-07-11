import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Stack, Text, Divider, Loader } from './ui/primitives';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { PasswordInput } from './ui/password-input';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { SegmentedControl } from './ui/segmented-control';
import { SimpleTooltip } from './ui/simple-tooltip';
import { notifications } from '../lib/notify';
import { cn } from '../lib/utils';
import LogsViewer from './LogsViewer';
import ParticipantPicker from './ParticipantPicker';
import { useSettingsStore, useConfigStore } from '../context/store';
import { useObsStore } from '../context/obs';
import { comboFromEvent } from '../context/staging';
import { useAssetsVersionStore } from '../lib/assets';
import { SupportLinks } from './SupportLinks';

const OBS_DOT = {
    connected: 'bg-emerald-500',
    connecting: 'bg-amber-400 animate-pulse',
    error: 'bg-destructive',
    disconnected: 'bg-muted-foreground/50',
};
const OBS_LABEL = {
    connected: 'Connected',
    connecting: 'Connecting…',
    error: 'Connection error',
    disconnected: 'Not connected',
};

// Click-to-record hotkey field: focus it, press a combo, done. Esc cancels.
function HotkeyInput({ value, onChange }) {
    const [recording, setRecording] = useState(false);
    return (
        <Input
            readOnly
            value={recording ? 'Press a key…' : (value || '')}
            placeholder="Click to set"
            onFocus={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            onKeyDown={(e) => {
                if (!recording) return;
                e.preventDefault();
                if (e.key === 'Escape') { setRecording(false); e.currentTarget.blur(); return; }
                const combo = comboFromEvent(e);
                if (combo) { onChange(combo); setRecording(false); e.currentTarget.blur(); }
            }}
            className="w-44 cursor-pointer text-center"
        />
    );
}

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
    const [hudEnabled, setHudEnabled] = useState(true);
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

    // Game data (game modes, tags, users) manual refresh
    const [gameDataRefreshing, setGameDataRefreshing] = useState(false);

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

    // OBS connection — edited as local draft, applied on "Save & Connect" so we
    // don't reconnect on every keystroke (the ObsConnectionManager reconnects
    // whenever host/port/password change).
    const [obsHost, setObsHost] = useState('127.0.0.1');
    const [obsPort, setObsPort] = useState('4455');
    const [obsPassword, setObsPassword] = useState('');

    const bumpAssetsVersion = useAssetsVersionStore(s => s.bump);

    // Appearance — color scheme stored as a regular setting for portability.
    const appName = useConfigStore(state => state.name) || 'PRSH';
    const appVersion = useConfigStore(state => state.version);
    // gc-overlay (controller input) only works on macOS — hide its settings
    // elsewhere. The flag comes from the server Config (see settings.py).
    const controllerSupported = useConfigStore(state => state.controller_overlay_supported);
    const colorScheme = useSettingsStore(state => state?.ui?.color_scheme) || 'dark';
    const setSetting = useSettingsStore(state => state.setItem);
    const handleColorScheme = useCallback((value) => {
        setSetting('ui.color_scheme', value);
    }, [setSetting]);

    // Network — LAN access opt-in. Default is loopback-only; enabling exposes
    // the app to anyone on the same WiFi (state, settings, Challonge key all
    // unauthenticated).
    const allowLan = useSettingsStore(state => state?.server?.allow_lan) === true;
    const handleAllowLan = useCallback((value) => {
        setSetting('server.allow_lan', !!value);
        notifications.show({
            message: value
                ? 'LAN access enabled. Restart PRSH for the change to take effect.'
                : 'LAN access disabled. Restart PRSH for the change to take effect.',
            color: 'yellow',
        });
    }, [setSetting]);

    // OBS — live connection status (read) + auto-connect toggle (write).
    const obsStatus = useObsStore(state => state.status);
    const obsError = useObsStore(state => state.error);
    const obsVersion = useObsStore(state => state.obsVersion);
    const obsConnect = useObsStore(state => state.connect);
    const obsAutoConnect = useSettingsStore(state => state?.obs?.auto_connect) !== false;
    const handleObsAutoConnect = useCallback((value) => {
        setSetting('obs.auto_connect', !!value);
    }, [setSetting]);
    const handleApplyObs = useCallback(() => {
        setSetting('obs.host', obsHost.trim() || '127.0.0.1');
        setSetting('obs.port', Number(obsPort) || 4455);
        setSetting('obs.password', obsPassword);
        // Settings now updated synchronously; connect reads the fresh values.
        obsConnect();
        notifications.show({ message: 'OBS connection settings saved.', color: 'green' });
    }, [setSetting, obsHost, obsPort, obsPassword, obsConnect]);

    // Production — confirm-to-live staging (see src/context/staging.js).
    const confirmEnabled = useSettingsStore(state => state?.production?.confirm?.enabled) === true;
    const confirmHotkey = useSettingsStore(state => state?.production?.confirm?.hotkey) || 'F9';
    const handleConfirmEnabled = useCallback((value) => {
        setSetting('production.confirm.enabled', !!value);
    }, [setSetting]);
    const handleConfirmHotkey = useCallback((combo) => {
        setSetting('production.confirm.hotkey', combo);
    }, [setSetting]);

    const fetchHudPath = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/rio/hud-path');
            const data = await resp.json();
            setHudPath(data.configured || '');
            setResolvedPath(data.resolved || null);
            setDefaultPath(data.default || '');
        } catch { /* ignore */ }
        try {
            const resp = await fetch('/api/v1/settings?key=project_rio.hud_enabled');
            const data = await resp.json();
            // Default true when unset; treat explicit false-ish as disabled.
            setHudEnabled(!(data === false || data === 'false' || data === '0'));
        } catch { /* ignore */ }
    }, []);

    const handleToggleHudEnabled = useCallback(async (enabled) => {
        setHudEnabled(enabled);
        try {
            await fetch(`/api/v1/scoreboards/hud-enabled?enabled=${enabled}`, { method: 'PUT' });
            notifications.show({
                message: enabled
                    ? 'HUD enabled — scoreboard 1 follows the local game'
                    : 'HUD disabled — scoreboard 1 is a normal board',
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to toggle HUD', color: 'red' });
        }
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

    const handleRefreshGameData = useCallback(async () => {
        setGameDataRefreshing(true);
        try {
            const resp = await fetch('/api/v1/rio/game-modes/refresh', { method: 'POST' });
            const data = await resp.json();
            notifications.show({
                message: `Refreshed game data — ${data.count ?? 0} active game modes`,
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to refresh game data', color: 'red' });
        }
        setGameDataRefreshing(false);
    }, []);

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
            if (resp.ok) {
                const n = data.dismissed || 0;
                setAnnouncementCount(0);
                notifications.show({
                    message: n === 0 ? 'No announcements to clear' : `Cleared ${n} announcement${n === 1 ? '' : 's'}`,
                    color: 'green',
                });
            } else {
                notifications.show({ message: data.error || 'Failed to clear announcements', color: 'red' });
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
            // Controller endpoints intentionally return success/false in the body
            // with HTTP 200 so the UI can read structured failure data.
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
            if (resp.ok) {
                setChallongeConfigured(true);
                setChallongeKey('');
                notifications.show({ message: 'Challonge API key saved', color: 'green' });
            } else {
                const data = await resp.json().catch(() => ({}));
                notifications.show({ message: data.error || 'Failed to save Challonge API key', color: 'red' });
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
            const obs = useSettingsStore.getState()?.obs ?? {};
            setObsHost(obs.host ?? '127.0.0.1');
            setObsPort(String(obs.port ?? 4455));
            setObsPassword(obs.password ?? '');
        }
    }, [opened, fetchHudPath, fetchAssetsPath, fetchPinnedPlayer, fetchChallongeStatus, fetchControllerStatus, fetchStreamLabels, fetchAnnouncements]);

    // Re-check the assets folder when the window regains focus — covers the
    // case where the user dragged files into the folder in another app and
    // tabbed back. Cheap: only fires on actual focus events.
    useEffect(() => {
        if (!opened) return;
        const onFocus = () => { fetchAssetsPath(); bumpAssetsVersion(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [opened, fetchAssetsPath, bumpAssetsVersion]);

    const handleSetHudPath = useCallback(async (path) => {
        setSavingPath(true);
        setHudPathError('');
        try {
            const resp = await fetch(`/api/v1/rio/hud-path?path=${encodeURIComponent(path)}`, { method: 'PUT' });
            const data = await resp.json();
            if (resp.ok) {
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
            if (resp.ok && data.path) {
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
            if (resp.ok) {
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
            if (resp.ok && data.path) {
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
        <Dialog open={opened} onOpenChange={(o) => { if (!o) { bumpAssetsVersion(); onClose(); } }}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="label-display">Settings</DialogTitle>
                </DialogHeader>
                <Stack gap="sm">
                    {/* About blurb — version moved here from the app title */}
                    <div className="flex items-center gap-2">
                        <img src="/favicon.png" alt="" width={28} height={28} className="pixelated" />
                        <div className="flex flex-col">
                            <Text size="sm" fw={600}>
                                {appName}{appVersion ? ` v${appVersion}` : ''}
                            </Text>
                            <Text size="xs" dimmed>
                                Tournament stream overlay manager for Mario Superstar Baseball.
                            </Text>
                        </div>
                    </div>

                    <Divider label="Appearance" />

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
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
                        </div>
                        <div className="flex items-center gap-2">
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
                        </div>
                    </div>

                    <Divider label="Project Rio" />

                    {/* HUD File Path */}
                    <Text size="sm" fw={500}>HUD File Path</Text>
                    <Text size="xs" dimmed>
                        Path to Project Rio's decoded.hud.json file. Leave empty to use the default location.
                    </Text>

                    {hudPath ? (
                        <div className="flex items-center gap-2">
                            <Input value={hudPath} readOnly className="flex-1" />
                            <SimpleTooltip label="Clear (use default)">
                                <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={handleClearHudPath} disabled={savingPath}>×</Button>
                            </SimpleTooltip>
                        </div>
                    ) : (
                        <Input value="" placeholder={defaultPath} readOnly />
                    )}

                    <div className="flex items-center gap-2">
                        <Badge className={resolvedPath ? 'bg-[#22c55e] text-black' : 'bg-destructive text-white'}>
                            {resolvedPath ? 'Found' : 'Not Found'}
                        </Badge>
                        {resolvedPath && !hudPath && (
                            <Text size="xs" dimmed>(using default)</Text>
                        )}
                    </div>

                    <Button size="xs" variant="outline" onClick={handleBrowse} disabled={browsingInProgress}>
                        {browsingInProgress && <Loader size={12} />}
                        Browse...
                    </Button>

                    {hudPathError && (
                        <Text size="xs" c="#ff5a5f">{hudPathError}</Text>
                    )}

                    {/* HUD enable — the single control for "is board 1 the HUD board" */}
                    <div className="mt-2 flex items-start gap-3">
                        <Switch checked={hudEnabled} onCheckedChange={handleToggleHudEnabled} className="mt-0.5" />
                        <div className="flex flex-col">
                            <Text size="sm" fw={500}>Follow local HUD on Scoreboard 1</Text>
                            <Text size="xs" dimmed>
                                When on, Scoreboard 1 auto-fills from the local Project Rio game. Turn off to use Scoreboard 1 as a normal single/set board (e.g. an API-only setup).
                            </Text>
                        </div>
                    </div>

                    {/* MSB Image Assets */}
                    <Text size="sm" fw={500} className="mt-2">MSB Image Assets</Text>
                    <Text size="xs" dimmed>
                        Folder containing character icons, team logos, and other MSB images. Required — overlays and the UI will show broken images without it. The default location lives under user data so it survives app updates.
                    </Text>

                    <div className="flex items-start gap-4">
                        {/* Left column: path input, status, action buttons */}
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                            {assetsPath ? (
                                <div className="flex items-center gap-2">
                                    <Input value={assetsPath} readOnly className="flex-1" />
                                    <SimpleTooltip label="Clear (use default)">
                                        <Button size="icon-sm" variant="ghost" className="text-destructive" onClick={handleClearAssetsPath} disabled={assetsSaving}>×</Button>
                                    </SimpleTooltip>
                                </div>
                            ) : (
                                <Input value="" placeholder={assetsDefault} readOnly />
                            )}

                            <div className="flex items-center gap-2">
                                <Button size="xs" onClick={handleRevealAssets} disabled={assetsRevealing}>
                                    {assetsRevealing && <Loader size={12} />}
                                    Open Folder
                                </Button>
                                <Button size="xs" variant="outline" onClick={handleBrowseAssets} disabled={assetsBrowsing}>
                                    {assetsBrowsing && <Loader size={12} />}
                                    Browse...
                                </Button>
                            </div>
                        </div>

                        {/* Right column: per-category checkmarks */}
                        {Object.keys(assetsCategories).length > 0 && (
                            <div className="flex shrink-0 flex-col gap-1">
                                {Object.entries(assetsCategories).map(([name, info]) => {
                                    const ok = info.missing_count === 0;
                                    return (
                                        <div key={name} className="flex items-center gap-2">
                                            <Text size="xs" fw={700} c={ok ? '#2dd4bf' : '#ff5a5f'} className="min-w-3">
                                                {ok ? '✓' : '✗'}
                                            </Text>
                                            <Text size="xs" className="min-w-[100px]">{name}/</Text>
                                            <Text size="xs" dimmed className="tabular-nums">
                                                {info.found}/{info.expected}
                                            </Text>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Missing-file detail (full width, below the side-by-side block) */}
                    {Object.entries(assetsCategories).some(([, info]) => info.missing_count > 0 && info.missing_sample.length > 0) && (
                        <div className="flex flex-col gap-0.5 pl-2">
                            {Object.entries(assetsCategories)
                                .filter(([, info]) => info.missing_count > 0 && info.missing_sample.length > 0)
                                .map(([name, info]) => (
                                    <Text key={name} size="xs" dimmed truncate>
                                        {name}/ missing: {info.missing_sample.join(', ')}
                                        {info.missing_count > info.missing_sample.length
                                            ? ` (+${info.missing_count - info.missing_sample.length} more)`
                                            : ''}
                                    </Text>
                                ))}
                        </div>
                    )}

                    {assetsError && (
                        <Text size="xs" c="#ff5a5f">{assetsError}</Text>
                    )}

                    {/* Pinned Player */}
                    <Text size="sm" fw={500} className="mt-2">Player Lock</Text>
                    <Text size="xs" dimmed>
                        Lock a Rio username to always appear on a specific side when a game is loaded.
                    </Text>
                    <ParticipantPicker
                        placeholder="Rio username"
                        value={pinnedPlayer}
                        onResolve={(row) => setPinnedPlayer(row.identities?.rioName || '')}
                        onRawValue={(text) => setPinnedPlayer(text)}
                    />
                    <SegmentedControl
                        size="xs"
                        value={pinnedSide}
                        onChange={setPinnedSide}
                        data={['Team 1', 'Team 2']}
                    />
                    <Button size="xs" variant="outline" onClick={handleSavePinnedPlayer} disabled={pinnedSaving}>
                        {pinnedSaving && <Loader size={12} />}
                        {pinnedPlayer.trim() ? 'Save Lock' : 'Clear Lock'}
                    </Button>

                    {/* Game Data */}
                    <Text size="sm" fw={500} className="mt-2">Game Data</Text>
                    <Text size="xs" dimmed>
                        Game modes, tags, and users from the Project Rio API are refreshed automatically each time
                        the app launches. Use this if a game mode was just added and you don't want to restart.
                    </Text>
                    <Button size="xs" variant="outline" onClick={handleRefreshGameData} disabled={gameDataRefreshing} className="w-fit">
                        {gameDataRefreshing && <Loader size={12} />}
                        Refresh Game Data Now
                    </Button>

                    <Divider label="Challonge" />

                    <div className="flex items-center justify-between">
                        <Text size="sm">API Key</Text>
                        <Badge className={challongeConfigured ? 'bg-[#22c55e] text-black' : 'bg-destructive text-white'}>
                            {challongeConfigured ? 'Configured' : 'Not Set'}
                        </Badge>
                    </div>
                    <Text size="xs" dimmed>
                        Required to load Challonge tournaments. Get your key from your Challonge account settings. You must be an admin in the Mario Superstar Baseball Netplay Events Challonge Community. Note: Challonge support will be deprecated in the future as its API support is limited.
                    </Text>
                    <PasswordInput
                        placeholder="Enter your Challonge API key"
                        value={challongeKey}
                        onChange={e => setChallongeKey(e.currentTarget.value)}
                    />
                    <Button
                        size="xs"
                        onClick={handleSaveChallongeKey}
                        disabled={!challongeKey.trim() || challongeSaving}
                    >
                        {challongeSaving && <Loader size={12} />}
                        Save Key
                    </Button>

                    {controllerSupported !== false && (
                        <>
                            <Divider label="Controller Overlay" />

                            <div className="flex items-center justify-between">
                                <Text size="sm">gc-overlay</Text>
                                <Badge className={controllerStatus?.available ? 'bg-[#22c55e] text-black' : 'bg-destructive text-white'}>
                                    {controllerStatus?.available ? 'Found' : 'Not Found'}
                                </Badge>
                            </div>
                            <Text size="xs" dimmed>
                                Path to the gc-overlay directory. Leave empty to auto-detect (looks for a sibling gc-overlay folder).
                            </Text>
                            <Input
                                placeholder={controllerStatus?.available ? controllerStatus.path : 'Not detected — enter path manually'}
                                value={controllerPath}
                                onChange={e => setControllerPath(e.currentTarget.value)}
                            />
                            <Button size="xs" variant="outline" onClick={handleSaveControllerPath} disabled={controllerPathSaving}>
                                {controllerPathSaving && <Loader size={12} />}
                                Save Path
                            </Button>
                        </>
                    )}

                    <Divider label="Network" />

                    <Label className="flex items-start gap-2">
                        <Switch checked={allowLan} onCheckedChange={handleAllowLan} className="mt-0.5" />
                        <span className="flex flex-col">
                            <Text size="sm">Allow LAN access (bind 0.0.0.0)</Text>
                            <Text size="xs" dimmed>
                                By default PRSH listens on loopback only (127.0.0.1) — only this computer can reach the UI and OBS overlays. Enable LAN access to use a phone or tablet on the same WiFi as a remote control. Anyone on the network will be able to read and modify scoreboards, settings, and any saved tournament API keys, so leave this off on shared networks (cafes, conventions).
                            </Text>
                        </span>
                    </Label>

                    <Divider label="OBS Connection" />

                    <Text size="xs" dimmed>
                        Connect to OBS via its WebSocket server (OBS 28+: Tools → WebSocket Server Settings → enable, default port 4455). PRSH connects from your browser, so use the address of the machine running OBS — localhost if that’s this computer. Powers the Production page’s On Air / Preview rail.
                    </Text>

                    <div className="grid grid-cols-[1fr_120px] gap-2">
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="obs-host"><Text size="xs" dimmed>Host</Text></Label>
                            <Input
                                id="obs-host"
                                value={obsHost}
                                onChange={e => setObsHost(e.currentTarget.value)}
                                placeholder="127.0.0.1"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label htmlFor="obs-port"><Text size="xs" dimmed>Port</Text></Label>
                            <Input
                                id="obs-port"
                                inputMode="numeric"
                                value={obsPort}
                                onChange={e => setObsPort(e.currentTarget.value.replace(/[^0-9]/g, ''))}
                                placeholder="4455"
                            />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="obs-pass"><Text size="xs" dimmed>Password (optional)</Text></Label>
                        <PasswordInput
                            id="obs-pass"
                            value={obsPassword}
                            onChange={e => setObsPassword(e.currentTarget.value)}
                            placeholder="If authentication is enabled in OBS"
                        />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <span className={cn('size-2 rounded-full', OBS_DOT[obsStatus] ?? OBS_DOT.disconnected)} />
                            <Text size="sm">
                                {OBS_LABEL[obsStatus] ?? 'Not connected'}
                                {obsStatus === 'connected' && obsVersion ? ` · v${obsVersion}` : ''}
                            </Text>
                        </div>
                        <Button size="xs" className="shrink-0" onClick={handleApplyObs}>Save &amp; Connect</Button>
                    </div>
                    {obsStatus === 'error' && obsError && (
                        <Text size="xs" className="text-destructive">{obsError}</Text>
                    )}

                    <Label className="flex items-start gap-2">
                        <Switch checked={obsAutoConnect} onCheckedChange={handleObsAutoConnect} className="mt-0.5" />
                        <span className="flex flex-col">
                            <Text size="sm">Auto-connect on launch</Text>
                            <Text size="xs" dimmed>
                                Connect to OBS automatically when PRSH starts, and keep retrying if OBS isn’t open yet.
                            </Text>
                        </span>
                    </Label>

                    <Divider label="Production" />

                    <Label className="flex items-start gap-2">
                        <Switch checked={confirmEnabled} onCheckedChange={handleConfirmEnabled} className="mt-0.5" />
                        <span className="flex flex-col">
                            <Text size="sm">Confirm changes before going live</Text>
                            <Text size="xs" dimmed>
                                Element changes on the Production page (source visibility, feeds, content) are staged
                                and only pushed to OBS and the overlays when you press the Go Live hotkey or button.
                                Scene switches, Take, and fire-now actions (replay, spotlight) stay immediate.
                            </Text>
                        </span>
                    </Label>
                    {confirmEnabled && (
                        <div className="flex items-center justify-between gap-4">
                            <Text size="sm">Go Live hotkey</Text>
                            <HotkeyInput value={confirmHotkey} onChange={handleConfirmHotkey} />
                        </div>
                    )}

                    <Divider label="Stream Labels" />

                    <div className="flex items-start justify-between gap-4">
                        <Label className="flex flex-1 items-start gap-2">
                            <Switch checked={streamLabelsEnabled} onCheckedChange={handleToggleStreamLabels} disabled={streamLabelsSaving} className="mt-0.5" />
                            <span className="flex flex-col">
                                <Text size="sm">Enable txt export</Text>
                                <Text size="xs" dimmed>
                                    Export every state key as an individual .txt file to user_data/stream_labels/. Use these as Text (GDI+) sources in OBS without needing the HTML overlays. Off by default.
                                </Text>
                            </span>
                        </Label>
                        <Button
                            size="xs"
                            className="shrink-0"
                            onClick={async () => {
                                try {
                                    const resp = await fetch('/api/v1/state/stream-labels/reveal', { method: 'POST' });
                                    if (!resp.ok) {
                                        notifications.show({
                                            message: `Reveal failed (${resp.status}). The server may need a restart to register the endpoint.`,
                                            color: 'red',
                                        });
                                    }
                                } catch (e) {
                                    notifications.show({ message: `Reveal failed: ${e?.message ?? e}`, color: 'red' });
                                }
                            }}
                        >
                            Open Folder
                        </Button>
                    </div>

                    <Divider label="Announcements" />

                    <Text size="xs" dimmed>
                        Announcements reappear each time the app launches until you clear them here or they expire. Closing a toast just hides it for the current session.
                    </Text>
                    <div className="flex items-center gap-2">
                        <Text size="sm" className="whitespace-nowrap">
                            {announcementCount === 0
                                ? 'No active announcements'
                                : `${announcementCount} active announcement${announcementCount === 1 ? '' : 's'}`}
                        </Text>
                        <Button
                            size="xs"
                            variant="outline"
                            className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={handleClearAnnouncements}
                            disabled={announcementsClearing || announcementCount === 0}
                        >
                            {announcementsClearing && <Loader size={12} />}
                            Clear
                        </Button>
                    </div>

                    <Divider label="Logs" />

                    <Text size="xs" dimmed>
                        View recent application logs. Useful when reporting a bug — you can copy the tail, or open the folder to grab the full rotated file.
                    </Text>
                    <Button size="xs" variant="outline" className="w-full" onClick={() => setLogsOpen(true)}>
                        View logs
                    </Button>

                    <Text size="xs" dimmed ta="center">
                        Enjoy PRSH? Consider supporting those who make it all possible.
                    </Text>
                    <SupportLinks />
                </Stack>
            </DialogContent>
        </Dialog>
        <LogsViewer opened={logsOpen} onClose={() => setLogsOpen(false)} />
        </>
    );
}

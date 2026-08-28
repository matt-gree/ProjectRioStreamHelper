import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Stack, Text, Divider, Loader } from './ui/primitives';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { SegmentedControl } from './ui/segmented-control';
import { notifications } from '../lib/notify';
import LogsViewer from './LogsViewer';
import { useSettingsStore, useConfigStore } from '../context/store';
import { comboFromEvent } from '../context/staging';
import { useAssetsVersionStore } from '../lib/assets';
import { SupportLinks } from './SupportLinks';
import { SIDE_LABEL_MODES, useSideLabels } from '../routes/production/sides';

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
 * Settings modal with HUD path configuration.
 */
export default function SettingsModal({ opened, onClose }) {
    // Stream labels (txt export) state
    const [streamLabelsEnabled, setStreamLabelsEnabled] = useState(false);
    const [streamLabelsSaving, setStreamLabelsSaving] = useState(false);

    // Announcements state
    const [announcementCount, setAnnouncementCount] = useState(0);
    const [announcementsClearing, setAnnouncementsClearing] = useState(false);

    // Reset match/scoreboard state (recovery hatch)
    const [resetting, setResetting] = useState(false);
    const [resetConfirm, setResetConfirm] = useState(false);

    // Logs viewer
    const [logsOpen, setLogsOpen] = useState(false);

    const bumpAssetsVersion = useAssetsVersionStore(s => s.bump);

    // Appearance — color scheme stored as a regular setting for portability.
    const appName = useConfigStore(state => state.name) || 'PRSH';
    const appVersion = useConfigStore(state => state.version);
    const colorScheme = useSettingsStore(state => state?.ui?.color_scheme) || 'dark';
    const setSetting = useSettingsStore(state => state.setItem);
    const handleColorScheme = useCallback((value) => {
        setSetting('ui.color_scheme', value);
    }, [setSetting]);

    // Production — confirm-to-live staging (see src/context/staging.js).
    const confirmEnabled = useSettingsStore(state => state?.production?.confirm?.enabled) === true;
    const confirmHotkey = useSettingsStore(state => state?.production?.confirm?.hotkey) || 'F9';
    const handleConfirmEnabled = useCallback((value) => {
        setSetting('production.confirm.enabled', !!value);
    }, [setSetting]);
    const handleConfirmHotkey = useCallback((combo) => {
        setSetting('production.confirm.hotkey', combo);
    }, [setSetting]);

    // What the console calls side 1 and side 2 (src/routes/production/sides.js).
    // `.mode` is the stored value with the fallback already applied, so the
    // control's value and the words it hands the rest of this modal cannot
    // disagree about which mode is selected.
    const sideWords = useSideLabels();
    const handleSideLabels = useCallback((value) => {
        setSetting('production.side_labels', value);
    }, [setSetting]);

    // Auto-capture — the stat file Project Rio writes at the final out is the
    // end-of-game signal for a local board (server/postgame_watch.py).
    const autoCapture = useSettingsStore(state => state?.postgame?.auto_capture) !== false;
    const handleAutoCapture = useCallback((value) => {
        setSetting('postgame.auto_capture', !!value);
    }, [setSetting]);

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

    const handleResetState = useCallback(async () => {
        setResetting(true);
        try {
            const resp = await fetch('/api/v1/scoreboards/reset', { method: 'POST' });
            const data = await resp.json();
            if (resp.ok) {
                notifications.show({
                    message: 'Match & scoreboard state reset',
                    color: 'green',
                });
            } else {
                notifications.show({ message: data.detail || 'Reset failed', color: 'red' });
            }
        } catch {
            notifications.show({ message: 'Reset failed', color: 'red' });
        }
        setResetting(false);
        setResetConfirm(false);
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

    useEffect(() => {
        if (opened) {
            fetchStreamLabels();
            fetchAnnouncements();
        }
    }, [opened, fetchStreamLabels, fetchAnnouncements]);

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

                    {/* The HUD file, the MSB image pack, gc-overlay, OBS and
                        the LAN bind all moved to the CONNECTIONS tab
                        (src/routes/connections/) — everything that points at
                        something outside PRSH. They each have a failure state
                        with a diagnostic readout you check against reality (drag
                        files in, plug a pad in, start OBS), and a modal has to be
                        closed to do any of that. What is left here is
                        preferences and the two escape hatches. */}

                    <Divider label="Production" />

                    {/* Auto-capture. It sat under "Project Rio" because the
                        stat file is Rio’s, but the SETTING is broadcast
                        behaviour and stayed behind when that section left for
                        Connections — it points at nothing outside PRSH.
                        Project Rio writes one stat file per
                        finished game, and that file landing is the only reliable
                        end-of-game signal a local board has — the HUD feed has
                        no final frame. Off leaves capture manual; the button is
                        on every board panel either way. */}
                    <div className="mt-2 flex items-start gap-3">
                        <Switch checked={autoCapture} onCheckedChange={handleAutoCapture} className="mt-0.5" />
                        <div className="flex flex-col">
                            <Text size="sm" fw={500}>Capture the box score when a game ends</Text>
                            <Text size="xs" dimmed>
                                Reads the finished game’s stats the moment Project Rio writes them, so the Stat Callout and Game Summary fill themselves in and a bound match advances to post-game. Turn off to capture by hand from the board’s panel.
                            </Text>
                        </div>
                    </div>


                    <div className="flex items-start justify-between gap-4">
                        <span className="flex flex-col">
                            <Text size="sm">Side labels</Text>
                            <Text size="xs" dimmed>
                                What the Production console calls each side. Sides are always 1 and 2 in
                                state and in overlay URLs — this is only what the panels say, so pick the
                                pair that matches how your scenes are actually laid out.
                            </Text>
                        </span>
                        <SegmentedControl
                            size="xs"
                            value={sideWords.mode}
                            onChange={handleSideLabels}
                            data={SIDE_LABEL_MODES}
                            className="shrink-0"
                        />
                    </div>

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

                    <Divider label="Reset State" />

                    <Text size="xs" dimmed>
                        Returns every scoreboard to a clean single board and deletes all authored matches. Use this to recover from stuck state — e.g. a board that refuses a match bind with &ldquo;is rotating,&rdquo; an orphaned match binding, or a stuck match conflict. Your scoreboard tabs and the HUD toggle are kept; live HUD data re-populates board&nbsp;1 automatically.
                    </Text>
                    {resetConfirm ? (
                        <div className="flex items-center gap-2">
                            <Text size="sm" className="whitespace-nowrap text-destructive">
                                Reset all match &amp; scoreboard state?
                            </Text>
                            <Button
                                size="xs"
                                variant="outline"
                                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                                onClick={handleResetState}
                                disabled={resetting}
                            >
                                {resetting && <Loader size={12} />}
                                Confirm reset
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => setResetConfirm(false)} disabled={resetting}>
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        <Button
                            size="xs"
                            variant="outline"
                            className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={() => setResetConfirm(true)}
                        >
                            Reset match &amp; scoreboard state
                        </Button>
                    )}

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

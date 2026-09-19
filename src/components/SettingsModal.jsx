import { useState, useEffect, useCallback, useId } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Text, Divider, Loader } from './ui/primitives';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { SegmentedControl } from './ui/segmented-control';
import { notifications } from '../lib/notify';
import { cn } from '../lib/utils';
import LogsViewer from './LogsViewer';
import { useSettingsStore, useConfigStore } from '../context/store';
import { comboFromEvent } from '../context/staging';
import { SupportLinks } from './SupportLinks';
import { SIDE_LABEL_MODES, useSideLabels } from '../routes/production/sides';

// Click-to-record hotkey field: focus it, press a combo, done. Esc cancels.
function HotkeyInput({ id, value, onChange }) {
    const [recording, setRecording] = useState(false);
    return (
        <Input
            id={id}
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
            className="h-7 w-36 cursor-pointer text-center text-xs"
        />
    );
}

/*
 * The modal's ONE row shape: what the setting is on the left (a label and at
 * most one short hint), the control on the right. It had three — switch-left,
 * control-right, and label-and-control inline — so the eye had to find the
 * control again on every row. `htmlFor` makes the words a click target for the
 * control and gives it its accessible name; a row without one (a button) is
 * named by the button's own text.
 */
function SettingRow({ label, hint, htmlFor, title, children, className }) {
    const Words = htmlFor ? 'label' : 'div';
    return (
        <div className={cn('flex items-center justify-between gap-6', className)} title={title}>
            <Words htmlFor={htmlFor} className={cn('flex min-w-0 flex-col gap-0.5', htmlFor && 'cursor-pointer')}>
                <span className="text-sm leading-tight">{label}</span>
                {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
            </Words>
            <div className="flex shrink-0 items-center gap-2">{children}</div>
        </div>
    );
}

function Section({ label, children }) {
    return (
        <section className="flex flex-col gap-4">
            <Divider label={label} />
            {children}
        </section>
    );
}

// `general.disable_export` is inverted and has been stored as a bool, "" and
// "1" over its life; the server reads it the same way (`State._is_export_enabled`).
function exportEnabled(disabled) {
    if (disabled === undefined || disabled === null) return false; // default: off
    if (typeof disabled === 'string') return ['', '0', 'false', 'no', 'off'].includes(disabled.trim().toLowerCase());
    return !disabled;
}

/**
 * App preferences and the escape hatches. Anything that points OUTSIDE PRSH
 * (HUD file, MSB pack, gc-overlay, OBS, LAN bind) lives on the Connections tab.
 */
export default function SettingsModal({ opened, onClose }) {
    const ids = {
        confirm: useId(), hotkey: useId(),
        capture: useId(), labels: useId(),
    };
    const setSetting = useSettingsStore(state => state.setItem);

    const appName = useConfigStore(state => state.name) || 'PRSH';
    const appVersion = useConfigStore(state => state.version);

    // ── General ──
    const colorScheme = useSettingsStore(state => state?.ui?.color_scheme) || 'dark';
    // `.mode` is the stored value with the fallback applied, so the control
    // and the words the rest of the app uses cannot disagree.
    const sideWords = useSideLabels();

    // ── Production ──
    const confirmEnabled = useSettingsStore(state => state?.production?.confirm?.enabled) === true;
    const confirmHotkey = useSettingsStore(state => state?.production?.confirm?.hotkey) || 'F9';
    // The stat file Project Rio writes at the final out is the end-of-game
    // signal for a local board (server/postgame_watch.py).
    const autoCapture = useSettingsStore(state => state?.postgame?.auto_capture) !== false;

    // ── Output ──
    const labelsEnabled = exportEnabled(useSettingsStore(state => state?.general?.disable_export));
    const [labelsSaving, setLabelsSaving] = useState(false);
    const toggleLabels = useCallback(async (enabled) => {
        setLabelsSaving(true);
        try {
            // REST rather than the socket, because the one-shot full export
            // below must run AFTER the setting has landed — ExportAll is a
            // no-op while export is off. Always PUT: a DELETE would let the
            // default (disabled) re-apply on the next load.
            const resp = await fetch(`/api/v1/settings?key=general.disable_export&value=${enabled ? '' : '1'}`, { method: 'PUT' });
            if (!resp.ok) throw new Error(String(resp.status));
            setSetting('general.disable_export', enabled ? '' : '1', false);
            // Regular saves write only what changed; seed every key once.
            if (enabled) await fetch('/api/v1/state/export-all', { method: 'POST' });
        } catch {
            notifications.show({ message: 'Couldn’t change the text file export', color: 'red' });
        }
        setLabelsSaving(false);
    }, [setSetting]);
    const revealLabels = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/state/stream-labels/reveal', { method: 'POST' });
            if (!resp.ok) throw new Error(String(resp.status));
        } catch {
            notifications.show({ message: 'Couldn’t open the text file folder', color: 'red' });
        }
    }, []);

    // ── Help & recovery ──
    const [announcementCount, setAnnouncementCount] = useState(0);
    const [announcementsClearing, setAnnouncementsClearing] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [resetConfirm, setResetConfirm] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);

    const fetchAnnouncements = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/announcements');
            const data = await resp.json();
            setAnnouncementCount(data?.items?.length || 0);
        } catch { /* ignore */ }
    }, []);

    const clearAnnouncements = useCallback(async () => {
        setAnnouncementsClearing(true);
        try {
            const resp = await fetch('/api/v1/announcements/dismiss-all', { method: 'POST' });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            setAnnouncementCount(0);
        } catch {
            notifications.show({ message: 'Couldn’t clear announcements', color: 'red' });
        }
        setAnnouncementsClearing(false);
    }, []);

    const resetBoards = useCallback(async () => {
        setResetting(true);
        try {
            const resp = await fetch('/api/v1/scoreboards/reset', { method: 'POST' });
            const data = await resp.json();
            notifications.show(resp.ok
                ? { message: 'Boards and matches reset', color: 'green' }
                : { message: data.detail || 'Reset failed', color: 'red' });
        } catch {
            notifications.show({ message: 'Reset failed', color: 'red' });
        }
        setResetting(false);
        setResetConfirm(false);
    }, []);

    useEffect(() => {
        if (opened) fetchAnnouncements();
        else setResetConfirm(false);
    }, [opened, fetchAnnouncements]);

    return (
        <>
        <Dialog open={opened} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="label-display">Settings</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-6">
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

                    <Section label="General">
                        <SettingRow label="Theme">
                            <SegmentedControl
                                size="xs"
                                value={colorScheme}
                                onChange={(v) => setSetting('ui.color_scheme', v)}
                                data={[
                                    { label: 'Light', value: 'light' },
                                    { label: 'Dark', value: 'dark' },
                                    { label: 'System', value: 'auto' },
                                ]}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Side labels"
                            hint="What the console calls each side. Overlays always use 1 and 2."
                        >
                            <SegmentedControl
                                size="xs"
                                value={sideWords.mode}
                                onChange={(v) => setSetting('production.side_labels', v)}
                                data={SIDE_LABEL_MODES}
                            />
                        </SettingRow>
                    </Section>

                    <Section label="Production">
                        <div className="flex flex-col gap-2">
                            <SettingRow
                                htmlFor={ids.confirm}
                                label="Confirm changes before going live"
                                hint="Production-page changes wait for Go Live. Scene switches and one-shot presses (replays, captures, Put on board) still happen at once."
                            >
                                <Switch
                                    id={ids.confirm}
                                    checked={confirmEnabled}
                                    onCheckedChange={(v) => setSetting('production.confirm.enabled', !!v)}
                                />
                            </SettingRow>
                            {confirmEnabled && (
                                <SettingRow htmlFor={ids.hotkey} label="Go Live hotkey" className="pl-4">
                                    <HotkeyInput
                                        id={ids.hotkey}
                                        value={confirmHotkey}
                                        onChange={(combo) => setSetting('production.confirm.hotkey', combo)}
                                    />
                                </SettingRow>
                            )}
                        </div>
                        <SettingRow
                            htmlFor={ids.capture}
                            label="Capture the box score when a game ends"
                            hint="Fills the Character Spotlight and Game Summary, and credits the game to its match. Off: capture from the board’s panel."
                        >
                            <Switch
                                id={ids.capture}
                                checked={autoCapture}
                                onCheckedChange={(v) => setSetting('postgame.auto_capture', !!v)}
                            />
                        </SettingRow>
                    </Section>

                    <Section label="Output">
                        <SettingRow
                            htmlFor={ids.labels}
                            label="Write text files for OBS"
                            hint="One .txt file per value, for OBS Text sources that don’t use the overlays."
                        >
                            <Button size="xs" variant="ghost" onClick={revealLabels}>
                                Open folder
                            </Button>
                            <Switch
                                id={ids.labels}
                                checked={labelsEnabled}
                                onCheckedChange={toggleLabels}
                                disabled={labelsSaving}
                            />
                        </SettingRow>
                    </Section>

                    <Section label="Help & recovery">
                        <SettingRow label="Logs" hint="Copy the recent log, or open the folder for the full file, when reporting a bug.">
                            <Button size="xs" variant="outline" onClick={() => setLogsOpen(true)}>
                                View logs
                            </Button>
                        </SettingRow>
                        <SettingRow label="Welcome checklist" hint="The setup steps shown on first launch.">
                            <Button
                                size="xs"
                                variant="outline"
                                onClick={() => { setSetting('ui.welcome_dismissed', false); onClose(); }}
                            >
                                Show again
                            </Button>
                        </SettingRow>
                        <SettingRow
                            label="Announcements"
                            hint={announcementCount === 0
                                ? 'None active.'
                                : `${announcementCount} active. Closing a notice hides it until the next launch; clearing hides it for good.`}
                        >
                            <Button
                                size="xs"
                                variant="outline"
                                onClick={clearAnnouncements}
                                disabled={announcementsClearing || announcementCount === 0}
                            >
                                {announcementsClearing && <Loader size={12} />}
                                Clear all
                            </Button>
                        </SettingRow>
                        <SettingRow
                            label="Reset boards and matches"
                            hint="For a board that’s stuck. Deletes every match, and clears each board’s game, capture and playback. Your boards, running orders and HUD setting stay."
                        >
                            {resetConfirm ? (
                                <>
                                    <Button size="xs" variant="ghost" onClick={() => setResetConfirm(false)} disabled={resetting}>
                                        Cancel
                                    </Button>
                                    <Button size="xs" variant="destructive" onClick={resetBoards} disabled={resetting}>
                                        {resetting && <Loader size={12} />}
                                        Delete and reset
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    size="xs"
                                    variant="outline"
                                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                                    onClick={() => setResetConfirm(true)}
                                >
                                    Reset…
                                </Button>
                            )}
                        </SettingRow>
                    </Section>

                    <div className="flex flex-col gap-2 border-t border-border pt-4">
                        <Text size="xs" dimmed ta="center">
                            Enjoy PRSH? Consider supporting those who make it all possible.
                        </Text>
                        <SupportLinks />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
        <LogsViewer opened={logsOpen} onClose={() => setLogsOpen(false)} />
        </>
    );
}

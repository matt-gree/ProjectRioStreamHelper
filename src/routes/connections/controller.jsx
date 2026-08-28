import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Text, Loader } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import ScaledIframe from '../../components/ScaledIframe';
import { notifications } from '../../lib/notify';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useSideLabels } from '../production/sides';
import { ConnBody } from './connections';

/*
 * gc-overlay — the controller-input reader.
 *
 * It is a SUBPROCESS on its own port (default 8069), not something PRSH renders,
 * and it is macOS-only (AF_UNIX MemoryWatcher sockets). Its whole install lives
 * here: where the binary is, what port it serves on, whether it boots with PRSH,
 * and whether it is up right now.
 *
 * WHY THE LIFECYCLE MOVED OFF THE PRODUCTION STAGE PANEL. Start/Stop used to sit
 * on the Controller element's stage body, which meant you could not start the
 * subprocess until you had already added an OBS source for it — you created the
 * source for a reader that wasn't running, to reach the button that runs it.
 * Backwards, and invisible until you hit it. The element's panel keeps what is
 * genuinely about the BROADCAST (the per-side follow URLs) and states the status
 * read-only; one owner for the lifecycle, no second copy to disagree.
 *
 * THE PREVIEWS are the point of this card. gc-overlay draws a physical pad, so
 * the only way to know the chain works — reader up, pad plugged in, right port —
 * is to look at it, and until now the only place to look was OBS. These iframe
 * gc-overlay directly at a FIXED port, so they need no game, no HUD frame and no
 * PRSH layout: press a button on the pad and the right box moves.
 */

// gc-overlay's `?port=` is 1-INDEXED (its page does `p - 1`), while the HUD —
// and so `score.{N}.player.{T}.port` — is 0-indexed. Every translation between
// the two lives at this boundary; getting it wrong is silent, and did once mean
// every side showed the wrong player's controller (see lib/controller-mount.js).
const GC_PORTS = [1, 2, 3, 4];
const stateIndexOf = (gcPort) => gcPort - 1;

/*
 * Which side, if any, is sitting on this controller port right now. Board 1 only:
 * the HUD board is the one that reports ports at all. Purely informational — it
 * turns "port 2 is alive" into "port 2 is alive AND it's side 1's pad", which is
 * the whole question a producer has before going live.
 */
function usePortOwners() {
    return useStateStore(useShallow((s) => {
        const p = s?.score?.[1]?.player;
        const out = {};
        for (const team of [1, 2]) {
            const port = p?.[team]?.port;
            if (typeof port === 'number') out[port] = team;
        }
        return out;
    }));
}

function PortPreview({ gcPort, baseUrl, owner }) {
    const sides = useSideLabels();
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
                <Text size="xs" fw={600}>Port {gcPort}</Text>
                {owner
                    ? <Badge className="bg-[#3b82f6]/15 text-[#60a5fa]">{sides.label(owner)}</Badge>
                    : <Text size="xs" dimmed>not in the game</Text>}
            </div>
            {/* Checkerboard, same reason as the stage preview: gc-overlay draws
                on transparency, and a flat backdrop makes "transparent" and
                "failed to load" look identical. */}
            <div
                className="overflow-hidden rounded-md border border-border/60"
                style={{
                    backgroundColor: '#15151c',
                    backgroundImage:
                        'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%),'
                        + 'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 8px 8px',
                }}
            >
                <ScaledIframe
                    src={`${baseUrl}/?port=${gcPort}&bg=transparent`}
                    nativeWidth={512}
                    nativeHeight={256}
                    minHeight={90}
                    maxHeight={200}
                    title={`Controller port ${gcPort} preview`}
                />
            </div>
        </div>
    );
}

export default function ControllerConnection() {
    const [status, setStatus] = useState(null);
    const [path, setPath] = useState('');
    const [pathSaving, setPathSaving] = useState(false);
    const [portDraft, setPortDraft] = useState('');
    const [portSaving, setPortSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const owners = usePortOwners();

    const setSetting = useSettingsStore(s => s.setItem);
    const autoStart = useSettingsStore(s => s?.controller_overlay?.auto_start) === true;

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/controller/status');
            const data = await resp.json();
            setStatus(data);
            setPath(prev => (prev ? prev : (data.path || '')));
            setPortDraft(prev => (prev ? prev : String(data.port ?? 8069)));
        } catch { /* keep the last-known status */ }
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    /*
     * Poll in BOTH states, not just while running. The old panel polled only
     * when it already believed the process was up, so a subprocess that died —
     * or one auto-started after this card mounted, or started from another
     * browser — left the card confidently reporting the opposite. Slower when
     * stopped: nothing changes on its own except an exit we want to notice.
     */
    useEffect(() => {
        const id = setInterval(fetchStatus, status?.running ? 5000 : 15000);
        return () => clearInterval(id);
    }, [status?.running, fetchStatus]);

    const handleStart = useCallback(async () => {
        setBusy(true);
        try {
            const resp = await fetch('/api/v1/controller/start', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                notifications.show({ message: 'Controller reader started', color: 'green' });
            } else if (data.reason === 'port_in_use' && data.suggested_port) {
                // The port is a real field on this card now, so the one-click fix
                // can just move it and say so, instead of hiding the whole
                // setting behind this notification the way the old panel did.
                await fetch(`/api/v1/controller/port?port=${data.suggested_port}`, { method: 'PUT' });
                setPortDraft(String(data.suggested_port));
                const retry = await (await fetch('/api/v1/controller/start', { method: 'POST' })).json();
                notifications.show(retry.success
                    ? { message: `Port ${data.port} was busy — moved to ${data.suggested_port} and started`, color: 'green' }
                    : { message: retry.error || 'Failed to start', color: 'red' });
            } else {
                notifications.show({ message: data.error || 'Failed to start', color: 'red' });
            }
        } catch {
            notifications.show({ message: 'Failed to start the controller reader', color: 'red' });
        }
        await fetchStatus();
        setBusy(false);
    }, [fetchStatus]);

    const handleStop = useCallback(async () => {
        setBusy(true);
        try {
            await fetch('/api/v1/controller/stop', { method: 'POST' });
            notifications.show({ message: 'Controller reader stopped', color: 'blue' });
        } catch { /* ignore */ }
        await fetchStatus();
        setBusy(false);
    }, [fetchStatus]);

    const handleSavePath = useCallback(async () => {
        setPathSaving(true);
        try {
            const resp = await fetch(`/api/v1/controller/path?path=${encodeURIComponent(path.trim())}`, { method: 'PUT' });
            const data = await resp.json();
            notifications.show(data.success
                ? {
                    message: data.available ? `Found gc-overlay at ${data.path}` : 'Path saved, but gc-overlay isn’t there',
                    color: data.available ? 'green' : 'yellow',
                }
                : { message: data.error || 'Failed to set path', color: 'red' });
        } catch {
            notifications.show({ message: 'Failed to save the path', color: 'red' });
        }
        await fetchStatus();
        setPathSaving(false);
    }, [path, fetchStatus]);

    const handleSavePort = useCallback(async () => {
        const n = Number(portDraft);
        if (!n) return;
        setPortSaving(true);
        try {
            await fetch(`/api/v1/controller/port?port=${n}`, { method: 'PUT' });
            notifications.show({
                message: status?.running
                    ? `Port saved — stop and start the reader to move it to ${n}`
                    : `Port set to ${n}`,
                color: 'green',
            });
        } catch {
            notifications.show({ message: 'Failed to set the port', color: 'red' });
        }
        await fetchStatus();
        setPortSaving(false);
    }, [portDraft, status?.running, fetchStatus]);

    if (!status) {
        return (
            <Panel title="Controller reader" className="lg:col-span-2"
                actions={<Badge className="bg-muted text-muted-foreground">Checking…</Badge>}>
                <ConnBody><Loader size={16} /></ConnBody>
            </Panel>
        );
    }

    const running = !!status.running;
    // Same-host assumption is the right one here: gc-overlay is a subprocess of
    // THIS server, so it is reachable at the address this browser used to get here.
    const baseUrl = `http://${window.location.hostname}:${status.port}`;

    return (
        <Panel
            title="Controller reader"
            className="lg:col-span-2"
            actions={
                <Badge className={running ? 'bg-[#22c55e] text-black'
                    : status.available ? 'bg-muted text-muted-foreground' : 'bg-destructive text-white'}>
                    {running ? 'Running' : status.available ? 'Stopped' : 'Not found'}
                </Badge>
            }
        >
            <ConnBody>
                <Text size="xs" dimmed>
                    gc-overlay reads GameCube controller input and draws it as its own browser source. It runs as
                    a separate process on its own port. Leave the path empty to auto-detect a sibling gc-overlay
                    folder.
                </Text>

                <div className="flex items-end gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Label htmlFor="gc-path"><Text size="xs" dimmed>Folder</Text></Label>
                        <Input
                            id="gc-path"
                            placeholder={status.available ? status.path : 'Not detected — enter the path manually'}
                            value={path}
                            onChange={e => setPath(e.currentTarget.value)}
                        />
                    </div>
                    <Button size="xs" variant="outline" onClick={handleSavePath} disabled={pathSaving}>
                        {pathSaving && <Loader size={12} />}
                        Save
                    </Button>
                </div>

                <div className="flex items-end gap-2">
                    <div className="flex w-[120px] flex-col gap-1">
                        <Label htmlFor="gc-port"><Text size="xs" dimmed>Port</Text></Label>
                        <Input
                            id="gc-port" inputMode="numeric" value={portDraft}
                            onChange={e => setPortDraft(e.currentTarget.value.replace(/[^0-9]/g, ''))}
                        />
                    </div>
                    <Button size="xs" variant="outline" onClick={handleSavePort} disabled={portSaving}>
                        {portSaving && <Loader size={12} />}
                        Save
                    </Button>
                    {status.version && <Text size="xs" dimmed className="ml-auto">gc-overlay {status.version}</Text>}
                </div>

                <Label className="mt-1 flex items-start gap-2">
                    <Switch
                        checked={autoStart} className="mt-0.5" disabled={!status.available}
                        onCheckedChange={v => setSetting('controller_overlay.auto_start', !!v)}
                    />
                    <span className="flex flex-col">
                        <Text size="sm">Start with PRSH</Text>
                        <Text size="xs" dimmed>
                            Launch the reader automatically at boot, so the controller sources are live before
                            you open OBS.
                        </Text>
                    </span>
                </Label>

                <div className="mt-1 flex items-center justify-between border-t border-border/60 pt-3">
                    <Text size="sm" fw={600}>
                        {running ? `Running on port ${status.port}` : status.available ? 'Not running' : 'gc-overlay not found'}
                    </Text>
                    <Button
                        size="xs"
                        variant={running ? 'outline' : 'default'}
                        className={running ? 'border-destructive/40 text-destructive' : ''}
                        onClick={running ? handleStop : handleStart}
                        disabled={busy || !status.available}
                    >
                        {busy && <Loader size={10} />}
                        {running ? 'Stop' : 'Start'}
                    </Button>
                </div>

                {running ? (
                    <div className="mt-1 flex flex-col gap-2 border-t border-border/60 pt-3">
                        <Text size="xs" dimmed>
                            Live input, straight from the reader — press a button on a pad and its box moves. No
                            game required.
                        </Text>
                        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                            {GC_PORTS.map(gcPort => (
                                <PortPreview
                                    key={gcPort} gcPort={gcPort} baseUrl={baseUrl}
                                    owner={owners[stateIndexOf(gcPort)]}
                                />
                            ))}
                        </div>
                    </div>
                ) : status.available && (
                    <Text size="xs" dimmed className="italic">
                        Start the reader to see live controller input here.
                    </Text>
                )}
            </ConnBody>
        </Panel>
    );
}

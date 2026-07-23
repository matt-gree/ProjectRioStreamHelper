import { memo, useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Text, Loader } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { CopyButton } from '../../../components/ui/copy-button';
import { notifications } from '../../../lib/notify';
import { DirectStage } from './generic';

/*
 * Controller stage — the gc-overlay controller-input display, lifted out of
 * Setup. The rack row shows/hides the OBS source like any direct element; what
 * lives HERE is the part only this element has: the gc-overlay SUBPROCESS
 * lifecycle (start/stop) and the source URLs to copy.
 *
 * macOS-only. Off-Darwin the status endpoint reports `available: false` and the
 * layout catalog omits controller/, so the Add picker never offers it — this
 * body then shows the "not found" note rather than start/stop. See the
 * controller-overlay skill for the four platform gates.
 *
 * Two source shapes, both copyable:
 *   - Per-side follow (recommended): the PRSH-served controller layout with
 *     ?team=1|2. It iframes gc-overlay at score.{N}.player.{T}.port, so a
 *     left/right source tracks whoever is on that side even across away/home
 *     reassignment. Host-qualified from the address this browser reached PRSH
 *     on — the same address OBS (even on another machine) should use.
 *   - Per-port (advanced): the raw gc-overlay at a FIXED controller index 1-4.
 *     These aren't in the layout catalog, so copying them here is the only way
 *     to wire them.
 */

const SIDE_LABEL = { 1: 'Left (side 1)', 2: 'Right (side 2)' };

// A url + a copy button, kit-row shaped.
const UrlRow = memo(function UrlRow({ label, url, disabled }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">{label}</Text>
            <CopyButton value={url}>
                {({ copied, copy }) => (
                    <Button
                        variant="ghost" size="xs" disabled={disabled}
                        className={copied ? 'text-[#14b8a6]' : ''} onClick={copy}
                    >
                        {copied ? <Check size={13} className="mr-1" /> : <Copy size={13} className="mr-1" />}
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                )}
            </CopyButton>
        </div>
    );
});

export default function ControllerStage({ element }) {
    return (
        <>
            <DirectStage element={element} />
            <ControllerContent />
        </>
    );
}

const ControllerContent = memo(function ControllerContent() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/controller/status');
            setStatus(await resp.json());
        } catch { /* leave last-known status */ }
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);
    useEffect(() => {
        if (!status?.running) return undefined;
        const id = setInterval(fetchStatus, 5000);
        return () => clearInterval(id);
    }, [status?.running, fetchStatus]);

    const handleStart = useCallback(async () => {
        setLoading(true);
        try {
            const resp = await fetch('/api/v1/controller/start', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                notifications.show({ message: 'Controller overlay started', color: 'green' });
                await fetchStatus();
            } else if (data.reason === 'port_in_use' && data.suggested_port) {
                const notifId = `ctrl-port-${data.port}`;
                notifications.show({
                    id: notifId, title: `Port ${data.port} is in use`, color: 'orange', autoClose: false,
                    message: (
                        <div className="flex flex-col gap-2">
                            <Text size="sm">Another process is using port {data.port}. Switch to {data.suggested_port}?</Text>
                            <Button size="xs" onClick={async () => {
                                notifications.hide(notifId);
                                await fetch(`/api/v1/controller/port?port=${data.suggested_port}`, { method: 'PUT' });
                                const r2 = await fetch('/api/v1/controller/start', { method: 'POST' });
                                const d2 = await r2.json();
                                notifications.show(d2.success
                                    ? { message: `Started on port ${data.suggested_port}`, color: 'green' }
                                    : { message: d2.error || 'Failed to start', color: 'red' });
                                await fetchStatus();
                            }}>Use port {data.suggested_port}</Button>
                        </div>
                    ),
                });
            } else {
                notifications.show({ message: data.error || 'Failed to start', color: 'red' });
            }
        } catch {
            notifications.show({ message: 'Failed to start controller overlay', color: 'red' });
        }
        setLoading(false);
    }, [fetchStatus]);

    const handleStop = useCallback(async () => {
        setLoading(true);
        try {
            const resp = await fetch('/api/v1/controller/stop', { method: 'POST' });
            if ((await resp.json()).success) {
                notifications.show({ message: 'Controller overlay stopped', color: 'blue' });
                await fetchStatus();
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [fetchStatus]);

    if (!status) return <Loader size={16} />;

    if (!status.available) {
        return (
            <Text size="xs" className="text-muted-foreground">
                Controller overlay (gc-overlay) isn’t available here — it’s macOS-only, and needs the
                gc-overlay repository beside this project or a path set in Settings.
            </Text>
        );
    }

    const origin = window.location.origin;
    const rawHost = window.location.hostname;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: status.running ? '#22c55e' : '#6b7280' }} />
                    <Text size="sm" fw={600}>{status.running ? 'Running' : 'Stopped'}</Text>
                    {status.running && <Text size="xs" dimmed>port {status.port} · 512×256</Text>}
                </div>
                <Button
                    size="xs"
                    variant={status.running ? 'outline' : 'default'}
                    className={status.running ? 'border-destructive/40 text-destructive' : ''}
                    onClick={status.running ? handleStop : handleStart}
                    disabled={loading}
                >
                    {loading && <Loader size={10} />}
                    {status.running ? 'Stop' : 'Start'}
                </Button>
            </div>

            {/* Per-side follow — the recommended pair. Add them from the rack's +
                (Controller group) for OBS wiring, or copy here for a manual /
                dual-machine setup. */}
            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <Text size="xs" className="label-display text-muted-foreground">Per-side follow</Text>
                {[1, 2].map(side => (
                    <UrlRow
                        key={side} label={SIDE_LABEL[side]}
                        url={`${origin}/layout/controller/controller.html?team=${side}`}
                    />
                ))}
                <Text size="xs" className="text-muted-foreground">
                    Tracks whoever is on that side — follows the port even when Rio swaps away/home.
                </Text>
            </div>

            {/* Per-port — a fixed controller index, not in the catalog, so copy is
                the only way to wire it. Only meaningful while gc-overlay runs. */}
            <div className="mt-1 flex flex-col gap-1.5 border-t border-border/60 pt-2">
                <Text size="xs" className="label-display text-muted-foreground">Per-port (fixed)</Text>
                {[1, 2, 3, 4].map(port => (
                    <UrlRow
                        key={port} label={`Player ${port}`} disabled={!status.running}
                        url={`http://${rawHost}:${status.port}/?port=${port}&bg=transparent`}
                    />
                ))}
                {!status.running && (
                    <Text size="xs" className="italic text-muted-foreground">
                        Start the overlay to use the fixed-port URLs.
                    </Text>
                )}
            </div>
        </div>
    );
});

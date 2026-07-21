import { memo, useState, useEffect, useCallback } from 'react';
import { Stack, Text, Loader } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { itemClass } from './shared';
import { CopyIconButton } from './binding';

// ── Controller Overlay Panel ──
const ControllerOverlayPanel = memo(function ControllerOverlayPanel({ selected, onSelect }) {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/controller/status');
            setStatus(await resp.json());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    useEffect(() => {
        if (!status?.running) return;
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
            } else if (data.reason === 'port_in_use') {
                const suggested = data.suggested_port;
                const notifId = `ctrl-port-${data.port}`;
                notifications.show({
                    id: notifId,
                    title: `Port ${data.port} is in use`,
                    color: 'orange',
                    autoClose: false,
                    message: suggested ? (
                        <Stack gap="xs">
                            <Text size="sm">
                                Another process is using port {data.port}. Switch to port {suggested}?
                            </Text>
                            <div className="flex items-center gap-2">
                                <Button size="xs" onClick={async () => {
                                    notifications.hide(notifId);
                                    await fetch(`/api/v1/controller/port?port=${suggested}`, { method: 'PUT' });
                                    const r2 = await fetch('/api/v1/controller/start', { method: 'POST' });
                                    const d2 = await r2.json();
                                    if (d2.success) {
                                        notifications.show({ message: `Started on port ${suggested}`, color: 'green' });
                                        await fetchStatus();
                                    } else {
                                        notifications.show({ message: d2.error || 'Failed to start', color: 'red' });
                                    }
                                }}>Use port {suggested}</Button>
                            </div>
                        </Stack>
                    ) : 'No nearby free port found. Change the port manually in settings.',
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
            const data = await resp.json();
            if (data.success) {
                notifications.show({ message: 'Controller overlay stopped', color: 'blue' });
                await fetchStatus();
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [fetchStatus]);

    const handleSelectPort = useCallback((portNum) => {
        const overlayUrl = `http://localhost:${status?.port ?? 8069}/?port=${portNum}&bg=transparent`;
        onSelect({
            group: 'controller',
            name: `Player ${portNum} Controller`,
            type: 'controller',
            url: overlayUrl,
            width: 512,
            height: 256,
            _controllerPort: portNum,
        });
    }, [status?.port, onSelect]);

    if (!status) return <Loader size={18} />;

    if (!status.available) {
        return (
            <Stack gap="xs">
                <Text size="sm" dimmed>Controller overlay (gc-overlay) not found.</Text>
                <Text size="xs" dimmed>Place the gc-overlay repository next to this project, or set the path in Settings.</Text>
            </Stack>
        );
    }

    return (
        <Stack gap="sm">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: status.running ? '#22c55e' : '#6b7280' }} />
                    <Text size="sm" fw={600}>{status.running ? 'Running' : 'Stopped'}</Text>
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

            {status.running && (
                <Text size="xs" dimmed>OBS Browser Source: 512 x 256</Text>
            )}

            <Stack gap="xs">
                {[1, 2, 3, 4].map(portNum => {
                    const isActive = selected?._controllerPort === portNum;
                    const portUrl = `http://localhost:${status.port}/?port=${portNum}&bg=transparent`;
                    return (
                        <button
                            key={portNum}
                            type="button"
                            onClick={() => handleSelectPort(portNum)}
                            className={cn(itemClass(isActive), !status.running && 'opacity-50')}
                            disabled={!status.running}
                        >
                            <div className="flex flex-nowrap items-center justify-between gap-1">
                                <div className="min-w-0 flex-1">
                                    <Text size="sm">Player {portNum}</Text>
                                </div>
                                {status.running && <CopyIconButton value={portUrl} />}
                            </div>
                        </button>
                    );
                })}
            </Stack>

            {!status.running && (
                <Text size="xs" dimmed className="italic">
                    Start the overlay to preview and copy OBS URLs.
                </Text>
            )}
        </Stack>
    );
});

export { ControllerOverlayPanel };

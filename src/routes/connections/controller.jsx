import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Loader } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import ScaledIframe from '../../components/ScaledIframe';
import { notifications } from '../../lib/notify';
import { useSettingsStore, useStateStore } from '../../context/store';
import { useSideLabels } from '../production/sides';
import { BusyButton, ConnCard, FieldLabel, Section, StatusPill, ToggleRow } from './kit';

/*
 * gc-overlay — the controller-input reader.
 *
 * It is a SUBPROCESS on its own port (default 8069), not something PRSH renders.
 * It runs on every platform as of gc-overlay 1.1.0, which carries a Dolphin
 * transport for each. It SHIPS with PRSH (bundled in every build, the submodule
 * in a source checkout), so there is no folder to point at — the card holds
 * what port it serves on, whether it boots with PRSH, and whether it is up.
 *
 * WHY THE LIFECYCLE MOVED OFF THE PRODUCTION STAGE PANEL. Start/Stop used to sit
 * on the Controller element's stage body, which meant you could not start the
 * subprocess until you had already added an OBS source for it — you created the
 * source for a reader that wasn't running, to reach the button that runs it.
 * Backwards, and invisible until you hit it. The element's panel states the
 * status read-only (its source's own link is the header's Copy URL); one owner
 * for the lifecycle, no second copy to disagree.
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
            <div className="flex h-5 items-center justify-between gap-2">
                <FieldLabel>Port {gcPort}</FieldLabel>
                {owner
                    ? <span className="rounded-[4px] bg-sky-500/15 px-1.5 text-[11px] font-semibold text-sky-300">{sides.label(owner)}</span>
                    : <span className="text-[11px] text-muted-foreground/70">not in the game</span>}
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
                {/* Gear and port label OFF. Each frame is already captioned
                    "Port N" by the row above it, and the gear's first control
                    switches port — one click and the preview is no longer
                    showing the port it is labelled with, which is the exact
                    confusion these four frames exist to resolve.

                    The status text stays ON: "Waiting for controller data..."
                    means the reader is up but Dolphin isn't hooked, and telling
                    those two apart is the whole job of this card. A broadcast
                    source hides it; a diagnostic must not.

                    Nothing here carries the producer's STYLE. These frames
                    answer "is the pad reaching PRSH", and the most legible
                    drawing is the right one for that — a keyline switched off
                    for a bright gameplay background is a worse diagnostic, and
                    a preview that needs the style to be right before it can
                    tell you the reader is wrong has two jobs. Style is the
                    element's, on its Production panel. */}
                <ScaledIframe
                    src={`${baseUrl}/?port=${gcPort}&bg=transparent&gear=0&portlabel=0`}
                    nativeWidth={512}
                    nativeHeight={180}
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
    const [portDraft, setPortDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const owners = usePortOwners();

    const setSetting = useSettingsStore(s => s.setItem);
    const autoStart = useSettingsStore(s => s?.controller_overlay?.auto_start) === true;

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/controller/status');
            const data = await resp.json();
            setStatus(data);
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

    const portDirty = !!status && !!Number(portDraft) && Number(portDraft) !== Number(status.port);

    const handleSavePort = useCallback(async () => {
        const n = Number(portDraft);
        setSaving(true);
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
        setSaving(false);
    }, [portDraft, status?.running, fetchStatus]);

    if (!status) {
        return (
            <ConnCard title="Controller reader" className="lg:col-span-3" status={<StatusPill>Checking…</StatusPill>}>
                <Section><Loader size={16} /></Section>
            </ConnCard>
        );
    }

    const running = !!status.running;
    // Same-host assumption is the right one here: gc-overlay is a subprocess of
    // THIS server, so it is reachable at the address this browser used to get here.
    const baseUrl = `http://${window.location.hostname}:${status.port}`;
    const pill = running
        ? <StatusPill tone="ok">Running · :{status.port}</StatusPill>
        : status.available ? <StatusPill>Stopped</StatusPill> : (
            // Only a source checkout without its submodule lands here.
            <StatusPill tone="bad" title="gc-overlay is missing from this install — in a source checkout, run git submodule update --init">
                Not found
            </StatusPill>
        );

    return (
        <ConnCard
            title="Controller reader"
            className="lg:col-span-3"
            status={pill}
            // Start/Stop rides the header beside the status it changes — the
            // body used to restate that status in a bold line just to give the
            // button somewhere to sit.
            actions={
                <Button
                    size="xs"
                    variant={running ? 'outline' : 'default'}
                    className={running ? 'border-destructive/40 text-destructive hover:text-destructive' : ''}
                    onClick={running ? handleStop : handleStart}
                    disabled={busy || !status.available}
                >
                    {busy && <Loader size={10} />}
                    {running ? 'Stop' : 'Start'}
                </Button>
            }
        >
            <Section>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <div className="flex items-center gap-2">
                        <FieldLabel htmlFor="gc-port">Port</FieldLabel>
                        <Input
                            id="gc-port" inputMode="numeric" value={portDraft} className="w-20 tabular-nums"
                            onChange={e => setPortDraft(e.currentTarget.value.replace(/[^0-9]/g, ''))}
                        />
                        <BusyButton busy={saving} disabled={!portDirty} onClick={handleSavePort}>Save</BusyButton>
                    </div>
                    <ToggleRow
                        checked={autoStart} disabled={!status.available}
                        onChange={v => setSetting('controller_overlay.auto_start', !!v)}
                        label="Start with PRSH"
                    />
                    {status.version && (
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            gc-overlay v{status.version}
                        </span>
                    )}
                </div>
            </Section>

            {/* Only while running: stopped / not found is already the pill. */}
            {running && (
                <Section>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {GC_PORTS.map(gcPort => (
                            <PortPreview
                                key={gcPort} gcPort={gcPort} baseUrl={baseUrl}
                                owner={owners[stateIndexOf(gcPort)]}
                            />
                        ))}
                    </div>
                </Section>
            )}
        </ConnCard>
    );
}

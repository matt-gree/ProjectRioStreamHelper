import { memo, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import { Text, Loader } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { CopyButton } from '../../../components/ui/copy-button';
import { DirectStage } from './generic';
import { useSideLabels } from '../sides';
import { KIT_SECTION } from '../kit';

/*
 * Controller stage — what is true of this element ON THE BROADCAST.
 *
 * The gc-overlay SUBPROCESS (start/stop, path, port, auto-start, and the live
 * per-port previews) lives on the CONNECTIONS tab, not here. It used to live on
 * this panel, which meant the reader could only be started from a panel that
 * only exists once you have added an OBS source for it — you built the source
 * for a process that wasn't running in order to reach the button that runs it.
 * One owner for the lifecycle; this panel states the status and links to it.
 *
 * What stays is the wiring a producer does while building a scene: the two
 * per-side follow URLs. They are PRSH-served layouts, so they are copyable
 * whether or not the reader is up — `?team=1|2` iframes gc-overlay at
 * score.{N}.player.{T}.port, so a source tracks whoever is on that side even
 * when Rio reassigns away/home. Host-qualified from the address this browser
 * reached PRSH on, which is the address OBS should use too.
 *
 * Offered on every platform — gc-overlay 1.1.0 carries a Dolphin transport for
 * each. When the reader isn't installed this body says so rather than being
 * unreachable, which is how a producer discovers there is something to install.
 */

// A url + a copy button, kit-row shaped.
const UrlRow = memo(function UrlRow({ label, url }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">{label}</Text>
            <CopyButton value={url}>
                {({ copied, copy }) => (
                    <Button variant="ghost" size="xs" className={copied ? 'text-[#14b8a6]' : ''} onClick={copy}>
                        {copied ? <Check size={13} className="mr-1" /> : <Copy size={13} className="mr-1" />}
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                )}
            </CopyButton>
        </div>
    );
});

export default function ControllerStage({ element, placement }) {
    return (
        <>
            <DirectStage element={element} placement={placement} />
            <ControllerContent />
        </>
    );
}

const ControllerContent = memo(function ControllerContent() {
    const sides = useSideLabels();
    const [status, setStatus] = useState(null);

    const fetchStatus = useCallback(async () => {
        try {
            const resp = await fetch('/api/v1/controller/status');
            setStatus(await resp.json());
        } catch { /* leave last-known status */ }
    }, []);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    if (!status) return <Loader size={16} />;

    if (!status.available) {
        return (
            <Text size="xs" className="text-muted-foreground">
                The controller reader isn’t installed — it needs the gc-overlay
                repository beside this project, or a folder set on the{' '}
                <Link to="/connections" className="underline hover:text-foreground">Connections</Link> tab.
            </Text>
        );
    }

    const origin = window.location.origin;

    return (
        <div className="flex flex-col gap-2">
            {/* Read-only. The one control is on Connections, so this says which
                way the reader is pointing and gets out of the way — a second
                Start button here is the duplication the move existed to end. */}
            <div className="flex items-center gap-2">
                <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: status.running ? '#22c55e' : '#6b7280' }}
                />
                <Text size="xs" className="text-muted-foreground">
                    {status.running
                        ? `Reader running on port ${status.port}.`
                        : 'Reader stopped — these sources will be blank.'}{' '}
                    <Link to="/connections" className="underline hover:text-foreground">Connections</Link>
                </Text>
            </div>

            <div className={KIT_SECTION}>
                <Text size="xs" className="label-display text-muted-foreground">Per-side follow</Text>
                {[1, 2].map(side => (
                    <UrlRow
                        key={side} label={sides.label(side)}
                        url={`${origin}/layout/controller/controller.html?team=${side}`}
                    />
                ))}
                <Text size="xs" className="text-muted-foreground">
                    Tracks whoever is on that side — follows the port even when Rio swaps away/home.
                </Text>
            </div>
        </div>
    );
});

import { memo, useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Text, Loader } from '../../../components/ui/primitives';
import { DirectStage } from './generic';

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
 * NO URLS HERE. This panel is ONE source, and that source already names its
 * side (`?team=`): the header's Copy URL copies exactly it, and the Add picker
 * offers both sides. A "Per-side follow · Side 1 Copy · Side 2 Copy" list on a
 * Side 1 panel was the pre-source-strip way of handing out URLs, and it read as
 * though one source needed two links. What follow MEANS — the source iframes
 * gc-overlay at score.{N}.player.{T}.port, so it tracks whoever is on that side
 * even when Rio reassigns away/home — is the element's behaviour, not a control.
 *
 * Offered on every platform — gc-overlay 1.1.0 carries a Dolphin transport for
 * each. When the reader isn't installed this body says so rather than being
 * unreachable, which is how a producer discovers there is something to install.
 */

export default function ControllerStage({ element, placement }) {
    return (
        <>
            <DirectStage element={element} placement={placement} />
            <ControllerContent />
        </>
    );
}

const ControllerContent = memo(function ControllerContent() {
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
                The controller reader wasn’t found — it ships with PRSH, and a
                source checkout needs the gc-overlay submodule. See the{' '}
                <Link to="/connections" className="underline hover:text-foreground">Connections</Link> tab.
            </Text>
        );
    }

    // Read-only. The one control is on Connections, so this says which way the
    // reader is pointing and gets out of the way — a second Start button here
    // is the duplication the move existed to end.
    return (
        <div className="flex items-center gap-2">
            <span
                className="size-2 rounded-full"
                style={{ backgroundColor: status.running ? '#22c55e' : '#6b7280' }}
            />
            <Text size="xs" className="text-muted-foreground">
                {status.running
                    ? `Reader running on port ${status.port}.`
                    : 'Reader stopped — this source will be blank.'}{' '}
                <Link to="/connections" className="underline hover:text-foreground">Connections</Link>
            </Text>
        </div>
    );
});

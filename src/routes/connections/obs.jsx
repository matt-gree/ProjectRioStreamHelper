import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { PasswordInput } from '../../components/ui/password-input';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { ConnCard, ErrorLine, FieldLabel, Section, StatusPill, ToggleRow } from './kit';

const OBS_TONE = {
    connected: 'ok',
    connecting: 'busy',
    error: 'bad',
    disconnected: 'idle',
};
const OBS_LABEL = {
    connected: 'Connected',
    connecting: 'Connecting…',
    error: 'Connection error',
    disconnected: 'Not connected',
};

/*
 * OBS — the websocket PRSH drives scenes and sources over.
 *
 * CONFIG lives here; RECONNECTING does not have to. The Production console
 * carries its own `ConnectionPill` with a Connect/Retry button, so a producer
 * whose OBS drops mid-show never has to leave the page they are working on —
 * which is what made it safe to move the host/port/password off a modal
 * reachable from everywhere. Coming here is for changing the address, not for
 * getting back on air.
 *
 * The connection itself is BROWSER-side (src/context/obs.jsx) so it reaches the
 * producer's OBS even when PRSH runs on another machine — hence "use the address
 * of the machine running OBS", which is not always this one.
 *
 * Edited as a local draft and applied on Save & Connect: the manager reconnects
 * whenever host/port/password change, so writing per keystroke would thrash the
 * socket. With nothing edited the same button is a plain Reconnect — so the
 * card always offers one press, and it names what that press will do.
 */
export default function ObsConnection() {
    const setSetting = useSettingsStore(state => state.setItem);
    const status = useObsStore(state => state.status);
    const error = useObsStore(state => state.error);
    const obsVersion = useObsStore(state => state.obsVersion);
    const connect = useObsStore(state => state.connect);
    const autoConnect = useSettingsStore(state => state?.obs?.auto_connect) !== false;

    const [host, setHost] = useState('127.0.0.1');
    const [port, setPort] = useState('4455');
    const [password, setPassword] = useState('');

    // Seed the draft from stored settings once they are loaded.
    const loaded = useSettingsStore(state => state.loaded);
    useEffect(() => {
        if (!loaded) return;
        const obs = useSettingsStore.getState()?.obs ?? {};
        setHost(obs.host ?? '127.0.0.1');
        setPort(String(obs.port ?? 4455));
        setPassword(obs.password ?? '');
    }, [loaded]);

    const handleApply = useCallback(() => {
        setSetting('obs.host', host.trim() || '127.0.0.1');
        setSetting('obs.port', Number(port) || 4455);
        setSetting('obs.password', password);
        connect();
        notifications.show({ message: 'OBS connection settings saved — connecting.', color: 'green' });
    }, [setSetting, host, port, password, connect]);

    const tone = OBS_TONE[status] ?? 'idle';
    const label = `${OBS_LABEL[status] ?? 'Not connected'}${status === 'connected' && obsVersion ? ` · v${obsVersion}` : ''}`;
    // The draft differs from what is stored — Save & Connect is the loud press
    // only while there is something to save; otherwise it is a reconnect.
    const stored = useSettingsStore(state => state?.obs);
    const dirty = loaded && (
        (host.trim() || '127.0.0.1') !== (stored?.host ?? '127.0.0.1')
        || (Number(port) || 4455) !== Number(stored?.port ?? 4455)
        || password !== (stored?.password ?? '')
    );

    return (
        <ConnCard title="OBS" status={<StatusPill tone={tone}>{label}</StatusPill>}>
            <Section>
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                        <FieldLabel htmlFor="obs-host"
                            title="OBS → Tools → WebSocket Server Settings. The address of the machine running OBS.">
                            Host
                        </FieldLabel>
                        <Input id="obs-host" value={host} placeholder="127.0.0.1"
                            onChange={e => setHost(e.currentTarget.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor="obs-port">Port</FieldLabel>
                        <Input id="obs-port" inputMode="numeric" value={port} placeholder="4455"
                            className="tabular-nums"
                            onChange={e => setPort(e.currentTarget.value.replace(/[^0-9]/g, ''))} />
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor="obs-pass">Password</FieldLabel>
                    <PasswordInput id="obs-pass" value={password}
                        placeholder="Only if authentication is on in OBS"
                        onChange={e => setPassword(e.currentTarget.value)} />
                </div>
                {/* obs-websocket's own message is often the bare word "Error",
                    which says nothing a producer can act on. */}
                {status === 'error' && (
                    <ErrorLine>
                        {error && error !== 'Error'
                            ? error
                            : 'Couldn’t reach OBS at that address — is it open, with the WebSocket server enabled?'}
                    </ErrorLine>
                )}
            </Section>
            <Section className="mt-auto flex-row items-center justify-between gap-3">
                <ToggleRow
                    checked={autoConnect}
                    onChange={v => setSetting('obs.auto_connect', !!v)}
                    label="Auto-connect"
                    title="Connect at launch, retrying until OBS is open"
                />
                <Button
                    size="sm" variant={dirty ? 'default' : 'outline'} className="shrink-0"
                    onClick={dirty ? handleApply : () => connect()}
                >
                    {dirty ? 'Save & connect' : 'Reconnect'}
                </Button>
            </Section>
        </ConnCard>
    );
}

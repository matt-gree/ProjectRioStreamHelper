import { useCallback, useEffect, useState } from 'react';
import { Text } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { PasswordInput } from '../../components/ui/password-input';
import { Switch } from '../../components/ui/switch';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import { useObsStore } from '../../context/obs';
import { ConnBody } from './connections';

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
 * socket.
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
        notifications.show({ message: 'OBS connection settings saved.', color: 'green' });
    }, [setSetting, host, port, password, connect]);

    return (
        <Panel
            title="OBS"
            actions={
                <Badge className={status === 'connected'
                    ? 'bg-[#22c55e] text-black'
                    : status === 'error' ? 'bg-destructive text-white' : 'bg-muted text-muted-foreground'}>
                    {OBS_LABEL[status] ?? 'Not connected'}
                </Badge>
            }
        >
            <ConnBody>
                <Text size="xs" dimmed>
                    Connect over the OBS WebSocket server (OBS 28+: Tools → WebSocket Server Settings → enable,
                    default port 4455). PRSH connects from your browser, so use the address of the machine
                    running OBS — localhost if that’s this computer.
                </Text>

                <div className="grid grid-cols-[1fr_120px] gap-2">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="obs-host"><Text size="xs" dimmed>Host</Text></Label>
                        <Input id="obs-host" value={host} placeholder="127.0.0.1"
                            onChange={e => setHost(e.currentTarget.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="obs-port"><Text size="xs" dimmed>Port</Text></Label>
                        <Input id="obs-port" inputMode="numeric" value={port} placeholder="4455"
                            onChange={e => setPort(e.currentTarget.value.replace(/[^0-9]/g, ''))} />
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="obs-pass"><Text size="xs" dimmed>Password (optional)</Text></Label>
                    <PasswordInput id="obs-pass" value={password}
                        placeholder="If authentication is enabled in OBS"
                        onChange={e => setPassword(e.currentTarget.value)} />
                </div>

                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className={cn('size-2 rounded-full', OBS_DOT[status] ?? OBS_DOT.disconnected)} />
                        <Text size="sm">
                            {OBS_LABEL[status] ?? 'Not connected'}
                            {status === 'connected' && obsVersion ? ` · v${obsVersion}` : ''}
                        </Text>
                    </div>
                    <Button size="xs" className="shrink-0" onClick={handleApply}>Save &amp; Connect</Button>
                </div>
                {status === 'error' && error && <Text size="xs" className="text-destructive">{error}</Text>}

                <Label className="flex items-start gap-2">
                    <Switch checked={autoConnect} className="mt-0.5"
                        onCheckedChange={v => setSetting('obs.auto_connect', !!v)} />
                    <span className="flex flex-col">
                        <Text size="sm">Auto-connect on launch</Text>
                        <Text size="xs" dimmed>
                            Connect to OBS automatically when PRSH starts, and keep retrying if OBS isn’t open yet.
                        </Text>
                    </span>
                </Label>
            </ConnBody>
        </Panel>
    );
}

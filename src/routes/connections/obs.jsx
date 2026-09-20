import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { PasswordInput } from '../../components/ui/password-input';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import { settingOn } from '../design/designConstants';
import { useObsStore } from '../../context/obs';
import { cn } from '../../lib/utils';
import { CONN_BTN, ConnCard, ErrorLine, FieldLabel, Section, StatusPill, ToggleRow } from './kit';

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
/*
 * How to turn the thing on — the four facts PRSH needed and never said.
 *
 * OBS ships with its websocket server OFF, so on a fresh install the honest
 * status is "not set up" and the useful content is a recipe, not an error
 * message. All of it existed already: the menu path was a `title` tooltip on
 * the Host input (unreachable by keyboard or touch, and nobody hovers a label
 * they don't yet know matters), and the rest was in a settings.py comment no
 * producer reads.
 *
 * Numbered because it is a SEQUENCE with a handoff in the middle — the two
 * values are copied out of OBS's dialog into the fields above, and which field
 * takes which is exactly what goes wrong when this is written as prose.
 *
 * Replaced by the error line once a connection has succeeded: from then on a
 * failure is a real fault and the recipe is noise over it.
 */
function SetupSteps() {
    return (
        <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs leading-snug text-muted-foreground marker:text-muted-foreground/60">
            <li>In OBS: <span className="text-foreground">Tools → WebSocket Server Settings</span></li>
            <li>Tick <span className="text-foreground">Enable WebSocket server</span></li>
            <li>
                Open <span className="text-foreground">Show Connect Info</span> and copy the
                {' '}<span className="text-foreground">Server IP</span> and
                {' '}<span className="text-foreground">Server Password</span> into the fields above
            </li>
            <li>Hit <span className="text-foreground">Save &amp; Connect</span></li>
        </ol>
    );
}

export default function ObsConnection() {
    const setSetting = useSettingsStore(state => state.setItem);
    const status = useObsStore(state => state.status);
    const error = useObsStore(state => state.error);
    const obsVersion = useObsStore(state => state.obsVersion);
    const connect = useObsStore(state => state.connect);
    const autoConnect = useSettingsStore(state => state?.obs?.auto_connect) !== false;
    // settingOn, not `=== true`: PUT /api/v1/settings is string-typed, so a
    // value set over REST or by a hand edit arrives as "true" — the exact
    // shape of the bug that rule exists for (see CLAUDE.md, Layouts).
    const everConnected = settingOn(
        useSettingsStore(state => state?.obs?.ever_connected), false);

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

    /*
     * Before the first success this card reads "Not set up", matching the
     * console's own pill (routes/production/production.jsx, where the argument
     * for it is written out). The two must agree: they describe one fact, a
     * producer sees both within a tab of each other, and a red CONNECTION ERROR
     * over a card explaining how to turn the server on is the card arguing with
     * itself about whether anything is wrong.
     */
    const unconfigured = !everConnected && (status === 'error' || status === 'disconnected');
    const tone = unconfigured ? 'idle' : (OBS_TONE[status] ?? 'idle');
    const label = unconfigured
        ? 'Not set up'
        : `${OBS_LABEL[status] ?? 'Not connected'}${status === 'connected' && obsVersion ? ` · v${obsVersion}` : ''}`;
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
                {/* Before the first success, the useful thing is the RECIPE,
                    not the failure — see SetupSteps. obs-websocket's own
                    message is often the bare word "Error" anyway, which says
                    nothing a producer can act on. */}
                {unconfigured && <SetupSteps />}
                {!unconfigured && status === 'error' && (
                    <ErrorLine>
                        {error && error !== 'Error'
                            ? error
                            : 'Couldn’t reach OBS at that address — is it open, with the WebSocket server enabled?'}
                    </ErrorLine>
                )}
            </Section>
            <Section className="flex-row items-center justify-between gap-3">
                <ToggleRow
                    checked={autoConnect}
                    onChange={v => setSetting('obs.auto_connect', !!v)}
                    label="Auto-connect"
                    hint="Connect when PRSH starts, retrying until OBS is open."
                />
                <Button
                    size="sm" variant={dirty ? 'default' : 'outline'} className={cn(CONN_BTN, 'shrink-0')}
                    onClick={dirty ? handleApply : () => connect()}
                >
                    {dirty ? 'Save & connect' : 'Reconnect'}
                </Button>
            </Section>
        </ConnCard>
    );
}

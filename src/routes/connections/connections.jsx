import { Title } from '../../components/ui/primitives';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { CopyButton } from '../../components/ui/copy-button';
import { cn } from '../../lib/utils';
import { RioHudConnection, MsbAssetsConnection } from './rio';
import ObsConnection from './obs';
import ControllerConnection from './controller';
import { useObsStore } from '../../context/obs';
import { CONN_BTN, ConnCard, FieldLabel, Hint, Section, StatusPill, ToggleRow } from './kit';

/*
 * CONNECTIONS — everything PRSH talks to outside itself.
 *
 * THE MEMBERSHIP RULE, because a settings page with no rule becomes the
 * settings page this one was carved out of: *if it doesn't point at something
 * outside PRSH, it isn't on this tab.* The game's HUD file, an asset pack on
 * disk, a gc-overlay binary and its subprocess, OBS's websocket, the network
 * PRSH binds to, the Rio API. Preferences (theme, side vocabulary, confirm
 * mode, txt export) stay in the Settings modal; so do the escape hatches (Reset
 * State, Logs), which would dilute the rule on day one.
 *
 * WHY A TAB AND NOT A MODAL. Every item here has a failure state with a
 * diagnostic readout — a missing-file census, a found/not-found path, a version,
 * a live controller preview — and you check those AGAINST REALITY: you drag
 * files into a folder, plug a pad in, start OBS, and look again. A modal has to
 * be closed to do any of that, which is why the old one re-checked the asset
 * folder on window focus. That workaround is this tab's whole argument.
 *
 * WHY NOT A DESK. It was considered and fails the console's own rule
 * (`.claude/skills/production-console-contract/reference/desks.md`): a rack row's
 * meta must read from State only, and a connection health summary costs three
 * REST calls. The rack's permanent tiers are also the most expensive rows on the
 * page, and this is once-per-machine work.
 *
 * Each connection is its own CARD owning its own fetches — not one mega
 * component with everyone's state, which is what the modal became at 995 lines.
 * The cards share one row kit (./kit.jsx): the status pill in the header, once,
 * and a body of hairline-split sections.
 */

/*
 * How PRSH serves itself. It points outward — at the network — so it belongs
 * here rather than with the preferences.
 *
 * The switch is a SETTING and the bind happens at boot, so the two disagree
 * until a restart; the card reads both (`GET /network`) and says so in the
 * pill. What it shows beneath the switch is the one thing a producer turning
 * LAN on wants next: the address to open on the phone.
 */
function NetworkConnection() {
    const setSetting = useSettingsStore(state => state.setItem);
    const allowLan = useSettingsStore(state => state?.server?.allow_lan) === true;
    const [net, setNet] = useState(null);

    const refresh = useCallback(async () => {
        try { setNet(await (await fetch('/api/v1/network')).json()); } catch { /* keep last */ }
    }, []);
    useEffect(() => { refresh(); }, [refresh]);
    // While LAN is wanted, keep the "last reached from" line current — it is
    // read while someone is trying a second device right now.
    useEffect(() => {
        if (!allowLan) return undefined;
        const id = setInterval(refresh, 10000);
        return () => clearInterval(id);
    }, [allowLan, refresh]);

    const handleAllowLan = useCallback((value) => {
        setSetting('server.allow_lan', !!value);
        notifications.show({ message: 'Restart PRSH for the change to take effect.', color: 'yellow' });
    }, [setSetting]);

    // null = the server can't say how it is bound; trust the setting then
    // rather than inventing a pending restart.
    const live = net?.lan_bound ?? allowLan;
    const pending = net?.lan_bound != null && net.lan_bound !== allowLan;
    const port = net?.port ?? window.location.port;

    const pill = pending
        ? <StatusPill tone="warn" title={allowLan ? 'LAN is on, but PRSH is still bound to this computer' : 'LAN is off, but PRSH is still reachable on the network'}>Restart to apply</StatusPill>
        : live ? <StatusPill tone="warn">LAN</StatusPill> : <StatusPill>This computer only</StatusPill>;

    // The phone's address once LAN is on (now or after the restart); this
    // computer's otherwise. Loopback is never offered to a phone.
    const lanUrls = (net?.addresses ?? []).map(ip => `http://${ip}:${port}`);
    const urls = allowLan ? lanUrls : [`http://127.0.0.1:${port}`];

    return (
        <ConnCard title="Network" status={pill}>
            <Section>
                <ToggleRow
                    checked={allowLan} onChange={handleAllowLan}
                    tone={allowLan ? 'warn' : undefined}
                    label="Allow LAN access"
                    /* The restart is named in the OFF state only. Turning it
                       on puts RESTART TO APPLY in the pill and `— after
                       restart` on the address label; a third copy in the hint
                       would be the header rule ("the status, once") broken on
                       the one row already shouting. Off, nothing else says it,
                       and it is what a producer needs before they flip. */
                    hint={allowLan
                        ? 'Any device on this network can open PRSH — which means controlling your broadcast and reading saved API keys. Turn it off when you are not using a second device.'
                        : 'PRSH answers only on this computer. Turn it on to open the console from a phone, a tablet, or a second PC on the same network — applies when PRSH restarts.'}
                />
            </Section>
            <Section className="gap-1.5">
                <FieldLabel>
                    {allowLan ? (pending ? 'Phone / tablet — after restart' : 'Phone / tablet') : 'This computer'}
                </FieldLabel>
                {urls.length === 0 && allowLan && (
                    <span className="text-xs text-red-300">No network address found — is this computer on WiFi?</span>
                )}
                {urls.map(url => <UrlRow key={url} url={url} dimmed={pending} />)}
                {/* WHAT THE SWITCH WOULD GIVE YOU, at the address it would give
                    it to you at. With LAN off this section said `Address:
                    127.0.0.1` — the one address a producer already has, since
                    they are reading it in the app it serves — and said nothing
                    about the thing the card is actually for. */}
                {!allowLan && lanUrls.length > 0 && (
                    <Hint>
                        With LAN access on, this computer answers at{' '}
                        <span className="font-mono text-foreground/80">{lanUrls[0]}</span>.
                    </Hint>
                )}
            </Section>
            {allowLan && <PinSection net={net} onChange={refresh} />}
            {live && !pending && <ReachSection net={net} />}
        </ConnCard>
    );
}

/*
 * THE LAN PIN (server/lan_access.py). Off by default and invisible until LAN
 * access is on. The PRSH computer never needs it, so a single-machine producer
 * never meets it; a phone or second screen enters it once; an OBS on another
 * computer gets a key in its source URLs from the address repair — run right
 * after turning the PIN on, so those sources have it before their next load.
 *
 * Only the PRSH computer may see or change it (the server refuses anyone
 * else): a device let in BY the PIN must not be able to switch it off.
 */
function PinSection({ net, onChange }) {
    const [busy, setBusy] = useState(false);
    const self = net?.this_computer === true;
    const on = net?.pin_enabled === true;

    const change = useCallback(async (body) => {
        setBusy(true);
        try {
            const r = await fetch('/api/v1/network/pin', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error((await r.json())?.error || 'Could not change the PIN');
            await onChange();
            // Give an OBS on another computer its key (or the new one) now.
            await useObsStore.getState().repairSourceAddresses();
        } catch (e) {
            notifications.show({ message: e.message, color: 'red' });
        }
        setBusy(false);
    }, [onChange]);

    return (
        <Section className="gap-1.5">
            <ToggleRow
                checked={on} disabled={!self || busy}
                onChange={(v) => change({ enabled: v })}
                label="Require a PIN on other devices"
                hint={self
                    ? 'Other devices enter it once. This computer never does, and OBS is handled for you.'
                    : 'Change it from the computer running PRSH.'}
            />
            {on && self && net?.pin && (
                <div className="flex items-center gap-2">
                    <span className="flex h-8 items-center rounded-md border border-input bg-input/30 px-3 font-mono text-sm tracking-[0.3em] text-foreground">
                        {net.pin}
                    </span>
                    <Button size="sm" variant="outline" className={CONN_BTN} disabled={busy}
                        onClick={() => change({ regenerate: true })}>
                        New PIN
                    </Button>
                    <Hint>A new PIN signs every other device out.</Hint>
                </div>
            )}
        </Section>
    );
}

/*
 * IS ANYTHING GETTING THROUGH? PRSH can't test its own LAN address from the
 * inside — that traffic never crosses the firewall — so this answers from the
 * other side: the last request that arrived from another machine. A producer
 * reading this card is usually doing it because a second device can't connect,
 * and "nothing has ever reached PRSH" points straight at the firewall or the
 * address, where a green LAN pill alone said everything was fine.
 */
function ReachSection({ net }) {
    const seen = net?.last_remote;
    const publicNet = net?.network_category === 'Public';
    return (
        <Section className="gap-1.5">
            <FieldLabel>Other devices</FieldLabel>
            {seen
                ? <Hint>Last reached from <span className="font-mono text-foreground/80">{seen.ip}</span> {ago(seen.seconds_ago)}.</Hint>
                : <Hint>None yet. If one should have, check this computer's firewall.</Hint>}
            {publicNet && (
                <span className="text-xs text-amber-300">
                    Windows has this network set to Public, which blocks other devices. Switch it to Private
                    in Settings → Network &amp; internet.
                </span>
            )}
        </Section>
    );
}

function ago(seconds) {
    if (seconds < 15) return 'just now';
    if (seconds < 90) return `${seconds}s ago`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
    return `${Math.round(seconds / 3600)} h ago`;
}

function UrlRow({ url, dimmed }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className={cn(
                'flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-input bg-input/30 px-2.5 font-mono text-xs',
                dimmed ? 'text-muted-foreground' : 'text-foreground',
            )}>
                {url}
            </span>
            <CopyButton value={url}>
                {({ copied, copy }) => (
                    <Button size="sm" variant="outline" className={cn(CONN_BTN, 'w-16')} onClick={copy}>
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                )}
            </CopyButton>
        </div>
    );
}

export default function Connections() {
    return (
        <div className="flex flex-col gap-3">
            <Title order={3}>Connections</Title>

            {/* THREE COLUMNS, then two full-width rows. The three narrow cards are
                a path, a websocket address and a switch — each reads best at
                about a third of the page, and side by side they are one row
                instead of the two-and-a-half they took in two columns. The
                image pack (five census tiles) and the controller reader (four
                512×180 previews) genuinely need the width, so they span it.

                `lg:` rather than `md:`: below ~1024px three columns squeeze the
                OBS host/port row and a path's buttons into each other.

                ONE HEIGHT FOR THE ROW, AND THE SLACK GOES TO THE BOTTOM.
                The grid's default stretch is what keeps the three cards level;
                what made a stretched card look broken was never the stretch but
                `mt-auto` on its last section, which pushed the leftover space
                into the MIDDLE to buy a footer line that only ever aligned two
                of the three. A hole between two sections reads as content
                failing to load; the same space under the last one reads as a
                card with less in it, which is the truth. So: no `mt-auto`
                anywhere on this tab, and each card's sections flow from the
                top. `items-start` was tried in between and is the other trade —
                no slack at all, ragged bottoms — and the producer wants the
                level row. */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <RioHudConnection />
                <ObsConnection />
                <NetworkConnection />
                <MsbAssetsConnection />
                <ControllerConnection />
            </div>
        </div>
    );
}

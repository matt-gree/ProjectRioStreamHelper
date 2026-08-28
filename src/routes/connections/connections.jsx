import { Title, Text } from '../../components/ui/primitives';
import { Panel } from '../../components/ui/panel';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { Label } from '../../components/ui/label';
import { notifications } from '../../lib/notify';
import { useSettingsStore } from '../../context/store';
import { useCallback } from 'react';
import { RioHudConnection, MsbAssetsConnection } from './rio';
import ObsConnection from './obs';
import ControllerConnection from './controller';

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
 */

// A card's health chip. Three states rather than two: "unknown" is honest while
// a fetch is in flight, and reads better than flashing "Not found" at a producer
// whose setup is fine.
export function ConnBadge({ state, ok = 'Connected', bad = 'Not found', idle = 'Checking…' }) {
    if (state == null) return <Badge className="bg-muted text-muted-foreground">{idle}</Badge>;
    return state
        ? <Badge className="bg-[#22c55e] text-black">{ok}</Badge>
        : <Badge className="bg-destructive text-white">{bad}</Badge>;
}

// The body every card shares. Cards are titled modules (Panel's flush header),
// so the padding lives here rather than in each section.
export function ConnBody({ children }) {
    return <div className="flex flex-col gap-2 p-4">{children}</div>;
}

/*
 * How PRSH serves itself. It points outward — at the network — so it belongs
 * here rather than with the preferences, and it is the one card that is a single
 * switch: the warning is the content.
 */
function NetworkConnection() {
    const setSetting = useSettingsStore(state => state.setItem);
    const allowLan = useSettingsStore(state => state?.server?.allow_lan) === true;
    const handleAllowLan = useCallback((value) => {
        setSetting('server.allow_lan', !!value);
        notifications.show({
            message: value
                ? 'LAN access enabled. Restart PRSH for the change to take effect.'
                : 'LAN access disabled. Restart PRSH for the change to take effect.',
            color: 'yellow',
        });
    }, [setSetting]);

    return (
        <Panel
            title="Network"
            className="lg:col-span-2"
            actions={<Badge className={allowLan ? 'bg-[#f5bb00]/15 text-[#f5bb00]' : 'bg-muted text-muted-foreground'}>
                {allowLan ? 'LAN' : 'This computer only'}
            </Badge>}
        >
            <ConnBody>
                <Label className="flex items-start gap-2">
                    <Switch checked={allowLan} onCheckedChange={handleAllowLan} className="mt-0.5" />
                    <span className="flex flex-col">
                        <Text size="sm">Allow LAN access (bind 0.0.0.0)</Text>
                        <Text size="xs" dimmed>
                            By default PRSH listens on loopback only (127.0.0.1) — only this computer can reach
                            the UI and OBS overlays. Enable LAN access to use a phone or tablet on the same WiFi
                            as a remote control. Anyone on the network will be able to read and modify
                            scoreboards, settings, and any saved tournament API keys, so leave this off on
                            shared networks (cafes, conventions).
                        </Text>
                    </span>
                </Label>
            </ConnBody>
        </Panel>
    );
}

export default function Connections() {
    return (
        <div className="flex flex-col gap-4">
            <Title order={3}>Connections</Title>
            <Text size="sm" dimmed>
                Everything PRSH talks to outside itself — the game, your image pack, OBS, the controller
                reader. Set these once per machine; come back here when something on the broadcast has
                stopped answering.
            </Text>

            {/* TWO COLUMNS, because most of these cards are short lines of text
                and a path input — at full page width they were a few controls
                marooned in a 1280px band. A card SPANS both only when it has
                something that genuinely needs the width: the asset census (five
                counted categories beside the path, then a line of missing
                filenames per category) and the controller previews (four
                512×256 frames). Everything else reads better narrow.

                `lg:` rather than `md:`: below ~1024px two columns would squeeze
                the OBS host/port row and the census into each other. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Narrow cards first and adjacent, so they pair into row 1.
                    A spanning card between them would be bumped to its own row
                    and leave the hole beside it. */}
                <RioHudConnection />
                <ObsConnection />
                <MsbAssetsConnection />
                <ControllerConnection />
                <NetworkConnection />
            </div>
        </div>
    );
}

/*
 * Passes over PRSH's own browser sources in OBS — every input, not only the
 * mirrored scenes, because a source in a scene nobody expanded is exactly the
 * one that would otherwise be missed:
 *
 *   repairSourceAddresses   a URL that no longer reaches PRSH gets one that does
 *   upgradeRetiredNames     a name in a retired form gets today's
 *   upgradeRetiredCanvases  a source at an outgrown canvas is offered a resize
 *   followUrlWithName       a name PRSH gave follows the URL it describes
 *
 * The first three run in that order after every connect (obs.jsx).
 */
import { checkObsSources, obsHostSetting } from '../lib/obs-reach';
import { notifications } from '../lib/notify';
import { upgradeRetiredCanvas } from '../routes/production/sources/canvas-migrate';
import { renameForUrl, upgradeRetiredName } from '../routes/production/sources/sourcename';
import { useObsStore } from './obs';
import { inputSettingsFor, isPrshUrl, session } from './obs-session';
import { useSettingsStore } from './store';

/*
 * THE ADDRESS REPAIR — every PRSH browser source whose URL no longer reaches
 * PRSH from where OBS is gets the address that does.
 *
 * A source's address goes stale with nothing to say so: made on the PRSH
 * machine it says 127.0.0.1 and OBS is elsewhere; the router hands PRSH a new
 * IP; LAN access goes off; PRSH moves off a busy port. The rack recognises a
 * source by its PATH, so a dead one went on listing as healthy while the scene
 * drew nothing. Only BROKEN sources are rewritten (the server judges, see
 * server/source_addresses.py) — a rewrite reloads the source, and this runs on
 * every OBS connect and every PRSH reconnect (a LAN or port change needs a
 * restart, and the console's OBS connection survives one), mid-show included.
 *
 * ALL inputs, not the mirrored scenes, like the rename pass. One toast when
 * something moved; a louder one when nothing CAN reach PRSH (OBS on another
 * machine with LAN access off), because then the fix is the producer's.
 */
export async function repairSourceAddresses(gen = session.generation) {
    if (!session.client) return;
    let inputs;
    try {
        ({ inputs } = await session.client.call('GetInputList', { inputKind: 'browser_source' }));
    } catch {
        return;
    }
    const byUrl = new Map();
    for (const { inputName } of inputs || []) {
        if (gen !== session.generation) return;
        const url = (await inputSettingsFor(inputName, gen))?.url;
        if (!url || !isPrshUrl(url)) continue;
        if (!byUrl.has(url)) byUrl.set(url, []);
        byUrl.get(url).push(inputName);
    }
    if (!byUrl.size || gen !== session.generation) return;
    const { fixed, unreachable } = await checkObsSources([...byUrl.keys()], obsHostSetting(useSettingsStore.getState()));
    if (gen !== session.generation) return;
    let moved = 0;
    for (const [from, to] of Object.entries(fixed)) {
        for (const inputName of byUrl.get(from) || []) {
            try {
                await session.client.call('SetInputSettings', { inputName, inputSettings: { url: to }, overlay: true });
                moved++;
            } catch { /* removed meanwhile */ }
        }
    }
    if (moved) {
        notifications.show({
            id: 'source-addresses',
            color: 'green',
            message: `Pointed ${moved} PRSH source${moved === 1 ? '' : 's'} in OBS at PRSH's current address — `
                + `${moved === 1 ? 'it' : 'they'} could no longer reach it.`,
        });
    }
    const stranded = unreachable.reduce((n, url) => n + (byUrl.get(url)?.length || 0), 0);
    if (stranded) {
        notifications.show({
            id: 'source-addresses-unreachable',
            color: 'yellow',
            autoClose: false,
            title: `${stranded} PRSH source${stranded === 1 ? '' : 's'} can't reach PRSH`,
            message: 'OBS is on another computer and LAN access is off. Turn on LAN access on the Connections tab and restart PRSH.',
        });
    }
}

/*
 * A source's NAME follows its URL — when PRSH named it.
 *
 * The URL is what a source reads; the name is only what OBS lists it as. When a
 * board switch or a producer's own edit in OBS Properties changes the URL, a
 * name PRSH gave it ("Stat Bar — Side 1 (Board 1)") would go on describing the
 * old one. So a name that is one PRSH gives the OLD url is rewritten to the one
 * it gives the new url; anything else is the producer's and is never touched
 * (../routes/production/sourcename). Every PRSH console receives the event, so a
 * second one's rename finds the old name gone and is dropped.
 */
export function followUrlWithName(inputName, url) {
    if (!url || !isPrshUrl(url)) return;
    const items = Object.values(useObsStore.getState().sceneItems).flat();
    const before = items.find(it => it.sourceName === inputName)?.url;
    const settings = useSettingsStore.getState() || {};
    const active = settings?.scoreboards?.active;
    const next = renameForUrl(inputName, before, url, {
        boards: Array.isArray(active) && active.length ? active : [1],
        mode: settings?.production?.side_labels,
    });
    if (!next) return;
    session.client?.call('SetInputName', { inputName, newInputName: next })
        .catch(() => { /* name taken, or another console got there first */ });
}

/*
 * THE ONE-TIME RENAME PASS — every PRSH browser source still wearing a name in a
 * retired form ("Stat Bar — Side 1 1", "Scoreboard Small 2") gets today's
 * ("Stat Bar — Side 1 (Board 1)"). See `upgradeRetiredName`.
 *
 * Runs on every connect, and that is what "one-time" means here: it only ever
 * matches a retired form, so after the first pass there is nothing left for it
 * to do and a name the producer typed is never a candidate. ALL inputs, not the
 * mirrored scenes — a source in a scene nobody has expanded is exactly the one
 * that would otherwise keep its old name forever. One toast, only when
 * something moved.
 */
export async function upgradeRetiredNames(gen) {
    if (!session.client) return;
    let inputs;
    try {
        ({ inputs } = await session.client.call('GetInputList', { inputKind: 'browser_source' }));
    } catch {
        return;
    }
    const settings = useSettingsStore.getState() || {};
    const active = settings?.scoreboards?.active;
    const ctx = {
        boards: Array.isArray(active) && active.length ? active : [1],
        mode: settings?.production?.side_labels,
    };
    let renamed = 0;
    for (const { inputName } of inputs || []) {
        if (gen !== session.generation) return;
        const url = (await inputSettingsFor(inputName, gen))?.url;
        if (!url || !isPrshUrl(url)) continue;
        const next = upgradeRetiredName(inputName, url, ctx);
        if (!next) continue;
        try {
            // InputNameChanged moves the mirror and the settings cache.
            await session.client.call('SetInputName', { inputName, newInputName: next });
            renamed++;
        } catch { /* the new name is taken — leave this one as it is */ }
    }
    if (renamed && gen === session.generation) {
        notifications.show({
            color: 'green',
            message: `Renamed ${renamed} PRSH source${renamed === 1 ? '' : 's'} in OBS to name `
                + 'the side and board plainly — e.g. “Stat Bar — Side 1 (Board 2)”.',
        });
    }
}

/*
 * THE RETIRED-CANVAS PROMPT — every PRSH browser source still at a canvas its
 * element has since outgrown (`RETIRED_CANVASES`: the Stat Bar 452x118 and the
 * Stat Card 380x240, before their roster band).
 *
 * At the old resolution the page fits its taller canvas into the old box and
 * the whole card draws smaller. Whether to fix that is the PRODUCER's call — a
 * finished scene is theirs — so this asks, once, in one toast:
 *
 *   Resize     grows each source (`growBrowserSource`): it stays where and as
 *              big as it was on screen, a crop keeps showing the same area,
 *              and the new height opens underneath.
 *   Keep size  touches nothing, and is remembered in this browser (by source
 *              name AND size) so the question is not asked on every connect.
 *
 * Only a resolution EXACTLY at a retired size is a candidate, so a size set by
 * hand never is, and once resized there is nothing left to ask about.
 */
const KEPT_CANVASES = 'prsh.ui.production.keptCanvases';
const keptKey = (name, s) => `${name}@${s.width}x${s.height}`;
function readKept() {
    try {
        const v = JSON.parse(localStorage.getItem(KEPT_CANVASES) || '[]');
        return new Set(Array.isArray(v) ? v : []);
    } catch { return new Set(); }
}
function writeKept(set) {
    try { localStorage.setItem(KEPT_CANVASES, JSON.stringify([...set])); } catch { /* private window */ }
}
// A Keep size is an answer about a SOURCE, so it follows the source's name — or
// a rename would ask the question again on the next connect. Split on the LAST
// '@': a source name may hold one, the size never does.
export function renameKeptCanvases(from, to) {
    const kept = readKept();
    let moved = false;
    const next = new Set([...kept].map((k) => {
        const at = k.lastIndexOf('@');
        if (at < 0 || k.slice(0, at) !== from) return k;
        moved = true;
        return `${to}${k.slice(at)}`;
    }));
    if (moved) writeKept(next);
}

export async function upgradeRetiredCanvases(gen) {
    if (!session.client) return;
    let inputs;
    try {
        ({ inputs } = await session.client.call('GetInputList', { inputKind: 'browser_source' }));
    } catch {
        return;
    }
    const kept = readKept();
    const stale = [];
    for (const { inputName } of inputs || []) {
        if (gen !== session.generation) return;
        const settings = await inputSettingsFor(inputName, gen);
        const url = settings?.url;
        if (!url || !isPrshUrl(url)) continue;
        const next = upgradeRetiredCanvas(url, settings.width, settings.height);
        if (!next) continue;
        const from = { width: Number(settings.width), height: Number(settings.height) };
        if (kept.has(keptKey(inputName, from))) continue;
        stale.push({ inputName, from, to: { width: next.width, height: next.height } });
    }
    if (!stale.length || gen !== session.generation) return;

    const n = stale.length;
    const plural = n === 1 ? '' : 's';
    notifications.show({
        id: 'retired-canvases',
        color: 'yellow',
        autoClose: false,
        title: `Resize ${n} stat card source${plural} in OBS?`,
        // Short: sonner sets the two buttons BESIDE the text, so every word
        // here narrows the column the rest wraps into.
        message: 'They grew a roster row. Resize keeps each looking the same on screen.',
        action: {
            label: 'Resize',
            onClick: async () => {
                const failed = [];
                let done = 0;
                for (const s of stale) {
                    try {
                        await useObsStore.getState().growBrowserSource({
                            sourceName: s.inputName, from: s.from, width: s.to.width, height: s.to.height,
                        });
                        done++;
                    } catch {
                        failed.push(s.inputName);
                    }
                }
                if (done) {
                    notifications.show({
                        color: 'green',
                        message: `Resized ${done} source${done === 1 ? '' : 's'} — each draws where and as big as it did.`,
                    });
                }
                if (failed.length) {
                    notifications.show({
                        color: 'red',
                        message: `Couldn’t resize ${failed.join(', ')} — set its size in OBS Properties instead.`,
                    });
                }
            },
        },
        cancel: {
            label: 'Keep size',
            onClick: () => {
                const set = readKept();
                for (const s of stale) set.add(keptKey(s.inputName, s.from));
                writeKept(set);
            },
        },
    });
}

import { useEffect, useState } from 'react';

/*
 * obs-reach.js — the address OBS must be handed to reach THIS PRSH.
 *
 * A source URL bakes in an address, and the console builds every URL from the
 * host ITS browser reached PRSH at — `127.0.0.1` on the PRSH machine, which on
 * any other machine names that machine. So a console on the gaming PC driving
 * OBS on a laptop created sources that were sized, enabled and blank. A router
 * handing PRSH a new IP, LAN access going off, or PRSH moving port does the
 * same to sources that used to work, and the console (which recognises a
 * source by its PATH) goes on listing them as healthy.
 *
 * The rule lives on the SERVER (`server/source_addresses.py`, `POST
 * /network/obs-sources`), because only it can answer the two hard questions:
 * which machine this browser is on, and whether an IP is still this machine.
 * This file is its client, used on the way in (`addBrowserSource`,
 * `repointBrowserSource`) and to repair what is already in OBS on connect.
 */

export const obsHostSetting = (settings) => settings?.obs?.host || '127.0.0.1';

export async function checkObsSources(urls, obsHost) {
    if (!urls.length) return { fixed: {}, unreachable: [] };
    try {
        const r = await fetch('/api/v1/network/obs-sources', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ obs_host: obsHost, urls }),
        });
        if (!r.ok) return { fixed: {}, unreachable: [] };
        const body = await r.json();
        return { fixed: body.fixed || {}, unreachable: body.unreachable || [], base: body.base, where: body.where };
    } catch {
        return { fixed: {}, unreachable: [] };
    }
}

/* The URL to give OBS for a source about to be created or re-pointed. */
export async function resolveUrlForObs(url, settings) {
    if (!url) return url;
    const { fixed } = await checkObsSources([url], obsHostSetting(settings));
    return fixed[url] || url;
}


/*
 * Copy URL's answer. The producer may paste it into OBS on either machine, so
 * the LAN address is the one that works on both — when PRSH is listening on
 * it. Loopback otherwise, unchanged.
 *
 * Synchronous over a network answer fetched AHEAD of the click: a clipboard
 * write needs the click's user activation, and an await on the server in
 * between can spend it (Safari is strict about this).
 */
export function lanCopy(text, net) {
    const lanBound = net?.lan_bound ?? net?.allow_lan;
    const addr = net?.addresses?.[0];
    if (!text || !lanBound || !addr) return text;
    return String(text).split('\n').map((line) => {
        let u;
        try { u = new URL(line); } catch { return line; }
        if (!isLoopback(u.hostname)) return line;
        u.hostname = addr;
        return u.toString();
    }).join('\n');
}

let netPromise = null;
export function fetchNetwork() {
    netPromise ??= fetch('/api/v1/network').then(r => r.json()).catch(() => { netPromise = null; return null; });
    return netPromise;
}

export function isLoopback(host) {
    const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || h.startsWith('127.') || h.endsWith('.localhost');
}

/* `lanCopy` against a once-fetched network answer, for a Copy URL button. */
export function useCopyableUrl(text) {
    const [net, setNet] = useState(null);
    useEffect(() => {
        let live = true;
        fetchNetwork().then(n => { if (live) setNet(n); });
        return () => { live = false; };
    }, []);
    return lanCopy(text, net);
}

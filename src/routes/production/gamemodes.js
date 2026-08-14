import { useEffect, useMemo, useState } from 'react';

/*
 * THE GAME-MODE CATALOGUE, IN TWO TIERS.
 *
 * Project Rio has ~200 game modes and 16 of them are running this week. Every
 * console surface that names a mode used to fetch only the active list, which
 * is right for PICKING and wrong as a vocabulary: a board's mode comes from the
 * game it is carrying, and a pool of completed games is mostly ended seasons the
 * active list no longer names. The symptom was a picker rendering its
 * placeholder while the board held a perfectly good tag, and a pool filter that
 * could not search a season that finished last month.
 *
 * So: both tiers, ACTIVE FIRST. `/rio/game-modes` is the active list;
 * `?scope=all` is the catalogue; the difference is what has ended. Options come
 * back grouped ('Active' / 'Ended') for a picker to render in that order — the
 * modes in use stay at the top of the list where they were, and the rest are
 * reachable underneath instead of absent.
 *
 * Ordering note: the catalogue is a name→id map from the API, so 'Ended' is in
 * whatever order Project Rio returns. Nobody scrolls 180 modes — they search —
 * and re-sorting alphabetically would put "2.1.0 Test" above every season a
 * producer might actually mean.
 */
export const ACTIVE_GROUP = 'Active';
export const ENDED_GROUP = 'Ended';

/*
 * Both tiers, fetched once per mount. The server answers each from its own
 * cache (the active list in memory, the catalogue from pyrio's disk cache), so
 * this is two cheap calls rather than two round-trips to Project Rio — and the
 * per-mount fetch is what makes Settings → Refresh game data show up here.
 */
export function useGameModes() {
    const [tiers, setTiers] = useState({ active: [], ended: [] });

    useEffect(() => {
        let live = true;
        Promise.all([
            fetch('/api/v1/rio/game-modes').then(r => r.json()),
            fetch('/api/v1/rio/game-modes?scope=all').then(r => r.json()),
        ])
            .then(([active, all]) => {
                if (!live) return;
                const activeNames = Object.keys(active || {});
                const activeSet = new Set(activeNames);
                setTiers({
                    active: activeNames,
                    ended: Object.keys(all || {}).filter(n => !activeSet.has(n)),
                });
            })
            .catch(() => {});
        return () => { live = false; };
    }, []);

    return useMemo(() => ({
        active: tiers.active,
        ended: tiers.ended,
        options: [
            ...tiers.active.map(n => ({ value: n, label: n, group: ACTIVE_GROUP })),
            ...tiers.ended.map(n => ({ value: n, label: n, group: ENDED_GROUP })),
        ],
    }), [tiers]);
}

/*
 * The catalogue plus whatever this surface is already holding.
 *
 * A mode can reach a board from the feed before it reaches any list — a cold
 * catalogue, a mode created since the last cache refresh — and a picker that
 * cannot render its own value claims nothing is set. Extras go in their own
 * group so the two lists stay honest about what they are.
 */
export function withHeldModes(options, ...held) {
    const extra = held.filter(
        (m, i, arr) => m && arr.indexOf(m) === i && !options.some(o => o.value === m),
    );
    return extra.length
        ? [...options, ...extra.map(m => ({ value: m, label: m, group: ENDED_GROUP }))]
        : options;
}

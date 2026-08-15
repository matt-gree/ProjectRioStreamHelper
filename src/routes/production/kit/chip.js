// Status chips — the console's ONE status language (see the
// production-console-contract skill). Every surface (rack row, rail card,
// panel header) derives its chip from the same binding read, so a rack row
// and its rail card can never disagree.
//
//   AIR  — source enabled in the program scene
//   PVW  — source enabled in the studio-preview scene (staged in OBS)
//   OFF  — an OBS source that isn't reaching the broadcast
//   —    — no matching OBS source anywhere we can see
//   DESK — content workflow (Match, Capture): feeds the broadcast, not on it

/*
 * A placement's chip (./placements). The chip's subject is what this copy of
 * the source contributes to the BROADCAST, which is why the scene decides it:
 *
 *   program scene  → enabled ? AIR : OFF
 *   preview scene  → enabled ? PVW : OFF
 *   any other      → OFF, enabled or not
 *
 * That last line is the one worth being deliberate about. A source enabled in a
 * Break scene nobody has cut to is not on the broadcast, so AIR would be a lie;
 * OFF is the honest read, and the row's eye still shows the item's own state so
 * the producer can see what WILL come up when that scene does. Scene grouping
 * adds a coordinate to the vocabulary rather than a word to it.
 *
 * A FED element (a member's slot on a container) takes both conditions. Its
 * content reaches the broadcast only if the container source is up AND the
 * container is carrying THIS element's content — one container holds one feed.
 * Reading the container's enabled state alone is how Character Spotlight and
 * Game Summary both used to say AIR while only one of them could be on screen.
 * AIR keeps meaning exactly what it always meant; a fed element just has two
 * ways to not be on.
 *
 * WHICH KIND OF ROW THIS IS COMES FROM `slot`, not `parent` — the one statement
 * of that question lives in ../placements (`isFedPlacement`), and this asked it
 * a second way. They agree for a row either builder produced, because those
 * carry both; they part company on a row RESOLVED from a stored id, which
 * `sourcelessPlacement` rebuilds with its slot and no parent. Two spellings of
 * one fact is how the console's identity bugs have started every time.
 *
 * Desk rows never derive — they pass state="desk" explicitly.
 */
export function chipFor(placement) {
    // No source anywhere — the one case that isn't about scenes at all.
    if (!placement?.item) return 'unbound';
    const live = placement.slot
        ? placement.item.enabled && !!placement.mine
        : placement.item.enabled;
    if (placement.where === 'program') return live ? 'air' : 'off';
    if (placement.where === 'preview') return live ? 'pvw' : 'off';
    return 'off';
}

export const CHIP_META = {
    air: {
        label: 'AIR',
        title: 'On air — enabled in the program scene',
        className: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 shadow-[0_0_6px] shadow-emerald-400/30',
    },
    pvw: {
        label: 'PVW',
        title: 'In studio preview — staged in OBS, not yet taken',
        className: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
    },
    off: {
        label: 'OFF',
        title: 'Not on the broadcast — hidden, or in a scene that isn’t live',
        className: 'border-border bg-transparent text-muted-foreground',
    },
    unbound: {
        label: '—',
        title: 'No matching OBS source',
        className: 'border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground/70',
    },
    desk: {
        label: 'DESK',
        title: 'Content workflow — feeds the broadcast, not an OBS source',
        className: 'border-rio-500/50 bg-rio-500/10 text-rio-400',
    },
};

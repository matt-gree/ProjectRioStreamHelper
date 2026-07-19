// Status chips — the console's ONE status language (see the
// production-console-contract skill). Every surface (rack row, rail card,
// panel header) derives its chip from the same binding read, so a rack row
// and its rail card can never disagree.
//
//   AIR  — source enabled in the program scene
//   PVW  — source enabled in the studio-preview scene (staged in OBS)
//   OFF  — bound to an OBS source, currently hidden
//   —    — no matching OBS source anywhere we can see
//   DESK — content workflow (Match, Capture): feeds the broadcast, not on it

// Derive a chip state from useElementBindings output ({ program, preview }).
// Program wins over preview, matching which binding the controls act on.
// Desk rows never derive — they pass state="desk" explicitly.
export function chipState(bindings) {
    const { program, preview } = bindings ?? {};
    if (program?.item?.enabled) return 'air';
    if (preview?.item?.enabled) return 'pvw';
    if (program || preview) return 'off';
    return 'unbound';
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
        title: 'Bound to an OBS source, currently hidden',
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

// Control metrics for the production console kit. One rhythm: a 28px (h-7)
// control row — every kit row is min-h-7 and every control inside sizes to it.
//
// KIT_INPUT is the console-standard compact input. KIT_FIELD (32px, desk
// forms) and KIT_INPUT_FLOW (content-height, the lower-third editors) are the
// two legacy shapes still referenced by pre-console faces in production.jsx;
// they collapse into KIT_INPUT as those faces migrate to stage bodies
// (production-console-plan slices 4–5).

export const KIT_INPUT = 'h-7 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground';
export const KIT_INPUT_FLOW = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground';
export const KIT_FIELD = 'h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground';

// Control metrics for the production console kit. One rhythm: a 28px (h-7)
// control row — every kit row is min-h-7 and every control inside sizes to it.
//
// KIT_INPUT is the console-standard compact input. KIT_FIELD (32px, desk
// forms) and KIT_INPUT_FLOW (content-height, the lower-third editors) are the
// two legacy shapes still referenced by pre-console faces in production.jsx;
// they collapse into KIT_INPUT as those faces migrate to stage bodies
// (production-console-plan slices 4–5).

export const KIT_INPUT = 'h-7 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground';

/*
 * The label column beside a field. 64px is right on a 252px rail card and a
 * 278px rack row — and it was the ONLY width, so on the stage, where a panel is
 * three or four times that, the same column clipped "Bottom Offset" to
 * "Bottom O…" while ~800px sat empty to the right of the input. The container
 * query measures the PANEL (PanelShell's body is the `@container`), so the
 * narrow surfaces, which are not containers at all, never match it and keep 64.
 */
export const KIT_LABEL = 'w-16 shrink-0 @lg:w-32';
export const KIT_INPUT_FLOW = 'w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground';
export const KIT_FIELD = 'h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground';
